#!/usr/bin/env node
/**
 * The toolbar entry's copy plane (R191): one namespace, two dictionaries, and no product text in the half.
 *
 *   node plugins/dsh-link-toolbar/test/toolbar-copy.spec.mjs
 *   node plugins/dsh-link-toolbar/test/toolbar-copy.spec.mjs --self-attack
 *
 * No DSH, no browser, no port. The world is three things: this package's src/client/** read as bytes,
 * this package's BUILT lib/client.js run the way the browser runs it (window.__ModuleLoader__.load),
 * and the pinned kernel's OWN built locale bundle
 * (core/deepseek-harness/packages/client/locale/lib/client.js) as the registry the built half must
 * really win inside. The copy scanner mirrors scripts/verify-client-copy-and-icons.mjs on purpose
 * (same JSX-text rule, same attribute whitelist, same copy-named rule), so these readings PREDICT the
 * gate instead of approximating it.
 *
 *   T1 the namespace      the dictionary module's NS export and the registration site name the SAME
 *                         one namespace, and there is exactly one of them.
 *   T2 the dictionaries   same key set, every value non-empty and not the bare key, placeholder names
 *                         identical per key.
 *   T3 the copy surface   every key this half can ask for - the static t() keys, every labelKey the
 *                         menu returns, every reason it can name - is in BOTH dictionaries. The keys
 *                         nothing asks for are printed as a list; a list is not a failure.
 *   T4 the real registry  the artifact took (NS, zh) and (NS, en) in the kernel's own LocaleRuntime,
 *                         every source key reads back in both languages, a second registration of the
 *                         pair is refused by the service, an unknown key surfaces as itself.
 *   T5 no copy in code    JSX text nodes, quoted named attributes, copy-named members, CJK outside the
 *                         dictionary, a dictionary value written into code, a literal that reads like
 *                         a sentence: every finding must be declared in test/keep-verbatim.json.
 *   T6 the wiring         inject names locale, the dictionaries register inside a ctx.effect with its
 *                         label, and the ONE entry this half registers still goes to the same slot at
 *                         the same priority, declaring locale: NS (which is what puts the t seat on
 *                         the component's props).
 *   T7 the glyph slots    measured, never assumed. This half fills none: no tab type, no first-party
 *                         glyph import, no foreign artwork, no self-drawn svg. That verdict is printed
 *                         NOT APPLICABLE with all four counts - it is not a pass. Put a glyph in this
 *                         half and the same reading becomes applicable and judged by the same rules.
 *   T8 kept-English       every dictionary value byte-identical in zh and en is declared, with a reason.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a premise is missing (named in the output).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
/** The project root: the tree that owns the pinned kernel this spec reads its instruments from. */
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'core', 'deepseek-harness', 'package.json')) && existsSync(join(at, 'plugins'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..', '..')
})()
const KERNEL_LOCALE = join(PROJECT, 'core', 'deepseek-harness', 'packages', 'client', 'locale', 'lib', 'client.js')
const ICON_MODULE = join(PROJECT, 'core', 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src', 'icons', 'index.tsx')
const SCRATCH = join(PROJECT, '.tmp', 'r191-p1', 'stage')
const SELF_ATTACK = process.argv.includes('--self-attack')
const EXPECTED_NS = 'dsh-link-toolbar'
const SLOT = 'conversation.session.header.actions'
const DICTIONARIES_LABEL = EXPECTED_NS + ': dictionaries'
const EXPECTED_PRIORITY = 100
const FIRST_PARTY = '@deepseek-ai/dsh-client-ui-primitives'

const show = (value) => { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text }
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)

/** Every reading the battery records; a mutant may only move the ids it declares. */
const READING_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']

function makePrinter(quiet) {
  return {
    check(id, ok, detail) {
      if (quiet === false) console.log('  ' + (ok === true ? 'ok  ' : ok === null ? 'n/a ' : 'FAIL') + '  ' + id + ' - ' + detail)
      return { id, ok: ok === true, na: ok === null, detail: String(detail) }
    },
    note(text) { if (quiet === false) console.log('      ' + text) },
  }
}

