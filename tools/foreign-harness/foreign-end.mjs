#!/usr/bin/env node
/**
 * A foreign end: a process that joins the DSH-LINK device net without installing DSH, cordis, or any of
 * our packages. It imports nothing from this repository. Everything it knows is what
 * docs/protocol/device-net-v1.md says: one HTTP route, one bearer token, a batch of records, and the
 * handful of record kinds a joining end has to write and read.
 *
 * It is the reference implementation of that page, and the counterpart the independent gate drives.
 * Run: node foreign-end.mjs --home <dir> --peer <url> --token <secret> --port 0 --member m-x --tool sum
 * It prints one JSON line when its route is up, and one JSON summary when it stops.
 *
 * R183 adds the three segments an end needs AFTER it is visible, written from the R183 sections of
 * that page and the frozen spellings in docs/handoff/R183-contract.md 3.1/3.2:
 *   1. it declares its capability manifest -- one `end/manifest` row, the six frozen fields, names the
 *      capability registry already holds (--manifest <cap,...>; a name nobody declared is refused with
 *      MANIFEST_CAPABILITY here, and only written when the caller asks this end to lie);
 *   2. it reads the decay along a path -- every hop on the via chain must carry the name, the answer is
 *      the intersection, and a break is named at the hop that broke it (NO_MANIFEST / PEER_SILENT /
 *      ROUTE_DOWN, and silence is sinceMs >= timeoutMs: the equal case is out);
 *   3. it answers a call through the key space `remote:<end>:<providerKey>` with one of the six frozen
 *      verdicts, and raises TypeError for anything outside that closed set. The keys are a reading of the
 *      ledger this end holds: this facade is the protocol's own key space, NOT the kernel's service
 *      broker and not an RPC provider -- no provider is injected, no key space of the kernel's is
 *      touched, and nothing here opens a socket to a provider.
 * The read side is this file's own implementation of those rules -- still no import of ours. It is
 * reachable over this end's own route (POST /api/foreign/{decay,keys,call,guard}, same bearer token),
 * and --seed <file.jsonl> hands the read side a world this end holds without having watched it arrive.
 * --lie capability|via|identity makes this end tell one of the three lies so an honest counterpart can
 * be measured answering it.
 */
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1] }
const has = (name) => argv.includes('--' + name)

const home = flag('home', '.')
const member = flag('member', 'm-foreign')
const team = flag('team', 'team-1')
const tool = flag('tool', 'sum')
const writer = flag('writer', 'foreign-end')
const peer = flag('peer', '')
const endName = flag('end', writer + '-end')
const viaEnd = flag('via', '')
const forward = flag('forward', '')
const naiveForward = has('naive-forward')
const beatEvery = Number(flag('beat-every', '0'))
// A harness may need this end's clock to be a value rather than "now": liveness is judged from the
// instant a record carries, so a reading about "a live transit behind a quiet member" can only be
// deterministic when the instants are chosen instead of waited for. Without --at the end uses its own
// clock, exactly as before.
const fixedAt = flag('at', '') === '' ? null : Number(flag('at', ''))
const stamp = () => fixedAt ?? Date.now()
const token = flag('token', '')
const port = Number(flag('port', '0'))
const rounds = Number(flag('rounds', '40'))
const TOOL_CAPABILITY = flag('capability', tool)
const PATH = '/api/dsh-link-collab/relay'
const LIMIT = 1_000_000

// --- R183: the three segments, and the switches a measurement needs -----------------------------
// The read face is this end's own route, not the page's relay route: it answers what this end reads
// from the records it holds. A caller names the instant and the threshold -- a reading never reads a
// clock (the same discipline the shipped fold keeps).
const DECAY_PATH = '/api/foreign/decay'
const KEYS_PATH = '/api/foreign/keys'
const CALL_PATH = '/api/foreign/call'
const GUARD_PATH = '/api/foreign/guard'
/** The six verdicts a key space has. A seventh would be a word this protocol does not have. */
const OPEN_VERDICTS = ['ok', 'unknown-key', 'no-provider', 'provider-silent', 'not-granted', 'service-gone']
/** The three ways a road breaks, each named at the hop that broke it. */
const MISS_CODES = ['NO_MANIFEST', 'PEER_SILENT', 'ROUTE_DOWN']
/** The manifest versions this build speaks; a row that names another one is refused with this list. */
const MANIFEST_PROTOCOLS = ['dsh-link-device/1']
const manifestCaps = flag('manifest', '') === '' ? [] : flag('manifest', '').split(',').map((name) => name.trim()).filter((name) => name !== '')
const manifestPlatform = flag('manifest-platform', 'foreign-harness')
const manifestVersion = flag('manifest-version', 'dsh-link-device/1')
const manifestVia = flag('manifest-via', '') === '' ? (viaEnd === '' ? null : viaEnd) : flag('manifest-via', '')
const manifestEnd = flag('manifest-end', endName)
const lie = flag('lie', '')
const lieCapability = flag('lie-capability', 'ghost:cap')
const lieVictim = flag('lie-victim', 'end-C')
const lieVia = flag('lie-via', endName)
const lieAs = flag('lie-as', 'end-A')
const lieAsThird = flag('lie-as-third', 'end-F')
const lieInstance = flag('lie-instance', 'forged-' + randomUUID())
const seedPath = flag('seed', '')

