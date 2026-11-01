#!/usr/bin/env node
/**
 * dsh-link-notes route self-check (producer-owned, R189 P1).
 *
 * It measures the BUILT artifact - lib/index.js, the bytes the kernel loads - not src/:
 *
 *   node plugins/dsh-link-notes/test/notes-route.spec.mjs
 *   node plugins/dsh-link-notes/test/notes-route.spec.mjs --self-attack
 *
 * What it must be able to FAIL on, reading by reading:
 *   S1   the two route paths are the contract's own paths, exported as constants
 *   S2   apply() binds exactly two exact-path routes over a real socket, and says so on the boot line
 *   S3   neither route is a tool: the model's face is still notes_list/notes_add, and no tool names a URL
 *   S4   the shipped artifact holds ONE appendNote call site and both writers go through writeOneNote
 *        (the R189-contract.md section 1 hard requirement, read as bytes); the GET reports the
 *        handed-in limits object rather than a second copy of the numbers
 *   G1   GET answers 200, readOnly:true, the exported path, json + no-store
 *   G2   the thresholds on the wire are the row's RESOLVED limits (the configured ones, not the
 *        defaults), and they are the numbers the row's own boot line names
 *   G3   the fold on the wire equals the module's own fold: live notes listed in ledger order, tombstones
 *        COUNTED and not listed, a done note counted as live, malformed counted
 *   G4   GET changes no byte of the ledger root (every file, before and after), and two GETs are
 *        byte-identical - no clock and no counter in the answer
 *   G5   POST/PUT/DELETE on the state route are 405 with the named code and an Allow header
 *   W1   a POST at the boundary writes exactly the bytes that were posted and answers {ok, seq, notes}
 *   W2   an omitted author is ROUTE_AUTHOR (user); the tool's own default (agent) is a different path
 *   W3   two POSTs are two facts in one unbroken sequence, and the answer's notes is the live count
 *   IN1  an unusable body is refused by name (NOTES_INPUT) with 400, never 500, and writes nothing
 *   FULL1 a ledger at maxNotes refuses the next POST with NOTES_FULL, and writes nothing
 *   TOO1 a body one code point over maxChars is refused with NOTES_TOO_LONG, with the very message
 *        appendNote throws for the same body, and writes nothing
 *   W5   no refused body added a byte to the ledger (every refusal's digest is unchanged)
 *   W6   the same call through the route and through appendNote writes BYTE-IDENTICAL ledger bytes
 *        (two sha256 digests, printed; the three inputs a write cannot choose for itself are pinned
 *        and named in the reading: the id, the clock, and the directory's own instance file)
 *   W7   GET/HEAD/PUT on the add route are 405 with the named code, and write nothing
 *
 * --self-attack mutates the ARTIFACT's own bytes with the failure section 1 exists to refuse - a SECOND
 * rule inside the narrow write route, one code point laxer than the shared boundary - and demands that
 * exactly the readings declared in MUTANTS[..].expect move. A mutant that moves nothing, or moves more
 * than it declared, fails.
 *
 * Exit: 0 every reading held (under --self-attack: pristine held AND the mutant moved exactly its
 * declared readings); 1 a reading failed; 3 NOT MEASURED (no built artifact, a kernel module missing, or
 * a mutant anchor that is gone, so no honest reading can be taken).
 */
import { Agent, createServer, request as httpRequest } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')
const SCRATCH = join(PROJECT, '.tmp', 'r189-p1')
const STAGE = join(SCRATCH, 'stage')
const WORLD_ROOT = join(SCRATCH, 'worlds')
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const SELF_ATTACK = process.argv.slice(2).includes('--self-attack')
const NL = String.fromCharCode(10)

/** The kernel modules the artifact imports, and the one relative import it carries. */
const KERNEL_MODULES = {
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
}
const RELATIVE_MODULES = { '../../dsh-link-collab/lib/index.js': join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js') }

const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }
for (const [specifier, file] of Object.entries({ ...KERNEL_MODULES, ...RELATIVE_MODULES })) {
  if (existsSync(file) === false) notMeasured('the module ' + specifier + ' is missing at ' + file + '; this self-check will not stand in a fake one')
}
if (existsSync(ARTIFACT) === false) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (build it: node plugins/build.mjs)')

