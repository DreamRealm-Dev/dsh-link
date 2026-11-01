#!/usr/bin/env node
/**
 * Self-check (R183-A) -- the end manifests, the decay along a path, and our own broker facade.
 *
 * Subject: what landed in R183 (docs/handoff/R183-A-ledger.md) -- the end/manifest fact (md:374), the
 * intersection a multi-hop path leaves (md:384-388), and ctx.get('linkCollab').broker, which is OUR
 * facade and not the kernel's service broker (md:376-382, TODO.md:70).
 *
 * Every reading is taken from the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js). Where a
 * ledger is involved it is a real one this script opens through the plugin's own composition and then
 * parses with its own JSON.parse; a refusal is measured against the file's sha256 and byte length
 * before and after, so a refusal that still appends fails here.
 *
 *   W  THE WRITE SIDE    one append gains exactly one end/manifest row and the row is the answer field
 *      for field; a batch of malformed calls is refused by name, each with its own code, and the ledger
 *      does not move by a byte; a row a FOREIGN writer slipped in with a name the registry never held
 *      stays visible (its own words in declared) while capabilities excludes it and malformed counts it.
 *   R  THE READ SIDE     the path is the whole chain from the end reading to the end asked about and the
 *      answer is the intersection of the hops, so a smaller directory further out shrinks what arrives;
 *      NO_MANIFEST, PEER_SILENT and ROUTE_DOWN are three separate named answers with the hop named, and
 *      the silence boundary is sinceMs >= timeoutMs (the threshold counts as out); the same rows in any
 *      array order fold to the same table.
 *   B  THE BROKER        remote:<end>:<key> is the only key generator; this end's own keys are not in
 *      the space; a key that is listed answers and a key whose link died is gone from the listing AND
 *      answers service-gone at the same instant (the paired reading); not-granted, no-provider,
 *      provider-silent and unknown-key are each reachable and each means one thing.
 *   F  THE FACADE        linkCollab.broker answers exactly what the module functions answer, remembers
 *      the last code, and writes nothing.
 *
 * Exit 0 every reading held | 1 a reading failed. Usage: node plugins/dsh-link-collab/test/manifest-selfcheck.mjs [--module <path>] [--keep]
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
const module = await import(pathToFileURL(MODULE_PATH).href)

const show = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }
const clip = (text, max = 240) => String(text).length > max ? String(text).slice(0, max) + '...' : String(text)
const readings = []
const add = (id, ok, detail, evidence = []) => {
  readings.push({ id, ok })
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}

const T0 = 1700000000000
const BEAT = 1700000300000
const NOW = 1700000350000
const TIMEOUT = 60000
const PROTO = 'dsh-link-device/1'
const MANIFEST = 'end/manifest'
const MEMBER = 'member/state'
const HEARTBEAT = 'member/heartbeat'
const END_A = 'end-A'
const END_B = 'end-B'
const END_C = 'end-C'
const PROVIDER = 'm-c'
const CAP_A = 'write:src'
const CAP_B = 'read:db'
/** The two names as the row must carry them: sorted, because two writers declaring one set write one row. */
const CAP_SORTED = [CAP_A, CAP_B].sort()

/**
 * The world apply() builds: the SHIPPED composition, a tools registry it can register into, and the
 * capability it publishes. Identical in shape to R182-A's probe, so a reader who has seen one has seen
 * both.
 */
