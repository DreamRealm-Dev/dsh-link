#!/usr/bin/env node
/**
 * Gate 123 (R189) - notes-route: THE TWO HTTP ROUTES OF plugins/dsh-link-notes, BOUND ON THE REAL
 * KERNEL WEB SERVER AND DRIVEN OVER A REAL SOCKET, PLUS THE ONE RULING R189-CONTRACT SECTION 1 MADE.
 *
 * Subject: plugins/dsh-link-notes/lib/index.js as delivered (the BUILT artifact; source-plane claims
 * are not made here), the two routes it binds - GET /api/dsh-link-notes/state and
 * POST /api/dsh-link-notes/add - and the contract page docs/dev/notes-ui.md.
 *
 * THE WORLD IS THE REAL KERNEL. A fresh cordis Context mounts the kernel's own WebServer service
 * (packages/host/webserver), SystemPrompt, ToolRuntime and the real agent loop (LlmRuntime,
 * SessionStore, SessionProjectionRegistry, AgentRegistry, AgentLoop); the SHIPPED apply() of the notes
 * row is called on that context with a gate-owned ledger directory, so the routes under test are
 * bound by the real WebServer.register() and answered over a socket the kernel itself listens on -
 * not by a hand-made server and not by a stub that records a handler. The agent whose tool face is
 * read in reading 10 is minted by ctx.agentLoop.create(), so its face is the kernel's own.
 *
 * THE SUBSTITUTIONS ARE NAMED, AND THERE ARE THREE (all nondeterministic inputs, none of them a rule):
 *   - the clock, pinned to one value while a ledger record is written (the record carries "at");
 *   - the id source, node:crypto's randomUUID, replaced by a gate-owned shim that mints a fixed,
 *     RESETTABLE sequence (the ledger carries the note id in its subject and payload);
 *   - the ledger instance, pre-seeded as the same fixed value in both directories of reading 6
 *     (the control log carries the instance it was opened under).
 * Everything else - the route paths, the three named codes, the two thresholds, the write function,
 * the fold, the tool registry - is the artifact's own. The pins are PRINTED in the reading that
 * needs them, and reading 6 is the only reading that uses them.
 *
 * READINGS (each independently failable, printed with the reading it was taken from):
 *   01 BOTH ROUTES ARE BOUND IN THE REAL KERNEL WEB SERVER. The real WebServer service's own exact
 *      route table holds both frozen paths with a handler; a path nobody registered answers the
 *      KERNEL's own 404 (which is what says the socket belongs to the kernel, not to a stand-in).
 *   02 THE STATE ROUTE ANSWERS 200 WITH THE ROW'S TWO THRESHOLDS. GET over the socket: 200, JSON, and
 *      an object carrying the two configured numbers (this gate configures 3 and 12, so a printed
 *      default would be a red reading).
 *   03 THE STATE ROUTE FOLDS THE LEDGER THE TOOLS WRITE TO. A note appended through the mounted store
 *      (the same store the tools and the route hold) appears in the served state.
 *   04 A GET CHANGES NO LEDGER BYTE. The ledger's per-file bytes and sha256 are identical either side
 *      of the GETs, both on an empty ledger and on a populated one, and the GETs answered 200 - the
 *      reading is taken over a 200, never over a 404.
 *   05 A VERB THAT IS NEITHER GET NOR POST IS REFUSED BY NAME. DELETE against both routes and PUT,
 *      PATCH and POST-state answer 405 with a named code and the Allow header; HEAD is reported and
 *      not judged (the panel precedent answers 200 to HEAD and the contract does not freeze it).
 *      The code is judged as a NAME (any all-caps word), because the contract freezes "refused by a
 *      name" and not one spelling; the Allow header is printed as evidence rather than judged.
 *   06 PAIRED, AND THIS IS THE POINT OF THE GATE: THE ROUTE AND appendNote WRITE THE SAME BYTES. One
 *      and the same input - the same text, the same tags, the author the route defaults to - written
 *      once through POST /add and once through the artifact's own appendNote, over two fresh ledgers
 *      opened under the same instance, at the same pinned clock, with the id source reset before each
 *      write, produces byte-identical ledgers (per-file bytes AND the whole-directory sha256). A route
 *      that re-implemented the boundary test, trimmed the body or minted its own record cannot hold
 *      this; that is why "no second set of rules" is measured rather than asserted.
 *   07 NOTES_INPUT TRAVELS OVER THE ROUTE AND WRITES NOTHING. POST with a wrongly typed body answers
 *      a refusal status (400 in this build) with code NOTES_INPUT and the ledger bytes are unchanged.
 *   08 NOTES_TOO_LONG TRAVELS OVER THE ROUTE AND WRITES NOTHING. A body of maxChars+1 code points
 *      answers with code NOTES_TOO_LONG and the ledger bytes are unchanged.
 *   09 NOTES_FULL TRAVELS OVER THE ROUTE AND WRITES NOTHING. With the ledger already holding
 *      maxNotes live notes, one more valid body answers with code NOTES_FULL and no byte moves.
 *   10 THE AGENT'S TOOL FACE HAS NO MEMBER FOR THE ROUTE. The face read out of the real ToolRuntime
 *      for a real agent carries exactly the names the artifact itself declares, no name is
 *      route-shaped, neither frozen route path appears anywhere in the serialized schemas, and
 *      executing the route path as a tool answers UNKNOWN_TOOL: a route is not a tool, and the model
 *      has no way to reach it.
 *   11 THE CONTRACT PAGE HOLDS AND CARRIES AT LEAST 10 CITATIONS. check-protocol-page.mjs
 *      --page docs/dev/notes-ui.md exits 0 and prints N of M with N === M and M >= 10 (M is READ).
 *   12 PAIRED: THE PAGE REDDENS WHEN ONE ROW MOVES. A copy whose first path:line citation is shifted
 *      by one line (or, if the page carries no path:line row, whose first citation requirement is
 *      reworded) exits non-zero while the page as shipped exits 0.
 *
 * Self-attack: --self-attack stages a copy of the package and the page under .tmp/r189-g123, applies
 * ONE edit per mutant to that copy, and re-runs the SAME judge. It asserts per mutant that the set of
 * readings that moved is exactly the declared set, prints the sentence 声明集 == 观测集 for each,
 * requires every reading to be declared by at least one mutant, and includes a control mutant that
 * changes nothing. Every anchor is a string the frozen interface names: the two route paths, the
 * three refusal codes, the route's default author, and the page's own citation rows.
 *
 * WHAT THIS GATE CANNOT JUDGE, named so that nobody reads a green as more than it is: whether the
 * client half of the panel renders any of this (that is P2's self-check and gate 124's live reading),
 * whether anything is visible as a pixel, whether the live client at 31761/31760 carries these routes,
 * whether a second PROCESS could open the same ledger, and whether the route's same-origin claim
 * holds against a non-loopback caller (the kernel binds the host the composition configures; this
 * gate binds 127.0.0.1 and does not test another interface).
 *
 * This gate binds its OWN ephemeral loopback port and never connects to 31761/31760/9222, never starts
 * or stops the client, never reads or writes the live profile, and writes nowhere but .tmp/r189-g123.
 * --subject <dir> measures another tree that carries plugins/dsh-link-notes and the page, so a red can
 * be reproduced by hand without touching this tree; the citation checker still resolves the page's
 * citations against THIS repository, which is what keeps the page mutant precise. The staged copy is
 * checked to be faithful: reversing the specifier rewrites gives the shipped bytes back.
 *
 * Exit 0 every reading held | 1 a reading failed (or a declared mutant set did not match what moved)
 * | 3 the subject cannot be measured here: the built artifact is missing (run: node plugins/build.mjs),
 * a kernel module or the citation checker is not on this machine, the artifact names a specifier this
 * gate cannot resolve offline, or a composition could not be built. A reading that cannot be measured
 * is never green.
 *
 * Usage: node scripts/verify-notes-route.mjs [--self-attack] [--keep] [--subject <dir>]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Agent, request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root: found by walking up to the tree that owns the kernel this gate reads. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'core', 'deepseek-harness', 'package.json')) && existsSync(join(at, 'plugins'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
/** The tree to measure: the project itself, or a copy of it (--subject) for a hand-made red. */
const SUBJECT = resolve(option('--subject', PROJECT))

