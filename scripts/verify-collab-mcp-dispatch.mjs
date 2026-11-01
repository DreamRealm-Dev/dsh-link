#!/usr/bin/env node
/**
 * R56 (task-109): MCP tools reaching a cross-end dispatch, judged against the wire basis and the ledger itself.
 *
 * Subject: .tmp/R56-contract.md section B (10 requirements) and docs/research/mcp-stdio-wire.md. The MCP peer is
 * a real child process written HERE (the producer's self-check is never imported, src/ is never read, and the
 * only product this gate reads is the built artifact).
 *
 * The readings that could go vacuously green are paired on purpose: every failure verdict (B2-B5) must show BOTH
 * the outcome (ok:false with its error text) AND that a task/result record actually reached the ledger - "there
 * is an answer" is free if nobody reads the ledger. B6 reads the fixture's own record of the requests it received
 * to show a capability mismatch never reached the subprocess, and the absence is paired with a declared call that
 * did reach it. B8 calls the name before and after the disposer and requires the two readings to differ.
 *
 * Exit 0 all held; 1 a reading failed; 2 the artifact is missing.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : resolve(argv[i + 1]) }
const ATTACK = argv.includes('--self-attack')
const JSON_OUT = argv.includes('--json')
const ARTIFACT = resolve(option('--artifact', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))

const NL = String.fromCharCode(10)
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

/** B1-B10, one reading each; B7 is the mapping table, which the contract also requires exhaustively. */
const DECLARED = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10']
const FROZEN = ['mcpDispatchOutcome', 'installMcpTools']
const REUSED = ['createMcpClient', 'createLocalTools', 'executeDispatches', 'dispatchRecord', 'resultRecord', 'projectDispatches',
  'resolveDispatch', 'capabilityRecord', 'mcpToolRecords', 'openControlLog', 'projectTeamState']
const DISPATCH_OUTCOME_KEYS = ['ok']

const MADE = []
function mkTemp(prefix) {
  mkdirSync(join(PROJECT, '.tmp'), { recursive: true })
  const dir = mkdtempSync(join(PROJECT, '.tmp', prefix))
  MADE.push(dir)
  return dir
}
function alive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
async function waitsGone(pid, budgetMs) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (!alive(pid)) return Date.now() - started
    await new Promise((settle) => setTimeout(settle, 20))
  }
  return -1
}

/** The text the multiline tool answers with: two real newlines, so one unescaped newline would break the frame. */
const MULTILINE_TEXT = 'dispatch line one' + NL + 'dispatch line two' + String.fromCharCode(13) + 'and a carriage return'
const ERROR_TEXT = 'the tool said no'
const TIMEOUT_MS = 500

/**
 * The fixture MCP server, as source lines: one JSON object per line on stdout, logs on stderr, initialize then
 * notifications/initialized, tools/list, tools/call with an isError RESULT for failure and -32602 for an unknown
 * name (docs/research/mcp-stdio-wire.md, rules 1-10). --trace records the messages it received, in order, which
 * is the only observer of what the execution side actually asked for.
 */
const FIXTURE_LINES = [
  '#!/usr/bin/env node',
  '// Written by scripts/verify-collab-mcp-dispatch.mjs (R56 gate). A fixture peer, not a product.',
  'import { appendFileSync } from "node:fs"',
  'const argv = process.argv.slice(2)',
  'const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }',
  'const TRACE = flag("--trace", "")',
  'const SLOW = Number(flag("--slow", "6000"))',
  'const NL = String.fromCharCode(10)',
  'const MULTILINE = "dispatch line one" + NL + "dispatch line two" + String.fromCharCode(13) + "and a carriage return"',
  'const TOOLS = [',
  '  { name: "add", description: "adds two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },',
  '  { name: "multiline", description: "answers with real newlines in the text", inputSchema: { type: "object" } },',
  '  { name: "fail", description: "answers with an isError result", inputSchema: { type: "object" } },',
  '  { name: "slow", description: "answers after the caller gave up", inputSchema: { type: "object" } },',
  '  { name: "crash", description: "dies in the middle of the request", inputSchema: { type: "object" } },',
  '  { name: "garbage", description: "writes a frame that is not JSON", inputSchema: { type: "object" } },',
  ']',
  'const trace = (entry) => { if (TRACE !== "") appendFileSync(TRACE, JSON.stringify(entry) + NL) }',
  'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object) + NL) }',
  'const text = (value) => ({ content: [{ type: "text", text: value }] })',
  'function handle(line) {',
  '  let message = null',
  '  try { message = JSON.parse(line) } catch { return }',
  '  const method = message.method',
  '  const params = message.params === undefined ? {} : message.params',
  '  trace({ method: method === undefined ? null : method, id: message.id === undefined ? null : message.id, tool: typeof params.name === "string" ? params.name : null })',
  '  if (method === "initialize") {',
  '    writeFrame({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "r56-fixture", version: "1.0.0" } } })',
  '    return',
  '  }',
  '  if (method === "notifications/initialized") return',
  '  if (method === "tools/list") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } }); return }',
  '  if (method === "tools/call") {',
  '    const name = params.name',
  '    const args = params.arguments === undefined ? {} : params.arguments',
  '    if (name === "add") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text(String(Number(args.a) + Number(args.b))) }); return }',
  '    if (name === "multiline") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text(MULTILINE) }); return }',
  '    if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "the tool said no" }], isError: true } }); return }',
  '    if (name === "slow") { setTimeout(() => { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("late") }) }, SLOW); return }',
  '    if (name === "crash") { process.exit(3) }',
  '    if (name === "garbage") { process.stdout.write("not json at all" + NL); return }',
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
  const dir = mkTemp('r56-' + label + '-')
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
      args: [script, '--trace', trace, '--slow', String(settings.slow === undefined ? 6000 : settings.slow)],
    },
  }
}
/** The messages the fixture received, in order: the only observer of what the execution side asked for. */
function traceOf(trace) {
  const text = readText(trace)
  if (text === null || text === '') return []
  return text.split(NL).filter((line) => line !== '').map((line) => JSON.parse(line))
}
const toolsAsked = (trace) => traceOf(trace).filter((row) => row.tool !== null).map((row) => row.tool)

