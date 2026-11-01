#!/usr/bin/env node
/**
 * R74 (T24): what a real MCP implementation does with what we write.
 *
 * The contract said the official SDK was not installed, so interop with the official implementation was
 * untestable and the round would fall back to a second implementation we wrote ourselves. That premise is
 * wrong, and this gate is written against the measured fact instead: the official packages are on disk in
 * the kernel pnpm store, @modelcontextprotocol/client@2.0.0 and @modelcontextprotocol/server@2.0.0 resolve
 * from the kernel own mcp-client package, and the kernel ships an official-SDK server
 * (packages/mcp/mcp-client/tests/fixture-server.ts) with predictable tools. So the peer here is an
 * OFFICIAL implementation, not one of ours:
 *
 *   peer S1  the kernel official-SDK fixture server (add / greet / fail(isError) / image / crash)
 *   peer S2  this gate own strict stdio server, written from docs/research/mcp-stdio-wire.md, plus its
 *            deliberately non-conforming modes (invalid JSON, embedded newline, replies without the
 *            jsonrpc member, and an inbound rule that requires jsonrpc like the official server does)
 *   client C1  the shipped plugins/dsh-link-collab/lib/index.js createMcpClient
 *   client C2  the official @modelcontextprotocol/client plus StdioClientTransport
 *
 * Every reading is measured on BOTH clients against the SAME peer, and the negative readings exist so the
 * comparison cannot pass on an empty world. A verdict that differs between the two clients is reported as
 * a finding with its wire evidence rather than smoothed over.
 *
 * Exit 0 every reading held; 1 a reading failed; 2 the shipped artifact is missing; 3 an input is missing
 * (no official packages on this machine, so the interop this gate is about cannot be read at all).
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(process.env.R74_PROJECT ?? resolve(dirname(HERE), '..'))
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(PROJECT, 'core', 'deepseek-harness'))
const OURS = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const SCRATCH = join(PROJECT, '.tmp', 'r74-gate')
const FIXTURE = join(SCRATCH, 'strict-server.mjs')
const MCP_CLIENT_PKG = join(KERNEL, 'packages', 'mcp', 'mcp-client', 'package.json')
const KERNEL_FIXTURE = join(KERNEL, 'packages', 'mcp', 'mcp-client', 'tests', 'fixture-server.ts')

const argv = process.argv.slice(2)
const JSON_CHILD = argv.includes('--json')
const MUTANT_ID = argv.includes('--mutant-id') ? argv[argv.indexOf('--mutant-id') + 1] : null

if (!existsSync(OURS)) { console.error('the plugin is not built: ' + OURS); process.exit(2) }
if (!existsSync(KERNEL_FIXTURE)) { console.error('the kernel fixture server is missing: ' + KERNEL_FIXTURE); process.exit(3) }

/* ------------------------------------------------------------------------------------------------
 * Resolving the official packages from the package that declares them. A pnpm store keeps them out of the
 * top-level node_modules, so probing that path is what made the contract believe they were absent.
 * ---------------------------------------------------------------------------------------------- */
function officialPackages() {
  const require = createRequire(MCP_CLIENT_PKG)
  const found = {}
  for (const [key, name] of [['client', '@modelcontextprotocol/client'], ['server', '@modelcontextprotocol/server']]) {
    try { found[key] = require.resolve(name) } catch { found[key] = null }
  }
  if (found.client === null) return null
  const dist = dirname(found.client)
  found.clientEsm = join(dist, 'index.mjs')
  found.stdioEsm = join(dist, 'stdio.mjs')
  if (!existsSync(found.clientEsm) || !existsSync(found.stdioEsm)) return null
  return found
}
const OFFICIAL = officialPackages()
if (OFFICIAL === null) {
  console.error('the official MCP packages are not resolvable from ' + MCP_CLIENT_PKG + '; this gate reads interop with them, so it cannot judge anything')
  process.exit(3)
}

/* ------------------------------------------------------------------------------------------------
 * The gate own server, written from the spec page numbered rules. Modes are deliberate defects:
 *   strict              requires jsonrpc on every inbound frame, exactly like the official server does
 *   lenient             accepts frames with no jsonrpc member (what our fixtures used to do)
 *   invalid-json        writes one line that is not JSON
 *   embedded-newline    writes a frame with a real newline inside a JSON string (spec: MUST NOT)
 *   no-jsonrpc-reply    answers without the jsonrpc member
 * ---------------------------------------------------------------------------------------------- */
