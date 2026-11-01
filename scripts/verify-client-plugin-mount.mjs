#!/usr/bin/env node
/**
 * Gate 121 (R188, extended by R189) - client-plugin-mount: TWO PACKAGES THAT ARE REALLY ON THE
 * DELIVERY CHAIN, AND THE TWO THINGS THEY CLAIM REACH THE REAL KERNEL ROUTER AND THE REAL REGISTRY.
 * R189 is the round that gave dsh-link-panel a client half, so both halves of that package are read
 * here now: M2 below says what "delivered" means, one failable fact at a time.
 *
 * Subject: plugins/dsh-link-markdown and plugins/dsh-link-panel, as delivered. Frozen interface:
 * docs/handoff/R188-contract.md section 9 (R3/R4) for the markdown package, and R189-contract.md
 * section 2 (P2) for the panel, which grows a browser half this round: BOTH package names
 * dsh-link-markdown and dsh-link-panel are host + client halves now, each declaring
 * dsh.client.platform = "web" with exports["./client"] pointing at a BUILT lib/client.js; the
 * markdown claim is kind "markdown", priority "extension", patterns ["*.md","*.markdown"], and it
 * does NOT take over builtin "text"; the panel registry's entries are data
 * ({ id, kind, title, source, order }) projected by the pure function projectPanel(entries, { sinks })
 * with the named codes PANEL_DUP_ID / PANEL_UNKNOWN_KIND / PANEL_EMPTY_SOURCE, and the panel's client
 * half registers a right-rail tab of kind "pane".
 *
 * THE WORLD, IN FOUR PARTS (no fake registry anywhere, and nothing on the live machine is touched):
 *
 *   (a) THE REAL LOADER COMPOSES THE ROWS. A throwaway DSH_HOME whose profile declares exactly the
 *       two bundles is composed by apps/cli/src/bin.ts --dump-config - the same applyEntryPatches
 *       call boot() makes - over node_modules junctions to the package directories. That this is not
 *       a printed constant is what the mutants show: point a package's own patch at a file that is
 *       not there, or stop its row naming the package, and the composed row moves.
 *   (b) THE REAL BROWSER MODULE LOADER RUNS EACH CLIENT HALF. lib/client.js is bytes on disk; the
 *       gate installs window.__ModuleLoader__.load and runs the shipped factory with a recording
 *       ctx, so the definition the kernel would be handed is the definition the artifact itself
 *       builds. Both client halves are driven, each in its own seat: a failure on one of them
 *       cannot decide whether the other ran. The only substitutions are the browser platform and
 *       cordis services.
 *   (c) THE REAL TAB ROUTER DECIDES WHAT THE MARKDOWN HALF CLAIMS. That captured definition is
 *       registered on the kernel's own
 *       SidebarRightTabRegistry (packages/client/ui-sidebar-right/src/client/tab-registry.ts),
 *       beside the kernel's OWN builtin "text" definition captured the same way from
 *       packages/client/ui-sidebar-documentpreview/lib/client.js. The paired reading is the
 *       router's answer for a .md address against its answer for a .txt address.
 *   (d) THE PAGE'S CITATIONS ARE CHECKED BY THE CHECKER THAT OWNS THEM
 *       (scripts/check-protocol-page.mjs), and the copy with one shifted line number has to redden.
 *
 * READINGS (each independently failable):
 *   M1 The markdown package is a deliverable client row: its manifest names it, declares
 *      dsh.client.platform "web", resolves exports["./client"] to a lib/client.js that exists and
 *      LOADS into the module loader under its own package name, and its host half lib/index.js
 *      imports. A package that is not on the tree is a red reading; a manifest that is there but a
 *      build that is not is the named exit 3, because then nothing below it can be measured.
 *   M2 The panel package carries a browser half now (R189-contract section 2, P2), and this reading
 *      is the three facts of that delivery, each readable and failable on its own:
 *        (1) the manifest declares the web client face: dsh.client is an object whose platform is
 *            "web";
 *        (2) exports["./client"] points at a lib/client.js that is really BUILT: the file is there AND
 *            the browser module loader runs it under its own package name, applying without error and
 *            registering into the seats the half injects (a half that loads but registers nothing is
 *            not a delivered half);
 *        (3) the composition DELIVERS it: the row the real loader composes carries the package name,
 *            and resolving that row's specifier from the composed profile's own resolution base
 *            reaches the manifest that names this half, whose bundle is the same bytes the loader was
 *            handed above.
 *      The declared host entry that exists and a host half that imports are read here too, exactly as
 *      before. Any of the three missing is a red M2 whose evidence names which one, and the reading
 *      never passes on mere presence. A missing panel client build is this red rather than exit 3,
 *      because every other reading in this gate is measurable without it; exit 3 is reserved for the
 *      markdown build, below which nothing at all can be measured.
 *   C1 The real loader composes the markdown row: the bundle's own section holds a root row whose
 *      name is the package name, carrying the id the package's own patch declares.
 *   C2 The same for the panel row.
 *   D1 The markdown client half declares exactly one type with kind "markdown", priority
 *      "extension", patterns ["*.md","*.markdown"], a canOpen that admits a dsh-resource://file/
 *      address and refuses "https:" and "sidebar:", and no type of kind "text" at all.
 *   D2 PAIRED: the real router gives the .md address to kind "markdown" and does NOT give the .txt
 *      address to kind "markdown". Changing the kind in the artifact reddens both D1 and D2.
 *   P1 The projection is not a function of arrival: two arrival orders of the same four entries (two
 *      of them tied on order, which is where an arrival-ordered fold shows) project byte-identically,
 *      and not to nothing.
 *   P2 A kind outside the closed set is refused BY NAME: PANEL_UNKNOWN_KIND and the offending kind
 *      both appear in what the projection answers or in what it throws.
 *   P3 A repeated id is refused BY NAME with PANEL_DUP_ID and the repeated id.
 *   P4 The empty set is an empty list, not an error: projectPanel([], ...) does not throw and yields
 *      no entry.
 *   V1 The contract page's citation table holds: check-protocol-page.mjs exits 0, every row holds
 *      (N === M), and the page carries at least 10 citations. M is READ, never assumed.
 *
 * Self-attack: --self-attack stages a copy of the three subjects under .tmp/r188-g121, applies ONE
 * byte edit per mutant to that copy, and re-runs the SAME judge. It asserts per mutant that the set
 * of readings that moved is exactly the declared set, prints the Chinese sentence for each, and
 * requires every reading to be declared by at least one mutant. Staging is what keeps the attack
 * precise: the citation checker resolves a page's file:line against THIS repository, so a mutant in a
 * staged package cannot move V1 and the page mutant cannot move a package reading. A mutant whose
 * anchor is not in the artifact is named NOT APPLICABLE and the reading it was to cover then counts
 * as uncovered. One control mutant changes nothing. M2's new client face is attacked the same way,
 * one mutant per fact: deleting the dsh.client declaration reddens the declaration fact, naming a
 * client bundle nobody built reddens the built-and-loadable fact, and renaming the composed row
 * reddens the delivery fact - each without touching the others.
 *
 * WHAT THIS GATE CANNOT JUDGE (named, never reported as a pass): whether the LIVE profile carries
 * the rows, whether the live page preloads the client halves, and whether the registered bodies
 * render - all three need the live client and belong to gate 122, to gate 124, or to the window Lead
 * owns. This gate never connects to 31761/31760/9222, never starts or stops the client, never reads
 * or writes the live profile, and composes its OWN profile under .tmp. The panel's delivery is
 * judged here only as far as a composed profile and its own resolution reach: what the live page's
 * preload list carries, whether the pane is drawn, and whether the read-only marker
 * (globalThis.__dshLinkPanel) is filled in a real page are not readings of this gate. It also does
 * not judge the panel's HTTP read face, the members of the closed kind set (only that a kind outside
 * it is refused), the order-field finiteness refusal, or any rendering.
 *
 * Exit 0 every reading held | 1 a reading failed (or a declared mutant set did not match what moved)
 * | 3 the subject cannot be measured here: the markdown package's build is missing (run: node
 * plugins/build.mjs; nothing below M1 can then be measured - a missing PANEL client build is a red M2
 * instead, because the readings around it stay measurable), the kernel CLI, the kernel tab registry,
 * the kernel text bundle or the citation checker is not on this machine, or the composed world could
 * not be built. A reading that cannot be measured is never green.
 *
 * --subject <dir> measures another tree that carries plugins/<name> and the page, so a red can be
 * reproduced by hand without touching the tree; the citation checker still resolves the page
 * against this repository, which is what keeps the mutant attack precise. --keep leaves the run
 * directory under .tmp/r188-g121 in place.
 *
 * Usage: node scripts/verify-client-plugin-mount.mjs [--self-attack] [--keep] [--subject <dir>]
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

const MARKDOWN = 'dsh-link-markdown'
const PANEL = 'dsh-link-panel'
const PAGE_REL = 'docs/dev/client-plugin-mount.md'
const SCRATCH_REL = join('.tmp', 'r188-g121')

/** The frozen interface (R188-contract section 9, rulings R3/R4). Every expectation uses these. */
const KIND = 'markdown'
const PRIORITY = 'extension'
const PATTERNS = ['*.md', '*.markdown']
const CODE_DUP = 'PANEL_DUP_ID'
const CODE_UNKNOWN = 'PANEL_UNKNOWN_KIND'
const MIN_CITATIONS = 10
const READINGS = ['M1', 'M2', 'C1', 'C2', 'D1', 'D2', 'P1', 'P2', 'P3', 'P4', 'V1']

