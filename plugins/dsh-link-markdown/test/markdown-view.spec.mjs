/**
 * The Markdown tab type, driven directly: the shipped claim decision, the shipped registration, and
 * the shipped paging rule.
 *
 * Needs no page and no DSH. The pure modules are imported from source (`claim.ts`, `read.ts`,
 * `register.ts`, `failure.ts`, `locales.ts`) because none of them imports React, and the built
 * artifacts are read too: the host half is imported, and the browser half is run in a vm context
 * (so build first: node plugins/build.mjs; readings 25 and 29 read that bundle, not the sources).
 *
 * Checks 24-31 are R190's copy-and-icon readings. They register the dictionary into the KERNEL's own
 * `LocaleRuntime` (its built browser bundle, `core/deepseek-harness/packages/client/locale`) by running
 * this package's built `lib/client.js` over it, then read every key back in both languages; they scan
 * the client sources for words written into components, and they hold the chip glyph and the frozen
 * live marker to their measured rules.
 *
 * Two environment overrides exist for the reverse proofs, which mutate a COPY of the package:
 *   MARKDOWN_VIEW_SRC             the client directory to scan (default: this package's src/client)
 *   MARKDOWN_VIEW_KERNEL_LOCALE   the kernel's built locale bundle (default: the checkout's)
 * Passing the kernel bundle is what keeps reading 25 alive inside a copy that no longer sits at the
 * same depth as `core/`. The proofs themselves live in .tmp/p2-markdown/reverse-proof.mjs.
 *
 *   node plugins/dsh-link-markdown/test/markdown-view.spec.mjs
 */
import { MARKDOWN_KIND, MARKDOWN_PATTERNS, MARKDOWN_TAB_ID, basenameOf, fileTargetOf, isMarkdownAddress, titleFor } from '../src/client/claim.ts'
import { appendPage, documentText, readAllPages, startDocument } from '../src/client/read.ts'
import { MARKER_KEY, markdownDefinition, registerMarkdown } from '../src/client/register.ts'
import * as host from '../lib/index.js'
import { readFile } from 'node:fs/promises'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: ok === true })
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const show = (value) => JSON.stringify(value)

// ---- the claim: .md is ours, everything else is named --------------------------------------------
const MD = 'dsh-resource://file/session/s1/notes/plan.md'
const MDLONG = 'dsh-resource://file/session/s1/notes/plan.markdown'
check('1 a session .md address is claimed', isMarkdownAddress(MD) === true, show(MD))
check('2 .markdown is claimed too, and case is ignored', isMarkdownAddress(MDLONG) === true && isMarkdownAddress('dsh-resource://file/session/s1/READ.ME') === false, show([MDLONG, isMarkdownAddress('dsh-resource://file/session/s1/A.MD')]))
check('3 a .txt address is NOT claimed (paired with 1)', isMarkdownAddress('dsh-resource://file/session/s1/notes/plan.txt') === false, show(isMarkdownAddress('dsh-resource://file/session/s1/notes/plan.txt')))
check('4 a non file:// scheme is refused by name', ['sidebar://guide', 'file:///C:/x/a.md', 'dsh-resource://chat/s1/a.md'].every((address) => fileTargetOf(address).ok === false && fileTargetOf(address).reason === 'not-a-dsh-resource-file-address') && isMarkdownAddress('dsh-resource://chat/s1/a.md') === false, show(['dsh-resource://chat/s1/a.md', fileTargetOf('dsh-resource://chat/s1/a.md').reason]))
check('5 an absolute-scope address is refused by name', fileTargetOf('dsh-resource://file/absolute/home/ys/a.md').reason === 'absolute-scope-carries-no-session' && isMarkdownAddress('dsh-resource://file/absolute/home/ys/a.md') === false, show(fileTargetOf('dsh-resource://file/absolute/home/ys/a.md')))
check('6 a session address decodes to session and path', show(fileTargetOf('dsh-resource://file/session/s1/a%20b/plan.md')) === show({ ok: true, scope: 'session', sessionId: 's1', path: 'a b/plan.md' }) && titleFor(MD) === 'plan.md' && basenameOf(MD) === 'plan.md', show([fileTargetOf('dsh-resource://file/session/s1/a%20b/plan.md'), titleFor(MD)]))
check('7 the frozen spelling is the contract', MARKDOWN_KIND === 'markdown' && MARKDOWN_TAB_ID === 'dsh-link-markdown' && show([...MARKDOWN_PATTERNS]) === show(['*.md', '*.markdown']), show([MARKDOWN_KIND, MARKDOWN_TAB_ID, MARKDOWN_PATTERNS]))

