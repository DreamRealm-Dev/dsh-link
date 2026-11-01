#!/usr/bin/env node
/**
 * R51 (task-97): the roster is ONE source of truth - packages/**, apps/** and vendor/** in a single scan,
 * shared by four consumers, with the apps hole measured rather than asserted away.
 *
 * Subject: .tmp/r51-contract.md. R50's gate (scripts/verify-roster.mjs) still answers "does the roster count
 * the right things"; this gate answers the different question "is there only one roster". So reading 1 is
 * structural, not an import graph: a file that reads the kernel tree, enumerates the three source roots and
 * takes names out of package.json is a second scan whether or not anybody imports it. The shape is matched in
 * two views - the raw text and a string-literal-stripped "code" view - because a gate may legitimately QUOTE
 * the shape as a mutation anchor; only the code view counts, and the difference is printed for a reader to
 * audit rather than hidden.
 *
 * Expectations are computed here: the three source roots and their package names are enumerated by this gate
 * from the tree, the counterexample world is built by this gate, the before/after diff is computed here from
 * the pre-change baseline under .tmp, and the seven real third-party targets are read from usage-targets.json.
 * scripts/compose-profile-rows.mjs, the three other consumers, the four producers and the R50 gates are the
 * PRODUCTS UNDER TEST and run as child processes where what is judged is a process; no reading of this gate
 * nests another gate's readings except reading 7, which is a regression run of the R50 family and says so.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes("--self-attack")

/**
 * Every path is resolved from the argument list on each run, never captured in a constant once: a mutated copy
 * handed in by --self-attack must be the file the readings actually open, or the mutants would be measured
 * against the real product and every one of them would "survive".
 */
let SCRIPTS = ""
let KERNEL = ""
let COMPOSE = ""
let CONTRACT_CHECKER = ""
let IMPORT_CHECKER = ""
let BUNDLE_CHECKER = ""
let ROWS_READER = ""
let IMPORT_OUT = ""
let CONTRACT_OUT = ""
let ROWS_OUT = ""
let DUMP_DIFF = ""
let REPORTS_JSON = ""
let USAGE_TARGETS = ""
let BEFORE_DIR = ""
let ROSTER_GATE = ""
let CONTRACT_GATE = ""
let ROWS_GATE = ""
let EVIDENCE = null
/** Where the producer's "what changed" record may live; every existing one is searched, the requirement is on content. */
let EVIDENCE_CANDIDATES = []

function resolveOptions(args) {
  const pick = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : resolve(args[i + 1]) }
  // The repository's own scripts directory is the default for every PRODUCT path, independent of
  // --scripts-dir: that option moves only the universe readings 1 and 2 SCAN, so a mutant that puts a private
  // roster in a scanned file cannot silently drag the composer and the three consumers along with it.
  const own = join(PROJECT, "scripts")
  SCRIPTS = resolve(pick("--scripts-dir", own))
  KERNEL = resolve(pick("--kernel", join(PROJECT, "core", "deepseek-harness")))
  COMPOSE = resolve(pick("--compose", join(own, "compose-profile-rows.mjs")))
  CONTRACT_CHECKER = resolve(pick("--contract-checker", join(own, "check-plugin-contract.mjs")))
  IMPORT_CHECKER = resolve(pick("--import-checker", join(own, "check-import-resolution.mjs")))
  BUNDLE_CHECKER = resolve(pick("--bundle-checker", join(own, "check-bundle-resolution.mjs")))
  ROWS_READER = resolve(pick("--rows-reader", join(own, "read-composition-rows.mjs")))
  IMPORT_OUT = resolve(pick("--import-out", join(PROJECT, "compat", "adaptation", "import-resolution.json")))
  CONTRACT_OUT = resolve(pick("--contract-out", join(PROJECT, "compat", "adaptation", "plugin-contract.json")))
  ROWS_OUT = resolve(pick("--rows-out", join(PROJECT, "compat", "adaptation", "rows", "profile-composition.json")))
  DUMP_DIFF = resolve(pick("--dump-diff", join(PROJECT, "compat", "adaptation", "rows", "dump-diff.json")))
  REPORTS_JSON = resolve(pick("--reports-json", join(PROJECT, "compat", "adaptation", "rows", "reports", "rows.json")))
  USAGE_TARGETS = resolve(pick("--usage-targets", join(PROJECT, "compat", "adaptation", "usage-targets.json")))
  BEFORE_DIR = resolve(pick("--before-dir", join(PROJECT, ".tmp", "r51-before")))
  ROSTER_GATE = resolve(pick("--roster-gate", join(own, "verify-roster.mjs")))
  CONTRACT_GATE = resolve(pick("--contract-gate", join(own, "verify-plugin-contract.mjs")))
  ROWS_GATE = resolve(pick("--rows-gate", join(own, "verify-composition-rows.mjs")))
  EVIDENCE = pick("--evidence", null)
  EVIDENCE_CANDIDATES = EVIDENCE !== null ? [EVIDENCE] : evidenceCandidates()
}

/**
 * Where a record of "these products moved, and why" may live.
 *
 * Ruling of R52: the surface is EVERY round's handoff record, not this gate's own round. The reading's intent is
 * "somebody named the movement of these products", and pinning the candidates to one round made every later
 * round that regenerates the same products hit the same red for a reason that is not about documentation.
 *
 *   - docs/handoff/R<N>*.md, any round: that round's handoff note;
 *   - .tmp/r<N>*.txt, any round: the raw evidence a round leaves behind.
 *
 * Excluded on purpose: this gate's own transcripts (a file whose name carries "gate"). A gate that prints the
 * changed keys is not a record that somebody documented them, and counting it would make this reading satisfy
 * itself. The requirement is NOT relaxed: every needle still has to appear in ONE record, and that record still
 * has to say whether a verdict moved.
 */
function evidenceCandidates() {
  const out = []
  const handoff = join(PROJECT, "docs", "handoff")
  if (existsSync(handoff)) {
    for (const name of readdirSync(handoff).filter((entry) => /^R\d+.*\.md$/i.test(entry)).sort()) out.push(join(handoff, name))
  }
  const tmp = join(PROJECT, ".tmp")
  if (existsSync(tmp)) {
    for (const name of readdirSync(tmp).filter((entry) => /^r\d+.*\.txt$/i.test(entry) && !/gate/i.test(entry)).sort()) {
      const candidate = join(tmp, name)
      if (statSync(candidate).isFile()) out.push(candidate)
    }
  }
  return out
}
resolveOptions(argv)

/** The three source roots, as the contract names them, with the origin each record must carry. */
const SOURCES = [
  { dir: "packages", origin: "workspace", nested: true },
  { dir: "apps", origin: "app", nested: false },
  { dir: "vendor", origin: "vendor", nested: false },
]
/** What core/deepseek-harness carries, so a reader can see the expectation is the tree, not a constant. */
const expectedKernelTotal = () => enumerateSources().reduce((total, group) => total + group.names.length, 0)

const results = []
/** Set while a mutant is being measured: the readings still run, but the transcript is suppressed. */
let SILENT = false
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  if (SILENT) return
  console.log("  " + (status === true ? "ok  " : status === "skip" ? "SKIP" : "FAIL") + "  " + n + ". " + detail)
}
const say = (text) => { if (!SILENT) console.log("      " + text) }
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "..." : text)
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const readText = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)
const readJson = (path) => { const text = readText(path); if (text === null) return null; try { return JSON.parse(text) } catch { return null } }
const normal = (path) => resolve(path).replace(/[\\/]+$/, "").toLowerCase()
const unique = (list) => [...new Set(list)]

let WORK = null
const work = () => {
  if (WORK === null) WORK = mkTemp("r51-work-")
  return WORK
}

/** Run node and return what the caller needs, never throwing. */
function runNode(args, timeoutMs) {
  const started = Date.now()
  const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: timeoutMs ?? 240000, cwd: PROJECT })
  return {
    status: run.status,
    ms: Date.now() - started,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    text: (run.stdout ?? "") + (run.stderr ?? ""),
  }
}

/**
 * The text with the contents of line comments, block comments and string literals blanked out (newlines kept,
 * so line numbers still line up). A gate that quotes the scan shape as a data string must not read as a scan.
 *
 * @param {string} text - raw source.
 * @returns {string} the code view.
 */
export function stripLiterals(text) {
  const out = []
  let state = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const next = i + 1 < text.length ? text[i + 1] : ""
    if (state === 0) {
      if (c === "/" && next === "/") { out.push("  "); i += 1; state = 4; continue }
      if (c === "/" && next === "*") { out.push("  "); i += 1; state = 5; continue }
      if (c === "'" || c === String.fromCharCode(34) || c === String.fromCharCode(96)) {
        out.push(" "); state = c === "'" ? 1 : c === String.fromCharCode(34) ? 2 : 3; continue
      }
      out.push(c); continue
    }
    if (state === 1 || state === 2 || state === 3) {
      if (c === "\\") { out.push("  "); i += 1; continue }
      const closes = (state === 1 && c === "'") || (state === 2 && c === String.fromCharCode(34)) || (state === 3 && c === String.fromCharCode(96))
      if (closes) state = 0
      out.push(c === String.fromCharCode(10) ? c : " "); continue
    }
    if (state === 4) { if (c === String.fromCharCode(10)) { out.push(c); state = 0 } else out.push(" "); continue }
    if (state === 5) {
      if (c === "*" && next === "/") { out.push("  "); i += 1; state = 0; continue }
      out.push(c === String.fromCharCode(10) ? c : " "); continue
    }
  }
  return out.join("")
}

