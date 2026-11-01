#!/usr/bin/env node
/**
 * R59 gate (task-111): a transit end really carries a peer's work two hops.
 *
 * What it drives: the shipped relay endpoint (built module plugins/dsh-link-collab/lib/index.js),
 * and the reference foreign end tools/foreign-harness/foreign-end.mjs as two REAL child processes -
 * a transit T and an end B behind it. The gate shares no code with either: it speaks the page.
 *
 * Judged by docs/protocol/device-net-v1.md section five-two (the transit rules) and the citation
 * table the page keeps. The producer's own multihop self-check is never imported.
 *
 * Exit 0 all readings held; 1 a reading failed; 3 an input is missing.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer as createHttp } from 'node:http'
import { createInterface } from 'node:readline'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href
const SHIPPED_FOREIGN = join(PROJECT, 'tools', 'foreign-harness', 'foreign-end.mjs')
const FOREIGN = resolve(option('--foreign', SHIPPED_FOREIGN))
const pageOption = option('--page', '')
const PAGE = pageOption === '' ? join(PROJECT, 'docs', 'protocol', 'device-net-v1.md') : resolve(pageOption)
const CHECKER = join(PROJECT, 'scripts', 'check-protocol-page.mjs')
const TOKEN = 'tok'
const AS_JSON = argv.includes('--json')
const CHILD = argv.includes('--plain-child')

for (const [what, path] of [['the built module', pathToFileURL(MODULE).pathname.slice(3)], ['the reference foreign end', FOREIGN], ['the page', PAGE], ['the citation checker', CHECKER]]) {
  if (!readFileSync) break
}
const mustExist = (path, what) => { try { readFileSync(path) } catch { console.error('missing ' + what + ': ' + path); process.exit(3) } }
mustExist(FOREIGN, 'the foreign end')
mustExist(PAGE, 'the protocol page')
mustExist(CHECKER, 'the citation checker')

const readings = []
const held = (name, ok, detail) => { readings.push({ name, ok: ok === true, detail: String(detail) }) }
const guard = async (name, body) => { try { await body() } catch (error) { held(name, false, 'threw: ' + String(error && error.message ? error.message : error)) } }
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const until = async (check, budgetMs) => { const end = Date.now() + budgetMs; for (;;) { if (check()) return true; if (Date.now() > end) return false; await sleep(100) } }
const freePort = () => new Promise((settle, fail) => { const probe = createServer(); probe.on('error', fail); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => settle(port)) }) })

/** One end of ours: a real control log, a real relay route, driven over real sockets. */
async function startOurEnd(C, root, name) {
  const log = C.openControlLog({ dir: join(root, name), writer: name })
  const endpoint = C.createRelayEndpoint({ token: TOKEN, log })
  const server = createHttp(endpoint.handler)
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
  const url = 'http://127.0.0.1:' + String(server.address().port) + endpoint.path
  return {
    log,
    url,
    close: async () => { server.closeAllConnections(); server.close(); await log.close() },
  }
}

/** A child foreign end, with its stdout kept: the ready line, the wire lines and the summary. */
function startForeign(root, name, args) {
  const home = join(root, name)
  mkdirSync(home, { recursive: true })
  const proc = spawn(process.execPath, [FOREIGN, '--home', home, '--token', TOKEN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const state = { ready: null, wires: [], done: null, errors: [], proc, url: null, home }
  state.stderr = ''
  proc.stderr.on('data', (chunk) => { state.stderr += String(chunk) })
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let message = null
    try { message = JSON.parse(line) } catch { return }
    if (message.ready === true) { state.ready = message; state.url = 'http://127.0.0.1:' + String(message.port) + '/api/dsh-link-collab/relay' }
    if (message.wire !== undefined) state.wires.push(message)
    if (message.done === true) state.done = message
    if (message.dying === true) state.dying = message
  })
  state.stop = () => { try { proc.kill() } catch { /* already gone */ } }
  return state
}

