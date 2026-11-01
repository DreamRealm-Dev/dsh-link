#!/usr/bin/env node
/**
 * Gate 127 (R192) - panel-contribution: THE PANEL'S CONTRIBUTION SEAM IS A REAL CLIENT-PLANE SERVICE,
 * IT REFUSES BY THE HOST REGISTRY'S OWN THREE NAMES, IT DOES NOT DEPEND ON ARRIVAL ORDER, AND THE
 * NEW MARKER FIELD DOES NOT MOVE ONE BYTE OF THE OLD ONE.
 *
 * Subject: the two halves R192-contract.md section 2 declares. dsh-link-panel (P1) grows, in its
 * browser half, the contribution seam ctx.provide('linkPanel', { declare, entries }); the real
 * provider this round is dsh-lan-bridge (P2), which injects the seam and declares one connection-status
 * item into it. (The contract calls the provider dsh-link-lan-bridge; the package on this tree, and the
 * id its own built bundle registers under, is dsh-lan-bridge, and that is the name this gate reads.)
 *
 * THE WORLD (nothing on the live machine is touched, and nothing is simulated that can be real):
 *
 *   (a) THE REAL CLIENT-PLANE DI. The seam is a cordis service, so the gate creates a REAL root Context
 *       from the pinned kernel's own vendored @deepseek-ai/cordis (vendor/cordis/lib/index.js) - the
 *       exact module identity packages/client/web/src/platform.ts seeds into the browser's frozen module
 *       table as @deepseek-ai/cordis - and plugs every half through ctx.plugin({ name, apply, inject }),
 *       which is the composition packages/client/web/src/boot-client.ts performs. Nothing hands a service
 *       to anybody: provide and inject are the library's own, a half whose injected service is missing
 *       STAYS PENDING, and the paired reading below is exactly that pending verdict.
 *   (b) THE REAL KERNEL LOCALE SERVICE. packages/client/locale's own SHIPPED bundle (lib/client.js) is run
 *       through the browser's module-loader registration point inside a vm and plugged as an ordinary
 *       cordis plugin, so the locale the panel half injects is the kernel's own LocaleRuntime instance,
 *       not a stub - the same instrument gate 125 drives.
 *   (c) THE REAL BROWSER MODULE LOADER, FOR EVERY HALF. plugins/<name>/lib/client.js is bytes on disk; the
 *       gate installs window.__ModuleLoader__.load, runs the shipped factory with a recording require, and
 *       hands the resulting apply/inject to cordis. The only substitutions are the browser platform, the
 *       seats the halves inject beside the seam (a recording slots and a recording sidebarRightTabs), a
 *       Proxy stub for connection, and the page's own fetch - and the fetch is a NAMED seat carrying FIXED
 *       bodies, because the marker readings need one fixed input.
 *   (d) THE HOST REGISTRY'S OWN RULE, READ AS DATA. plugins/dsh-link-panel's host half exports
 *       projectPanel / PANEL_REJECT / PANEL_KINDS; the gate imports the BUILT lib/index.js and asks it what
 *       the same four items are refused with, then holds the seam's answers to the host's. "One word list,
 *       no second one" (R192-contract section 1 ruling 1) is therefore measured against the registry that
 *       owns the words, never against this file's transcription of them.
 *
 * READINGS (each independently failable; a reading that cannot be measured is the NAMED third state,
 * never green):
 *   S1  THE SEAM IS A REAL PROVIDED SERVICE. The panel half's own apply() ran and the real store answers
 *       linkPanel; the provider's own bundle names linkPanel in its own inject array; with the panel
 *       plugged the provider's fiber reaches ACTIVE, and with the panel absent the SAME provider STAYS
 *       PENDING and names linkPanel as the missing service; the service's public face is printed (every own
 *       member with its type, so the method names are read and not assumed) and it carries the frozen pair
 *       declare (a function) and entries.
 *   R-DUP  A REPEATED ID IS REFUSED BY NAME - PANEL_DUP_ID - AND NO CLAIMANT WINS: two items claim one id,
 *       the id is admitted zero times, and the refusal count is printed.
 *   R-KIND A KIND OUTSIDE THE CLOSED SET IS REFUSED BY NAME - PANEL_UNKNOWN_KIND - AND THE OFFENDING KIND
 *       IS NAMED in the refusal's own detail.
 *   R-SRC  AN EMPTY SOURCE IS REFUSED BY NAME - PANEL_EMPTY_SOURCE.
 *   R-ORDER A NON-FINITE ORDER KEEPS ITS OWN TEXT: the refusal carries code null (no fourth name is
 *       invented for it) and its detail is about the order field.
 *   R-VOCAB THE FOUR ANSWERS ARE THE HOST REGISTRY'S OWN: for the same four inputs the host half's own
 *       projectPanel is asked the same question, and the seam's codes are held to the host's, code for
 *       code; no answer carries a name outside the host's own family.
 *   O1  ORDER-INDEPENDENT: the same four contributions arriving in two orders project to BYTE-IDENTICAL
 *       output (two of them tied on order, which is where an arrival-ordered fold shows), and to something,
 *       not to nothing.
 *   D1  DISPOSAL: the disposer declare() returned removes that one item and leaves every other item
 *       byte-identical, the provider's own item included.
 *   M1  THE MARKER GAINED A FIELD AND LOST NO SEMANTICS (the guard gate 124 owns). With one fixed route
 *       answer, globalThis.__dshLinkPanel.items is byte-identical to the route's declared.visible AND
 *       byte-identical to the same world with no contribution declared; the new contributed field reports
 *       the contribution; and the marker's field set is R191's frozen set (READ AS DATA out of gate 124's
 *       own bytes) plus contributed and nothing else.
 *   P1  THE PROVIDER REALLY CALLED declare. The call site is NAMED BY file:line in dsh-lan-bridge's BUILT
 *       artifact (the bytes are read, never transcribed), AND the call is observed arriving at the
 *       provider's own service object at runtime, AND the item it named is in the projection.
 *
 * R193 (contract section 2, the panel-action successor) makes the seam's action kind drawable - a button
 * that calls the provider's own invoke exactly once, shows what it threw, and refuses an action whose
 * invoke is not callable by the host's own pass-through rule (code null, its own text, no fourth name).
 * Five readings, in a world of their own (W-I), measure it. That world plugs the R193 real user of the
 * kind - dsh-browser, whose half declares one action into the same seam - and mounts the panel half's OWN
 * body component, the one it registers into the seat, through the shell's own React pin into a real DOM.
 * The click is a REAL DOM click through React's own event system, so "exactly once" is counted where it
 * happens: at the provider's own function, and at the navigation the provider's own action performs.
 *   I1  AN action ROW IS DRAWN AS A BUTTON. Every action row - the provider's own and the gate's two -
 *       offers a button (as the row's own element or inside it); the status control row offers none, so
 *       the kind decides the shape rather than every row being clickable.
 *   I2  ONE CLICK, EXACTLY ONE CALL. Before any click the gate's invoke has been called zero times and the
 *       provider has opened nothing (drawing a button is not running it); two clicks on the gate's action
 *       row arrive exactly twice; one click on the provider's own row reaches its own navigate exactly
 *       once and names the tab type that provider registered.
 *   I3  A THROWING INVOKE IS CAUGHT AND ITS OWN TEXT IS SHOWN IN THAT ROW. The click reaches the invoke
 *       exactly once, THAT row carries the original text, no other row carries it, every other row is
 *       byte-identical across the click, the page's own error channels stay silent, and the pane is still
 *       answering clicks afterwards.
 *   I4  AN ACTION WITH NO CALLABLE INVOKE KEEPS ITS OWN TEXT: refused with code null (no fourth name is
 *       invented) and a detail about the invoke field, not drawn - while the paired controls (a status row
 *       with no invoke, and an action WITH a callable) are admitted.
 *   I5  THE MARKER REPORTS THE CALLABLE AS A BOOLEAN: the marker's contributed rows say whether the row
 *       carries an invoke (true for both action rows, not true for the status control) and carry no
 *       function at all, so the marker stays readable data.
 *
 * MUTANTS (--self-attack): one edit per mutant in a STAGED COPY of the two packages, each measured by the
 * same judge, each anchored on the subject artifact's own bytes (the built lib/client.js). Five of them
 * stand inside the seam's own declare path and are aimed at the probe's own fixtures, so each moves exactly
 * the reading it declares: the unknown kind translated to the nearest known one (R-KIND), the two duplicate
 * claimants told apart (R-DUP), an empty source papered over (R-SRC), a non-finite order silently repaired
 * (R-ORDER), and the projection made a function of arrival (O1). The rest are anchored on bytes that must
 * be there: the frozen code literals (a second word list, which moves R-KIND and R-VOCAB), the ctx.provide
 * call that IS the seam (S1, and with it M1 and P1, because nothing else can be measured without it), the
 * artifact's own marker write (the marker re-merging the two sources, which is the one thing ruling 3
 * forbids, and which must move M1 alone), and the provider's own .declare( call (P1).
 * R193's mutants split the same way. Three are injected inside the seam's own declare head - the anchor
 * family the four refusal mutants already use - and each is aimed at one declaration rather than at the
 * whole path: an action with no callable invoke papered over, aimed at the two fixtures that carry none
 * (I4); the PROVIDER's own invoke made to arrive twice for one press, aimed at the one declaration this
 * gate did not write (I2); and that same row's kind rewritten to the plain-line kind, which is the one
 * edit that moves two readings - the button is missing (I1) and the click I2 dispatches on that row is
 * the very shape that went missing (I2 with I1). The other two are anchored on bytes the delivered
 * artifacts must carry: the catch inside the seam's own press(), unwrapped so a throwing invoke no longer
 * becomes that row's own text (I3), and the contributed property inside the marker's own object literal,
 * rebuilt without hasInvoke so the marker stops reporting the callable (I5). The seam-removal mutant
 * declares the five I readings as well, and honestly: with no service at all the pane world cannot be
 * driven, so no action row is drawn, nothing is declared into it and nothing is clicked - every one of
 * the five is red in that world on its own terms, not carried along by a click that misbehaved.
 *
 * A mutant that edits bytes must LAND, and the two spellings that do not are named here: wrapping the
 * returned exports (esbuild's CJS exports are accessor properties that Object.defineProperty cannot swap,
 * so the wrapper is a silent no-op that declares a reading it never moved), and repairing the marker from
 * a timer after the fact (a race with the judge's own settle window, so it lands on some machines and not
 * others). Every mutant here edits bytes the artifact itself reads on its own synchronous path, or it is
 * printed NOT APPLICABLE and the reading it was to cover counts as uncovered.
 * Every reading that is a green claim must be declared by at least one mutant; a mutant whose anchor is not
 * in the artifact is printed NOT APPLICABLE and the reading it was to cover counts as uncovered.
 *
 * WHAT THIS GATE CANNOT JUDGE (named, never reported as a pass): whether the LIVE page carries these
 * bundles, whether the live marker carries contributed, and what any of it looks like - gates 122/124 and
 * the live render gate own that, and this gate never connects to 31761/31760/9222, never opens a panel and
 * spends no model round. Nor does it judge the seam's wiring into what the pane DRAWS (the tab body still
 * draws the route's items; whether a contributed row is drawn is the live render gate's subject), the
 * contributions of any package other than dsh-lan-bridge, or whether entries is the right name for the
 * second member (the frozen pair is held as frozen; a delivery that renames it is a red S1, not a silent
 * pass).
 *
 * Exit 0 every reading held | 1 a reading failed (or a declared mutant set did not match what moved)
 * | 3 the subject cannot be measured here, BY NAME: a package, its built client half, the pinned kernel's
 * cordis or locale bundle, the host half, or the host registry's own word list is missing, or the probe
 * could not run at all. An artifact that IS built but does not provide the seam is NOT exit 3: that is a
 * red S1 with the dependent readings named as the third state, because the subject is there to be judged.
 * A gate 124 that no longer spells its frozen marker field list as data degrades ONE clause of M1 - that
 * clause is printed as a named third state inside the reading - and it is never a silent pass.
 *
 * Usage: node scripts/verify-panel-contribution.mjs [--self-attack] [--keep] [--subject <dir>]
 *   --subject <dir> measures plugins/<name>/* inside that tree while the instruments (the kernel, the
 *   probe and gate 124) stay this tree's: it is how a COPY of a declared package can be falsified without
 *   touching the delivered one, and it is also the tree --self-attack stages its mutants from.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
/** The tree whose plugins/ are measured; the instruments stay this tree's. */
const SUBJECT = resolve(option('--subject', PROJECT))

/** The two declared packages (R192-contract section 2). */
const PANEL = 'dsh-link-panel'
const PROVIDER = 'dsh-lan-bridge'
/**
 * The R193 real user of the `action` kind: dsh-browser declares one action into the same seam, and its
 * half is what this gate renders a button for. Its absence is a NAMED third state for the I readings, not
 * a reason to refuse the whole subject: the R192 readings are about the other two packages.
 */
const BROWSER = 'dsh-browser'
/** The kind the button belongs to, and the status kind the paired control row is drawn with. */
const ACTION_KIND = 'action'
const STATUS_KIND = 'status'
/**
 * The marker field R193 adds: whether a contributed row carries a callable, reported as a BOOLEAN
 * (R193-contract section 2, P1: the function itself must not travel into the marker - it is readable data).
 */
const HAS_INVOKE = 'hasInvoke'
/** The provider's own navigation, as the shell names it: `ctx.sidebarRight.openTab(kind, options?)`. */
const OPEN_TAB = 'openTab'
/** The service name the seam is provided under, and the frozen member pair it must carry. */
const SEAM = 'linkPanel'
const SEAM_MEMBERS = ['declare', 'entries']
/** The marker field R192 adds, and the marker itself (the key R189 froze, and gate 124 reads). */
const CONTRIBUTED = 'contributed'
const MARKER_KEY = '__dshLinkPanel'
/** The three names the host registry owns; the seam must reuse them and invent no fourth (ruling 1). */
const CODE_DUP = 'PANEL_DUP_ID'
const CODE_KIND = 'PANEL_UNKNOWN_KIND'
const CODE_SOURCE = 'PANEL_EMPTY_SOURCE'

const CORDIS_BUNDLE = join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js')
const LOCALE_BUNDLE = join(KERNEL, 'packages', 'client', 'locale', 'lib', 'client.js')
const GATE124 = join(PROJECT, 'scripts', 'verify-panel-live.mjs')
const SCRATCH_REL = join('.tmp', 'r192-g127')

const READINGS = ['S1', 'R-DUP', 'R-KIND', 'R-SRC', 'R-ORDER', 'R-VOCAB', 'O1', 'D1', 'M1', 'P1', 'I1', 'I2', 'I3', 'I4', 'I5']

/** The probe's own fixtures. Every id is prefixed, so nothing here can collide with a delivered item. */
const UNKNOWN_KIND = 'gate127-no-such-kind'
const ID_DUP = 'gate127-dup'
const ID_KIND = 'gate127-kind'
const ID_SOURCE = 'gate127-source'
const ID_ORDER = 'gate127-order'
const ID_M1 = 'gate127-contributed'
const ID_D1 = ['gate127-d1-x', 'gate127-d1-y', 'gate127-d1-z']
const ID_ARRIVAL = ['gate127-arrival-a', 'gate127-arrival-b', 'gate127-arrival-c', 'gate127-arrival-d']
/**
 * R193's own fixtures, every id prefixed so nothing here can collide with a delivered item. The throwing
 * one carries the text this gate will look for in the row it belongs to, and nowhere else.
 */
const ID_ACTION = 'gate127-action'
const ID_THROW = 'gate127-action-throw'
const ID_NOINVOKE = 'gate127-action-no-invoke'
const ID_BADINVOKE = 'gate127-action-bad-invoke'
const ID_STATUS = 'gate127-status'
const THROW_TEXT = 'gate127 invoke refused: the action row was handed a broken tab'
const BAD_INVOKE = 'gate127: this is not a function'

