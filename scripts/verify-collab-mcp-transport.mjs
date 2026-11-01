#!/usr/bin/env node
/**
 * R55 (task-107): the MCP-over-stdio transport half, judged against a wire-format basis rather than memory.
 *
 * Subject: .tmp/R55-contract.md section B (13 requirements) and docs/research/mcp-stdio-wire.md, which this gate
 * cites wherever it asserts what the wire must look like. The peer server is written HERE as a real child
 * process speaking the documented wire format; the producer's self-check harness is never imported, src/ is never
 * read, and the only product this gate reads is the built artifact.
 *
 * One reading (B1) is deliberately taken without the product at all: the fixture's own bytes are captured by this
 * gate directly (spawn + pipe) so that "no embedded newline" is proven from bytes the gate owns, not from the
 * fixture's testimony - and the same text then has to come back byte-identical through the client.
 *
 * R75 added B14, and with it the reason this gate could not see the defect R74 found: a peer that tolerates a
 * frame without the required `jsonrpc` member is more lenient than a real implementation, so it cannot report a
 * client that stops sending one. The peer here now requires it, refuses (and records) anything else, and B14
 * reads that pair - the question it owns is "does the peer hold the client to the envelope", not "does an
 * official implementation accept us". The latter lives in scripts/verify-mcp-interop.mjs, whose peer is the
 * official SDK implementation; both readings exist on purpose and answer different questions.
 *
 * Exit 0 all held; 1 a reading failed; 2 the artifact is missing; 3 an input is missing (printed).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : resolve(argv[i + 1]) }
const ATTACK = argv.includes('--self-attack')
const ARTIFACT = resolve(option('--artifact', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))

const results = []
let SILENT = false
const record = (id, ok, detail) => {
  results.push({ id, ok: ok === true })
  if (SILENT) return
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + ' ' + detail)
}
const say = (text) => { if (!SILENT) console.log('      ' + text) }
const clip = (text, n) => (String(text).length > n ? String(text).slice(0, n) + '...' : String(text))
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

/** The 13 requirements of section B, one reading each. */
const DECLARED = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14']
const FROZEN = ['createMcpClient', 'mcpToolRecords', 'MCP_PROTOCOL_VERSION']
const REUSED = ['capabilityRecord', 'mcpTools', 'mcpCall', 'openControlLog', 'projectTeamState', 'adapterRecord']
const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + String.fromCharCode(10)
const OK_VERDICTS = ['ok', 'refused', 'protocol-error', 'transport-error', 'timeout']
const CALL_VERDICTS = ['ok', 'tool-error', 'unknown-tool', 'protocol-error', 'transport-error', 'timeout']

const MADE = []
function mkTemp(prefix) {
  mkdirSync(join(PROJECT, '.tmp'), { recursive: true })
  const dir = mkdtempSync(join(PROJECT, '.tmp', prefix))
  MADE.push(dir)
  return dir
}
/** Whether a pid is alive right now - asked of the operating system, never read out of a field. */
function alive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
/** Poll until a pid disappears; -1 means it was still there when the budget ran out. */
async function waitsGone(pid, budgetMs) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (!alive(pid)) return Date.now() - started
    await new Promise((settle) => setTimeout(settle, 20))
  }
  return -1
}

/** The text the multiline tool answers with: three real newlines plus a carriage return. */
const MULTILINE_TEXT = 'first line' + NL + 'second line' + NL + 'third line' + String.fromCharCode(13) + 'with a carriage return'
/** A base64 image block, so the content array is genuinely heterogeneous. */
const IMAGE_BLOCK = { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }

/**
 * The peer server this gate writes for itself, as source lines: a real node process that speaks the wire format
 * in docs/research/mcp-stdio-wire.md - one JSON object per line on stdout (rules 1-4), logs on stderr (rule 2),
 * initialize -> result, then notifications/initialized (rules 5-6), tools/list and tools/call with an error
 * RESULT for failure (rule 8), heterogeneous content blocks (rule 9) and -32602 for an unknown tool name (rule 10).
 *
 * The behaviours the wire document cannot express as data are switches: --slow makes a call answer after the
 * caller has given up, --version answers a different protocol version, --stderr writes log lines, and the crash
 * and garbage tools die and emit a malformed frame respectively.
 */
const FIXTURE_LINES = [
  '#!/usr/bin/env node',
  '// Written by scripts/verify-collab-mcp-transport.mjs (R55 gate). A fixture peer, not a product.',
  'import { appendFileSync } from "node:fs"',
  'const argv = process.argv.slice(2)',
  'const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }',
  'const VERSION = flag("--version", "2025-06-18")',
  'const TRACE = flag("--trace", "")',
  'const SLOW = Number(flag("--slow", "1500"))',
  'const LOG_LINES = Number(flag("--stderr", "0"))',
  'const NL = String.fromCharCode(10)',
  'const MULTILINE = "first line" + NL + "second line" + NL + "third line" + String.fromCharCode(13) + "with a carriage return"',
  'const IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUg==", mimeType: "image/png" }',
  'const TOOLS = [',
  '  { name: "add", description: "adds two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },',
  '  { name: "greet", description: "greets one name", inputSchema: { type: "object", properties: { who: { type: "string" } } } },',
  '  { name: "fail", description: "returns an error result", inputSchema: { type: "object" } },',
  '  { name: "image", description: "returns a heterogeneous content array", inputSchema: { type: "object" } },',
  '  { name: "multiline", description: "returns text with real newlines", inputSchema: { type: "object" } },',
  '  { name: "slow", description: "answers after the caller gave up", inputSchema: { type: "object" } },',
  '  { name: "crash", description: "exits in the middle of the request", inputSchema: { type: "object" } },',
  '  { name: "garbage", description: "writes a malformed frame", inputSchema: { type: "object" } },',
  ']',
  'const trace = (entry) => { if (TRACE !== "") appendFileSync(TRACE, JSON.stringify(entry) + NL) }',
  'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object) + NL) }',
  'const text = (value) => ({ content: [{ type: "text", text: value }] })',
  'if (LOG_LINES > 0) for (let i = 1; i <= LOG_LINES; i += 1) process.stderr.write("fixture log line " + String(i) + NL)',
  'function handle(line) {',
  '  let message = null',
  '  try { message = JSON.parse(line) } catch { return }',
  '  const method = message.method',
  '  const envelope = message !== null && typeof message === "object" && message.jsonrpc === "2.0" ? "json-rpc-2.0" : "not-json-rpc-2.0"',
  '  trace({ method: method === undefined ? null : method, id: message.id === undefined ? null : message.id, keys: message.params === undefined ? null : Object.keys(message.params).sort(), jsonrpc: message.jsonrpc === undefined ? null : message.jsonrpc, envelope })',
  '  if (envelope !== "json-rpc-2.0") { trace({ refused: "not-json-rpc-2.0", method: method === undefined ? null : method }); return }',
  '  if (method === "initialize") {',
  '    writeFrame({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "r55-fixture", version: "1.0.0" } } })',
  '    return',
  '  }',
  '  if (method === "notifications/initialized") return',
  '  if (method === "tools/list") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } }); return }',
  '  if (method === "tools/call") {',
  '    const params = message.params === undefined ? {} : message.params',
  '    const name = params.name',
  '    const args = params.arguments === undefined ? {} : params.arguments',
  '    if (name === "add") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text(String(Number(args.a) + Number(args.b))) }); return }',
  '    if (name === "greet") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("hello " + String(args.who)) }); return }',
  '    if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Something went wrong" }], isError: true } }); return }',
  '    if (name === "image") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [IMAGE, { type: "text", text: "caption" }] } }); return }',
  '    if (name === "multiline") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text(MULTILINE) }); return }',
  '    if (name === "slow") { setTimeout(() => { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("late") }) }, SLOW); return }',
  '    if (name === "crash") { process.exit(3) }',
  '    if (name === "garbage") { process.stdout.write("this line is not JSON at all" + NL); return }',
  '    writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid params: unknown tool " + String(name) } })',
  '    return',
  '  }',
  '  writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })',
  '}',
  'let buffer = ""',
  'process.stdin.on("data", (chunk) => {',
  '  buffer += chunk.toString("utf8")',
  '  let at = buffer.indexOf(NL)',
  '  while (at !== -1) {',
  '    const line = buffer.slice(0, at)',
  '    buffer = buffer.slice(at + 1)',
  '    if (line.trim() !== "") handle(line)',
  '    at = buffer.indexOf(NL)',
  '  }',
  '})',
  'process.stdin.on("end", () => process.exit(0))',
  '',
]
let FIXTURE_TEXT = FIXTURE_LINES.join(NL) + NL
const FIXTURE_FILE = option('--fixture-file', null)
if (FIXTURE_FILE !== null && existsSync(FIXTURE_FILE)) FIXTURE_TEXT = readFileSync(FIXTURE_FILE, 'utf8')