const NOTES = 'dsh-link-notes'
const PAGE_REL = join('docs', 'dev', 'notes-ui.md')
const SCRATCH_REL = join('.tmp', 'r189-g123')

/** The frozen interface (R189-contract sections 1 and 2): every expectation below uses these. */
const STATE_PATH = '/api/dsh-link-notes/state'
const ADD_PATH = '/api/dsh-link-notes/add'
const CODE_INPUT = 'NOTES_INPUT'
const CODE_TOO_LONG = 'NOTES_TOO_LONG'
const CODE_FULL = 'NOTES_FULL'
const ROUTE_AUTHOR = 'user'
const MIN_CITATIONS = 10
/** The two thresholds this gate configures. Distinct values, so a printed default cannot pass by luck. */
const LIMITS = { maxNotes: 3, maxChars: 12 }
/** Reading 6's world: four live notes, a comfortable body limit, and the three pins. */
const IDENTITY_LIMITS = { maxNotes: 4, maxChars: 24 }
const CLOCK = 1750000000000
const INSTANCE = 'ffffffff-0000-4000-8000-ffffffffffff'
const READINGS = [
  '01-both-routes-are-bound-in-the-real-kernel-web-server',
  '02-the-state-route-answers-200-with-the-two-thresholds',
  '03-the-state-route-folds-the-ledger-the-store-holds',
  '04-a-GET-changes-no-ledger-byte',
  '05-a-verb-that-is-neither-GET-nor-POST-is-refused-by-name',
  '06-the-route-and-appendNote-write-byte-identical-ledgers',
  '07-NOTES_INPUT-travels-over-the-route-and-writes-nothing',
  '08-NOTES_TOO_LONG-travels-over-the-route-and-writes-nothing',
  '09-NOTES_FULL-travels-over-the-route-and-writes-nothing',
  '10-the-real-agents-tool-face-has-no-member-for-the-route',
  '11-the-contract-page-holds-and-carries-at-least-ten-citations',
  '12-PAIRED-the-page-reddens-when-one-row-moves',
]

/** The kernel modules the artifact and this gate must SHARE, by path, so both sides see one service. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent-loop': join(KERNEL, 'packages', 'core', 'agent-loop', 'lib', 'index.js'),
  '@deepseek-ai/dsh-llm': join(KERNEL, 'packages', 'llm', 'llm', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session-projection': join(KERNEL, 'packages', 'session', 'session-projection', 'lib', 'index.js'),
  '@deepseek-ai/dsh-host-webserver': join(KERNEL, 'packages', 'host', 'webserver', 'lib', 'index.js'),
}
const COLLAB_MODULE = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const PAGE_CHECKER = join(PROJECT, 'scripts', 'check-protocol-page.mjs')
const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)]

/** The gate's only module substitution: the id source, made deterministic AND resettable. */
const CRYPTO_SHIM_SOURCE = [
  '// gate 123 substitution: the artifact\'s id source, pinned so two write paths can be compared.',
  'export * from "node:crypto"',
  'let minted = 0',
  'export function __reset() { minted = 0 }',
  'export function randomUUID() {',
  '  minted += 1',
  '  return "00000000-0000-4000-8000-" + String(minted).padStart(12, "0")',
  '}',
  '',
].join('\n')

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const slug = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_')
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

// ---------------------------------------------------------------------------
// Bytes on disk: this gate's own reader, so no expectation is read back from the plugin.
// ---------------------------------------------------------------------------
const filesUnder = (root) => {
  const out = []
  const walk = (rel) => {
    const abs = rel === '' ? root : join(root, rel)
    if (existsSync(abs) === false) return
    for (const name of readdirSync(abs).sort()) {
      const child = rel === '' ? name : rel + '/' + name
      if (statSync(join(abs, name)).isDirectory()) walk(child)
      else out.push(child)
    }
  }
  walk('')
  return out.sort()
}
const ledgerBytes = (root) => {
  const map = {}
  for (const rel of filesUnder(root)) map[rel] = readFileSync(join(root, rel))
  return map
}
const ledgerDigest = (map) => sha256(Buffer.concat(Object.keys(map).sort().map((rel) => Buffer.concat([Buffer.from(rel + '=', 'utf8'), map[rel], Buffer.from(';', 'utf8')]))))
const ledgerSizes = (map) => Object.keys(map).sort().map((rel) => rel + ' ' + String(map[rel].length) + 'B').join(', ')
const ledgerSame = (left, right) => {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys.every((rel) => left[rel] !== undefined && right[rel] !== undefined && left[rel].equals(right[rel]))
}

// ---------------------------------------------------------------------------
// The socket: node:http against the kernel's own listening port, with an agent that keeps nothing
// alive (a half-closed socket at exit trips a libuv assertion on Windows and the exit code stops
// describing the readings).
// ---------------------------------------------------------------------------
const socketCall = (port, path, method, body) => new Promise((done) => {
  const agent = new Agent({ keepAlive: false })
  const headers = body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
  const request = httpRequest({ host: '127.0.0.1', port, path, method, agent, headers }, (response) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => {
      let parsed = null
      try { parsed = JSON.parse(text) } catch { parsed = null }
      agent.destroy()
      done({ status: response.statusCode, type: response.headers['content-type'] ?? null, cache: response.headers['cache-control'] ?? null, allow: response.headers.allow ?? null, body: parsed, text })
    })
  })
  request.on('error', (error) => {
    agent.destroy()
    done({ status: 0, type: null, cache: null, allow: null, body: null, text: '', error: String((error === null || error === undefined ? '' : (error.code ?? error.message))) })
  })
  if (body !== undefined) request.write(body)
  request.end()
})

/** The first object in an answer that carries both configured thresholds. Tolerant of field names. */
const findThresholds = (body) => {
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return null
    if (Array.isArray(node) === false) {
      const numbers = Object.entries(node).filter(([, value]) => typeof value === 'number')
      const hasNotes = numbers.some(([, value]) => value === LIMITS.maxNotes)
      const hasChars = numbers.some(([, value]) => value === LIMITS.maxChars)
      if (hasNotes && hasChars) return { path, node }
    }
    for (const [key, value] of Object.entries(node)) {
      const found = walk(value, path === '' ? key : path + '.' + key)
      if (found !== null) return found
    }
    return null
  }
  return walk(body, '')
}

// ---------------------------------------------------------------------------
// Staging: the shipped bytes of the package, copied, with ONLY their import specifiers rewritten
// onto the exact module paths this gate also imports (and the id source onto the shim).
// ---------------------------------------------------------------------------
const substitutions = (runDir) => Object.assign({}, KERNEL_MODULES, {
  '../../dsh-link-collab/lib/index.js': COLLAB_MODULE,
  'node:crypto': join(runDir, 'gate123-crypto-shim.mjs'),
})
const rewriteSpecifiers = (source, subs) => {
  let text = source
  let hits = 0
  for (const specifier of Object.keys(subs)) {
    const url = pathToFileURL(subs[specifier]).href
    for (const quote of QUOTES) {
      const parts = text.split(quote + specifier + quote)
      hits += parts.length - 1
      text = parts.join(quote + url + quote)
    }
  }
  return { text, hits }
}
/** The inverse of rewriteSpecifiers: staging is faithful when this gives the shipped bytes back. */
const unstageSource = (text, subs) => {
  let out = text
  for (const specifier of Object.keys(subs)) out = out.split(pathToFileURL(subs[specifier]).href).join(specifier)
  return out
}
/** Bare or relative specifiers the artifact still names after staging: this gate cannot resolve those. */
const leftovers = (text) => {
  const found = new Set()
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const specifier = match[1]
    if (specifier.startsWith('node:') || specifier.startsWith('data:') || specifier.startsWith('file:')) continue
    found.add(specifier)
  }
  return [...found].sort()
}

