#!/usr/bin/env node
/**
 * Gate 118 (R186, task-12) - notes-ledger: THE TWO THRESHOLDS, THE RENDER AND THE PROMPT SECTION
 * ARE ONE SUBJECT, AND EVERY READING BELOW IS TAKEN FROM BYTES.
 *
 * Subject: plugins/dsh-link-notes/lib/index.js - the BUILT artifact - plus the one prompt section
 * that artifact registers on a real cordis context. Frozen interface: docs/handoff/R186-contract.md
 * section 9 (R2/R3/R6): named export renderNotesSection(state, {maxNotes, maxChars}); defaults
 * maxNotes 200 / maxChars 100; refusals named NOTES_FULL and NOTES_TOO_LONG; one section named
 * notes:ledger at order 700 with interpolate: false; a ledger past maxNotes renders only its newest
 * maxNotes live notes plus one visible "(+K older note(s) elided)" line; an over-long note is
 * clipped to exactly maxChars code points ending in a single horizontal ellipsis.
 *
 * THE WORLD. Two halves, no fake registry anywhere:
 *   (a) the data face is driven through the artifact's own exports against real ledger files under
 *       .tmp, and every expectation is this gate's own arithmetic over the bytes it reads back with
 *       its own JSONL reader - never a number the artifact reports about itself;
 *   (b) the prompt face is a real kernel: a fresh cordis Context mounting the kernel's own
 *       SystemPrompt service and ToolRuntime, with the SHIPPED apply() called on that context, so
 *       the section name, its order, its interpolate flag and its text are read from the kernel's
 *       own registry and its own assemble() - not from a stub.
 *
 * WHAT "DEPENDS ON THE BUILT lib/" MEANS HERE (declared, not hidden). The artifact is measured as
 * it sits on disk, but it is LOADED with its own bare kernel import specifiers rewritten onto the
 * exact module paths this gate imports - the rule gate 115 wrote, so plugin and world share ONE
 * registry instance. That rewrite touches no logic: the gate proves it by un-rewriting the staged
 * bytes and comparing them with the shipped bytes, and it prints both the shipped specifiers and
 * the leftover ones (which must be none). If the artifact cannot be loaded even staged, that is a
 * named red for every reading, not a pass.
 *
 * READINGS (each can fail on its own evidence):
 *   1  The maxNotes boundary is inclusive and refuses by name, leaving the bytes alone.
 *      200 appends through appendNote all answer; the 201st throws a message carrying NOTES_FULL;
 *      the ledger still holds exactly 200 records and its bytes are byte for byte what they were
 *      before the refusal.
 *   2  The maxChars boundary is inclusive and refuses by name, leaving the bytes alone.
 *      A note of exactly 100 code points is taken; a note of 101 is refused with NOTES_TOO_LONG.
 *   3  The render is a function of the facts, not of their arrival: the same records folded from
 *      two arrival orders render byte for byte the same (the fixture carries two notes with the
 *      SAME at, which is where an arrival-ordered fold would show).
 *   4  The injected text IS the fold: the section text the kernel assembles equals
 *      renderNotesSection(projectNotes(records read from the ledger), the frozen limits) byte for
 *      byte - there is no second copy of any note.
 *   5  The empty state is empty: a ledger with zero notes makes the section text exactly "" -
 *      not a blank line, not a placeholder.
 *   6  A note containing double braces renders byte for byte as written: interpolate:false is what
 *      keeps a user's braces out of the variable table, measured against a variable registered in
 *      the very kernel that assembles the section.
 *   7  A garbage ledger does not throw: R48's mixed ledger (payload.text 42, a record with no
 *      usable id, records of other kinds) still renders, and the gate reports what came back.
 *   8  The frozen registration: the section is registered as notes:ledger with order 700 and
 *      interpolate false, read from the kernel's registry.
 *   9  Convergence over history: 205 live notes render as the newest 200 plus one visible elision
 *      line naming the 5 that were left out.
 *  10  An over-long historical note clips to exactly maxChars CODE POINTS ending in the ellipsis
 *      (the fixture carries an astral character inside the first maxChars code points, so a UTF-16
 *      clip answers differently).
 *
 * Self-attack: --self-attack rewrites the SHIPPED ARTIFACT'S OWN BYTES (one located replacement per
 * mutant, or one appended wrapper whose anchor is the artifact's own exported binding) and re-runs
 * every reading against that build. It asserts per mutant that the set of readings that moved is
 * exactly the declared set, prints 声明集 == 观测集 for each, and requires every reading to be
 * declared by at least one mutant. A mutant whose anchor is not in the artifact is named NOT
 * APPLICABLE, and the reading it was to cover then counts as uncovered.
 *
 * WHAT THIS GATE CANNOT JUDGE (named, never reported as a pass): the two tools' schemas, their
 * registration layer, the approval path and the group mask belong to gate 119; so does the
 * session-level claim "no note means no system/message commit". This gate does not drive a real
 * model, does not touch the live client, and does not judge the CODE POINT semantics of the
 * threshold CHECK (only the clip in reading 10 is pinned to code points). It also re-runs no other
 * gate: whether the pre-R186 surface still holds is R48's gate's business.
 *
 * Exit 0 every reading held | 1 a reading failed (or a declared mutant set did not match what
 * moved) | 3 the subject is not here: the artifact file is missing. A reading that cannot be
 * measured is never green.
 *
 * Usage: node scripts/verify-notes-ledger.mjs [--module <path>] [--self-attack] [--keep]
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')))
const COLLAB = join(PROJECT, 'plugins', 'dsh-link-collab')

/** The frozen interface (R186-contract section 9, rulings R2/R3/R6). Every expectation uses these. */
const LIMITS = { maxNotes: 200, maxChars: 100 }
const SECTION_NAME = 'notes:ledger'
const SECTION_ORDER = 700
const ELISION = 'older note(s) elided'
const REFUSAL_FULL = 'NOTES_FULL'
const REFUSAL_LONG = 'NOTES_TOO_LONG'
const BRACE_BODY = 'literal {{gate118_brace}} text'
const SENTINEL = 'GATE118-SUBSTITUTED'
const READINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