// ---- the registration shape: the definition the registry receives, and the two seats -------------
function fakeHost(options = {}) {
  const seen = { definitions: [], slots: [], effects: [] }
  const host = {
    effect(callback, label) { seen.effects.push(label); return callback() },
    sidebarRightTabs: {
      register(definition) {
        if (options.failRegister === true) throw new Error(options.failRegisterWith ?? 'sidebarRight: boom')
        seen.definitions.push(definition)
        return () => {}
      },
    },
    slots: {
      inject(name, factory) { seen.slots.push(name); return factory() },
      register(registration) { seen.slots.push(registration.name + '#' + registration.key); return () => {} },
    },
  }
  return { host, seen }
}
const globals = {}
const live = fakeHost()
const dispose = registerMarkdown(live.host, { body: () => null, title: () => null, titleText: titleFor, readPage: () => {}, globals })
const definition = live.seen.definitions[0]
check('8 one definition, and it is kind markdown in the extension band', live.seen.definitions.length === 1 && definition.kind === 'markdown' && definition.priority === 'extension' && definition.id === MARKDOWN_TAB_ID && show([...definition.patterns]) === show(['*.md', '*.markdown']), show(live.seen.definitions))
check('9 the definition vetoes and titles through the shipped functions', definition.canOpen(MD) === true && definition.canOpen('dsh-resource://file/session/s1/a.txt') === false && definition.title(MD) === 'plan.md', show([definition.canOpen(MD), definition.title(MD)]))
check('10 body and title land under both real slot names, keyed by the definition id', show(live.seen.slots) === show(['sidebar.right.pane.tab', 'sidebar.right.pane.tab#dsh-link-markdown', 'sidebar.right.pane.tab.title', 'sidebar.right.pane.tab.title#dsh-link-markdown']), show(live.seen.slots))
check('11 the live marker is written on success', show(globals[MARKER_KEY]) === show({ kind: 'markdown', patterns: ['*.md', '*.markdown'], registered: true }) && globals[MARKER_KEY].registered === true, show(globals[MARKER_KEY]))
check('12 the same definition comes from the built host artifact', typeof host.isMarkdownAddress === 'function' && host.isMarkdownAddress(MD) === true && host.MARKDOWN_KIND === 'markdown' && show([...host.MARKDOWN_PATTERNS]) === show(['*.md', '*.markdown']), show([host.MARKDOWN_KIND, host.MARKDOWN_PATTERNS]))
dispose()
check('13 a taken-down registration stops claiming to be live', globals[MARKER_KEY].registered === false && globals[MARKER_KEY].disposed === true, show(globals[MARKER_KEY]))

// ---- fail-closed: a broken registration must not throw, and must say why -------------------------
const brokenGlobals = {}
const broken = fakeHost({ failRegister: true, failRegisterWith: 'sidebarRight: tab type id "dsh-link-markdown" is already registered' })
let threw = null
let brokenDispose = null
try { brokenDispose = registerMarkdown(broken.host, { body: () => null, title: () => null, titleText: titleFor, readPage: () => {}, globals: brokenGlobals }) } catch (error) { threw = error }
check('14 a failed registration does not throw', threw === null && typeof brokenDispose === 'function', show(threw === null ? 'no throw' : String(threw)))
check('15 the failure marker carries the error text verbatim', show(brokenGlobals[MARKER_KEY]) === show({ registered: false, failed: 'sidebarRight: tab type id "dsh-link-markdown" is already registered' }), show(brokenGlobals[MARKER_KEY]))

