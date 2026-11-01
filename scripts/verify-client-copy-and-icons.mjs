#!/usr/bin/env node
/**
 * Gate 125 (R190) - client-copy-and-icons: OUR OWN CLIENT COPY GOES THROUGH A LOCALE NAMESPACE, AND
 * OUR OWN TAB GLYPHS COME FROM THE FIRST-PARTY SET OR FOLLOW THE MEASURED RULES.
 *
 * Subject: the four packages this gate declares - plugins/dsh-link-panel (P1) and
 * plugins/dsh-link-markdown (P2), which fill a right-sidebar tab, plus the two halves a later reading
 * added, which declare the same locale face while filling no tab at all: plugins/dsh-theme-settings
 * (P3, R190's second reading), which fills a settings section, and plugins/dsh-link-toolbar (P4,
 * R191), which fills the conversation header's action slot through ctx.slots. Each one is judged half
 * on the BUILT half (lib/client.js, run the way the browser runs it) and half on the SOURCE half
 * (plugins/<name>/src/client/**, read as bytes with file:line). Frozen
 * interface: docs/handoff/R190-contract.md section 1 ruling 2 - our own browser halves carry no
 * product text of their own (every word comes out of a locale namespace registered through
 * ctx.locale, one namespace per package, zh and en carrying the same key set) and no brand-colour
 * artwork in a glyph slot (the first-party set first; a self-drawn piece only when nothing there
 * fits, and then 16x16, currentColor, stroke 1 or 1.3). That glyph clause is about a GLYPH SLOT, so
 * it is only measured where a half fills one: a declared half that registers no tab type and carries
 * no glyph at all has its I reading printed as NOT APPLICABLE with both measurements named - never a
 * pass, never a silent skip.
 *
 * THE WORLD, IN THREE PARTS (nothing on the live machine is touched):
 *
 *   (a) THE REAL KERNEL CLIENT LOCALE SERVICE. packages/client/locale is a client plugin; its own
 *       SHIPPED bundle (lib/client.js) is run through the browser's module-loader registration point
 *       inside a vm, and the LocaleRuntime instance its apply() provides is what every registration
 *       below lands in. The registrar is not a stub: the namespace-occupancy throw read by D is the
 *       shipped class's own message, and the values read back in D are the shipped lookup chain's own
 *       answers (namespace, then fallback locale, then the shared common namespace, then the key).
 *       The instance's register() is wrapped by a one-line recorder that calls the original, so the
 *       gate can name which (ns, locale) pair an artifact took without re-implementing the service.
 *   (b) THE REAL BROWSER MODULE LOADER. Each declared package's lib/client.js is bytes on disk: the
 *       gate installs window.__ModuleLoader__.load, runs the shipped factory with a recording ctx, and
 *       calls the artifact's own apply(). The only substitutions are the browser platform and the
 *       cordis services the half injects, and each one is NAMED where it is read: the slots seat
 *       records what a half registers in it, and the configForms seat answers a recording form whose
 *       document holds no value for that namespace yet (getSnapshot() -> { value: undefined,
 *       revision: 0 }, subscribe() never calls back, set() is counted) - the nothing-persisted state
 *       a first boot really has. A half that fails is reported by its own error text.
 *   (c) THE SOURCE PLANE. plugins/<name>/src/client/** is read as bytes for the copy and glyph
 *       readings, because that is the only plane where a hardcoded sentence and a self-drawn svg
 *       element are visible at a file:line.
 *
 * READINGS (each independently failable, or NAMED not-applicable):
 *   D1-D4  The artifact really registers ITS OWN dictionary into the real service: the recorder
 *          names the (ns, locale) pairs the artifact took, and the namespace they were taken under is
 *          the one the package's own source declares (its dictionary module's NS export, or - for a
 *          half that names the namespace at its registration site instead, which is what P3 and P4 do -
 *          the string constant that site passes); the shipped translator answers every source key with the
 *          source value in both languages, and - the paired half - a second registration of the same
 *          (ns, locale) is refused BY THE SERVICE with its own "already has locale" message (single
 *          occupant, and the artifact took exactly that one namespace).
 *   K1-K4  zh and en carry the same key set, read from the package's own dictionary module; both
 *          diffs are printed and both must be empty.
 *   C1-C4  NO product text is written into the client half: JSX text nodes and the named attribute
 *          whitelist may not carry a hardcoded sentence, and every key a t(...) call names must exist
 *          in the dictionary. A literal the package declares as kept-English (an i18n-keep marker on or
 *          above its line, or an exported keep list) is a declaration, not a leak, and the list is
 *          printed either way.
 *   I1/I2  The tab NAMES its glyph: a first-party import (@deepseek-ai/dsh-client-ui-primitives, whose
 *          name must be one of that package's own exports - the package name and the component name are
 *          both printed) or a self-drawn piece, which must then be viewBox "0 0 16 16" with stroke
 *          width 1 or 1.3.
 *   I3/I4  NOT APPLICABLE, NAMED, once per declared half that fills no glyph slot: dsh-theme-settings
 *          (I3) fills a settings section and dsh-link-toolbar (I4) fills the conversation header's
 *          action slot, and neither fills a tab - neither half's own apply() registers a right-sidebar
 *          tab type, and neither src/client/** carries a glyph whatsoever (0 first-party glyph imports,
 *          0 artwork-looking imports from anywhere else, 0 self-drawn <svg>). Nothing here is a glyph
 *          slot, so there is nothing for the I rule to judge: each reading is printed with BOTH of its
 *          own measurements - the tab types its apply() registered and the glyph inventory of its
 *          source - together with the slot that half DOES fill, it is counted as neither green nor red,
 *          and the coverage matrix names it as not a green claim. If a mutant puts a glyph into one of
 *          those halves, the same reading becomes applicable and is judged by the same rule as I1/I2 -
 *          which is what the glyph mutants below show for each of them.
 *   B1-B4  NO brand-colour piece in a glyph slot: no gradient, no fixed fill/stroke colour, and no
 *          artwork-looking component imported from outside the first-party set. A first-party import is
 *          NOT judged by SVG bytes: the kernel's own guide entries draw first-party GuideArtwork
 *          (36x36, fixed palette) in exactly this slot (packages/client/ui-primitives/src/guide-artwork.tsx,
 *          ui-sidebar-files/src/client/definition.tsx, ui-sidebar-browser/src/client/definition.tsx),
 *          so a blanket ban on non-16x16 first-party artwork would redden the kernel's own precedent.
 *   L0     THE COVERAGE LIST - printed with its own heading because IT IS NOT A PASS. Every package
 *          under plugins/ that ships a web client face is listed with its copy/key/namespace counts, one
 *          line each, classified GUARDED (this gate's declared set) or UNGUARDED (named, counted, and NOT
 *          counted as compliant). What is judged here is only the accounting: every client-half package
 *          appears exactly once, and the declared set equals the set this gate OBSERVED registering a
 *          dictionary through the real service.
 *
 * MUTANTS (--self-attack): one edit per mutant in a STAGED COPY of the declared packages, each measured
 * by the same judge: a dictionary key dropped in the source, a key dropped in the BUILT bundle, a value
 * changed in the built bundle, a registration removed, a hardcoded JSX text node, a hardcoded
 * whitelisted attribute, an unknown t() key, a declared kept-English literal (which must move nothing),
 * a brand piece injected into the glyph inventory, a first-party glyph replaced by a 36x36 fixed-fill
 * piece, and an artwork component imported from outside the first-party set. P1 and P2 carry the eleven
 * mutants each they always carried (none of them removed); P3, which has no glyph slot of its own,
 * carries twelve mutants aimed at its own faces instead: the dictionary key in its source, a key and a
 * value in its built bundle, its registration, its namespace renamed under the artifact's feet (so what
 * it registered is not what its own source declares), its dictionary module given an NS export that
 * disagrees with its own registration site, two hardcoded literals, an unknown key, a declared
 * kept-English literal, and the two glyph mutants that make its named-not-applicable I reading
 * applicable and red. P4, the R191 addition, carries seven more, each anchored on its own bytes: a zh
 * key dropped from its dictionary module, the last entry of its BUILT zh block dropped (a key whose two
 * languages carry different values, because the service's lookup chain falls from zh to en and a key
 * reading the same in both would be answered by the fallback instead), its registration removed, three
 * hardcoded-literal faces, and the artwork import from outside the first-party set that fills its glyph
 * inventory - which makes its named-not-applicable I reading applicable and red without any special case
 * in the judge. Every reading must be declared by at least one mutant, every
 * mutant's declared set must equal the set that really moved, and a reading that is not applicable in
 * the baseline is not counted as covered by anything - it is no green claim to cover.
 *
 * WHAT THIS GATE CANNOT JUDGE (named, never reported as a pass): whether the live page carries these
 * bundles or the live marker (gates 122/124 own the live client), whether the dictionaries are complete
 * (only the keys a package's own module declares are read here; a key present only inside a built bundle
 * and absent from the source module is not enumerable through the service's public face), whether a
 * declared kept-English literal is the RIGHT call (the gate only requires it to be declared), whether a
 * self-drawn glyph looks like the rest of the product, and the copy of packages this gate does not
 * declare (listed by L0, judged by nobody). Three substitutions of THIS probe are named wherever they
 * are read and are not measurements of the live client: the configForms seat is a recording stub whose
 * document holds no value for the namespace it hands out, so a declared half that reads a preference
 * sees the nothing-persisted state and never a persisted one; the slots seat records a registration
 * without mounting the component behind it; and the tab-type seat records a definition without running
 * the pane. Nor is the I3/I4 verdict a measurement of anything beyond the two counts each prints:
 * whether a half SHOULD fill a glyph slot is the Lead's call, not this gate's. Whether P4's header
 * action is ever mounted on a live page is not measured here either - gates 122/124 own the live
 * client, and this half is their negative control. The page
 * docs/dev/client-copy-and-icons.md belongs to scripts/check-protocol-page.mjs, not here.
 *
 * Exit 0 every reading held | 1 a reading failed (or a mutant's declared set did not match what moved)
 * | 3 the subject cannot be measured here: the kernel client locale bundle, the first-party icon source,
 * the declared packages or their built client halves are missing, or the probe could not run. A
 * reading that cannot be measured is never green.
 *
 * Usage: node scripts/verify-client-copy-and-icons.mjs [--self-attack] [--keep] [--subject <dir>]
 *   --subject <dir> measures plugins/<name>/* inside that tree (the dictionaries, the bundles and the
 *   sources) while the instruments stay this tree's: it is how a COPY of a declared package can be
 *   falsified without touching the delivered one.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root: the tree that owns the pinned kernel this gate reads its instruments from. */
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
/** The tree whose plugins/ are measured; the instruments (kernel locale bundle, icon set) stay this tree's. */
const SUBJECT = resolve(option('--subject', PROJECT))

/**
 * The packages this gate declares, and the face each one fills. P1 (panel) and P2 (markdown) are the
 * two R190-contract section 2 names - both fill a right-sidebar tab, so both carry a glyph slot. P3
 * (theme settings) is R190's second reading: it was already registering a locale namespace of its own
 * (settings.theme-style) with nothing guarding its keys, so it joins the declared set and is judged by
 * the same D/K/C readings; it fills a settings section rather than a tab, so its I reading is the named
 * not-applicable one above. P4 (toolbar) is R191's addition: the coverage list had already named it as
 * a half registering a locale namespace with nothing guarding its keys, and its own copy now goes
 * through the real service under its own NS, so it is judged by the same D/K/C/B readings; it fills the
 * conversation header's action slot through ctx.slots rather than a right-sidebar tab type, so its I
 * reading is the second named not-applicable verdict - decided by its own two counts, not by its face.
 */
