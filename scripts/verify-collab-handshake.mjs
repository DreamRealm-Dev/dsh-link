#!/usr/bin/env node
/**
 * R38 (task-65): a lead-to-lead handshake must be requested, agreed, revocable and directional.
 *
 *   1 REQUEST IS NOT PERMISSION: a pending request alone leaves mayExchange false, and the other side
 *     sees it in pendingRequests.
 *   2 AGREEMENT TAKES EFFECT: only the answer flips mayExchange true.
 *   3 REJECTION CLEARS: a rejection after an agreement takes the permission away again.
 *   4 DIRECTION SENSITIVE: A -> B and B -> A are separate facts; one does not carry the other.
 *   5 ORDER INDEPENDENCE + COUNTEREXAMPLE: the same facts in two arrival orders resolve the same pair,
 *     and a copy that resolves the pair first-by-seq instead of last must fail that comparison.
 *   6 READING CONTROL: handshake records leave the ENTITY readings byte-identical. Record counters
 *     (folded, unknown, teams, unattributed) legitimately move when any record arrives and are excluded —
 *     R36 and R37 both got this wrong before settling on entities only.
 *   7 NO REGRESSION: the seven existing gates stay green.
 *
 * Every API check fails while the handshake functions are absent, so nothing passes on an empty read.
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
// R44: reading 7 runs the gates named above, each of which may nest a sweep. --skip-regression is the fast
// path for a harness that already owns the full regression sweep: it drops reading 7 and says so.
const SKIP_REGRESSION = argv.includes("--skip-regression")
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const GATES = ["verify-collab-contested.mjs", "verify-collab-registry.mjs", "verify-collab-failover.mjs", "verify-collab-fractal.mjs", "verify-client-plane.mjs", "verify-client-members.mjs", "verify-teams-log.mjs"]
const TEAM_A = "lead-a", TEAM_B = "lead-b"
// PEER_KIND is peer/state (:352) and the fold reads payload.from / payload.to / payload.state with the
// states requested | granted | denied; the pairs land at state.peers.pairs.
const fact = (seq, from, to, state) => ({ seq, writer: "w-" + from, instance: "i1", kind: "peer/state", actor: from, subject: to, payload: { from, to, state } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const asked = () => [fact(1, TEAM_A, TEAM_B, "requested")]
const agreed = () => [fact(1, TEAM_A, TEAM_B, "requested"), fact(2, TEAM_A, TEAM_B, "granted")]
const rejected = () => [fact(1, TEAM_A, TEAM_B, "requested"), fact(2, TEAM_A, TEAM_B, "granted"), fact(3, TEAM_A, TEAM_B, "denied")]

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => JSON.stringify(v)
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({
  project: mod && mod.projectTeamState ? mod.projectTeamState : null,
  may: mod && mod.mayExchange ? mod.mayExchange : null,
  pending: mod && mod.pendingRequests ? mod.pendingRequests : null,
})
const call = (fn) => { try { return { value: fn() } } catch (error) { return { error: clip(String((error && error.message) || error), 100) } } }
const asIds = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : (item && (item.from || item.id || item.team)) || null)).filter((item) => item !== null) : null)

function stateOf(project, records) { return project(clone(records)) }
function boolOf(value) { return value === true ? true : (value === false ? false : (value && typeof value === "object" && typeof value.allowed === "boolean" ? value.allowed : null)) }

// ---------------------------------------------------------------- 1 request is not permission
function checkOne(mod) {
  const { project, may, pending } = api(mod)
  if (project === null || may === null || pending === null) { record(1, false, "the module exposes no " + [project === null ? "projectTeamState" : null, may === null ? "mayExchange" : null, pending === null ? "pendingRequests" : null].filter((x) => x !== null).join(", ") + " join the missing list"); return }
  const state = stateOf(project, asked())
  const problems = []
  const allowed = boolOf(call(() => may(state, TEAM_A, TEAM_B)).value)
  if (allowed === null) problems.push("mayExchange returned something this gate cannot read as a boolean")
  else if (allowed !== false) problems.push("a pending request already reads as permission (" + show(allowed) + ")")
  const listed = call(() => pending(state, TEAM_B))
  const froms = listed.error === undefined ? asIds(listed.value) : null
  if (froms === null) problems.push("pendingRequests(" + TEAM_B + ") is not a list (" + clip(show(listed.error || listed.value), 60) + ")")
  else if (froms.indexOf(TEAM_A) === -1) problems.push("the pending request from " + TEAM_A + " is not listed (" + show(froms) + ")")
  console.log("      requested only -> mayExchange " + show(allowed) + ", pendingRequests(" + TEAM_B + ") = " + show(froms))
  record(1, problems.length === 0, problems.length === 0 ? "a request is not permission and the other side sees it pending" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 2 agreement takes effect
function checkTwo(mod) {
  const { project, may } = api(mod)
  if (project === null || may === null) { record(2, false, "the module exposes no mayExchange"); return }
  const allowed = boolOf(call(() => may(stateOf(project, agreed()), TEAM_A, TEAM_B)).value)
  console.log("      requested + agreed -> mayExchange " + show(allowed))
  record(2, allowed === true, allowed === true ? "the agreement is what makes the exchange legal" : "an agreement did not make the exchange legal (" + show(allowed) + ")")
}

// ---------------------------------------------------------------- 3 rejection clears
function checkThree(mod) {
  const { project, may } = api(mod)
  if (project === null || may === null) { record(3, false, "the module exposes no mayExchange"); return }
  const problems = []
  const afterAgree = boolOf(call(() => may(stateOf(project, agreed()), TEAM_A, TEAM_B)).value)
  const afterReject = boolOf(call(() => may(stateOf(project, rejected()), TEAM_A, TEAM_B)).value)
  if (afterAgree !== true) problems.push("the agreement itself did not hold (" + show(afterAgree) + "), so the rejection cannot be shown to clear it")
  else if (afterReject !== false) problems.push("a rejection left the earlier agreement in force (" + show(afterReject) + ")")
  console.log("      agreed -> " + show(afterAgree) + "; then rejected -> " + show(afterReject))
  // The clearing is not a separate revoke path: the denial is simply the later fact for that pair, so
  // the pair reads denied and the earlier grant is superseded (Lead, R38: last-by-seq for the pair).
  record(3, problems.length === 0, problems.length === 0 ? "the denial is the later fact for that pair, so the permission the grant gave is gone" : problems.join(" | "))
}

// ---------------------------------------------------------------- 4 direction sensitivity
function checkFour(mod) {
  const { project, may } = api(mod)
  if (project === null || may === null) { record(4, false, "the module exposes no mayExchange"); return }
  const state = stateOf(project, agreed())
  const forward = boolOf(call(() => may(state, TEAM_A, TEAM_B)).value)
  const backward = boolOf(call(() => may(state, TEAM_B, TEAM_A)).value)
  const problems = []
  if (forward !== true) problems.push("the agreed direction is not allowed (" + show(forward) + ")")
  if (backward === true) problems.push("the reverse direction is allowed from the same facts (" + show(backward) + "), so the pair is not ordered")
  console.log("      " + TEAM_A + " -> " + TEAM_B + " : " + show(forward) + "; " + TEAM_B + " -> " + TEAM_A + " : " + show(backward))
  record(4, problems.length === 0, problems.length === 0 ? "the two directions are separate facts" : problems.join(" | "))
}

// ---------------------------------------------------------------- 5 order independence + counterexample
function pairState(mod, records) {
  const { project, may, pending } = api(mod)
  if (project === null || may === null) return null
  const state = stateOf(project, records)
  return { forward: boolOf(call(() => may(state, TEAM_A, TEAM_B)).value), pending: asIds(call(() => (pending === null ? [] : pending(state, TEAM_B))).value) }
}
async function checkFive(mod) {
  const { project, may } = api(mod)
  if (project === null || may === null) { record(5, false, "the module exposes no mayExchange"); return }
  const problems = []
  const first = pairState(mod, rejected())
  const second = pairState(mod, [...rejected()].reverse())
  if (first === null || second === null) { record(5, false, "the pair state could not be read"); return }
  console.log("      arrival order as written -> " + clip(show(first), 70) + "; reversed -> " + clip(show(second), 70))
  if (show(first) !== show(second)) problems.push("the two arrival orders disagree (" + clip(show(first), 60) + " vs " + clip(show(second), 60) + ")")
  if (first.forward !== false) problems.push("the refused pair reads as permitted (" + show(first.forward) + "), so the last fact did not win")
  const tmp = mkdtempSync(join(tmpdir(), "r38-flip-"))
  try {
    const source = readFileSync(MODULE, "utf8")
    const candidates = [["left.seq - right.seq", "right.seq - left.seq"], ["right.seq - left.seq", "left.seq - right.seq"]]
    let flipped = source, used = null
    // Every fold in this module resolves by ascending seq, so the inversion is applied everywhere the
    // expression appears: whichever fold the pair reads through, first-by-seq is now the rule there.
    for (const pair of candidates) { const next = source.split(pair[0]).join(pair[1]); if (next !== source) { flipped = next; used = pair[0] + " -> " + pair[1] + " (all occurrences)"; break } }
    if (flipped === source) { record(5, false, problems.length === 0 ? "no seq comparison could be inverted in the module, so the counterexample cannot be built" : problems.join(" | ")); return }
    const copy = join(tmp, "collab-first-wins.mjs")
    writeFileSync(copy, flipped)
    const broken = await load(copy)
    const brokenState = pairState(broken, rejected())
    const noticed = brokenState === null || show(brokenState) !== show(first)
    console.log("      inverted " + clip(String(used), 36) + "; the copy reads " + clip(show(brokenState), 70))
    if (!noticed) problems.push("resolving the pair first-by-seq still produced the same state, so this gate is not measuring the last-fact rule")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  record(5, problems.length === 0, problems.length === 0 ? "the pair is order-independent and the counterexample bites" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 6 reading control
function checkSix(mod) {
  const { project } = api(mod)
  if (project === null) { record(6, false, "the module exports no projectTeamState"); return }
  const base = [{ seq: 1, writer: "w-a", instance: "i1", kind: "member/state", actor: "team-1", subject: TEAM_A, payload: { id: TEAM_A, name: TEAM_A, state: "active", role: "member" } }]
  const withFacts = [...clone(base), fact(2, TEAM_A, TEAM_B, "requested"), fact(3, TEAM_B, TEAM_A, "agreed")]
  const pick = (state, path) => path.split(".").reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), state)
  // Entities only: folded/unknown/teams/unattributed count RECORDS and move by design when records arrive.
  const scope = ["tasks", "members", "counts.tasks", "counts.members", "liveness.malformed"]
  const moved = scope.filter((path) => show(pick(project(clone(base)), path)) !== show(pick(project(clone(withFacts)), path)))
  record(6, moved.length === 0, moved.length === 0 ? "handshake facts leave every entity reading byte-identical (" + String(scope.length) + " compared; record counters excluded on purpose)" : "those facts moved " + show(moved))
}

// ---------------------------------------------------------------- 7 no regression
function checkSeven() {
  const problems = [], notes = []
  for (const gate of GATES) {
    const gatePath = join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout || "") + (run.stderr || "")).trim().replace(/\s+/g, " "), 90))
  }
  record(7, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function main() {
  if (!existsSync(MODULE)) { console.log("SKIP  no collab module at " + MODULE); process.exit(3) }
  const mod = await load(MODULE)
  if (mod === null) { console.log("SKIP  the collab module could not be imported"); process.exit(3) }
  console.log("== real (this machine) ==")
  checkOne(mod); checkTwo(mod); checkThree(mod); checkFour(mod); await checkFive(mod); checkSix(mod)
  if (SKIP_REGRESSION) {
    console.log("")
    console.log("-- 7. NOT RUN: --skip-regression was passed, so the nested gates were not re-run here")
    console.log("   (verify-all.mjs owns that sweep; the default run does execute reading 7)")
  } else checkSeven()
  const failed = results.filter((r) => !r.ok && !r.skip).map((r) => r.n)
  const skipped = results.filter((r) => r.skip).map((r) => r.n)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

await main()
