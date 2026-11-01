#!/usr/bin/env node
/**
 * R505 self-test for plugins/dsh-link-collab/src/compute-engine.ts (the shadow comparison).
 *
 * The engine file is deliberately dependency-free (node:fs/node:path only), so it can be tested
 * without a DSH boot. These tests pin the approved hard constraints (review rounds 1 and 2):
 *   - default engine is 'ts'; unknown names are refused at configuration time;
 *   - observe() is read-only, never throws and schedules sampling OFF the response path;
 *   - the FIRST eligible call is sampled regardless of the counter (explicit first-sample);
 *   - sampling is throttled by both a call counter and a wall-clock interval, never overlaps;
 *   - a ledger over shadowMaxBytes disables the shadow and is counted;
 *   - diagnostics keep their fixed shape, carry sample p50/p99/max and never payload content;
 *   - the (size, mtime) cache is used, and its documented threat model is exercised.
 *
 * Run: node --test rust/scripts/compute-engine-selftest.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ENGINE = await import(pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-collab', 'src', 'compute-engine.ts')).href)

/** A ledger dir + one control.jsonl, cleaned up after the test. */
function withLedger(check) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-compute-engine-'))
  writeFileSync(join(directory, 'control.jsonl'), '{"seq":1,"kind":"member/state","payload":{"id":"m1","team":"t1"}}\n')
  try {
    check(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** An injected scheduler: samples run only when drain() is called, so tests stay deterministic. */
function manualScheduler() {
  const queued = []
  return { schedule: (task) => { queued.push(task) }, drain: () => { while (queued.length > 0) queued.shift()() } }
}

/** A fake compute facade whose index answers one fixed snapshot. */
function fakeService(snapshot, kind = 'native') {
  const openFoldIndex = () => ({ appendRecords: () => new Uint8Array(32), snapshot: () => snapshot })
  return { kind, openFoldIndex }
}

/** A collab-shaped state matching one member/team/task. */
function collabState(team = 't1') {
  return {
    members: [{ id: 'm1', team, state: 'active' }],
    tasks: [{ id: 'task-1', team, owner: 'm1', status: 'pending' }],
    teams: { teams: [{ id: 't1', parent: null, lead: 'm1' }] },
    counts: { folded: 1 },
  }
}

/** The compute snapshot with the same overlapping fields. */
function computeSnapshot(team = 't1') {
  return JSON.stringify({
    members: [{ id: 'm1', team, state: 'active' }],
    tasks: [{ id: 'task-1', team, owner: 'm1', state: 'pending' }],
    teams: [{ team: 't1', parent: null, lead: 'm1' }],
    records: 1,
  })
}

/** Build a shadow with the manual scheduler and a fixed clock. */
function makeShadow(directory, overrides = {}) {
  const scheduler = manualScheduler()
  const shadow = ENGINE.createComputeShadow({
    directory,
    getService: () => fakeService(computeSnapshot()),
    sampleEvery: 1,
    sampleIntervalMs: 0,
    schedule: scheduler.schedule,
    now: () => 1000,
    ...overrides,
  })
  return { shadow, scheduler }
}

test('the engine defaults to ts and only accepts the two documented names', () => {
  assert.equal(ENGINE.resolveFoldEngine(undefined).engine, 'ts')
  assert.equal(ENGINE.resolveFoldEngine({ fold: {} }).engine, 'ts')
  assert.equal(ENGINE.resolveFoldEngine({ fold: { engine: 'native-shadow' } }).engine, 'native-shadow')
  assert.throws(() => ENGINE.resolveFoldEngine({ fold: { engine: 'native' } }), /fold\.engine must be 'ts' or 'native-shadow'/)
})

test('the first eligible call is sampled even with sampleEvery 20 (explicit first-sample)', () => {
  withLedger((directory) => {
    const { shadow, scheduler } = makeShadow(directory, { sampleEvery: 20, sampleIntervalMs: 2000 })
    shadow.observe(collabState())
    assert.equal(shadow.diagnostics().runs, 0, 'observe() only schedules; the sample runs later')
    scheduler.drain()
    const diagnostics = shadow.diagnostics()
    assert.equal(diagnostics.calls, 1)
    assert.equal(diagnostics.runs, 1, 'first call must be sampled, not skipped until call 20')
  })
})

test('observe() itself does no I/O and never throws, and an unavailable service is counted', () => {
  withLedger((directory) => {
    const { shadow, scheduler } = makeShadow(directory, { getService: () => undefined })
    assert.doesNotThrow(() => shadow.observe(collabState()))
    scheduler.drain()
    const diagnostics = shadow.diagnostics()
    assert.equal(diagnostics.failures, 1)
    assert.match(String(diagnostics.lastError), /linkCompute is not mounted/)
  })
})

test('a matching sample reports no difference; a differing one names the first field', () => {
  withLedger((directory) => {
    const matching = makeShadow(directory)
    matching.shadow.observe(collabState())
    matching.scheduler.drain()
    assert.equal(matching.shadow.diagnostics().diffs, 0)
    assert.equal(matching.shadow.diagnostics().computeKind, 'native')

    const differing = makeShadow(directory, { getService: () => fakeService(computeSnapshot('t2')) })
    differing.shadow.observe(collabState('t1'))
    differing.scheduler.drain()
    const diagnostics = differing.shadow.diagnostics()
    assert.equal(diagnostics.failures, 0, String(diagnostics.lastError))
    assert.ok(diagnostics.diffs >= 2, 'member team and task team differ: ' + String(diagnostics.diffs))
    assert.equal(diagnostics.firstDiff.entity, 'member')
    assert.equal(diagnostics.firstDiff.field, 'team')
  })
})

test('sampling is throttled by the call counter and the wall clock, and never overlaps', () => {
  withLedger((directory) => {
    let clock = 0
    const { shadow, scheduler } = makeShadow(directory, { sampleEvery: 20, sampleIntervalMs: 2000, now: () => clock })
    // The first eligible call is sampled (and drained) before the burst, so the burst only sees
    // the counter/interval gates, which is the steady state of a live read path.
    shadow.observe(collabState())
    scheduler.drain()
    for (let call = 0; call < 100; call += 1) { clock += 10; shadow.observe(collabState()) }
    scheduler.drain()
    const diagnostics = shadow.diagnostics()
    assert.equal(diagnostics.calls, 101)
    assert.equal(diagnostics.runs, 1, 'only the first sample: later counter hits are inside the 2s interval')
    assert.equal(diagnostics.overlapped, 0, 'samples are drained immediately, so nothing overlaps')
    assert.ok(diagnostics.skipped >= 99)

    const overlap = makeShadow(directory, { sampleEvery: 1, sampleIntervalMs: 0 })
    overlap.shadow.observe(collabState())
    overlap.shadow.observe(collabState()) // scheduled but not drained: must not overlap
    assert.equal(overlap.shadow.diagnostics().overlapped, 1)
    overlap.scheduler.drain()
    assert.equal(overlap.shadow.diagnostics().runs, 1)
  })
})

test('a ledger over shadowMaxBytes disables the shadow and is counted', () => {
  withLedger((directory) => {
    const { shadow, scheduler } = makeShadow(directory, { shadowMaxBytes: 10 })
    shadow.observe(collabState())
    scheduler.drain()
    const diagnostics = shadow.diagnostics()
    assert.equal(diagnostics.oversizeSkips, 1)
    assert.equal(diagnostics.enabled, false)
    assert.equal(diagnostics.runs, 0)
    assert.match(String(diagnostics.disabledReason), /exceeds shadowMaxBytes/)
    // Once disabled it keeps counting calls but never samples again.
    shadow.observe(collabState())
    scheduler.drain()
    assert.equal(shadow.diagnostics().runs, 0)
  })
})

test('an unchanged (size, mtime) is answered from the cache; the threat model is exercised', () => {
  withLedger((directory) => {
    const path = join(directory, 'control.jsonl')
    const frozen = new Date(1700000000000)
    utimesSync(path, frozen, frozen)
    const { shadow, scheduler } = makeShadow(directory)
    shadow.observe(collabState())
    scheduler.drain()
    const before = shadow.diagnostics()
    shadow.observe(collabState())
    scheduler.drain()
    assert.equal(shadow.diagnostics().cacheHits, before.cacheHits + 1)
    // Same byte length, different content, mtime restored: exactly the rewrite the (size, mtime)
    // cache cannot see. Accepted only because the shadow answers no request; a serving path must
    // hash the bytes (documented threat model in compute-engine.ts).
    writeFileSync(path, readFileSync(path, 'utf8').replace('"m1"', '"m9"'))
    utimesSync(path, frozen, frozen)
    shadow.observe(collabState())
    scheduler.drain()
    assert.ok(shadow.diagnostics().cacheHits >= before.cacheHits + 2, 'same size+mtime is a cache hit')
  })
})

test('dispose releases the shared shadow: map empty, sampling stops, diagnostics read as disposed', () => {
  withLedger((directory) => {
    const { shadow, scheduler } = makeShadow(directory)
    shadow.observe(collabState())
    scheduler.drain()
    assert.equal(shadow.diagnostics().runs, 1)
    // Register it in the process map exactly like the collab row does, then release it.
    const shared = ENGINE.computeShadowFor({ directory, getService: () => fakeService(computeSnapshot()), sampleEvery: 1, sampleIntervalMs: 0, schedule: scheduler.schedule, now: () => 1000 })
    shared.observe(collabState())
    scheduler.drain()
    assert.equal(ENGINE.computeShadowDiagnostics().length, 1)
    ENGINE.disposeComputeShadow(directory)
    assert.equal(ENGINE.computeShadowDiagnostics().length, 0, 'dispose removes the directory entry')
    const runsAtDispose = shared.diagnostics().runs
    shared.observe(collabState())
    scheduler.drain()
    assert.equal(shared.diagnostics().runs, runsAtDispose, 'no sampling after dispose')
    assert.equal(shared.diagnostics().enabled, false)
    assert.equal(shared.diagnostics().disabledReason, 'disposed')
    // Idempotent, and a directory nobody registered is a no-op.
    assert.doesNotThrow(() => ENGINE.disposeComputeShadow(directory))
    assert.doesNotThrow(() => ENGINE.disposeComputeShadow(directory + '-never-created'))
  })
})

test('diagnostics keep the fixed shape, expose sample percentiles, and never include payload content', () => {
  withLedger((directory) => {
    let clock = 0
    const { shadow, scheduler } = makeShadow(directory, { now: () => { clock += 3; return clock } })
    shadow.observe(collabState())
    scheduler.drain()
    const diagnostics = shadow.diagnostics()
    assert.deepEqual(Object.keys(diagnostics).sort(), [
      'cacheHits', 'calls', 'computeKind', 'diffs', 'disabledReason', 'enabled', 'failures', 'firstDiff',
      'lastError', 'lastMs', 'mode', 'overlapped', 'oversizeSkips', 'runs', 'sampleMaxMs', 'sampleP50Ms',
      'sampleP99Ms', 'skipped',
    ].sort())
    assert.equal(diagnostics.mode, 'native-shadow')
    assert.equal(diagnostics.enabled, true)
    assert.ok(diagnostics.lastMs > 0)
    assert.ok(diagnostics.sampleP50Ms > 0 && diagnostics.sampleP99Ms > 0 && diagnostics.sampleMaxMs > 0)
    assert.ok(!JSON.stringify(diagnostics).includes('member/state'), 'no ledger payload content in diagnostics')
  })
})