/**
 * The one mutation this file declares: a SECOND RULE inside the narrow write route.
 *
 * The shared boundary refuses a body longer than maxChars. This mutant gives the ROUTE its own, laxer
 * rule - a body exactly one code point over is clipped and admitted - which is the shape section 1
 * forbids ('the route must not carry a second set of rules') and exactly what a byte-identity reading
 * between the two writers exists to catch.
 */
const MUTANTS = {
  'route-lax-boundary': {
    from: 'const written = await writeOneNote(store, parsed, { who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }, limits);',
    to: 'if (typeof parsed?.text === "string" && Array.from(parsed.text).length === limits.maxChars + 1) parsed = { ...parsed, text: Array.from(parsed.text).slice(0, limits.maxChars).join("") };'
      + NL + '      const written = await writeOneNote(store, parsed, { who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }, limits);',
    /**
     * The readings this mutation must move, each justified - a mutant that moves MORE than it declared
     * fails just as loudly as one that moves less:
     *   TOO1  a body one code point over maxChars is refused through the route by the SHARED rule,
     *         with the very message appendNote throws -> it is clipped and admitted instead: 200 where
     *         the shared boundary answers 400, and the message is no longer the one the same body gets
     *         from appendNote
     *   W5    no refused body added a byte to the ledger -> this one did: a record the shared rule
     *         refuses is on disk, which is the whole cost of a second rule
     */
    expect: ['TOO1', 'W5'],
  },
}

/** Rewrite the artifact's bare kernel imports and its one relative import onto absolute file URLs. */
function stage(text) {
  let out = text
  for (const [specifier, file] of Object.entries({ ...KERNEL_MODULES, ...RELATIVE_MODULES })) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"']) out = out.split(quote + specifier + quote).join(quote + url + quote)
  }
  return out
}

const show = (value) => {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text
}
const canonical = (value) => show(value)
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** Every file under one root, in a fixed order: what 'the ledger root' means in the readings below. */
function filesUnder(root) {
  if (existsSync(root) === false) return []
  const out = []
  const walk = (rel) => {
    const abs = rel === '' ? root : join(root, rel)
    for (const name of readdirSync(abs).sort()) {
      const child = rel === '' ? name : rel + '/' + name
      if (statSync(join(abs, name)).isDirectory()) walk(child)
      else out.push(child)
    }
  }
  walk('')
  return out.sort()
}
const digestOfFiles = (root) => {
  const hash = createHash('sha256')
  for (const rel of filesUnder(root)) {
    hash.update(rel)
    hash.update(readFileSync(join(root, rel)))
  }
  return hash.digest('hex')
}
/** The ledger file itself: the bytes a note fact lives in. */
const ledgerFile = (root) => join(root, 'notes', 'control.jsonl')
const ledgerBytes = (root) => (existsSync(ledgerFile(root)) ? readFileSync(ledgerFile(root)) : Buffer.from(''))
const ledgerDigest = (root) => sha256(ledgerBytes(root))
const recordsOf = (root) => ledgerBytes(root).toString('utf8').split(NL).filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
const recordCount = (root) => recordsOf(root).length

/** One note fact as the ledger stores it, for ledgers this file writes by hand. */
const fact = (id, text, seq, at, state, tags) => ({ kind: 'note/state', subject: id, payload: { id, text, tags: tags ?? [], state: state ?? 'open', author: 'selfcheck' }, seq, at, actor: 'selfcheck' })

/** A fresh world under .tmp/r189-p1/worlds: the scratch rule keeps every directory in one place. */
let worldCount = 0
function world(tag) {
  worldCount += 1
  const dir = join(WORLD_ROOT, tag + '-' + String(worldCount))
  mkdirSync(join(dir, 'notes'), { recursive: true })
  return dir
}
const writeInstance = (root, instance) => writeFileSync(join(root, 'notes', '.instance'), instance + NL, 'utf8')
/** Write a ledger by hand, before any store opens it: the file is what the store must read back. */
function writeLedger(root, records) {
  mkdirSync(join(root, 'notes'), { recursive: true })
  writeFileSync(join(root, 'notes', 'control.jsonl'), records.map((record) => JSON.stringify(record)).join(NL) + NL)
  return root
}