/** The addresses the routing pair is taken on: the frozen .md/.txt pair plus the two scheme refusals. */
const ADDRESS = {
  md: 'dsh-resource://file/session/gate121/home/me/notes.md',
  mdmark: 'dsh-resource://file/session/gate121/home/me/notes.markdown',
  txt: 'dsh-resource://file/session/gate121/home/me/notes.txt',
  httpsMd: 'https://example.com/notes.md',
  otherScheme: 'sidebar://gate121',
}

/** The kernel modules a Host half may import, by path, so the artifact and this gate share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-llm': join(KERNEL, 'packages', 'llm', 'llm', 'lib', 'index.js'),
}

const KERNEL_CLI = join(KERNEL, 'apps', 'cli', 'src', 'bin.ts')
const TAB_REGISTRY = join(KERNEL, 'packages', 'client', 'ui-sidebar-right', 'src', 'client', 'tab-registry.ts')
const TEXT_BUNDLE = join(KERNEL, 'packages', 'client', 'ui-sidebar-documentpreview', 'lib', 'client.js')
const PAGE_CHECKER = join(PROJECT, 'scripts', 'check-protocol-page.mjs')

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const slug = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_')

const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

// ---------------------------------------------------------------------------
// The client-half loader, as the child process runs it. It lives here as lines rather than as a
// template so that this file stays quote-friendly; the wording is the whole harness.
// ---------------------------------------------------------------------------
const PROBE_LINES = [
  'import { createContext, runInContext } from "node:vm"',
  'import { readFileSync } from "node:fs"',
  'import { pathToFileURL } from "node:url"',
  '',
  '/** A stub that answers every read with another stub, so a browser bundle runs unattended. */',
  'function makeStub(path) {',
  '  const fn = function () { return makeStub(path + "()") }',
  '  return new Proxy(fn, {',
  '    get(target, key) {',
  '      if (key === Symbol.toPrimitive) return () => path',
  '      if (key === Symbol.iterator) return function () { return { next: () => ({ done: true }) } }',
  '      if (key === "then") return undefined',
  '      if (key === "length") return 0',
  '      if (key === "name") return path',
  '      return makeStub(path + "." + String(key))',
  '    },',
  '    apply() { return makeStub(path + "()") },',
  '    construct() { return makeStub("new " + path) },',
  '    has() { return true },',
  '  })',
  '}',
  '',
  '/** The browser module-loader registration point, stubbed: the artifact registers itself here. */',
  'function loadClientHalf(path) {',
  '  const code = readFileSync(path, "utf8")',
  '  let captured = null',
  '  const sandbox = {',
  '    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,',
  '    URL, URLSearchParams, Date, Math, JSON,',
  '    window: { __ModuleLoader__: { load(module) { captured = module } } },',
  '    navigator: { userAgent: "gate121" }, location: { href: "http://gate121/" },',
  '  }',
  '  sandbox.globalThis = sandbox',
  '  runInContext(code, createContext(sandbox), { filename: path })',
  '  if (captured === null) throw new Error("the artifact made no window.__ModuleLoader__.load registration")',
  '  return { module: captured, bytes: code.length }',
  '}',
  '',
  '/** A recording ctx: services answer, and the two registration seats keep exactly what they are given. */',
  'function recordingCtx(log, kept) {',
  '  const ctx = {}',
  '  ctx.effect = (fn, name) => { log.push("effect " + String(name === undefined ? "" : name).slice(0, 60)); try { const d = fn(); return typeof d === "function" ? d : () => {} } catch (error) { log.push("effect threw: " + error.message); return () => {} } }',
  '  ctx.on = () => () => {}',
  '  ctx.get = () => undefined',
  '  ctx.inject = (names, cb) => { log.push("inject " + JSON.stringify(names)); try { return cb(ctx) } catch (error) { log.push("inject cb threw: " + error.message) } }',
  '  ctx.provide = () => () => {}',
  '  ctx.reflect = { provide: () => () => {} }',
  '  ctx.sidebarRightTabs = {',
  '    register: (definition) => {',
  '      kept.definitions.push({ id: definition.id, kind: definition.kind, priority: definition.priority, patterns: definition.patterns === undefined ? undefined : [...definition.patterns], canOpen: typeof definition.canOpen === "function", title: typeof definition.title })',
  '      kept.objects.push(definition)',
  '      log.push("sidebarRightTabs.register " + JSON.stringify({ id: definition.id, kind: definition.kind, priority: definition.priority, patterns: definition.patterns }))',
  '      return () => {}',
  '    },',
  '  }',
  '  ctx.slots = {',
  '    register: (name, component, options) => { kept.slots.push({ name: typeof name === "string" ? name : "(object)", key: typeof name === "string" ? options : name }); log.push("slots.register " + (typeof name === "string" ? name : "object")); return () => {} },',
  '    inject: (name, cb) => { kept.slotInjects.push(String(name)); log.push("slots.inject " + String(name)); try { cb() } catch (error) { log.push("slots.inject cb threw: " + error.message) } return () => {} },',
  '    registerFactory: () => () => {},',
  '  }',
  '  return new Proxy(ctx, { get(target, key) { if (key in target) return target[key]; return makeStub("ctx." + String(key)) } })',
  '}',
  '',
  '/** Run one built client half: its factory, then its apply on the recording ctx. */',
  'function driveClientHalf(path) {',
  '  const kept = { definitions: [], objects: [], slots: [], slotInjects: [], log: [], errors: [] }',
  '  const loaded = loadClientHalf(path)',
  '  kept.registeredId = loaded.module.id',
  '  kept.bytes = loaded.bytes',
  '  const exported = loaded.module.factory((specifier) => makeStub("require:" + String(specifier)))',
  '  kept.exportsName = exported === undefined || exported === null ? null : exported.name',
  '  kept.exportsInject = exported === undefined || exported === null ? null : exported.inject',
  '  kept.hasApply = exported !== undefined && exported !== null && typeof exported.apply === "function"',
  '  if (kept.hasApply) {',
  '    try { exported.apply(recordingCtx(kept.log, kept)) } catch (error) { kept.errors.push(String(error && error.message ? error.message : error)) }',
  '  } else {',
  '    kept.errors.push("the client half exports no apply()")',
  '  }',
  '  return kept',
  '}',
  '',
  'const input = JSON.parse(readFileSync(process.argv[2], "utf8"))',
  'const out = { ok: false, why: null, text: null, markdown: null, panel: null, panelError: null, canOpen: {}, routes: {}, candidates: {} }',
  'const describe = (error) => String(error && error.message ? error.message : error)',
  '',
  '// The panel half is driven first, in its own seat: a failure on the markdown side below must not',
  '// decide whether the panel own client half ran.',
  'if (input.panel !== null) {',
  '  try {',
  '    const panel = driveClientHalf(input.panel)',
  '    out.panel = {',
  '      registeredId: panel.registeredId, bytes: panel.bytes, exportsName: panel.exportsName,',
  '      exportsInject: panel.exportsInject, hasApply: panel.hasApply, errors: panel.errors,',
  '      definitions: panel.definitions, slots: panel.slots, slotInjects: panel.slotInjects, log: panel.log,',
  '    }',
  '  } catch (error) { out.panelError = describe(error) }',
  '}',
  'try {',
  '  const registryModule = await import(pathToFileURL(input.registry).href)',
  '  const Registry = registryModule.SidebarRightTabRegistry',
  '  if (typeof Registry !== "function") throw new Error("the kernel module exports no SidebarRightTabRegistry")',
  '  const ctx = { effect: (fn) => { const d = fn(); return typeof d === "function" ? d : () => {} } }',
  '',
  '  const text = driveClientHalf(input.textBundle)',
  '  const textDefinition = text.objects[0]',
  '  if (textDefinition === undefined) throw new Error("the kernel text bundle registered no tab type")',
  '  out.text = text.definitions[0] === undefined ? null : text.definitions[0]',
  '',
  '  if (input.markdown === null) throw new Error("the markdown package declares no built client half to drive")',
  '  const markdown = driveClientHalf(input.markdown)',
  '  out.markdown = {',
  '    registeredId: markdown.registeredId, bytes: markdown.bytes, exportsName: markdown.exportsName,',
  '    exportsInject: markdown.exportsInject, hasApply: markdown.hasApply, errors: markdown.errors,',
  '    definitions: markdown.definitions, slots: markdown.slots, slotInjects: markdown.slotInjects, log: markdown.log,',
  '  }',
  '  for (const definition of markdown.objects) {',
  '    if (typeof definition.canOpen !== "function") continue',
  '    for (const [name, address] of Object.entries(input.addresses)) {',
  '      try { out.canOpen[name] = definition.canOpen(address) === true } catch (error) { out.canOpen[name] = "threw: " + describe(error) }',
  '    }',
  '  }',
  '',
  '  const registry = new Registry(ctx)',
  '  registry.register(textDefinition)',
  '  for (const definition of markdown.objects) registry.register(definition)',
  '  for (const [name, address] of Object.entries(input.addresses)) {',
  '    try { out.routes[name] = { kind: registry.claim(address).kind } } catch (error) { out.routes[name] = { threw: describe(error) } }',
  '    try { out.candidates[name] = registry.candidates(address).map((definition) => definition.kind) } catch (error) { out.candidates[name] = ["threw: " + describe(error)] }',
  '  }',
  '  out.ok = true',
  '} catch (error) {',
  '  out.why = describe(error)',
  '}',
  'console.log("@@GATE121@@" + JSON.stringify(out))',
]
const PROBE_SOURCE = PROBE_LINES.join('\n')

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------
const SCRATCH_ROOT = join(PROJECT, SCRATCH_REL)
mkdirSync(SCRATCH_ROOT, { recursive: true })
const freshRun = (label) => mkdtempSync(join(SCRATCH_ROOT, slug(label) + '-'))