/** Copy the two subjects into the run root, so a mutant edits a copy and the tree stays untouched. */
const stageSubject = (root) => {
  const packageSource = join(SUBJECT, 'plugins', NOTES)
  const packageTarget = join(root, 'plugins', NOTES)
  if (existsSync(packageSource)) {
    mkdirSync(dirname(packageTarget), { recursive: true })
    cpSync(packageSource, packageTarget, { recursive: true, filter: (source) => source.includes('node_modules') === false })
  }
  const pageSource = join(SUBJECT, PAGE_REL)
  if (existsSync(pageSource)) {
    mkdirSync(dirname(join(root, PAGE_REL)), { recursive: true })
    cpSync(pageSource, join(root, PAGE_REL))
  }
  return { packageDir: packageTarget, artifact: join(packageTarget, 'lib', 'index.js'), page: join(root, PAGE_REL) }
}

/** Rewrite the specifiers of every module in the staged package, in place, and report what moved. */
const stagePackageModules = (packageDir, subs) => {
  const rows = []
  for (const rel of filesUnder(packageDir)) {
    if (/\.(?:js|mjs|cjs)$/.test(rel) === false) continue
    const path = join(packageDir, rel)
    const before = readFileSync(path, 'utf8')
    const rewritten = rewriteSpecifiers(before, subs)
    if (rewritten.hits > 0) writeFileSync(path, rewritten.text)
    const rest = leftovers(rewritten.text).filter((specifier) => Object.values(subs).some((file) => pathToFileURL(file).href === specifier) === false)
    rows.push({ rel, hits: rewritten.hits, leftovers: rest })
  }
  return rows
}

// ---------------------------------------------------------------------------
// The page: the checker that owns the citations, on the shipped page and on a copy with one row moved.
// ---------------------------------------------------------------------------
const citationCounts = (stdout) => {
  const match = /(\d+) of (\d+) citation\(s\) hold/.exec(stdout)
  return match === null ? { holds: null, total: null } : { holds: Number(match[1]), total: Number(match[2]) }
}
const runCitationChecker = (pagePath) => {
  if (!existsSync(PAGE_CHECKER)) return { path: pagePath, exit: null, holds: null, total: null, last: '', error: 'the checker is not on this machine: ' + PAGE_CHECKER }
  const last = (stdout) => String(stdout).split(/\r?\n/).filter((line) => line.trim() !== '').slice(-1)[0] ?? ''
  try {
    const stdout = execFileSync(process.execPath, [PAGE_CHECKER, '--page', pagePath], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return { path: pagePath, exit: 0, stdout, last: last(stdout), error: null, ...citationCounts(stdout) }
  } catch (error) {
    const stdout = String(error.stdout === undefined ? '' : error.stdout)
    return { path: pagePath, exit: error.status === undefined ? null : error.status, stdout, last: last(stdout), error: describe(error), ...citationCounts(stdout) }
  }
}
/** Move one citation row: the first path:line shifted by one, or a requirement reworded. */
const moveOneRow = (pageText) => {
  const exact = /(\|[^\n|]*\|[^\n|]*?):(\d+)(\s*\|)/.exec(pageText)
  if (exact !== null) {
    const shifted = pageText.slice(0, exact.index) + exact[1] + ':' + String(Number(exact[2]) + 1) + exact[3] + pageText.slice(exact.index + exact[0].length)
    return { applied: true, why: 'the first path:line citation was moved one line down', text: shifted }
  }
  const lines = pageText.split('\n')
  let inside = false
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    if (line.startsWith('<!-- citations')) { inside = true; continue }
    if (line.trim() === '<!-- /citations -->') { inside = false; continue }
    if (inside === false || line.trim().startsWith('|') === false) continue
    const cells = line.split('|')
    if (cells.length < 5) continue
    const id = (cells[1] ?? '').trim()
    if (id === 'id' || /^-+$/.test(id)) continue
    cells[cells.length - 2] = cells[cells.length - 2] + ' gate123-moved'
    const moved = [...lines]
    moved[at] = cells.join('|')
    return { applied: true, why: 'the first citation requirement was reworded', text: moved.join('\n') }
  }
  return { applied: false, why: 'the page carries no citation row this gate can move', text: pageText }
}

// ---------------------------------------------------------------------------
// The kernel: the real services, by path, one instance each.
// ---------------------------------------------------------------------------
let KERNEL_CACHE = null
const loadKernel = async () => {
  if (KERNEL_CACHE !== null) return KERNEL_CACHE
  for (const specifier of Object.keys(KERNEL_MODULES)) {
    if (existsSync(KERNEL_MODULES[specifier]) === false) {
      throw new Error('the kernel module ' + specifier + ' is missing at ' + KERNEL_MODULES[specifier] + '; this gate mounts the real kernel and will not stand in a fake web server')
    }
  }
  const load = (key) => import(pathToFileURL(KERNEL_MODULES[key]).href)
  const cordis = await load('@deepseek-ai/cordis')
  const prompt = await load('@deepseek-ai/dsh-system-prompt')
  const tools = await load('@deepseek-ai/dsh-tools')
  const webserver = await load('@deepseek-ai/dsh-host-webserver')
  const session = await load('@deepseek-ai/dsh-session')
  const agent = await load('@deepseek-ai/dsh-agent')
  const loop = await load('@deepseek-ai/dsh-agent-loop')
  const projection = await load('@deepseek-ai/dsh-session-projection')
  const llm = await load('@deepseek-ai/dsh-llm')
  KERNEL_CACHE = {
    Context: cordis.Context,
    SystemPrompt: prompt.default,
    ToolRuntime: tools.default,
    WebServer: webserver.default,
    SessionStore: session.default,
    AgentRegistry: agent.default,
    AgentLoop: loop.default,
    SessionProjectionRegistry: projection.default,
    LlmRuntime: llm.default === undefined ? llm.LlmRuntime : llm.default,
  }
  return KERNEL_CACHE
}

/** Mount one plugin and keep its fiber, so the world can be torn down and its port released. */
const makeMounter = (ctx, fibers) => async (plugin, config) => {
  const fiber = ctx.plugin(plugin, config)
  await fiber
  fibers.push(fiber)
  return fiber
}
const disposeAll = async (fibers) => {
  const failed = []
  for (const fiber of [...fibers].reverse()) {
    try { await fiber.dispose() } catch (error) { failed.push(describe(error)) }
  }
  return failed
}