/** The one item the marker world contributes, and the route answer every marker world is given. */
const CONTRIBUTED_ITEM = { id: ID_M1, kind: 'status', title: 'gate127 contributed item', source: 'gate127', order: 7 }
const ROUTE_VISIBLE = [
  { id: 'link-panel', kind: 'pane', title: 'LINK panel', source: 'dsh-link-panel', order: 40 },
]
const PANEL_ROUTE_PATH = '/api/dsh-link-panel/state'
const NOTES_ROUTE_PATH = '/api/dsh-link-notes/state'
const NOTES_LIMITS = { maxNotes: 200, maxChars: 100 }

/** One contribution as the probe hands it to declare(), in the order the contract names the fields. */
const contribution = (id, kind, source, order, title) => ({ id, kind, title, source, order })

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const slug = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_')
const readText = (path) => { try { return readFileSync(path, 'utf8') } catch { return null } }
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

// ---------------------------------------------------------------------------
// The instruments this tree owns, read as DATA: the host registry's own word list and kind set, and
// gate 124's frozen marker field list. A file this gate cannot read is a named exit 3, never a guess.
// ---------------------------------------------------------------------------
/** The host half's builder, by the manifest's own declaration, or the conventional path. */
function hostHalfOf(root) {
  const manifestText = readText(join(root, 'plugins', PANEL, 'package.json'))
  if (manifestText === null) return { path: null, why: 'no package.json for ' + PANEL + ' under ' + root }
  let manifest = null
  try { manifest = JSON.parse(manifestText) } catch (error) { return { path: null, why: 'the manifest is not JSON: ' + describe(error) } }
  const main = manifest.main === undefined ? null : manifest.main
  const rel = typeof main === 'string' ? main : 'lib/index.js'
  const path = join(root, 'plugins', PANEL, rel.replace(/^\.\//, ''))
  return { path, why: null }
}

/** Read the host half's own three refusal names and closed kind set, from its source or its build. */
function hostVocabulary(root) {
  const candidates = [join(root, 'plugins', PANEL, 'src', 'index.ts'), hostHalfOf(root).path].filter((path) => path !== null)
  for (const path of candidates) {
    const text = readText(path)
    if (text === null) continue
    const kinds = /PANEL_KINDS[^=]*=\s*Object\.freeze\(\s*\[([^\]]*)\]/.exec(text)
    const names = /PANEL_REJECT\s*=\s*Object\.freeze\(\s*\{([\s\S]*?)\}\)/.exec(text)
    if (kinds === null || names === null) continue
    const kindList = [...kinds[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
    const named = {}
    for (const pair of names[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*['"]([^'"]+)['"]/g)) named[pair[1]] = pair[2]
    if (kindList.length === 0 || Object.keys(named).length === 0) continue
    return { path, kinds: kindList, codes: named, names: Object.values(named), why: null }
  }
  return { path: null, kinds: [], codes: {}, names: [], why: 'the host half of ' + PANEL + ' declares no PANEL_KINDS array and no PANEL_REJECT map this gate can read under ' + root }
}

/** Gate 124's frozen marker field list, read as data out of the guard this reading protects. */
function frozenMarkerFields() {
  const text = readText(GATE124)
  if (text === null) return { names: null, source: null, why: 'gate 124 is not on this tree: ' + GATE124 }
  const match = /Object\.keys\(value\)\.filter\(\(key\) => \[([^\]]*)\]\.includes/.exec(text)
  if (match === null) return { names: null, source: null, why: 'gate 124 no longer spells the frozen marker field list as an array literal, so R191 field set cannot be read as data' }
  const names = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((found) => found[1])
  if (names.length === 0) return { names: null, source: null, why: 'the array literal in gate 124 names no field' }
  const line = lineOf(text, match.index)
  return { names, source: 'scripts/verify-panel-live.mjs:' + String(line) + ' (gate 124 reading 3)', why: null }
}

/** The built client half a package's own manifest exports, or the conventional path when it names none. */
function clientBundleOf(root, name) {
  const text = readText(join(root, 'plugins', name, 'package.json'))
  const dir = join(root, 'plugins', name)
  if (text === null) return join(dir, 'lib', 'client.js')
  let manifest = null
  try { manifest = JSON.parse(text) } catch (error) { return join(dir, 'lib', 'client.js') }
  const entry = manifest.exports === undefined || manifest.exports === null ? undefined : manifest.exports['./client']
  const relative = typeof entry === 'string' ? entry : (entry !== null && typeof entry === 'object' && typeof entry.default === 'string' ? entry.default : null)
  return relative === null ? join(dir, 'lib', 'client.js') : join(dir, relative.replace(/^\.\//, ''))
}

/**
 * The pane instruments R193's world needs, read as data: the React pin the shell's module table seeds
 * (`react` and `react/jsx-runtime` are baseline specifiers of every client half, so a half that renders
 * imports them from the table) and a DOM to render into. The versions are read out of the manifests, so
 * the reading can say which React drew the pane rather than asserting one.
 *
 * `reactAnchor` and `kernelAnchor` are package.json paths: the probe resolves `react` from the first and
 * `jsdom` from the second, which is how the kernel's own client-subpackage tests get their DOM.
 * A missing one is a NAMED third state of the five I readings - never a silent pass and never a red: the
 * R192 readings are about other artifacts and stay judgeable without a DOM.
 */
function readManifestVersion(path) {
  const text = readText(path)
  if (text === null) return null
  try { const manifest = JSON.parse(text); return typeof manifest.version === 'string' ? manifest.version : null } catch { return null }
}

function paneInstruments() {
  const reactAnchor = join(PROJECT, 'package.json')
  const kernelAnchor = join(KERNEL, 'package.json')
  const react = { name: 'react', version: readManifestVersion(join(PROJECT, 'node_modules', 'react', 'package.json')) }
  const reactDom = { name: 'react-dom', version: readManifestVersion(join(PROJECT, 'node_modules', 'react-dom', 'package.json')) }
  const jsdom = { name: 'jsdom', version: readManifestVersion(join(KERNEL, 'node_modules', 'jsdom', 'package.json')) }
  const missing = [react, reactDom, jsdom].filter((entry) => entry.version === null).map((entry) => entry.name)
  return { react, reactDom, jsdom, reactAnchor, kernelAnchor, missing }
}

// ---------------------------------------------------------------------------
// The probe, as the child process runs it. It lives here as one string so the harness reads in one
// place; it never uses a template literal of its own, so this file stays quote-friendly.
// ---------------------------------------------------------------------------
const PROBE_SOURCE = String.raw`import { createContext, runInContext } from "node:vm"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const input = JSON.parse(readFileSync(process.argv[2], "utf8"))
const out = {
  ok: false, why: null, errors: [], locale: null, panel: null, provider: null, elsewhere: null,
  seam: null, refusals: [], projection: null, arrival: null, disposer: null, marker: null, host: null,
}

const STATE = ["pending", "loading", "active", "failed", "disposed", "unloading"]
const describe = (error) => String(error && error.message !== undefined ? error.message : error)
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {}, group() {}, groupEnd() {} }
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const settle = async (turns) => { for (let i = 0; i < (turns === undefined ? 24 : turns); i += 1) await wait(1) }
const isObject = (value) => value !== null && typeof value === "object"
const ownKeys = (value) => { try { return Object.keys(value) } catch (error) { return [] } }
const stateOf = (fiber) => STATE[fiber.state] === undefined ? String(fiber.state) : STATE[fiber.state]
/** The gate own spelling of a value, available INSIDE the probe too (the probe is its own module, so the
 *  helpers the gate file defines at top level are not in scope here; R193's clickRow needs one). */
const show = (value) => { try { return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(canonical(value)) } catch (error) { return describe(value) } }

/** Sorted-key, total clone: a value JSON cannot print is spelled out rather than dropped. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (isObject(value)) {
    const out = {}
    for (const key of ownKeys(value).slice().sort()) out[key] = canonical(value[key])
    return out
  }
  if (typeof value === "number" && Number.isFinite(value) === false) return String(value)
  if (typeof value === "function" || typeof value === "undefined") return null
  return value
}

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

/**
 * The browser module-loader registration point, stubbed: the artifact registers itself here.
 *
 * extra is the seat map the world installs on the sandbox (a fetch, say). The one key it may carry that
 * is NOT a global is require: the module-table lookup handed to the factory. W-I passes the shell own
 * React pin through it - react and react/jsx-runtime are baseline specifiers of every client half, so a
 * half that renders imports them from the table - and leaves every other specifier a stub.
 */
function loadBundle(path, extra) {
  const settings = extra === undefined ? {} : extra
  const installed = {}
  for (const key of ownKeys(settings)) { if (key !== "require") installed[key] = settings[key] }
  const code = readFileSync(path, "utf8")
  let captured = null
  const sandbox = Object.assign({
    console: quiet, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Math, JSON,
    URL, URLSearchParams,
    window: { __ModuleLoader__: { load(module) { captured = module } } },
    navigator: { userAgent: "gate127", language: "en", languages: ["en"] },
    location: { href: "http://gate127/" },
  }, installed)
  sandbox.globalThis = sandbox
  const context = createContext(sandbox)
  runInContext(code, context, { filename: path })
  if (captured === null) throw new Error("the artifact made no window.__ModuleLoader__.load registration: " + path)
  return { module: captured, sandbox, context, bytes: code.length }
}

/** The cordis module the browser's frozen module table seeds, imported once for every world. */
const cordisModule = await import(pathToFileURL(input.cordis).href)
const Context = cordisModule.Context

/** The world's seats beside the seam: named substitutions, each recording what it is given. */
function makeSeats() {
  const kept = { slots: [], slotInjects: [], tabs: [], installs: 0, pane: null, navigation: [] }
  return {
    kept,
    seats: {
      slots: {
        installLocale() { kept.installs += 1; return () => {} },
        inject(name, callback) { kept.slotInjects.push(String(name)); try { callback() } catch (error) { out.errors.push("slots.inject " + String(name) + ": " + describe(error)) } return () => {} },
        /**
         * A registration, kept whole: the component itself and the props face the registrant hands the
         * seat. The pane the I readings draw and click is looked up HERE rather than by a name this gate
         * chose, so a half that renames its props is still mounted.
         */
        register(a, b) {
          const held = {
            name: typeof a === "string" ? a : (a && a.name),
            key: typeof a === "string" ? b : (a && a.key),
            locale: typeof a === "object" && a !== null && typeof a.locale === "string" ? a.locale : null,
            component: typeof a === "string" ? null : b,
            props: null,
          }
          if (typeof a === "object" && a !== null && typeof a.inject === "function") {
            try { const given = a.inject(); held.props = given !== null && typeof given === "object" ? given : null } catch (error) { out.errors.push("slots.register " + String(held.name) + ": the registration own inject face threw: " + describe(error)) }
          }
          kept.slots.push(held)
          // The body seat of a pane: the one registration whose own inject face hands the pane its reads.
          if (held.name === "sidebar.right.pane.tab" && held.props !== null && typeof held.component === "function") kept.pane = held
          return () => {}
        },
        registerFactory() { return () => {} },
      },
      sidebarRightTabs: { register(definition) { kept.tabs.push(definition); return () => {} } },
      /**
       * The navigation controller the contract names for the provider's own invoke. Every way into the
       * column is recorded by name and by argument, so "one click reached it exactly once" is counted
       * where it lands rather than inferred from anything the half says about itself.
       */
      sidebarRight: {
        openTab(...args) { kept.navigation.push({ where: "openTab", args: args.map((value) => canonical(value)) }); return undefined },
        openTabFromTarget(...args) { kept.navigation.push({ where: "openTabFromTarget", args: args.map((value) => canonical(value)) }); return undefined },
        openResource(...args) { kept.navigation.push({ where: "openResource", args: args.map((value) => canonical(value)) }); return undefined },
      },
      connection: makeStub("connection"),
      remote: makeStub("remote"),
      configForms: {
        get(namespace) { return { namespace: String(namespace), getSnapshot: () => ({ value: undefined, revision: 0 }), subscribe: () => () => {}, set: () => undefined } },
        developerTools: { enabled: false },
      },
    },
  }
}

/** A root Context with the seats provided through the real service store. */
async function rootWithSeats() {
  const root = new Context()
  const world = makeSeats()
  root.plugin({ name: "gate127-seats", apply(ctx) { for (const name of ownKeys(world.seats)) ctx.provide(name, world.seats[name]) } })
  await settle(4)
  return { root, kept: world.kept }
}

/** The kernel's own shipped locale bundle, plugged as an ordinary cordis plugin. */
async function plugLocale(root) {
  const bundle = loadBundle(input.localeBundle)
  const exported = bundle.module.factory((specifier) => makeStub("require:" + String(specifier)))
  const fiber = root.plugin({ name: bundle.module.id, apply: exported.apply, inject: exported.inject })
  await settle(16)
  const service = root.get("locale")
  return {
    id: bundle.module.id, exports: ownKeys(exported), inject: exported.inject, state: stateOf(fiber),
    class: service === undefined ? null : (service.constructor === undefined ? null : service.constructor.name),
    locales: service === undefined ? null : service.getSnapshot().locales.map((entry) => entry.id),
  }
}

/** One shipped client half, run through the browser loader and plugged into the real context. */
async function plugHalf(root, path, extra) {
  const settings = extra === undefined ? {} : extra
  const bundle = loadBundle(path, settings)
  const lookup = typeof settings.require === "function" ? settings.require : ((specifier) => makeStub("require:" + String(specifier)))
  const exported = bundle.module.factory(lookup)
  const fiber = root.plugin({ name: bundle.module.id, apply: exported.apply, inject: exported.inject })
  await settle(20)
  return { id: bundle.module.id, exports: ownKeys(exported), inject: Array.isArray(exported.inject) ? exported.inject.slice() : null, fiber, state: stateOf(fiber), sandbox: bundle.sandbox, context: bundle.context, pendingOn: ownKeys(fiber.inject === undefined || fiber.inject === null ? {} : fiber.inject).filter((name) => root.get(name) === undefined) }
}

/** One row of the service's public face: every own member with its type, so methods are read, not assumed. */
function faceOf(service) {
  const face = []
  for (const key of ownKeys(service).slice().sort()) {
    let type = typeof service[key]
    if (type === "object" && service[key] !== null) type = Array.isArray(service[key]) ? "array" : "object"
    face.push({ name: key, type })
  }
  return face
}

/**
 * The recorder on the seam's own declare, and the walk of everything the service's public face answers.
 * A one-line wrapper: the artifact's own function does the work, the gate learns what it was asked.
 */
function bindSeam(root) {
  const service = root.get(input.seam)
  if (service === undefined || service === null) return null
  const state = { calls: [], returned: [], threw: [], wrapped: false, wrapError: null }
  try {
    const original = service.declare
    if (typeof original === "function") {
      const bound = original.bind(service)
      Object.defineProperty(service, "declare", {
        configurable: true, writable: true,
        value: function (definition) {
          state.calls.push(canonical(definition))
          try {
            const token = bound(definition)
            state.returned.push({ ok: true, token: typeof token, value: typeof token === "function" || token === undefined || token === null ? null : canonical(token) })
            return token
          } catch (error) {
            state.threw.push({ ok: false, message: describe(error) })
            throw error
          }
        },
      })
      state.wrapped = true
    }
  } catch (error) {
    state.wrapError = describe(error)
  }
  return { service, face: faceOf(service), state }
}

/** Every place a refusal or an accepted row can legitimately come from, in the order they are read. */
function harvest(value, acc, where, depth) {
  if (depth > 4 || value === null || value === undefined) return
  if (Array.isArray(value)) { for (const row of value) harvest(row, acc, where, depth + 1); return }
  if (!isObject(value)) return
  let code
  try { code = value.code } catch (error) { code = undefined }
  if (code === null || typeof code === "string") {
    let entry = null
    try { entry = isObject(value.entry) ? value.entry : null } catch (error) { entry = null }
    let id = null
    try { id = typeof value.id === "string" ? value.id : (entry !== null && typeof entry.id === "string" ? entry.id : null) } catch (error) { id = null }
    let detail = ""
    try { detail = String(value.detail === undefined ? (value.message === undefined ? "" : value.message) : value.detail) } catch (error) { detail = "" }
    acc.refused.push({ where, id, code: typeof code === "string" ? code : null, detail })
    return
  }
  let id = undefined
  let kind = undefined
  try { id = value.id; kind = value.kind } catch (error) { id = undefined }
  if (typeof id === "string" && typeof kind === "string") { acc.accepted.push({ where, row: canonical(value) }); return }
  for (const key of ownKeys(value)) {
    let inner
    try { inner = value[key] } catch (error) { inner = undefined }
    if (Array.isArray(inner)) harvest(inner, acc, where + "." + key, depth + 1)
  }
}

/** One contribution as this probe hands it to declare(), in the order the contract names the fields. */
const contribution = (id, kind, source, order, title) => ({ id, kind, title, source, order })
const ID_DUP = input.ids.dup
const ID_KIND = input.ids.kind
const ID_SOURCE = input.ids.source
const ID_ORDER = input.ids.order

const SEAM_READS = ["entries", "entry", "items", "list", "all", "current", "snapshot", "visible", "refused", "rejected", "refusals", "problems", "declared", "contributions", "state", "projection"]

/** Ask the service's own public face what it holds, printing every place that was read. */
function readService(service, state) {
  const acc = { accepted: [], refused: [], places: [] }
  const take = (where, value) => { acc.places.push(where); harvest(value, acc, where, 0) }
  for (let index = 0; index < state.returned.length; index += 1) take("declare#" + String(index + 1) + " returned", state.returned[index].value)
  for (let index = 0; index < state.threw.length; index += 1) take("declare#" + String(index + 1) + " threw", { code: null, detail: state.threw[index].message })
  for (const key of SEAM_READS) {
    let fn
    try { fn = service[key] } catch (error) { fn = undefined }
    if (typeof fn !== "function") continue
    try { take(key + "()", fn.call(service)) } catch (error) { acc.places.push(key + "() threw: " + describe(error)) }
  }
  for (const key of ownKeys(service)) {
    let value
    try { value = service[key] } catch (error) { continue }
    if (Array.isArray(value)) take("service." + key, value)
  }
  return acc
}

/** One declare() the probe makes, with whatever it answered, threw, or left behind. */
function declareOne(service, state, definition) {
  let threw = null
  let returned = null
  try { returned = service.declare(definition) } catch (error) { threw = describe(error) }
  return { threw, returned: typeof returned, read: readService(service, state), definition }
}

/** The rows a refusal reader found for one id, and every refusal shape it saw. */
function refusedFor(read, id) { return read.refused.filter((row) => row.id === id) }
function acceptedFor(read, id) { return read.accepted.filter((row) => row.row.id === id) }

// ---------------------------------------------------------------------------
// The world builders.
// ---------------------------------------------------------------------------
async function worldWithPanel(options) {
  const settings = options === undefined ? {} : options
  const world = await rootWithSeats()
  world.locale = await plugLocale(world.root)
  if (settings.panel !== false) {
    world.panel = await plugHalf(world.root, input.panelBundle, settings.fetch === undefined ? undefined : { fetch: settings.fetch })
  }
  world.seam = bindSeam(world.root)
  return world
}

// ---------------------------------------------------------------------------
// W-I: THE PANE, DRAWN AND CLICKED (R193). The panel half own body component - the one it registers into
// the seat - is mounted through the shell own React pin into a real DOM, and every click is a real DOM
// click through React own event system. The substitutions are named: the page own fetch (fixed bodies),
// the seats beside the seam, and the browser environment (the shell own React pin plus a DOM). Nothing
// here touches a live page, a port, or a client process.
// ---------------------------------------------------------------------------

/** The React pin and the DOM the pane is drawn with, or the named reason they are not here. */
function paneStack() {
  const versions = input.instrumentVersions === undefined ? {} : input.instrumentVersions
  try {
    const fromProject = createRequire(input.reactAnchor)
    const fromKernel = createRequire(input.kernelAnchor)
    const react = fromProject("react")
    const testUtils = fromProject("react-dom/test-utils")
    return {
      ok: true, why: null, versions,
      react,
      jsx: fromProject("react/jsx-runtime"),
      createRoot: fromProject("react-dom/client").createRoot,
      act: typeof react.act === "function" ? react.act : testUtils.act,
      JSDOM: fromKernel("jsdom").JSDOM,
      VirtualConsole: fromKernel("jsdom").VirtualConsole,
    }
  } catch (error) {
    return { ok: false, why: "the shell React pin or a DOM is not here: " + describe(error), versions }
  }
}

/** Every contributed row the pane drew, by its own id, with the node itself kept for the click. */
function drawnRows(document) {
  const found = {}
  const all = document.querySelectorAll("[data-panel-contributed-row]")
  for (let index = 0; index < all.length; index += 1) {
    const node = all[index]
    const tag = String(node.tagName === undefined ? "" : node.tagName).toLowerCase()
    const buttons = node.querySelectorAll("button")
    found[String(node.getAttribute("data-panel-contributed-row"))] = {
      id: String(node.getAttribute("data-panel-contributed-row")),
      tag,
      kind: node.getAttribute("data-panel-contributed-kind"),
      text: String(node.textContent === undefined ? "" : node.textContent),
      html: String(node.outerHTML === undefined ? "" : node.outerHTML),
      buttons: buttons.length + (tag === "button" ? 1 : 0),
      node,
    }
  }
  return found
}

/** One drawn row as data: the node itself never travels into the result. */
function rowSummary(row) {
  if (row === null || row === undefined) return null
  return { id: row.id, tag: row.tag, kind: row.kind, text: row.text, html: row.html, buttons: row.buttons }
}

/** The element a person clicks in one drawn row: the row itself when the row IS the button, else its button. */
function clickableOf(row) {
  if (row === null || row === undefined) return null
  if (row.tag === "button") return row.node
  const inside = row.node.querySelector("button")
  return inside === null ? null : inside
}

/** What the service own public face answers for each visible row: its own keys and what each holds. */
function rowFaces(service) {
  const faces = []
  if (service === null || service === undefined || typeof service.entries !== "function") return faces
  let rows = []
  try { rows = service.entries() } catch (error) { return faces }
  for (const row of rows) {
    const keys = []
    for (const key of ownKeys(row)) { let type = "unreadable"; try { type = typeof row[key] } catch (error) { type = "threw" } keys.push({ name: key, type }) }
    faces.push({ id: row === null ? null : row.id, kind: row === null ? null : row.kind, keys })
  }
  return faces
}

/** The marker as readable data, with the TYPE of every contributed field, so a function cannot hide. */
function markerFace(marker, field) {
  if (marker === null || marker === undefined) return null
  const contributed = marker.contributed
  const rows = []
  if (Array.isArray(contributed)) {
    for (const row of contributed) {
      const keys = []
      for (const key of ownKeys(row)) { let type = "unreadable"; try { type = typeof row[key] } catch (error) { type = "threw" } keys.push({ name: key, type }) }
      let flag = null
      try { flag = row === null ? null : row[field] } catch (error) { flag = null }
      rows.push({
        id: row === null || row === undefined ? null : row.id,
        kind: row === null || row === undefined ? null : row.kind,
        keys,
        reported: typeof flag === "function" ? "a function, not a boolean" : (flag === undefined ? "absent" : flag),
        reportedTrue: flag === true,
      })
    }
  }
  return { keys: ownKeys(marker), raw: String(JSON.stringify(marker)), isArray: Array.isArray(contributed), rows }
}

/** One drawn row click report. */
function landed(result, started, ended) {
  return { id: result.id, clicked: result.clicked, where: result.where === undefined ? null : result.where, why: result.why === undefined ? null : result.why, threw: result.threw === undefined ? null : result.threw, arrived: ended - started }
}

async function paneWorld() {
  const log = {
    ok: false, instrumentMissing: false, why: null, instrument: null, instrumentVersions: input.instrumentVersions,
    mount: null, rows: { before: null, throwBefore: null, throwAfter: null, final: null },
    clicks: [], counters: null, navigation: [], pageErrors: [], provider: null, providerActionId: null,
    seam: null, marker: null, language: null,
  }
  const stack = paneStack()
  if (stack.ok !== true) { log.instrumentMissing = true; log.why = stack.why; return log }
  log.instrument = { react: stack.react.version === undefined ? null : stack.react.version, reactDom: null, jsdom: null }
  if (input.instrumentVersions !== undefined) { log.instrument.reactDom = input.instrumentVersions.reactDom === undefined ? null : input.instrumentVersions.reactDom; log.instrument.jsdom = input.instrumentVersions.jsdom === undefined ? null : input.instrumentVersions.jsdom }

  // The fixed route answers, held until the pane mounts, so the marker is the live shape when it is read.
  const route = {}
  route.promise = new Promise((done) => { route.release = done })
  const bodyOf = (url) => (url === input.panelRoute.path ? input.panelRoute.body : (url === input.notesRoute.path ? input.notesRoute.body : null))
  const seat = async (url) => {
    await route.promise
    const body = bodyOf(url)
    if (body === null) return { status: 404, text: async () => JSON.stringify({ ok: false, error: { code: "NO_ROUTE", message: "gate127 has no such route" } }) }
    return { status: 200, text: async () => JSON.stringify(body) }
  }

  const world = await rootWithSeats()
  await plugLocale(world.root)
  const lookup = (specifier) => specifier === "react" ? stack.react : (specifier === "react/jsx-runtime" ? stack.jsx : makeStub("require:" + String(specifier)))
  const panel = await plugHalf(world.root, input.panelBundle, { fetch: seat, require: lookup })
  const seam = bindSeam(world.root)
  if (seam === null) { log.why = "the panel half provides no " + show(input.seam) + " in this world, so there is no table to declare an action into and nothing to draw"; return log }
  // The R193 real user of the kind, plugged AFTER the recorder so its own declaration is seen arriving.
  // The tab types registered BEFORE it belong to the panel half, so the provider own registration is
  // read as the slice that arrives with this plug - a page may (and here does) register more than one.
  const tabsBeforeProvider = world.kept.tabs.length
  const browser = await plugHalf(world.root, input.browserBundle, { require: lookup })

  const counters = { action: 0, throw: 0 }
  const thrower = () => {
    counters.throw += 1
    let error = null
    try { error = new (runInContext("Error", panel.context))(input.throwText) } catch (inner) { error = new Error(input.throwText) }
    throw error
  }
  const items = [
    { id: input.ids.action, kind: input.actionKind, title: "gate127 action row", source: "gate127", order: 30, body: "gate127 action body", invoke: () => { counters.action += 1 } },
    { id: input.ids.throw, kind: input.actionKind, title: "gate127 throwing action row", source: "gate127", order: 31, body: "gate127 throw body", invoke: thrower },
    { id: input.ids.noInvoke, kind: input.actionKind, title: "gate127 action with no invoke", source: "gate127", order: 32, body: "gate127 no invoke body" },
    { id: input.ids.badInvoke, kind: input.actionKind, title: "gate127 action with a non-callable invoke", source: "gate127", order: 33, body: "gate127 bad invoke body", invoke: input.badInvoke },
    { id: input.ids.status, kind: input.statusKind, title: "gate127 status row", source: "gate127", order: 34, body: "gate127 status body" },
  ]
  for (const item of items) {
    try { seam.service.declare(item) } catch (error) { out.errors.push("pane fixture declare threw (" + String(item.id) + "): " + describe(error)) }
  }
  const arrived = seam.state.calls.filter((call) => call !== null && typeof call.id === "string")
  const providerRows = arrived.filter((call) => call.kind === input.actionKind && String(call.id).startsWith("gate127") === false)
  const providerActionId = providerRows.length === 0 ? null : providerRows[0].id
  const read = readService(seam.service, seam.state)
  log.seam = {
    places: read.places,
    visible: read.accepted.map((row) => row.row),
    visibleIds: read.accepted.map((row) => row.row.id),
    refused: read.refused.map((row) => ({ id: row.id, code: row.code, detail: row.detail })),
    faces: rowFaces(seam.service),
  }
  const tabs = []
  for (const definition of world.kept.tabs.slice(tabsBeforeProvider)) {
    if (definition === null || typeof definition !== "object") continue
    tabs.push({ id: typeof definition.id === "string" ? definition.id : null, kind: typeof definition.kind === "string" ? definition.kind : null })
  }
  log.provider = {
    id: browser.id, state: browser.state, inject: browser.inject, pendingOn: browser.pendingOn,
    declaredActionIds: providerRows.map((call) => call.id), declaredIds: arrived.filter((call) => String(call.id).startsWith("gate127") === false).map((call) => call.id),
    tabs,
  }
  log.providerActionId = providerActionId

  // The DOM, and every channel a failure that was NOT caught would reach.
  const pageErrors = []
  const virtualConsole = new stack.VirtualConsole()
  virtualConsole.on("jsdomError", (error) => { pageErrors.push("jsdomError: " + describe(error)) })
  const dom = new stack.JSDOM("<!doctype html><html><body><div id=\"gate127-pane\"></div></body></html>", { virtualConsole, pretendToBeVisual: true })
  dom.window.addEventListener("error", (event) => { pageErrors.push("window.error: " + describe(event !== null && event !== undefined && event.message !== undefined ? event.message : event)) })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  try { Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true, writable: true }) } catch (error) { out.errors.push("the navigator seat could not be installed: " + describe(error)) }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const escaped = []
  process.on("uncaughtException", (error) => { escaped.push("uncaughtException: " + describe(error)) })
  process.on("unhandledRejection", (error) => { escaped.push("unhandledRejection: " + describe(error)) })

  const instance = world.root.get("locale")
  const held = world.kept.pane
  if (held === null || held === undefined) { log.why = "the panel half registered no body component into the sidebar.right.pane.tab seat, so there is no pane to draw"; return log }
  const translate = instance !== undefined && instance !== null && typeof instance.bind === "function" && held.locale !== null ? instance.bind(held.locale) : null
  const props = Object.assign({}, held.props === null ? {} : held.props, translate === null ? {} : { t: translate })
  const snapshot = instance !== undefined && instance !== null && typeof instance.getSnapshot === "function" ? instance.getSnapshot() : null
  log.language = snapshot !== null && snapshot !== undefined && snapshot.language !== undefined ? String(snapshot.language) : null
  log.mount = {
    component: typeof held.component.name === "string" ? held.component.name : "(anonymous)",
    key: held.key, locale: held.locale, props: ownKeys(props),
    heldProps: held.props === null ? [] : ownKeys(held.props),
  }
  const container = dom.window.document.getElementById("gate127-pane")
  const reactRoot = stack.createRoot(container)
  route.release()
  try {
    await stack.act(async () => { reactRoot.render(stack.react.createElement(held.component, props)); await settle(30) })
  } catch (error) {
    log.why = "the pane could not be mounted: " + describe(error)
    return log
  }

  const rowsNow = () => drawnRows(dom.window.document)
  const snapshotOf = () => {
    const rows = rowsNow()
    const summary = {}
    for (const key of ownKeys(rows)) summary[key] = rowSummary(rows[key])
    return { rows, summary }
  }
  const clickRow = async (id) => {
    const rows = rowsNow()
    const row = rows[id] === undefined ? null : rows[id]
    if (row === null) return { id: id, clicked: false, why: "no row carrying data-panel-contributed-row=" + show(id) + " was drawn" }
    const node = clickableOf(row)
    if (node === null) return { id: id, clicked: false, why: "the drawn row offers nothing to click: it is a " + row.tag + " with no button element in it" }
    let threw = null
    try {
      await stack.act(async () => { node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })); await settle(6) })
    } catch (error) { threw = describe(error) }
    return { id: id, clicked: true, where: row.tag === "button" ? "the row own element is the button" : "a button inside the row", threw }
  }

  const first = snapshotOf()
  log.rows.before = first.summary
  // What has run before a single click: drawing a button must not be calling anything.
  log.atRender = { counters: { action: counters.action, throw: counters.throw }, navigation: world.kept.navigation.length }
  const clicks = []
  if (providerActionId !== null) { const at = counters.action; const report = await clickRow(providerActionId); clicks.push(landed(report, at, counters.action)) }
  else clicks.push({ id: null, clicked: false, why: "the provider declared no " + show(input.actionKind) + " row, so there is nothing of ITS OWN to click", where: null, threw: null, arrived: 0 })
  { const at = counters.action; const report = await clickRow(input.ids.action); clicks.push(landed(report, at, counters.action)) }
  log.rows.throwBefore = snapshotOf().summary
  { const at = counters.throw; const report = await clickRow(input.ids.throw); clicks.push(landed(report, at, counters.throw)) }
  log.rows.throwAfter = snapshotOf().summary
  { const at = counters.action; const report = await clickRow(input.ids.action); clicks.push(landed(report, at, counters.action)) }
  await settle(10)
  log.rows.final = snapshotOf().summary
  log.clicks = clicks
  log.counters = counters
  log.navigation = world.kept.navigation
  log.pageErrors = pageErrors.concat(escaped)
  log.marker = markerFace(panel.sandbox === undefined ? null : panel.sandbox.__dshLinkPanel, input.hasInvoke)
  log.ok = true
  return log
}

const results = {}
try {
  // --- W-A: the seam, the provider, the four refusals and the disposer -------------------------
  const a = await worldWithPanel({})
  out.locale = a.locale
  out.panel = { id: a.panel.id, exports: a.panel.exports, inject: a.panel.inject, state: a.panel.state, pendingOn: a.panel.pendingOn, face: a.seam === null ? null : a.seam.face, provided: a.seam !== null }
  if (a.seam === null) {
    out.seam = { provided: false, name: input.seam }
  } else {
    const state = a.seam.state
    out.seam = {
      provided: true, name: input.seam, face: a.seam.face, wrapped: state.wrapped, wrapError: state.wrapError,
      methods: a.seam.face.filter((member) => member.type === "function").map((member) => member.name),
      members: a.seam.face.map((member) => member.name),
    }
    // The provider, plugged after the recorder is on, so what it declares arrives at THIS object.
    const provider = await plugHalf(a.root, input.providerBundle)
    const projection = readService(a.seam.service, state)
    out.projection = { accepted: projection.accepted.map((row) => row.row), places: projection.places, refused: projection.refused }
    out.provider = { id: provider.id, exports: provider.exports, inject: provider.inject, state: provider.state, pendingOn: provider.pendingOn, declaredAtRuntime: state.calls.map((call) => call === null ? null : call.id) }
    // The paired control: the SAME halves, with no panel in the world at all.
    const b = await rootWithSeats()
    await plugLocale(b.root)
    const alone = await plugHalf(b.root, input.providerBundle)
    out.elsewhere = { state: alone.state, pendingOn: alone.pendingOn, inject: alone.inject }
    // The four refusals, one declare each, and the projection after each.
    const probes = [
      { id: ID_DUP, why: "duplicate id", call: () => { a.seam.service.declare(contribution(ID_DUP, input.kinds[0], "gate127", 10, "claimant one")); a.seam.service.declare(contribution(ID_DUP, input.kinds[0], "gate127", 20, "claimant two")) } },
      { id: ID_KIND, why: "unknown kind", call: () => { a.seam.service.declare(contribution(ID_KIND, input.unknownKind, "gate127", 11, "unknown kind")) } },
      { id: ID_SOURCE, why: "empty source", call: () => { a.seam.service.declare(contribution(ID_SOURCE, input.kinds[0], "", 12, "no source")) } },
      { id: ID_ORDER, why: "non-finite order", call: () => { a.seam.service.declare(contribution(ID_ORDER, input.kinds[0], "gate127", Number.NaN, "not finite")) } },
    ]
    for (const probe of probes) {
      const before = state.calls.length
      try { probe.call() } catch (error) { out.errors.push(probe.why + " threw: " + describe(error)) }
      const read = readService(a.seam.service, state)
      const items = [ID_DUP, ID_KIND, ID_SOURCE, ID_ORDER].filter((id) => id === probe.id)
      const call = state.calls.slice(before).find((entry) => entry !== null && items.includes(entry.id)) === undefined ? null : state.calls.slice(before).find((entry) => entry !== null && items.includes(entry.id))
      out.refusals.push({ id: probe.id, why: probe.why, declared: state.calls.slice(before), refused: refusedFor(read, probe.id), accepted: acceptedFor(read, probe.id), places: read.places })
    }
    // The host half's own answer for the same three inputs, read from its own build.
    try {
      const host = await import(pathToFileURL(input.hostHalf).href)
      const shape = (rows) => rows.map((row) => ({ id: row.id, code: row.code, detail: row.detail }))
      out.host = {
        path: input.hostHalf, exports: ownKeys(host), kinds: host.PANEL_KINDS === undefined ? null : host.PANEL_KINDS,
        codes: host.PANEL_REJECT === undefined ? null : host.PANEL_REJECT,
        dup: shape(host.projectPanel([contribution(ID_DUP, input.kinds[0], "gate127", 10, "one"), contribution(ID_DUP, input.kinds[0], "gate127", 20, "two")]).rejected),
        kind: shape(host.projectPanel([contribution(ID_KIND, input.unknownKind, "gate127", 11, "k")]).rejected),
        source: shape(host.projectPanel([contribution(ID_SOURCE, input.kinds[0], "", 12, "s")]).rejected),
        order: shape(host.projectPanel([contribution(ID_ORDER, input.kinds[0], "gate127", Number.NaN, "o")]).rejected),
      }
    } catch (error) {
      out.host = { path: input.hostHalf, error: describe(error) }
    }
    // The disposer: three items in, one disposed, and the other two held to their own bytes.
    const before = state.calls.length
    const tokens = []
    for (let index = 0; index < input.disposerIds.length; index += 1) {
      const id = input.disposerIds[index]
      let token = null
      try { token = a.seam.service.declare(contribution(id, input.kinds[0], "gate127", 30 + index, "d1 " + id)) } catch (error) { out.errors.push("disposer declare threw: " + describe(error)) }
      tokens.push(token)
    }
    const readBefore = readService(a.seam.service, state)
    let disposeThrew = null
    let disposeKind = typeof tokens[1]
    try {
      if (typeof tokens[1] === "function") tokens[1]()
      else if (isObject(tokens[1]) && typeof tokens[1][Symbol.dispose] === "function") tokens[1][Symbol.dispose]()
      else disposeKind = "not-a-disposer"
    } catch (error) { disposeThrew = describe(error) }
    await settle(4)
    const readAfter = readService(a.seam.service, state)
    const rowOf = (read, id) => read.accepted.filter((row) => row.row.id === id).map((row) => row.row)
    out.disposer = {
      ids: input.disposerIds, disposeKind, disposeThrew,
      before: readBefore.accepted.map((row) => row.row), after: readAfter.accepted.map((row) => row.row),
      rowsBefore: input.disposerIds.map((id) => rowOf(readBefore, id)), rowsAfter: input.disposerIds.map((id) => rowOf(readAfter, id)),
      declaredBefore: state.calls.slice(0, before).map((call) => call === null ? null : call.id), declaredAfter: state.calls.slice(before).map((call) => call === null ? null : call.id),
    }
  }
  // --- W-E / W-F: the same four contributions in two arrival orders ---------------------------
  const orderWorld = async (ids) => {
    const world = await worldWithPanel({})
    if (world.seam === null) return null
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]
      const order = input.arrivalOrders[id]
      try { world.seam.service.declare(contribution(id, input.kinds[0], "gate127", order, "arrival " + id)) } catch (error) { out.errors.push("arrival declare threw: " + describe(error)) }
    }
    const read = readService(world.seam.service, world.seam.state)
    return { accepted: read.accepted.map((row) => row.row), places: read.places, refused: read.refused }
  }
  const first = await orderWorld(input.arrivalIds)
  const second = await orderWorld(input.arrivalIds.slice().reverse())
  const mine = (rows) => rows.filter((row) => row !== null && row !== undefined && input.arrivalIds.includes(row.id))
  out.arrival = {
    ids: input.arrivalIds, orders: input.arrivalOrders,
    first: first === null ? null : mine(first.accepted), second: second === null ? null : mine(second.accepted),
    firstRefused: first === null ? null : first.refused.length, secondRefused: second === null ? null : second.refused.length,
    firstBytes: first === null ? null : JSON.stringify(mine(first.accepted)),
    secondBytes: second === null ? null : JSON.stringify(mine(second.accepted)),
  }
  // --- W-C / W-D: the marker, with and without one contribution, on one fixed route answer -----
  const markerWorld = async (contribute) => {
    const gate = {}
    gate.promise = new Promise((done) => { gate.release = done })
    const seat = async (url) => {
      await gate.promise
      const body = url === input.panelRoute.path ? input.panelRoute.body : (url === input.notesRoute.path ? input.notesRoute.body : null)
      if (body === null) return { status: 404, text: async () => JSON.stringify({ ok: false, error: { code: "NO_ROUTE", message: "gate127 has no such route" } }) }
      return { status: 200, text: async () => JSON.stringify(body) }
    }
    const world = await worldWithPanel({ fetch: seat })
    if (world.seam !== null && contribute === true) {
      try { world.seam.service.declare(input.contribution) } catch (error) { out.errors.push("marker declare threw: " + describe(error)) }
    }
    gate.release()
    await settle(40)
    const marker = world.panel.sandbox.__dshLinkPanel === undefined ? null : world.panel.sandbox.__dshLinkPanel
    return { marker: marker === null ? null : marker, raw: marker === null ? null : JSON.stringify(marker), keys: marker === null ? null : ownKeys(marker), state: world.panel.state }
  }
  const control = await markerWorld(false)
  const contributed = await markerWorld(true)
  out.marker = {
    routeVisible: input.panelRoute.body.declared.visible,
    control: control,
    contributed: contributed,
  }
  // --- W-I: the pane, drawn and clicked (R193). Its own try, so a DOM that cannot be driven leaves
  // --- the R192 readings above judgeable and names the five I readings as the third state.
  try { out.pane = await paneWorld() } catch (error) { out.pane = { ok: false, instrumentMissing: false, why: "the pane world threw: " + describe(error) + " :: " + String(error && error.stack ? error.stack.split(String.fromCharCode(10)).slice(0, 4).join(" | ") : ""), rows: { before: null, throwBefore: null, throwAfter: null, final: null }, clicks: [], counters: null, navigation: [], pageErrors: [], marker: null, seam: null, provider: null, providerActionId: null } }
  out.ok = true
} catch (error) {
  out.why = describe(error) + " :: " + String(error && error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : "")
}
console.log("@@GATE127@@" + JSON.stringify(out))
process.exit(0)
`

// ---------------------------------------------------------------------------
// The world this gate measures, and the judge.
// ---------------------------------------------------------------------------
/** Read one package's manifest state: there, told apart from not there. */
function packageState(root, name) {
  const dir = join(root, 'plugins', name)
  const manifestPath = join(dir, 'package.json')
  const bundle = clientBundleOf(root, name)
  return { name, dir, manifestPath, manifest: existsSync(manifestPath), bundle, bundleExists: existsSync(bundle) }
}

/** The probe input: the instruments, the three built halves, and the fixtures the probe drives. */
function probeInput(root, vocabulary, instruments) {
  const arrivalOrders = {}
  const orders = [30, 10, 20, 40]
  for (let index = 0; index < ID_ARRIVAL.length; index += 1) arrivalOrders[ID_ARRIVAL[index]] = orders[index]
  return {
    cordis: CORDIS_BUNDLE,
    localeBundle: LOCALE_BUNDLE,
    panelBundle: clientBundleOf(root, PANEL),
    providerBundle: clientBundleOf(root, PROVIDER),
    browserBundle: clientBundleOf(root, BROWSER),
    hostHalf: hostHalfOf(root).path,
    seam: SEAM,
    actionKind: vocabulary.kinds.includes(ACTION_KIND) ? ACTION_KIND : vocabulary.kinds[0],
    statusKind: vocabulary.kinds.includes(STATUS_KIND) ? STATUS_KIND : vocabulary.kinds[0],
    hasInvoke: HAS_INVOKE,
    openTab: OPEN_TAB,
    reactAnchor: instruments.reactAnchor,
    kernelAnchor: instruments.kernelAnchor,
    instrumentVersions: { react: instruments.react.version, reactDom: instruments.reactDom.version, jsdom: instruments.jsdom.version },
    ids: {
      dup: ID_DUP, kind: ID_KIND, source: ID_SOURCE, order: ID_ORDER,
      action: ID_ACTION, throw: ID_THROW, noInvoke: ID_NOINVOKE, badInvoke: ID_BADINVOKE, status: ID_STATUS,
    },
    throwText: THROW_TEXT,
    badInvoke: BAD_INVOKE,
    kinds: vocabulary.kinds,
    unknownKind: UNKNOWN_KIND,
    panelRoute: { path: PANEL_ROUTE_PATH, body: { ok: true, declared: { visible: ROUTE_VISIBLE, rejected: [] }, registry: { kinds: vocabulary.kinds, kindSinks: null, sinks: null, sinksMounted: null, entries: ROUTE_VISIBLE } } },
    notesRoute: { path: NOTES_ROUTE_PATH, body: { ok: true, readOnly: true, path: NOTES_ROUTE_PATH, notes: [], limits: NOTES_LIMITS, counts: { notes: 0 } } },
    contribution: CONTRIBUTED_ITEM,
    disposerIds: ID_D1,
    arrivalIds: ID_ARRIVAL,
    arrivalOrders,
  }
}

/** Run the probe in its own process and read its one result line back. */
function runProbe(runDir, root, vocabulary, instruments) {
  const probePath = join(runDir, 'contribution-probe.mjs')
  const inputPath = join(runDir, 'contribution-probe.json')
  writeFileSync(probePath, PROBE_SOURCE + '\n')
  writeFileSync(inputPath, JSON.stringify(probeInput(root, vocabulary, instruments === undefined ? paneInstruments() : instruments), null, 1))
  try {
    const stdout = execFileSync(process.execPath, [probePath, inputPath], { cwd: KERNEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 })
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('@@GATE127@@'))
    if (line === undefined) return { error: 'the contribution probe printed no result line', value: null }
    return { error: null, value: JSON.parse(line.slice('@@GATE127@@'.length)) }
  } catch (error) {
    return { error: 'the contribution probe failed: ' + describe(error) + ' ' + clip(String(error.stderr === undefined ? '' : error.stderr).trim(), 600), value: null }
  }
}

/** Build the whole world: the instrument paths, the two packages, the frozen field list, and the probe. */
function buildWorld(root, runDir) {
  const world = { root, runDir, fatal: null, missing: [], vocabulary: null, frozen: null, instruments: null, probe: null, packages: {} }
  world.vocabulary = hostVocabulary(root)
  world.instruments = paneInstruments()
  world.frozen = frozenMarkerFields()
  for (const name of [PANEL, PROVIDER]) {
    world.packages[name] = packageState(root, name)
    const state = world.packages[name]
    if (!state.manifest) world.missing.push(state.manifestPath)
    else if (!state.bundleExists) world.missing.push(state.bundle)
  }
  if (!existsSync(CORDIS_BUNDLE)) world.missing.push(CORDIS_BUNDLE)
  if (!existsSync(LOCALE_BUNDLE)) world.missing.push(LOCALE_BUNDLE)
  if (world.missing.length > 0) {
    world.fatal = 'a declared package or a pinned kernel instrument is not on this machine, so the seam cannot be measured: ' + world.missing.join(', ') + ' - run: node plugins/build.mjs'
    return world
  }
  if (world.vocabulary.why !== null) { world.fatal = world.vocabulary.why; return world }
  if (world.vocabulary.kinds.length === 0) { world.fatal = 'the host half declares no kind this gate can declare a contribution with'; return world }
  const probe = runProbe(runDir, root, world.vocabulary, world.instruments)
  world.probe = probe.error === null ? probe.value : { ok: false, why: probe.error, errors: [], refusals: [], marker: null, seam: null, panel: null, provider: null, elsewhere: null, arrival: null, disposer: null, host: null, locale: null, pane: null }
  return world
}

/** The host's own codes for the four probe inputs, keyed by the probe's own labels, read from its build. */
function hostCodes(world) {
  const host = world.probe === null ? null : world.probe.host
  if (host === null || host === undefined || host.dup === undefined) return null
  return { dup: host.dup, kind: host.kind, source: host.source, order: host.order }
}

/** Which of the four probe inputs a row belongs to, by the id the refusal reader reported. */
function refusalOf(world, id) {
  const list = world.probe === null || world.probe.refusals === undefined ? [] : world.probe.refusals
  return list.find((entry) => entry.id === id) === undefined ? null : list.find((entry) => entry.id === id)
}

function judge(world) {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok, state: ok === true ? 'green' : ok === false ? 'red' : 'n/a', detail, evidence: evidence === undefined ? [] : evidence })
  const probe = world.probe
  const seam = probe === null ? null : probe.seam
  const provided = seam !== null && seam !== undefined && seam.provided === true
  const panelState = probe === null || probe.panel === null || probe.panel === undefined ? null : probe.panel.state
  const notProvided = (id, detail) => add(id, null, detail, [
    'the seam ' + show(SEAM) + ' is not a service of this world, so this reading has nothing to judge: ' + detail,
    'this is the NAMED third state (not green, not red). The artifact IS built and IS measurable - what is missing is the subject of this reading.',
  ])

  // --- S1 -------------------------------------------------------------------------------------
  if (probe === null || probe.ok !== true) {
    add('S1', false, 'the world could not be driven at all: ' + String(probe === null ? 'the probe printed nothing' : probe.why))
  } else if (!provided) {
    add('S1', false, 'the panel half ran (' + show(panelState) + ') but the real service store answers no ' + show(SEAM) + ': the contribution seam this round is about is not provided', [
      'the panel half own apply() reached fiber state ' + show(panelState) + '; its own bundle injects ' + show(probe.panel.inject),
      'the store was asked for ' + show(SEAM) + ' through the real client-plane store (ctx.get) after the half own apply() returned, and it answered undefined',
      'the provider declares ' + show(probe.provider === null ? null : probe.provider.inject) + ' in its own inject array, so with no seam there is nothing for it to inject into',
    ])
  } else {
    const facts = []
    let ok = true
    const face = seam.face === undefined || seam.face === null ? [] : seam.face
    const methods = face.filter((member) => member.type === 'function').map((member) => member.name)
    const missingMembers = SEAM_MEMBERS.filter((member) => methods.includes(member) === false)
    facts.push('the service public face (every own member, read from the provided object, not assumed): ' + show(face))
    facts.push('the method names: ' + show(methods))
    if (missingMembers.length > 0) { ok = false; facts.push('FAIL the frozen pair is not there: ' + show(missingMembers) + ' is/are missing from the public face') }
    const provider = probe.provider
    if (provider === null || provider === undefined) {
      ok = false
      facts.push('FAIL the provider half was never plugged, so nothing about its injection can be read')
    } else {
      const inject = provider.inject === null ? [] : provider.inject
      facts.push('the provider built artifact is ' + show(provider.id) + ', its own exports are ' + show(provider.exports) + ' and its own inject array is ' + show(provider.inject))
      if (inject.includes(SEAM) === false) { ok = false; facts.push('FAIL the provider does not name ' + show(SEAM) + ' in its own inject array') }
      facts.push('with the panel plugged the provider fiber is ' + show(provider.state) + (provider.pendingOn === undefined ? '' : ' (pending on ' + show(provider.pendingOn) + ')'))
      if (provider.state !== 'active') { ok = false; facts.push('FAIL the provider did not activate beside the seam') }
      const alone = probe.elsewhere
      facts.push('the paired control - the SAME provider bundle in a world with no panel half: ' + show(alone === null ? null : alone.state) + ', pending on ' + show(alone === null ? null : alone.pendingOn))
      if (alone === null || alone === undefined || alone.state !== 'pending' || (alone.pendingOn === undefined || alone.pendingOn.includes(SEAM) === false)) {
        ok = false
        facts.push('FAIL the control did not stay pending on ' + show(SEAM) + ', so nothing here shows the service arrived through cordis own inject rather than being handed over')
      }
    }
    const declared = probe.provider === null ? [] : probe.provider.declaredAtRuntime
    facts.push('the seam own declare recorder saw these ids arrive from the provider at runtime: ' + show(declared))
    add('S1', ok, ok
      ? 'the seam is a REAL provided service: the real store answers ' + show(SEAM) + ', the provider injects it and activates beside it, and the same provider stays PENDING on ' + show(SEAM) + ' with no panel in the world'
      : 'the seam exists but the injection chain does not hold; the facts below name which link moved', facts)
  }

  // --- the four refusals, and the word list ---------------------------------------------------
  const codes = hostCodes(world)
  const refusalReading = (id, option) => {
    const entry = refusalOf(world, option.probeId)
    if (!provided) { notProvided(id, 'the four refusals are answered by the seam, and the seam is not provided'); return }
    if (entry === null) { add(id, false, 'the probe declared the item and the judge found no record of it at all: the probe never ran this input'); return }
    const evidence = [
      'declared: ' + show(entry.declared),
      'every place the service public face was read for this input: ' + show(entry.places),
      'refusal rows for ' + show(option.probeId) + ': ' + show(entry.refused),
      'accepted rows for ' + show(option.probeId) + ': ' + show(entry.accepted),
    ]
    if (codes !== null) evidence.push('the HOST half own projectPanel, asked the same question of the same input: ' + show(codes[option.label]))
    const rows = entry.refused
    if (rows.length === 0) { add(id, false, 'the input was refused NOWHERE this gate can read: no refusal row carries ' + show(option.probeId) + ' and the refused list is empty', evidence); return }
    const wanted = rows.filter((row) => row.code === option.code)
    if (wanted.length === 0) { add(id, false, 'the refusal does not carry ' + show(option.code) + '; what it carries instead is ' + show(rows.map((row) => row.code)), evidence); return }
    const extra = option.extra === undefined ? [] : option.extra(rows, entry)
    const failed = extra.filter((fact) => fact.ok === false)
    for (const fact of extra) evidence.push((fact.ok ? 'ok   ' : 'FAIL ') + fact.text)
    add(id, failed.length === 0, failed.length === 0 ? option.held : option.failed, evidence)
  }

  refusalReading('R-DUP', {
    probeId: ID_DUP, label: 'dup', code: CODE_DUP,
    held: 'a repeated id is refused BY NAME with ' + CODE_DUP + ' and NO CLAIMANT WINS: the id is admitted zero times',
    failed: 'the duplicate is named with ' + CODE_DUP + ' but one of these facts does not hold - see the FAIL lines',
    extra: (rows, entry) => [
      { ok: entry.accepted.length === 0, text: 'no claimant wins: accepted rows carrying this id = ' + String(entry.accepted.length) + ' (the rule is that a duplicate refuses EVERY claimant, so this must be 0)' },
      { ok: rows.length >= 1, text: 'refusal rows carrying this id = ' + String(rows.length) + ' (two claimants were declared)' },
      { ok: same(entry.declared.filter((call) => call !== null && call.id === ID_DUP).length, 2), text: 'the two claimants the probe declared both arrived at the seam: ' + show(entry.declared) },
    ],
  })
  refusalReading('R-KIND', {
    probeId: ID_KIND, label: 'kind', code: CODE_KIND,
    held: 'a kind outside the closed set is refused BY NAME with ' + CODE_KIND + ', and the refusal names the offending kind',
    failed: 'the unknown kind is not refused the way the closed set requires - see the FAIL lines',
    extra: (rows) => [
      { ok: rows.some((row) => row.detail.includes(UNKNOWN_KIND)), text: 'the refusal detail names the offending kind ' + show(UNKNOWN_KIND) + ': ' + show(rows.map((row) => row.detail)) },
      { ok: rows.some((row) => row.detail.includes(UNKNOWN_KIND)), text: 'an unknown kind is NOT translated to the nearest known one: the detail keeps the exact kind that was declared' },
    ],
  })
  refusalReading('R-SRC', {
    probeId: ID_SOURCE, label: 'source', code: CODE_SOURCE,
    held: 'an empty source is refused BY NAME with ' + CODE_SOURCE,
    failed: 'the empty source is not refused the way the registry requires - see the FAIL lines',
  })
  refusalReading('R-ORDER', {
    probeId: ID_ORDER, label: 'order', code: null,
    held: 'a non-finite order keeps its OWN text: the refusal carries code null and its detail is about the order field, so no fourth name was invented',
    failed: 'the non-finite order did not keep its own text - see the FAIL lines',
    extra: (rows) => [
      { ok: rows.every((row) => row.code === null), text: 'no new code was invented for this refusal: codes carried = ' + show(rows.map((row) => row.code)) },
      { ok: rows.some((row) => /order/i.test(row.detail)), text: 'the original text is carried: detail = ' + show(rows.map((row) => row.detail)) },
    ],
  })

  // --- R-VOCAB: the four answers are the host registry's own ----------------------------------
  if (!provided) {
    notProvided('R-VOCAB', 'the word list is the seam answer vocabulary, and the seam is not provided')
  } else if (codes === null) {
    add('R-VOCAB', null, 'the host half own projectPanel could not be imported from its build, so the family the seam must reuse cannot be read as data here', [
      'the host half was asked of ' + show(world.probe.host === null ? null : world.probe.host.path) + ' and answered ' + show(world.probe.host === null ? null : world.probe.host.error),
    ])
  } else {
    const observed = []
    const lines = []
    let ok = true
    let answered = 0
    const family = Object.values(world.vocabulary.codes)
    for (const pair of [['dup', ID_DUP], ['kind', ID_KIND], ['source', ID_SOURCE], ['order', ID_ORDER]]) {
      const entry = refusalOf(world, pair[1])
      const hostRow = codes[pair[0]] === undefined ? [] : codes[pair[0]]
      const hostCode = hostRow.length === 0 ? null : hostRow[0].code
      if (entry === null || entry.refused.length === 0) {
        lines.push('n/a  ' + pair[0] + ': the seam answered NO refusal for this input, so there is no word to compare here - the reading that owns this input judges its refusal, while this reading judges only the words that were answered')
        continue
      }
      answered += 1
      const seamCode = entry.refused[0].code
      observed.push(seamCode)
      const agrees = same(seamCode, hostCode)
      if (agrees === false) ok = false
      const insideFamily = seamCode === null || family.includes(seamCode)
      if (insideFamily === false) ok = false
      lines.push((agrees ? 'ok   ' : 'FAIL ') + pair[0] + ': host projectPanel says ' + show(hostCode) + ', the seam answers ' + show(seamCode)
        + (agrees ? '' : ' - two word lists, not one') + (insideFamily ? '' : ' - and that name is outside the host family ' + show(family)))
    }
    if (answered === 0) { ok = false; lines.push('FAIL not one of the four inputs answered a refusal, so this reading has no word at all to judge') }
    lines.push('the words the seam answered, in the order the four inputs were declared: ' + show(observed))
    lines.push('the host names were read as data from ' + show(world.vocabulary.path) + ': ' + show(world.vocabulary.codes))
    add('R-VOCAB', ok, ok
      ? 'ONE WORD LIST: every refusal the seam answered carries exactly the word the host registry own projectPanel carries for the same input, and no answer is outside the host family'
      : 'the seam and the host registry do not agree word for word - see the FAIL lines', lines)
  }

  // --- O1 -------------------------------------------------------------------------------------
  if (!provided) {
    notProvided('O1', 'order-independence is a property of the seam projection, and the seam is not provided')
  } else if (probe.arrival === null || probe.arrival === undefined) {
    add('O1', false, 'the arrival pair could not be driven: the probe recorded no projection')
  } else {
    const arrival = probe.arrival
    const ok = arrival.firstBytes !== null && arrival.firstBytes === arrival.secondBytes && arrival.first !== null && arrival.first.length === arrival.ids.length
    const evidence = [
      'the four contributions, in the order they were declared first: ' + show(arrival.ids),
      'the same four, declared in the reverse order',
      'the orders they carry: ' + show(arrival.orders) + ' (two of them tied, which is where an arrival-ordered fold shows)',
      'projection of the first arrival order: ' + show(arrival.firstBytes),
      'projection of the second arrival order: ' + show(arrival.secondBytes),
      'refusal rows seen: ' + String(arrival.firstRefused) + ' / ' + String(arrival.secondRefused),
    ]
    if (ok === false) evidence.push('FAIL the two arrival orders do not project to the same bytes, or they project to nothing')
    add('O1', ok, ok
      ? 'ORDER-INDEPENDENT: the same four contributions in two arrival orders project to BYTE-IDENTICAL output (' + String(arrival.first.length) + ' rows), and to something'
      : 'the projection is a function of arrival, or of nothing at all - see the FAIL line', evidence)
  }

  // --- D1 -------------------------------------------------------------------------------------
  if (!provided) {
    notProvided('D1', 'the disposer is what declare() returns, and declare is not provided')
  } else if (probe.disposer === null || probe.disposer === undefined) {
    add('D1', false, 'the disposer could not be driven: the probe recorded nothing')
  } else {
    const disposer = probe.disposer
    const evidence = [
      'declare() handed back ' + show(disposer.disposeKind) + ' for the middle item of ' + show(disposer.ids),
      'ids that arrived at the seam before the dispose: ' + show(disposer.declaredBefore),
      'projection before dispose: ' + show(disposer.before),
      'projection after dispose: ' + show(disposer.after),
    ]
    if (disposer.disposeThrew !== null) evidence.push('FAIL the disposer threw: ' + show(disposer.disposeThrew))
    const target = disposer.ids[1]
    const goneBefore = disposer.rowsBefore[1].length
    const goneAfter = disposer.rowsAfter[1].length
    const othersBefore = [disposer.rowsBefore[0], disposer.rowsBefore[2]]
    const othersAfter = [disposer.rowsAfter[0], disposer.rowsAfter[2]]
    const othersHeld = same(othersBefore, othersAfter)
    const countDown = disposer.after.length === disposer.before.length - 1
    const ok = disposer.disposeThrew === null && goneBefore === 1 && goneAfter === 0 && othersHeld && countDown
    evidence.push((goneBefore === 1 && goneAfter === 0 ? 'ok   ' : 'FAIL ') + 'the disposed item ' + show(target) + ' is gone: before ' + String(goneBefore) + ' row(s), after ' + String(goneAfter))
    evidence.push((othersHeld ? 'ok   ' : 'FAIL ') + 'every OTHER item held its own bytes across the dispose: ' + show(othersAfter))
    evidence.push((countDown ? 'ok   ' : 'FAIL ') + 'exactly one item left the projection: ' + String(disposer.before.length) + ' -> ' + String(disposer.after.length))
    add('D1', ok, ok
      ? 'DISPOSAL holds: the disposer declare() returned removed exactly that item and left every other item byte-identical'
      : 'disposal did not remove exactly one item, or it moved something else - see the FAIL lines', evidence)
  }

  // --- M1: the marker gained a field and lost no semantics (gate 124 own guard) ---------------
  const marker = probe === null ? null : probe.marker
  if (probe === null || probe.ok !== true || marker === null || marker.contributed === null || marker.contributed === undefined) {
    add('M1', false, 'the marker could not be read in a world with a fixed route answer, so the field gate 124 guards cannot be held')
  } else {
    const withItem = marker.contributed
    const without = marker.control
    const routeVisible = marker.routeVisible
    const evidence = []
    let ok = true
    evidence.push('the fixed route answer this world is given: declared.visible = ' + show(routeVisible))
    evidence.push('the marker with one contribution declared: ' + show(withItem.raw))
    evidence.push('the marker with NO contribution declared, same input: ' + show(without.raw))
    if (withItem.marker === null) { ok = false; evidence.push('FAIL the marker is not there at all in the contributed world') }
    if (without.marker === null) { ok = false; evidence.push('FAIL the marker is not there at all in the control world') }
    if (ok) {
      const items = withItem.marker.items
      const controlItems = without.marker.items
      const itemsAreRoute = same(items, routeVisible)
      const itemsAreControl = same(items, controlItems)
      if (itemsAreRoute === false) { ok = false; evidence.push('FAIL items is not the route declared.visible byte for byte: ' + show(items)) }
      else evidence.push('ok   items === the route declared.visible, row by row and byte by byte (' + String(items.length) + ' row(s))')
      if (itemsAreControl === false) { ok = false; evidence.push('FAIL items differs between the world with a contribution and the world without one, so the new source leaked into the old field') }
      else evidence.push('ok   items is byte-identical to the same world with no contribution declared: ' + show(JSON.stringify(items)))
      const contributed = withItem.marker[CONTRIBUTED]
      const reports = Array.isArray(contributed) && contributed.some((row) => row !== null && typeof row === 'object' && row.id === ID_M1)
      if (reports === false) { ok = false; evidence.push('FAIL the new field ' + show(CONTRIBUTED) + ' does not report the contribution ' + show(ID_M1) + ': ' + show(contributed)) }
      else evidence.push('ok   the new field ' + show(CONTRIBUTED) + ' reports the contribution: ' + show(contributed))
      const inItems = Array.isArray(items) && items.some((row) => row !== null && typeof row === 'object' && row.id === ID_M1)
      if (inItems) { ok = false; evidence.push('FAIL the contribution ' + show(ID_M1) + ' is also inside items, which is exactly what ruling 3 forbids') }
      else evidence.push('ok   the contribution is NOT inside items')
      if (world.frozen.names === null) {
        evidence.push('n/a  the R191 frozen field list could not be read as data (' + String(world.frozen.why) + '), so the field-set claim is NOT judged here; everything above is')
      } else {
        const allowed = world.frozen.names.concat([CONTRIBUTED])
        const extra = withItem.keys.filter((key) => allowed.includes(key) === false)
        const absent = allowed.filter((key) => withItem.keys.includes(key) === false)
        const setHolds = extra.length === 0 && absent.length === 0
        if (setHolds === false) { ok = false; evidence.push('FAIL the field set is not R191 frozen set + ' + show(CONTRIBUTED) + ': extra ' + show(extra) + ', absent ' + show(absent)) }
        else evidence.push('ok   the field set is exactly ' + show(allowed) + ', read as data from ' + show(world.frozen.source))
        evidence.push('the R191 frozen field list, read out of gate 124 own bytes: ' + show(world.frozen.names) + ' - ' + String(world.frozen.source))
      }
      evidence.push('THIS READING IS GATE 124 OWN GUARD: gate 124 reading 4 holds the marker items to the real route declared.visible byte for byte, so items must stay the host-declared visible items and the contribution must live in its own field')
    }
    add('M1', ok, ok
      ? 'THE MARKER GAINED A FIELD AND LOST NO SEMANTICS: items is byte-identical to the route declared.visible and to the same world with no contribution, and ' + CONTRIBUTED + ' reports the contribution'
      : 'the marker field moved a semantic gate 124 depends on - see the FAIL lines', evidence)
  }

  // --- P1: the provider really called declare -------------------------------------------------
  const providerState = probe === null ? null : probe.provider
  if (!provided || providerState === null || providerState === undefined) {
    notProvided('P1', 'the provider declares into the seam, and the seam is not provided here')
  } else {
    const bytes = readText(world.packages[PROVIDER].bundle)
    const evidence = []
    let ok = true
    if (bytes === null) { ok = false; evidence.push('FAIL the provider built artifact could not be read: ' + world.packages[PROVIDER].bundle) }
    else {
      const pattern = /([A-Za-z_$][\w$.]{0,48})\.declare\s*\(/
      const match = pattern.exec(bytes)
      const relative = world.packages[PROVIDER].bundle.slice(world.root.length + 1).replaceAll('\\', '/')
      if (match === null) { ok = false; evidence.push('FAIL no .declare( call is in the provider built artifact (' + String(bytes.length) + ' bytes read): ' + relative) }
      else {
        const line = lineOf(bytes, match.index)
        const text = bytes.split('\n')[line - 1].trim()
        evidence.push('the call site, read out of the artifact own bytes: ' + relative + ':' + String(line) + ' -> ' + clip(text, 220))
        evidence.push('the receiver spelling at that site: ' + show(match[1]) + '.declare(')
      }
    }
    const declared = providerState.declaredAtRuntime === undefined ? [] : providerState.declaredAtRuntime
    evidence.push('the seam own declare recorder saw these ids arrive from the provider at runtime: ' + show(declared))
    if (declared.length === 0) { ok = false; evidence.push('FAIL the call is in the bytes but nothing arrived at the seam at runtime') }
    const projection = probe.projection === null || probe.projection === undefined ? [] : probe.projection.accepted
    const refusedRows = probe.projection === null || probe.projection === undefined ? [] : probe.projection.refused
    const inProjection = declared.filter((id) => projection.some((row) => row !== null && row !== undefined && row.id === id))
    evidence.push('the projection the seam own public face answered when the provider had declared: ' + show(projection))
    evidence.push('of those ids, the ones really in the projection: ' + show(inProjection))
    if (inProjection.length !== declared.length) {
      ok = false
      const named = refusedRows.filter((row) => declared.includes(row.id))
      evidence.push('FAIL an item the provider declared is not in the projection; the seam own rejected() answers this for it: ' + show(named.length === 0 ? refusedRows : named))
    }
    add('P1', ok, ok
      ? 'THE PROVIDER REALLY CALLED declare: the call is named by file:line in the built artifact, it arrived at the seam object at runtime, and the item it named is in the projection'
      : 'the provider does not really declare into the seam - see the FAIL lines', evidence)
  }

  // --- I1..I5: the action kind, DRAWN AND CLICKED (R193) --------------------------------------
  const pane = probe === null || probe.pane === undefined ? null : probe.pane
  /**
   * Whether the pane world can be judged at all. A missing instrument is the NAMED third state (the
   * shell's React pin and a DOM are not part of the delivered packages); a pane that could not be driven
   * is a red, because the subject IS there.
   */
  const paneBlocking = (id) => {
    if (pane === null) { add(id, false, 'the pane world was not driven at all: the probe recorded nothing for it'); return true }
    if (pane.instrumentMissing === true) {
      add(id, null, 'the pane instruments are not on this machine, so this reading cannot be measured here: ' + String(pane.why), [
        'the world needs the shell own React pin and a DOM; this gate resolves them from ' + show(world.instruments === null ? null : { reactAnchor: world.instruments.reactAnchor, kernelAnchor: world.instruments.kernelAnchor }),
        'what is missing: ' + show(world.instruments === null ? null : world.instruments.missing),
        'this is the NAMED third state (not green, not red): the delivered packages are measurable, the DOM they would be drawn into is not here',
      ])
      return true
    }
    if (pane.ok !== true) { add(id, false, 'the pane world could not be driven: ' + String(pane.why)); return true }
    return false
  }
  const paneRows = (which) => pane.rows === null || pane.rows === undefined || pane.rows[which] === null ? {} : pane.rows[which]
  const paneClicks = pane === null || pane.clicks === undefined || pane.clicks === null ? [] : pane.clicks
  const paneNavigation = pane === null || pane.navigation === undefined || pane.navigation === null ? [] : pane.navigation
  const clickReport = (entry) => ({ id: entry.id, clicked: entry.clicked, where: entry.where, threw: entry.threw, arrived: entry.arrived })

  // --- I1: an action row is drawn as a button, and the kind decides the shape ------------------
  if (paneBlocking('I1') === false) {
    const drawn = paneRows('before')
    const providerId = pane.providerActionId
    const evidence = []
    let ok = true
    evidence.push('the pane the gate mounted: ' + show(pane.mount) + ' (the page own fetch, the seats and the browser environment are named substitutions; no live page, port or client process is touched)')
    evidence.push('the instrument that drew it: ' + show(pane.instrument))
    evidence.push('the rows the pane drew, by their own ids: ' + show(Object.keys(drawn)))
    const wanted = [
      { id: ID_ACTION, why: 'the gate own action row' },
      { id: ID_THROW, why: 'the gate own throwing action row' },
    ]
    if (providerId === null) {
      ok = false
      evidence.push('FAIL the provider declared no ' + show(ACTION_KIND) + ' row at all, so R193 own real action is not in this world; what it declared: ' + show(pane.provider === null ? null : pane.provider.declaredIds) + ' (its fiber: ' + show(pane.provider === null ? null : pane.provider.state) + ' pending on ' + show(pane.provider === null ? null : pane.provider.pendingOn) + ')')
    } else {
      wanted.push({ id: providerId, why: 'the provider own action row, whose id is read out of its own declare call' })
    }
    for (const want of wanted) {
      const row = drawn[want.id] === undefined ? null : drawn[want.id]
      if (row === null) { ok = false; evidence.push('FAIL ' + want.why + ' (' + show(want.id) + ') was not drawn at all'); continue }
      if (row.buttons === 0) { ok = false; evidence.push('FAIL ' + want.why + ' is a ' + row.tag + ' offering no button: ' + clip(row.html, 320)) }
      else evidence.push('ok   ' + want.why + ' (' + show(want.id) + ') offers a button: the row itself is a ' + row.tag + ', ' + String(row.buttons) + ' button(s) in the row -> ' + clip(row.html, 200))
    }
    const control = drawn[ID_STATUS] === undefined ? null : drawn[ID_STATUS]
    if (control === null) { ok = false; evidence.push('FAIL the status control row ' + show(ID_STATUS) + ' was not drawn, so the shape the kind decides cannot be compared') }
    else if (control.buttons > 0) { ok = false; evidence.push('FAIL the status control row (kind ' + show(control.kind) + ') offers a button too, so the kind does not decide the shape: ' + clip(control.html, 320)) }
    else evidence.push('ok   the status control row (kind ' + show(control.kind) + ') offers no button: it is a ' + control.tag + ' -> ' + clip(control.html, 200))
    add('I1', ok, ok
      ? 'AN action ROW IS DRAWN AS A BUTTON: the provider own action row and both gate action rows offer one, and the status control row offers none - the kind decides the shape'
      : 'the action kind is not drawn as a button, or the kind does not decide the shape - see the FAIL lines', evidence)
  }

  // --- I2: one click, exactly one call ----------------------------------------------------------
  if (paneBlocking('I2') === false) {
    const counters = pane.counters === null ? null : pane.counters
    const atRender = pane.atRender === undefined || pane.atRender === null ? null : pane.atRender
    const providerId = pane.providerActionId
    const tab = pane.provider === null || pane.provider.tabs === undefined || pane.provider.tabs.length === 0 ? null : pane.provider.tabs[0]
    const actionClicks = paneClicks.filter((entry) => entry.id === ID_ACTION)
    const providerClicks = providerId === null ? [] : paneClicks.filter((entry) => entry.id === providerId)
    const landedOn = (list) => list.filter((entry) => entry.clicked === true).length
    const landedAction = landedOn(actionClicks)
    const landedProvider = landedOn(providerClicks)
    const navigations = paneNavigation.filter((entry) => entry.where === OPEN_TAB || entry.where === 'openTabFromTarget')
    const evidence = [
      'every click this gate dispatched, in order, as a real DOM click through React own event system: ' + show(paneClicks.map(clickReport)),
      'what had run BEFORE the first click (a drawn button must not be a run button): ' + show(atRender),
      'arrivals at the gate own invoke: ' + show(counters),
      'every call of the provider own navigation, by name and by argument: ' + show(paneNavigation),
    ]
    let ok = true
    if (atRender === null) { ok = false; evidence.push('FAIL the pre-click reading is missing, so "nothing ran while it was drawn" cannot be held') }
    else if (atRender.counters.action !== 0 || atRender.counters.throw !== 0 || atRender.navigation !== 0) {
      ok = false
      evidence.push('FAIL something ran while the pane was only being drawn: ' + show(atRender))
    } else evidence.push('ok   nothing ran before a click: the invoke had been called 0 times and the provider had navigated 0 times')
    if (counters === null) { ok = false; evidence.push('FAIL the counters were never recorded') } else {
      if (counters.action !== landedAction) { ok = false; evidence.push('FAIL ' + String(landedAction) + ' click(s) on the gate own action row reached its invoke ' + String(counters.action) + ' time(s): one click must land exactly once') }
      else evidence.push('ok   ' + String(landedAction) + ' click(s) on the gate own action row reached its invoke exactly ' + String(counters.action) + ' time(s) in all')
      if (landedAction < 2) { ok = false; evidence.push('FAIL fewer than two clicks on the gate own action row landed, so "exactly once" was not measured on this world') }
    }
    if (providerId === null) { ok = false; evidence.push('FAIL the provider declared no action row, so its own invoke was never clicked') }
    else if (landedProvider !== 1) { ok = false; evidence.push('FAIL the provider own action row could not be clicked: ' + show(providerClicks.map((entry) => entry.why))) }
    else if (navigations.length !== 1) { ok = false; evidence.push('FAIL one click on the provider own action row reached its own navigation ' + String(navigations.length) + ' time(s): ' + show(navigations)) }
    else {
      evidence.push('ok   one click on the provider own action row reached its own navigation exactly once: ' + show(navigations[0]))
      const target = navigations[0].args.length === 0 ? null : navigations[0].args[0]
      const names = tab === null ? [] : [tab.kind, tab.id].filter((value) => value !== null)
      if (names.length === 0 || names.includes(target) === false) { ok = false; evidence.push('FAIL that call does not name the tab type the provider itself registered: it named ' + show(target) + '; the provider registered ' + show(tab)) }
      else evidence.push('ok   that call names the type the provider itself registered: ' + show(target) + ' - ' + show(tab))
    }
    add('I2', ok, ok
      ? 'ONE CLICK, EXACTLY ONE CALL: nothing ran while the button was drawn, two clicks on the gate own action row arrived exactly twice, and one click on the provider own row reached its own navigation exactly once, naming its own tab type'
      : 'a click does not land exactly once where R193 says it must - see the FAIL lines', evidence)
  }

  // --- I3: a throwing invoke is caught, and its own text is shown in that row --------------------
  if (paneBlocking('I3') === false) {
    const before = paneRows('throwBefore')
    const after = paneRows('throwAfter')
    const counters = pane.counters === null ? null : pane.counters
    const throwClicks = paneClicks.filter((entry) => entry.id === ID_THROW)
    const beforeRow = before[ID_THROW] === undefined ? null : before[ID_THROW]
    const afterRow = after[ID_THROW] === undefined ? null : after[ID_THROW]
    const evidence = [
      'the click aimed at the throwing row: ' + show(throwClicks.map(clickReport)),
      'that row BEFORE the click: ' + clip(show(beforeRow), 400),
      'that row AFTER the click: ' + clip(show(afterRow), 700),
      'the page own error channels watched through the click (window error events, the console the DOM reports through, uncaught exceptions and unhandled rejections): ' + show(pane.pageErrors),
    ]
    let ok = true
    if (throwClicks.length !== 1 || throwClicks[0].clicked !== true) { ok = false; evidence.push('FAIL the throwing row could not be clicked: ' + show(throwClicks.map((entry) => entry.why))) }
    if (counters === null || counters.throw !== 1) { ok = false; evidence.push('FAIL the click was to reach the invoke exactly once; arrivals = ' + show(counters === null ? null : counters.throw)) }
    else evidence.push('ok   the one click reached the invoke exactly once')
    const textAfter = afterRow === null ? '' : String(afterRow.text)
    const textBefore = beforeRow === null ? '' : String(beforeRow.text)
    if (textAfter.includes(THROW_TEXT) === false) { ok = false; evidence.push('FAIL the row does not carry the original text the invoke threw: ' + show(THROW_TEXT) + ' is not in ' + show(clip(textAfter, 320))) }
    else if (textBefore.includes(THROW_TEXT)) { ok = false; evidence.push('FAIL the text was already on the row before the click, so nothing here shows it was shown BY the failure') }
    else evidence.push('ok   the row carries the original text, and did not before the click: ' + show(THROW_TEXT))
    const elsewhere = Object.keys(after).filter((id) => id !== ID_THROW && after[id] !== null && String(after[id].text).includes(THROW_TEXT))
    if (elsewhere.length > 0) { ok = false; evidence.push('FAIL the original text is drawn on rows it does not belong to: ' + show(elsewhere)) }
    else evidence.push('ok   no other row carries it')
    const others = Object.keys(before).filter((id) => id !== ID_THROW)
    const moved = others.filter((id) => same(before[id], after[id]) === false)
    if (moved.length > 0) { ok = false; evidence.push('FAIL rows other than the throwing one moved across the click: ' + show(moved) + ' -> ' + show(moved.map((id) => clip(show(after[id]), 220)))) }
    else evidence.push('ok   every other row is byte-identical across the click (' + String(others.length) + ' row(s))')
    const escaped = pane.pageErrors === undefined || pane.pageErrors === null ? [] : pane.pageErrors
    if (escaped.length > 0) { ok = false; evidence.push('FAIL the throw was NOT caught: it reached a channel outside the row: ' + show(escaped.map((line) => clip(line, 220)))) }
    else evidence.push('ok   nothing reached the page own error channels, so the throw was caught rather than let through')
    if (counters === null || counters.action !== 2) { ok = false; evidence.push('FAIL the pane stopped answering clicks after the throw: the click that followed reached the gate own invoke ' + show(counters === null ? null : counters.action) + ' time(s) in all') }
    else evidence.push('ok   the pane is still answering clicks after the throw (the click that followed landed)')
    add('I3', ok, ok
      ? 'A THROWING INVOKE IS CAUGHT: the click reached it exactly once, THAT row carries the original text and no other row does, every other row is byte-identical, nothing escaped to the page own error channels, and the pane still answers clicks'
      : 'the throw was not contained the way R193 requires - see the FAIL lines', evidence)
  }

  // --- I4: an action with no callable invoke keeps its own text ----------------------------------
  if (paneBlocking('I4') === false) {
    const seam = pane.seam === null ? null : pane.seam
    const refused = seam === null || seam.refused === undefined ? [] : seam.refused
    const visible = seam === null || seam.visibleIds === undefined ? [] : seam.visibleIds
    const evidence = [
      'what the seam own public face answered for the gate own declarations: visible ' + show(visible),
      'refusals: ' + show(refused),
      'what a visible row carries, field by field (the seam own rows, read at runtime): ' + show(seam === null ? null : seam.faces),
    ]
    let ok = true
    for (const pair of [{ id: ID_NOINVOKE, why: 'an action row with NO invoke field at all' }, { id: ID_BADINVOKE, why: 'an action row whose invoke is not a function' }]) {
      const rows = refused.filter((row) => row.id === pair.id)
      if (rows.length === 0) { ok = false; evidence.push('FAIL ' + pair.why + ' (' + show(pair.id) + ') was refused nowhere this gate can read'); continue }
      const codes = rows.map((row) => row.code)
      if (codes.every((code) => code === null) === false) { ok = false; evidence.push('FAIL ' + pair.why + ' is refused with a name of its own instead of the original text: codes ' + show(codes) + ' (the pass-through rule is code null)') }
      else evidence.push('ok   ' + pair.why + ' is refused with code null: no fourth name was invented for it')
      const details = rows.map((row) => String(row.detail))
      if (details.some((detail) => /invoke/i.test(detail)) === false) { ok = false; evidence.push('FAIL the refusal text is not about the invoke field: ' + show(details)) }
      else evidence.push('ok   the refusal carries its own text, about the invoke field: ' + show(details))
      if (visible.includes(pair.id)) { ok = false; evidence.push('FAIL ' + show(pair.id) + ' is admitted as well, so it is not refused after all') }
      else evidence.push('ok   ' + show(pair.id) + ' is not drawn')
      const host = Object.values(world.vocabulary.codes)
      if (host.includes(codes[0]) && codes[0] !== null) { ok = false; evidence.push('FAIL that refusal reuses a host name (' + show(codes[0]) + ') for an input the host own rule answers with its own text') }
    }
    for (const control of [
      { id: ID_STATUS, why: 'a status row with no invoke (the field is optional outside action)' },
      { id: ID_ACTION, why: 'an action row WITH a callable invoke' },
      { id: ID_THROW, why: 'an action row whose invoke throws when it is called' },
    ]) {
      if (visible.includes(control.id)) evidence.push('ok   still admitted: ' + control.why + ' (' + show(control.id) + ')')
      else { ok = false; evidence.push('FAIL ' + control.why + ' (' + show(control.id) + ') is NOT admitted, so the rule refuses more than the contract does') }
    }
    add('I4', ok, ok
      ? 'AN ACTION WITH NO CALLABLE INVOKE KEEPS ITS OWN TEXT: refused with code null and a detail about the invoke field, not drawn - while the status row with no invoke and the actions WITH a callable are all admitted'
      : 'the pass-through rule for a missing invoke is not the host own rule - see the FAIL lines', evidence)
  }

  // --- I5: the marker reports the callable as a boolean -----------------------------------------
  if (paneBlocking('I5') === false) {
    const marker = pane.marker === null ? null : pane.marker
    if (marker === null) {
      add('I5', false, 'the marker is not there in the pane world, so the field it must report cannot be read')
    } else {
      const rows = marker.rows === undefined || marker.rows === null ? [] : marker.rows
      const byId = (id) => rows.find((row) => row.id === id) === undefined ? null : rows.find((row) => row.id === id)
      const providerId = pane.providerActionId
      const evidence = [
        'the marker (as JSON reads it, so a function field is invisible here): ' + clip(String(marker.raw), 900),
        'every contributed row of the marker, with the TYPE of every field it carries: ' + show(rows),
        'the field this reading is about, as the contract spells it: ' + show(HAS_INVOKE),
      ]
      let ok = true
      const wanted = [{ id: ID_ACTION, why: 'the gate own action row' }, { id: ID_THROW, why: 'the gate own throwing action row' }]
      if (providerId === null) evidence.push('n/a  the provider declared no action row, so its own row cannot be held here')
      else wanted.push({ id: providerId, why: 'the provider own action row' })
      for (const want of wanted) {
        const row = byId(want.id)
        if (row === null) { ok = false; evidence.push('FAIL ' + want.why + ' (' + show(want.id) + ') is not in the marker own contributed rows'); continue }
        if (row.reportedTrue !== true) { ok = false; evidence.push('FAIL ' + want.why + ' does not report ' + show(HAS_INVOKE) + ' as true: it reports ' + show(row.reported)) }
        else evidence.push('ok   ' + want.why + ' reports ' + show(HAS_INVOKE) + ' true')
      }
      const control = byId(ID_STATUS)
      if (control === null) { ok = false; evidence.push('FAIL the status control row is not in the marker own contributed rows') }
      else if (control.reportedTrue === true) { ok = false; evidence.push('FAIL the status control row reports ' + show(HAS_INVOKE) + ' true although it carries no invoke: the report is not truthful') }
      else evidence.push('ok   the status control row does not claim a callable: ' + show(control.reported))
      const carried = []
      for (const row of rows) for (const field of row.keys) if (field.type === 'function') carried.push(String(row.id) + '.' + String(field.name))
      if (carried.length > 0) { ok = false; evidence.push('FAIL a function travelled into the marker, which is readable data: ' + show(carried)) }
      else evidence.push('ok   no contributed field of the marker holds a function: the report is a boolean, and the callable stayed out')
      add('I5', ok, ok
        ? 'THE MARKER REPORTS THE CALLABLE AS A BOOLEAN: both action rows say ' + HAS_INVOKE + ' is true, the status control does not claim one, and no function travelled into the marker'
        : 'the marker does not report the callable as readable data - see the FAIL lines', evidence)
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// The self-attack: one edit per mutant, in a staged copy of the two packages, measured by the same
// judge. Every anchor is a byte of the subject artifact's own build.
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

/**
 * The seam's own declare path, found in the built bundle by a family of spellings rather than by one
 * literal: a method or a declared function named declare, an assigned function or arrow, and - when the
 * service literal NAMES a function instead - that function's own head. The statement is injected just
 * inside it, with the parameter name the anchor really carries. An artifact whose declare head this
 * family does not match makes its mutants NOT APPLICABLE, and the readings they were to cover then count
 * as uncovered: that is the named third state, never a silent pass.
 */
function seamAnchor(text) {
  const direct = [
    { kind: 'declare(', re: /declare\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/ },
    { kind: 'declare: function', re: /declare\s*[:=]\s*(?:async\s+)?function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/ },
    { kind: 'declare: arrow', re: /declare\s*[:=]\s*(?:async\s+)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/ },
  ]
  for (const candidate of direct) {
    const match = candidate.re.exec(text)
    if (match !== null) return { kind: candidate.kind, end: match.index + match[0].length, param: match[1] }
  }
  const reference = /declare\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(text)
  if (reference === null) return null
  const name = reference[1]
  const forms = [
    new RegExp('function\\s+' + name + '\\s*\\(\\s*([A-Za-z_$][\\w$]*)'),
    new RegExp(name + '\\s*[:=]\\s*(?:async\\s+)?function\\s*\\(\\s*([A-Za-z_$][\\w$]*)'),
    new RegExp(name + '\\s*[:=]\\s*(?:async\\s+)?\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*=>'),
  ]
  for (const form of forms) {
    const found = form.exec(text)
    if (found === null) continue
    const brace = text.indexOf('{', found.index + found[0].length)
    if (brace === -1) continue
    return { kind: 'declare: ' + name, end: brace + 1, param: found[1] }
  }
  return null
}

/** Inject one statement just inside the seam's own declare head, whichever spelling the bundle uses. */
function injectIntoSeam(path, makeStatement) {
  return editFile(path, (text) => {
    const anchor = seamAnchor(text)
    if (anchor === null) return null
    const statement = makeStatement(anchor.param, anchor.kind)
    if (statement === null || statement === undefined) return null
    return text.slice(0, anchor.end) + ' ' + statement + text.slice(anchor.end)
  })
}

/**
 * The marker's own write, found as DATA rather than by a name: the artifact returns exactly one object
 * literal for the marker in which the two fields this reading holds apart sit side by side - items (the
 * rows the route declared) and contributed (the seam's own list). A mutant that re-merges them has to be
 * written THERE, inside that literal, and this is why the other two spellings were rejected:
 *
 *   (i)  NOT on the returned exports. plugins/<name>/lib/client.js is esbuild's CJS output and its
 *        module.exports is built by __toCommonJS, so the named exports are accessor properties that
 *        cannot be redefined: a wrapper that tries to swap "apply" through Object.defineProperty is a
 *        silent no-op ("Cannot redefine property: apply"), and a mutant that never lands measures
 *        nothing while still declaring a reading it did not move.
 *   (ii) NOT on a timer, or on any turn after the write. A poller that re-merges the marker later is a
 *        race with the judge's own settle window, so whether the edit is observable at all would depend
 *        on the machine and its event loop: an instrument defect dressed as a mutation.
 *
 * Written inside the literal, the marker is BORN carrying the contribution, in the artifact's own realm,
 * on its own synchronous write path - the same bytes on every machine and every run. Two spellings of
 * that literal, the tighter one first; an artifact where neither is found makes the mutant NOT
 * APPLICABLE, the named third state, never a silent pass.
 */
function markerMergeAnchor(text) {
  const member = '([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)'
  const spellings = [
    new RegExp('\\{\\s*mounted:\\s*true\\s*,\\s*tabId:[\\s\\S]{0,400}?\\bitems:\\s*' + member + '\\s*,[\\s\\S]{0,400}?\\bcontributed:\\s*' + member + '\\s*,'),
    new RegExp('\\{\\s*mounted:\\s*true\\s*,[^{}]{0,200}?\\bitems:\\s*' + member + '\\s*,[\\s\\S]{0,400}?\\bcontributed:\\s*' + member + '\\s*,'),
  ]
  for (const spelling of spellings) {
    const found = spelling.exec(text)
    if (found === null) continue
    if (found[1] === found[2]) continue
    return { literal: found[0], at: found.index, items: found[1], contributed: found[2] }
  }
  return null
}

/**
 * What the marker REPORTS, found where the artifact writes it: the contributed property inside the same
 * marker literal markerMergeAnchor locates (mounted/tabId/items/contributed side by side). A mutant that
 * takes a field out of the marker's report has to be written there - not on the row reader the pane also
 * draws, and not on the returned exports - so that the drawn rows stay exactly as delivered and only the
 * marker's own answer moves. An artifact where that literal or that property cannot be found makes the
 * mutant NOT APPLICABLE, the named third state, never a silent pass.
 */
function markerContributedAnchor(text) {
  const literal = markerMergeAnchor(text)
  if (literal === null) return null
  const property = /\bcontributed:\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*,/.exec(literal.literal)
  if (property === null) return null
  return { at: literal.at + property.index, length: property[0].length, contributed: literal.contributed }
}

/**
 * The seam's own press(), and the one catch inside it: the place where an invoke that throws is turned
 * into THAT ROW'S own text instead of an exception on the page. The head is located first, so the catch
 * unwrapped here is the one the press path really runs - the panel half keeps other catches (a fetch that
 * throws, a listener that throws, a read that throws) and unwrapping one of those would declare a reading
 * it cannot move. Inside that head the try/catch is matched as one shape: a receiver .call(name) whose
 * attempt answers the ok face, caught by a parameter the catch answers through a message function. An
 * artifact whose press path is spelled differently makes the mutant NOT APPLICABLE, never a silent pass.
 */
function pressCatchAnchor(text) {
  const head = /press\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/.exec(text)
  if (head === null) return null
  const from = head.index + head[0].length
  const attempt = /try\s*\{\s*([A-Za-z_$][\w$]*)\.call\(\s*([A-Za-z_$][\w$]*)\s*\)\s*;?\s*(return\s*\{[^{}]*\}\s*;?)\s*\}\s*catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s*\{\s*ok:\s*false\s*,\s*detail:\s*[A-Za-z_$][\w$]*\(\s*\4\s*\)\s*\}\s*;?\s*\}/.exec(text.slice(from))
  if (attempt === null) return null
  return {
    at: from + attempt.index,
    length: attempt[0].length,
    replacement: attempt[1] + '.call(' + attempt[2] + '); ' + attempt[3].trim(),
  }
}

/** The mutants, each declaring the set of readings it must move; every edit takes the staged root it must edit. */
function buildMutants(vocabulary) {
  const nearestKnown = vocabulary.kinds[0]
  const sequence = '(globalThis.__gate127Seq = (globalThis.__gate127Seq || 0) + 1)'
  const mutants = []

  mutants.push(
    {
      name: 'panel-translates-an-unknown-kind-to-the-nearest-known-one', expect: ['R-KIND'],
      note: 'the named counter-example of the closed set: the kind this gate declares is rewritten to the nearest kind the build knows, so the seam admits it instead of refusing it by name. Aimed at the probe own fixture, so exactly this reading moves',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && String(' + param + '.kind) === ' + JSON.stringify(UNKNOWN_KIND)
        + ') { ' + param + ' = Object.assign({}, ' + param + ', { kind: ' + JSON.stringify(nearestKnown) + ' }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-tells-the-two-duplicate-claimants-apart', expect: ['R-DUP'],
      note: 'the other named counter-example - "the later claimant wins" starts here: the second claimant is no longer seen as a second claimant of the same id, so nothing is refused and arrival decides everything. Aimed at the probe own fixture, so exactly this reading moves',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && String(' + param + '.id) === ' + JSON.stringify(ID_DUP)
        + ') { ' + param + ' = Object.assign({}, ' + param + ', { id: ' + JSON.stringify(ID_DUP) + ' + "#" + String(' + sequence + ') }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-papers-over-an-empty-source', expect: ['R-SRC'],
      note: 'the source rule, defeated at the seam own door: an item that cannot say where it comes from is given a source and admitted rather than refused by name',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && (typeof ' + param + '.source !== "string" || ' + param + '.source.trim() === ""))'
        + ' { ' + param + ' = Object.assign({}, ' + param + ', { source: "gate127" }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-silently-repairs-a-non-finite-order', expect: ['R-ORDER'],
      note: 'the pass-through rule: the non-finite order is silently replaced by a finite one, so the refusal - and with it the original text the rule is about - never happens',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && typeof ' + param + '.order === "number" && Number.isFinite(' + param + '.order) === false)'
        + ' { ' + param + ' = Object.assign({}, ' + param + ', { order: 0 }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-projects-as-a-function-of-arrival', expect: ['O1'],
      note: 'the identity of every arrival fixture is made arrival-dependent (a sequence number appended to the id), which is the one thing an order-independent projection cannot survive: two arrival orders of the same set answer different bytes. Aimed at the order-independence fixture own ids, so exactly this reading moves',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && /^gate127-arrival-/.test(String(' + param + '.id)))'
        + ' { ' + param + ' = Object.assign({}, ' + param + ', { id: String(' + param + '.id) + "#" + String(' + sequence + ') }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-answers-with-a-name-of-its-own', expect: ['R-KIND', 'R-VOCAB'],
      note: 'the second word list (ruling 1): one of the three frozen names is renamed inside the panel build, so the seam answers under a name of its own',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => text.includes(CODE_KIND) ? text.replaceAll(CODE_KIND, 'GATE127_UNKNOWN_KIND') : null),
    },
    {
      name: 'panel-never-provides-the-seam', expect: ['S1', 'M1', 'I1', 'I2', 'I3', 'I4', 'I5'],
      note: 'the seam itself, removed from the built half: the service name it is provided under is renamed, so the store answers nothing, the provider has nothing to inject into and cannot activate, and the marker cannot report a contribution. The five R193 readings are declared here too, and honestly rather than by tally: with no service there is no table to declare an action into, so the pane world leaves before it mounts a DOM - no row is drawn (I1), nothing is clicked (I2), no throw is contained (I3), no invoke-less action is refused (I4) and no contribution reaches the marker (I5). Each is red on its own terms, not carried along by a click that misbehaved',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => {
        const direct = /(\.provide\(\s*)(["'])linkPanel\2/
        if (direct.test(text)) return text.replace(direct, '$1$2gate127-no-seam$2')
        const call = /\.provide\(\s*([A-Za-z_$][\w$]*)/.exec(text)
        if (call === null) return null
        const at = text.indexOf(call[1] + ' = "')
        if (at === -1) return null
        const end = text.indexOf('"', at + call[1].length + 4)
        if (end === -1) return null
        return text.slice(0, at) + call[1] + ' = "gate127-no-seam"' + text.slice(end + 1)
      }),
    },
    {
      name: 'panel-merges-the-contributions-into-the-marker-items', expect: ['M1'],
      note: 'the one thing ruling 3 forbids, and the reading gate 124 depends on: the marker items is made to carry the contribution list as well, by re-merging the two sources where the artifact itself writes the marker. The merge is written INSIDE the marker own object literal, so the marker is BORN carrying the contribution, synchronously, in the artifact own realm - no wrapper around the exports and no timer, for the two reasons markerMergeAnchor names',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => {
        const anchor = markerMergeAnchor(text)
        if (anchor === null) return null
        const merged = anchor.literal.replace(/([,{]\s*items:\s*)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/, (property, head) => head + '(' + anchor.items + ').concat(' + anchor.contributed + ')')
        if (merged === anchor.literal) return null
        return text.slice(0, anchor.at) + merged + text.slice(anchor.at + anchor.literal.length)
      }),
    },
    {
      name: 'panel-hands-back-a-disposer-that-does-nothing', expect: ['D1'],
      note: 'the disposer, neutralised: declare() still takes the declaration in and the row still appears, but the removal it performs is gone, so a feature that takes its item back out cannot - which is what D1 exists to catch. Three spellings of that one removal, the first that is there',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => {
        const anchors = [
          /claims\.delete\([^)]*\)/,
          /[A-Za-z_$][\w$]*\.delete\(\s*[A-Za-z_$][\w$]*\s*\)/,
          /\.delete\(\s*[A-Za-z_$][\w$]*\s*\)/,
        ]
        for (const anchor of anchors) {
          const found = anchor.exec(text)
          if (found === null) continue
          return text.slice(0, found.index) + 'void 0' + text.slice(found.index + found[0].length)
        }
        return null
      }),
    },
    {
      name: 'provider-stops-calling-declare', expect: ['P1'],
      note: 'the provider built artifact keeps injecting the seam and simply never calls declare, so the call site leaves the bytes and nothing arrives at the service',
      edit: (paths) => editFile(clientBundleOf(paths.root, PROVIDER), (text) => {
        const pattern = /([A-Za-z_$][\w$.]{0,48})\.declare\s*\(/
        return pattern.test(text) ? text.replace(pattern, 'void (') : null
      }),
    },
    // --- R193: the five readings of the action kind, one mutant aimed at each ---------------------
    // Three are injected inside the seam's own declare head (the anchor family above), and each is
    // aimed at ONE declaration rather than at the whole path: the provider's own action, or the two
    // gate fixtures that carry no callable invoke. The other two edit the bytes the artifact itself
    // reads - the catch inside press(), and the contributed property of the marker's own literal.
    {
      name: 'panel-papers-over-an-action-with-no-callable-invoke', expect: ['I4'],
      note: 'R193 ruling 1, defeated at the seam own door - and the paired counter-example the contract names ("invoke becomes an empty function => red"): the two fixtures that carry no callable invoke are handed one, so an action nobody could press is admitted and drawn instead of being refused by its own text with code null. Aimed at the probe own fixture ids, so exactly the reading about them moves',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && (String(' + param + '.id) === ' + JSON.stringify(ID_NOINVOKE) + ' || String(' + param + '.id) === ' + JSON.stringify(ID_BADINVOKE) + '))'
        + ' { ' + param + ' = Object.assign({}, ' + param + ', { invoke: function () {} }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'provider-action-arrives-twice-for-one-click', expect: ['I2'],
      note: 'R193 ruling 2 own "exactly once", defeated where the panel calls the provider: the provider own invoke - the one declaration in the seam this gate did not write - is wrapped to run twice per press, so one real click reaches the provider own navigation twice. No gate fixture is touched and the drawn rows are the same, so only the reading that counts arrivals at that navigation moves',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && String(' + param + '.kind) === ' + JSON.stringify(ACTION_KIND) + ' && /^gate127/.test(String(' + param + '.id)) === false && typeof ' + param + '.invoke === "function")'
        + ' { var gate127once = ' + param + '.invoke; ' + param + ' = Object.assign({}, ' + param + ', { invoke: function () { gate127once.call(this); return gate127once.call(this); } }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'provider-action-is-drawn-as-a-plain-line', expect: ['I1', 'I2'],
      note: 'the kind, no longer deciding the shape: the provider own action kind is rewritten to the reading kind at the seam own door, so that row is drawn as a plain line offering no button. I1 moves because a row the contract says is a button offers none; I2 moves WITH it, and is declared here, because the click I2 dispatches lands on that very shape - a click target that went missing is not a second defect but the same one read by the second reading',
      edit: (paths) => injectIntoSeam(clientBundleOf(paths.root, PANEL), (param, kind) => 'if (' + param + ' && String(' + param + '.kind) === ' + JSON.stringify(ACTION_KIND) + ' && /^gate127/.test(String(' + param + '.id)) === false)'
        + ' { ' + param + ' = Object.assign({}, ' + param + ', { kind: ' + JSON.stringify(STATUS_KIND) + ' }); } /* seam anchor: ' + kind + ' */'),
    },
    {
      name: 'panel-lets-the-throw-escape-the-row', expect: ['I3'],
      note: 'R193 ruling 2 own containment, removed where it lives: the seam own press() calls the invoke without its try, so a throwing invoke no longer becomes THAT row own text - the exception leaves the row and reaches the page own error channels (the window error event / the DOM console), which is the one thing the ruling forbids. The row is still a button and still arrives exactly once, so only the reading that watches that text and those channels moves',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => {
        const anchor = pressCatchAnchor(text)
        if (anchor === null) return null
        return text.slice(0, anchor.at) + anchor.replacement + text.slice(anchor.at + anchor.length)
      }),
    },
    {
      name: 'panel-drops-hasInvoke-from-the-marker', expect: ['I5'],
      note: 'R193 ruling 4 own field, taken back out where the marker is written: the contributed property of the marker own literal rebuilds its rows without hasInvoke, so the marker stops saying whether a row carries a callable - a boolean silently missing rather than a function silently travelling. Written inside that literal (the same anchor family as the merge mutant), so the rows the pane draws are untouched and only the marker own answer moves',
      edit: (paths) => editFile(clientBundleOf(paths.root, PANEL), (text) => {
        const anchor = markerContributedAnchor(text)
        if (anchor === null) return null
        const rebuilt = 'contributed: ' + anchor.contributed + '.map((row) => ({ id: row.id, kind: row.kind, title: row.title, source: row.source, order: row.order, body: row.body })),'
        return text.slice(0, anchor.at) + rebuilt + text.slice(anchor.at + anchor.length)
      }),
    },
  )
  mutants.push({ name: 'control-nothing-changed', expect: [], note: 'the harness must not move a reading on its own', edit: () => ({ applied: true, why: null }) })
  return mutants
}

/** Copy the two declared packages into a staged root and hand a mutant the root it may edit. */
function stageSubject(root, vocabulary) {
  // R193: the real user of the action kind is staged too, so the self-attack baseline is not
  // red for a reason that has nothing to do with the readings it is attacking.
  for (const name of [PANEL, PROVIDER, BROWSER]) {
    const source = join(SUBJECT, 'plugins', name)
    if (!existsSync(source)) continue
    const target = join(root, 'plugins', name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  return { root, vocabulary }
}

const SCRATCH_ROOT = join(PROJECT, SCRATCH_REL)
mkdirSync(SCRATCH_ROOT, { recursive: true })
const freshRun = (label) => mkdtempSync(join(SCRATCH_ROOT, slug(label) + '-'))

const runAttack = (started, vocabulary) => {
  const clean = (run) => { if (!KEEP) { try { rmSync(run.runDir, { recursive: true, force: true }) } catch { /* a locked temp file is not a gate failure */ } } }
  const collect = (label, edit) => {
    const runDir = freshRun(label)
    const root = join(runDir, 'root')
    const paths = stageSubject(root, vocabulary)
    const applied = edit === null ? { applied: true, why: null } : edit(paths)
    return { runDir, applied, world: buildWorld(root, runDir) }
  }
  const baseline = collect('baseline', null)
  if (baseline.world.fatal !== null) { const why = baseline.world.fatal; clean(baseline); return NOT_MEASURED('the staged baseline could not be built: ' + why) }
  const baseReadings = judge(baseline.world)
  const baseRed = baseReadings.filter((reading) => reading.ok === false)
  const baseNotApplicable = baseReadings.filter((reading) => reading.ok === null)
  console.log('  baseline in a staged copy of the declared packages: ' + String(baseReadings.length) + ' readings, ' + String(baseRed.length) + ' failed'
    + (baseNotApplicable.length === 0 ? '' : ', ' + String(baseNotApplicable.length) + ' NOT APPLICABLE named (' + baseNotApplicable.map((reading) => reading.id).join(', ') + ')'))
  clean(baseline)
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed.map((reading) => reading.id)))
    console.log('        (a red baseline is this gate failability evidence; the mutants only mean something once the declared packages are green, e.g. after P1/P2 land and: node plugins/build.mjs)')
    for (const reading of baseRed) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below is ONE edit in a staged copy of the declared packages, measured by the same judge:')
  const mutants = buildMutants(vocabulary)
  let failures = 0
  let uncovered = 0
  const moved = new Map()
  for (const mutant of mutants) {
    const run = collect('mutant-' + mutant.name, mutant.edit)
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
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' - declared=' + show(declared) + ' observed=' + show(observed) + note)
  }
  console.log('  coverage matrix (every reading that IS a green claim must be declared by at least one mutant):')
  for (const reading of baseReadings) {
    const count = moved.get(reading.id) === undefined ? 0 : moved.get(reading.id)
    if (reading.ok === null) {
      console.log('    n/a   ' + reading.id + '  (' + clip(reading.detail, 120) + ')' + (count === 0 ? '' : ' - ' + String(count) + ' mutant(s) declare it by making it applicable'))
      continue
    }
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id + (count === 0 ? '  (' + clip(reading.detail, 120) + ')' : ''))
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(mutants.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failures === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  const runDir = freshRun(SELF_ATTACK ? 'attack' : 'run')
  try {
    const vocabulary = hostVocabulary(SUBJECT)
    if (SELF_ATTACK) {
      if (vocabulary.why !== null) return NOT_MEASURED('the attack needs the host registry own word list to aim its mutants, and ' + vocabulary.why)
      return runAttack(started, vocabulary)
    }
    const world = buildWorld(SUBJECT, runDir)
    if (world.fatal !== null) return NOT_MEASURED(world.fatal)
    const probe = world.probe
    console.log('        the subject' + (SUBJECT === PROJECT ? ' (the tree itself)' : ' (a copy named by --subject)') + ':')
    for (const name of [PANEL, PROVIDER]) console.log('          ' + name + ': ' + world.packages[name].bundle + ' (' + String(existsSync(world.packages[name].bundle) ? readFileSync(world.packages[name].bundle, 'utf8').length : 0) + ' bytes)')
    console.log('        the world: a REAL cordis Context from ' + CORDIS_BUNDLE)
    console.log('          every half plugged through ctx.plugin({ name, apply, inject }) - the composition boot-client.ts performs - with the kernel shipped locale service (' + LOCALE_BUNDLE + ') plugged the same way')
    console.log('        the host registry own word list, read as data from ' + show(world.vocabulary.path) + ': kinds ' + show(world.vocabulary.kinds) + ', codes ' + show(world.vocabulary.codes))
    console.log('        the R191 marker field list, read as data: ' + show(world.frozen.names) + (world.frozen.source === null ? ' (' + String(world.frozen.why) + ')' : ' - ' + String(world.frozen.source)))
    console.log('        the locale service the halves inject: ' + show(probe === null ? null : probe.locale === null ? null : { id: probe.locale.id, class: probe.locale.class, locales: probe.locale.locales }))
    console.log('        the readings declared by this gate: ' + show(READINGS))
    if (probe !== null && probe.ok !== true) console.log('        the probe could not finish: ' + String(probe.why))
    if (probe !== null && probe.errors !== undefined && probe.errors.length > 0) console.log('        the probe recorded ' + String(probe.errors.length) + ' error(s): ' + show(probe.errors.slice(0, 4)))
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