// --------------------------------------------------------------------------------------------- source
/** Source with both comment forms blanked, keeping every line number: a comment is not copy and not code. */
function blankComments(source) {
  const blocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  return blocks.split('\n').map((line) => {
    const at = line.indexOf('//')
    if (at < 0) return line
    const quotes = (line.slice(0, at).match(/['"]/g) || []).length
    return quotes % 2 === 0 ? line.slice(0, at) : line
  }).join('\n')
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** Every string, template and quoted literal in one source with its line; comments are skipped. */
function literalsOf(source) {
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
    if (here === '"' || here === "'" || here === String.fromCharCode(96)) {
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

/** Every TypeScript source under one directory, at any depth. */
function listSources(dir) {
  const out = []
  if (existsSync(dir) === false) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...listSources(path)); continue }
    if (/\.(ts|tsx)$/.test(entry.name) === false) continue
    out.push({ name: relative(dir, path).replaceAll('\\', '/'), path, text: readFileSync(path, 'utf8') })
  }
  return out.sort((left, right) => left.name.localeCompare(right.name))
}

// The three copy rules of gate 125, mirrored so this reading predicts it.
const ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'label', 'description']
const CODE_PUNCT = /[=()\[\]|;{}]/
const CODE_HEAD = /^(const|let|var|return|readonly|function|if|else|use[A-Z]|set[A-Z]|import|export|type|interface)\b/
const KEY_SHAPED = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/
const COPY_NAME = /(TITLE|LABEL|DESCRIPTION|PLACEHOLDER|CAPTION|COPY|TEXT|MESSAGE|HINT|SUBTITLE|HEADING)/i
const GLYPH_NAME = /^(Icon|GuideArtwork|PluginArtwork|FileTypeIcon|LinkIcon|ReferenceIcon|PermissionIcon|CodeFileIcon|SiteGlyph|FishLogo|BrandWordmark|Logo|Mark[A-Z])/

/** One literal, safe to put inside a RegExp source. */
function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function proseLike(raw) {
  const text = raw.trim()
  if (/[A-Za-z\u00c0-\u024f\u4e00-\u9fff]/.test(text) === false) return false
  if (text.includes('\n')) return false
  if (CODE_PUNCT.test(text)) return false
  if (CODE_HEAD.test(text)) return false
  if (text.startsWith('|') || text.startsWith(')') || text.startsWith('(') || text.startsWith(':')) return false
  return true
}

function identifierShaped(value) {
  if (KEY_SHAPED.test(value)) return true
  if (/^[a-z0-9.\-_]*$/.test(value)) return true
  return false
}

/** One import per specifier, with the names it brings in (the glyph inventory reads this). */
function importsOf(text) {
  const out = []
  for (const match of text.matchAll(/import\s+(?:type\s+)?(?:(\{[^}]*\})|([A-Za-z_$][A-Za-z0-9_$]*))\s+from\s+(['"])([^'"]+)\3/g)) {
    const names = match[1] === undefined
      ? [match[2]]
      : match[1].replace(/[{}]/g, '').split(',').map((part) => part.trim().split(/\s+as\s+/).pop().trim()).filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
    out.push({ line: lineOf(text, match.index), specifier: match[4], names })
  }
  return out
}

/**
 * The copy scanner over one client half: gate 125's three channels plus three this package needs
 * (CJK outside the dictionary, a dictionary value written into code, a literal that reads like a
 * sentence). Returns the findings, the full literal inventory, and which keep entries were used.
 */
function scanCopy(files, dictionaries, keep) {
  const findings = []
  const inventory = []
  const used = new Set()
  const dictionaryValues = new Set([...Object.values(dictionaries.zh), ...Object.values(dictionaries.en)])
  for (const file of files) {
    const isDictionary = /locales?\.tsx?$/i.test(file.name)
    const text = blankComments(file.text)
    if (isDictionary) continue
    const rel = 'src/client/' + file.name
    const declared = (literal) => {
      const entry = keep.find((candidate) => candidate.file === rel && typeof candidate.match === 'string' && literal.includes(candidate.match))
      if (entry !== undefined) used.add(entry.id)
      return entry !== undefined
    }
    const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/.exec(text)
    if (cjk !== null) findings.push({ file: rel, line: lineOf(text, cjk.index), rule: 'cjk-outside-dictionary', text: clip(cjk[0], 40) })
    if (file.name.endsWith('.tsx')) {
      for (const match of text.matchAll(/(?<![A-Za-z0-9_.)\]])(<[A-Za-z][^<>]*>)([^<>{}]+)/g)) {
        if (proseLike(match[2]) === false) continue
        const literal = match[2].trim()
        if (declared(literal)) continue
        findings.push({ file: rel, line: lineOf(text, match.index), rule: 'jsx-text', text: literal })
      }
    }
    for (const attr of ATTRS) {
      const pattern = new RegExp('\\b' + attr.replace('-', '\\-') + '\\s*=\\s*"([^"\n]*)"', 'g')
      for (const match of text.matchAll(pattern)) {
        if (/[A-Za-z\u4e00-\u9fff]/.test(match[1]) === false || identifierShaped(match[1])) continue
        if (declared(match[1])) continue
        findings.push({ file: rel, line: lineOf(text, match.index), rule: 'attr:' + attr, text: match[1] })
      }
    }
    for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(['"])([^'"\n]*)\2/g)) {
      if (COPY_NAME.test(match[1]) === false) continue
      if (/[A-Za-z\u4e00-\u9fff]/.test(match[3]) === false || identifierShaped(match[3])) continue
      if (declared(match[3])) continue
      findings.push({ file: rel, line: lineOf(text, match.index), rule: 'named-copy:' + match[1], text: match[3] })
    }
    const specifiers = new Set(importsOf(text).map((entry) => entry.specifier))
    for (const literal of literalsOf(file.text)) {
      const value = literal.text.trim()
      if (value === '' || specifiers.has(value)) continue
      inventory.push({ file: rel, line: literal.line, literal: value })
      if (/[A-Za-z]/.test(value) && /\s/.test(value) && dictionaryValues.has(value) === false) {
        if (declared(value) === false) findings.push({ file: rel, line: literal.line, rule: 'reads-like-a-sentence', text: value })
      }
    }
    // A dictionary value written anywhere in the half, quoted or not: this is the channel that catches a
    // bare JSX text node even when the tag-boundary regex above is defeated by an inline arrow in the same
    // element's props (a real limitation of the gate's srcd-text rule, mirrored here on purpose).
    for (const value of dictionaryValues) {
      if (value.length < 4 || identifierShaped(value)) continue
      const hit = new RegExp('(?<![A-Za-z0-9_])' + escapePattern(value) + '(?![A-Za-z0-9_])').exec(text)
      if (hit === null) continue
      if (declared(value)) continue
      findings.push({ file: rel, line: lineOf(text, hit.index), rule: 'dictionary-value-in-code', text: value })
    }
  }
  return { findings, inventory, used }
}

// ------------------------------------------------------------------------------------------- the half
function makeStub(path) {
  const fn = function () { return makeStub(path + '()') }
  return new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => path
      if (key === Symbol.iterator) return function () { return { next: () => ({ done: true }) } }
      if (key === 'then') return undefined
      if (key === 'length') return 0
      if (key === 'name') return path
      return makeStub(path + '.' + String(key))
    },
    apply() { return makeStub(path + '()') },
    construct() { return makeStub('new ' + path) },
    has() { return true },
  })
}