/** The kernel modules the plugin imports, by path, so plugin and world share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-llm': join(KERNEL, 'packages', 'llm', 'llm', 'lib', 'index.js'),
}

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const clip = (text, n) => { const out = String(text); return out.length > n ? out.slice(0, n) + '...' : out }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

/** The first index at which two strings differ, or -1 when they are equal byte for byte. */
const firstDiff = (left, right) => {
  const n = Math.min(left.length, right.length)
  for (let at = 0; at < n; at += 1) if (left[at] !== right[at]) return at
  return left.length === right.length ? -1 : n
}
const ellipsis = String.fromCharCode(8230)
const newline = String.fromCharCode(10)

// ---------------------------------------------------------------------------
// Staging: the shipped artifact's own bytes, with ONLY its import specifiers rewritten.
// ---------------------------------------------------------------------------
const stageSource = (source) => {
  let text = source
  let rewrites = 0
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) {
      const parts = text.split(quote + specifier + quote)
      rewrites += parts.length - 1
      text = parts.join(quote + url + quote)
    }
  }
  return { text, rewrites }
}
const unstageSource = (text) => {
  let out = text
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) out = out.split(pathToFileURL(file).href).join(specifier)
  return out
}
const bareSpecifiers = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)].map((match) => match[1]).filter((spec) => spec.startsWith('@'))

// ---------------------------------------------------------------------------
// Bytes on disk: this gate's own reader, so no expectation is read back from the engine.
// ---------------------------------------------------------------------------
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
const filesUnder = (root) => {
  const out = []
  const walk = (rel) => {
    const abs = rel === '' ? root : join(root, rel)
    for (const name of readdirSync(abs).sort()) {
      const child = rel === '' ? name : rel + '/' + name
      if (statSync(join(abs, name)).isDirectory()) walk(child)
      else out.push(child)
    }
  }
  if (existsSync(root)) walk('')
  return out.sort()
}
const bytesOf = (root) => {
  const map = {}
  for (const rel of filesUnder(root)) map[rel] = readFileSync(join(root, rel))
  return map
}
const digestOf = (map) => sha(Buffer.concat(Object.keys(map).sort().map((rel) => Buffer.concat([Buffer.from(rel + '=', 'utf8'), map[rel], Buffer.from(';', 'utf8')]))))
const sizeList = (map) => Object.keys(map).sort().map((rel) => rel + ' ' + String(map[rel].length) + 'B').join(', ')
const jsonlIn = (dir) => { const rel = filesUnder(dir).find((name) => name.endsWith('.jsonl')); return rel === undefined ? null : join(dir, rel) }
function recordsFrom(dir) {
  const records = []
  for (const rel of filesUnder(dir)) {
    for (const line of readFileSync(join(dir, rel), 'utf8').split(newline)) {
      if (line.trim() === '') continue
      let parsed = null
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed !== null && typeof parsed === 'object' && Number.isInteger(parsed.seq)) records.push(parsed)
    }
  }
  return records.sort((left, right) => left.seq - right.seq)
}

// ---------------------------------------------------------------------------
// Temp rooms under .tmp, removed again at the end.
// ---------------------------------------------------------------------------
let BASE = null
let RUN = 0
const base = () => {
  if (BASE === null) { mkdirSync(join(PROJECT, '.tmp'), { recursive: true }); BASE = mkdtempSync(join(PROJECT, '.tmp', 'r118-')) }
  return BASE
}
const room = (tag) => { const dir = join(base(), 'run-' + String(RUN) + '-' + tag); mkdirSync(dir, { recursive: true }); return dir }
let CURRENT = { module: MODULE, room: null, staged: null }

/** Stage one build of the artifact into its own room and load it. */
const stageBuild = (source, tag) => {
  const dir = room('stage-' + tag)
  const staged = stageSource(source)
  const file = join(dir, 'plugins', 'dsh-link-notes', 'lib', 'index.js')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, staged.text)
  cpSync(COLLAB, join(dir, 'plugins', 'dsh-link-collab'), { recursive: true })
  return { dir, file, text: staged.text, rewrites: staged.rewrites, leftover: bareSpecifiers(staged.text), faithful: unstageSource(staged.text) === source }
}