function writeFixture() {
  mkdirSync(SCRATCH, { recursive: true })
  const NL = 'const NL = String.fromCharCode(10)'
  const lines = [
    "import { createInterface } from 'node:readline'",
    'const MODE = process.argv[2] ?? "strict"',
    NL,
    'const send = (frame) => process.stdout.write(JSON.stringify(frame) + NL)',
    'const reply = (id, result) => send(MODE === "no-jsonrpc-reply" ? { id, result } : { jsonrpc: "2.0", id, result })',
    'const fail = (id, code, message) => send(MODE === "no-jsonrpc-reply" ? { id, error: { code, message } } : { jsonrpc: "2.0", id, error: { code, message } })',
    'const tools = [',
    '  { name: "add", description: "adds two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },',
    '  { name: "fail", description: "always reports isError", inputSchema: { type: "object" } },',
    '  { name: "echo", description: "returns the text it was given, verbatim", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },',
    ']',
    'process.stderr.write("strict-server ready(" + MODE + ")" + NL)',
    'const rl = createInterface({ input: process.stdin })',
    'rl.on("line", (line) => {',
    '  if (MODE === "invalid-json") { process.stdout.write("this is not json at all" + NL); return }',
    '  let frame',
    '  try { frame = JSON.parse(line) } catch { return }',
    '  if (MODE === "strict" && frame?.jsonrpc !== "2.0") return',
    '  if (typeof frame?.method !== "string") return',
    '  if (frame.method === "notifications/initialized") return',
    '  if (frame.id === undefined) return',
    '  if (frame.method === "initialize") { reply(frame.id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "strict-server", version: "1.0.0" } }); return }',
    '  if (frame.method === "tools/list") {',
    '    if (MODE === "embedded-newline") { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "add", description: "first" + String.fromCharCode(92) + "nsecond", inputSchema: { type: "object" } }] } }).replace(String.fromCharCode(92) + "n", String.fromCharCode(10)) + NL); return }',
    '    reply(frame.id, { tools })',
    '    return',
    '  }',
    '  if (frame.method === "tools/call") {',
    '    const name = frame.params?.name',
    '    if (name === "add") { reply(frame.id, { content: [{ type: "text", text: String(Number(frame.params?.arguments?.a) + Number(frame.params?.arguments?.b)) }] }); return }',
    '    if (name === "fail") { reply(frame.id, { content: [{ type: "text", text: "Something went wrong" }], isError: true }); return }',
    '    if (name === "echo") {',
    '      const text = String(frame.params?.arguments?.text ?? "")',
    '      reply(frame.id, { content: [{ type: "text", text }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] })',
    '      return',
    '    }',
    '    fail(frame.id, -32602, "unknown tool: " + String(name))',
    '    return',
    '  }',
    '  fail(frame.id, -32601, "method not found: " + frame.method)',
    '})',
    '',
  ]
  writeFileSync(FIXTURE, lines.join(String.fromCharCode(10)))
}
writeFixture()

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const flat = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** One official client run against one peer: every step is recorded, a throw is a recorded outcome. */
async function runOfficial(peer, steps) {
  const main = await import(pathToFileURL(OFFICIAL.clientEsm).href)
  const stdio = await import(pathToFileURL(OFFICIAL.stdioEsm).href)
  const transport = new stdio.StdioClientTransport(peer)
  const client = new main.Client({ name: 'r74-gate', version: '1.0.0' }, { capabilities: {} })
  const out = { connect: null, steps: [] }
  try {
    await client.connect(transport)
    out.connect = { ok: true, negotiated: client.getNegotiatedProtocolVersion?.() ?? null }
  } catch (error) {
    out.connect = { ok: false, detail: flat(String(error?.message ?? error)).slice(0, 200) }
    return out
  }
  for (const step of steps) {
    try { out.steps.push(await step(client)) } catch (error) { out.steps.push({ threw: true, detail: flat(String(error?.message ?? error)).slice(0, 200), code: error?.code ?? null }) }
  }
  try { await client.close() } catch { /* best effort */ }
  return out
}

