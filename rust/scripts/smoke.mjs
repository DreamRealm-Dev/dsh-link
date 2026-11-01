#!/usr/bin/env node
/**
 * Smoke test for the built napi addon.
 *
 * Proves, in one short run:
 *   1. require() of plugins/dsh-link-compute/lib/dsh_compute.node works;
 *   2. both functions return correct results for the 1000-row collab fixture and the
 *      12/24-member team fixtures;
 *   3. the Rust output is byte-identical to the pure-TS reference output;
 *   4. re-ordering the same rows does not change the folded answer;
 *   5. unusable input throws COMPUTE_INPUT on both sides;
 *   6. the crate sources contain no unsafe blocks and the entries are panic-guarded.
 *
 * Run: node rust/scripts/smoke.mjs  (after node rust/scripts/build.mjs)
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeCollabRecords, makeTeamEvents, shuffled } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
const CRATE_DIR = join(HERE, '..', 'crates', 'dsh-compute-napi')

let failures = 0
/** Record one assertion. */
function check(condition, label, detail = '') {
  if (condition) {
    console.log('ok   ' + label + (detail === '' ? '' : '  [' + detail + ']'))
    return
  }
  failures += 1
  console.log('FAIL ' + label + (detail === '' ? '' : '  [' + detail + ']'))
}

/** Run fn, returning the thrown message, or null when it did not throw. */
function thrown(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

if (!existsSync(ADDON)) {
  console.error('missing addon: ' + ADDON + '\nrun: node rust/scripts/build.mjs')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const loadStart = process.hrtime.bigint()
const addon = require(ADDON)
const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6

check(typeof addon.foldCollabRecords === 'function', 'addon exports foldCollabRecords')
check(typeof addon.indexTeamStatus === 'function', 'addon exports indexTeamStatus')
check(typeof addon.nativeVersion === 'function' && addon.nativeVersion() === '0.3.0', 'addon reports version 0.3.0', 'load ' + loadMs.toFixed(2) + 'ms')

const reference = await import(pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'src', 'reference.ts')).href)

// --- 1000-row collaboration fold -------------------------------------------------
const collab = makeCollabRecords(1000)
const collabJson = JSON.stringify(collab.rows)
const rustFold = addon.foldCollabRecords(collabJson)
const tsFold = reference.foldCollabRecords(collabJson)
const fold = JSON.parse(rustFold)
check(fold.records === 1000, 'fold: 1000 rows folded', 'records=' + String(fold.records))
check(fold.malformedRows === collab.meta.malformedRows, 'fold: damaged rows counted', 'malformedRows=' + String(fold.malformedRows))
check(fold.members.length === collab.meta.members, 'fold: member registry complete', 'members=' + String(fold.members.length))
check(fold.tasks.length === collab.meta.tasks, 'fold: task board complete', 'tasks=' + String(fold.tasks.length))
check(fold.teams.length === collab.meta.teams, 'fold: team rows complete', 'teams=' + String(fold.teams.length))
check(fold.teamTree.maxDepth === 2, 'fold: team tree depth resolved', 'maxDepth=' + String(fold.teamTree.maxDepth))
check(fold.messages.count > 0 && fold.messages.bytes > 0, 'fold: message volume counted', 'messages=' + String(fold.messages.count) + ', bytes=' + String(fold.messages.bytes))
check(/^[0-9a-f]{16}$/.test(fold.checksum), 'fold: checksum is 16 hex digits', fold.checksum)
check(rustFold === tsFold, 'fold: Rust bytes === TS reference bytes', String(rustFold.length) + ' bytes')

const reshuffled = JSON.stringify(shuffled(collab.rows, 0x1234_5678))
check(addon.foldCollabRecords(reshuffled) === rustFold, 'fold: re-ordered ledger folds to the same bytes')
check(reference.foldCollabRecords(reshuffled) === tsFold, 'fold: TS reference is order-independent too')

