#!/usr/bin/env node
/**
 * R55 self-check: an MCP server really wired into our ledger.
 *
 * Every reading below runs the peer as a REAL child process (--seq/--wire files are the fixture's own
 * notes about what went over the wire), and each shape is asserted in both directions: a positive that
 * says it happened beside the negative that says the wrong thing did not. The wire rules come from
 * docs/research/mcp-stdio-wire.md, not from memory.
 *
 * Run:  node plugins/dsh-link-collab/test/mcp-stdio-selfcheck.mjs
 * Exit: 0 every reading held; 1 a reading failed; 2 the plugin is not built.
 */

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
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const dumps = (value) => JSON.stringify(value)
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))
const ROOT = mkdtempSync(join(tmpdir(), 'r55-selfcheck-'))
let counter = 0
const slot = () => {
  counter += 1
  return {
    seq: join(ROOT, 'seq-' + String(counter) + '.jsonl'),
    wire: join(ROOT, 'wire-' + String(counter) + '.jsonl'),
    trace: join(ROOT, 'trace-' + String(counter) + '.jsonl'),
  }
}
const spec = (flags, files) => ({ command: process.execPath, args: [FIXTURE, '--seq', files.seq, '--wire', files.wire, '--trace', files.trace, ...flags] })
const alive = (pid) => {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split(NL).filter((line) => line !== '') : [])
const methods = (path) => lines(path).map((line) => JSON.parse(line).method)

// ------------------------------------------------------------------ R0: the factory's own refusals
{
  let refused = null
  try { mod.createMcpClient({ server: { command: '' } }) } catch (error) { refused = error.constructor.name }
  record('R0 a client without a server command is refused at construction',
    refused === 'TypeError' && typeof mod.MCP_PROTOCOL_VERSION === 'string' && mod.MCP_PROTOCOL_VERSION === '2025-06-18',
    'refused=' + String(refused) + ' version=' + String(mod.MCP_PROTOCOL_VERSION))
}

// ------------------------------------------------------------------ R1/R11a: real child, handshake order
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec([], files), timeoutMs: 5_000 })
  const handshake = await client.initialize()
  // The order this claims is a fact about two streams, so it is read off one ordered trace of what the
  // fixture saw and sent: initialize in, its result out, and only then the initialized notification.
  // The wait is the same courtesy every crossing reading needs: the client finishes writing the frame
  // and answers its caller, and the fixture's note of having received it lands a moment later.
  await wait(200)
  const trace = lines(files.trace).map((line) => JSON.parse(line))
    .map((entry) => entry.dir + ':' + (entry.method === null ? 'result:' + String(entry.id) : entry.method))
  const seq = methods(files.seq)
  const pid = client.pid
  const aliveWhileRunning = alive(pid)
  record('R1 a real child process answers the handshake in the order the lifecycle page writes',
    typeof pid === 'number' && aliveWhileRunning
    && handshake.verdict === 'ok' && handshake.negotiated === mod.MCP_PROTOCOL_VERSION
    && handshake.serverInfo !== null && handshake.serverInfo.name === 'r55-fixture'
    && dumps(seq) === dumps(['initialize', 'notifications/initialized'])
    && dumps(trace) === dumps(['in:initialize', 'out:result:1', 'in:notifications/initialized']),
    'pid=' + String(pid) + ' alive=' + String(aliveWhileRunning) + ' verdict=' + handshake.verdict
    + ' negotiated=' + String(handshake.negotiated) + ' server=' + dumps(handshake.serverInfo)
    + ' seq=' + dumps(seq) + ' trace=' + dumps(trace))
  record('R11a frames counts the frames written and read',
    dumps(client.frames) === dumps({ sent: 2, received: 1 }),
    'frames=' + dumps(client.frames) + ' readyWs=' + dumps({ sent: 2, received: 1 }))
  await client.close()
  await client.close()
  await wait(50)
  record('R11b close() is idempotent and leaves no orphan',
    aliveWhileRunning === true && alive(pid) === false,
    'aliveBefore=' + String(aliveWhileRunning) + ' aliveAfterTwoCloses=' + String(alive(pid)))
}

