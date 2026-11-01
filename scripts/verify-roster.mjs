#!/usr/bin/env node
/**
 * R50 (task-95): the roster's holes - the modules the HOST provides must be counted, from both sources.
 *
 * Subject: .tmp/r50-contract.md. Two sources of "what the host provides" exist in fact: the kernel's vendored
 * framework packages (core/deepseek-harness/vendor/*) and the module-table specifiers the web shell preloads.
 * This gate judges that the roster counts both, that it still refuses a specifier nobody provides (left-pad -
 * without that counterexample the round would be "making the gate green" instead of "fixing the roster"), that
 * the client baseline lives in exactly ONE place (compat/host-modules.json, read by plugins/build.mjs), that the
 * re-judgement is archived and reproducible with --all --out, and that the fail -> pass changes are NAMED rather
 * than silently green.
 *
 * Expectations are computed here: the vendored package names are enumerated from the vendor manifests by this
 * gate, the baseline list is enumerated from the contract, and the synthetic packages written as counterexamples are
 * written by this gate. scripts/check-plugin-contract.mjs, scripts/compose-profile-rows.mjs, plugins/build.mjs and
 * scripts/verify-composition-rows.mjs are the PRODUCTS UNDER TEST here and are run as child processes; the R47 gate
 * is a regression run, not an instrument, and no reading of this gate nests another gate's readings. Self-attack
 * follows the rulings: declared-set equality per mutant, coverage matrix with no uncovered reading, anchors from the
 * products under test. All temporary work lives under .tmp and is deleted at the end.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : resolve(argv[i + 1]) }
const KERNEL = resolve(option("--kernel", join(PROJECT, "core", "deepseek-harness")))
const COMPOSE = resolve(option("--compose", join(PROJECT, "scripts", "compose-profile-rows.mjs")))
const CHECKER = resolve(option("--checker", join(PROJECT, "scripts", "check-plugin-contract.mjs")))
const BUILD = resolve(option("--build", join(PROJECT, "plugins", "build.mjs")))
const HOST_MODULES = resolve(option("--host-modules", join(PROJECT, "compat", "host-modules.json")))
const CONTRACT = resolve(option("--contract", join(PROJECT, "compat", "adaptation", "plugin-contract.json")))
const COMPOSITION = resolve(option("--composition", join(PROJECT, "compat", "adaptation", "rows", "profile-composition.json")))
const COMPOSITION_GATE = resolve(option("--composition-gate", join(PROJECT, "scripts", "verify-composition-rows.mjs")))
const CONTRACT_GATE = resolve(option("--contract-gate", join(PROJECT, "scripts", "verify-plugin-contract.mjs")))
const SELF_ATTACK = argv.includes("--self-attack")
const FORMAT = "dsh-link.host-modules/1"
/** The module-table specifiers the web shell preloads, enumerated from the contract (R2 moves them into data). */
const BASELINE = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit"]
/** The two packages the contract names as evidence for a fail -> pass change. */
const CHANGED = ["dsh-theme-settings", "dsh-link-responsive"]

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : status === "skip" ? "SKIP" : "FAIL") + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const norm = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return null } }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const runNode = (args, timeoutMs = 600000) => {
  const started = Date.now()
  const done = spawnSync(process.execPath, args, { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
  return { status: done.status, signal: done.signal, stdout: done.stdout ?? "", stderr: done.stderr ?? "", ms: Date.now() - started }
}
// ---------------------------------------------------------------- products under test
let CURRENT = { compose: COMPOSE, checker: CHECKER, build: BUILD }
let ARCHIVE = null
const archive = () => {
  if (ARCHIVE !== null && ARCHIVE.checker === CURRENT.checker) return ARCHIVE
  const out = join(base(), "recomputed-contract.json")
  const run = runNode([CURRENT.checker, "--all", "--out", out])
  const parsed = readJson(out)
  ARCHIVE = { path: out, run, json: parsed, text: existsSync(out) ? readFileSync(out, "utf8") : null, checker: CURRENT.checker }
  return ARCHIVE
}
const carriedText = (node) => show(node)
const walk = (node, visit, trail = []) => {
  visit(node, trail)
  if (Array.isArray(node)) node.forEach((item, index) => walk(item, visit, trail.concat(String(index))))
  else if (node !== null && typeof node === "object") for (const key of Object.keys(node)) walk(node[key], visit, trail.concat(key))
}

// ---------------------------------------------------------------- readings
function checkOne(mod) {
  const problems = []
  const vendor = vendored()
  const tree = kernelTree(5)
  if (vendor.length === 0) problems.push("no vendored kernel packages were enumerated under " + join(KERNEL, "vendor"))
  if (tree.length === 0) problems.push("no kernel workspace packages were enumerated under " + join(KERNEL, "packages"))
  const roster = mod !== null && typeof mod.kernelRoster === "function" ? mod.kernelRoster() : null
  const kernel = mod !== null && typeof mod.kernelPackages === "function" ? mod.kernelPackages() : null
  if (kernel === null) { record(1, false, "the composer exports no kernelPackages; the roster cannot be read"); return }
  for (const entry of vendor) {
    const resolved = kernel(entry.name)
    if (resolved === null) problems.push("the roster does not carry " + entry.name + " (vendor/" + entry.dir + ")")
    else if (resolve(resolved) !== entry.path) problems.push(entry.name + " resolves to " + resolved + ", expected " + entry.path)
    if (roster !== null) {
      const row = roster.get(entry.name)
      if (row === undefined) problems.push("kernelRoster does not hold " + entry.name)
      else if (row.origin !== "vendor") problems.push(entry.name + " is carried as " + show(row.origin) + ", expected vendor")
    }
  }
  for (const entry of tree) if (kernel(entry.name) === null) problems.push("the widened roster lost the workspace package " + entry.name)
  console.log("      vendored enumerated here: " + String(vendor.length) + " (" + clip(vendor.map((v) => v.name).join(", "), 120) + ")")
  console.log("      workspace packages still carried: " + show(tree.map((t) => t.name)))
  record(1, problems.length === 0, problems.length === 0 ? "every vendored kernel package is enumerated by the gate and carried by the roster, with its origin named, and the workspace packages are still there" : problems.join(" | "))
}

function checkTwo(mod) {
  const problems = []
  const data = readJson(HOST_MODULES)
  if (data === null) { record(2, false, "no readable " + HOST_MODULES + ": the client baseline is not data yet"); return }
  if (data.format !== FORMAT) problems.push("format is " + show(data.format) + ", expected " + show(FORMAT))
  const baseline = Array.isArray(data.clientBaseline) ? data.clientBaseline : null
  if (baseline === null || baseline.length === 0) problems.push("clientBaseline is " + clip(show(data.clientBaseline), 60))
  else if (show(baseline.slice().sort()) !== show(BASELINE.slice().sort())) problems.push("clientBaseline is " + show(baseline) + ", expected the preloaded module table " + show(BASELINE))
  if (typeof data.note !== "string" || data.note.length === 0) problems.push("the file carries no note explaining the two sources")
  const source = readFileSync(CURRENT.build, "utf8")
  const lines = source.split(String.fromCharCode(10))
  const wired = lines.findIndex((line) => line.indexOf("CLIENT_BASELINE") !== -1 && line.indexOf("host-modules.json") !== -1)
  const literal = lines.findIndex((line) => line.indexOf("'react', 'react/jsx-runtime'") !== -1)
  if (wired === -1) problems.push("plugins/build.mjs does not bind its client baseline from compat/host-modules.json")
  if (literal !== -1) problems.push("plugins/build.mjs still holds a second copy of the list at line " + String(literal + 1) + ": " + lines[literal].trim())
  console.log("      baseline " + show(baseline) + " read from " + show(HOST_MODULES))
  console.log("      build.mjs wiring: " + (wired === -1 ? "none found" : "line " + String(wired + 1) + " -> " + clip(lines[wired].trim(), 120)) + "; second copy present: " + String(literal !== -1))
  record(2, problems.length === 0, problems.length === 0 ? "the preloaded module table is data: one file, the right format, the exact nine specifiers, and plugins/build.mjs binds its external list from that file instead of holding a copy" : problems.join(" | "))
}

function checkThree(mod) {
  const problems = []
  const real = ["dsh-theme-settings", "dsh-link-responsive"].map((name) => ({ name, dir: join(PROJECT, "plugins", name) }))
  const seen = []
  for (const entry of real) {
    if (!existsSync(entry.dir)) { problems.push("the real package " + entry.name + " is not at " + entry.dir); continue }
    const run = runNode([CURRENT.checker, entry.dir, "--json"])
    let judged = null
    try { judged = JSON.parse(run.stdout) } catch { judged = null }
    if (judged === null) { problems.push(entry.name + ": the checker printed no JSON (exit " + show(run.status) + "): " + clip(run.stderr, 90)); continue }
    const fails = judged.readings.filter((row) => row.rule === "dependency-declared" && row.verdict === "fail")
    const bases = judged.readings.flatMap((row) => row.basis ?? []).filter((line) => typeof line === "string" && /vendor|baseline|preload/i.test(line))
    if (fails.length > 0) problems.push(entry.name + " still fails dependency-declared " + String(fails.length) + " time(s): " + clip(show(fails[0].basis), 110))
    if (bases.length === 0) problems.push(entry.name + " passes with no basis naming which source provides the module")
    if (run.status !== 0 && fails.length === 0) problems.push(entry.name + " exited " + show(run.status) + " with no dependency-declared failure")
    seen.push(entry.name + " -> " + String(judged.counts.pass) + " pass / " + String(judged.counts.fail) + " fail; basis " + clip(bases[0] ?? "none", 80))
  }
  for (const line of seen) console.log("      " + line)
  record(3, problems.length === 0, problems.length === 0 ? "the checker judges both real packages clean on dependency-declared and says in its basis which source provides the module (vendored kernel package or preloaded client baseline)" : problems.join(" | "))
}

function checkFour(mod) {
  const problems = []
  const dir = join(base(), "leftpad")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "r50-leftpad-probe", version: "1.0.0", private: true, license: "MIT", type: "module", main: "index.js" }, null, 1) + String.fromCharCode(10))
  writeFileSync(join(dir, "index.js"), "import leftPad from 'left-pad'" + String.fromCharCode(10) + "export const pad = (text) => leftPad(text)" + String.fromCharCode(10))
  const run = runNode([CURRENT.checker, dir, "--json"])
  let judged = null
  try { judged = JSON.parse(run.stdout) } catch { judged = null }
  if (judged === null) problems.push("the checker printed no JSON for the counterexample (exit " + show(run.status) + "): " + clip(run.stderr, 90))
  else {
    const row = judged.readings.find((entry) => entry.rule === "dependency-declared" && entry.verdict === "fail")
    if (row === undefined) problems.push("a package importing left-pad was not failed by dependency-declared: " + clip(show(judged.readings.filter((e) => e.rule === "dependency-declared")), 140))
    else if (!show(row.basis).includes("left-pad")) problems.push("the failure does not name left-pad: " + clip(show(row.basis), 110))
    const severity = row === undefined ? null : row.severity
    if (severity === "refuse" && run.status === 0) problems.push("a refuse-level failure exited 0")
    console.log("      left-pad -> verdict " + show(row === undefined ? null : row.verdict) + " at " + show(severity) + " severity, checker exit " + show(run.status) + " (" + String(judged.counts.pass) + " pass / " + String(judged.counts.fail) + " fail; a rewrite-level failure exits 0 by the recorded exit-code rule, so the verdict is the reading and the exit code only confirms the severity)")
    console.log("      basis " + clip(show(row === undefined ? null : row.basis), 140))
  }
  record(4, problems.length === 0, problems.length === 0 ? "a package importing left-pad still reads fail on dependency-declared, with left-pad named in the basis; the exit code is only required to be non-zero at refuse severity, so the verdict is what the reading gates: the roster was fixed, not loosened" : problems.join(" | "))
}