const root = mkdtempSync(join(tmpdir(), 'r183-manifest-'))
const buildWorld = async (homeDir) => {
  const home = homeDir
  const dir = join(home, 'collab')
  mkdirSync(dir, { recursive: true })
  const registry = new Map()
  const provided = new Map()
  const registryService = { register(definition) { registry.set(definition.name, definition); return () => { registry.delete(definition.name) } } }
  const server = { register() { return () => {} } }
  const ctx = {
    get(name) {
      if (name === 'tools') return registryService
      if (name === 'webServer') return server
      if (name === 'dshHomePath') return (sub) => join(home, sub)
      return provided.get(name)
    },
    inject(_dependencies, callback) { callback({ get: (name) => (name === 'tools' ? registryService : undefined) }) },
    provide(name, value) { provided.set(name, value) },
    effect(fn) { const dispose = fn(); return () => { void dispose } },
    on() { return () => {} },
    logger: { warn: () => {} },
  }
  const quiet = { log: console.log, error: console.error }
  let applied = null
  try {
    console.log = () => {}
    console.error = () => {}
    module.apply(ctx, {})
    applied = { ok: true }
  } catch (error) {
    applied = { ok: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  return { home, dir, registry, collab: provided.get('linkCollab'), applied }
}

const rowsOf = (dir) => {
  const path = join(dir, 'control.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}
const bytesOf = (dir) => {
  const path = join(dir, 'control.jsonl')
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length }
}
const factsOnly = (rows) => rows.map((row) => ({ seq: row.seq, kind: row.kind, at: row.at, actor: row.actor, subject: row.subject, payload: row.payload }))
const dropManifest = (rows, end) => rows.filter((row) => !(row.kind === MANIFEST && (row.payload?.end === end || row.subject === end)))
const withBeat = (rows, member, at) => rows
  .filter((row) => !(row.kind === HEARTBEAT && (row.payload?.id === member || row.subject === member)))
  .concat([{ seq: 900000 + rows.length, kind: HEARTBEAT, at, actor: member, subject: member, payload: { id: member, at } }])
const dropRow = (rows, member) => rows.filter((row) => !(row.kind === 'member/host' && (row.payload?.id === member || row.subject === member)))
const dropBeats = (rows, member) => rows.filter((row) => !(row.kind === HEARTBEAT && (row.payload?.id === member || row.subject === member)))

// ----------------------------------------------------------------------------------------------- W: the write side
const writes = await buildWorld(join(root, 'writes'))
console.log('world: apply() -> ' + (writes.applied.ok ? 'ok' : show(writes.applied.error)) + '; ledger ' + join(writes.dir, 'control.jsonl'))
console.log('linkCollab.tools.names: ' + show(writes.collab?.tools?.names ?? null))

{
  const issues = []
  if (writes.applied.ok !== true || writes.collab === undefined) issues.push('apply() did not publish linkCollab: ' + show(writes.applied.error ?? 'no capability provided'))
  const log = writes.collab.log
  await log.append(module.capabilityRecord(PROVIDER, [CAP_A, CAP_B]))
  const before = rowsOf(writes.dir).length
  const answer = await module.appendManifest(writes.collab.state(), log, { end: END_A, via: null, platform: 'dsh', protocolVersion: PROTO, capabilities: [CAP_B, CAP_A, CAP_A], at: T0 })
  const after = rowsOf(writes.dir)
  if (after.length !== before + 1) issues.push('one append gained ' + String(after.length - before) + ' row(s); it must gain exactly one')
  const row = after[after.length - 1]
  if (row.seq !== answer.seq) issues.push('seq ' + show(row.seq) + ' vs answer ' + show(answer.seq))
  if (row.kind !== MANIFEST) issues.push('the row is ' + show(row.kind) + ', not ' + MANIFEST)
  if (row.subject !== END_A) issues.push('subject ' + show(row.subject) + ' vs ' + END_A)
  if (row.actor !== END_A) issues.push('actor ' + show(row.actor) + ' vs the end declaring itself ' + END_A)
  for (const field of ['end', 'via', 'platform', 'protocolVersion', 'capabilities', 'at']) {
    if (show(row.payload?.[field]) !== show(answer[field])) issues.push('payload.' + field + ' ' + show(row.payload?.[field]) + ' vs answer ' + show(answer[field]))
  }
  if (show(row.payload?.capabilities) !== show(CAP_SORTED)) issues.push('the capabilities were not sorted and deduplicated on the row: ' + show(row.payload?.capabilities) + ' vs ' + show(CAP_SORTED))
  const folded = module.projectManifests(after).ends.find((entry) => entry.end === END_A)
  if (folded === undefined) issues.push('the fold does not read back the row that was just written')
  else if (show(folded) !== show(answer.folded)) issues.push('the fold reads ' + show(folded) + ' where the answer returned ' + show(answer.folded))
  add('W1-one-append-one-row-and-the-row-is-the-answer', issues.length === 0,
    issues.length === 0
      ? 'end/manifest row ' + show(row.seq) + ' for ' + END_A + ': kind/subject/actor/payload equal the answer field by field, capabilities ' + show(row.payload.capabilities)
      : issues.join('; '),
    ['row: ' + show(row)])
}

{
  const issues = []
  const log = writes.collab.log
  const before = bytesOf(writes.dir)
  const good = { end: 'end-E', via: null, platform: 'dsh', protocolVersion: PROTO, capabilities: [CAP_A], at: T0 }
  const cases = [
    ['MANIFEST_INPUT', null],
    ['MANIFEST_INPUT', ['end-E']],
    ['MANIFEST_END', { ...good, end: '' }],
    ['MANIFEST_END', { ...good, end: 7 }],
    ['MANIFEST_VIA', { ...good, via: 7 }],
    ['MANIFEST_VIA', { ...good, via: 'end-E' }],
    ['MANIFEST_PLATFORM', { ...good, platform: null }],
    ['MANIFEST_VERSION', { ...good, protocolVersion: 'dsh-link-device/9' }],
    ['MANIFEST_CAPABILITY', { ...good, capabilities: [] }],
    ['MANIFEST_CAPABILITY', { ...good, capabilities: ['has space'] }],
    ['MANIFEST_CAPABILITY', { ...good, capabilities: ['ghost:cap'] }],
    ['MANIFEST_AT', { ...good, at: 'now' }],
  ]
  const seen = []
  for (const [expected, args] of cases) {
    try {
      await module.appendManifest(writes.collab.state(), log, args)
      issues.push('a malformed call was accepted: ' + show(args) + ' (expected ' + expected + ')')
      seen.push(expected + '->accepted')
    } catch (error) {
      const code = error && error.code !== undefined ? String(error.code) : null
      seen.push(code)
      if (code !== expected) issues.push('refused with ' + show(code) + ' where ' + expected + ' was the rule: ' + clip(String(error && error.message ? error.message : error)))
      if (error instanceof module.ManifestRefusal !== true) issues.push('the refusal is not a ManifestRefusal: ' + show(error && error.name))
      if (String(error && error.message ? error.message : '').startsWith(expected + ':') !== true) issues.push('the code is not first in the message: ' + clip(String(error && error.message)))
      if (code === 'MANIFEST_VERSION' && show(error.supported) !== show([PROTO])) issues.push('the version refusal does not carry the supported list: ' + show(error.supported))
    }
  }
  const after = bytesOf(writes.dir)
  if (after.sha256 !== before.sha256 || after.length !== before.length) {
    issues.push('the ledger moved through a batch of refusals: ' + show(before) + ' -> ' + show(after))
  }
  // The pure builder refuses the same rules, so a caller that never holds a log still gets the codes.
  let builderCode = null
  try { module.manifestRecord({ ...good, protocolVersion: 'nope/1' }) } catch (error) { builderCode = String(error.code) }
  if (builderCode !== 'MANIFEST_VERSION') issues.push('manifestRecord refused a bad version with ' + show(builderCode))
  add('W2-every-refusal-is-named-and-the-ledger-does-not-move', issues.length === 0,
    issues.length === 0
      ? String(cases.length) + ' malformed calls, each refused with its own code; ledger sha256 ' + after.sha256.slice(0, 16) + ' and length ' + String(after.length) + ' identical before and after'
      : issues.join('; '),
    ['codes: ' + seen.join(', ')])
}

{
  const issues = []
  const log = writes.collab.log
  // A foreign writer is not obliged to go through our builder. The row must stay visible with its own
  // words, and the name the registry never held must not be read as "this end has no such capability".
  await log.append({ kind: MANIFEST, subject: 'end-F', actor: 'end-F', at: T0, payload: { end: 'end-F', via: null, platform: 'harness-x', protocolVersion: PROTO, capabilities: ['ghost:cap', CAP_A], at: T0 } })
  const folded = module.projectManifests(rowsOf(writes.dir))
  const row = folded.ends.find((entry) => entry.end === 'end-F')
  if (row === undefined) issues.push('the row a foreign writer wrote is not in the fold at all')
  else {
    if (show(row.declared) !== show([CAP_A, 'ghost:cap'].sort())) issues.push('declared is ' + show(row.declared) + ', not the words the row carried, sorted')
    if (show(row.capabilities) !== show([CAP_A])) issues.push('capabilities is ' + show(row.capabilities) + ', and a name the registry does not hold must not enter it')
  }
  if (folded.malformed < 1) issues.push('malformed is ' + show(folded.malformed) + '; a row carrying an unreadable name must be counted')
  add('W3-a-name-nobody-declared-is-visible-and-not-read-as-absent', issues.length === 0,
    issues.length === 0
      ? 'end-F: declared ' + show(row.declared) + ' but capabilities ' + show(row.capabilities) + '; malformed=' + String(folded.malformed)
      : issues.join('; '),
    ['folded end-F: ' + show(row)])
}

// ----------------------------------------------------------------------------------------------- R: the read side
const reads = await buildWorld(join(root, 'reads'))
const log = reads.collab.log
const state = () => reads.collab.state()
await log.append(module.capabilityRecord(PROVIDER, [CAP_A, CAP_B]))
await log.append(module.capabilityRecord(END_B, ['relay']))
await log.append({ kind: MEMBER, actor: PROVIDER, subject: PROVIDER, at: T0, payload: { id: PROVIDER, team: 'team-1', name: PROVIDER, state: 'active', role: 'member' } })
await log.append(module.hostRecord(END_B, END_B, null, T0))
await log.append(module.hostRecord(END_C, END_C, END_B, T0))
await log.append(module.hostRecord(PROVIDER, END_C, END_B, T0))
await log.append(module.heartbeatRecord(PROVIDER, BEAT))
await module.appendManifest(state(), log, { end: END_A, via: null, platform: 'dsh', protocolVersion: PROTO, capabilities: [CAP_A, CAP_B], at: T0 })
await module.appendManifest(state(), log, { end: END_B, via: null, platform: 'dsh', protocolVersion: PROTO, capabilities: [CAP_A], at: T0 })
await module.appendManifest(state(), log, { end: END_C, via: END_B, platform: 'dsh', protocolVersion: PROTO, capabilities: [CAP_A, CAP_B], at: T0 })
await log.append(module.peerRecord(END_A, END_C, 'call your provider', 'granted'))
await log.append(module.peerRecord(END_A, END_B, 'relay handshake', 'granted'))
const seeded = rowsOf(reads.dir)
console.log('read world: ' + String(seeded.length) + ' rows; manifests ' + show(module.projectManifests(seeded).ends.map((row) => row.end)))

{
  const issues = []
  const withReader = module.effectiveCapabilities(state(), END_C, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(withReader.path) !== show([END_A, END_B, END_C])) issues.push('the path is ' + show(withReader.path) + ', not [' + END_A + ', ' + END_B + ', ' + END_C + ']')
  if (show(withReader.capabilities) !== show([CAP_A])) issues.push('the surviving capabilities are ' + show(withReader.capabilities) + '; the intersection down A-B-C is [' + CAP_A + ']')
  if (withReader.missing.length !== 0) issues.push('a whole path reports ' + show(withReader.missing))
  if (withReader.through !== state().through) issues.push('through is ' + show(withReader.through) + ', not the fold\'s ' + show(state().through))
  const withoutReader = module.effectiveCapabilities(state(), END_C, NOW, { timeoutMs: TIMEOUT })
  if (show(withoutReader.path) !== show([END_B, END_C])) issues.push('with no end named, the path is ' + show(withoutReader.path) + '; the chain starts at the furthest declared hop')
  if (show(withoutReader.capabilities) !== show([CAP_A])) issues.push('the unnamed-reader reading answers ' + show(withoutReader.capabilities))
  const relay = module.effectiveCapabilities(state(), END_B, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(relay.capabilities) !== show([CAP_A])) issues.push('the relay\'s own capabilities are ' + show(relay.capabilities))
  const declaredC = module.projectManifests(seeded).ends.find((row) => row.end === END_C)
  if (show(declaredC.capabilities) !== show(CAP_SORTED)) issues.push('end-C\'s own row is ' + show(declaredC.capabilities) + '; this reading is only meaningful while the far end offers more than the path leaves')
  add('R1-the-path-is-the-chain-and-the-answer-is-the-intersection', issues.length === 0,
    issues.length === 0
      ? 'A->B->C: path ' + show(withReader.path) + ', capabilities ' + show(withReader.capabilities) + ' (end-C offers ' + show(declaredC.capabilities) + ', end-B offers [' + CAP_A + ']); with no reader named the chain is ' + show(withoutReader.path)
      : issues.join('; '))
}

{
  const issues = []
  const hole = module.effectiveCapabilities(module.projectTeamState(dropManifest(seeded, END_B)), END_C, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(hole.missing) !== show([{ hop: END_B, code: 'NO_MANIFEST' }])) issues.push('a hop with no row answers ' + show(hole.missing) + ', not NO_MANIFEST at ' + END_B)
  if (show(hole.path) !== show([END_B])) issues.push('the path of a broken chain is ' + show(hole.path) + '; it stops at the hop that broke it, and the target behind the break is not on the road walked')
  if (hole.capabilities.length !== 0) issues.push('a broken chain still quotes ' + show(hole.capabilities))

  const quiet = module.effectiveCapabilities(module.projectTeamState(withBeat(seeded, END_C, NOW - TIMEOUT)), END_C, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(quiet.missing) !== show([{ hop: END_C, code: 'PEER_SILENT' }])) issues.push('the end asked about going quiet answers ' + show(quiet.missing))
  if (show(quiet.path) !== show([END_A, END_B, END_C])) issues.push('PEER_SILENT truncated the path to ' + show(quiet.path) + '; the road is whole, the far end is quiet')

  const sameBeat = module.effectiveCapabilities(module.projectTeamState(withBeat(seeded, END_C, NOW - TIMEOUT)), END_C, NOW, { timeoutMs: TIMEOUT + 1, localEnd: END_A })
  if (sameBeat.missing.length !== 0) issues.push('at timeoutMs = sinceMs + 1 the same beat reads ' + show(sameBeat.missing) + '; the boundary is sinceMs >= timeoutMs and equal counts as out')
  const equalBeat = module.effectiveCapabilities(module.projectTeamState(withBeat(seeded, END_C, NOW - TIMEOUT)), END_C, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(equalBeat.missing) !== show([{ hop: END_C, code: 'PEER_SILENT' }])) issues.push('at timeoutMs = sinceMs the beat does NOT read as out: ' + show(equalBeat.missing))

  const down = module.effectiveCapabilities(module.projectTeamState(withBeat(seeded, END_B, NOW - 2 * TIMEOUT)), END_C, NOW, { timeoutMs: TIMEOUT, localEnd: END_A })
  if (show(down.missing) !== show([{ hop: END_B, code: 'ROUTE_DOWN' }])) issues.push('a relay gone quiet answers ' + show(down.missing) + ', not ROUTE_DOWN at ' + END_B)
  if (down.missing[0]?.code === quiet.missing[0]?.code) issues.push('a silent relay and a silent end answer with the same code; R59 keeps them two answers')
  if (show(down.path) !== show([END_A, END_B])) issues.push('ROUTE_DOWN did not stop the path at the break: ' + show(down.path))

  add('R2-missing-silent-and-down-are-three-named-answers', issues.length === 0,
    issues.length === 0
      ? 'NO_MANIFEST at end-B (path ' + show(hole.path) + '), PEER_SILENT at end-C (path whole), ROUTE_DOWN at end-B (path ' + show(down.path) + '); the same beat is silent at timeoutMs=s and healthy at timeoutMs=s+1'
      : issues.join('; '),
    ['hole: ' + show(hole), 'down: ' + show(down)])
}

{
  const issues = []
  const forward = module.projectManifests(seeded)
  const backward = module.projectManifests([...seeded].reverse())
  const shuffled = module.projectManifests([seeded[3], seeded[0], seeded[seeded.length - 1], ...seeded.slice(1, 3).reverse(), ...seeded.slice(4, seeded.length - 1)])
  if (show(forward) !== show(backward)) issues.push('the fold answers differently with the rows reversed')
  if (show(forward) !== show(shuffled)) issues.push('the fold answers differently with the rows shuffled')
  const stateForward = module.projectTeamState(factsOnly(seeded))
  const stateBackward = module.projectTeamState(factsOnly([...seeded].reverse()))
  if (show(stateForward.manifests) !== show(stateBackward.manifests)) issues.push('projectTeamState folds the manifests differently when the array is reversed')
  if (show(stateForward.merges) !== show(stateBackward.merges)) issues.push('projectTeamState folds the merges differently when the array is reversed')
  add('R3-two-arrival-orders-one-table', issues.length === 0,
    issues.length === 0
      ? 'projectManifests over ' + String(seeded.length) + ' real ledger rows: forward == reversed == shuffled (' + forward.ends.length + ' ends, malformed ' + String(forward.malformed) + ')'
      : issues.join('; '))
}

// ----------------------------------------------------------------------------------------------- B: the broker
{
  const issues = []
  const options = { timeoutMs: TIMEOUT, localEnd: END_A }
  const keys = module.brokerKeys(state(), NOW, options).map((row) => row.key)
  if (show(keys) !== show(['remote:' + END_B + ':' + CAP_A, 'remote:' + END_C + ':' + CAP_A])) issues.push('the key space is ' + show(keys))
  const mine = keys.filter((key) => key.includes(':' + END_A + ':'))
  if (mine.length !== 0) issues.push('this end\'s own keys are in the space: ' + show(mine))
  const row = module.brokerKeys(state(), NOW, options).find((entry) => entry.end === END_C)
  if (row.via !== END_B) issues.push('the key of ' + END_C + ' says via ' + show(row.via) + ', not the next hop ' + END_B)
  const ok = module.brokerCall(state(), 'remote:' + END_C + ':' + CAP_A, NOW, options)
  if (ok.code !== 'ok') issues.push('a listed key answers ' + show(ok.code) + ' where ok was expected')
  const gone = module.brokerCall(module.projectTeamState(dropManifest(seeded, END_B)), 'remote:' + END_C + ':' + CAP_A, NOW, options)
  const goneKeys = module.brokerKeys(module.projectTeamState(dropManifest(seeded, END_B)), NOW, options).map((entry) => entry.key)
  if (gone.code !== 'service-gone') issues.push('after the link node B is gone, the same key answers ' + show(gone.code) + ' instead of service-gone')
  if (gone.reason !== 'NO_MANIFEST') issues.push('the service-gone reason is ' + show(gone.reason) + ' where the break was NO_MANIFEST')
  if (goneKeys.includes('remote:' + END_C + ':' + CAP_A)) issues.push('the dead key is still listed in the second reading')
  const met = module.brokerCall(state(), 'remote:' + END_C + ':' + CAP_B, NOW, options)
  if (met.code !== 'service-gone') issues.push('a name the path did not carry answers ' + show(met.code))
  if (met.reason !== 'meet:' + END_B) issues.push('the meet-drop reason is ' + show(met.reason) + ', and the hop that lost the name is ' + END_B)
  add('B1-the-key-space-and-the-service-gone-pair', issues.length === 0,
    issues.length === 0
      ? 'keys ' + show(keys) + '; the same key remote:' + END_C + ':' + CAP_A + ' is listed and answers ok with B alive, and is gone from the listing and answers service-gone (reason NO_MANIFEST) with B dropped'
      : issues.join('; '),
    ['gone: ' + show(gone), 'found keys after the drop: ' + show(goneKeys)])
}

{
  const issues = []
  const options = { timeoutMs: TIMEOUT, localEnd: END_A }
  const ungranted = module.brokerCall(state(), 'remote:' + END_C + ':' + CAP_A, NOW, { timeoutMs: TIMEOUT, localEnd: END_B })
  if (ungranted.code !== 'not-granted') issues.push('a pair with no handshake answers ' + show(ungranted.code) + ' instead of not-granted')

  const unprovided = module.brokerCall(module.projectTeamState(dropBeats(seeded, PROVIDER)), 'remote:' + END_C + ':' + CAP_A, NOW, options)
  if (unprovided.code !== 'no-provider') issues.push('nobody answering on that end answers ' + show(unprovided.code) + ' instead of no-provider')
  // Both ends are granted (the seed writes both handshakes), so the only thing left wrong with this key
  // is that end-B hosts nobody who declares the name: the end in the key is not decoration.
  const elsewhere = module.brokerCall(state(), 'remote:' + END_B + ':' + CAP_A, NOW, options)
  if (elsewhere.code !== 'no-provider') issues.push('a key whose end hosts nobody who declares it answers ' + show(elsewhere.code) + ' instead of no-provider')

  const unreachable = module.brokerCall(module.projectTeamState(dropRow(seeded, END_B)), 'remote:' + END_C + ':' + CAP_A, NOW, options)
  if (unreachable.code !== 'provider-silent') issues.push('a healthy provider this end cannot reach answers ' + show(unreachable.code) + ' instead of provider-silent')

  const unknown = module.brokerCall(state(), 'remote:end-Z:' + CAP_A, NOW, options)
  if (unknown.code !== 'unknown-key') issues.push('a key no row ever offered answers ' + show(unknown.code))
  if (unknown.end !== null || unknown.providerKey !== null) issues.push('an unknown key resolved to ' + show({ end: unknown.end, providerKey: unknown.providerKey }))
  const notAKey = module.brokerCall(state(), CAP_A, NOW, options)
  if (notAKey.code !== 'unknown-key') issues.push('a bare capability name answers ' + show(notAKey.code))

  const throws = []
  try { module.brokerCall(state(), 7, NOW, options); throws.push('a non-string key was accepted') } catch (error) { if (error instanceof TypeError !== true) throws.push('a non-string key threw ' + show(error && error.name)) }
  try { module.brokerCall(state(), 'remote:' + END_C + ':' + CAP_A, NOW, { timeoutMs: TIMEOUT }); throws.push('a call with no end asking was accepted') } catch (error) { if (error instanceof TypeError !== true) throws.push('a call with no end asking threw ' + show(error && error.name)) }
  try { module.effectiveCapabilities(state(), END_C, NOW, {}); throws.push('a reading with no threshold was accepted') } catch (error) { if (error instanceof TypeError !== true) throws.push('a reading with no threshold threw ' + show(error && error.name)) }
  if (throws.length !== 0) issues.push(...throws)
  add('B2-the-other-four-codes-and-the-two-that-throw', issues.length === 0,
    issues.length === 0
      ? 'not-granted (no handshake), no-provider (nobody answering; and an end that hosts nobody who declares it), provider-silent (answering but out of reach), unknown-key (never offered, and a bare name); a non-string key and a call with no end asking raise TypeError'
      : issues.join('; '))
}

// ----------------------------------------------------------------------------------------------- F: the facade
{
  const issues = []
  const options = { timeoutMs: TIMEOUT, localEnd: END_A }
  const facade = reads.collab?.broker
  if (facade === undefined) issues.push('linkCollab.broker is not published')
  else {
    const before = bytesOf(reads.dir)
    if (show(facade.keys(state(), NOW, options)) !== show(module.brokerKeys(state(), NOW, options))) issues.push('broker.keys answers something the module function does not')
    if (facade.lastCode !== null) issues.push('lastCode starts at ' + show(facade.lastCode) + ', not null')
    const ok = facade.call(state(), 'remote:' + END_C + ':' + CAP_A, NOW, options)
    if (ok.code !== 'ok') issues.push('the facade answered ' + show(ok.code))
    if (facade.lastCode !== 'ok') issues.push('lastCode is ' + show(facade.lastCode) + ' after an ok call')
    const unknown = facade.call(state(), 'remote:end-Z:' + CAP_A, NOW, options)
    if (unknown.code !== 'unknown-key') issues.push('the facade answered ' + show(unknown.code) + ' for a key no row offered')
    if (facade.lastCode !== 'unknown-key') issues.push('lastCode is ' + show(facade.lastCode) + ' after the second call')
    if (show(facade.call(state(), 'remote:' + END_C + ':' + CAP_A, NOW, options)) !== show(module.brokerCall(state(), 'remote:' + END_C + ':' + CAP_A, NOW, options))) issues.push('the facade and the module function answer differently for the same key')
    const after = bytesOf(reads.dir)
    if (after.sha256 !== before.sha256 || after.length !== before.length) issues.push('the facade wrote to the ledger: ' + show(before) + ' -> ' + show(after))
  }
  add('F1-the-facade-is-the-same-owner-and-writes-nothing', issues.length === 0,
    issues.length === 0
      ? 'linkCollab.broker.keys/call equal the module functions on the same state; lastCode goes null -> ok -> unknown-key; the ledger sha256 and length do not move'
      : issues.join('; '))
}

// ----------------------------------------------------------------------------------------------- verdict
if (KEEP !== true) rmSync(root, { recursive: true, force: true })
const failed = readings.filter((reading) => reading.ok !== true)
console.log(String(readings.length) + ' readings, ' + String(failed.length) + ' failed' + (failed.length === 0 ? '' : ' (' + failed.map((reading) => reading.id).join(', ') + ')'))
process.exit(failed.length === 0 ? 0 : 1)
