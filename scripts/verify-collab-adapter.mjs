#!/usr/bin/env node
/**
 * R45 (task-85): the ADMISSION face for other platforms — an agent from elsewhere enters this bus only
 * through a declared adapter, on a protocol version we support, offering only capabilities the registry
 * actually holds. Contract: .tmp/r45-contract.md (section 7 lists the readings). Shape authority: the built
 * module plugins/dsh-link-collab/lib/index.js, never src.
 *
 * Every expected value is computed HERE from the records and the clock handed in: SUPPORTED below is the
 * contract's literal list (section 2), the capability sets are the ones the fixtures declare, and the
 * liveness/reachability expectations are this gate's own reading of the healthy/unknown rule and of R44's
 * host facts. This gate runs NO other gate (the suite owns that sweep).
 *
 *   1 an undeclared adapter is refused, and the supported list still comes back  [R4, S7.1]
 *   2 a protocol version we do not know is refused, request side and declaration side, supported as-is  [R1/R4/R6, S7.2]
 *   3 declared, supported and offered == registry -> ok, and offers are sorted and deduplicated  [S1/S7.3]
 *   4 the registry is the authority: a self-claimed capability the ledger lacks is a mismatch (refused),
 *     a registry capability the adapter did not claim is extra (reported, still ok)  [R5, S7.4]
 *   5 an empty platform is its own reason, and malformed declarations stay visible (id null when unreadable)  [R3/R4, S7.5]
 *   6 two declarations for one id: foldClaim decides, both arrival orders are byte-identical, the loser is listed  [R2, S7.6]
 *   7 mcpInitialize: an unknown version is refused with supported; NO version is ok and answers ours  [R7, S7.7]
 *   8 mcpTools comes from the registry, offeredBy holds only healthy members, empty registry is []  [R8, S7.8]
 *   9 mcpCall in priority order: unknown-tool, no-provider, provider-silent (the provider is healthy but
 *     NOT in routes(state, localEnd, now, ...)), ok — and the same provider is reachable from its own end,
 *     because reachability is a property of the observing end (the Lead ruling on the S5 gap)  [R9, S7.9]
 *  10 adapter facts are readable and move nothing else (contrast fixture carries adapter records only)  [S6, S7.10]
 *  11 the real two-end path: a second log declares its adapter, relays it, is callable, then goes silent  [S7.11]
 *  12 the listing and the call agree: availableFrom is non-empty exactly when mcpCall from the SAME localEnd
 *     is ok, so no tool is ever advertised by an end that answers provider-silent for it  [Lead ruling]
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). --self-attack mutates the BUILT
 * module (anchors matched out of lib/index.js itself, so a refactor cannot leave one silently stale): every
 * mutant must redden exactly the set it declares, the coverage matrix is printed, and every reading must be
 * claimed by at least one mutant.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
const MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
// The contract's discipline: every log this gate opens lives under .tmp, never in the live home.
const SCRATCH = join(PROJECT, '.tmp')

// The contract's literal list (section 2). Not read out of the module: a gate that takes the expected
// supported list from the implementation cannot see the list go wrong.
const SUPPORTED = ['dsh-link-adapter/1']
const UNKNOWN_VERSION = 'dsh-link-adapter/9'
const ADAPTER_KIND = 'adapter/state'
const TEAM = 'team-1'
const NOW = 1_800_000_000_000
const TIMEOUT = 60_000

const SENTENCES = {
  1: 'an undeclared adapter is refused as undeclared-adapter, with supported carried out  [R4, S7.1]',
  2: 'a protocol version we do not know is refused, and supported comes back as-is  [R1/R4/R6, S7.2]',
  3: 'declared + supported + offered == registry is ok, and offers are sorted and deduplicated  [S1/S7.3]',
  4: 'the registry is the authority: missing is refused, extra is reported but still ok  [R5, S7.4]',
  5: 'empty-platform has its own reason, and malformed declarations stay visible  [R3/R4, S7.5]',
  6: 'two declarations for one id: foldClaim decides, order-independent, the loser is listed  [R2, S7.6]',
  7: 'mcpInitialize refuses an unknown version, and answers ours when none was sent  [R7, S7.7]',
  8: 'mcpTools is the registry, offeredBy is only the healthy, an empty registry is []  [R8, S7.8]',
  9: 'mcpCall in priority order: unknown-tool, no-provider, provider-silent (healthy but not in routes from the observing end), ok  [R9, S7.9]',
  10: 'adapter facts are readable kinds and move no other reading  [S6, S7.10]',
  11: 'the real two-end path: declare, relay, call ok, then the provider goes silent  [S7.11]',
  12: 'the listing and the call are read from ONE viewpoint: a tool is advertised exactly when the same end can call it  [Lead ruling]',
}

// ---------------------------------------------------------------- helpers
const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === 'skip' })
  console.log('  ' + (status === true ? 'ok  ' : (status === 'skip' ? 'SKIP' : 'FAIL')) + '  ' + n + '. ' + detail)
}
const start = (n) => { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]) }
const clip = (text, n) => { const s = String(text); return s.length > n ? s.slice(0, n) + '...' : s }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const freshDir = () => mkdtempSync(join(SCRATCH, 'r45-adapter-'))
const exported = (log) => log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))

// Deterministic fixtures. Member records are raw (this build has no member builder); every other fact goes
// through the module's own builder, so the ledger holds what a real writer would have written.
// A real ledger stamps every record with a clock (writeNow: at = record.at ?? now()), and an adapter claim
// with no readable clock cannot be folded, so the fixtures stamp one exactly as the log would.
const stamped = (fact, seq, extra) => ({ ...fact, seq, channel: 'control', writer: 'w-1', instance: 'i1', at: NOW, ...extra })
const member = (seq, id) => ({ seq, channel: 'control', writer: 'w-1', instance: 'i1', actor: TEAM, kind: 'member/state', subject: id, payload: { id, name: id, state: 'active', role: 'member' } })
const rawAdapter = (seq, subject, payload, extra) => ({ seq, channel: 'control', writer: 'w-1', instance: 'i1', actor: TEAM, kind: ADAPTER_KIND, at: NOW, ...(subject === undefined ? {} : { subject }), payload, ...extra })
const clone = (records) => records.map((item) => ({ ...item, payload: item.payload === undefined ? undefined : { ...item.payload } }))
const arrival = (records, order) => order.map((seq) => records.find((item) => item.seq === seq))

const apiOf = (mod) => ({
  project: typeof mod?.projectTeamState === 'function' ? mod.projectTeamState : null,
  adapter: typeof mod?.adapterRecord === 'function' ? mod.adapterRecord : null,
  adapters: typeof mod?.projectAdapters === 'function' ? mod.projectAdapters : null,
  admit: typeof mod?.admitAdapter === 'function' ? mod.admitAdapter : null,
  initialize: typeof mod?.mcpInitialize === 'function' ? mod.mcpInitialize : null,
  tools: typeof mod?.mcpTools === 'function' ? mod.mcpTools : null,
  call: typeof mod?.mcpCall === 'function' ? mod.mcpCall : null,
  capability: typeof mod?.capabilityRecord === 'function' ? mod.capabilityRecord : null,
  heartbeat: typeof mod?.heartbeatRecord === 'function' ? mod.heartbeatRecord : null,
  host: typeof mod?.hostRecord === 'function' ? mod.hostRecord : null,
  openLog: typeof mod?.openControlLog === 'function' ? mod.openControlLog : null,
  supported: Array.isArray(mod?.SUPPORTED_PROTOCOLS) ? mod.SUPPORTED_PROTOCOLS : null,
  adapterKind: typeof mod?.ADAPTER_KIND === 'string' ? mod.ADAPTER_KIND : null,
})
const REQUIRED = [
  ['project', 'projectTeamState'], ['adapter', 'adapterRecord'], ['adapters', 'projectAdapters'], ['admit', 'admitAdapter'],
  ['initialize', 'mcpInitialize'], ['tools', 'mcpTools'], ['call', 'mcpCall'], ['capability', 'capabilityRecord'],
  ['heartbeat', 'heartbeatRecord'], ['host', 'hostRecord'], ['openLog', 'openControlLog'],
]

// ---------------------------------------------------------------- the readings
async function run(a) {
  const problems = {}
  const notes = {}
  const say = (n, problem) => { (problems[n] = problems[n] ?? []).push(problem) }
  const note = (n, text) => { (notes[n] = notes[n] ?? []).push(text) }
  const done = (n) => { const list = problems[n] ?? []; record(n, list.length === 0, list.length === 0 ? (notes[n] ?? []).join(' | ') : list.slice(0, 3).join(' | ')) }
  const cap = (memberId, capabilities) => a.capability(memberId, capabilities)
  const beat = (memberId, at) => a.heartbeat(memberId, at)
  const host = (memberId, end, via, at) => a.host(memberId, end, via, at)
  const adapter = (id, platform, version, offers) => a.adapter(id, platform, version, offers)
  const stateOf = (records) => a.project(clone(records))

  // ---------------------------------------------------------------- 1 undeclared
  start(1)
  {
    const empty = stateOf([member(1, 'other')])
    const reading = a.admit(empty, 'a1')
    if (reading?.ok !== false) say(1, 'ok is ' + show(reading?.ok ?? null) + ', expected false')
    if (reading?.reason !== 'undeclared-adapter') say(1, 'reason is ' + show(reading?.reason ?? null) + ', expected undeclared-adapter')
    if (show(reading?.supported) !== show(SUPPORTED)) say(1, 'supported is ' + clip(show(reading?.supported ?? null), 90) + ', expected the supported list as-is ' + show(SUPPORTED))
    if (reading?.platform !== null || reading?.protocolVersion !== null) say(1, 'an undeclared adapter answered platform ' + show(reading?.platform ?? null) + ' / version ' + show(reading?.protocolVersion ?? null) + ', expected null for both (there is nothing to read them from)')
    if (!Array.isArray(reading?.missing) || !Array.isArray(reading?.extra)) say(1, 'missing/extra are not both arrays: ' + clip(show({ missing: reading?.missing ?? null, extra: reading?.extra ?? null }), 90))
    if (a.supported !== null && show(a.supported) !== show(SUPPORTED)) say(1, 'the module SUPPORTED_PROTOCOLS is ' + show(a.supported) + ', expected ' + show(SUPPORTED))
    if (a.adapterKind !== null && a.adapterKind !== ADAPTER_KIND) say(1, 'ADAPTER_KIND is ' + show(a.adapterKind) + ', expected ' + ADAPTER_KIND)
    note(1, 'verdict ' + clip(show(reading), 140))
    console.log('      ' + notes[1][0])
  }
  done(1)

  // ---------------------------------------------------------------- 2 unsupported protocol
  start(2)
  {
    const records = [
      member(1, 'a1'),
      stamped(cap('a1', ['tools.echo']), 2),
      stamped(adapter('a1', 'platform-x', SUPPORTED[0], ['tools.echo']), 3),
      stamped(adapter('a2', 'platform-y', UNKNOWN_VERSION, ['tools.echo']), 4),
    ]
    const state = stateOf(records)
    const asked = a.admit(state, 'a1', { protocolVersion: UNKNOWN_VERSION })
    const declared = a.admit(state, 'a2', { protocolVersion: SUPPORTED[0] })
    const implicit = a.admit(state, 'a2')
    const control = a.admit(state, 'a1', { protocolVersion: SUPPORTED[0] })
    for (const [label, reading] of [['request unknown', asked], ['declaration unknown (request supported)', declared], ['declaration unknown (no request)', implicit]]) {
      if (reading?.ok !== false) say(2, label + ': ok is ' + show(reading?.ok ?? null) + ', expected false')
      if (reading?.reason !== 'unsupported-protocol') say(2, label + ': reason is ' + show(reading?.reason ?? null) + ', expected unsupported-protocol')
      if (show(reading?.supported) !== show(SUPPORTED)) say(2, label + ': supported is ' + clip(show(reading?.supported ?? null), 90) + ', expected ' + show(SUPPORTED) + ' as-is')
    }
    if (control?.ok !== true) say(2, 'the control (supported version, registry matches offers) answered ' + clip(show(control), 110) + ', expected ok — the fixture is otherwise admissible')
    note(2, 'request unknown -> ' + clip(show(asked), 110) + '; declaration unknown -> ' + clip(show(declared), 110) + '; control -> ' + clip(show(control), 90))
    console.log('      ' + notes[2][0])
  }
  done(2)

  // ---------------------------------------------------------------- 3 happy path, offers canonicalised
  start(3)
  {
    const built = adapter('a1', 'platform-x', SUPPORTED[0], ['tools.time', 'tools.echo', 'tools.echo'])
    const records = [
      member(1, 'a1'),
      stamped(cap('a1', ['tools.time', 'tools.echo']), 2),
      stamped(built, 3),
    ]
    const state = stateOf(records)
    if (show(built.payload?.offers) !== show(['tools.echo', 'tools.time'])) say(3, 'the builder wrote offers ' + clip(show(built.payload?.offers ?? null), 90) + ', expected sorted and deduplicated [tools.echo, tools.time]')
    const row = (state.adapters?.adapters ?? []).find((item) => item.id === 'a1') ?? null
    if (row === null) say(3, 'the adapter is not in the fold at all')
    else if (show(row.offers) !== show(['tools.echo', 'tools.time'])) say(3, 'the folded offers are ' + clip(show(row.offers), 90) + ', expected [tools.echo, tools.time]')
    const reading = a.admit(state, 'a1')
    if (reading?.ok !== true) say(3, 'ok is ' + show(reading?.ok ?? null) + ', expected true')
    if (reading?.reason !== 'ok') say(3, 'reason is ' + show(reading?.reason ?? null) + ', expected ok')
    if (reading?.platform !== 'platform-x') say(3, 'platform is ' + show(reading?.platform ?? null) + ', expected platform-x')
    if (reading?.protocolVersion !== SUPPORTED[0]) say(3, 'protocolVersion is ' + show(reading?.protocolVersion ?? null) + ', expected ' + SUPPORTED[0])
    if (show(reading?.missing) !== show([])) say(3, 'missing is ' + clip(show(reading?.missing ?? null), 90) + ', expected []')
    if (show(reading?.extra) !== show([])) say(3, 'extra is ' + clip(show(reading?.extra ?? null), 90) + ', expected []')
    note(3, 'offers ' + show(built.payload?.offers) + ' -> ' + clip(show(reading), 130))
    console.log('      ' + notes[3][0])
  }
  done(3)

  // ---------------------------------------------------------------- 4 the registry is the authority
  start(4)
  {
    const base = [member(1, 'b1'), stamped(cap('b1', ['tools.echo', 'tools.time']), 2)]
    const claimedTooMuch = stateOf([...base, stamped(adapter('b1', 'platform-x', SUPPORTED[0], ['tools.echo', 'tools.ghost']), 3)])
    const claimedTooLittle = stateOf([...base, stamped(adapter('b1', 'platform-x', SUPPORTED[0], ['tools.echo']), 3)])
    const missing = a.admit(claimedTooMuch, 'b1')
    if (missing?.ok !== false) say(4, 'a self-claimed capability the registry lacks answered ok ' + show(missing?.ok ?? null) + ', expected false')
    if (missing?.reason !== 'capability-mismatch') say(4, 'that refusal reason is ' + show(missing?.reason ?? null) + ', expected capability-mismatch')
    if (show(missing?.missing) !== show(['tools.ghost'])) say(4, 'missing is ' + clip(show(missing?.missing ?? null), 90) + ', expected [tools.ghost]')
    // The registry is ['tools.echo','tools.time'] and the adapter claimed ['tools.echo','tools.ghost'], so
    // the same refusal also has an extra: a refused reading still reports BOTH lists truthfully (R5). My
    // first expectation said [] here, which would have been the implementation reading the registry wrongly.
    if (show(missing?.extra) !== show(['tools.time'])) say(4, 'missing-case extra is ' + clip(show(missing?.extra ?? null), 90) + ', expected [tools.time] (registry minus offers, reported even while refusing)')
    const extra = a.admit(claimedTooLittle, 'b1')
    if (extra?.ok !== true) say(4, 'a registry capability the adapter did not claim refused the adapter (' + clip(show(extra), 110) + '), expected ok — the registry is the authority')
    if (extra?.reason !== 'ok') say(4, 'that reading reason is ' + show(extra?.reason ?? null) + ', expected ok')
    if (show(extra?.extra) !== show(['tools.time'])) say(4, 'extra is ' + clip(show(extra?.extra ?? null), 90) + ', expected [tools.time]')
    if (show(extra?.missing) !== show([])) say(4, 'extra-case missing is ' + clip(show(extra?.missing ?? null), 90) + ', expected []')
    note(4, 'claimed too much -> ' + clip(show(missing), 120) + '; claimed too little -> ' + clip(show(extra), 120))
    console.log('      ' + notes[4][0])
  }
  done(4)

  // ---------------------------------------------------------------- 5 empty platform, malformed visible
  start(5)
  {
    const records = [
      member(1, 'c1'),
      rawAdapter(2, 'c1', { id: 'c1', platform: '', protocolVersion: SUPPORTED[0], offers: [] }),
      rawAdapter(3, undefined, { protocolVersion: SUPPORTED[0], offers: [] }),
      rawAdapter(4, 'c3', { id: 'c3', platform: 'platform-z', protocolVersion: SUPPORTED[0], offers: 'tools.echo' }),
    ]
    const state = stateOf(records)
    const ids = (state.adapters?.adapters ?? []).map((row) => row.id)
    if (show(ids) !== show(['c1'])) say(5, 'the folded adapters are ' + show(ids) + ', expected only c1 (the two unusable declarations must not become adapters)')
    const empty = a.admit(state, 'c1')
    if (empty?.reason !== 'empty-platform') say(5, 'an empty platform answered ' + show(empty?.reason ?? null) + ', expected empty-platform')
    if (empty?.ok !== false) say(5, 'an empty platform answered ok ' + show(empty?.ok ?? null) + ', expected false')
    const refused = state.adapters?.refused ?? []
    if (state.adapters?.malformed !== 2) say(5, 'malformed is ' + show(state.adapters?.malformed ?? null) + ', expected 2')
    if (refused.length !== 2) say(5, 'refused holds ' + refused.length + ' rows, expected 2')
    const bySeq = new Map(refused.map((row) => [row.seq, row]))
    if (!bySeq.has(3)) say(5, 'the record with no readable id is not visible in refused')
    else if (bySeq.get(3).id !== null) say(5, 'an unreadable id was refused as ' + show(bySeq.get(3).id) + ', expected null (null is "named none", never the empty string)')
    if (!bySeq.has(4)) say(5, 'the record whose offers is not an array is not visible in refused')
    else if (bySeq.get(4).id !== 'c3') say(5, 'that row names id ' + show(bySeq.get(4).id) + ', expected c3 (the id it did name)')
    for (const row of refused) if (row.reason !== 'malformed') say(5, 'a refused row says ' + show(row.reason) + ', expected malformed')
    const undeclared = a.admit(state, 'c3')
    if (undeclared?.reason !== 'undeclared-adapter') say(5, 'a malformed declaration did reach the adapter list: admitting c3 answered ' + show(undeclared?.reason ?? null) + ', expected undeclared-adapter')
    note(5, 'adapters ' + show(ids) + '; empty-platform -> ' + clip(show(empty), 100) + '; refused ' + clip(show(refused), 140))
    console.log('      ' + notes[5][0])
  }
  done(5)

  // ---------------------------------------------------------------- 6 contested declarations
  start(6)
  {
    const early = { ...adapter('d1', 'platform-old', SUPPORTED[0], ['tools.echo']), seq: 2, channel: 'control', writer: 'w-1', instance: 'i1', at: NOW - 1_000 }
    const late = { ...adapter('d1', 'platform-new', SUPPORTED[0], ['tools.time']), seq: 3, channel: 'control', writer: 'w-2', instance: 'i2', at: NOW }
    const records = [member(1, 'd1'), early, late]
    const byAt = stateOf(records)
    const row = (byAt.adapters?.adapters ?? []).find((item) => item.id === 'd1') ?? null
    if (row === null) say(6, 'the contested id has no folded row')
    else {
      if (row.platform !== 'platform-new') say(6, 'the winner is ' + show(row.platform) + ', expected platform-new (the later at wins)')
      if (row.resolvedBy !== 'at') say(6, 'resolvedBy is ' + show(row.resolvedBy) + ', expected at')
      if (row.contested !== true) say(6, 'contested is ' + show(row.contested) + ', expected true')
      if ((row.losers ?? []).length !== 1) say(6, 'losers holds ' + clip(show(row.losers), 90) + ', expected one')
      else if (row.losers[0].platform !== 'platform-old') say(6, 'the loser names platform ' + show(row.losers[0].platform) + ', expected platform-old')
      else if (row.losers[0].seq !== 2) say(6, 'the loser names seq ' + show(row.losers[0].seq) + ', expected 2')
    }
    const forward = JSON.stringify(byAt.adapters)
    const backward = JSON.stringify(stateOf(arrival(records, [3, 1, 2])).adapters)
    if (forward !== backward) say(6, 'the two arrival orders fold differently: ' + clip(forward, 130) + ' vs ' + clip(backward, 130))
    // Equal clocks: foldClaim falls back to the sequence, and the row has to say so.
    const sameClock = [
      member(1, 'd1'),
      { ...adapter('d1', 'platform-old', SUPPORTED[0], ['tools.echo']), seq: 2, channel: 'control', writer: 'w-1', instance: 'i1', at: NOW },
      { ...adapter('d1', 'platform-new', SUPPORTED[0], ['tools.time']), seq: 3, channel: 'control', writer: 'w-2', instance: 'i2', at: NOW },
    ]
    const bySeq = (stateOf(sameClock).adapters?.adapters ?? []).find((item) => item.id === 'd1') ?? null
    if (bySeq === null) say(6, 'the equal-clock pair has no folded row')
    else if (bySeq.resolvedBy !== 'seq') say(6, 'with two equal clocks resolvedBy is ' + show(bySeq.resolvedBy) + ', expected seq')
    else if (bySeq.platform !== 'platform-new') say(6, 'with two equal clocks the winner is ' + show(bySeq.platform) + ', expected the later seq (platform-new)')
    // Observation, printed and NOT asserted (reported to the Lead): a declaration with no readable clock at
    // all cannot be folded, and this build counts it malformed instead of inventing a clock for it.
    const noClockState = stateOf([member(1, 'd1'), { ...adapter('d1', 'platform-x', SUPPORTED[0], ['tools.echo']), seq: 2, channel: 'control', writer: 'w-1', instance: 'i1' }])
    note(6, 'by at -> ' + clip(show(row), 120) + '; order-independent ' + show(forward === backward) + '; equal clocks -> ' + clip(show(bySeq), 90) + '; no clock at all -> adapters ' + JSON.stringify((noClockState.adapters?.adapters ?? []).length) + ', refused ' + JSON.stringify((noClockState.adapters?.refused ?? []).length) + ', malformed ' + JSON.stringify(noClockState.adapters?.malformed ?? null))
    console.log('      ' + notes[6][0])
  }
  done(6)

  // ---------------------------------------------------------------- 7 mcpInitialize
  start(7)
  {
    const state = stateOf([member(1, 'x')])
    const unknown = a.initialize(state, { protocolVersion: UNKNOWN_VERSION })
    if (unknown?.ok !== false) say(7, 'an unknown requested version answered ok ' + show(unknown?.ok ?? null) + ', expected false')
    if (unknown?.reason !== 'unsupported-protocol') say(7, 'that reason is ' + show(unknown?.reason ?? null) + ', expected unsupported-protocol')
    if (show(unknown?.supported) !== show(SUPPORTED)) say(7, 'that supported is ' + clip(show(unknown?.supported ?? null), 90) + ', expected ' + show(SUPPORTED))
    for (const [label, request] of [['undefined', undefined], ['empty object', {}], ['our version', { protocolVersion: SUPPORTED[0] }]]) {
      const reading = a.initialize(state, request)
      if (reading?.ok !== true) say(7, label + ': ok is ' + show(reading?.ok ?? null) + ', expected true (the server picks the version when the client sends none)')
      else if (reading.protocolVersion !== SUPPORTED[0]) say(7, label + ': protocolVersion is ' + show(reading.protocolVersion) + ', expected our own ' + SUPPORTED[0])
      if (show(reading?.supported) !== show(SUPPORTED)) say(7, label + ': supported is ' + clip(show(reading?.supported ?? null), 90) + ', expected ' + show(SUPPORTED))
    }
    const info = a.initialize(state, undefined)?.serverInfo ?? null
    if (info === null || typeof info.name !== 'string' || info.name === '' || typeof info.version !== 'string' || info.version === '') say(7, 'serverInfo is ' + clip(show(info), 90) + ', expected a non-empty name and version')
    note(7, 'unknown -> ' + clip(show(unknown), 110) + '; none -> ' + clip(show(a.initialize(state, undefined)), 110) + '; serverInfo ' + clip(show(info), 60))
    console.log('      ' + notes[7][0])
  }
  done(7)

  // ---------------------------------------------------------------- 8 mcpTools from the registry
  start(8)
  {
    // m5 is healthy but sits behind an end nothing hosts: R44's no-route, i.e. out of reach from end-local.
    const LOCAL = 'end-local'
    const records = [
      member(1, 'm1'), member(2, 'm2'), member(3, 'm3'), member(4, 'm4'), member(5, 'm5'), member(6, 'm6'),
      stamped(cap('m1', ['tools.a']), 7), stamped(cap('m2', ['tools.b']), 8), stamped(cap('m3', ['tools.c']), 9),
      stamped(cap('m4', ['tools.a']), 10), stamped(cap('m5', ['tools.d']), 11),
      stamped(beat('m1', NOW - 1_000), 12), stamped(beat('m2', NOW - 1_000), 13), stamped(beat('m4', NOW - 1_000), 14), stamped(beat('m5', NOW - 1_000), 15),
      stamped(host('m5', 'end-far', 'end-gap', NOW - 1_000), 16), stamped(host('m6', LOCAL, null, NOW - 1_000), 17),
    ]
    const state = stateOf(records)
    // availableFrom is "who can offer this NOW": healthy, and reachable from the observing end when one is
    // given (the Lead's rename ruling). Without localEnd the reading is the healthy set, as before.
    // availableFrom is "who can offer this NOW from the observing end": healthy AND reachable from localEnd.
    // The observing end is passed on every call (the Lead's rulings), so the listing and mcpCall below are
    // always read from the same viewpoint — reading 12 pins exactly that coherence.
    const want = [
      { name: 'tools.a', availableFrom: ['m1', 'm4'] },
      { name: 'tools.b', availableFrom: ['m2'] },
      { name: 'tools.c', availableFrom: [] },
      { name: 'tools.d', availableFrom: [] },
    ]
    const tools = a.tools(state, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })
    if (show(tools) !== show(want)) say(8, 'mcpTools is ' + clip(show(tools), 220) + ', expected ' + clip(show(want), 220) + ' (m3 never beat, so tools.c has nobody; m5 is healthy but out of reach from ' + LOCAL + ')')
    const stale = a.tools(state, NOW + 5 * TIMEOUT, { timeoutMs: TIMEOUT, localEnd: LOCAL })
    const staleExpect = want.map((row) => ({ name: row.name, availableFrom: [] }))
    if (show(stale) !== show(staleExpect)) say(8, 'once every heartbeat is stale the tools are ' + clip(show(stale), 190) + ', expected the same names with nobody available (the registry is the list, health is the availability)')
    const emptyState = stateOf([member(1, 'm1')])
    if (show(a.tools(emptyState, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })) !== show([])) say(8, 'an empty registry gave ' + clip(show(a.tools(emptyState, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })), 90) + ', expected [] (an empty registry is not an error)')
    note(8, 'tools ' + clip(show(tools), 170) + '; stale ' + clip(show(stale), 110) + '; empty registry ' + show(a.tools(emptyState, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })))
    console.log('      ' + notes[8][0])
  }
  done(8)

  // ---------------------------------------------------------------- 9 mcpCall priorities
  start(9)
  {
    // The observing end is an argument (the Lead ruling): reachability is not a property of the provider,
    // it is a property of the pair. end-local is a member of this ledger; end-remote is the end p3 lives at.
    const LOCAL = 'end-local'
    const records = [
      member(1, 'p1'), member(2, 'p2'), member(3, 'p3'), member(4, 'p4'), member(5, 'p5'),
      stamped(cap('p1', ['tools.never']), 6),
      stamped(cap('p2', ['tools.silent', 'tools.mixed']), 7),
      stamped(cap('p3', ['tools.broken', 'tools.mixed']), 8),
      stamped(cap('p4', ['tools.local']), 9),
      stamped(beat('p3', NOW - 1_000), 10), stamped(beat('p4', NOW - 1_000), 11), stamped(beat('p5', NOW - 1_000), 12),
      // p3 is healthy but routed through an end nothing hosts: R44's no-route, i.e. out of reach from here.
      stamped(host('p3', 'end-remote', 'end-via', NOW - 1_000), 13),
      stamped(host('p5', LOCAL, null, NOW - 1_000), 14),
    ]
    const state = stateOf(records)
    const cases = [
      ['unknown-tool', 'tools.unknown', 'unknown-tool', []],
      ['no-provider', 'tools.silent', 'no-provider', ['p2']],
      ['provider-silent', 'tools.broken', 'provider-silent', ['p3']],
      ['ok', 'tools.local', 'ok', ['p4']],
      ['silent beats broken is not the rule: a healthy but unreachable provider is provider-silent even beside a dead one', 'tools.mixed', 'provider-silent', ['p2', 'p3']],
    ]
    for (const [label, tool, wantReason, wantOffered] of cases) {
      const reading = a.call(state, tool, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })
      if (reading?.reason !== wantReason) say(9, label + ': reason is ' + show(reading?.reason ?? null) + ', expected ' + wantReason)
      if (reading?.ok !== (wantReason === 'ok')) say(9, label + ': ok is ' + show(reading?.ok ?? null) + ', expected ' + show(wantReason === 'ok'))
      if (show(reading?.declaredBy) !== show(wantOffered)) say(9, label + ': declaredBy is ' + clip(show(reading?.declaredBy ?? null), 90) + ', expected ' + show(wantOffered))
      if (!Array.isArray(reading?.healthy)) say(9, label + ': healthy is ' + clip(show(reading?.healthy ?? null), 60) + ', expected an array')
    }
    // The same provider, seen from the end it lives at: the sentence is about the PAIR, so this must be ok.
    const fromItsOwnEnd = a.call(state, 'tools.broken', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-remote' })
    if (fromItsOwnEnd?.reason !== 'ok') say(9, 'the same healthy provider seen from end-remote answered ' + clip(show(fromItsOwnEnd), 120) + ', expected ok (reachability is a property of the observing end, not of the provider)')
    else if (show(fromItsOwnEnd?.declaredBy) !== show(['p3'])) say(9, 'from end-remote the provider is ' + clip(show(fromItsOwnEnd?.declaredBy ?? null), 80) + ', expected [p3]')
    note(9, cases.map(([label, tool]) => tool + ' -> ' + show(a.call(state, tool, NOW, { timeoutMs: TIMEOUT, localEnd: LOCAL })?.reason ?? null)).join('; ') + '; tools.broken from end-remote -> ' + show(fromItsOwnEnd?.reason ?? null))
    console.log('      ' + notes[9][0])
  }
  done(9)

  // ---------------------------------------------------------------- 10 counters and the contrast fixture
  start(10)
  {
    const base = [
      member(1, 'k1'), member(2, 'k2'),
      stamped(cap('k1', ['tools.a']), 3), stamped(beat('k1', NOW - 1_000), 4),
      { seq: 5, channel: 'control', writer: 'w-1', instance: 'i1', actor: TEAM, kind: 'task/state', subject: 'T1', payload: { id: 'T1', state: 'in-progress', owner: 'k1' } },
      stamped(host('k2', 'end-two', null, NOW - 1_000), 6),
    ]
    const adapterFacts = [stamped(adapter('k1', 'platform-x', SUPPORTED[0], ['tools.a']), 7)]
    const without = stateOf(base)
    const added = stateOf([...base, ...adapterFacts])
    if ((without.counts?.unknown ?? null) !== 0) say(10, 'the base ledger already has unknown ' + show(without.counts?.unknown ?? null))
    if ((added.counts?.unknown ?? null) !== 0) say(10, 'adding an adapter fact raised counts.unknown to ' + show(added.counts?.unknown ?? null) + ' (the kind must be readable)')
    const control = stateOf([{ seq: 1, channel: 'control', writer: 'w', instance: 'i1', kind: 'probe/unreadable-kind', subject: 'x', payload: { id: 'x' } }])
    if ((control.counts?.unknown ?? null) !== 1) say(10, 'the positive control was not counted: unknown is ' + show(control.counts?.unknown ?? null) + ', expected 1')
    for (const key of ['tasks', 'members', 'registry', 'liveness', 'teams', 'peers', 'board', 'locks']) {
      const left = JSON.stringify(without[key] ?? null)
      const right = JSON.stringify(added[key] ?? null)
      if (left !== right) say(10, key + ' moved when only an adapter fact was added: ' + clip(left, 90) + ' vs ' + clip(right, 90))
    }
    for (const key of Object.keys(without.counts ?? {})) {
      if (key === 'folded' || key === 'unknown') continue
      if (show(without.counts[key]) !== show(added.counts[key])) say(10, 'counts.' + key + ' moved: ' + show(without.counts[key]) + ' vs ' + show(added.counts[key]))
    }
    if (JSON.stringify(without.adapters) === JSON.stringify(added.adapters)) say(10, 'the two sides fold identical adapters, so the fixture carries nothing for this reading to see')
    note(10, 'unknown base ' + show(without.counts?.unknown ?? null) + ', with an adapter ' + show(added.counts?.unknown ?? null) + ', positive control ' + show(control.counts?.unknown ?? null) + '; adapters differ ' + show(JSON.stringify(without.adapters) !== JSON.stringify(added.adapters)))
    console.log('      ' + notes[10][0])
  }
  done(10)

  // ---------------------------------------------------------------- 11 the real two-end path
  start(11)
  {
    const dir = freshDir()
    let logA = null; let logB = null
    try {
      logA = a.openLog({ dir: join(dir, 'a'), writer: 'end-a' })
      logB = a.openLog({ dir: join(dir, 'b'), writer: 'end-b' })
      const remote = 'b-remote'
      // The adapter id IS a member id (contract S1), so the far end declares the member too: routing walks
      // state.members, and without the member the provider would look unreachable rather than unknown.
      await logB.append({ kind: 'member/state', actor: TEAM, subject: remote, at: NOW, payload: { id: remote, name: remote, state: 'active', role: 'member' } })
      await logB.append(a.adapter(remote, 'platform-b', SUPPORTED[0], ['tools.remote']))
      await logB.append(a.capability(remote, ['tools.remote']))
      await logB.append(a.heartbeat(remote, NOW))
      const landed = await logA.ingest({ writer: logB.writer, instance: logB.instance, records: exported(logB) })
      if (landed?.appended !== 4) say(11, 'the relay appended ' + show(landed?.appended ?? null) + ' of the four declared facts, expected 4')
      const stateA = a.project(logA.replay())
      const stateB = a.project(logB.replay())
      if (JSON.stringify(stateA.adapters ?? null) !== JSON.stringify(stateB.adapters ?? null)) say(11, 'the two ends fold different adapters: A ' + clip(JSON.stringify(stateA.adapters), 120) + ' vs B ' + clip(JSON.stringify(stateB.adapters), 120))
      const admitted = a.admit(stateA, remote)
      if (admitted?.ok !== true) say(11, 'the relayed adapter is not admissible on A: ' + clip(show(admitted), 120))
      const tools = a.tools(stateA, NOW, { timeoutMs: TIMEOUT, localEnd: 'end-a' })
      const wantTools = [{ name: 'tools.remote', availableFrom: [remote] }]
      if (show(tools) !== show(wantTools)) say(11, 'A mcpTools is ' + clip(show(tools), 140) + ', expected ' + clip(show(wantTools), 140))
      const call = a.call(stateA, 'tools.remote', NOW, { timeoutMs: TIMEOUT, localEnd: 'end-a' })
      if (call?.reason !== 'ok' || call?.ok !== true) say(11, 'A mcpCall is ' + clip(show(call), 120) + ', expected ok with the remote provider')
      const wentSilent = a.call(stateA, 'tools.remote', NOW + 5 * TIMEOUT, { timeoutMs: TIMEOUT, localEnd: 'end-a' })
      if (wentSilent?.reason !== 'no-provider') say(11, 'once the far end stops beating, mcpCall is ' + clip(show(wentSilent), 120) + ', expected no-provider')
      if (show(wentSilent?.declaredBy) !== show([remote])) say(11, 'the declaration is not remembered through the silence: declaredBy is ' + clip(show(wentSilent?.declaredBy ?? null), 90) + ', expected [' + remote + ']')
      if (show(wentSilent?.healthy) !== show([])) say(11, 'a silent provider is still counted healthy: ' + clip(show(wentSilent?.healthy ?? null), 90) + ', expected []')
      const silentTools = a.tools(stateA, NOW + 5 * TIMEOUT, { timeoutMs: TIMEOUT, localEnd: 'end-a' })
      if (show(silentTools) !== show([{ name: 'tools.remote', availableFrom: [] }])) say(11, 'once the far end stops beating, mcpTools is ' + clip(show(silentTools), 120) + ', expected the tool with nobody available from end-a')
      note(11, 'relayed ' + show(landed?.appended ?? null) + '; admit ' + show(admitted?.ok ?? null) + '; tools ' + clip(show(tools), 90) + '; call ' + show(call?.reason ?? null) + '; after silence ' + show(wentSilent?.reason ?? null))
    } catch (error) {
      say(11, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 130))
    } finally {
      if (logA !== null) { try { await logA.close() } catch { /* nothing to do */ } }
      if (logB !== null) { try { await logB.close() } catch { /* nothing to do */ } }
      rmSync(dir, { recursive: true, force: true })
    }
    console.log('      ' + (notes[11] ?? ['(no note)'])[0])
  }
  done(11)

  // ---------------------------------------------------------------- 12 the listing and the call agree
  start(12)
  {
    const LOCAL = 'end-local'
    const FAR = 'end-far'
    const records = [
      member(1, 'h1'), member(2, 'h2'), member(3, 'h3'), member(4, 'h4'),
      stamped(cap('h1', ['tools.here']), 5),
      stamped(cap('h2', ['tools.gone']), 6),
      stamped(cap('h3', ['tools.dead']), 7),
      stamped(beat('h1', NOW - 1_000), 8), stamped(beat('h2', NOW - 1_000), 9),
      stamped(host('h2', FAR, 'end-gap', NOW - 1_000), 10),
      stamped(host('h4', LOCAL, null, NOW - 1_000), 11),
    ]
    const state = stateOf(records)
    const seen = []
    for (const end of [LOCAL, FAR]) {
      const listing = a.tools(state, NOW, { timeoutMs: TIMEOUT, localEnd: end })
      if (show(listing.map((row) => row.name)) !== show(['tools.dead', 'tools.gone', 'tools.here'])) say(12, 'from ' + end + ' the listing names ' + clip(show(listing.map((row) => row.name)), 90) + ', expected the registry capabilities sorted')
      for (const tool of listing) {
        const advertised = (tool.availableFrom ?? []).length > 0
        const call = a.call(state, tool.name, NOW, { timeoutMs: TIMEOUT, localEnd: end })
        if (advertised !== (call?.ok === true)) say(12, 'from ' + end + ', ' + tool.name + ' is advertised by ' + show(tool.availableFrom ?? null) + ' but mcpCall answered ' + show(call?.reason ?? null) + ' — the listing and the call must come from one viewpoint')
        if (!advertised && call?.ok === false && !['no-provider', 'provider-silent'].includes(call.reason)) say(12, 'from ' + end + ', ' + tool.name + ' refused with ' + show(call.reason) + ', expected no-provider or provider-silent')
      }
      const advertised = listing.filter((row) => (row.availableFrom ?? []).length > 0).map((row) => row.name)
      const silent = listing.filter((row) => (row.availableFrom ?? []).length === 0).map((row) => row.name)
      if (advertised.length === 0 || silent.length === 0) say(12, 'from ' + end + ' the fixture does not exercise both sides: advertised ' + show(advertised) + ', silent ' + show(silent))
      seen.push(end + ': advertised ' + show(advertised) + ', silent ' + show(silent))
    }
    if (seen.length === 2 && seen[0].split(': ')[1] === seen[1].split(': ')[1]) say(12, 'both ends see the same availability, so the reading is not about the observing end: ' + show(seen))
    note(12, seen.join(' | '))
    console.log('      ' + notes[12][0])
  }
  done(12)
  return results
}