/** One run of the shipped client against one peer. */
async function runOurs(peer, steps) {
  const mod = await import(pathToFileURL(OURS).href)
  const client = mod.createMcpClient({ server: peer, protocolVersion: '2025-06-18', timeoutMs: 12000 })
  const out = { steps: [] }
  for (const step of steps) {
    try { out.steps.push(await step(client)) } catch (error) { out.steps.push({ threw: true, detail: flat(String(error?.message ?? error)).slice(0, 200) }) }
  }
  out.frames = { ...client.frames }
  out.stderr = client.stderr.slice(0, 3)
  try { await client.close() } catch { /* best effort */ }
  return out
}

const officialPeer = { command: process.execPath, args: ['--import', 'tsx/esm', KERNEL_FIXTURE], cwd: KERNEL }
const strictPeer = (mode) => ({ command: process.execPath, args: [FIXTURE, mode], cwd: PROJECT })

const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
const check = async (id, name, body) => {
  try { const [ok, detail] = await body(); held(id, name, ok, detail) } catch (error) { held(id, name, false, 'threw: ' + flat(String(error?.message ?? error)).slice(0, 160)) }
}

await check('R1', 'handshake against the official server: the version EACH client asks for is the version it is answered with', async () => {
  // The first version of this reading demanded that both clients negotiate the SAME version. That was an
  // expectation I invented: the spec page has the CLIENT send its protocolVersion and the server answer
  // with the version it will speak, and the two clients here deliberately ask for different ones. What the
  // protocol does require is that a request is answered rather than ignored, so that is what is read here,
  // and the difference itself is R11 rather than a failure.
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict, negotiated: answer.negotiated ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => ({ negotiated: client.getNegotiatedProtocolVersion?.() ?? null })])
  const a = ours.steps[0] ?? {}
  const b = theirs.steps[0] ?? {}
  const oursAsked = '2025-06-18'
  const oursOk = a.verdict === 'ok' && a.negotiated === oursAsked
  const theirsOk = theirs.connect?.ok === true && typeof b.negotiated === 'string' && b.negotiated.length > 0
  return [oursOk && theirsOk, 'ours=' + JSON.stringify(a) + ' (asked ' + oursAsked + ') theirs.connect=' + JSON.stringify(theirs.connect) + ' theirs=' + JSON.stringify(b)]
})

await check('R2', 'tools/list: both clients see the same tool names on the official server', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then(() => client.listTools()).then((answer) => ({ verdict: answer.verdict, names: (answer.tools ?? []).map((tool) => tool.name).sort() }))])
  const theirs = await runOfficial(officialPeer, [(client) => client.listTools().then((answer) => ({ names: (answer.tools ?? []).map((tool) => tool.name).sort() }))])
  const a = ours.steps[0]?.names ?? []
  const b = theirs.steps[0]?.names ?? []
  return [a.length > 0 && JSON.stringify(a) === JSON.stringify(b), 'ours=' + JSON.stringify(a) + ' theirs=' + JSON.stringify(b)]
})

await check('R3', 'tools/call add returns the same bytes to both clients (official server)', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then(() => client.callTool('add', { a: 20, b: 22 })).then((answer) => ({ verdict: answer.verdict, text: answer.content?.[0]?.text ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => client.callTool({ name: 'add', arguments: { a: 20, b: 22 } }).then((answer) => ({ text: answer.content?.[0]?.text ?? null }))])
  return [ours.steps[0]?.text === '42' && theirs.steps[0]?.text === '42', 'ours=' + JSON.stringify(ours.steps[0]) + ' theirs=' + JSON.stringify(theirs.steps[0])]
})

await check('R4', 'isError is a RESULT on both clients, not a transport failure (official server, tool fail)', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then(() => client.callTool('fail', {})).then((answer) => ({ verdict: answer.verdict, isError: answer.isError ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => client.callTool({ name: 'fail', arguments: {} }).then((answer) => ({ isError: answer.isError ?? null }))])
  const oursOk = ours.steps[0]?.verdict === 'tool-error' && ours.steps[0]?.isError === true
  const theirsOk = theirs.steps[0]?.isError === true && theirs.steps[0]?.threw !== true
  return [oursOk && theirsOk, 'ours=' + JSON.stringify(ours.steps[0]) + ' theirs=' + JSON.stringify(theirs.steps[0])]
})

