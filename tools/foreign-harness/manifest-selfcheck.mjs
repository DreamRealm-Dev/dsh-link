#!/usr/bin/env node
/**
 * Self-check (R183-P2) -- the foreign end's three segments, measured against the ship.
 *
 * Subject: the R183 additions to tools/foreign-harness/foreign-end.mjs -- the capability manifest it
 * declares, the decay it reads along a path, and the key space it answers a call through. The spellings
 * are the frozen ones in docs/handoff/R183-contract.md 3.1/3.2 and the record of the ledger seat in
 * docs/handoff/R183-A-ledger.md (its section 1 file:line table and its section 2 refusal list).
 *
 * WHICH PAGE THIS FILE WAS WRITTEN AGAINST: two versions, and both are named here on purpose.
 *   (a) When this harness was built, docs/protocol/device-net-v1.md had no R183 sections yet: 151 lines,
 *       22728 bytes, sha256 aa2815722667ed6dec0ba9b651f2bb1f5a09c91919d9643935f071165a749485. The
 *       manifest/decay/key-space rules below were implemented from the frozen contract
 *       (docs/handoff/R183-contract.md 3.1/3.2) and the ledger seat's record (docs/handoff/R183-A-ledger.md).
 *   (b) That page then landed its R183 sections (section seven for this seat: 274 lines, 49781 bytes,
 *       sha256 6c3ac81a2fd22ffb468da24f709cec2a26e141d25856e73b500448927e8e905f). This harness was
 *       re-read against section seven: the six fields, the fold's declared/capabilities/malformed split,
 *       the three decay codes with sinceMs >= timeoutMs and "never beat reads unknown", the six verdicts
 *       with their frozen precedence, the paired service-gone listing, and the sentence that this key
 *       space is our own facade and NOT a kernel service broker -- all of them are implemented here and
 *       measured below. Section eight (team/merge) is another seat's and is not read here.
 * The relay route, its refusals, its identity rules and the record shapes are taken from the page in
 * both versions.
 *
 * Every reading comes from the SHIPPED artifact or from a REAL child process, and the ledger is counted
 * by this script itself: sha256 + byte length + parsed row count, before and after each write, so a
 * refusal that still appends fails here rather than passing on a plugin's own report. Nothing here
 * drives the live world (31761 / 31760 / 9222) and nothing reads or writes kernel-home/collab.
 *
 *   W  THE HONEST JOIN      a real child process writes one real end/manifest row into a real ledger
 *                           and our own fold reads it; an end that joins without one is a member and
 *                           not a manifest (the paired negative).
 *   L  THE THREE LIES       a capability nobody declared; a via that takes over another end's next hop;
 *                           a batch claiming another end's identity. Each says who refused it -- or
 *                           says out loud that nobody did.
 *   R  DECAY AND KEY SPACE  one whole road and three breaks (manifest withdrawn / over threshold / road
 *                           down): listed or not, and the verdict for the same key, on our side and in
 *                           the foreign end's own reading of the same facts.
 *   G  THE CLOSED SETS      six verdicts, three break codes, and TypeError for anything else.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 the readings held and at least one requirement has
 * no owner in this build -- the hole is named in the summary line, never pressed into green.
 * Usage: node tools/foreign-harness/manifest-selfcheck.mjs [--keep]
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..')
const FOREIGN = join(HERE, 'foreign-end.mjs')
const C = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href)
const KEEP = process.argv.includes('--keep')
const show = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }
const clip = (text, max = 200) => { const out = String(text); return out.length > max ? out.slice(0, max) + '...' : out }
const readings = []
const holes = []
const add = (id, ok, detail, evidence = []) => {
  readings.push({ id, ok: ok === true })
  console.log((ok === true ? 'PASS ' : 'FAIL ') + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}
const hole = (id, detail, evidence = []) => {
  holes.push(id)
  console.log('HOLE ' + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}

const TOKEN = 'r183-p2-token'
const T0 = 1700000000000
const NOW = T0 + 1000
const TIMEOUT = 60000
const PROTOCOL = 'dsh-link-device/1'
const KEY = 'remote:end-C:read:db'
const VERDICTS = ['ok', 'unknown-key', 'no-provider', 'provider-silent', 'not-granted', 'service-gone']
const MISS_CODES = ['NO_MANIFEST', 'PEER_SILENT', 'ROUTE_DOWN']
const manifestFact = (end, via, capabilities) => ({ ...C.manifestRecord({ end, via, platform: 'dsh', protocolVersion: PROTOCOL, capabilities, at: T0 }), actor: end })
const manifestOf = (rows, end) => rows.filter((row) => (row.kind === 'end/manifest') && ((row.payload && row.payload.end === end) || row.subject === end))

/** The world every reading below is taken over: one member on a far end behind one relay. */
const worldRows = (options = {}) => {
  const rows = []
  const push = (row, writer) => rows.push({ seq: rows.length + 1, at: T0, writer, ...row })
  push({ kind: 'capability/state', actor: 'end-C', subject: 'm-c', payload: { id: 'm-c', capabilities: ['read:db', 'write:src'] } }, 'end-C')
  push({ kind: 'member/state', actor: 'team-1', subject: 'm-c', payload: { id: 'm-c', team: 'team-1', state: 'active', role: 'member' } }, 'end-C')
  if (options.hostOfProvider !== false) push({ kind: 'member/host', actor: 'team-1', subject: 'm-c', payload: { id: 'm-c', end: 'end-C', via: 'end-B', at: T0 } }, 'end-C')
  push({ kind: 'member/heartbeat', actor: 'team-1', subject: 'm-c', payload: { id: 'm-c', at: T0 } }, 'end-C')
  if (options.hostOfMiddle !== false) push({ kind: 'member/host', actor: 'end-B', subject: 'end-B', payload: { id: 'end-B', end: 'end-B', via: null, at: T0 } }, 'end-B')
  push({ kind: 'member/host', actor: 'end-C', subject: 'end-C', payload: { id: 'end-C', end: 'end-C', via: null, at: T0 } }, 'end-C')
  push(manifestFact('end-A', null, ['read:db', 'write:src']), 'end-A')
  if (options.manifestOfMiddle !== false) push(manifestFact('end-B', null, ['read:db']), 'end-B')
  push(manifestFact('end-C', 'end-B', ['read:db', 'write:src']), 'end-C')
  if (options.grant !== false) push({ kind: 'peer/state', actor: 'end-A', subject: 'end-A->end-C', payload: { from: 'end-A', to: 'end-C', request: 'call your provider', state: 'granted' } }, 'end-A')
  if (options.beatEndC !== undefined) push({ kind: 'member/heartbeat', actor: 'end-C', subject: 'end-C', payload: { id: 'end-C', at: options.beatEndC } }, 'end-C')
  if (options.beatEndB !== undefined) push({ kind: 'member/heartbeat', actor: 'end-B', subject: 'end-B', payload: { id: 'end-B', at: options.beatEndB } }, 'end-B')
  return rows
}
/** The same world with one fact withdrawn -- a reading over a hypothetical ledger, not a write. */
const withoutRow = (rows, predicate) => rows.filter((row) => predicate(row) === false).map((row, index) => ({ ...row, seq: index + 1 }))
const withoutManifest = (rows, end) => withoutRow(rows, (row) => row.kind === 'end/manifest' && (row.payload?.end === end || row.subject === end))