function loadBundle(path) {
  const code = readFileSync(path, 'utf8')
  let captured = null
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, URLSearchParams, Date, Math, JSON,
    window: { __ModuleLoader__: { load(module) { captured = module } } },
    navigator: { languages: ['zh-CN'], language: 'zh-CN' },
    location: { href: 'http://toolbar-copy-spec/' },
  }
  sandbox.globalThis = sandbox
  runInContext(code, createContext(sandbox), { filename: path })
  if (captured === null) throw new Error('the bundle made no window.__ModuleLoader__.load registration: ' + path)
  return { id: captured.id, exports: captured.factory((specifier) => makeStub('require:' + String(specifier))) }
}

/** The first-party glyph names the pinned kernel exports, or null when that module cannot be read. */
function firstPartyGlyphs() {
  const text = existsSync(ICON_MODULE) ? readFileSync(ICON_MODULE, 'utf8') : null
  if (text === null) return null
  const names = new Set()
  for (const match of text.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) names.add(match[1])
  return names
}

/** Whether the call now being recorded is this instrument's own occupancy probe, not the artifact's. */
let byGate = false

/**
 * Run one package root's BUILT client half against the kernel's own LocaleRuntime on a recording ctx.
 * @param root - the package root (the real one, or a staged copy).
 * @returns what the artifact did: the pairs it took, the seats it filled, and any error text.
 */
function runArtifact(root) {
  const out = {
    bundle: join(root, 'lib', 'client.js'), id: null, bytes: 0, error: null, apply: false,
    taken: [], slots: [], slotInjects: [], effects: [], definitions: [], errors: [],
    inject: null, readback: {}, occupancy: {}, unknownKey: null, locales: [],
  }
  if (existsSync(out.bundle) === false) { out.error = 'no built client half at ' + out.bundle; return out }
  if (existsSync(KERNEL_LOCALE) === false) { out.error = 'no kernel locale bundle at ' + KERNEL_LOCALE; return out }
  byGate = false
  try {
    const kernel = loadBundle(KERNEL_LOCALE)
    const runtime = new kernel.exports.LocaleRuntime({
      effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
      emit: () => {},
    })
    out.locales = runtime.getSnapshot().locales.map((entry) => entry.id)
    const original = runtime.register.bind(runtime)
    runtime.register = function (...args) {
      const result = original(...args)
      if (typeof args[1] === 'string') out.taken.push({ ns: args[0], locale: args[1], keys: Object.keys(args[2] === undefined ? {} : args[2]).length, byGate })
      else out.taken.push({ ns: args[0], locales: Object.keys(args[1] === undefined ? {} : args[1]), keys: Object.values(args[1] === undefined ? {} : args[1]).map((dict) => Object.keys(dict).length), byGate })
      return result
    }
    const ctx = {}
    ctx.effect = (fn, label) => {
      out.effects.push(String(label))
      try { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} }
      catch (error) { out.errors.push('effect ' + String(label) + ': ' + describe(error)); return () => {} }
    }
    ctx.on = () => () => {}
    ctx.get = () => undefined
    ctx.provide = () => () => {}
    ctx.reflect = { provide: () => () => {} }
    ctx.locale = runtime
    ctx.sidebarRightTabs = { register: (definition) => { out.definitions.push(definition); return () => {} } }
    ctx.slots = {
      register: (options, component) => { out.slots.push({ options, component }); return () => {} },
      inject: (name, factory) => {
        out.slotInjects.push(String(name))
        try { factory() } catch (error) { out.errors.push('slots.inject ' + String(name) + ': ' + describe(error)) }
        return () => {}
      },
      registerFactory: () => () => {},
    }
    const artifact = loadBundle(out.bundle)
    out.id = artifact.id
    out.bytes = readFileSync(out.bundle, 'utf8').length
    out.apply = typeof artifact.exports.apply === 'function'
    out.inject = artifact.exports.inject === undefined ? null : [...artifact.exports.inject]
    out.runtime = runtime
    if (out.apply === false) out.errors.push('the client half exports no apply()')
    else artifact.exports.apply(ctx)
  } catch (error) {
    out.error = describe(error)
  }
  return out
}

/** Read every source key back through the shipped translator, in both languages. */
function readBack(run, dictionaries) {
  const out = { zh: null, en: null }
  if (run.runtime === undefined) return out
  const t = run.runtime.bind(EXPECTED_NS)
  for (const pair of [['zh', dictionaries.zh], ['en', dictionaries.en]]) {
    const locale = pair[0]
    const dict = pair[1]
    const keys = Object.keys(dict)
    const misses = []
    run.runtime.setLocale(locale)
    for (const key of keys) if (String(t(key)) !== String(dict[key])) misses.push({ key, want: dict[key], got: String(t(key)) })
    out[locale] = { active: run.runtime.getSnapshot().active, checked: keys.length, misses: misses.slice(0, 6), missCount: misses.length }
  }
  return out
}

// ------------------------------------------------------------------------------------------- battery
/**
 * Judge one package root. Every reading is computed from that root's own sources, its own built
 * bundle and the pinned kernel's locale bundle, so a staged COPY can be measured by the same rules.
 * @param root - the package root to measure.
 * @param quiet - true while a self-attack mutant runs (only the moved set is printed then).
 * @returns the readings, the premises that could not be measured, and the raw world.
 */