/** Write the fixture into a fresh directory and describe how to spawn it. */
function fixtureAt(label, options) {
  const settings = options === undefined ? {} : options
  const dir = mkTemp('r55-' + label + '-')
  const script = join(dir, 'fixture-mcp-server.mjs')
  writeFileSync(script, FIXTURE_TEXT)
  const trace = join(dir, 'trace.jsonl')
  writeFileSync(trace, '')
  return {
    dir,
    script,
    trace,
    spec: {
      command: process.execPath,
      args: [script, '--trace', trace, '--version', settings.version === undefined ? '2025-06-18' : settings.version, '--slow', String(settings.slow === undefined ? 1500 : settings.slow), '--stderr', String(settings.stderr === undefined ? 0 : settings.stderr)],
    },
  }
}
/** The methods the fixture saw, in the order it saw them: the only observer of what the client sent. */
function traceOf(trace) {
  const text = readText(trace)
  if (text === null || text === '') return []
  return text.split(NL).filter((line) => line !== '').map((line) => JSON.parse(line))
}
/** The methods alone, which is what B3 asserts over. */
const methodsOf = (trace) => traceOf(trace).map((row) => (row.method === null ? '#response' : row.method))

/** Build a client over a fixture, run the body, and always close. */
async function withClient(spec, body, options) {
  const settings = options === undefined ? {} : options
  const config = { server: spec, clientName: 'r55-gate', clientVersion: '1.0.0' }
  if (settings.protocolVersion !== undefined) config.protocolVersion = settings.protocolVersion
  if (settings.timeoutMs !== undefined) config.timeoutMs = settings.timeoutMs
  if (settings.spawn !== undefined) config.spawn = settings.spawn
  const client = mod.createMcpClient(config)
  try {
    return await body(client)
  } finally {
    try { await client.close() } catch { /* closing twice is B9's reading, not this helper's failure */ }
  }
}
if (!existsSync(ARTIFACT)) {
  console.error('no artifact at ' + ARTIFACT + ' - build it first; this gate never builds')
  process.exit(2)
}
const artifactBytes = readFileSync(ARTIFACT)
const sha = createHash('sha256').update(artifactBytes).digest('hex')
const mod = await import(pathToFileURL(ARTIFACT).href)
const missingAnchors = [...FROZEN, ...REUSED].filter((name) => typeof mod[name] === 'undefined')
const VERSION = typeof mod.MCP_PROTOCOL_VERSION === 'string' ? mod.MCP_PROTOCOL_VERSION : '2025-06-18'
const ESC_NL = String.fromCharCode(92) + 'n'
const blocked = () => (missingAnchors.length === 0 ? null : 'blocked: the artifact does not export ' + show(missingAnchors))
say('artifact ' + ARTIFACT.replace(PROJECT, '.') + ' sha256 ' + sha.slice(0, 16) + ' (' + String(artifactBytes.length) + ' bytes)')
say('frozen names resolved: ' + show(FROZEN.filter((name) => typeof mod[name] !== 'undefined')) + ' - the probe list is the contract, not names this gate invented')
if (missingAnchors.length > 0) say('NOT YET EXPORTED, so every reading below reports it as blocked: ' + show(missingAnchors))

/** The eight tools the fixture serves, restated here so a client that drops or flattens one is caught. */
const EXPECTED_TOOLS = [
  { name: 'add', description: 'adds two numbers' },
  { name: 'greet', description: 'greets one name' },
  { name: 'fail', description: 'returns an error result' },
  { name: 'image', description: 'returns a heterogeneous content array' },
  { name: 'multiline', description: 'returns text with real newlines' },
  { name: 'slow', description: 'answers after the caller gave up' },
  { name: 'crash', description: 'exits in the middle of the request' },
  { name: 'garbage', description: 'writes a malformed frame' },
]
/** One request per line, exactly as wire rule 1 requires, so the fixture can be driven without the client. */
const frameOf = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + NL

