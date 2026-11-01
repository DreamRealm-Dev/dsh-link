#!/usr/bin/env node
/**
 * R54-B self-check: dispatch batches and results over a REAL HTTP loopback.
 *
 * The in-process fold proves the rules; it cannot prove that a peer reaches them. So this harness
 * mounts the shipped relay endpoint on two plain \`node:http\` servers and pushes the records across a
 * real socket in both directions:
 *
 *   A  the factory itself   createRelayEndpoint refuses an unusable token, keeps the shipped path, and
 *                           applies an authorised batch over the wire while an unauthorised one leaves
 *                           the ledger byte-identical
 *   B  two ends, one job    A pushes a dispatch batch to B, B executes it, B pushes the result batch
 *                           back to A, and both ends fold the same dispatch byte-identically
 *
 * Run:  node plugins/dsh-link-collab/test/relay-push-dispatch.mjs
 * Exit: 0 every reading held; 1 a reading failed; 2 the plugin is not built.
 */

import { createServer, request as httpRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENTRY = new URL('../lib/index.js', import.meta.url)
if (!existsSync(ENTRY)) {
  console.error('the plugin is not built: ' + ENTRY.pathname)
  process.exit(2)
}
const mod = await import(ENTRY.href)

const ROUTE = '/api/dsh-link-collab/relay'
const TOKEN = 'r54-token-' + Date.now().toString(36)
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const dumps = (value) => JSON.stringify(value)
const isDump = (value, expected) => dumps(value) === dumps(expected)
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
const ledgerOf = (dir) => {
  const file = join(dir, 'control.jsonl')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))

/** Mount one plugin instance on its own real HTTP server, exactly as the kernel would. */
const mount = async (label) => {
  const dir = mkdtempSync(join(tmpdir(), 'r54-relay-' + label + '-'))
  let capability = null
  let route = null
  const seen = { requests: 0, byRoute: 0 }
  const server = createServer((req, res) => {
    seen.requests += 1
    if (route !== null && req.url === route.path) { seen.byRoute += 1; void route.handler(req, res); return }
    res.statusCode = 404
    res.end('no route')
  })
  const stub = { register: (value) => { route = value; return () => { route = null } } }
  mod.apply({
    get: (name) => (name === 'dshHomePath' ? () => dir : undefined),
    provide: (name, value) => { if (name === 'linkCollab') capability = value },
    effect: (work) => { work() },
    inject: (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) }),
  }, { relay: { token: TOKEN, path: ROUTE } })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return {
    dir,
    seen,
    server,
    url: 'http://127.0.0.1:' + String(server.address().port) + ROUTE,
    route: () => route,
    capability: () => capability,
    close: async () => {
      await new Promise((done) => server.close(done))
      await capability?.log.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const post = async (url, body, token) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: 'Bearer ' + token }) },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