/**
 * One row, mounted on a minimal ctx with a web server stub.
 *
 * Minimal on purpose: this file measures the two routes, not the kernel. The mount-level readings live in
 * test/notes-invariants.mjs, which mounts the real cordis world. What the stub has to be is honest about
 * every seam apply() reaches: get('webServer'), provide, effect, on, systemPrompt.section, and the inject
 * seam the tools registry resolves through.
 */
function mountRow(mod, config) {
  const routes = []
  const tools = []
  const sections = []
  const provided = {}
  const effects = []
  const server = {
    register: (route) => {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const registry = { register: (definition) => { tools.push(definition); return () => {} } }
  const scope = { get: (name) => (name === 'tools' ? registry : undefined) }
  const ctx = {
    get: (name) => (name === 'webServer' ? server : undefined),
    provide: (name, value) => { provided[name] = value },
    effect: (work) => { effects.push(work) },
    on: () => {},
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    inject: (_names, work) => work(scope),
  }
  const spoken = []
  const real = { log: console.log, error: console.error }
  console.log = (line) => { spoken.push(String(line)) }
  console.error = (line) => { spoken.push(String(line)) }
  try {
    mod.apply(ctx, config)
  } finally {
    console.log = real.log
    console.error = real.error
  }
  return {
    routes,
    tools,
    sections,
    provided,
    spoken,
    /** Unload the row the way the kernel does: run the effect factories, then their disposers. */
    close: async () => {
      for (const work of effects.splice(0)) {
        const dispose = work()
        if (typeof dispose === 'function') await dispose()
      }
    },
  }
}

/** Drive the bound routes over a REAL socket, the way the panel self-check does. */
async function serve(routes) {
  const server = createServer((req, res) => {
    const route = routes.find((entry) => entry.path === req.url)
    if (route === undefined) {
      res.statusCode = 404
      res.end('no route')
      return
    }
    void route.handler(req, res)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = 'http://127.0.0.1:' + String(server.address().port)
  // node:http rather than fetch, with an agent that keeps nothing alive: this spec must be able to finish
  // without a socket half-closed underneath it (on Windows that trips a libuv assertion and the exit code
  // stops describing the readings).
  const agent = new Agent({ keepAlive: false })
  const call = (method, path, body) => new Promise((done) => {
    const payload = body === undefined ? null : Buffer.from(body, 'utf8')
    const request = httpRequest(origin + path, {
      method,
      agent,
      ...(payload === null ? {} : { headers: { 'content-type': 'application/json', 'content-length': payload.length } }),
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(text) } catch { parsed = null }
        done({ status: response.statusCode, type: response.headers['content-type'], cache: response.headers['cache-control'], allow: response.headers.allow, text, body: parsed })
      })
    })
    request.on('error', (error) => done({ status: 0, type: null, cache: null, allow: null, text: '', body: null, error: String((error && error.code) ?? (error && error.message)) }))
    if (payload === null) request.end()
    else request.end(payload)
  })
  return {
    call,
    stop: async () => {
      agent.destroy()
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((done) => server.close(done))
    },
  }
}

const LIMITS = { maxNotes: 2, maxChars: 8 }
const STATE_LIMITS = { maxNotes: 3, maxChars: 12 }
/** Exactly maxChars code points: the boundary both write paths have to agree about. */
const BOUNDARY = 'abcdefgh'
const OVER = BOUNDARY + '!'

/**
 * Every reading, taken against ONE module. Called twice under --self-attack (pristine, then the mutant),
 * so a mutant's moved set can be compared with what the mutation declared.
 * @param mod - the imported artifact (or a mutated copy of it).
 * @returns the readings, in the order they were taken.
 */
async function battery(mod) {
  const rows = []
  const held = (id, ok, detail) => { rows.push({ id, ok: ok === true, detail: String(detail) }); return ok === true }

  // -------------------------------------------------------------- A: the two routes as a surface
  held('S1',
    mod.NOTES_ROUTE_PATH === '/api/dsh-link-notes/state' && mod.NOTES_ADD_ROUTE_PATH === '/api/dsh-link-notes/add'
    && mod.ROUTE_AUTHOR === 'user' && mod.METHOD_NOT_ALLOWED === 'METHOD_NOT_ALLOWED',
    'exported constants: state=' + show(mod.NOTES_ROUTE_PATH) + ' add=' + show(mod.NOTES_ADD_ROUTE_PATH)
    + ' author=' + show(mod.ROUTE_AUTHOR) + ' method=' + show(mod.METHOD_NOT_ALLOWED))

  // -------------------------------------------------------------- S4: one write path, as bytes
  const calls = shipped.split('appendNote(').length - 1
  const oneCall = shipped.split('appendNote(store, { text, tags, author }, limits)').length - 1
  const writers = shipped.split('writeOneNote(').length - 1
  const handedLimits = shipped.split('limits: { maxNotes: limits.maxNotes, maxChars: limits.maxChars }').length - 1
  held('S4',
    calls === 2 && oneCall === 1 && writers === 3 && handedLimits === 1,
    'the artifact holds ' + String(calls) + ' appendNote( occurrences (one definition + ' + String(oneCall) + ' call site), '
    + String(writers) + ' writeOneNote( occurrences (one definition + the tool + the route), and the GET body reads the handed-in limits '
    + String(handedLimits) + ' time(s)')

  // -------------------------------------------------------------- the read-only world
  const stateDir = writeLedger(world('state'), [
    fact('s-1', 'first live', 1, 1000, 'open', ['alpha']),
    fact('s-2', 'done but not deleted', 2, 2000, 'done', ['beta']),
    fact('s-3', 'gone', 3, 3000, 'deleted', ['alpha']),
    fact('s-4', 'second live', 4, 4000, 'open', ['alpha', 'beta']),
  ])
  const stateWorld = mountRow(mod, { dir: stateDir, maxNotes: STATE_LIMITS.maxNotes, maxChars: STATE_LIMITS.maxChars })
  const bound = stateWorld.routes.map((route) => ({ kind: route.kind, path: route.path }))
  held('S2',
    stateWorld.routes.length === 2
    && bound[0].kind === 'exact' && bound[0].path === mod.NOTES_ROUTE_PATH
    && bound[1].kind === 'exact' && bound[1].path === mod.NOTES_ADD_ROUTE_PATH
    && stateWorld.routes.every((route) => typeof route.handler === 'function')
    && stateWorld.spoken.some((line) => line.startsWith('[link-notes] state route bound on ' + mod.NOTES_ROUTE_PATH))
    && stateWorld.spoken.some((line) => line.startsWith('[link-notes] add route bound on ' + mod.NOTES_ADD_ROUTE_PATH)),
    'bound ' + show(bound) + '; boot lines ' + canonical(stateWorld.spoken.filter((line) => line.includes('route bound'))))
  held('S3',
    canonical(stateWorld.tools.map((tool) => tool.name)) === '["notes_list","notes_add"]'
    && stateWorld.tools.every((tool) => canonical(tool).includes('/api/') === false)
    && stateWorld.sections.length === 1 && stateWorld.sections[0].name === 'notes:ledger',
    'the tool face the row registered into is ' + canonical(stateWorld.tools.map((tool) => tool.name))
    + '; no tool carries a URL; sections ' + canonical(stateWorld.sections.map((section) => section.name)))

  const live = await serve(stateWorld.routes)
  try {
    const first = await live.call('GET', mod.NOTES_ROUTE_PATH)
    held('G1',
      first.status === 200 && first.type === 'application/json; charset=utf-8' && first.cache === 'no-store'
      && first.body !== null && first.body.ok === true && first.body.readOnly === true && first.body.path === mod.NOTES_ROUTE_PATH,
      'status=' + String(first.status) + ' type=' + show(first.type) + ' cache=' + show(first.cache)
      + ' readOnly=' + show(first.body && first.body.readOnly) + ' path=' + show(first.body && first.body.path))

    const bootLine = stateWorld.spoken.find((line) => line.startsWith('[link-notes] ready')) ?? ''
    held('G2',
      canonical(first.body.limits) === canonical(STATE_LIMITS)
      && first.body.limits.maxNotes !== mod.DEFAULT_MAX_NOTES && first.body.limits.maxChars !== mod.DEFAULT_MAX_CHARS
      && bootLine.includes(String(STATE_LIMITS.maxNotes) + ' live note(s), ' + String(STATE_LIMITS.maxChars) + ' character(s) each'),
      'wire limits ' + canonical(first.body.limits) + ' (the defaults are ' + String(mod.DEFAULT_MAX_NOTES) + '/' + String(mod.DEFAULT_MAX_CHARS)
      + '); the row own boot line says: ' + show(bootLine))

    // G3: the wire's fold IS this module's fold over the same ledger bytes.
    const wire = first.body
    const local = mod.projectNotes(recordsOf(stateDir))
    const localLive = mod.liveNotes(local)
    const expectedCounts = { live: localLive.length, deleted: local.counts.deleted, notes: local.counts.notes, open: local.counts.open, done: local.counts.done, malformed: local.counts.malformed }
    const expectedNotes = localLive.map((note) => ({ id: note.id, text: note.text, tags: [...note.tags], state: note.state, author: note.author, at: note.at, seq: note.seq }))
    held('G3',
      canonical(wire.counts) === canonical(expectedCounts) && canonical(wire.notes) === canonical(expectedNotes)
      && wire.counts.deleted === 1 && wire.counts.done === 1 && wire.counts.live === 3
      && wire.notes.some((note) => note.id === 's-3') === false,
      'counts ' + canonical(wire.counts) + '; listed ' + canonical(wire.notes.map((note) => note.id))
      + '; the tombstone s-3 is counted (' + String(wire.counts.deleted) + ') and not listed; the done note s-2 is live')

    // G4: three GETs, then the whole ledger root compared byte for byte.
    const beforeFile = ledgerDigest(stateDir)
    const beforeAll = digestOfFiles(stateDir)
    const beforeList = canonical(filesUnder(stateDir))
    const second = await live.call('GET', mod.NOTES_ROUTE_PATH)
    const third = await live.call('GET', mod.NOTES_ROUTE_PATH)
    const afterFile = ledgerDigest(stateDir)
    const afterAll = digestOfFiles(stateDir)
    const afterList = canonical(filesUnder(stateDir))
    held('G4',
      beforeFile === afterFile && beforeAll === afterAll && beforeList === afterList
      && second.text === first.text && third.text === second.text,
      'three GETs; control.jsonl sha256 ' + beforeFile.slice(0, 16) + ' -> ' + afterFile.slice(0, 16)
      + '; every file under the root ' + beforeAll.slice(0, 16) + ' -> ' + afterAll.slice(0, 16)
      + ' (the file list is unchanged: ' + String(beforeList === afterList) + '); two answers byte-identical: ' + String(second.text === first.text))

    const refusedMethods = [await live.call('POST', mod.NOTES_ROUTE_PATH, '{"text":"x"}'), await live.call('PUT', mod.NOTES_ROUTE_PATH, ''), await live.call('DELETE', mod.NOTES_ROUTE_PATH)]
    held('G5',
      refusedMethods.every((answer) => answer.status === 405 && answer.body !== null && answer.body.ok === false
        && answer.body.error.code === mod.METHOD_NOT_ALLOWED && answer.allow === 'GET' && answer.text.includes('was refused'))
      && ledgerDigest(stateDir) === beforeFile,
      'POST/PUT/DELETE -> ' + canonical(refusedMethods.map((answer) => answer.status + '/' + String(answer.body && answer.body.error && answer.body.error.code)))
      + '; allow=' + show(refusedMethods[0].allow) + '; the ledger still reads ' + ledgerDigest(stateDir).slice(0, 16)
      + '; one refusal verbatim: ' + show(refusedMethods[0].body && refusedMethods[0].body.error.message))
  } finally {
    await live.stop()
    await stateWorld.close()
  }

  // -------------------------------------------------------------- the codes world: the three refusals
  const codeDir = world('codes')
  const codeWorld = mountRow(mod, { dir: codeDir, maxNotes: LIMITS.maxNotes, maxChars: LIMITS.maxChars })
  const codeLive = await serve(codeWorld.routes)
  const refusals = []
  try {
    const unusable = [
      ['{}', 'no text field', '{}'],
      ['empty text', 'an empty string', '{"text":""}'],
      ['text is not a string', 'a number', '{"text":5}'],
      ['tags is not a list', 'a string', '{"text":"ok","tags":"none"}'],
      ['a tag is not a string', 'a number in the list', '{"text":"ok","tags":[1]}'],
      ['a field this route does not take', 'extra', '{"text":"ok","extra":1}'],
      ['a body that is not an object', 'a bare string', '"just a string"'],
      ['a body that is not JSON', 'plain text', 'not json at all'],
      ['an empty body', 'zero bytes', ''],
    ]
    const reported = []
    let inputOk = true
    for (const [label, why, payload] of unusable) {
      const before = ledgerDigest(codeDir)
      const answer = await codeLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, payload)
      const named = answer.status >= 400 && answer.status < 500
        && answer.body !== null && answer.body.ok === false && answer.body.error !== null
        && answer.body.error.code === mod.REFUSALS.INPUT
        && answer.body.error.message.startsWith(mod.REFUSALS.INPUT + ':')
        && ledgerDigest(codeDir) === before
      inputOk = named && inputOk
      refusals.push({ label: label, ok: named })
      reported.push(label + ' (' + why + ') -> ' + String(answer.status) + '/' + String((answer.body && answer.body.error && answer.body.error.code) ?? null))
    }
    held('IN1', inputOk, 'unusable bodies are refused by name, never 500, and not one of them wrote a byte: ' + canonical(reported))

    const filled = [await codeLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, '{"text":"one"}'), await codeLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, '{"text":"two"}')]
    const digestFull = ledgerDigest(codeDir)
    const full = await codeLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, '{"text":"three"}')
    const fullOk = filled.every((answer) => answer.status === 200 && answer.body !== null && answer.body.ok === true)
      && full.status === 409 && full.body !== null && full.body.error.code === mod.REFUSALS.FULL
      && ledgerDigest(codeDir) === digestFull && recordCount(codeDir) === 2
    refusals.push({ label: 'NOTES_FULL', ok: fullOk })
    held('FULL1', fullOk, 'two notes fill the ledger (maxNotes=' + String(LIMITS.maxNotes) + '); the third answers '
      + String(full.status) + '/' + show(full.body && full.body.error ? full.body.error.code : null) + ' with ' + show(full.body && full.body.error ? full.body.error.message : full.body)
      + '; the ledger still holds ' + String(recordCount(codeDir)) + ' record(s)')

  } finally {
    await codeLive.stop()
    await codeWorld.close()
  }

  // -------------------------------------------------------------- the boundary world: one code point over
  // Its own world on purpose: the ledger here has room, so a route that broke the boundary would leave a
  // record behind where the shared rule leaves none, and the reading can say exactly that.
  const tooDir = world('too')
  const tooLimits = { maxNotes: 5, maxChars: LIMITS.maxChars }
  const tooWorld = mountRow(mod, { dir: tooDir, maxNotes: tooLimits.maxNotes, maxChars: tooLimits.maxChars })
  const tooLive = await serve(tooWorld.routes)
  try {
    const digestOver = ledgerDigest(tooDir)
    const over = await tooLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, JSON.stringify({ text: OVER }))
    const directStore = mod.openNotesStore(world('direct-over'), { writer: 'host' })
    let directError = null
    try {
      await mod.appendNote(directStore, { text: OVER, tags: [], author: 'r189' }, tooLimits)
    } catch (error) {
      directError = error
    } finally {
      await directStore.close()
    }
    const tooOk = over.status === 400 && over.body !== null && over.body.error.code === mod.REFUSALS.TOO_LONG
      && directError !== null && directError.message === over.body.error.message
      && ledgerDigest(tooDir) === digestOver && recordCount(tooDir) === 0
    refusals.push({ label: 'NOTES_TOO_LONG', ok: tooOk })
    held('TOO1', tooOk, 'a ' + String(Array.from(OVER).length) + '-code-point body (maxChars=' + String(tooLimits.maxChars) + ') over the route answers '
      + String(over.status) + '/' + show(over.body && over.body.error ? over.body.error.code : null) + '; the message through the route is byte-identical to the one appendNote throws'
      + ' for the same body: ' + show(over.body && over.body.error ? over.body.error.message : over.body) + ' (direct: ' + show(directError && directError.message) + ')'
      + '; records left behind: ' + String(recordCount(tooDir)))
  } finally {
    await tooLive.stop()
    await tooWorld.close()
  }

  held('W5', refusals.every((row) => row.ok), String(refusals.length) + ' refused write(s) over the route; every one answered <500 with a named code'
    + ' and left the ledger bytes exactly as they were: ' + canonical(refusals))

  // -------------------------------------------------------------- the accepted writes
  const goodDir = world('good')
  const goodWorld = mountRow(mod, { dir: goodDir, maxNotes: 5, maxChars: LIMITS.maxChars })
  const goodLive = await serve(goodWorld.routes)
  try {
    const first = await goodLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, JSON.stringify({ text: BOUNDARY, tags: ['t2', 't1', 't1'] }))
    const written = recordsOf(goodDir)
    held('W1',
      first.status === 200 && canonical(first.body) === canonical({ ok: true, seq: 1, notes: 1 })
      && written.length === 1 && written[0].payload.text === BOUNDARY
      && canonical(written[0].payload.tags) === '["t1","t2"]' && written[0].payload.state === mod.OPEN,
      'POST {text: ' + String(Array.from(BOUNDARY).length) + ' code points, tags: [t2,t1,t1]} -> ' + canonical(first.body)
      + '; the ledger holds ' + show(written[0] ? written[0].payload : null) + ' at sequence ' + show(written[0] ? written[0].seq : null))

    const afterFirst = await goodLive.call('GET', mod.NOTES_ROUTE_PATH)
    const second = await goodLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, '{"text":"second"}')
    const records = recordsOf(goodDir)
    held('W2',
      afterFirst.body.notes[0].author === mod.ROUTE_AUTHOR
      && second.status === 200 && canonical(second.body) === canonical({ ok: true, seq: 2, notes: 2 })
      && records.length === 2 && records[1].payload.author === mod.ROUTE_AUTHOR && records[1].payload.tags.length === 0,
      'a body that names no author is written as ' + show(records[1] ? records[1].payload.author : null) + ' (the tool own default is "agent", and that is a different path);'
      + ' the GET lists it as ' + show(afterFirst.body.notes[0].author))

    held('W3',
      records.length === 2 && canonical(records.map((row) => row.seq)) === '[1,2]'
      && canonical(records.map((row) => row.payload.text)) === canonical([BOUNDARY, 'second'])
      && second.body.notes === 2,
      'two POSTs are two facts, sequences ' + canonical(records.map((row) => row.seq)) + ', bodies ' + canonical(records.map((row) => row.payload.text))
      + '; the second answer reports notes=' + String(second.body.notes))

    const verbs = [await goodLive.call('GET', mod.NOTES_ADD_ROUTE_PATH), await goodLive.call('HEAD', mod.NOTES_ADD_ROUTE_PATH), await goodLive.call('PUT', mod.NOTES_ADD_ROUTE_PATH, '{"text":"by PUT"}')]
    held('W7',
      verbs.every((answer) => answer.status === 405 && answer.allow === 'POST'
        && (answer.body === null || (answer.body.ok === false && answer.body.error.code === mod.METHOD_NOT_ALLOWED)))
      && recordCount(goodDir) === 2,
      'GET/HEAD/PUT on the add route -> ' + canonical(verbs.map((answer) => answer.status)) + ' with allow=' + show(verbs[0].allow)
      + '; the ledger still holds ' + String(recordCount(goodDir)) + ' record(s)')
  } finally {
    await goodLive.stop()
    await goodWorld.close()
  }

  // -------------------------------------------------------------- W6: one input, two writers, one ledger
  try {
    const instance = randomUUID()
    const routeDir = world('identity-route')
    const directDir = world('identity-direct')
    writeInstance(routeDir, instance)
    writeInstance(directDir, instance)
    const note = { text: BOUNDARY, tags: ['t2', 't1', 't1'], author: 'r189' }
    const identityLimits = { maxNotes: 5, maxChars: LIMITS.maxChars }
    const identityWorld = mountRow(mod, { dir: routeDir, maxNotes: identityLimits.maxNotes, maxChars: identityLimits.maxChars })
    const identityLive = await serve(identityWorld.routes)
    let answer = null
    let routeRecords = []
    try {
      answer = await identityLive.call('POST', mod.NOTES_ADD_ROUTE_PATH, JSON.stringify(note))
      routeRecords = recordsOf(routeDir)
    } finally {
      await identityLive.stop()
      await identityWorld.close()
    }
    const routeRecord = routeRecords[0] ?? null
    // The three inputs a write cannot choose for itself are PINNED and named here rather than hidden:
    //   the id       - the route mints it, so the direct call is handed the very id appendNote minted;
    //   the clock    - the ledger stamps its instant at append time, so Date.now answers with the route's
    //                  own reading for the length of the direct append;
    //   the instance - the directory's own identity file, which is NOT part of a note fact: both ledgers
    //                  are written as the same log, which is what makes their bytes comparable at all.
    let directSeq = null
    if (routeRecord !== null) {
      const realNow = Date.now
      try {
        Date.now = () => routeRecord.at
        const store = mod.openNotesStore(directDir, { writer: 'host' })
        try {
          const appended = await mod.appendNote(store, { text: note.text, tags: note.tags, author: note.author, id: routeRecord.payload.id }, identityLimits)
          directSeq = appended.seq
        } finally {
          await store.close()
        }
      } finally {
        Date.now = realNow
      }
    }
    const routeSha = ledgerDigest(routeDir)
    const directSha = ledgerDigest(directDir)
    const dirSame = digestOfFiles(routeDir) === digestOfFiles(directDir)
    held('W6',
      answer !== null && answer.status === 200 && routeRecords.length === 1 && directSeq === routeRecord.seq
      && routeSha === directSha && canonical(recordsOf(directDir)) === canonical(routeRecords),
      'route ledger sha256 ' + routeSha + ' vs direct appendNote ledger sha256 ' + directSha + ' (equal: ' + String(routeSha === directSha) + ')'
      + '; pinned: id=' + show(routeRecord && routeRecord.payload.id) + ' at=' + String(routeRecord && routeRecord.at) + ' writer=host instance=' + show(instance)
      + '; whole-directory digests equal: ' + String(dirSame) + '; files ' + canonical(filesUnder(routeDir)))
  } catch (error) {
    held('W6', false, 'the pair could not be taken: ' + String(error && error.message ? error.message : error))
  }

  return rows
}