// ---------------------------------------------------------------- B1 one message, one line
async function checkB1() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B1', false, blockedReason); return }
  const problems = []
  const raw = fixtureAt('b1-raw')
  const input = frameOf(1, 'initialize', { protocolVersion: VERSION, capabilities: { tools: {} }, clientInfo: { name: 'gate', version: '1.0.0' } })
    + frameOf(2, 'tools/call', { name: 'multiline', arguments: {} })
  const run = spawnSync(process.execPath, raw.spec.args, { input, timeout: 30000 })
  const out = run.stdout === null ? Buffer.from('') : run.stdout
  const text = out.toString('utf8')
  const newlineCount = text.split(NL).length - 1
  const lines = text.split(NL).filter((line) => line !== '')
  const frames = []
  for (const line of lines) {
    try { frames.push(JSON.parse(line)) } catch { problems.push('a frame the fixture wrote is not one JSON object: ' + clip(line, 80)) }
  }
  say('fixture stdout: ' + String(out.length) + ' bytes, ' + String(newlineCount) + ' newline byte(s), ' + String(frames.length) + ' frame(s)')
  if (frames.length !== 2 || newlineCount !== 2) problems.push('two requests produced ' + String(frames.length) + ' frame(s) and ' + String(newlineCount) + ' newline byte(s): one message is not one line')
  const callLine = lines.filter((line) => line.indexOf('first line') !== -1)
  if (callLine.length !== 1) problems.push('the multiline result is not on exactly one line (' + String(callLine.length) + ')')
  else {
    if (callLine[0].indexOf('first line' + ESC_NL + 'second line') === -1) problems.push('the newline in the text was NOT escaped on the wire: ' + clip(callLine[0], 120))
    const parsed = JSON.parse(callLine[0])
    const returned = parsed.result !== undefined && Array.isArray(parsed.result.content) ? parsed.result.content[0].text : null
    if (returned !== MULTILINE_TEXT) problems.push('the frame does not carry the text unchanged: ' + clip(show(returned), 100))
    else say('the wire line carries the text escaped (a literal backslash-n) and parsing it back gives the three-line text byte for byte')
  }
  const live = fixtureAt('b1-client')
  const through = await withClient(live.spec, async (client) => {
    const handshake = await client.initialize()
    const call = await client.callTool('multiline', {})
    const content = Array.isArray(call.content) ? call.content : []
    return { handshake, call, returned: content.length > 0 ? content[0].text : null, received: client.frames.received }
  })
  const identical = through.returned === MULTILINE_TEXT
  if (!identical) problems.push('the client returned ' + clip(show(through.returned), 100) + ' instead of the three-line text')
  if (through.call.verdict !== 'ok') problems.push('the multiline call reads ' + show(through.call.verdict))
  say('through the client: handshake ' + show(through.handshake.verdict) + ', call ' + show(through.call.verdict) + ', text identical: ' + String(identical) + ', frames.received ' + String(through.received))
  record('B1', problems.length === 0, problems.length === 0
    ? 'one message is one line: 2 requests -> 2 frames and exactly 2 newline bytes, the result text is JSON-escaped on the wire (' + ESC_NL + ', not a real newline) and comes back through the client byte for byte'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B2 stderr is a log, not protocol
async function checkB2() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B2', false, blockedReason); return }
  const problems = []
  const loud = fixtureAt('b2-loud', { stderr: 3 })
  const quiet = fixtureAt('b2-quiet', { stderr: 0 })
  const runOne = async (fix) => withClient(fix.spec, async (client) => {
    await client.initialize()
    const call = await client.callTool('add', { a: 2, b: 3 })
    return { call, stderr: Array.from(client.stderr) }
  })
  const withLogs = await runOne(loud)
  const without = await runOne(quiet)
  const sameVerdict = withLogs.call.verdict === without.call.verdict
  const sameText = show(withLogs.call.content) === show(without.call.content)
  say('stderr collected with logs: ' + String(withLogs.stderr.length) + ' ' + clip(show(withLogs.stderr), 90) + ' ; with none: ' + String(without.stderr.length))
  if (withLogs.stderr.length !== 3) problems.push('the client collected ' + String(withLogs.stderr.length) + ' stderr line(s) instead of the 3 the server wrote')
  else if (withLogs.stderr.filter((line) => line.indexOf('fixture log line') !== -1).length !== 3) problems.push('the collected lines are not the ones the server wrote: ' + clip(show(withLogs.stderr), 120))
  if (without.stderr.length !== 0) problems.push('a server that logged nothing still produced ' + String(without.stderr.length) + ' line(s)')
  if (!sameVerdict || !sameText) problems.push('the log lines changed the verdict: ' + show(withLogs.call.verdict) + ' vs ' + show(without.call.verdict))
  else say('the same call reads ' + show(withLogs.call.verdict) + ' with logs and without, and the content is identical: stderr is evidence, not protocol')
  record('B2', problems.length === 0, problems.length === 0
    ? 'three stderr lines are collected as readable evidence (and none when the server logs nothing), with the call verdict and content identical either way (' + show(withLogs.call.verdict) + ')'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B3 the handshake order
async function checkB3() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B3', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b3-order')
  const methods = await withClient(fix.spec, async (client) => {
    await client.initialize()
    await client.listTools()
    await client.callTool('add', { a: 1, b: 1 })
    return methodsOf(fix.trace)
  })
  const trace = traceOf(fix.trace)
  const first = trace.length > 0 ? trace[0] : null
  const keys = first !== null && Array.isArray(first.keys) ? first.keys : []
  const initializeCount = methods.filter((method) => method === 'initialize').length
  say('the fixture saw, in order: ' + show(methods.slice(0, 4)))
  if (methods[0] !== 'initialize') problems.push('the first message the server saw was ' + show(methods[0]) + ', not initialize')
  if (methods[1] !== 'notifications/initialized') problems.push('the second message was ' + show(methods[1]) + ': notifications/initialized does not follow the initialize result')
  if (initializeCount !== 1) problems.push('initialize was sent ' + String(initializeCount) + ' time(s)')
  if (methods[2] !== 'tools/list') problems.push('the first request after the notification was ' + show(methods[2]) + ', not tools/list')
  for (const key of ['protocolVersion', 'capabilities', 'clientInfo']) {
    if (keys.indexOf(key) === -1) problems.push('the initialize request carried no ' + key + ' (params keys ' + show(keys) + ')')
  }
  if (problems.length === 0) say('initialize (params ' + show(keys) + ') -> result -> notifications/initialized -> tools/list on the wire, read off the server side')
  record('B3', problems.length === 0, problems.length === 0
    ? 'the server-side trace shows initialize first, notifications/initialized only after the result, then tools/list; and the initialize params carry protocolVersion, capabilities and clientInfo'
    : problems.join(' | '))
}
// ---------------------------------------------------------------- B4 version negotiation
async function checkB4() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B4', false, blockedReason); return }
  const problems = []
  const mismatched = fixtureAt('b4-mismatch', { version: '2020-01-01' })
  const agreed = fixtureAt('b4-agree')
  const other = await withClient(mismatched.spec, async (client) => client.initialize())
  const ours = await withClient(agreed.spec, async (client) => client.initialize())
  say('server answers 2020-01-01 -> ' + clip(show(other), 120))
  say('server answers ' + VERSION + ' -> ' + clip(show(ours), 120))
  if (other.verdict === 'ok') problems.push('a server that answered a different protocol version still read ok')
  if (!OK_VERDICTS.includes(other.verdict)) problems.push('the verdict ' + show(other.verdict) + ' is outside the frozen closure ' + show(OK_VERDICTS))
  if (other.negotiated !== '2020-01-01') problems.push('negotiated reads ' + show(other.negotiated) + ' instead of the version the server answered')
  if (ours.verdict !== 'ok' || ours.negotiated !== VERSION) problems.push('the agreeing server reads ' + show(ours.verdict) + ' with negotiated ' + show(ours.negotiated))
  record('B4', problems.length === 0, problems.length === 0
    ? 'a server answering 2020-01-01 reads ' + show(other.verdict) + ' (negotiated ' + show(other.negotiated) + ') while one answering ' + VERSION + ' reads ok: the mismatch is not silently accepted, and the agreement is not assumed'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B5 the tool surface
async function checkB5() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B5', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b5-tools')
  const result = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const list = await client.listTools()
    const call = await client.callTool('image', {})
    return { list, call }
  })
  const tools = Array.isArray(result.list.tools) ? result.list.tools : []
  say('listTools: verdict ' + show(result.list.verdict) + ', ' + String(tools.length) + ' tool(s) ' + clip(show(tools.map((tool) => tool.name).sort()), 130))
  if (result.list.verdict !== 'ok') problems.push('listTools reads ' + show(result.list.verdict))
  if (tools.length !== EXPECTED_TOOLS.length) problems.push('the fixture serves ' + String(EXPECTED_TOOLS.length) + ' tools, the client listed ' + String(tools.length))
  for (const expected of EXPECTED_TOOLS) {
    const found = tools.filter((tool) => tool.name === expected.name)
    if (found.length !== 1) { problems.push('tool ' + expected.name + ' appears ' + String(found.length) + ' time(s)'); continue }
    if (found[0].description !== expected.description) problems.push('tool ' + expected.name + ' lost its description (' + clip(show(found[0].description), 60) + ')')
    if (found[0].inputSchema === undefined || found[0].inputSchema === null) problems.push('tool ' + expected.name + ' carries no inputSchema')
  }
  const blocks = Array.isArray(result.call.content) ? result.call.content : []
  say('callTool image: verdict ' + show(result.call.verdict) + ', content ' + clip(show(blocks), 160))
  if (result.call.verdict !== 'ok') problems.push('the image call reads ' + show(result.call.verdict))
  if (blocks.length !== 2) problems.push('the heterogeneous content array came back with ' + String(blocks.length) + ' block(s), expected 2')
  else {
    if (blocks[0].type !== 'image' || blocks[0].mimeType !== 'image/png' || typeof blocks[0].data !== 'string') problems.push('the image block was flattened or lost its type: ' + clip(show(blocks[0]), 90))
    if (blocks[1].type !== 'text' || blocks[1].text !== 'caption') problems.push('the text block beside it reads ' + clip(show(blocks[1]), 90))
  }
  record('B5', problems.length === 0, problems.length === 0
    ? 'all ' + String(EXPECTED_TOOLS.length) + ' tools come back with name, description and inputSchema, and a call returns a two-block content array whose image block keeps type/data/mimeType beside the text block'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B6 isError is a RESULT
async function checkB6() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B6', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b6-tool-error')
  const run = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const failed = await client.callTool('fail', {})
    const after = await client.callTool('add', { a: 2, b: 3 })
    return { failed, after }
  })
  say('callTool fail -> ' + clip(show({ verdict: run.failed.verdict, isError: run.failed.isError, content: run.failed.content, code: run.failed.code }), 170))
  say('the very next callTool add -> ' + clip(show({ verdict: run.after.verdict, content: run.after.content }), 120))
  if (run.failed.verdict !== 'tool-error') problems.push('a server result with isError:true reads ' + show(run.failed.verdict) + ' (it is a RESULT, not a transport failure)')
  if (run.failed.isError !== true) problems.push('isError reads ' + show(run.failed.isError))
  const failedBlocks = Array.isArray(run.failed.content) ? run.failed.content : []
  if (failedBlocks.length === 0 || failedBlocks[0].text !== 'Something went wrong') problems.push('the error result lost its content: ' + clip(show(run.failed.content), 90))
  if (run.after.verdict !== 'ok' || !Array.isArray(run.after.content) || run.after.content[0].text !== '5') problems.push('the client was not usable afterwards: ' + clip(show(run.after), 110))
  record('B6', problems.length === 0, problems.length === 0
    ? 'isError:true reads tool-error (not transport-error) with content and isError both readable, and the NEXT call answers ok with content 5: the failure result did not poison the session'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B7 an unknown tool name
async function checkB7() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B7', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b7-unknown-tool')
  const run = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const unknown = await client.callTool('no-such-tool', {})
    const after = await client.callTool('add', { a: 1, b: 4 })
    return { unknown, after }
  })
  say('callTool no-such-tool -> ' + clip(show({ verdict: run.unknown.verdict, code: run.unknown.code }), 130))
  if (run.unknown.verdict !== 'unknown-tool') problems.push('a JSON-RPC -32602 answer reads ' + show(run.unknown.verdict) + ' instead of unknown-tool')
  if (run.unknown.code !== -32602) problems.push('the JSON-RPC code reads ' + show(run.unknown.code) + ' instead of -32602')
  if (run.after.verdict !== 'ok') problems.push('the next call reads ' + show(run.after.verdict) + ': the session did not survive an unknown-tool answer')
  else say('the same client then calls add -> ok with content ' + clip(show(run.after.content), 60))
  record('B7', problems.length === 0, problems.length === 0
    ? 'an unknown tool name reads unknown-tool with code -32602 readable (distinct from the tool-error RESULT of B6), and the session still answers the next call'
    : problems.join(' | '))
}
// ---------------------------------------------------------------- B8 a malformed frame
async function checkB8() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B8', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b8-garbage')
  const started = Date.now()
  const run = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const bad = await client.callTool('garbage', {})
    const sentBefore = client.frames.sent
    const after = await client.callTool('add', { a: 1, b: 1 })
    const sentAfter = client.frames.sent
    const later = await client.callTool('add', { a: 2, b: 2 })
    return { bad, after, later, sentBefore, sentAfter }
  })
  const elapsed = Date.now() - started
  const latch = run.after.reason !== undefined ? run.after.reason : run.after.detail
  say('the malformed frame -> ' + clip(show({ verdict: run.bad.verdict, code: run.bad.code }), 110) + ' after ' + String(elapsed) + ' ms')
  say('the next call -> ' + clip(show({ verdict: run.after.verdict, reason: run.after.reason, detail: run.after.detail }), 150) + ' ; the call after that -> ' + show(run.later.verdict))
  say('frames.sent across the latched call: ' + String(run.sentBefore) + ' -> ' + String(run.sentAfter) + ' (unchanged means nothing was written to a session that is already condemned)')
  if (run.bad.verdict !== 'protocol-error') problems.push('a malformed frame reads ' + show(run.bad.verdict) + ' instead of protocol-error')
  if (!CALL_VERDICTS.includes(run.bad.verdict)) problems.push('the verdict ' + show(run.bad.verdict) + ' is outside the frozen closure ' + show(CALL_VERDICTS))
  if (elapsed > 8000) problems.push('the reading took ' + String(elapsed) + ' ms: a malformed frame must not be waited out, it must be reported')
  // rev1.1: the bad frame keeps protocol-error, but every call AFTER it must say the session is unreachable, and
  // must name the latch - one word for "this frame was bad" and "this session is over" would be two meanings.
  if (run.after.verdict !== 'transport-error') problems.push('the call after the malformed frame reads ' + show(run.after.verdict) + ' instead of transport-error')
  if (typeof latch !== 'string' || !/malformed|frame/i.test(latch)) problems.push('the latched verdict does not name the latch: ' + clip(show(latch), 90))
  if (run.later.verdict !== 'transport-error') problems.push('the second call after the malformed frame reads ' + show(run.later.verdict) + ': the latch is not sticky')
  if (run.sentAfter !== run.sentBefore) problems.push('frames.sent moved from ' + String(run.sentBefore) + ' to ' + String(run.sentAfter) + ' across the latched call: the client wrote to a deadline it had already given up on')
  record('B8', problems.length === 0, problems.length === 0
    ? 'a line that is not JSON reads protocol-error within ' + String(elapsed) + ' ms, every call after it reads transport-error naming the latch (' + clip(show(latch), 60) + '), and frames.sent did not move across the latched call (' + String(run.sentBefore) + '): the session is declared gone, not silently retried'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B9 the child dying mid-request
async function checkB9() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B9', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b9-crash')
  const started = Date.now()
  const outcome = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const pid = client.pid
    const call = await client.callTool('crash', {})
    let second = 'not-run'
    await client.close()
    try { await client.close(); second = 'ok' } catch (error) { second = 'threw: ' + String(error.message) }
    return { call, pid, second, goneMs: await waitsGone(pid, 4000) }
  })
  const elapsed = Date.now() - started
  say('the server exited mid-request -> ' + clip(show({ verdict: outcome.call.verdict }), 90) + ' after ' + String(elapsed) + ' ms; close() twice: ' + outcome.second + '; pid gone after ' + String(outcome.goneMs) + ' ms')
  if (outcome.call.verdict !== 'transport-error') problems.push('a server that died mid-request reads ' + show(outcome.call.verdict) + ' instead of transport-error')
  if (elapsed > 8000) problems.push('the reading took ' + String(elapsed) + ' ms: a dead peer must be reported, not waited out')
  if (outcome.second !== 'ok') problems.push('close() on an already dead process is not idempotent: ' + outcome.second)
  if (outcome.goneMs < 0) problems.push('the pid was still alive 4 s after the crash was reported')
  record('B9', problems.length === 0, problems.length === 0
    ? 'a server that exits mid-request reads transport-error within ' + String(elapsed) + ' ms, close() twice does not throw, and the pid is gone'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B10 the timeout has an upper bound
async function checkB10() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B10', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b10-slow', { slow: 6000 })
  const timeoutMs = 400
  const started = Date.now()
  const run = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const call = await client.callTool('slow', {}, { timeoutMs })
    const pid = client.pid
    const after = await client.callTool('add', { a: 1, b: 2 })
    return { call, after, pid, alive: alive(pid) }
  }, { timeoutMs })
  const elapsed = Date.now() - started
  say('a call whose answer is 6 s away with timeoutMs=' + String(timeoutMs) + ' -> ' + clip(show({ verdict: run.call.verdict }), 90) + ' after ' + String(elapsed) + ' ms; the server is still ' + (run.alive ? 'alive' : 'gone') + '; the next call reads ' + show(run.after.verdict))
  if (run.call.verdict !== 'timeout') problems.push('a call that answers after the deadline reads ' + show(run.call.verdict) + ' instead of timeout')
  if (elapsed > timeoutMs * 8) problems.push('the gate waited ' + String(elapsed) + ' ms for a ' + String(timeoutMs) + ' ms timeout: the wait is not bounded')
  if (!run.alive) problems.push('the server is gone after a timeout: a slow peer is not a dead one')
  if (run.after.verdict !== 'ok') problems.push('the client is not usable after a timeout: the next call reads ' + show(run.after.verdict))
  record('B10', problems.length === 0, problems.length === 0
    ? 'a peer that answers 6 s late reads timeout after ' + String(elapsed) + ' ms (bounded by ' + String(timeoutMs) + ' ms, not by the peer), the server is still alive, and the next call reads ok: the deadline bounded the wait, it did not kill the session'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B11 no orphan, honest counters
async function checkB11() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B11', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b11-close')
  const run = await withClient(fix.spec, async (client) => {
    await client.initialize()
    await client.listTools()
    await client.callTool('add', { a: 1, b: 1 })
    const pid = client.pid
    const frames = { sent: client.frames.sent, received: client.frames.received }
    const aliveBefore = alive(pid)
    await client.close()
    return { pid, frames, aliveBefore, goneMs: await waitsGone(pid, 5000), seen: traceOf(fix.trace).length }
  })
  // The fixture trace is the ground truth for what the client sent: initialize + the initialized
  // notification + tools/list + tools/call. The fixture answers the three requests, never the notification.
  say('frames sent/received = ' + String(run.frames.sent) + '/' + String(run.frames.received) + '; the fixture received ' + String(run.seen) + ' message(s) and wrote 3 replies; alive before close: ' + String(run.aliveBefore) + '; pid gone after ' + String(run.goneMs) + ' ms')
  if (!run.aliveBefore) problems.push('the pid was not alive before close(), so "gone afterwards" would prove nothing')
  if (run.goneMs < 0) problems.push('the child was still alive 5 s after close(): an orphan')
  if (run.frames.sent !== run.seen) problems.push('frames.sent reads ' + String(run.frames.sent) + ' while the server received ' + String(run.seen) + ' message(s)')
  if (run.frames.received !== 3) problems.push('frames.received reads ' + String(run.frames.received) + ' while the server wrote 3 replies (a notification is not answered)')
  record('B11', problems.length === 0, problems.length === 0
    ? 'close() removes the process (pid alive before, gone within ' + String(run.goneMs) + ' ms after) and the frame counters match the wire: sent = the ' + String(run.seen) + ' messages the server received, received = the 3 replies it wrote'
    : problems.join(' | '))
}