/** Rewrite the artifact's bare kernel specifiers onto the exact module paths this gate also imports. */
const stageSource = (source) => {
  let text = source
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

/** Bare specifiers the artifact still names after staging: this gate cannot resolve those offline. */
const leftovers = (text) => {
  const found = new Set()
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('file:') || specifier.startsWith('node:') || specifier.startsWith('data:')) continue
    if (KERNEL_MODULES[specifier] !== undefined) continue
    found.add(specifier)
  }
  return [...found].sort()
}

// ---------------------------------------------------------------------------
// The subject: manifests, patches, host halves, the client artifact, the composed rows, the page
// ---------------------------------------------------------------------------
/** Load one package manifest, or say why it is not a manifest. */
function readManifest(root, name) {
  const dir = join(root, 'plugins', name)
  const path = join(dir, 'package.json')
  if (!existsSync(dir)) return { dir, path, exists: false, json: null, error: 'the package directory is not on the tree' }
  if (!existsSync(path)) return { dir, path, exists: false, json: null, error: 'the package has no package.json' }
  try { return { dir, path, exists: true, json: JSON.parse(readFileSync(path, 'utf8')), error: null } } catch (error) { return { dir, path, exists: true, json: null, error: describe(error) } }
}

/** The client artifact a manifest declares: exports["./client"]. */
function clientExportOf(manifest) {
  if (manifest.json === null) return null
  const exports = manifest.json.exports
  if (exports === undefined || exports === null || typeof exports !== 'object') return null
  const entry = exports['./client']
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object' && typeof entry.default === 'string') return entry.default
  return null
}

/** The row a package's bundle patch declares: the id inside its first insert, and the name beside it. */
function readRowPatch(manifest) {
  if (manifest.json === null) return null
  const bundle = manifest.json.dsh === undefined ? undefined : manifest.json.dsh.bundle
  const declared = bundle === undefined || bundle === null ? null : bundle.patch
  if (typeof declared !== 'string') return null
  const path = join(manifest.dir, declared)
  if (!existsSync(path)) return { path, exists: false, id: null, name: null }
  const text = readFileSync(path, 'utf8')
  const id = /^[ \t]*-[ \t]*id:[ \t]*(\S+)[ \t]*$/m.exec(text)
  const name = /^[ \t]*name:[ \t]*(\S+)[ \t]*$/m.exec(text)
  return {
    path, exists: true,
    id: id === null ? null : id[1].replace(/^['"]|['"]$/g, ''),
    name: name === null ? null : name[1].replace(/^['"]|['"]$/g, ''),
  }
}

/** Stage one package's host half with its kernel specifiers rewritten, and import it. */
async function importHostHalf(world, manifest, runDir) {
  const artifact = join(manifest.dir, 'lib', 'index.js')
  const idle = { artifact, exists: false, ns: null, keys: [], apply: false, error: null }
  // A package that is not on the tree at all is a RED reading, not the third state: the producer
  // simply has not delivered. Only a package that IS here with an unbuilt half is exit 3, because
  // then no reading below it can be measured.
  if (!manifest.exists) return idle
  if (!existsSync(artifact)) { world.buildMissing.push(artifact); return idle }
  const source = readFileSync(artifact, 'utf8')
  const rest = leftovers(source)
  if (rest.length > 0) { world.unresolvable.push({ artifact, specifiers: rest }); return { ...idle, exists: true, error: 'the artifact names specifiers this gate cannot resolve offline: ' + rest.join(', ') } }
  const staged = join(runDir, slug(manifest.json !== null && typeof manifest.json.name === 'string' ? manifest.json.name : 'host') + '-host.mjs')
  writeFileSync(staged, stageSource(source))
  try {
    const ns = await import(pathToFileURL(staged).href + '?gate121=' + String(Math.random()).slice(2))
    return { artifact, exists: true, ns, keys: Object.keys(ns).sort(), apply: typeof ns.apply === 'function', error: null }
  } catch (error) {
    return { artifact, exists: true, ns: null, keys: [], apply: false, error: describe(error) }
  }
}

/** Compose a gate-owned profile through the kernel's own loader. Nothing outside the run dir is written. */
function composeRows(world, runDir) {
  const home = join(runDir, 'home')
  const profileDir = join(home, 'profiles', 'web')
  // The profile directory is the resolution base the loader itself used for every row it composed,
  // so M2 reads delivery back through this path rather than through the tree's own.
  world.profileDir = profileDir
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  const dependencies = {}
  const bundles = []
  for (const name of [MARKDOWN, PANEL]) {
    const manifest = world.manifest[name]
    dependencies[name] = 'link:' + manifest.dir.replaceAll('\\', '/')
    bundles.push(name)
    if (!existsSync(manifest.dir)) continue
    const link = join(profileDir, 'node_modules', name)
    try { rmSync(link, { recursive: true, force: true }) } catch { /* nothing was there */ }
    symlinkSync(manifest.dir, link, 'junction')
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies, dsh: { profile: { bundles } } }, null, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.yml'), '# gate 121 staged profile: exactly the two bundles under test, composed by the real loader\n[]\n')
  if (!existsSync(KERNEL_CLI)) { world.composeError = 'the kernel CLI is not on this machine: ' + KERNEL_CLI; return }
  const started = Date.now()
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx/esm', KERNEL_CLI, '--profile', 'web', '--dump-config'], {
      cwd: KERNEL, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, DSH_HOME: home },
    })
    world.compose = { exit: 0, stdout, stderr: '', ms: Date.now() - started }
  } catch (error) {
    world.compose = {
      exit: error.status === undefined ? null : error.status,
      stdout: String(error.stdout === undefined ? '' : error.stdout),
      stderr: String(error.stderr === undefined ? '' : error.stderr),
      ms: Date.now() - started,
    }
  }
}