/**
 * The features of "a second scan", each in the view where it can be judged.
 *
 * @param {string} raw - raw source.
 * @returns {{code: string, kernelRoot: boolean, tokens: string[], manifestName: boolean, scanLoop: boolean, secondScan: boolean}}
 */
export function features(raw) {
  const code = stripLiterals(raw)
  const quote = [39, 34].map((point) => String.fromCharCode(point))
  const tokens = SOURCES.map((source) => source.dir).filter((token) => quote.some((q) => raw.indexOf(q + token + q) !== -1))
  const kernelRoot = /\bKERNEL\b/.test(code)
  const manifestName = /package\.json/.test(raw) && /\.name\b/.test(code) && /JSON\.parse|readFileSync|readJson/.test(code)
  const scanLoop = /readdirSync\s*\(/.test(code)
  return { code, kernelRoot, tokens, manifestName, scanLoop, secondScan: kernelRoot && tokens.length === SOURCES.length && manifestName && scanLoop }
}

/** The line numbers where the scan shape shows, for a reader to check by hand. */
function shapeLines(raw) {
  const lines = raw.split(String.fromCharCode(10))
  const codeLines = stripLiterals(raw).split(String.fromCharCode(10))
  const quote = [39, 34].map((point) => String.fromCharCode(point))
  const hits = { kernelRoot: [], tokens: [], manifestName: [], scanLoop: [] }
  lines.forEach((line, index) => {
    if (/\bKERNEL\b/.test(codeLines[index] ?? "")) hits.kernelRoot.push(index + 1)
    if (SOURCES.some((source) => quote.some((q) => line.indexOf(q + source.dir + q) !== -1))) hits.tokens.push(index + 1)
    if (/package\.json|\.name\b/.test(codeLines[index] ?? "")) hits.manifestName.push(index + 1)
    if (/readdirSync\s*\(/.test(codeLines[index] ?? "")) hits.scanLoop.push(index + 1)
  })
  return hits
}

/**
 * Enumerate the kernel's three source roots here, from the tree, so every count below is this gate's.
 *
 * @returns {{dir: string, origin: string, names: string[], paths: string[], manifests: number}[]}
 */
export function enumerateSources() {
  const groups = []
  for (const source of SOURCES) {
    const at = join(KERNEL, source.dir)
    const names = []
    const paths = []
    let manifests = 0
    if (existsSync(at)) {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const top = join(at, entry.name)
        const dirs = source.nested ? readdirSync(top, { withFileTypes: true }).filter((child) => child.isDirectory()).map((child) => join(top, child.name)) : [top]
        for (const dir of dirs) {
          const manifest = join(dir, "package.json")
          if (!existsSync(manifest)) continue
          manifests += 1
          const parsed = readJson(manifest)
          if (parsed !== null && typeof parsed.name === "string") { names.push(parsed.name); paths.push(dir) }
        }
      }
    }
    groups.push({ dir: source.dir, origin: source.origin, names, paths, manifests })
  }
  return groups
}

/** Import the roster under test, cache-busted so a mutant copy is the code that is measured. */
async function rosterOf(composePath) {
  const url = pathToFileURL(composePath).href + "?v=" + String(Date.now())
  const mod = await import(url)
  return mod
}
/**
 * Reading 1 (S3.1, the key reading of the round): the scan shape exists in exactly one file.
 *
 * The shape is "reads the kernel tree + enumerates all three source roots + takes a name out of a
 * package.json". A file may legitimately QUOTE that shape as data (a mutation anchor), so the features are
 * matched in the string-literal-stripped code view; every near miss is printed with which feature it lacks
 * and whether its kernel mention lives inside a literal, so a reader can audit the difference by hand.
 */
function checkOne() {
  const problems = []
  if (!existsSync(SCRIPTS)) { record(1, false, "the script directory does not exist: " + SCRIPTS); return }
  const files = readdirSync(SCRIPTS).filter((name) => name.endsWith(".mjs")).sort()
  if (files.length === 0) { record(1, false, "no .mjs file to scan in " + SCRIPTS); return }
  const matched = []
  const near = []
  for (const file of files) {
    const raw = readFileSync(join(SCRIPTS, file), "utf8")
    const f = features(raw)
    if (f.secondScan) { matched.push(file); continue }
    const score = (f.kernelRoot ? 1 : 0) + (f.tokens.length === SOURCES.length ? 1 : 0) + (f.manifestName ? 1 : 0) + (f.scanLoop ? 1 : 0)
    if (score >= 3) near.push({ file, kernelRoot: f.kernelRoot, rawKernel: /\bKERNEL\b/.test(raw), tokens: f.tokens, manifestName: f.manifestName, scanLoop: f.scanLoop })
  }
  // SELF-REFERENCE, ruled on in R51 and not an oversight: this gate must enumerate the kernel tree itself to
  // compute its own expectations, so its own text contains the shape it looks for. The expected set is
  // therefore the one roster PLUS this file, both named in the reading and printed. The run-time alternative
  // (splitting the feature constants so the file never contains the whole shape) was rejected: a signature
  // assembled out of halves is harder for a reader to audit, and hiding it would also hide a real second scan
  // that happened to live in a gate. Naming the self-reference keeps the assertion honest and still reddens
  // for every other file.
  const instrument = basename(fileURLToPath(import.meta.url))
  const expected = [basename(COMPOSE)]
  const allowed = expected.concat([instrument])
  say("scanned " + String(files.length) + " file(s) in " + SCRIPTS)
  say("self-reference: " + instrument + " shows the shape too because it enumerates the tree to compute its expectations; it is the named measuring device, so the assertion is \"the one roster plus this file\" and any other hit reddens")
  for (const file of matched) {
    const hits = shapeLines(readFileSync(join(SCRIPTS, file), "utf8"))
    say("scan shape in " + file + ": kernel root at line(s) " + clip(show(hits.kernelRoot), 60)
      + ", source roots at " + clip(show(hits.tokens), 60) + ", package.json name at " + clip(show(hits.manifestName), 60)
      + ", directory loop at " + clip(show(hits.scanLoop), 60))
  }
  for (const row of near) {
    say("near miss (3 of 4 features) " + row.file + ": kernelRoot=" + show(row.kernelRoot) + " (raw mention " + show(row.rawKernel)
      + "), source roots=[" + row.tokens.join(",") + "], package.json name=" + show(row.manifestName) + ", directory loop=" + show(row.scanLoop))
  }
  const extra = matched.filter((file) => allowed.indexOf(file) === -1)
  const missing = expected.filter((file) => matched.indexOf(file) === -1)
  if (extra.length > 0) problems.push("the scan shape is in " + show(extra) + " as well as the one roster: a second scan")
  if (missing.length > 0) problems.push("the shared roster " + show(expected) + " does not show the shape: it does not enumerate all three source roots")
  record(1, problems.length === 0, problems.length === 0
    ? "the shape (kernel tree + packages/apps/vendor + package.json names) is in the one roster " + show(expected) + " and nowhere else a product could read it; the only other hit is this gate itself by self-reference, and the line numbers of every hit are printed above"
    : problems.join(" | "))
}

/**
 * Reading 2 (S3.2): four consumers read that one roster, and no other file defines one.
 */
function checkTwo() {
  const problems = []
  const consumers = [
    { file: COMPOSE, label: basename(COMPOSE), source: true },
    { file: CONTRACT_CHECKER, label: basename(CONTRACT_CHECKER) },
    { file: IMPORT_CHECKER, label: basename(IMPORT_CHECKER) },
    { file: BUNDLE_CHECKER, label: basename(BUNDLE_CHECKER) },
  ]
  const defines = /(^|[^A-Za-z0-9_$])(export\s+)?function\s+kernelRoster\s*\(|(const|let|var)\s+kernelRoster\s*=/
  const definitions = []
  for (const file of readdirSync(SCRIPTS).filter((name) => name.endsWith(".mjs")).sort()) {
    const code = stripLiterals(readFileSync(join(SCRIPTS, file), "utf8"))
    if (defines.test(code)) definitions.push(file)
  }
  if (show(definitions) !== show([basename(COMPOSE)])) {
    problems.push("kernelRoster is defined in " + show(definitions) + ", expected exactly " + show([basename(COMPOSE)]))
  }
  for (const consumer of consumers) {
    if (!existsSync(consumer.file)) { problems.push(consumer.label + " is missing: " + consumer.file); continue }
    const raw = readFileSync(consumer.file, "utf8")
    const code = stripLiterals(raw)
    if (consumer.source === true) {
      if (!/export\s+function\s+kernelRoster\s*\(/.test(code)) problems.push(consumer.label + " does not export kernelRoster: there is no roster to share")
      if (!/export\s+function\s+kernelPackages\s*\(/.test(code)) problems.push(consumer.label + " no longer exports kernelPackages (the wrapper the call sites use)")
      say(consumer.label + " holds the one scan (origin " + show(SOURCES.map((source) => source.origin)) + ", " + String(expectedKernelTotal()) + " package(s) in the tree)")
      continue
    }
    const ownDefinition = defines.test(code)
    const sharedImport = /import\s*\{[^}]*\bkernelRoster\b[^}]*\}\s*from\s*["'][^"']*compose-profile-rows\.mjs["']/.test(raw)
    const callSite = /\bkernelRoster\s*\(/.test(code)
    const line = (raw.split(String.fromCharCode(10)).findIndex((text) => text.indexOf("compose-profile-rows.mjs") !== -1) + 1)
    if (ownDefinition) problems.push(consumer.label + " still defines its own kernelRoster: a private roster survives")
    if (!sharedImport) problems.push(consumer.label + " does not import kernelRoster from compose-profile-rows.mjs")
    if (!callSite) problems.push(consumer.label + " imports the roster but never calls it")
    if (!ownDefinition && sharedImport && callSite) say(consumer.label + " reads the shared roster (imported at line " + String(line) + "), no private definition")
  }
  record(2, problems.length === 0, problems.length === 0
    ? "kernelRoster is defined once, in " + basename(COMPOSE) + ", and all four consumers named by the contract read it (the three others by import, the composer as the definition)"
    : problems.join(" | "))
}

/**
 * Reading 3 (S3.3): the three source roots are all in the roster, and the record of each is right.
 *
 * The names, the directories and the total are enumerated from the kernel tree by this gate; nothing here is
 * read back out of the roster to form the expectation.
 */
async function checkThree() {
  const problems = []
  const groups = enumerateSources()
  const mine = new Map()
  for (const group of groups) {
    if (group.names.length === 0) problems.push("this gate enumerated no package under " + group.dir + ": the tree or the reading is wrong")
    group.names.forEach((name, index) => {
      if (!mine.has(name)) mine.set(name, { origin: group.origin, dir: group.paths[index] })
      else problems.push(name + " is published by two source roots")
    })
  }
  say("enumerated here from the tree: " + groups.map((group) => group.dir + " " + String(group.names.length)).join(", ") + " = " + String(mine.size) + " package(s)")
  const mod = await rosterOf(COMPOSE)
  if (typeof mod.kernelRoster !== "function") { record(3, false, "the composer under test exports no kernelRoster"); return }
  const roster = mod.kernelRoster()
  const missing = [...mine.keys()].filter((name) => !roster.has(name))
  const extra = [...roster.keys()].filter((name) => !mine.has(name))
  if (missing.length > 0) problems.push(String(missing.length) + " package(s) of the tree are not in the roster: " + clip(show(missing), 160))
  if (extra.length > 0) problems.push(String(extra.length) + " name(s) are in the roster but not in the tree: " + clip(show(extra), 160))
  const wrongOrigin = []
  const wrongDir = []
  for (const [name, want] of mine) {
    const row = roster.get(name)
    if (row === undefined) continue
    if (row.origin !== want.origin) wrongOrigin.push(name + " origin " + show(row.origin) + " expected " + show(want.origin))
    if (normal(row.dir ?? "") !== normal(want.dir)) wrongDir.push(name + " dir " + show(row.dir) + " expected " + show(want.dir))
  }
  if (wrongOrigin.length > 0) problems.push(String(wrongOrigin.length) + " record(s) carry the wrong origin: " + clip(show(wrongOrigin), 200))
  if (wrongDir.length > 0) problems.push(String(wrongDir.length) + " record(s) point at the wrong directory: " + clip(show(wrongDir), 200))
  const appGroup = groups.find((group) => group.dir === "apps")
  const appName = appGroup !== undefined && appGroup.names.length > 0 ? appGroup.names[0] : null
  const wrapper = typeof mod.kernelPackages === "function" ? mod.kernelPackages() : null
  if (appName === null) problems.push("the kernel tree carries no apps/ package: nothing proves the apps root reaches the wrapper")
  else if (wrapper === null) problems.push("the composer exports no kernelPackages wrapper")
  else {
    const viaWrapper = wrapper(appName)
    if (viaWrapper === null || viaWrapper === undefined) problems.push("kernelPackages(" + show(appName) + ") resolves nothing: a bundle that lives only under apps/ still drops out of the report")
    else if (normal(viaWrapper) !== normal(appGroup.paths[appGroup.names.indexOf(appName)])) problems.push("kernelPackages(" + show(appName) + ") points at " + show(viaWrapper))
    else say("kernelPackages(" + show(appName) + ") -> " + appGroup.dir + "/: the apps root reaches the call sites that report rows")
  }
  record(3, problems.length === 0, problems.length === 0
    ? "all three roots are in the roster: " + groups.map((group) => group.dir + " " + String(group.names.length) + " (" + group.origin + ")").join(", ") + " = " + String(roster.size) + " package(s), every origin and directory checked against this gate's own enumeration"
    : problems.join(" | "))
}

/**
 * Reading 4 (S3.4): the effect of adding apps/ is measured, not asserted.
 *
 * The diff is computed HERE, from the pre-change baseline the producer stored under .tmp, and the roster block
 * of the tracked contract reading is re-derived from this gate's own enumeration. Sections that only live
 * state can move (liveInputs, layers, digests) are separated from real movement, so "nothing changed" has to
 * survive both the diff and the producer's own record of it.
 */
/**
 * Whether a top-level section is one live state moves. R50 recorded which they are (the composition's
 * layers and ids, and every key named live*): this gate separates them from real movement rather than
 * calling a digest of the live home a change of judgement.
 */
const liveDerived = (key) => /^live/.test(key)
/** The sections whose elements each carry their own provenance, so they are judged element by element. */
const STRUCTURAL = ["layers", "ids"]
/** Whether a path is one this repository derives, as opposed to a file on the live machine. */
const insideRepo = (path) => typeof path === "string" && path !== "" && normal(path).startsWith(normal(PROJECT))

/**
 * Every changed leaf under one section, each tagged with the nearest record that says where it came from.
 *
 * A leaf whose nearest origin is "live", or whose nearest file/path lies outside this repository, is a
 * live-machine input: the application rewrote its own profile patch file, so a digest and the line numbers
 * that point into it move without the repository changing. Everything else is a movement the roster change
 * has to answer for, and there is no third bucket a change can hide in.
 *
 * @param before - the earlier report.
 * @param now - the later report.
 * @param key - the top-level section to walk.
 * @returns the changed leaves, split into those live state explains and those it does not.
 */
function movementOf(before, now, key) {
  const leaves = []
  const walk = (was, is, trail, context) => {
    if (show(was) === show(is)) return
    const object = is !== null && typeof is === "object" ? is : was
    if (object !== null && typeof object === "object") {
      const next = { origin: object.origin === undefined ? context.origin : object.origin, file: object.file === undefined ? (object.path === undefined ? context.file : object.path) : object.file }
      for (const child of unique([...Object.keys(was === undefined ? {} : was), ...Object.keys(is === undefined ? {} : is)])) {
        walk((was === undefined ? {} : was)[child], (is === undefined ? {} : is)[child], trail + "." + child, next)
      }
      return
    }
    leaves.push({ path: trail, before: was, after: is, origin: context.origin, file: context.file })
  }
  walk(before === undefined ? undefined : before[key], now === undefined ? undefined : now[key], key, { origin: null, file: null })
  const live = leaves.filter((leaf) => leaf.origin === "live" || (typeof leaf.file === "string" && leaf.file !== "" && !insideRepo(leaf.file)))
  return { key, leaves, live, unexplained: leaves.filter((leaf) => live.indexOf(leaf) === -1) }
}

function diffArtifact(beforePath, nowPath) {
  const before = readJson(beforePath)
  const now = readJson(nowPath)
  if (before === null || now === null) return { status: "unreadable", changed: [], real: [], live: [] }
  const keys = unique([...Object.keys(before), ...Object.keys(now)])
  const changed = keys.filter((key) => show(before[key]) !== show(now[key]))
  const live = []
  const real = []
  const movements = []
  for (const key of changed) {
    if (liveDerived(key)) { live.push(key); continue }
    if (STRUCTURAL.indexOf(key) !== -1) {
      const movement = movementOf(before, now, key)
      movements.push(movement)
      if (movement.unexplained.length === 0) live.push(key)
      else real.push(key)
      continue
    }
    real.push(key)
  }
  return { status: changed.length === 0 ? "identical" : real.length === 0 ? "live-only" : "real", changed, real, live, movements }
}

function checkFour() {
  const problems = []
  if (!existsSync(BEFORE_DIR)) { record(4, false, "the pre-change baseline is missing: " + BEFORE_DIR + " (no diff can be measured, and an absent baseline must not read as 'nothing changed')"); return }
  const pairs = [
    { label: "import-resolution.json", before: join(BEFORE_DIR, "import-resolution.json"), now: IMPORT_OUT },
    { label: "plugin-contract.json", before: join(BEFORE_DIR, "plugin-contract.json"), now: CONTRACT_OUT },
    { label: "rows/profile-composition.json", before: join(BEFORE_DIR, "profile-composition.json"), now: ROWS_OUT },
    { label: "rows/dump-diff.json", before: join(BEFORE_DIR, "dump-diff.json"), now: DUMP_DIFF },
    { label: "rows/reports/rows.json", before: join(BEFORE_DIR, "reports-rows.json"), now: REPORTS_JSON },
  ]
  const absent = pairs.filter((pair) => !existsSync(pair.before) || !existsSync(pair.now))
  if (absent.length > 0) { record(4, false, "a baseline or an artifact is absent, so 'nothing changed' cannot be concluded: " + clip(show(absent.map((pair) => pair.label)), 200)); return }
  const diffs = pairs.map((pair) => ({ ...pair, diff: diffArtifact(pair.before, pair.now) }))
  for (const row of diffs) {
    say(row.label + ": " + row.diff.status + (row.diff.changed.length === 0 ? "" : " (changed top-level key(s) " + clip(show(row.diff.changed), 110) + ")")
      + (row.diff.live.length > 0 ? " [live-derived: " + row.diff.live.join(",") + "]" : ""))
  }
  const moved = diffs.filter((row) => row.diff.status === "real")
  const liveOnly = diffs.filter((row) => row.diff.status === "live-only")
  const identical = diffs.filter((row) => row.diff.status === "identical")
  const groups = enumerateSources()
  const appsGroup = groups.find((group) => group.dir === "apps")
  const contract = readJson(CONTRACT_OUT)
  const roster = contract !== null && typeof contract === "object" ? contract.roster ?? null : null
  if (roster === null) problems.push("the tracked contract reading carries no roster block, so the apps change is not declared there")
  else {
    const declared = Array.isArray(roster.kernelApps) ? roster.kernelApps : []
    const wantApps = [...appsGroup.names].sort()
    if (show([...declared].sort()) !== show(wantApps)) problems.push("the roster block declares kernelApps " + clip(show(declared), 120) + ", this gate enumerates " + clip(show(wantApps), 120))
    if (roster.kernelRosterSize !== expectedKernelTotal()) problems.push("the roster block declares kernelRosterSize " + show(roster.kernelRosterSize) + ", this gate counts " + String(expectedKernelTotal()) + " in the tree")
    const sources = Array.isArray(roster.sources) ? roster.sources.join(" ") : ""
    if (sources.indexOf("apps") === -1) problems.push("the roster block does not name apps/ among its sources: " + clip(show(roster.sources), 140))
    else say("the tracked contract reading declares kernelApps " + show(wantApps) + " and kernelRosterSize " + show(roster.kernelRosterSize) + ", both recomputed here from the tree")
  }
  const candidates = EVIDENCE_CANDIDATES.filter((path) => existsSync(path))
  say("records searched (every round's handoff, this gate's own transcripts excluded): " + String(candidates.length) + " file(s) "
    + clip(show(candidates.map((path) => path.replace(PROJECT, ""))), 220))
  if (candidates.length === 0) problems.push("no record of the measured difference exists (looked for " + clip(show(EVIDENCE_CANDIDATES.map((path) => path.replace(PROJECT, ""))), 200) + ")")
  const hunt = moved.length > 0
    ? { keys: unique(moved.flatMap((row) => row.diff.real)), labels: moved.map((row) => basename(row.label)) }
    : { keys: unique(liveOnly.flatMap((row) => row.diff.live)), labels: [] }
  const needs = hunt.keys.concat(["apps"])
  const found = []
  for (const path of candidates) {
    const text = readFileSync(path, "utf8")
    const missing = needs.filter((needle) => text.indexOf(needle) === -1)
    if (missing.length === 0) found.push(path)
    say("record " + basename(path) + " (" + String(text.length) + " bytes): names " + show(needs.filter((needle) => text.indexOf(needle) !== -1)) + (missing.length === 0 ? " - all of it" : " - missing " + show(missing)))
  }
  if (candidates.length > 0 && found.length === 0) problems.push("no existing record names the measured difference (" + clip(show(needs), 120) + "): the change would be undocumented")
  if (moved.length > 0) {
    if (hunt.labels.length > 0 && !found.some((path) => hunt.labels.every((label) => readFileSync(path, "utf8").indexOf(label) !== -1))) problems.push("the record does not name the artifact(s) that moved: " + show(hunt.labels))
    const verdictWords = /flipped|regress|verdict|judgement|判定/
    if (found.length > 0 && !found.some((path) => verdictWords.test(readFileSync(path, "utf8")))) problems.push("the record does not say whether any verdict moved (no flipped/regressed/judgement wording): a bare 'the roster grew' is not a measurement")
  }
  say("this gate's diff: " + String(identical.length) + " artifact(s) byte-identical, " + String(liveOnly.length) + " moved only in live-derived sections, " + String(moved.length) + " moved in a real section")
  record(4, problems.length === 0, problems.length === 0
    ? "the apps change is measured here from the pre-change baseline: " + (moved.length > 0 ? show(moved.map((row) => basename(row.label))) + " moved in " + show(hunt.keys) : "no real section moved, only live-derived ones")
      + ", the tracked contract reading's kernelApps/kernelRosterSize were recomputed from the tree, and the producer's record names the difference"
    : problems.join(" | "))
}
/**
 * A synthetic kernel world, built here: three source roots with one package each, a relocated copy of the
 * consumer under test, and one probe plugin whose imports are known to this gate. The consumer computes its
 * own repository root from its own location, so a copy under .tmp reads the world, not this repository.
 */
function relocate(raw, sourcePath, keepInWorld) {
  let moved = 0
  const text = raw.replace(/(from\s*)(["'])(\.[^"']+)\2/g, (match, lead, quote, spec) => {
    if (basename(spec) === keepInWorld && spec.indexOf("/") === spec.lastIndexOf("/")) return match
    moved += 1
    return lead + quote + pathToFileURL(resolve(dirname(sourcePath), spec)).href + quote
  })
  return { text, moved }
}

/** The line every product computes its repository root on. */
const REPO_LINE = "const REPO = resolve(HERE, '..')"

/**
 * Point a copy of a product at this repository. A copy under .tmp computes its own root from its own location,
 * so a mutated composer would find no kernel tree and every reading would redden for the WRONG reason (the
 * relocation, not the mutation). Seeding the root back to the real repository makes the copy behave like the
 * original except for the mutation, which is the only difference a mutant is allowed to introduce.
 */
function pinRepo(raw, target) {
  return swap(raw, REPO_LINE, "const REPO = " + JSON.stringify(target.replaceAll("\\", "/")))
}

/** Undo a pin, so a copy that is relocated into a staged world computes the world's root instead. */
function unpinRepo(raw) {
  const newline = String.fromCharCode(10)
  return raw.split(newline).map((line) => (line.startsWith("const REPO = ") && line.indexOf("resolve(HERE, '..')") === -1 ? REPO_LINE : line)).join(newline)
}

function writeManifest(dir, name) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.1" }, null, 1) + String.fromCharCode(10))
  return dir
}

/** @returns {{root: string, scripts: string, artifact: string, probe: string, relocations: number}} */
function buildWorld(composePath, checkerPath) {
  // Through mkTemp, not mkdtempSync: a world that is not registered in MADE is scratch left behind on every
  // run (found at R52 integration: ~140 r51-world-* directories had accumulated because this line bypassed it).
  const root = mkTemp("r51-world-")
  const scripts = join(root, "scripts")
  mkdirSync(scripts, { recursive: true })
  const kernel = join(root, "core", "deepseek-harness")
  writeManifest(join(kernel, "packages", "@r51-fake", "alpha"), "@r51-fake/alpha")
  writeManifest(join(kernel, "apps", "child-app"), "r51-fake-app")
  writeManifest(join(kernel, "vendor", "fake-vendor"), "r51-fake-vendor")
  let relocations = 0
  for (const source of [composePath, checkerPath]) {
    const raw = unpinRepo(readFileSync(source, "utf8"))
    const { text, moved } = relocate(raw, source, "compose-profile-rows.mjs")
    relocations += moved
    writeFileSync(join(scripts, basename(source)), text)
  }
  const probe = join(root, "targets", "r51-probe")
  mkdirSync(probe, { recursive: true })
  writeFileSync(join(probe, "package.json"), JSON.stringify({ name: "r51-probe", version: "0.0.1" }, null, 1) + String.fromCharCode(10))
  mkdirSync(join(probe, "lib"), { recursive: true })
  writeFileSync(join(probe, "lib", "probe.js"), [
    "import alpha from '@r51-fake/alpha'",
    "import app from 'r51-fake-app'",
    "import vendor from 'r51-fake-vendor'",
    "import missing from '@r51-nope/not-provided'",
    "import { readFileSync as builtin } from 'node:fs'",
    "export const all = [alpha, app, vendor, missing, builtin]",
    "",
  ].join(String.fromCharCode(10)))
  const targets = join(root, "compat", "adaptation")
  mkdirSync(targets, { recursive: true })
  writeFileSync(join(targets, "usage-targets.json"), JSON.stringify({ format: "dsh-link.usage-targets/1", targets: [{ name: "r51-probe", version: "0.0.1", dir: probe }] }, null, 1) + String.fromCharCode(10))
  return { root, scripts, artifact: join(targets, "import-resolution.json"), probe, relocations }
}

/**
 * Reading 5 (S3.5): a name nobody provides is still refused, and the shared roster is what answers.
 *
 * The world is built here, so every expectation below is this gate's: three synthetic packages exist, a fourth
 * name exists nowhere, and the probe imports all four plus a relative path. If the consumer had a private
 * single-root roster the app name would read unresolved; if the counterexample had been papered over by a
 * permissive fallback the missing name would read resolved.
 */
async function checkFive() {
  const problems = []
  if (!existsSync(IMPORT_CHECKER)) { record(5, false, "the consumer under test is missing: " + IMPORT_CHECKER); return }
  // Half one, as ruled: the shared scan is pointed at a staged tree through kernelRoster(roots), one package
  // per source shape (nested workspace, flat app, flat vendor), and the REAL tree is asked again afterwards -
  // so "the seam answers" cannot be bought by breaking the default the four consumers call.
  const mod = await rosterOf(COMPOSE)
  if (typeof mod.kernelRoster !== "function") {
    record(5, false, "the composer exports no kernelRoster, so neither half of this reading can be taken")
    return
  }
  const staged = mkTemp("r51-staged-")
  const stagedKernel = join(staged, "kernel")
  const stagedAlpha = writeManifest(join(stagedKernel, "packages", "@r51-fake", "alpha"), "@r51-fake/alpha")
  const stagedApp = writeManifest(join(stagedKernel, "apps", "child-app"), "r51-fake-app")
  const stagedVendor = writeManifest(join(stagedKernel, "vendor", "fake-vendor"), "r51-fake-vendor")
  const stagedRoots = [
    { origin: "workspace", at: join(stagedKernel, "packages") },
    { origin: "app", at: join(stagedKernel, "apps") },
    { origin: "vendor", at: join(stagedKernel, "vendor") },
  ]
  const groups = enumerateSources()
  const inTree = new Set(groups.flatMap((group) => group.names))
  const realBefore = mod.kernelRoster()
  const stagedRoster = mod.kernelRoster(stagedRoots)
  const realAfter = mod.kernelRoster()
  say("staged tree built here (nested workspace, flat app, flat vendor): the shared scan over it carries " + show([...stagedRoster.keys()].sort()) + " = " + String(stagedRoster.size) + " record(s)")
  for (const [name, wantOrigin, wantDir] of [["@r51-fake/alpha", "workspace", stagedAlpha], ["r51-fake-app", "app", stagedApp], ["r51-fake-vendor", "vendor", stagedVendor]]) {
    const row = stagedRoster.get(name)
    if (row === undefined) { problems.push(name + " is not in the roster built over the staged tree: the " + wantOrigin + " root does not answer"); continue }
    if (row.origin !== wantOrigin) problems.push(name + " carries origin " + show(row.origin) + " over the staged tree, expected " + show(wantOrigin))
    if (normal(row.dir ?? "") !== normal(wantDir)) problems.push(name + " points at " + show(row.dir) + " over the staged tree, expected " + wantDir)
  }
  if (stagedRoster.size !== 3) problems.push("the staged roster carries " + String(stagedRoster.size) + " record(s), expected the 3 packages this gate wrote: it read something besides the staged roots")
  if (stagedRoster.has("@r51-nope/not-provided")) problems.push("a name nobody provides appears in the staged roster")
  if (show([...realAfter.keys()].sort()) !== show([...realBefore.keys()].sort())) problems.push("the default roster moved after a staged call: the roots parameter behaves like a global, not a parameter")
  if (realAfter.size !== inTree.size) problems.push("the default roster carries " + String(realAfter.size) + " package(s); this gate counts " + String(inTree.size) + " in the tree")
  say("the real tree, asked again after the staged call: " + String(realAfter.size) + " package(s) in " + groups.map((group) => group.dir + " " + String(group.names.filter((name) => realAfter.has(name)).length)).join(", ") + " (unchanged, and this is the default the four consumers call)")
  const world = buildWorld(COMPOSE, IMPORT_CHECKER)
  if (!existsSync(join(world.scripts, basename(COMPOSE))) || world.relocations === 0) {
    record(5, false, "the world did not come together (composer copied " + show(existsSync(join(world.scripts, basename(COMPOSE)))) + ", relocations " + String(world.relocations) + "): a world that silently falls back to this repository measures nothing")
    return
  }
  const run = runNode([join(world.scripts, basename(IMPORT_CHECKER))], 120000)
  const report = readJson(world.artifact)
  if (report === null) {
    record(5, false, "the consumer in the world wrote no report (exit " + show(run.status) + "): " + clip(run.text, 200))
    return
  }
  const rows = Array.isArray(report.plugins) && report.plugins[0] !== undefined && Array.isArray(report.plugins[0].rows) ? report.plugins[0].rows : []
  const classOf = (specifier) => { const row = rows.find((entry) => entry.specifier === specifier); return row === undefined ? null : row.class }
  say("world: " + world.root.replace(PROJECT, "") + ", three synthetic manifests, the consumer relocated (" + String(world.relocations) + " relative import(s) rewritten)")
  say("world report: kernelPackages=" + show(report.kernelPackages) + "; classes " + show(rows.map((row) => row.specifier + "=" + row.class)))
  if (report.kernelPackages !== 3) problems.push("the consumer read " + show(report.kernelPackages) + " kernel package(s) from the world, expected the 3 this gate wrote")
  for (const [specifier, want] of [["@r51-fake/alpha", "resolves"], ["r51-fake-app", "resolves"], ["r51-fake-vendor", "resolves"]]) {
    const got = classOf(specifier)
    if (got !== want) problems.push(specifier + " reads " + show(got) + " in the world, expected " + show(want) + " (a shared roster over all three roots answers it)")
  }
  const missing = classOf("@r51-nope/not-provided")
  if (missing !== "undeclared-not-found") problems.push("a name no source provides reads " + show(missing) + " instead of undeclared-not-found: the counterexample was lost")
  // A relative specifier never reaches the report: the analyzer drops anything starting with a dot
  // (analyze-plugin-usage.mjs:183), so the "this is not a package" row is provoked with a node: builtin,
  // which is extracted, refused by splitSpecifier and must still be counted as not-a-package.
  const builtin = classOf("node:fs")
  if (builtin !== "not-a-package") problems.push("a node: builtin reads " + show(builtin) + " instead of not-a-package")
  record(5, problems.length === 0, problems.length === 0
    ? "the shared scan over a staged tree answers for all three source shapes (nested workspace, flat app, flat vendor) with the right origin and directory, the real tree still carries " + String(realAfter.size) + " packages afterwards, and in a relocated world the whole consumer still reads a name no source provides as undeclared-not-found"
    : problems.join(" | "))
}

/**
 * Reading 6 (S3.6): the four tracked products are recomputable, the seven real targets keep their shape, and
 * the drift instrument actually fires.
 *
 * The real producers are run here (never another gate's readings), the roster-independent sections of the
 * composition are compared byte for byte, and the seven real third-party targets are read from
 * usage-targets.json by this gate rather than counted out of the report.
 */
function checkSix() {
  const problems = []
  const contractTmp = join(work(), "plugin-contract.json")
  const importCheck = runNode([IMPORT_CHECKER, "--check"], 180000)
  if (importCheck.status !== 0) problems.push("check-import-resolution --check exits " + show(importCheck.status) + ": " + clip(importCheck.text, 160))
  else say("check-import-resolution --check: " + clip(importCheck.stdout.trim(), 150))
  const contractAll = runNode([CONTRACT_CHECKER, "--all", "--out", contractTmp], 180000)
  const fresh = readText(contractTmp)
  const tracked = readText(CONTRACT_OUT)
  if (contractAll.status !== 0 || fresh === null) problems.push("check-plugin-contract --all --out exits " + show(contractAll.status) + ": " + clip(contractAll.text, 160))
  else if (fresh !== tracked) problems.push("--all --out does not reproduce the tracked contract reading byte for byte: " + String(fresh.length) + " vs " + String(tracked.length) + " bytes")
  else say("check-plugin-contract --all --out reproduces the tracked reading byte for byte (" + String(fresh.length) + " bytes)")
  const contractCheck = runNode([CONTRACT_CHECKER, "--all", "--check"], 180000)
  if (contractCheck.status !== 0) problems.push("check-plugin-contract --all --check exits " + show(contractCheck.status) + ": " + clip(contractCheck.text, 160))
  const rowsCheck = runNode([ROWS_READER, "--check"], 180000)
  if (rowsCheck.status !== 0) problems.push("read-composition-rows --check exits " + show(rowsCheck.status) + ": " + clip(rowsCheck.text, 160))
  else say("read-composition-rows --check: " + clip(rowsCheck.stdout.trim().split(String.fromCharCode(10)).slice(-1)[0], 150))
  const first = join(work(), "compose-a.json")
  const second = join(work(), "compose-b.json")
  const one = runNode([COMPOSE, "--out", first], 180000)
  const two = runNode([COMPOSE, "--out", second], 180000)
  if (one.status !== 0 || two.status !== 0) problems.push("the composer exits " + show(one.status) + "/" + show(two.status) + ": " + clip(one.text + two.text, 160))
  else if (readText(first) !== readText(second)) problems.push("two runs of the composer over the same inputs disagree")
  else {
    const freshRows = readJson(first)
    const trackedRows = readJson(ROWS_OUT)
    const drifted = trackedRows === null ? ["(tracked rows unreadable)"] : Object.keys(trackedRows).filter((key) => show(freshRows[key]) !== show(trackedRows[key]))
    // Element by element, as ruled: a change inside layers/ids is put down to live state only when every
    // changed element points at a live input (origin "live", or a file outside this repository). A single
    // element pointing at a repository-derived file is a movement the roster change has to answer for.
    const notLive = []
    for (const key of drifted) {
      if (liveDerived(key)) continue
      if (STRUCTURAL.indexOf(key) !== -1) {
        const movement = movementOf(trackedRows, freshRows, key)
        if (movement.unexplained.length === 0) {
          say("  " + key + ": " + String(movement.leaves.length) + " changed element(s), every one pointing at a live-machine file outside the repository, e.g. " + show(movement.live.slice(0, 2).map((leaf) => leaf.path)))
          continue
        }
        say("  " + key + ": " + String(movement.unexplained.length) + " changed element(s) this gate cannot put down to live state, first " + show(movement.unexplained[0].path) + " " + show(movement.unexplained[0].before) + " -> " + show(movement.unexplained[0].after))
        notLive.push(key)
        continue
      }
      notLive.push(key)
    }
    if (notLive.length > 0) problems.push("the roster change moved sections of the composition analysis that live state cannot explain: " + show(notLive))
    say("composer deterministic over two runs: true; tracked vs fresh differs in " + clip(show(drifted), 110) + " (live-derived, not gated)")
  }
  const targetsFile = readJson(USAGE_TARGETS)
  const targets = targetsFile !== null && Array.isArray(targetsFile.targets) ? targetsFile.targets : null
  const report = readJson(IMPORT_OUT)
  if (targets === null) problems.push("usage-targets.json carries no targets: the seven real targets cannot be enumerated")
  else if (report === null || !Array.isArray(report.plugins)) problems.push("the committed resolution report cannot be read")
  else {
    if (targets.length !== 7) problems.push("usage-targets.json now carries " + String(targets.length) + " target(s), expected the recorded 7")
    const shape = (plugins) => plugins.map((plugin) => ({ name: plugin.name, version: plugin.version, rows: Array.isArray(plugin.rows) ? plugin.rows.length : null, classes: unique((plugin.rows ?? []).map((row) => row.class)).sort() }))
    const wantShape = targets.map((target) => ({ name: target.name, version: target.version }))
    const gotNames = report.plugins.map((plugin) => ({ name: plugin.name, version: plugin.version }))
    if (show(gotNames) !== show(wantShape)) problems.push("the report's target section is not the seven real targets in order: " + clip(show(gotNames), 200))
    for (const plugin of report.plugins) {
      const rows = Array.isArray(plugin.rows) ? plugin.rows : []
      const sum = Object.values(plugin.counts ?? {}).reduce((total, value) => total + value, 0)
      if (sum !== rows.length) problems.push(plugin.name + " counts sum to " + String(sum) + " but it carries " + String(rows.length) + " row(s)")
    }
    if (report.kernelPackages !== expectedKernelTotal()) problems.push("the report declares " + show(report.kernelPackages) + " kernel package(s); this gate counts " + String(expectedKernelTotal()) + " in the tree: two rosters again")
    const before = readJson(join(BEFORE_DIR, "import-resolution.json"))
    if (before !== null && Array.isArray(before.plugins)) {
      const sameShape = show(shape(before.plugins)) === show(shape(report.plugins))
      if (!sameShape) problems.push("the seven real third-party targets changed shape across the change: " + clip(show(shape(report.plugins)), 200))
      else say("the seven real third-party targets: " + String(targets.length) + " target(s), per-plugin row counts and class vocabulary unchanged against the pre-change baseline")
    } else say("the seven real third-party targets: " + String(targets.length) + " target(s) in usage-targets.json, matched against the report by name and version")
  }
  const world = buildWorld(COMPOSE, IMPORT_CHECKER)
  const plain = runNode([join(world.scripts, basename(IMPORT_CHECKER))], 120000)
  const pass = runNode([join(world.scripts, basename(IMPORT_CHECKER)), "--check"], 120000)
  const seeded = readJson(world.artifact)
  if (seeded !== null) writeFileSync(world.artifact, JSON.stringify({ ...seeded, kernelPackages: (seeded.kernelPackages ?? 0) + 1 }, null, 1) + String.fromCharCode(10))
  const stale = runNode([join(world.scripts, basename(IMPORT_CHECKER)), "--check"], 120000)
  if (plain.status !== 0) problems.push("the consumer in the world exits " + show(plain.status) + " on a plain run")
  if (pass.status !== 0) problems.push("--check exits " + show(pass.status) + " against a report the same code just wrote")
  if (seeded === null) problems.push("the world wrote no report, so the drift instrument could not be provoked")
  else if (stale.status === 0) problems.push("--check exits 0 against a deliberately corrupted report: the recomputation compares nothing")
  else say("drift instrument: plain run exit " + show(plain.status) + ", --check exit " + show(pass.status) + ", --check against a corrupted report exit " + show(stale.status))
  record(6, problems.length === 0, problems.length === 0
    ? "the four products recompute (--check and --all --out byte for byte, the composer deterministic), the seven real targets keep their name/version/row-count/class shape, and --check refuses a corrupted reading"
    : problems.join(" | "))
}
/**
 * Reading 7 (S3.7): the R50 family did not regress.
 *
 * Under --self-attack the three gates are replaced by stubs and a mutant makes one of them fail: a roster
 * mutant must not be allowed to launch three other gates a dozen times, and what this reading has to show
 * there is that it notices a failing neighbour at all. The real gates are the ones run in a normal pass.
 */
function parseTally(text) {
  const match = text.match(/(\d+)\s+(readings?|checks?),\s*(\d+)\s+held,\s*(\d+)\s+skipped,\s*(\d+)\s+failed/)
  return match === null ? null : { total: Number(match[1]), held: Number(match[3]), skipped: Number(match[4]), failed: Number(match[5]), unit: match[2] }
}

function checkSeven() {
  const problems = []
  const wanted = [
    { label: "verify-roster (R50, the roster counts right)", path: ROSTER_GATE, total: 7 },
    { label: "verify-plugin-contract (R47)", path: CONTRACT_GATE, total: 7 },
    { label: "verify-composition-rows (R20)", path: ROWS_GATE, total: 11 },
  ]
  // Ruled in R51: the neighbouring gates run at THIS repository's root, never inside a staged world (a staged
  // world carries no plugins/, so a neighbour spawned there fails for a reason that is not about the roster).
  // The root is printed, and a gate that resolves outside the repository is a problem in its own right.
  say("neighbour gates are spawned with the repository root as their working directory: " + PROJECT)
  for (const spec of wanted) {
    if (!existsSync(spec.path)) { problems.push(spec.label + " is missing: " + spec.path); continue }
    if (!insideRepo(spec.path)) { problems.push(spec.label + " resolves outside the repository (" + spec.path + "): it would be run against the wrong root"); continue }
    say("  " + spec.label + " -> " + spec.path.replace(PROJECT, ".") + " at " + PROJECT)
    const run = runNode([spec.path], 240000)
    const tally = parseTally(run.text)
    if (run.status !== 0) {
      const failing = run.text.split(String.fromCharCode(10)).filter((line) => line.indexOf("FAIL") !== -1 || /failed/.test(line)).slice(0, 3)
      problems.push(spec.label + " exits " + show(run.status) + ": " + clip(failing.join(" | "), 220))
      say(spec.label + " exit " + show(run.status) + " in " + String(run.ms) + " ms, tally " + show(tally))
      continue
    }
    if (tally === null) { problems.push(spec.label + " exits 0 but printed no tally line: " + clip(run.text.slice(-220), 220)); continue }
    if (tally.failed !== 0 || tally.total !== spec.total || tally.held !== spec.total) {
      problems.push(spec.label + " reads " + String(tally.total) + " " + tally.unit + " / " + String(tally.held) + " held / " + String(tally.failed) + " failed, expected " + String(spec.total) + " held and none failed")
    }
    say(spec.label + ": exit " + show(run.status) + ", " + String(tally.total) + " " + tally.unit + ", " + String(tally.held) + " held, " + String(tally.skipped) + " skipped, " + String(tally.failed) + " failed, " + String(run.ms) + " ms")
  }
  say("regression runs of other PRODUCTS as child processes; no reading of this gate nests another gate's readings")
  record(7, problems.length === 0, problems.length === 0
    ? "the neighbouring products are still green after the roster was merged: " + wanted.map((spec) => basename(spec.path)).join(", ")
    : problems.join(" | "))
}

/** Count how often an anchor occurs, so a mutation can never silently edit the wrong branch. */
function occurrences(text, find) {
  let count = 0
  let at = text.indexOf(find)
  while (at !== -1) { count += 1; at = text.indexOf(find, at + find.length) }
  return count
}

/** A mutation is an anchored replacement; an anchor that does not occur exactly once is a gate failure. */
function swap(text, find, replace, times) {
  const want = times ?? 1
  const found = occurrences(text, find)
  if (found !== want) throw new Error("anchor occurs " + String(found) + " time(s), expected " + String(want) + ": " + clip(show(find), 120))
  return text.split(find).join(replace)
}

function editFile(path, mutate) {
  const raw = readFileSync(path, "utf8")
  writeFileSync(path, mutate(raw))
}

/** A stub standing in for a neighbouring gate under --self-attack. */
function stubGate(dir, label, total, unit, fails) {
  const path = join(dir, "stub-" + label + ".mjs")
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "console.log('  stub standing in for " + label + " under --self-attack')",
    "console.log('" + String(total) + " " + unit + ", " + String(fails ? total - 1 : total) + " held, 0 skipped, " + String(fails ? 1 : 0) + " failed')",
    "process.exit(" + String(fails ? 1 : 0) + ")",
    "",
  ].join(String.fromCharCode(10)))
  return path
}

/** The option set a mutant run uses: whichever of the copied products exist in its directory are read there. */
function overridesFor(dir, extra) {
  const args = []
  const known = [
    ["--scripts-dir", ""],
    ["--compose", "compose-profile-rows.mjs"],
    ["--import-checker", "check-import-resolution.mjs"],
    ["--bundle-checker", "check-bundle-resolution.mjs"],
    ["--contract-checker", "check-plugin-contract.mjs"],
  ]
  for (const [flag, name] of known) {
    const path = name === "" ? dir : join(dir, "scripts", name)
    if (name === "" || existsSync(path)) args.push(flag, path)
  }
  return args.concat(extra ?? [])
}
/** A second, private roster: the R51 hole in reverse, with the full three-root shape. */
const SECOND_SCAN = [
  "import { existsSync, readdirSync, readFileSync } from 'node:fs'",
  "import { dirname, join, resolve } from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
  "const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')",
  "const KERNEL = join(REPO, 'core', 'deepseek-harness')",
  "/** A private roster, defined next to the shared one. */",
  "export function kernelRoster() {",
  "  const roster = new Map()",
  "  for (const group of ['packages', 'apps', 'vendor']) {",
  "    const at = join(KERNEL, group)",
  "    if (!existsSync(at)) continue",
  "    for (const entry of readdirSync(at, { withFileTypes: true })) {",
  "      const manifest = join(at, entry.name, 'package.json')",
  "      if (!existsSync(manifest)) continue",
  "      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))",
  "      if (typeof parsed.name === 'string') roster.set(parsed.name, { dir: at })",
  "    }",
  "  }",
  "  return roster",
  "}",
  "",
].join(String.fromCharCode(10))

/** The consumer's own single-root scan, the shape R50 found and R51 removed. */
const PRIVATE_ROSTER = [
  "import { readdirSync } from 'node:fs'",
  "function kernelRoster() {",
  "  const roster = new Map()",
  "  const at = join(KERNEL, 'packages')",
  "  if (existsSync(at)) {",
  "    for (const group of readdirSync(at, { withFileTypes: true })) {",
  "      if (!group.isDirectory()) continue",
  "      for (const child of readdirSync(join(at, group.name), { withFileTypes: true })) {",
  "        if (!child.isDirectory()) continue",
  "        const manifest = join(at, group.name, child.name, 'package.json')",
  "        if (!existsSync(manifest)) continue",
  "        const parsed = JSON.parse(readFileSync(manifest, 'utf8'))",
  "        if (typeof parsed.name === 'string') roster.set(parsed.name, { dir: dirname(manifest), exports: parsed.exports === undefined ? null : parsed.exports, client: parsed.dsh === undefined ? null : parsed.dsh.client })",
  "      }",
  "    }",
  "  }",
  "  return roster",
  "}",
].join(String.fromCharCode(10))

/** The whole three-root scan as a private definition: the shape reading 1 hunts, hiding in a consumer. */
const PRIVATE_FULL_SCAN = [
  "import { readdirSync } from 'node:fs'",
  "const KERNEL = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'core', 'deepseek-harness')",
  "function kernelRoster() {",
  "  const roster = new Map()",
  "  for (const group of ['packages', 'apps', 'vendor']) {",
  "    const at = join(KERNEL, group)",
  "    if (!existsSync(at)) continue",
  "    for (const entry of readdirSync(at, { withFileTypes: true })) {",
  "      const manifest = join(at, entry.name, 'package.json')",
  "      if (!existsSync(manifest)) continue",
  "      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))",
  "      if (typeof parsed.name === 'string') roster.set(parsed.name, { dir: at })",
  "    }",
  "  }",
  "  return roster",
  "}",
].join(String.fromCharCode(10))

const COMPOSE_NAME = "compose-profile-rows.mjs"
const IMPORT_NAME = "check-import-resolution.mjs"
const BUNDLE_NAME = "check-bundle-resolution.mjs"
const CONTRACT_NAME = "check-plugin-contract.mjs"

/**
 * Each mutant names the readings it must redden. Anchors are taken from the product under test, so a mutant
 * whose anchor has drifted fails loudly instead of quietly doing nothing.
 */
const MUTATIONS = [
  {
    id: "M1", note: "a second roster file appears next to the shared one", declared: [1, 2], files: [COMPOSE_NAME, IMPORT_NAME, BUNDLE_NAME, CONTRACT_NAME],
    mutate: (ctx) => writeFileSync(join(ctx.scripts, "r51-second-roster.mjs"), SECOND_SCAN),
    options: (ctx) => ["--scripts-dir", ctx.scripts],
  },
  {
    id: "M2", note: "the shared roster keeps the apps root but points it away from the tree", declared: [3, 5], files: [COMPOSE_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, COMPOSE_NAME), (raw) => swap(raw, "at: join(KERNEL, 'apps')", "at: join(KERNEL, 'apps', '.r51-not-scanned')")),
    options: (ctx) => ["--scripts-dir", ctx.scripts, "--compose", join(ctx.scripts, COMPOSE_NAME)],
  },
  {
    id: "M3", note: "workspace records are labelled 'packages' instead of the contract's 'workspace'", declared: [3], files: [COMPOSE_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, COMPOSE_NAME), (raw) => swap(raw, "{ origin: 'workspace', at: join(KERNEL, 'packages') },", "{ origin: 'packages', at: join(KERNEL, 'packages') },")),
    options: (ctx) => ["--scripts-dir", ctx.scripts, "--compose", join(ctx.scripts, COMPOSE_NAME)],
  },
  {
    id: "M4", note: "a consumer stops sharing and scans packages/ itself", declared: [2, 5, 6], files: [COMPOSE_NAME, IMPORT_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, IMPORT_NAME), (raw) => swap(raw, "import { kernelRoster } from './compose-profile-rows.mjs'", PRIVATE_ROSTER)),
    options: (ctx) => ["--import-checker", join(ctx.scripts, IMPORT_NAME)],
  },
  {
    id: "M5", note: "the shared roster keeps the vendor root but points it away from the tree", declared: [3, 5], files: [COMPOSE_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, COMPOSE_NAME), (raw) => swap(raw, "at: join(KERNEL, 'vendor')", "at: join(KERNEL, 'vendor', '.r51-not-scanned')")),
    options: (ctx) => ["--scripts-dir", ctx.scripts, "--compose", join(ctx.scripts, COMPOSE_NAME)],
  },
  {
    id: "M6", note: "the record claims the diff is empty while a real section moved", declared: [4], files: [],
    mutate: (ctx) => writeFileSync(join(ctx.root, "claim-empty.txt"), "No tracked artefact changed: the diff is empty, because every profile bundle name lives under packages/ and adding a source root cannot move anything." + String.fromCharCode(10)),
    options: (ctx) => ["--evidence", join(ctx.root, "claim-empty.txt")],
  },
  {
    id: "M7", note: "the tracked contract reading loses its apps declaration", declared: [4, 6], files: [],
    mutate: (ctx) => {
      const contract = readJson(CONTRACT_OUT)
      writeFileSync(join(ctx.root, "plugin-contract.json"), JSON.stringify({ ...contract, roster: { ...(contract ?? {}).roster, kernelApps: [], kernelRosterSize: 328 } }, null, 1) + String.fromCharCode(10))
    },
    options: (ctx) => ["--contract-out", join(ctx.root, "plugin-contract.json")],
  },
  {
    id: "M8", note: "the committed resolution report moves with no record naming the move", declared: [4, 6], files: [],
    // Two things at once, so the mutant cannot go quiet on a later round: a wrong count (reading 6 sees it) and a
    // top-level key no handoff record can contain (reading 4 must refuse to call the move documented - the needles
    // are key names, so the marker key is one no record will ever name).
    mutate: (ctx) => {
      const report = readJson(IMPORT_OUT)
      writeFileSync(join(ctx.root, "import-resolution.json"), JSON.stringify({ ...report, kernelPackages: 331, "r52-m8-undocumented": "no record names this key" }, null, 1) + String.fromCharCode(10))
    },
    options: (ctx) => ["--import-out", join(ctx.root, "import-resolution.json")],
  },
  {
    id: "M9", note: "a name no source provides is crowned by a fallback", declared: [5, 6], files: [COMPOSE_NAME, IMPORT_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, IMPORT_NAME), (raw) => swap(raw, "? 'dependency-not-installed' : 'undeclared-not-found'", "? 'dependency-not-installed' : 'resolves'")),
    options: (ctx) => ["--import-checker", join(ctx.scripts, IMPORT_NAME)],
  },
  {
    id: "M10", note: "a consumer swaps the shared import for its own full three-root scan", declared: [1, 2], files: [COMPOSE_NAME, BUNDLE_NAME],
    mutate: (ctx) => editFile(join(ctx.scripts, BUNDLE_NAME), (raw) => swap(raw, "import { kernelRoster } from './compose-profile-rows.mjs'", PRIVATE_FULL_SCAN)),
    options: (ctx) => ["--scripts-dir", ctx.scripts, "--bundle-checker", join(ctx.scripts, BUNDLE_NAME)],
  },
  {
    id: "M11", note: "a neighbouring gate regresses (this is reading 7's own instrument)", declared: [7], files: [],
    options: () => [],
  },
  {
    id: "M12", note: "a real third-party target disappears from the target list", declared: [6], files: [],
    mutate: (ctx) => {
      const file = readJson(USAGE_TARGETS)
      const targets = Array.isArray((file ?? {}).targets) ? file.targets.slice(1) : []
      writeFileSync(join(ctx.root, "usage-targets.json"), JSON.stringify({ ...file, targets }, null, 1) + String.fromCharCode(10))
    },
    options: (ctx) => ["--usage-targets", join(ctx.root, "usage-targets.json")],
  },
]