// ---------------------------------------------------------------------------
// World A: the routes, over the real kernel web server, on a gate-owned ledger.
// ---------------------------------------------------------------------------
const buildRouteWorld = async (K, runDir, notesModule) => {
  const dir = join(runDir, 'state-ledger')
  mkdirSync(dir, { recursive: true })
  const t = { dir, boot: [], noteText: 'g123-alpha', extraTexts: ['g123-bravo', 'g123-charlie'] }
  const ctx = new K.Context()
  const fibers = []
  const mount = makeMounter(ctx, fibers)
  const spoken = []
  const realLog = console.log
  const realError = console.error
  try {
    await mount(K.WebServer, { host: '127.0.0.1', port: 0 })
    await mount(K.SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
    await mount(K.ToolRuntime)
    await mount(K.LlmRuntime)
    await mount(K.SessionStore)
    await mount(K.SessionProjectionRegistry)
    await mount(K.AgentRegistry)
    await mount(K.AgentLoop, { agents: [] })
    console.log = (line) => { spoken.push(String(line)) }
    console.error = (line) => { spoken.push('ERR ' + String(line)) }
    await mount(notesModule, { dir, maxNotes: LIMITS.maxNotes, maxChars: LIMITS.maxChars })
  } finally {
    console.log = realLog
    console.error = realError
  }
  t.boot = spoken
  const server = ctx.get('webServer')
  t.server = {
    present: server !== undefined && server !== null,
    port: server === undefined || server === null ? null : server.port,
    host: server === undefined || server === null ? null : server.host,
    exact: [],
  }
  if (t.server.present && server.exact !== undefined) {
    for (const [path, route] of server.exact.entries()) t.server.exact.push({ path, kind: route.kind ?? null, handler: typeof route.handler })
  }
  t.stranger = await socketCall(t.server.port, '/api/dsh-link-notes/gate123-nobody', 'GET')
  t.emptyBefore = ledgerBytes(dir)
  t.getsEmpty = []
  for (let at = 0; at < 3; at += 1) t.getsEmpty.push(await socketCall(t.server.port, STATE_PATH, 'GET'))
  t.emptyAfter = ledgerBytes(dir)
  const store = ctx.get('linkNotes')
  t.store = { present: store !== undefined && store !== null }
  t.appended = await notesModule.appendNote(store, { text: t.noteText, tags: ['g123'], author: ROUTE_AUTHOR }, LIMITS)
  t.populatedBefore = ledgerBytes(dir)
  t.getAfter = await socketCall(t.server.port, STATE_PATH, 'GET')
  t.getAgain = await socketCall(t.server.port, STATE_PATH, 'GET')
  t.populatedAfter = ledgerBytes(dir)
  t.verbs = []
  for (const one of [
    { path: STATE_PATH, method: 'DELETE' },
    { path: STATE_PATH, method: 'POST', body: '{}' },
    { path: ADD_PATH, method: 'DELETE' },
    { path: ADD_PATH, method: 'PUT' },
    { path: ADD_PATH, method: 'PATCH' },
    { path: STATE_PATH, method: 'HEAD' },
    { path: ADD_PATH, method: 'HEAD' },
  ]) {
    const answer = await socketCall(t.server.port, one.path, one.method, one.body)
    t.verbs.push({ path: one.path, method: one.method, status: answer.status, allow: answer.allow, code: answer.body === null || answer.body.error === undefined ? null : (answer.body.error.code ?? null), ok: answer.body === null ? null : answer.body.ok, text: clip(answer.text, 200) })
  }
  t.input = { before: ledgerBytes(dir) }
  t.input.answer = await socketCall(t.server.port, ADD_PATH, 'POST', JSON.stringify({ text: 42 }))
  t.input.after = ledgerBytes(dir)
  t.inputOthers = []
  for (const raw of [JSON.stringify({}), JSON.stringify({ text: 'g123-ok', nope: 1 }), '{not json']) {
    const answer = await socketCall(t.server.port, ADD_PATH, 'POST', raw)
    t.inputOthers.push({ sent: raw, status: answer.status, code: answer.body === null || answer.body.error === undefined ? null : (answer.body.error.code ?? null), message: answer.body === null || answer.body.error === undefined ? null : clip(answer.body.error.message, 160) })
  }
  t.tooLong = { body: JSON.stringify({ text: 'x'.repeat(LIMITS.maxChars + 1), author: ROUTE_AUTHOR }), before: ledgerBytes(dir) }
  t.tooLong.answer = await socketCall(t.server.port, ADD_PATH, 'POST', t.tooLong.body)
  t.tooLong.after = ledgerBytes(dir)
  t.full = { filled: [], before: null, answer: null, after: null }
  t.full.before = ledgerBytes(dir)
  for (const text of t.extraTexts) t.full.filled.push(await notesModule.appendNote(store, { text, tags: [], author: ROUTE_AUTHOR }, LIMITS))
  t.full.before = ledgerBytes(dir)
  t.full.answer = await socketCall(t.server.port, ADD_PATH, 'POST', JSON.stringify({ text: 'g123-late', author: ROUTE_AUTHOR }))
  t.full.after = ledgerBytes(dir)
  t.face = { registry: [], agent: [], schemas: null, unknownTool: null, error: null }
  try {
    const agent = await ctx.agentLoop.create('gate123-face', { provider: 'mock', model: 'model' })
    const agentSchemas = ctx.tools.schemas(agent)
    t.face.registry = ctx.tools.schemas().map((tool) => String(tool.name))
    t.face.agent = agentSchemas.map((tool) => String(tool.name))
    t.face.schemas = JSON.stringify(agentSchemas)
    const answer = await ctx.tools.execute({ signal: new AbortController().signal, callId: 'gate123-face-probe', name: ADD_PATH, arguments: {}, agent })
    t.face.unknownTool = { isError: answer !== null && answer !== undefined && answer.isError === true, text: clip(show(answer), 400) }
  } catch (error) {
    t.face.error = describe(error)
  }
  t.teardown = await disposeAll(fibers)
  return t
}

// ---------------------------------------------------------------------------
// World B, reading 6: the same input, two write paths, two fresh ledgers, one pinned world.
// ---------------------------------------------------------------------------
const buildIdentityWorld = async (K, runDir, notesModule, shimPath) => {
  const routeDir = join(runDir, 'identity-route-ledger')
  const directDir = join(runDir, 'identity-direct-ledger')
  for (const dir of [routeDir, directDir]) {
    mkdirSync(join(dir, 'notes'), { recursive: true })
    writeFileSync(join(dir, 'notes', '.instance'), INSTANCE + '\n')
  }
  const t = { routeDir, directDir, clock: CLOCK, instance: INSTANCE, input: { text: 'g123-beta', tags: ['t'], author: ROUTE_AUTHOR } }
  const ctx = new K.Context()
  const fibers = []
  const mount = makeMounter(ctx, fibers)
  const spoken = []
  const realLog = console.log
  const realError = console.error
  try {
    await mount(K.WebServer, { host: '127.0.0.1', port: 0 })
    await mount(K.SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
    await mount(K.ToolRuntime)
    console.log = (line) => { spoken.push(String(line)) }
    console.error = (line) => { spoken.push('ERR ' + String(line)) }
    await mount(notesModule, { dir: routeDir, maxNotes: IDENTITY_LIMITS.maxNotes, maxChars: IDENTITY_LIMITS.maxChars })
  } finally {
    console.log = realLog
    console.error = realError
  }
  t.boot = spoken
  t.port = ctx.get('webServer').port
  const shim = await import(pathToFileURL(shimPath).href)
  const realNow = Date.now
  shim.__reset()
  try {
    Date.now = () => CLOCK
    t.routeAnswer = await socketCall(t.port, ADD_PATH, 'POST', JSON.stringify({ text: t.input.text, tags: t.input.tags }))
  } finally {
    Date.now = realNow
  }
  const store = notesModule.openNotesStore(directDir, { writer: 'host' })
  shim.__reset()
  try {
    Date.now = () => CLOCK
    t.direct = await notesModule.appendNote(store, t.input, IDENTITY_LIMITS)
  } finally {
    Date.now = realNow
  }
  store.close()
  t.routeBytes = ledgerBytes(routeDir)
  t.directBytes = ledgerBytes(directDir)
  t.routeDigest = ledgerDigest(t.routeBytes)
  t.directDigest = ledgerDigest(t.directBytes)
  t.same = ledgerSame(t.routeBytes, t.directBytes)
  t.routeSizes = ledgerSizes(t.routeBytes)
  t.directSizes = ledgerSizes(t.directBytes)
  t.teardown = await disposeAll(fibers)
  return t
}

// ---------------------------------------------------------------------------
// The transcript. Every reading below is arithmetic over this object and nothing else.
// ---------------------------------------------------------------------------
const buildWorld = async (root, runDir) => {
  // The caller STAGES FIRST (stageSubject copies the subjects into root), so a self-attack mutant can
  // edit the copy between staging and measuring: a buildWorld that copied again would overwrite it.
  const staged = { packageDir: join(root, 'plugins', NOTES), artifact: join(root, 'plugins', NOTES, 'lib', 'index.js'), page: join(root, PAGE_REL) }
  const world = { root, runDir, fatal: null, staging: null, artifact: null, exports: null, route: null, identity: null, page: { pristine: null, moved: null } }
  const shimPath = join(runDir, 'gate123-crypto-shim.mjs')
  writeFileSync(shimPath, CRYPTO_SHIM_SOURCE)
  world.staging = { packageDir: staged.packageDir, artifact: staged.artifact, page: staged.page, shimPath, modules: [] }
  const shippedArtifact = join(SUBJECT, 'plugins', NOTES, 'lib', 'index.js')
  if (existsSync(staged.artifact) === false) {
    world.fatal = 'the built artifact is missing, so nothing below it can be measured: ' + staged.artifact + ' - run: node plugins/build.mjs'
    return world
  }
  const rows = stagePackageModules(staged.packageDir, substitutions(runDir))
  world.staging.modules = rows
  const unresolvable = rows.filter((row) => row.leftovers.length > 0)
  if (unresolvable.length > 0) {
    world.fatal = 'the staged artifact names specifiers this gate cannot resolve offline: ' + unresolvable.map((row) => row.rel + ' -> ' + row.leftovers.join(', ')).join('; ')
    return world
  }
  world.artifact = {
    shipped: shippedArtifact,
    shippedSha: sha256(readFileSync(shippedArtifact)),
    shippedBytes: statSync(shippedArtifact).size,
    staged: staged.artifact,
    stagedSha: sha256(readFileSync(staged.artifact)),
    rewrites: rows.reduce((total, row) => total + row.hits, 0),
    identicalToShipped: readFileSync(staged.artifact).equals(readFileSync(shippedArtifact)),
    // What the specifier rewrite took away, un-replaced: staging is faithful when this is the shipped
    // text again, which is what makes "the measured artifact is the shipped artifact" a reading.
    faithful: unstageSource(readFileSync(staged.artifact, 'utf8'), substitutions(runDir)) === readFileSync(shippedArtifact, 'utf8'),
  }
  for (const [what, path] of [['the citation checker', PAGE_CHECKER], ...Object.entries(KERNEL_MODULES)]) {
    if (existsSync(path)) continue
    world.fatal = what + ' is not on this machine: ' + path
    return world
  }
  if (existsSync(join(root, PAGE_REL)) === false) world.staging.pageMissing = join(root, PAGE_REL)
  let notesModule = null
  try {
    notesModule = await import(pathToFileURL(staged.artifact).href)
  } catch (error) {
    world.fatal = 'the staged artifact does not import: ' + describe(error)
    return world
  }
  world.exports = {
    keys: Object.keys(notesModule).sort(),
    listTool: notesModule.LIST_TOOL ?? null,
    addTool: notesModule.ADD_TOOL ?? null,
    refusals: notesModule.REFUSALS ?? null,
    statePath: notesModule.NOTES_ROUTE_PATH ?? null,
    addPath: notesModule.NOTES_ADD_ROUTE_PATH ?? null,
    routeAuthor: notesModule.ROUTE_AUTHOR ?? null,
  }
  const K = await loadKernel()
  try {
    world.route = await buildRouteWorld(K, runDir, notesModule)
  } catch (error) {
    world.fatal = 'the route world could not be built: ' + describe(error)
    return world
  }
  try {
    world.identity = await buildIdentityWorld(K, runDir, notesModule, shimPath)
  } catch (error) {
    world.fatal = 'the byte-identity world could not be built: ' + describe(error)
    return world
  }
  world.page.pristine = runCitationChecker(join(root, PAGE_REL))
  const pageBytesPath = join(root, PAGE_REL)
  if (existsSync(pageBytesPath) === false) {
    world.page.moved = { applied: false, why: 'the page is missing at ' + pageBytesPath, path: null, exit: null, holds: null, total: null, last: '' }
  } else {
    const moved = moveOneRow(readFileSync(pageBytesPath, 'utf8'))
    if (moved.applied === false) {
      world.page.moved = { applied: false, why: moved.why, path: null, exit: null, holds: null, total: null, last: '' }
    } else {
      const movedPath = join(runDir, 'page-moved.md')
      writeFileSync(movedPath, moved.text)
      world.page.moved = { applied: true, why: moved.why, ...runCitationChecker(movedPath) }
    }
  }
  return world
}

// ---------------------------------------------------------------------------
// The judge: a pure function over the transcript above. Nothing here reads the clock or the disk.
// ---------------------------------------------------------------------------
/** A code that is a NAME: an all-caps word, which is what "refused by name" means for a refusal. */
const codeIsNamed = (code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)
const errorCode = (answer) => answer === null || answer === undefined || answer.body === null || answer.body.error === undefined ? null : (answer.body.error.code ?? null)

function judge(world) {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok: ok === true, detail, evidence: evidence === undefined ? [] : evidence })
  const route = world.route
  const identity = world.identity
  const exports = world.exports

  // 01 -- the routes live in the real kernel web server's own table, and the socket is the kernel's.
  {
    const rows = []
    const server = route.server
    const state = server.exact.find((one) => one.path === STATE_PATH) ?? null
    const addOne = server.exact.find((one) => one.path === ADD_PATH) ?? null
    rows.push('the real service: ctx.get("webServer") ' + (server.present ? 'present, bound on ' + show(server.host) + ':' + String(server.port) + ' (an ephemeral port this gate owns; this gate never connects to 31761/31760/9222)' : 'ABSENT'))
    rows.push('its own exact route table: ' + show(server.exact.map((one) => one.path)))
    rows.push('frozen ' + STATE_PATH + ' -> ' + show(state))
    rows.push('frozen ' + ADD_PATH + ' -> ' + show(addOne))
    rows.push('a path nobody registered answers ' + String(route.stranger.status) + ' (' + show(clip(route.stranger.text, 60)) + '): the KERNEL own 404, which is what says this socket is the kernel and not a stand-in')
    rows.push('the row own boot lines: ' + show(route.boot))
    rows.push('the artifact own exported constants (reported): state=' + show(exports.statePath) + ' add=' + show(exports.addPath) + '; the frozen pair is ' + show([STATE_PATH, ADD_PATH]))
    const ok = server.present === true && server.port !== null && state !== null && state.kind === 'exact' && state.handler === 'function' && addOne !== null && addOne.kind === 'exact' && addOne.handler === 'function' && route.stranger.status === 404
    add(READINGS[0], ok, 'both frozen routes sit in the real kernel web server own exact table, and an unregistered path answers the kernel own 404', rows)
  }

  // 02 -- 200 + the two configured thresholds.
  {
    const rows = []
    const answer = route.getsEmpty[0]
    const found = answer.body === null ? null : findThresholds(answer.body)
    const identical = route.getsEmpty.every((one) => one.text === answer.text)
    rows.push('GET ' + STATE_PATH + ' -> status ' + String(answer.status) + ', type ' + show(answer.type) + ', cache ' + show(answer.cache))
    rows.push('the answer carries: ' + clip(show(answer.body), 700))
    rows.push('the configured thresholds are ' + String(LIMITS.maxNotes) + ' and ' + String(LIMITS.maxChars) + '; the first object carrying both is at ' + show(found === null ? null : found.path) + ' = ' + show(found === null ? null : found.node))
    rows.push('three GETs over an unchanged ledger answered byte-identically: ' + String(identical) + ' (reported: the contract does not freeze it, the row design does)')
    const ok = answer.status === 200 && answer.body !== null && found !== null
    add(READINGS[1], ok, 'the state route answers 200 with JSON carrying both configured thresholds', rows)
  }

  // 03 -- the route reads the ledger the tools write to.
  {
    const rows = []
    const answer = route.getAfter
    const text = String(answer.text)
    const appended = route.appended
    const id = appended === null || appended === undefined ? null : appended.id
    const carriesId = typeof id === 'string' && text.includes(id)
    const carriesText = text.includes(route.noteText)
    rows.push('the note the mounted store wrote: ' + show(appended) + ' (text ' + show(route.noteText) + ')')
    rows.push('GET ' + STATE_PATH + ' after it -> status ' + String(answer.status) + '; carries the id: ' + String(carriesId) + ', carries the text: ' + String(carriesText))
    rows.push('the answer: ' + clip(text, 700))
    const ok = answer.status === 200 && (carriesId || carriesText)
    add(READINGS[2], ok, 'the served state carries the note the tools write to: one ledger, not a second store', rows)
  }

  // 04 -- a GET moves no ledger byte.
  {
    const rows = []
    const emptySame = ledgerSame(route.emptyBefore, route.emptyAfter)
    const populatedSame = ledgerSame(route.populatedBefore, route.populatedAfter)
    const statuses = route.getsEmpty.map((one) => one.status).concat([route.getAfter.status, route.getAgain.status])
    rows.push('empty ledger before 3 GETs: ' + ledgerSizes(route.emptyBefore) + ' | sha256 ' + ledgerDigest(route.emptyBefore))
    rows.push('empty ledger after  3 GETs: ' + ledgerSizes(route.emptyAfter) + ' | sha256 ' + ledgerDigest(route.emptyAfter) + ' -> identical=' + String(emptySame))
    rows.push('populated ledger before 2 GETs: ' + ledgerSizes(route.populatedBefore) + ' | sha256 ' + ledgerDigest(route.populatedBefore))
    rows.push('populated ledger after  2 GETs: ' + ledgerSizes(route.populatedAfter) + ' | sha256 ' + ledgerDigest(route.populatedAfter) + ' -> identical=' + String(populatedSame))
    rows.push('the GETs answered ' + show(statuses) + ': the reading is taken over 200s, never over a 404')
    const ok = emptySame && populatedSame && statuses.every((status) => status === 200)
    add(READINGS[3], ok, 'no GET moves one byte of the ledger, on an empty ledger and on a populated one', rows)
  }

  // 05 -- a verb that is neither GET nor POST is refused by name.
  {
    const rows = []
    const judged = ['DELETE ' + STATE_PATH, 'POST ' + STATE_PATH, 'DELETE ' + ADD_PATH, 'PUT ' + ADD_PATH, 'PATCH ' + ADD_PATH]
    for (const one of route.verbs) {
      const key = one.method + ' ' + one.path
      rows.push(one.method + ' ' + one.path + ' -> ' + String(one.status) + ' code=' + show(one.code) + ' allow=' + show(one.allow) + ' ok=' + show(one.ok) + (judged.includes(key) ? '' : '  (reported and NOT judged: the contract freezes non-GET/POST, the panel precedent answers 200 to HEAD)'))
    }
    rows.push('the judged set is ' + show(judged) + '; the codes seen: ' + show([...new Set(route.verbs.filter((one) => judged.includes(one.method + ' ' + one.path)).map((one) => one.code))]) + ' -- judged as a NAME (any ALL-CAPS word), with the panel precedent spelling reported: ' + show('METHOD_NOT_ALLOWED'))
    const each = route.verbs.filter((one) => judged.includes(one.method + ' ' + one.path))
    const ok = each.length === judged.length && each.every((one) => one.status === 405 && codeIsNamed(one.code))
    add(READINGS[4], ok, 'DELETE on both routes and PUT, PATCH and POST-state answer 405 with a named code', rows)
  }

  // 06 -- PAIRED: one input, two write paths, byte-identical ledgers.
  {
    const rows = []
    rows.push('the three pins this reading substitutes, and nothing else: the clock (' + String(identity.clock) + ' while a record is written), the id source (a resettable shim, reset before each write) and the ledger instance (' + show(identity.instance) + ', pre-seeded in both directories)')
    rows.push('path A, the ROUTE: POST ' + ADD_PATH + ' with text ' + show(identity.input.text) + ' and tags ' + show(identity.input.tags) + ' and NO author, so the route own default decides -> status ' + String(identity.routeAnswer === null ? null : identity.routeAnswer.status) + ' ' + clip(show(identity.routeAnswer === null ? null : identity.routeAnswer.body), 200))
    rows.push('path B, appendNote: appendNote(store, ' + show(identity.input) + ') on the artifact own exported function -> ' + show(identity.direct))
    rows.push('A ledger: ' + identity.routeSizes + ' | sha256 ' + identity.routeDigest)
    rows.push('B ledger: ' + identity.directSizes + ' | sha256 ' + identity.directDigest)
    rows.push('per-file bytes identical: ' + String(identity.same) + '; whole-directory sha256 equal: ' + String(identity.routeDigest === identity.directDigest))
    rows.push('the record A wrote: ' + clip(String(identity.routeBytes['notes/control.jsonl'] ?? ''), 420))
    const wrote = identity.routeAnswer !== null && identity.routeAnswer.status === 200 && identity.direct !== null && identity.direct !== undefined && typeof identity.direct.id === 'string'
    const ok = wrote && identity.same === true && identity.routeDigest === identity.directDigest && String(identity.routeBytes['notes/control.jsonl'] ?? '') !== ''
    add(READINGS[5], ok, 'PAIRED: the same input through POST /add and through appendNote produces byte-identical ledgers, so the route holds no second write rule', rows)
  }

  // 07 / 08 / 09 -- the three named refusals travel over the route and write nothing.
  {
    const rows = []
    const answer = route.input.answer
    const code = errorCode(answer)
    const sameBytes = ledgerSame(route.input.before, route.input.after)
    rows.push('POST ' + ADD_PATH + ' ' + show('{"text":42}') + ' -> status ' + String(answer.status) + ', code ' + show(code) + ', message ' + show(answer.body === null || answer.body.error === undefined ? null : clip(answer.body.error.message, 200)))
    rows.push('the ledger before: ' + ledgerSizes(route.input.before) + ' | sha256 ' + ledgerDigest(route.input.before))
    rows.push('the ledger after:  ' + ledgerSizes(route.input.after) + ' | sha256 ' + ledgerDigest(route.input.after) + ' -> identical=' + String(sameBytes))
    rows.push('three more unusable bodies, reported and not judged: ' + show(route.inputOthers))
    const ok = answer.status >= 400 && code === CODE_INPUT && sameBytes
    add(READINGS[6], ok, CODE_INPUT + ' travels over the route and nothing is written', rows)
  }
  {
    const rows = []
    const answer = route.tooLong.answer
    const code = errorCode(answer)
    const sameBytes = ledgerSame(route.tooLong.before, route.tooLong.after)
    rows.push('POST ' + ADD_PATH + ' with a body of ' + String(LIMITS.maxChars + 1) + ' code points (the row limit is ' + String(LIMITS.maxChars) + ') -> status ' + String(answer.status) + ', code ' + show(code) + ', message ' + show(answer.body === null || answer.body.error === undefined ? null : clip(answer.body.error.message, 220)))
    rows.push('the ledger before: ' + ledgerSizes(route.tooLong.before) + ' | sha256 ' + ledgerDigest(route.tooLong.before))
    rows.push('the ledger after:  ' + ledgerSizes(route.tooLong.after) + ' | sha256 ' + ledgerDigest(route.tooLong.after) + ' -> identical=' + String(sameBytes))
    const ok = answer.status >= 400 && code === CODE_TOO_LONG && sameBytes
    add(READINGS[7], ok, CODE_TOO_LONG + ' travels over the route and nothing is written', rows)
  }
  {
    const rows = []
    const answer = route.full.answer
    const code = errorCode(answer)
    const sameBytes = ledgerSame(route.full.before, route.full.after)
    rows.push('the ledger was filled to the row limit of ' + String(LIMITS.maxNotes) + ' live notes through the same mounted store: ' + show(route.full.filled))
    rows.push('then POST ' + ADD_PATH + ' with one more valid body -> status ' + String(answer.status) + ', code ' + show(code) + ', message ' + show(answer.body === null || answer.body.error === undefined ? null : clip(answer.body.error.message, 240)))
    rows.push('the ledger before: ' + ledgerSizes(route.full.before) + ' | sha256 ' + ledgerDigest(route.full.before))
    rows.push('the ledger after:  ' + ledgerSizes(route.full.after) + ' | sha256 ' + ledgerDigest(route.full.after) + ' -> identical=' + String(sameBytes))
    const ok = answer.status >= 400 && code === CODE_FULL && sameBytes
    add(READINGS[8], ok, CODE_FULL + ' travels over the route and nothing is written', rows)
  }

  // 10 -- the agent's tool face has no member for the route.
  {
    const rows = []
    const face = route.face
    const declared = [exports.listTool, exports.addTool].filter((name) => typeof name === 'string').sort()
    const agentFace = [...face.agent].sort()
    const registryFace = [...face.registry].sort()
    const schemas = face.schemas === null ? '' : String(face.schemas)
    const routeShaped = agentFace.filter((name) => /route|api|endpoint/i.test(name) || name.includes('/'))
    rows.push('the artifact own declared tool names: ' + show(declared) + ' (its whole export surface: ' + show(exports.keys) + ')')
    rows.push('the REAL agent tool face (ctx.tools.schemas on an agent minted by ctx.agentLoop.create): ' + show(agentFace) + ' -- ' + String(agentFace.length) + ' tool(s), ' + String(Buffer.byteLength(schemas, 'utf8')) + ' B of serialized schema')
    rows.push('the registry face, with no agent: ' + show(registryFace))
    rows.push('face names that read like the route (matching route|api|endpoint, or carrying a slash): ' + show(routeShaped))
    rows.push('the frozen route paths anywhere in the serialized schemas: state=' + String(schemas.includes(STATE_PATH)) + ', add=' + String(schemas.includes(ADD_PATH)))
    rows.push('executing the route path AS a tool: ' + show(face.unknownTool) + (face.error === null ? '' : ' (the probe failed: ' + clip(face.error, 200) + ')'))
    rows.push('the pair the shipped groups row declares, reported and not judged: ' + show(['notes_list', 'notes_add']))
    const ok = face.error === null && agentFace.length > 0 && same(agentFace, registryFace) && same(agentFace, declared) && routeShaped.length === 0 && schemas.includes(STATE_PATH) === false && schemas.includes(ADD_PATH) === false && face.unknownTool !== null && face.unknownTool.isError === true && face.unknownTool.text.includes('UNKNOWN_TOOL')
    add(READINGS[9], ok, 'the real agent tool face carries the artifact own tools and no route-shaped member, and the route path is not an executable tool', rows)
  }

  // 11 -- the contract page's citations.
  {
    const rows = []
    const page = world.page.pristine
    rows.push('check-protocol-page.mjs --page ' + page.path + ' -> exit ' + show(page.exit))
    rows.push('the checker printed: ' + clip(page.last, 200))
    if (page.total === null) rows.push('the checker printed no N of M citation(s) hold line' + (page.error === null ? '' : ' (' + clip(page.error, 200) + ')'))
    else rows.push('N=' + String(page.holds) + ' M=' + String(page.total) + ' (this reading requires N === M and M >= ' + String(MIN_CITATIONS) + ')')
    if (world.staging.pageMissing !== undefined) rows.push('the page is not on the tree: ' + world.staging.pageMissing)
    const ok = page.exit === 0 && page.total !== null && page.total >= MIN_CITATIONS && page.holds === page.total
    add(READINGS[10], ok, 'the contract page own citation table holds and carries at least ' + String(MIN_CITATIONS) + ' citations', rows)
  }

  // 12 -- PAIRED: the page reddens when one row moves.
  {
    const rows = []
    const pristine = world.page.pristine
    const moved = world.page.moved
    rows.push('the page as shipped: exit ' + show(pristine.exit) + '  ' + clip(pristine.last, 140))
    rows.push('the mutation: ' + (moved.applied === true ? moved.why : 'NOT APPLICABLE: ' + moved.why))
    rows.push('the copy the checker read: ' + show(moved.path) + ' -> exit ' + show(moved.exit) + '  ' + clip(moved.last, 140))
    const ok = moved.applied === true && pristine.exit === 0 && moved.exit !== null && moved.exit !== 0
    add(READINGS[11], ok, 'PAIRED: the page as shipped exits 0 and a copy with one row moved exits non-zero', rows)
  }

  return out
}