// ------------------------------------------------------------ A: the factory, over the wire
{
  const dir = mkdtempSync(join(tmpdir(), 'r54-factory-'))
  const log = mod.openControlLog({ dir })
  let refusedEmpty = null
  let refusedBlank = null
  try { mod.createRelayEndpoint({ token: '', log }) } catch (error) { refusedEmpty = error.constructor.name }
  try { mod.createRelayEndpoint({ token: '   ', log }) } catch (error) { refusedBlank = error.constructor.name }
  const endpoint = mod.createRelayEndpoint({ token: TOKEN, log })
  record('A the factory refuses a token that cannot be presented',
    refusedEmpty === 'TypeError' && refusedBlank === 'TypeError' && endpoint.path === ROUTE,
    'empty=' + String(refusedEmpty) + ' blank=' + String(refusedBlank) + ' path=' + endpoint.path)

  const seen = { requests: 0, byRoute: 0 }
  const server = createServer((req, res) => {
    seen.requests += 1
    if (req.url === endpoint.path) { seen.byRoute += 1; void endpoint.handler(req, res); return }
    res.statusCode = 404
    res.end('no route')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const url = 'http://127.0.0.1:' + String(server.address().port) + endpoint.path
  const batch = (writer, instance, rows) => ({ writer, instance, records: rows })
  const rows = [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } }]

  // The ledger has to exist and be non-empty before the refusal, or "it did not move" would be a
  // statement about a file that was never written.
  const landedFirst = await post(url, batch('peer-0', 'peer-1', [{ seq: 1, kind: 'task/state', actor: 'team-0', payload: { id: 't0', state: 'open' } }]), TOKEN)
  const before = ledgerOf(dir)
  const denied = await post(url, batch('peer-x', 'peer-1', rows), 'not-the-token')
  const silent = await post(url, batch('peer-x', 'peer-1', rows))
  const afterDenied = ledgerOf(dir)
  const landed = await post(url, batch('peer-x', 'peer-1', rows), TOKEN)
  // Paired on purpose: a ledger that never changed because nothing was ever accepted would read the
  // same as "the refusal left it alone", and this reading has to tell the two apart.
  record('A an authorised batch lands, an unauthorised one is refused, and the ledger does not move',
    landedFirst.body?.appended === 1 && before !== '' && denied.status === 401 && silent.status === 401
    && denied.body?.code === 'UNAUTHORIZED' && afterDenied === before
    && landed.status === 200 && landed.body?.appended === 1,
    'first=' + String(landedFirst.body?.appended) + ' denied=' + String(denied.status) + '/' + String(denied.body?.code)
    + ' anonymous=' + String(silent.status) + ' unchanged=' + String(before === afterDenied)
    + ' thenAccepted=' + String(landed.body?.appended) + ' ledger=' + sha(afterDenied))

  // One reading that really reads the socket: a raw http.request, so a fetch that silently bypassed the
  // server could not make the numbers above look like a network exchange.
  const raw = await new Promise((done) => {
    const body = JSON.stringify(batch('peer-y', 'peer-1', [{ seq: 1, kind: 'task/state', actor: 'team-B', payload: { id: 't2', state: 'open' } }]))
    const request = httpRequest({ host: '127.0.0.1', port: server.address().port, path: endpoint.path, method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, 'content-length': Buffer.byteLength(body) } }, (response) => {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => done({ status: response.statusCode, body: JSON.parse(text) }))
    })
    request.end(body)
  })
  record('A the endpoint answers a real loopback socket',
    raw.status === 200 && raw.body?.appended === 1 && seen.requests >= 4 && seen.byRoute >= 4,
    'status=' + String(raw.status) + ' appended=' + String(raw.body?.appended) + ' requests=' + String(seen.requests) + ' routed=' + String(seen.byRoute))

  const pushed = await endpoint.relayTo(url, batch('peer-z', 'peer-1', [{ seq: 1, kind: 'task/state', actor: 'team-C', payload: { id: 't3', state: 'open' } }]))
  const pushedWrong = await endpoint.relayTo(url, batch('peer-w', 'peer-1', [{ seq: 1, kind: 'task/state', actor: 'team-D', payload: { id: 't4', state: 'open' } }]), { token: 'not-the-token' })
  record('A the factory client pushes with its own token and is refused with another',
    pushed.ok === true && pushed.appended === 1 && pushedWrong.ok === false && pushedWrong.code === 'UNAUTHORIZED',
    'ok=' + dumps(pushed) + ' wrong=' + dumps(pushedWrong))

  await new Promise((done) => server.close(done))
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------------------------ B: two ends, one dispatched job
{
  const a = await mount('a')
  const b = await mount('b')
  const now = 4_000
  const alog = a.capability().log
  const blog = b.capability().log

  await alog.append(mod.capabilityRecord('worker', ['echo']))
  await alog.append(mod.dispatchRecord('job-1', 'worker', 'echo', { say: 'hello' }, now))

  // Both ends run in one process, and a log's default writer name is the constant 'local', so each
  // end relays under its own name. On two devices those names differ anyway; here the relay identity
  // is what keeps one end from being read as the other's rewritten ledger.
  const pushed = await a.capability().relayTo({ url: b.url, token: TOKEN, as: { writer: 'end-a', instance: alog.instance } })
  const bHolds = mod.projectDispatches(blog.replay())
  record('B the dispatch batch reaches B over the network',
    pushed.ok === true && pushed.appended === 2 && b.seen.byRoute >= 1 && bHolds.dispatches.length === 1
    && bHolds.dispatches[0].status === 'pending' && bHolds.pending.join(',') === 'job-1',
    'push=' + dumps(pushed) + ' routed=' + String(b.seen.byRoute) + ' bFold=' + dumps(bHolds.dispatches.map((row) => row.id + ':' + row.status)))

  const bState = mod.projectTeamState(blog.replay())
  record('B the dispatch is stale-free before any threshold is given, and stale exactly at the boundary',
    mod.resolveDispatch(bState, 'job-1', now + 900).verdict === 'pending'
    && mod.resolveDispatch(bState, 'job-1', now + 1_000, { timeoutMs: 1_000 }).verdict === 'stale'
    && mod.resolveDispatch(bState, 'job-1', now + 999, { timeoutMs: 1_000 }).verdict === 'pending'
    && mod.expiredDispatches(bState, now + 1_000, { timeoutMs: 1_000 }).join(',') === 'job-1',
    'noThreshold=' + mod.resolveDispatch(bState, 'job-1', now + 10 ** 6).verdict
    + ' atBoundary=' + mod.resolveDispatch(bState, 'job-1', now + 1_000, { timeoutMs: 1_000 }).verdict
    + ' expired=' + dumps(mod.expiredDispatches(bState, now + 1_000, { timeoutMs: 1_000 })))

  const tools = mod.createLocalTools()
  const off = tools.register('echo', (args) => ({ echoed: args }))
  const exec = await mod.executeDispatches(bState, { local: 'worker', tools, log: blog, now: now + 10 })
  off()
  const bAfter = mod.projectDispatches(blog.replay())
  record('B the addressed end runs the tool and writes exactly one answer',
    exec.executed.length === 1 && exec.executed[0].id === 'job-1' && exec.executed[0].outcome.ok === true
    && exec.refused.length === 0 && bAfter.results.length === 1 && bAfter.pending.length === 0,
    'executed=' + dumps(exec.executed.map((row) => row.id + ':' + row.reason)) + ' refused=' + dumps(exec.refused) + ' results=' + String(bAfter.results.length))

  const back = await b.capability().relayTo({ url: a.url, token: TOKEN, as: { writer: 'end-b', instance: blog.instance } })
  const aFold = mod.projectDispatches(alog.replay())
  const aEntry = aFold.dispatches.find((row) => row.id === 'job-1')
  record('B the result batch comes back and A folds the dispatch as answered',
    back.ok === true && back.appended === 1 && a.seen.byRoute >= 1 && aEntry !== undefined
    && aEntry.status === 'answered' && dumps(aEntry.result.value) === dumps({ echoed: { say: 'hello' } }),
    'push=' + dumps(back) + ' routed=' + String(a.seen.byRoute) + ' aFold=' + dumps(aEntry === undefined ? null : { id: aEntry.id, status: aEntry.status, value: aEntry.result === null ? null : aEntry.result.value }))

  const aLedger = ledgerOf(a.dir)
  const bLedger = ledgerOf(b.dir)
  const aView = mod.projectTeamState(alog.replay()).dispatches
  const bView = mod.projectTeamState(blog.replay()).dispatches
  // The two ledgers hold the same records in the same order with the same cross-end numbers; they
  // differ in the writer name the relay attributed each batch to ('end-a'/'end-b' versus each log's
  // own 'local'), which is the relay identity and not the dispatch. Stated rather than hidden: the
  // reading below is about the FOLD, and the record parity is reported beside it.
  const triples = (text) => text.split('\n').filter((line) => line !== '').map((line) => {
    const row = JSON.parse(line)
    return row.seq + '/' + row.kind + '/' + row.originSeq
  }).join(',')
  const writers = (text) => [...new Set(text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line).writer))].join('+')
  record('B both ends fold the same dispatch byte-identically',
    aLedger !== '' && bLedger !== '' && dumps(aView) === dumps(bView)
    && aView.dispatches.length === 1 && aView.dispatches[0].status === 'answered'
    && triples(aLedger) === triples(bLedger),
    'folds=' + String(dumps(aView) === dumps(bView)) + ' fold=' + dumps(aView.dispatches.map((row) => row.id + ':' + row.status + ':' + row.seq))
    + ' records=' + triples(aLedger) + ' / ' + triples(bLedger) + ' writers=' + writers(aLedger) + '/' + writers(bLedger))

  // Order independence, asked of the same records the network delivered: a fold that depends on
  // arrival order would make every comparison above an accident of the socket.
  const shuffled = [...blog.replay()].reverse()
  record('B the fold ignores the order the relay delivered the records in',
    dumps(mod.projectDispatches(shuffled)) === dumps(bAfter),
    'reversedFold=' + String(dumps(mod.projectDispatches(shuffled)) === dumps(bAfter)))

  const beforeLedger = ledgerOf(a.dir)
  const wrong = await post(a.url, { writer: 'peer-q', instance: 'peer-9', records: [{ seq: 1, kind: 'task/dispatch', payload: { id: 'job-9', to: 'worker', tool: 'echo', args: {}, at: now } }] }, 'not-the-token')
  await wait(50)
  record('B an unauthorised push cannot add a dispatch, and the ledger does not move',
    wrong.status === 401 && wrong.body?.code === 'UNAUTHORIZED' && ledgerOf(a.dir) === beforeLedger
    && mod.projectDispatches(alog.replay()).dispatches.length === 1,
    'status=' + String(wrong.status) + '/' + String(wrong.body?.code) + ' unchanged=' + String(ledgerOf(a.dir) === beforeLedger)
    + ' dispatches=' + String(mod.projectDispatches(alog.replay()).dispatches.length))

  await a.close()
  await b.close()
}

const failed = results.filter((row) => !row.ok)
console.log('')
console.log((failed.length === 0 ? 'PASS' : 'FAIL') + '  ' + String(results.length - failed.length) + '/' + String(results.length) + ' readings held')
for (const row of failed) console.log('  failed: ' + row.name)
process.exit(failed.length === 0 ? 0 : 1)