// ---- the paged read: pages become one document, and the loop always ends -------------------------
const page = (offset, text, lines, eof) => ({ ok: true, value: { offset, text, lines, eof, version: 'v1' } })
const readOf = (pages) => {
  const calls = []
  // R377: the third argument is the kernel's `range` OBJECT, not a line number. The fake used to take
  // whatever the reader sent, so a reader that sent the wrong thing stayed green; check 16b now pins the
  // shape to the kernel's own generated signature.
  return { calls, read: async (sessionId, path, range) => { calls.push([sessionId, path, range]); return pages.shift() ?? { ok: true, value: { offset: range.offset ?? 1, text: '', lines: 0, eof: true } } } }
}
const two = readOf([page(1, 'a\nb', 2, false), page(3, 'c', 1, true)])
const twoDoc = await readAllPages(two.read, MD, new AbortController().signal, () => {})
check('16 pages accumulate into one document and stop at eof', documentText(twoDoc) === 'a\nb\nc' && twoDoc.eof === true && twoDoc.pages === 2 && show(two.calls) === show([['s1', 'notes/plan.md', { offset: 1 }], ['s1', 'notes/plan.md', { offset: 3 }]]), show([documentText(twoDoc), two.calls]))

// ---- the wire shape, anchored to the kernel's own generated client, not to this file --------------
// This is the check whose ABSENCE let R377 ship: the reader sent `offset: number` where the kernel
// declares `range: WorkspaceFileRange`, and the live page refused it at the wire boundary
// ("wire field \"range\" failed boundary validation"). A fake reader in this file cannot catch that;
// the kernel's generated declaration can.
const KERNEL_REMOTE_CLIENT = 'core/deepseek-harness/packages/api/workspace-files/lib/typert.remote-client.d.ts'
const KERNEL_TYPES = 'core/deepseek-harness/packages/api/workspace-files/src/types.ts'
const remoteClientText = await readFile(new URL('../../../' + KERNEL_REMOTE_CLIENT, import.meta.url), 'utf8').catch(() => null)
const kernelTypesText = await readFile(new URL('../../../' + KERNEL_TYPES, import.meta.url), 'utf8').catch(() => null)
const declaredRead = remoteClientText === null ? null : (remoteClientText.match(/^\s*read: \((.*)\) => Promise<RemoteResult<WorkspaceFileText>>$/m)?.[1] ?? null)
const rangeInterface = kernelTypesText === null ? null : (kernelTypesText.match(/export interface WorkspaceFileRange \{([\s\S]*?)\}/)?.[1] ?? null)
check('16b the kernel really declares a range OBJECT as the third argument of workspaceFiles/read', declaredRead !== null && /range: WorkspaceFileRange/.test(declaredRead) && /\boffset\?: number\b/.test(rangeInterface ?? ''), show({ declaredRead, rangeInterface: rangeInterface === null ? null : rangeInterface.trim().slice(0, 80) }))
check('16c this reader sends exactly that shape: an object carrying a line offset', show(two.calls[0][2]) === show({ offset: 1 }) && typeof two.calls[0][2] === 'object' && typeof two.calls[0][2].offset === 'number', show(two.calls[0][2]))

const blank = readOf([page(1, 'a\n', 2, false), page(3, 'b', 1, true)])
const blankDoc = await readAllPages(blank.read, MD, new AbortController().signal, () => {})
check('17 a page ending on an empty line keeps the blank line', documentText(blankDoc) === 'a\n\nb', show(documentText(blankDoc)))

const stalled = readOf([page(1, 'a', 1, false), page(2, '', 0, false)])
const stalledDoc = await readAllPages(stalled.read, MD, new AbortController().signal, () => {})
check('18 a page that advances nothing stops by name instead of spinning', stalledDoc.failure?.code === 'page-made-no-progress' && stalled.calls.length === 2, show([stalledDoc.failure, stalled.calls.length]))