// ---------------------------------------------------------------------------
// Self-attack: one edit per mutant, applied to a staged copy and measured by the same judge.
// ---------------------------------------------------------------------------
const editText = (path, transform) => {
  if (existsSync(path) === false) return { applied: false, why: 'no such file: ' + path }
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === null || after === undefined) return { applied: false, why: 'no anchor this gate can locate in ' + path }
  if (after === before) return { applied: false, why: 'the located anchor changed no byte of ' + path }
  writeFileSync(path, after)
  return { applied: true, why: null }
}
/** How many times one quoted literal occurs in all three quote spellings. */
const countLiteral = (text, literal) => QUOTES.reduce((total, quote) => total + text.split(quote + literal + quote).length - 1, 0)
/** Replace a quoted literal: the first occurrence, or every one. Null when the literal is not there. */
const replaceLiteral = (path, literal, replacement, all) => editText(path, (text) => {
  for (const quote of QUOTES) {
    const needle = quote + literal + quote
    if (text.includes(needle) === false) continue
    return all === true ? text.split(needle).join(quote + replacement + quote) : text.replace(needle, quote + replacement + quote)
  }
  return null
})

const MUTANTS = [
  {
    name: 'the-state-route-is-bound-under-another-name',
    expect: [READINGS[0], READINGS[1], READINGS[2], READINGS[3], READINGS[4]],
    why: 'the two frozen paths are what the socket is asked for and what the real web server table holds: moving the state path moves every reading taken over that route, including the method refusal on it',
    edit: (paths) => replaceLiteral(paths.artifact, STATE_PATH, '/api/dsh-link-notes/gate123-state'),
  },
  {
    name: 'the-write-route-is-bound-under-another-name',
    expect: [READINGS[0], READINGS[4], READINGS[5], READINGS[6], READINGS[7], READINGS[8]],
    why: 'the write path carries the registration, the method refusal on that path, the byte-identity POST and all three named refusals (they travel over it); the state route is untouched, so readings 02, 03, 04 and 10 stay green',
    edit: (paths) => replaceLiteral(paths.artifact, ADD_PATH, '/api/dsh-link-notes/gate123-add'),
  },
  {
    name: 'the-input-code-is-renamed',
    expect: [READINGS[6]],
    why: 'the code is judged by the frozen name, so renaming it moves exactly the reading that asks for NOTES_INPUT',
    edit: (paths) => replaceLiteral(paths.artifact, CODE_INPUT, CODE_INPUT + '_GATE123', true),
  },
  {
    name: 'the-too-long-code-is-renamed',
    expect: [READINGS[7]],
    why: 'the same, for the second frozen code',
    edit: (paths) => replaceLiteral(paths.artifact, CODE_TOO_LONG, CODE_TOO_LONG + '_GATE123', true),
  },
  {
    name: 'the-full-code-is-renamed',
    expect: [READINGS[8]],
    why: 'the same, for the third frozen code',
    edit: (paths) => replaceLiteral(paths.artifact, CODE_FULL, CODE_FULL + '_GATE123', true),
  },
  {
    name: 'the-route-defaults-the-author-to-the-agent',
    expect: [READINGS[5]],
    why: 'the default author is one half of "one input, two paths": with the agent default on the route side the two ledgers stop being byte-identical, and nothing else in the gate reads that default',
    edit: (paths) => replaceLiteral(paths.artifact, ROUTE_AUTHOR, 'agent'),
  },
  {
    name: 'the-write-tool-grows-a-route-shaped-name',
    expect: [READINGS[9]],
    why: 'a face name that reads like the route is what "the agent has no way to the route" refuses; the face and the artifact own declaration move together, so only the route-shaped-name test and the frozen-pair report see it',
    edit: (paths) => replaceLiteral(paths.artifact, 'notes_add', 'notes_add_route'),
  },
  {
    name: 'the-page-cites-the-line-after-the-one-it-read',
    expect: [READINGS[10], READINGS[11]],
    why: 'the checker resolves a citation against THIS repository, so only the staged page copy can move these two readings: the page stops holding, and the paired copy stops being the only red',
    edit: (paths) => editText(paths.page, (text) => { const moved = moveOneRow(text); return moved.applied === true ? moved.text : null }),
  },
  { name: 'control-nothing-changed', expect: [], why: 'a build with no change of its own must move nothing: the control that says this attack measures deltas', edit: () => ({ applied: true, why: null }) },
]

