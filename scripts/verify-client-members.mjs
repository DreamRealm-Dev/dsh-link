#!/usr/bin/env node
/**
 * R34 (task-57): a service name is not a member set — the client plane must judge `ctx.<service>.<member>`,
 * and it must not let a member it cannot see pass as present.
 *
 *   1 POSITIVE CONTROL: the captured surface must carry a member set for the `slots` service, the report
 *     must judge `ctx.slots.register` (dsh-repeat-guard) as present, and the cited file:line must really
 *     carry that call — read here, not trusted from the report.
 *   2 CONSTRUCTED: the same pipeline over a copy whose call names `ctx.slots.noSuchMember` must turn that
 *     verdict absent and leave the other member verdicts untouched.
 *   3 UNKNOWN IS NOT PRESENT: where a service member set could not be parsed (members null plus a reason),
 *     every member verdict for that service must be unknown. Unreadable is never "present".
 *   4 ONE VOCABULARY: every present/absent member verdict must name a member the capture actually recorded
 *     for that service, and every captured member must be judged — two lists, one source.
 *   5 NO REGRESSION: verify-client-plane and the three collab gates stay green.
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SURFACE = resolve(option("--surface", join(PROJECT, "compat", "surface", "client-0.2.1-alpha.1.json")))
const REPORT = resolve(option("--report", join(PROJECT, "compat", "adaptation", "client-plane.json")))
const TARGETS = resolve(option("--targets", join(PROJECT, "compat", "adaptation", "usage-targets.json")))
const CHECKER = resolve(option("--checker", join(PROJECT, "scripts", "check-client-plane.mjs")))
const GATES = ["verify-client-plane.mjs", "verify-teams-log.mjs", "verify-collab-relay.mjs", "verify-collab-multihop.mjs"]
const SERVICE = "slots"
const MEMBER = "register"
const PLUGIN = "dsh-repeat-guard"
const CALL = /ctx\.slots\.register/

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
// The checker's vocabulary is member-present / member-absent / member-unknown; the older
// service-level classes are accepted too so this gate does not depend on which layer a row came from.
const isPresent = (cls) => cls === "member-present" || cls === "present"
const isAbsent = (cls) => cls === "member-absent" || cls === "absent"
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "…" : t)
const show = (v) => JSON.stringify(v)
const serviceEntry = (surface, name) => (surface.services ?? {})[name] ?? null
/** Member verdicts: rows whose kind says member, or whose name is dotted as service.member. */
// A member verdict is a row the analyser marked as a service member; a dotted name is only taken as one
// when the head is not itself a service row of the same plugin (remote.credentials is a face, not a member).
const memberRows = (report) => [...(report.plugins ?? []).flatMap((plugin) => {
  const faces = new Set((plugin.rows ?? []).filter((row) => row.kind === "service").map((row) => String(row.name ?? "")))
  return [...(plugin.rows ?? []), ...(plugin.memberRows ?? [])]
    .filter((row) => {
      // The analyzer marks the verdict on the row itself: kind stays "service", the member it judged
      // sits in `member` and the class becomes member-present / member-absent / member-unknown
      // (Lead, R34: the first selector looked for a kind of "service-member", which never exists, so
      // it saw no member verdicts at all and reported the whole layer as missing).
      if (typeof row.member === "string" && row.member !== "") return true
      if (row.kind === "service-member") return true
      if (!/^[a-z][\w-]*\.[A-Za-z_$][\w$]*$/.test(String(row.name ?? ""))) return false
      // A dotted row that is also a service row of this plugin is a face, not a member.
      if (faces.has(String(row.name ?? ""))) return false
      return typeof row.member === "string" && row.member !== ""
    })
    .map((row) => ({ plugin, row }))
})]
const targetsOf = (doc) => (Array.isArray(doc.targets) ? doc.targets : [])
function stage(world) {
  const root = mkdtempSync(join(tmpdir(), "r34-build-"))
  cpSync(join(world.baseDir, "scripts"), join(root, "scripts"), { recursive: true })
  cpSync(join(world.baseDir, "compat"), join(root, "compat"), { recursive: true })
  const source = targetsOf(readJson(world.targets)).find((entry) => String(entry.name ?? "").includes(PLUGIN)) ?? null
  if (source === null || !existsSync(String(source.dir))) { rmSync(root, { recursive: true, force: true }); return null }
  const pluginDir = join(root, "plugin-copy")
  cpSync(String(source.dir), pluginDir, { recursive: true, filter: (from) => !String(from).slice(String(source.dir).length).includes("node_modules") })
  const targets = readJson(world.targets)
  writeFileSync(join(root, "compat", "adaptation", "usage-targets.json"), JSON.stringify({ ...targets, targets: [{ ...source, dir: pluginDir }] }, null, 1) + "\n")
  return { root, pluginDir, plugin: String(source.name ?? ""), checker: join(root, "scripts", "check-client-plane.mjs"), report: join(root, "compat", "adaptation", "client-plane.json"), surface: join(root, "compat", "surface", "client-0.2.1-alpha.1.json") }
}
const runStage = (staged) => spawnSync(process.execPath, [staged.checker], { cwd: staged.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 })