// --- 12-member and 24-member team status index -----------------------------------
for (const memberCount of [12, 24]) {
  const team = makeTeamEvents(memberCount)
  const teamJson = JSON.stringify(team.events)
  const rustState = addon.indexTeamStatus(teamJson)
  const tsState = reference.indexTeamStatus(teamJson)
  const state = JSON.parse(rustState)
  check(state.events === team.meta.events, 'team-' + String(memberCount) + ': all events indexed', 'events=' + String(state.events))
  check(state.teams[0].members === memberCount, 'team-' + String(memberCount) + ': roster complete', 'members=' + String(state.teams[0].members))
  check(state.tree.maxDepth === team.meta.derivedMaxDepth, 'team-' + String(memberCount) + ': three-level tree resolved', 'maxDepth=' + String(state.tree.maxDepth))
  check(state.tree.roots === 1, 'team-' + String(memberCount) + ': one root (the Lead)')
  check(state.statusCounts.running > 0, 'team-' + String(memberCount) + ': runtime presence applied', 'running=' + String(state.statusCounts.running))
  check(state.tasks.completed > 0 && state.tasks.inProgress > 0, 'team-' + String(memberCount) + ': task status counted')
  check(state.tree.orphanParents === 0, 'team-' + String(memberCount) + ': every parent name resolved')
  check(state.unknownEvents === 2 && state.malformedEvents === 2, 'team-' + String(memberCount) + ': unknown/malformed counted', 'unknown=' + String(state.unknownEvents) + ', malformed=' + String(state.malformedEvents))
  check(rustState === tsState, 'team-' + String(memberCount) + ': Rust bytes === TS reference bytes', String(rustState.length) + ' bytes')
}

// --- incremental index (the stateful API) -----------------------------------------
check(typeof addon.CollabFoldIndex === 'function', 'addon exports CollabFoldIndex')
const batches = []
for (let index = 0; index < collab.rows.length; index += 100) batches.push(JSON.stringify(collab.rows.slice(index, index + 100)))
const rustIndex = new addon.CollabFoldIndex()
const tsIndex = new reference.CollabFoldIndex()
let appendStatsEqual = true
for (const batch of batches) {
  if (rustIndex.appendBatch(batch) !== tsIndex.appendBatch(batch)) appendStatsEqual = false
}
check(appendStatsEqual, 'incremental: append stats byte-identical to TS', String(batches.length) + ' batches')
const rustSnapshot = rustIndex.snapshot()
check(rustSnapshot === rustFold, 'incremental: snapshot equals the one-shot Rust fold')
check(rustSnapshot === tsIndex.snapshot(), 'incremental: snapshot byte-identical to TS')
check(rustIndex.deltaSince(0) === tsIndex.deltaSince(0), 'incremental: deltaSince(0) byte-identical to TS')
check(rustIndex.records() === 1000 && rustIndex.version() === batches.length, 'incremental: records/version counters', String(rustIndex.records()) + ' rows / ' + String(rustIndex.version()) + ' batches')
check(rustIndex.checksum() === fold.checksum, 'incremental: checksum equals the one-shot checksum', rustIndex.checksum())
const beforeVersion = rustIndex.version()
rustIndex.appendBatch(JSON.stringify(collab.rows.slice(0, 7)))
tsIndex.appendBatch(JSON.stringify(collab.rows.slice(0, 7)))
check(rustIndex.deltaSince(beforeVersion) === tsIndex.deltaSince(beforeVersion), 'incremental: deltaSince(version) covers only the new batch')

// --- probe / native API handshake -------------------------------------------------
const probe = addon.probe()
check(typeof probe === 'object' && probe.ok === true, 'probe: reports ok=true')
check(probe.nativeApiVersion === 2, 'probe: native API version is 2', String(probe.nativeApiVersion))
check(Array.isArray(probe.features) && probe.features.includes('byteBatched') && probe.features.includes('deltaCursor'), 'probe: advertises the byte-batched features', probe.features.join(','))
const emptyStats = reference.decodeAppendStats(new addon.CollabFoldIndex().appendRecords(Buffer.alloc(0)))
check(emptyStats.accepted === 0 && emptyStats.version === 1, 'byte: an empty NDJSON batch is a valid no-op append', JSON.stringify(emptyStats))