if (token === '') { console.error('foreign-end: --token is required'); process.exit(2) }
mkdirSync(home, { recursive: true })
const instancePath = join(home, 'instance')
const instance = existsSync(instancePath) ? readFileSync(instancePath, 'utf8').trim() : randomUUID()
writeFileSync(instancePath, instance + '\n')
const logPath = join(home, 'log.jsonl')
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.equals(y) }

/** This end's own ledger: a file of lines, and the fact that `seq` counts only its own records. */
const own = []
/**
 * Everything this end holds, numbered by the position each record occupies in THIS end's log -- what it
 * wrote itself and what a peer relayed to it, in the order they became facts here. That is the order
 * the page's high-water-mark discipline gives them, and it is the only ledger the read side below
 * folds. `originWriter`/`originInstance` keep the batch header a relayed row arrived under: an end
 * that wrote a row about somebody else is visible as such instead of being taken for that somebody.
 */
const held = []
const hold = (row, originWriter, originInstance) => {
  held.push({ seq: held.length + 1, at: row.at, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, originWriter, originInstance })
}
const append = (record) => {
  const seq = own.length + 1
  const row = { seq, at: stamp(), ...record }
  own.push(row)
  hold(row, writer, instance)
  appendFileSync(logPath, JSON.stringify(row) + '\n')
  return row
}
const accepted = []
const marks = new Map()
const onWire = (record) => record.kind === 'task/dispatch' || record.kind === 'task/result'

const answer = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }

/** The server half: the rules on this page, implemented by a process that shares no code with our end. */
const ingest = (batch) => {
  if (batch === null || typeof batch !== 'object') return { status: 400, code: 'RELAY_MALFORMED' }
  const { writer: from, instance: theirs, records } = batch
  if (typeof from !== 'string' || from === '' || typeof theirs !== 'string' || theirs === '') return { status: 400, code: 'RELAY_WRITER_MISSING' }
  if (from === writer && theirs !== instance) return { status: 400, code: 'RELAY_IMPERSONATION' }
  if (!Array.isArray(records)) return { status: 400, code: 'RELAY_MALFORMED' }
  // A peer with nothing new to hand over is an ordinary condition, not a reason to fall over: the
  // shipped endpoint answers an empty batch with appended 0, and this one answers the same way.
  if (records.length === 0) return { status: 200, body: { ok: true, appended: 0, skipped: 0 } }
  const seqs = new Set()
  for (const row of records) {
    if (!Number.isInteger(row?.seq) || row.seq <= 0 || seqs.has(row.seq)) return { status: 400, code: 'RELAY_MALFORMED' }
    seqs.add(row.seq)
  }
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  const known = marks.get(from)
  if (known !== undefined && known.instance !== theirs) return { status: 400, code: 'RELAY_REWRITTEN' }
  const high = known?.high ?? 0
  if (ordered[0].seq > high + 1) return { status: 400, code: 'RELAY_GAP' }
  let expected = high + 1
  let appended = 0
  let skipped = 0
  for (const row of ordered) {
    if (row.seq <= high) { skipped += 1; continue }
    if (row.seq !== expected) return { status: 400, code: 'RELAY_HOLE' }
    expected += 1
    accepted.push({ ...row, originWriter: from, originInstance: theirs })
    hold(row, from, theirs)
    if (onWire(row)) console.log(JSON.stringify({ wire: 'in', kind: row.kind, id: row.payload?.id ?? null }))
    appended += 1
  }
  marks.set(from, { instance: theirs, high: expected - 1 })
  return { status: 200, body: { ok: true, appended, skipped } }
}

const server = createServer(async (req, res) => {
  const authorization = req.headers.authorization
  const presented = typeof authorization === 'string' && /^bearer[ \t]+/i.test(authorization) ? authorization.replace(/^bearer[ \t]+/i, '') : null
  if (presented === null || !same(presented, token)) return answer(res, 401, { ok: false, code: 'UNAUTHORIZED' })
  if (req.method !== 'POST') return answer(res, 405, { ok: false, code: 'METHOD' })
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return answer(res, 415, { ok: false, code: 'CONTENT_TYPE' })
  const chunks = []
  let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > LIMIT) { res.setHeader('connection', 'close'); return answer(res, 413, { ok: false, code: 'TOO_LARGE' }) } chunks.push(chunk) }
  let batch
  try { batch = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return answer(res, 400, { ok: false, code: 'RELAY_MALFORMED', error: 'the body is not JSON' }) }
  // R183: this end's own read face, beside the relay route. Same bearer token, same method and body
  // rules; it answers from the records this end holds and never writes anything.
  const asked = String(req.url ?? '')
  if (asked === DECAY_PATH || asked === KEYS_PATH || asked === CALL_PATH || asked === GUARD_PATH) {
    const outcome = readFace(asked, batch)
    if (outcome.error !== undefined) return answer(res, 400, { ok: false, error: outcome.error, message: outcome.message })
    return answer(res, 200, { ok: true, ...outcome.body })
  }
  const verdict = ingest(batch)
  if (verdict.status !== 200) return answer(res, verdict.status, { ok: false, code: verdict.code })
  return answer(res, 200, verdict.body)
})