// ---------------------------------------------------------------- run
rmSync(WORLD_ROOT, { recursive: true, force: true })
mkdirSync(WORLD_ROOT, { recursive: true })
mkdirSync(STAGE, { recursive: true })

const shipped = readFileSync(ARTIFACT, 'utf8')
const mutant = MUTANTS['route-lax-boundary']
if (SELF_ATTACK) {
  if (shipped.includes(mutant.from) === false) notMeasured('the mutant anchor is not in ' + ARTIFACT + ' any more: ' + show(mutant.from))
  if (shipped.split(mutant.from).length - 1 !== 1) notMeasured('the mutant anchor occurs more than once in ' + ARTIFACT + ', so the mutation would move more than one thing')
}
const pristinePath = join(STAGE, 'notes-routes.mjs')
writeFileSync(pristinePath, stage(shipped))
const pristine = await import(pathToFileURL(pristinePath).href)

/** Print one battery, and hand back the failures. */
function report(title, rows) {
  console.log('== dsh-link-notes route self-check - ' + title + ' ==')
  for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '. ' + row.detail)
  const failed = rows.filter((row) => !row.ok)
  console.log('')
  console.log(String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
  return failed
}

const pristineFailed = report('pristine', await battery(pristine))
console.log('artifact ' + ARTIFACT + ' (' + String(Buffer.byteLength(shipped, 'utf8')) + ' bytes, sha256 ' + sha256(shipped).slice(0, 16) + '), worlds ' + WORLD_ROOT)

if (SELF_ATTACK === false) {
  // process.exitCode rather than process.exit(): a spec that dies on the way out reports the wrong thing.
  process.exitCode = pristineFailed.length === 0 ? 0 : 1
} else {
  const attackedPath = join(STAGE, 'notes-routes-mutant.mjs')
  writeFileSync(attackedPath, stage(shipped.replace(mutant.from, mutant.to)))
  const attacked = await import(pathToFileURL(attackedPath).href)
  const attackedFailed = report('mutant route-lax-boundary', await battery(attacked))
  const moved = attackedFailed.map((row) => row.id).sort()
  const declared = [...mutant.expect].sort()
  const exact = canonical(moved) === canonical(declared)
  console.log('')
  console.log('self-attack route-lax-boundary:')
  console.log('  from: ' + show(mutant.from))
  console.log('  to:   ' + show(mutant.to))
  console.log('')
  console.log('pristine held: ' + String(pristineFailed.length === 0) + '; moved set == declared set: ' + String(exact))
  console.log('  moved (failed readings): ' + canonical(moved))
  console.log('  declared:                ' + canonical(declared))
  process.exitCode = (pristineFailed.length === 0 && exact) ? 0 : 1
}