const freshRun = (parent, label) => mkdtempSync(join(parent, slug(label) + '-'))

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const runAttack = async (attackDir, started) => {
  const collect = async (label, edit) => {
    const runDir = freshRun(attackDir, label)
    const root = join(runDir, 'root')
    const paths = stageSubject(root)
    const applied = edit === null ? { applied: true, why: null } : edit(paths)
    return { runDir, applied, world: await buildWorld(root, runDir) }
  }
  const clean = (run) => { if (!KEEP) { try { rmSync(run.runDir, { recursive: true, force: true }) } catch { /* a locked temp file is not a gate failure */ } } }

  const baseline = await collect('baseline', null)
  if (baseline.world.fatal !== null) {
    const why = baseline.world.fatal
    clean(baseline)
    return NOT_MEASURED('the staged baseline could not be built: ' + why)
  }
  const baseReadings = judge(baseline.world)
  const baseRed = baseReadings.filter((reading) => reading.ok === false)
  console.log('  baseline in a staged copy of the subject: ' + String(baseReadings.length) + ' readings, ' + String(baseRed.length) + ' failed')
  clean(baseline)
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed.map((reading) => reading.id)))
    for (const reading of baseRed) {
      console.log('        ' + reading.id + ': ' + reading.detail)
      for (const line of reading.evidence) console.log('          ' + line)
    }
    return 1
  }
  console.log('  each mutant below is ONE edit in a staged copy of the subject, measured by the same judge:')
  let failures = 0
  let uncovered = 0
  const moved = new Map()
  for (const mutant of MUTANTS) {
    const run = await collect('mutant-' + mutant.name, mutant.edit)
    const notApplicable = run.applied !== undefined && run.applied.applied === false
    let observed = []
    let note = ''
    if (run.world.fatal !== null) {
      observed = baseReadings.map((reading) => reading.id)
      note = ' (the mutant world could not be built, so no reading could be taken: ' + run.world.fatal + ')'
    } else if (notApplicable) {
      note = ' (NOT APPLICABLE: ' + run.applied.why + ' - the readings it was to cover then count as uncovered unless another mutant carries them)'
    } else {
      observed = judge(run.world).filter((reading) => reading.ok === false).map((reading) => reading.id).sort()
    }
    clean(run)
    const declared = [...mutant.expect].sort()
    if (notApplicable) {
      console.log('  n/a   mutant. ' + mutant.name + ' - declared=' + show(declared) + ' observed=' + show(observed) + note)
      continue
    }
    const precise = same(observed, declared)
    if (precise === false) failures += 1
    for (const id of declared) moved.set(id, (moved.get(id) === undefined ? 0 : moved.get(id)) + 1)
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' - 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed) + note)
  }
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  for (const reading of baseReadings) {
    const count = moved.get(reading.id) === undefined ? 0 : moved.get(reading.id)
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id + (count === 0 ? '  (' + reading.detail + ')' : ''))
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(MUTANTS.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failures === 0 && uncovered === 0 ? 0 : 1
}

