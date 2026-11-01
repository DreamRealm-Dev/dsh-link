/**
 * Behaviour of the loading policy and the fallback discipline.
 *
 * These run on plain Node (no kernel): the plugin's loading code is dependency-free, so the
 * failure paths that matter in production — missing addon, addon that throws — are testable
 * without a DSH boot. The kernel-side mounting proof lives in docs/handoff/R486-napi-mvp.md.
 *
 * Run: node --test plugins/dsh-link-compute/test/*.spec.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeCollabRecords, makeTeamEvents } from '../../../rust/scripts/fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const REPO = resolve(PLUGIN, '../..')
const ADDON = join(PLUGIN, 'lib', 'dsh_compute.node')

const { ComputeFacade, NATIVE_API_VERSION, REQUIRED_NATIVE_FEATURES, resolveBinding } = await import(pathToFileURL(join(PLUGIN, 'src', 'binding.ts')).href)
const { DEFAULT_CONFIG } = await import(pathToFileURL(join(PLUGIN, 'src', 'config.ts')).href)
const reference = await import(pathToFileURL(join(PLUGIN, 'src', 'reference.ts')).href)

/** A 1000-row fold fixture, serialised once. */
const COLLAB = JSON.stringify(makeCollabRecords(1000).rows)
/** A 12-member team fixture, serialised once. */
const TEAM = JSON.stringify(makeTeamEvents(12).events)

test('the row is off by default', () => {
  assert.equal(DEFAULT_CONFIG.enabled, false)
  assert.equal(DEFAULT_CONFIG.nativeEnabled, true)
})

test('a missing addon falls back to the TypeScript reference', () => {
  const binding = resolveBinding({ addonPath: join(PLUGIN, 'lib', 'does-not-exist.node') })
  assert.equal(binding.kind, 'typescript')
  assert.match(binding.detail, /no addon at/)
  const summary = JSON.parse(binding.foldCollabRecords(COLLAB))
  assert.equal(summary.records, 1000)
  assert.equal(summary.members.length, 24)
})

test('native: off never looks at the addon', () => {
  const binding = resolveBinding({ native: 'off' })
  assert.equal(binding.kind, 'typescript')
  assert.match(binding.detail, /native disabled by config/)
})

test('the addon loads when it is present', { skip: !existsSync(ADDON) }, () => {
  const binding = resolveBinding()
  assert.equal(binding.kind, 'native')
  assert.match(binding.version, /^0\.3\.0$/)
  const rustFold = binding.foldCollabRecords(COLLAB)
  assert.equal(rustFold, reference.foldCollabRecords(COLLAB), 'native and reference must agree byte for byte')
  assert.equal(binding.indexTeamStatus(TEAM), reference.indexTeamStatus(TEAM))
})

test('the incremental index agrees across the native and reference halves', { skip: !existsSync(ADDON) }, () => {
  const native = resolveBinding().openFoldIndex()
  const referenceIndex = resolveBinding({ native: 'off' }).openFoldIndex()
  const rows = JSON.parse(COLLAB)
  for (let index = 0; index < rows.length; index += 100) {
    const batch = JSON.stringify(rows.slice(index, index + 100))
    assert.equal(native.appendBatch(batch), referenceIndex.appendBatch(batch))
  }
  assert.equal(native.snapshot(), referenceIndex.snapshot())
  assert.equal(native.snapshot(), reference.foldCollabRecords(COLLAB))
  assert.equal(native.deltaSince(0), referenceIndex.deltaSince(0))
  assert.equal(native.version(), referenceIndex.version())
  assert.equal(native.records(), 1000)
  assert.equal(native.checksum(), referenceIndex.checksum())
})