// --- byte-batched incremental API --------------------------------------------------
const lineBatches = []
for (let index = 0; index < collab.rows.length; index += 100) {
  lineBatches.push(Buffer.from(collab.rows.slice(index, index + 100).map((row) => JSON.stringify(row)).join('\n') + '\n'))
}
const rustBytes = new addon.CollabFoldIndex()
const tsBytes = new reference.CollabFoldIndex()
let byteStatsEqual = true
for (const frame of lineBatches) {
  const rustStats = rustBytes.appendRecords(frame)
  const tsStats = tsBytes.appendRecords(new Uint8Array(frame))
  if (!Buffer.from(rustStats).equals(Buffer.from(tsStats))) byteStatsEqual = false
}
const rustBytesSnapshot = rustBytes.snapshot()
check(byteStatsEqual, 'byte: append-stats buffers byte-identical to TS', String(lineBatches.length) + ' frames')
check(rustBytesSnapshot === rustFold, 'byte: snapshot equals the one-shot Rust fold')
check(rustBytesSnapshot === tsBytes.snapshot(), 'byte: snapshot byte-identical to TS')
const rustDeltaBytes = Buffer.from(rustBytes.readDelta(0))
const tsDeltaBytes = Buffer.from(tsBytes.readDelta(0))
check(rustDeltaBytes.equals(tsDeltaBytes), 'byte: readDelta buffers byte-identical to TS', String(rustDeltaBytes.length) + ' bytes')
check(JSON.stringify(reference.decodeDelta(new Uint8Array(rustDeltaBytes))) === rustBytes.deltaSince(0), 'byte: decodeDelta agrees with the JSON delta')
const cursor = rustBytes.version() - 1
check(Buffer.from(rustBytes.readDelta(cursor)).equals(Buffer.from(tsBytes.readDelta(cursor))), 'byte: cursor delta byte-identical to TS')
const damagedFrame = Buffer.from('{"seq":1,"kind":"member/state","payload":{"id":"m9"}}\nNOT JSON\n{"seq":2,"kind":"member/heartbeat","payload":{"id":"m9","at":5}}\n')
const rustDamaged = new addon.CollabFoldIndex()
const tsDamaged = new reference.CollabFoldIndex()
const rustDamagedStats = reference.decodeAppendStats(new Uint8Array(rustDamaged.appendRecords(damagedFrame)))
const tsDamagedStats = reference.decodeAppendStats(new Uint8Array(tsDamaged.appendRecords(new Uint8Array(damagedFrame))))
check(rustDamagedStats.accepted === 2 && rustDamagedStats.unparsable === 1, 'byte: damaged NDJSON line counted, not fatal', JSON.stringify(rustDamagedStats))
check(JSON.stringify(rustDamagedStats) === JSON.stringify(tsDamagedStats), 'byte: damaged-frame stats agree with TS')
check(rustDamaged.snapshot() === tsDamaged.snapshot(), 'byte: damaged-frame snapshot agrees with TS')

// --- parity input domain (R503) -----------------------------------------------------
// Both halves must agree on the same five reported counterexamples: the same typed
// COMPUTE_DOMAIN error, never one silently folding what the other refuses.
const frameOf = (text) => Buffer.from(text)
const domainCases = [
  ['invalid UTF-8', Buffer.concat([Buffer.from('{"seq":1,"kind":"member/state","payload":{"id":"m'), Buffer.from([0xff]), Buffer.from('1"}}\n')]), 'utf-8'],
  ['lone surrogate', frameOf('{"seq":1,"kind":"member/state","payload":{"id":"\\ud800"}}\n'), 'surrogate'],
  ['1e400', frameOf('{"seq":1,"kind":"member/state","payload":{"x":1e400}}\n'), 'number'],
  ['1.797e308', frameOf('{"seq":1,"kind":"member/state","payload":{"x":1.797e308}}\n'), 'number'],
  ['>2^53', frameOf('{"seq":9007199254740993,"kind":"member/state","payload":{"id":"m1"}}\n'), 'number'],
]
let domainKindSame = true
for (const [label, frame, keyword] of domainCases) {
  const rustError = thrown(() => new addon.CollabFoldIndex().appendRecords(frame))
  const tsError = thrown(() => new reference.CollabFoldIndex().appendRecords(new Uint8Array(frame)))
  const same = rustError !== null && tsError !== null
    && rustError.startsWith('COMPUTE_DOMAIN') && tsError.startsWith('COMPUTE_DOMAIN')
    && rustError.toLowerCase().includes(keyword) && tsError.toLowerCase().includes(keyword)
  if (!same) {
    domainKindSame = false
    console.log('  domain mismatch ' + label + ': rust=' + String(rustError) + ' ts=' + String(tsError))
  }
}
check(domainKindSame, 'domain: all 5 counterexamples are COMPUTE_DOMAIN in both halves')

