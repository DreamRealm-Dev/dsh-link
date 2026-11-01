#!/usr/bin/env node
/**
 * R46 (task-87): LINK's own upgrade path - an upgrade must not lose conversations, capability, or startup.
 *
 * Subject: .tmp/r46-contract.md. One state root (version.json + config/ + plugins.json + ledger/ + paths the
 * layout does not know) must come out of a migration with the ledger byte-identical, the plugin set only
 * growing, no pre-existing config key lost, and every unknown path untouched. Three refusals (newer-state,
 * no-path, unknown-action) and two injected failures (dryRun, beforeCommit) are constructed as counterexamples
 * and each must leave the root byte-identical - proved by a recursive sha256 tree snapshot, never a return code.
 *
 * Expectations are computed here from the fixture and the manifest this gate writes; nothing is read back from
 * the engine. The engine surface is read from plugins/dsh-link-upgrade/lib/index.js before any assertion.
 * Self-attack follows the R40-R45 rulings: declared-set equality per mutant, a coverage matrix with no uncovered
 * reading, anchors taken from lib/index.js. This gate runs no other gate: regression belongs to the suite.
 *
 * R76 (debt 47) adds one reading in the same style: the upgrade engine retries a rename the operating system
 * refuses once (EPERM/EIO - Windows says that for a locked handle) and must still commit byte for byte without
 * leaving staging or backup behind, while a permanent failure (ENOSPC) must still be thrown untouched. Both
 * faults are injected into a COPY of the artifact under test, so the mutant accounting sees them.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed).
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-upgrade", "lib", "index.js")))
const SELF_ATTACK = argv.includes("--self-attack")
const FORMAT = "dsh-link.migrations/1"
const LF = String.fromCharCode(10)

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : status === "skip" ? "SKIP" : "FAIL") + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const sorted = (v) => Array.isArray(v) && show(v) === show(v.slice().sort())
const norm = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({
  readState: mod && typeof mod.readState === "function" ? mod.readState : null,
  plan: mod && typeof mod.planMigrations === "function" ? mod.planMigrations : null,
  apply: mod && typeof mod.applyMigration === "function" ? mod.applyMigration : null,
})
const MISSING = "the module exposes no R46 surface (readState/planMigrations/applyMigration) - task-86 has not landed"

// ---------------------------------------------------------------- recursive hash: the only hard evidence
const sha = (buf) => createHash("sha256").update(buf).digest("hex")
function snapshot(root) {
  const map = {}
  const walk = (rel) => {
    const abs = rel === "" ? root : join(root, rel)
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel === "" ? name : rel + "/" + name
      if (statSync(join(abs, name)).isDirectory()) { map[childRel] = "dir"; walk(childRel) }
      else map[childRel] = sha(readFileSync(join(abs, name)))
    }
  }
  walk("")
  const paths = Object.keys(map).sort()
  const digest = sha(Buffer.from(paths.map((p) => p + "=" + map[p]).join(LF), "utf8"))
  return { map, paths, digest }
}
const moved = (before, after) => {
  const out = []
  for (const p of after.paths) if (before.map[p] === undefined) out.push("added " + p)
  for (const p of before.paths) {
    if (after.map[p] === undefined) out.push("removed " + p)
    else if (after.map[p] !== before.map[p]) out.push("changed " + p)
  }
  return out.sort()
}
const sameTree = (before, after) => before.digest === after.digest

// ---------------------------------------------------------------- fixtures (written by this gate)
const LEDGER = () => ({
  "control.log": Buffer.concat([Buffer.from("{\"seq\":1,\"speaker\":\"lead\",\"text\":\"会话一：升级不许丢\"}", "utf8"), Buffer.from([0x0a, 0x00, 0xff, 0x7f, 0x01, 0x0a])]),
  "tasks.log": Buffer.concat([Buffer.from("{\"seq\":2,\"task\":\"R46 迁移\",\"state\":\"open\"}", "utf8"), Buffer.from([0x0a])]),
})
const EXTRAS = () => ({
  "unknown.bin": Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x7f]),
  "weird/note.txt": Buffer.from("this directory is not part of the layout", "utf8"),
})
const baseSpec = (layout) => ({
  version: { link: "0.1.0", layout },
  config: { "window.json": { scale: 1, theme: "dark" }, "profile.patch.json": { density: "compact" } },
  plugins: ["dsh-link-core", "dsh-link-collab"],
  ledger: LEDGER(),
  extras: EXTRAS(),
})
const writeJson = (abs, value) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, JSON.stringify(value, null, 2) + LF) }
function buildRoot(root, spec) {
  mkdirSync(root, { recursive: true })
  writeJson(join(root, "version.json"), spec.version)
  for (const [name, value] of Object.entries(spec.config)) writeJson(join(root, "config", name), value)
  writeJson(join(root, "plugins.json"), { plugins: spec.plugins })
  mkdirSync(join(root, "ledger"), { recursive: true })
  for (const [name, bytes] of Object.entries(spec.ledger)) writeFileSync(join(root, "ledger", name), bytes)
  for (const [rel, bytes] of Object.entries(spec.extras)) { const abs = join(root, ...rel.split("/")); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, bytes) }
  return root
}

// The contract pins the action vocabulary and the two example config files but not how a dotted action key maps
// onto config/, so this gate uses the reading that makes the example meaningful: the segment before the first dot
// names the file, the rest names the member inside it, hence window.scale is config/window.json -> scale.
const keyFile = (key) => { const parts = key.split("."); return { file: parts[0] + ".json", path: parts.slice(1) } }
function specReadKey(config, key) {
  const target = keyFile(key)
  let at = config[target.file]
  if (at === undefined) return { missing: true }
  for (const part of target.path) { if (at === null || typeof at !== "object" || !(part in at)) return { missing: true }; at = at[part] }
  return { missing: false, value: at }
}
function specWriteKey(config, key, value) {
  const target = keyFile(key)
  if (config[target.file] === undefined) config[target.file] = {}
  let at = config[target.file]
  for (const part of target.path.slice(0, -1)) { if (typeof at[part] !== "object" || at[part] === null) at[part] = {}; at = at[part] }
  at[target.path[target.path.length - 1]] = value
}
function readKey(root, key) {
  const target = keyFile(key)
  const file = join(root, "config", target.file)
  if (!existsSync(file)) return { missing: true }
  return specReadKey({ [target.file]: JSON.parse(readFileSync(file, "utf8")) }, key)
}
const presentKeys = (root) => {
  const out = []
  for (const name of readdirSync(join(root, "config")).sort()) {
    const data = JSON.parse(readFileSync(join(root, "config", name), "utf8"))
    const stem = name.endsWith(".json") ? name.slice(0, -5) : name
    for (const member of Object.keys(data).sort()) out.push(stem + "." + member)
  }
  return out.sort()
}

// My own reducer over the manifest: the expectation, computed without the engine.
const ACTIONS = ["add-config", "set-config", "ensure-plugin", "note"]
function stepChain(manifest, from) {
  const chain = []
  let at = from
  for (const step of manifest.steps) if (step.from === at) { chain.push(step); at = step.to }
  return { chain, reached: at }
}
function expectedAfter(spec, manifest) {
  const reach = stepChain(manifest, spec.version.layout)
  const config = JSON.parse(JSON.stringify(spec.config))
  const plugins = spec.plugins.slice()
  const applied = [], changed = [], added = [], unknown = []
  for (const step of reach.chain) {
    applied.push(step.from + "->" + step.to)
    for (const action of step.actions) {
      if (ACTIONS.indexOf(action.kind) === -1) { unknown.push({ step: step.to, kind: action.kind }); continue }
      if (action.kind === "add-config") {
        if (specReadKey(config, action.key).missing) { specWriteKey(config, action.key, action.value); added.push(action.key) }
      } else if (action.kind === "set-config") {
        const now = specReadKey(config, action.key)
        if (!now.missing && show(now.value) !== show(action.value)) changed.push({ key: action.key, before: now.value, after: action.value })
        specWriteKey(config, action.key, action.value)
      } else if (action.kind === "ensure-plugin" && plugins.indexOf(action.name) === -1) plugins.push(action.name)
    }
  }
  return { reached: reach.reached, complete: reach.reached === manifest.current, config, plugins, applied, changed, added, unknown }
}
const MANIFEST = { format: FORMAT, current: 3, steps: [
  { from: 1, to: 2, actions: [{ kind: "add-config", key: "window.hue", value: 210 }, { kind: "ensure-plugin", name: "dsh-link-upgrade" }] },
  { from: 2, to: 3, actions: [{ kind: "set-config", key: "window.theme", value: "light" }, { kind: "note", text: "迁移到 layout 3" }, { kind: "ensure-plugin", name: "dsh-link-teaming" }] },
]}

// ---------------------------------------------------------------- temp roots under .tmp, deleted at the end
let BASE = null
const base = () => {
  if (BASE === null) { mkdirSync(join(PROJECT, ".tmp"), { recursive: true }); BASE = mkdtempSync(join(PROJECT, ".tmp", "r46-")) }
  return BASE
}
const freshRoot = (name, spec) => buildRoot(join(base(), name), spec)
const strays = (root) => readdirSync(dirname(root)).filter((name) => name.indexOf(".staging-") >= 0 || name.indexOf(".backup-") >= 0).sort()

// ---------------------------------------------------------------- readings
// Every one of them builds its own root under .tmp, snapshots it, and compares bytes. Nothing is read back
// from the engine: the expected config, plugin set, applied and changed lists come from expectedAfter above.

function checkOne(mod) {
  const a = api(mod)
  if (a.apply === null || a.plan === null) { record(1, false, MISSING); return }
  const spec = baseSpec(1)
  const root = freshRoot("r1", spec)
  const before = snapshot(root)
  const report = a.apply(root, MANIFEST, {})
  const after = snapshot(root)
  const want = expectedAfter(spec, MANIFEST)
  const problems = []
  if (report.ok !== true) problems.push("ok is " + show(report.ok) + " / reason " + show(report.reason))
  if (report.from !== 1 || report.to !== 3) problems.push("from/to " + show([report.from, report.to]) + ", expected [1,3]")
  if (show(report.applied) !== show(want.applied)) problems.push("applied " + show(report.applied) + ", expected " + show(want.applied))
  if (report.ledgerUnchanged !== true) problems.push("ledgerUnchanged is " + show(report.ledgerUnchanged))
  if (report.rootUnchanged === true) problems.push("rootUnchanged is true although the run migrated")
  const layout = JSON.parse(readFileSync(join(root, "version.json"), "utf8")).layout
  if (layout !== want.reached) problems.push("version.json layout is " + show(layout) + ", expected " + show(want.reached))
  const windowNow = JSON.parse(readFileSync(join(root, "config", "window.json"), "utf8"))
  if (norm(windowNow) !== norm(want.config["window.json"])) problems.push("config/window.json is " + show(windowNow) + ", expected " + show(want.config["window.json"]))
  const profileNow = norm(JSON.parse(readFileSync(join(root, "config", "profile.patch.json"), "utf8")))
  if (profileNow !== norm(spec.config["profile.patch.json"])) problems.push("config/profile.patch.json moved to " + profileNow)
  const pluginsNow = JSON.parse(readFileSync(join(root, "plugins.json"), "utf8")).plugins
  for (const name of want.plugins) if (pluginsNow.indexOf(name) === -1) problems.push("plugin " + name + " is missing after the run")
  if (strays(root).length > 0) problems.push("the run left staging or backup directories behind: " + show(strays(root)))
  console.log("      migrated -> " + clip(show({ reason: report.reason, from: report.from, to: report.to, applied: report.applied, changed: report.changed }), 190))
  console.log("      root moved by " + show(moved(before, after)) + "; digest " + before.digest.slice(0, 12) + " -> " + after.digest.slice(0, 12))
  record(1, problems.length === 0, problems.length === 0 ? "a layout-1 root reaches layout 3 over the two-step manifest: applied [1->2,2->3], ledgerUnchanged true, only the planned paths moved" : problems.join(" | "))
}

function checkTwo(mod) {
  const a = api(mod)
  if (a.apply === null) { record(2, false, MISSING); return }
  const spec = baseSpec(1)
  const root = freshRoot("r2", spec)
  const before = snapshot(root)
  const report = a.apply(root, MANIFEST, {})
  const after = snapshot(root)
  const names = Object.keys(spec.ledger)
  const problems = []
  if (names.length < 2) problems.push("the fixture carries " + String(names.length) + " ledger files, the reading needs at least two")
  const control = spec.ledger["control.log"]
  const adversarial = control.indexOf(0x00) !== -1 && control.indexOf(0xff) !== -1 && control.toString("utf8").indexOf("会话") !== -1
  if (!adversarial) problems.push("the fixture is not adversarial: control.log must carry Chinese text and raw non-UTF8 bytes, so length equality cannot pass by accident")
  for (const name of names) {
    const key = "ledger/" + name
    if (before.map[key] === undefined) { problems.push(key + " was not in the root before the run"); continue }
    if (after.map[key] === undefined) problems.push(key + " disappeared")
    else if (after.map[key] !== before.map[key]) problems.push(key + " changed: " + before.map[key].slice(0, 12) + " -> " + after.map[key].slice(0, 12))
  }
  if (report.ledgerUnchanged !== true) problems.push("ledgerUnchanged is " + show(report.ledgerUnchanged))
  console.log("      ledger " + names.map((n) => n + " " + String(spec.ledger[n].length) + "B " + before.map["ledger/" + n].slice(0, 12)).join(", "))
  record(2, problems.length === 0, problems.length === 0 ? "every conversation file keeps its own sha256 across the migration (two files, one carrying Chinese text and raw binary), so no byte was rewritten" : problems.join(" | "))
}

function checkThree(mod) {
  const a = api(mod)
  if (a.apply === null) { record(3, false, MISSING); return }
  const spec = baseSpec(1)
  const root = freshRoot("r3", spec)
  const beforeKeys = presentKeys(root)
  const beforePlugins = JSON.parse(readFileSync(join(root, "plugins.json"), "utf8")).plugins.slice()
  const report = a.apply(root, MANIFEST, {})
  const afterKeys = presentKeys(root)
  const afterPlugins = JSON.parse(readFileSync(join(root, "plugins.json"), "utf8")).plugins.slice()
  const want = expectedAfter(spec, MANIFEST)
  const problems = []
  if (beforeKeys.length < 3) problems.push("the fixture exposes " + String(beforeKeys.length) + " config keys, the reading needs at least three")
  for (const key of beforeKeys) if (afterKeys.indexOf(key) === -1) problems.push("config key " + key + " disappeared")
  for (const name of beforePlugins) if (afterPlugins.indexOf(name) === -1) problems.push("plugin " + name + " disappeared")
  for (const name of want.plugins) if (afterPlugins.indexOf(name) === -1) problems.push("plugin " + name + " was not ensured by the plan")
  const configKeys = new Set(beforeKeys)
  const configChanged = (Array.isArray(report.changed) ? report.changed : []).filter((c) => configKeys.has(c.key))
  const otherChanged = (Array.isArray(report.changed) ? report.changed : []).filter((c) => !configKeys.has(c.key))
  if (show(configChanged) !== show(want.changed)) problems.push("changed for config keys " + show(configChanged) + ", expected " + show(want.changed))
  const theme = readKey(root, "window.theme")
  if (theme.missing) problems.push("window.theme is gone after the run")
  else if (theme.value !== "light") problems.push("window.theme is " + show(theme.value) + ", expected light")
  console.log("      plugins " + show(beforePlugins) + " -> " + show(afterPlugins))
  console.log("      config keys " + show(beforeKeys) + " -> " + show(afterKeys))
  console.log("      changed for config keys " + show(configChanged) + "; entries outside the config key space " + show(otherChanged) + " (recorded: the contract types changed as {key,before,after} but does not restrict keys to config)")
  console.log("      added " + show(report.added) + " (recorded: the contract fixes neither the scope nor the spelling of added)")
  record(3, problems.length === 0, problems.length === 0 ? "the plugin set only grew, every pre-existing config key survived, and the one overwritten value is reported in changed with before and after" : problems.join(" | "))
}

function checkFour(mod) {
  const a = api(mod)
  if (a.apply === null) { record(4, false, MISSING); return }
  const spec = baseSpec(1)
  const root = freshRoot("r4", spec)
  const before = snapshot(root)
  const report = a.apply(root, MANIFEST, {})
  const after = snapshot(root)
  const problems = []
  for (const rel of ["unknown.bin", "weird/note.txt"]) {
    if (before.map[rel] === undefined) problems.push(rel + " was not written by the fixture")
    else if (before.map[rel] !== after.map[rel]) problems.push(rel + " moved: " + show(moved(before, after)))
  }
  const preserved = Array.isArray(report.preserved) ? report.preserved : []
  if (preserved.indexOf("unknown.bin") === -1) problems.push("unknown.bin is not listed in preserved: " + show(preserved))
  if (!preserved.some((p) => typeof p === "string" && p.indexOf("weird") === 0)) problems.push("weird/ is not listed in preserved: " + show(preserved))
  console.log("      preserved " + show(preserved) + " (granularity recorded: the contract does not fix whether a directory appears as weird or as weird/note.txt)")
  record(4, problems.length === 0, problems.length === 0 ? "a file and a directory the layout does not know come through byte-identical and are listed in preserved" : problems.join(" | "))
}

function checkFive(mod) {
  const a = api(mod)
  if (a.apply === null || a.plan === null) { record(5, false, MISSING); return }
  const spec = baseSpec(4)
  const root = freshRoot("r5", spec)
  const before = snapshot(root)
  const report = a.apply(root, MANIFEST, {})
  const after = snapshot(root)
  const plan = a.plan(MANIFEST, a.readState(root))
  const problems = []
  if (report.ok !== false) problems.push("the run reported ok " + show(report.ok))
  if (report.reason !== "newer-state") problems.push("reason is " + show(report.reason) + ", expected newer-state")
  if (report.rootUnchanged !== true) problems.push("rootUnchanged is " + show(report.rootUnchanged))
  if (!sameTree(before, after)) problems.push("the root moved: " + show(moved(before, after)))
  if (plan.ok !== false) problems.push("the plan reported ok " + show(plan.ok))
  if (plan.reason !== "newer-state") problems.push("the plan says " + show(plan.reason) + ", expected newer-state")
  if (show(plan.steps) !== show([])) problems.push("the plan carries steps " + show(plan.steps) + " for a downgrade")
  console.log("      layout 4 vs manifest current 3 -> " + show({ ok: report.ok, reason: report.reason, rootUnchanged: report.rootUnchanged }) + "; root digest " + before.digest.slice(0, 12) + " -> " + after.digest.slice(0, 12))
  record(5, problems.length === 0, problems.length === 0 ? "a layout newer than the manifest is refused as newer-state and not one byte of the root moves" : problems.join(" | "))
}

function checkSix(mod) {
  const a = api(mod)
  if (a.apply === null) { record(6, false, MISSING); return }
  const gap = { format: FORMAT, current: 3, steps: [{ from: 1, to: 2, actions: [] }] }
  const problems = []
  if (stepChain(gap, 1).reached === gap.current) problems.push("the fixture is not a gap")
  const root = freshRoot("r6", baseSpec(1))
  const before = snapshot(root)
  const report = a.apply(root, gap, {})
  const after = snapshot(root)
  if (report.ok !== false) problems.push("the run reported ok " + show(report.ok))
  if (report.reason !== "no-path") problems.push("reason is " + show(report.reason) + ", expected no-path")
  if (report.rootUnchanged !== true) problems.push("rootUnchanged is " + show(report.rootUnchanged))
  if (!sameTree(before, after)) problems.push("the root moved: " + show(moved(before, after)))
  console.log("      manifest 1->2 with current 3 from layout 1 -> " + show({ ok: report.ok, reason: report.reason, from: report.from, to: report.to, applied: report.applied }) + "; root digest " + before.digest.slice(0, 12) + " -> " + after.digest.slice(0, 12))
  record(6, problems.length === 0, problems.length === 0 ? "a manifest whose steps do not join up is refused as no-path: no partial upgrade, root byte-identical" : problems.join(" | "))
}

function checkSeven(mod) {
  const a = api(mod)
  if (a.apply === null || a.plan === null || a.readState === null) { record(7, false, MISSING); return }
  // The offending action sits in the SECOND step on purpose: its manifest index (1) and its target layout (3)
  // differ, so the gate can state which convention the engine uses to name the step it refuses.
  const bad = { format: FORMAT, current: 3, steps: [{ from: 1, to: 2, actions: [] }, { from: 2, to: 3, actions: [{ kind: "teleport", key: "window.scale" }] }] }
  const root = freshRoot("r7", baseSpec(1))
  const before = snapshot(root)
  const plan = a.plan(bad, a.readState(root))
  const report = a.apply(root, bad, {})
  const after = snapshot(root)
  const entries = Array.isArray(plan.unknown) ? plan.unknown : []
  const problems = []
  if (plan.ok !== false) problems.push("the plan reported ok " + show(plan.ok))
  if (plan.reason !== "unknown-action") problems.push("the plan says " + show(plan.reason) + ", expected unknown-action")
  if (entries.length !== 1 || entries[0].kind !== "teleport") problems.push("the plan lists " + show(plan.unknown) + " as unknown, expected exactly one teleport")
  else if (entries[0].step === 1) console.log("      the refused step is named by its manifest index (1) rather than its target layout (3): recorded, the contract does not fix the convention")
  else if (entries[0].step === 3) console.log("      the refused step is named by its target layout (3) rather than its manifest index (1): recorded")
  else problems.push("the plan names the refused step as " + show(entries[0].step) + ", neither the manifest index 1 nor the target layout 3")
  if (report.ok !== false) problems.push("the run reported ok " + show(report.ok))
  if (report.reason !== "unknown-action") problems.push("the run says " + show(report.reason) + ", expected unknown-action")
  if (report.rootUnchanged !== true) problems.push("rootUnchanged is " + show(report.rootUnchanged))
  if (!sameTree(before, after)) problems.push("the root moved: " + show(moved(before, after)))
  console.log("      kind teleport in the second step -> plan " + show({ ok: plan.ok, reason: plan.reason, unknown: plan.unknown }) + "; root digest " + before.digest.slice(0, 12) + " -> " + after.digest.slice(0, 12))
  record(7, problems.length === 0, problems.length === 0 ? "an action outside the frozen vocabulary is refused as unknown-action with the offending step and kind named, and the root does not move" : problems.join(" | "))
}

function checkEight(mod) {
  const a = api(mod)
  if (a.apply === null) { record(8, false, MISSING); return }
  const root = freshRoot("r8", baseSpec(1))
  const first = a.apply(root, MANIFEST, {})
  const mid = snapshot(root)
  const second = a.apply(root, MANIFEST, {})
  const after = snapshot(root)
  const third = a.apply(root, MANIFEST, {})
  const after3 = snapshot(root)
  const problems = []
  if (first.ok !== true) problems.push("the first run reported " + show(first.reason))
  if (second.reason !== "already-current") problems.push("the second run says " + show(second.reason) + ", expected already-current")
  if (second.rootUnchanged !== true) problems.push("the second run reports rootUnchanged " + show(second.rootUnchanged))
  if (!sameTree(mid, after)) problems.push("the second run wrote: " + show(moved(mid, after)))
  if (!sameTree(after, after3)) problems.push("the third run wrote: " + show(moved(after, after3)))
  if (show(second) !== show(third)) problems.push("two already-current runs differ: " + clip(show(second), 90) + " vs " + clip(show(third), 90))
  console.log("      run 1 " + show({ ok: first.ok, reason: first.reason, to: first.to }) + "; run 2 " + show({ ok: second.ok, reason: second.reason, rootUnchanged: second.rootUnchanged }) + "; run 3 identical to run 2: " + String(show(second) === show(third)))
  console.log("      (run 2 ok is recorded, not gated: the contract fixes the reason and the side-effect freedom, not the ok flag of an already-current run)")
  record(8, problems.length === 0, problems.length === 0 ? "re-running on a current root changes nothing: already-current, rootUnchanged true, and the root digest is identical after the second and the third run" : problems.join(" | "))
}

function checkNine(mod) {
  const a = api(mod)
  if (a.apply === null) { record(9, false, MISSING); return }
  const root = freshRoot("r9", baseSpec(1))
  const before = snapshot(root)
  const dry = a.apply(root, MANIFEST, { dryRun: true })
  const afterDry = snapshot(root)
  const problems = []
  if (!sameTree(before, afterDry)) problems.push("the dry run wrote: " + show(moved(before, afterDry)))
  if (dry.ok !== true) problems.push("the dry run reported ok " + show(dry.ok) + " / " + show(dry.reason) + "")
  if (dry.rootUnchanged !== true) problems.push("the dry run reports rootUnchanged " + show(dry.rootUnchanged))
  const real = a.apply(root, MANIFEST, {})
  const afterReal = snapshot(root)
  for (const field of ["ok", "reason", "from", "to", "applied", "changed", "added", "preserved", "ledgerUnchanged"]) {
    if (show(dry[field]) !== show(real[field])) problems.push("dry run and real run disagree on " + field + ": " + clip(show(dry[field]), 70) + " vs " + clip(show(real[field]), 70))
  }
  if (!sameTree(afterDry, before)) problems.push("the dry run left the root moved")
  if (sameTree(before, afterReal)) problems.push("the real run after the dry run wrote nothing at all")
  if (strays(root).length > 0) problems.push("the dry run left staging or backup directories behind: " + show(strays(root)))
  console.log("      dry run -> " + clip(show({ ok: dry.ok, reason: dry.reason, applied: dry.applied, changed: dry.changed }), 150))
  console.log("      dry run root digest " + before.digest.slice(0, 12) + " -> " + afterDry.digest.slice(0, 12) + " (identical: " + String(sameTree(before, afterDry)) + ")")
  record(9, problems.length === 0, problems.length === 0 ? "the dry run reports the same plan and outcome as the real run and not one byte of the root moves" : problems.join(" | "))
}

function checkTen(mod) {
  const a = api(mod)
  if (a.apply === null) { record(10, false, MISSING); return }
  const root = freshRoot("r10", baseSpec(1))
  const before = snapshot(root)
  const injected = new Error("r46 injected failure")
  let called = false
  let threw = null
  let report = null
  try {
    report = a.apply(root, MANIFEST, { beforeCommit: () => { called = true; throw injected } })
  } catch (error) { threw = error }
  const after = snapshot(root)
  const problems = []
  if (!called) problems.push("the beforeCommit hook was never called, so the injection proves nothing")
  if (!sameTree(before, after)) problems.push("the root moved despite the abandoned commit: " + show(moved(before, after)))
  if (strays(root).length > 0) problems.push("the abandoned commit left staging or backup directories behind: " + show(strays(root)))
  if (threw !== null) {
    const message = threw && threw.message ? threw.message : String(threw)
    if (message.indexOf("r46 injected failure") === -1) problems.push("the thrown error is not the injected one: " + show(message))
  } else if (report !== null) {
    if (report.ok !== false) problems.push("the run reported ok " + show(report.ok) + " although the commit was abandoned")
    if (report.reason === "ok") problems.push("the run reports reason ok after an abandoned commit")
  } else {
    problems.push("the injection neither threw nor produced a report")
  }
  console.log("      semantics " + (threw !== null ? "throws the injected error (" + clip(threw.message, 50) + ")" : "reports reason " + show(report === null ? null : report.reason)) + "; the contract lets the engine choose, recorded here")
  console.log("      root digest " + before.digest.slice(0, 12) + " -> " + after.digest.slice(0, 12) + " (identical: " + String(sameTree(before, after)) + ")")
  record(10, problems.length === 0, problems.length === 0 ? "a fault injected before the commit leaves the original root byte-identical, and the failure is not swallowed" : problems.join(" | "))
}

function checkEleven(mod) {
  const a = api(mod)
  if (a.plan === null || a.readState === null) { record(11, false, MISSING); return }
  const rootA = freshRoot("r11a", baseSpec(1))
  const rootB = freshRoot("r11b", baseSpec(2))
  const before = snapshot(rootA)
  const s1 = a.readState(rootA)
  const s2 = a.readState(rootB)
  const p1 = a.plan(MANIFEST, s1)
  const p1b = a.plan(MANIFEST, s1)
  const p2 = a.plan(MANIFEST, s2)
  const after = snapshot(rootA)
  const pairs = (p) => show((Array.isArray(p.steps) ? p.steps : []).map((s) => [s.from, s.to]))
  const problems = []
  if (show(p1) !== show(p1b)) problems.push("two calls on the same input differ: " + clip(show(p1), 80) + " vs " + clip(show(p1b), 80))
  if (p1.ok !== true || p1.reason !== "ok") problems.push("layout 1 plans as " + show({ ok: p1.ok, reason: p1.reason }))
  if (p1.from !== 1 || p1.to !== 3) problems.push("layout 1 plans from/to " + show([p1.from, p1.to]) + ", expected [1,3]")
  if (pairs(p1) !== show([[1, 2], [2, 3]])) problems.push("layout 1 steps " + pairs(p1) + ", expected [[1,2],[2,3]]")
  if (pairs(p2) !== show([[2, 3]])) problems.push("layout 2 steps " + pairs(p2) + ", expected [[2,3]]")
  if (show(p1.steps) === show(p2.steps)) problems.push("layout 1 and layout 2 plan the same steps")
  if (!sameTree(before, after)) problems.push("planning wrote to the root: " + show(moved(before, after)))
  console.log("      layout 1 -> " + pairs(p1) + "; layout 2 -> " + pairs(p2) + "; same input twice identical: " + String(show(p1) === show(p1b)))
  record(11, problems.length === 0, problems.length === 0 ? "planning is a pure function: the same state gives byte-identical plans, layout 1 and layout 2 give different step lists, and nothing was written" : problems.join(" | "))
}

function checkTwelve(mod) {
  const a = api(mod)
  if (a.readState === null) { record(12, false, MISSING); return }
  const rootA = freshRoot("r12a", baseSpec(2))
  const before = snapshot(rootA)
  const state = a.readState(rootA)
  const after = snapshot(rootA)
  const problems = []
  if (state === null || typeof state !== "object") problems.push("readState returned " + show(state))
  else {
    if (typeof state.root !== "string" || state.root.length === 0) problems.push("root is " + show(state.root))
    if (state.link !== "0.1.0") problems.push("link is " + show(state.link))
    if (state.layout !== 2) problems.push("layout is " + show(state.layout))
    if (show(state.ledger) !== show(["ledger/control.log", "ledger/tasks.log"])) problems.push("ledger is " + show(state.ledger) + ", expected the two files as root-relative paths, sorted")
    if (!Array.isArray(state.plugins) || show(state.plugins.slice().sort()) !== show(["dsh-link-collab", "dsh-link-core"])) problems.push("plugins are " + show(state.plugins))
    const blob = show(state.config)
    if (blob.indexOf("dark") === -1 || blob.indexOf("compact") === -1) problems.push("config does not carry the fixture values: " + clip(blob, 120))
    console.log("      readState -> " + clip(show({ link: state.link, layout: state.layout, ledger: state.ledger, plugins: state.plugins, config: state.config }), 180))
    console.log("      (the shape of config is recorded, not gated: the contract fixes neither a flat key space nor a file-keyed one)")
    if (typeof mod.hashTree === "function") {
      const mineRows = {}
      for (const [key, value] of Object.entries(snapshot(rootA).map)) mineRows[key] = value
      const engineRows = {}
      for (const [key, value] of Object.entries(mod.hashTree(rootA))) engineRows[value === "dir" && key.endsWith("/") ? key.slice(0, -1) : key] = value
      if (norm(engineRows) !== norm(mineRows)) problems.push("my recursive hash and the module hashTree disagree: " + clip(show(engineRows), 90) + " vs " + clip(show(mineRows), 90))
      else console.log("      cross-check: my recursive hash equals the module hashTree over " + String(Object.keys(mineRows).length) + " paths (recorded: hashTree is an extra export, not a contract symbol)")
    }
  }
  if (!sameTree(before, after)) problems.push("readState wrote to the root: " + show(moved(before, after)))
  const rootB = freshRoot("r12b", baseSpec(1))
  rmSync(join(rootB, "version.json"))
  const beforeB = snapshot(rootB)
  let threw = null
  try { a.readState(rootB) } catch (error) { threw = error }
  if (threw === null) problems.push("readState accepted a root with no version.json instead of refusing to guess a version")
  else if (!(threw instanceof TypeError)) problems.push("readState threw " + show(threw && threw.constructor ? threw.constructor.name : typeof threw) + ", expected TypeError")
  const afterB = snapshot(rootB)
  if (!sameTree(beforeB, afterB)) problems.push("the refused read wrote: " + show(moved(beforeB, afterB)))
  console.log("      no version.json -> " + (threw === null ? "accepted" : "threw " + show(threw.constructor ? threw.constructor.name : typeof threw)))
  record(12, problems.length === 0, problems.length === 0 ? "readState is a faithful reader: it lists the ledger sorted, carries the config values, writes nothing, and refuses a root without version.json with a TypeError" : problems.join(" | "))
}

/** The notes a report carries about what the MACHINE did to it, rather than about the root it described. */
const machineNotes = (report) => (report !== null && typeof report === "object" && Array.isArray(report.notes) ? report.notes : [])
  .filter((note) => typeof note === "string" && note.indexOf("retried:rename") === 0)