await check('R5', 'an unknown tool is a JSON-RPC -32602 on both clients (official server)', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then(() => client.callTool('definitely-not-a-tool', {})).then((answer) => ({ verdict: answer.verdict, code: answer.code ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => client.callTool({ name: 'definitely-not-a-tool', arguments: {} }).then(() => ({ threw: false })).catch((error) => ({ threw: true, code: error?.code ?? null }))])
  const oursOk = ours.steps[0]?.verdict === 'unknown-tool' && ours.steps[0]?.code === -32602
  const theirsOk = theirs.steps[0]?.threw === true && theirs.steps[0]?.code === -32602
  return [oursOk && theirsOk, 'ours=' + JSON.stringify(ours.steps[0]) + ' theirs=' + JSON.stringify(theirs.steps[0])]
})

await check('R6', 'a server that dies mid-session ends both clients with a bounded transport failure', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize()
    .then(() => client.callTool('crash', {}))
    .then(() => sleep(700))
    .then(() => client.callTool('add', { a: 1, b: 1 }))
    .then((answer) => ({ verdict: answer.verdict, reason: answer.reason ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => client.callTool({ name: 'crash', arguments: {} })
    .then(() => sleep(700))
    .then(() => client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }))
    .then(() => ({ threw: false }))
    .catch((error) => ({ threw: true, detail: flat(String(error?.message ?? error)).slice(0, 120) }))])
  const oursOk = ['transport-error', 'timeout'].includes(ours.steps[0]?.verdict) && ours.steps[0]?.threw !== true
  const theirsOk = theirs.steps[0]?.threw === true
  return [oursOk && theirsOk, 'ours=' + JSON.stringify(ours.steps[0]) + ' theirs=' + JSON.stringify(theirs.steps[0])]
})

await check('R7', 'a multi-line tool result travels byte-identically to both clients (gate fixture, lenient mode)', async () => {
  const text = 'first line' + String.fromCharCode(10) + 'second line' + String.fromCharCode(10) + 'third'
  const ours = await runOurs(strictPeer('lenient'), [(client) => client.initialize().then(() => client.callTool('echo', { text })).then((answer) => ({ verdict: answer.verdict, text: answer.content?.[0]?.text ?? null, blocks: Array.isArray(answer.content) ? answer.content.length : 0 }))])
  const theirs = await runOfficial(strictPeer('lenient'), [(client) => client.callTool({ name: 'echo', arguments: { text } }).then((answer) => ({ text: answer.content?.[0]?.text ?? null, blocks: Array.isArray(answer.content) ? answer.content.length : 0 }))])
  const same = ours.steps[0]?.text === text && theirs.steps[0]?.text === text
  return [same && ours.steps[0]?.blocks === 2 && theirs.steps[0]?.blocks === 2, 'sent=' + JSON.stringify(text) + ' ours=' + JSON.stringify(ours.steps[0]) + ' theirs=' + JSON.stringify(theirs.steps[0])]
})

await check('R8', 'negative: a server that writes a line which is not JSON is detected by at least one client', async () => {
  const ours = await runOurs(strictPeer('invalid-json'), [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict, detail: flat(answer.detail ?? '').slice(0, 80) }))])
  const theirs = await runOfficial(strictPeer('invalid-json'), [() => ({ reached: true })])
  const oursBroke = ours.steps[0]?.verdict !== 'ok'
  const theirsBroke = theirs.connect?.ok === false
  return [oursBroke || theirsBroke, 'ours=' + JSON.stringify(ours.steps[0]) + ' theirs.connect=' + JSON.stringify(theirs.connect)]
})

await check('R9', 'finding, paired: a strict server answers only a client that sends jsonrpc, and the official server behaves the same way', async () => {
  const strictOurs = await runOurs(strictPeer('strict'), [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict }))])
  const lenientOurs = await runOurs(strictPeer('lenient'), [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict }))])
  const strictTheirs = await runOfficial(strictPeer('strict'), [(client) => ({ negotiated: client.getNegotiatedProtocolVersion?.() ?? null })])
  const officialOurs = await runOurs(officialPeer, [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict }))])
  const oursAnswersStrict = strictOurs.steps[0]?.verdict === 'ok'
  const specClientAnswered = strictTheirs.connect?.ok === true
  const lenientAnswers = lenientOurs.steps[0]?.verdict === 'ok'
  const story = 'ours@strict=' + JSON.stringify(strictOurs.steps[0]) + ' ours@lenient=' + JSON.stringify(lenientOurs.steps[0])
    + ' ours@officialServer=' + JSON.stringify(officialOurs.steps[0]) + ' theirs@strict=' + JSON.stringify(strictTheirs.connect)
  return [oursAnswersStrict && specClientAnswered && lenientAnswers, 'oursAnswersStrict=' + String(oursAnswersStrict) + ' ' + story]
})