const root = mkdtempSync(join(tmpdir(), 'r183-p2-'))
const home = (name) => { const dir = join(root, name); mkdirSync(dir, { recursive: true }); return dir }

// --- our side: a real ledger, a real relay route, and the shipped folds -------------------------
const logA = C.openControlLog({ dir: home('end-A'), writer: 'end-A' })
const endpoint = C.createRelayEndpoint({ token: TOKEN, log: logA })
const server = createServer(endpoint.handler)
await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
const urlA = 'http://127.0.0.1:' + String(server.address().port) + endpoint.path
const ledgerPath = join(root, 'end-A', 'control.jsonl')
const ledgerDigest = () => {
  const bytes = existsSync(ledgerPath) ? readFileSync(ledgerPath) : Buffer.alloc(0)
  const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim() !== '')
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length, rows: lines.length, parsed: lines.map((line) => JSON.parse(line)) }
}
const ourState = () => C.projectTeamState(logA.replay())
const ask = async (port, route, body) => {
  const response = await fetch('http://127.0.0.1:' + String(port) + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const verdictOf = (code) => code === 'ok' || code === 'service-gone' || code === 'not-granted' || code === 'no-provider' || code === 'provider-silent' || code === 'unknown-key'

const children = []
/** A real other process, started the way the protocol page says an end is started. */
const startChild = async (flags) => {
  const child = spawn(process.execPath, [FOREIGN, '--token', TOKEN, ...flags], { stdio: ['ignore', 'pipe', 'inherit'] })
  children.push(child)
  const lines = []
  const said = []
  let ready = null
  createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line)
    let message = null
    try { message = JSON.parse(line) } catch { return }
    said.push(message)
    if (message.ready === true) ready = message
  })
  for (let tick = 0; tick < 200 && ready === null; tick += 1) await new Promise((settle) => setTimeout(settle, 50))
  return { child, pid: child.pid, ready, said, lines }
}

console.log('self-check (R183-P2): ' + FOREIGN)
console.log('our ledger: ' + ledgerPath)
console.log('shipped fold: ' + join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))

// =============================================================================================== W
// The world first, written the way our own producers write it: the shipped builders, our own log.
const world = worldRows()
for (const row of world) {
  if (row.kind === 'end/manifest') await C.appendManifest(ourState(), logA, { end: row.payload.end, via: row.payload.via, platform: row.payload.platform, protocolVersion: row.payload.protocolVersion, capabilities: row.payload.capabilities, at: row.payload.at })
  else await logA.append({ kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })
}
const seeded = ledgerDigest()
console.log('world written: ' + String(seeded.rows) + ' rows, sha256 ' + seeded.sha256.slice(0, 16) + ', ' + String(seeded.length) + ' bytes; manifests ' + show(C.projectManifests(seeded.parsed).ends.map((row) => row.end)))

