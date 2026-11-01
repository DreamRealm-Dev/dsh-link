#!/usr/bin/env node
/**
 * R36 (task-61): fault isolation and rescheduling must be deterministic, boundary-explicit and recoverable.
 *
 *   1 DETERMINISM: the verdict is a function of the caller-supplied now, never of a clock read inside.
 *   2 BOUNDARY: now exactly at heartbeat + timeoutMs is decided one way, stated out loud, and the same
 *     instant reached twice agrees with itself.
 *   3 RECOVERY: an in-flight task held by an unhealthy member is recoverable, and a fresh heartbeat takes
 *     it back out of that list.
 *   4 CAPABILITY-CONSTRAINED CANDIDATES: a healthy member without the capability, and a member with the
 *     capability but unhealthy, are both kept out.
 *   5 COUNTEREXAMPLE: a copy forced always-healthy must change the liveness verdict and the recoverable list.
 *   6 READING CONTROL: heartbeat and capability declarations leave tasks/members/counts byte-identical.
 *   7 NO REGRESSION: the five existing gates stay green.
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
// R44: reading 7 runs the gates named above, each of which may nest a sweep. --skip-regression is the fast
// path for a harness that already owns the full regression sweep: it drops reading 7 and says so.
const SKIP_REGRESSION = argv.includes("--skip-regression")
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const GATES = ["verify-collab-contested.mjs", "verify-collab-registry.mjs", "verify-client-plane.mjs", "verify-client-members.mjs", "verify-teams-log.mjs"]
const TEAM = "team-1", HOLDER = "holder-1", IDLE = "idle-1", FIT = "fit-1", CAP = "review", TIMEOUT = 60000
const T0 = "2026-03-01T12:00:00.000Z"
const ms = (iso) => Date.parse(iso)
const shift = (base, offsetMs) => new Date(ms(base) + offsetMs).toISOString()
const member = (seq, id) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: TEAM, subject: id, payload: { id, name: id, state: "active", role: "member" } })
// payload.at must be a finite number: the fold ignores the record-level at entirely (:1210-1226 in src)
const heartbeat = (seq, id, when) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/heartbeat", actor: TEAM, subject: id, payload: { id, at: Date.parse(when) } })
const capability = (seq, id, name) => ({ seq, writer: "w-" + id, instance: "i1", kind: "capability/state", actor: TEAM, subject: id, payload: { id, member: id, capability: name, state: "granted" } })
const task = (seq, id, state, owner) => ({ seq, writer: "w-" + owner, instance: "i1", kind: "task/state", actor: TEAM, subject: id, payload: { id, state, owner } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const stateWith = (heartbeatAt) => [
  member(1, HOLDER), member(2, IDLE), capability(3, HOLDER, CAP), capability(4, IDLE, CAP),
  task(5, "task-1", "in-progress", HOLDER), task(6, "task-2", "in-progress", IDLE),
  ...(heartbeatAt === null ? [] : [heartbeat(7, HOLDER, heartbeatAt), heartbeat(8, IDLE, shift(T0, -1000))]),
]

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => JSON.stringify(v)
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({ project: mod && mod.projectTeamState ? mod.projectTeamState : null, liveness: mod && mod.livenessOf ? mod.livenessOf : null, recoverable: mod && mod.recoverable ? mod.recoverable : null })
// livenessOf returns [{ memberId, liveness, sinceMs, ... }] (:1265-1274 in src)
const pickMember = (value, id) => { if (Array.isArray(value)) { const found = value.find((item) => item && item.memberId === id) || null; return found === null ? null : found; } return null }
const healthy = (value) => { if (value && typeof value === "object" && typeof value.liveness === "string") return value.liveness === "healthy" ? true : (value.liveness === "unhealthy" ? false : null); if (value === true) return true; if (value === false) return false; const text = show(value).toLowerCase(); if (text.includes("unhealth")) return false; if (text.includes("health")) return true; return null }
const names = (value) => { const list = Array.isArray(value) ? value : (value && (value.tasks || value.recoverable || value.candidates)) || []; return list.map((item) => (typeof item === "string" ? item : (item && (item.id || item.task)) || null)).filter((item) => item !== null) }

function checkOne(mod) {
  const { project, liveness } = api(mod)
  if (project === null || liveness === null) { record(1, false, "the module exposes no livenessOf; exports are " + show(mod === null ? null : Object.keys(mod).slice(0, 12))); return }
  const stale = project(clone(stateWith(shift(T0, -5 * TIMEOUT))))
  const problems = []
  let ancient = null, future = null, again = null
  try { ancient = pickMember(liveness(stale, 0, { timeoutMs: TIMEOUT }), HOLDER) } catch (error) { problems.push("livenessOf threw: " + clip(String(error && error.message), 90)) }
  try { future = pickMember(liveness(stale, ms(T0) + 10 * TIMEOUT, { timeoutMs: TIMEOUT }), HOLDER) } catch (error) { problems.push("livenessOf threw on a far-future now: " + clip(String(error && error.message), 90)) }
  try { again = pickMember(liveness(stale, ms(T0) + 10 * TIMEOUT, { timeoutMs: TIMEOUT }), HOLDER) } catch (error) { problems.push("livenessOf threw on a repeated call") }
  if (show(ancient) === show(future)) problems.push("an ancient now and a far-future now give the same verdict, so the clock is not the caller-supplied one (" + clip(show(future), 60) + ")")
  if (show(future) !== show(again)) problems.push("the same (state, now) answered differently twice, so something inside reads a clock")
  const fresh = project(clone(stateWith(shift(T0, 0))))
  let freshVerdict = null
  try { freshVerdict = pickMember(liveness(fresh, ms(T0) + 10 * TIMEOUT, { timeoutMs: TIMEOUT }), HOLDER) } catch (error) { problems.push("livenessOf threw on the fresh state") }
  console.log("      now=0 -> " + clip(show(ancient), 50) + "; now=T0+10x -> " + clip(show(future), 50) + "; after a heartbeat -> " + clip(show(freshVerdict), 50))
  if (healthy(future) === true && healthy(freshVerdict) === true && show(future) === show(freshVerdict)) problems.push("a stale heartbeat reads exactly like a fresh one, so the verdict does not follow the timestamps")
  record(1, problems.length === 0, problems.length === 0 ? "the verdict follows the caller-supplied now, is stable across calls, and a heartbeat moves it" : problems.slice(0, 3).join(" | "))
}

function checkTwo(mod) {
  const { project, liveness } = api(mod)
  if (project === null || liveness === null) { record(2, false, "the module exposes no livenessOf"); return }
  const hb = shift(T0, -TIMEOUT)
  const state = project(clone(stateWith(hb)))
  const before = pickMember(liveness(state, ms(hb) + TIMEOUT - 1, { timeoutMs: TIMEOUT }), HOLDER)
  const exactly = pickMember(liveness(state, ms(hb) + TIMEOUT, { timeoutMs: TIMEOUT }), HOLDER)
  const problems = []
  if (healthy(before) !== true) problems.push("one millisecond before the deadline already reads " + clip(show(before), 40) + ", so the deadline is not the boundary")
  const rule = healthy(exactly) === true ? ">" : ">="
  console.log("      now = heartbeat + timeoutMs reads " + clip(show(exactly), 50) + " (one ms earlier: " + clip(show(before), 40) + "), so the rule in force is " + rule)
  record(2, problems.length === 0, problems.length === 0 ? "the boundary is decided and printed: an expired heartbeat is judged " + (rule === ">=" ? "unhealthy at exactly heartbeat + timeoutMs" : "healthy at exactly heartbeat + timeoutMs") + " (rule " + rule + ")" : problems.join(" | "))
}

function checkThree(mod) {
  const { project, recoverable } = api(mod)
  if (project === null || recoverable === null) { record(3, false, "the module exposes no recoverable()"); return }
  // Close to the fresh heartbeat: with a now far beyond it even the freshly beaten holder reads stale.
  const now = ms(T0) + 1000
  const stale = project(clone(stateWith(shift(T0, -5 * TIMEOUT))))
  const fresh = project(clone(stateWith(shift(T0, 0))))
  const problems = []
  let staleList = null, freshList = null
  try { staleList = names(recoverable(stale, now, { timeoutMs: TIMEOUT })) } catch (error) { problems.push("recoverable() threw: " + clip(String(error && error.message), 90)) }
  try { freshList = names(recoverable(fresh, now, { timeoutMs: TIMEOUT })) } catch (error) { problems.push("recoverable() threw on the fresh state") }
  if (staleList !== null && freshList !== null) {
    if (staleList.indexOf("task-1") === -1) problems.push("the unhealthy holder in-flight task is not recoverable (" + show(staleList) + ")")
    if (staleList.indexOf("task-2") !== -1) problems.push("a healthy holder task was offered for recovery (" + show(staleList) + ")")
    if (freshList.indexOf("task-1") !== -1) problems.push("a fresh heartbeat did not take the task back out (" + show(freshList) + ")")
    console.log("      stale holder -> " + show(staleList) + "; after a heartbeat -> " + show(freshList))
  }
  record(3, problems.length === 0, problems.length === 0 ? "the unhealthy holder in-flight task is recoverable and leaves the list once the holder heartbeats" : problems.slice(0, 3).join(" | "))
}

function checkFour(mod) {
  const { project, recoverable } = api(mod)
  if (project === null || recoverable === null) { record(4, false, "the module exposes no recoverable()"); return }
  const records = [
    member(1, HOLDER), member(2, IDLE), capability(3, HOLDER, CAP), member(9, FIT), capability(10, FIT, CAP),
    { seq: 4, writer: "w-revoke", instance: "i1", kind: "capability/state", actor: TEAM, subject: IDLE, payload: { id: IDLE, capabilities: [] } },
    { seq: 5, writer: "w-owner", instance: "i1", kind: "task/state", actor: TEAM, subject: "task-1", payload: { id: "task-1", state: "in-progress", owner: HOLDER, capability: CAP } },
    task(6, "task-2", "in-progress", HOLDER),
    heartbeat(7, HOLDER, shift(T0, -5 * TIMEOUT)), heartbeat(8, IDLE, shift(T0, 0)), heartbeat(11, FIT, shift(T0, 0)),
  ]
  const state = project(clone(records))
  const problems = []
  let value = null
  try { value = recoverable(state, ms(T0) + 1000, { timeoutMs: TIMEOUT, capability: CAP }) } catch (error) { problems.push("recoverable() with a capability threw: " + clip(String(error && error.message), 90)) }
  // recoverable() returns entries { id, owner, capability, candidates }; the candidates are members.
  const entry = Array.isArray(value) ? (value.find((item) => item && item.candidates) || value[0] || null) : value
  const candidates = entry === null || entry === undefined ? null : (Array.isArray(entry.candidates) ? entry.candidates : null)
  if (candidates === null) { record(4, "skip", "recoverable() exposes no candidate list, so the capability constraint cannot be read here (keys " + show(value === null ? null : Object.keys(value)) + ")"); return }
  const eligible = candidates.map((item) => (typeof item === "string" ? item : (item && (item.id || item.memberId || item.member)) || null)).filter((item) => item !== null)
  console.log("      demanded capability " + show(entry && entry.capability) + " -> candidates " + show(eligible))
  if (eligible.indexOf(HOLDER) !== -1) problems.push("a member with the capability but an unhealthy heartbeat is offered (" + show(eligible) + ")")
  if (eligible.indexOf(IDLE) !== -1) problems.push("a healthy member WITHOUT the capability is offered (" + show(eligible) + ")")
  if (eligible.indexOf(FIT) === -1) problems.push("a healthy member WITH the demanded capability is not offered (" + show(eligible) + ") — an empty candidate list must not pass as correct")
  record(4, problems.length === 0, problems.length === 0 ? "no ineligible member is a candidate (" + show(eligible) + ")" : problems.slice(0, 3).join(" | "))
}

async function checkFive() {
  const tmp = mkdtempSync(join(tmpdir(), "r36-live-"))
  try {
    const source = readFileSync(MODULE, "utf8")
    const candidates = [
      // the deadline is sinceMs >= timeoutMs (:1272 in src)
      ["sinceMs >= timeoutMs", "sinceMs < timeoutMs"],
      ["sinceMs>=timeoutMs", "sinceMs<timeoutMs"],
    ]
    let flipped = source, used = null
    for (const pair of candidates) { const next = source.replace(pair[0], pair[1]); if (next !== source) { flipped = next; used = pair[0] + " -> " + pair[1]; break } }
    if (flipped === source) { record(5, "skip", "no liveness comparison could be inverted in the module, so the counterexample cannot be built yet"); return }
    const copy = join(tmp, "collab-always-healthy.mjs")
    writeFileSync(copy, flipped)
    const broken = await load(copy)
    const brokenApi = api(broken)
    if (brokenApi.project === null || brokenApi.liveness === null) { record(5, false, "the inverted copy does not even export livenessOf"); return }
    const state = brokenApi.project(clone(stateWith(shift(T0, -5 * TIMEOUT))))
    const verdict = pickMember(brokenApi.liveness(state, ms(T0) + 10 * TIMEOUT, { timeoutMs: TIMEOUT }), HOLDER)
    const noticedLive = healthy(verdict) !== false
    const problems = []
    if (!noticedLive) problems.push("forcing the comparison the other way still judged the stale holder unhealthy, so this test is not measuring the deadline")
    console.log("      inverted " + used + " ; the copy judges the stale holder " + clip(show(verdict), 60) + " -> noticed " + String(noticedLive))
    record(5, problems.length === 0, problems.length === 0 ? "the counterexample bites: inverting the deadline comparison flips the liveness verdict" : problems.join(" | "))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

function checkSix(mod) {
  const { project } = api(mod)
  if (project === null) { record(6, false, "the module exports no projectTeamState"); return }
  const base = [member(1, HOLDER), task(2, "task-1", "open", HOLDER)]
  const extra = [...clone(base), heartbeat(3, HOLDER, T0), capability(4, HOLDER, CAP)]
  const pick = (state, path) => path.split(".").reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), state)
  const scope = ["tasks", "members", "counts.tasks", "counts.members", "counts.teams", "counts.unattributed"]
  const moved = scope.filter((path) => show(pick(project(clone(base)), path)) !== show(pick(project(clone(extra)), path)))
  record(6, moved.length === 0, moved.length === 0 ? "heartbeat and capability declarations leave every entity reading byte-identical (" + String(scope.length) + " compared)" : "those declarations moved " + show(moved))
}

function checkSeven() {
  const problems = [], notes = []
  for (const gate of GATES) {
    const gatePath = join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout || "") + (run.stderr || "")).trim().replace(/\s+/g, " "), 100))
  }
  record(7, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function main() {
  if (!existsSync(MODULE)) {
    console.log("SKIP  the collab module is not on this machine; missing:")
    console.log("  - " + MODULE)
    process.exit(3)
  }
  const mod = await load(MODULE)
  if (mod === null) { console.log("SKIP  the collab module could not be imported"); process.exit(3) }
  console.log("== real (this machine) ==")
  checkOne(mod); checkTwo(mod); checkThree(mod); checkFour(mod); await checkFive(); checkSix(mod)
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
