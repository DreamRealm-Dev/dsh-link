#!/usr/bin/env node
/**
 * R56 self-check: MCP tools reached by a real dispatched unit of work.
 *
 * The two halves this joins are already shipped and already proven: R53/R54 hand work over a real HTTP
 * loopback, R55 runs a real MCP server as a child process. What is read here is the join — the tools a
 * server listed become tools a dispatch executes, and every way that call can fail still leaves the
 * dispatch with an answer written into the ledger.
 *
 * Run:  node plugins/dsh-link-collab/test/mcp-dispatch-selfcheck.mjs
 * Exit: 0 every reading held; 1 a reading failed; 2 the plugin is not built.
 */

import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(HERE, '..', 'lib', 'index.js')
if (!existsSync(ENTRY)) {
  console.error('the plugin is not built: ' + ENTRY)
  process.exit(2)
}
const mod = await import('file:///' + ENTRY.replaceAll(String.fromCharCode(92), '/'))
const FIXTURE = join(HERE, 'mcp-fixture-server.mjs')
const NL = String.fromCharCode(10)
const TTY = String.fromCharCode(9)
const ROUTE = '/api/dsh-link-collab/relay'
const TOKEN = 'r56-token-' + Date.now().toString(36)
const ADAPTER = 'mcp-adapter'
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const dumps = (value) => JSON.stringify(value)
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))
const ROOT = mkdtempSync(join(tmpdir(), 'r56-selfcheck-'))
let counter = 0
const slot = () => {
  counter += 1
  return { seq: join(ROOT, 'seq-' + String(counter) + '.jsonl'), wire: join(ROOT, 'wire-' + String(counter) + '.jsonl'), trace: join(ROOT, 'trace-' + String(counter) + '.jsonl') }
}
const fixtureSpec = (flags, files) => ({ command: process.execPath, args: [FIXTURE, '--seq', files.seq, '--wire', files.wire, '--trace', files.trace, ...flags] })
const methods = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split(NL).filter((line) => line !== '').map((line) => JSON.parse(line).method) : [])
const alive = (pid) => {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
const MULTILINE = ['line one', 'line two' + TTY + 'tabbed'].join(NL)

/** Mount one plugin instance on its own real HTTP server, exactly as the kernel would. */
const mount = async (label) => {
  const dir = mkdtempSync(join(ROOT, 'end-' + label + '-'))
  let capability = null
  let route = null
  const server = createServer((req, res) => {
    if (route !== null && req.url === route.path) { void route.handler(req, res); return }
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
    url: 'http://127.0.0.1:' + String(server.address().port) + ROUTE,
    capability: () => capability,
    close: async () => {
      await new Promise((done) => server.close(done))
      await capability?.log.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** One throwaway ledger with a capability declared for the adapter. */
const ledger = async () => {
  const dir = mkdtempSync(join(ROOT, 'ledger-'))
  const log = mod.openControlLog({ dir })
  return { dir, log, close: async () => { await log.close(); rmSync(dir, { recursive: true, force: true }) } }
}

// ------------------------------------------------------------------ S0 (B7): the mapping, row by row
{
  const row = (verdict, extra) => mod.mcpDispatchOutcome({ verdict, content: [], isError: false, ...extra })
  const mapped = {
    ok: row('ok', { content: [{ type: 'text', text: 'kept' }, { type: 'image', data: 'aGk=', mimeType: 'image/png' }] }),
    toolError: row('tool-error', { content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }, { type: 'text', text: 'Something went wrong' }], isError: true }),
    unknown: row('unknown-tool', { code: -32602 }),
    protocol: row('protocol-error'),
    transport: row('transport-error', { reason: 'malformed-frame' }),
    timeout: row('timeout'),
  }
  const threw = []
  for (const bad of [{ verdict: 'ok-ish' }, { verdict: '' }, {}, { verdict: 7 }, null]) {
    try { mod.mcpDispatchOutcome(bad); threw.push('no-throw:' + dumps(bad)) } catch (error) { threw.push(error.constructor.name) }
  }
  record('S0 every verdict in the closed set maps by name, and anything else throws',
    mapped.ok.ok === true && dumps(mapped.ok.value) === dumps({ content: [{ type: 'text', text: 'kept' }, { type: 'image', data: 'aGk=', mimeType: 'image/png' }], isError: false })
    && mapped.toolError.ok === false && mapped.toolError.error === 'Something went wrong'
    && mapped.unknown.error === 'unknown-tool' && mapped.protocol.error === 'protocol-error'
    && mapped.transport.error === 'transport-error:malformed-frame' && mapped.timeout.error === 'timeout'
    && dumps(threw) === dumps(['TypeError', 'TypeError', 'TypeError', 'TypeError', 'TypeError']),
    'ok=' + dumps(mapped.ok.value) + ' toolError=' + dumps(mapped.toolError) + ' unknown=' + dumps(mapped.unknown)
    + ' transport=' + dumps(mapped.transport) + ' timeout=' + dumps(mapped.timeout) + ' outOfSet=' + dumps(threw))
}

// ------------------------------------------------------------------ S1 (B1/B10): end to end, over the network
{
  const a = await mount('a')
  const b = await mount('b')
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec([], files), timeoutMs: 8_000 })
  const handshake = await client.initialize()
  const listed = await client.listTools()
  const pid = client.pid
  const aliveBefore = alive(pid)
  const alog = a.capability().log
  const blog = b.capability().log
  const names = listed.tools.map((tool) => tool.name).sort()
  await alog.append(mod.capabilityRecord(ADAPTER, names))
  await alog.append(mod.dispatchRecord('job-nl', ADAPTER, 'nl', {}, 5_000))
  const pushed = await a.capability().relayTo({ url: b.url, token: TOKEN, as: { writer: 'end-a', instance: alog.instance } })

  const tools = mod.createLocalTools()
  const dispose = mod.installMcpTools(tools, listed.tools, client)
  const bRun = await mod.executeDispatches(mod.projectTeamState(blog.replay()), { local: ADAPTER, tools, log: blog, now: 6_000 })
  dispose()
  const back = await b.capability().relayTo({ url: a.url, token: TOKEN, as: { writer: 'end-b', instance: blog.instance } })
  const aEntry = mod.projectDispatches(alog.replay()).dispatches.find((entry) => entry.id === 'job-nl')
  const text = aEntry?.result?.value?.content?.[0]?.text
  record('S1 a dispatched unit of work runs an MCP tool in another process and its text folds back byte for byte',
    handshake.verdict === 'ok' && typeof pid === 'number' && aliveBefore
    && pushed.ok === true && pushed.appended === 2
    && bRun.executed.length === 1 && bRun.executed[0].outcome.ok === true
    && back.ok === true && back.appended === 1
    && aEntry !== undefined && aEntry.status === 'answered' && text === MULTILINE && text.includes(NL),
    'pid=' + String(pid) + ' tools=' + dumps(names) + ' pushed=' + dumps(pushed) + ' executed=' + dumps(bRun.executed.length)
    + ' back=' + dumps(back) + ' fold=' + aEntry?.status + ' textEqual=' + String(text === MULTILINE))
  await client.close()
  await wait(60)
  record('S10 the MCP server was a real child process, and close() removes it',
    aliveBefore === true && alive(pid) === false,
    'aliveBeforeClose=' + String(aliveBefore) + ' aliveAfterClose=' + String(alive(pid)))
  await a.close()
  await b.close()
}

/** Run one dispatch against one MCP server, and report what the ledger says afterwards. */
const dispatchOnce = async (tool, options) => {
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec(options.flags ?? [], files), timeoutMs: options.timeoutMs ?? 6_000 })
  if (options.initialize !== false) await client.initialize()
  const listed = options.initialize === false ? [] : (await client.listTools()).tools
  const table = await ledger()
  await table.log.append(mod.capabilityRecord(ADAPTER, [tool]))
  await table.log.append(mod.dispatchRecord('job-1', ADAPTER, tool, options.args ?? {}, 5_000))
  const tools = mod.createLocalTools()
  const dispose = mod.installMcpTools(tools, options.install ?? listed ?? [], client)
  const started = Date.now()
  const run = await mod.executeDispatches(mod.projectTeamState(table.log.replay()), { local: ADAPTER, tools, log: table.log, now: 5_100 })
  const elapsed = Date.now() - started
  dispose()
  const folded = mod.projectDispatches(table.log.replay())
  const entry = folded.dispatches.find((row) => row.id === 'job-1')
  await client.close()
  await table.close()
  return { run, entry, elapsed, methods: methods(files.seq) }
}