// ------------------------------------------------------------------ R2: one message is one line
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const verdict = await client.callTool('nl', {})
  const expected = ['line one', 'line two' + String.fromCharCode(9) + 'tabbed'].join(NL)
  const wires = lines(files.wire)
  const everyLineIsAFrame = wires.length > 0 && wires.every((line) => { try { JSON.parse(line); return true } catch { return false } })
  const escaped = wires[1].includes('line one' + String.fromCharCode(92) + 'nline two')
  record('R2 a newline inside a result travels escaped, arrives word for word, and never splits a frame',
    verdict.verdict === 'ok' && verdict.content.length === 1 && verdict.content[0].text === expected
    && expected.includes(NL) && wires.length === 2 && everyLineIsAFrame && escaped,
    'equal=' + String(verdict.content[0]?.text === expected) + ' wireLines=' + String(wires.length)
    + ' allFrames=' + String(everyLineIsAFrame) + ' escaped=' + String(escaped))
  await client.close()
}

// ------------------------------------------------------------------ R3: stderr is logs, not protocol
{
  const loud = slot()
  const noisy = mod.createMcpClient({ server: spec(['--stderr', '3'], loud), timeoutMs: 5_000 })
  await noisy.initialize()
  const call = await noisy.callTool('add', { a: 2, b: 3 })
  await wait(80)
  const captured = noisy.stderr.length
  const quietSlot = slot()
  const quiet = mod.createMcpClient({ server: spec([], quietSlot), timeoutMs: 5_000 })
  await quiet.initialize()
  await wait(80)
  record('R3 stderr lines are collected as logs and change no verdict',
    captured === 3 && call.verdict === 'ok' && call.content[0].text === '5' && quiet.stderr.length === 0,
    'stderrLines=' + String(captured) + ' verdict=' + call.verdict + ' sum=' + String(call.content[0]?.text)
    + ' silentRun=' + String(quiet.stderr.length))
  await noisy.close()
  await quiet.close()
}

// ------------------------------------------------------------------ R4: version negotiation
{
  const files = slot()
  const mismatched = mod.createMcpClient({ server: spec(['--version', '1999-01-01'], files), timeoutMs: 5_000 })
  const refused = await mismatched.initialize()
  const seq = methods(files.seq)
  record('R4 a different version is refused, the negotiation is readable, and the session does not proceed',
    refused.verdict === 'refused' && refused.negotiated === '1999-01-01'
    && refused.serverInfo !== null && dumps(seq) === dumps(['initialize']),
    'verdict=' + refused.verdict + ' negotiated=' + String(refused.negotiated) + ' seq=' + dumps(seq))
  await mismatched.close()
}

// ------------------------------------------------------------------ R5: the tool face
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const listed = await client.listTools()
  const names = listed.tools.map((tool) => tool.name).sort()
  const add = listed.tools.find((tool) => tool.name === 'add')
  const pictured = await client.callTool('image', {})
  const blocks = pictured.content.map((block) => block.type)
  const image = pictured.content.find((block) => block.type === 'image')
  record('R5 the tools arrive with their description and schema, and heterogeneous content is preserved',
    listed.verdict === 'ok' && dumps(names) === dumps(['add', 'crash', 'fail', 'image', 'nl', 'slow'])
    && add.description === 'Add two numbers' && add.inputSchema?.properties?.a?.type === 'number'
    && pictured.verdict === 'ok' && dumps(blocks) === dumps(['text', 'image'])
    && image?.mimeType === 'image/png' && image?.data === 'aGVsbG8=',
    'tools=' + dumps(names) + ' described=' + String(add?.description) + ' schema=' + dumps(add?.inputSchema?.properties?.a)
    + ' blocks=' + dumps(blocks) + ' mime=' + String(image?.mimeType))
  await client.close()
}