// A rejected append is atomic: records, version and snapshot do not move.
const atomic = new addon.CollabFoldIndex()
atomic.appendRecords(frameOf('{"seq":1,"kind":"member/state","payload":{"id":"m1"}}\n'))
const atomicBefore = atomic.snapshot()
const atomicVersion = atomic.version()
const atomicRecords = atomic.records()
const atomicError = thrown(() => atomic.appendRecords(frameOf('{"seq":2,"kind":"member/state","payload":{"x":1e400}}\n')))
check(atomicError !== null && atomicError.startsWith('COMPUTE_DOMAIN')
  && atomic.version() === atomicVersion && atomic.records() === atomicRecords && atomic.snapshot() === atomicBefore,
'domain: a rejected append leaves the index unchanged')
check(thrown(() => atomic.appendRecords(frameOf('{"seq":3,"kind":"member/state","payload":{"id":"m2"}}\n'))) === null,
'domain: the index still folds valid input after a rejection')

// The one-shot functions carry the same domain gate.
const largeSafe = '[{"seq":9007199254740991,"kind":"member/state","payload":{"id":"m1","x":1.5}}]'
const oneShotDomainOk = thrown(() => addon.foldCollabRecords('[{"seq":1,"x":1e400}]'))?.startsWith('COMPUTE_DOMAIN')
  && thrown(() => reference.foldCollabRecords('[{"seq":1,"x":1e400}]'))?.startsWith('COMPUTE_DOMAIN')
  && thrown(() => addon.indexTeamStatus('[{"seq":1,"x":1.797e308}]'))?.startsWith('COMPUTE_DOMAIN')
  && thrown(() => reference.indexTeamStatus('[{"seq":1,"x":1.797e308}]'))?.startsWith('COMPUTE_DOMAIN')
check(oneShotDomainOk === true, 'domain: one-shot fold/index report COMPUTE_DOMAIN in both halves')
check(addon.foldCollabRecords(largeSafe) === reference.foldCollabRecords(largeSafe),
'domain: the safe-integer boundary stays inside the domain and matches byte for byte')

// Valid UTF-8 identifiers sort by UTF-16 code unit in both halves (U+FFFD vs an astral id is
// the pair whose UTF-8 and UTF-16 orders disagree).
const astralFrame = frameOf('{"seq":1,"kind":"member/state","payload":{"id":"\\ufffd"}}\n{"seq":2,"kind":"member/state","payload":{"id":"\\ud835\\udd18"}}\n')
const astralRust = new addon.CollabFoldIndex()
const astralTs = new reference.CollabFoldIndex()
astralRust.appendRecords(astralFrame)
astralTs.appendRecords(new Uint8Array(astralFrame))
check(astralRust.snapshot() === astralTs.snapshot(), 'domain: non-BMP identifier order matches the TS reference')

// --- unusable input ---------------------------------------------------------------
for (const bad of ['{"not":"an array"}', 'not json at all']) {
  const rustError = thrown(() => addon.foldCollabRecords(bad))
  const tsError = thrown(() => reference.foldCollabRecords(bad))
  check(rustError !== null && rustError.startsWith('COMPUTE_INPUT'), 'fold: Rust refuses unusable input', String(rustError).slice(0, 60))
  check(tsError !== null && tsError.startsWith('COMPUTE_INPUT'), 'fold: TS refuses unusable input', String(tsError).slice(0, 60))
}
check(thrown(() => addon.indexTeamStatus('42')) !== null, 'index: Rust refuses a non-array root')

// --- safety audits ----------------------------------------------------------------
const rustFiles = readdirSync(join(CRATE_DIR, 'src')).filter((name) => name.endsWith('.rs'))
let unsafeHits = 0
for (const name of rustFiles) {
  const text = readFileSync(join(CRATE_DIR, 'src', name), 'utf8')
  for (const line of text.split('\n')) {
    if (/\bunsafe\b/.test(line) && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('///') && !line.trimStart().startsWith('//!')) unsafeHits += 1
  }
}
check(unsafeHits === 0, 'safety: crate sources contain no unsafe blocks', 'files=' + String(rustFiles.length))
const libSource = readFileSync(join(CRATE_DIR, 'src', 'lib.rs'), 'utf8')
check((libSource.match(/catch_unwind/g) ?? []).length >= 1, 'safety: entries are panic-guarded (catch_unwind)')
const cargoToml = readFileSync(join(CRATE_DIR, 'Cargo.toml'), 'utf8')
check(cargoToml.includes('cdylib'), 'safety: crate builds as a cdylib')

console.log('\n' + (failures === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + String(failures) + ' assertion(s)'))
process.exit(failures === 0 ? 0 : 1)