// ---------------------------------------------------------------------------
// The world: a real kernel context and the shipped apply() on it.
// ---------------------------------------------------------------------------
let KERNEL_CACHE = null
const kernel = async () => {
  if (KERNEL_CACHE !== null) return KERNEL_CACHE
  const { Context } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/cordis']).href)
  const prompt = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-system-prompt']).href)
  const ToolRuntime = (await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-tools']).href)).default
  KERNEL_CACHE = { Context, SystemPrompt: prompt.default, renderPrompt: prompt.renderPrompt, ToolRuntime }
  return KERNEL_CACHE
}
const readRegisteredSection = (ctx, name) => {
  const sections = ctx !== null && ctx !== undefined && ctx.systemPrompt !== undefined ? ctx.systemPrompt.layers?.global?.sections : undefined
  if (sections === undefined || sections === null || typeof sections.get !== 'function') return null
  const entry = sections.get(name)
  if (entry === undefined || entry === null) return null
  return { source: 'kernel registry (ctx.systemPrompt.layers.global.sections)', name: entry.name ?? name, order: entry.order, interpolate: entry.interpolate }
}
const waitForSection = async (ctx, name, budgetMs) => {
  const started = Date.now()
  for (;;) {
    const entry = readRegisteredSection(ctx, name)
    if (entry !== null) return { entry, waitedMs: Date.now() - started }
    if (Date.now() - started >= budgetMs) return { entry: null, waitedMs: Date.now() - started }
    await new Promise((done) => setTimeout(done, 20))
  }
}
const describeApply = (error) => {
  const message = describe(error)
  const frames = String(error !== null && error !== undefined && error.stack !== undefined ? error.stack : '').split(newline).map((line) => line.trim()).filter((line) => line.startsWith('at ') && line.includes('dsh-link-notes')).slice(0, 2)
  return message + (frames.length === 0 ? '' : ' | ' + frames.join(' ; '))
}
const buildWorld = async (modulePath, ledgerDir) => {
  const { Context, SystemPrompt, renderPrompt, ToolRuntime } = await kernel()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
  await ctx.plugin(ToolRuntime)
  const plugin = await import(pathToFileURL(modulePath).href)
  let applied = null
  let applyError = null
  try { applied = await ctx.plugin(plugin, { dir: ledgerDir }) } catch (error) { applyError = describeApply(error) }
  ctx.systemPrompt.variable('gate118_brace', () => SENTINEL)
  const waited = await waitForSection(ctx, SECTION_NAME, 1500)
  const assembly = await ctx.systemPrompt.assemble({})
  const assembled = Array.isArray(assembly.sections) ? assembly.sections : []
  const section = assembled.find((row) => row.name === SECTION_NAME) ?? null
  return { ctx, renderPrompt, applied, applyError, registered: waited.entry, waitedMs: waited.waitedMs, assembly, section, assembled }
}

// ---------------------------------------------------------------------------
// Readings.
// ---------------------------------------------------------------------------
const results = []
/** A mutant run measures with the same checks but does not print them: its answer is the delta. */
let QUIET = false
const add = (id, ok, detail, evidence) => {
  results.push({ id, ok: ok === true, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  if (QUIET) return
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + '. ' + detail)
  for (const line of (Array.isArray(evidence) ? evidence : [])) console.log('        ' + line)
}

const surface = (mod) => ({
  noteRecord: mod !== null && typeof mod.noteRecord === 'function' ? mod.noteRecord : null,
  project: mod !== null && typeof mod.projectNotes === 'function' ? mod.projectNotes : null,
  open: mod !== null && typeof mod.openNotesStore === 'function' ? mod.openNotesStore : null,
  append: mod !== null && typeof mod.appendNote === 'function' ? mod.appendNote : null,
  render: mod !== null && typeof mod.renderNotesSection === 'function' ? mod.renderNotesSection : null,
})
const MISSING_DATA = 'the artifact exposes no notes data face (noteRecord/projectNotes/openNotesStore/appendNote)'
const MISSING_RENDER = 'the artifact exports no renderNotesSection, so the R186 render face has not landed (rulings R2/R3)'

const pad = (n, width) => String(n).padStart(width, '0')

async function checkOne(api) {
  if (api.open === null || api.append === null || api.project === null || api.noteRecord === null) { add('1', false, MISSING_DATA); return }
  const dir = room('r1')
  const store = api.open(dir, { writer: 'gate118' })
  const ids = []
  for (let at = 0; at < 200; at += 1) ids.push((await api.append(store, { text: 'boundary note ' + pad(at, 3), tags: [], author: 'gate118' })).id)
  const before = bytesOf(dir)
  let thrown = null
  let accepted = null
  try { accepted = await api.append(store, { text: 'the two hundred and first note', tags: [], author: 'gate118' }) } catch (error) { thrown = error }
  const after = bytesOf(dir)
  const records = recordsFrom(dir)
  await store.close()
  const problems = []
  if (new Set(ids).size !== 200) problems.push('the 200 appends reused an id: ' + String(new Set(ids).size) + ' distinct')
  if (records.length !== 200) problems.push('the ledger holds ' + String(records.length) + ' records, expected exactly the 200 that were taken')
  if (thrown === null) problems.push('the 201st append was TAKEN (it returned ' + clip(show(accepted), 40) + '), so the maxNotes boundary is not enforced at all')
  else if (String(describe(thrown)).includes(REFUSAL_FULL) === false) problems.push('the 201st append threw ' + show(clip(describe(thrown), 90)) + ', which does not carry the frozen refusal code ' + REFUSAL_FULL)
  if (digestOf(before) !== digestOf(after)) problems.push('the refusal changed the ledger: ' + sizeList(before) + ' -> ' + sizeList(after))
  const file = jsonlIn(dir)
  if (file !== null && readFileSync(file, 'utf8').includes('two hundred and first')) problems.push('the refused note is on disk after all')
  add('1', problems.length === 0, problems.length === 0
    ? 'the boundary is inclusive and the overflow is a named refusal: 200 appends taken, the 201st refused with ' + REFUSAL_FULL + ', and the ledger bytes are identical across the refusal'
    : problems.join(' | '),
  ['200 appends -> ' + String(records.length) + ' records on disk; the 201st: ' + (thrown === null ? 'TAKEN (no refusal)' : clip(describe(thrown), 120)),
    'ledger bytes ' + digestOf(before).slice(0, 12) + ' -> ' + digestOf(after).slice(0, 12) + ' (' + sizeList(after) + ')'])
}

async function checkTwo(api) {
  if (api.open === null || api.append === null || api.project === null) { add('2', false, MISSING_DATA); return }
  const dir = room('r2')
  const store = api.open(dir, { writer: 'gate118' })
  const exact = 'x'.repeat(100)
  const over = 'y'.repeat(101)
  const taken = await api.append(store, { text: exact, tags: [], author: 'gate118' })
  const before = bytesOf(dir)
  let thrown = null
  let accepted = null
  try { accepted = await api.append(store, { text: over, tags: [], author: 'gate118' }) } catch (error) { thrown = error }
  const after = bytesOf(dir)
  const records = recordsFrom(dir)
  await store.close()
  const problems = []
  if (typeof taken.id !== 'string' || taken.id === '') problems.push('the exactly-100-code-point note returned ' + clip(show(taken), 60))
  if (records.length !== 1) problems.push('the ledger holds ' + String(records.length) + ' records, expected the one note that was taken')
  if (thrown === null) problems.push('a 101-code-point note was TAKEN (returned ' + clip(show(accepted), 40) + '), so the maxChars boundary is not enforced at all')
  else if (String(describe(thrown)).includes(REFUSAL_LONG) === false) problems.push('the 101-code-point append threw ' + show(clip(describe(thrown), 90)) + ', which does not carry the frozen refusal code ' + REFUSAL_LONG)
  if (digestOf(before) !== digestOf(after)) problems.push('the refusal changed the ledger: ' + sizeList(before) + ' -> ' + sizeList(after))
  const file = jsonlIn(dir)
  const onDisk = file === null ? '' : readFileSync(file, 'utf8')
  if (onDisk.includes(over)) problems.push('the refused 101-code-point body is on disk after all')
  if (onDisk.includes(exact) === false) problems.push('the taken 100-code-point body is not on disk')
  add('2', problems.length === 0, problems.length === 0
    ? 'the length boundary is inclusive and the overflow is a named refusal: exactly 100 code points taken, 101 refused with ' + REFUSAL_LONG + ', the ledger bytes identical across the refusal'
    : problems.join(' | '),
  ['100 code points: taken (' + clip(show(taken), 50) + '); 101 code points: ' + (thrown === null ? 'TAKEN (no refusal)' : clip(describe(thrown), 110)),
    'ledger bytes ' + digestOf(before).slice(0, 12) + ' -> ' + digestOf(after).slice(0, 12) + ' (' + sizeList(after) + ')'])
}

async function checkThree(api) {
  if (api.open === null || api.project === null || api.noteRecord === null) { add('3', false, MISSING_DATA); return }
  if (api.render === null) { add('3', false, MISSING_RENDER); return }
  const dir = room('r3')
  const store = api.open(dir, { writer: 'gate118' })
  const facts = [
    { id: 'arrive-1', text: 'arrival one', at: 1000 },
    { id: 'arrive-2', text: 'arrival two', at: 1000 },
    { id: 'arrive-3', text: 'arrival three', at: 900 },
    { id: 'arrive-4', text: 'arrival four', at: 1100 },
    // One id written twice, which is the only place an arrival-ordered fold could differ from an
    // (at, seq) one: the two arrival orders below differ in which of these two facts is processed
    // last, and no other id in this gate is written twice.
    { id: 'same-note', text: 'same note first fact', at: 2000 },
    { id: 'same-note', text: 'same note second fact', at: 3000 },
  ]
  // Each record carries an actor: the claim rule records a superseded fact with writer: null, and
  // that field is where an arrival order leaks into the folded state (the render never prints it).
  for (const fact of facts) await store.log.append({ ...api.noteRecord(fact.id, fact.text, [], 'open', 'gate118'), at: fact.at, actor: 'gate118' })
  await store.close()
  const records = recordsFrom(dir)
  const forwardState = api.project(records)
  const backwardState = api.project([...records].reverse())
  let forward = null
  let backward = null
  const problems = []
  try { forward = api.render(forwardState, LIMITS) } catch (error) { problems.push('rendering the forward fold threw: ' + clip(describe(error), 80)) }
  try { backward = api.render(backwardState, LIMITS) } catch (error) { problems.push('rendering the reversed fold threw: ' + clip(describe(error), 80)) }
  const orderOf = (state) => (state !== null && state !== undefined && Array.isArray(state.notes) ? state.notes.map((note) => note.id) : null)
  if (forward !== null && typeof forward !== 'string') problems.push('the render answered ' + show(forward) + ', expected a string')
  if (forward === '') problems.push('the render is empty over a four-note ledger, so equality would prove nothing')
  // The state is compared as well as the render: an arrival order can leak into the folded state
  // through a field the render never prints (the claim rule records a superseded winner with
  // writer: null), so render-only equality would be blind to it. Both halves are asserted here.
  const stateDiff = firstDiff(show(forwardState), show(backwardState))
  if (stateDiff !== -1) problems.push('two arrival orders fold differently at code unit ' + String(stateDiff) + ': ' + clip(show(forwardState), 90) + ' vs ' + clip(show(backwardState), 90))
  if (forward !== null && backward !== null) {
    if (forward !== backward) problems.push('two arrival orders render differently at code unit ' + String(firstDiff(forward, backward)) + ': ' + clip(show(forward), 90) + ' vs ' + clip(show(backward), 90))
    for (const body of ['arrival one', 'arrival two', 'arrival three', 'arrival four', 'same note second fact']) {
      if (String(forward).includes(body) === false) problems.push('the render of the forward fold does not carry ' + show(body))
    }
    if (String(forward).includes('same note first fact')) problems.push('the render carries the superseded fact, so this fixture no longer pins the claim rule')
  }
  add('3', problems.length === 0, problems.length === 0
    ? 'the same facts folded from two arrival orders answer byte for byte the same at the fold AND at the render: the order the records came in decides nothing downstream'
    : problems.join(' | '),
  ['records read back from disk: ' + String(records.length) + ' (two share at=1000 and one id is written twice, where an arrival-ordered fold would show)',
    'fold order forward ' + show(orderOf(forwardState)) + ' / reversed ' + show(orderOf(backwardState)),
    'folded state equal=' + String(stateDiff === -1) + '; render ' + String(forward === null ? 0 : forward.length) + ' code units both ways; render equal=' + String(forward === backward),
    'what the render prints: ' + clip(show(forward), 120)])
}

async function worldFor(tag, ledgerDir, cache) {
  if (cache.has(tag)) return cache.get(tag)
  const promise = buildWorld(CURRENT.module, ledgerDir)
  cache.set(tag, promise)
  return promise
}

async function checkFour(api, cache) {
  if (api.project === null || api.noteRecord === null) { add('4', false, MISSING_DATA); return }
  if (api.render === null) { add('4', false, MISSING_RENDER); return }
  const dir = room('r4-ledger')
  const store = api.open(dir, { writer: 'gate118' })
  for (const fact of [{ id: 'fold-1', text: 'plain note one', at: 1000 }, { id: 'fold-2', text: BRACE_BODY, at: 2000 }, { id: 'fold-3', text: 'plain note three', at: 3000 }]) {
    await store.log.append({ ...api.noteRecord(fact.id, fact.text, [], 'open', 'gate118'), at: fact.at })
  }
  await store.close()
  const expected = api.render(api.project(recordsFrom(dir)), LIMITS)
  let world = null
  try { world = await worldFor('ledger', dir, cache) } catch (error) { add('4', false, 'the kernel world could not be built: ' + clip(describe(error), 140)); return }
  if (world.applyError !== null) { add('4', false, 'the shipped apply() threw inside the package, so the section never registered: ' + world.applyError); return }
  const problems = []
  const text = world.section === null ? null : world.section.text
  if (text === null || text === undefined) problems.push('the kernel assembled no section named ' + SECTION_NAME + ' within ' + String(world.waitedMs) + 'ms, so there is nothing to compare')
  else {
    if (typeof text !== 'string') problems.push('the section text is ' + show(text) + ', expected a string')
    else if (expected === '') problems.push('the fold renders empty over a three-note ledger, so equality would prove nothing')
    else if (text !== expected) problems.push('the section text is NOT the fold: they differ at code unit ' + String(firstDiff(text, expected)) + ' (' + clip(show(text), 80) + ' vs ' + clip(show(expected), 80) + ')')
  }
  add('4', problems.length === 0, problems.length === 0
    ? 'the text the kernel injects is the fold itself, byte for byte: no second copy of any note exists between the ledger and the prompt'
    : problems.join(' | '),
  ['section text (' + String(text === null || text === undefined ? 'absent' : text.length) + ' code units) vs renderNotesSection(projectNotes(ledger)) (' + String(expected.length) + '): equal=' + String(text === expected),
    'assembled section text: ' + clip(show(text), 150)])
}

async function checkFive(api, cache) {
  const dir = room('r5-empty')
  let world = null
  try { world = await worldFor('empty', dir, cache) } catch (error) { add('5', false, 'the kernel world could not be built: ' + clip(describe(error), 140)); return }
  if (world.applyError !== null) { add('5', false, 'the shipped apply() threw inside the package, so the section never registered: ' + world.applyError); return }
  const problems = []
  const text = world.section === null ? null : world.section.text
  if (world.section === null) problems.push('no section named ' + SECTION_NAME + ' was registered within ' + String(world.waitedMs) + 'ms over an EMPTY ledger, so an empty section cannot be told from an absent feature')
  else if (text !== '') problems.push('the empty ledger renders ' + show(clip(text, 80)) + ' (' + String(typeof text === 'string' ? text.length : -1) + ' code units), expected exactly the empty string')
  const prompt = world.renderPrompt(world.assembly)
  add('5', problems.length === 0, problems.length === 0
    ? 'zero notes is exactly the empty string: the section carries no blank line and no placeholder, and the assembled prompt has no notes text in it at all'
    : problems.join(' | '),
  ['the rendered prompt over the empty ledger is ' + show(clip(prompt, 120)) + ' (' + String(prompt.length) + ' code units), registered section order=' + show(world.registered === null ? null : world.registered.order)])
}

async function checkSix(api, cache) {
  if (api.noteRecord === null || api.open === null) { add('6', false, MISSING_DATA); return }
  const dir = room('r6-ledger')
  const store = api.open(dir, { writer: 'gate118' })
  await store.log.append({ ...api.noteRecord('brace-1', BRACE_BODY, [], 'open', 'gate118'), at: 1000 })
  await store.close()
  let world = null
  try { world = await worldFor('brace', dir, cache) } catch (error) { add('6', false, 'the kernel world could not be built: ' + clip(describe(error), 140)); return }
  if (world.applyError !== null) { add('6', false, 'the shipped apply() threw inside the package, so the section never registered: ' + world.applyError); return }
  const problems = []
  const text = world.section === null ? null : world.section.text
  const prompt = world.renderPrompt(world.assembly)
  const interpolate = world.registered === null ? undefined : world.registered.interpolate
  if (text === null || text === undefined) problems.push('the kernel assembled no section named ' + SECTION_NAME + ' within ' + String(world.waitedMs) + 'ms')
  else {
    if (String(text).includes(BRACE_BODY) === false) problems.push('the section text does not carry the note byte for byte: ' + clip(show(text), 90) + ' does not contain ' + show(BRACE_BODY))
    if (String(text).includes(SENTINEL)) problems.push('the section text carries the substituted variable value ' + show(SENTINEL) + ', so the note was treated as a template')
  }
  if (prompt.includes(BRACE_BODY) === false) problems.push('the assembled prompt does not carry ' + show(BRACE_BODY) + ': ' + clip(show(prompt), 120))
  if (prompt.includes(SENTINEL)) problems.push('the assembled prompt substituted the note: it contains ' + show(SENTINEL))
  add('6', problems.length === 0, problems.length === 0
    ? 'a note that looks like a template stays literal end to end: the braces reach the assembled prompt exactly as the user wrote them, and a variable of that very name in that very kernel is never consulted'
    : problems.join(' | '),
  ['the variable gate118_brace is registered in this world and answers ' + show(SENTINEL) + '; section interpolate=' + show(interpolate),
    'prompt: ' + clip(show(prompt), 150)])
}

async function checkSeven(api) {
  if (api.project === null || api.noteRecord === null) { add('7', false, MISSING_DATA); return }
  if (api.render === null) { add('7', false, MISSING_RENDER); return }
  // R48's mixed ledger, copied shape for shape: two usable facts, a record whose payload text is a
  // number, a record with no usable id, and two records of other layers.
  const mixed = [
    { ...api.noteRecord('m-1', 'fine', [], 'open', 'gate118'), seq: 1, at: 100, actor: 'gate118' },
    { ...api.noteRecord('m-2', 'fine too', [], 'open', 'gate118'), seq: 2, at: 200, actor: 'gate118' },
    { kind: 'note/state', seq: 3, actor: 'gate118', subject: 42, at: 300, payload: { text: 'no id at all', tags: [], state: 'open', author: 'gate118' } },
    { kind: 'note/state', seq: 4, actor: 'gate118', subject: 'm-4', at: 400, payload: { id: 'm-4', text: 42, tags: [], state: 'open', author: 'gate118' } },
    { kind: 'member/state', seq: 5, actor: 'team-1', subject: 'm-5', at: 500, payload: { id: 'm-5', name: 'm-5', state: 'active', role: 'member' } },
    { kind: 'lock/state', seq: 6, actor: 'team-1', subject: 'task-1', at: 600, payload: {} },
  ]
  const problems = []
  let state = null
  try { state = api.project(mixed) } catch (error) { problems.push('projectNotes threw over the mixed ledger: ' + clip(describe(error), 90)) }
  let rendered = null
  try { rendered = api.render(state, LIMITS) } catch (error) { problems.push('renderNotesSection threw over the mixed ledger: ' + clip(describe(error), 90)) }
  if (rendered !== null && typeof rendered !== 'string') problems.push('the render answered ' + show(rendered) + ', expected a string')
  if (typeof rendered === 'string') {
    for (const body of ['fine', 'fine too']) if (rendered.includes(body) === false) problems.push('the render does not carry the usable note ' + show(body) + ': ' + clip(show(rendered), 90))
  }
  const counts = state === null || state === undefined ? null : state.counts
  add('7', problems.length === 0, problems.length === 0
    ? 'a ledger with unusable shapes renders instead of throwing: the two usable notes come back, the garbage rows are skipped by the fold, and nothing anywhere throws'
    : problems.join(' | '),
  ['fold over the mixed ledger -> ' + clip(show(counts), 120),
    'the render answered ' + (typeof rendered === 'string' ? String(rendered.length) + ' code units: ' + clip(show(rendered), 140) : show(rendered))])
}

async function checkEight(api, cache) {
  const dir = room('r8-ledger')
  let world = null
  try { world = await worldFor('freeze', dir, cache) } catch (error) { add('8', false, 'the kernel world could not be built: ' + clip(describe(error), 140)); return }
  if (world.applyError !== null) { add('8', false, 'the shipped apply() threw inside the package, so the section never registered: ' + world.applyError); return }
  const problems = []
  const entry = world.registered
  if (entry === null) problems.push('no section named ' + SECTION_NAME + ' was registered in the kernel within ' + String(world.waitedMs) + 'ms')
  else {
    if (entry.order !== SECTION_ORDER) problems.push('the registered order is ' + show(entry.order) + ', frozen at ' + String(SECTION_ORDER))
    if (entry.interpolate !== false) problems.push('the registered interpolate flag is ' + show(entry.interpolate) + ', frozen at false')
  }
  add('8', problems.length === 0, problems.length === 0
    ? 'the registration is the frozen one: the section is named ' + SECTION_NAME + ' at order ' + String(SECTION_ORDER) + ' with interpolate false, read out of the kernel registry'
    : problems.join(' | '),
  ['registered: ' + show(entry) + ' (source: ' + (entry === null ? 'nothing was registered' : entry.source) + ')'])
}

async function checkNine(api) {
  if (api.open === null || api.project === null || api.noteRecord === null) { add('9', false, MISSING_DATA); return }
  if (api.render === null) { add('9', false, MISSING_RENDER); return }
  const dir = room('r9')
  const store = api.open(dir, { writer: 'gate118' })
  const bodies = []
  for (let at = 0; at < 205; at += 1) {
    const body = 'elision-note-' + pad(at, 3)
    bodies.push(body)
    await store.log.append({ ...api.noteRecord('history-' + pad(at, 3), body, [], 'open', 'gate118'), at: 1000 + at })
  }
  await store.close()
  const records = recordsFrom(dir)
  const problems = []
  let rendered = null
  try { rendered = api.render(api.project(records), LIMITS) } catch (error) { problems.push('the render threw over 205 historical notes: ' + clip(describe(error), 90)) }
  const present = typeof rendered === 'string' ? bodies.filter((body) => rendered.includes(body)) : []
  const oldest = bodies.slice(0, 5)
  const newest = bodies.slice(5)
  if (typeof rendered === 'string') {
    if (present.length !== LIMITS.maxNotes) problems.push('the render carries ' + String(present.length) + ' of the 205 bodies, expected exactly ' + String(LIMITS.maxNotes))
    for (const body of oldest) if (rendered.includes(body)) problems.push('the render kept the oldest note ' + show(body) + ', so it converged on the wrong end')
    for (const body of newest) if (rendered.includes(body) === false) problems.push('the render dropped a note inside the newest ' + String(LIMITS.maxNotes) + ': ' + show(body))
    if (rendered.includes('(+5 ' + ELISION + ')') === false) problems.push('the elision is silent: the render does not carry the frozen line "(+5 ' + ELISION + ')"')
  }
  const line = typeof rendered === 'string' ? (rendered.split(newline).find((row) => row.includes('elided')) ?? null) : null
  add('9', problems.length === 0, problems.length === 0
    ? 'a ledger past the threshold converges the same way every time and says so: the newest ' + String(LIMITS.maxNotes) + ' live notes render, the 5 older ones are left out, and the elision is a visible line rather than a silent truncation'
    : problems.join(' | '),
  ['205 historical notes on disk -> ' + String(records.length) + ' records; the render carries ' + String(present.length) + ' bodies',
    'the elision line as written: ' + show(line),
    'the 5 oldest bodies left out: ' + show(oldest)])
}

async function checkTen(api) {
  if (api.open === null || api.project === null || api.noteRecord === null) { add('10', false, MISSING_DATA); return }
  if (api.render === null) { add('10', false, MISSING_RENDER); return }
  const dir = room('r10')
  const store = api.open(dir, { writer: 'gate118' })
  const star = String.fromCodePoint(0x1F642)
  // 150 code points, with an astral character inside the first maxChars-1 of them: a clip by UTF-16
  // code units answers with a different string than a clip by code points.
  const body = 'a'.repeat(50) + star + 'b'.repeat(99)
  await store.log.append({ ...api.noteRecord('over-long-1', body, [], 'open', 'gate118'), at: 1000 })
  await store.close()
  const expected = 'a'.repeat(50) + star + 'b'.repeat(48) + ellipsis
  const fullPrefix = 'a'.repeat(50) + star + 'b'.repeat(49)
  const records = recordsFrom(dir)
  const problems = []
  let rendered = null
  try { rendered = api.render(api.project(records), LIMITS) } catch (error) { problems.push('the render threw over an over-long historical note: ' + clip(describe(error), 90)) }
  if (typeof rendered === 'string') {
    if (rendered.includes(body)) problems.push('the over-long body reached the prompt whole (150 code points), so nothing converges')
    if (rendered.includes(expected) === false) problems.push('the clip is not the first ' + String(LIMITS.maxChars - 1) + ' code points plus the ellipsis: ' + clip(show(rendered), 140))
    if (rendered.includes(fullPrefix)) problems.push('the clip kept ' + String(LIMITS.maxChars) + ' code points and merely added a terminator; the frozen rule is ' + String(LIMITS.maxChars) + ' code points ENDING in the ellipsis')
  }
  add('10', problems.length === 0, problems.length === 0
    ? 'an over-long historical note clips to exactly ' + String(LIMITS.maxChars) + ' code points with the ellipsis in the last position, measured with an astral character inside the clipped window'
    : problems.join(' | '),
  ['the note on disk is ' + String([...body].length) + ' code points (' + String(body.length) + ' UTF-16 units); expected clip ' + show(expected),
    'the render measured ' + (typeof rendered === 'string' ? String([...rendered].length) + ' code points: ' + clip(show(rendered), 140) : show(rendered))])
}

const CHECKS = [['1', checkOne], ['2', checkTwo], ['3', checkThree], ['4', checkFour], ['5', checkFive], ['6', checkSix], ['7', checkSeven], ['8', checkEight], ['9', checkNine], ['10', checkTen]]

// ---------------------------------------------------------------------------
// The mutant set: each rewrites ONE located string in the artifact's own bytes (or appends one
// wrapper whose anchor is the artifact's own exported binding) and declares exactly what must move.
// ---------------------------------------------------------------------------
const QUOTES = "\u0027\u0022\u0060"
const foundIn = (source, patterns) => {
  for (const pattern of patterns) {
    const hits = [...source.matchAll(pattern)]
    if (hits.length === 1) return { hit: hits[0], pattern: String(pattern) }
  }
  return null
}
const splice = (source, hit, to) => source.slice(0, hit.index) + to + source.slice(hit.index + hit[0].length)

const MUTANTS = [
  {
    name: 'the-full-refusal-code-is-renamed',
    expect: ['1'],
    mutate: (source) => {
      const found = foundIn(source, [/["'\u0060]NOTES_FULL["'\u0060]/gu, /\bNOTES_FULL\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace('NOTES_FULL', 'NOTES_CAPACITY')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-length-refusal-code-is-renamed',
    expect: ['2'],
    mutate: (source) => {
      const found = foundIn(source, [/["'\u0060]NOTES_TOO_LONG["'\u0060]/gu, /\bNOTES_TOO_LONG\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace('NOTES_TOO_LONG', 'NOTES_LENGTH')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-maxNotes-default-is-moved',
    expect: ['1'],
    mutate: (source) => {
      const found = foundIn(source, [/\bmaxNotes\s*:\s*200\b/gu, /\bmaxNotes\s*=\s*200\b/gu, /\bmaxNotes\b[^\n]{0,40}?\b200\b/gu, /\b200\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace('200', '199')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-maxChars-default-is-moved',
    expect: ['2'],
    mutate: (source) => {
      const found = foundIn(source, [/\bmaxChars\s*:\s*100\b/gu, /\bmaxChars\s*=\s*100\b/gu, /\bmaxChars\b[^\n]{0,40}?\b100\b/gu, /\b100\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace('100', '99')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-section-order-is-moved-off-700',
    expect: ['8'],
    mutate: (source) => {
      const found = foundIn(source, [/\border\s*:\s*700\b/gu, /\b700\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace('700', '701')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'interpolation-is-turned-on-for-the-notes-section',
    expect: ['6', '8'],
    mutate: (source) => {
      const found = foundIn(source, [/\binterpolate\s*:\s*false\b/gu, /\binterpolate\s*:\s*!1\b/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, found.hit[0].replace(/false|!1/u, 'true')), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-section-reads-a-different-source-than-the-fold',
    // Measured, not guessed: this anchor is the store read the whole package shares, so the mutant
    // also blinds the live-note count the fullness refusal uses, which is why reading 1 moves too.
    expect: ['1', '4', '6'],
    mutate: (source) => {
      const found = foundIn(source, [/\bstore\.log\.replay\(\)/gu, /\blog\.replay\(\)/gu, /\bnotesOf\(store\)/gu])
      if (found === null) return null
      const to = found.hit[0].includes('notesOf') ? 'projectNotes([])' : '[]'
      return { text: splice(source, found.hit, to), note: 'anchor ' + found.pattern + ' -> ' + to }
    },
  },
  {
    name: 'the-empty-state-becomes-a-placeholder',
    // The anchor is the artifact's own exported binding at its own end of file: the wrapper calls
    // the shipped renderer and only changes what it answers for the empty string.
    expect: ['5'],
    mutate: (source) => {
      const wrapper = ['',
        '// gate 118 mutant: the anchor is this module own exported binding, at its own end of file',
        '{',
        '  const gate118Shipped = renderNotesSection;',
        '  renderNotesSection = (...args) => { const text = gate118Shipped(...args); return text === "" ? "GATE118-PLACEHOLDER" : text; };',
        '}',
        ''].join(newline)
      return { text: source + wrapper, note: 'anchor: the exported binding renderNotesSection at end of file' }
    },
  },
  {
    name: 'the-elision-line-is-worded-differently',
    expect: ['9'],
    mutate: (source) => {
      const found = foundIn(source, [/older note\(s\) elided/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, 'older note(s) suppressed'), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'the-clip-loses-its-terminator',
    expect: ['10'],
    mutate: (source) => {
      // The ellipsis appears at least twice (the elision line and the clip). Take the one whose
      // neighbourhood is NOT the elision sentence.
      const hits = [...source.matchAll(/\\u2026|\u2026/gu)]
      const clipHits = hits.filter((hit) => {
        const around = source.slice(Math.max(0, hit.index - 70), hit.index + 70)
        return around.includes('elided') === false && around.includes('older note') === false
      })
      if (clipHits.length !== 1) return null
      return { text: splice(source, clipHits[0], ''), note: 'anchor: the ellipsis at the clip (of ' + String(hits.length) + ' in the artifact)' }
    },
  },
  {
    name: 'the-arrival-order-leaks-into-the-fold',
    // Dropping the pre-fold record sort (R48's own mutant for its reading 6). The order then reaches
    // the folded state through a field the render never prints - a superseded winner is recorded with
    // writer: null - which is exactly why reading 3 compares the state as well as the render.
    expect: ['3'],
    mutate: (source) => {
      const found = foundIn(source, [/\[\.\.\.records\]\.sort\(\(left, right\) => left\.seq - right\.seq\)/gu, /\[\.\.\.records\]\.sort\(\([a-zA-Z]+, [a-zA-Z]+\) => [a-zA-Z]+\.seq - [a-zA-Z]+\.seq\)/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, '[...records]'), note: 'anchor ' + found.pattern }
    },
  },
  {
    name: 'an-unusable-shape-breaks-the-fold',
    expect: ['7'],
    mutate: (source) => {
      const found = foundIn(source, [/\bmalformed \+= 1;/gu])
      if (found === null) return null
      return { text: splice(source, found.hit, 'throw new Error("gate 118 mutant: an unusable shape breaks the fold");'), note: 'anchor ' + found.pattern }
    },
  },
]

// ---------------------------------------------------------------------------
// Running every reading against one build of the artifact.
// ---------------------------------------------------------------------------
async function runAll(source, tag, quiet) {
  results.length = 0
  QUIET = quiet === true
  RUN += 1
  const worlds = new Map()
  const staged = stageBuild(source, tag)
  CURRENT = { module: staged.file, room: staged.dir, staged }
  let mod = null
  let loadError = null
  try { mod = await import(pathToFileURL(staged.file).href) } catch (error) { loadError = describe(error) }
  const api = surface(mod)
  if (loadError !== null) for (const [id] of CHECKS) add(id, false, 'the staged artifact does not load at all: ' + clip(loadError, 140))
  else {
    for (const [id, check] of CHECKS) {
      const mark = results.length
      try { await check(api, worlds) } catch (error) { add(id, false, 'the check threw: ' + describe(error)) }
      if (results.length === mark) add(id, false, 'no reading was recorded')
    }
  }
  for (const promise of worlds.values()) {
    try { const world = await promise; await world.ctx.fiber.dispose() } catch { /* a world that never built has nothing to dispose */ }
  }
  return { staged, failed: results.filter((row) => row.ok === false).map((row) => row.id), rows: results.map((row) => ({ id: row.id, ok: row.ok, detail: row.detail })) }
}

// ---------------------------------------------------------------------------
// Self-attack.
// ---------------------------------------------------------------------------
const runSelfAttack = async () => {
  const source = readFileSync(MODULE, 'utf8')
  console.log('  the artifact under attack: ' + MODULE + ' (' + String(Buffer.byteLength(source)) + ' bytes)')
  const baseline = await runAll(source, 'baseline', true)
  const baseRed = baseline.failed
  console.log('  baseline in this world: ' + String(baseline.rows.length) + ' readings, ' + String(baseRed.length) + ' failed' + (baseRed.length === 0 ? ' (the readings themselves are printed by the plain run)' : ''))
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed))
    for (const row of baseline.rows.filter((reading) => reading.ok === false)) console.log('        ' + row.id + '. ' + row.detail)
    console.log('  the mutants are not measured against a red baseline, but their anchors are reported so a reader can see what they would have attacked:')
    let anchors = 0
    for (const mutant of MUTANTS) {
      const made = mutant.mutate(source)
      if (made !== null) anchors += 1
      console.log('        ' + (made === null ? 'NOT APPLICABLE' : 'applicable    ') + '  ' + mutant.name + ' -> ' + show(mutant.expect) + (made === null ? '' : ' (' + made.note + ')'))
    }
    console.log('        ' + String(anchors) + ' of ' + String(MUTANTS.length) + ' mutants find their anchor in these bytes')
    return 1
  }
  console.log('  each mutant below rewrites ONE located string in the shipped artifact own bytes and is measured by the same readings:')
  let failures = 0
  let built = 0
  let notApplicable = 0
  const moved = new Map()
  for (const [at, mutant] of MUTANTS.entries()) {
    const made = mutant.mutate(source)
    if (made === null) {
      notApplicable += 1
      console.log('  SKIP  mutant. ' + mutant.name + ' — NOT APPLICABLE: none of its anchors is in the artifact exactly once, so it cannot say anything about ' + show(mutant.expect))
      continue
    }
    const run = await runAll(made.text, 'mutant-' + String(at), true)
    const observed = run.failed.slice().sort()
    const declared = [...mutant.expect].sort()
    const precise = same(observed, declared)
    if (precise === false) failures += 1
    built += 1
    for (const id of declared) moved.set(id, (moved.get(id) === undefined ? 0 : moved.get(id)) + 1)
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed) + ' (' + made.note + ')')
    if (precise === false) for (const row of run.rows.filter((reading) => reading.ok === false)) console.log('        ' + (declared.includes(row.id) ? 'declared but red: ' : 'moved but not declared: ') + row.id + '. ' + row.detail)
  }
  console.log('  coverage matrix (every reading must be declared by at least one applicable mutant):')
  let uncovered = 0
  for (const id of READINGS) {
    const count = moved.get(id) === undefined ? 0 : moved.get(id)
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(built) + ' mutants applied, ' + String(notApplicable) + ' not applicable, ' + String(failures) + ' imprecise, ' + String(uncovered) + ' reading(s) uncovered')
  return failures === 0 && uncovered === 0 && built > 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  if (existsSync(MODULE) === false) return NOT_MEASURED('there is no built artifact at ' + MODULE)
  const shipped = readFileSync(MODULE, 'utf8')
  console.log('  the artifact: ' + MODULE + ' (' + String(Buffer.byteLength(shipped)) + ' bytes, bare kernel specifiers ' + show(bareSpecifiers(shipped)) + ')')
  console.log('  frozen interface: renderNotesSection(state, ' + show(LIMITS) + '); refusals ' + REFUSAL_FULL + '/' + REFUSAL_LONG + '; section ' + SECTION_NAME + ' order ' + String(SECTION_ORDER) + ' interpolate false')
  if (SELF_ATTACK) {
    const code = await runSelfAttack()
    console.log('  elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
    return code
  }
  const run = await runAll(shipped, 'gate')
  const staged = run.staged
  console.log('  staging: the shipped bytes are loaded with their kernel specifiers rewritten onto this gate module paths - ' + String(staged.rewrites) + ' rewrite(s), leftover bare specifiers ' + show(staged.leftover) + ', un-rewriting reproduces the shipped bytes exactly: ' + String(staged.faithful))
  const failed = run.failed
  console.log('')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length) + ' held, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failed.length > 0 ? 1 : 0
}

const code = await main()
const roots = BASE
if (BASE !== null && KEEP === false) rmSync(BASE, { recursive: true, force: true })
console.log('')
console.log('store roots: ' + (roots === null ? 'none were needed' : roots + (KEEP ? ' (kept: --keep)' : ' (built under .tmp, removed again: ' + String(!existsSync(roots)) + ')')))
process.exit(code)