/** The client half: hand our own records over, and read the answer. */
let sentUpTo = 0
/**
 * A peer that is not up yet, or has just gone away, is an ordinary condition on a device net, not a
 * crash: both senders below report the failure as an answer and try again on the next tick, which is
 * also why this process can be started before the ends it talks to.
 */
const push = async () => {
  if (peer === '') return null
  const outbound = own.filter((row) => row.seq > sentUpTo)
  if (outbound.length === 0) return null
  const reply = await send(peer, { writer, instance, records: outbound })
  if (reply.status === 200) sentUpTo = outbound[outbound.length - 1].seq
  return reply
}

/**
 * The transit half: hand a peer's records on, regrouped by the log that produced them.
 *
 * `ownPage()` is a one-hop export — it names this end's own work and nothing a peer sent — so a
 * middle hop that forwards its own page forwards nothing of the peer's work (the multihop gate
 * measures exactly that). Regrouping by (origin writer, origin instance) makes every hop look like a
 * first hop, which is what the receiving end's high-water marks expect. `--naive-forward` sends the
 * own page instead, so a reading can show the regrouping is load-bearing rather than decorative.
 */
const FORWARD_TARGETS = forward === '' ? [] : forward.split(',').map((url) => url.trim()).filter((url) => url !== '')
const forwarded = new Map()
const send = async (url, batch) => {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    return { status: 0, body: { ok: false, code: 'NETWORK', error: String(error?.cause?.code ?? error?.message ?? error) } }
  }
  return { status: response.status, body: await response.json().catch(() => null) }
}
const forwardHeld = async () => {
  if (FORWARD_TARGETS.length === 0) return null
  if (naiveForward) {
    const replies = []
    for (const target of FORWARD_TARGETS) {
      const reply = await send(target, { writer, instance, records: own })
      replies.push({ to: target, origin: writer, sent: own.length, status: reply.status, code: reply.body?.code ?? null })
    }
    return replies
  }
  const groups = new Map()
  for (const row of accepted) {
    const key = row.originWriter + '\u0000' + row.originInstance
    const group = groups.get(key) ?? { writer: row.originWriter, instance: row.originInstance, records: [] }
    group.records.push({ seq: row.seq, kind: row.kind, ...(row.actor === undefined ? {} : { actor: row.actor }), ...(row.subject === undefined ? {} : { subject: row.subject }), ...(row.payload === undefined ? {} : { payload: row.payload }), at: row.at })
    groups.set(key, group)
  }
  const results = []
  for (const target of FORWARD_TARGETS) {
    for (const [key, group] of groups) {
      const mark = target + '\u0000' + key
      const since = forwarded.get(mark) ?? 0
      const outbound = group.records.filter((row) => row.seq > since).sort((a, b) => a.seq - b.seq)
      if (outbound.length === 0) continue
      const reply = await send(target, { writer: group.writer, instance: group.instance, records: outbound })
      // `RELAY_IMPERSONATION` counts as delivered: those records carry the target's own writer name,
      // which means the target already produced them — the refusal is the rule working, not a loss,
      // and retrying it forever would make a transit's log unreadable.
      const code = reply.body?.code ?? null
      if (reply.status === 200 || code === 'RELAY_IMPERSONATION') forwarded.set(mark, outbound[outbound.length - 1].seq)
      results.push({ to: target, origin: group.writer, sent: outbound.length, status: reply.status, code })
    }
  }
  return results
}

// ------------------------------------------------------------------------------------------------
// R183, segments two and three: reading the ledger this end holds.
//
// These folds are this file's own implementation of the page's rules. Nothing below imports anything
// of ours, and nothing below reads a clock: `now` and `timeoutMs` are arguments, exactly as the
// shipped fold takes them, because "is that end silent" has no answer without an instant.
const nameOf = (value) => (typeof value === 'string' && value !== '' ? value : null)
const heldOrdered = () => [...held].sort((left, right) => left.seq - right.seq)