// ------------------------------------- B14 the peer requires JSON-RPC 2.0 (R75, debt 52)
/**
 * The same frame with the required member removed.
 *
 * This is the stimulus, not the expectation: a peer that answers it is a peer more lenient than the wire
 * document says a peer must be, and a gate whose peer is more lenient than a real implementation cannot see a
 * client that stops sending the member. That is exactly how the missing member survived four rounds (R74).
 * @param frame - one compliant, newline terminated frame.
 * @returns the same frame without `jsonrpc`.
 */
function withoutEnvelope(frame) {
  const parsed = JSON.parse(frame.split(NL)[0])
  delete parsed.jsonrpc
  return JSON.stringify(parsed) + NL
}

async function checkB14() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B14', false, blockedReason); return }
  const problems = []
  const params = { protocolVersion: VERSION, capabilities: { tools: {} }, clientInfo: { name: 'gate', version: '1.0.0' } }
  const compliant = frameOf(7, 'initialize', params)
  const stripped = withoutEnvelope(compliant)
  const yes = fixtureAt('b14-compliant')
  const no = fixtureAt('b14-stripped')
  const answeredRun = spawnSync(process.execPath, yes.spec.args, { input: compliant, timeout: 30000 })
  const refusedRun = spawnSync(process.execPath, no.spec.args, { input: stripped, timeout: 30000 })
  const answeredText = (answeredRun.stdout === null ? Buffer.from('') : answeredRun.stdout).toString('utf8').trim()
  const refusedText = (refusedRun.stdout === null ? Buffer.from('') : refusedRun.stdout).toString('utf8').trim()
  const answeredFrames = answeredText === '' ? [] : answeredText.split(NL).filter((line) => line !== '').map((line) => { try { return JSON.parse(line) } catch { return null } })
  const answeredOk = answeredFrames.length === 1 && answeredFrames[0] !== null && answeredFrames[0].id === 7 && answeredFrames[0].result !== undefined
  if (!answeredOk) problems.push('the compliant frame was not answered with exactly one result frame: ' + clip(answeredText, 90))
  const compliantTrace = traceOf(yes.trace)
  if (compliantTrace.length !== 1 || compliantTrace[0].envelope !== 'json-rpc-2.0') problems.push('the peer did not record the compliant frame as JSON-RPC 2.0: ' + clip(show(compliantTrace), 100))
  if (refusedText !== '') problems.push('the peer ANSWERED a frame that does not declare JSON-RPC 2.0 (it wrote ' + String(refusedText.split(NL).length - 1) + ' frame(s)): a peer more lenient than a real implementation cannot see a client that stops sending the member')
  const refusedTrace = traceOf(no.trace)
  const named = refusedTrace.filter((row) => row.refused === 'not-json-rpc-2.0')
  if (named.length !== 1) problems.push('the peer did not record exactly one named refusal for the stripped frame (recorded ' + String(named.length) + '): ' + clip(show(refusedTrace), 110))
  const productFix = fixtureAt('b14-product')
  const through = await withClient(productFix.spec, async (client) => {
    const handshake = await client.initialize()
    const call = await client.callTool('add', { a: 1, b: 1 })
    return { handshake: handshake.verdict, call: call.verdict }
  })
  const productTrace = traceOf(productFix.trace)
  const productFrames = productTrace.filter((row) => row.refused === undefined)
  const offEnvelope = productFrames.filter((row) => row.envelope !== 'json-rpc-2.0')
  if (productFrames.length < 2) problems.push('the peer recorded fewer than two frames from the product (' + String(productFrames.length) + '): ' + clip(show(productTrace), 100))
  else if (offEnvelope.length !== 0) problems.push(String(offEnvelope.length) + ' of ' + String(productFrames.length) + ' frames the product wrote did not declare JSON-RPC 2.0: ' + clip(show(offEnvelope[0]), 100))
  else if (productTrace.some((row) => row.refused !== undefined)) problems.push('the product wrote a frame this peer had to refuse')
  say('compliant answered: ' + String(answeredOk) + ' (recorded ' + show(compliantTrace.length === 1 ? compliantTrace[0].envelope : null) + '), stripped answered: ' + String(refusedText !== '') + ' (refusals recorded ' + String(named.length) + '), product frames all JSON-RPC 2.0: ' + String(productFrames.length > 0 && offEnvelope.length === 0) + ' of ' + String(productFrames.length) + ', product verdicts ' + show(through.handshake) + '/' + show(through.call))
  record('B14', problems.length === 0, problems.length === 0
    ? 'the peer asks for what the wire document asks for: a compliant frame is answered and recorded as json-rpc-2.0, the same frame without the member gets no answer at all and exactly one named refusal in the peer own record, and every frame the product wrote carries the member - so a client that stops sending it can no longer pass here (the interop half of this question is verify-mcp-interop.mjs, whose peer is the official implementation)'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B12 the tools reach the ledger
async function checkB12() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B12', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b12-ledger')
  const listed = await withClient(fix.spec, async (client) => {
    await client.initialize()
    const list = await client.listTools()
    return Array.isArray(list.tools) ? list.tools : []
  })
  const names = listed.map((tool) => tool.name)
  const produced = mod.mcpToolRecords('mcp-adapter', listed)
  const expected = [mod.capabilityRecord('mcp-adapter', names)]
  const asArray = Array.isArray(produced) ? produced : null
  const identical = asArray !== null && JSON.stringify(asArray) === JSON.stringify(expected)
  say('the server listed ' + String(names.length) + ' tool(s); mcpToolRecords -> ' + clip(show(produced), 150))
  say('capabilityRecord(adapter, names) -> ' + clip(show(expected), 150) + ' ; byte-identical: ' + String(identical))
  if (asArray === null) problems.push('mcpToolRecords did not return an array of records: ' + clip(show(produced), 90))
  else if (!identical) problems.push('mcpToolRecords is not the capability vocabulary: ' + clip(show(produced), 110) + ' vs ' + clip(show(expected), 110))
  const dir = mkTemp('r55-b12-log')
  const log = mod.openControlLog({ dir, writer: 'gate' })
  const localEnd = 'gate-end'
  const now = Date.now()
  const timeoutMs = 60000
  // Before feeding: the name is declared by a member that never beats, so nobody can serve it.
  await log.append(mod.capabilityRecord('probe-silent', ['add']))
  const before = mod.projectTeamState(log.replay())
  const callBefore = mod.mcpCall(before, 'add', now, { timeoutMs, localEnd })
  const listedBefore = mod.mcpTools(before, now, { timeoutMs, localEnd })
  // Feed what the real server listed, plus the liveness of the adapter that serves it.
  await log.append({ kind: 'member/state', subject: 'mcp-adapter', payload: { id: 'mcp-adapter', name: 'mcp-adapter', state: 'active', role: 'member' } })
  for (const record of (asArray === null ? [] : asArray)) await log.append(record)
  await log.append(mod.heartbeatRecord('mcp-adapter', now - 100))
  // A member serves from an end it is hosted at (R44's route rule): without the host record the tool is
  // declared and healthy but unreachable from this end, which reads provider-silent - a different question
  // from the one B12 asks (does what the SERVER listed reach the ledger and become callable).
  await log.append(mod.hostRecord('mcp-adapter', localEnd, null, now - 100))
  const after = mod.projectTeamState(log.replay())
  const callAfter = mod.mcpCall(after, 'add', now, { timeoutMs, localEnd })
  const listedAfter = mod.mcpTools(after, now, { timeoutMs, localEnd })
  await log.close()
  say('before feeding: mcpCall add -> ' + clip(show(callBefore), 90) + ' ; the listing carried ' + String(listedBefore.length) + ' name(s)')
  say('after feeding: mcpCall add -> ' + clip(show(callAfter), 90) + ' ; the listing carries ' + clip(show(listedAfter.map((row) => row.name)), 150))
  if (callBefore.reason !== 'no-provider') problems.push('before the tools were fed, mcpCall add reads ' + show(callBefore.reason) + ' instead of no-provider')
  if (callAfter.ok !== true || callAfter.reason !== 'ok') problems.push('after feeding the records, mcpCall add reads ' + clip(show(callAfter), 90) + ' instead of ok')
  const row = listedAfter.filter((entry) => entry.name === 'add')
  if (row.length !== 1) problems.push('the listing after feeding carries add ' + String(row.length) + ' time(s)')
  else if (!Array.isArray(row[0].availableFrom) || row[0].availableFrom.indexOf('mcp-adapter') === -1) problems.push('availableFrom for add is ' + clip(show(row[0].availableFrom), 80) + ', expected the adapter')
  record('B12', problems.length === 0, problems.length === 0
    ? 'mcpToolRecords(adapter, the tools the REAL server listed) is byte-identical to [capabilityRecord(adapter, names)] (' + String(names.length) + ' names), and feeding it into a real log moves the ledger: mcpCall add went no-provider -> ok and the listing names the adapter as availableFrom'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B13 a real child process
async function checkB13() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B13', false, blockedReason); return }
  const problems = []
  const fix = fixtureAt('b13-real-child')
  const run = await withClient(fix.spec, async (client) => {
    const handshake = await client.initialize()
    const pid = client.pid
    const seen = methodsOf(fix.trace)
    return { handshake, pid, alive: alive(pid), seen }
  })
  const helper = run.seen.length === 0 ? null : traceOf(fix.trace)[0]
  say('client.pid = ' + show(run.pid) + ', alive while in use: ' + String(run.alive) + '; the fixture process recorded ' + clip(show(run.seen.slice(0, 3)), 120))
  if (typeof run.pid !== 'number' || run.pid <= 0) problems.push('client.pid reads ' + show(run.pid) + ': no subprocess was started')
  else if (!run.alive) problems.push('the pid ' + String(run.pid) + ' is not a live process')
  if (helper === null || helper.method !== 'initialize') problems.push('the fixture process recorded no initialize: the messages did not reach a real child')
  if (run.handshake.verdict !== 'ok') problems.push('the handshake over the real child reads ' + show(run.handshake.verdict))
  record('B13', problems.length === 0, problems.length === 0
    ? 'the exchange went through a real node subprocess: client.pid ' + String(run.pid) + ' is alive while in use and the fixture process itself recorded the initialize it received'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- coverage matrix + self-attack
// JSON_OUT is read here because the readings and the child runs need it; the matrix itself is printed after
// the readings have run, next to the tally.
const JSON_OUT = argv.includes('--json')

/** Count occurrences, so a mutation can never silently edit the wrong branch. */
function occurrences(text, find) {
  let count = 0
  let at = text.indexOf(find)
  while (at !== -1) { count += 1; at = text.indexOf(find, at + find.length) }
  return count
}
/** An anchored replacement; an anchor that does not occur exactly once is a GATE failure, not a mutation. */
function swap(text, find, replace) {
  const found = occurrences(text, find)
  if (found !== 1) throw new Error('anchor occurs ' + String(found) + ' time(s), expected 1: ' + clip(show(find), 110))
  return text.split(find).join(replace)
}

/**
 * One mutant per reading, so the coverage matrix cannot have a hole by construction.
 *
 * 'fixture' mutants mutate the peer server this gate writes - the stimulus. They are anchored on lines that
 * exist here and now, and each one changes the behaviour of exactly one tool or switch, which is what keeps a
 * mutant's declared set honest.
 *
 * 'artifact' mutants mutate a COPY of the shipped bundle with an anchor taken from the product. Those anchors
 * can only be pinned once the product ships: while the transport half is not in the artifact, they are declared
 * pending and the self-attack reports the readings they would cover as uncovered. That is the correct reading of
 * a gate whose product does not exist yet - not a silent pass.
 */
const MUTANTS = [
  { id: 'M1', reading: 'B1', target: 'fixture', note: 'the fixture writes a real newline inside the frame',
    find: 'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object) + NL) }',
    replace: 'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object).split("third line").join("third" + NL + "line") + NL) }' },
  { id: 'M2', reading: 'B2', target: 'fixture', note: 'the fixture writes nothing to stderr',
    find: 'if (LOG_LINES > 0) for (let i = 1; i <= LOG_LINES; i += 1) process.stderr.write("fixture log line " + String(i) + NL)',
    replace: 'void LOG_LINES' },
  { id: 'M3', reading: 'B3', target: 'artifact', note: 'the client never sends notifications/initialized (the handshake is left unfinished)',
    find: '    const failed = writeFrame({ method: "notifications/initialized", params: {} });', replace: '    const failed = null;' },
  { id: 'M4', reading: 'B4', target: 'fixture', note: 'the fixture echoes the requested version instead of answering its own',
    find: 'writeFrame({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "r55-fixture", version: "1.0.0" } } })',
    replace: 'const asked = message.params === undefined ? null : message.params.protocolVersion' + NL + '    writeFrame({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: asked === null ? VERSION : asked, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "r55-fixture", version: "1.0.0" } } })' },
  { id: 'M5', reading: 'B5', target: 'artifact', note: 'the client flattens the content array to text blocks',
    find: '    return { verdict: isError ? "tool-error" : "ok", content: result.content, isError };',
    replace: '    return { verdict: isError ? "tool-error" : "ok", content: result.content.filter((block) => block?.type === "text"), isError };' },
  { id: 'M6', reading: 'B6', target: 'fixture', note: 'the fixture reports a failed tool as a JSON-RPC error instead of an isError result',
    find: 'if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Something went wrong" }], isError: true } }); return }',
    replace: 'if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Something went wrong" } }); return }' },
  { id: 'M7', reading: 'B7', target: 'fixture', note: 'the fixture answers an unknown tool name with an isError result instead of -32602',
    find: 'writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid params: unknown tool " + String(name) } })',
    replace: 'writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "no such tool" }], isError: true } })' },
  { id: 'M8', reading: 'B8', target: 'fixture', note: 'the fixture stops writing a malformed frame',
    find: 'if (name === "garbage") { process.stdout.write("this line is not JSON at all" + NL); return }',
    replace: 'if (name === "garbage") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("well formed after all") }); return }' },
  { id: 'M9', reading: 'B9', target: 'fixture', note: 'the fixture answers before it exits',
    find: 'if (name === "crash") { process.exit(3) }',
    replace: 'if (name === "crash") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("alive") }); process.exit(3) }' },
  { id: 'M10', reading: 'B10', target: 'fixture', note: 'the slow tool answers at once, inside any deadline',
    find: 'const SLOW = Number(flag("--slow", "1500"))',
    replace: 'const SLOW = 0' },
  { id: 'M14', reading: 'B14', target: 'fixture', note: 'the peer stops requiring the JSON-RPC 2.0 member, so it answers a frame that does not declare it',
    find: '  if (envelope !== "json-rpc-2.0") { trace({ refused: "not-json-rpc-2.0", method: method === undefined ? null : method }); return }',
    replace: '  void envelope' },
  { id: 'M11', reading: 'B11', target: 'artifact', note: 'close() stops closing the child, leaving an orphan',
    swaps: [['      stdin?.end?.();', '      void 0;'], ['        child.kill();', '        void 0;'], ['          child.kill("SIGKILL");', '          void 0;']] },
  { id: 'M12', reading: 'B12', target: 'artifact', note: 'mcpToolRecords invents its own payload vocabulary',
    find: '  return [capabilityRecord(adapterId, names)];', replace: '  return [{ kind: "capability/state", subject: adapterId, payload: { id: adapterId, tools: names } }];' },
  { id: 'M13', reading: 'B13', target: 'artifact', note: 'pid is no longer the live child, so every reading that asks the pid a question moves: B10 asks whether a slow peer is still alive, B11 whether close() really took it away, B13 whether it is a live process',
    declared: ['B10', 'B11', 'B13'], find: '      return child.pid;', replace: '      return null;' },
]

/** Run this same gate in a child process and read its verdict map back. */
function childVerdicts(extraArgs) {
  const run = spawnSync(process.execPath, [SELF, '--json'].concat(extraArgs), { encoding: 'utf8', timeout: 300000, cwd: PROJECT })
  const stdout = run.stdout === null ? '' : run.stdout
  const line = stdout.split(NL).filter((row) => row.startsWith('{')).pop()
  if (line !== undefined) return { ok: true, map: JSON.parse(line) }
  // A mutant violent enough to take the child down with it still has to be measured: the readings it managed to
  // print before dying are read off the transcript, and every reading that never printed is false. Reporting
  // "gate failure" instead would make the most interesting mutants unmeasurable.
  const map = Object.fromEntries(DECLARED.map((id) => [id, false]))
  for (const row of stdout.split(NL)) {
    const match = /^\s+(ok|FAIL)\s+(B\d+)\b/.exec(row)
    if (match !== null && match[1] === 'ok') map[match[2]] = true
  }
  const printed = stdout.split(NL).filter((row) => /^\s+(ok|FAIL)\s+B\d+\b/.test(row)).length
  if (printed === 0) return { ok: false, why: 'the armed run printed no readings at all (exit ' + show(run.status) + '): ' + clip(stdout + (run.stderr || ''), 200) }
  return { ok: true, map, crashed: true, printed }
}

async function runAttack() {
  console.log('')
  console.log('=== self-attack: one mutant per reading, declared set == observed set ===')
  console.log('  (each mutant runs this gate again in a child process, so the injection flag selects the defect and')
  console.log('   never the expectations: the baseline map is taken from a clean run of the same code)')
  const base = childVerdicts([])
  if (!base.ok) { console.error('self-attack: the baseline run produced no verdict map: ' + base.why); return false }
  const table = []
  const coverage = new Map()
  let ok = true
  /** A mutant carries either one anchored swap or several; each anchor must occur exactly once. */
  const foldIn = (text, mutant) => (mutant.swaps === undefined
    ? swap(text, mutant.find, mutant.replace)
    : mutant.swaps.reduce((live, pair) => swap(live, pair[0], pair[1]), text))
  for (const mutant of MUTANTS) {
    const declared = mutant.declared === undefined ? [mutant.reading] : mutant.declared
    for (const reading of declared) coverage.set(reading, [...(coverage.get(reading) ?? []), mutant.id])
    if (mutant.pending === true) {
      ok = false
      table.push({ id: mutant.id, note: mutant.note, declared, observed: ['anchor not shipped'], localised: false })
      continue
    }
    try {
      let args = []
      if (mutant.target === 'fixture') {
        const dir = mkTemp('r55-fix-' + mutant.id + '-')
        const file = join(dir, 'fixture-mutated.mjs')
        writeFileSync(file, foldIn(FIXTURE_TEXT, mutant))
        args = ['--fixture-file', file]
      } else {
        const dir = mkTemp('r55-art-' + mutant.id + '-')
        const copy = join(dir, 'index.js')
        writeFileSync(copy, foldIn(readFileSync(ARTIFACT, 'utf8'), mutant))
        args = ['--artifact', copy]
      }
      const armed = childVerdicts(args)
      const observed = armed.ok ? DECLARED.filter((id) => Boolean(base.map[id]) !== Boolean(armed.map[id])) : ['gate failure']
      const localised = show(observed) === show(declared)
      if (!localised) ok = false
      table.push({ id: mutant.id, note: mutant.note, declared, observed, localised })
    } catch (error) {
      ok = false
      table.push({ id: mutant.id, note: mutant.note, declared, observed: ['gate failure'], localised: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const row of table) {
    console.log('  ' + row.id + ' [' + row.declared.join(',') + '] ' + row.note + ' -> observed ' + show(row.observed) + '  ' + (row.localised ? 'LOCALISED' : 'MISMATCH') + (row.error === undefined ? '' : ' [' + row.error + ']'))
  }
  console.log('')
  console.log('coverage matrix (reading -> mutants that declare it):')
  for (const reading of DECLARED) console.log('  ' + reading + ': ' + ((coverage.get(reading) ?? []).join(', ') || '(none)'))
  const uncovered = DECLARED.filter((reading) => (coverage.get(reading) ?? []).length === 0)
  const mismatched = table.filter((row) => !row.localised).map((row) => row.id)
  console.log('')
  console.log('mutants applied ' + String(table.length - table.filter((row) => row.observed[0] === 'anchor not shipped').length) + ' of ' + String(MUTANTS.length) + '; declared-set matches ' + String(table.length - mismatched.length) + ' of ' + String(table.length) + '; uncovered readings ' + show(uncovered))
  return ok && uncovered.length === 0 && mismatched.length === 0
}

const started = Date.now()
/** A reading that throws is a FAILED reading, recorded against its own id: a gate that dies at B1 cannot report
 *  on B2..B13, and a mutant that makes the client throw is exactly the kind of thing the later readings must
 *  still be measured against. */
const guard = async (id, body) => {
  try { await body() } catch (error) {
    if (!results.some((row) => row.id === id)) record(id, false, 'threw: ' + clip(error instanceof Error ? error.message : String(error), 140))
  }
}
await guard('B1', checkB1)
await guard('B2', checkB2)
await guard('B3', checkB3)
await guard('B4', checkB4)
await guard('B5', checkB5)
await guard('B6', checkB6)
await guard('B7', checkB7)
await guard('B8', checkB8)
await guard('B9', checkB9)
await guard('B10', checkB10)
await guard('B11', checkB11)
await guard('B12', checkB12)
await guard('B13', checkB13)
await guard('B14', checkB14)
const failed = results.filter((row) => row.ok !== true).length
const ordered = DECLARED.map((id) => ({ id, ok: (results.find((row) => row.id === id) || {}).ok === true }))
const held = ordered.filter((row) => row.ok).length
const escaped = DECLARED.filter((id) => !results.some((row) => row.id === id))
console.log('')
console.log('coverage matrix: ' + String(ordered.length) + ' declared readings, ' + String(held) + ' held, ' + String(ordered.length - held) + ' failed, ' + String(escaped.length) + ' escaped')
if (JSON_OUT) console.log(JSON.stringify(Object.fromEntries(ordered.map((row) => [row.id, row.ok]))))
console.log('')
console.log('boundary: the peer is a child process this gate wrote, speaking docs/research/mcp-stdio-wire.md; the')
console.log('          handshake order, the tool surface, the four failure verdicts, the timeout bound, the orphan check')
console.log('          and the ledger feed are all read off real bytes or real pids.')
console.log('')
const orderedFinal = DECLARED.map((id) => ({ id, ok: (results.find((row) => row.id === id) || {}).ok === true }))
const heldFinal = orderedFinal.filter((row) => row.ok).length
console.log(String(orderedFinal.length) + ' readings, ' + String(heldFinal) + ' held, 0 skipped, ' + String(orderedFinal.length - heldFinal) + ' failed')
let attackOk = true
if (ATTACK && argv.indexOf('--mutant') === -1) attackOk = await runAttack()
console.log('wall ' + String(Date.now() - started) + ' ms')
if (process.env.DSH_KEEP_MUTANTS === '1') console.log('kept ' + String(MADE.length) + ' temporary director(ies) under .tmp (DSH_KEEP_MUTANTS=1)')
else for (const dir of MADE) rmSync(dir, { recursive: true, force: true })
process.exit(failed === 0 && attackOk ? 0 : 1)
// __APPEND__
