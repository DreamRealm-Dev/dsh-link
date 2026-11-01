#!/usr/bin/env node
/**
 * dsh-link-notes self-check (producer-owned, NOT a gate).
 *
 * What it is for: the three threshold layers, the rendered section and the two tools, each read
 * against the shipped artifact's own bytes. The world is the real kernel - a fresh cordis Context
 * with the real SystemPrompt, the real ToolRuntime, the real AgentRegistry, the real Session, and in
 * one world the real ApprovalService - and the plugin's built lib/index.js is loaded through an
 * import rewrite (plugins/dsh-link-groups/test/group-state-selfcheck.mjs stages the same way, for the
 * same reason: a bare kernel specifier resolves in the loaded profile, not in this checkout). No
 * hand-written registry stands in for the kernel's: every tool reading goes through ctx.tools.execute.
 *
 * What it is NOT: gate 118 notes-ledger and gate 119 notes-inject carry the mount-level readings and
 * the declared-set self-attack over the whole artifact. This file exists so the producer can see each
 * of its own claims move: --mutant injects one string into the artifact's own bytes and the run ends
 * with declared set vs observed set.
 *
 *   node plugins/dsh-link-notes/test/notes-invariants.mjs
 *   node plugins/dsh-link-notes/test/notes-invariants.mjs --mutant allow-101
 *
 * Exit codes: 0 every reading held (or the declared set matched), 1 a reading failed or the mutant
 * moved something it did not declare, 3 NOT MEASURED (a kernel module or the built artifact is not
 * there, so no honest reading exists).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const SCRATCH = join(PROJECT, '.tmp', 'r186-p1', 'stage')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MUTANT = option('--mutant', '')

/** The kernel modules the artifact imports, by path, so both sides share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-user-approval': join(KERNEL, 'packages', 'interaction', 'user-approval', 'lib', 'index.js'),
}

/** The one relative import the artifact carries: the collaboration bus's own built module. */
const RELATIVE_MODULES = { '../../dsh-link-collab/lib/index.js': join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js') }

const readings = []
const held = (id, ok, detail) => { readings.push({ id, ok: ok === true, detail: String(detail) }); return ok === true }
const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }

for (const [specifier, file] of Object.entries({ ...KERNEL_MODULES, ...RELATIVE_MODULES })) {
  if (!existsSync(file)) notMeasured('the module ' + specifier + ' is missing at ' + file + '; this self-check mounts the real kernel and will not stand in a fake one')
}
if (!existsSync(ARTIFACT)) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (run: node plugins/build.mjs)')

/** Rewrite the artifact's bare kernel imports and its one relative import onto absolute file URLs. */
function stage(text) {
  let out = text
  for (const [specifier, file] of Object.entries({ ...KERNEL_MODULES, ...RELATIVE_MODULES })) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) out = out.split(quote + specifier + quote).join(quote + url + quote)
  }
  return out
}

/** The mutants: each replaces exactly one string in the artifact's own bytes and declares what must move. */
const MUTANTS = {
  'allow-101': { from: 'if (length > maxChars) {', to: 'if (length > maxChars + 1) {', expect: ['D2', 'D2a', 'H4', 'H5'] },
  'allow-201': { from: 'if (held >= maxNotes) {', to: 'if (held >= maxNotes + 1) {', expect: ['D4', 'D5'] },
  'render-oldest': { from: 'live.slice(elided)', to: 'live.slice(0, live.length - elided)', expect: ['E1'] },
  'interpolate-on': { from: 'interpolate: false,', to: 'interpolate: true,', expect: ['B2', 'B4'] },
  'never-asks': { from: 'return { kind: "ask" };', to: 'return { kind: "allow" };', expect: ['H2', 'H3', 'H7'] },
}