// ------------------------------------------------------------------ R6/R7: two kinds of failure, one client
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const failed = await client.callTool('fail', {})
  const afterFail = await client.callTool('add', { a: 1, b: 1 })
  record('R6 isError is a result, not a broken transport, and the client stays usable',
    failed.verdict === 'tool-error' && failed.isError === true && failed.content[0]?.text === 'Something went wrong'
    && afterFail.verdict === 'ok' && afterFail.content[0]?.text === '2',
    'fail=' + failed.verdict + '/' + String(failed.isError) + ' text=' + String(failed.content[0]?.text)
    + ' next=' + afterFail.verdict + '/' + String(afterFail.content[0]?.text))
  const unknown = await client.callTool('no-such-tool', {})
  const known = await client.callTool('add', { a: 2, b: 2 })
  record('R7 a protocol-level unknown tool is named with its code, and the client stays usable',
    unknown.verdict === 'unknown-tool' && unknown.code === -32602
    && known.verdict === 'ok' && known.content[0]?.text === '4',
    'unknown=' + unknown.verdict + '/code=' + String(unknown.code) + ' next=' + known.verdict + '/' + String(known.content[0]?.text))
  await client.close()
}

// ------------------------------------------------------------------ R8: a malformed line
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec(['--malformed'], files), timeoutMs: 5_000 })
  const first = await client.initialize()
  const sentAtLatch = client.frames.sent
  const started = Date.now()
  const second = await client.listTools()
  const third = await client.callTool('add', { a: 1, b: 2 })
  const elapsed = Date.now() - started
  const sentAfter = client.frames.sent
  // Paired: the request whose answer was corrupted names the protocol defect, and the session after it is
  // declared unreachable (transport-error) instead of quietly answering "protocol-error" forever, which
  // would be neither usable nor explicitly unreachable.
  record('R8 a malformed line is a protocol error, every request after it is latched unreachable, and nothing more is written',
    first.verdict === 'protocol-error'
    && second.verdict === 'transport-error' && second.reason === 'malformed-frame'
    && third.verdict === 'transport-error' && third.reason === 'malformed-frame'
    && sentAfter === sentAtLatch && elapsed < 300,
    'first=' + first.verdict + ' second=' + second.verdict + '/' + String(second.reason)
    + ' third=' + third.verdict + '/' + String(third.reason)
    + ' framesSent=' + String(sentAtLatch) + '->' + String(sentAfter) + ' elapsedMs=' + String(elapsed))
  await client.close()
}

// ------------------------------------------------------------------ R9: the server dies mid-answer
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec(['--hangup', 'crash'], files), timeoutMs: 8_000 })
  await client.initialize()
  const pid = client.pid
  const started = Date.now()
  const dead = await client.callTool('crash', {})
  const elapsed = Date.now() - started
  await wait(80)
  const goneBeforeClose = alive(pid) === false
  let threw = null
  try { await client.close(); await client.close() } catch (error) { threw = String(error) }
  record('R9 a server that dies mid-answer is a transport error, does not hang, and close() stays idempotent',
    dead.verdict === 'transport-error' && elapsed < 3_000 && goneBeforeClose && threw === null && alive(pid) === false,
    'verdict=' + dead.verdict + ' elapsedMs=' + String(elapsed) + ' gone=' + String(goneBeforeClose)
    + ' closeThrew=' + String(threw) + ' aliveAfter=' + String(alive(pid)))
}