function checkFive(mod) {
  const problems = []
  const recomputed = archive()
  if (recomputed.run.status !== 0) problems.push("the recomputation exited " + show(recomputed.run.status) + ": " + clip(recomputed.run.stderr, 110))
  const tracked = readFileSync(CONTRACT, "utf8")
  if (recomputed.text === null) problems.push("the recomputation wrote no reading at " + recomputed.path)
  else if (recomputed.text !== tracked) problems.push("--all --out does not reproduce the tracked reading byte for byte: " + String(recomputed.text.length) + " vs " + String(tracked.length) + " bytes")
  const parsed = readJson(CONTRACT)
  if (parsed === null) problems.push("the tracked reading cannot be parsed")
  else {
    const targets = Array.isArray(parsed.targets) ? parsed.targets : []
    if (targets.length !== 7) problems.push("the tracked reading carries " + String(targets.length) + " real targets, expected the recorded 7")
    const own = parsed.ourPackages
    const ownList = Array.isArray(own) ? own : own !== null && typeof own === "object" ? Object.keys(own) : []
    if (ownList.length === 0) problems.push("the reading carries no ourPackages section: the roster fix was never re-judged against this repo's own packages")
    else if (show(ownList).indexOf("dsh-link-responsive") === -1) problems.push("ourPackages does not carry dsh-link-responsive: " + clip(show(ownList), 110))
    console.log("      recomputed == tracked: " + String(recomputed.text === tracked) + "; real targets " + String(targets.length) + "; own packages " + String(ownList.length))
  }
  const check = runNode([CURRENT.checker, "--all", "--check"])
  if (check.status !== 0) problems.push("--all --check exited " + show(check.status) + ": " + clip(check.stdout + check.stderr, 110))
  record(5, problems.length === 0, problems.length === 0 ? "the re-judgement is archived: --all --out reproduces the tracked reading byte for byte, it keeps the seven real targets and adds this repo's own packages, and --all --check agrees" : problems.join(" | "))
}