await check('R10', 'the gate compared two clients, and the shipped one really wrote to the wire', async () => {
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then((answer) => ({ verdict: answer.verdict }))])
  const sent = ours.frames?.sent ?? 0
  return [sent > 0, 'frames=' + JSON.stringify(ours.frames) + ' stderr=' + JSON.stringify(ours.stderr)]
})

await check('R11', 'recorded difference: our client pins the spec version it cites while the official client asks for its newest', async () => {
  const mod = await import(pathToFileURL(OURS).href)
  const ours = await runOurs(officialPeer, [(client) => client.initialize().then((answer) => ({ negotiated: answer.negotiated ?? null }))])
  const theirs = await runOfficial(officialPeer, [(client) => ({ negotiated: client.getNegotiatedProtocolVersion?.() ?? null })])
  const pinned = mod.MCP_PROTOCOL_VERSION
  const a = ours.steps[0]?.negotiated ?? null
  const b = theirs.steps[0]?.negotiated ?? null
  // The difference is the finding; it is asserted as a difference so that "they became equal" is also read.
  return [typeof pinned === 'string' && a === pinned && b !== null && theirs.connect?.ok === true && b !== a,
    'oursPins=' + String(pinned) + ' oursNegotiated=' + String(a) + ' theirsNegotiated=' + String(b) + ' (the official server answered both)']
})

/* ------------------------------------------------------------------------------------------------
 * Self-attack: the mutants patch THIS gate, each one breaking exactly one reading's mechanism, and the
 * declared flip set is compared with the measured one. A mutant whose anchor is not unique, or whose
 * declared set is not what it actually moves, fails the attack - an anchor that also appears in this
 * table would silently patch the table instead of the gate (the R71/R72 lesson), so each anchor below is
 * assembled from two pieces and the table therefore does not contain it verbatim.
 * ---------------------------------------------------------------------------------------------- */
const MUT = [
  { name: 'version-equality-restored', anchor: 'a.negotiated === oursA' + 'sked', replace: "a.negotiated === '2025-11-25'", declared: ['R1'] },
  { name: 'names-plus-ghost', anchor: 'JSON.stringify(a) === JSON.stringify' + '(b)', replace: "JSON.stringify([...a, 'ghost']) === JSON.stringify(b)", declared: ['R2'] },
  { name: 'sum-expectation-broken', anchor: "ours.steps[0]?.text === '4" + "2'", replace: "ours.steps[0]?.text === '43'", declared: ['R3'] },
  { name: 'iserror-as-transport-failure', anchor: "ours.steps[0]?.verdict === 'tool-error' && ours.steps[0]?.isError ===" + ' true', replace: "ours.steps[0]?.verdict === 'transport-error'", declared: ['R4'] },
  { name: 'wrong-jsonrpc-code', anchor: 'ours.steps[0]?.code === -326' + '02', replace: 'ours.steps[0]?.code === -32601', declared: ['R5'] },
  { name: 'fixture-writes-raw-newline', anchor: 'reply(frame.id, { content: [{ type: "text", text }, { type: "image", data: "iVBORw0KGgo="' + ', mimeType: "image/png" }] })', replace: 'process.stdout.write(String.fromCharCode(123) + String.fromCharCode(34) + "jsonrpc" + String.fromCharCode(34) + ":" + String.fromCharCode(34) + "2.0" + String.fromCharCode(34) + "," + String.fromCharCode(34) + "id" + String.fromCharCode(34) + ":" + frame.id + "," + String.fromCharCode(34) + "result" + String.fromCharCode(34) + ":{" + String.fromCharCode(34) + "content" + String.fromCharCode(34) + ":[" + String.fromCharCode(123) + String.fromCharCode(34) + "type" + String.fromCharCode(34) + ":" + String.fromCharCode(34) + "text" + String.fromCharCode(34) + "," + String.fromCharCode(34) + "text" + String.fromCharCode(34) + ":" + String.fromCharCode(34) + text + String.fromCharCode(34) + String.fromCharCode(125) + "]}}" + NL)', declared: ['R7'] },
  { name: 'strict-client-must-fail', anchor: "const oursAnswersStrict = strictOurs.steps[0]?.verdict === 'o" + "k'", replace: "const oursAnswersStrict = strictOurs.steps[0]?.verdict !== 'ok'", declared: ['R9'] },
  { name: 'wire-count-zeroed', anchor: 'return [sent >' + ' 0,', replace: 'return [sent === 0,', declared: ['R10'] },
  { name: 'crash-expectation-inverted', anchor: "const oursOk = ['transport-error', 'timeout'].includes(ours.steps[0]?.verdict) && ours.steps[0]?.threw !== true" + "\n  const theirsOk = theirs.steps[0]?.threw ===" + ' true', replace: "const oursOk = ['transport-error', 'timeout'].includes(ours.steps[0]?.verdict) && ours.steps[0]?.threw !== true" + "\n  const theirsOk = theirs.steps[0]?.threw ===" + ' false', declared: ['R6'] },
  { name: 'negative-reading-defused', anchor: 'return [oursBroke ||' + ' theirsBroke,', replace: 'return [false,', declared: ['R8'] },
  { name: 'difference-erased', anchor: 'theirs.connect?.ok === true && b !==' + ' a,', replace: 'theirs.connect?.ok === true && b === a,', declared: ['R11'] },
]