/** The capability registry: the names this end has been told are capabilities. It is the authority. */
const foldRegistry = () => {
  const members = new Map()
  for (const record of heldOrdered()) {
    if (record.kind !== 'capability/state') continue
    const id = nameOf(record.payload?.id) ?? nameOf(record.subject)
    if (id === null) continue
    const listed = Array.isArray(record.payload?.capabilities)
      ? record.payload.capabilities.filter((entry) => nameOf(entry) !== null)
      : (nameOf(record.payload?.capability) === null ? [] : [record.payload.capability])
    const replace = Array.isArray(record.payload?.capabilities)
    const previous = members.get(id) ?? []
    members.set(id, [...new Set(replace ? listed : [...previous, ...listed])])
  }
  const byCapability = new Map()
  for (const [id, capabilities] of members) for (const capability of capabilities) byCapability.set(capability, [...(byCapability.get(capability) ?? []), id])
  return { members, byCapability, names: new Set(byCapability.keys()) }
}

/** The members, folded from member/state rows: who is on this bus at all. */
const foldMembers = () => {
  const members = new Map()
  for (const record of heldOrdered()) {
    if (record.kind !== 'member/state') continue
    const id = nameOf(record.payload?.id) ?? nameOf(record.subject)
    if (id === null) continue
    members.set(id, { id, at: record.seq })
  }
  return members
}

/**
 * The end/manifest fold, in the shape the shipped fold answers with: `declared` is what the row said,
 * exactly the words it carried; `capabilities` is what the registry recognises of them; and a row
 * carrying a name nobody ever declared is counted in `malformed` while the end stays visible. An
 * unreadable name is never quietly read as "this end does not have it".
 */
const foldManifests = () => {
  const known = foldRegistry().names
  const ends = new Map()
  let malformed = 0
  for (const record of heldOrdered()) {
    if (record.kind !== 'end/manifest') continue
    const payload = record.payload ?? {}
    const end = nameOf(payload.end) ?? nameOf(record.subject)
    const platform = nameOf(payload.platform)
    const protocolVersion = nameOf(payload.protocolVersion)
    const at = payload.at
    const rawVia = payload.via
    const via = rawVia === null || rawVia === undefined ? null : nameOf(rawVia)
    if (end === null || platform === null || protocolVersion === null || typeof at !== 'number' || !Number.isFinite(at) || (rawVia !== null && rawVia !== undefined && via === null)) { malformed += 1; continue }
    const listed = Array.isArray(payload.capabilities) ? payload.capabilities.filter((entry) => nameOf(entry) !== null) : []
    const declared = [...new Set(listed)].sort()
    const capabilities = declared.filter((entry) => known.has(entry))
    if (capabilities.length !== declared.length) malformed += 1
    ends.set(end, { end, via, platform, protocolVersion, capabilities, declared, at, seq: record.seq, originWriter: record.originWriter ?? null })
  }
  return { ends, malformed }
}

/** Who is on which end (member/host), and who is still beating (member/heartbeat). */
const foldHosts = () => {
  const hosts = new Map()
  for (const record of heldOrdered()) {
    if (record.kind !== 'member/host') continue
    const id = nameOf(record.payload?.id) ?? nameOf(record.subject)
    const end = nameOf(record.payload?.end)
    const at = record.payload?.at
    if (id === null || end === null || typeof at !== 'number' || !Number.isFinite(at)) continue
    const via = nameOf(record.payload?.via)
    const previous = hosts.get(id)
    if (previous !== undefined && !(at > previous.at || (at === previous.at && record.seq > previous.seq))) continue
    hosts.set(id, { id, end, via, at, seq: record.seq })
  }
  const beats = new Map()
  for (const record of heldOrdered()) {
    if (record.kind !== 'member/heartbeat') continue
    const id = nameOf(record.payload?.id) ?? nameOf(record.subject)
    if (id === null || typeof record.payload?.at !== 'number' || !Number.isFinite(record.payload.at)) continue
    beats.set(id, record.payload.at)
  }
  return { hosts, beats }
}

/** The lead handshakes (peer/state): whether two ends were ever granted an exchange, in that direction. */
const foldPeers = () => {
  const pairs = new Map()
  for (const record of heldOrdered()) {
    if (record.kind !== 'peer/state') continue
    const from = nameOf(record.payload?.from)
    const to = nameOf(record.payload?.to)
    const state = record.payload?.state
    if (from === null || to === null || !['requested', 'granted', 'denied'].includes(state)) continue
    pairs.set(from + '->' + to, { from, to, state, seq: record.seq })
  }
  return pairs
}

/** Silence: a member that never beat reads unknown, which is NOT silence (R40). The equal case is out. */
const beatLiveness = (beats, memberId, now, timeoutMs) => {
  const last = beats.get(memberId)
  if (last === undefined) return 'unknown'
  return now - last >= timeoutMs ? 'unhealthy' : 'healthy'
}
const representativeOf = (hosts, end, exclude) => {
  const candidates = [...hosts.values()].filter((row) => (row.id === end || row.end === end) && row.id !== exclude).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return candidates.find((row) => row.id === end) ?? candidates[0] ?? null
}

/** The one generator of a key in this file; everywhere else a key is matched as a whole string. */
const brokerKeyOf = (end, providerKey) => 'remote:' + end + ':' + providerKey