/** Build a client over a fixture, run the body, and always close. */
async function withClient(spec, body, options) {
  const settings = options === undefined ? {} : options
  const config = { server: spec, clientName: 'r56-gate', clientVersion: '1.0.0' }
  if (settings.timeoutMs !== undefined) config.timeoutMs = settings.timeoutMs
  const client = mod.createMcpClient(config)
  try {
    return await body(client)
  } finally {
    try { await client.close() } catch { /* B5's reading is about a dead peer, not about close() throwing */ }
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
const blocked = () => (missingAnchors.length === 0 ? null : 'blocked: the artifact does not export ' + show(missingAnchors))
say('artifact ' + ARTIFACT.replace(PROJECT, '.') + ' sha256 ' + sha.slice(0, 16) + ' (' + String(artifactBytes.length) + ' bytes)')
say('frozen names resolved: ' + show(FROZEN.filter((name) => typeof mod[name] !== 'undefined')) + ' - the probe list is the contract, not names this gate invented')
if (missingAnchors.length > 0) say('NOT YET EXPORTED, so every reading below reports it as blocked: ' + show(missingAnchors))

/** One dispatch fact, stamped the way a real log stamps it. */
const dispatchFact = (seq, id, to, tool, args, at) => ({ seq, channel: 'control', at, actor: to, ...mod.dispatchRecord(id, to, tool, args, at) })
const kindsOf = (records) => [...new Set(records.map((row) => row.kind))].sort()
const resultsFor = (records, id) => records.filter((row) => row.kind === 'task/result' && row.subject === id)

/**
 * The world B1-B6 share: one real ledger holding the capability declaration and one dispatched job, one real MCP
 * child, the tools installed into a local registry, and the execution side run once.
 *
 * Everything the readings assert afterwards is derived from what this returns: the outcome the registry produced,
 * the records that reached the ledger, and the requests the fixture says it received.
 */
async function runDispatch(label, options) {
  const settings = options === undefined ? {} : options
  const fixture = fixtureAt(label, { slow: settings.slow })
  const dir = mkTemp('r56-log-' + label + '-')
  const log = mod.openControlLog({ dir, writer: 'end-b' })
  const local = 'end-b'
  const at = Date.now()
  const id = settings.id === undefined ? 'job-r56' : settings.id
  const listed = await withClient(fixture.spec, async (client) => {
    await client.initialize()
    const tools = await client.listTools()
    return Array.isArray(tools.tools) ? tools.tools : []
  })
  const installed = settings.extraTool === undefined ? listed : listed.concat([settings.extraTool])
  const declared = settings.declare === undefined ? installed.map((tool) => tool.name) : settings.declare
  // The declaration is the separate explicit act R55 froze: the same capability vocabulary, no new record kind.
  await log.append(mod.capabilityRecord(local, declared))
  await log.append(dispatchFact(2, id, local, settings.tool, settings.args === undefined ? {} : settings.args, at))
  const before = log.replay()
  const state = mod.projectTeamState(before)
  const started = Date.now()
  const run = await withClient(fixture.spec, async (client) => {
    await client.initialize()
    const tools = mod.createLocalTools()
    const beforeInstall = log.replay().length
    const dispose = mod.installMcpTools(tools, installed, client)
    const afterInstall = log.replay().length
    // The dispatch's own clock: B4 is about the deadline bounding the WAIT, so the reading must not be inflated
    // by the teardown poll afterwards (that window belongs to B10's orphan check, not to the timeout).
    const dispatchStarted = Date.now()
    const executed = await mod.executeDispatches(state, { local, tools, log, at, timeoutMs: settings.timeoutMs === undefined ? TIMEOUT_MS : settings.timeoutMs })
    const dispatchMs = Date.now() - dispatchStarted
    const pid = client.pid
    const pidAlive = alive(pid)
    await client.close()
    return { executed, dispose, pid, pidAlive, dispatchMs, beforeInstall, afterInstall, goneMs: await waitsGone(pid, 5000) }
  }, { timeoutMs: settings.timeoutMs })
  const elapsed = Date.now() - started
  const after = log.replay()
  const fold = mod.projectDispatches(after)
  const verdict = mod.resolveDispatch(mod.projectTeamState(after), id, at + elapsed + 1, { timeoutMs: TIMEOUT_MS, localEnd: local })
  await log.close()
  return { fixture, dir, id, at, listed, installed, declared, before, after, fold, verdict, elapsed, run }
}

/** The outcome the execution side recorded for one job, as the reading sees it. */
const outcomeOf = (world, id) => {
  const row = world.run.executed.executed.filter((entry) => entry.id === (id === undefined ? world.id : id))
  return row.length === 0 ? null : row[0].outcome
}
const errorTextOf = (outcome) => (outcome === null || outcome.ok !== false ? null : outcome.error)

// ---------------------------------------------------------------- B1 end to end, with the wire half
async function checkB1() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B1', false, blockedReason); return }
  const problems = []
  // Half one, without the product: this gate writes one request and reads the bytes the fixture answered with.
  const raw = fixtureAt('b1-wire')
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '1' } } }) + NL
    + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'multiline', arguments: {} } }) + NL
  const direct = spawnSync(process.execPath, raw.spec.args, { input: request, timeout: 30000 })
  const wireText = (direct.stdout === null ? Buffer.from('') : direct.stdout).toString('utf8')
  const wireLines = wireText.split(NL).filter((line) => line !== '')
  const newlineCount = wireText.split(NL).length - 1
  const escaped = String.fromCharCode(92) + 'n'
  const callLine = wireLines.filter((line) => line.indexOf('dispatch line one') !== -1)
  say('the wire: ' + String(wireLines.length) + ' frame(s), ' + String(newlineCount) + ' newline byte(s) for 2 requests')
  if (wireLines.length !== 2 || newlineCount !== 2) problems.push('the fixture produced ' + String(wireLines.length) + ' frame(s) and ' + String(newlineCount) + ' newline byte(s) for two requests')
  if (callLine.length !== 1 || callLine[0].indexOf('dispatch line one' + escaped + 'dispatch line two') === -1) problems.push('the multi-line text is not JSON-escaped on the wire: ' + clip(show(callLine[0]), 120))
  else say('the multi-line text travels as ' + escaped + ' on one line, byte for byte restorable')
  // Half two: the whole way through - dispatch, MCP child, ledger, fold.
  const world = await runDispatch('b1', { tool: 'multiline' })
  const outcome = outcomeOf(world)
  const landed = resultsFor(world.after, world.id)
  const dispatch = world.fold.dispatches.filter((row) => row.id === world.id)
  const folded = dispatch.length === 0 ? null : dispatch[0]
  const content = outcome !== null && outcome.ok === true && outcome.value !== undefined && Array.isArray(outcome.value.content) ? outcome.value.content : []
  const text = content.length > 0 ? content[0].text : null
  const value = folded === null || folded.result === undefined ? null : folded.result.value
  const foldedText = value !== null && value !== undefined && Array.isArray(value.content) && value.content.length > 0 ? value.content[0].text : null
  say('dispatched multiline -> outcome ' + clip(show(outcome), 90) + ' ; ledger grew by ' + String(landed.length) + ' task/result ; fold says ' + show(world.verdict.verdict))
  say('the text through the MCP tool: ' + show(text) + ' ; the same text after folding the ledger: ' + show(foldedText))
  if (outcome === null) problems.push('the execution side recorded no outcome for ' + world.id + ' (refused: ' + clip(show(world.run.executed.refused), 80) + ')')
  else if (outcome.ok !== true) problems.push('the multiline dispatch reads ' + clip(show(outcome), 100))
  if (text !== MULTILINE_TEXT) problems.push('the text through the MCP tool is not the server text: ' + clip(show(text), 100))
  if (foldedText !== MULTILINE_TEXT) problems.push('the text after folding the ledger is not byte-identical: ' + clip(show(foldedText), 100))
  if (landed.length !== 1) problems.push('the ledger holds ' + String(landed.length) + ' task/result record(s) for the job, expected 1')
  if (world.verdict.verdict !== 'answered') problems.push('the dispatch folds as ' + show(world.verdict.verdict) + ' instead of answered')
  record('B1', problems.length === 0, problems.length === 0
    ? 'a real MCP child, a real ledger and a real dispatch: the multi-line text is escaped on the wire and comes back byte for byte both from the tool and after folding, the ledger grew one task/result, and the dispatch folds answered'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B2-B5 the four failure verdicts, paired
/** Every failure verdict must produce an outcome AND a landing: "there is an answer" is free otherwise. */
async function checkFailure(id, label, options, want, extra) {
  const blockedReason = blocked()
  if (blockedReason !== null) { record(id, false, blockedReason); return null }
  const problems = []
  const world = await runDispatch(label, options)
  const outcome = outcomeOf(world)
  const landed = resultsFor(world.after, world.id)
  const error = errorTextOf(outcome)
  say('dispatched ' + options.tool + ' -> ' + clip(show(outcome), 110) + ' after ' + String(world.elapsed) + ' ms ; ledger holds ' + String(landed.length) + ' task/result for the job')
  if (outcome === null) problems.push('no outcome was recorded for the job (refused: ' + clip(show(world.run.executed.refused), 80) + ')')
  else if (outcome.ok !== false) problems.push('the outcome reads ' + clip(show(outcome), 90) + ', expected ok:false')
  if (typeof error !== 'string' || !want.test(error)) problems.push('the error text is ' + clip(show(error), 90) + ', expected something matching ' + String(want))
  if (landed.length !== 1) problems.push('the ledger holds ' + String(landed.length) + ' task/result record(s): a failure is still an answer, and an answer that never lands is not one')
  else if (landed[0].payload !== undefined && landed[0].payload.error !== undefined && landed[0].payload.error !== error) problems.push('the ledger recorded a different error (' + clip(show(landed[0].payload.error), 70) + ') than the execution side returned')
  if (extra !== undefined) extra({ world, outcome, error, problems, say, show, clip })
  record(id, problems.length === 0, problems.length === 0
    ? label + ': the outcome is ok:false with the readable error ' + clip(show(error), 70) + ' AND the ledger really grew one task/result - the failure is an answer, not a silence'
    : problems.join(' | '))
  return world
}

async function checkB2() {
  await checkFailure('B2', 'b2-tool-error', { tool: 'fail' }, /the tool said no/)
}
async function checkB3() {
  await checkFailure('B3', 'b3-unknown-tool', { tool: 'ghost', extraTool: { name: 'ghost', description: 'a name the server does not serve', inputSchema: { type: 'object' } } }, /^unknown-tool$/)
}
async function checkB4() {
  await checkFailure('B4', 'b4-timeout', { tool: 'slow', timeoutMs: TIMEOUT_MS, slow: 6000 }, /^timeout$/, ({ world, problems, say }) => {
    say('the dispatch itself returned in ' + String(world.run.dispatchMs) + ' ms for a ' + String(TIMEOUT_MS) + ' ms deadline (the whole world took ' + String(world.elapsed) + ' ms, which includes the teardown poll)')
    if (world.run.dispatchMs > TIMEOUT_MS * 12) problems.push('the dispatch took ' + String(world.run.dispatchMs) + ' ms: a deadline must bound the dispatch, not the peer')
  })
}
async function checkB5() {
  // The dead peer: the mapped error must carry the reason the client latched, not just the word transport-error.
  const preflight = await withClient(fixtureAt('b5-direct', { slow: 6000 }).spec, async (client) => {
    await client.initialize()
    const verdict = await client.callTool('crash', {})
    return { verdict }
  })
  await checkFailure('B5', 'b5-transport', { tool: 'crash' }, /^transport-error/, ({ world, outcome, error, problems, say, show, clip }) => {
    const reason = preflight.verdict.reason === undefined ? null : preflight.verdict.reason
    say('the client latched ' + clip(show({ verdict: preflight.verdict.verdict, reason }), 110) + ' ; the dispatch outcome reads ' + clip(show(outcome), 110))
    if (preflight.verdict.verdict !== 'transport-error') problems.push('the direct call on a dying peer reads ' + show(preflight.verdict.verdict))
    if (reason !== null && String(error).indexOf(reason) === -1) problems.push('the reason the client latched (' + show(reason) + ') does not survive into the dispatch outcome (' + clip(show(error), 80) + ')')
    if (reason === null) say('the client reported no reason for the dead peer, so only the verdict word is asserted (the contract asks for the reason when it is named)')
    if (world.run.goneMs < 0) problems.push('the fixture was still alive 5 s after the reading: an orphan')
  })
}
// ---------------------------------------------------------------- B6 the capability gate comes first
async function checkB6() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B6', false, blockedReason); return }
  const problems = []
  const fixture = fixtureAt('b6-mismatch')
  const dir = mkTemp('r56-log-b6-')
  const log = mod.openControlLog({ dir, writer: 'end-b' })
  const local = 'end-b'
  const at = Date.now()
  const listed = await withClient(fixture.spec, async (client) => {
    await client.initialize()
    const tools = await client.listTools()
    return Array.isArray(tools.tools) ? tools.tools : []
  })
  // 'multiline' is declared; 'add' is installed into the registry but never declared: the mismatch case.
  await log.append(mod.capabilityRecord(local, ['multiline']))
  await log.append(dispatchFact(2, 'job-declared', local, 'multiline', {}, at))
  await log.append(dispatchFact(3, 'job-undeclared', local, 'add', { a: 1, b: 2 }, at + 1))
  const state = mod.projectTeamState(log.replay())
  const run = await withClient(fixture.spec, async (client) => {
    await client.initialize()
    const tools = mod.createLocalTools()
    const dispose = mod.installMcpTools(tools, listed, client)
    const executed = await mod.executeDispatches(state, { local, tools, log, at, timeoutMs: TIMEOUT_MS })
    dispose()
    await client.close()
    return executed
  })
  const asked = toolsAsked(fixture.trace)
  const after = log.replay()
  const undeclaredLanded = resultsFor(after, 'job-undeclared')
  const declaredLanded = resultsFor(after, 'job-declared')
  const verdict = mod.resolveDispatch(mod.projectTeamState(after), 'job-undeclared', at + 5000, { timeoutMs: TIMEOUT_MS, localEnd: local })
  await log.close()
  say('the child was asked for ' + clip(show(asked), 120))
  say('executed ' + clip(show(run.executed.map((row) => ({ id: row.id, error: row.outcome === undefined ? null : row.outcome.error }))), 130) + ' ; refused ' + clip(show(run.refused), 90))
  say('the undeclared job: ledger records ' + String(undeclaredLanded.length) + ', verdict ' + clip(show(verdict), 70) + ' ; the declared job: ledger records ' + String(declaredLanded.length))
  // The absence has to be an observation, not a hole: this very run asked the same child for the declared tool.
  if (asked.indexOf('multiline') === -1) problems.push('the child never received the DECLARED request either, so "it did not receive the undeclared one" would prove nothing: ' + clip(show(asked), 100))
  if (asked.indexOf('add') !== -1) problems.push('the child received a request for the tool that was never declared: the capability gate sits behind the MCP call')
  if (declaredLanded.length !== 1) problems.push('the declared job left ' + String(declaredLanded.length) + ' record(s), expected 1')
  if (undeclaredLanded.length !== 0) problems.push('the undeclared job wrote ' + String(undeclaredLanded.length) + ' record(s): a call that must not happen was answered')
  // The word the contract names is the REFUSAL REASON in the projection (R53's rule), while the verdict closure
  // stays the five words R54 froze - refused. Both are read where the product actually says them.
  const projection = mod.projectTeamState(after)
  const refusal = show(projection.dispatches)
  const namesReason = refusal.indexOf('capability-mismatch') !== -1 && refusal.indexOf('job-undeclared') !== -1
  if (!namesReason) problems.push('the projection does not carry the refusal reason capability-mismatch for the undeclared job: ' + clip(refusal, 160))
  else say('the projection carries the refusal reason capability-mismatch for job-undeclared, and the verdict stays inside R54s closure (' + show(verdict.verdict) + ')')
  record('B6', problems.length === 0, problems.length === 0
    ? 'the capability gate runs BEFORE the MCP call: the child received the declared request and never received the undeclared one, the undeclared job wrote nothing, and its verdict names capability-mismatch'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B7 the mapping, exhaustively
async function checkB7() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B7', false, blockedReason); return }
  const problems = []
  const blocks = [{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }, { type: 'text', text: 'caption' }]
  const cases = [
    ['ok', { verdict: 'ok', content: blocks }, { ok: true, value: { content: blocks, isError: false } }],
    ['tool-error', { verdict: 'tool-error', content: [{ type: 'text', text: ERROR_TEXT }], isError: true }, { ok: false, error: ERROR_TEXT }],
    ['tool-error with no text block', { verdict: 'tool-error', content: [{ type: 'image', data: 'x', mimeType: 'image/png' }], isError: true }, { ok: false, error: 'tool-error' }],
    ['unknown-tool', { verdict: 'unknown-tool', code: -32602 }, { ok: false, error: 'unknown-tool' }],
    ['protocol-error', { verdict: 'protocol-error', detail: 'a frame was not JSON' }, { ok: false, error: 'protocol-error' }],
    ['transport-error with a reason', { verdict: 'transport-error', reason: 'server-exited' }, { ok: false, error: 'transport-error:server-exited' }],
    ['transport-error with no reason', { verdict: 'transport-error' }, { ok: false, error: 'transport-error' }],
    ['timeout', { verdict: 'timeout' }, { ok: false, error: 'timeout' }],
  ]
  for (const [label, verdict, want] of cases) {
    const got = mod.mcpDispatchOutcome(verdict)
    if (show(got) !== show(want)) problems.push(label + ' maps to ' + clip(show(got), 100) + ', expected ' + clip(show(want), 100))
    else say(label + ' -> ' + clip(show(got), 90))
  }
  // A verdict outside the frozen closure is a programming error, not a verdict: it must THROW rather than
  // quietly answer success or failure. Returning a value here is the shape this reading exists to refuse.
  let threw = null
  try { mod.mcpDispatchOutcome({ verdict: 'not-a-verdict' }) } catch (error) { threw = error }
  if (threw === null) problems.push('a verdict outside the closure returned a value instead of throwing')
  else if (!(threw instanceof TypeError)) problems.push('a verdict outside the closure threw ' + show(threw.name) + ' instead of a TypeError')
  else say('a verdict outside the closure throws ' + threw.name + ': ' + clip(threw.message, 90))
  record('B7', problems.length === 0, problems.length === 0
    ? 'every one of the ' + String(cases.length) + ' frozen verdicts maps to the documented outcome (content passed through unfiltered, the error text read off the first text block, the latched reason carried as transport-error:<reason>), and a verdict outside the closure throws TypeError'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B8 the disposer is exact
async function checkB8() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B8', false, blockedReason); return }
  const problems = []
  const fixture = fixtureAt('b8-disposer')
  const run = await withClient(fixture.spec, async (client) => {
    await client.initialize()
    const tools = mod.createLocalTools()
    const previous = tools.register('add', () => 'the handler that was there before')
    const before = tools.invoke('add', { a: 1, b: 2 })
    const dispose = mod.installMcpTools(tools, [{ name: 'add' }, { name: 'multiline' }, { name: 'third' }], client)
    const installed = { add: tools.has('add'), multiline: tools.has('multiline'), third: tools.has('third') }
    const throughMcp = tools.invoke('add', { a: 40, b: 2 })
    dispose()
    const afterHas = { add: tools.has('add'), multiline: tools.has('multiline'), third: tools.has('third') }
    const restored = tools.invoke('add', { a: 1, b: 2 })
    let second = 'not-run'
    try { dispose(); second = 'ok' } catch (error) { second = 'threw: ' + String(error.message) }
    previous()
    const finalHas = tools.has('add')
    await client.close()
    return { before, installed, throughMcp, afterHas, restored, second, finalHas }
  })
  say('before installing: add -> ' + clip(show(run.before), 80))
  say('installed: has ' + show(run.installed) + ' ; through the MCP child -> ' + clip(show(run.throughMcp), 90))
  say('after the disposer: has ' + show(run.afterHas) + ' ; add -> ' + clip(show(run.restored), 80) + ' ; disposer twice: ' + run.second)
  if (run.installed.add !== true || run.installed.multiline !== true || run.installed.third !== true) problems.push('installMcpTools did not register all three names: ' + show(run.installed))
  if (show(run.throughMcp) === show(run.before)) problems.push('calling add before and after the install returned the same value, so the MCP handler never took over: ' + clip(show(run.throughMcp), 90))
  // The name that had a handler before: restoring it means it is STILL registered, with the earlier handler.
  // The other two had nothing before them, so they must be gone. Demanding has(add) === false asks the wrong thing.
  if (run.afterHas.multiline !== false || run.afterHas.third !== false) problems.push('names with no earlier handler were left behind: ' + show(run.afterHas))
  if (run.afterHas.add !== true) problems.push('the name that had an earlier handler is no longer registered at all: ' + show(run.afterHas))
  if (show(run.restored) !== show(run.before)) problems.push('the handler that was there before was not restored: ' + clip(show(run.restored), 90) + ' instead of ' + clip(show(run.before), 90))
  if (run.second !== 'ok') problems.push('calling the disposer twice is not harmless: ' + run.second)
  if (run.finalHas !== false) problems.push('after the restored handler removed itself the name is still registered: the disposer re-registered instead of restoring')
  record('B8', problems.length === 0, problems.length === 0
    ? 'three names are installed and the MCP handler really takes over (the same call reads differently), the disposer removes all three, restores the handler that was there before (the call reads the earlier value again), and calling it twice is harmless'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B9 no new vocabulary
async function checkB9() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B9', false, blockedReason); return }
  const problems = []
  const world = await runDispatch('b9-vocabulary', { tool: 'add', args: { a: 1, b: 2 } })
  // "No new vocabulary" is judged against the kinds this artifact constructs, not against one ledger before the
  // round: the result record IS a new kind in that ledger, and it is the existing one.
  const allowed = [mod.capabilityRecord('x', []).kind, mod.dispatchRecord('i', 'x', 't', {}, 0).kind, mod.resultRecord('i', 'x', { ok: true, value: null }, 0).kind]
  const before = kindsOf(world.before)
  const after = kindsOf(world.after)
  const added = after.filter((kind) => allowed.indexOf(kind) === -1)
  say('kinds this artifact can construct: ' + clip(show(allowed), 90))
  const names = world.installed.map((tool) => tool.name)
  const produced = mod.mcpToolRecords('end-b', world.installed)
  const expected = [mod.capabilityRecord('end-b', names)]
  say('kinds in the ledger before: ' + clip(show(before), 90) + ' ; after: ' + clip(show(after), 110))
  say('mcpToolRecords(adapter, the tools the server listed) -> ' + clip(show(produced), 110))
  if (added.length > 0) problems.push('the round introduced record kind(s) the ledger did not carry before: ' + show(added))
  if (JSON.stringify(produced) !== JSON.stringify(expected)) problems.push('mcpToolRecords is no longer the capability vocabulary: ' + clip(show(produced), 100) + ' vs ' + clip(show(expected), 100))
  // Installing is not declaring: the registry is written, the ledger is not.
  if (world.run.afterInstall !== world.run.beforeInstall) problems.push('installMcpTools wrote to the ledger (' + String(world.run.beforeInstall) + ' -> ' + String(world.run.afterInstall) + ' records): declaring is a separate act')
  else say('installMcpTools wrote nothing to the ledger (' + String(world.run.beforeInstall) + ' records before and after): the registry is not the ledger')
  record('B9', problems.length === 0, problems.length === 0
    ? 'the wiring adds no vocabulary: the ledger carries only the kinds it already had, the MCP tools still enter it as exactly [capabilityRecord(adapter, names)], and installing writes nothing to the ledger at all'
    : problems.join(' | '))
}

// ---------------------------------------------------------------- B10 the peer is another process
async function checkB10() {
  const blockedReason = blocked()
  if (blockedReason !== null) { record('B10', false, blockedReason); return }
  const problems = []
  const world = await runDispatch('b10-real-child', { tool: 'add', args: { a: 2, b: 3 } })
  const asked = toolsAsked(world.fixture.trace)
  const methods = traceOf(world.fixture.trace).map((row) => row.method)
  say('client.pid ' + show(world.run.pid) + ' alive while dispatching: ' + String(world.run.pidAlive) + ' ; gone after close: ' + String(world.run.goneMs) + ' ms')
  say('the fixture process recorded: ' + clip(show(methods), 120) + ' and the tools it was asked for ' + clip(show(asked), 80))
  if (typeof world.run.pid !== 'number' || world.run.pid <= 0) problems.push('client.pid reads ' + show(world.run.pid) + ': no subprocess was started')
  else if (!world.run.pidAlive) problems.push('the pid ' + String(world.run.pid) + ' was not alive while the dispatch ran')
  if (world.run.goneMs < 0) problems.push('the fixture was still alive 5 s after close()')
  if (methods.indexOf('initialize') === -1 || methods.indexOf('notifications/initialized') === -1) problems.push('the fixture process recorded no handshake: ' + clip(show(methods), 110))
  if (asked.indexOf('add') === -1) problems.push('the fixture process recorded no tools/call for the dispatched tool: ' + clip(show(asked), 90))
  record('B10', problems.length === 0, problems.length === 0
    ? 'the MCP peer is a real child process: pid ' + String(world.run.pid) + ' was alive while the dispatch ran and gone after close(), and the child itself recorded the handshake and the tools/call it was asked for'
    : problems.join(' | '))
}
/** Count occurrences, so a mutation can never silently edit the wrong branch. */
function occurrences(text, find) {
  let count = 0
  let at = text.indexOf(find)
  while (at !== -1) { count += 1; at = text.indexOf(find, at + find.length) }
  return count
}
function swap(text, find, replace) {
  const found = occurrences(text, find)
  if (found !== 1) throw new Error('anchor occurs ' + String(found) + ' time(s), expected 1: ' + clip(show(find), 110))
  return text.split(find).join(replace)
}

/**
 * One mutant per reading, so the coverage matrix cannot have a hole by construction.
 *
 * The fixture-side mutants (M1-M5) are the stimulus this gate owns: each changes one behaviour of one tool, so
 * the reading it targets is the only one that can move. The artifact-side mutants (M6-M10) must be anchored on
 * the shipped bundle, and the wiring this round is about is not in it yet: until it ships they are declared
 * pending and the readings they would cover are reported uncovered. That is the honest reading of a gate whose
 * product does not exist yet - not a silent pass.
 */
const MUTANTS = [
  { id: 'M1', reading: 'B1', target: 'fixture', note: 'the fixture emits a real newline inside the frame',
    find: 'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object) + NL) }',
    replace: 'const writeFrame = (object) => { process.stdout.write(JSON.stringify(object).split("dispatch line two").join("dispatch" + NL + " line two") + NL) }' },
  { id: 'M2', reading: 'B2', target: 'fixture', note: 'a failed tool is answered as a JSON-RPC error instead of an isError RESULT',
    find: 'if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "the tool said no" }], isError: true } }); return }',
    replace: 'if (name === "fail") { writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "the tool said no" } }); return }' },
  { id: 'M3', reading: 'B3', target: 'fixture', note: 'an unknown tool name is answered with an isError RESULT instead of -32602',
    find: 'writeFrame({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid params: unknown tool " + String(name) } })',
    replace: 'writeFrame({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "no such tool" }], isError: true } })' },
  { id: 'M4', reading: 'B4', target: 'fixture', note: 'the slow tool answers at once, inside any deadline',
    find: 'const SLOW = Number(flag("--slow", "6000"))', replace: 'const SLOW = 0' },
  { id: 'M5', reading: 'B5', target: 'fixture', note: 'the dying peer answers before it exits',
    find: 'if (name === "crash") { process.exit(3) }',
    replace: 'if (name === "crash") { writeFrame({ jsonrpc: "2.0", id: message.id, result: text("still here") }); process.exit(3) }' },
  { id: 'M6', reading: 'B6', target: 'artifact', note: 'the capability gate moves behind the MCP call: the execution side walks every dispatch, not only the ones the projection left pending',
    find: '  for (const id of state.dispatches.pending) {', replace: '  for (const id of state.dispatches.dispatches.map((row) => row.id)) {' },
  { id: 'M7', reading: 'B7', target: 'artifact', note: 'a verdict outside the frozen closure is answered instead of throwing',
    find: '  if (name2 === "timeout") return { ok: false, error: "timeout" };',
    replace: '  if (name2 === "timeout") return { ok: false, error: "timeout" };' + NL + '  if (name2 === "not-a-verdict") return { ok: false, error: "unmapped" };' },
  { id: 'M8', reading: 'B8', target: 'artifact', note: 'the disposer removes nothing, so the names it installed stay behind',
    find: '    for (const dispose of [...disposers].reverse()) dispose();', replace: '    void disposers;' },
  { id: 'M9', reading: 'B9', target: 'artifact', note: 'mcpToolRecords invents its own payload vocabulary instead of the capability one',
    find: '  return [capabilityRecord(adapterId, names)];', replace: '  return [{ kind: "capability/state", subject: adapterId, payload: { id: adapterId, tools: names } }];' },
  { id: 'M10', reading: 'B10', target: 'artifact', note: 'close() stops closing the child, so the peer outlives the session',
    swaps: [['      stdin?.end?.();', '      void 0;'], ['        child.kill();', '        void 0;'], ['          child.kill("SIGKILL");', '          void 0;']] },
]

/** Run this same gate in a child process and read its verdict map back. */
function childVerdicts(extraArgs) {
  const run = spawnSync(process.execPath, [SELF, '--json'].concat(extraArgs), { encoding: 'utf8', timeout: 300000, cwd: PROJECT })
  const stdout = run.stdout === null ? '' : run.stdout
  const line = stdout.split(NL).filter((row) => row.startsWith('{')).pop()
  if (line !== undefined) return { ok: true, map: JSON.parse(line) }
  // A mutant violent enough to take the armed run down with it still has to be measured: the readings it managed
  // to print are read off the transcript, and every reading that never printed is false.
  const map = Object.fromEntries(DECLARED.map((id) => [id, false]))
  for (const row of stdout.split(NL)) {
    const match = /^\s+(ok|FAIL)\s+(B\d+)\b/.exec(row)
    if (match !== null && match[1] === 'ok') map[match[2]] = true
  }
  const printed = stdout.split(NL).filter((row) => /^\s+(ok|FAIL)\s+B\d+\b/.test(row)).length
  if (printed === 0) return { ok: false, why: 'the armed run printed no readings (exit ' + show(run.status) + '): ' + clip(stdout + (run.stderr || ''), 200) }
  return { ok: true, map, crashed: true }
}

async function runAttack() {
  console.log('')
  console.log('=== self-attack: one mutant per reading, declared set == observed set ===')
  console.log('  (every mutant runs this gate again in a child process, so the injection flag selects the defect and')
  console.log('   never the expectations: the baseline map comes from a clean run of the same code)')
  const base = childVerdicts([])
  if (!base.ok) { console.error('self-attack: the baseline run produced no verdict map: ' + base.why); return false }
  const foldIn = (text, mutant) => (mutant.swaps === undefined
    ? swap(text, mutant.find, mutant.replace)
    : mutant.swaps.reduce((live, pair) => swap(live, pair[0], pair[1]), text))
  const table = []
  const coverage = new Map()
  let ok = true
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
        const dir = mkTemp('r56-fix-' + mutant.id + '-')
        const file = join(dir, 'fixture-mutated.mjs')
        writeFileSync(file, foldIn(FIXTURE_TEXT, mutant))
        args = ['--fixture-file', file]
      } else {
        const dir = mkTemp('r56-art-' + mutant.id + '-')
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
  console.log('mutants applied ' + String(table.filter((row) => row.observed[0] !== 'anchor not shipped').length) + ' of ' + String(MUTANTS.length) + '; declared-set matches ' + String(table.length - mismatched.length) + ' of ' + String(table.length) + '; uncovered readings ' + show(uncovered))
  return ok && uncovered.length === 0 && mismatched.length === 0
}

const started = Date.now()
/** A reading that throws is a FAILED reading, recorded against its own id: a gate that dies at B1 cannot report
 *  on B2..B10, and a mutant that makes the product throw is exactly what the later readings must still see. */
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
const ordered = DECLARED.map((id) => ({ id, ok: (results.find((row) => row.id === id) || {}).ok === true }))
const held = ordered.filter((row) => row.ok).length
const escaped = DECLARED.filter((id) => !results.some((row) => row.id === id))
const failed = ordered.length - held
console.log('')
console.log('coverage matrix: ' + String(ordered.length) + ' declared readings, ' + String(held) + ' held, ' + String(failed) + ' failed, ' + String(escaped.length) + ' escaped')
if (JSON_OUT) console.log(JSON.stringify(Object.fromEntries(ordered.map((row) => [row.id, row.ok]))))
console.log('')
console.log('boundary: a real MCP child the gate wrote, a real ledger, and a real dispatch: the failure verdicts are')
console.log('          read from the outcome AND from the records that landed, and the capability gate is read off the')
console.log('          requests the child says it received.')
console.log(String(ordered.length) + ' readings, ' + String(held) + ' held, 0 skipped, ' + String(failed) + ' failed')
let attackOk = true
if (ATTACK && argv.indexOf('--mutant') === -1) attackOk = await runAttack()
console.log('wall ' + String(Date.now() - started) + ' ms')
if (process.env.DSH_KEEP_MUTANTS === '1') console.log('kept ' + String(MADE.length) + ' temporary director(ies) under .tmp (DSH_KEEP_MUTANTS=1)')
else for (const dir of MADE) rmSync(dir, { recursive: true, force: true })
process.exit(failed === 0 && attackOk ? 0 : 1)