if (argv.includes('--self-attack')) {
  const { spawnSync } = await import('node:child_process')
  const self = fileURLToPath(import.meta.url)
  const source = readFileSync(self, 'utf8')
  const child = (file) => {
    const run = spawnSync(process.execPath, [file, '--json'], { encoding: 'utf8', timeout: 420000, cwd: PROJECT, env: { ...process.env, R74_PROJECT: PROJECT } })
    const line = (run.stdout ?? '').split(String.fromCharCode(10)).filter((row) => row.startsWith('{')).pop()
    try { return JSON.parse(line) } catch { return { failed: ['<unparsable>'], total: 0, exit: run.status, stderr: (run.stderr ?? '').slice(-200) } }
  }
  const baseline = child(self)
  const problems = []
  if ((baseline.failed ?? []).length > 0) {
    console.log('self-attack refuses to run: the baseline is not green (failed ' + JSON.stringify(baseline.failed) + ')')
    process.exitCode = 1
  } else {
    const moved = new Set()
    for (const mutant of MUT) {
      const occurrences = source.split(mutant.anchor).length - 1
      if (occurrences !== 1) { problems.push(mutant.name + ': anchor occurs ' + String(occurrences) + ' times'); continue }
      const file = join(SCRATCH, 'mutant-' + mutant.name + '.mjs')
      writeFileSync(file, source.replace(mutant.anchor, mutant.replace))
      const seen = child(file)
      const failed = (seen.failed ?? []).filter((id) => id !== '<unparsable>')
      for (const id of failed) moved.add(id)
      const measured = JSON.stringify([...failed].sort())
      const declared = JSON.stringify([...mutant.declared].sort())
      const ok = measured === declared && failed.length > 0
      console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  flipped=' + measured + ' declared=' + declared)
      if (!ok) problems.push(mutant.name + ': measured ' + measured + ' declared ' + declared)
      if (seen.stderr !== undefined) problems.push(mutant.name + ': child stderr ' + String(seen.stderr).slice(0, 120))
    }
    const all = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11']
    const uncovered = all.filter((id) => !moved.has(id))
    console.log('  ' + (uncovered.length === 0 ? 'ok  ' : 'FAIL') + '  every reading is moved by at least one mutant, uncovered=' + JSON.stringify(uncovered))
    if (uncovered.length > 0) problems.push('uncovered readings: ' + uncovered.join(','))
    console.log('  ' + (problems.length === 0 ? 'ok  ' : 'FAIL') + '  every mutant moved exactly what it declared, and no mutant was silent')
    if (problems.length > 0) console.log('self-attack problems: ' + problems.join(' | '))
    process.exitCode = problems.length === 0 ? 0 : 1
  }
} else if (JSON_CHILD) {
  console.log(JSON.stringify({ mutant: MUTANT_ID, failed: readings.filter((row) => !row.ok).map((row) => row.id), total: readings.length }))
} else {
  for (const row of readings) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '  ' + row.name + '  |  ' + flat(row.detail).slice(0, 240))
  const failed = readings.filter((row) => !row.ok)
  console.log(String(readings.length - failed.length) + ' of ' + String(readings.length) + ' readings held')
  if (failed.length > 0) console.log('failed: ' + failed.map((row) => row.id).join(', '))
}
process.exitCode = readings.some((row) => !row.ok) ? 1 : 0
