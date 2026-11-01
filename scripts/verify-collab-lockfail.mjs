#!/usr/bin/env node
/**
 * R40 (task-73): a dead holder must not keep a task out of rescheduling, and the two answers that decide
 * that — recoverable() and claimable() — must not contradict each other (R39 critic A6).
 *
 * Expected values in every reading below are computed from the graph and the clock passed in, not read off
 * the implementation. Contract: .tmp/r40-contract.md.
 *
 *   1 the critic counterexample, flipped: an unhealthy holder with a LIVE lock -> recoverable hands the
 *     task over with heldLocks=[key] and reclaimable=true, and claimable answers ready with reclaimedFrom=dead
 *   2 a HEALTHY holder live lock -> reclaimable=false, claimable locked, reclaimedFrom null
 *   3 a member that never heartbeated (liveness unknown) holding a lock -> holderUnhealthy false, not reclaimable
 *   4 never locked -> lastHolder null, reclaimable false; heldLocks [] with a ttl, null without (null != [])
 *   5 dead holder but nothing to hand out (done / removed / blocked / unreachable) -> that reason, not reclaimable
 *   6 boundaries: now - lastHeartbeat == timeoutMs is unhealthy, now - at == ttlMs is expired (both >=)
 *   7 additive defaults: without timeoutMs / ttlMs the readings are the old ones (locked, heldLocks null)
 *   8 --self-attack: each mutant reddens only its own reading, including "unhealthy relaxed to unhealthy+unknown"
 *     and "reclaimable drops the reason criterion"
 *   9 regression: the R39 board gate (19/19) and the nine other gates
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). Red readings are held until task-72 lands.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
// R44: reading 9 runs ten more gates, which nest sweeps of their own (measured 282.4s for this file).
// --skip-regression is the fast path for a harness that already owns the full regression sweep.
const SKIP_REGRESSION = argv.includes("--skip-regression")
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const SELF_ATTACK = argv.includes("--self-attack")
// HEAD's R39 bundle, extracted by the Lead (git show HEAD:... 52894 bytes). Read-only: this gate never writes it.
const BEFORE = resolve(option("--before", join(PROJECT, ".tmp", "lib-r39-before.mjs")))
const GATES = ["verify-collab-board.mjs", "verify-collab-failover.mjs", "verify-collab-registry.mjs", "verify-collab-handshake.mjs", "verify-collab-fractal.mjs", "verify-collab-contested.mjs", "verify-collab-multihop.mjs", "verify-teams-log.mjs", "verify-collab-relay.mjs", "verify-collab-relay-http.mjs"]
const TEAM = "team-1"
const NOW = 1_800_000_000_000
const TTL = 600_000
const TIMEOUT = 60_000
const MEMBER = (seq, id) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: TEAM, subject: id, payload: { id, name: id, state: "active", role: "member" } })
const BEAT = (seq, id, atMs) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/heartbeat", actor: TEAM, subject: id, payload: { id, at: atMs } })
const TASK = (seq, team, id, state, owner) => ({ seq, writer: "w-" + id, instance: "i1", kind: "task/state", actor: team, subject: id, payload: { id, state, owner } })
const LOCK = (seq, team, id, holder, at) => ({ seq, writer: "w-" + id, instance: "i1", kind: "lock/state", actor: team, subject: id, payload: { task: id, holder, at, team } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({ project: mod.projectTeamState ?? null, claimable: mod.claimable ?? null, reclaimable: mod.reclaimable ?? null, recoverable: mod.recoverable ?? null, lockHolder: mod.lockHolder ?? null, boardKey: mod.boardKey ?? null })
const keyOf = (mod, team, id) => (typeof mod.boardKey === "function" ? mod.boardKey(team, id) : (team ?? "") + String.fromCharCode(0) + id)
const missingApi = (a) => ["projectTeamState", "claimable", "reclaimable", "recoverable"].filter((name) => a[name === "projectTeamState" ? "project" : name] === null)

// ---------------------------------------------------------------- 1 the critic counterexample, flipped
function checkOne(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(1, false, "the module exposes no " + missingApi(a).join(", ") + " — task-72 has not landed"); return }
  const key = keyOf(mod, TEAM, "T4")
  const records = [MEMBER(1, "m2"), TASK(2, TEAM, "T4", "pending", "m2"), LOCK(3, TEAM, "T4", "m2", NOW - 1000), BEAT(4, "m2", NOW - 5 * TIMEOUT)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.holder !== "m2") problems.push("holder is " + show(reading.holder) + ", expected the dead holder m2")
  if (reading.holderUnhealthy !== true) problems.push("holderUnhealthy is " + show(reading.holderUnhealthy) + " for a holder five timeouts stale")
  if (reading.expired !== false) problems.push("a lock one second old is reported expired")
  if (reading.reason !== "ready") problems.push("reason without the lock is " + show(reading.reason) + ", expected ready")
  if (reading.reclaimable !== true) problems.push("reclaimable is " + show(reading.reclaimable) + " for an unhealthy holder with a live lock")
  const verdict = a.claimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (verdict.ok !== true || verdict.reason !== "ready") problems.push("claimable answers " + show({ ok: verdict.ok, reason: verdict.reason }) + ", expected ready")
  if (verdict.reclaimedFrom !== "m2") problems.push("reclaimedFrom is " + show(verdict.reclaimedFrom) + ", expected m2")
  if (verdict.holder !== "m2") problems.push("claimable no longer reports who holds the lock (" + show(verdict.holder) + ")")
  const handed = a.recoverable(state, NOW, { timeoutMs: TIMEOUT, ttlMs: TTL })
  const task = (handed || []).find((entry) => entry.id === "T4") || null
  if (task === null) problems.push("recoverable did not hand T4 over at all")
  else {
    if (show(task.heldLocks) !== show([key])) problems.push("heldLocks is " + show(task.heldLocks) + ", expected [" + key + "]")
    if (task.lockReclaimable !== true) problems.push("the handed-over task reads lockReclaimable " + show(task.lockReclaimable) + " (ruling 2 renames the RecoverableTask field)")
  }
  console.log("      reclaimable -> " + clip(show(reading), 150))
  console.log("      claimable -> " + clip(show(verdict), 120) + "; recoverable T4 -> " + clip(show(task), 120))
  record(1, problems.length === 0, problems.length === 0 ? "the A6 contradiction is gone: the dead holder lock is reclaimable and claimable agrees with recoverable" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 2 a healthy holder still holds
function checkTwo(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(2, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T5")
  const records = [MEMBER(1, "m9"), TASK(2, TEAM, "T5", "pending", "m9"), LOCK(3, TEAM, "T5", "m9", NOW - 1000), BEAT(4, "m9", NOW - 1000)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.holderUnhealthy !== false) problems.push("a holder that beat one second ago is called unhealthy")
  if (reading.reclaimable !== false) problems.push("a healthy holder lock is reclaimable")
  const verdict = a.claimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (verdict.reason !== "locked" || verdict.ok !== false) problems.push("claimable answers " + show({ ok: verdict.ok, reason: verdict.reason }) + ", expected locked")
  if (verdict.reclaimedFrom !== null) problems.push("reclaimedFrom is " + show(verdict.reclaimedFrom) + " although the holder is healthy")
  console.log("      healthy holder -> reclaimable " + show(reading.reclaimable) + "; claimable " + clip(show(verdict), 100))
  record(2, problems.length === 0, problems.length === 0 ? "a healthy holder lock still blocks the claim" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 3 silence is not death
function checkThree(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(3, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T6")
  const records = [MEMBER(1, "mSilent"), TASK(2, TEAM, "T6", "pending", "mSilent"), LOCK(3, TEAM, "T6", "mSilent", NOW - 1000)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.holderUnhealthy !== false) problems.push("a member that NEVER heartbeated is called unhealthy (" + show(reading.holderUnhealthy) + ") — silence is not death")
  if (reading.reclaimable !== false) problems.push("a never-beaten holder lock is reclaimable")
  const verdict = a.claimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (verdict.reason !== "locked") problems.push("claimable answered " + show(verdict.reason) + " for a live lock held by a silent member")
  console.log("      never heartbeated -> holderUnhealthy " + show(reading.holderUnhealthy) + "; reclaimable " + show(reading.reclaimable))
  record(3, problems.length === 0, problems.length === 0 ? "a member whose liveness is unknown is not treated as dead" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 4 never locked, and null != []
function checkFour(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(4, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T7")
  // The owner must be stale AND the task eligible, or recoverable never lists it and heldLocks is unreadable;
  // nothing ever locks it, which is the reading.
  const records = [MEMBER(1, "m1"), TASK(2, TEAM, "T7", "in-progress", "m1"), BEAT(3, "m1", NOW - 5 * TIMEOUT)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.lastHolder !== null) problems.push("lastHolder is " + show(reading.lastHolder) + " although nothing ever locked this task")
  if (reading.reclaimable !== false) problems.push("a task that was never locked is reclaimable")
  const withTtl = a.recoverable(state, NOW, { timeoutMs: TIMEOUT, ttlMs: TTL })
  const withoutTtl = a.recoverable(state, NOW, { timeoutMs: TIMEOUT })
  const withEntry = (withTtl || []).find((entry) => entry.id === "T7") || null
  const withoutEntry = (withoutTtl || []).find((entry) => entry.id === "T7") || null
  if (withEntry === null || withoutEntry === null) problems.push("recoverable did not list T7 in one of the two modes")
  else {
    if (show(withEntry.heldLocks) !== show([])) problems.push("with a ttl heldLocks is " + show(withEntry.heldLocks) + ", expected [] (looked, none)")
    if (withoutEntry.heldLocks !== null) problems.push("without a ttl heldLocks is " + show(withoutEntry.heldLocks) + ", expected null (not looked) — null must not look like []")
  }
  console.log("      never locked -> lastHolder " + show(reading.lastHolder) + "; heldLocks with ttl " + show(withEntry && withEntry.heldLocks) + ", without ttl " + show(withoutEntry && withoutEntry.heldLocks))
  record(4, problems.length === 0, problems.length === 0 ? "never locked is not reclaimable, and heldLocks tells looked-none from not-looked" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 5 dead holder, but nothing to hand out
function checkFive(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(5, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const problems = []
  const seen = []
  const cases = [
    ["done", [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), TASK(3, TEAM, "T8", "completed", "m2"), LOCK(4, TEAM, "T8", "m2", NOW - 1000)], "done"],
    ["removed", [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), TASK(3, TEAM, "T8", "deleted", "m2"), LOCK(4, TEAM, "T8", "m2", NOW - 1000)], "removed"],
    ["blocked", [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), TASK(3, TEAM, "T8", "pending", "m2"), TASK(4, TEAM, "dep1", "in_progress", "m2"), { ...TASK(5, TEAM, "T8", "pending", "m2"), payload: { id: "T8", state: "pending", owner: "m2", deps: ["dep1"] } }, LOCK(6, TEAM, "T8", "m2", NOW - 1000)], "blocked"],
    ["unreachable", [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), { ...TASK(3, TEAM, "T8", "pending", "m2"), payload: { id: "T8", state: "pending", owner: "m2", deps: ["gone"] } }, TASK(4, TEAM, "gone", "deleted", "m2"), LOCK(5, TEAM, "T8", "m2", NOW - 1000)], "unreachable"],
  ]
  for (const [name, records, expected] of cases) {
    const key = keyOf(mod, TEAM, "T8")
    const state = a.project(clone(records))
    const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
    seen.push(name + " -> reason " + show(reading.reason) + ", reclaimable " + show(reading.reclaimable))
    if (reading.reason !== expected) problems.push(name + ": reason is " + show(reading.reason) + ", expected " + show(expected))
    if (reading.reclaimable !== false) problems.push(name + ": reclaimable is " + show(reading.reclaimable) + " although there is nothing to hand out")
    const verdict = a.claimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
    if (verdict.ok !== false || verdict.reclaimedFrom !== null) problems.push(name + ": claimable answers " + show({ ok: verdict.ok, reason: verdict.reason, reclaimedFrom: verdict.reclaimedFrom }))
  }
  console.log("      " + seen.join("; "))
  record(5, problems.length === 0, problems.length === 0 ? "a reclaimable lock on a task that is done, removed, blocked or unreachable is still not handed out" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 6 the two boundaries, exactly
function checkSix(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(6, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const problems = []
  const seen = []
  for (const [name, offset, expectUnhealthy] of [["exactly timeout", TIMEOUT, true], ["one ms inside", TIMEOUT - 1, false]]) {
    const key = keyOf(mod, TEAM, "T9")
    const records = [MEMBER(1, "m2"), BEAT(2, "m2", NOW - offset), TASK(3, TEAM, "T9", "pending", "m2"), LOCK(4, TEAM, "T9", "m2", NOW - 1000)]
    const reading = a.reclaimable(a.project(clone(records)), key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
    seen.push(name + " -> unhealthy " + show(reading.holderUnhealthy))
    if (reading.holderUnhealthy !== expectUnhealthy) problems.push(name + ": holderUnhealthy is " + show(reading.holderUnhealthy) + ", expected " + show(expectUnhealthy))
  }
  for (const [name, offset, expectExpired] of [["ttl exactly", TTL, true], ["ttl one ms inside", TTL - 1, false]]) {
    const key = keyOf(mod, TEAM, "T10")
    const records = [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 1000), TASK(3, TEAM, "T10", "pending", "m2"), LOCK(4, TEAM, "T10", "m2", NOW - offset)]
    const reading = a.reclaimable(a.project(clone(records)), key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
    seen.push(name + " -> expired " + show(reading.expired))
    if (reading.expired !== expectExpired) problems.push(name + ": expired is " + show(reading.expired) + ", expected " + show(expectExpired))
  }
  console.log("      " + seen.join("; "))
  record(6, problems.length === 0, problems.length === 0 ? "both thresholds are >= : exactly at the mark counts, one ms inside does not" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 7 additive: measured against HEAD, not inferred
async function checkSeven(mod) {
  const a = api(mod)
  const before = existsSync(BEFORE) ? await load(BEFORE) : null
  if (before === null || typeof before.projectTeamState !== "function" || typeof before.claimable !== "function") { record(7, "skip", "no usable HEAD bundle at " + BEFORE + ", so the additive comparison cannot be measured"); return }
  if (a.project === null || a.claimable === null || a.recoverable === null) { record(7, false, "the new bundle exposes no projectTeamState/claimable/recoverable"); return }
  const key = keyOf(mod, TEAM, "T11")
  const oldKey = typeof before.boardKey === "function" ? before.boardKey(TEAM, "T11") : key
  // The A6 fixture: owner m2 is five timeouts stale and holds a live lock on its in-progress task.
  const records = [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), TASK(3, TEAM, "T11", "in-progress", "m2"), LOCK(4, TEAM, "T11", "m2", NOW - 1000)]
  const stateNew = a.project(clone(records))
  const stateOld = before.projectTeamState(clone(records))
  const common = (v) => ({ ok: v.ok, reason: v.reason, holder: v.holder, blockers: v.blockers })
  const fields = (entry) => ({ id: entry.id, owner: entry.owner, capability: entry.capability, candidates: entry.candidates })
  const problems = []
  const bareNew = common(a.claimable(stateNew, key, NOW, { ttlMs: TTL }))
  const bareOld = common(before.claimable(stateOld, oldKey, NOW, { ttlMs: TTL }))
  if (show(bareNew) !== show(bareOld)) problems.push("default claimable changed: new " + show(bareNew) + " vs HEAD " + show(bareOld))
  if (bareNew.reason !== "locked") problems.push("without timeoutMs claimable answers " + show(bareNew.reason) + ", expected the pre-change locked")
  // Ruling 1: reclaimedFrom is always present, null by default. The HEAD bundle has no such key at all,
  // so its absence on the old side is named rather than compared.
  if (!("reclaimedFrom" in a.claimable(stateNew, key, NOW, { ttlMs: TTL }))) problems.push("claimable no longer returns reclaimedFrom at all (ruling 1: it must always be there, null when unused)")
  else if (a.claimable(stateNew, key, NOW, { ttlMs: TTL }).reclaimedFrom !== null) problems.push("reclaimedFrom is " + show(a.claimable(stateNew, key, NOW, { ttlMs: TTL }).reclaimedFrom) + " by default, expected null")
  const reNew = (a.recoverable(stateNew, NOW, { timeoutMs: TIMEOUT }) || []).map(fields)
  const reOld = (before.recoverable(stateOld, NOW, { timeoutMs: TIMEOUT }) || []).map(fields)
  if (show(reNew) !== show(reOld)) problems.push("default recoverable changed: new " + clip(show(reNew), 90) + " vs HEAD " + clip(show(reOld), 90))
  const oldVerdict = before.claimable(stateOld, oldKey, NOW, { ttlMs: TTL })
  const oldEntry = (before.recoverable(stateOld, NOW, { timeoutMs: TIMEOUT }) || [])[0] || null
  const newVerdict = a.claimable(stateNew, key, NOW, { ttlMs: TTL })
  const newEntry = (a.recoverable(stateNew, NOW, { timeoutMs: TIMEOUT }) || [])[0] || null
  console.log("      HEAD bundle: claimable " + clip(show(common(oldVerdict)), 80) + "; reclaimedFrom " + show(oldVerdict.reclaimedFrom) + ", heldLocks " + show(oldEntry === null ? null : oldEntry.heldLocks) + " (absent by construction)")
  console.log("      new bundle : claimable " + clip(show(common(newVerdict)), 80) + "; reclaimedFrom " + show(newVerdict.reclaimedFrom) + ", heldLocks " + show(newEntry === null ? null : newEntry.heldLocks))
  console.log("      compared: claimable ok/reason/holder/blockers, recoverable id/owner/capability/candidates — the new fields are named, not compared, because HEAD has no such fields")
  record(7, problems.length === 0, problems.length === 0 ? "measured against HEAD: the default readings are byte-identical on every common field, so the change is additive" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 10 unknown holder: the lock is visible, the task is not takeable
function checkTen(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(10, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T12")
  // mSilent never heartbeated, so its liveness is unknown; it holds a live lock on its own in-progress task.
  const records = [MEMBER(1, "mSilent"), TASK(2, TEAM, "T12", "in-progress", "mSilent"), LOCK(3, TEAM, "T12", "mSilent", NOW - 1000)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.holderUnhealthy !== false) problems.push("the silent holder is called unhealthy (" + show(reading.holderUnhealthy) + ")")
  if (reading.reclaimable !== false) problems.push("reclaimable() offers to take a task whose holder is merely silent (" + show(reading.reclaimable) + ")")
  const handed = a.recoverable(state, NOW, { timeoutMs: TIMEOUT, ttlMs: TTL })
  const task = (handed || []).find((entry) => entry.id === "T12") || null
  if (task === null) problems.push("recoverable did not list T12 at all, so heldLocks cannot be read")
  else {
    if (show(task.heldLocks) !== show([key])) problems.push("heldLocks is " + show(task.heldLocks) + ", expected [" + key + "] — the lock is visible even when it is not reclaimable")
    if (task.lockReclaimable !== false) problems.push("RecoverableTask.lockReclaimable is " + show(task.lockReclaimable) + " for a silent holder")
  }
  console.log("      unknown holder -> " + clip(show(reading), 130) + "; recoverable T12 -> " + clip(show(task), 130))
  record(10, problems.length === 0, problems.length === 0 ? "a never-heartbeated holder keeps the lock visible and non-reclaimable: heldLocks names it, reclaimable stays false" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 11 an expired lock is reclaimable even with the holder healthy
function checkEleven(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(11, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T13")
  // m3 beat one second ago (healthy) and its lock is exactly at the ttl: expiry alone must make it takeable.
  const records = [MEMBER(1, "m3"), BEAT(2, "m3", NOW - 1000), TASK(3, TEAM, "T13", "in-progress", "m3"), LOCK(4, TEAM, "T13", "m3", NOW - TTL)]
  const state = a.project(clone(records))
  const problems = []
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.holderUnhealthy !== false) problems.push("a holder that beat one second ago is called unhealthy")
  if (reading.expired !== true) problems.push("a lock exactly at the ttl is not expired (" + show(reading.expired) + ")")
  if (reading.reclaimable !== true) problems.push("reclaimable() does not take an expired lock with a healthy holder (" + show(reading.reclaimable) + ")")
  const verdict = a.claimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (verdict.ok !== true || verdict.reason !== "ready") problems.push("claimable answers " + show({ ok: verdict.ok, reason: verdict.reason }) + " for an expired lock")
  console.log("      expired lock, healthy holder -> " + clip(show(reading), 130) + "; claimable " + clip(show({ ok: verdict.ok, reason: verdict.reason, holder: verdict.holder, reclaimedFrom: verdict.reclaimedFrom }), 90))
  record(11, problems.length === 0, problems.length === 0 ? "expiry alone makes a locked task takeable, and both readings agree" : problems.slice(0, 3).join(" | "))
}
// ---------------------------------------------------------------- 12 the two questions are different on a blocked task
function checkTwelve(mod) {
  const a = api(mod)
  if (missingApi(a).length > 0) { record(12, false, "the module exposes no " + missingApi(a).join(", ")); return }
  const key = keyOf(mod, TEAM, "T5")
  // m2 is stale and holds a live lock on T5, but T5 waits on dep1: the lock IS takeable, the task is NOT handable.
  const records = [MEMBER(1, "m2"), BEAT(2, "m2", NOW - 5 * TIMEOUT), TASK(3, TEAM, "dep1", "in_progress", "m2"), { ...TASK(4, TEAM, "T5", "pending", "m2"), payload: { id: "T5", state: "pending", owner: "m2", deps: ["dep1"] } }, LOCK(5, TEAM, "T5", "m2", NOW - 1000)]
  const state = a.project(clone(records))
  const problems = []
  // NOT an invariant: a general rule heldLocks non-empty => lockReclaimable === reclaimable().reclaimable is wrong here.
  const reading = a.reclaimable(state, key, NOW, { ttlMs: TTL, timeoutMs: TIMEOUT })
  if (reading.reason !== "blocked") problems.push("reason is " + show(reading.reason) + ", expected blocked")
  if (reading.reclaimable !== false) problems.push("reclaimable() offers a task that is blocked (" + show(reading.reclaimable) + ")")
  const handed = a.recoverable(state, NOW, { timeoutMs: TIMEOUT, ttlMs: TTL })
  const task = (handed || []).find((entry) => entry.id === "T5") || null
  if (task === null) problems.push("recoverable did not list T5, so lockReclaimable cannot be read")
  else {
    if (show(task.heldLocks) !== show([key])) problems.push("heldLocks is " + show(task.heldLocks) + ", expected [" + key + "]")
    if (task.lockReclaimable !== true) problems.push("lockReclaimable is " + show(task.lockReclaimable) + " although the lock can be taken now")
  }
  console.log("      blocked task with a takeable lock -> reclaimable() " + clip(show({ reason: reading.reason, reclaimable: reading.reclaimable }), 70) + "; RecoverableTask lockReclaimable " + show(task === null ? null : task.lockReclaimable) + " — two different questions, recorded as a reading")
  record(12, problems.length === 0, problems.length === 0 ? "on a blocked task the lock is takeable while the task is not handable: lockReclaimable true, reclaimable() false" : problems.slice(0, 3).join(" | "))
}
// ---------------------------------------------------------------- 9 regression
function checkNine(gates) {
  const problems = [], notes = []
  for (const gate of gates) {
    const gatePath = isAbsolute(gate) ? gate : join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate.replace("verify-", "").replace(".mjs", "") + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout || "") + (run.stderr || "")).trim().replace(/\s+/g, " "), 90))
  }
  record(9, problems.length === 0, problems.length === 0 ? notes.join(", ") : problems.join(" | "))
}

async function runAll(modulePath, gates) {
  results.length = 0
  const mod = await load(modulePath)
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [10, checkTen], [11, checkEleven], [12, checkTwelve]]
  for (const entry of sequence) {
    try { await entry[1](mod === null ? {} : mod) } catch (error) { record(entry[0], false, "the reading threw: " + clip(String((error && error.message) || error), 120)) }
  }
  if (SKIP_REGRESSION) {
    console.log("")
    console.log("-- 9. NOT RUN: --skip-regression was passed, so the ten other gates were not re-run here")
    console.log("   (verify-all.mjs owns that sweep; the default run does execute reading 9)")
  } else {
    checkNine(gates === undefined ? GATES : gates)
  }
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

const MUTATIONS = [
  // Each entry declares the readings its mutation is PREDICTED to change, with the reason. Set equality is
  // required: an extra red outside the declared set fails, and a missing expected red fails. Reading 9
  // (the regression probe) is excluded by construction.
  // loosening the unhealthy test touches exactly the two readings that pin it: 3 (unknown is not dead) and 10 (unknown holder).
  ["unhealthy relaxed to unhealthy+unknown", "=== \"unhealthy\"", "!== \"healthy\"", [3, 10]],
  // dropping the reason criterion makes every takeable lock look handable, which is what 1-5 and 10-12 measure.
  ["reclaimable drops the reason criterion", "reason === \"ready\" &&", "true &&", [1, 2, 3, 4, 5, 10, 11, 12]],
  // heldLocks null -> [] is exactly the null != [] reading.
  ["heldLocks null becomes [] (lib:833)", "ttlMs === void 0 ? null :", "ttlMs === void 0 ? [] :", [4]],
  // Ignoring timeoutMs removes the reclaim path (1, 4, 6, 12) and also blanks liveness for recoverable, which
  // reading 7 compares against the HEAD bundle — so 7 is in this class too, and the first run proved it.
  ["claimable ignores timeoutMs", "options.timeoutMs", "undefined", [1, 4, 6, 7, 12]],
  // relaxing the lock ttl boundary changes 6 (the >= pair) and 11 (expiry alone).
  ["ttl boundary relaxed to >", "sinceMs >= options.ttlMs", "sinceMs > options.ttlMs", [6, 11]],
]

async function selfAttack() {
  const tmp = mkdtempSync(join(tmpdir(), "r40-attack-"))
  try {
    const source = readFileSync(MODULE, "utf8")
    const failing = join(tmp, "gate-that-fails.mjs")
    writeFileSync(failing, "process.exit(1)\n")
    const lines = []
    const rows = []
    let localised = 0
    let applied = 0
    for (const [name, from, to, declaredRaw] of MUTATIONS) {
      const expected = declaredRaw
      const flipped = source.split(from).join(to)
      if (flipped === source) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(from) + " in the bundle)"); continue }
      applied += 1
      const copy = join(tmp, "mutant-" + String(expected) + "-" + String(applied) + ".mjs")
      writeFileSync(copy, flipped)
      const seen = await runAll(copy, [failing])
      const declared = (Array.isArray(expected) ? expected : [expected]).slice().sort((l, r) => l - r)
      const observed = seen.failed.filter((n) => n !== 9).slice().sort((l, r) => l - r)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push("  " + name + " -> declared " + show(declared) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
      rows.push({ name, declared, clean })
    }
    console.log("== mutations: each mutant must redden exactly its declared set ==")
    console.log(lines.join("\n"))
    console.log("")
    // Coverage matrix: every reading must be claimed by at least one mutant, or that reading has no guard.
    // Reading 9 (the regression sweep) is covered by the synthetic failing-gate run below, by construction.
    const READINGS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]
    const matrix = READINGS.map((n) => n + ": " + (n === 9 ? "regression probe (synthetic failing gate)" : (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED")))
    const uncovered = READINGS.filter((n) => n !== 9 && rows.every((r) => r.declared.indexOf(n) === -1))
    console.log("")
    console.log("coverage matrix (reading -> mutants that claim it):")
    for (const line of matrix) console.log("  " + line)
    if (uncovered.length > 0) console.log("  UNCOVERED READINGS: " + show(uncovered))
    console.log("")
    console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(localised) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
    process.exit(applied === MUTATIONS.length && localised === applied && uncovered.length === 0 ? 0 : 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  if (!existsSync(MODULE)) { console.log("SKIP  no collab module at " + MODULE); process.exit(3) }
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll(MODULE)
  console.log("")
  console.log(String(results.length) + " readings, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