// ------------------------------------------------------------------ S2 (B2): a tool that failed
{
  const one = await dispatchOnce('fail', {})
  record('S2 a tool that reported failure still leaves the dispatch answered, with the server text as the error',
    one.entry?.status === 'answered' && one.entry.result.ok === false && one.entry.result.error === 'Something went wrong'
    && one.run.executed[0]?.outcome.ok === false,
    'status=' + String(one.entry?.status) + ' result=' + dumps(one.entry?.result === null || one.entry?.result === undefined ? null : { ok: one.entry.result.ok, error: one.entry.result.error }))
}

// ------------------------------------------------------------------ S3 (B3): a tool the server does not know
{
  const one = await dispatchOnce('ghost', { install: [{ name: 'ghost', description: null, inputSchema: null }] })
  record('S3 a protocol-level unknown tool is answered too, named unknown-tool',
    one.entry?.status === 'answered' && one.entry.result.ok === false && one.entry.result.error === 'unknown-tool',
    'status=' + String(one.entry?.status) + ' error=' + String(one.entry?.result?.error))
}

// ------------------------------------------------------------------ S4 (B4): the answer never comes
{
  const one = await dispatchOnce('slow', { flags: ['--slow-ms', '3000'], timeoutMs: 200 })
  record('S4 a call that never answers in time is answered as timeout, within a bound',
    one.entry?.status === 'answered' && one.entry.result.error === 'timeout' && one.elapsed < 1_500,
    'status=' + String(one.entry?.status) + ' error=' + String(one.entry?.result?.error) + ' elapsedMs=' + String(one.elapsed))
}