test('the reference half opens an incremental index without the addon', () => {
  const index = resolveBinding({ native: 'off' }).openFoldIndex()
  const rows = JSON.parse(COLLAB)
  index.appendBatch(JSON.stringify(rows.slice(0, 500)))
  index.appendBatch(JSON.stringify(rows.slice(500)))
  assert.equal(index.snapshot(), reference.foldCollabRecords(COLLAB))
  assert.equal(index.version(), 2)
  assert.equal(index.records(), 1000)
  assert.match(index.deltaSince(1), /"fromVersion":1/)
})

/** Write a throwaway CommonJS addon and run `check` with its path; always cleans up. */
function withFakeAddon(source, check) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-compute-'))
  const fake = join(directory, 'fake-addon.cjs')
  writeFileSync(fake, source + '\n')
  try {
    check(fake)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The exports every native binding must carry, so a fake only varies the part under test. */
const FAKE_BASE = "module.exports = { foldCollabRecords: () => '{}', indexTeamStatus: () => '{}', nativeVersion: () => '0.0.0', CollabFoldIndex: class {}, probe: " 

test('the native half answers the probe with the required API version and features', { skip: !existsSync(ADDON) }, () => {
  const report = resolveBinding().probe()
  assert.equal(report.ok, true)
  assert.equal(report.kind, 'native')
  assert.equal(report.nativeApiVersion, NATIVE_API_VERSION)
  for (const feature of REQUIRED_NATIVE_FEATURES) assert.ok(report.features.includes(feature), 'probe is missing ' + feature)
  assert.equal(report.version, '0.3.0')
})

test('the reference half answers the probe without a native API version', () => {
  const report = resolveBinding({ native: 'off' }).probe()
  assert.equal(report.ok, true)
  assert.equal(report.kind, 'typescript')
  assert.equal(report.nativeApiVersion, null)
  assert.ok(report.features.includes('byteBatched'))
})

test('an addon without the incremental class is refused at load', () => {
  withFakeAddon("module.exports = { foldCollabRecords: () => '{}', indexTeamStatus: () => '{}', nativeVersion: () => '0.0.0' }", (fake) => {
    const binding = resolveBinding({ addonPath: fake })
    assert.equal(binding.kind, 'typescript')
    assert.match(binding.detail, /exports no CollabFoldIndex class/)
  })
})

test('an addon speaking another native API version is refused and falls back', () => {
  withFakeAddon(FAKE_BASE + "() => ({ ok: true, nativeApiVersion: 999, features: ['foldCollabRecords', 'indexTeamStatus', 'collabFoldIndex', 'byteBatched', 'deltaCursor', 'probe'] }) }", (fake) => {
    const binding = resolveBinding({ addonPath: fake })
    assert.equal(binding.kind, 'typescript')
    assert.match(binding.detail, /native API version 999/)
    assert.match(binding.detail, /requires 2/)
  })
})

test('an addon missing a required feature is refused and falls back', () => {
  withFakeAddon(FAKE_BASE + "() => ({ ok: true, nativeApiVersion: 2, features: ['foldCollabRecords', 'indexTeamStatus', 'collabFoldIndex', 'deltaCursor', 'probe'] }) }", (fake) => {
    const binding = resolveBinding({ addonPath: fake })
    assert.equal(binding.kind, 'typescript')
    assert.match(binding.detail, /missing native features byteBatched/)
  })
})

test('the ready/health readout exposes kind, nativeApiVersion and version', { skip: !existsSync(ADDON) }, () => {
  const facade = new ComputeFacade(resolveBinding())
  const health = facade.health()
  assert.equal(health.ok, true)
  assert.equal(health.kind, 'native')
  assert.equal(health.nativeApiVersion, NATIVE_API_VERSION)
  assert.equal(health.version, '0.3.0')
  assert.equal(health.referenceVersion, '0.3.0')
  assert.equal(health.pairLocked, true, 'the shipped plugin and addon are pair-locked')
  assert.equal(health.nativeCalls, 0)
  assert.equal(health.nativeFailures, 0)
  assert.equal(health.lastError, null)
  const readyLine = '[link-compute] ready ' + JSON.stringify(health)
  assert.match(readyLine, /\"kind\":\"native\"/)
  assert.match(readyLine, /\"nativeApiVersion\":2/)
  assert.match(readyLine, /\"version\":\"0\.3\.0\"/)
})

test('old binary + new plugin falls back and the ready line says why', () => {
  withFakeAddon(FAKE_BASE + "() => ({ ok: true, nativeApiVersion: 1, features: " + "['foldCollabRecords', 'indexTeamStatus', 'collabFoldIndex', 'byteBatched', 'deltaCursor', 'probe']" + " }) }", (fake) => {
    const facade = new ComputeFacade(resolveBinding({ addonPath: fake }))
    const health = facade.health()
    assert.equal(health.kind, 'typescript', 'an older binary is refused at load')
    assert.equal(health.nativeApiVersion, null)
    assert.match(health.detail, /version 1/)
    assert.match(health.detail, /requires 2/)
    const readyLine = '[link-compute] ready ' + JSON.stringify(health)
    assert.match(readyLine, /\"kind\":\"typescript\"/)
    assert.match(readyLine, /version 1/)
  })
})

test('new binary + old plugin falls back and the ready line says why', () => {
  withFakeAddon(FAKE_BASE + "() => ({ ok: true, nativeApiVersion: 3, features: " + "['foldCollabRecords', 'indexTeamStatus', 'collabFoldIndex', 'byteBatched', 'deltaCursor', 'probe']" + " }) }", (fake) => {
    const facade = new ComputeFacade(resolveBinding({ addonPath: fake }))
    const health = facade.health()
    assert.equal(health.kind, 'typescript', 'a newer binary is refused at load')
    assert.match(health.detail, /version 3/)
    assert.match(health.detail, /requires 2/)
    assert.match('[link-compute] ready ' + JSON.stringify(health), /\"kind\":\"typescript\"/)
  })
})

test('a same-API addon with a mismatched crate version is accepted but not pair-locked', () => {
  const source = "module.exports = { foldCollabRecords: () => '{}', indexTeamStatus: () => '{}', nativeVersion: () => '0.2.0', CollabFoldIndex: class {}, probe: () => ({ ok: true, nativeApiVersion: 2, features: " + "['foldCollabRecords', 'indexTeamStatus', 'collabFoldIndex', 'byteBatched', 'deltaCursor', 'probe']" + " }) }"
  withFakeAddon(source, (fake) => {
    const facade = new ComputeFacade(resolveBinding({ addonPath: fake }))
    const health = facade.health()
    assert.equal(health.kind, 'native')
    assert.equal(health.version, '0.2.0')
    assert.equal(health.referenceVersion, '0.3.0')
    assert.equal(health.pairLocked, false, 'a version skew is visible in health instead of silent')
  })
})

test('the byte-batched index agrees across the native and reference halves', { skip: !existsSync(ADDON) }, () => {
  const rows = JSON.parse(COLLAB)
  const native = resolveBinding().openFoldIndex()
  const referenceIndex = resolveBinding({ native: 'off' }).openFoldIndex()
  for (let index = 0; index < rows.length; index += 100) {
    const frame = new TextEncoder().encode(rows.slice(index, index + 100).map((row) => JSON.stringify(row)).join('\n') + '\n')
    const nativeStats = native.appendRecords(frame)
    const referenceStats = referenceIndex.appendRecords(frame)
    assert.deepEqual(Buffer.from(nativeStats), Buffer.from(referenceStats), 'append-stats buffers must be identical')
    const decoded = reference.decodeAppendStats(nativeStats)
    assert.equal(decoded.records, Math.min(index + 100, rows.length))
    assert.equal(decoded.unparsable, 0)
  }
  assert.equal(native.snapshot(), referenceIndex.snapshot())
  assert.equal(native.snapshot(), reference.foldCollabRecords(COLLAB))
  assert.deepEqual(Buffer.from(native.readDelta(0)), Buffer.from(referenceIndex.readDelta(0)))
  assert.deepEqual(reference.decodeDelta(native.readDelta(0)), JSON.parse(native.deltaSince(0)))
  const cursor = native.version() - 1
  assert.deepEqual(reference.decodeDelta(native.readDelta(cursor)), JSON.parse(native.deltaSince(cursor)))
  assert.equal(native.version(), referenceIndex.version())
  assert.equal(native.records(), 1000)
  assert.equal(native.checksum(), referenceIndex.checksum())
})

test('the byte-batched facade exposes the same snapshot as the string form', { skip: !existsSync(ADDON) }, () => {
  const facade = new ComputeFacade(resolveBinding())
  const byString = facade.openFoldIndex()
  const byBytes = facade.openFoldIndex()
  const rows = JSON.parse(COLLAB)
  for (let index = 0; index < rows.length; index += 250) {
    const slice = rows.slice(index, index + 250)
    byString.appendBatch(JSON.stringify(slice))
    byBytes.appendRecords(new TextEncoder().encode(slice.map((row) => JSON.stringify(row)).join('\n') + '\n'))
  }
  assert.equal(byString.snapshot(), byBytes.snapshot())
  assert.equal(byString.version(), byBytes.version())
  assert.equal(byString.deltaSince(0), byBytes.deltaSince(0))
})

/** Run a call and return its message, or null when it did not throw. */
function messageOfThrown(work) {
  try {
    work()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The five reported out-of-domain counterexamples, as NDJSON frames. */
const DOMAIN_CASES = [
  ['invalid UTF-8', Buffer.concat([Buffer.from('{"seq":1,"kind":"member/state","payload":{"id":"m'), Buffer.from([0xff]), Buffer.from('1"}}\n')]), 'utf-8'],
  ['lone surrogate', Buffer.from('{"seq":1,"kind":"member/state","payload":{"id":"\\ud800"}}\n'), 'surrogate'],
  ['1e400', Buffer.from('{"seq":1,"kind":"member/state","payload":{"x":1e400}}\n'), 'number'],
  ['1.797e308', Buffer.from('{"seq":1,"kind":"member/state","payload":{"x":1.797e308}}\n'), 'number'],
  ['>2^53', Buffer.from('{"seq":9007199254740993,"kind":"member/state","payload":{"id":"m1"}}\n'), 'number'],
]

test('out-of-domain input is the same typed error in both halves', { skip: !existsSync(ADDON) }, () => {
  const native = resolveBinding().openFoldIndex()
  const referenceIndex = resolveBinding({ native: 'off' }).openFoldIndex()
  for (const [label, frame, keyword] of DOMAIN_CASES) {
    const nativeError = messageOfThrown(() => native.appendRecords(frame))
    const referenceError = messageOfThrown(() => referenceIndex.appendRecords(frame))
    assert.ok(nativeError !== null && nativeError.startsWith('COMPUTE_DOMAIN'), 'native: ' + label + ' -> ' + String(nativeError))
    assert.ok(referenceError !== null && referenceError.startsWith('COMPUTE_DOMAIN'), 'reference: ' + label + ' -> ' + String(referenceError))
    assert.ok(nativeError.toLowerCase().includes(keyword) && referenceError.toLowerCase().includes(keyword), 'same category for ' + label)
  }
})

test('a rejected append is atomic and the index keeps working', { skip: !existsSync(ADDON) }, () => {
  const native = resolveBinding().openFoldIndex()
  native.appendRecords(Buffer.from('{"seq":1,"kind":"member/state","payload":{"id":"m1"}}\n'))
  const before = native.snapshot()
  assert.throws(() => native.appendRecords(Buffer.from('{"seq":2,"kind":"member/state","payload":{"x":1e400}}\n')), /COMPUTE_DOMAIN/)
  assert.equal(native.snapshot(), before)
  native.appendRecords(Buffer.from('{"seq":3,"kind":"member/state","payload":{"id":"m2"}}\n'))
  assert.equal(JSON.parse(native.snapshot()).records, 2)
})

test('a native index failure latches the reference and the facade counts it', () => {
  const brokenIndex = {
    appendBatch() {
      throw new Error('COMPUTE_DOMAIN: simulated domain violation')
    },
    snapshot: () => '{}',
    deltaSince: () => '{}',
    appendRecords() {
      throw new Error('COMPUTE_DOMAIN: simulated domain violation')
    },
    readDelta: () => new Uint8Array(),
    version: () => 0,
    records: () => 0,
    checksum: () => '',
  }
  const broken = {
    kind: 'native',
    version: '0.0.0-test',
    detail: 'a broken addon',
    foldCollabRecords: () => '{}',
    indexTeamStatus: () => '{}',
    openFoldIndex: () => brokenIndex,
    probe: () => ({ ok: true, kind: 'native', nativeApiVersion: 2, features: [], version: '0.0.0-test', detail: 'broken' }),
  }
  const facade = new ComputeFacade(broken)
  const stalled = facade.openFoldIndex()
  assert.throws(() => stalled.appendRecords(Buffer.from('x')), /COMPUTE_DOMAIN/)
  assert.equal(facade.kind, 'typescript', 'the reference is latched after an index failure')
  assert.equal(facade.nativeFailures, 1)
  assert.match(String(facade.lastError), /COMPUTE_DOMAIN/)
  // A reopened index is the reference. The same out-of-domain input fails the same way there;
  // nothing silently diverges and nothing silently retries the failed native index.
  const reopened = facade.openFoldIndex()
  assert.equal(reopened.constructor.name, 'CollabFoldIndex')
  const sameError = messageOfThrown(() => reopened.appendRecords(Buffer.from('{"seq":1,"x":1e400}\n')))
  assert.ok(sameError !== null && sameError.startsWith('COMPUTE_DOMAIN'), String(sameError))
  assert.throws(() => stalled.appendRecords(Buffer.from('y')), /COMPUTE_FALLBACK/)
  assert.equal(facade.nativeCalls, 0)
})

test('a native call failure latches the reference and still answers', () => {
  const broken = {
    kind: 'native',
    version: '0.0.0-test',
    detail: 'a broken addon',
    foldCollabRecords() {
      throw new Error('simulated native failure')
    },
    indexTeamStatus() {
      throw new Error('simulated native failure')
    },
  }
  const facade = new ComputeFacade(broken)
  const first = JSON.parse(facade.foldCollabRecords(COLLAB))
  assert.equal(first.records, 1000, 'the failing call is answered by the reference')
  assert.equal(facade.kind, 'typescript', 'the reference is latched')
  assert.equal(facade.nativeFailures, 1)
  assert.match(String(facade.lastError), /simulated native failure/)
  const second = JSON.parse(facade.indexTeamStatus(TEAM))
  assert.equal(second.teams[0].members, 12)
  assert.equal(facade.nativeFailures, 1, 'later calls do not retry the broken addon')
  assert.equal(facade.nativeCalls, 0)
})

test('the facade answers from the reference when that is what resolved', () => {
  const facade = new ComputeFacade(resolveBinding({ native: 'off' }))
  assert.equal(facade.kind, 'typescript')
  assert.equal(JSON.parse(facade.indexTeamStatus(TEAM)).teams[0].members, 12)
  assert.equal(facade.nativeCalls, 0)
  assert.equal(facade.nativeFailures, 0)
})

test('the fixtures themselves carry the shapes the tests claim', () => {
  assert.equal(JSON.parse(COLLAB).length, 1000)
  assert.equal(JSON.parse(TEAM).length, makeTeamEvents(12).meta.events)
  assert.ok(REPO.endsWith('dsh-link'))
})