const refused = await readAllPages(async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'no such file' } }), MD, new AbortController().signal, () => {})
check('19 a settled failure is named and keeps the lines read', refused.failure?.code === 'workspace-file/not-found' && refused.failure?.message === 'no such file', show(refused.failure))

let readsForBadScope = 0
const badScope = await readAllPages(async () => { readsForBadScope += 1; return page(1, '', 0, true) }, 'dsh-resource://file/nowhere/a.md', new AbortController().signal, () => {})
check('20 an unparsable address fails by name before the first read', badScope.failure?.code === 'unknown-file-address-scope' && readsForBadScope === 0, show([badScope.failure, readsForBadScope]))

const states = []
await readAllPages(readOf([page(1, 'x', 1, true)]).read, MD, new AbortController().signal, (document) => states.push(document.pages))
check('21 every intermediate document is reported', show(states) === show([0, 1]), show(states))

// ---- the append rule, without any loop -----------------------------------------------------------
check('22 appendPage is pure and joins lines rather than page texts', documentText(appendPage(appendPage(startDocument(MD), { offset: 1, text: 'a\n', lines: 2, eof: false }), { offset: 3, text: 'b', lines: 1, eof: true })) === 'a\n\nb', show(appendPage(startDocument(MD), { offset: 1, text: 'a\n', lines: 2, eof: false })))
const built = markdownDefinition(titleFor)
check('23 the definition builder is the one registration uses', built.canOpen === isMarkdownAddress && built.title === titleFor && definition.canOpen === built.canOpen, show({ canOpen: built.canOpen === isMarkdownAddress, title: built.title === titleFor }))

// ---- the copy: one namespace, both dictionaries, and the real kernel registry -------------------
// Every word the browser half shows is a key in src/client/locales.ts. These readings are: the
// dictionary contract (one key set, twice), the registration that must really win inside the KERNEL's
// own LocaleRuntime when this package's BUILT half runs, and the scan that says no word is written
// into a component. The English that stays English is test/keep-verbatim.json: every entry must cover
// a literal here and must be named in README.md.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { REFUSAL_DISPOSITIONS } from '../src/client/claim.ts'
import { NAMED_FAILURE_CODES, failureReasonKey } from '../src/client/failure.ts'
import { NS, en, zh } from '../src/client/locales.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
/** The client half this run scans; the reverse proofs point it at a copy of the package. */
const SRC = process.env.MARKDOWN_VIEW_SRC ?? join(PACKAGE, 'src', 'client')
/** The kernel's own built locale bundle: the real registration the dictionary must win. */
const KERNEL_LOCALE = process.env.MARKDOWN_VIEW_KERNEL_LOCALE ?? resolve(PACKAGE, '../../core/deepseek-harness/packages/client/locale/lib/client.js')
const CLIENT_ARTIFACT = join(PACKAGE, 'lib', 'client.js')
const KEEP_VERBATIM = join(PACKAGE, 'test', 'keep-verbatim.json')
const README_PATH = join(PACKAGE, 'README.md')

/** Every TypeScript source under one directory, at any depth (a nested file is still this half). */
function listSources (dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { found.push(...listSources(join(dir, entry.name))); continue }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    const path = join(dir, entry.name)
    found.push({ name: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') })
  }
  return found
}
const clientSources = listSources(SRC).sort((left, right) => left.name.localeCompare(right.name))
const sourceOf = (name) => { const file = clientSources.find((entry) => entry.name === name); return file === undefined ? '' : file.text }

/**
 * Every string and template literal in one source, with the line it starts on; comments are skipped.
 * @param source - the file's text.
 * @returns the literals, in file order.
 */
function literalsOf (source) {
  const found = []
  let index = 0
  let line = 1
  while (index < source.length) {
    const here = source[index]
    if (here === '\n') { line += 1; index += 1; continue }
    if (here === '/' && source[index + 1] === '/') { while (index < source.length && source[index] !== '\n') index += 1; continue }
    if (here === '/' && source[index + 1] === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) { if (source[index] === '\n') line += 1; index += 1 }
      index += 2
      continue
    }
    if (here === '"' || here === "'" || here === '\u0060') {
      const quote = here
      const start = line
      let text = ''
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') { text += source[index + 1] === undefined ? '' : source[index + 1]; index += 2; continue }
        if (source[index] === '\n') line += 1
        text += source[index]
        index += 1
      }
      index += 1
      found.push({ text, line: start })
      continue
    }
    index += 1
  }
  return found
}