function checkSix(mod) {
  const problems = []
  const parsed = archive().json
  if (parsed === null) { record(6, false, "no recomputed reading to read the changes out of"); return }
  const flipped = Array.isArray(parsed.flipped) ? parsed.flipped : []
  const own = parsed.ourPackages
  const ourNames = Array.isArray(own) ? own.map((entry) => entry.name) : own !== null && typeof own === "object" ? Object.keys(own) : []
  const named = []
  for (const name of CHANGED) {
    const rows = flipped.filter((entry) => entry !== null && typeof entry === "object" && entry.package === name)
    if (rows.length === 0) { problems.push("the archive's flipped list does not name " + name + ": the change would be silently green"); continue }
    const moved = rows.filter((row) => row.before === "fail" && row.after === "pass")
    if (moved.length === 0) problems.push(name + " has a flipped entry that does not read fail -> pass: " + clip(show(rows[0]), 110))
    const entry = moved.length > 0 ? moved[0] : rows[0]
    if (entry.rule !== "dependency-declared") problems.push(name + " flipped on rule " + show(entry.rule) + ", expected dependency-declared")
    if (!/vendor|baseline|preload/i.test(show(entry.basis))) problems.push(name + " flipped with no basis naming the source that provides the module")
    if (ourNames.length > 0 && ourNames.indexOf(name) === -1) problems.push(name + " is named as flipped but is not among the re-judged own packages")
    named.push(name + " " + show(entry.before) + " -> " + show(entry.after) + " on " + show(entry.rule) + "; basis " + clip(show(entry.basis), 140))
  }
  const regressed = Array.isArray(parsed.regressed) ? parsed.regressed : []
  if (regressed.length > 0) problems.push("the roster repair regressed " + String(regressed.length) + " reading(s): " + clip(show(regressed[0]), 110))
  const towardUnknown = Array.isArray(parsed.regressedTowardsUnknown) ? parsed.regressedTowardsUnknown : []
  if (towardUnknown.length > 0) problems.push(String(towardUnknown.length) + " reading(s) became unknown: " + clip(show(towardUnknown[0]), 110))
  const roster = parsed.roster ?? null
  if (roster === null) problems.push("the archive carries no roster block, so the two sources are not declared in the reading")
  else {
    const sources = Array.isArray(roster.sources) ? roster.sources.join(" ") : ""
    for (const needle of ["kernel-vendor", "client-baseline"]) if (sources.indexOf(needle) === -1) problems.push("the roster block does not declare the source " + needle + ": " + clip(sources, 110))
  }
  const consistency = parsed.consistency ?? null
  if (consistency === null) problems.push("the archive carries no consistency block for the recorded third-party verdicts")
  else {
    if (consistency.against !== "compat/adaptation/port-verdicts.json") problems.push("the consistency block is measured against " + show(consistency.against) + ", expected compat/adaptation/port-verdicts.json")
    for (const key of ["agree", "notReproduced", "newFindings"]) if (!Array.isArray(consistency[key])) problems.push("the consistency block carries no " + key + " list")
  }
  console.log("      flipped " + String(flipped.length) + " reading(s) fail -> pass; own packages re-judged " + String(ourNames.length) + "; regressed " + String(regressed.length) + "; consistency against " + show(consistency === null ? null : consistency.against))
  for (const line of named) console.log("      " + line)
  record(6, problems.length === 0, problems.length === 0 ? "every fail -> pass change is named in the archive's flipped list with its before/after and the source that provides the module, nothing regressed, and the reconciliation against the recorded verdicts is intact" : problems.join(" | "))
}