async function battery(root, quiet) {
  const printer = makePrinter(quiet === true)
  const rows = []
  const premises = []
  const dir = join(root, 'src', 'client')
  const files = listSources(dir)
  const sourceOf = (name) => { const found = files.find((entry) => entry.name === name); return found === undefined ? '' : found.text }
  const locales = await import(pathToFileURL(join(dir, 'locales.ts')).href)
  const dictionaries = { zh: locales.zh, en: locales.en }
  const zhKeys = Object.keys(dictionaries.zh).sort()
  const enKeys = Object.keys(dictionaries.en).sort()
  const keepPath = join(root, 'test', 'keep-verbatim.json')
  const keep = existsSync(keepPath) ? JSON.parse(readFileSync(keepPath, 'utf8')).entries : []
  const run = runArtifact(root)
  if (run.error !== null) premises.push(run.error)
  const seats = run

  // ---- T1 the namespace: the module's NS export and the registration site name the same one.
  {
    const moduleNs = /export\s+const\s+NS\s*=\s*(['"])([^'"]+)\1/.exec(sourceOf('locales.ts'))
    const moduleName = moduleNs === null ? null : moduleNs[2]
    const at = /locale\s*\.\s*register\s*\(\s*(?:([A-Za-z_$][A-Za-z0-9_$]*)|(['"])([^'"]+)\2)/.exec(sourceOf('index.tsx'))
    let siteName = null
    let how = 'no locale.register( ... ) call in the registration site'
    if (at !== null) {
      if (at[3] !== undefined) { siteName = at[3]; how = 'the site names the namespace as a literal' }
      else {
        const constant = at[1]
        const declaration = files.map((file) => ({ file, match: new RegExp('(?:export\\s+)?const\\s+' + constant + '\\s*=\\s*([\'"])([^\'"]+)\\1').exec(file.text) })).find((candidate) => candidate.match !== null)
        if (declaration === undefined) { siteName = null; how = 'the constant ' + constant + ' is declared in no scanned file' }
        else { siteName = declaration.match[2]; how = 'the site passes the constant ' + constant + ' (' + declaration.file.name + ')' }
      }
    }
    const agree = moduleName !== null && siteName !== null && moduleName === siteName
    const ok = agree && locales.NS === EXPECTED_NS && moduleName === EXPECTED_NS
    printer.note('T1 channels: module NS export=' + show(moduleName) + ' in src/client/locales.ts; registration site=' + show(siteName) + ' (' + how + ')')
    rows.push(printer.check('T1', ok, 'the half declares exactly one namespace, through both channels, and it is ' + show(EXPECTED_NS) + ': module=' + show(moduleName) + ', site=' + show(siteName) + ', agree=' + String(agree)))
  }

  // ---- T2 the two dictionaries.
  {
    const missingEn = zhKeys.filter((key) => enKeys.includes(key) === false)
    const extraEn = enKeys.filter((key) => zhKeys.includes(key) === false)
    const empty = [...zhKeys, ...enKeys].filter((key, index, all) => {
      const dict = index < zhKeys.length ? dictionaries.zh : dictionaries.en
      const value = dict[key]
      return typeof value !== 'string' || value.length === 0 || value === key
    })
    const placeholders = (value) => { const found = []; for (const match of String(value).matchAll(/\{(\w+)\}/g)) found.push(match[1]); return found.join(',') }
    const mismatched = zhKeys.filter((key) => placeholders(dictionaries.zh[key]) !== placeholders(dictionaries.en[key]))
    const ok = files.length > 0 && zhKeys.length > 0 && missingEn.length === 0 && extraEn.length === 0 && empty.length === 0 && mismatched.length === 0
    printer.note('T2 keys: zh ' + String(zhKeys.length) + ' / en ' + String(enKeys.length) + '; missing from en=' + show(missingEn) + '; extra in en=' + show(extraEn) + '; empty or self-named=' + show(empty) + '; placeholder mismatch=' + show(mismatched))
    rows.push(printer.check('T2', ok, 'zh and en carry the same key set (' + String(zhKeys.length) + ' vs ' + String(enKeys.length) + '), every value is a real string different from its key, and {name} placeholders match per key'))
  }

  // ---- T3 the copy surface: everything this half can ask for is in both dictionaries.
  {
    const toolbarItems = await import(pathToFileURL(join(dir, 'toolbar-items.ts')).href)
    const states = [ {}, { 'data-dsh-link-layout': 'wide', 'data-dsh-link-notes': '9', 'data-dsh-link-glass': 'on', 'data-dsh-browser': '' }, {} ]
    const stand = (table) => ({ getAttribute: (name) => (Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null) })
    const menuKeys = []
    const reasonKeys = []
    for (const table of states) for (const item of toolbarItems.toolbarItems(stand(table))) {
      if (menuKeys.includes(item.labelKey) === false) menuKeys.push(item.labelKey)
      if (item.reason !== null) { const key = 'reason.' + item.reason; if (reasonKeys.includes(key) === false) reasonKeys.push(key) }
    }
    const staticKeys = []
    for (const file of files) for (const match of blankComments(file.text).matchAll(/\bt\(\s*'([^']+)'/g)) if (staticKeys.includes(match[1]) === false) staticKeys.push(match[1])
    const asked = [...new Set([...staticKeys, ...menuKeys, ...reasonKeys])].sort()
    const unknown = asked.filter((key) => dictionaries.zh[key] === undefined || dictionaries.en[key] === undefined)
    const notAsked = zhKeys.filter((key) => asked.includes(key) === false)
    const ok = staticKeys.length > 0 && menuKeys.length > 0 && reasonKeys.length > 0 && unknown.length === 0
    printer.note('T3 asked for: ' + String(asked.length) + ' key(s) = static t() ' + show(staticKeys.sort()) + ' + menu ' + show(menuKeys) + ' + reasons ' + show(reasonKeys) + '; unknown=' + show(unknown))
    printer.note('T3 NOT ASKED FOR BY THIS HALF (a list, not a failure): ' + show(notAsked) + ' - dictionary keys nothing in src/client/** names; pruning them is a product call, not this instrument agreement')
    rows.push(printer.check('T3', ok, 'every key this half can ask for resolves in both dictionaries: ' + String(asked.length) + ' asked, 0 unknown' + (notAsked.length === 0 ? '' : '; ' + String(notAsked.length) + ' dictionary key(s) nothing asks for are listed above')))
  }

  // ---- T4 the real registry: the artifact's own registration, read back through the service.
  {
    const readback = readBack(run, dictionaries)
    run.readback = readback
    if (run.error !== null) {
      rows.push(printer.check('T4', false, 'the built half could not be run against the kernel locale service: ' + clip(run.error, 400)))
    } else {
      const took = (locale) => run.taken.some((call) => call.byGate === false && call.ns === EXPECTED_NS && (call.locale === locale || (Array.isArray(call.locales) && call.locales.includes(locale))))
      const own = [...new Set(run.taken.filter((call) => call.byGate === false).map((call) => String(call.ns)))]
      let duplicate = null
      try {
        byGate = true
        run.runtime.register(EXPECTED_NS, 'en', dictionaries.en)
      } catch (error) { duplicate = describe(error) } finally { byGate = false }
      const t = run.runtime.bind(EXPECTED_NS)
      run.runtime.setLocale('zh')
      const unknownKey = String(t(EXPECTED_NS + '.no.such.key'))
      const cleanZh = readback.zh !== null && readback.zh.missCount === 0 && readback.zh.active === 'zh'
      const cleanEn = readback.en !== null && readback.en.missCount === 0 && readback.en.active === 'en'
      const ok = run.errors.length === 0 && took('zh') && took('en') && own.length === 1 && own[0] === EXPECTED_NS && cleanZh && cleanEn
        && duplicate !== null && duplicate.includes(EXPECTED_NS) && unknownKey === EXPECTED_NS + '.no.such.key'
      printer.note('T4 the artifact (' + String(run.bytes) + ' B, id ' + show(run.id) + ') took: ' + show(run.taken.filter((call) => call.byGate === false)))
      printer.note('T4 read back through the service own translator: zh ' + show(readback.zh === null ? null : { active: readback.zh.active, checked: readback.zh.checked, misses: readback.zh.missCount }) + ', en ' + show(readback.en === null ? null : { active: readback.en.active, checked: readback.en.checked, misses: readback.en.missCount }))
      if (readback.zh !== null && readback.zh.missCount > 0) printer.note('T4 zh misses (want -> got): ' + clip(show(readback.zh.misses), 300))
      if (readback.en !== null && readback.en.missCount > 0) printer.note('T4 en misses (want -> got): ' + clip(show(readback.en.misses), 300))
      printer.note('T4 PAIRED: registering (' + EXPECTED_NS + ', en) a second time -> ' + (duplicate === null ? 'accepted (the pair was FREE)' : 'THREW: ' + show(duplicate)))
      printer.note('T4 an unknown key surfaces as itself: ' + show(unknownKey) + '; the kernel locales on this machine: ' + show(run.locales))
      rows.push(printer.check('T4', ok, 'the built half registered its own dictionary into the kernel LocaleRuntime under ' + show(EXPECTED_NS) + ' (zh and en), every source key reads back in both languages, the pair is single-occupant, and an unknown key is not invented'))
    }
  }

  // ---- T5 no product text in the half.
  {
    const scan = scanCopy(files, dictionaries, keep)
    const keepProblems = []
    const usedIds = new Set(scan.used)
    for (const entry of keep) {
      if (typeof entry.why !== 'string' || entry.why.trim().length < 8) keepProblems.push('entry states no reason: ' + String(entry.id))
      if (typeof entry.id !== 'string' || entry.id === '') keepProblems.push('entry has no id: ' + show(entry))
      if (typeof entry.match === 'string') {
        const file = files.find((candidate) => 'src/client/' + candidate.name === entry.file)
        if (file === undefined) keepProblems.push('entry names no scanned file: ' + String(entry.id) + ' -> ' + show(entry.file))
        else {
          const count = file.text.split(entry.match).length - 1
          if (count === 0) keepProblems.push('entry anchors to a literal that is not in ' + entry.file + ': ' + String(entry.id) + ' ' + show(entry.match))
        }
      } else if (typeof entry.key !== 'string') {
        keepProblems.push('entry names neither a file+match nor a key: ' + String(entry.id))
      }
    }
    const ids = keep.map((entry) => String(entry.id))
    if (new Set(ids).size !== ids.length) keepProblems.push('two keep entries share an id')
    const ok = files.length > 0 && keep.length > 0 && scan.findings.length === 0 && keepProblems.length === 0
    printer.note('T5 scanned ' + String(files.length) + ' file(s) under src/client/**; criteria: JSX text node, quoted named attribute ' + show(ATTRS) + ', copy-named member, CJK outside the dictionary, a dictionary value written into code, a literal that reads like a sentence')
    for (const finding of scan.findings.slice(0, 12)) printer.note('T5 LEAK ' + finding.file + ':' + String(finding.line) + ' [' + finding.rule + '] ' + show(clip(finding.text, 80)))
    printer.note('T5 kept-English declarations used by a finding: ' + show([...usedIds]))
    printer.note('T5 the whole literal inventory of the chrome files (' + String(scan.inventory.length) + ' literal(s); a list, its reasons are the README table and test/keep-verbatim.json):')
    for (const item of scan.inventory) printer.note('      ' + item.file + ':' + String(item.line) + ' ' + show(clip(item.literal, 70)))
    rows.push(printer.check('T5', ok, 'no product text is written into the client half: ' + String(scan.findings.length) + ' finding(s), ' + String(keep.length) + ' keep-verbatim entr(ies) all anchored and stated'))
  }

  // ---- T6 the wiring.
  {
    const indexText = blankComments(sourceOf('index.tsx'))
    const injectMatch = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(indexText)
    const sourceInject = injectMatch === null ? [] : injectMatch[1].split(',').map((name) => name.trim().replaceAll("'", '')).filter((name) => name !== '')
    const seatLocale = /ctx\.slots\.register\(\{[^}]*\blocale:\s*NS\b/.test(indexText)
    // The namespace argument is deliberately not pinned here (an identifier or a literal both count): WHICH
    // namespace the call names is T1's reading, and this one is the wiring around it.
    const registersAsEffect = /ctx\.effect\(\s*\(\)\s*=>\s*ctx\.locale\.register\(\s*(?:[A-Za-z_$][A-Za-z0-9_$]*|'[^']*')\s*,\s*\{\s*zh,\s*en\s*\}\),\s*'([^']+)'\s*\)/.exec(indexText)
    const one = run.slots.length === 1 ? run.slots[0] : null
    const ok = files.length > 0 && sourceInject.includes('slots') && sourceInject.includes('locale') && seatLocale && registersAsEffect !== null
      && one !== null && one.options !== undefined && one.options.name === SLOT && one.options.priority === EXPECTED_PRIORITY && one.options.locale === EXPECTED_NS
      && typeof one.component === 'function' && run.slotInjects.length === 1 && run.slotInjects[0] === SLOT
      && run.effects.includes(DICTIONARIES_LABEL) && Array.isArray(run.inject) && run.inject.includes('locale') && run.errors.length === 0
    printer.note('T6 source: inject=' + show(sourceInject) + ', seat declares locale: NS=' + String(seatLocale) + ', dictionaries registered inside ctx.effect with label ' + show(registersAsEffect === null ? null : registersAsEffect[1]))
    printer.note('T6 artifact: ' + String(run.slots.length) + ' slot registration(s) ' + show(run.slots.map((entry) => ({ name: entry.options.name, priority: entry.options.priority, locale: entry.options.locale }))) + ', slotInjects ' + show(run.slotInjects) + ', effects ' + show(run.effects) + ', inject ' + show(run.inject) + ', errors ' + show(run.errors))
    rows.push(printer.check('T6', ok, 'the locale wiring: inject names locale, the dictionaries register inside a ctx.effect labelled ' + show(DICTIONARIES_LABEL) + ', and the one entry still goes to ' + show(SLOT) + ' at priority ' + String(EXPECTED_PRIORITY) + ' declaring locale: NS'))
  }

  // ---- T7 the glyph slots: measured, and named not-applicable when there is none.
  {
    const firstParty = []
    const foreign = []
    const selfDrawn = []
    for (const file of files) {
      const text = blankComments(file.text)
      for (const entry of importsOf(text)) {
        for (const imported of entry.names) {
          if (GLYPH_NAME.test(imported) === false) continue
          const used = new RegExp('\\b' + imported + '\\b').test(text.slice(text.indexOf(entry.specifier) + entry.specifier.length))
          if (entry.specifier === FIRST_PARTY) firstParty.push({ file: file.name, line: entry.line, name: imported, used })
          else foreign.push({ file: file.name, line: entry.line, name: imported, specifier: entry.specifier, used })
        }
      }
      for (const match of text.matchAll(/<svg\b/g)) {
        const start = match.index
        const end = text.indexOf('</svg>', start)
        selfDrawn.push({ file: file.name, line: lineOf(text, start), bytes: text.slice(start, end === -1 ? Math.min(text.length, start + 4000) : end + 6) })
      }
    }
    const candidates = firstParty.length + foreign.length + selfDrawn.length
    const applicable = candidates + run.definitions.length > 0
    if (applicable === false) {
      printer.note('T7 NOT APPLICABLE, NAMED. The measurements this verdict IS: tab types registered by this half = ' + String(run.definitions.length) + '; first-party glyph imports = ' + String(firstParty.length) + '; artwork-looking imports from anywhere else = ' + String(foreign.length) + '; self-drawn svg pieces = ' + String(selfDrawn.length))
      printer.note('T7 the imports this half does carry are not glyphs: ' + show(importsOf(blankComments(sourceOf('index.tsx'))).map((entry) => entry.specifier + ' -> ' + entry.names.join(','))) + ' - Menu is a menu surface, and no name above is one of the glyph names the gate counts')
      printer.note('T7 what it registers instead: ' + show(run.slots.map((entry) => entry.options.name)) + ' slot(s). THIS IS NOT A PASS: nothing above is a green claim. Put a glyph into this half and the same reading becomes applicable and judged')
      rows.push(printer.check('T7', null, 'NOT APPLICABLE for ' + EXPECTED_NS + ': its apply() registers no right-sidebar tab type and src/client/** carries no glyph at all (0 first-party glyph import, 0 foreign artwork, 0 self-drawn svg), so there is no glyph slot for the icon rule to judge'))
    } else {
      const problems = []
      const known = firstPartyGlyphs()
      for (const piece of firstParty) {
        if (known === null) problems.push('the pinned kernel icon module could not be read, so ' + piece.name + ' cannot be checked against the first-party set')
        else if (known.has(piece.name) === false) problems.push(piece.name + ' is not an export of ' + FIRST_PARTY)
        if (piece.used === false) problems.push(piece.name + ' is imported but never used in ' + piece.file)
      }
      for (const piece of foreign) if (piece.used === true) problems.push(piece.name + ' is artwork imported from ' + piece.specifier + ' rather than from ' + FIRST_PARTY)
      for (const piece of selfDrawn) {
        const tag = /<svg\b[^>]*>/.exec(piece.bytes)
        const head = tag === null ? piece.bytes : tag[0]
        if (/viewBox="0 0 16 16"/.test(head) === false) problems.push(piece.file + ':' + String(piece.line) + ' draws on a canvas that is not 0 0 16 16: ' + show(clip(head, 90)))
        if (/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|url\(|Gradient/.test(piece.bytes)) problems.push(piece.file + ':' + String(piece.line) + ' carries a fixed colour or a gradient: ' + show(clip(head, 90)))
        for (const match of piece.bytes.matchAll(/\b(fill|stroke)\s*=\s*"([^"]*)"/g)) {
          const value = match[2].trim()
          if (value === '' || value === 'none' || value === 'currentColor') continue
          problems.push(piece.file + ':' + String(piece.line) + ' sets ' + match[1] + '=' + show(value) + ' instead of riding currentColor')
        }
        for (const match of piece.bytes.matchAll(/\bstroke-?[Ww]idth\s*=\s*"([^"]*)"/g)) if (['1', '1.3'].includes(match[1]) === false) problems.push(piece.file + ':' + String(piece.line) + ' draws a stroke of ' + show(match[1]) + ', not 1 or 1.3')
        for (const match of head.matchAll(/\b(width|height)\s*=\s*"([^"]*)"/g)) if (match[2] !== '16') problems.push(piece.file + ':' + String(piece.line) + ' sizes the piece at ' + show(match[2]) + ' rather than 16')
      }
      printer.note('T7 applicable: ' + String(candidates) + ' glyph piece(s) and ' + String(run.definitions.length) + ' tab type(s); first-party ' + show(firstParty.map((piece) => piece.name)) + ', foreign ' + show(foreign.map((piece) => piece.name)) + ', self-drawn ' + String(selfDrawn.length))
      for (const problem of problems) printer.note('T7 GLYPH PROBLEM: ' + problem)
      rows.push(printer.check('T7', problems.length === 0, 'the glyph this half draws follows the measured rules (first-party set first, 16x16, currentColor, stroke 1 or 1.3): ' + String(problems.length) + ' problem(s)'))
    }
  }

  // ---- T8 the English that stays English is declared.
  {
    const identical = zhKeys.filter((key) => dictionaries.zh[key] === dictionaries.en[key])
    const declaredKeys = keep.filter((entry) => typeof entry.key === 'string')
    const missing = identical.filter((key) => declaredKeys.some((entry) => entry.key === key && String(entry.why).trim().length >= 8) === false)
    const stale = declaredKeys.filter((entry) => dictionaries.zh[entry.key] !== dictionaries.en[entry.key] || dictionaries.zh[entry.key] === undefined)
    const ok = identical.length > 0 && missing.length === 0 && stale.length === 0
    printer.note('T8 values byte-identical in zh and en (' + String(identical.length) + '): ' + show(identical.map((key) => key + ' = ' + dictionaries.zh[key])))
    printer.note('T8 declared by test/keep-verbatim.json: ' + show(declaredKeys.map((entry) => entry.key + ' (reason ' + String(String(entry.why).trim().length) + ' chars)')) + '; undeclared=' + show(missing) + '; declared but no longer identical=' + show(stale.map((entry) => entry.key)))
    rows.push(printer.check('T8', ok, 'every dictionary value that is byte-identical in zh and en is declared as kept-English with a reason: ' + String(identical.length) + ' identical, 0 undeclared, 0 stale declarations'))
  }

  return { rows, premises }
}

// -------------------------------------------------------------------------------------------------- run
const pristine = await battery(PACKAGE, false)
const rows = pristine.rows
const held = rows.filter((row) => row.ok === true).length
const failed = rows.filter((row) => row.ok === false && row.na !== true)
const notApplicable = rows.filter((row) => row.na === true)
console.log('')
console.log(String(rows.length) + ' readings, ' + String(held) + ' held, ' + String(failed.length) + ' failed, ' + String(notApplicable.length) + ' not applicable'
  + (pristine.premises.length === 0 ? '' : ', ' + String(pristine.premises.length) + ' premise(s) missing'))
for (const premise of pristine.premises) console.log('NOT MEASURED: ' + clip(premise, 300))

if (SELF_ATTACK === false) {
  process.exitCode = failed.length > 0 ? 1 : (pristine.premises.length > 0 ? 3 : 0)
} else {
  // ---------------------------------------------------------------------------- the declared mutants
  // One edit per mutant in a STAGED COPY of the package under .tmp/r191-p1/stage; each is measured by
  // the same battery, and the set that really moved must equal the set declared here. A source mutant
  // cannot move the artifact plane (the staged lib/client.js is the pristine build) and an artifact
  // mutant cannot move the source plane - each mutant below states which plane it hits, and the
  // declared sets name every reading that really moves, cross-plane effects included.
  const MUTANTS = [
    {
      name: 'zh-key-deleted',
      why: 'a key deleted from zh: the two key sets no longer match (T2), and the product still asks for that key (T3)',
      expect: ['T2', 'T3'],
      edits: [['src/client/locales.ts', "  'reason.empty-value': '已装载但未给值',\n", '']],
    },
    {
      name: 'en-key-deleted',
      why: 'the same key deleted from en only: the same two readings, from the other dictionary',
      expect: ['T2', 'T3'],
      edits: [['src/client/locales.ts', "  'reason.empty-value': 'Mounted with no value',\n", '']],
    },
    {
      name: 'copy-hardcoded-in-jsx',
      why: 'the trigger text written into the JSX instead of read from the dictionary: a bare JSX text node AND a dictionary value in code (T5)',
      expect: ['T5'],
      edits: [['src/client/index.tsx', "{t('toolbar.open')}", 'DSH LINK']],
    },
    {
      name: 'title-attribute-literal',
      why: 'the trigger hint written as a quoted title attribute: a copy attribute (T5)',
      expect: ['T5'],
      edits: [['src/client/index.tsx', "title={t('toolbar.openHint')}", 'title="Open DSH LINK status"']],
    },
    {
      name: 'unknown-t-key',
      why: 'the trigger asks for a key no dictionary carries (T3)',
      expect: ['T3'],
      edits: [['src/client/index.tsx', "t('toolbar.open')", "t('toolbar.opened')"]],
    },
    {
      name: 'namespace-renamed-at-the-site',
      why: 'the registration site names another namespace than the dictionary module exports: the two channels disagree (T1)',
      expect: ['T1'],
      edits: [['src/client/index.tsx', 'ctx.locale.register(NS, { zh, en })', "ctx.locale.register('dsh-link-toolbar-x', { zh, en })"]],
    },
    {
      name: 'registration-removed',
      why: 'the dictionary registration deleted from the source: the site channel names nothing (T1), the effect label is gone from the source wiring (T6), and the keep-verbatim entry anchored on that label no longer resolves (T5)',
      expect: ['T1', 'T5', 'T6'],
      edits: [['src/client/index.tsx', "  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries')\n", '']],
    },
    {
      name: 'inject-drops-locale',
      why: 'the locale service dropped from inject: the wiring reading reddens in the source and in the built half',
      expect: ['T6'],
      edits: [['src/client/index.tsx', "export const inject = ['slots', 'locale']", "export const inject = ['slots']"]],
    },
    {
      name: 'seat-loses-locale',
      why: 'the registration stops declaring locale: NS, so the shell would bind no t seat for the entry (T6)',
      expect: ['T6'],
      edits: [['src/client/index.tsx', 'priority: TOOLBAR_ACTIONS_PRIORITY, locale: NS', 'priority: TOOLBAR_ACTIONS_PRIORITY']],
    },
    {
      name: 'english-copied-into-zh',
      why: 'an untranslated English value copied into the zh dictionary: the identical-values rule (T8) reddens, and the pristine built half can no longer read that key back (T4)',
      expect: ['T4', 'T8'],
      edits: [['src/client/locales.ts', "  'item.notes': '便条',", "  'item.notes': 'Notes',"]],
    },
    {
      name: 'glyph-injected',
      why: 'a 36x36 fixed-colour svg put into the half: the named not-applicable icon reading becomes applicable and red (T7)',
      expect: ['T7'],
      edits: [['src/client/index.tsx', 'export const TOOLBAR_ACTIONS_PRIORITY = 100',
        'export const TOOLBAR_ACTIONS_PRIORITY = 100\n\nconst INJECTED_GLYPH = <svg width="36" height="36" viewBox="0 0 36 36" fill="#4D6BFE"><rect width="36" height="36" /></svg>']],
    },
    {
      name: 'artifact-registration-dropped',
      why: 'the BUILT half stops registering the dictionary (the artifact plane): nothing is taken in the real service (T4) and the effect label never appears (T6)',
      expect: ['T4', 'T6'],
      edits: [['lib/client.js', null, null]],
    },
  ]
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })
  let everyExact = true
  const claims = new Map(READING_IDS.map((id) => [id, []]))
  for (const mutant of MUTANTS) {
    const root = join(SCRATCH, mutant.name)
    cpSync(PACKAGE, root, { recursive: true })
    const applied = []
    let anchorMissing = null
    for (const edit of mutant.edits) {
      const path = join(root, edit[0])
      if (edit[0] === 'lib/client.js') {
        const text = readFileSync(path, 'utf8')
        const anchor = text.split('\n').find((line) => line.includes('ctx.locale.register') && line.includes('dsh-link-toolbar: dictionaries'))
        if (anchor === undefined) { anchorMissing = 'no compiled line registers the dictionaries in ' + edit[0]; continue }
        writeFileSync(path, text.split('\n').filter((line) => line !== anchor).join('\n'))
        applied.push(edit[0] + ' (one compiled line removed)')
        continue
      }
      const before = readFileSync(path, 'utf8')
      if (before.includes(edit[1]) === false) { anchorMissing = 'the anchor is not in ' + edit[0] + ': ' + show(clip(edit[1], 80)); continue }
      writeFileSync(path, before.split(edit[1]).join(edit[2]))
      applied.push(edit[0])
    }
    const attacked = await battery(root, true)
    const moved = attacked.rows.filter((row) => row.ok === false && row.na !== true).map((row) => row.id).sort()
    const declared = [...mutant.expect].sort()
    const exact = anchorMissing === null && JSON.stringify(moved) === JSON.stringify(declared) && moved.length > 0
    everyExact = everyExact && exact
    for (const id of declared) claims.get(id).push(mutant.name)
    console.log('')
    console.log('self-attack ' + mutant.name + ': ' + mutant.why)
    console.log('  instrument moved: ' + String(applied.length) + ' edit(s) in ' + show(applied) + (anchorMissing === null ? '' : '  ANCHOR MISSING: ' + anchorMissing))
    console.log('  moved (failed readings): ' + show(moved))
    console.log('  declared:                ' + show(declared) + '  exact=' + String(exact))
    for (const row of attacked.rows.filter((entry) => entry.ok === false)) console.log('  ' + row.id + ': ' + clip(row.detail, 300))
  }
  const uncovered = READING_IDS.filter((id) => claims.get(id).length === 0)
  console.log('')
  console.log('coverage matrix (reading -> mutants that declare it):')
  for (const id of READING_IDS) console.log('  ' + id + ': ' + (claims.get(id).length === 0 ? 'UNCOVERED' : claims.get(id).join(',')))
  console.log('  note: T7 is NOT APPLICABLE in the baseline on purpose (this half fills no glyph slot), so it is no green claim; the glyph mutant makes it applicable and red.')
  console.log('')
  console.log('pristine held: ' + String(failed.length === 0) + '; readings with no coverage: ' + show(uncovered) + '; every mutant moved exactly its declared set: ' + String(everyExact))
  process.exitCode = failed.length === 0 && pristine.premises.length === 0 && everyExact && uncovered.length === 0 ? 0 : 1
}