const SUBJECTS = [
  { name: 'dsh-link-panel', id: '1', tag: 'panel', face: 'tab' },
  { name: 'dsh-link-markdown', id: '2', tag: 'markdown', face: 'tab' },
  { name: 'dsh-theme-settings', id: '3', tag: 'theme', face: 'settings-section' },
  { name: 'dsh-link-toolbar', id: '4', tag: 'toolbar', face: 'header-action' },
  { name: 'dsh-link-teams', id: '5', tag: 'teams', face: 'tab' },
  { name: 'dsh-link-collab', id: '6', tag: 'collab', face: 'settings-section' },
]
const DECLARED = SUBJECTS.map((subject) => subject.name)
const subjectOf = (name) => SUBJECTS.find((subject) => subject.name === name)
const FIRST_PARTY = '@deepseek-ai/dsh-client-ui-primitives'
const LOCALE_BUNDLE = join(KERNEL, 'packages', 'client', 'locale', 'lib', 'client.js')
const PRIMITIVES_SRC = join(KERNEL, 'packages', 'client', 'ui-primitives', 'src')
const SCRATCH_REL = join('.tmp', 'r191-g125c')
/** The readings this gate declares, in the order it judges them: five per package, then the accounting. */
const READINGS = [...SUBJECTS.flatMap((subject) => ['D', 'K', 'C', 'I', 'B'].map((letter) => letter + subject.id)), 'L0']

/** The attributes that carry user-visible text (the named whitelist of reading C). */
const ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'label', 'description']
/** Names that mean "this component draws a glyph" - what a glyph slot may be filled with. */
const GLYPH_NAME = /^(Icon|GuideArtwork|PluginArtwork|FileTypeIcon|LinkIcon|ReferenceIcon|PermissionIcon|CodeFileIcon|SiteGlyph|FishLogo|BrandWordmark|Logo|Mark[A-Z])/
/** Exported names a package may use to declare its kept-English list. */
const KEEP_EXPORT = /^(KEEP_?EN|EN_?KEEP[A-Z_]*|ENGLISH_?KEPT|KEEP_?LATIN|KEEP_?ENGLISH|KEEP_?AS_?IS)$/i
/** The source marker that declares one literal as kept English, with its reason. */
const KEEP_MARKER = /i18n-keep\s*:?\s*([^\n*]*)/i
/** The stroke widths the first-party glyph set draws with (ui-primitives/src/icons/index.tsx). */
const ALLOWED_STROKES = [1, 1.3]
/** The glyph canvas the first-party product icons draw on. */
const GLYPH_VIEWBOX = '0 0 16 16'

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const slug = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_')
const relativeTo = (root, path) => relative(root, path).replaceAll('\\', '/')
const hasLetter = (text) => /[A-Za-z\u00c0-\u024f\u4e00-\u9fff]/.test(text)
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }
const suffixOf = (name) => { const subject = subjectOf(name); return subject === undefined ? '?' : subject.id }

// ---------------------------------------------------------------------------
// Source plane: the copy scanner, the glyph scanner, and the first-party export list.
// ---------------------------------------------------------------------------
const CODE_PUNCT = /[=()\[\]|;{}]/
const CODE_HEAD = /^(const|let|var|return|readonly|function|if|else|use[A-Z]|set[A-Z]|import|export|type|interface)\b/
const KEY_SHAPED = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/
const COPY_NAME = /(TITLE|LABEL|DESCRIPTION|PLACEHOLDER|CAPTION|COPY|TEXT|MESSAGE|HINT|SUBTITLE|HEADING)/i

/** Read one UTF-8 file, or null when it is not there. */
function readText(path) { try { return readFileSync(path, 'utf8') } catch { return null } }

/** Every regular file under a directory, by extension filter. */
function walkFiles(dir, test) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walkFiles(path, test))
    else if (test(entry)) out.push(path)
  }
  return out
}

/** Blank out comments, keeping every line number: a comment is not product text and not code. */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
const lineAt = (text, index) => text.slice(0, index).split('\n').length

/** Whether a JSX text-node capture is prose rather than a fragment of code a tag boundary exposed. */
function proseLike(raw) {
  const text = raw.trim()
  if (!hasLetter(text)) return false
  if (text.includes('\n')) return false
  if (CODE_PUNCT.test(text)) return false
  if (CODE_HEAD.test(text)) return false
  if (text.startsWith('|') || text.startsWith(')') || text.startsWith('(') || text.startsWith(':')) return false
  return true
}

/** Whether a literal is shaped like an identifier or a dictionary key rather than a sentence. */
function identifierShaped(value) {
  if (KEY_SHAPED.test(value)) return true
  if (/^[a-z0-9.\-_]*$/.test(value)) return true
  return false
}

/**
 * Read one package's browser half as bytes.
 * @param root - the measured tree.
 * @param name - the package directory name.
 * @returns the files, their copy findings, their t() keys, and the kept-English declarations.
 */