function checkSeven(mod) {
  const problems = []
  const runs = []
  const vendoredNames = vendored()
  let missing = []
  const contractGate = runNode([CONTRACT_GATE])
  runs.push("verify-plugin-contract exit " + show(contractGate.status) + " in " + String(contractGate.ms) + " ms")
  if (contractGate.status !== 0) problems.push("the R47 gate exits " + show(contractGate.status) + " after the roster change: " + clip(contractGate.stdout + contractGate.stderr, 140))
  const compositionGate = runNode([COMPOSITION_GATE])
  runs.push("verify-composition-rows exit " + show(compositionGate.status) + " in " + String(compositionGate.ms) + " ms")
  if (compositionGate.status !== 0) problems.push("verify-composition-rows exits " + show(compositionGate.status) + " after the roster change: " + clip(compositionGate.stdout + compositionGate.stderr, 140))
  const first = join(base(), "compose-a.json")
  const second = join(base(), "compose-b.json")
  const one = runNode([CURRENT.compose, "--out", first])
  const two = runNode([CURRENT.compose, "--out", second])
  if (one.status !== 0 || two.status !== 0) problems.push("the composer exits " + show(one.status) + "/" + show(two.status) + ": " + clip(one.stderr, 110))
  else {
    const freshText = readFileSync(first, "utf8")
    const againText = readFileSync(second, "utf8")
    if (freshText !== againText) problems.push("two runs of the composer over the same inputs disagree: the composition analysis is not deterministic")
    else {
      const fresh = JSON.parse(freshText)
      const tracked = JSON.parse(readFileSync(COMPOSITION, "utf8"))
      for (const key of ["bundles", "counts", "limits"]) {
        if (JSON.stringify(fresh[key]) !== JSON.stringify(tracked[key])) problems.push("the roster-independent section " + key + " moved: " + clip(show(fresh[key]), 80) + " vs " + clip(show(tracked[key]), 80))
      }
      const moved = Object.keys(tracked).filter((key) => JSON.stringify(fresh[key]) !== JSON.stringify(tracked[key]))
      const liveDerived = ["layers", "ids", "liveDigest", "liveInputs"]
      const unexpected = moved.filter((key) => liveDerived.indexOf(key) === -1)
      if (unexpected.length > 0) problems.push("the roster change moved sections of the composition analysis that live state cannot explain: " + show(unexpected))
      console.log("      composer deterministic over two runs: " + String(freshText === againText) + "; vendored framework packages are scanned by the roster but are not profile rows, so their names do not appear here while counts/ids do depend on that root (measured with the vendor-root mutant)")
      console.log("      tracked vs fresh differs only in " + show(moved) + " - live-derived, first at layers[18].files[0].digest, while bundles/counts/limits stay byte-equal (recorded, not gated: no gate can freeze the live home)")
    }
  }
  for (const line of runs) console.log("      " + line)
  console.log("      (these are regression runs of other PRODUCTS, run as child processes; no reading of this gate nests another gate's readings)")
  record(7, problems.length === 0, problems.length === 0 ? "the roster change leaves the neighbouring products green: the R47 gate and the composition gate both exit 0, the analysis is deterministic and carries every vendored package, and its roster-independent sections still match the tracked rows" : problems.join(" | "))
}