/** A verdict outside the closed set is not a verdict: it is a word this protocol does not have. */
const assertVerdict = (code) => {
  if (!OPEN_VERDICTS.includes(code)) throw new TypeError('brokerCall: ' + JSON.stringify(code) + ' is not one of the six answers this key space has; the closed set is ' + OPEN_VERDICTS.join(', '))
  return code
}
const assertMissCode = (code) => {
  if (!MISS_CODES.includes(code)) throw new TypeError('effectiveCapabilities: ' + JSON.stringify(code) + ' is not one of the three ways a road breaks; the closed set is ' + MISS_CODES.join(', '))
  return code
}

/**
 * The decay along a path: walk the via chain one hop at a time from `end` back to the end asking, and
 * answer the INTERSECTION of the hops' capabilities -- so a smaller directory further out shrinks what
 * arrives here. Every hop must have a manifest; a hop that never declared one stops the road there
 * (NO_MANIFEST), a whole road whose far end went quiet is PEER_SILENT, and a relay on the way that
 * went quiet is ROUTE_DOWN. The last two stay two answers (R59), and the path always stops at the
 * break it names.
 */
const effectiveCapabilities = (end, now, options) => {
  if (typeof end !== 'string' || end === '') throw new TypeError('effectiveCapabilities: end must be a non-empty string')
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('effectiveCapabilities: now must be a finite number of milliseconds')
  const timeoutMs = options?.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('effectiveCapabilities: timeoutMs must be a finite number of milliseconds and not negative')
  const local = nameOf(options?.localEnd ?? null)
  const folded = foldManifests()
  const { hosts, beats } = foldHosts()
  const chain = []
  const seen = new Set()
  let cursor = end
  while (cursor !== null) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    chain.push(cursor)
    if (local !== null && cursor === local) break
    const row = folded.ends.get(cursor)
    if (row === undefined) break
    cursor = row.via
  }
  const arrived = chain[chain.length - 1]
  if (local !== null && arrived !== undefined && arrived !== local && folded.ends.get(arrived)?.via === null) chain.push(local)
  const missing = []
  const walked = []
  const reached = []
  for (const hop of [...chain].reverse()) {
    walked.push(hop)
    const row = folded.ends.get(hop)
    if (row === undefined) { missing.push({ hop, code: assertMissCode('NO_MANIFEST') }); break }
    reached.push(row)
    const representative = representativeOf(hosts, hop, null)
    if (representative !== null && beatLiveness(beats, representative.id, now, timeoutMs) === 'unhealthy') {
      missing.push({ hop, code: assertMissCode(hop === end ? 'PEER_SILENT' : 'ROUTE_DOWN') })
      break
    }
  }
  const capabilities = []
  if (missing.length === 0 && reached.length > 0) {
    for (const candidate of reached[reached.length - 1].capabilities) {
      if (reached.every((row) => row.capabilities.includes(candidate))) capabilities.push(candidate)
    }
    capabilities.sort()
  }
  return { end, path: walked, capabilities, missing, through: held.length }
}

/** One member's road back to the end asking; null when there is no road at all. */
const routeTo = (member, localEnd, hosts, beats, now, timeoutMs) => {
  const host = hosts.get(member) ?? null
  const memberEnd = host === null ? localEnd : host.end
  if (memberEnd === localEnd) return { path: [localEnd], failure: null }
  const chain = [memberEnd]
  const seen = new Set([memberEnd])
  let via = host === null ? null : host.via
  for (;;) {
    const next = via === null ? localEnd : via
    if (next === localEnd) break
    if (seen.has(next)) return { path: [localEnd, ...[...chain].reverse()], failure: { reason: 'path-cycle' } }
    const representative = representativeOf(hosts, next, member)
    if (representative === null) return { path: [localEnd, ...[...chain].reverse(), next], failure: { reason: 'no-route' } }
    chain.push(next)
    seen.add(next)
    via = representative.via
  }
  const path = [localEnd, ...[...chain].reverse()]
  for (const hop of chain) {
    const representative = representativeOf(hosts, hop, member)
    if (representative === null) continue
    if (beatLiveness(beats, representative.id, now, timeoutMs) !== 'unhealthy') continue
    return { path: path.slice(0, path.indexOf(hop) + 1), failure: { reason: 'route-down' } }
  }
  return { path, failure: null }
}

/** Whether the provider on the far end is answering and this end can reach it. */
const providerVerdict = (providerKey, now, options) => {
  const registry = foldRegistry()
  const declaredBy = registry.byCapability.get(providerKey) ?? []
  if (declaredBy.length === 0) return 'unknown-tool'
  const { hosts, beats } = foldHosts()
  const healthy = declaredBy.filter((id) => beatLiveness(beats, id, now, options.timeoutMs) === 'healthy')
  if (healthy.length === 0) return 'no-provider'
  const reachable = new Set()
  for (const id of foldMembers().keys()) {
    if (routeTo(id, options.localEnd, hosts, beats, now, options.timeoutMs).failure === null) reachable.add(id)
  }
  if (!healthy.some((id) => reachable.has(id))) return 'provider-silent'
  return 'ok'
}

