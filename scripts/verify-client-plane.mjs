#!/usr/bin/env node
/**
 * R25: the client-plane chain (capture -> surface -> per-plugin judgement) must be pinned, not just
 * drift-checked. scripts/capture-client-surface.mjs writes compat/surface/client-0.2.1-alpha.1.json and
 * scripts/check-client-plane.mjs writes compat/adaptation/client-plane.json; both already have --check
 * drift gates registered, so this gate judges meaning instead:
 *
 *   1 the claim and the table agree: the report repeats the surface counts, those counts equal the
 *     tables I recount myself, and the capture declares its limits, including the one that says a legal
 *     slot name is not a promise that anyone renders that seat
 *   2 POSITIVE CONTROL: settings.section and conversation.input.right are in the captured slot table AND
 *     judged present, and each present verdict cites a file:line that really carries the inject call
 *   3 NEGATIVE CONTROL, built: a plugin copied into .tmp whose slots.inject names a slot absent from the
 *     table must be judged absent-from-slot-map, with every other slot verdict unchanged
 *   4 service side, scope: remote must be present and declared under packages/api (R24 first missed that
 *     scope: remote lives in packages/api/remotes and packages/api/gateway, not under packages/client)
 *   5 service side, built: dropping remote from the surface must stop its verdict from being present
 *   6 member layer (R34): slots.register / slots.inject / configForms.get must be judged member-present with a
 *     read-back citation; a rewritten member must become member-absent without moving anything else, and a
 *     member asked of a service whose set could not be read must be member-unknown with a reason
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed). --self-attack builds a synthetic
 * surface, plugin and target list in a temp repo and mutates one of them per check.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes("--self-attack")
const REAL = {
  label: "real (this machine)",
  baseDir: PROJECT,
  surface: resolve(option("--surface", join(PROJECT, "compat", "surface", "client-0.2.1-alpha.1.json"))),
  report: resolve(option("--report", join(PROJECT, "compat", "adaptation", "client-plane.json"))),
  targets: resolve(option("--targets", join(PROJECT, "compat", "adaptation", "usage-targets.json"))),
  checker: resolve(option("--checker", join(PROJECT, "scripts", "check-client-plane.mjs"))),
  kernelBase: PROJECT,
}
const SLOT_MUST = ["settings.section", "conversation.input.right"]
const RUNTIME_LIMIT = /SlotMap declaration merging|whether the current owner renders|runtime fact/i
const INJECT_SLOT = /slots\.inject\(\s*["\x27]settings\.section["\x27]/

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text)
const show = (value) => JSON.stringify(value)
const targetsOf = (targets) => (Array.isArray(targets.targets) ? targets.targets : [])
const allRows = (report, key) => (report.plugins ?? []).flatMap((plugin) => (Array.isArray(plugin[key]) ? plugin[key].map((row) => ({ plugin, row })) : []))
// ---------------------------------------------------------------- 1 the claim, the tables, the limits
function checkOne(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const problems = []
  const mine = { services: Object.keys(surface.services ?? {}).length, events: Object.keys(surface.events ?? {}).length, slots: Object.keys(surface.slots ?? {}).length }
  const claimed = surface.counts ?? {}
  for (const key of ["services", "events", "slots"]) if (claimed[key] !== mine[key]) problems.push("the surface claims " + String(claimed[key]) + " " + key + " but its own table holds " + String(mine[key]))
  const repeated = report.clientSurfaceCounts ?? {}
  for (const key of ["services", "events", "slots"]) if (repeated[key] !== mine[key]) problems.push("the report repeats " + String(repeated[key]) + " " + key + " against " + String(mine[key]) + " in the surface")
  if (!Number.isFinite(surface.packages) || surface.packages <= 0) problems.push("the surface does not say how many packages it scanned")
  const limits = Array.isArray(surface.limits) ? surface.limits : []
  if (limits.length === 0) problems.push("the capture declares no limits")
  else if (!limits.some((line) => RUNTIME_LIMIT.test(String(line)))) problems.push("no limit says a legal slot name is not a promise that anyone renders that seat: " + show(limits.map((line) => clip(String(line), 40))))
  record(1, problems.length === 0, problems.length === 0 ? "tables recounted: " + String(mine.services) + " services / " + String(mine.events) + " events / " + String(mine.slots) + " slots over " + String(surface.packages) + " package(s); report repeats them; " + String(limits.length) + " limit(s) include the slot-vs-render one" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 2 positive control
function checkTwo(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const targets = targetsOf(readJson(world.targets))
  const slotTable = surface.slots ?? {}
  const rows = allRows(report, "slotRows")
  const problems = []
  const observed = []
  for (const slot of SLOT_MUST) {
    if (!(slot in slotTable)) { problems.push(slot + " is not in the captured slot table (" + String(Object.keys(slotTable).length) + " names)"); continue }
    const present = rows.filter(({ row }) => row.name === slot && row.class === "present")
    if (present.length === 0) { problems.push(slot + " has no present verdict (classes seen: " + show([...new Set(rows.filter(({ row }) => row.name === slot).map(({ row }) => row.class))]) + ")"); continue }
    for (const { plugin, row } of present) {
      const target = targets.find((entry) => String(entry.name ?? "") === String(plugin.name ?? ""))
      const at = String(row.at ?? "")
      const file = at.replace(/^\s*client\s+/, "").split(":")[0]
      const line = Number(at.split(":")[1])
      if (target === undefined) { problems.push(slot + ": " + plugin.name + " has no usage target, so its citation cannot be read"); continue }
      const absolute = join(String(target.dir), file)
      if (!existsSync(absolute)) { problems.push(slot + ": " + plugin.name + " cites " + at + " but " + absolute + " does not exist"); continue }
      const lines = readText(absolute).split(/\r?\n/)
      if (!Number.isInteger(line) || line < 1 || line > lines.length) { problems.push(slot + ": " + plugin.name + " cites " + at + " outside the file (" + String(lines.length) + " lines)"); continue }
      const window = lines.slice(Math.max(0, line - 1), Math.min(lines.length, line + 2)).join("\n")
      if (!window.includes(slot)) problems.push(slot + ": " + plugin.name + " cites " + at + " but that line does not name the slot")
      observed.push(slot + " <- " + plugin.name + " @" + at)
    }
  }
  record(2, problems.length === 0, problems.length === 0 ? "both slots are in the table and judged present, citations read back: " + observed.join("; ") : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- the constructed pipeline
/** A throwaway repository holding the scripts, the surface and one copied plugin, so no construction can
 * touch the committed report: the checker writes beside its own script. */