/** Whether a literal reads like something a person would see written into a component. */
function looksLikeCopy (text) {
  return /[\u4e00-\u9fff]/.test(text) || (/\s/.test(text.trim()) && /[A-Za-z]/.test(text))
}

/** One window.__ModuleLoader__.load bundle (this package's or the kernel's), run in its own context. */
function makeStub (path) {
  const fn = function () { return makeStub(path + '()') }
  return new Proxy(fn, {
    get (target, key) {
      if (key === Symbol.toPrimitive) return () => path
      if (key === Symbol.iterator) return function () { return { next: () => ({ done: true }) } }
      if (key === 'then') return undefined
      if (key === 'length') return 0
      if (key === 'name') return path
      return makeStub(path + '.' + String(key))
    },
    apply () { return makeStub(path + '()') },
    construct () { return makeStub('new ' + path) },
    has () { return true },
  })
}

function loadBundle (path) {
  const code = readFileSync(path, 'utf8')
  let captured = null
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, URLSearchParams, Date, Math, JSON,
    window: { __ModuleLoader__: { load (module) { captured = module } } },
    navigator: { languages: ['zh-CN'], language: 'zh-CN' },
    location: { href: 'http://markdown-view-spec/' },
  }
  sandbox.globalThis = sandbox
  runInContext(code, createContext(sandbox), { filename: path })
  if (captured === null) throw new Error('the bundle made no window.__ModuleLoader__.load registration: ' + path)
  return { id: captured.id, exports: captured.factory((specifier) => makeStub('require:' + String(specifier))) }
}

const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
check('24 one namespace, one key set, and a typed dictionary guard on both sides',
  NS === 'dsh-link-markdown' && zhKeys.length > 0 && show(zhKeys) === show(enKeys)
  && zhKeys.every((key) => key.includes('.') && zh[key] !== key && en[key] !== key && String(zh[key]).length > 0 && String(en[key]).length > 0)
  && sourceOf('locales.ts').includes('export type MarkdownKey = keyof typeof zh')
  && sourceOf('locales.ts').includes('satisfies Record<string, string>')
  && sourceOf('locales.ts').includes('satisfies Record<MarkdownKey, string>'),
  show({ ns: NS, keys: zhKeys.length, keySetsEqual: show(zhKeys) === show(enKeys), guard: 'satisfies on both dictionaries' }))

// The real thing: the kernel's LocaleRuntime, this package's built half driving it, one key loop.
const seats = { definitions: [], slots: [], slotInjects: [], effects: [], errors: [] }
let localeRuntime = null
let artifact = null
let artifactError = null
try {
  const kernelExports = loadBundle(KERNEL_LOCALE).exports
  localeRuntime = new kernelExports.LocaleRuntime({
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    emit: () => {},
  })
  const ctx = {}
  ctx.effect = (fn, label) => { seats.effects.push(String(label)); try { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} } catch (error) { seats.errors.push('effect ' + String(label) + ': ' + String(error && error.message ? error.message : error)); return () => {} } }
  ctx.on = () => () => {}
  ctx.get = () => undefined
  ctx.provide = () => () => {}
  ctx.reflect = { provide: () => () => {} }
  ctx.locale = localeRuntime
  ctx.remote = { workspaceFiles: { read: async () => ({ ok: true, value: { offset: 1, text: '', lines: 0, eof: true } }) } }
  ctx.sidebarRightTabs = { register: (definition) => { seats.definitions.push(definition); return () => {} } }
  ctx.slots = {
    register: (options, component) => { seats.slots.push({ options, component }); return () => {} },
    inject: (name, factory) => { seats.slotInjects.push(String(name)); try { factory() } catch (error) { seats.errors.push('inject ' + String(name) + ': ' + String(error && error.message ? error.message : error)) } return () => {} },
    registerFactory: () => () => {},
  }
  artifact = loadBundle(CLIENT_ARTIFACT)
  await artifact.exports.apply(ctx)
} catch (error) {
  artifactError = String(error && error.message ? error.message : error)
}