async function runAll(modulePath) {
  results.length = 0
  const mod = await load(modulePath)
  const a = apiOf(mod)
  const gone = REQUIRED.filter(([key]) => a[key] === null).map(([, name]) => name)
  if (gone.length > 0) {
    for (const n of Object.keys(SENTENCES).map(Number)) {
      start(n)
      record(n, false, 'the module exposes no ' + gone.join(', ') + ' — the sentence cannot be read on this build')
    }
    return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
  }
  try {
    await run(a)
  } catch (error) {
    const already = new Set(results.map((row) => row.n))
    for (const n of Object.keys(SENTENCES).map(Number)) {
      if (already.has(n)) continue
      start(n)
      record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
    }
  }
  return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
}

// Anchors are matched out of the build product itself; a mutant whose anchor is missing FAILS the
// self-attack instead of quietly disappearing (R40 lost a mutant that way once). Filled from the landed
// build: an empty table is a failure, not a pass.
const MUTATIONS = [
  {
    name: 'the declared protocol version is no longer checked',
    declared: [2],
    edits: [{
      find: /  if \(!supported\.includes\(row\.protocolVersion\)\) \{\n    return \{ ok: false, reason: "unsupported-protocol", platform: row\.platform, protocolVersion: row\.protocolVersion, supported, missing, extra \};\n  \}\n/,
      replace: () => '',
    }],
  },
  {
    name: 'the supported list is not carried out',
    // First run declared [1,2,7] and observed [1,2,3,4,11]: the same list is also what the admission test
    // consults, so emptying it refuses an adapter that is otherwise admissible. The declaration was wrong.
    declared: [1, 2, 3, 4, 11],
    edits: [{
      find: /const supported = \[\.\.\.SUPPORTED_PROTOCOLS\];/,
      replace: () => 'const supported = [];',
    }],
  },
  {
    name: 'offers are no longer sorted and deduplicated',
    declared: [3],
    edits: [{
      find: /offers: sortedNames\(offers\) \}/,
      replace: () => 'offers: [...offers] }',
    }],
  },
  {
    name: 'a self-claimed capability the registry lacks is no longer a refusal',
    declared: [4],
    edits: [{
      find: /  if \(missing\.length > 0\) return \{ ok: false, reason: "capability-mismatch", platform: row\.platform, protocolVersion: row\.protocolVersion, supported, missing, extra \};\n/,
      replace: () => '',
    }],
  },
  {
    name: 'a registry capability the adapter did not claim is a refusal too (the declaration rules)',
    declared: [4],
    edits: [{
      find: /  if \(missing\.length > 0\) return \{ ok: false, reason: "capability-mismatch"/,
      replace: () => '  if (missing.length > 0 || extra.length > 0) return { ok: false, reason: "capability-mismatch"',
    }],
  },
  {
    name: 'a malformed declaration is dropped instead of staying visible',
    declared: [5],
    edits: [{
      find: /      refused\.push\(\{ id: named, reason: "malformed", seq: record\.seq \}\);\n/,
      replace: () => '',
    }],
  },
  {
    name: 'the adapter fold ignores foldClaim (the first claim always wins)',
    declared: [6],
    edits: [{
      find: /const folded = foldClaim\(\{ at: previous\.at, seq: previous\.seq \}, \{ at: incoming\.at, seq: incoming\.seq \}\);/,
      replace: () => 'const folded = { incomingWins: false, byAt: true };',
    }],
  },
  {
    name: 'mcpInitialize refuses when the client sent no version (the server stops picking)',
    declared: [7],
    edits: [{
      find: /  if \(asked === null\) return \{ ok: true, reason: "ok", protocolVersion: SUPPORTED_PROTOCOLS\[0\], supported, serverInfo: MCP_SERVER_INFO \};/,
      replace: () => '  if (asked === null) return { ok: false, reason: "unsupported-protocol", protocolVersion: null, supported, serverInfo: MCP_SERVER_INFO };',
    }],
  },
  {
    // Anchored on the livenesses map (the first one is the listing's), so the mutant survives the rename of
    // the returned field and any reshaping of the availability filter that follows it.
    name: 'the listing ignores health (it offers tools through members that are not healthy)',
    // Declared [8,11], observed [8,11,12]: reading 12 sees the listing advertise a member the call refuses.
    declared: [8, 11, 12],
    edits: [{
      find: /const livenesses = new Map\(livenessOf\(state, now, options\)\.map\(\(reading\) => \[reading\.memberId, reading\.liveness\]\)\);/,
      replace: () => 'const livenesses = new Map(livenessOf(state, now, options).map((reading) => [reading.memberId, "healthy"]));',
    }],
  },
  {
    name: 'the listing stops asking whether the provider is reachable',
    // Declared [8,12], observed [8,11,12]: with an empty reachable set the relayed provider disappears from
    // the far end own listing, which reading 11 reads.
    declared: [8, 11, 12],
    edits: [{
      find: /const reachable = [^;\n]*routes\(state, options\.localEnd, now, \{ timeoutMs: options\.timeoutMs \}\)\.map\(\(row\) => row\.member\)\);/,
      replace: () => 'const reachable = new Set();',
    }],
  },
  {
    name: 'mcpCall drops the no-provider branch (health stops meaning anything)',
    declared: [9, 11],
    edits: [{
      find: /  if \(healthy\.length === 0\) return \{ ok: false, reason: "no-provider", declaredBy, healthy \};\n/,
      replace: () => '',
    }],
  },
  {
    name: 'mcpCall drops the reachability test (a healthy provider is always reachable)',
    declared: [9, 12],
    edits: [{
      find: /  if \(!healthy\.some\(\(id\) => reachable\.has\(id\)\)\) return \{ ok: false, reason: "provider-silent", declaredBy, healthy \};\n/,
      replace: () => '',
    }],
  },
  {
    name: 'the adapter kind is unreadable again (READABLE_KINDS)',
    declared: [10],
    edits: [{
      find: /, HOST_KIND, ADAPTER_KIND\];/,
      replace: () => ', HOST_KIND];',
    }],
  },
  {
    name: 'adapter facts leak into the member fold',
    declared: [10],
    edits: [{
      find: /const change = record\.kind === TASK_KIND \|\| record\.kind === MEMBER_KIND \? stateOf\(record\) : null;/,
      replace: () => 'const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND || record.kind === ADAPTER_KIND ? stateOf(record) : null;',
    }],
  },
]