const withoutMachineNotes = (report) => report !== null && typeof report === "object" && Array.isArray(report.notes)
  ? { ...report, notes: report.notes.filter((note) => !(typeof note === "string" && note.indexOf("retried:rename") === 0)) }
  : report

function checkThirteen(mod) {
  const a = api(mod)
  if (a.apply === null) { record(13, false, MISSING); return }
  const rootA = freshRoot("r13a", baseSpec(1))
  const rootB = freshRoot("r13b", baseSpec(1))
  const ra = a.apply(rootA, MANIFEST, {})
  const rb = a.apply(rootB, MANIFEST, {})
  const problems = []
  // R76: a rename the operating system refused once is a fact about this machine, not about the root, so two
  // byte-identical roots may legitimately differ there (measured: without this exemption the reading failed
  // about two runs in eight, purely because one of the two applies hit a transient EPERM and reported the
  // retry). Everything else must still be identical, and ONLY a note naming a retry is exempt: a difference
  // anywhere else is still a difference.
  const notesA = machineNotes(ra)
  const notesB = machineNotes(rb)
  if (show(withoutMachineNotes(ra)) !== show(withoutMachineNotes(rb))) {
    problems.push("two identical roots produced different reports: " + clip(show(withoutMachineNotes(ra)), 90) + " vs " + clip(show(withoutMachineNotes(rb)), 90))
  } else if (notesA.length > 0 || notesB.length > 0) {
    console.log("      the two runs report different retry notes (" + clip(show([notesA, notesB]), 90) + "): a fact about the machine, not about the root, and the only thing this reading exempts")
  }
  const roundTrip = JSON.parse(JSON.stringify(ra))
  for (const [field, value] of Object.entries(ra)) if (show(roundTrip[field]) !== show(value)) problems.push("field " + field + " does not survive a JSON round trip: " + show(value))
  if (!sorted(ra.applied)) problems.push("applied is not sorted: " + show(ra.applied))
  if (!sorted(ra.added)) problems.push("added is not sorted: " + show(ra.added))
  if (!sorted(ra.preserved)) problems.push("preserved is not sorted: " + show(ra.preserved))
  const keys = Array.isArray(ra.changed) ? ra.changed.map((c) => c.key) : []
  if (show(keys) !== show(keys.slice().sort())) problems.push("changed is not sorted by key: " + show(keys))
  console.log("      report " + clip(show({ applied: ra.applied, added: ra.added, preserved: ra.preserved, changed: keys }), 170))
  record(13, problems.length === 0, problems.length === 0 ? "the report is data: serialisable, byte-identical for byte-identical roots (a retried rename is the one machine fact this reading exempts, and the detail names it when it happens), with applied, added, preserved and changed all sorted" : problems.join(" | "))
}

