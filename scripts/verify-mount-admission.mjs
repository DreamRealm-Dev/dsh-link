#!/usr/bin/env node
/**
 * R21: the three new artifacts must be pinned by something that can fail.
 *
 *   A compat/adaptation/rows/mount-admission.json  (scripts/probe-mount-admission.mjs)
 *   B compat/adaptation/port-verdicts.json         (scripts/port-verdicts.mjs)
 *   C compat/adaptation/rows/fixtures/{11,12}-*.patch.yml + index.json + README.md (the loader wording)
 *
 * Nine checks:
 *   1 every mount case carries a raw excerpt, 实测 only where raw output exists, and every case proves
 *     its overlay was read (calibrationMounted)
 *   2 POSITIVE CONTROL: a row with disabled: true does not mount while the calibration row does —
 *     without it "did not mount" and "the boot never got there" read the same
 *   3 regression, pinned: the 0.1.x spelling disable: true still mounts
 *   4 regression, pinned: enabled / options never reach the plugin (the row mounts, config is null)
 *   5 regression, pinned: with two rows on one id only the LATER one mounts
 *   6 the probe can fail: its calibration guard exists in the source and, where the kernel and tsx are
 *     available, a copy whose calibration no longer matches must exit non-zero
 *   7 the port list recomputes (--check green), @argszero carries peer-range-excludes-kernel,
 *     dsh-repeat-guard carries no such item, and no verdict word appears anywhere in the file
 *   8 fixtures 11 and 12 are indexed and the loader wording for each is quoted verbatim
 *   9 fixture 10 is LAYER-FATAL (exit != 0, composedRows 0) and must be classified as such: its
 *     "removed" list is a byproduct of the failed dump, not rows the loader removed. Negative control:
 *     fixture 06 (!!js) exits 0 with the composition intact.
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (what is missing is printed).
 * --self-attack copies the artifacts into a temp tree, mutates one copy per check and requires exactly
 * the matching check to go red.
 */
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const KERNEL = join(PROJECT, "core", "deepseek-harness")
const ROWS = join(PROJECT, "compat", "adaptation", "rows")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes("--self-attack")
const REAL = {
  label: "real (this machine)",
  baseDir: PROJECT,
  rowsRoot: resolve(option("--rows-root", ROWS)),
  mount: resolve(option("--mount", join(ROWS, "mount-admission.json"))),
  port: resolve(option("--port", join(PROJECT, "compat", "adaptation", "port-verdicts.json"))),
  portScript: resolve(option("--port-script", join(PROJECT, "scripts", "port-verdicts.mjs"))),
  probe: resolve(option("--probe", join(PROJECT, "scripts", "probe-mount-admission.mjs"))),
  behaviour: resolve(option("--behaviour", join(ROWS, "loader-behaviour.json"))),
  fixtures: resolve(option("--fixtures", join(ROWS, "fixtures"))),
  kernelCli: join(KERNEL, "apps", "cli", "src", "bin.ts"),
  kernelRoot: KERNEL,
}

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  const tag = status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")
  console.log("  " + tag + "  " + n + ". " + detail)
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text)
const show = (value) => JSON.stringify(value)
const digest = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "missing")
const casesOf = (doc) => (Array.isArray(doc.cases) ? doc.cases : [])
/** Every case-like record in a document: the arrays named cases/fixtures/tests plus rows/entries. */
const allCases = (doc) => {
  const out = []
  for (const key of ["cases", "fixtures", "tests", "rows", "entries"]) {
    if (!Array.isArray(doc[key])) continue
    for (const entry of doc[key]) if (entry !== null && typeof entry === "object") out.push(entry)
  }
  return out
}
/** The tags a case inserts, read from the modules it names: ./r21-dupe-b.mjs -> dupe-b. */
const candidateTags = (entry) => [...new Set([...String(entry.constructed ?? "").matchAll(/\.\/([\w.-]+)\.(?:mjs|cjs|js)/g)].map((m) => m[1].replace(/^r21-/, "")))]
const mountedOf = (entry) => (Array.isArray(entry.observed?.mountedTags) ? entry.observed.mountedTags : null)
/** The probe reports module tags, the case names modules; either containing the other is a match. */
const mountedIs = (mounted, tag) => mounted.some((item) => String(item).includes(tag) || tag.includes(String(item)))
const configFor = (entry, tag) => (entry.observed?.configByTag ?? {})[tag]
const findCase = (doc, predicate) => casesOf(doc).find(predicate) ?? null