const main = async () => {
  const started = Date.now()
  mkdirSync(join(PROJECT, SCRATCH_REL), { recursive: true })
  const attackDir = join(PROJECT, SCRATCH_REL)
  const runDir = freshRun(attackDir, SELF_ATTACK ? 'attack' : 'run')
  try {
    if (SELF_ATTACK) {
      console.log('        the subject: ' + join(SUBJECT, 'plugins', NOTES) + ' and ' + join(SUBJECT, PAGE_REL) + (SUBJECT === PROJECT ? ' (the tree itself)' : ' (a copy named by --subject)'))
      return await runAttack(runDir, started)
    }
    const root = join(runDir, 'root')
    stageSubject(root)
    const world = await buildWorld(root, runDir)
    if (world.fatal !== null) return NOT_MEASURED(world.fatal)
    console.log('        the subject: ' + join(SUBJECT, 'plugins', NOTES) + ' and ' + join(SUBJECT, PAGE_REL) + (SUBJECT === PROJECT ? ' (the tree itself)' : ' (a copy named by --subject)'))
    console.log('        the world: the REAL kernel web server (' + KERNEL_MODULES['@deepseek-ai/dsh-host-webserver'] + ') listening on an ephemeral loopback port this gate owns, fed by the artifact own apply(); the real SystemPrompt, ToolRuntime and agent loop; the ledger under ' + world.route.dir)
    console.log('        the artifact: ' + world.artifact.staged + ' (' + String(world.artifact.shippedBytes) + ' B shipped, sha256 ' + world.artifact.shippedSha + '; ' + String(world.artifact.rewrites) + ' specifier rewrite(s) for the gate own module paths and the id shim; identical to the shipped bytes: ' + String(world.artifact.identicalToShipped) + ', and faithful when those rewrites are reversed: ' + String(world.artifact.faithful) + ')')
    console.log('        the readings declared by this gate: ' + show(READINGS))
    const readings = judge(world)
    for (const reading of readings) {
      console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + ' -- ' + reading.detail)
      for (const line of reading.evidence) console.log('        ' + line)
    }
    const failed = readings.filter((reading) => reading.ok === false)
    console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
    return failed.length > 0 ? 1 : 0
  } finally {
    if (!KEEP) { try { rmSync(runDir, { recursive: true, force: true }) } catch { /* a locked temp file is not a gate failure */ } }
  }
}

process.exitCode = await main()