const t = localeRuntime === null ? null : localeRuntime.bind(NS)
const resolveMisses = (locale) => {
  if (localeRuntime === null || t === null) return ['no locale runtime']
  localeRuntime.setLocale(locale)
  const active = localeRuntime.getSnapshot().active
  const misses = zhKeys.filter((key) => t(key) !== (locale === 'zh' ? zh[key] : en[key]))
  return misses.length === 0 && active === locale ? [] : misses.concat('active=' + active)
}
const zhMisses = resolveMisses('zh')
const enMisses = resolveMisses('en')
const bodyRegistration = seats.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
const titleRegistration = seats.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab.title')
const injectNames = artifact === null || artifact.exports.inject === undefined ? [] : [...artifact.exports.inject]
check('25 the built half registers the dictionary into the kernel LocaleRuntime, and every key resolves in both languages',
  artifactError === null && seats.errors.length === 0 && artifact !== null && injectNames.includes('locale')
  && seats.effects.some((label) => label === 'dsh-link-markdown: dictionaries')
  && seats.definitions.length === 1 && seats.definitions[0].kind === 'markdown'
  && bodyRegistration !== undefined && bodyRegistration.options.locale === NS
  && titleRegistration !== undefined && titleRegistration.options.locale === undefined
  && show(seats.slotInjects) === show(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  && zhMisses.length === 0 && enMisses.length === 0,
  show({ artifactError, errors: seats.errors, inject: injectNames, effects: seats.effects, definitions: seats.definitions.map((definition) => definition.kind), slots: seats.slots.map((entry) => ({ name: entry.options.name, locale: entry.options.locale ?? null })), zhMisses, enMisses, keys: zhKeys.length }))

// The two facts the registry's own contract names: the namespace has one occupant, and a missing key
// surfaces as the key rather than as a blank.
let duplicate = null
let missingKey = null
const locales = localeRuntime === null ? [] : localeRuntime.getSnapshot().locales.map((locale) => locale.id + '->' + String(locale.fallback ?? '(terminal)'))
if (localeRuntime !== null && t !== null) {
  try { localeRuntime.register(NS, 'en', en) } catch (error) { duplicate = String(error && error.message ? error.message : error) }
  localeRuntime.setLocale('zh')
  missingKey = t('dsh-link-markdown.no.such.key')
}
check('26 the namespace is single-occupant, and an unknown key surfaces as itself',
  duplicate !== null && duplicate.includes(NS) && missingKey === 'dsh-link-markdown.no.such.key'
  && show(locales) === show(['zh->en', 'en->(terminal)']),
  show({ duplicate, missingKey, locales }))

// ---- the scan: no word is written into a component ------------------------------------------------
const dictionaryValues = new Set([...Object.values(zh), ...Object.values(en)])
const keepVerbatim = JSON.parse(readFileSync(KEEP_VERBATIM, 'utf8')).entries
const copyProblems = []
const covered = new Set()
for (const file of clientSources) {
  if (file.name === 'locales.ts') continue
  const literals = literalsOf(file.text)
  for (const literal of literals) {
    if (literal.text.trim() !== '' && dictionaryValues.has(literal.text.trim())) {
      copyProblems.push(file.name + ':' + String(literal.line) + ' writes a dictionary value into code: ' + show(literal.text))
      continue
    }
    if (!looksLikeCopy(literal.text)) continue
    const entry = keepVerbatim.find((candidate) => candidate.file === 'src/client/' + file.name && literal.text.includes(candidate.match))
    if (entry === undefined) copyProblems.push(file.name + ':' + String(literal.line) + ' reads like copy and is on no keep-verbatim entry: ' + show(literal.text))
    else covered.add(entry.id)
  }
  const jsx = file.name.endsWith('.tsx')
  for (const line of file.text.split('\n')) {
    if (jsx) for (const match of line.matchAll(/>([^<>{}]*)</g)) {
      const before = line.slice(0, match.index + 1).trimEnd()
      const after = line[match.index + match[0].length]
      // Only JSX: an arrow's '>' followed by a generic's '<' is not a text node.
      if (before.endsWith('=>') || after === undefined || /[A-Za-z/!]/.test(after) === false) continue
      if (/[A-Za-z\u4e00-\u9fff]/.test(match[1])) copyProblems.push(file.name + ' writes a bare JSX text node: ' + show(match[1].trim()))
    }
    for (const match of line.matchAll(/\b(title|aria-label|alt|placeholder)\s*=\s*"([^"]*)"/g)) {
      if (/[A-Za-z\u4e00-\u9fff]/.test(match[2])) copyProblems.push(file.name + ' writes a copy attribute literally: ' + match[1] + '="' + match[2] + '"')
    }
  }
}
for (const entry of keepVerbatim) {
  if (!covered.has(entry.id)) copyProblems.push('keep-verbatim entry covers nothing: ' + entry.id + ' (' + entry.file + ' / ' + show(entry.match) + ')')
  if (String(entry.why ?? '').length < 8) copyProblems.push('keep-verbatim entry states no reason: ' + entry.id)
}
check('27 no hardcoded copy in the client half, and every kept-English literal is named with a reason',
  copyProblems.length === 0 && keepVerbatim.length === 8,
  show({ problems: copyProblems, entries: keepVerbatim.map((entry) => entry.id) }))