// ---------------------------------------------------------------- R76 (debt 47): transient rename faults
// The engine now retries a rename once when the operating system says EPERM/EIO (Windows reports a locked
// handle that way, and one suite run died on `EPERM: rename ...staging...`). Two facts have to hold, and
// neither can be read from the shipped artifact on its own: a TRANSIENT failure must still commit, and a
// PERMANENT one must still surface. Both are injected the way this gate already injects failures - a copy of
// the bundle under test, with the first rename call made to fail once - so the injection follows the artifact
// instead of the other way round.
const RENAME_DEFINITION = "function renameWithRetry("

/** The span of the shipped helper's body, or null when this artifact has no such helper. */
function renameBodySpan(source) {
  const start = source.indexOf(RENAME_DEFINITION)
  if (start === -1) return null
  const open = source.indexOf("{", start)
  if (open === -1) return null
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    else if (source[index] === "}") {
      depth -= 1
      if (depth === 0) return { open, close: index }
    }
  }
  return null
}

/** Replace the helper's body with a stub: how a mutant takes its retry away. */
function replaceRenameBody(source, body) {
  const span = renameBodySpan(source)
  if (span === null) return null
  return source.slice(0, span.open + 1) + body + source.slice(span.close)
}

/**
 * A copy of the bundle whose FIRST rename call fails once with `code`, then behaves exactly like the
 * shipped one: the shipped helper keeps its implementation under a private name and the wrapper delegates
 * to it, so the injected module differs from the artifact in nothing but the one fault.
 */