function stagePipeline(world, sourceDir) {
  const root = mkdtempSync(join(tmpdir(), "r25-build-"))
  cpSync(join(world.baseDir, "scripts"), join(root, "scripts"), { recursive: true })
  // the whole compat tree travels with the copy: the analyzer reads more than the surface it is given
  cpSync(join(world.baseDir, "compat"), join(root, "compat"), { recursive: true })
  const pluginDir = join(root, "plugin-copy")
  // the whole package is copied (minus its dependency tree): the analyzer reads more than its sources
  cpSync(sourceDir, pluginDir, { recursive: true, filter: (from) => !String(from).slice(String(sourceDir).length).includes("node_modules") })
  const targets = readJson(world.targets)
  const chosen = targetsOf(targets).find((entry) => resolve(String(entry.dir)) === resolve(sourceDir)) ?? null
  if (chosen === null) { rmSync(root, { recursive: true, force: true }); return null }
  writeFileSync(join(root, "compat", "adaptation", "usage-targets.json"), JSON.stringify({ ...targets, targets: [{ ...chosen, dir: pluginDir }] }, null, 1) + "\n")
  return { root, pluginDir, surfacePath: join(root, "compat", "surface", "client-0.2.1-alpha.1.json"), reportPath: join(root, "compat", "adaptation", "client-plane.json"), checker: join(root, "scripts", "check-client-plane.mjs") }
}
const runPipeline = (stage) => spawnSync(process.execPath, [stage.checker], { cwd: stage.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 })
const slotRowsOf = (report) => (report.plugins ?? []).flatMap((plugin) => (plugin.slotRows ?? []).map((row) => ({ name: row.name, class: row.class })))
/** The plugin the positive control hangs on: the first with a present settings.section verdict. */
function anchorOf(world) {
  const report = readJson(world.report)
  const rows = allRows(report, "slotRows")
  const anchor = rows.find(({ row }) => row.name === "settings.section" && row.class === "present") ?? null
  if (anchor === null) return null
  const targets = targetsOf(readJson(world.targets))
  const target = targets.find((entry) => String(entry.name ?? "") === String(anchor.plugin.name ?? "")) ?? null
  return target === null || !existsSync(String(target.dir)) ? null : { anchor, target }
}