/** Hand this end's own records to a peer's route, exactly as the page describes the client half. */
async function pushOwnTo(log, url) {
  const records = log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, ...(row.actor === undefined ? {} : { actor: row.actor }), ...(row.subject === undefined ? {} : { subject: row.subject }), ...(row.payload === undefined ? {} : { payload: row.payload }), at: row.at }))
  if (records.length === 0) return { status: 0, body: null, sent: 0 }
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ writer: log.writer, instance: log.instance, records }) })
  return { status: response.status, body: await response.json().catch(() => null), sent: records.length }
}

const fold = (C, log) => C.projectTeamState(log.replay())
const memberIds = (state) => state.members.map((row) => row.id).sort()
const hostsOf = (state, id) => state.hosting.hosts.filter((row) => row.id === id).map((row) => row.end + '/' + String(row.via))
const pathOf = (routes, id) => routes.find((row) => row.member === id)

/** World one and its readings: both ends join, work travels out and the answer travels back. */
async function worldTwoHops(C, root, foreignPath) {
  const a = await startOurEnd(C, root, 'end-A')
  const portT = await freePort()
  const portB = await freePort()
  const urlT = 'http://127.0.0.1:' + String(portT) + '/api/dsh-link-collab/relay'
  const urlB = 'http://127.0.0.1:' + String(portB) + '/api/dsh-link-collab/relay'
  const t = startForeign(root, 'T', ['--peer', a.url, '--forward', a.url + ',' + urlB, '--port', String(portT), '--writer', 'end-T', '--member', 'm-t', '--end', 'T-end', '--rounds', '900', '--beat-every', '200'])
  const b = startForeign(root, 'B', ['--peer', urlT, '--port', String(portB), '--writer', 'end-B', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--tool', 'sum', '--rounds', '900', '--beat-every', '200'])
  // The children are torn down in a finally: a failed assertion inside a world used to leave two live
  // node processes behind, which the next world would then have to fight for ports with.
  try {
  const seen = () => { const state = fold(C, a.log); return { state, ids: memberIds(state) } }
  const joined = await until(() => seen().ids.includes('m-b') && seen().ids.includes('m-t'), 12000)
  const after = seen()
  const now = Date.now()
  const routes = C.routes(after.state, 'end-A', now, { timeoutMs: 8000 })
  const routeB = pathOf(routes, 'm-b')
  const assign = C.assignThrough(after.state, 'team-1', 'm-b', 'end-A', now, { timeoutMs: 8000 })
  held(
    '1. both ends join through the transit: the far member is visible with its two-hop path',
    joined && after.ids.includes('m-t') && after.ids.includes('m-b') && JSON.stringify(hostsOf(after.state, 'm-b')) === JSON.stringify(['B-end/T-end']) && routeB !== undefined && JSON.stringify(routeB.path) === JSON.stringify(['end-A', 'T-end', 'B-end']) && routeB.hops === 2 && assign.ok === true && assign.hops === 2,
    'members=' + JSON.stringify(after.ids) + ' host=' + JSON.stringify(hostsOf(after.state, 'm-b')) + ' route=' + JSON.stringify(routeB) + ' assign=' + JSON.stringify(assign),
  )

  const resultsBefore = a.log.replay().filter((row) => row.kind === 'task/result').length
  await a.log.append(C.dispatchRecord('job-1', 'm-b', 'sum', { a: 40, b: 2 }, Date.now()))
  const pushed = await pushOwnTo(a.log, t.url)
  const answered = await until(() => C.resolveDispatch(fold(C, a.log), 'job-1', Date.now()).verdict === 'answered', 15000)
  const entry = fold(C, a.log).dispatches.dispatches.find((row) => row.id === 'job-1')
  const resultsAfter = a.log.replay().filter((row) => row.kind === 'task/result').length
  held(
    '2. work goes out two hops and the answer comes back two hops, with the ledger really gaining the answer',
    answered && entry !== undefined && entry.status === 'answered' && JSON.stringify(entry.result.value) === JSON.stringify({ sum: 42 }) && entry.result.from === 'm-b' && resultsAfter === resultsBefore + 1 && pushed.status === 200,
    'push=' + JSON.stringify(pushed.body) + ' result=' + JSON.stringify(entry ? entry.result : null) + ' results ' + String(resultsBefore) + '->' + String(resultsAfter),
  )
  const forwards = t.wires.filter((row) => Array.isArray(row.sent)).flatMap((row) => row.sent)
  // Both directions have to be visible in the transit's own account of what it sent, and they have to
  // be the peer's records regrouped under the peer's own name - a transit that forwarded its own page
  // would show neither (the reading below is why the naive world exists).
  const outbound = forwards.some((leg) => leg.to === urlB && leg.origin === 'end-A' && leg.status === 200 && leg.sent >= 1)
  const inbound = forwards.some((leg) => leg.to === a.url && leg.origin === 'end-B' && leg.status === 200 && leg.sent >= 1)
  held(
    '2b. the transit carried it both ways: the work out to the far end, the answer back to us',
    outbound && inbound,
    'out=' + String(outbound) + ' back=' + String(inbound) + ' last forwards=' + JSON.stringify(forwards.slice(-4)),
  )

  } finally {
    t.stop(); b.stop(); await a.close()
  }
  void foreignPath
}

/** World two: the transit that forwards its own page instead of regrouping carries nothing. */
async function worldNaiveTransit(C, root) {
  const a = await startOurEnd(C, root, 'end-A')
  const portT = await freePort()
  const portB = await freePort()
  const urlT = 'http://127.0.0.1:' + String(portT) + '/api/dsh-link-collab/relay'
  const urlB = 'http://127.0.0.1:' + String(portB) + '/api/dsh-link-collab/relay'
  const t = startForeign(root, 'T', ['--peer', a.url, '--forward', a.url + ',' + urlB, '--naive-forward', '--port', String(portT), '--writer', 'end-T', '--member', 'm-t', '--end', 'T-end', '--rounds', '400', '--beat-every', '200'])
  const b = startForeign(root, 'B', ['--peer', urlT, '--port', String(portB), '--writer', 'end-B', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--tool', 'sum', '--rounds', '400', '--beat-every', '200'])
  try {
  await sleep(6000)
  const state = fold(C, a.log)
  const ids = memberIds(state)
  const now = Date.now()
  const ghost = C.assignThrough(state, 'team-1', 'm-b', 'end-A', now, { timeoutMs: 8000 })
  const transit = C.assignThrough(state, 'team-1', 'm-t', 'end-A', now, { timeoutMs: 8000 })
  held(
    '3. the paired negative: a transit that forwards only its own page carries nothing, while it is itself visible',
    ids.includes('m-t') && !ids.includes('m-b') && ghost.reason === 'not-member' && ghost.ok === false && transit.ok === true,
    'members=' + JSON.stringify(ids) + ' far=' + JSON.stringify(ghost) + ' transit=' + JSON.stringify(transit),
  )
  } finally {
    t.stop(); b.stop(); await a.close()
  }
}

/** Worlds three and four: the two silences are two different answers, read at real instants. */
async function worldSilence(C, root, options) {
  const a = await startOurEnd(C, root, 'end-A')
  const portT = await freePort()
  const portB = await freePort()
  const urlT = 'http://127.0.0.1:' + String(portT) + '/api/dsh-link-collab/relay'
  const urlB = 'http://127.0.0.1:' + String(portB) + '/api/dsh-link-collab/relay'
  const tArgs = ['--peer', a.url, '--forward', a.url + ',' + urlB, '--port', String(portT), '--writer', 'end-T', '--member', 'm-t', '--end', 'T-end', '--rounds', '900']
  const bArgs = ['--peer', urlT, '--port', String(portB), '--writer', 'end-B', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--tool', 'sum', '--rounds', '900']
  const t = startForeign(root, 'T', options.transitBeats ? tArgs.concat(['--beat-every', '200']) : tArgs)
  const b = startForeign(root, 'B', options.endBeats ? bArgs.concat(['--beat-every', '200']) : bArgs)
  try {
  const timeoutMs = 3000
  const verdict = () => C.assignThrough(fold(C, a.log), 'team-1', 'm-b', 'end-A', Date.now(), { timeoutMs })
  const wanted = await until(() => { const state = fold(C, a.log); return memberIds(state).includes('m-b') && verdict().reason === options.expect }, 15000)
  const observed = verdict()
  held(
    options.name,
    wanted && observed.reason === options.expect && JSON.stringify(observed.path) === JSON.stringify(options.path) && observed.hops === options.hops,
    'verdict=' + JSON.stringify(observed) + ' transitBeats=' + String(options.transitBeats) + ' endBeats=' + String(options.endBeats),
  )
  } finally {
    t.stop(); b.stop(); await a.close()
  }
}

/** The page and its checker: green, its own count read back, and the two transit rows really there. */
async function readPage() {
  const outcome = spawnSync(process.execPath, [CHECKER, '--page', PAGE], { cwd: PROJECT, encoding: 'utf8' })
  const summary = (outcome.stdout + outcome.stderr).split(/\r?\n/).filter((line) => /citation\(s\) hold/.test(line))
  const page = readFileSync(PAGE, 'utf8')
  const hasRow = (id) => new RegExp('^\\| ' + id + ' \\|', 'm').test(page)
  held(
    '5. the page keeps its citations and the checker reports the count it checked',
    outcome.status === 0 && summary.length === 1 && hasRow('own-page-one-hop') && hasRow('regroup-helper'),
    'checker exit=' + String(outcome.status) + ' summary=' + JSON.stringify(summary) + ' rows=' + String(hasRow('own-page-one-hop')) + '/' + String(hasRow('regroup-helper')),
  )
}

async function plainRun() {
  const C = await import(MODULE)
  const root = mkdtempSync(join(tmpdir(), 'r59-multihop-'))
  await guard('1..2 (two hops)', () => worldTwoHops(C, root, FOREIGN))
  rmSync(join(root, 'T'), { recursive: true, force: true })
  rmSync(join(root, 'B'), { recursive: true, force: true })
  rmSync(join(root, 'end-A'), { recursive: true, force: true })
  await guard('3 (naive transit)', () => worldNaiveTransit(C, root))
  for (const name of ['T', 'B', 'end-A']) rmSync(join(root, name), { recursive: true, force: true })
  await guard('4a (transit silent)', () => worldSilence(C, root, { name: '4a. a silent transit answers route-down and the path stops at it', transitBeats: false, endBeats: true, expect: 'route-down', path: ['end-A', 'T-end'], hops: 1 }))
  for (const name of ['T', 'B', 'end-A']) rmSync(join(root, name), { recursive: true, force: true })
  await guard('4b (end silent)', () => worldSilence(C, root, { name: '4b. a live transit with a silent end answers member-silent on the whole path', transitBeats: true, endBeats: false, expect: 'member-silent', path: ['end-A', 'T-end', 'B-end'], hops: 2 }))
  for (const name of ['T', 'B', 'end-A']) rmSync(join(root, name), { recursive: true, force: true })
  await guard('5 (page)', () => readPage())
  rmSync(root, { recursive: true, force: true })
}

const MUTANTS = [
  { id: 'regroup-off', anchor: 'for (const row of accepted) {', replace: 'for (const row of accepted.filter(() => false)) {', declared: ['1. both ends join through the transit: the far member is visible with its two-hop path', '2. work goes out two hops and the answer comes back two hops, with the ledger really gaining the answer', '2b. the transit carried it both ways: the work out to the far end, the answer back to us', '4a. a silent transit answers route-down and the path stops at it', '4b. a live transit with a silent end answers member-silent on the whole path'], why: 'the transit stops regrouping, so a peer records never travel: the far member never joins, the work never arrives and the two silence readings have no route to judge' },
  { id: 'naive-made-clever', anchor: 'if (naiveForward) {', replace: 'if (false) {', declared: ['3. the paired negative: a transit that forwards only its own page carries nothing, while it is itself visible'], why: 'the naive forward mode starts regrouping, so the paired negative loses its negative' },
  { id: 'page-row-gone', kind: 'page', anchor: '| regroup-helper |', replace: '| regroup-helper-removed |', declared: ['5. the page keeps its citations and the checker reports the count it checked'], why: 'a row leaves the citation table: the checker still passes (it judges the rows it is given), so only the gate own coverage assertion can see it' },
  { id: 'via-erased', anchor: 'via: viaEnd === \'\' ? null : viaEnd', replace: 'via: null', declared: ['1. both ends join through the transit: the far member is visible with its two-hop path', '4a. a silent transit answers route-down and the path stops at it', '4b. a live transit with a silent end answers member-silent on the whole path'], why: 'the far end stops declaring the hop it is behind: the path is no longer two hops, and a transit that is no longer on the far end route stops being able to cut it' },
]

async function selfAttack() {
  const shipped = readFileSync(SHIPPED_FOREIGN, 'utf8')
  const shippedPage = readFileSync(join(PROJECT, 'docs', 'protocol', 'device-net-v1.md'), 'utf8')
  const matrix = []
  const baseline = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--plain-child', '--json'], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const baselineResults = JSON.parse(baseline.stdout.trim().split(/\r?\n/).pop())
  const baselineFailed = Object.entries(baselineResults).filter(([, ok]) => ok !== true).map(([name]) => name)
  if (baselineFailed.length > 0) {
    console.log('self-attack: the unmutated run is not green (' + JSON.stringify(baselineFailed) + '), so no mutant can be trusted')
    process.exit(1)
  }
  let mismatches = 0
  for (const mutant of MUTANTS) {
    const source = mutant.kind === 'page' ? shippedPage : shipped
    if (!source.includes(mutant.anchor)) { console.log('  FAIL  ' + mutant.id + ': ANCHOR MISSING in the shipped artifact (' + mutant.kind + ')'); mismatches += 1; continue }
    const dir = mkdtempSync(join(tmpdir(), 'r59-mutant-'))
    const path = join(dir, mutant.kind === 'page' ? 'page.md' : 'foreign-end.mjs')
    writeFileSync(path, source.replace(mutant.anchor, mutant.replace))
    const extra = mutant.kind === 'page' ? ['--page', path] : ['--foreign', path]
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--plain-child', '--json', ...extra], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    rmSync(dir, { recursive: true, force: true })
    let observed = null
    try { observed = JSON.parse(run.stdout.trim().split(/\r?\n/).pop()) } catch { observed = null }
    if (observed === null) { console.log('  FAIL  ' + mutant.id + ': the mutated run printed no result'); mismatches += 1; continue }
    // A reading that the mutant broke so early that it never registered at all counts as moved - it
    // certainly does not hold - but the report keeps the two apart, because 'never reached' and 'ran and
    // reddened' are different evidence about how the mutant works.
    const names = Object.keys(baselineResults)
    const neverRan = names.filter((name) => observed[name] === undefined).sort()
    const flipped = names.filter((name) => baselineResults[name] === true && observed[name] !== true).sort()
    const declared = [...mutant.declared].sort()
    const same = JSON.stringify(flipped) === JSON.stringify(declared)
    if (!same) mismatches += 1
    matrix.push({ id: mutant.id, flipped, neverRan, declared, same })
    console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + mutant.id + '  flipped=' + JSON.stringify(flipped) + ' declared=' + JSON.stringify(declared) + (neverRan.length === 0 ? '' : '  never-reached=' + JSON.stringify(neverRan)))
  }
  const covered = new Set(matrix.flatMap((row) => row.flipped))
  const uncovered = Object.keys(baselineResults).filter((name) => !covered.has(name))
  console.log('coverage matrix: ' + String(Object.keys(baselineResults).length) + ' declared readings, ' + String(covered.size) + ' moved by at least one mutant, uncovered=' + JSON.stringify(uncovered))
  const ok = mismatches === 0 && uncovered.length === 0
  console.log(ok ? 'self-attack held: every declared set matched and every reading moved' : 'self-attack failed: ' + String(mismatches) + ' declared-set mismatch(es)')
  process.exit(ok ? 0 : 1)
}

if (argv.includes('--self-attack')) selfAttack().catch((error) => { console.error('self-attack threw: ' + String(error)); process.exit(1) })
else {
  await plainRun()
  if (AS_JSON || CHILD) { console.log(JSON.stringify(Object.fromEntries(readings.map((row) => [row.name, row.ok])))) }
  else {
    for (const row of readings) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.name + '  |  ' + row.detail)
    const failed = readings.filter((row) => !row.ok).length
    console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
    process.exit(failed === 0 ? 0 : 1)
  }
}