function injectRenameFault(source, code) {
  if (source.indexOf(RENAME_DEFINITION) === -1) return null
  // The fault belongs INSIDE the shipped helper's try: a wrapper around the helper would throw before the
  // retry logic ever ran, which is a different experiment (and it is exactly what the first version of this
  // reading measured - the artifact looked broken when the injection was simply in the wrong place).
  const inner = source.split("renameSync(from, to)").join("__r76RenameOnce(from, to)")
  const wrapper = [
    "let __r76RenameCalls = 0;",
    "function __r76RenameOnce(from, to) {",
    "  __r76RenameCalls += 1;",
    "  if (__r76RenameCalls === 1) { const fault = new Error(\"r76 injected \" + \"" + code + "\"); fault.code = \"" + code + "\"; throw fault }",
    "  return renameSync(from, to);",
    "}",
  ].join(LF)
  return inner + LF + wrapper + LF
}

/**
 * Load a copy of the plugin under test with the first rename made to fail once with `code`.
 *
 * Every copy gets its own directory: a dynamic import is cached by URL, so reusing the path across the
 * mutant runs of --self-attack would hand a later mutant the FIRST copy's module and make this reading
 * red for every mutant (measured: that is exactly what happened before this counter existed).
 */
let injectedCopies = 0
async function loadInjected(modulePath, code, tag) {
  const source = readFileSync(modulePath, "utf8")
  const injected = injectRenameFault(source, code)
  if (injected === null) return null
  injectedCopies += 1
  const dir = join(base(), "r76-" + tag + "-" + String(injectedCopies))
  copyTree(dirname(dirname(modulePath)), dir)
  writeFileSync(join(dir, "lib", "index.js"), injected)
  const mod = await load(join(dir, "lib", "index.js"))
  return { mod, dir }
}