const shipped = readFileSync(ARTIFACT, 'utf8')
const artifactImports = [...shipped.matchAll(/from\s+["']([^"']+)["']/gu)].map((m) => m[1]).filter((specifier) => !specifier.startsWith('node:')).sort()
// The three specifiers the built artifact actually imports: the rest of the kernel modules this file
// mounts are type-only imports in the source and are gone from the bundle.
const STATED_RUNTIME_IMPORTS = ['../../dsh-link-collab/lib/index.js', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery']
let artifactText = shipped
if (MUTANT !== '') {
  const mutant = MUTANTS[MUTANT]
  if (mutant === undefined) notMeasured('unknown mutant "' + MUTANT + '"; known: ' + Object.keys(MUTANTS).join(', '))
  if (!shipped.includes(mutant.from)) notMeasured('mutant "' + MUTANT + '" cannot be applied: its anchor is not in the artifact bytes')
  if (shipped.split(mutant.from).length - 1 !== 1) notMeasured('mutant "' + MUTANT + '" anchor occurs more than once, so it would move more than one thing')
  artifactText = shipped.replace(mutant.from, mutant.to)
}

mkdirSync(SCRATCH, { recursive: true })
const stagedPath = join(SCRATCH, 'notes' + (MUTANT === '' ? '' : '-' + MUTANT) + '.mjs')
const stagedText = stage(artifactText)
writeFileSync(stagedPath, stagedText)
const plugin = await import(pathToFileURL(stagedPath).href)

const K = (specifier) => pathToFileURL(KERNEL_MODULES[specifier]).href
const { Context } = await import(K('@deepseek-ai/cordis'))
const { createScope } = await import(K('@deepseek-ai/dsh-scope'))
const { default: SystemPrompt, renderPrompt } = await import(K('@deepseek-ai/dsh-system-prompt'))
const { default: ToolRuntime } = await import(K('@deepseek-ai/dsh-tools'))
const { Session, SessionId } = await import(K('@deepseek-ai/dsh-session'))
const { default: AgentRegistry } = await import(K('@deepseek-ai/dsh-agent'))
const { default: ApprovalService } = await import(K('@deepseek-ai/dsh-user-approval'))
const { projectNotes, appendNote, openNotesStore, notesOf, renderNotesSection, liveNotes } = plugin

const LIMITS = { maxNotes: plugin.DEFAULT_MAX_NOTES, maxChars: plugin.DEFAULT_MAX_CHARS }
const NL = String.fromCharCode(10)
const codePoints = (text) => Array.from(text).length
const emoji = (count) => Array.from({ length: count }, () => '\u{1F5D2}').join('')
const body = (n) => 'x'.repeat(n)
const worldRoots = []

/** One note fact as the ledger stores it, for ledgers this file writes by hand. */
const fact = (id, text, seq, at, state) => ({ kind: 'note/state', subject: id, payload: { id, text, tags: [], state: state ?? 'open', author: 'selfcheck' }, seq, at, actor: 'selfcheck' })

/** Write a ledger by hand, before any store opens it: the file is what the store must read back. */
function writeLedger(dir, records) {
  mkdirSync(join(dir, 'notes'), { recursive: true })
  writeFileSync(join(dir, 'notes', 'control.jsonl'), records.map((record) => JSON.stringify(record)).join(NL) + NL)
  return dir
}

/** Every file under one root, in a fixed order. */
function filesUnder(root) {
  if (!existsSync(root)) return []
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
const ledgerDigest = (dir) => {
  const hash = createHash('sha256')
  for (const rel of filesUnder(dir)) { hash.update(rel); hash.update(readFileSync(join(dir, rel))) }
  return hash.digest('hex').slice(0, 16)
}
const recordCount = (dir) => {
  let count = 0
  for (const rel of filesUnder(dir)) { if (!rel.endsWith('control.jsonl')) continue; for (const line of readFileSync(join(dir, rel), 'utf8').split(NL)) if (line.trim() !== '') count += 1 }
  return count
}
const ledgerText = (dir) => filesUnder(dir).map((rel) => readFileSync(join(dir, rel), 'utf8')).join(NL)

let worlds = 0
/** One world: real kernel services, one live agent, then the plugin row, applied for real. */
async function mountWorld(config, withApproval) {
  const root = mkdtempSync(join(tmpdir(), 'r186-p1-'))
  worldRoots.push(root)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const id = 'r186p1-agent-' + String(worlds += 1)
  const agent = {
    id: SessionId(id),
    options: {},
    session: Session.create(SessionId(id)),
    inbox: { nextTurn: [], nextStep: [] },
    status: 'idle',
    ctx: undefined,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' }) }),
    inject() {},
    cancel() {},
    runMaintenance: (task) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  // The scope key is the agent itself, exactly as the kernel mints it: a view resolves a scope by the
  // key it is asked about, so a mismatched key would read an empty layer and hide every registration.
  await ctx.plugin(Object.assign((inner) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  const fiber = ctx.plugin(plugin, { dir: root, ...config })
  await fiber
  const unregister = await ctx.agents.register(agent)
  const approvals = { asked: 0, answer: 'rejected', service: null }
  if (withApproval === true) {
    approvals.service = new ApprovalService(agent.ctx, { policy: 'ask' })
    agent.session.append('turn/start', { turn: 1 })
    ctx.on('approval/request', () => { approvals.asked += 1; return Promise.resolve(approvals.answer) })
  }
  return { ctx, agent, root, fiber, unregister, approvals, ledger: join(root, 'notes') }
}
const run = async (world, name, args) => {
  try {
    const result = await world.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'call-' + name + '-' + String(Math.random()).slice(2, 10),
      name,
      arguments: args ?? {},
      agent: world.agent,
    })
    const first = result.content[0]
    return { text: first !== undefined && first.type === 'text' ? first.text : JSON.stringify(result.content), isError: result.isError === true }
  } catch (error) {
    return { text: 'the executor threw: ' + String(error && error.message ? error.message : error), isError: true }
  }
}
const surfaceOf = (world) => world.ctx.tools.schemas(world.agent).map((tool) => tool.name)
const promptOf = async (world) => {
  try { return renderPrompt(await world.ctx.systemPrompt.assemble({})) } catch (error) { return 'the assembly threw: ' + String(error && error.message ? error.message : error) }
}
const sectionOf = async (world) => (await world.ctx.systemPrompt.assemble({})).sections.find((section) => section.name === 'notes:ledger')

// ---------------------------------------------------------------- A: the shipped surface
const stagedImports = [...stagedText.matchAll(/from\s+["']([^"']+)["']/gu)].map((m) => m[1])
  .filter((specifier) => !specifier.startsWith('file:///') && !specifier.startsWith('node:'))
held('A1',
  JSON.stringify(artifactImports) === JSON.stringify([...STATED_RUNTIME_IMPORTS].sort()) && stagedImports.length === 0,
  'the artifact imports exactly ' + JSON.stringify(artifactImports) + ', and staging rewrote every one of them onto an absolute path ('
    + String(3 - stagedImports.length) + ' of 3): ' + JSON.stringify(stagedImports))
held('A2',
  plugin.name === 'dsh-link-notes' && plugin.default === undefined && JSON.stringify(plugin.inject) === '["tools","systemPrompt"]'
    && typeof plugin.renderNotesSection === 'function' && typeof plugin.projectNotes === 'function'
    && typeof plugin.appendNote === 'function' && typeof plugin.setNoteState === 'function' && typeof plugin.notesWithTag === 'function'
    && typeof plugin.searchNotes === 'function' && typeof plugin.openNotes === 'function' && typeof plugin.noteRecord === 'function'
    && typeof plugin.openNotesStore === 'function' && plugin.NOTE_KIND === 'note/state'
    && plugin.LIST_TOOL === 'notes_list' && plugin.ADD_TOOL === 'notes_add' && plugin.SECTION_NAME === 'notes:ledger' && plugin.SECTION_ORDER === 700
    && plugin.DEFAULT_MAX_NOTES === 200 && plugin.DEFAULT_MAX_CHARS === 100
    && JSON.stringify(plugin.REFUSALS) === '{"INPUT":"NOTES_INPUT","TOO_LONG":"NOTES_TOO_LONG","FULL":"NOTES_FULL"}',
  'named exports only, with the R48 data face intact: no default export, inject=' + JSON.stringify(plugin.inject)
    + ', names ' + JSON.stringify([plugin.LIST_TOOL, plugin.ADD_TOOL, plugin.SECTION_NAME, plugin.SECTION_ORDER]) + ', refusals ' + JSON.stringify(plugin.REFUSALS))

// ---------------------------------------------------------------- B: the prompt section
const doubledBrace = 'Q:/ffmpeg/ 目录 — 的说明 {{notes_that_do_not_exist}} 与它在 PATH 里的位置'
const sectionRoot = writeLedger(mkdtempSync(join(tmpdir(), 'r186-p1-section-')), [fact('s-1', doubledBrace, 1, 1)])
worldRoots.push(sectionRoot)
const sectionWorld = await mountWorld({ dir: sectionRoot }, false)
const batched = await sectionWorld.ctx.systemPrompt.assemble({})
const found = batched.sections.filter((section) => section.name === 'notes:ledger')
held('B1', found.length === 1, 'exactly one section named notes:ledger is in the assembly (' + String(found.length) + ' found)')
held('B2',
  found.length === 1 && found[0].interpolate === false,
  'it is registered with interpolation off: the assembly carries interpolate=' + JSON.stringify(found.length === 1 ? found[0].interpolate : null))
held('B3',
  found.length === 1 && found[0].text === renderNotesSection(projectNotes([{ kind: 'note/state', subject: 's-1', payload: { id: 's-1', text: doubledBrace, tags: [], state: 'open', author: 'selfcheck' }, seq: 1, at: 1 }]), LIMITS),
  'the section text is the fold rendered, byte for byte, with no second storage: ' + JSON.stringify(found.length === 1 ? found[0].text : null).slice(0, 200))
let sectionPrompt = ''
try { sectionPrompt = renderPrompt(batched) } catch (error) { sectionPrompt = 'the render threw: ' + String(error && error.message ? error.message : error) }
held('B4',
  sectionPrompt.includes(doubledBrace) && sectionPrompt.includes('{{notes_that_do_not_exist}}'),
  'a note containing {{...}} reaches the rendered prompt verbatim: ' + JSON.stringify(sectionPrompt.slice(0, 200)))
// The pair: the same text in a section that DOES interpolate is a hard error, not a quiet loss.
const controlCtx = new Context()
await controlCtx.plugin(SystemPrompt, {})
controlCtx.systemPrompt.section({ name: 'control:interpolated', order: 700, text: doubledBrace })
let controlError = null
try { renderPrompt(await controlCtx.systemPrompt.assemble({})) } catch (error) { controlError = error }
held('B5',
  controlError !== null && /unknown prompt variable/u.test(String(controlError.message)),
  'the pair to B4: the same text with interpolation on is refused by the kernel (' + String(controlError === null ? 'no error' : controlError.message).slice(0, 130) + ')')
// The order reading: two neighbours out of the same layer bracket the value the row registered.
sectionWorld.ctx.systemPrompt.section({ name: 'selfcheck:before', order: 699, text: 'before' })
sectionWorld.ctx.systemPrompt.section({ name: 'selfcheck:after', order: 701, text: 'after' })
const orderedNames = (await sectionWorld.ctx.systemPrompt.assemble({})).sections.map((section) => section.name)
held('B6',
  orderedNames.indexOf('selfcheck:before') !== -1 && orderedNames.indexOf('selfcheck:before') < orderedNames.indexOf('notes:ledger')
    && orderedNames.indexOf('notes:ledger') < orderedNames.indexOf('selfcheck:after'),
  'its order is 700, read between a 699 neighbour and a 701 neighbour: ' + JSON.stringify(orderedNames.filter((name) => name.startsWith('selfcheck') || name === 'notes:ledger')))

// ---------------------------------------------------------------- C: the empty ledger
const emptyWorld = await mountWorld({}, false)
const emptyText = await sectionOf(emptyWorld)
held('C1',
  emptyText !== undefined && emptyText.text === '' && !(await promptOf(emptyWorld)).includes('Notes ledger'),
  'an empty ledger renders an empty section and the empty section contributes nothing to the prompt: text=' + JSON.stringify(emptyText === undefined ? null : emptyText.text))
const emptyList = await run(emptyWorld, 'notes_list')
held('C2',
  emptyList.isError === false && /0 live note/u.test(emptyList.text),
  'notes_list on an empty ledger answers instead of failing: ' + JSON.stringify(emptyList.text))

// ---------------------------------------------------------------- D: the thresholds at the append layer
const thresholdRoot = mkdtempSync(join(tmpdir(), 'r186-p1-threshold-'))
worldRoots.push(thresholdRoot)
const store = openNotesStore(thresholdRoot, { writer: 'selfcheck' })
const liveCount = () => liveNotes(notesOf(store)).length
await appendNote(store, { text: body(100), author: 'selfcheck' }, LIMITS)
held('D1',
  codePoints(body(100)) === 100 && liveCount() === 1,
  'a body of exactly 100 code points is accepted, so maxChars is inclusive: ' + String(liveCount()) + ' live note(s)')
await appendNote(store, { text: emoji(60), author: 'selfcheck' }, LIMITS)
held('D1a',
  emoji(60).length === 120 && codePoints(emoji(60)) === 60 && liveCount() === 2,
  'the limit counts CODE POINTS, not UTF-16 units: 60 astral code points are ' + String(emoji(60).length) + ' units and are accepted')
const beforeRefusal = ledgerDigest(thresholdRoot)
const beforeRecords = recordCount(thresholdRoot)
let tooLong = null
try { await appendNote(store, { text: body(101), author: 'selfcheck' }, LIMITS) } catch (error) { tooLong = error }
held('D2',
  tooLong !== null && String(tooLong.message).startsWith('NOTES_TOO_LONG') && ledgerDigest(thresholdRoot) === beforeRefusal && recordCount(thresholdRoot) === beforeRecords,
  '101 code points is refused by name and writes nothing: ' + JSON.stringify(tooLong === null ? null : tooLong.message.slice(0, 110)) + '; ledger ' + beforeRefusal + ' -> ' + ledgerDigest(thresholdRoot))
let astral = null
try { await appendNote(store, { text: emoji(101), author: 'selfcheck' }, LIMITS) } catch (error) { astral = error }
held('D2a',
  astral !== null && String(astral.message).startsWith('NOTES_TOO_LONG') && ledgerDigest(thresholdRoot) === beforeRefusal,
  'the pair on an astral body: 101 code points (' + String(emoji(101).length) + ' units) is refused too, and the ledger is still ' + beforeRefusal)
while (liveCount() < plugin.DEFAULT_MAX_NOTES) await appendNote(store, { text: 'note ' + String(liveCount() + 1), author: 'selfcheck' }, LIMITS)
held('D3', liveCount() === 200, 'the 200th live note is accepted, so maxNotes is inclusive too: ' + String(liveCount()) + ' live note(s)')
const fullBytes = ledgerDigest(thresholdRoot)
const fullRecords = recordCount(thresholdRoot)
let full = null
try { await appendNote(store, { text: 'note 201', author: 'selfcheck' }, LIMITS) } catch (error) { full = error }
held('D4',
  full !== null && String(full.message).startsWith('NOTES_FULL') && ledgerDigest(thresholdRoot) === fullBytes && recordCount(thresholdRoot) === fullRecords,
  'the 201st is refused by name and the ledger bytes do not move: ' + JSON.stringify(full === null ? null : full.message.slice(0, 110)) + '; ' + fullBytes + ' -> ' + ledgerDigest(thresholdRoot) + ', records ' + String(fullRecords) + ' -> ' + String(recordCount(thresholdRoot)))
const overState = notesOf(store)
await store.close()
held('D5',
  liveNotes(overState).length === 200 && overState.counts.malformed === 0,
  'the fold over the closed ledger reads ' + String(liveNotes(overState).length) + ' live note(s) and ' + String(overState.counts.malformed) + ' malformed record(s): the two refusals left no fact behind')

// ---------------------------------------------------------------- E: the render layer
const many = Array.from({ length: 201 }, (_unused, i) => fact('m-' + String(i + 1), 'body ' + String(i + 1), i + 1, 1000 + i))
const manyText = renderNotesSection(projectNotes(many), LIMITS)
const manyRows = manyText.split(NL)
held('E1',
  manyRows.includes('… (+1 older note(s) elided)') && manyRows.filter((row) => row.startsWith('- ')).length === 200
    && manyRows.includes('- body 2') && !manyRows.includes('- body 1'),
  '201 live notes render the NEWEST 200 with the elision stated, not silent: ' + String(manyRows.filter((row) => row.startsWith('- ')).length)
    + ' rows, first row ' + JSON.stringify(manyRows[2]) + ', the oldest row is gone')
const longRow = renderNotesSection(projectNotes([fact('l-1', body(101), 1, 1)]), LIMITS).split(NL)[1]
held('E2',
  longRow === '- ' + 'y'.repeat(0) + body(99) + '…' && codePoints(longRow.slice(2)) === 100
    && renderNotesSection(projectNotes([fact('l-2', body(100), 1, 1)]), LIMITS).split(NL)[1] === '- ' + body(100),
  'an over-long body is cut to exactly maxChars code points with an ellipsis in the last one, and a body of exactly maxChars is untouched: length ' + String(codePoints(longRow.slice(2))))
held('E3',
  renderNotesSection(projectNotes([fact('t-1', 'gone', 1, 1, 'deleted')]), LIMITS) === '' && renderNotesSection(projectNotes([]), LIMITS) === '',
  'a ledger of tombstones and an empty ledger both render the empty string, which is what makes an empty section free')
held('E4',
  renderNotesSection(projectNotes([fact('b-1', doubledBrace, 1, 1)]), LIMITS).includes('{{notes_that_do_not_exist}}'),
  'the render keeps a doubled brace verbatim: ' + JSON.stringify(renderNotesSection(projectNotes([fact('b-1', doubledBrace, 1, 1)]), LIMITS).slice(0, 110)))
held('E5',
  renderNotesSection(projectNotes([fact('e-1', emoji(101), 1, 1)]), LIMITS).split(NL)[1] === '- ' + Array.from(emoji(101)).slice(0, 99).join('') + '…',
  'the cut is by code points here too, so an astral body is cut between characters and not through one')

// ---------------------------------------------------------------- F: determinism
const reversed = [...many].reverse()
const shuffled = [...many].sort((left, right) => ((left.seq * 37) % 203) - ((right.seq * 37) % 203))
held('F1',
  renderNotesSection(projectNotes(reversed), LIMITS) === manyText
    && renderNotesSection(projectNotes(shuffled), LIMITS) === manyText
    && renderNotesSection(projectNotes(many), LIMITS) === manyText,
  'the same 201 facts in three arrival orders (forward, reversed, shuffled by a fixed permutation) render byte-identically: sha256 '
    + createHash('sha256').update(manyText).digest('hex').slice(0, 16) + ' over ' + String(codePoints(manyText)) + ' code point(s)')

// ---------------------------------------------------------------- G: garbage the fold must survive
const garbageRoot = mkdtempSync(join(tmpdir(), 'r186-p1-garbage-'))
worldRoots.push(garbageRoot)
mkdirSync(join(garbageRoot, 'notes'), { recursive: true })
writeFileSync(join(garbageRoot, 'notes', 'control.jsonl'), [
  JSON.stringify(fact('g-1', 'the only usable note', 1, 1)),
  JSON.stringify({ kind: 'note/state', subject: 'g-2', payload: { id: 'g-2', text: 42 }, seq: 2, at: 2 }),
  JSON.stringify({ kind: 'note/state', payload: { text: 'no id anywhere' }, seq: 3, at: 3 }),
  JSON.stringify({ kind: 'member/state', subject: 'm-1', payload: { name: 'someone' }, seq: 4, at: 4 }),
  '{ this line is not JSON at all',
].join(NL) + NL)
let garbageThrow = null
let garbageState = null
try {
  const garbageStore = openNotesStore(garbageRoot, { writer: 'selfcheck' })
  garbageState = notesOf(garbageStore)
  await garbageStore.close()
} catch (error) { garbageThrow = error }
held('G1',
  garbageThrow === null && garbageState !== null && liveNotes(garbageState).length === 1 && garbageState.counts.malformed === 2,
  'a hand-written ledger carrying payload.text = 42, a record with no id, a foreign kind and a broken line folds to '
    + String(garbageState === null ? null : liveNotes(garbageState).length) + ' live note(s) and '
    + String(garbageState === null ? null : garbageState.counts.malformed) + ' malformed, and throws nothing')
const garbageRender = garbageState === null ? null : renderNotesSection(garbageState, LIMITS)
held('G2',
  garbageRender !== null && garbageRender.includes('the only usable note')
    && garbageRender === renderNotesSection(projectNotes([fact('g-1', 'the only usable note', 1, 1)]), LIMITS),
  'the render over that ledger is total and identical to the render of the one fact that is usable: ' + JSON.stringify(garbageRender))
const garbageWorld = await mountWorld({ dir: garbageRoot }, false)
const garbageList = await run(garbageWorld, 'notes_list')
held('G3',
  garbageList.isError === false && garbageList.text.includes('unreadable record(s)'),
  'notes_list over the same ledger answers and names the unreadable records: ' + JSON.stringify(garbageList.text.split(NL)[0]))

// ---------------------------------------------------------------- H: the two tools, through the real executor
const openWorld = await mountWorld({}, false)
const surface = surfaceOf(openWorld)
held('H0', surface.includes('notes_list') && surface.includes('notes_add'), 'both tools resolve on the agent the row was applied to: ' + JSON.stringify(surface))
const listCall = await run(openWorld, 'notes_list')
held('H1',
  listCall.isError === false && openWorld.approvals.asked === 0 && listCall.text.includes('0 live note'),
  'notes_list answers through the real executor and asks nobody - this world mounts no approval service at all: ' + JSON.stringify(listCall.text.split(NL)[0]))
const inputRefusal = await run(openWorld, 'notes_list', { filter: 'anything' })
held('H6',
  inputRefusal.isError === true && inputRefusal.text.includes('NOTES_INPUT'),
  'notes_list refuses an argument it does not take instead of dropping it in silence: ' + JSON.stringify(inputRefusal.text.slice(0, 140)))
const unapproved = await run(openWorld, 'notes_add', { text: 'a note nobody can approve' })
held('H2',
  unapproved.isError === true && /requires approval/u.test(unapproved.text) && recordCount(openWorld.ledger) === 0,
  'with no approval channel the kernel refuses the call before the body runs, and the ledger stays empty: ' + JSON.stringify(unapproved.text.slice(0, 150)))
const approvalWorld = await mountWorld({}, true)
approvalWorld.approvals.answer = 'rejected'
const rejected = await run(approvalWorld, 'notes_add', { text: 'the user will say no' })
held('H3',
  rejected.isError === true && rejected.text.includes('the user rejected tool "notes_add"') && approvalWorld.approvals.asked === 1
    && recordCount(approvalWorld.ledger) === 0,
  'a rejecting answerer is asked exactly once, the kernel sentence is passed through, and nothing is written: ' + JSON.stringify(rejected.text.slice(0, 150)))
approvalWorld.approvals.answer = 'allowed-once'
const beforeApproved = ledgerDigest(approvalWorld.ledger)
const approvedRecords = recordCount(approvalWorld.ledger)
const longApproved = await run(approvalWorld, 'notes_add', { text: body(101) })
held('H4',
  longApproved.isError === true && longApproved.text.includes('NOTES_TOO_LONG') && ledgerDigest(approvalWorld.ledger) === beforeApproved
    && recordCount(approvalWorld.ledger) === approvedRecords,
  'an approved over-long body is refused at the tool boundary with the same code, and still writes nothing: ' + JSON.stringify(longApproved.text.slice(0, 130)))
const good = await run(approvalWorld, 'notes_add', { text: 'Q:/ffmpeg/ 目录', tags: ['media', 'media'], author: 'r186' })
held('H5',
  good.isError === false && recordCount(approvalWorld.ledger) === approvedRecords + 1 && good.text.includes('the notes:ledger section is now')
    && ledgerText(approvalWorld.ledger).includes('Q:/ffmpeg/ 目录'),
  'one approved call appends exactly one fact (' + String(approvedRecords) + ' -> ' + String(recordCount(approvalWorld.ledger))
    + '), the ledger bytes carry the body, and the result reports the section cost: ' + JSON.stringify(good.text.slice(0, 200)))
const reassembled = await promptOf(approvalWorld)
held('H7',
  reassembled.includes('Q:/ffmpeg/ 目录') && approvalWorld.approvals.asked === 3,
  'the same world re-assembles its prompt and the new note is in it, because the section re-reads the ledger every assembly (asks=' + String(approvalWorld.approvals.asked) + '): ' + JSON.stringify(reassembled.slice(-200)))

// ---------------------------------------------------------------- verdict
const failed = readings.filter((reading) => reading.ok === false)
console.log('== dsh-link-notes self-check' + (MUTANT === '' ? '' : ' (mutant ' + MUTANT + ')') + ' ==')
for (const reading of readings) console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
console.log('')
console.log(String(readings.length) + ' readings, ' + String(readings.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
console.log('artifact ' + ARTIFACT + ' (' + String(Buffer.byteLength(shipped, 'utf8')) + ' bytes, sha256 '
  + createHash('sha256').update(shipped).digest('hex').slice(0, 16) + '); staged ' + stagedPath)
for (const root of worldRoots) { try { rmSync(root, { recursive: true, force: true }) } catch { /* a disposable world */ } }
if (MUTANT === '') process.exit(failed.length === 0 ? 0 : 1)
const want = MUTANTS[MUTANT].expect.slice().sort()
const observed = failed.map((reading) => reading.id).sort()
const clean = JSON.stringify(want) === JSON.stringify(observed)
console.log('mutant ' + MUTANT + ': declared ' + JSON.stringify(want) + ', observed ' + JSON.stringify(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
process.exit(clean ? 0 : 1)