// ------------------------------------------------------------------ R10: timeouts have a bound
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec(['--slow-ms', '700'], files), timeoutMs: 3_000 })
  await client.initialize()
  const started = Date.now()
  const timedOut = await client.callTool('slow', {}, { timeoutMs: 150 })
  const waited = Date.now() - started
  const startedLate = Date.now()
  const allowed = await client.callTool('slow', {}, { timeoutMs: 4_000 })
  const waitedLate = Date.now() - startedLate
  record('R10 a late answer is a timeout with a bound, and the same call succeeds when it is allowed to',
    timedOut.verdict === 'timeout' && waited < 600
    && allowed.verdict === 'ok' && allowed.content[0]?.text === 'slow done' && waitedLate >= 600,
    'timedOut=' + timedOut.verdict + ' waitedMs=' + String(waited) + ' allowed=' + allowed.verdict
    + ' waitedLateMs=' + String(waitedLate))
  await client.close()
}

// ------------------------------------------------------------------ R12: the ledger really learns the tools
{
  const files = slot()
  const client = mod.createMcpClient({ server: spec([], files), timeoutMs: 5_000 })
  await client.initialize()
  const listed = await client.listTools()
  await client.close()
  const adapterId = 'mcp-adapter'
  const records = mod.mcpToolRecords(adapterId, listed.tools)
  const reference = mod.capabilityRecord(adapterId, listed.tools.map((tool) => tool.name))
  record('R12a the records for one server tool list are capabilityRecord byte for byte',
    records.length === 1 && dumps(records[0]) === dumps(reference),
    'records=' + dumps(records.map((row) => row.kind + '/' + row.subject)) + ' identical=' + String(dumps(records[0]) === dumps(reference))
    + ' capabilities=' + dumps(records[0]?.payload?.capabilities))

  const ledgerSlot = mkdtempSync(join(tmpdir(), 'r55-ledger-'))
  const log = mod.openControlLog({ dir: ledgerSlot })
  const now = 1_000_000
  const view = { timeoutMs: 60_000, localEnd: adapterId }
  const before = mod.mcpCall(mod.projectTeamState(log.replay()), 'add', now, view)
  await log.append(records[0])
  const declared = mod.projectTeamState(log.replay())
  const afterDeclare = mod.mcpCall(declared, 'add', now, view)
  const catalogDeclared = mod.mcpTools(declared, now, view).map((tool) => tool.name)
  // A member record names the adapter as a member, which is what a route to it is built from; without
  // one the ledger knows the capability and nobody who has it.
  await log.append({ kind: 'member/state', subject: adapterId, payload: { id: adapterId, state: 'active', name: adapterId } })
  const named = mod.projectTeamState(log.replay())
  const afterMember = mod.mcpCall(named, 'add', now, view)
  await log.append(mod.heartbeatRecord(adapterId, now))
  const beating = mod.projectTeamState(log.replay())
  const afterBeat = mod.mcpCall(beating, 'add', now, view)
  const catalog = mod.mcpTools(beating, now, view).find((tool) => tool.name === 'add')
  record('R12b the tools a real server listed become ledger facts the R45 faces read',
    before.reason === 'unknown-tool' && afterDeclare.reason === 'no-provider' && afterMember.reason === 'no-provider'
    && dumps(catalogDeclared) === dumps(['add', 'crash', 'fail', 'image', 'nl', 'slow'])
    && afterBeat.reason === 'ok' && dumps(catalog?.availableFrom) === dumps([adapterId]),
    'before=' + before.reason + ' declared=' + afterDeclare.reason + ' named=' + afterMember.reason + ' catalog='
    + dumps(catalogDeclared.length) + ' +beat=' + afterBeat.reason + ' availableFrom=' + dumps(catalog?.availableFrom))
  await log.close()
  rmSync(ledgerSlot, { recursive: true, force: true })
}

rmSync(ROOT, { recursive: true, force: true })
const failed = results.filter((row) => !row.ok)
console.log('')
console.log((failed.length === 0 ? 'PASS' : 'FAIL') + '  ' + String(results.length - failed.length) + '/' + String(results.length) + ' readings held')
for (const row of failed) console.log('  failed: ' + row.name)
process.exit(failed.length === 0 ? 0 : 1)