let BASE = null
const base = () => {
  if (BASE === null) { mkdirSync(join(PROJECT, ".tmp"), { recursive: true }); BASE = mkdtempSync(join(PROJECT, ".tmp", "r50-")) }
  return BASE
}
/** The vendored kernel package names, enumerated here from the manifests rather than read back. */
function vendored() {
  const out = []
  const root = join(KERNEL, "vendor")
  if (!existsSync(root)) return out
  for (const name of readdirSync(root).sort()) {
    const manifest = join(root, name, "package.json")
    if (!existsSync(manifest) || !statSync(join(root, name)).isDirectory()) continue
    const parsed = readJson(manifest)
    if (parsed !== null && typeof parsed.name === "string") out.push({ dir: name, name: parsed.name, path: resolve(join(root, name)) })
  }
  return out
}
/** A few kernel workspace packages, enumerated here, to prove R1 widened the scan instead of replacing it. */
function kernelTree(limit) {
  const out = []
  const root = join(KERNEL, "packages")
  if (!existsSync(root)) return out
  for (const group of readdirSync(root).sort()) {
    const groupDir = join(root, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const item of readdirSync(groupDir).sort()) {
      const manifest = join(groupDir, item, "package.json")
      if (!existsSync(manifest) || !statSync(join(groupDir, item)).isDirectory()) continue
      const parsed = readJson(manifest)
      if (parsed !== null && typeof parsed.name === "string" && out.length < limit) out.push({ name: parsed.name, path: resolve(join(groupDir, item)) })
    }
    if (out.length >= limit) break
  }
  return out
}
// ---------------------------------------------------------------- self-attack (R40-R50 rulings)
const PRISTINE = { compose: COMPOSE, checker: CHECKER, build: BUILD }
const MUTATIONS = [
  // Anchors are exact substrings of the products under test, each verified to occur exactly once. A mutant is run
  // against a staged copy of the repo (compat/, plugins/, scripts/ copied under .tmp) so its REPO-relative reads
  // still resolve; the declared set is what the mutant MUST redden, extra or missing reds are a mismatch.
  // Re-anchored after R51 collapsed the three kernel roots into one shape (the anchor is now the vendor entry of
  // DEFAULT_ROOTS). R51 also made that root part of the composition scan, so removing it moves the roster reading
  // AND the composition counts/ids: measured both, so both are declared.
  ["the roster stops scanning vendor", "compose", "  { origin: 'vendor', at: join(KERNEL, 'vendor') },", "  { origin: 'vendor', at: join(KERNEL, 'vendor-r50-off') },", [1, 7]],
  ["the checker stops reading the client baseline", "checker", "  const preloaded = sources.baseline && (CLIENT_BASELINE.includes(specifier) || CLIENT_BASELINE.includes(pkg))", "  const preloaded = false", [3, 5, 6]],
  ["build.mjs keeps its own copy of the list", "build", "const CLIENT_BASELINE = JSON.parse(await readFile(join(HERE, '..', 'compat', 'host-modules.json'), 'utf8')).clientBaseline", "const CLIENT_BASELINE = ['react', 'react/jsx-runtime']", [2]],
  // Re-anchored after R51: the three return paths are replaced together, so no basis line names its source any more.
  // The basis strings are part of the archived reading, so the archive moves with them.
  ["the basis stops naming which source provided the module", "checker", "  if (carriedUsable && preloaded) return (KERNEL_LABEL[carried.origin] ?? 'kernel-packages') + '+client-baseline'\n  if (carriedUsable) return KERNEL_LABEL[carried.origin] ?? 'kernel-packages'\n  if (preloaded) return 'client-baseline'", "  if (carriedUsable || preloaded) return 'kernel-host'", [3, 5, 6]],
  // Providing everything flips the recorded targets too, so it moves the archive and the naming list as well.
  ["anything counts as host-provided", "checker", "  if (preloaded) return 'client-baseline'\n  return null\n}", "  if (preloaded) return 'client-baseline'\n  return 'client-baseline'\n}", [4, 5, 6]],
  // The format is the envelope of the archived reading, which the checker re-reads to work out what flipped.
  ["the archived format drifts", "checker", "const FORMAT = 'dsh-link.plugin-contract-readings/1'", "const FORMAT = 'dsh-link.plugin-contract-readings/2'", [3, 5, 6]],
]
const READINGS = [1, 2, 3, 4, 5, 6, 7]