/** The retry count the report claims, and the lines it claims it in. */
const renameRetriesClaimed = (report) => {
  const notes = report !== null && typeof report === "object" && Array.isArray(report.notes) ? report.notes : []
  const lines = notes.filter((note) => typeof note === "string" && note.indexOf("retried:rename") === 0)
  let count = 0
  for (const line of lines) {
    const tail = Number(line.slice("retried:rename".length).replace(/^:?/, ""))
    count += Number.isFinite(tail) && tail > 0 ? tail : 1
  }
  return { lines, count }
}

async function checkFourteen(mod, modulePath) {
  const a = api(mod)
  if (a.apply === null) { record(14, false, MISSING); return }
  if (readFileSync(modulePath, "utf8").indexOf(RENAME_DEFINITION) === -1) {
    record(14, false, "the engine exposes no " + show(RENAME_DEFINITION) + " to inject a rename fault into, so this reading has no subject")
    return
  }
  const spec = baseSpec(1)
  const scoped = join(base(), "r76-scope")
  mkdirSync(scoped, { recursive: true })
  const at = (name) => buildRoot(join(scoped, name), spec)
  const problems = []
  const rootOk = at("ok")
  const reportOk = a.apply(rootOk, MANIFEST, {})
  const treeOk = snapshot(rootOk)
  const clean = renameRetriesClaimed(reportOk)
  if (clean.count !== 0) problems.push("the clean run claims " + show(clean.lines) + ", so the count is not evidence of anything")
  const loaded = await loadInjected(modulePath, "EPERM", "transient")
  const transient = loaded === null ? null : loaded.mod
  let transientReport = null
  let transientError = null
  const rootT = at("transient")
  if (transient === null || typeof transient.applyMigration !== "function") problems.push("the injected module could not be loaded")
  else {
    try { transientReport = transient.applyMigration(rootT, MANIFEST, {}) } catch (error) { transientError = error }
    if (transientError !== null) problems.push("one transient EPERM made the upgrade fail: " + clip(show(transientError && transientError.message ? transientError.message : transientError), 120))
    const treeT = snapshot(rootT)
    if (!sameTree(treeOk, treeT)) problems.push("the retried commit produced a different root: " + show(moved(treeOk, treeT)))
    const claimed = renameRetriesClaimed(transientReport)
    if (claimed.count !== 1) problems.push("the retried run claims " + show(claimed.lines) + " (count " + String(claimed.count) + "), expected exactly one retry")
    const left = strays(rootT)
    if (left.length > 0) problems.push("the retried commit left staging or backup directories behind: " + show(left))
    console.log("      EPERM once -> ok=" + show(transientReport && transientReport.ok) + " notes=" + clip(show(claimed.lines), 70) + " retries=" + String(claimed.count) + " root byte-identical=" + String(sameTree(treeOk, treeT)) + " strays=" + show(left))
  }
  const loadedPermanent = await loadInjected(modulePath, "ENOSPC", "permanent")
  const permanent = loadedPermanent === null ? null : loadedPermanent.mod
  let permanentThrew = null
  const rootP = at("permanent")
  if (permanent === null || typeof permanent.applyMigration !== "function") problems.push("the permanent-fault module could not be loaded")
  else {
    try { permanent.applyMigration(rootP, MANIFEST, {}) } catch (error) { permanentThrew = error }
    if (permanentThrew === null) problems.push("ENOSPC is not transient, so the upgrade must not report success: it returned instead")
    else if (permanentThrew.code !== "ENOSPC") problems.push("the permanent failure surfaced as " + show({ name: permanentThrew.name, code: permanentThrew.code, message: clip(String(permanentThrew.message), 80) }) + ", expected the injected ENOSPC to come through untouched")
    console.log("      ENOSPC once -> " + (permanentThrew === null ? "returned a report instead of throwing" : "threw " + show({ name: permanentThrew.name, code: permanentThrew.code })) + "; leftover in scope " + show(strays(rootP)))
  }
  if (clean.lines.length > 0) console.log("      clean run notes " + clip(show(clean.lines), 80))
  for (const entry of [loaded, loadedPermanent]) if (entry !== null) rmSync(entry.dir, { recursive: true, force: true })
  record(14, problems.length === 0, problems.length === 0
    ? "a rename the operating system refuses once is retried exactly once and the upgrade still commits byte for byte (no staging or backup left behind), a permanent rename failure is still thrown untouched, and a clean run claims no retry at all"
    : "one transient rename fault: " + problems.join("; "))
}