// ---------------------------------------------------------------- 1 mount table discipline
function checkOne(world) {
  const doc = readJson(world.mount)
  const cases = casesOf(doc)
  if (cases.length === 0) { record(1, false, "the mount table carries no cases"); return }
  const problems = []
  for (const entry of cases) {
    const raw = [entry.rawExcerpt, entry.raw, entry.observed?.raw].find((text) => typeof text === "string" && text.trim() !== "")
    const labels = Array.isArray(entry.labels) ? entry.labels : []
    const claims = entry.measured === true || labels.some((label) => /实测|measured|observed/i.test(String(label)))
    if (raw === undefined) { problems.push(entry.id + ": no raw excerpt"); continue }
    if (claims && labels.length === 0) problems.push(entry.id + ": claims a measurement with no label")
    if (entry.calibrationMounted !== true) problems.push(entry.id + ": the calibration row is not proven mounted, so a missing row and a boot that never got there read the same")
    if (mountedOf(entry) === null) problems.push(entry.id + ": no mountedTags reading")
  }
  const calibrationRule = String(JSON.stringify(doc.method ?? {}))
  if (!/calibration/i.test(calibrationRule)) problems.push("the table states no calibration rule in method")
  record(1, problems.length === 0, problems.length === 0 ? cases.length + " mount case(s): every one carries raw output, a label, a mounted reading and a proven calibration row" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 2 positive control
function checkTwo(world) {
  const doc = readJson(world.mount)
  // the two spellings must not be confused: `disabled` is the 0.2.x key, `disable` the 0.1.x one that still mounts
  const entry = findCase(doc, (item) => /disabled["']?\s*:\s*true/.test(String(item.constructed ?? "")))
  if (entry === null) { record(2, false, "no case constructs a row with disabled: true, so a non-mount cannot be told from a boot that never reached the row"); return }
  const mounted = mountedOf(entry) ?? []
  const candidates = candidateTags(entry)
  const problems = []
  if (candidates.length === 0) problems.push("the case names no module to look for")
  for (const tag of candidates) if (mountedIs(mounted, tag)) problems.push("the disabled row " + tag + " mounted (" + show(mounted) + ")")
  if (!mountedIs(mounted, "calibration")) problems.push("the calibration row did not mount, so this case proves nothing (" + show(mounted) + ")")
  record(2, problems.length === 0, problems.length === 0 ? "positive control holds: disabled: true row(s) " + show(candidates) + " did not mount while calibration did (" + show(mounted) + ")" : problems.join(" | "))
}

// ---------------------------------------------------------------- 3/4/5 pinned regressions
function checkThree(world) {
  const entry = findCase(readJson(world.mount), (item) => /disable["']?\s*:\s*true/.test(String(item.constructed ?? "")) && !/disabled["']?\s*:\s*true/.test(String(item.constructed ?? "")))
  if (entry === null) { record(3, false, "no case constructs the 0.1.x spelling disable: true"); return }
  const mounted = mountedOf(entry) ?? []
  const candidates = candidateTags(entry)
  const alive = candidates.filter((tag) => mountedIs(mounted, tag))
  const ok = candidates.length > 0 && alive.length > 0 && mountedIs(mounted, "calibration")
  record(3, ok, ok ? "pinned: disable: true (0.1.x spelling) still mounts " + show(alive) + " (" + show(mounted) + ")" : "disable: true did not mount " + show(candidates) + " (" + show(mounted) + ") — the pinned reading flipped")
}
function checkFour(world) {
  const entry = findCase(readJson(world.mount), (item) => /enabled|options/.test(String(item.constructed ?? "")))
  if (entry === null) { record(4, false, "no case constructs enabled / options metadata"); return }
  const mounted = mountedOf(entry) ?? []
  const candidates = candidateTags(entry)
  const alive = candidates.filter((tag) => mountedIs(mounted, tag))
  const problems = []
  if (alive.length === 0) problems.push("the row with enabled/options did not mount at all (" + show(mounted) + "), which is a different finding from dead metadata")
  for (const tag of alive) {
    const config = configFor(entry, tag) ?? (mountedOf(entry) ?? []).map((item) => (entry.observed?.configByTag ?? {})[item]).find((value) => value !== undefined)
    if (config !== null && config !== undefined) problems.push("the plugin received " + show(config) + " for " + tag + " instead of null, so enabled/options did reach config")
  }
  record(4, problems.length === 0, problems.length === 0 ? "pinned: enabled/options are dead metadata — " + show(alive) + " mounted with config null" : problems.join(" | "))
}
function checkFive(world) {
  const entry = findCase(readJson(world.mount), (item) => /same-id|two rows|dupe/i.test(String(item.id ?? "") + " " + String(item.question ?? "")))
  if (entry === null) { record(5, false, "no case constructs two rows on one id"); return }
  const mounted = mountedOf(entry) ?? []
  const candidates = candidateTags(entry)
  const alive = candidates.filter((tag) => mountedIs(mounted, tag))
  const problems = []
  if (candidates.length < 2) problems.push("the case names fewer than two modules (" + show(candidates) + ")")
  if (alive.length !== 1) problems.push("the composed tree mounted " + show(alive) + " of " + show(candidates) + " — expected exactly one, the later row")
  else if (candidates.length >= 2 && alive[0] !== candidates[candidates.length - 1]) problems.push("the row that mounted (" + alive[0] + ") is not the later one (" + candidates[candidates.length - 1] + ")")
  record(5, problems.length === 0, problems.length === 0 ? "pinned: two rows on one id -> only the later row " + alive[0] + " mounted (candidates " + show(candidates) + ", mounted " + show(mounted) + ")" : problems.join(" | "))
}

// ---------------------------------------------------------------- 6 the probe can fail
function checkSix(world) {
  const source = existsSync(world.probe) ? readText(world.probe) : null
  if (source === null) { record(6, false, "no probe at " + world.probe); return }
  const problems = []
  if (!/calibration/i.test(source)) problems.push("the probe source never mentions its calibration row")
  if (!/exit\([^)]*\)/.test(source)) problems.push("the probe source has no failing exit path")
  const live = existsSync(world.kernelCli) && existsSync(join(world.kernelRoot, "node_modules", "tsx"))
  if (!live) {
    if (problems.length > 0) record(6, false, problems.join(" | "))
    else record(6, "skip", "the calibration guard is in the source (" + clip(source.split("\n").filter((line) => /calibrationMounted|exit\(/.test(line)).join(" / "), 160) + ") but the live exercise needs the kernel CLI and tsx")
    return
  }
  const tmp = mkdtempSync(join(tmpdir(), "r21-probe-"))
  try {
    // The probe is exercised from a throwaway copy of the repository, so its own artifact is never
    // rewritten: scripts, compat and plugins are copied and a single case is run.
    // The probe takes its kernel from cwd and its artifact path from --out, whose default is this
    // machine's real artifact: every run below passes --out explicitly, and the real file is digested
    // before and after so that a future change of this harness cannot silently clobber it.
    const artifact = join(world.rowsRoot, "mount-admission.json")
    const beforeDigest = digest(artifact)
    const probe = join(tmp, "probe-copy.mjs")
    writeFileSync(probe, readText(world.probe))
    const original = readText(probe)
    // The trigger is constructed on a copy: the probe is told, through its own guard variable, that the
    // calibration row did not mount. Renaming the calibration id would prove nothing, because the probe
    // inserts that same id into the overlay, so both sides move together and the case stays honest.
    const guard = /const calibrationMounted = [^\n]*/.exec(original)
    const run = (out, cases) => spawnSync(process.execPath, ["--import", "tsx/esm", probe, "--out", out, "--cases", cases], { cwd: world.kernelRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 })
    const clean = run(join(tmp, "clean.json"), "control-plain-row")
    if (clean.status !== 0) { record(6, "skip", "the probe could not be exercised faithfully from a throwaway repository (exit " + String(clean.status) + "): " + clip(((clean.stdout ?? "") + (clean.stderr ?? "")).trim(), 220)); return }
    if (guard === null) problems.push("the probe source does not express its calibration guard in a form the gate can redirect")
    else {
      writeFileSync(probe, original.replace(guard[0], "const calibrationMounted = false"))
      const broken = run(join(tmp, "broken.json"), "control-plain-row")
      if (broken.status === 0) problems.push("a probe whose own guard says the calibration row never mounted still exited 0 (" + JSON.stringify(guard[0].trim()) + " -> false), so an overlay that was never read would be reported as a measured result")
      else console.log("      (the probe exited " + String(broken.status) + " once its guard was told the calibration never mounted; the untouched copy exited 0)")
    }
    if (digest(artifact) !== beforeDigest) problems.push("the probe exercise rewrote the real mount table: it must be given --out outside the artifact")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  record(6, problems.length === 0, problems.length === 0 ? "the probe refuses to report success when its overlay was never proven read (exercised from a throwaway repository)" : problems.join(" | "))
}

// ---------------------------------------------------------------- 7 the port list
const VERDICT_WORDS = /compatible|usable|drop-in|drop in|兼容|可用/i
function checkSeven(world) {
  const problems = []
  if (!existsSync(world.portScript)) problems.push("no port script at " + world.portScript)
  else {
    const run = spawnSync(process.execPath, [world.portScript, "--check"], { cwd: world.baseDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 })
    const output = ((run.stdout ?? "") + (run.stderr ?? "")).trim()
    if (run.status !== 0) problems.push("port-verdicts --check failed (exit " + String(run.status) + "): " + clip(output, 160))
  }
  if (!existsSync(world.port)) { problems.push("no port list at " + world.port); record(7, false, problems.join(" | ")); return }
  const text = readText(world.port)
  const doc = JSON.parse(text)
  const entries = Array.isArray(doc.verdicts) ? doc.verdicts : []
  const byName = (needle) => entries.find((entry) => String(entry.name ?? "").includes(needle)) ?? null
  const argszero = byName("thinking-loop-guard")
  if (argszero === null) problems.push("no entry for the @argszero thinking-loop-guard plugin")
  else {
    const peer = (argszero.items ?? []).filter((item) => item.category === "peer-range-excludes-kernel")
    if (peer.length === 0) problems.push("the @argszero entry carries no peer-range-excludes-kernel item")
    else {
      // The item is grouped: one row per plugin, with the excluded ranges machine-readable under
      // peers[]. The detail must still name the kernel and at least one range (Lead, R26: grouping
      // replaced the inline ranges, and this check caught it).
      const text = peer.map((item) => String(item.detail ?? "")).join(" ")
      const peers = peer.flatMap((item) => Array.isArray(item.peers) ? item.peers : [])
      if (!/kernel is \d/.test(text) || !/<0\.2\.0/.test(text)) problems.push("the peer item does not state the excluded kernel range")
      else if (peers.length === 0 || peers.some((entry) => typeof entry.range !== "string" || entry.range === "")) problems.push("the peer item does not carry the excluded peers as {name, range}")
    }
  }
  const guard = byName("dsh-repeat-guard")
  if (guard === null) problems.push("no entry for dsh-repeat-guard")
  else {
    const peer = (guard.items ?? []).filter((item) => item.category === "peer-range-excludes-kernel")
    if (peer.length > 0) problems.push("dsh-repeat-guard is reported as excluding the kernel, which its range does not do (" + show(peer.slice(0, 1)) + ")")
  }
  const word = VERDICT_WORDS.exec(text)
  if (word !== null) problems.push("the list carries a verdict word " + show(word[0]) + " — items must stay concrete")
  record(7, problems.length === 0, problems.length === 0 ? entries.length + " plugin entries: --check green, @argszero carries peer-range-excludes-kernel, dsh-repeat-guard carries none, no verdict word in the file" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 8 the two new fixtures
function checkEight(world) {
  const indexPath = join(world.fixtures, "index.json")
  if (!existsSync(indexPath)) { record(8, false, "no fixture index at " + indexPath); return }
  const index = readJson(indexPath)
  const listed = Array.isArray(index.fixtures) ? index.fixtures : []
  const readme = existsSync(join(world.fixtures, "README.md")) ? readText(join(world.fixtures, "README.md")) : ""
  const problems = []
  const notes = []
  for (const name of ["11-insert-into-non-group.patch.yml", "12-name-mismatch.patch.yml"]) {
    const entry = listed.find((item) => item.file === name)
    const file = join(world.fixtures, name)
    if (entry === undefined) { problems.push(name + " is not in index.json"); continue }
    if (!existsSync(file) || statSync(file).size === 0) { problems.push(name + " is missing or empty on disk"); continue }
    const text = readText(file)
    const quoted = [String(entry.rawWarning ?? ""), String(entry.observed ?? ""), readme].join(" ").trim()
    const hasWarning = /patch:|warning|YAMLException|skipping|is not a group|name mismatch/i.test(quoted)
    if (quoted === "") problems.push(name + ": the index and README quote no loader wording")
    else if (!hasWarning) problems.push(name + ": the quoted wording carries no loader diagnostic (" + clip(quoted, 80) + ")")
    notes.push(name + " (" + String(text.split("\n").length) + " lines, wording quoted " + (String(entry.rawWarning ?? "").trim() === "" ? "in README/index prose" : "in the index") + ")")
  }
  record(8, problems.length === 0, problems.length === 0 ? "both new fixtures are indexed with loader wording: " + notes.join("; ") : problems.join(" | "))
}

// ---------------------------------------------------------------- 9 layer-fatal, and its control
function checkNine(world) {
  if (!existsSync(world.behaviour)) { record(9, false, "no behaviour table at " + world.behaviour); return }
  const doc = readJson(world.behaviour)
  const records = allCases(doc)
  const fatal = records.find((item) => /10-disabled-bang-js/.test(String(item.file ?? ""))) ?? null
  const control = records.find((item) => /06-disabled-js/.test(String(item.file ?? ""))) ?? null
  const problems = []
  if (fatal === null) problems.push("the behaviour table has no case for fixture 10")
  else {
    if (fatal.exitStatus === 0) problems.push("fixture 10 exited 0, so the layer-fatal reading does not hold")
    if (fatal.composedRows !== 0) problems.push("fixture 10 composed " + show(fatal.composedRows) + " rows, not 0")
    const said = [String(fatal.verdict ?? ""), String(fatal.reading ?? ""), String((fatal.labels ?? []).join(" "))].join(" ")
    const classified = fatal.layerFatal === true || /fatal|dump (failed|never)|parse[d]? (error|failed)|YAMLException|never composed|no composed tree|composition (never|did not)/i.test(said)
    if (!classified) problems.push("fixture 10 is layer-fatal (exit " + String(fatal.exitStatus) + ", composedRows 0) but the entry carries no such classification — it still reads as " + show(clip(said, 90)) + ", and its observed.removed list (the dump never produced a tree) would be read as rows the loader removed. Missing: an explicit layer-fatal marker or verdict wording")
    else if (!/fatal|dump (failed|never)|parse[d]? (error|failed)|never composed|no composed tree|composition (never|did not)/i.test(said) && Array.isArray(fatal.observed?.removed) && fatal.observed.removed.length > 0) problems.push("fixture 10 lists " + String(fatal.observed.removed.length) + " removed id(s) while classifying the case only through raw wording; the removed list must not be presented as a composition change")
  }
  if (control === null) problems.push("the behaviour table has no case for fixture 06")
  else {
    if (control.exitStatus !== 0) problems.push("the !!js control exited " + show(control.exitStatus) + ", so it is not a clean control")
    const baseline = Number(control.baselineRows)
    if (Number.isFinite(baseline) && control.composedRows !== baseline + 1) problems.push("the !!js control composed " + show(control.composedRows) + " rows, expected baseline " + String(baseline) + " + 1")
    const warnings = Array.isArray(control.observed?.warnings) ? control.observed.warnings : null
    const said = [String(control.verdict ?? ""), String(control.reading ?? "")].join(" ")
    if (warnings !== null && warnings.length > 0) problems.push("the !!js control warned: " + show(warnings.slice(0, 2)))
    else if (warnings === null && !/no diagnostics|0 warning|without a warning|no warn/i.test(said)) problems.push("the !!js control states no clean wording and carries no warnings array")
  }
  record(9, problems.length === 0,
    problems.length === 0 ? "fixture 10 is classified layer-fatal (exit " + show(fatal.exitStatus) + ", composedRows 0, " + String((fatal.observed?.removed ?? []).length) + " ids listed only as a byproduct) and the !!js control is clean (exit 0, +1 row, 0 warnings)"
      : problems.slice(0, 3).join(" | "))
}

async function runAll(world) {
  results.length = 0
  console.log("== " + world.label + " ==")
  checkOne(world)
  checkTwo(world)
  checkThree(world)
  checkFour(world)
  checkFive(world)
  checkSix(world)
  checkSeven(world)
  checkEight(world)
  checkNine(world)
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

async function main() {
  const missing = []
  if (!existsSync(REAL.mount)) missing.push("mount table " + REAL.mount)
  if (!existsSync(REAL.port)) missing.push("port list " + REAL.port)
  if (!existsSync(REAL.behaviour)) missing.push("behaviour table " + REAL.behaviour)
  if (!existsSync(join(REAL.fixtures, "index.json"))) missing.push("fixture index " + join(REAL.fixtures, "index.json"))
  if (missing.length > 0) {
    console.log("SKIP  the R21 artifacts are not on this machine yet; missing:")
    for (const item of missing) console.log("  - " + item)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  const { failed, skipped } = await runAll(REAL)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

if (SELF_ATTACK) {
  const mod = await import(pathToFileURL(join(PROJECT, "scripts", "lib", "mount-admission-synthetic.mjs")).href)
  await mod.selfAttack({ runAll, tmpdir, join, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync: (from, to) => cpSync(from, to) })
} else {
  await main()
}