{
  // The whole road in our own ledger, before any foreign process has said a word: this is the reading
  // the three breaks below are paired against.
  const state = ourState()
  const keys = C.brokerKeys(state, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const call = C.brokerCall(state, KEY, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const decay = C.effectiveCapabilities(state, 'end-C', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const ok = show(decay.path) === show(['end-A', 'end-B', 'end-C']) && show(decay.capabilities) === show(['read:db']) && decay.missing.length === 0 &&
    keys.map((row) => row.key).includes(KEY) && (keys.find((row) => row.key === KEY) ?? {}).via === 'end-B' && call.code === 'ok' && call.end === 'end-C' && call.providerKey === 'read:db'
  add('R0-one-whole-road-lists-the-key-and-answers-ok', ok,
    ok ? 'end-A->end-B->end-C: path ' + show(decay.path) + ', capabilities ' + show(decay.capabilities) + ' (end-C offers both names, end-B only read:db, so the road keeps read:db); ' + KEY + ' is listed via end-B and answers ok' : 'the whole road did not read as one: ' + show({ decay, keys: keys.map((row) => row.key), call }),
    ['keys: ' + show(keys.map((row) => row.key))])
}

const baseManifests = C.projectManifests(ledgerDigest().parsed)

// W1: the honest join -- a real child process, one real end/manifest row, read by our own fold.
const honest = await startChild(['--home', home('ch-f'), '--writer', 'end-F', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-f', '--team', 'team-1', '--tool', 'sum', '--end', 'end-F', '--manifest', 'sum'])
const afterHonest = ledgerDigest()
{
  const issues = []
  if (honest.ready === null) issues.push('the child never came up: ' + show(honest.lines.slice(0, 3)))
  const row = honest.ready?.manifest?.[0] ?? null
  if (row === null) issues.push('the child reported no manifest row')
  else {
    const payload = row.payload ?? {}
    for (const field of ['end', 'via', 'platform', 'protocolVersion', 'capabilities', 'at']) if (payload[field] === undefined) issues.push('the row is missing the frozen field ' + field + ': ' + show(row))
    if (payload.end !== 'end-F' || payload.via !== null) issues.push('the row speaks for ' + show(payload.end) + ' via ' + show(payload.via))
    if (show(payload.capabilities) !== show(['sum'])) issues.push('the row declares ' + show(payload.capabilities))
  }
  const gained = afterHonest.rows - seeded.rows
  if (gained !== 5) issues.push('the child wrote ' + String(gained) + ' rows, not the five it declares (member, capability, host, heartbeat, manifest)')
  const landed = manifestOf(afterHonest.parsed, 'end-F')
  if (landed.length !== 1) issues.push('our ledger holds ' + String(landed.length) + ' end/manifest row(s) for end-F')
  else if (show(landed[0].payload) !== show(row.payload)) issues.push('the row in our ledger is ' + show(landed[0].payload) + ', not the row the child reported ' + show(row.payload))
  const folded = C.projectManifests(afterHonest.parsed).ends.find((entry) => entry.end === 'end-F') ?? null
  const team = C.projectTeamState(afterHonest.parsed).manifests.ends.find((entry) => entry.end === 'end-F') ?? null
  if (folded === null) issues.push('projectManifests does not read the end that just joined')
  else if (show(folded.capabilities) !== show(['sum'])) issues.push('projectManifests reads capabilities ' + show(folded.capabilities))
  if (team === null) issues.push('projectTeamState(...).manifests does not read it either')
  else if (show(team) !== show(folded)) issues.push('the two folds disagree: ' + show(team) + ' vs ' + show(folded))
  const member = C.projectTeamState(afterHonest.parsed).members.find((entry) => entry.id === 'm-f') ?? null
  if (member === null || C.capabilitiesOf(C.projectTeamState(afterHonest.parsed), 'm-f').includes('sum') !== true) issues.push('the member did not join with its capability: ' + show({ member }))
  add('W1-honest-join-one-real-row-and-our-own-fold-reads-it', issues.length === 0,
    issues.length === 0
      ? 'a real child process (pid ' + String(honest.pid) + ') wrote one real end/manifest row for end-F; the ledger grew ' + String(gained) + ' rows to ' + String(afterHonest.rows) + ' (sha256 ' + seeded.sha256.slice(0, 16) + ' -> ' + afterHonest.sha256.slice(0, 16) + ', ' + String(seeded.length) + ' -> ' + String(afterHonest.length) + ' bytes) and projectManifests and projectTeamState both read declared ' + show(folded.declared) + ' / capabilities ' + show(folded.capabilities)
      : issues.join('; '),
    ['the row it landed: ' + show(landed[0]?.payload ?? null)])
}

// W2: the paired negative -- an end that joins without a manifest is a member, not a manifest.
const quiet = await startChild(['--home', home('ch-f2'), '--writer', 'end-F2', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-f2', '--team', 'team-1', '--tool', 'sum', '--end', 'end-F2'])
const afterQuiet = ledgerDigest()
{
  const issues = []
  if (quiet.ready === null) issues.push('the second child never came up')
  const folded = C.projectManifests(afterQuiet.parsed)
  const state = C.projectTeamState(afterQuiet.parsed)
  if (state.members.some((row) => row.id === 'm-f2') !== true) issues.push('the silent end did not even join as a member')
  if (folded.ends.some((row) => row.end === 'end-F2')) issues.push('an end with no manifest row is in the manifests fold')
  if (manifestOf(afterQuiet.parsed, 'end-F2').length !== 0) issues.push('a manifest row for end-F2 exists after all')
  if (folded.malformed !== baseManifests.malformed) issues.push('the malformed count moved for an end that said nothing: ' + String(baseManifests.malformed) + ' -> ' + String(folded.malformed))
  add('W2-an-end-without-a-manifest-is-a-member-and-not-a-manifest', issues.length === 0,
    issues.length === 0
      ? 'm-f2 is in members (' + String(state.members.length) + ' members) while end-F2 is not in manifests.ends (' + show(folded.ends.map((row) => row.end)) + '); paired against the end that DID declare one'
      : issues.join('; '))
}

// =============================================================================================== L
// L1: declaring a capability nobody ever declared. Two owners, named, plus the wire's honest answer.
const afterCleanMalformed = C.projectManifests(ledgerDigest().parsed).malformed
const liar1 = await startChild(['--home', home('ch-g'), '--writer', 'end-G', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-g', '--team', 'team-1', '--tool', 'sum', '--end', 'end-G', '--lie', 'capability', '--lie-capability', 'ghost:cap'])
const afterLiar1 = ledgerDigest()
{
  const issues = []
  if (liar1.ready === null) issues.push('the lying child never came up')
  const wire = liar1.ready?.reached ?? null
  if (wire?.status !== 200) issues.push('the relay did not take the row at all: ' + show(wire) + ' (that is a different finding, not this one)')
  const folded = C.projectManifests(afterLiar1.parsed)
  const row = folded.ends.find((entry) => entry.end === 'end-G') ?? null
  if (row === null) issues.push('the lying end is not visible at all -- "unreadable" must not read as "absent"')
  else {
    if (show(row.declared) !== show(['ghost:cap'])) issues.push('declared is ' + show(row.declared) + ', and the fold must keep the words the row carried')
    if (row.capabilities.length !== 0) issues.push('capabilities is ' + show(row.capabilities) + ', and a name nobody declared must not enter it')
  }
  if (folded.malformed !== afterCleanMalformed + 1) issues.push('malformed is ' + String(folded.malformed) + ' where the clean world reads ' + String(afterCleanMalformed) + '; one unreadable name is one more')
  // The admission face: the same claim, pushed through the shipped write, named.
  const before = ledgerDigest()
  let refusal = null
  try { await C.appendManifest(ourState(), logA, { end: 'end-G', via: null, platform: 'harness-x', protocolVersion: PROTOCOL, capabilities: ['ghost:cap'], at: T0 }) } catch (error) { refusal = { name: error?.name, code: error?.code, message: String(error?.message ?? error) } }
  const after = ledgerDigest()
  if (refusal === null) issues.push('the admission face accepted a name the registry never held')
  else {
    if (refusal.code !== 'MANIFEST_CAPABILITY') issues.push('the admission refused with ' + show(refusal.code) + ', not MANIFEST_CAPABILITY')
    if (String(refusal.message ?? '').startsWith('MANIFEST_CAPABILITY:') !== true) issues.push('the code is not first in the message: ' + clip(refusal.message))
  }
  if (after.sha256 !== before.sha256 || after.length !== before.length || after.rows !== before.rows) issues.push('the ledger moved through a refusal: ' + show({ before: before.sha256.slice(0, 16), after: after.sha256.slice(0, 16) }))
  const clean = C.projectManifests(ledgerDigest().parsed).ends.find((entry) => entry.end === 'end-F') ?? null
  add('L1-a-name-nobody-declared-is-refused-by-name-on-the-write-and-never-read-as-a-capability', issues.length === 0,
    issues.length === 0
      ? 'the relay took the row (200, appended 1) because it reads no payload; the fold counts it malformed (' + String(afterCleanMalformed) + ' -> ' + String(folded.malformed) + ') and keeps it visible with declared ' + show(row.declared) + ' but capabilities ' + show(row.capabilities) + '; the shipped admission refuses the same claim with MANIFEST_CAPABILITY and the ledger does not move (' + after.sha256.slice(0, 16) + ' / ' + String(after.length) + ' bytes / ' + String(after.rows) + ' rows). Paired: the honest child end-F reads declared ' + show(clean?.declared) + ' capabilities ' + show(clean?.capabilities)
      : issues.join('; '),
    ['refusal: ' + clip(refusal?.message)])
}

// L1b: the same claim in the mouth of the reference implementation itself -- asked to declare a name
// nobody declared, it refuses by name and writes nothing (the pair for the lie above, which is a lie
// only because the caller asked for one).
const honestRefuser = await startChild(['--home', home('ch-s'), '--writer', 'end-S', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-s', '--team', 'team-1', '--tool', 'sum', '--end', 'end-S', '--manifest', 'ghost:cap'])
{
  const issues = []
  const refusalLine = (honestRefuser.said ?? []).find((message) => message.manifest !== undefined) ?? null
  if (honestRefuser.ready === null) issues.push('the child never came up')
  if (refusalLine === null || refusalLine.manifest?.refused !== 'MANIFEST_CAPABILITY') issues.push('the reference implementation did not refuse its own unregistered name: ' + show(refusalLine))
  if ((honestRefuser.ready?.manifest ?? []).length !== 0) issues.push('it wrote a row anyway: ' + show(honestRefuser.ready.manifest))
  const rows = manifestOf(ledgerDigest().parsed, 'end-S')
  if (rows.length !== 0) issues.push('a manifest row for end-S is in our ledger although it refused to write one')
  add('L1b-the-reference-implementation-refuses-to-write-a-name-the-registry-never-held', issues.length === 0,
    issues.length === 0
      ? 'the same claim, honestly offered by the foreign end itself, is refused by its own write path with MANIFEST_CAPABILITY and no row is appended (' + String(manifestOf(ledgerDigest().parsed, 'end-S').length) + ' rows for end-S); the lie in L1 is a lie because the caller asked for one'
      : issues.join('; '),
    ['the child said: ' + clip(refusalLine?.manifest?.detail ?? show(refusalLine))])
}

// L2: the via lie -- a row for ANOTHER end that takes over its next hop, over the real route.
const beforeVia = ledgerDigest()
const cleanReal = { keys: C.brokerKeys(ourState(), NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' }).map((row) => ({ key: row.key, via: row.via })), call: C.brokerCall(ourState(), KEY, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' }) }
const liar2 = await startChild(['--home', home('ch-h'), '--writer', 'end-H', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-h', '--team', 'team-1', '--tool', 'read:db', '--end', 'end-H', '--lie', 'via', '--lie-victim', 'end-C', '--lie-via', 'end-H'])
const afterVia = ledgerDigest()
{
  const issues = []
  if (liar2.ready === null) issues.push('the lying child never came up')
  const wire = liar2.ready?.reached ?? null
  const row = liar2.ready?.manifest?.[0] ?? null
  if (row === null) issues.push('the child reported no row')
  else {
    if (row.payload?.end !== 'end-C') issues.push('the lying row names ' + show(row.payload?.end))
    if (row.payload?.via !== 'end-H') issues.push('the lying row carries via ' + show(row.payload?.via))
  }
  if (wire?.status !== 200) issues.push('the relay refused the row: ' + show(wire))
  const state = ourState()
  const decay = C.effectiveCapabilities(state, 'end-C', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const keys = C.brokerKeys(state, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' }).map((entry) => entry.key)
  const call = C.brokerCall(state, KEY, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  if (show(decay.missing) !== show([{ hop: 'end-H', code: 'NO_MANIFEST' }])) issues.push('the rewritten road answers ' + show(decay.missing))
  if (keys.includes(KEY)) issues.push('the key is still listed after the road broke: ' + show(keys))
  if (call.code !== 'service-gone' || call.reason !== 'NO_MANIFEST') issues.push('the call for a key whose road broke answers ' + show(call))
  if (cleanReal.keys.find((entry) => entry.key === KEY)?.via !== 'end-B' || cleanReal.call.code !== 'ok') issues.push('the paired clean reading is not what this pair needs: ' + show(cleanReal))
  add('L2-a-row-that-takes-over-anothers-next-hop-is-not-refused-on-the-wire', issues.length === 0,
    issues.length === 0
      ? 'no owner refuses the row itself: the relay took it (200, appended ' + String(wire.body?.appended) + ') and the fold reads end-C as via ' + show('end-H') + '. What it buys the liar is a broken road: ' + show(decay.path) + ' with NO_MANIFEST at end-H, ' + KEY + ' gone from the listing, and the call service-gone (reason NO_MANIFEST). Paired: before the lie the same key was listed via end-B and answered ok'
      : issues.join('; '),
    ['clean before the lie: ' + show(cleanReal), 'after the lie: ' + show({ path: decay.path, missing: decay.missing, keys, call })])
}

// L2b: the same lie, but the hop it names declares a manifest too. Does it buy a road?
const liar3 = await startChild(['--home', home('ch-h2'), '--writer', 'end-H2', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-h2', '--team', 'team-1', '--tool', 'read:db', '--end', 'end-H2', '--manifest', 'read:db', '--lie', 'via', '--lie-victim', 'end-C', '--lie-via', 'end-H2'])
const afterHijack = ledgerDigest()
{
  const state = ourState()
  const decay = C.effectiveCapabilities(state, 'end-C', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const keys = C.brokerKeys(state, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const call = C.brokerCall(state, KEY, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const rewired = show(decay.path) === show(['end-A', 'end-H2', 'end-C']) && decay.missing.length === 0 && keys.map((row) => row.key).includes(KEY) && call.code === 'ok'
  const row = C.projectManifests(afterHijack.parsed).ends.find((entry) => entry.end === 'end-C') ?? null
  const stolen = (liar3.ready?.manifest ?? []).find((entry) => entry.payload?.end === 'end-C') ?? null
  // And the last owner that could have refused it, asked directly: our own write face, whose log belongs
  // to end-A, writing a row that speaks for end-Z.
  const beforeAdmit = ledgerDigest()
  let admitted = null
  try { admitted = await C.appendManifest(ourState(), logA, { end: 'end-Z', via: 'end-F', platform: 'dsh', protocolVersion: PROTOCOL, capabilities: ['read:db'], at: T0 }) } catch (error) { admitted = { refused: String(error?.code ?? error) } }
  const afterAdmit = ledgerDigest()
  const detail = 'the same lie, one hop further: with end-H2 declaring a manifest of its own the fold takes the rewrite -- end-C is read via ' + show(row?.via) + ', the road is ' + show(decay.path) + ' with capabilities ' + show(decay.capabilities) + ', and ' + KEY + ' is listed again and answers ' + show(call.code) + '. No owner refuses it: the relay reads no payload, the fold reads one fact per hop, and the admission face never compares the end a row names with the end that wrote it -- asked directly, appendManifest wrote end-Z a row (via end-F) into the ledger whose writer is end-A, ' + String(afterAdmit.rows - beforeAdmit.rows) + ' row(s) added, and only MANIFEST_VIA (via === end) or MANIFEST_CAPABILITY (a name nobody declared) can stop it.'
  if (rewired) hole('L2b-the-same-lie-with-a-backed-hop-rewrites-the-road', detail + ' => the liar is ON the road to end-C and the key is offered through it.', ['fold: ' + show(row), 'keys: ' + show(keys.map((entry) => ({ key: entry.key, via: entry.via }))), 'call: ' + show(call), 'the row that speaks for end-C, written by the end that is not end-C: ' + show(stolen), 'the same claim through our own admission face: ' + show(admitted) + ' (+' + String(afterAdmit.rows - beforeAdmit.rows) + ' row)'])
  else add('L2b-the-same-lie-with-a-backed-hop-does-not-rewrite-the-road', true, detail + ' (measured: it did not take over)', ['fold: ' + show(row), 'decay: ' + show(decay)])
}

// L2c: the one via rule our own side names, for the record: via that names the end itself.
{
  const issues = []
  const before = ledgerDigest()
  let refusal = null
  try { await C.appendManifest(ourState(), logA, { end: 'end-Q', via: 'end-Q', platform: 'dsh', protocolVersion: PROTOCOL, capabilities: ['read:db'], at: T0 }) } catch (error) { refusal = { code: error?.code, message: String(error?.message ?? error) } }
  const after = ledgerDigest()
  if (refusal?.code !== 'MANIFEST_VIA') issues.push('a via that names its own end answers ' + show(refusal))
  if (after.sha256 !== before.sha256 || after.rows !== before.rows) issues.push('the ledger moved through the refusal')
  add('L2c-the-only-via-rule-in-this-build-is-via-naming-the-end-itself', issues.length === 0,
    issues.length === 0
      ? 'MANIFEST_VIA refuses via === end (a hop towards nowhere), ledger byte for byte as it was (' + after.sha256.slice(0, 16) + ', ' + String(after.rows) + ' rows). This is the whole of the via rule: it says nothing about a row written for somebody else, which is the finding above'
      : issues.join('; '),
    ['refusal: ' + clip(refusal?.message)])
}

// L3: claiming another end's identity on the wire.
const beforeIdentity = ledgerDigest()
const liar4 = await startChild(['--home', home('ch-l'), '--writer', 'end-L', '--peer', urlA, '--port', '0', '--rounds', '900', '--member', 'm-l', '--team', 'team-1', '--tool', 'sum', '--end', 'end-L', '--lie', 'identity', '--lie-as', 'end-A', '--lie-as-third', 'end-F'])
const afterIdentity = ledgerDigest()
{
  const issues = []
  const said = liar4.ready?.lies ?? []
  const byAttempt = Object.fromEntries(said.map((entry) => [entry.attempt, entry]))
  if (said.length !== 3) issues.push('the child reported ' + String(said.length) + ' attempts, not three')
  if (byAttempt['own-name']?.status !== 200) issues.push('its own name was not accepted: ' + show(byAttempt['own-name']))
  if (byAttempt['receiver-own-name']?.code !== 'RELAY_IMPERSONATION') issues.push('claiming the receiving end own name answers ' + show(byAttempt['receiver-own-name']))
  if (byAttempt['another-end-name']?.code !== 'RELAY_REWRITTEN') issues.push('claiming a third end whose instance is known answers ' + show(byAttempt['another-end-name']))
  const gained = afterIdentity.rows - beforeIdentity.rows
  const sent = byAttempt['own-name']?.sent ?? 0
  if (gained !== sent) issues.push('the ledger grew ' + String(gained) + ' rows through the identity lie, and the one honest attempt sent ' + String(sent) + '')
  add('L3-claiming-another-ends-identity-is-refused-by-name-by-the-receiving-relay', issues.length === 0,
    issues.length === 0
      ? 'the same real child process, three batches, three receipts: its own name accepted (200, appended ' + String(byAttempt['own-name']?.appended) + '), the receiving end own name refused RELAY_IMPERSONATION, and a third end the receiver already holds under another instance refused RELAY_REWRITTEN; the ledger grew exactly the one honest batch (' + String(gained) + ' rows)'
      : issues.join('; '),
    ['receipts: ' + show(said.map((entry) => ({ attempt: entry.attempt, claimed: entry.claimed, status: entry.status, code: entry.code, appended: entry.appended }))),
      'the row that speaks for end-C while end-C wrote nothing, and the batch header that carried it (writer end-H): ' + show(liar2.ready?.manifest?.[0] ?? null)])
}

// =============================================================================================== R
// The four worlds: one whole road and three ways it breaks, read by our side and by a real foreign
// end that holds the same facts. Our side reads a records array (a hypothetical ledger); the foreign
// end is handed the same rows as a ledger it holds (--seed), which is how a reading over a chosen
// world is taken without writing one into anybody.
const worlds = [
  { name: 'clean', rows: worldRows(), expect: { path: ['end-A', 'end-B', 'end-C'], missing: [], listed: true, code: 'ok' } },
  { name: 'withdrawn', rows: withoutManifest(worldRows(), 'end-B'), expect: { missing: [{ hop: 'end-B', code: 'NO_MANIFEST' }], listed: false, code: 'service-gone', reason: 'NO_MANIFEST' } },
  { name: 'silent', rows: worldRows({ beatEndC: NOW - TIMEOUT }), expect: { missing: [{ hop: 'end-C', code: 'PEER_SILENT' }], listed: false, code: 'service-gone', reason: 'PEER_SILENT' } },
  { name: 'silent-not-quite', rows: worldRows({ beatEndC: NOW - TIMEOUT }), timeoutMs: TIMEOUT + 1, expect: { missing: [], listed: true, code: 'ok' } },
  { name: 'down', rows: worldRows({ beatEndB: NOW - 2 * TIMEOUT }), expect: { missing: [{ hop: 'end-B', code: 'ROUTE_DOWN' }], listed: false, code: 'service-gone', reason: 'ROUTE_DOWN' } },
  { name: 'ungranted', rows: worldRows({ grant: false }), expect: { missing: [], listed: true, code: 'not-granted' } },
  { name: 'unprovided', rows: worldRows({ hostOfProvider: false }), expect: { missing: [], listed: true, code: 'no-provider' } },
  { name: 'unreachable', rows: worldRows({ hostOfMiddle: false }), expect: { missing: [], listed: true, code: 'provider-silent' } },
  // The page's own words for a withdrawal (docs/protocol/device-net-v1.md:122): declaring again, and
  // declaring LESS, is a withdrawal -- a real write, not a hole punched in an array. end-B drops
  // read:db, so the road to end-C keeps only write:src: one key leaves and another appears.
  {
    name: 'withdrawn-by-write',
    rows: (() => { const rows = worldRows(); rows.push({ seq: rows.length + 1, at: T0 + 500, writer: 'end-B', ...manifestFact('end-B', null, ['write:src']) }); return rows })(),
    expect: { missing: [], listed: false, code: 'service-gone', reason: 'meet:end-B', alsoListed: 'remote:end-C:write:src' },
  },
]
const foreignWorld = async (entry) => {
  const file = join(root, entry.name + '.jsonl')
  writeFileSync(file, entry.rows.map((row) => JSON.stringify({ seq: row.seq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at, writer: row.writer ?? 'seed-1', instance: 'seed-1' })).join('\n') + '\n')
  const child = await startChild(['--home', home('ch-world-' + entry.name), '--port', '0', '--rounds', '900', '--seed', file, '--end', 'end-W', '--member', 'm-w', '--team', 'team-1', '--tool', 'seed:cap', '--no-heartbeat'])
  if (child.ready === null) return { error: 'the seeded child never came up: ' + show(child.lines.slice(0, 2)) }
  const timeoutMs = entry.timeoutMs ?? TIMEOUT
  const options = { now: NOW, timeoutMs, localEnd: 'end-A' }
  const decay = await ask(child.ready.port, '/api/foreign/decay', { end: 'end-C', ...options })
  const keys = await ask(child.ready.port, '/api/foreign/keys', options)
  const call = await ask(child.ready.port, '/api/foreign/call', { key: KEY, ...options })
  return { child, decay: decay.body, keys: keys.body, call: call.body }
}
{
  const issues = []
  const evidence = []
  for (const entry of worlds) {
    const timeoutMs = entry.timeoutMs ?? TIMEOUT
    const state = C.projectTeamState(entry.rows)
    const ours = {
      decay: C.effectiveCapabilities(state, 'end-C', NOW, { timeoutMs, localEnd: 'end-A' }),
      keys: C.brokerKeys(state, NOW, { timeoutMs, localEnd: 'end-A' }),
      call: C.brokerCall(state, KEY, NOW, { timeoutMs, localEnd: 'end-A' }),
    }
    const listed = ours.keys.map((row) => row.key).includes(KEY)
    if (show(ours.decay.missing) !== show(entry.expect.missing)) issues.push(entry.name + ': our decay answers ' + show(ours.decay.missing) + ', not ' + show(entry.expect.missing))
    if (listed !== entry.expect.listed) issues.push(entry.name + ': the key is ' + (listed ? 'listed' : 'not listed') + ' where it must be ' + (entry.expect.listed ? 'listed' : 'not listed'))
    if (ours.call.code !== entry.expect.code) issues.push(entry.name + ': our call answers ' + show(ours.call) + ', not ' + entry.expect.code)
    if (entry.expect.reason !== undefined) {
      if (ours.call.reason !== entry.expect.reason) issues.push(entry.name + ': the call reason is ' + show(ours.call.reason) + ', not ' + show(entry.expect.reason))
      if (listed === true) issues.push(entry.name + ': a key answered service-gone is still in the listing -- the pair is broken')
    }
    if (entry.expect.alsoListed !== undefined && ours.keys.map((row) => row.key).includes(entry.expect.alsoListed) !== true) issues.push(entry.name + ': the key that must appear instead, ' + entry.expect.alsoListed + ', is not listed: ' + show(ours.keys.map((row) => row.key)))
    const theirs = await foreignWorld(entry)
    if (theirs.error !== undefined) { issues.push(entry.name + ': ' + theirs.error); continue }
    evidence.push(entry.name + ': ours ' + show({ path: ours.decay.path, missing: ours.decay.missing, listed, code: ours.call.code, reason: ours.call.reason ?? null }))
    evidence.push(entry.name + ': theirs ' + show({ path: theirs.decay?.reading?.path ?? theirs.decay, missing: theirs.decay?.reading?.missing ?? null, keys: theirs.keys?.keys?.map((row) => row.key) ?? theirs.keys, code: theirs.call?.verdict?.code ?? theirs.call, reason: theirs.call?.verdict?.reason ?? null }))
    const theirDecay = theirs.decay?.reading ?? null
    const theirCall = theirs.call?.verdict ?? null
    if (theirDecay === null || theirCall === null) { issues.push(entry.name + ': the foreign end answered nothing usable: ' + show(theirs)); continue }
    if (show(theirDecay.missing) !== show(ours.decay.missing)) issues.push(entry.name + ': the foreign end answers missing ' + show(theirDecay.missing) + ' where we answer ' + show(ours.decay.missing))
    if (show(theirDecay.path) !== show(ours.decay.path)) issues.push(entry.name + ': the foreign end walks ' + show(theirDecay.path) + ' where we walk ' + show(ours.decay.path))
    if (show(theirDecay.capabilities) !== show(ours.decay.capabilities)) issues.push(entry.name + ': the foreign end keeps ' + show(theirDecay.capabilities) + ' where we keep ' + show(ours.decay.capabilities))
    if (theirCall.code !== ours.call.code) issues.push(entry.name + ': the foreign end answers ' + show(theirCall.code) + ' where we answer ' + show(ours.call.code))
    if (verdictOf(theirCall.code) === false) issues.push(entry.name + ': the foreign end answered a word outside the six')
    const theirListed = (theirs.keys?.keys ?? []).map((row) => row.key).includes(KEY)
    if (theirListed !== listed) issues.push(entry.name + ': the foreign end lists the key ' + (theirListed ? 'yes' : 'no') + ' where we say ' + (listed ? 'yes' : 'no'))
    if (entry.expect.alsoListed !== undefined && (theirs.keys?.keys ?? []).map((row) => row.key).includes(entry.expect.alsoListed) !== true) issues.push(entry.name + ': the foreign end does not list ' + entry.expect.alsoListed + ' either')
    if ((theirs.keys?.keys ?? []).some((row) => row.via === undefined)) issues.push(entry.name + ': a foreign key row carries no via')
  }
  if (issues.length > 0) add('R1-R3-two-implementations-one-table', false, issues.join('; '))
  else {
    add('R1-R3-two-implementations-one-table', true,
      'nine worlds, each read twice -- by the shipped fold on a records array and by a real foreign end holding the same rows: the whole road (listed, ok), a manifest row taken out of the array (NO_MANIFEST at end-B, unlisted, service-gone), the page own withdrawal, which is a WRITE of a smaller declaration (end-B drops read:db: unlisted, service-gone with reason meet:end-B, and remote:end-C:write:src appears in its place), a beat exactly at the threshold (PEER_SILENT at end-C, unlisted, service-gone) with its pair one millisecond under (listed, ok), a relay gone quiet (ROUTE_DOWN at end-B -- a different answer from PEER_SILENT, R59), no handshake (not-granted), nobody on that end declaring it (no-provider) and a provider out of reach (provider-silent). The two implementations agree on every path, every kept name and every verdict',
      evidence)
  }
}

// The boundary pair, stated as its own reading: the equal case is out, one millisecond more is in.
{
  const issues = []
  const atEdge = worldRows({ beatEndC: NOW - TIMEOUT })
  const out = C.effectiveCapabilities(C.projectTeamState(atEdge), 'end-C', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  const stillIn = C.effectiveCapabilities(C.projectTeamState(atEdge), 'end-C', NOW, { timeoutMs: TIMEOUT + 1, localEnd: 'end-A' })
  const unknown = C.effectiveCapabilities(C.projectTeamState(worldRows()), 'end-C', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-A' })
  if (show(out.missing) !== show([{ hop: 'end-C', code: 'PEER_SILENT' }])) issues.push('sinceMs >= timeoutMs does not read as out: ' + show(out.missing))
  if (stillIn.missing.length !== 0) issues.push('the same beat at timeoutMs = sinceMs + 1 reads ' + show(stillIn.missing) + '; the boundary is the equal case only')
  if (unknown.missing.length !== 0) issues.push('an end that never beat reads as silent: ' + show(unknown.missing))
  add('R4-the-silence-boundary-and-the-end-that-never-beat', issues.length === 0,
    issues.length === 0
      ? 'the equal case is out (sinceMs >= timeoutMs: PEER_SILENT at end-C), one millisecond more is in, and an end that never beat at all reads unknown, which is not silence (R40)'
      : issues.join('; '))
}

// =============================================================================================== G
// The closed sets, asked of a real foreign end: six verdicts, three break codes, TypeError otherwise.
{
  const issues = []
  const child = await foreignWorld(worlds[0])
  if (child.error !== undefined) add('G1-the-closed-sets', false, child.error)
  else {
    const guard = async (code) => await ask(child.child.ready.port, '/api/foreign/guard', { code })
    const accepted = []
    for (const code of VERDICTS) { const answer = await guard(code); if (answer.status !== 200 || answer.body?.code !== code) issues.push('the guard refused a code in the set: ' + show({ code, answer })); else accepted.push(code) }
    const refused = []
    for (const code of ['made-up', 'OK', 'unknown_tool', 'service_gone', '', null, 7]) {
      const answer = await guard(code)
      refused.push({ code, status: answer.status, error: answer.body?.error ?? null })
      if (answer.status !== 400 || answer.body?.error !== 'TypeError') issues.push('a code outside the closed set was not a TypeError: ' + show({ code, answer }))
    }
    const unknown = await ask(child.child.ready.port, '/api/foreign/call', { key: 'remote:end-Z:read:db', now: NOW, timeoutMs: TIMEOUT, localEnd: 'end-A' })
    if (unknown.body?.verdict?.code !== 'unknown-key') issues.push('a key no row ever offered answers ' + show(unknown.body))
    const badKey = await ask(child.child.ready.port, '/api/foreign/call', { key: 7, now: NOW, timeoutMs: TIMEOUT, localEnd: 'end-A' })
    if (badKey.status !== 400 || badKey.body?.error !== 'TypeError') issues.push('a key that is not a name answers ' + show(badKey))
    const noEnd = await ask(child.child.ready.port, '/api/foreign/call', { key: KEY, now: NOW, timeoutMs: TIMEOUT })
    if (noEnd.status !== 400 || noEnd.body?.error !== 'TypeError') issues.push('a call with no end asking answers ' + show(noEnd))
    add('G1-the-closed-sets-and-what-is-not-a-verdict', issues.length === 0,
      issues.length === 0
        ? 'a real foreign end accepts all six verdicts (' + accepted.join(', ') + ') and the three break codes, and raises TypeError for everything else (made-up, OK, unknown_tool, service_gone, the empty string, null, 7) -- it never invents a seventh word. unknown-key for a key no row ever offered; a key that is not a name and a call with no end asking raise TypeError'
        : issues.join('; '),
      ['refused probes: ' + show(refused)])
  }
}

// =============================================================================================== verdict
for (const child of children) { try { child.kill() } catch { /* already gone */ } }
server.close()
await logA.close()
if (KEEP !== true) rmSync(root, { recursive: true, force: true })
const failed = readings.filter((entry) => entry.ok !== true)
const holeNote = holes.length === 0 ? '' : '; ' + String(holes.length) + ' named hole(s): ' + holes.join(', ')
console.log(String(readings.length) + ' readings, ' + String(failed.length) + ' failed' + holeNote)
process.exit(failed.length > 0 ? 1 : (holes.length > 0 ? 3 : 0))