// ---------------------------------------------------------------- self-attack (R40-R45 rulings)
const MUTATIONS = [
  // Anchors are exact substrings of plugins/dsh-link-upgrade/lib/index.js, each verified to occur exactly once.
  // A declared set is the readings the mutant MUST redden: extra or missing reds are a mismatch, not a pass.
  ["a layout newer than the manifest is migrated anyway", "if (state.layout > manifest.current)", "if (false && state.layout > manifest.current)", [5]],
  // 14 is declared here because this mutant stops the engine from committing at all, and reading 14 is about a
  // commit that was retried: the dependency is intrinsic, so the declared set is the measured one.
  ["already-current inverted: any other layout counts as current", "if (state.layout === manifest.current) return { ok: true, reason: \"already-current\"", "if (state.layout !== manifest.current) return { ok: true, reason: \"already-current\"", [1, 3, 6, 7, 9, 10, 11, 14]],
  ["dry run commits", "if (options.dryRun === true) return report;", "if (false) return report;", [9]],
  ["the commit hook is never called", "options.beforeCommit?.();", "if (false) options.beforeCommit?.();", [10]],
  ["the staging copy loses the ledger", "copyTree(root, staging);", "copyTree(root, staging); rmSync(join(staging, LEDGER_DIR), { recursive: true, force: true });", [1, 2, 3, 4, 8, 9, 13, 14]],
  ["unknown paths are no longer reported", "const preserved = preservedPaths(root);", "const preserved = [];", [4]],
  ["the action vocabulary is no longer closed", "if (kind !== \"add-config\" && kind !== \"set-config\" && kind !== \"ensure-plugin\" && kind !== \"note\") {", "if (false) {", [7]],
  ["an overwritten value is not reported", "changed.push({ key: action.key, before: config[action.key], after: action.value });", "void 0;", [3]],
  ["the plan is not a pure function", "const steps = manifest.steps.map((step) => ({ from: step.from, to: step.to, actions: Array.isArray(step.actions) ? step.actions : [] }));", "const steps = manifest.steps.map((step, index) => ({ from: step.from, to: step.to, actions: (Array.isArray(step.actions) ? step.actions : []).map((action) => ({ ...action, nonce: Math.random() + index })) }));", [11]],
  ["an already-current run claims the root moved", "ledgerUnchanged: true, rootUnchanged: true, notes: [] };", "ledgerUnchanged: true, rootUnchanged: false, notes: [] };", [8]],
  ["a state without a version is accepted", "if (!existsSync(versionPath)) throw new TypeError(", "if (false) throw new TypeError(", [12]],
  ["the ledger listing is not sorted", "return { root, link, layout, config, plugins, ledger: ledger.sort() };", "return { root, link, layout, config, plugins, ledger: ledger.sort().reverse() };", [12]],
  ["a manifest with a gap is upgraded part way", "return refuse(\"no-path\", unknown, \"no step leads from layout \" + String(at) + \" towards \" + String(manifest.current));", "return { ok: true, reason: \"ok\", from: state.layout, to: manifest.current, steps: chain, unknown: [], detail: null };", [6]],
]
// Two mutants cannot be written as a fixed substring pair: they take the retry away from the shipped helper,
// whose body is the product's business and may be rewritten without anyone telling this gate. They are
// generated from the artifact's own text (the helper's body is located and replaced), and they declare the
// same single reading, because both legs of that reading live inside it.
const GENERATED_MUTANTS = [
  ["the transient rename fault is no longer retried", [14], (source) => replaceRenameBody(source, "renameSync(from, to); return 0;")],
  ["the retry swallows every rename failure", [14], (source) => replaceRenameBody(source, "try { renameSync(from, to); } catch { /* swallowed */ } return 0;")],
]
const READINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