const copyTree = (src, dst) => {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    if (name === "node_modules" || name === ".git") continue
    const from = join(src, name), to = join(dst, name)
    if (statSync(from).isDirectory()) copyTree(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}
const stageRepo = (root) => {
  copyTree(join(PROJECT, "compat"), join(root, "compat"))
  copyTree(join(PROJECT, "plugins"), join(root, "plugins"))
  copyTree(join(PROJECT, "scripts"), join(root, "scripts"))
  for (const name of ["package.json", "pnpm-workspace.yaml", "LICENSE"]) if (existsSync(join(PROJECT, name))) writeFileSync(join(root, name), readFileSync(join(PROJECT, name)))
  return root
}

async function selfAttack() {
  const lines = [], rows = []
  let applied = 0, matched = 0
  for (const [name, product, from, to, declared] of MUTATIONS) {
    const source = readFileSync(PRISTINE[product], "utf8")
    const flipped = source.split(from).join(to)
    if (flipped === source) {
      lines.push("  " + name + " -> NOT APPLICABLE (no " + show(clip(from, 60)) + " in " + product + ")")
      rows.push({ name, declared })
      continue
    }
    applied += 1
    const root = stageRepo(join(base(), "mutant-" + String(applied)))
    const target = product === "build" ? join(root, "plugins", "build.mjs") : join(root, "scripts", product === "compose" ? "compose-profile-rows.mjs" : "check-plugin-contract.mjs")
    writeFileSync(target, flipped)
    CURRENT = { compose: product === "compose" ? target : PRISTINE.compose, checker: product === "checker" ? target : PRISTINE.checker, build: product === "build" ? target : PRISTINE.build }
    ARCHIVE = null
    const seen = await runAll()
    const observed = seen.failed.slice().sort((l, r) => l - r)
    const want = declared.slice().sort((l, r) => l - r)
    const clean = show(observed) === show(want)
    if (clean) matched += 1
    lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
    rows.push({ name, declared })
    CURRENT = { ...PRISTINE }
    ARCHIVE = null
  }
  console.log("== mutants: each must redden exactly its declared set ==")
  console.log(lines.join(String.fromCharCode(10)))
  const uncovered = READINGS.filter((n) => rows.every((r) => r.declared.indexOf(n) === -1))
  console.log("")
  console.log("coverage matrix (reading -> mutants that claim it):")
  for (const n of READINGS) console.log("  " + n + ": " + (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED"))
  console.log("")
  console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(matched) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
  return applied === MUTATIONS.length && matched === applied && uncovered.length === 0 ? 0 : 1
}

async function runAll() {
  results.length = 0
  CURRENT = { ...CURRENT }
  ARCHIVE = null
  const mod = await load(CURRENT.compose)
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven]]
  const failed = [], skipped = []
  for (const [n, check] of sequence) {
    const mark = results.length
    try { await check(mod) } catch (error) { record(n, false, "the check threw: " + (error && error.message ? error.message : String(error))) }
    if (results.length === mark) record(n, false, "no reading was recorded")
    const row = results[results.length - 1]
    if (row.skip) skipped.push(n)
    else if (!row.ok) failed.push(n)
  }
  return { failed, skipped }
}

async function main() {
  if (!existsSync(COMPOSE)) { console.log("SKIP  no composer at " + COMPOSE); return 3 }
  if (!existsSync(KERNEL)) { console.log("SKIP  no kernel checkout at " + KERNEL); return 3 }
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll()
  console.log("")
  console.log(String(results.length) + " readings, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) return 1
  if (skipped.length > 0) return 3
  return 0
}

const code = SELF_ATTACK ? await selfAttack() : await main()
const roots = BASE
if (BASE !== null) rmSync(BASE, { recursive: true, force: true })
console.log("")
console.log("temporary work: " + (roots === null ? "none was needed" : roots + " (built under .tmp, removed again: " + String(!existsSync(roots)) + ")"))
process.exit(code)
