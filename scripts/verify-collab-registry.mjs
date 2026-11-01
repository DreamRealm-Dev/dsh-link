#!/usr/bin/env node
/**
 * R35 (task-59): the collab capability registry must be queryable, stable, order-independent, and silent
 * about absence.
 *
 *   1 DYNAMIC DISCOVERY: two members whose capabilities overlap are found from either side — every
 *     capability reports the right member set, deduped and in one stable order under repeated calls.
 *   2 EMPTY IS NOT AN ERROR: an unknown capability or member yields an empty list, never undefined and
 *     never a throw.
 *   3 ORDER INDEPENDENCE, and the counterexample: the same two declarations for one member, fed with the
 *     arrival order and the seq order swapped, must project the same winner, and the winner is the LARGER
 *     seq. A module that crowns the earlier arrival must fail that test.
 *   4 UNKNOWN KIND: a record of a kind the fold does not carry is counted, not thrown away and not fatal.
 *   5 THE READING CONTROL (asked for explicitly): adding capability declarations must leave every
 *     tasks/members reading byte-identical — measured by comparing two projections, not asserted.
 *   6 NO REGRESSION: the four existing gates stay green.
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
// R44: reading 6 runs four more gates, each of which may nest a sweep. --skip-regression is the fast path
// for a harness that already owns the full regression sweep: it drops reading 6 and says so.
const SKIP_REGRESSION = argv.includes("--skip-regression")
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const GATES = ["verify-collab-contested.mjs", "verify-client-plane.mjs", "verify-client-members.mjs", "verify-teams-log.mjs"]
const TEAM = "team-1"
const ALPHA = "alpha-1"
const BETA = "beta-1"
const CAP_A = "review"
const CAP_B = "ship"
const CAP_C = "oncall"

const cap = (seq, member, capability) => ({ seq, writer: "w-" + member, instance: "i1", kind: "capability/state", actor: TEAM, subject: member, payload: { id: member, member, capability, state: "granted" } })
/** Whole declaration: payload.capabilities is read with replace = true, so it supersedes. */
const capSet = (seq, memberId, capabilities) => ({ seq, writer: "w-" + memberId, instance: "i1", kind: "capability/state", actor: TEAM, subject: memberId, payload: { id: memberId, capabilities } })
/** One capability per record: incremental, so declarations for the same member union. */
const member = (seq, id, name) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: TEAM, subject: id, payload: { id, name, state: "active", role: "member" } })
const task = (seq, id, state) => ({ seq, writer: "w-" + id, instance: "i1", kind: "task/state", actor: TEAM, subject: id, payload: { id, state, owner: "owner-" + id } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const overlay = [member(1, ALPHA, "alpha"), member(2, BETA, "beta"), cap(3, ALPHA, CAP_A), cap(4, ALPHA, CAP_B), cap(5, BETA, CAP_B), cap(6, BETA, CAP_C)]

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "…" : t)
const show = (v) => JSON.stringify(v)
const load = async (modulePath) => { const mod = await import(pathToFileURL(modulePath).href); return mod.projectTeamState ?? mod.default?.projectTeamState ?? null }
/** Find the query helpers however the module names them, so the gate measures behaviour not spelling. */
const registryOf = (state) => state?.registry ?? state?.capabilities ?? null
const callMembersWith = (state, capability) => {
  if (typeof state?.membersWith === "function") return state.membersWith(capability)
  if (typeof state?.registry?.membersWith === "function") return state.registry.membersWith(capability)
  if (typeof state?.capabilities?.membersWith === "function") return state.capabilities.membersWith(capability)
  return undefined
}
const callCapabilitiesOf = (state, memberId) => {
  if (typeof state?.capabilitiesOf === "function") return state.capabilitiesOf(memberId)
  if (typeof state?.registry?.capabilitiesOf === "function") return state.registry.capabilitiesOf(memberId)
  if (typeof state?.capabilities?.capabilitiesOf === "function") return state.capabilities.capabilitiesOf(memberId)
  return undefined
}

// ---------------------------------------------------------------- 1 dynamic discovery
function checkOne(project) {
  const state = project(clone(overlay))
  const problems = []
  const notes = []
  const hasHelpers = callMembersWith(state, CAP_A) !== undefined || callCapabilitiesOf(state, ALPHA) !== undefined || registryOf(state) !== null
  if (!hasHelpers) { record(1, false, "the projection exposes no capability registry at all (keys " + show(Object.keys(state ?? {})) + "): no membersWith, no capabilitiesOf, no registry/capabilities"); return }
  const wanted = new Map([[CAP_A, [ALPHA]], [CAP_B, [ALPHA, BETA]], [CAP_C, [BETA]]])
  for (const [capability, expected] of wanted) {
    const found = callMembersWith(state, capability)
    if (found === undefined) { problems.push("membersWith(" + capability + ") is undefined"); continue }
    if (!Array.isArray(found)) { problems.push("membersWith(" + capability + ") is " + show(found) + ", not a list"); continue }
    const ids = found.map((item) => (typeof item === "string" ? item : item?.id ?? item?.member))
    if (new Set(ids).size !== ids.length) problems.push("membersWith(" + capability + ") repeats a member (" + show(ids) + ")")
    if (show([...ids].sort()) !== show([...expected].sort())) problems.push("membersWith(" + capability + ") is " + show(ids) + ", expected " + show(expected))
    const again = callMembersWith(state, capability)
    const ids2 = Array.isArray(again) ? again.map((item) => (typeof item === "string" ? item : item?.id ?? item?.member)) : null
    if (ids2 === null || show(ids2) !== show(ids)) problems.push("membersWith(" + capability + ") is not stable across calls (" + show(ids) + " then " + show(ids2) + ")")
    notes.push(capability + " -> " + show(ids))
  }
  const alpha = callCapabilitiesOf(state, ALPHA)
  if (alpha === undefined) problems.push("capabilitiesOf(" + ALPHA + ") is undefined")
  else if (!Array.isArray(alpha)) problems.push("capabilitiesOf(" + ALPHA + ") is " + show(alpha) + ", not a list")
  else {
    const names = alpha.map((item) => (typeof item === "string" ? item : item?.capability ?? item?.name))
    if (new Set(names).size !== names.length) problems.push("capabilitiesOf(" + ALPHA + ") repeats a capability (" + show(names) + ")")
    if (show([...names].sort()) !== show([CAP_A, CAP_B].sort())) problems.push("capabilitiesOf(" + ALPHA + ") is " + show(names) + ", expected " + show([CAP_A, CAP_B]))
    notes.push(ALPHA + " -> " + show(names))
  }
  record(1, problems.length === 0, problems.length === 0 ? "two members with overlapping capabilities are found from either side, deduped and stable: " + notes.join("; ") : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 2 empty is not an error
function checkTwo(project) {
  const state = project(clone(overlay))
  const problems = []
  try {
    const none = callMembersWith(state, "no.such.capability")
    if (none === undefined) problems.push("membersWith(unknown) is undefined — absence must be an empty list")
    else if (!Array.isArray(none)) problems.push("membersWith(unknown) is " + show(none) + ", not a list")
    else if (none.length !== 0) problems.push("membersWith(unknown) returned " + String(none.length) + " entr(ies)")
  } catch (error) { problems.push("membersWith(unknown) threw: " + clip(String(error?.message ?? error), 120)) }
  try {
    const none = callCapabilitiesOf(state, "no.such.member")
    if (none === undefined) problems.push("capabilitiesOf(unknown) is undefined — absence must be an empty list")
    else if (!Array.isArray(none)) problems.push("capabilitiesOf(unknown) is " + show(none) + ", not a list")
    else if (none.length !== 0) problems.push("capabilitiesOf(unknown) returned " + String(none.length) + " entr(ies)")
  } catch (error) { problems.push("capabilitiesOf(unknown) threw: " + clip(String(error?.message ?? error), 120)) }
  record(2, problems.length === 0, problems.length === 0 ? "an unknown capability and an unknown member both answer with an empty list, no throw and no undefined" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 3 order independence + counterexample
function compareDeclarations(project) {
  const first = [cap(10, ALPHA, CAP_A), cap(11, ALPHA, CAP_B)]
  const second = [cap(11, ALPHA, CAP_B), cap(10, ALPHA, CAP_A)]
  const one = project(clone(first))
  const two = project(clone(second))
  const listOf = (state) => { const list = callCapabilitiesOf(state, ALPHA); return Array.isArray(list) ? list.map((item) => (typeof item === "string" ? item : item?.capability ?? item?.name)) : null }
  const problems = []
  if (listOf(one) === null || listOf(two) === null) problems.push("capabilitiesOf(" + ALPHA + ") is not a list in both orders")
  else if (show(listOf(one)) !== show(listOf(two))) problems.push("the two orders disagree: " + show(listOf(one)) + " vs " + show(listOf(two)))
  return { problems, one, two, first, second }
}
/** The capability set one projection reports for a member, as plain sorted strings. */
function setOf(state, memberId) {
  const list = callCapabilitiesOf(state, memberId)
  if (!Array.isArray(list)) return null
  return list.map((item) => (typeof item === "string" ? item : item?.capability ?? item?.name)).filter((item) => typeof item === "string").sort()
}
async function checkThree(modulePath) {
  const mod = await import(pathToFileURL(modulePath).href)
  const project = mod.projectTeamState ?? mod.default?.projectTeamState ?? null
  if (project === null) { record(3, false, "the module exports no projectTeamState"); return }
  const problems = []
  const notes = []
  // Permutation: the same two declarations, arrival order swapped.
  const a = setOf(project(clone([cap(10, ALPHA, CAP_A), cap(11, ALPHA, CAP_B)])), ALPHA)
  const b = setOf(project(clone([cap(11, ALPHA, CAP_B), cap(10, ALPHA, CAP_A)])), ALPHA)
  if (a === null || b === null) problems.push("capabilitiesOf(" + ALPHA + ") is not a list in both orders")
  else if (show(a) !== show(b)) problems.push("the two arrival orders disagree: " + show(a) + " vs " + show(b))
  else notes.push("permutation: " + show(a) + " either way")
  // A whole declaration replaces: the higher seq decides which set survives, in either order.
  const forwards = [capSet(10, ALPHA, [CAP_A]), capSet(20, ALPHA, [CAP_C])]
  const backwards = [capSet(20, ALPHA, [CAP_C]), capSet(10, ALPHA, [CAP_A])]
  const c = setOf(project(clone(forwards)), ALPHA)
  const d = setOf(project(clone(backwards)), ALPHA)
  if (c === null || d === null) problems.push("capabilitiesOf(" + ALPHA + ") is not a list for the replacement pair")
  else {
    if (show(c) !== show(d)) problems.push("swapping the arrival order changed which declaration won: " + show(c) + " vs " + show(d))
    if (!c.includes(CAP_C)) problems.push("the higher-seq declaration did not survive (" + show(c) + "), expected " + show([CAP_C]))
    notes.push("higher seq survives: " + show(c) + " either way")
  }
  // Incremental declarations union rather than replacing each other.
  const union = setOf(project(clone([cap(30, ALPHA, CAP_A), cap(31, ALPHA, CAP_B)])), ALPHA)
  if (union === null) problems.push("capabilitiesOf(" + ALPHA + ") is not a list for the incremental pair")
  else if (show(union) !== show([CAP_A, CAP_B].sort())) problems.push("two incremental declarations did not union: " + show(union) + ", expected " + show([CAP_A, CAP_B].sort()))
  else notes.push("incremental union: " + show(union))
  // The same query is exported by the module; where it is, it must agree with the projection.
  if (typeof mod.capabilitiesOf === "function") {
    try {
      const fromExport = mod.capabilitiesOf(project(clone(forwards)), ALPHA)
      const flat = Array.isArray(fromExport) ? fromExport.map((item) => (typeof item === "string" ? item : item?.capability ?? item?.name)).filter((item) => typeof item === "string").sort() : null
      if (flat !== null && c !== null && show(flat) !== show(c)) problems.push("the module-level capabilitiesOf disagrees with the projection: " + show(flat) + " vs " + show(c))
      else notes.push("module-level export agrees")
    } catch (error) { notes.push("module-level export threw: " + clip(String(error?.message ?? error), 60)) }
  } else notes.push("no module-level capabilitiesOf (the projection one is used)")
  // Counterexample: a copy where the earlier arrival wins must differ from the real answer.
  const tmp = mkdtempSync(join(tmpdir(), "r35-winner-"))
  try {
    // The winner is the declaration with the highest seq, which the fold reaches by applying declarations
    // in ASCENDING seq order (projectRegistry: [...declarations].sort((left, right) => left.seq - right.seq)).
    // Crowning the earlier arrival therefore means inverting that order, and the candidates are tried in
    // this order so the inversion attempted is the documented one whenever the expression is there.
    const source = readFileSync(modulePath, "utf8")
    const ascending = "[...declarations].sort((left, right) => left.seq - right.seq)"
    const descending = "[...declarations].sort((left, right) => right.seq - left.seq)"
    const candidates = [
      [ascending, descending],
      ["left.seq - right.seq", "right.seq - left.seq"],
      [/seq\s*>\s*([a-zA-Z_$][\w$]*\.seq)/, "seq < $1"],
      [/seq\s*<\s*([a-zA-Z_$][\w$]*\.seq)/, "seq > $1"],
    ]
    let flipped = source
    let used = null
    for (const [from, to] of candidates) {
      const next = source.replace(from, to)
      if (next !== source) { flipped = next; used = String(from); break }
    }
    if (flipped === source) problems.push("no seq comparison could be inverted in the module, so the counterexample cannot be built")
    else {
      const copy = join(tmp, "collab-earlier-wins.mjs")
      writeFileSync(copy, flipped)
      let brokenSet = null
      try {
        const brokenMod = await import(pathToFileURL(copy).href)
        const brokenProject = brokenMod.projectTeamState ?? brokenMod.default?.projectTeamState ?? null
        brokenSet = brokenProject === null ? null : setOf(brokenProject(clone(forwards)), ALPHA)
      } catch (error) { brokenSet = "threw: " + clip(String(error?.message ?? error), 50) }
      const noticed = brokenSet === null || show(brokenSet) !== show(c)
      notes.push("inverted " + clip(String(used), 50) + "; earlier-arrival copy yields " + show(brokenSet) + " against the real " + show(c) + " -> noticed " + String(noticed))
      if (!noticed) problems.push("crowning the earlier arrival still produced the same winner (" + show(c) + "), so this test is not measuring the seq rule")
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  record(3, problems.length === 0, problems.length === 0 ? "order-independent, higher seq survives, incrementals union: " + notes.join("; ") : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 4 unknown kind only counts
function checkFour(project) {
  const records = [...clone(overlay), { seq: 90, writer: "w-x", instance: "i1", kind: "no/such-kind", actor: TEAM, payload: { id: "x" } }]
  let state = null
  const problems = []
  try { state = project(records) } catch (error) { problems.push("a record of an unknown kind threw: " + clip(String(error?.message ?? error), 120)) }
  if (state !== null) {
    const unknown = state.counts?.unknown ?? null
    if (typeof unknown !== "number") problems.push("counts.unknown is " + show(unknown) + ", so the unknown kind was not counted")
    else if (unknown < 1) problems.push("counts.unknown is " + String(unknown) + " for a record of a kind the fold does not carry")
    const folded = state.counts?.folded ?? null
    if (typeof folded === "number" && typeof unknown === "number" && folded + unknown === 0) problems.push("nothing was folded and nothing counted")
  }
  record(4, problems.length === 0, problems.length === 0 ? "an unknown kind is counted without throwing (counts " + show(state?.counts ?? null) + ")" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 5 the reading control
function checkFive(project) {
  const base = [task(1, "task-1", "open"), member(2, ALPHA, "alpha"), task(3, "task-2", "done")]
  const withCaps = [...clone(base), cap(4, ALPHA, CAP_A), cap(5, ALPHA, CAP_B)]
  // The entity readings only: folded/unknown/through legitimately move whenever any extra record arrives,
  // so the control compares what describes the entities, not the volume of records.
  const pick = (state, path) => path.split(".").reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), state)
  const scope = ["tasks", "members", "counts.tasks", "counts.members", "counts.teams", "counts.unattributed"]
  const readings = (state) => show(Object.fromEntries(scope.map((path) => [path, pick(state, path)])))
  const before = readings(project(clone(base)))
  const after = readings(project(clone(withCaps)))
  const problems = []
  if (before !== after) {
    const keys = scope.filter((path) => show(pick(project(clone(base)), path)) !== show(pick(project(clone(withCaps)), path)))
    problems.push("adding capability declarations changed " + show(keys) + ": " + clip(before, 140) + " vs " + clip(after, 140))
  }
  record(5, problems.length === 0, problems.length === 0 ? "capability declarations leave every tasks/members/counts reading byte-identical (compared, not assumed)" : problems.join(" | "))
}

// ---------------------------------------------------------------- 6 no regression
function checkSix() {
  const problems = []
  const notes = []
  for (const gate of GATES) {
    const gatePath = join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim().replace(/\s+/g, " "), 110))
  }
  record(6, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function main() {
  if (!existsSync(MODULE)) {
    console.log("SKIP  the collab module is not on this machine; missing:")
    console.log("  - " + MODULE)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  const project = await load(MODULE)
  console.log("== real (this machine) ==")
  if (project === null) { record(1, false, "the module exports no projectTeamState"); process.exit(1) }
  checkOne(project)
  checkTwo(project)
  await checkThree(MODULE)
  checkFour(project)
  checkFive(project)
  if (SKIP_REGRESSION) {
    console.log("")
    console.log("-- 6. NOT RUN: --skip-regression was passed, so the four nested gates were not re-run here")
    console.log("   (verify-all.mjs owns that sweep; the default run does execute reading 6)")
  } else checkSix()
  const failed = results.filter((r) => !r.ok && !r.skip).map((r) => r.n)
  const skipped = results.filter((r) => r.skip).map((r) => r.n)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

await main()