// ------------------------------------------------------------------ S5 (B5): the transport dies, and the latch names itself
{
  const died = await dispatchOnce('crash', { flags: ['--hangup', 'crash'] })
  // The latch is read through a tool that WAS installed: with the stream latched the server can no
  // longer list anything, so the name has to be installed explicitly or the registry would refuse the
  // dispatch for its own reason and the latch would never be reached.
  const latched = await dispatchOnce('add', { flags: ['--malformed'], install: [{ name: 'add', description: null, inputSchema: null }] })
  record('S5 a dead server and a latched stream both answer the dispatch, and the reason reads at the result',
    died.entry?.status === 'answered' && died.entry.result.ok === false && died.entry.result.error === 'transport-error:server-exited' && died.elapsed < 1_500
    && latched.entry?.status === 'answered' && latched.entry.result.ok === false && latched.entry.result.error === 'transport-error:malformed-frame' && latched.elapsed < 1_500,
    'died=' + String(died.entry?.result?.error) + '/' + String(died.elapsed) + 'ms latched=' + String(latched.entry?.result?.error) + '/' + String(latched.elapsed) + 'ms')
}

// ------------------------------------------------------------------ S6 (B6): capability is decided in the projection
{
  // The dispatch names a tool the capability ledger never recorded, so the fold refuses it — and the
  // reading that matters is the negative one: the MCP server never receives a request for it.
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const table = await ledger()
  await table.log.append(mod.dispatchRecord('job-1', ADAPTER, 'add', { a: 1, b: 2 }, 5_000))
  const tools = mod.createLocalTools()
  const dispose = mod.installMcpTools(tools, [{ name: 'add', description: null, inputSchema: null }], client)
  const run = await mod.executeDispatches(mod.projectTeamState(table.log.replay()), { local: ADAPTER, tools, log: table.log, now: 5_100 })
  const refused = mod.projectDispatches(table.log.replay()).refusedDispatches.map((row) => row.reason)
  const untouched = methods(files.seq)
  // Paired: the same wiring with the capability recorded does reach the server, so "the server saw
  // nothing" is evidence about this dispatch and not about a client that never worked.
  await table.log.append(mod.capabilityRecord(ADAPTER, ['add']))
  await table.log.append(mod.dispatchRecord('job-2', ADAPTER, 'add', { a: 1, b: 2 }, 5_200))
  const second = await mod.executeDispatches(mod.projectTeamState(table.log.replay()), { local: ADAPTER, tools, log: table.log, now: 5_300 })
  const reached = methods(files.seq)
  dispose()
  await client.close()
  await table.close()
  record('S6 a tool that is not in the capability ledger is refused without the MCP server ever seeing the call',
    run.executed.length === 0 && run.refused.length === 0 && dumps(refused) === dumps(['capability-mismatch'])
    && !untouched.includes('tools/call')
    && second.executed.length === 2 && reached.filter((method) => method === 'tools/call').length === 2,
    'refused=' + dumps(refused) + ' seqBefore=' + dumps(untouched) + ' seqAfter=' + dumps(reached))
}