/** Every temporary directory this gate made, so the run can leave .tmp as it found it. */
const MADE = []
function mkTemp(prefix) {
  mkdirSync(join(PROJECT, ".tmp"), { recursive: true })
  const dir = mkdtempSync(join(PROJECT, ".tmp", prefix))
  MADE.push(dir)
  return dir
}

/** Run the whole reading set against one path configuration, quietly when it is a mutant. */
async function runReadings(args, quiet) {
  resolveOptions(args)
  results.length = 0
  const previous = SILENT
  SILENT = quiet === true
  try {
    checkOne()
    checkTwo()
    await checkThree()
    checkFour()
    await checkFive()
    checkSix()
    checkSeven()
  } finally {
    SILENT = previous
  }
  return {
    failed: results.filter((row) => row.ok !== true && row.skip !== true).map((row) => row.n),
    held: results.filter((row) => row.ok === true).length,
    skipped: results.filter((row) => row.skip === true).length,
    total: results.length,
    details: results.slice(),
  }
}

/** The self-attack: declared set, observed set, coverage matrix, anchors from the product. */
async function runAttack() {
  console.log("")
  console.log("=== self-attack: every mutant must redden exactly the readings it declares ===")
  console.log("  (under --self-attack the three neighbouring gates are stubs, so M11 is the mutant that makes one")
  console.log("   fail; the real gates are run in the normal pass, because a roster mutant must not launch three")
  console.log("   other gates a dozen times. .tmp is removed again unless DSH_KEEP_MUTANTS=1.)")
  const table = []
  const coverage = new Map()
  let ok = true
  for (const mutant of MUTATIONS) {
    // Re-resolve the real paths first: the previous mutant's run left SCRIPTS pointing at its own directory.
    resolveOptions(argv)
    const ctx = { id: mutant.id, root: mkTemp("r51-" + mutant.id + "-") }
    ctx.scripts = join(ctx.root, "scripts")
    mkdirSync(ctx.scripts, { recursive: true })
    try {
      for (const name of mutant.files ?? []) {
        const real = join(SCRIPTS, name)
        if (!existsSync(real)) throw new Error(name + " is not there to copy: " + real)
        const { text } = relocate(readFileSync(real, "utf8"), real, COMPOSE_NAME)
        // The copy is pinned to this repository: a mutant must differ from the product in its mutation only.
        writeFileSync(join(ctx.scripts, name), pinRepo(text, PROJECT))
      }
      if (mutant.mutate !== undefined) mutant.mutate(ctx)
      const stubArgs = [
        "--roster-gate", stubGate(ctx.root, "roster", 7, "readings", mutant.id === "M11"),
        "--contract-gate", stubGate(ctx.root, "contract", 7, "readings", false),
        "--rows-gate", stubGate(ctx.root, "rows", 11, "checks", false),
      ]
      const observed = await runReadings((mutant.options !== undefined ? mutant.options(ctx) : []).concat(stubArgs), true)
      const declared = [...mutant.declared].sort((a, b) => a - b)
      const got = [...observed.failed].sort((a, b) => a - b)
      const localised = show(declared) === show(got)
      if (!localised) ok = false
      table.push({ id: mutant.id, note: mutant.note, declared, got, localised })
      for (const reading of declared) coverage.set(reading, [...(coverage.get(reading) ?? []), mutant.id])
    } catch (error) {
      ok = false
      table.push({ id: mutant.id, note: mutant.note, declared: mutant.declared, got: ["gate failure"], localised: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const row of table) {
    console.log("  " + row.id + " " + row.note + " -> declared " + show(row.declared) + ", observed " + show(row.got) + "  " + (row.localised ? "LOCALISED" : "MISMATCH") + (row.error !== undefined ? " [" + row.error + "]" : ""))
  }
  console.log("")
  console.log("coverage matrix (reading -> mutants that declare it):")
  const readings = [1, 2, 3, 4, 5, 6, 7]
  for (const reading of readings) console.log("  " + String(reading) + ": " + ((coverage.get(reading) ?? []).join(", ") || "(none)"))
  const uncovered = readings.filter((reading) => (coverage.get(reading) ?? []).length === 0)
  const mismatched = table.filter((row) => !row.localised).map((row) => row.id)
  console.log("")
  console.log("mutants applied " + String(table.length) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(table.length - mismatched.length) + " of " + String(table.length) + "; uncovered readings " + show(uncovered))
  return ok && uncovered.length === 0 && mismatched.length === 0
}

async function main() {
  console.log("R51 gate: scripts/verify-roster-single-source.mjs - is the kernel roster a single source of truth?")
  console.log("  product under test: " + COMPOSE.replace(PROJECT, ".") + " (the one scan), the three other consumers,")
  console.log("  the four tracked products and the R50 gate family; contract .tmp/r51-contract.md section 3")
  const required = [
    { path: COMPOSE, what: "the shared roster" },
    { path: IMPORT_CHECKER, what: "the resolution consumer" },
    { path: BUNDLE_CHECKER, what: "the bundle consumer" },
    { path: CONTRACT_CHECKER, what: "the contract consumer" },
    { path: KERNEL, what: "the kernel tree" },
  ]
  const absent = required.filter((entry) => !existsSync(entry.path))
  if (absent.length > 0) {
    for (const entry of absent) console.log("  input missing: " + entry.what + " at " + entry.path)
    process.exit(3)
  }
  const started = Date.now()
  await runReadings(argv, false)
  const failed = results.filter((row) => row.ok !== true && row.skip !== true).length
  const held = results.filter((row) => row.ok === true).length
  const skipped = results.filter((row) => row.skip === true).length
  console.log("")
  console.log("boundary: one scan over packages/<group>/<pkg>, apps/<pkg> and vendor/<pkg>; the record carries")
  console.log("          workspace/app/vendor, the four consumers read it, and a name no source provides is refused.")
  console.log(String(results.length) + " readings, " + String(held) + " held, " + String(skipped) + " skipped, " + String(failed) + " failed")
  let attackOk = true
  if (SELF_ATTACK) attackOk = await runAttack()
  console.log("")
  console.log("wall " + String(Date.now() - started) + " ms")
  if (process.env.DSH_KEEP_MUTANTS === "1") console.log("kept " + String(MADE.length) + " temporary director(ies) under .tmp (DSH_KEEP_MUTANTS=1)")
  else for (const dir of MADE) rmSync(dir, { recursive: true, force: true })
  process.exit(failed === 0 && attackOk ? 0 : 1)
}

await main()