/** Read the composed dump: sections are headed "# == <bundle>", root rows are unindented ids. */
function parseDump(text) {
  const sections = []
  let current = null
  let last = null
  for (const line of text.split(/\r?\n/)) {
    const header = /^# == (.+?)\s*$/.exec(line)
    if (header !== null) { current = { bundle: header[1], rows: [] }; sections.push(current); last = null; continue }
    const id = /^- id: (.+?)\s*$/.exec(line)
    if (id !== null) {
      if (current === null) { current = { bundle: '(no section)', rows: [] }; sections.push(current) }
      last = { id: id[1].replace(/^['"]|['"]$/g, ''), name: null }
      current.rows.push(last)
      continue
    }
    const name = /^\s+name: (.+?)\s*$/.exec(line)
    if (name !== null && last !== null && last.name === null) last.name = name[1].replace(/^['"]|['"]$/g, '')
  }
  return sections
}

/** The vocabulary a package publishes (kinds, sinks), read from its own exports or its own patch. */
function discoverVocabulary(ns, pattern, patchPath, key) {
  if (ns !== null) {
    for (const [name, value] of Object.entries(ns)) {
      if (pattern.test(name) === false) continue
      if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) return { value: [...value], source: 'the package exports ' + name }
      if (value !== null && typeof value === 'object' && Array.isArray(value[key]) && value[key].length > 0 && value[key].every((item) => typeof item === 'string')) return { value: [...value[key]], source: 'the package exports ' + name + '.' + key }
    }
  }
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, 'utf8')
    const block = new RegExp('^[ \\t]*' + key + 's?:[ \\t]*\\[([^\\]]*)\\]', 'm').exec(text)
    if (block !== null) {
      const value = block[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter((item) => item !== '')
      if (value.length > 0) return { value, source: 'the package own cordis.patch.yml' }
    }
  }
  return { value: [], source: 'none' }
}

/** Write the registry probe into the run dir and run it, because the kernel router is TypeScript. */
function runRegistryProbe(runDir, markdown, panel) {
  if (!existsSync(TAB_REGISTRY)) return { error: 'the kernel tab registry is not on this machine: ' + TAB_REGISTRY, value: null }
  if (!existsSync(TEXT_BUNDLE)) return { error: 'the kernel text bundle is not on this machine: ' + TEXT_BUNDLE, value: null }
  const probePath = join(runDir, 'registry-probe.mjs')
  const inputPath = join(runDir, 'registry-probe.json')
  writeFileSync(probePath, PROBE_SOURCE + '\n')
  // Each half is handed over on its own terms: a null here means "there is no built half to drive",
  // which the probe reports as that half not having run rather than as the other half failing.
  writeFileSync(inputPath, JSON.stringify({ registry: TAB_REGISTRY, textBundle: TEXT_BUNDLE, markdown, panel, addresses: ADDRESS }, null, 1))
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx/esm', probePath, inputPath], { cwd: KERNEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('@@GATE121@@'))
    if (line === undefined) return { error: 'the registry probe printed no result line', value: null }
    return { error: null, value: JSON.parse(line.slice('@@GATE121@@'.length)) }
  } catch (error) {
    return { error: 'the registry probe failed: ' + describe(error) + ' ' + clip(String(error.stderr === undefined ? '' : error.stderr).trim(), 300), value: null }
  }
}

/** One citation run: the checker's exit code and the N of M the checker itself printed. */
function runCitationChecker(pagePath) {
  if (!existsSync(PAGE_CHECKER)) return { path: pagePath, exit: null, total: null, holds: null, stdout: '', error: 'the checker is not on this machine: ' + PAGE_CHECKER }
  const counts = (stdout) => {
    const match = /(\d+) of (\d+) citation\(s\) hold/.exec(stdout)
    return match === null ? { total: null, holds: null } : { holds: Number(match[1]), total: Number(match[2]) }
  }
  try {
    const stdout = execFileSync(process.execPath, [PAGE_CHECKER, '--page', pagePath], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return { path: pagePath, exit: 0, stdout, error: null, ...counts(stdout) }
  } catch (error) {
    const stdout = String(error.stdout === undefined ? '' : error.stdout)
    return { path: pagePath, exit: error.status === undefined ? null : error.status, stdout, error: describe(error), ...counts(stdout) }
  }
}

async function buildWorld(root, runDir) {
  const world = {
    root, runDir, profileDir: null, fatal: null, buildMissing: [], unresolvable: [], composeError: null,
    manifest: {}, host: {}, patch: {}, clientError: null, compose: null, sections: [], probe: null, page: null,
    panel: { projectPanel: null, keys: [], kinds: { value: [], source: 'none' }, sinks: { value: [], source: 'none' } },
  }
  world.manifest[MARKDOWN] = readManifest(root, MARKDOWN)
  world.manifest[PANEL] = readManifest(root, PANEL)
  world.patch[MARKDOWN] = readRowPatch(world.manifest[MARKDOWN])
  world.patch[PANEL] = readRowPatch(world.manifest[PANEL])

  for (const name of [MARKDOWN, PANEL]) world.host[name] = await importHostHalf(world, world.manifest[name], runDir)

  const declared = clientExportOf(world.manifest[MARKDOWN])
  const markdownArtifact = declared === null ? null : join(world.manifest[MARKDOWN].dir, declared)
  if (markdownArtifact !== null && !existsSync(markdownArtifact)) world.buildMissing.push(markdownArtifact)
  // The panel's client half is not pushed into buildMissing: its absence is a red M2 (the manifest
  // declares a half that is not built), not an unmeasurable world, because the host-side readings
  // below it never need those bytes.
  const panelDeclared = clientExportOf(world.manifest[PANEL])
  const panelArtifact = panelDeclared === null ? null : join(world.manifest[PANEL].dir, panelDeclared)
  const driveable = (path) => path !== null && existsSync(path)
  if (driveable(markdownArtifact) || driveable(panelArtifact)) {
    const probe = runRegistryProbe(runDir, driveable(markdownArtifact) ? markdownArtifact : null, driveable(panelArtifact) ? panelArtifact : null)
    world.probe = probe.error === null ? probe.value : { ok: false, why: probe.error }
  }

  composeRows(world, runDir)
  if (world.compose !== null && world.compose.exit === 0) world.sections = parseDump(world.compose.stdout)

  const panelModule = world.host[PANEL].ns
  world.panel.keys = world.host[PANEL].keys
  if (panelModule !== null) {
    if (typeof panelModule.projectPanel === 'function') world.panel.projectPanel = panelModule.projectPanel
    else {
      for (const value of Object.values(panelModule)) {
        if (value !== null && typeof value === 'object' && typeof value.projectPanel === 'function') { world.panel.projectPanel = value.projectPanel; break }
      }
    }
    const patchPath = join(root, 'plugins', PANEL, 'cordis.patch.yml')
    world.panel.kinds = discoverVocabulary(panelModule, /kinds?$/i, patchPath, 'kind')
    world.panel.sinks = discoverVocabulary(panelModule, /sinks?$/i, patchPath, 'sink')
  }
  if (world.panel.kinds.value.length === 0) world.panel.kinds = { value: ['gate121'], source: 'the gate own fallback: the package exports no kind vocabulary' }
  if (world.panel.sinks.value.length === 0) world.panel.sinks = { value: ['gate121-sink'], source: 'the gate own fallback: the package exports no sink vocabulary' }

  world.page = runCitationChecker(join(root, PAGE_REL))

  if (world.buildMissing.length > 0) { world.fatal = 'the build is missing, so nothing below it can be measured: ' + world.buildMissing.join(', ') + ' - run: node plugins/build.mjs'; return world }
  if (world.unresolvable.length > 0) { world.fatal = 'a host half names specifiers this gate cannot resolve offline: ' + world.unresolvable.map((item) => item.artifact + ' -> ' + item.specifiers.join(', ')).join('; '); return world }
  // An instrument that is not on this machine is the third state too: it is not the subject's fault,
  // and a reading taken without it would be a reading taken without its ruler.
  for (const [instrument, path] of [['the kernel tab registry', TAB_REGISTRY], ['the kernel text bundle', TEXT_BUNDLE], ['the citation checker', PAGE_CHECKER]]) {
    if (!existsSync(path)) { world.fatal = instrument + ' is not on this machine: ' + path; return world }
  }
  if (world.composeError !== null) { world.fatal = world.composeError; return world }
  if (world.compose !== null && world.compose.exit !== 0) { world.fatal = 'the real loader could not compose the gate-owned profile: exit ' + show(world.compose.exit) + ' - ' + clip(world.compose.stderr.trim(), 400); return world }
  return world
}

/**
 * Resolve a composed row's module specifier from the profile's own resolution base.
 *
 * This is the first link of the kernel's delivery chain: the loader mounts a row by resolving its
 * `name`, and the package that specifier reaches is the one whose manifest the client scan reads.
 * The owning manifest is the nearest ancestor of the resolved entry that declares the name.
 * @param profileDir - the composed profile directory (the base the loader composed the row from).
 * @param specifier - the row's module specifier, as the loader's own dump spells it.
 * @returns the manifest path, the entry it resolved through, or why neither could be had.
 */
function resolveRowPackage(profileDir, specifier) {
  const base = join(profileDir, 'package.json')
  if (!existsSync(base)) return { manifest: null, entry: null, error: 'the composed profile carries no package.json at ' + base }
  let entry = null
  try {
    entry = createRequire(base).resolve(specifier)
  } catch (error) {
    return { manifest: null, entry: null, error: 'the row specifier ' + show(specifier) + ' does not resolve from ' + profileDir + ': ' + describe(error) }
  }
  let at = dirname(entry)
  for (let step = 0; step < 12; step += 1) {
    const candidate = join(at, 'package.json')
    if (existsSync(candidate)) {
      try {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
        if (manifest !== null && typeof manifest === 'object' && manifest.name === specifier) return { manifest: candidate, entry, error: null }
      } catch { /* a manifest this gate cannot parse is not the one that owns the row */ }
    }
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return { manifest: null, entry, error: 'no ancestor manifest of ' + String(entry) + ' declares the name ' + show(specifier) }
}

/**
 * The composition's own delivery of one package's client half (M2 fact 3).
 *
 * Three links in the order the kernel's client scan takes them: the row the real loader composed
 * carries the package name; that name resolves from the composed profile's own base to a package
 * whose manifest declares the web client face; and the bundle that manifest exports is the very
 * bytes this gate was handed to run. Nothing here reads the tree's own manifest on trust - the
 * chain starts at the loader's answer and ends at the bytes served from the profile's resolution,
 * so a tree with a client half that the composition does not deliver reddens this fact alone.
 * @param world - the composed world.
 * @param name - the bundle name the profile declares.
 * @param artifact - the client artifact the tree's manifest names, for the byte comparison.
 * @returns whether the delivery held, and the rows that say so either way.
 */
function deliveredClientHalf(world, name, artifact) {
  const rows = []
  const patch = world.patch[name]
  const section = world.sections.find((candidate) => candidate.bundle === name)
  const row = section === undefined || patch === null ? undefined : section.rows.find((candidate) => candidate.id === patch.id)
  if (row === undefined) return { ok: false, rows: ['the composed profile carries no row ' + show(patch === null ? null : patch.id) + ' in section ' + show(name) + ', so no row delivers this client half'] }
  rows.push('the composed row is ' + show(row) + ' - the real loader own answer, read from its own dump')
  if (row.name !== name) return { ok: false, rows: [...rows, 'the composed row names ' + show(row.name) + ' instead of ' + show(name) + ': the loader would resolve a package this composition does not deliver, so nothing here reaches this client half'] }
  if (world.profileDir === null) return { ok: false, rows: [...rows, 'the composed profile directory is unknown, so the loader own resolution base cannot be read'] }
  const located = resolveRowPackage(world.profileDir, row.name)
  if (located.manifest === null) return { ok: false, rows: [...rows, located.error] }
  rows.push('the row specifier resolves from the profile base through ' + String(located.entry) + ' to ' + located.manifest)
  let resolved = null
  try { resolved = JSON.parse(readFileSync(located.manifest, 'utf8')) } catch (error) { return { ok: false, rows: [...rows, 'the manifest the profile reaches cannot be read: ' + describe(error)] } }
  const client = resolved.dsh === undefined ? undefined : resolved.dsh.client
  const platform = client !== null && typeof client === 'object' ? client.platform : undefined
  if (platform !== 'web') return { ok: false, rows: [...rows, 'the package the profile reaches declares dsh.client=' + show(client === undefined ? null : client) + ': it is not a web client row, so nothing there is served as this half'] }
  const relative = clientExportOf({ json: resolved })
  const delivered = relative === null ? null : join(dirname(located.manifest), relative)
  if (delivered === null || !existsSync(delivered)) return { ok: false, rows: [...rows, 'the manifest the profile reaches declares exports["./client"]=' + show(relative) + ' and ' + (delivered === null ? 'there is no such file' : delivered + ' is not there') + ': the delivered half was never built'] }
  rows.push('the delivered half is ' + delivered + ' (' + String(statSync(delivered).size) + ' B), named by the manifest the profile own resolution reaches')
  const comparable = artifact !== null && existsSync(artifact)
  const identical = comparable ? readFileSync(delivered, 'utf8') === readFileSync(artifact, 'utf8') : false
  rows.push(comparable
    ? 'byte-identical to the artifact this gate ran: ' + show(identical)
    : 'the tree declares no artifact to compare bytes with: ' + show(artifact))
  return { ok: comparable && identical, rows }
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------
function judge(world) {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok, detail, evidence: evidence === undefined ? [] : evidence })

  // M1 -- the markdown package is a deliverable client row.
  {
    const manifest = world.manifest[MARKDOWN]
    const rows = []
    let ok = manifest.exists && manifest.json !== null
    rows.push('package.json: ' + (manifest.exists ? manifest.path : 'MISSING (' + manifest.error + ')') + (manifest.error === null || !manifest.exists ? '' : ' (' + manifest.error + ')'))
    if (ok) {
      const named = manifest.json.name === MARKDOWN
      const client = manifest.json.dsh === undefined ? undefined : manifest.json.dsh.client
      const platform = client === undefined || client === null ? undefined : client.platform
      const declared = clientExportOf(manifest)
      const artifact = declared === null ? null : join(manifest.dir, declared)
      const artifactExists = artifact !== null && existsSync(artifact)
      const loaded = world.probe !== null && world.probe.ok === true ? world.probe.markdown : null
      const loadedOk = loaded !== null && loaded.registeredId === MARKDOWN && loaded.hasApply === true && loaded.errors.length === 0
      const host = world.host[MARKDOWN]
      ok = named && platform === 'web' && declared !== null && artifactExists && loadedOk && host.exists && host.apply === true && host.error === null
      rows.push('name=' + show(manifest.json.name) + ' (frozen: ' + MARKDOWN + ')')
      rows.push('dsh.client.platform=' + show(platform) + ' (frozen: web)')
      rows.push('exports["./client"]=' + show(declared) + ' -> ' + (artifact === null ? '(none)' : artifact + (artifactExists ? ' exists ' + String(statSync(artifact).size) + ' B' : ' MISSING (run: node plugins/build.mjs)')))
      rows.push('the artifact loads into the module loader as ' + show(loaded === null ? null : loaded.registeredId) + ' with apply()=' + show(loaded === null ? null : loaded.hasApply) + (world.probe !== null && world.probe.ok === true ? '' : ' (the probe did not answer: ' + clip(world.probe === null ? 'not run' : world.probe.why, 200) + ')'))
      rows.push('host half ' + host.artifact + ' imports=' + show(host.exists && host.error === null) + ' keys=' + show(host.keys) + (host.error === null ? '' : ' error=' + clip(host.error, 200)))
    }
    add('M1', ok, 'the markdown package is a client row: manifest + a built lib/client.js that loads + a host half that imports', rows)
  }

  // M2 -- the panel package carries a browser half now, and the composition really delivers it.
  // Three facts, each with its own verdict line, each able to redden this reading alone: the
  // declaration, the built and runnable artifact, and the delivery the composed profile reaches.
  {
    const manifest = world.manifest[PANEL]
    const rows = []
    let ok = manifest.exists && manifest.json !== null
    rows.push('package.json: ' + (manifest.exists ? manifest.path : 'MISSING (' + manifest.error + ')') + (manifest.error === null || !manifest.exists ? '' : ' (' + manifest.error + ')'))
    const detail = 'the panel package is a client row: (1) the web client face, (2) exports["./client"] -> a built half that loads, (3) the composition delivering it, (4) the host side unchanged'
    if (ok) {
      const named = manifest.json.name === PANEL
      rows.push('name=' + show(manifest.json.name) + ' (frozen: ' + PANEL + ')')

      // (1) the web client face, declared by the manifest itself.
      const client = manifest.json.dsh === undefined ? undefined : manifest.json.dsh.client
      const declaredFace = client !== null && typeof client === 'object' && Array.isArray(client) === false
      const platform = declaredFace ? client.platform : undefined
      const faceOk = named && declaredFace && platform === 'web'
      rows.push('(1) the manifest web client face: dsh.client=' + show(client === undefined ? null : client) + ', platform=' + show(platform) + ' (frozen: an object whose platform is "web") ... ' + (faceOk ? 'DECLARED' : 'FAIL, the manifest declares no web client face'))

      // (2) exports["./client"] -> a BUILT lib/client.js: the file is there AND the module loader runs it.
      const declared = clientExportOf(manifest)
      const artifact = declared === null ? null : join(manifest.dir, declared)
      const artifactExists = artifact !== null && existsSync(artifact)
      const loaded = world.probe === null || world.probe.panel === undefined ? null : world.probe.panel
      const registrations = loaded === null || Array.isArray(loaded.definitions) === false || Array.isArray(loaded.slots) === false ? 0 : loaded.definitions.length + loaded.slots.length
      const whyNotRun = world.probe === null
        ? 'the registry probe did not run'
        : world.probe.panelError !== null && world.probe.panelError !== undefined
          ? world.probe.panelError
          : artifactExists ? 'the probe answered without this half' : 'there is no file at ' + String(artifact) + ' for the module loader to run'
      const loadedOk = loaded !== null && loaded.registeredId === PANEL && loaded.hasApply === true && loaded.errors.length === 0 && registrations > 0
      const artifactOk = named && declared !== null && artifactExists && loadedOk
      rows.push('(2) exports["./client"]=' + show(declared) + ' -> ' + (artifact === null ? '(no such export)' : artifact + (artifactExists ? ' exists ' + String(statSync(artifact).size) + ' B' : ' MISSING (run: node plugins/build.mjs)')))
      rows.push('    the module loader ran it as ' + show(loaded === null ? null : loaded.registeredId) + ', apply()=' + show(loaded === null ? null : loaded.hasApply) + ', errors=' + show(loaded === null ? null : loaded.errors) + ', ' + String(registrations) + ' registration(s)' + (loaded === null ? ' (this half did not run: ' + clip(whyNotRun, 240) + ')' : ''))
      if (loaded !== null) rows.push('    it registered ' + show(loaded.definitions) + ' and contributed to the seats ' + show(loaded.slotInjects))
      rows.push('    ... ' + (artifactOk ? 'BUILT AND LOADABLE' : 'FAIL, exports["./client"] does not reach a built half that runs and registers'))

      // (3) the composition delivers that half: the row, the profile own resolution, the same bytes.
      const delivery = deliveredClientHalf(world, PANEL, artifact)
      rows.push('(3) delivery through the composed profile ... ' + (delivery.ok ? 'DELIVERED' : 'FAIL'))
      for (const line of delivery.rows) rows.push('    ' + line)

      // (4) the host side, read exactly as before this round: the declared entry and the host half.
      const exportsRoot = manifest.json.exports === undefined || manifest.json.exports === null ? null : manifest.json.exports['.']
      const main = typeof manifest.json.main === 'string' ? manifest.json.main : (exportsRoot !== null && typeof exportsRoot === 'object' && typeof exportsRoot.default === 'string' ? exportsRoot.default : null)
      const entry = main === null ? null : join(manifest.dir, main)
      const entryExists = entry !== null && existsSync(entry)
      const host = world.host[PANEL]
      const hostOk = named && entryExists && host.exists && host.apply === true && host.error === null
      rows.push('(4) the host side: declared entry=' + show(main) + ' -> ' + (entry === null ? '(none)' : entry + (entryExists ? ' exists' : ' MISSING (run: node plugins/build.mjs)')))
      rows.push('    host half ' + host.artifact + ' imports=' + show(host.exists && host.error === null) + ' keys=' + show(host.keys) + (host.error === null ? '' : ' error=' + clip(host.error, 200)))

      ok = faceOk && artifactOk && delivery.ok && hostOk
      const missing = []
      if (!faceOk) missing.push('(1) the manifest web client face')
      if (!artifactOk) missing.push('(2) exports["./client"] -> a built lib/client.js that loads and registers')
      if (!delivery.ok) missing.push('(3) delivery through the composed profile')
      if (!hostOk) missing.push('(4) the declared host entry and a host half that imports')
      add('M2', ok, detail + (missing.length === 0 ? '' : ' | MISSING: ' + missing.join('; ')), rows)
    } else {
      add('M2', ok, detail + ' | MISSING: the package manifest itself', rows)
    }
  }

  // C1 / C2 -- the real loader composes the rows.
  for (const pair of [['C1', MARKDOWN], ['C2', PANEL]]) {
    const reading = pair[0]
    const name = pair[1]
    const rows = []
    const patch = world.patch[name]
    const compose = world.compose
    let ok = patch !== null && patch.exists && patch.id !== null && patch.name !== null && compose !== null && compose.exit === 0
    rows.push('the row the package declares: patch=' + show(patch === null ? null : patch.path) + ' id=' + show(patch === null ? null : patch.id) + ' name=' + show(patch === null ? null : patch.name))
    if (compose === null) {
      rows.push('the composition did not run')
      ok = false
    } else {
      rows.push('the loader: exit=' + String(compose.exit) + ' in ' + String(compose.ms) + ' ms over a gate-owned DSH_HOME (the live profile is neither read nor written)')
      const skips = []
      for (const match of String(compose.stderr).matchAll(/skipping profile bundle "([^"]+)"/g)) skips.push(match[1])
      if (skips.includes(name)) { ok = false; rows.push('the loader SKIPPED this bundle: ' + clip(String(compose.stderr).trim(), 400)) }
      const section = world.sections.find((candidate) => candidate.bundle === name)
      const row = section === undefined || patch === null ? undefined : section.rows.find((candidate) => candidate.name === name || candidate.id === patch.id)
      rows.push('composed sections=' + show(world.sections.map((candidate) => candidate.bundle)))
      rows.push('in section ' + show(name) + ' the row is ' + show(row === undefined ? null : row))
      ok = ok && section !== undefined && row !== undefined && row.name === name && patch !== null && row.id === patch.id
    }
    add(reading, ok, 'the real loader composes this package own row, inside the package own section', rows)
  }

  // D1 -- the frozen declaration, captured from the artifact's own apply().
  {
    const probe = world.probe
    const rows = []
    let ok = probe !== null && probe.ok === true && probe.markdown !== null
    if (!ok) {
      rows.push('the registry probe did not answer: ' + clip(probe === null ? 'not run' : probe.why, 400))
      rows.push('the world it needed: ' + TAB_REGISTRY + ' and ' + TEXT_BUNDLE)
    } else {
      const definitions = probe.markdown.definitions
      const markdown = definitions.filter((definition) => definition.kind === KIND)
      const text = definitions.filter((definition) => definition.kind === 'text')
      const one = markdown.length === 1 ? markdown[0] : null
      rows.push('the artifact registered ' + String(definitions.length) + ' tab type(s): ' + show(definitions.map((definition) => ({ id: definition.id, kind: definition.kind, priority: definition.priority, patterns: definition.patterns }))))
      rows.push('canOpen over the addresses: ' + show(probe.canOpen))
      rows.push('the kernel own builtin this must not take over: ' + show(probe.text))
      rows.push('apply() threw ' + String(probe.markdown.errors.length) + ' time(s): ' + show(probe.markdown.errors) + '; its log: ' + clip(probe.markdown.log.join(' | '), 260))
      ok = one !== null && one.priority === PRIORITY && same(one.patterns, PATTERNS) && one.canOpen === true && one.title === 'function'
        && probe.canOpen.md === true && probe.canOpen.mdmark === true && probe.canOpen.httpsMd === false && probe.canOpen.otherScheme === false
        && text.length === 0 && probe.markdown.errors.length === 0
    }
    add('D1', ok, 'the client half declares one kind markdown type with the frozen priority, patterns and scheme restriction, and no text takeover', rows)
  }

  // D2 -- PAIRED routing through the kernel's own registry.
  {
    const probe = world.probe
    const rows = []
    let ok = probe !== null && probe.ok === true
    if (!ok) {
      rows.push('the registry probe did not answer: ' + clip(probe === null ? 'not run' : probe.why, 400))
    } else {
      const md = probe.routes.md
      const txt = probe.routes.txt
      rows.push('claim(' + ADDRESS.md + ') = ' + show(md))
      rows.push('claim(' + ADDRESS.txt + ') = ' + show(txt))
      rows.push('candidates(.md) = ' + show(probe.candidates.md) + '; candidates(.txt) = ' + show(probe.candidates.txt))
      rows.push('the router: ' + TAB_REGISTRY + ', fed with the kernel own text definition ' + show(probe.text === null ? null : { id: probe.text.id, kind: probe.text.kind, priority: probe.text.priority, patterns: probe.text.patterns }))
      ok = md !== undefined && md.kind === KIND && txt !== undefined && txt.threw === undefined && txt.kind !== undefined && txt.kind !== KIND
    }
    add('D2', ok, 'PAIRED: the real router gives the .md address to markdown and the .txt address to something else', rows)
  }

  // P1..P4 -- the panel projection, a pure function.
  {
    const project = world.panel.projectPanel
    const rows = []
    rows.push('projectPanel: ' + (typeof project === 'function' ? 'reachable from the built host half' : 'NOT reachable from the built host half') + '; the host half exports ' + show(world.panel.keys))
    rows.push('the fixture vocabulary: kinds=' + show(world.panel.kinds.value) + ' (source: ' + world.panel.kinds.source + '), sinks=' + show(world.panel.sinks.value) + ' (source: ' + world.panel.sinks.source + ')')
    if (typeof project !== 'function') {
      for (const id of ['P1', 'P2', 'P3', 'P4']) add(id, false, 'the projection could not be measured: projectPanel is not reachable from the built host half public surface', rows)
    } else {
      const kind = world.panel.kinds.value[0]
      const sink = world.panel.sinks.value[0]
      const entries = [
        { id: 'gate121-a', kind, title: 'Alpha', source: sink, order: 30 },
        { id: 'gate121-b', kind, title: 'Beta', source: sink, order: 10 },
        { id: 'gate121-c', kind, title: 'Gamma', source: sink, order: 10 },
        { id: 'gate121-d', kind, title: 'Delta', source: sink, order: 20 },
      ]
      const asText = (value) => { try { return { text: JSON.stringify(value), error: null } } catch (error) { return { text: null, error: describe(error) } } }
      const call = (list) => { try { return { ok: true, value: project(list, { sinks: world.panel.sinks.value }) } } catch (error) { return { ok: false, error: describe(error) } } }
      const answerOf = (called) => called.ok ? (asText(called.value).text === null ? '(unserialisable: ' + asText(called.value).error + ')' : asText(called.value).text) : 'threw: ' + called.error
      const arraysOf = (value) => {
        const found = []
        const walk = (node, depth) => {
          if (depth > 3 || node === null || typeof node !== 'object') return
          if (Array.isArray(node)) { found.push(node); return }
          for (const child of Object.values(node)) walk(child, depth + 1)
        }
        walk(value, 0)
        return found
      }

      // P1 -- arrival order is not part of the projection.
      {
        const forward = call(entries)
        const backward = call([...entries].reverse())
        const rows1 = [...rows]
        rows1.push('forward  = ' + clip(answerOf(forward), 600))
        rows1.push('backward = ' + clip(answerOf(backward), 600))
        rows1.push('the fixture ties gate121-b and gate121-c on order=10, which is where an arrival-ordered fold shows')
        let ok = forward.ok && backward.ok
        if (ok) {
          const left = asText(forward.value)
          const right = asText(backward.value)
          const lists = arraysOf(forward.value)
          const nonEmpty = lists.some((list) => list.length > 0) || (Array.isArray(forward.value) && forward.value.length > 0)
          ok = left.text !== null && left.text === right.text && nonEmpty
          if (!nonEmpty) rows1.push('the projection carries NO entry for four entries: if this fixture vocabulary is not the product own, the fixture is wrong - a named red, not a pass')
        }
        add('P1', ok, 'PAIRED: the same entries in two arrival orders project byte-identically, and not to nothing', rows1)
      }

      // P2 -- a kind outside the closed set is refused by name.
      {
        const unknown = 'gate121-no-such-kind'
        const called = call([...entries, { id: 'gate121-x', kind: unknown, title: 'X', source: sink, order: 40 }])
        const text = answerOf(called)
        add('P2', text.includes(CODE_UNKNOWN) && text.includes(unknown), 'PAIRED: a kind outside the closed set is refused with ' + CODE_UNKNOWN + ' and the kind itself named', [...rows, 'the projection answered ' + clip(text, 600)])
      }

      // P3 -- a repeated id is refused by name.
      {
        const called = call([...entries, { id: 'gate121-a', kind, title: 'Alpha again', source: sink, order: 50 }])
        const text = answerOf(called)
        add('P3', text.includes(CODE_DUP) && text.includes('gate121-a'), 'PAIRED: a repeated id is refused with ' + CODE_DUP + ' and the id named', [...rows, 'the projection answered ' + clip(text, 600)])
      }

      // P4 -- the empty set is an empty list, not an error.
      {
        const called = call([])
        const lists = called.ok ? arraysOf(called.value) : []
        const ok = called.ok && (Array.isArray(called.value) ? called.value.length === 0 : lists.length > 0 && lists.every((list) => list.length === 0))
        add('P4', ok, 'the empty set is an empty list, not an error', [...rows, 'projectPanel([], {sinks}) answered ' + (called.ok ? clip(answerOf(called), 300) + ' with ' + String(lists.length) + ' list(s)' : 'by throwing: ' + called.error)])
      }
    }
  }

  // V1 -- the contract page's citations.
  {
    const page = world.page
    const rows = []
    const last = String(page.stdout).split(/\r?\n/).filter((line) => line.trim() !== '').slice(-1)[0]
    rows.push('check-protocol-page.mjs --page ' + page.path + ' -> exit ' + show(page.exit))
    rows.push('the checker printed: ' + clip(last, 200))
    if (page.total === null) rows.push('the checker printed no N of M citation(s) hold line' + (page.error === null ? '' : ' (' + clip(page.error, 200) + ')'))
    else rows.push('N=' + String(page.holds) + ' M=' + String(page.total) + ' (this reading requires N === M and M >= ' + String(MIN_CITATIONS) + ')')
    const ok = page.exit === 0 && page.total !== null && page.total >= MIN_CITATIONS && page.holds === page.total
    add('V1', ok, 'the contract page own citation table holds and carries at least ' + String(MIN_CITATIONS) + ' citations', rows)
  }

  return out
}

// ---------------------------------------------------------------------------
// Self-attack: one byte edit per mutant, applied to a staged copy, measured by the same judge.
// ---------------------------------------------------------------------------
const editFile = (path, transform) => {
  if (!existsSync(path)) return { applied: false, why: 'no such file: ' + path }
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === null || after === undefined) return { applied: false, why: 'no anchor this gate can locate in ' + path }
  if (after === before) return { applied: false, why: 'the located anchor changed no byte of ' + path }
  writeFileSync(path, after)
  return { applied: true, why: null }
}

/** Inject one statement just inside the projection own function head, whichever spelling it uses. */
const injectIntoProjection = (path, statement) => editFile(path, (text) => {
  const anchors = [
    /(?:export\s+)?(?:async\s+)?function\s+projectPanel\s*\([^)]*\)\s*\{/,
    /(?:export\s+)?(?:const|let|var)\s+projectPanel\s*=\s*(?:async\s+)?(?:function\s*)?\([^)]*\)\s*=>\s*\{/,
  ]
  for (const anchor of anchors) {
    const match = anchor.exec(text)
    if (match === null) continue
    return text.slice(0, match.index + match[0].length) + statement + text.slice(match.index + match[0].length)
  }
  return null
})

const MUTANTS = [
  {
    name: 'the-markdown-manifest-says-another-platform', expect: ['M1'],
    note: 'dsh.client.platform is what makes a client row',
    edit: (paths) => editFile(paths.markdownManifest, (text) => text.replace(/("platform"\s*:\s*)(["'])web\2/, '$1$2native$2')),
  },
  {
    name: 'the-panel-declared-entry-points-at-nothing', expect: ['M2'],
    note: 'fact (4): the declared host entry must resolve to a file that exists; nothing else reads that declaration offline',
    edit: (paths) => editFile(paths.panelManifest, (text) => text.replace(/(["'])((?:\.\/)?lib\/index\.js)\1/, '$1lib/index.gate121-absent.js$1')),
  },
  {
    name: 'the-panel-client-face-is-deleted', expect: ['M2'],
    note: 'fact (1): without the dsh.client declaration the package is not a web client row at all, so the composition would serve nothing for this row - the exports entry alone is not a client face',
    edit: (paths) => editFile(paths.panelManifest, (text) => {
      // The declaration is the member whose key is "client" inside dsh; remove exactly that member,
      // comma and braces included, so the rest of the manifest stays the JSON it was.
      const at = text.indexOf('"client"')
      if (at === -1) return null
      const open = text.indexOf('{', at)
      const comma = text.lastIndexOf(',', at)
      if (open === -1 || comma === -1) return null
      let depth = 0
      for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1
        else if (text[index] === '}') { depth -= 1; if (depth === 0) return text.slice(0, comma) + text.slice(index + 1) }
      }
      return null
    }),
  },
  {
    name: 'the-panel-client-bundle-points-at-nothing', expect: ['M2'],
    note: 'fact (2): the exported bundle must exist and must run; a manifest naming a file nobody built is not a delivered half, and the row would have nothing to serve',
    edit: (paths) => editFile(paths.panelManifest, (text) => text.replace(/(["'])((?:\.\/)?lib\/client\.js)\1/, '$1lib/client.gate121-absent.js$1')),
  },
  {
    name: 'the-markdown-row-stops-naming-its-package', expect: ['C1'],
    note: 'the loader composes what the patch says; the composed row must name the package the profile asked for',
    edit: (paths) => editFile(paths.markdownPatch, (text) => text.replace(/(name:\s*)dsh-link-markdown\b/, '$1dsh-link-markdown-gate121-absent')),
  },
  {
    name: 'the-panel-row-stops-naming-its-package', expect: ['C2', 'M2'],
    note: 'the same, for the second row - and this is also fact (3) of M2: the composed row is the anchor the delivery chain starts at, so a row naming a package the composition does not carry delivers no client half either',
    edit: (paths) => editFile(paths.panelPatch, (text) => text.replace(/(name:\s*)dsh-link-panel\b/, '$1dsh-link-panel-gate121-absent')),
  },
  {
    name: 'the-markdown-type-stops-being-markdown', expect: ['D1', 'D2'],
    note: 'the frozen kind, and with it the router verdict; the second anchor is the pattern list, the same claim by another spelling',
    edit: (paths) => editFile(paths.markdownClient, (text) => {
      // Three spellings of the same claim, in the order the artifact is likely to carry it: the kind
      // written at the registration, the kind held by the artifact own constant, and the pattern list
      // held by the artifact own constant. The first one that is there is the one that moves.
      const spellings = [
        /(kind\s*:\s*)(["'])markdown\2/,
        /([A-Za-z0-9_]*MARKDOWN[A-Za-z0-9_]*\s*=\s*)(["'])markdown\2/,
        /([A-Za-z0-9_]*MARKDOWN[A-Za-z0-9_]*\s*=\s*Object\.freeze\(\s*\[)[^\]]*(\])/,
      ]
      for (const spelling of spellings) {
        const match = spelling.exec(text)
        if (match === null) continue
        const replacement = match[0].includes('freeze') ? match[1] + '"*.gate121"' + match[2] : match[1] + match[2] + 'markdown-gate121' + match[2]
        return text.replace(match[0], replacement)
      }
      return null
    }),
  },
  {
    name: 'the-unknown-kind-code-is-renamed', expect: ['P2'],
    note: 'the refusal is judged by its frozen name, so renaming the code moves exactly that reading',
    edit: (paths) => editFile(paths.panelHost, (text) => text.includes(CODE_UNKNOWN) ? text.replaceAll(CODE_UNKNOWN, 'GATE121_UNKNOWN_KIND') : null),
  },
  {
    name: 'the-duplicate-id-code-is-renamed', expect: ['P3'],
    note: 'the same, for the other frozen code',
    edit: (paths) => editFile(paths.panelHost, (text) => text.includes(CODE_DUP) ? text.replaceAll(CODE_DUP, 'GATE121_DUP_ID') : null),
  },
  {
    name: 'the-projection-becomes-a-function-of-arrival', expect: ['P1', 'P3'],
    note: 'every entry is flattened to one order and given an arrival-dependent id, so an arrival-ordered fold cannot answer twice the same way - and the duplicate-id probe no longer sees its duplicate',
    edit: (paths) => injectIntoProjection(paths.panelHost, 'entries = Array.isArray(entries) ? entries.map((entry, index) => Object.assign({}, entry, { order: 0, id: String(entry.id) + "#" + String(index) })) : entries; '),
  },
  {
    name: 'the-empty-set-becomes-an-error', expect: ['P4'],
    note: 'the empty set is the one input whose answer is a list, not a refusal',
    edit: (paths) => injectIntoProjection(paths.panelHost, 'if (Array.isArray(entries) && entries.length === 0) throw new Error("gate121: this mutant refuses the empty set"); '),
  },
  {
    name: 'the-page-cites-the-line-after-the-one-it-read', expect: ['V1'],
    note: 'the checker resolves file:line against this repository, so only the staged page copy can move V1',
    edit: (paths) => editFile(paths.page, (text) => {
      const match = /(\|[^\n|]*\|[^\n|]*?):(\d+)(\s*\|)/.exec(text)
      if (match === null) return null
      return text.slice(0, match.index) + match[1] + ':' + String(Number(match[2]) + 1) + match[3] + text.slice(match.index + match[0].length)
    }),
  },
  { name: 'control-nothing-changed', expect: [], note: 'the harness must not move a reading on its own', edit: () => ({ applied: true, why: null }) },
]

/** Copy the three subjects into a staged root and return the paths a mutant may edit. */
function stageSubject(root) {
  for (const name of [MARKDOWN, PANEL]) {
    const source = join(PROJECT, 'plugins', name)
    if (!existsSync(source)) continue
    const target = join(root, 'plugins', name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  const pageSource = join(PROJECT, PAGE_REL)
  if (existsSync(pageSource)) {
    mkdirSync(dirname(join(root, PAGE_REL)), { recursive: true })
    cpSync(pageSource, join(root, PAGE_REL))
  }
  return {
    markdownManifest: join(root, 'plugins', MARKDOWN, 'package.json'),
    panelManifest: join(root, 'plugins', PANEL, 'package.json'),
    markdownPatch: join(root, 'plugins', MARKDOWN, 'cordis.patch.yml'),
    panelPatch: join(root, 'plugins', PANEL, 'cordis.patch.yml'),
    markdownClient: join(root, 'plugins', MARKDOWN, 'lib', 'client.js'),
    panelHost: join(root, 'plugins', PANEL, 'lib', 'index.js'),
    page: join(root, PAGE_REL),
  }
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
  console.log('  baseline in a staged copy of the subject: ' + String(baseReadings.length) + ' readings, ' + String(baseRed.length) + ' failed')
  clean(baseline)
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed.map((reading) => reading.id)))
    for (const reading of baseRed) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below is ONE byte edit in a staged copy of the subject, measured by the same judge:')
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  const runDir = freshRun(SELF_ATTACK ? 'attack' : 'run')
  try {
    if (SELF_ATTACK) return await runAttack(started)
    const world = await buildWorld(SUBJECT, runDir)
    if (world.fatal !== null) return NOT_MEASURED(world.fatal)
    console.log('        the subject: ' + join(SUBJECT, 'plugins', MARKDOWN) + ' and ' + join(SUBJECT, 'plugins', PANEL) + (SUBJECT === PROJECT ? ' (the tree itself)' : ' (a copy named by --subject)'))
    console.log('        the world: the real loader (' + KERNEL_CLI + ' --dump-config) over a gate-owned DSH_HOME, the real router (' + TAB_REGISTRY + ') fed by the artifacts own apply(), and ' + PAGE_CHECKER)
    console.log('        the composition: exit ' + show(world.compose === null ? null : world.compose.exit) + ' in ' + String(world.compose === null ? 0 : world.compose.ms) + ' ms, sections ' + show(world.sections.map((section) => section.bundle)))
    console.log('        the readings declared by this gate: ' + show(READINGS))
    const readings = judge(world)
    for (const reading of readings) {
      console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
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