// ---------------------------------------------------------------- 3 negative control, built
function checkThree(world) {
  const found = anchorOf(world)
  if (found === null) { record(3, "skip", "no present settings.section verdict whose plugin is on this machine, so the negative control cannot be built"); return }
  const stage = stagePipeline(world, String(found.target.dir))
  if (stage === null) { record(3, false, "the target list no longer names that plugin directory"); return }
  try {
    const libDir = join(stage.pluginDir, "lib")
    const candidates = existsSync(libDir) ? readdirSync(libDir).filter((name) => /\.(js|mjs|cjs)$/.test(name)).map((name) => join(libDir, name)) : []
    const source = candidates.find((file) => INJECT_SLOT.test(readText(file))) ?? null
    if (source === null) { record(3, "skip", "the copied plugin does not carry a literal slots.inject call naming settings.section, so the gate cannot rewrite it"); return }
    // The control is the same staged pipeline run unmodified, so the only variable is the slot name;
    // comparing against the committed report instead would let an unrelated report edit trip this check.
    const firstRun = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(3, false, "the unmodified staged run produced no report (exit " + String(firstRun.status) + "): " + clip(((firstRun.stdout ?? "") + (firstRun.stderr ?? "")).trim(), 200)); return }
    const baseline = slotRowsOf(readJson(stage.reportPath))
    if (!baseline.some((row) => row.name === "settings.section" && row.class === "present")) { record(3, "skip", "the staged baseline does not judge settings.section present, so the construction has no anchor to move"); return }
    writeFileSync(source, readText(source).replace(/settings\.section/, "no.such.slot"))
    const run = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(3, false, "the constructed run produced no report (exit " + String(run.status) + "): " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim(), 200)); return }
    const after = slotRowsOf(readJson(stage.reportPath))
    const problems = []
    const unknown = after.find((row) => row.name === "no.such.slot")
    if (unknown === undefined) problems.push("the constructed report says nothing about no.such.slot")
    else if (unknown.class !== "absent-from-slot-map") problems.push("no.such.slot was judged " + show(unknown.class) + ", not absent-from-slot-map")
    if (after.some((row) => row.name === "settings.section")) problems.push("settings.section still appears after the rewrite")
    const survivors = baseline.filter((row) => row.name !== "settings.section")
    const moved = survivors.filter((row) => !after.some((item) => item.name === row.name && item.class === row.class))
    if (moved.length > 0) problems.push("the construction moved unrelated verdicts: " + show(moved.slice(0, 3)))
    record(3, problems.length === 0, problems.length === 0 ? "built: " + String(found.anchor.plugin.name) + " rewritten to inject no.such.slot -> judged absent-from-slot-map, and the other " + String(survivors.length) + " slot verdict(s) unchanged against the same pipeline run unmodified" : problems.join(" | "))
  } finally { rmSync(stage.root, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 4 remote, and the scope it lives in
function checkFour(world) {
  const rows = allRows(readJson(world.report), "rows")
  const problems = []
  const present = rows.filter(({ row }) => row.name === "remote" && row.class === "present")
  if (present.length === 0) problems.push("remote has no present verdict (classes seen: " + show([...new Set(rows.filter(({ row }) => row.name === "remote").map(({ row }) => row.class))]) + ")")
  const declared = present.flatMap(({ row }) => (row.declaredIn ?? []).map(String))
  if (present.length > 0 && declared.length === 0) problems.push("the present remote verdict cites no declaration")
  if (declared.length > 0 && declared.every((path) => !/packages\/api\//.test(path))) problems.push("every remote declaration sits outside packages/api (" + show(declared.slice(0, 3)) + "), the scope R24 first missed")
  for (const path of declared) if (!existsSync(resolve(world.kernelBase ?? world.baseDir, path.split(":")[0]))) problems.push("declared path " + path + " does not exist under the kernel tree")
  const scopes = [...new Set(declared.filter((path) => /packages\/api\//.test(path)).map((path) => path.split("packages/api/")[1].split("/")[0]))]
  record(4, problems.length === 0, problems.length === 0 ? "remote is present from " + String(present.length) + " usage verdict(s); declarations resolve under " + show(scopes) : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 5 drop remote from the surface, built
function checkFive(world) {
  const rows = allRows(readJson(world.report), "rows")
  const anchor = rows.find(({ row }) => row.name === "remote" && row.class === "present") ?? null
  if (anchor === null) { record(5, false, "no present remote verdict to drop from the surface"); return }
  const targets = targetsOf(readJson(world.targets))
  const target = targets.find((entry) => String(entry.name ?? "") === String(anchor.plugin.name ?? "")) ?? null
  if (target === null || !existsSync(String(target.dir))) { record(5, "skip", "the plugin behind that verdict is not on this machine (" + show(target?.dir ?? null) + ")"); return }
  const stage = stagePipeline(world, String(target.dir))
  if (stage === null) { record(5, false, "the target list no longer names that plugin directory"); return }
  try {
    const surface = readJson(stage.surfacePath)
    if (!Object.prototype.hasOwnProperty.call(surface.services ?? {}, "remote")) { record(5, false, "the copied surface does not declare remote, so there is nothing to drop"); return }
    const firstRun = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(5, false, "the unmodified staged run produced no report (exit " + String(firstRun.status) + "): " + clip(((firstRun.stdout ?? "") + (firstRun.stderr ?? "")).trim(), 200)); return }
    const baselineRows = allRows(readJson(stage.reportPath), "rows")
    if (!baselineRows.some(({ row }) => row.name === "remote" && row.class === "present")) { record(5, "skip", "the staged baseline does not judge remote present, so there is nothing to remove"); return }
    // The construction moves the whole service, faces included: remote.credentials and remote.llm are the
    // same service's faces, so they belong to the change and must not be counted as unrelated verdicts.
    const unaffected = ({ row }) => !/^remote(\.|$)/.test(String(row.name))
    const baselineServices = baselineRows.filter(unaffected).map(({ row }) => ({ name: row.name, class: row.class }))
    delete surface.services.remote
    writeFileSync(stage.surfacePath, JSON.stringify(surface, null, 1) + "\n")
    const run = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(5, false, "the constructed run produced no report (exit " + String(run.status) + "): " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim(), 200)); return }
    const afterRows = allRows(readJson(stage.reportPath), "rows")
    const after = afterRows.filter(({ row }) => row.name === "remote")
    const stillPresent = after.filter(({ row }) => row.class === "present")
    const problems = []
    if (stillPresent.length > 0) problems.push("remote is still judged present after being dropped from the surface (" + show(stillPresent.map(({ row }) => row.at)) + "; second run exit " + String(run.status) + ")" + " out=" + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim().replace(/\s+/g, " "), 160))
    if (after.length === 0) problems.push("dropping remote removed the verdict entirely instead of turning it absent")
    const moved = baselineServices.filter((row) => !afterRows.some(({ row: other }) => unaffected({ row: other }) && other.name === row.name && other.class === row.class))
    if (moved.length > 0) problems.push("the construction moved unrelated verdicts: " + show(moved.slice(0, 3)))
    record(5, problems.length === 0, problems.length === 0 ? "built: dropping remote from the surface turns its verdict absent (now " + show([...new Set(after.map(({ row }) => row.class))]) + ") with the other " + String(baselineServices.length) + " service verdict(s) unchanged against the same pipeline run unmodified" : problems.join(" | "))
  } finally { rmSync(stage.root, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 6 the member layer, and what it cannot read
/** The member usages that must be judged, and the service each belongs to. */
const MEMBER_MUST = [
  { name: "slots.register", head: "slots", member: "register" },
  { name: "slots.inject", head: "slots", member: "inject" },
  { name: "configForms.get", head: "configForms", member: "get" },
]

function checkSix(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const targets = targetsOf(readJson(world.targets))
  const rows = allRows(report, "rows")
  const problems = []
  const observed = []
  for (const must of MEMBER_MUST) {
    const found = rows.filter(({ row }) => row.name === must.name)
    if (found.length === 0) { problems.push(must.name + " has no verdict: the member layer recorded nothing for it"); continue }
    const judged = found.filter(({ row }) => row.class === "member-present")
    if (judged.length === 0) { problems.push(must.name + " is not judged member-present (classes: " + show([...new Set(found.map(({ row }) => row.class))]) + ")"); continue }
    const declared = (surface.services ?? {})[must.head] ?? null
    if (declared === null) { problems.push(must.head + " is not declared in the surface"); continue }
    if (Array.isArray(declared.members) === false && Array.isArray(declared.properties) === false) { problems.push(must.head + " carries no member set, so member-present cannot be read from it"); continue }
    for (const { plugin, row } of judged) {
      const target = targets.find((entry) => String(entry.name ?? "") === String(plugin.name ?? ""))
      if (target === undefined) { problems.push(must.name + ": " + plugin.name + " has no usage target, so its citation cannot be read"); continue }
      const at = String(row.at ?? "")
      const file = at.replace(/^\s*client\s+/, "").split(":")[0]
      const line = Number(at.split(":")[1])
      const absolute = join(String(target.dir), file)
      if (!existsSync(absolute)) { problems.push(must.name + ": cites " + at + " but that file does not exist") ; continue }
      const lines = readText(absolute).split(/\r?\n/)
      const window = lines.slice(Math.max(0, line - 2), Math.min(lines.length, line + 1)).join("\n")
      if (window.includes(must.head + "." + must.member) === false) problems.push(must.name + ": " + plugin.name + " cites " + at + " but that window does not name it")
      observed.push(must.name + " <- " + plugin.name + " @" + at)
    }
  }
  const anchor = rows.find(({ row }) => row.name === "slots.register" && row.class === "member-present") ?? null
  if (anchor === null || observed.length === 0) {
    record(6, problems.length === 0 ? "skip" : false, problems.length === 0 ? "no member verdict to read back on this machine" : problems.slice(0, 3).join(" | "))
    return
  }
  const target = targets.find((entry) => String(entry.name ?? "") === String(anchor.plugin.name ?? "")) ?? null
  if (target === null || !existsSync(String(target.dir))) { record(6, "skip", "the plugin behind the member verdict is not on this machine"); return }
  const unreadable = Object.entries(surface.services ?? {}).find(([, value]) => value.members === null && typeof value.type === "string" && /^[A-Za-z_$][\w$]*$/.test(value.type) === false) ?? null
  const stage = stagePipeline(world, String(target.dir))
  if (stage === null) { record(6, false, "the target list no longer names that plugin directory"); return }
  try {
    const libDir = join(stage.pluginDir, "lib")
    const files = existsSync(libDir) ? readdirSync(libDir).filter((name) => /\.(js|mjs|cjs)$/.test(name)).map((name) => join(libDir, name)) : []
    const source = files.find((file) => /ctx\.slots\.register/.test(readText(file))) ?? null
    if (source === null) { record(6, "skip", "the copied plugin carries no literal ctx.slots.register call to rewrite"); return }
    const first = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(6, false, "the unmodified staged run produced no report (exit " + String(first.status) + ")"); return }
    const baseline = allRows(readJson(stage.reportPath), "rows").map(({ row }) => ({ name: row.name, class: row.class }))
    writeFileSync(source, readText(source).replace("ctx.slots.register", "ctx.slots.noSuchMember"))
    const run = runPipeline(stage)
    if (!existsSync(stage.reportPath)) { record(6, false, "the constructed run produced no report (exit " + String(run.status) + ")"); return }
    const after = allRows(readJson(stage.reportPath), "rows")
    const renamed = after.find(({ row }) => row.name === "slots.noSuchMember") ?? null
    if (renamed === null) problems.push("the constructed report says nothing about slots.noSuchMember")
    else if (renamed.row.class !== "member-absent") problems.push("slots.noSuchMember was judged " + show(renamed.row.class) + ", not member-absent")
    const moved = baseline.filter((row) => row.name !== "slots.register").filter((row) => !after.some(({ row: other }) => other.name === row.name && other.class === row.class))
    if (moved.length > 0) problems.push("the construction moved unrelated verdicts: " + show(moved.slice(0, 3)))
    let unreadableNote = ""
    if (unreadable === null) problems.push("the surface declares no service whose member set could not be read, so the unknown case cannot be built")
    else {
      writeFileSync(source, readText(source) + "\nconst r25Probe = ctx." + unreadable[0] + ".noSuchMemberProbe\n")
      const third = runPipeline(stage)
      if (!existsSync(stage.reportPath)) problems.push("the unknown-case run produced no report (exit " + String(third.status) + ")")
      else {
        const probe = allRows(readJson(stage.reportPath), "rows").find(({ row }) => row.name === unreadable[0] + ".noSuchMemberProbe") ?? null
        if (probe === null) problems.push("no verdict for " + unreadable[0] + ".noSuchMemberProbe")
        else if (probe.row.class !== "member-unknown") problems.push(unreadable[0] + ".noSuchMemberProbe was judged " + show(probe.row.class) + ", not member-unknown")
        else if (String(probe.row.memberReason ?? "") === "") problems.push("the unknown verdict carries no reason")
        else unreadableNote = " | " + unreadable[0] + " (members: null) -> member-unknown with a reason"
      }
    }
    record(6, problems.length === 0, problems.length === 0 ? "member usages read back and judged: " + observed.slice(0, 3).join("; ") + " | built: slots.register rewritten -> member-absent, other verdicts unchanged" + unreadableNote : problems.slice(0, 3).join(" | "))
  } finally { rmSync(stage.root, { recursive: true, force: true }) }
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
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

async function main() {
  const missing = []
  if (!existsSync(REAL.surface)) missing.push("client surface " + REAL.surface)
  if (!existsSync(REAL.report)) missing.push("client-plane report " + REAL.report)
  if (!existsSync(REAL.targets)) missing.push("usage targets " + REAL.targets)
  if (!existsSync(REAL.checker)) missing.push("checker " + REAL.checker)
  if (missing.length > 0) {
    console.log("SKIP  the client-plane chain is not on this machine yet; missing:")
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
  const mod = await import(pathToFileURL(join(PROJECT, "scripts", "lib", "client-plane-synthetic.mjs")).href)
  await mod.selfAttack({ runAll, stagePipeline, tmpdir, join, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync })
} else {
  await main()
}