// ---------------------------------------------------------------- 1 positive control
function checkOne(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const problems = []
  const entry = serviceEntry(surface, SERVICE)
  if (entry === null) { record(1, false, "the captured surface has no service named " + SERVICE); return null }
  // A real method can be held as a class field (SlotRegistry.register), so the set is members ∪ properties.
  const members = entry.members === null || entry.members === undefined
    ? null
    : [...entry.members, ...(Array.isArray(entry.properties) ? entry.properties : [])]
  if (members === null) problems.push("the " + SERVICE + " service carries no captured member set (members is " + show(entry.members ?? null) + "; keys " + show(Object.keys(entry)) + "), so no member can be judged present")
  else if (!Array.isArray(members) || !members.map((item) => (typeof item === "string" ? item : item?.name)).includes(MEMBER)) problems.push("the captured member set does not list " + MEMBER + " (" + show(members).slice(0, 120) + ")")
  const rows = memberRows(report).filter(({ row }) => String(row.name ?? "") === SERVICE + "." + MEMBER)
  if (rows.length === 0) problems.push("the report carries no member verdict for " + SERVICE + "." + MEMBER)
  const targets = targetsOf(readJson(world.targets))
  const notes = []
  for (const { plugin, row } of rows) {
    if (String(plugin.name ?? "") !== PLUGIN) continue
    if (!isPresent(row.class)) problems.push(PLUGIN + ": " + SERVICE + "." + MEMBER + " is judged " + show(row.class) + ", not present")
    const target = targets.find((item) => String(item.name ?? "") === String(plugin.name ?? "")) ?? null
    const at = String(row.at ?? "")
    const file = at.replace(/^\s*client\s+/, "").split(":")[0]
    const line = Number(at.split(":")[1])
    if (target === null) { problems.push(PLUGIN + ": no usage target, so the citation cannot be read"); continue }
    const absolute = join(String(target.dir), file)
    if (!existsSync(absolute)) { problems.push(PLUGIN + " cites " + at + " but " + absolute + " does not exist"); continue }
    const lines = readText(absolute).split(/\r?\n/)
    if (!Number.isInteger(line) || line < 1 || line > lines.length) { problems.push(PLUGIN + " cites " + at + " outside the file (" + String(lines.length) + " lines)"); continue }
    const window = lines.slice(Math.max(0, line - 1), Math.min(lines.length, line + 2)).join("\n")
    if (!CALL.test(window)) problems.push(PLUGIN + " cites " + at + " but that line does not carry a ctx.slots.register call")
    notes.push(PLUGIN + " present @" + at)
  }
  record(1, problems.length === 0, problems.length === 0 ? SERVICE + "." + MEMBER + " is present for " + PLUGIN + ", the member set lists it and the citation reads back (" + notes.join("; ") + ")" : problems.slice(0, 3).join(" | "))
  return problems.length === 0 ? { members, rows } : null
}

