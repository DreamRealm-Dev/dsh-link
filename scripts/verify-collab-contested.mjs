#!/usr/bin/env node
/**
 * R29 (task-50): a contested claim must resolve by `at`, not by arrival order — for members and for tasks.
 *
 * plugins/dsh-link-collab exports projectTeamState(records). A contested entry carries the winning claim,
 * the contenders it beat, how it was resolved and whether there was a contest:
 *   { id, team, <kind fields>, at: <record seq>, claim: { <kind fields>, at: <timestamp|null>, seq, writer },
 *     resolvedBy: "at" | "arrival", contested: boolean, losers: [ ...claims ] }
 * Member claims carry name/state/role; task claims carry status/owner. The record sequence is deliberately
 * NOT the claim timestamp: `at` on the entry stays the arrival figure, so this gate reads `claim.at`.
 *
 *   1 ORDER INDEPENDENCE, both kinds: one batch of two claims on the same id, fed in two arrival orders,
 *     must project the SAME entity, and it must be the claim with the later `at` (resolvedBy "at",
 *     contested true). Both inputs and both projections print.
 *   2 COUNTEREXAMPLE, built: the same test against a copy of the module whose `at` reads are replaced by
 *     `seq` must FAIL. A check that passes on arrival-order folding is not measuring `at`.
 *   3 MISSING `at`: the same batches without timestamps must resolve with `resolvedBy: "arrival"` while
 *     STILL reporting the contest and listing the loser — silence is not a resolution.
 *   4 THE LOSER AND THE LEDGER: by kind, the winning claim must expose its own fields plus writer and its
 *     timestamp, the losers must be listed, and the projection must not touch the records it was given.
 *   5 NO REGRESSION: verify-teams-log, verify-collab-relay, verify-collab-multihop stay green.
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed). --self-attack runs checks 1/3/4
 * against the neutralised copy and lists which check numbers flipped.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
// R44: reading 5 runs three more gates, each of which may nest a sweep. --skip-regression is the fast path
// for a harness that already owns the full regression sweep: it drops reading 5 and says so.
const SKIP_REGRESSION = argv.includes("--skip-regression")
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes("--self-attack")
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const GATES = ["verify-teams-log.mjs", "verify-collab-relay.mjs", "verify-collab-multihop.mjs"]
const AT_EARLY = "2026-01-01T00:00:00.000Z"
const AT_LATE = "2026-02-01T00:00:00.000Z"
const TEAM = "team-1"
// The two kinds the fold carries, and the fields a claim of each kind must expose.
const KINDS = [
  { name: "member", kind: "member/state", id: "member-1", fields: ["name", "state", "role"], late: { name: "late-claim" }, early: { name: "early-claim" }, winner: { field: "name", value: "late-claim" } },
  // the projection reads a task state from payload.state and reports it as status
  { name: "task", kind: "task/state", id: "task-1", fields: ["status", "owner"], late: { state: "done", owner: "owner-late" }, early: { state: "open", owner: "owner-early" }, winner: { field: "status", value: "done" } },
]
const claim = (spec, seq, at, which) => {
  const body = which === "late" ? spec.late : spec.early
  const record = { seq, writer: "w-" + which, instance: "i1", kind: spec.kind, actor: TEAM, subject: spec.id, payload: { id: spec.id, ...body } }
  return at === null ? record : { ...record, at }
}
const batch = (spec, order, at) => {
  const late = claim(spec, 2, at === undefined ? AT_LATE : at, "late")
  const early = claim(spec, 1, at === undefined ? AT_EARLY : at, "early")
  return order === "late-first" ? [late, early] : [early, late]
}
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text)
const show = (value) => JSON.stringify(value)
const entryOf = (state, id) => [...(state.members ?? []), ...(state.tasks ?? [])].find((entity) => entity.id === id) ?? null
const digestOf = (value) => JSON.stringify(value)
const loadProject = async (modulePath) => { const mod = await import(pathToFileURL(modulePath).href); return mod.projectTeamState ?? mod.default?.projectTeamState ?? null }
// The comparison both check 1 and check 2 use: same projection either way, and the late claim wins.
const compareOrders = (project, spec) => {
  const one = entryOf(project(clone(batch(spec, "late-first"))), spec.id)
  const two = entryOf(project(clone(batch(spec, "early-first"))), spec.id)
  const problems = []
  if (one === null || two === null) { problems.push("the batch does not project " + spec.id + " at all"); return { problems, one, two } }
  if (digestOf(one) !== digestOf(two)) problems.push("the two arrival orders project different entities")
  const claimAt = one.claim?.at ?? null
  if (String(claimAt) !== AT_LATE) problems.push("the winning claim is not the later-at claim (claim.at " + show(claimAt) + ")")
  if (one.resolvedBy !== "at") problems.push("resolvedBy is " + show(one.resolvedBy ?? null) + ", expected \"at\"")
  if (one.contested !== true) problems.push("contested is " + show(one.contested ?? null) + ", expected true")
  if (one.claim?.[spec.winner.field] !== spec.winner.value) problems.push("the winner is not the later claim (" + spec.winner.field + " " + show(one.claim?.[spec.winner.field]) + ", expected " + show(spec.winner.value) + ")")
  return { problems, one, two }
}

// ---------------------------------------------------------------- 1 order independence, both kinds
async function checkOne(world) {
  const project = await loadProject(world.module)
  if (project === null) { record(1, false, "the module exports no projectTeamState"); return null }
  const problems = []
  for (const spec of KINDS) {
    const result = compareOrders(project, spec)
    for (const problem of result.problems) problems.push(spec.name + ": " + problem)
    console.log("      " + spec.name + " order late-first : " + clip(show(batch(spec, "late-first").map((item) => ({ seq: item.seq, at: item.at, ...item.payload }))), 165))
    console.log("      " + spec.name + " order early-first: " + clip(show(batch(spec, "early-first").map((item) => ({ seq: item.seq, at: item.at, ...item.payload }))), 165))
    console.log("      " + spec.name + " projection late-first : " + clip(show(result.one), 185))
    console.log("      " + spec.name + " projection early-first: " + clip(show(result.two), 185))
  }
  record(1, problems.length === 0, problems.length === 0 ? "both kinds project the same entity from either arrival order, and it is the later-at claim" : problems.join(" | "))
  return project
}

// ---------------------------------------------------------------- 2 the counterexample, built
async function checkTwo(world, project) {
  if (project === null) { record(2, false, "the order-independence test could not run, so the counterexample proves nothing"); return }
  const tmp = mkdtempSync(join(tmpdir(), "r29-module-"))
  try {
    const copy = join(tmp, "collab-arrival-order.mjs")
    const source = readFileSync(world.module, "utf8")
    // Neutralise every timestamp read: with `at` replaced by `seq`, only arrival order can decide.
    const neutralised = source.replace(/record\.at/g, "record.seq").replace(/\bpayload\.at\b/g, "payload.seq")
    writeFileSync(copy, neutralised)
    const neutralProject = await loadProject(copy)
    if (neutralProject === null) { record(2, false, "the neutralised copy exports no projectTeamState"); return }
    const problems = []
    const notes = []
    for (const spec of KINDS) {
      const result = compareOrders(neutralProject, spec)
      if (result.problems.length === 0) problems.push(spec.name + ": arrival-order folding passed the order-independence test, so the test is not measuring the at rule")
      notes.push(spec.name + " " + clip(show(result.one?.claim ?? null), 80) + " vs " + clip(show(result.two?.claim ?? null), 80))
    }
    console.log("      neutralised copy: at reads replaced = " + String(neutralised !== source) + "; " + notes.join(" | "))
    record(2, problems.length === 0, problems.length === 0 ? "the same test fails for both kinds on a copy that decides by arrival order (at -> seq), so check 1 really measures the at rule" : problems.join(" | "))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 3 no at: arrival, but still contested
async function checkThree(world, project) {
  if (project === null) { record(3, false, "the module exports no projectTeamState"); return }
  const problems = []
  const notes = []
  for (const spec of KINDS) {
    const entry = entryOf(project(clone(batch(spec, "late-first", null))), spec.id)
    if (entry === null) { problems.push(spec.name + ": the batch without at does not project " + spec.id); continue }
    if ((entry.claim?.at ?? null) !== null) problems.push(spec.name + ": claim.at is " + show(entry.claim?.at ?? null) + ", expected null")
    if (entry.resolvedBy !== "arrival") problems.push(spec.name + ": resolvedBy is " + show(entry.resolvedBy ?? null) + ", expected \"arrival\"")
    if (entry.contested !== true) problems.push(spec.name + ": the contest is not reported (" + show(entry.contested ?? null) + ")")
    if (!Array.isArray(entry.losers) || entry.losers.length === 0) problems.push(spec.name + ": no loser is listed (" + show(entry.losers ?? null) + ")")
    notes.push(spec.name + " -> resolvedBy " + show(entry.resolvedBy) + ", contested " + show(entry.contested) + ", losers " + String((entry.losers ?? []).length))
  }
  record(3, problems.length === 0, problems.length === 0 ? "without at, both kinds resolve by arrival and still report the contest and the loser (" + notes.join("; ") + ")" : problems.join(" | "))
}

// ---------------------------------------------------------------- 4 the loser, by kind, and the ledger
async function checkFour(world, project) {
  if (project === null) { record(4, false, "the module exports no projectTeamState"); return }
  const problems = []
  const notes = []
  for (const spec of KINDS) {
    const records = clone(batch(spec, "late-first"))
    const snapshot = digestOf(records)
    const entry = entryOf(project(records), spec.id)
    if (digestOf(records) !== snapshot) problems.push(spec.name + ": the projection mutated the records it was given")
    if (entry === null) { problems.push(spec.name + ": no entry for " + spec.id); continue }
    for (const field of [...spec.fields, "at", "seq", "writer"]) if (entry.claim?.[field] === undefined) problems.push(spec.name + ": the winning claim exposes no " + field + " (keys " + show(Object.keys(entry.claim ?? {})) + ")")
    const loser = (entry.losers ?? [])[0] ?? null
    if (loser === null) problems.push(spec.name + ": the losing claim is not visible")
    else for (const field of [...spec.fields, "at", "writer"]) if (loser[field] === undefined) problems.push(spec.name + ": the losing claim exposes no " + field)
    notes.push(spec.name + " winner " + clip(show(entry.claim), 95) + " loser " + clip(show(loser), 75))
  }
  record(4, problems.length === 0, problems.length === 0 ? "both kinds expose the winning claim (kind fields + at + seq + writer) and the loser, and the records came back byte-identical: " + notes.join(" | ") : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 5 no regression in the existing gates
function checkFive() {
  const problems = []
  const notes = []
  for (const gate of GATES) {
    const gatePath = join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim().replace(/\s+/g, " "), 120))
  }
  record(5, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function runAll(world) {
  results.length = 0
  console.log("== " + world.label + " ==")
  const project = await checkOne(world)
  await checkTwo(world, project)
  await checkThree(world, project)
  await checkFour(world, project)
  if (SKIP_REGRESSION) {
    console.log("")
    console.log("-- 5. NOT RUN: --skip-regression was passed, so the three nested gates were not re-run here")
    console.log("   (verify-all.mjs owns that sweep; the default run does execute reading 5)")
  } else if (world.skipGates !== true) checkFive()
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

async function main() {
  if (!existsSync(MODULE)) {
    console.log("SKIP  the collab module is not on this machine; missing:")
    console.log("  - " + MODULE)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  const { failed, skipped } = await runAll({ label: "real (this machine)", module: MODULE })
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

if (SELF_ATTACK) {
  const tmp = mkdtempSync(join(tmpdir(), "r29-self-"))
  try {
    const copy = join(tmp, "collab-arrival-order.mjs")
    const source = readFileSync(MODULE, "utf8")
    writeFileSync(copy, source.replace(/record\.at/g, "record.seq").replace(/\bpayload\.at\b/g, "payload.seq"))
    const { failed } = await runAll({ label: "self-attack (module forced to arrival order)", module: copy, skipGates: true })
    console.log("")
    console.log("checks that flipped in the arrival-order world: " + (failed.length === 0 ? "(none — the checks did not notice, which is a failure of this gate)" : show(failed)))
    const noticed = failed.includes(1)
    console.log("the order-independence check noticed the regression: " + String(noticed))
    process.exit(noticed ? 0 : 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
} else {
  await main()
}