// ---- the keys: asked for, and present ------------------------------------------------------------
const usedKeys = new Set()
for (const file of clientSources) for (const match of file.text.matchAll(/\bt\(\s*'([^']+)'/g)) usedKeys.add(match[1])
const unknownKeys = [...usedKeys].filter((key) => zh[key] === undefined || en[key] === undefined).sort()
const keyLiterals = new Set(clientSources.flatMap((file) => literalsOf(file.text).map((literal) => literal.text)))
const unusedKeys = zhKeys.filter((key) => !keyLiterals.has(key))
const namedCodes = new Set(NAMED_FAILURE_CODES)
const declaredCodes = new Set([...Object.values(REFUSAL_DISPOSITIONS), 'read-rejected', 'page-made-no-progress', 'unreadable-file'])
const missingReasonNames = [...declaredCodes].filter((code) => !namedCodes.has(code))
const unknownReasonNames = [...namedCodes].filter((code) => !declaredCodes.has(code))
check('28 every t() key is in both dictionaries, every dictionary key is asked for somewhere, and every named failure code has a name',
  unknownKeys.length === 0 && unusedKeys.length === 0 && usedKeys.size > 0
  && missingReasonNames.length === 0 && unknownReasonNames.length === 0
  && failureReasonKey('workspace-file/not-found') === undefined && failureReasonKey('read-rejected') !== undefined,
  show({ used: usedKeys.size, unknownKeys, unusedKeys, namedCodes: NAMED_FAILURE_CODES, missingReasonNames, unknownReasonNames }))

// ---- the artifact: what really ships -------------------------------------------------------------
const artifactText = readFileSync(CLIENT_ARTIFACT, 'utf8')
const artifactProblems = []
for (const match of artifactText.matchAll(/children:\s*"([^"]*)"/g)) {
  if (/[A-Za-z\u4e00-\u9fff]/.test(match[1])) artifactProblems.push('a built child is a literal: ' + show(match[1]))
}
for (const prop of ['copyLabel', 'copiedLabel', 'footnotes']) {
  // The dictionary tables themselves hold the same words, so the reading is the binding, not the text:
  // each chrome label the built half forwards must be a t() call.
  if (new RegExp('\\b' + prop + ':\\s*t\\(').test(artifactText) === false) artifactProblems.push('the built half binds ' + prop + ' to something other than t()')
}
for (const key of ['markdown.copy', 'markdown.copied', 'markdown.footnotes', 'body.readonly', 'empty.noAddress']) {
  if (!artifactText.includes('"' + key + '"')) artifactProblems.push('the built half never asks for ' + key)
}
check('29 the built half forwards chrome labels through t(), and no rendered child is a literal',
  artifactProblems.length === 0,
  show({ problems: artifactProblems, bytes: artifactText.length }))