// ---------------------------------------------------------------- 2 constructed absent
function checkTwo(world) {
  const staged = stage(world)
  if (staged === null) { record(2, "skip", "the plugin to construct with is not on this machine"); return }
  try {
    const libDir = join(staged.pluginDir, "lib")
    const files = existsSync(libDir) ? readdirSync(libDir).filter((name) => /\.(js|mjs|cjs)$/.test(name)).map((name) => join(libDir, name)) : []
    const target = files.find((file) => CALL.test(readText(file))) ?? null
    if (target === null) { record(2, "skip", "the copied plugin carries no literal ctx.slots.register call to rewrite"); return }
    // The baseline is the SAME staged pipeline run unmodified, scoped to the one plugin the stage carries.
    // Comparing against the committed report compared different plugin sets — the stage holds one plugin,
    // the committed report holds them all — so another plugin merely not being there read as "moved", and
    // the construction would have been blamed for a difference it never caused.
    const scoped = (entry) => String(entry.plugin.name ?? "") === staged.plugin && String(entry.row.name ?? "") !== SERVICE + "." + MEMBER
    const baselineRun = runStage(staged)
    if (!existsSync(staged.report)) { record(2, false, "the unmodified staged run produced no report (exit " + String(baselineRun.status) + ")"); return }
    const baseline = memberRows(readJson(staged.report)).filter(scoped)
    writeFileSync(target, readText(target).replace(CALL, "ctx.slots.noSuchMember"))
    const run = runStage(staged)
    if (!existsSync(staged.report)) { record(2, false, "the constructed run produced no report (exit " + String(run.status) + ")"); return }
    const built = readJson(staged.report)
    const after = memberRows(built)
    const unknown = after.find(({ row }) => String(row.name ?? "") === SERVICE + ".noSuchMember")
    const problems = []
    if (unknown === undefined) problems.push("the constructed report says nothing about " + SERVICE + ".noSuchMember")
    else if (isPresent(unknown.row.class)) problems.push(SERVICE + ".noSuchMember was judged present, which is the defect this check exists for")
    else if (!isAbsent(unknown.row.class)) problems.push(SERVICE + ".noSuchMember was judged " + show(unknown.row.class) + ", not absent")
    const moved = baseline.filter(({ row }) => !after.some(({ row: other }) => other.name === row.name && other.class === row.class))
    if (moved.length > 0) problems.push("the construction moved unrelated member verdicts of " + staged.plugin + ": " + show(moved.slice(0, 3).map(({ row }) => row.name)))
    record(2, problems.length === 0, problems.length === 0 ? "built: ctx.slots.noSuchMember is judged absent and the other member verdicts are unchanged" : problems.slice(0, 3).join(" | "))
  } finally { rmSync(staged.root, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 3 unknown is not present
function checkThree(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const unreadable = Object.entries(surface.services ?? {}).filter(([, entry]) => entry !== null && typeof entry === "object" && entry.members === null)
  const rows = memberRows(report)
  const problems = []
  const notes = []
  if (unreadable.length === 0) problems.push("no service records members: null with a reason, so a member that could not be parsed has no way to come out unknown (" + String(Object.keys(surface.services ?? {}).length) + " services captured)")
  for (const [name, entry] of unreadable) {
    const reason = entry.membersReason ?? entry.reason ?? null
    if (reason === null) problems.push(name + ": members is null but no reason is recorded")
    const judged = rows.filter(({ row }) => String(row.name ?? "").startsWith(name + "."))
    const present = judged.filter(({ row }) => row.class === "present")
    if (present.length > 0) problems.push(name + ": " + String(present.length) + " member verdict(s) are present although the member set could not be parsed")
    notes.push(name + " -> members null (" + clip(String(reason ?? "no reason"), 60) + "), " + String(judged.length) + " member verdict(s), none present")
  }
  record(3, problems.length === 0, problems.length === 0 ? "unreadable member sets stay unknown: " + notes.join("; ") : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 4 one vocabulary
function checkFour(world) {
  const surface = readJson(world.surface)
  const report = readJson(world.report)
  const captured = new Map()
  for (const [name, entry] of Object.entries(surface.services ?? {})) {
    // The captured set is members ∪ properties: the source holds some real methods as class fields
    // (SlotRegistry.register), and the checker judges those too, recording declaredAs.
    const members = entry?.members
    if (!Array.isArray(members)) continue
    const names = [...members, ...(Array.isArray(entry?.properties) ? entry.properties : [])]
      .map((item) => (typeof item === "string" ? item : item?.name))
      .filter((item) => typeof item === "string")
    captured.set(name, new Set(names))
  }
  const problems = []
  const rows = memberRows(report)
  for (const { plugin, row } of rows) {
    const name = String(row.name ?? "")
    const dot = name.indexOf(".")
    if (dot === -1) continue
    const service = name.slice(0, dot)
    const member = name.slice(dot + 1)
    const set = captured.get(service)
    if (set === undefined) { problems.push(plugin.name + ": " + name + " is judged against service " + service + ", which captured no member set"); continue }
    if (!set.has(member) && row.class === "present") problems.push(plugin.name + ": " + name + " is judged present but the capture never recorded " + member + " on " + service)
  }
  record(4, problems.length === 0, problems.length === 0 ? "every member verdict names a member the capture recorded (" + String(captured.size) + " service(s) with a member set)" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 5 no regression
function checkFive() {
  const problems = []
  const notes = []
  for (const gate of GATES) {
    const gatePath = join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim().replace(/\s+/g, " "), 110))
  }
  record(5, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function main() {
  const world = { label: "real (this machine)", baseDir: PROJECT, surface: SURFACE, report: REPORT, targets: TARGETS, checker: CHECKER }
  const missing = []
  if (!existsSync(SURFACE)) missing.push("client surface " + SURFACE)
  if (!existsSync(REPORT)) missing.push("client-plane report " + REPORT)
  if (!existsSync(TARGETS)) missing.push("usage targets " + TARGETS)
  if (missing.length > 0) {
    console.log("SKIP  the client member data is not on this machine yet; missing:")
    for (const item of missing) console.log("  - " + item)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  console.log("== " + world.label + " ==")
  checkOne(world)
  checkTwo(world)
  checkThree(world)
  checkFour(world)
  checkFive()
  const failed = results.filter((r) => !r.ok && !r.skip).map((r) => r.n)
  const skipped = results.filter((r) => r.skip).map((r) => r.n)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

await main()