/** The key space: one row per capability that survived a whole road, this end's own end excluded. */
const brokerKeysOf = (now, options) => {
  const local = nameOf(options?.localEnd ?? null)
  const rows = []
  const ends = [...foldManifests().ends.values()].sort((left, right) => (left.end < right.end ? -1 : left.end > right.end ? 1 : 0))
  for (const manifest of ends) {
    if (local !== null && manifest.end === local) continue
    const reading = effectiveCapabilities(manifest.end, now, options)
    if (reading.missing.length > 0) continue
    if (reading.capabilities.length === 0) continue
    for (const providerKey of reading.capabilities) {
      rows.push({ key: brokerKeyOf(manifest.end, providerKey), end: manifest.end, providerKey, via: manifest.via, capabilities: reading.capabilities })
    }
  }
  return rows.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/**
 * One call through the key space. The precedence is fixed and total -- unknown-key, service-gone,
 * not-granted, no-provider, provider-silent, ok -- and every answer is one of those six words, never a
 * seventh. A key is matched as a whole string: names may contain the separator.
 */
const brokerCallOf = (key, now, options) => {
  if (typeof key !== 'string' || key === '') throw new TypeError('brokerCall: key must be a non-empty string, as brokerKeys spelled it')
  const local = nameOf(options?.localEnd ?? null)
  if (local === null) throw new TypeError('brokerCall: localEnd must name the end asking; "may this end call that one" has no answer without it')
  const folded = foldManifests()
  const offered = new Map()
  for (const manifest of folded.ends.values()) for (const providerKey of manifest.declared) offered.set(brokerKeyOf(manifest.end, providerKey), { end: manifest.end, providerKey })
  const hit = offered.get(key)
  if (hit === undefined) return { code: assertVerdict('unknown-key'), key, end: null, providerKey: null }
  const reading = effectiveCapabilities(hit.end, now, { timeoutMs: options.timeoutMs, localEnd: local })
  if (reading.missing.length > 0) return { code: assertVerdict('service-gone'), key, end: hit.end, providerKey: hit.providerKey, reason: reading.missing[0].code }
  if (!reading.capabilities.includes(hit.providerKey)) {
    const lost = reading.path.find((hop) => (folded.ends.get(hop)?.capabilities ?? []).includes(hit.providerKey) === false) ?? hit.end
    return { code: assertVerdict('service-gone'), key, end: hit.end, providerKey: hit.providerKey, reason: 'meet:' + lost }
  }
  if (foldPeers().get(local + '->' + hit.end)?.state !== 'granted') return { code: assertVerdict('not-granted'), key, end: hit.end, providerKey: hit.providerKey }
  const hosts = foldHosts().hosts
  const onEnd = (foldRegistry().byCapability.get(hit.providerKey) ?? []).filter((id) => (hosts.get(id)?.end ?? null) === hit.end)
  if (onEnd.length === 0) return { code: assertVerdict('no-provider'), key, end: hit.end, providerKey: hit.providerKey }
  const provider = providerVerdict(hit.providerKey, now, { timeoutMs: options.timeoutMs, localEnd: local })
  if (provider === 'ok') return { code: assertVerdict('ok'), key, end: hit.end, providerKey: hit.providerKey }
  if (provider === 'provider-silent') return { code: assertVerdict('provider-silent'), key, end: hit.end, providerKey: hit.providerKey }
  return { code: assertVerdict('no-provider'), key, end: hit.end, providerKey: hit.providerKey }
}

/**
 * The read face, over this end's own route. A caller that asks something these rules cannot answer
 * gets a TypeError back with the name TypeError on it -- never a made-up verdict.
 */
const readFace = (route, body) => {
  try {
    const mine = body?.localEnd === undefined || body?.localEnd === null ? (endName === '' ? null : endName) : body.localEnd
    // A call must name the end asking: "may this end call that one" has no answer without it, and the
    // shipped function raises rather than guessing. A reading of the road may default to this end.
    if (route === DECAY_PATH) return { body: { reading: effectiveCapabilities(body?.end, body?.now, { timeoutMs: body?.timeoutMs, localEnd: mine }), held: held.length } }
    if (route === KEYS_PATH) return { body: { keys: brokerKeysOf(body?.now, { timeoutMs: body?.timeoutMs, localEnd: mine }) } }
    if (route === CALL_PATH) return { body: { verdict: brokerCallOf(body?.key, body?.now, { timeoutMs: body?.timeoutMs, localEnd: body?.localEnd ?? null }) } }
    if (route === GUARD_PATH) return { body: { code: assertVerdict(body?.code), closed: OPEN_VERDICTS, miss: MISS_CODES } }
    return { error: 'TypeError', message: 'readFace: ' + JSON.stringify(String(route)) + ' is not a route this end reads' }
  } catch (error) {
    return { error: error instanceof TypeError ? 'TypeError' : String(error?.name ?? 'Error'), message: String(error?.message ?? error) }
  }
}

/**
 * A world this end holds but did not watch arrive: the harness's way of pointing the read side at
 * chosen facts (the same kind of affordance --at already is). Every row keeps the writer and instance
 * it claims, so a row one end wrote about another stays visible as exactly that.
 */
const loadSeed = (file) => {
  let loaded = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const row = JSON.parse(line)
    hold(row, nameOf(row.writer) ?? flag('seed-writer', 'seed-1'), nameOf(row.instance) ?? 'seed-instance-1')
    loaded += 1
  }
  return loaded
}
const run = async () => {
  append({ kind: 'member/state', actor: team, subject: member, payload: { id: member, name: member, state: 'active', role: 'member' } })
  append({ kind: 'capability/state', actor: team, subject: member, payload: { id: member, capabilities: [TOOL_CAPABILITY] } })
  append({ kind: 'member/host', actor: team, subject: member, payload: { id: member, end: endName, via: viaEnd === '' ? null : viaEnd, at: stamp() } })
  if (!has('no-heartbeat')) append({ kind: 'member/heartbeat', actor: team, subject: member, payload: { id: member, at: stamp() } })
  // R183 segment one: declare the capability manifest -- one `end/manifest` row, the six frozen fields.
  // The names have to be ones the capability registry already holds: this end checks its own claim
  // against the registry it can see and refuses it under the same name the shipped admission uses,
  // unless the caller asked this end to lie. --seed hands the read side a world it holds but did not
  // watch arrive (the harness's affordance, like --at; the writers each row claims are kept as claimed).
  if (seedPath !== '') console.log(JSON.stringify({ seed: { file: seedPath, loaded: loadSeed(seedPath), held: held.length } }))
  const ownManifest = { end: manifestEnd, via: manifestVia, platform: manifestPlatform, protocolVersion: manifestVersion, capabilities: [...new Set(manifestCaps)].sort(), at: stamp() }
  const undeclared = ownManifest.capabilities.filter((name) => name !== TOOL_CAPABILITY && !foldRegistry().names.has(name))
  /**
   * The rules a writer of this row has to keep, checked here before anything is appended, and named the
   * way the page names them: an end that writes a bad row gets the refusal, not a row. The caller can
   * ask this end to lie (--lie capability|via), and then the check is stepped over on purpose: a lie
   * that could not be told would leave nothing for an honest counterpart to refuse.
   */
  const manifestRefusalOf = () => {
    if (nameOf(manifestEnd) === null) return { code: 'MANIFEST_END', detail: 'end is required and must be a non-empty name' }
    if (manifestVia !== null && nameOf(manifestVia) === null) return { code: 'MANIFEST_VIA', detail: 'via must be null or a non-empty end name' }
    if (manifestVia !== null && manifestVia === manifestEnd) return { code: 'MANIFEST_VIA', detail: 'via names the end itself; a hop towards nowhere is not a shorter path, use null when it is this end' }
    if (nameOf(manifestPlatform) === null) return { code: 'MANIFEST_PLATFORM', detail: 'platform is required and must be a non-empty string' }
    if (!MANIFEST_PROTOCOLS.includes(manifestVersion)) return { code: 'MANIFEST_VERSION', detail: 'protocolVersion ' + JSON.stringify(manifestVersion) + ' is not one this build speaks', supported: MANIFEST_PROTOCOLS }
    if (ownManifest.capabilities.length === 0) return { code: 'MANIFEST_CAPABILITY', detail: 'capabilities must be a non-empty array of names' }
    if (undeclared.length > 0) return { code: 'MANIFEST_CAPABILITY', detail: 'these names are not in the capability registry, so no end can be read as offering them', names: undeclared, registry: [...foldRegistry().names].sort() }
    if (Number.isFinite(ownManifest.at) !== true) return { code: 'MANIFEST_AT', detail: 'at must be a finite number of milliseconds' }
    return null
  }
  const manifestRows = []
  const refused = (code, detail) => console.log(JSON.stringify({ manifest: { lie: lie === '' ? null : lie, refused: code, detail } }))
  const writeOwnManifest = () => manifestRows.push(append({ kind: 'end/manifest', actor: ownManifest.end, subject: ownManifest.end, payload: ownManifest }))
  if (lie === 'via') {
    if (manifestCaps.length > 0) writeOwnManifest()
    const victim = { end: lieVictim, via: lieVia, platform: manifestPlatform, protocolVersion: manifestVersion, capabilities: [...new Set([TOOL_CAPABILITY])].sort(), at: stamp() }
    manifestRows.push(append({ kind: 'end/manifest', actor: victim.end, subject: victim.end, payload: victim }))
    console.log(JSON.stringify({ manifest: { lie: 'via', refused: null, speaker: ownManifest.end, row: manifestRows[manifestRows.length - 1] } }))
  } else if (lie === 'capability') {
    const lying = { ...ownManifest, capabilities: [...new Set([lieCapability])].sort() }
    manifestRows.push(append({ kind: 'end/manifest', actor: lying.end, subject: lying.end, payload: lying }))
    console.log(JSON.stringify({ manifest: { lie: 'capability', refused: null, uncontested: undeclared, row: manifestRows[manifestRows.length - 1] } }))
  } else if (manifestCaps.length > 0) {
    const refusal = manifestRefusalOf()
    if (refusal !== null) refused(refusal.code, refusal.detail)
    else {
      writeOwnManifest()
      console.log(JSON.stringify({ manifest: { lie: null, refused: null, row: manifestRows[manifestRows.length - 1] } }))
    }
  }
  // R70: an end that knows nothing about leases writes its own attempt, so the protocol page's promise
  // about such an end is witnessed by a foreign process rather than by our own log. The page says: in a
  // world with no lease the attempt is admitted, and while another end holds a live lease the same
  // attempt is refused as 'lease-mismatch' - visibly, not dropped. --attempt-actor names the end this
  // attempt is attributed to (defaults to this member), because that is what the owner rule compares.
  const attempt = flag('attempt', '')
  if (attempt !== '') {
    const attemptRoot = flag('attempt-root', attempt.split('#r')[0])
    const attemptActor = flag('attempt-actor', member)
    const attemptNumber = Number((/#r(\d+)$/.exec(attempt) ?? [])[1] ?? 1)
    append({
      kind: 'task/dispatch',
      actor: attemptActor,
      subject: attempt,
      payload: { id: attempt, to: flag('attempt-to', member), tool: TOOL_CAPABILITY, args: {}, at: stamp(), retryOf: attemptRoot, attempt: attemptNumber },
    })
  }

  // R183: the third lie -- claiming to be somebody else on the wire. A batch header is a claim, and the
  // answers below are the honest end's receipts for it: its own name first (the pair), then the name of
  // the end it is talking to, then the name of a third end the receiver already knows under another
  // instance. Each attempt says which identity it claimed, so a reading can quote it rather than guess.
  const lies = []
  let reached = null
  if (lie === 'identity') {
    const page = own.map((row) => ({ seq: row.seq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))
    const attempts = [
      { attempt: 'own-name', claimed: writer, claimedInstance: instance },
      { attempt: 'receiver-own-name', claimed: lieAs, claimedInstance: lieInstance },
      { attempt: 'another-end-name', claimed: lieAsThird, claimedInstance: lieInstance },
    ]
    for (const one of attempts) {
      const reply = await send(peer, { writer: one.claimed, instance: one.claimedInstance, records: page })
      lies.push({ ...one, sent: page.length, status: reply.status, code: reply.body?.code ?? null, appended: reply.body?.appended ?? null })
      if (one.attempt === 'own-name') { reached = { status: reply.status, body: reply.body }; if (reply.status === 200) sentUpTo = page[page.length - 1].seq }
    }
  } else {
    reached = await push()
  }
  console.log(JSON.stringify({ ready: true, port: server.address().port, instance, reached, manifest: manifestRows, lies }))

  let lastBeat = stamp()
  const executed = []
  const seen = new Set()
  for (let tick = 0; tick < rounds; tick += 1) {
    const pending = accepted
      .filter((row) => row.kind === 'task/dispatch')
      .filter((row) => row.payload?.to === member)
      .filter((row) => !seen.has(row.payload?.id))
    for (const row of pending) {
      seen.add(row.payload.id)
      const wanted = row.payload.tool
      if (wanted !== TOOL_CAPABILITY) continue
      const value = wanted === 'sum'
        ? { sum: Number(row.payload.args?.a ?? 0) + Number(row.payload.args?.b ?? 0) }
        : { echoed: row.payload.args }
      executed.push(row.payload.id)
      append({ kind: 'task/result', actor: team, subject: row.payload.id, payload: { id: row.payload.id, from: flag('spoof-from', member), ok: true, value, at: Date.now() } })
    }
    if (beatEvery > 0 && stamp() - lastBeat >= beatEvery) { lastBeat = stamp(); append({ kind: 'member/heartbeat', actor: team, subject: member, payload: { id: member, at: lastBeat } }) }
    await push()
    const forwardedNow = await forwardHeld()
    if (forwardedNow !== null) console.log(JSON.stringify({ wire: 'forward', sent: forwardedNow }))
    if (has('die-after-dispatch') && executed.length > 0) { console.log(JSON.stringify({ dying: true, executed })); process.exit(7) }
    await new Promise((settle) => setTimeout(settle, 60))
  }
  console.log(JSON.stringify({ done: true, ownSeq: own.length, end: endName, executed, ingested: accepted.map((row) => row.kind), forwarded: [...forwarded.entries()], manifest: manifestRows, lies, held: held.length }))
  server.close()
  process.exit(0)
}

server.listen(port, '127.0.0.1', () => { run().catch((error) => { console.error('foreign-end: ' + String(error)); process.exit(1) }) })