function scanPackageSource(root, name) {
  const dir = join(root, 'plugins', name, 'src', 'client')
  const files = walkFiles(dir, (entry) => /\.(ts|tsx)$/.test(entry))
  const perFile = []
  const findings = []
  const keys = []
  const dynamicKeys = []
  const keepEntries = []
  const keepLiterals = new Set()
  for (const path of files) {
    const rel = relativeTo(root, path)
    const raw = readText(path)
    if (raw === null) continue
    const lines = raw.split(/\r?\n/)
    // The dictionary module is where copy is SUPPOSED to live; it is read for keys, never for leaks.
    const isDictionary = /locales?\.tsx?$/i.test(path)
    const text = blankComments(raw)
    const fileFindings = []
    let fileKeys = 0
    if (!isDictionary) {
      if (path.endsWith('.tsx')) {
        for (const match of text.matchAll(/(?<![A-Za-z0-9_.)\]])(<[A-Za-z][^<>]*>)([^<>{}]+)/g)) {
          if (!proseLike(match[2])) continue
          fileFindings.push({ line: lineAt(text, match.index), rule: 'jsx-text', text: match[2].trim() })
        }
      }
      for (const attr of ATTRS) {
        const pattern = new RegExp('\\b' + attr.replace('-', '\\-') + '\\s*=\\s*"([^"\n]*)"', 'g')
        for (const match of text.matchAll(pattern)) {
          if (!hasLetter(match[1]) || identifierShaped(match[1])) continue
          fileFindings.push({ line: lineAt(text, match.index), rule: 'attr:' + attr, text: match[1] })
        }
      }
      for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(['"])([^'"\n]*)\2/g)) {
        if (!COPY_NAME.test(match[1])) continue
        if (!hasLetter(match[3]) || identifierShaped(match[3])) continue
        fileFindings.push({ line: lineAt(text, match.index), rule: 'named-copy:' + match[1], text: match[3] })
      }
      for (const match of text.matchAll(/\bt\(\s*(['"])([^'"\n]*)\1/g)) { keys.push({ file: rel, line: lineAt(text, match.index), key: match[2] }); fileKeys += 1 }
      for (const match of text.matchAll(/\bt\(\s*\u0060/g)) dynamicKeys.push({ file: rel, line: lineAt(text, match.index) })
    }
    // The kept-English declaration: a marker on a line (or on the line above) keeps whatever literal the
    // gate would otherwise flag there, whatever markup holds it, and states its reason.
    const markerLines = []
    for (let index = 0; index < lines.length; index += 1) {
      const marker = KEEP_MARKER.exec(lines[index])
      if (marker === null) continue
      markerLines.push({ line: index + 1, reason: marker[1].trim() })
    }
    for (const finding of fileFindings) {
      const covering = markerLines.find((marker) => marker.line === finding.line || marker.line === finding.line - 1)
      if (covering === undefined) continue
      finding.declared = covering.reason
      keepLiterals.add(finding.text)
      keepEntries.push({ file: rel, line: finding.line, literal: finding.text, reason: covering.reason })
    }
    for (const finding of fileFindings) findings.push({ file: rel, ...finding })
    perFile.push({ file: rel, path, isDictionary, findings: fileFindings.length, keys: fileKeys })
  }
  // A third declaration channel: the package's own kept-English list, a JSON file whose entries carry a
  // literal and the reason it is not copy. It is a DECLARATION (printed by reading C), never a leak.
  const listFiles = walkFiles(join(root, 'plugins', name), (entry) => /keep[-_.a-z]*\.json$/i.test(entry))
  for (const path of listFiles) {
    const text = readText(path)
    if (text === null) continue
    let parsed = null
    try { parsed = JSON.parse(text) } catch { continue }
    const entries = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.entries) ? parsed.entries : []
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.match !== 'string') continue
      keepLiterals.add(entry.match)
      keepEntries.push({ file: relativeTo(root, path), line: null, literal: entry.match, reason: String(entry.why === undefined ? '' : entry.why), declaredIn: 'list' })
    }
  }
  return { dir, files, perFile, findings, keys, dynamicKeys, keepEntries, keepLiterals }
}

/** The names a module exports, read as text: one glyph set, two packaging styles. */
function exportedNamesFrom(text) {
  const names = new Set()
  for (const match of text.matchAll(/export\s+(?:const|function|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) names.add(match[1])
  for (const match of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * The first-party glyph set, read from the kernel package's own sources: the package name and the
 * component name a declared package may import (reading I), and the stroke constants its artwork uses.
 * @returns the export names, the files they were read from, the stroke constants, or why none could be read.
 */
function firstPartySet() {
  const indexPath = join(PRIMITIVES_SRC, 'index.ts')
  const indexText = readText(indexPath)
  if (indexText === null) return { error: 'the first-party package has no source index at ' + indexPath, names: new Set(), sources: [], strokes: {} }
  const names = new Set()
  const sources = [relativeTo(KERNEL, indexPath)]
  for (const name of exportedNamesFrom(indexText)) names.add(name)
  for (const match of indexText.matchAll(/export\s+(?:\*|type\s*\*)?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of (match[1] === undefined ? '' : match[1]).split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name)
    }
    if (!match[0].includes('*')) continue
    const target = join(PRIMITIVES_SRC, match[2].replace(/^\.\//, ''))
    const text = readText(target)
    if (text === null) continue
    sources.push(relativeTo(KERNEL, target))
    for (const name of exportedNamesFrom(text)) names.add(name)
  }
  const iconText = readText(join(PRIMITIVES_SRC, 'icons', 'index.tsx')) ?? ''
  const strokes = {}
  for (const match of iconText.matchAll(/export\s+const\s+(ICON_[A-Z_]*STROKE)\s*=\s*([0-9.]+)/g)) strokes[match[1]] = Number(match[2])
  return { names, sources, strokes, error: null }
}

/** Judge one self-drawn SVG block by its own bytes: the canvas, the ink, and the stroke. */
function judgeSvg(bytes) {
  const viewBox = (/viewBox\s*=\s*"([^"]*)"/.exec(bytes) ?? [null, null])[1]
  const gradient = /<(linear|radial)Gradient\b/.test(bytes) || /url\(#/.test(bytes)
  const fixedColors = []
  for (const match of bytes.matchAll(/\b(fill|stroke)\s*=\s*"([^"]*)"/g)) {
    const value = match[2].trim()
    if (value === '' || value === 'none' || value === 'currentColor') continue
    fixedColors.push(match[1] + '=' + value)
  }
  const strokeWidths = []
  for (const match of bytes.matchAll(/\bstroke-?[Ww]idth\s*=\s*"([^"]*)"/g)) strokeWidths.push(match[1])
  for (const match of bytes.matchAll(/\bstrokeWidth\s*[:=]\s*\{?([0-9.]+)\}?/g)) strokeWidths.push(match[1])
  for (const match of bytes.matchAll(/\bstrokeWidth\s*[:=]\s*\{?(ICON_[A-Z_]*STROKE)\}?/g)) strokeWidths.push(match[1])
  return { viewBox, gradient, fixedColors, strokeWidths }
}

/** The names a module imports, by specifier, with the line of the import. */
function importsOf(text) {
  const out = []
  for (const match of text.matchAll(/import\s+(?:type\s+)?(?:(\{[^}]*\})|([A-Za-z_$][A-Za-z0-9_$]*))\s+from\s+(['"])([^'"]+)\3/g)) {
    const names = match[1] === undefined
      ? [match[2]]
      : match[1].replace(/[{}]/g, '').split(',').map((part) => part.trim().split(/\s+as\s+/).pop().trim()).filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
    out.push({ line: lineAt(text, match.index), specifier: match[4], names })
  }
  return out
}

/**
 * Read the glyph inventory of one package's client half: what a glyph slot is filled with, and where
 * each piece comes from.
 * @param root - the measured tree.
 * @param name - the package directory name.
 * @returns the first-party imports, the artwork imported from anywhere else, and the self-drawn pieces.
 */
function scanGlyphs(root, name, firstParty) {
  const dir = join(root, 'plugins', name, 'src', 'client')
  const files = walkFiles(dir, (entry) => /\.(ts|tsx)$/.test(entry))
  const firstPartyImports = []
  const foreignArtwork = []
  const selfDrawn = []
  for (const path of files) {
    const rel = relativeTo(root, path)
    const raw = readText(path)
    if (raw === null) continue
    const text = blankComments(raw)
    for (const entry of importsOf(text)) {
      for (const imported of entry.names) {
        if (!GLYPH_NAME.test(imported)) continue
        const after = text.slice(text.indexOf(entry.specifier) + entry.specifier.length)
        const used = new RegExp('\\b' + imported + '\\b').test(after)
        if (entry.specifier === FIRST_PARTY) firstPartyImports.push({ file: rel, line: entry.line, name: imported, used, known: firstParty.names.has(imported) })
        else foreignArtwork.push({ file: rel, line: entry.line, name: imported, specifier: entry.specifier, used })
      }
    }
    for (const match of text.matchAll(/<svg\b/g)) {
      const start = match.index
      const end = text.indexOf('</svg>', start)
      const bytes = text.slice(start, end === -1 ? Math.min(text.length, start + 4000) : end + 6)
      selfDrawn.push({ file: rel, line: lineAt(text, start), bytes, judged: judgeSvg(bytes) })
    }
  }
  for (const path of walkFiles(dir, (entry) => /\.svg$/.test(entry))) {
    const bytes = readText(path) ?? ''
    selfDrawn.push({ file: relativeTo(root, path), line: 1, bytes, judged: judgeSvg(bytes) })
  }
  return { firstPartyImports, foreignArtwork, selfDrawn }
}

/**
 * The locale namespace a package's OWN client half declares, read on the source plane as bytes.
 *
 * Two channels, in the order a half would use them: a dictionary module that exports NS (P1/P2), or the
 * constant the half's own locale.register(<IDENT>, ...) site passes (P3 - its namespace literal lives
 * beside the registration, not in the dictionary module). The answer names the file:line it was read
 * from; the judge requires the namespace the artifact really REGISTERED to be this one, so the half
 * cannot register under a namespace its own source does not declare and still pass D.
 * @param root - the measured tree.
 * @param name - the package directory name.
 * @returns the namespace, where it was read, how, or null when the half declares none.
 */
function namespaceDeclaration(root, name) {
  const dir = join(root, "plugins", name, "src", "client")
  const files = walkFiles(dir, (entry) => /\.(ts|tsx)$/.test(entry)).map((path) => ({ path, text: blankComments(readText(path) ?? "") }))
  // Channel 1: the dictionary module own NS export (P1/P2).
  let moduleExport = null
  for (const file of files) {
    if (/locales?\.tsx?$/i.test(file.path) === false) continue
    const exported = /export\s+const\s+NS\s*=\s*(['"])([^'"]+)\1/.exec(file.text)
    if (exported === null) continue
    moduleExport = { ns: exported[2], file: relativeTo(root, file.path), line: lineAt(file.text, exported.index) }
    break
  }
  // Channel 2: the namespace the half own registration site names, by constant or by literal (P3).
  let site = null
  for (const file of files) {
    const at = /locale\s*\.\s*register\s*\(\s*(?:([A-Za-z_$][A-Za-z0-9_$]*)|(['"])([^'"]+)\2)/.exec(file.text)
    if (at === null) continue
    const line = lineAt(file.text, at.index)
    if (at[3] !== undefined) {
      site = { ns: at[3], file: relativeTo(root, file.path), line, how: "the registration site names the namespace as a string literal at " + relativeTo(root, file.path) + ":" + String(line) }
      break
    }
    const ident = at[1]
    const declaration = files.map((other) => ({ other, match: new RegExp('(?:export\\s+)?const\\s+' + ident + '\\s*=\\s*([\'"])([^\'"]+)\\1').exec(other.text) })).find((candidate) => candidate.match !== null)
    if (declaration === undefined) continue
    site = {
      ns: declaration.match[2], file: relativeTo(root, declaration.other.path), line: lineAt(declaration.other.text, declaration.match.index),
      how: "the constant " + ident + " passed to locale.register(...) at " + relativeTo(root, file.path) + ":" + String(line),
    }
    break
  }
  const named = [site, moduleExport].filter((channel) => channel !== null)
  return { ns: site !== null ? site.ns : (moduleExport === null ? null : moduleExport.ns), site, moduleExport, agree: named.length < 2 || named[0].ns === named[1].ns }
}

// ---------------------------------------------------------------------------
// The client-half probe, as the child process runs it: the real locale service, the real module
// loader, and one recording ctx per half. It lives here as one string so the harness reads in one place.
// ---------------------------------------------------------------------------
const PROBE_SOURCE = `import { createContext, runInContext } from "node:vm"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** A stub that answers every read with another stub, so a browser bundle runs unattended. */
function makeStub(path) {
  const fn = function () { return makeStub(path + "()") }
  return new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => path
      if (key === Symbol.iterator) return function () { return { next: () => ({ done: true }) } }
      if (key === "then") return undefined
      if (key === "length") return 0
      if (key === "name") return path
      return makeStub(path + "." + String(key))
    },
    apply() { return makeStub(path + "()") },
    construct() { return makeStub("new " + path) },
    has() { return true },
  })
}

/** The browser module-loader registration point, stubbed: the artifact registers itself here. */
function loadBundle(path) {
  const code = readFileSync(path, "utf8")
  let captured = null
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Math, JSON,
    URL, URLSearchParams,
    window: { __ModuleLoader__: { load(module) { captured = module } } },
    navigator: { userAgent: "gate125", language: "en", languages: ["en"] },
    location: { href: "http://gate125/" },
  }
  sandbox.globalThis = sandbox
  runInContext(code, createContext(sandbox), { filename: path })
  if (captured === null) throw new Error("no window.__ModuleLoader__.load registration in " + path)
  return captured
}

const describe = (error) => String(error && error.message ? error.message : error)

/** A recording ctx: services answer, and every registration seat keeps exactly what it is given. */
function recordingCtx(kept) {
  const ctx = {}
  ctx.effect = (fn, name) => {
    try {
      const disposer = fn()
      return typeof disposer === "function" ? disposer : () => {}
    } catch (error) {
      kept.errors.push("effect " + String(name === undefined ? "" : name) + ": " + describe(error))
      return () => {}
    }
  }
  ctx.on = () => () => {}
  ctx.get = () => undefined
  ctx.inject = (names, callback) => { try { return callback(ctx) } catch (error) { kept.errors.push("inject: " + describe(error)) } }
  ctx.provide = (name, value) => { kept.provided.push(name); if (name === "locale") kept.locale = value; return () => {} }
  ctx.reflect = { provide: (name, value) => { kept.provided.push("reflect:" + name); if (name === "locale") kept.locale = value; return () => {} } }
  // The configForms seat: a RECORDING STUB, named wherever it is read. get() hands out a form whose
  // document holds no value for that namespace yet - the nothing-persisted state a first boot really has
  // (getSnapshot() -> { value: undefined, revision: 0 }) - subscribe() never calls back, and set() is
  // counted. A half that reads a preference therefore sees "nothing stored", never a stored value.
  ctx.configForms = {
    get: (namespace) => {
      const form = { namespace: String(namespace), reads: 0, subscribes: 0, sets: 0 }
      kept.forms.push(form)
      return {
        getSnapshot: () => { form.reads += 1; return { value: undefined, revision: 0 } },
        subscribe: () => { form.subscribes += 1; return () => {} },
        set: () => { form.sets += 1; return undefined },
      }
    },
    developerTools: { enabled: false },
  }
  ctx.sidebarRightTabs = { register: (definition) => { kept.definitions.push(definition); return () => {} } }
  ctx.slots = {
    installLocale: (value) => { kept.locale = value; return () => {} },
    inject: (name, callback) => { kept.slotInjects.push(String(name)); try { callback() } catch (error) { kept.errors.push("slots.inject " + String(name) + ": " + describe(error)) } return () => {} },
    register: (a, b) => { kept.slots.push({ name: typeof a === "string" ? a : a && a.name, key: typeof a === "string" ? b : a && a.key }); return () => {} },
    registerFactory: () => () => {},
  }
  return new Proxy(ctx, { get(target, key) { if (key in target) return target[key]; return makeStub("ctx." + String(key)) } })
}

const input = JSON.parse(readFileSync(process.argv[2], "utf8"))
const out = { ok: false, why: null, service: null, packages: {} }

try {
  // (a) the real kernel client locale service, through its own shipped bundle.
  const localeModule = loadBundle(input.localeBundle)
  const rootKept = { errors: [], provided: [], definitions: [], slots: [], slotInjects: [], forms: [], locale: null }
  const rootExports = localeModule.factory((specifier) => makeStub("require:" + String(specifier)))
  await rootExports.apply(recordingCtx(rootKept))
  const runtime = rootKept.locale
  if (runtime === null || runtime === undefined) throw new Error("the kernel locale bundle provided no locale service")
  out.service = {
    id: localeModule.id,
    exports: Object.keys(rootExports),
    class: runtime.constructor === undefined ? null : runtime.constructor.name,
    locales: runtime.getSnapshot().locales.map((entry) => entry.id),
    errors: rootKept.errors,
  }
  // One-line recorder on the SHIPPED instance: the original does the work, the gate learns who took what.
  const original = runtime.register.bind(runtime)
  const calls = []
  let byGate = false
  runtime.register = function (...args) {
    const result = original(...args)
    const entry = { ns: args[0], byGate }
    if (typeof args[1] === "string") { entry.locale = args[1]; entry.keys = Object.keys(args[2] === undefined ? {} : args[2]).length }
    else { entry.locales = Object.keys(args[1]); entry.keys = Object.values(args[1]).map((dict) => Object.keys(dict).length) }
    calls.push(entry)
    return result
  }

  for (const subject of input.packages) {
    const kept = { errors: [], provided: [], definitions: [], slots: [], slotInjects: [], forms: [], locale: null }
    const entry = { name: subject.name, bundle: subject.bundle, locales: null, ns: null, definitions: [], slots: [], slotInjects: [], forms: [], errors: [], registered: [], occupancy: {}, readback: {}, apply: false }
    // The dictionary module the package's own source declares: read through the TypeScript loader.
    if (subject.locales !== null) {
      try {
        const module = await import(pathToFileURL(subject.locales).href)
        entry.locales = {
          present: true,
          path: subject.locales,
          NS: typeof module.NS === "string" ? module.NS : null,
          zh: module.zh === null || typeof module.zh !== "object" ? null : module.zh,
          en: module.en === null || typeof module.en !== "object" ? null : module.en,
          keep: Object.entries(module).filter((pair) => /^(KEEP_?EN|EN_?KEEP[A-Z_]*|ENGLISH_?KEPT|KEEP_?LATIN|KEEP_?ENGLISH)$/i.test(pair[0])).map((pair) => ({ name: pair[0], literals: Array.isArray(pair[1]) ? pair[1] : (pair[1] !== null && typeof pair[1] === "object" ? Object.keys(pair[1]) : []) })),
        }
      } catch (error) {
        entry.locales = { present: false, path: subject.locales, error: describe(error) }
      }
    } else {
      entry.locales = { present: false, path: null, error: "the gate found no locales module in this package client sources" }
    }
    // (b) the artifact itself, on the recording ctx, with the REAL service on ctx.locale.
    try {
      const module = loadBundle(subject.bundle)
      const exported = module.factory((specifier) => makeStub("require:" + String(specifier)))
      entry.id = module.id
      entry.bytes = readFileSync(subject.bundle, "utf8").length
      entry.hasApply = typeof exported.apply === "function"
      const ctx = recordingCtx(kept)
      ctx.locale = runtime
      calls.length = 0
      if (entry.hasApply) {
        try { exported.apply(ctx) } catch (error) { kept.errors.push("apply threw: " + describe(error)) }
      } else {
        kept.errors.push("the client half exports no apply()")
      }
      entry.apply = entry.hasApply && kept.errors.length === 0
      entry.registered = calls.map((call) => Object.assign({}, call))
      entry.definitions = kept.definitions.map((definition) => ({
        id: definition.id, kind: definition.kind, priority: definition.priority,
        title: typeof definition.title, patterns: definition.patterns === undefined ? null : [...definition.patterns],
        guide: definition.guide === undefined || definition.guide === null ? null
          : definition.guide.map((item) => ({ id: item.id, order: item.order, title: typeof item.title, description: typeof item.description, icon: item.icon === undefined || item.icon === null ? null : typeof item.icon })),
      }))
      entry.slots = kept.slots
      entry.slotInjects = kept.slotInjects
      entry.forms = kept.forms
      entry.errors = kept.errors
      entry.provided = kept.provided
    } catch (error) {
      entry.error = describe(error)
      entry.errors = kept.errors
    }
    // The values the SHIPPED translator answers, in both languages, for every key the source declares.
    const dictionary = entry.locales !== null && entry.locales.present === true ? entry.locales : null
    // The namespace the half's OWN source declares: its dictionary module's NS export, or - for a half
    // that names the namespace at its registration site instead, which is what P3 does - the constant
    // that site passes. The judge is the one that requires the artifact to have registered THIS one.
    const declared = subject.declaredNs === undefined || subject.declaredNs === null ? null : subject.declaredNs.ns
    const ns = declared !== null ? declared : (dictionary === null ? null : dictionary.NS)
    entry.ns = { fromModule: dictionary === null ? null : dictionary.NS, fromSourcePlane: declared, used: ns }
    if (dictionary !== null && ns !== null && dictionary.zh !== null && dictionary.en !== null) {
      const t = runtime.bind(ns)
      for (const pair of [["zh", dictionary.zh], ["en", dictionary.en]]) {
        runtime.setLocale(pair[0])
        const mismatches = []
        for (const key of Object.keys(pair[1])) {
          const got = String(t(key))
          if (got !== pair[1][key]) mismatches.push({ key, want: pair[1][key], got })
        }
        entry.readback[pair[0]] = { active: runtime.getSnapshot().active, checked: Object.keys(pair[1]).length, mismatches: mismatches.slice(0, 8), mismatchCount: mismatches.length }
      }
      // The paired half: the same (ns, locale) again must be refused by the SERVICE, by name.
      for (const pair of [["zh", dictionary.zh], ["en", dictionary.en]]) {
        byGate = true
        try {
          runtime.register(ns, pair[0], pair[1])
          entry.occupancy[pair[0]] = { threw: false, message: null }
        } catch (error) {
          entry.occupancy[pair[0]] = { threw: true, message: describe(error) }
        }
        byGate = false
      }
    }
    out.packages[subject.name] = entry
  }
  out.ok = true
} catch (error) {
  out.why = describe(error)
}
console.log("@@GATE125@@" + JSON.stringify(out))
`

// ---------------------------------------------------------------------------
// The world: the declared packages, the real instruments, and the probe's answers.
// ---------------------------------------------------------------------------
/** Read one package manifest. */
function readManifest(root, name) {
  const dir = join(root, 'plugins', name)
  const path = join(dir, 'package.json')
  const text = readText(path)
  if (text === null) return { name, dir, path, exists: false, json: null, error: 'no package.json at ' + path }
  try { return { name, dir, path, exists: true, json: JSON.parse(text), error: null } }
  catch (error) { return { name, dir, path, exists: true, json: null, error: describe(error) } }
}

/** The relative client bundle a manifest exports, or null. */
function clientExportOf(manifest) {
  const exports = manifest.json === null || manifest.json === undefined ? undefined : manifest.json.exports
  if (exports === null || exports === undefined) return null
  const entry = exports['./client']
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object' && typeof entry.default === 'string') return entry.default
  return null
}

/** The built client half a package's own manifest exports, or the conventional path when it names none. */
function bundleOf(root, name) {
  const manifest = readManifest(root, name)
  const relativeBundle = manifest.json === null ? null : clientExportOf(manifest)
  return relativeBundle === null ? join(manifest.dir, 'lib', 'client.js') : join(manifest.dir, relativeBundle)
}

/** Every package under plugins/ that ships a web client face, with the counts reading L0 prints. */
function clientFacePackages(root) {
  const out = []
  const plugins = join(root, 'plugins')
  if (!existsSync(plugins)) return out
  for (const entry of readdirSync(plugins)) {
    const manifest = readManifest(root, entry)
    if (!manifest.exists || manifest.json === null) continue
    const client = manifest.json.dsh === undefined ? undefined : manifest.json.dsh.client
    if (client === null || typeof client !== 'object' || client.platform !== 'web') continue
    const source = scanPackageSource(root, entry)
    const relativeBundle = clientExportOf(manifest)
    const bundle = relativeBundle === null ? null : join(manifest.dir, relativeBundle)
    const sourceText = source.perFile.map((file) => readText(file.path) ?? '').join('\n')
    out.push({
      name: entry, declared: DECLARED.includes(entry), manifest, bundle,
      bundleExists: bundle !== null && existsSync(bundle),
      sourceFiles: source.files.length,
      findings: source.findings.length,
      keys: source.keys.length,
      registersNamespace: /locale\s*\.\s*register\s*\(/.test(sourceText),
      registersTabType: /sidebarRightTabs\s*\.\s*register\s*\(/.test(sourceText),
      hasDictionary: source.files.some((path) => /locales?\.tsx?$/i.test(path)),
    })
  }
  return out.sort((left, right) => left.name.localeCompare(right.name))
}

/** The probe input: the real service, and one built half plus one dictionary module per package. */
function runProbe(runDir, subjects) {
  if (!existsSync(LOCALE_BUNDLE)) return { error: 'the kernel client locale bundle is not on this machine: ' + LOCALE_BUNDLE, value: null }
  const probePath = join(runDir, 'client-probe.mjs')
  const inputPath = join(runDir, 'client-probe.json')
  writeFileSync(probePath, PROBE_SOURCE + '\n')
  writeFileSync(inputPath, JSON.stringify({ localeBundle: LOCALE_BUNDLE, packages: subjects }, null, 1))
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx/esm', probePath, inputPath], { cwd: KERNEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('@@GATE125@@'))
    if (line === undefined) return { error: 'the client-half probe printed no result line', value: null }
    return { error: null, value: JSON.parse(line.slice('@@GATE125@@'.length)) }
  } catch (error) {
    return { error: 'the client-half probe failed: ' + describe(error) + ' ' + clip(String(error.stderr === undefined ? '' : error.stderr).trim(), 400), value: null }
  }
}

async function buildWorld(root, runDir) {
  const world = { root, runDir, fatal: null, missing: [], manifest: {}, source: {}, glyphs: {}, namespace: {}, firstParty: null, probe: null, inventory: [], subjects: [] }
  world.firstParty = firstPartySet()
  for (const name of DECLARED) {
    world.manifest[name] = readManifest(root, name)
    world.source[name] = scanPackageSource(root, name)
    world.glyphs[name] = scanGlyphs(root, name, world.firstParty.error === null ? world.firstParty : { names: new Set() })
    world.namespace[name] = namespaceDeclaration(root, name)
    const manifest = world.manifest[name]
    const bundle = bundleOf(root, name)
    const dictionary = join(manifest.dir, 'src', 'client', 'locales.ts')
    world.subjects.push({ name, bundle, locales: existsSync(dictionary) ? dictionary : null, declaredNs: world.namespace[name] })
    if (!manifest.exists) world.missing.push(manifest.path)
    else if (!existsSync(bundle)) world.missing.push(bundle)
  }
  world.inventory = clientFacePackages(root)
  if (world.missing.length > 0) { world.fatal = 'the built half of a declared package is missing, so nothing about the delivered dictionary can be measured: ' + world.missing.join(', ') + ' - run: node plugins/build.mjs'; return world }
  if (world.firstParty.error !== null) { world.fatal = world.firstParty.error; return world }
  if (!existsSync(LOCALE_BUNDLE)) { world.fatal = 'the kernel client locale bundle is not on this machine: ' + LOCALE_BUNDLE; return world }
  const probe = runProbe(runDir, world.subjects)
  world.probe = probe.error === null ? probe.value : { ok: false, why: probe.error, packages: {}, service: null }
  return world
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------
function judge(world) {
  const out = []
  // ok is true (green), false (red) or null (NOT APPLICABLE: a reading this subject has nothing to
  // judge - it is printed with its own named measurements, and it is no green claim anywhere below).
  const add = (id, ok, detail, evidence) => out.push({ id, ok, state: ok === true ? 'green' : ok === false ? 'red' : 'n/a', detail, evidence: evidence === undefined ? [] : evidence })
  const probe = world.probe
  const serviceLine = probe === null || probe.service === null || probe.service === undefined
    ? 'the real kernel client locale service did not run'
    : 'the real service: ' + LOCALE_BUNDLE + ' as ' + show(probe.service.id) + ', class ' + show(probe.service.class) + ', locales ' + show(probe.service.locales) + ', exports ' + show(probe.service.exports)

  for (const name of DECLARED) {
    const id = suffixOf(name)
    const entry = probe === null || probe.packages === undefined ? null : probe.packages[name]
    const dictionary = entry === null || entry === undefined ? null : entry.locales
    const source = world.source[name]

    // D -- the dictionary really registered, and the pair is really taken.
    {
      const rows = [serviceLine]
      let ok = probe !== null && probe.ok === true && entry !== null && entry !== undefined
      if (!ok) {
        rows.push('the probe did not answer for this package: ' + clip(probe === null ? 'not run' : (entry === undefined || entry === null ? 'no answer' : probe.why), 400))
      } else {
        const declared = world.namespace === undefined || world.namespace[name] === undefined ? null : world.namespace[name]
        const declaredNs = declared === null ? null : declared.ns
        const defined = dictionary !== null && dictionary.present === true
        const fromModule = defined ? dictionary.NS : null
        const NS = declaredNs !== null ? declaredNs : fromModule
        // The two channels the half declares the namespace through must name the SAME one, and the
        // artifact must have registered exactly that: a namespace the half registers but its own source
        // never names, or two of its own declarations disagreeing, is a red D - never a silent pass.
        const nsAgree = declared !== null && declared.agree === true && (fromModule === null || declaredNs === null || fromModule === declaredNs)
        const zhKeys = defined && dictionary.zh !== null ? Object.keys(dictionary.zh) : []
        const enKeys = defined && dictionary.en !== null ? Object.keys(dictionary.en) : []
        rows.push('the dictionary module: ' + show(dictionary === null ? null : dictionary.path) + ' declares NS=' + show(fromModule) + ', zh=' + String(zhKeys.length) + ' key(s), en=' + String(enKeys.length) + ' key(s)' + (defined ? '' : ' - NOT THERE: ' + clip(dictionary === null ? 'no locales module' : String(dictionary.error), 200)))
        rows.push('the namespace the half OWN SOURCE declares: ' + (declared === null ? 'NONE - neither a registration site nor an NS export names one, so nothing here says which namespace this half was supposed to take' : show(declaredNs)))
        rows.push('    channel 1, the registration site (read as bytes): ' + show(declared === null || declared.site === null ? null : declared.site.ns + ' at ' + declared.site.file + ':' + String(declared.site.line)) + (declared === null || declared.site === null ? '' : ' - ' + declared.site.how))
        rows.push('    channel 2, the dictionary module NS export (read through the loader): ' + show(fromModule) + (declared === null || declared.moduleExport === null ? '' : ' at ' + declared.moduleExport.file + ':' + String(declared.moduleExport.line)))
        rows.push('    the two channels agree: ' + show(nsAgree) + (nsAgree ? '' : '  <-- THE HALF NAMES TWO NAMESPACES, OR THE MODULE DISAGREES WITH THE SITE'))
        rows.push('the artifact ' + show(entry.bundle) + ' (' + String(entry.bytes === undefined ? 0 : entry.bytes) + ' B) ran as ' + show(entry.id) + ', apply()=' + show(entry.hasApply) + ', errors=' + show(entry.errors))
        rows.push('the (ns, locale) pairs THE ARTIFACT took, read off the shipped registrar: ' + show(entry.registered))
        const registered = Array.isArray(entry.registered) ? entry.registered : []
        const took = (locale) => registered.some((call) => call.byGate === false && call.ns === NS && (call.locale === locale || (Array.isArray(call.locales) && call.locales.includes(locale))))
        const tookZh = took('zh')
        const tookEn = took('en')
        const ownNs = [...new Set(registered.filter((call) => call.byGate === false).map((call) => String(call.ns)))]
        const oneOwnNs = ownNs.length === 1 && ownNs[0] === NS
        rows.push('the namespace(s) the artifact itself registered under: ' + show(ownNs) + ' - the one namespace this half own source declares is ' + show(NS) + ': ' + show(oneOwnNs))
        rows.push('the artifact itself took (NS, zh)=' + show(tookZh) + ' and (NS, en)=' + show(tookEn) + ' with NS=' + show(NS) + (declaredNs !== null ? ' (named by the half own registration site)' : ' (the dictionary module own NS export)'))
        if (entry.forms !== undefined && entry.forms.length > 0) rows.push('the configForms seat (a RECORDING STUB, not the live document): ' + show(entry.forms) + ' - the form it handed out answers getSnapshot() with { value: undefined, revision: 0 }, so a preference read here sees nothing-persisted, never a stored value')
        for (const locale of ['zh', 'en']) {
          const readback = entry.readback === undefined ? undefined : entry.readback[locale]
          rows.push('read back through the service own translator, active ' + show(locale) + ': ' + show(readback === undefined ? null : { active: readback.active, checked: readback.checked, mismatchCount: readback.mismatchCount }))
          if (readback !== undefined && readback.mismatchCount > 0) rows.push('    the first mismatches (want -> got): ' + clip(show(readback.mismatches), 400))
        }
        const occupancy = entry.occupancy === undefined ? {} : entry.occupancy
        for (const locale of ['zh', 'en']) {
          const refused = occupancy[locale]
          rows.push('PAIRED: registering (' + show(NS) + ', ' + show(locale) + ') a second time -> ' + (refused === undefined ? 'not measured' : refused.threw === true ? 'THREW: ' + show(refused.message) : 'accepted (the pair was FREE: this artifact had taken nothing)'))
        }
        const refusedBoth = occupancy.zh !== undefined && occupancy.zh.threw === true && occupancy.en !== undefined && occupancy.en.threw === true
        const cleanReadback = entry.readback !== undefined && entry.readback.zh !== undefined && entry.readback.zh.mismatchCount === 0 && entry.readback.en !== undefined && entry.readback.en.mismatchCount === 0
        ok = defined && NS !== null && nsAgree && oneOwnNs && entry.apply === true && tookZh && tookEn && cleanReadback && refusedBoth
      }
      add('D' + id, ok, 'the artifact registers its own ' + show(name) + ' dictionary into the real kernel locale service under the one namespace its own source declares, the shipped translator answers every source key with the source value in both languages, and a second registration of the same (ns, locale) is refused by the service', rows)
    }

    // K -- zh and en carry the same key set.
    {
      const rows = []
      let ok = dictionary !== null && dictionary !== undefined && dictionary.present === true && dictionary.zh !== null && dictionary.en !== null
      if (!ok) {
        rows.push('the dictionary module could not be read: ' + clip(dictionary === null || dictionary === undefined ? 'the probe answered nothing for this package' : String(dictionary.error), 300))
      } else {
        const zh = Object.keys(dictionary.zh)
        const en = Object.keys(dictionary.en)
        const missingInEn = zh.filter((key) => en.includes(key) === false)
        const extraInEn = en.filter((key) => zh.includes(key) === false)
        rows.push('the dictionary module: ' + dictionary.path)
        rows.push('zh keys (' + String(zh.length) + '): ' + clip(show(zh), 500))
        rows.push('en keys (' + String(en.length) + '): ' + clip(show(en), 500))
        rows.push('zh keys missing from en: ' + show(missingInEn))
        rows.push('en keys missing from zh: ' + show(extraInEn))
        ok = missingInEn.length === 0 && extraInEn.length === 0 && zh.length > 0
      }
      add('K' + id, ok, 'the ' + show(name) + ' namespace carries the same key set in zh and en: both diffs empty', rows)
    }

    // C -- the copy goes through the dictionary.
    {
      const rows = []
      const declaredKeep = dictionary !== null && dictionary !== undefined && dictionary.present === true && Array.isArray(dictionary.keep) ? dictionary.keep : []
      const keepLiterals = new Set(source.keepLiterals)
      for (const declaration of declaredKeep) for (const literal of declaration.literals) keepLiterals.add(literal)
      const keys = dictionary !== null && dictionary !== undefined && dictionary.present === true && dictionary.zh !== null ? new Set(Object.keys(dictionary.zh)) : new Set()
      const leaks = source.findings.filter((finding) => finding.declared === undefined && keepLiterals.has(finding.text) === false)
      const declaredLeaks = source.findings.filter((finding) => finding.declared !== undefined || keepLiterals.has(finding.text))
      const unknown = source.keys.filter((use) => keys.has(use.key) === false)
      rows.push('the scanned half: ' + show(source.dir) + ' - ' + String(source.files.length) + ' file(s); the gate flags a literal in a JSX text node, in one of the named attributes ' + show(ATTRS) + ', or bound to a copy-named member')
      rows.push('the dictionary keys the t() calls are checked against: ' + String(keys.size) + ', from ' + show(dictionary !== null && dictionary.present === true ? dictionary.path : null))
      for (const finding of leaks.slice(0, 12)) rows.push('    LEAK ' + finding.file + ':' + String(finding.line) + ' [' + finding.rule + '] ' + show(clip(finding.text, 90)))
      if (leaks.length > 12) rows.push('    ... and ' + String(leaks.length - 12) + ' more hardcoded literal(s)')
      const keepLines = declaredLeaks.map((finding) => ({ at: finding.file + ':' + String(finding.line), literal: finding.text, reason: (source.keepEntries.find((item) => item.literal === finding.text) ?? {}).reason ?? 'declared' }))
      const keepExports = declaredKeep.map((declaration) => ({ at: 'export ' + declaration.name, reason: 'the dictionary module declares it', literal: declaration.literals }))
      const keepLists = source.keepEntries.filter((item) => item.declaredIn === 'list').map((item) => ({ at: item.file, literal: item.literal, reason: item.reason }))
      rows.push('kept-English declarations the gate can SEE (this is the list, not a leak): ' + (keepLines.length + keepExports.length + keepLists.length === 0
        ? '(none: no i18n-keep marker in the scanned half, no keep list exported by the dictionary module, and no keep*.json in the package)'
        : show([...keepLines, ...keepExports, ...keepLists])))
      rows.push('t(...) calls read from the half: ' + String(source.keys.length) + ' static use(s), ' + String(new Set(source.keys.map((use) => use.key)).size) + ' distinct key(s); keys the dictionary does not carry: ' + show([...new Set(unknown.map((use) => use.key))]))
      for (const use of unknown.slice(0, 8)) rows.push('    UNKNOWN KEY ' + use.file + ':' + String(use.line) + ' ' + show(use.key))
      if (source.dynamicKeys.length > 0) rows.push('    NOT CHECKABLE, NAMED: ' + String(source.dynamicKeys.length) + ' template-literal key(s) at ' + show(source.dynamicKeys.slice(0, 6).map((use) => use.file + ':' + String(use.line))))
      const ok = leaks.length === 0 && unknown.length === 0 && source.keys.length > 0
      add('C' + id, ok, 'no hardcoded product text in the ' + show(name) + ' client half (JSX text nodes, the named attributes, copy-named members) and every t() key is in the dictionary', rows)
    }

    // I -- the glyph is named, and a self-drawn piece follows the measured rules - or the NAMED
    // not-applicable verdict, when the half fills no glyph slot for that rule to judge.
    {
      const glyphs = world.glyphs[name]
      const face = subjectOf(name)
      const rows = []
      const definitions = entry === null || entry === undefined || Array.isArray(entry.definitions) === false ? [] : entry.definitions
      const slots = entry === null || entry === undefined || Array.isArray(entry.slots) === false ? [] : entry.slots
      const unknownNames = glyphs.firstPartyImports.filter((use) => use.known !== true)
      const unused = glyphs.firstPartyImports.filter((use) => use.used !== true)
      const selfDrawn = glyphs.selfDrawn
      const badCanvas = selfDrawn.filter((piece) => piece.judged.viewBox !== GLYPH_VIEWBOX)
      const badStroke = selfDrawn.filter((piece) => piece.judged.strokeWidths.some((width) => ALLOWED_STROKES.includes(Number(width)) === false))
      const noStroke = selfDrawn.filter((piece) => piece.judged.strokeWidths.length === 0)
      rows.push('the first-party set: ' + FIRST_PARTY + ' (' + String(world.firstParty.error === null ? world.firstParty.names.size : 0) + ' exported name(s) read from ' + show(world.firstParty.error === null ? world.firstParty.sources : []) + ', strokes ' + show(world.firstParty.error === null ? world.firstParty.strokes : {}) + ')')
      rows.push('first-party glyph components imported and used in this half: ' + (glyphs.firstPartyImports.length === 0 ? '(none)' : show(glyphs.firstPartyImports.map((use) => ({ package: FIRST_PARTY, component: use.name, at: use.file + ':' + String(use.line) })))))
      for (const use of unknownNames) rows.push('    NOT AN EXPORT OF THE FIRST-PARTY SET: ' + use.name + ' at ' + use.file + ':' + String(use.line))
      for (const use of unused) rows.push('    NAMED BUT NOT USED in this half: ' + use.name + ' at ' + use.file + ':' + String(use.line))
      rows.push('self-drawn pieces judged by their own SVG bytes: ' + (selfDrawn.length === 0 ? '(none)' : show(selfDrawn.map((piece) => ({ at: piece.file + ':' + String(piece.line), viewBox: piece.judged.viewBox, strokes: piece.judged.strokeWidths })))))
      for (const piece of badCanvas) rows.push('    CANVAS NOT ' + show(GLYPH_VIEWBOX) + ': ' + piece.file + ':' + String(piece.line) + ' declares ' + show(piece.judged.viewBox))
      for (const piece of badStroke) rows.push('    STROKE NOT 1 OR 1.3: ' + piece.file + ':' + String(piece.line) + ' declares ' + show(piece.judged.strokeWidths))
      for (const piece of noStroke) rows.push('    NOTE (not judged): ' + piece.file + ':' + String(piece.line) + ' declares no stroke width at all: the rule names 1 or 1.3, and a glyph that draws no stroke is a call for the Lead, not for this gate')
      const candidates = glyphs.firstPartyImports.length + selfDrawn.length
      // Is there a glyph slot at all? Either the half registered a tab type that has to name a glyph, or
      // its sources carry a glyph-shaped piece. With neither, there is nothing here for the I rule to
      // judge, and the reading says so by name instead of passing or being silently left out.
      const applicable = definitions.length > 0 || candidates + glyphs.foreignArtwork.length > 0
      if (applicable === false) {
        rows.push('NOT APPLICABLE, NAMED: this half fills the ' + show(face === undefined ? 'unknown' : face.face) + ' face rather than a tab, and fills no glyph slot anywhere. The measurements this verdict IS:')
        rows.push('    (1) the tab types its own apply() registered: ' + show(definitions) + ' - no right-sidebar tab type, so there is no tab that could NAME a glyph')
        rows.push('    (2) what src/client/** carries in a glyph slot: ' + String(glyphs.firstPartyImports.length) + ' first-party glyph import(s), ' + String(glyphs.foreignArtwork.length) + ' artwork-looking import(s) from anywhere else, ' + String(selfDrawn.length) + ' self-drawn svg piece(s)')
        rows.push('    what its own apply() did register instead: ' + show(slots) + ' slot(s)')
        rows.push('THIS IS NOT A PASS AND NOT A FAILURE: nothing above is a green claim, so no mutant is required to redden it (there is nothing to redden), and the coverage matrix names it as not a green claim. Put a glyph into this half and the same reading becomes applicable, judged by the same rule as the others - which is what the glyph mutants aimed at this half show.')
        add('I' + id, null, 'NOT APPLICABLE for ' + show(name) + ': its own apply() registers no right-sidebar tab type and its client half carries no glyph at all, so there is no glyph slot for the I rule to judge - named here, never skipped, never counted as green', rows)
      } else {
        rows.push('the tab types the artifact own apply() registered: ' + show(definitions))
        for (const definition of definitions) if (definition.guide !== null) rows.push('    the guide entries carry an icon component: ' + show(definition.guide.map((item) => item.icon)))
        const ok = candidates > 0 && unknownNames.length === 0 && unused.length === 0 && badCanvas.length === 0 && badStroke.length === 0
        add('I' + id, ok, 'the ' + show(name) + ' half names its glyph - a first-party component (package and name above) or a self-drawn piece on a 16x16 canvas with stroke 1 or 1.3', rows)
      }
    }

    // B -- no brand-colour piece in the glyph slot.
    {
      const glyphs = world.glyphs[name]
      const rows = []
      const selfDrawn = glyphs.selfDrawn
      const branded = selfDrawn.filter((piece) => piece.judged.gradient === true || piece.judged.fixedColors.length > 0)
      const foreign = glyphs.foreignArtwork.filter((use) => use.used === true)
      rows.push('the glyph-slot rule: no gradient, no fixed fill/stroke colour, and no artwork-looking component imported from outside ' + FIRST_PARTY)
      rows.push('NOTE (named, not a leak): a FIRST-PARTY import is not judged by SVG bytes - the kernel own guide entries draw first-party GuideArtwork (36x36, fixed palette) in this very slot: packages/client/ui-primitives/src/guide-artwork.tsx:9-31, packages/client/ui-sidebar-files/src/client/definition.tsx:31-38, packages/client/ui-sidebar-browser/src/client/definition.tsx:22-25')
      rows.push('self-drawn pieces, by their bytes: ' + (selfDrawn.length === 0 ? '(none)' : show(selfDrawn.map((piece) => ({ at: piece.file + ':' + String(piece.line), gradient: piece.judged.gradient, fixedColors: piece.judged.fixedColors })))))
      for (const piece of branded) rows.push('    BRAND PIECE: ' + piece.file + ':' + String(piece.line) + ' gradient=' + show(piece.judged.gradient) + ' fixed colours=' + show(piece.judged.fixedColors))
      rows.push('artwork-looking names imported from anywhere else: ' + (glyphs.foreignArtwork.length === 0 ? '(none)' : show(glyphs.foreignArtwork.map((use) => ({ name: use.name, from: use.specifier, used: use.used, at: use.file + ':' + String(use.line) })))))
      for (const use of foreign) rows.push('    NOT FIRST-PARTY: ' + use.name + ' imported from ' + show(use.specifier) + ' at ' + use.file + ':' + String(use.line))
      const ok = branded.length === 0 && foreign.length === 0
      add('B' + id, ok, 'no brand-colour artwork (36x36 / gradient / fixed fill) and no non-first-party artwork in the ' + show(name) + ' glyph slot', rows)
    }
  }

  // L0 -- the coverage list. It is a list: only the accounting is judged.
  {
    const rows = []
    const inventory = world.inventory
    const declaredEntries = inventory.filter((entry) => entry.declared)
    const unguarded = inventory.filter((entry) => entry.declared === false)
    const observed = DECLARED.filter((name) => {
      const entry = probe === null || probe.packages === undefined ? null : probe.packages[name]
      return entry !== null && entry !== undefined && Array.isArray(entry.registered) && entry.registered.some((call) => call.byGate === false)
    })
    const lineOf = (entry, mark) => '    ' + entry.name
      + ' | src/client files=' + String(entry.sourceFiles)
      + (entry.sourceFiles === 0 ? ' | src/client/**=NONE (this half is JS under lib/, which this gate does not scan)' : ' | hardcoded literals this gate would flag=' + String(entry.findings))
      + ' | t() key uses=' + String(entry.keys)
      + ' | own source registers a locale namespace=' + show(entry.registersNamespace)
      + ' | own source registers a tab type=' + show(entry.registersTabType)
      + ' | built half=' + show(entry.bundleExists)
      + (mark ? '  <-- IT REGISTERS A LOCALE NAMESPACE AND THIS GATE DOES NOT DECLARE IT: nothing here guards its keys' : '')
    rows.push('=== THE COVERAGE LIST (THIS IS NOT A PASS, IT IS A LIST) ===')
    rows.push('every package under plugins/ that ships a web client face (dsh.client.platform = web), one line each:')
    rows.push('--- GUARDED by this gate, ' + String(declaredEntries.length) + ' package(s): ' + show(DECLARED))
    for (const entry of declaredEntries) rows.push(lineOf(entry, false))
    rows.push('--- UNGUARDED, NAMED, AND COUNTED AS COMPLIANT BY NOBODY, ' + String(unguarded.length) + ' package(s):')
    for (const entry of unguarded) rows.push(lineOf(entry, entry.registersNamespace))
    rows.push('the declared set: ' + show(DECLARED) + ' (' + String(DECLARED.length) + ')')
    rows.push('the set this gate OBSERVED registering a dictionary through the real service: ' + show(observed) + ' (' + String(observed.length) + ')')
    const accountedFor = declaredEntries.length + unguarded.length
    const bothLists = declaredEntries.every((entry) => unguarded.some((other) => other.name === entry.name) === false)
    const noLeakage = accountedFor === inventory.length && new Set(inventory.map((entry) => entry.name)).size === inventory.length && bothLists
    rows.push('the accounting: ' + String(inventory.length) + ' client-half package(s), ' + String(accountedFor) + ' classified exactly once; declared packages really present: ' + show(DECLARED.filter((name) => inventory.some((entry) => entry.name === name && entry.declared))))
    rows.push('the readings that judge each declared package (a NOT APPLICABLE reading is named here and is no green claim):')
    for (const subject of SUBJECTS) {
      const judged = out.filter((reading) => reading.id.slice(1) === subject.id)
      rows.push('    ' + subject.name + ' (' + subject.face + '): ' + (judged.length === 0 ? 'THE PROBE ANSWERED NOTHING FOR IT' : show(judged.map((reading) => reading.id + ':' + reading.state))))
      for (const reading of judged) if (reading.state === 'n/a') rows.push('        ' + reading.id + ' NOT APPLICABLE: ' + reading.detail)
    }
    const ok = noLeakage && same(observed, DECLARED) && DECLARED.every((name) => inventory.some((entry) => entry.name === name && entry.declared))
    add('L0', ok, 'the accounting holds: every client-half package is classified exactly once, and the declared set equals the set observed registering a dictionary (the coverage itself is listed above and is NOT a pass)', rows)
  }

  return out
}

// ---------------------------------------------------------------------------
// Self-attack: one edit per mutant, applied to a staged copy, measured by the same judge.
// ---------------------------------------------------------------------------
const editFile = (path, transform) => {
  if (path === null || existsSync(path) === false) return { applied: false, why: 'no such file: ' + show(path) }
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === null || after === undefined) return { applied: false, why: 'no anchor this gate can locate in ' + path }
  if (after === before) return { applied: false, why: 'the located anchor changed no byte of ' + path }
  writeFileSync(path, after)
  return { applied: true, why: null }
}

/** The file a package's browser half draws its glyph in: where a first-party piece is used or imported. */
function glyphFile(paths, name) {
  const dir = join(paths.root, 'plugins', name, 'src', 'client')
  const files = walkFiles(dir, (entry) => /\.(ts|tsx)$/.test(entry))
  const withGlyph = files.find((path) => {
    const text = readText(path) ?? ''
    return /ICON|Icon|GuideArtwork|PluginArtwork|FileTypeIcon/.test(text)
  })
  if (withGlyph !== undefined) return withGlyph
  const tsx = files.filter((path) => path.endsWith('.tsx')).sort((left, right) => statSync(right).size - statSync(left).size)
  return tsx.length > 0 ? tsx[0] : null
}

/** Inject one markup fragment just inside the first JSX return, or append it when no such anchor exists. */
const injectIntoJsx = (path, markup) => editFile(path, (text) => {
  const anchor = /return\s*\(\s*\n(\s*)</.exec(text)
  if (anchor !== null) {
    const at = anchor.index + anchor[0].length - 1
    return text.slice(0, at) + markup + '\n' + anchor[1] + text.slice(at)
  }
  return text + '\n' + markup + '\n'
})

/** Build the mutants: eleven per declared package, anchored on that package's own bytes. */
function buildMutants() {
  const mutants = []
  // P1 and P2 fill a right-sidebar tab: they carry the eleven mutants they always carried (none of them
  // removed), each anchored on the file that names their glyph, their dictionary module or their bundle.
  for (const subject of SUBJECTS.filter((candidate) => candidate.face === 'tab')) {
    const name = subject.name
    const id = subject.id
    const tag = subject.tag
    const dictionary = (paths) => join(paths.root, 'plugins', name, 'src', 'client', 'locales.ts')
    const bundle = (paths) => bundleOf(paths.root, name)
    mutants.push(
      {
        name: tag + '-source-zh-drops-a-key', expect: ['C' + id, 'K' + id],
        note: 'the dictionary module is the key-set source of truth: dropping one zh entry leaves zh and en disagreeing, and a component still asking for that key then names a key no dictionary carries',
        edit: (paths) => editFile(dictionary(paths), (text) => {
          const anchor = /(\n\s*'[^']+':\s*'[^']*',?)(?=\n\s*\})/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-built-en-drops-a-key', expect: ['D' + id],
        note: 'the BUILT half is what registers: a key dropped from the bundle leaves the source module complete, so only the registration reading moves',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const anchor = /\n(\s*)"[A-Za-z][A-Za-z0-9._-]*":\s*"[^"\n]*",(?=\n\s*"[A-Za-z][A-Za-z0-9._-]*":)/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-built-value-changes', expect: ['D' + id],
        note: 'the same pair of planes: a value the bundle carries while the source module does not is a read-back mismatch, not a missing key',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const anchor = /("[A-Za-z][A-Za-z0-9._-]*":\s*")([^"\n]{3,})(")/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + anchor[1] + 'gate125-changed' + anchor[3] + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-stops-registering-its-dictionary', expect: ['D' + id, 'L0'],
        note: 'the registration itself, removed from the BUILT half: nothing lands in the real service, so the dictionary reading and the declared-versus-observed accounting of L0 both move',
        edit: (paths) => editFile(bundle(paths), (text) => text.includes('ctx.locale.register(') ? text.replaceAll('ctx.locale.register(', 'void (') : null),
      },
      {
        name: tag + '-writes-a-sentence-into-a-text-node', expect: ['C' + id],
        note: 'a hardcoded sentence in a JSX text node is the leak reading C exists for',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<span>gate125 hardcoded sentence</span>'),
      },
      {
        name: tag + '-writes-a-sentence-into-a-whitelisted-attribute', expect: ['C' + id],
        note: 'the named attribute whitelist is the second half of the same rule',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<span aria-label="gate125 hardcoded label" />'),
      },
      {
        name: tag + '-asks-for-a-key-no-dictionary-carries', expect: ['C' + id],
        note: 'a t() key the dictionary does not carry is named by C',
        edit: (paths) => editFile(glyphFile(paths, name), (text) => text.includes('t(') ? text.replace(/\bt\(/, 't("gate125.no.such.key") || t(') : null),
      },
      {
        name: tag + '-declares-a-kept-english-literal', expect: [],
        note: 'a declared kept-English literal must move NOTHING: the i18n-keep marker is what tells a declaration apart from a leak',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<span>gate125 kept english</span> {/* i18n-keep: gate125 control: this sentence is declared kept English */}'),
      },
      {
        name: tag + '-glyph-becomes-a-brand-piece', expect: ['B' + id, 'I' + id],
        note: 'a 36x36 gradient/fixed-fill piece in the glyph inventory: the canvas moves I and the fixed colour moves B',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<svg viewBox="0 0 36 36" fill="#4D6BFE"><path d="M1 1h2" fill="#4D6BFE" /><defs><linearGradient id="g125"><stop stopColor="#fff" /></linearGradient></defs></svg>'),
      },
      {
        name: tag + '-glyph-is-replaced-by-a-brand-piece', expect: ['B' + id, 'I' + id],
        note: 'the same piece REPLACING the first-party glyph rather than joining it: the usage site is the anchor, in either of the two spellings this package could use',
        edit: (paths) => editFile(glyphFile(paths, name), (text) => {
          const element = /<([A-Z][A-Za-z0-9]*(?:Icon|Artwork|Glyph)[A-Za-z0-9]*)\b[^>]*\/>/.exec(text)
          if (element !== null) return text.replace(element[0], '<svg viewBox="0 0 36 36" fill="#4D6BFE"><path d="M1 1h2" fill="#4D6BFE" /></svg>')
          const property = /(icon:\s*)([A-Za-z_$][A-Za-z0-9_$]*)/.exec(text)
          if (property !== null) return text.slice(0, property.index) + 'icon: undefined, __gate125Brand: (<svg viewBox="0 0 36 36" fill="#4D6BFE"><path d="M1 1h2" fill="#4D6BFE" /></svg>)' + text.slice(property.index + property[0].length)
          return null
        }),
      },
      {
        name: tag + '-imports-artwork-from-outside-the-first-party-set', expect: ['B' + id],
        note: 'the brand-import face of the same rule: an artwork-looking component reached from anywhere but the first-party set',
        edit: (paths) => editFile(glyphFile(paths, name), (text) => {
          const anchor = /import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"][^'"]+['"];?\n/
          if (anchor.test(text) === false) return null
          return text.replace(anchor, '$&import { IconBrandMark } from "dsh-link-brand/client";\nexport const __gate125Glyph = IconBrandMark;\n')
        }),
      },
    )
  }
  // P3: a settings-section half, and every one of its anchors is its own. Its namespace literal lives
  // beside its registration rather than in the dictionary module; its BUILT bundle carries compiled JSX
  // before the dictionaries, so the first quoted "key": "value" pair in it is the attribute
  // ("aria-hidden": "true") and NOT a dictionary entry - which is why the value mutant anchors on two
  // ADJACENT dictionary entries instead; and its two glyph mutants are the ones that turn the named
  // not-applicable I reading into an applicable, red one without any special case in the judge.
  {
    const name = 'dsh-theme-settings'
    const id = '3'
    const tag = 'theme'
    const source = (paths, relative) => join(paths.root, 'plugins', name, 'src', 'client', relative)
    const dictionary = (paths) => source(paths, 'locales.ts')
    const section = (paths) => source(paths, 'ThemeSection.tsx')
    const bundle = (paths) => bundleOf(paths.root, name)
    const brandPiece = '<svg viewBox="0 0 36 36" fill="#4D6BFE"><path d="M1 1h2" fill="#4D6BFE" /><defs><linearGradient id="g125"><stop stopColor="#fff" /></linearGradient></defs></svg>'
    mutants.push(
      {
        name: tag + '-source-zh-drops-a-key', expect: ['C' + id, 'K' + id],
        note: 'the same key-set source of truth as the tab halves: one zh entry dropped from the dictionary module leaves zh and en disagreeing, and the component still asking for that key then names a key no dictionary carries',
        edit: (paths) => editFile(dictionary(paths), (text) => {
          const anchor = /(\n\s*'[^']+':\s*'[^']*',?)(?=\n\s*\})/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-built-dictionary-drops-a-key', expect: ['D' + id],
        note: 'the BUILT half is what registers: a key dropped from the bundle leaves the source module complete, so only the registration reading moves',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const anchor = /\n(\s*)"[A-Za-z][A-Za-z0-9._-]*":\s*"[^"\n]*",(?=\n\s*"[A-Za-z][A-Za-z0-9._-]*":)/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-built-dictionary-value-changes', expect: ['D' + id],
        note: 'a value the bundle carries while the source module does not is a read-back mismatch: the anchor needs TWO adjacent dictionary entries, because the first quoted key/value pair in this bundle is a compiled JSX attribute and moving that would move nothing',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const anchor = /\n(\s*"[A-Za-z][A-Za-z0-9._-]*":\s*")([^"\n]{3,})(",\n\s*"[A-Za-z][A-Za-z0-9._-]*":)/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + '\n' + anchor[1] + 'gate125-changed' + anchor[3] + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-stops-registering-its-dictionary', expect: ['D' + id, 'L0'],
        note: 'the registration itself, removed from the BUILT half: nothing lands in the real service, so the dictionary reading and the declared-versus-observed accounting of L0 both move',
        edit: (paths) => editFile(bundle(paths), (text) => text.includes('ctx.locale.register(') ? text.replaceAll('ctx.locale.register(', 'void (') : null),
      },
      {
        name: tag + '-registers-under-a-namespace-its-own-source-does-not-declare', expect: ['D' + id],
        note: 'THIS package own face of the D reading: the whole namespace registry is untouched (L0 still sees a registration) and only the namespace the artifact took is moved - so D is the one reading that moves, and it moves because the ns it registered is not the one its own source declares',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const site = /locale\s*\.\s*register\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(text)
          if (site === null) return null
          const anchor = new RegExp('(var|const|let)\\s+' + site[1] + '\\s*=\\s*([\'"])([^\'"]+)\\2').exec(text)
          if (anchor === null) return null
          return text.slice(0, anchor.index) + anchor[1] + ' ' + site[1] + ' = "' + anchor[3] + '-gate125-renamed"' + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-dictionary-module-declares-another-namespace-than-the-site', expect: ['D' + id],
        note: 'the other half of the namespace claim: the two channels this half declares its namespace through (its registration site and a later NS export) must name the SAME one. The artifact keeps registering what its site says and L0 still sees that registration, so D is the only reading that moves - and it moves on the disagreement itself',
        edit: (paths) => editFile(dictionary(paths), (text) => 'export const NS = "gate125-other-namespace"' + '\n' + text),
      },
      {
        name: tag + '-writes-a-sentence-into-a-text-node', expect: ['C' + id],
        note: 'a hardcoded sentence in a JSX text node is the leak reading C exists for, and this half has real JSX to put it in',
        edit: (paths) => injectIntoJsx(section(paths), '<span>gate125 hardcoded sentence</span>'),
      },
      {
        name: tag + '-writes-a-sentence-into-a-whitelisted-attribute', expect: ['C' + id],
        note: 'the named attribute whitelist is the second half of the same rule',
        edit: (paths) => injectIntoJsx(section(paths), '<span aria-label="gate125 hardcoded label" />'),
      },
      {
        name: tag + '-asks-for-a-key-no-dictionary-carries', expect: ['C' + id],
        note: 'a t() key the dictionary does not carry is named by C',
        edit: (paths) => editFile(section(paths), (text) => text.includes('t(') ? text.replace(/\bt\(/, 't("gate125.no.such.key") || t(') : null),
      },
      {
        name: tag + '-declares-a-kept-english-literal', expect: [],
        note: 'a declared kept-English literal must move NOTHING: the i18n-keep marker is what tells a declaration apart from a leak',
        edit: (paths) => injectIntoJsx(section(paths), '<span>gate125 kept english</span> {/* i18n-keep: gate125 control: this sentence is declared kept English */}'),
      },
      {
        name: tag + '-glyph-slot-gets-a-brand-piece', expect: ['B' + id, 'I' + id],
        note: 'the not-applicable reading is a MEASUREMENT: put a 36x36 fixed-fill piece into this half and the same I reading becomes applicable and red (canvas), and the fixed colour moves B',
        edit: (paths) => injectIntoJsx(section(paths), brandPiece),
      },
      {
        name: tag + '-imports-artwork-from-outside-the-first-party-set', expect: ['B' + id, 'I' + id],
        note: 'the brand-import face of the same rule: an artwork-looking component reached from anywhere but the first-party set. For this half it moves I too - the glyph slot is now filled by something that is neither a first-party component nor a self-drawn piece, so the half names no glyph at all',
        edit: (paths) => editFile(source(paths, 'index.tsx'), (text) => {
          const anchor = /import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"][^'"]+['"];?\n/
          if (anchor.test(text) === false) return null
          return text.replace(anchor, '$&import { IconBrandMark } from "dsh-link-brand/client";\nexport const __gate125Glyph = IconBrandMark;\n')
        }),
      },
    )
  }
  // P4: a half that fills the conversation header's action slot through ctx.slots rather than a
  // right-sidebar tab type, so it has no tab that could name a glyph and no glyph of its own - its I
  // reading is the second named not-applicable verdict, and the last mutant below is the one that turns
  // it into an applicable, red one. Its dictionary module and its registration site name the same
  // namespace, and its BUILT zh block escapes non-ASCII as \uXXXX, so the entry that mutant drops is
  // the LAST one of that block: a key whose two languages carry DIFFERENT values, because the shipped
  // lookup chain falls from zh to en and a key reading the same in both would be answered by the
  // fallback and move nothing.
  {
    const name = 'dsh-link-toolbar'
    const id = '4'
    const tag = 'toolbar'
    const source = (paths, relative) => join(paths.root, 'plugins', name, 'src', 'client', relative)
    const dictionary = (paths) => source(paths, 'locales.ts')
    const bundle = (paths) => bundleOf(paths.root, name)
    mutants.push(
      {
        name: tag + '-source-zh-drops-a-key', expect: ['K' + id],
        note: 'the dictionary module is the key-set source of truth: dropping one zh entry leaves zh and en disagreeing, while the two keys this half statically asks for survive and the BUILT half still registers the dropped key - which is why the key-set reading is the only one that moves',
        edit: (paths) => editFile(dictionary(paths), (text) => {
          const anchor = /(\n\s*'[^']+':\s*'[^']*',?)(?=\n\s*\})/.exec(text)
          return anchor === null ? null : text.slice(0, anchor.index) + text.slice(anchor.index + anchor[0].length)
        }),
      },
      {
        name: tag + '-built-zh-drops-a-key', expect: ['D' + id],
        note: 'the BUILT half is what registers: the last entry of its zh block is dropped, and it is the last one on purpose - that key carries a different value in each language, so the service own zh-to-en fallback cannot answer it with the source value, and the read-back names the mismatch instead of finding nothing to complain about',
        edit: (paths) => editFile(bundle(paths), (text) => {
          const block = /\nvar zh = \{([\s\S]*?)\n\};/.exec(text)
          if (block === null) return null
          const entries = block[1].split('\n').filter((line) => line.trim() !== '')
          if (entries.length < 2 || /^\s*"[A-Za-z][A-Za-z0-9._-]*":\s*"[^"]*",?$/.test(entries[entries.length - 1]) === false) return null
          return text.slice(0, block.index) + '\nvar zh = {' + entries.slice(0, -1).join('\n') + '\n};' + text.slice(block.index + block[0].length)
        }),
      },
      {
        name: tag + '-stops-registering-its-dictionary', expect: ['D' + id, 'L0'],
        note: 'the registration itself, removed from the BUILT half: nothing lands in the real service under this half own name, so the dictionary reading and the declared-versus-observed accounting of L0 both move',
        edit: (paths) => editFile(bundle(paths), (text) => text.includes('ctx.locale.register(') ? text.replaceAll('ctx.locale.register(', 'void (') : null),
      },
      {
        name: tag + '-writes-a-sentence-into-a-text-node', expect: ['C' + id],
        note: 'a hardcoded sentence in a JSX text node is the leak reading C exists for, and this half own header action carries real JSX to put it in',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<span>gate125 hardcoded sentence</span>'),
      },
      {
        name: tag + '-writes-a-sentence-into-a-whitelisted-attribute', expect: ['C' + id],
        note: 'the named attribute whitelist is the second half of the same rule',
        edit: (paths) => injectIntoJsx(glyphFile(paths, name), '<span aria-label="gate125 hardcoded label" />'),
      },
      {
        name: tag + '-asks-for-a-key-no-dictionary-carries', expect: ['C' + id],
        note: 'a t() key the dictionary does not carry is named by C',
        edit: (paths) => editFile(glyphFile(paths, name), (text) => text.includes('t(') ? text.replace(/\bt\(/, 't("gate125.no.such.key") || t(') : null),
      },
      {
        name: tag + '-imports-artwork-from-outside-the-first-party-set', expect: ['B' + id, 'I' + id],
        note: 'the brand-import face of the glyph rule, and the one that shows the named not-applicable verdict is a MEASUREMENT: an artwork-looking component reached from anywhere but the first-party set fills this half glyph inventory, so B moves - and I moves with it, applicable and red, because a foreign import is neither a first-party component nor a self-drawn piece',
        edit: (paths) => editFile(source(paths, 'index.tsx'), (text) => {
          const anchor = /import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"][^'"]+['"];?\n/
          if (anchor.test(text) === false) return null
          return text.replace(anchor, '$&import { IconBrandMark } from "dsh-link-brand/client";\nexport const __gate125Glyph = IconBrandMark;\n')
        }),
      },
    )
  }
  mutants.push({ name: 'control-nothing-changed', expect: [], note: 'the harness must not move a reading on its own', edit: () => ({ applied: true, why: null }) })
  return mutants
}

/** Copy the declared packages into a staged root and return the paths a mutant may edit. */
function stageSubject(root) {
  for (const name of DECLARED) {
    const source = join(PROJECT, 'plugins', name)
    if (!existsSync(source)) continue
    const target = join(root, 'plugins', name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  return { root }
}

const runAttack = async (started) => {
  const collect = async (label, edit) => {
    const runDir = freshRun(label)
    const root = join(runDir, 'root')
    const paths = stageSubject(root)
    const applied = edit === null ? { applied: true, why: null } : edit(paths)
    return { runDir, applied, world: await buildWorld(root, runDir) }
  }
  const clean = (run) => { if (!KEEP) { try { rmSync(run.runDir, { recursive: true, force: true }) } catch { /* a locked temp file is not a gate failure */ } } }

  const baseline = await collect('baseline', null)
  if (baseline.world.fatal !== null) { const why = baseline.world.fatal; clean(baseline); return NOT_MEASURED('the staged baseline could not be built: ' + why) }
  const baseReadings = judge(baseline.world)
  const baseRed = baseReadings.filter((reading) => reading.ok === false)
  const baseNotApplicable = baseReadings.filter((reading) => reading.ok === null)
  console.log('  baseline in a staged copy of the declared packages: ' + String(baseReadings.length) + ' readings, ' + String(baseRed.length) + ' failed' + (baseNotApplicable.length === 0 ? '' : ', ' + String(baseNotApplicable.length) + ' NOT APPLICABLE named (' + baseNotApplicable.map((reading) => reading.id).join(', ') + ')'))
  clean(baseline)
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed.map((reading) => reading.id)))
    console.log('        (a red baseline is this gate failability evidence; the mutants only mean something once the declared packages are green, e.g. after P1/P2 land and: node plugins/build.mjs)')
    for (const reading of baseRed) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below is ONE edit in a staged copy of the declared packages, measured by the same judge:')
  const mutants = buildMutants()
  let failures = 0
  let uncovered = 0
  const moved = new Map()
  for (const mutant of mutants) {
    const run = await collect('mutant-' + mutant.name, mutant.edit)
    const notApplicable = run.applied !== undefined && run.applied.applied === false
    let observed = []
    let note = ''
    if (run.world.fatal !== null) {
      observed = baseReadings.map((reading) => reading.id)
      note = ' (the mutant world could not be built: ' + run.world.fatal + ')'
    } else if (notApplicable) {
      note = ' (NOT APPLICABLE: ' + run.applied.why + ' - the reading it was to cover counts as uncovered)'
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
    for (const reading of declared) moved.set(reading, (moved.get(reading) === undefined ? 0 : moved.get(reading)) + 1)
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' - 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed) + note)
  }
  console.log('  coverage matrix (every reading that IS a green claim must be declared by at least one mutant):')
  for (const reading of baseReadings) {
    const count = moved.get(reading.id) === undefined ? 0 : moved.get(reading.id)
    if (reading.ok === null) {
      // NOT APPLICABLE: no green claim, so there is nothing for a mutant to redden and nothing to cover.
      // It is named here with its own measurements, and it is NOT counted as covered by the mutants that
      // do declare it (those declare it by making it applicable - a different state, not this one).
      console.log('    n/a   ' + reading.id + '  (' + reading.detail + ')' + (count === 0 ? '' : ' - ' + String(count) + ' mutant(s) declare it by making it applicable and red'))
      continue
    }
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id + (count === 0 ? '  (' + reading.detail + ')' : ''))
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(mutants.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failures === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Staging and main
// ---------------------------------------------------------------------------
const SCRATCH_ROOT = join(PROJECT, SCRATCH_REL)
mkdirSync(SCRATCH_ROOT, { recursive: true })
const freshRun = (label) => mkdtempSync(join(SCRATCH_ROOT, slug(label) + '-'))

const main = async () => {
  const started = Date.now()
  const runDir = freshRun(SELF_ATTACK ? 'attack' : 'run')
  try {
    if (SELF_ATTACK) return await runAttack(started)
    const world = await buildWorld(SUBJECT, runDir)
    if (world.fatal !== null) return NOT_MEASURED(world.fatal)
    console.log('        the subject: ' + show(DECLARED.map((name) => join(SUBJECT, 'plugins', name))) + (SUBJECT === PROJECT ? ' (the tree itself)' : ' (a copy named by --subject)'))
    console.log('        the world: the real kernel client locale service (' + LOCALE_BUNDLE + ') provided by its own shipped bundle and driven in a vm by each half own apply(), through the browser module-loader registration point, plus the source plane under plugins/<name>/src/client/**')
    console.log('        the service answered: ' + (world.probe.service === null || world.probe.service === undefined ? '(not run)' : show({ id: world.probe.service.id, class: world.probe.service.class, locales: world.probe.service.locales })))
    console.log('        the coverage list: ' + String(world.inventory.length) + ' package(s) with a web client face, ' + String(world.inventory.filter((entry) => entry.declared).length) + ' declared by this gate')
    console.log('        the readings declared by this gate: ' + show(READINGS))
    const readings = judge(world)
    for (const reading of readings) {
      console.log('  ' + (reading.ok === true ? 'ok  ' : reading.ok === false ? 'FAIL' : 'n/a ') + '  ' + reading.id + '. ' + reading.detail)
      for (const line of reading.evidence) console.log('        ' + line)
    }
    const failed = readings.filter((reading) => reading.ok === false)
    const notApplicable = readings.filter((reading) => reading.ok === null)
    console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed'
      + (notApplicable.length === 0 ? '' : ', ' + String(notApplicable.length) + ' NOT APPLICABLE (' + notApplicable.map((reading) => reading.id).join(', ') + ': a named verdict, not a green claim and not a failure)')
      + ' | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
    return failed.length > 0 ? 1 : 0
  } finally {
    if (!KEEP) { try { rmSync(runDir, { recursive: true, force: true }) } catch { /* a locked temp file is not a gate failure */ } }
  }
}

process.exitCode = await main()