const copyTree = (src, dst) => {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name), to = join(dst, name)
    if (statSync(from).isDirectory()) copyTree(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}

async function selfAttack() {
  if (MUTATIONS.length === 0) {
    console.log("== mutants: each must redden exactly its declared set ==")
    console.log("  none declared: no anchor can be taken from lib/index.js until task-86 lands")
    console.log("")
    console.log("mutants applied 0 of 0; declared-set matches 0 of 0; uncovered readings " + String(READINGS.length))
    return 1
  }
  const source = readFileSync(MODULE, "utf8")
  const lines = [], rows = []
  let applied = 0, matched = 0
  for (const [name, from, to, declared] of MUTATIONS) {
    const flipped = source.split(from).join(to)
    if (flipped === source) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(from) + " in the bundle)"); continue }
    applied += 1
    const dir = join(base(), "mutant-" + String(applied))
    copyTree(dirname(dirname(MODULE)), dir)
    writeFileSync(join(dir, "lib", "index.js"), flipped)
    const seen = await runAll(join(dir, "lib", "index.js"))
    const observed = seen.failed.slice().sort((l, r) => l - r)
    const want = declared.slice().sort((l, r) => l - r)
    const clean = show(observed) === show(want)
    if (clean) matched += 1
    lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
    rows.push({ name, declared })
  }
  console.log("== mutants: each must redden exactly its declared set ==")
  console.log(lines.join(" | ").split(" | ").join(LF))
  for (const [name, declared, mutate] of GENERATED_MUTANTS) {
    const flipped = mutate(source)
    if (flipped === null || flipped === source) { lines.push("  " + name + " -> NOT APPLICABLE (the artifact has no rename helper to take apart)"); continue }
    applied += 1
    const dir = join(base(), "mutant-" + String(applied))
    copyTree(dirname(dirname(MODULE)), dir)
    writeFileSync(join(dir, "lib", "index.js"), flipped)
    const seen = await runAll(join(dir, "lib", "index.js"))
    const observed = seen.failed.slice().sort((l, r) => l - r)
    const want = declared.slice().sort((l, r) => l - r)
    const clean = show(observed) === show(want)
    if (clean) matched += 1
    lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
    rows.push({ name, declared })
  }
  const uncovered = READINGS.filter((n) => rows.every((r) => r.declared.indexOf(n) === -1))
  console.log("")
  console.log("coverage matrix (reading -> mutants that claim it):")
  for (const n of READINGS) console.log("  " + n + ": " + (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED"))
  console.log("")
  console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length + GENERATED_MUTANTS.length) + "; declared-set matches " + String(matched) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
  return applied === MUTATIONS.length + GENERATED_MUTANTS.length && matched === applied && uncovered.length === 0 ? 0 : 1
}

async function runAll(modulePath) {
  results.length = 0
  const mod = await load(modulePath)
  // The path travels with the module: a reading that injects a fault must inject it into the artifact under
  // test, not into the shipped one - otherwise a mutant would be measured through an unmutated engine.
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [8, checkEight], [9, checkNine], [10, checkTen], [11, checkEleven], [12, checkTwelve], [13, checkThirteen], [14, checkFourteen]]
  const failed = [], skipped = []
  for (const [n, check] of sequence) {
    const mark = results.length
    try { await check(mod, modulePath) } catch (error) { record(n, false, "the check threw: " + (error && error.message ? error.message : String(error))) }
    if (results.length === mark) record(n, false, "no reading was recorded")
    const row = results[results.length - 1]
    if (row.skip) skipped.push(n)
    else if (!row.ok) failed.push(n)
  }
  return { failed, skipped }
}

async function main() {
  if (!existsSync(MODULE)) { console.log("SKIP  no upgrade engine at " + MODULE); return 3 }
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll(MODULE)
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
console.log("state roots: " + (roots === null ? "none were needed" : roots + " (built under .tmp, removed again: " + String(!existsSync(roots)) + ")"))
process.exit(code)