async function selfAttack() {
  if (MUTATIONS.length === 0) {
    console.log('the mutation table is empty: this run has nothing to attack with, which is a failure, not a pass')
    process.exit(1)
  }
  const tmp = mkdtempSync(join(SCRATCH, 'r45-attack-'))
  try {
    const source = readFileSync(MODULE, 'utf8')
    const lines = []
    const anchors = []
    const rows = []
    let localised = 0
    let applied = 0
    let notApplicable = 0
    for (const mutation of MUTATIONS) {
      const id = 'M' + String(MUTATIONS.indexOf(mutation) + 1)
      let text = source
      let anchor = null
      let dead = null
      for (const edit of mutation.edits) {
        const match = edit.find.exec(text)
        if (match === null) { dead = show(edit.find); break }
        anchor = anchor === null ? match[0] : anchor + ' && ' + match[0]
        text = text.replace(edit.find, edit.replace)
      }
      if (dead !== null || text === source) {
        notApplicable += 1
        lines.push('  ' + id + ' ' + mutation.name + ' -> ANCHOR NOT FOUND in lib/index.js (' + clip(dead ?? 'the edit was a no-op', 90) + ')')
        continue
      }
      applied += 1
      anchors.push('  ' + id + ' ' + mutation.name + ' -> ' + clip(anchor.replace(/\s+/g, ' '), 150))
      const copy = join(tmp, 'mutant-' + String(applied) + '.mjs')
      writeFileSync(copy, text)
      const seen = await runAll(copy)
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.slice().sort((left, right) => left - right)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push('  ' + id + ' ' + mutation.name + ' -> declared ' + show(declared) + ', observed ' + show(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
      rows.push({ id, name: mutation.name, declared, clean })
    }
    console.log('== anchors taken from the build product (' + MODULE + ') ==')
    console.log(anchors.join('\n'))
    console.log('')
    console.log('== mutations: each mutant must redden exactly its declared set ==')
    console.log(lines.join('\n'))
    console.log('')
    const READINGS = Object.keys(SENTENCES).map(Number)
    console.log('coverage matrix (reading -> mutants that declare it):')
    for (const n of READINGS) {
      const claimants = rows.filter((row) => row.declared.includes(n)).map((row) => row.id)
      console.log('  ' + n + ': ' + (claimants.join(', ') || 'UNCOVERED'))
    }
    const uncovered = READINGS.filter((n) => rows.every((row) => !row.declared.includes(n)))
    if (uncovered.length > 0) console.log('  UNCOVERED READINGS: ' + show(uncovered))
    const mismatched = rows.filter((row) => !row.clean).map((row) => row.id + ' ' + row.name)
    console.log('')
    console.log('mutants applied ' + String(applied) + ' of ' + String(MUTATIONS.length) + ' (anchors not found ' + String(notApplicable) + '); declared-set matches ' + String(localised) + ' of ' + String(applied) + '; uncovered readings ' + String(uncovered.length))
    if (mismatched.length > 0) console.log('mutants whose red set is not the declared one: ' + show(mismatched))
    process.exit(applied === MUTATIONS.length && localised === applied && uncovered.length === 0 ? 0 : 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  if (!existsSync(MODULE)) { console.log('SKIP  no collab module at ' + MODULE); process.exit(3) }
  console.log('== real (this machine): ' + MODULE + ' ==')
  const { failed } = await runAll(MODULE)
  console.log('')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length) + ' held, 0 skipped, ' + String(failed.length) + ' failed')
  if (failed.length > 0) process.exit(1)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