// ---- the icon: a first-party glyph in the chip seat ----------------------------------------------
const iconProblems = []
const indexSource = sourceOf('index.tsx')
if (!/import \{[^}]*FileTypeIcon[^}]*\} from '@deepseek-ai\/dsh-client-ui-primitives'/.test(indexSource)) iconProblems.push('the chip glyph is not imported from the first-party client primitives package')
if (!/<FileTypeIcon[^>]*kind="markdown"[^>]*size=\{16\}[^>]*\/>/.test(indexSource)) iconProblems.push('the chip glyph is not the first-party markdown file sheet drawn at 16px')
for (const file of clientSources) {
  for (const match of file.text.matchAll(/<svg\b[^>]*>/g)) {
    const tag = match[0]
    if (!/viewBox="0 0 16 16"/.test(tag)) iconProblems.push(file.name + ' draws a self-made glyph outside a 16x16 box: ' + show(tag.slice(0, 90)))
    if (/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|url\(|Gradient/.test(tag) || /fill="(?!none|currentColor)/.test(tag)) iconProblems.push(file.name + ' draws a self-made glyph with a fixed colour or gradient: ' + show(tag.slice(0, 90)))
    const size = tag.match(/(?:width|height|size)=\{?(\d+)/)
    if (size !== null && size[1] !== '16') iconProblems.push(file.name + ' draws a self-made glyph at ' + size[1] + 'px instead of 16: ' + show(tag.slice(0, 90)))
  }
}
for (const file of clientSources) {
  if (/\.png|\.jpg|symbol-v2|linearGradient|radialGradient/.test(file.text)) iconProblems.push(file.name + ' reaches for a brand asset inside the glyph slot')
}
check('30 the chip glyph is a first-party component, and nothing here self-draws outside the measured rules',
  iconProblems.length === 0,
  show({ problems: iconProblems, glyph: 'FileTypeIcon kind="markdown" size={16} from @deepseek-ai/dsh-client-ui-primitives' }))

// ---- the frozen shape the live gates read, and the list the README must carry --------------------
const readme = readFileSync(README_PATH, 'utf8')
const readmeProblems = []
if (!readme.includes('## 文案契约与图标来源')) readmeProblems.push('README.md has no 文案契约与图标来源 section')
for (const entry of keepVerbatim) if (!readme.includes(entry.id)) readmeProblems.push('README.md never names ' + entry.id)
if (!artifactText.includes('"__dshLinkMarkdown"')) readmeProblems.push('the built half lost the live marker key')
if (!artifactText.includes('"markdown"') || !artifactText.includes('"*.markdown"')) readmeProblems.push('the built half lost the frozen kind or patterns')
check('31 the frozen live shape is intact in the built half, and the kept-English list is in the README',
  readmeProblems.length === 0 && MARKDOWN_KIND === 'markdown' && show([...MARKDOWN_PATTERNS]) === show(['*.md', '*.markdown']),
  show({ problems: readmeProblems, readmeBytes: readme.length }))

const bad = results.filter((row) => !row.ok)
console.log('')
console.log(String(results.length) + ' checks, ' + String(results.length - bad.length) + ' held, ' + String(bad.length) + ' failed')
process.exit(bad.length === 0 ? 0 : 1)