// ------------------------------------------------------------------ S7 (B8): the disposer is exact
{
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const listed = (await client.listTools()).tools
  const tools = mod.createLocalTools()
  const previous = []
  // The registry owns the outcome shape and a handler owns the value (R62 restored this convention
  // after R56 briefly let handlers return outcomes — and a plain handler's success was then written to
  // the ledger as a failure). This line encoded the broken convention; it returns the value now.
  tools.register('add', () => { previous.push('the handler that was there before'); return 'previous' })
  const dispose = mod.installMcpTools(tools, listed, client)
  const installed = listed.map((tool) => tools.has(tool.name))
  const foreign = listed.slice(1).map((tool) => tool.name)
  const installedCall = await tools.invoke('add', { a: 2, b: 2 })
  dispose()
  const afterFirst = listed.map((tool) => tools.has(tool.name))
  const restored = await tools.invoke('add', { a: 2, b: 2 })
  let threw = null
  try { dispose() } catch (error) { threw = String(error) }
  const untouched = tools.has('never-installed')
  await client.close()
  record('S8 installing replaces, and the disposer removes exactly what it installed and restores what it replaced',
    installed.every(Boolean) === true
    && afterFirst[0] === true && afterFirst.slice(1).every((value) => value === false)
    && installedCall.ok === true && dumps(installedCall.value) === dumps({ content: [{ type: 'text', text: '4' }], isError: false })
    && restored.ok === true && restored.value === 'previous' && previous.length === 1
    && threw === null && untouched === false,
    'installed=' + dumps(installed.length) + ' afterDispose=' + dumps(afterFirst) + ' foreign=' + dumps(foreign)
    + ' installedCall=' + dumps(installedCall)
    + ' restored=' + dumps(restored) + ' secondDisposeThrew=' + String(threw))
}

// ------------------------------------------------------------------ S9 (B9): one vocabulary, three record kinds
{
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const listed = (await client.listTools()).tools
  await client.close()
  const records = mod.mcpToolRecords(ADAPTER, listed)
  const reference = mod.capabilityRecord(ADAPTER, listed.map((tool) => tool.name))
  const table = await ledger()
  await table.log.append(mod.capabilityRecord(ADAPTER, ['add']))
  await table.log.append(mod.dispatchRecord('job-1', ADAPTER, 'add', {}, 5_000))
  await table.log.append(mod.resultRecord('job-1', ADAPTER, { ok: true, value: 1 }, 5_100))
  const kinds = [...new Set(table.log.replay().map((row) => row.kind))].sort()
  await table.close()
  record('S9 MCP tools enter the ledger through capabilityRecord only, with no third record kind',
    records.length === 1 && dumps(records[0]) === dumps(reference)
    && dumps(kinds) === dumps(['capability/state', 'task/dispatch', 'task/result']),
    'identical=' + String(dumps(records[0]) === dumps(reference)) + ' kinds=' + dumps(kinds))
}

// ------------------------------------------------------------------ S9b: an uninitialized client is decidable
{
  const files = slot()
  const client = mod.createMcpClient({ server: fixtureSpec([], files), timeoutMs: 1_500 })
  const tools = mod.createLocalTools()
  const dispose = mod.installMcpTools(tools, [{ name: 'add', description: null, inputSchema: null }], client)
  let threw = null
  let outcome = null
  try { outcome = await tools.invoke('add', { a: 1, b: 1 }) } catch (error) { threw = String(error) }
  dispose()
  await client.close()
  // The requirement is decidability, not a particular verdict: a client that was never handshaked must
  // yield a DispatchOutcome (here the fixture answers anyway) instead of throwing at the caller.
  const decidable = outcome !== null && typeof outcome === 'object' && typeof outcome.ok === 'boolean'
    && (outcome.ok === true ? 'value' in outcome : typeof outcome.error === 'string')
  record('S9b a client that was never initialized still answers decisively rather than throwing',
    threw === null && decidable,
    'threw=' + String(threw) + ' outcome=' + dumps(outcome))
}

rmSync(ROOT, { recursive: true, force: true })
const failed = results.filter((row) => !row.ok)
console.log('')
console.log((failed.length === 0 ? 'PASS' : 'FAIL') + '  ' + String(results.length - failed.length) + '/' + String(results.length) + ' readings held')
for (const row of failed) console.log('  failed: ' + row.name)
process.exit(failed.length === 0 ? 0 : 1)
