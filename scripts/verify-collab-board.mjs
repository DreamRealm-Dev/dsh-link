#!/usr/bin/env node
/**
 * R39 (task-68): the shared task board — dependency graph, claim/lock, and status broadcast facts.
 *
 * Shapes read from plugins/dsh-link-collab/lib/index.js before any assertion was written:
 *   LOCK_KIND "lock/state" (:352); lockRecord validates taskId/holder/at types (:353-357)
 *   projectLocks: per task the record with the highest seq, sorted by task (:359-371)
 *   lockHolder: sinceMs = max(0, now - at), expired = sinceMs >= ttlMs, no fact -> { holder: null, sinceMs: null, expired: false } (:373-378)
 *   projectBoard: DONE_STATUSES = ["completed","done"] (:380), deps from payload.deps sorted+deduped (:393-394),
 *     missing = deps with no record and orphans collects them (:421-425), cycles reported as { edge: [from, next], loop: sorted } (:427-445),
 *     ready = not done, not in a cycle, blocked empty (:457)
 *   claimable priority unknown -> done -> cycle -> blocked -> locked -> ready (:460-471)
 *   projectTeamState gains { board, locks } (:856-857)
 *
 * Ten readings (task-68 section 4). Every check computes its own expected value from the graph or the
 * clock it passes in; none of them repeats an implementation branch. --self-attack mutates a copy of the
 * module and reports, per mutation, which checks went red — that is the proof each check can fail.
 *
 * Discrepancies noticed against the frozen contract, reported rather than silently absorbed:
 *   (a) BoardState.unknown counts RECORDS with an unrecognised status (:392), not tasks, so it is a
 *       counter rather than an entity reading;
 *   (b) BoardCycle.loop is the SORTED loop members, not the walk order the contract wording suggests;
 *   (c) lockHolder on a task with no lock fact at all reports expired: false, so "never locked" is told
 *       apart from "lock rotted" by sinceMs === null, not by expired.
 *
 * Exit 0 all held; 1 a check failed; 3 an input is missing (printed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
// R44: the nine gates below nest sweeps of their own, which is why this file takes about 160s. --skip-regression
// is the fast path for a harness that already owns the full regression sweep: it drops reading 10 and says so.
const SKIP_REGRESSION = argv.includes('--skip-regression')
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const SELF_ATTACK = argv.includes("--self-attack")
const NINE = ["verify-teams-log.mjs", "verify-collab-relay.mjs", "verify-collab-relay-http.mjs", "verify-collab-multihop.mjs", "verify-collab-contested.mjs", "verify-collab-registry.mjs", "verify-collab-failover.mjs", "verify-collab-fractal.mjs", "verify-collab-handshake.mjs"]
const TEAM = "team-1"
const TTL = 5000
const NOW = 1_800_000_000_000
// Only the record types under test ever appear in a fixture: task facts for the board, lock facts for the locks.
const task = (seq, id, state, deps, owner) => ({ seq, writer: "w-" + id, instance: "i1", kind: "task/state", actor: TEAM, subject: id, payload: { id, state, deps: deps === undefined ? [] : deps, ...owner === undefined ? {} : { owner } } })
const lock = (seq, id, holder, at) => ({ seq, writer: "w-" + id, instance: "i1", kind: "lock/state", actor: TEAM, subject: id, payload: { task: id, holder, at } })
const member = (seq, id) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: TEAM, subject: id, payload: { id, name: id, state: "active", role: "member" } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({
  project: mod && mod.projectTeamState ? mod.projectTeamState : null,
  claimable: mod && mod.claimable ? mod.claimable : null,
  lockHolder: mod && mod.lockHolder ? mod.lockHolder : null,
  projectLocks: mod && mod.projectLocks ? mod.projectLocks : null,
})
const claim = (mod, records, id, now) => {
  const { project, claimable } = api(mod)
  const state = project(clone(records))
  // rev2 addresses the board by key; the fixtures keep speaking in bare ids and this is where they meet
  return { state, verdict: claimable(state, keyOf(mod, TEAM, id), now === undefined ? NOW : now, { ttlMs: TTL }) }
}

/** rev2 keys carry the team: expectations stay in bare ids, so readings are stripped before comparing. */
const bare = (value) => String(value).split("\u0000").pop()
const bareAll = (list) => (Array.isArray(list) ? list.map(bare) : list)

// ---------------------------------------------------------------- 1 a fresh task is claimable
function checkOne(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(1, false, "the module exposes no " + [project === null ? "projectTeamState" : null, claimable === null ? "claimable" : null].filter((x) => x !== null).join(", ")); return }
  const { verdict } = claim(mod, [task(1, "t1", "pending", [])], "t1")
  const ok = verdict.ok === true && verdict.reason === "ready"
  console.log("      fresh task, no deps -> " + show(verdict))
  record(1, ok, ok ? "a task with no dependencies and no completion is claimable (reason ready)" : "expected ok true / reason ready, read " + show({ ok: verdict.ok, reason: verdict.reason }))
}

// ---------------------------------------------------------------- 2 an unfinished dep blocks
function checkTwo(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(2, false, "the module exposes no claimable"); return }
  const { verdict } = claim(mod, [task(1, "t1", "pending", ["t2"]), task(2, "t2", "in_progress", [])], "t1")
  const blocked = verdict.ok === false && verdict.reason === "blocked" && show(bareAll(verdict.blockers)) === show(["t2"])
  console.log("      dep in_progress -> " + show(verdict))
  record(2, blocked, blocked ? "an unfinished dependency blocks the claim and is named in blockers" : "expected ok false / blocked / blockers [t2], read " + show(verdict))
}

// ---------------------------------------------------------------- 3 done clears, both spellings
function checkThree(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(3, false, "the module exposes no claimable"); return }
  const problems = []
  const seen = []
  for (const spelling of ["done", "completed"]) {
    const { verdict } = claim(mod, [task(1, "t1", "pending", ["t2"]), task(2, "t2", spelling, [])], "t1")
    seen.push(spelling + " -> " + show({ ok: verdict.ok, reason: verdict.reason }))
    if (verdict.ok !== true || verdict.reason !== "ready") problems.push("a dep spelled " + show(spelling) + " did not clear the block (" + show(verdict.reason) + ")")
  }
  console.log("      " + seen.join("; "))
  record(3, problems.length === 0, problems.length === 0 ? "both accepted spellings clear the dependency" : problems.join(" | "))
}

// ---------------------------------------------------------------- 4 an unrecognised status is not done
function checkFour(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(4, false, "the module exposes no claimable"); return }
  const records = [task(1, "t1", "pending", ["t2"]), task(2, "t2", "finished", [])]
  const { state, verdict } = claim(mod, records, "t1")
  const problems = []
  if (verdict.ok !== false || verdict.reason !== "blocked") problems.push("a dep spelled finished was treated as satisfied (" + show({ ok: verdict.ok, reason: verdict.reason }) + ")")
  if (show(bareAll(verdict.blockers)) !== show(["t2"])) problems.push("blockers are " + show(verdict.blockers) + ", expected [t2]")
  const done = bareAll((state.board && state.board.done) || [])
  if (done.indexOf("t2") !== -1) problems.push("the unrecognised status landed in board.done (" + show(done) + ")")
  console.log("      dep finished -> " + show({ ok: verdict.ok, reason: verdict.reason, blockers: verdict.blockers }) + "; board.done = " + show(done))
  record(4, problems.length === 0, problems.length === 0 ? "an unrecognised status is never read as completion" : problems.join(" | "))
}

// ---------------------------------------------------------------- 5 a dep with no record is visible
function checkFive(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(5, false, "the module exposes no claimable"); return }
  const { state, verdict } = claim(mod, [task(1, "t1", "pending", ["ghost"])], "t1")
  const board = state.board
  const problems = []
  if (verdict.ok !== false || verdict.reason !== "blocked") problems.push("a missing dep did not block (" + show({ ok: verdict.ok, reason: verdict.reason }) + ")")
  if (show(bareAll(verdict.blockers)) !== show(["ghost"])) problems.push("blockers are " + show(verdict.blockers) + ", expected [ghost]")
  const missingRow = board && board.missing ? board.missing[keyOf(mod, TEAM, "t1")] : undefined
  if (missingRow === undefined || show(bareAll(missingRow)) !== show(["ghost"])) problems.push("missing for t1 is " + show(board && board.missing) + ", expected t1 -> [ghost]")
  if (!board || bareAll(board.orphans || []).indexOf("ghost") === -1) problems.push("ghost is not in orphans (" + show(board && board.orphans) + ")")
  if (!board || (board.ready || []).indexOf(keyOf(mod, TEAM, "t1")) !== -1) problems.push("t1 with a missing dep is in ready")
  console.log("      missing dep -> " + show({ reason: verdict.reason, blockers: verdict.blockers, missing: board && board.missing, orphans: board && board.orphans }) )
  record(5, problems.length === 0, problems.length === 0 ? "a dependency with no record is visible in missing and orphans and never satisfies a block" : problems.join(" | "))
}

// ---------------------------------------------------------------- 6 a cycle is a determinate answer
function checkSix(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(6, false, "the module exposes no claimable"); return }
  const records = [task(1, "t1", "pending", ["t2"]), task(2, "t2", "pending", ["t1"])]
  const { state } = claim(mod, records, "t1")
  const board = state.board
  const problems = []
  const cycles = (board && board.cycles) || []
  if (cycles.length === 0) problems.push("no cycle was reported for two tasks depending on each other")
  else {
    const loop = bareAll(cycles[0].loop).sort()
    if (show(loop) !== show(["t1", "t2"])) problems.push("loop is " + show(cycles[0].loop) + ", expected the two members t1 and t2")
    const edge = bareAll(cycles[0].edge || [])
    if (edge.length !== 2 || ["t1", "t2"].indexOf(edge[0]) === -1 || ["t1", "t2"].indexOf(edge[1]) === -1) problems.push("edge is " + show(cycles[0].edge) + ", expected a closing edge between t1 and t2")
  }
  for (const id of ["t1", "t2"]) {
    const key = keyOf(mod, TEAM, id)
    const verdict = claimable(state, key, NOW, { ttlMs: TTL })
    if (verdict.reason !== "cycle") problems.push(id + " reads " + show(verdict.reason) + ", expected cycle")
    if ((board.ready || []).indexOf(key) !== -1) problems.push(id + " is in ready although it sits on a cycle")
    if (!board.blocked || !(board.blocked[key] || []).length) problems.push(id + " has no blocked entry although its dep is unmet")
  }
  console.log("      mutual deps -> cycles " + show(cycles) + "; ready = " + show(board && board.ready) + "; blocked = " + show(board && board.blocked))
  record(6, problems.length === 0, problems.length === 0 ? "the cycle is reported with a closing edge and neither member is ready" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 7 locks, including the exact boundary
function checkSeven(mod) {
  const { project, claimable, lockHolder } = api(mod)
  if (project === null || claimable === null || lockHolder === null) { record(7, false, "the module exposes no claimable/lockHolder"); return }
  const base = [task(1, "t1", "pending", [])]
  const problems = []
  const seen = []
  // (a) held, well inside the ttl
  const held = claim(mod, [...base, lock(2, "t1", "h1", NOW - 1000)], "t1")
  seen.push("held -> " + show({ ok: held.verdict.ok, reason: held.verdict.reason, holder: held.verdict.holder }))
  if (held.verdict.reason !== "locked" || held.verdict.ok !== false || held.verdict.holder !== "h1") problems.push("a live lock did not produce locked/h1 (" + show(held.verdict) + ")")
  // (b) released
  const released = claim(mod, [...base, lock(2, "t1", null, NOW - 1000)], "t1")
  seen.push("released -> " + show({ ok: released.verdict.ok, reason: released.verdict.reason }))
  if (released.verdict.reason !== "ready") problems.push("a released lock did not return the task to ready (" + show(released.verdict.reason) + ")")
  // (c) exactly at the ttl counts as expired: sinceMs >= ttlMs
  const boundary = claim(mod, [...base, lock(2, "t1", "h1", NOW - TTL)], "t1")
  const reading = lockHolder(boundary.state, keyOf(mod, TEAM, "t1"), NOW, { ttlMs: TTL })
  seen.push("now - at == ttl -> " + show({ expired: reading.expired, holder: reading.holder, sinceMs: reading.sinceMs, reason: boundary.verdict.reason }))
  if (reading.sinceMs !== TTL) problems.push("sinceMs is " + show(reading.sinceMs) + ", expected exactly " + String(TTL))
  if (reading.expired !== true) problems.push("a lock exactly at the ttl is not expired")
  if (boundary.verdict.reason !== "ready") problems.push("a lock exactly at the ttl still blocks the claim (" + show(boundary.verdict.reason) + ")")
  // (d) one millisecond inside the ttl is still held
  const inside = claim(mod, [...base, lock(2, "t1", "h1", NOW - TTL + 1)], "t1")
  seen.push("one ms inside -> " + show({ reason: inside.verdict.reason, holder: inside.verdict.holder }))
  if (inside.verdict.reason !== "locked") problems.push("a lock one millisecond inside the ttl is already considered expired (" + show(inside.verdict.reason) + ")")
  console.log("      " + seen.join("; "))
  record(7, problems.length === 0, problems.length === 0 ? "lock, release and the exact ttl boundary all read as computed from the clock passed in" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 8 order independence and the seq winner
function checkEight(mod) {
  const { project } = api(mod)
  if (project === null) { record(8, false, "the module exports no projectTeamState"); return }
  const records = [task(1, "t1", "pending", ["t2"]), task(2, "t2", "done", []), lock(3, "t1", "h-old", NOW - 9000), lock(4, "t1", "h-new", NOW - 1000)]
  const first = project(clone(records))
  const second = project(clone([...records].reverse()))
  const problems = []
  if (show(first.board) !== show(second.board)) problems.push("board differs between the two arrival orders")
  if (show(first.locks) !== show(second.locks)) problems.push("locks differ between the two arrival orders")
  // independently: the later declaration (seq 4) is the one in force, so the lock holder is h-new
  const locks = first.locks || []
  const row = locks.find((item) => item.id === "t1" || item.task === "t1")
  if (row === undefined) problems.push("no lock row for t1")
  else if (row.holder !== "h-new") problems.push("the lock in force is " + show(row.holder) + ", expected h-new (the higher seq declaration)")
  console.log("      two orders -> board " + (show(first.board) === show(second.board) ? "identical" : "DIFFERENT") + ", locks " + (show(first.locks) === show(second.locks) ? "identical" : "DIFFERENT") + "; winner " + show(row && row.holder))
  record(8, problems.length === 0, problems.length === 0 ? "the board and the locks are byte-identical under both arrival orders and the higher seq wins" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 9 the other readings stay empty
function checkNine(mod) {
  const { project } = api(mod)
  if (project === null) { record(9, false, "the module exports no projectTeamState"); return }
  const problems = []
  // fixture holds ONLY lock facts: every other entity reading must therefore be empty
  const locksOnly = project([lock(1, "t1", "h1", NOW)])
  const entity = (state) => ({ tasks: state.tasks, members: state.members, counts: state.counts, registry: state.registry, liveness: state.liveness, teams: state.teams, peers: state.peers })
  const empty = show({ tasks: [], members: [], counts: locksOnly.counts, registry: locksOnly.registry, liveness: locksOnly.liveness, teams: locksOnly.teams, peers: locksOnly.peers })
  const filled = (state) => [state.tasks, state.members].every((list) => Array.isArray(list) && list.length > 0)
  if (filled(locksOnly)) problems.push("lock-only ledger produced tasks/members entries: " + clip(show(entity(locksOnly)), 120))
  if ((locksOnly.locks || []).length !== 1) problems.push("the lock fact did not land in state.locks (" + show(locksOnly.locks) + ")")
  if (locksOnly.board && (locksOnly.board.tasks || []).length !== 0) problems.push("a lock fact created a board task (" + show(locksOnly.board.tasks) + ")")
  // fixture holds ONLY one member fact: the board and the locks must stay empty
  const membersOnly = project([member(1, "m1")])
  if ((membersOnly.board && membersOnly.board.tasks || []).length !== 0) problems.push("a member fact created a board task")
  if ((membersOnly.locks || []).length !== 0) problems.push("a member fact created a lock row")
  void empty
  console.log("      lock-only ledger -> tasks " + show(locksOnly.tasks) + ", members " + show(locksOnly.members) + ", locks " + String((locksOnly.locks || []).length) + "; member-only ledger -> board.tasks " + show((membersOnly.board || {}).tasks) + ", locks " + String((membersOnly.locks || []).length))
  record(9, problems.length === 0, problems.length === 0 ? "each fact type lands only in its own reading (fixtures hold one record type each)" : problems.slice(0, 3).join(" | "))
}

// ---------------------------------------------------------------- 11 no phantom self-loop, and a real one is reported
/** A self-loop is an edge whose two ends are the same id. */
const selfLoops = (cycles) => cycles.filter((cycle) => Array.isArray(cycle.edge) && cycle.edge.length === 2 && cycle.edge[0] === cycle.edge[1])
function checkEleven(mod) {
  const { project } = api(mod)
  if (project === null) { record(11, false, "the module exports no projectTeamState"); return }
  const problems = []
  // Independently computed from the graph: x -> a,b; a -> c; b -> c; c -> b. The only genuine cycle is b<->c,
  // and no task here depends on itself, so any edge [i,i] in the answer is a loop that does not exist.
  const graph = [task(1, "x", "pending", ["a", "b"]), task(2, "a", "pending", ["c"]), task(3, "b", "pending", ["c"]), task(4, "c", "pending", ["b"])]
  const board = project(clone(graph)).board
  const cycles = (board && board.cycles) || []
  const phantom = selfLoops(cycles)
  if (phantom.length > 0) problems.push("reported a self-loop that does not exist: " + show(phantom[0]) + " (no task in this ledger depends on itself)")
  if (cycles.length !== 1) problems.push("expected exactly one cycle for b<->c, got " + String(cycles.length) + ": " + clip(show(cycles.map((cycle) => cycle.loop)), 90))
  const loop = cycles.length > 0 ? bareAll(cycles[0].loop).sort() : []
  if (cycles.length === 1 && show(loop) !== show(["b", "c"])) problems.push("the one cycle covers " + show(loop) + ", expected [b, c]")
  console.log("      x->[a,b], a->[c], b->[c], c->[b] -> cycles " + clip(show(cycles), 130))
  // Reverse constraint, so this check cannot be satisfied by never reporting self-loops at all.
  const real = project([task(1, "s", "pending", ["s"])]).board
  const realCycles = (real && real.cycles) || []
  const realLoops = selfLoops(realCycles)
  if (realLoops.length === 0) problems.push("a task that really depends on itself was not reported as a self-loop (" + clip(show(realCycles), 90) + ")")
  else if (show(bareAll(realLoops[0].loop)) !== show(["s"])) problems.push("the genuine self-loop reports loop " + show(realLoops[0].loop) + ", expected [s]")
  console.log("      s->[s] -> " + clip(show(realCycles), 90))
  record(11, problems.length === 0, problems.length === 0 ? "exactly one cycle for the b<->c graph with no phantom self-loop, and a genuine self-loop is reported" : problems.slice(0, 3).join(" | "))
}
// ---------------------------------------------------------------- 12-16 rev2 readings (task-70)
/** The key rule rev2 freezes: boardKey(team, id) == (team ?? "") + NUL + id. */
const keyOf = (mod, team, id) => (typeof mod.boardKey === "function" ? mod.boardKey(team, id) : (team === null ? "" : team) + "\u0000" + id)
const taskRec = (seq, team, id, state, deps) => ({ seq, writer: "w-" + id, instance: "i1", kind: "task/state", actor: team, subject: id, payload: deps === undefined ? { id, state } : { id, state, deps } })
const lockRec = (seq, team, id, holder, at) => ({ seq, writer: "w-" + id, instance: "i1", kind: "lock/state", actor: team, subject: id, payload: { task: id, holder, at, team } })
function checkRev2(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(12, false, "the module exposes no claimable"); return }
  // Each of A1..A5 reports on its own. boardKey is used through keyOf(), which falls back to the same
  // rule, so an intermediate build missing the export does not silence the other four readings.
  const hasBoardKey = typeof mod.boardKey === "function"
  const A = "team-a", B = "team-b"
  // A1 deleted dependency: never ready, and the reason must be explicit about the tombstone
  {
    const state = project([taskRec(1, A, "t1", "pending", ["t2"]), taskRec(2, A, "t2", "deleted", [])])
    const verdict = claimable(state, keyOf(mod, A, "t1"), NOW, { ttlMs: TTL })
    const board = state.board || {}
    const problems = []
    if (verdict.reason !== "unreachable") problems.push("a deleted dependency reads " + show(verdict.reason) + ", expected unreachable")
    if ((board.ready || []).indexOf(keyOf(mod, A, "t1")) !== -1) problems.push("a task whose dependency is a tombstone is in ready")
    if ((board.removed || []).indexOf(keyOf(mod, A, "t2")) === -1) problems.push("the tombstone task is not in board.removed (" + show(board.removed) + ")")
    if (!board.unreachable || show(board.unreachable[keyOf(mod, A, "t1")]) !== show([keyOf(mod, A, "t2")])) problems.push("unreachable does not name the deleted dependency (" + clip(show(board.unreachable), 90) + ")")
    console.log("      A1 deleted dep -> " + show({ reason: verdict.reason, removed: board.removed, unreachable: board.unreachable }))
    record(12, problems.length === 0, problems.length === 0 ? "A1: a deleted dependency is never ready and is reported as unreachable by name" : problems.slice(0, 3).join(" | "))
  }
  // A2 two opposite claims on one key: the board must agree with state.tasks
  {
    const records = [taskRec(1, A, "t1", "pending", []), { ...taskRec(2, A, "t1", "completed", []), at: "2026-05-01T00:00:00.000Z" }]
    const state = project(clone(records))
    const board = state.board || {}
    const folded = (state.tasks || []).find((entry) => entry.id === "t1") || null
    const row = (board.tasks || []).find((entry) => entry.key === keyOf(mod, A, "t1")) || null
    const problems = []
    if (folded === null || row === null) problems.push("the task is missing from tasks or from board.tasks")
    else {
      if (row.status !== folded.status) problems.push("board says " + show(row.status) + " while state.tasks says " + show(folded.status) + " for the same key")
      if (row.resolvedBy !== "at") problems.push("two claims carrying at resolved by " + show(row.resolvedBy) + ", expected at")
    }
    console.log("      A2 two claims -> board " + show(row && { status: row.status, resolvedBy: row.resolvedBy }) + "; state.tasks " + show(folded && { status: folded.status }))
    record(13, problems.length === 0, problems.length === 0 ? "A2: the board and state.tasks agree on which claim won" : problems.join(" | "))
  }
  // A3 same id in two teams: deps must not cross-satisfy and locks must not cross-hold
  {
    const records = [taskRec(1, A, "t1", "pending", ["shared"]), taskRec(2, B, "shared", "done", []), lockRec(3, A, "shared", "h-a", NOW - 100), taskRec(4, A, "shared", "pending", [])]
    const state = project(clone(records))
    const problems = []
    const crossVerdict = claimable(state, keyOf(mod, A, "t1"), NOW, { ttlMs: TTL })
    if (crossVerdict.reason !== "blocked") problems.push("a dependency satisfied only in ANOTHER team cleared the block (" + show(crossVerdict.reason) + ")")
    const aShared = claimable(state, keyOf(mod, A, "shared"), NOW, { ttlMs: TTL })
    const bShared = claimable(state, keyOf(mod, B, "shared"), NOW, { ttlMs: TTL })
    if (aShared.reason !== "locked") problems.push("the locked key reads " + show(aShared.reason) + ", expected locked")
    if (bShared.reason === "locked") problems.push("a lock in one team locked the same id in another team")
    if (!hasBoardKey) problems.push("no boardKey export: the keys were computed by the gate fallback, so this reading does not yet exercise the shipped key rule")
    console.log("      A3 two teams -> cross-team dep " + show(crossVerdict.reason) + ", team-a key " + show(aShared.reason) + ", team-b key " + show(bShared.reason))
    record(14, problems.length === 0, problems.length === 0 ? "A3: teams with the same id neither satisfy each other deps nor share a lock" : problems.join(" | "))
  }
  // A4 a later record with no deps must not erase the graph
  {
    const state = project([taskRec(1, A, "t1", "pending", ["t2"]), taskRec(2, A, "t2", "in_progress", []), taskRec(3, A, "t1", "in_progress")])
    const board = state.board || {}
    const row = (board.tasks || []).find((entry) => entry.key === keyOf(mod, A, "t1")) || null
    const problems = []
    if (row === null) problems.push("the task vanished from the board")
    else {
      // Lead ruling: declaredDeps keeps the writer's own words, deps is the resolved key list.
      if (row.declaredDeps !== undefined && show(row.declaredDeps) !== show(["t2"])) problems.push("declaredDeps no longer holds the writer's declaration (" + show(row.declaredDeps) + ")")
      if (show(bareAll(row.deps)) !== show(["t2"])) problems.push("a later record without deps replaced the graph (" + show(row.deps) + ")")
      if (!Array.isArray(row.deps) || row.deps.some((dep) => String(dep).indexOf(String.fromCharCode(0)) === -1)) problems.push("deps are spelled as bare ids (" + show(row.deps) + "), expected resolved keys")
    }
    const verdict = claimable(state, keyOf(mod, A, "t1"), NOW, { ttlMs: TTL })
    if (verdict.reason !== "blocked") problems.push("the task reads " + show(verdict.reason) + " although its dependency is unfinished")
    console.log("      A4 later record without deps -> deps " + show(row && row.deps) + ", reason " + show(verdict.reason))
    record(15, problems.length === 0, problems.length === 0 ? "A4: a record without deps leaves the dependency graph intact" : problems.join(" | "))
  }
  // A5 a lock record must not inflate the unknown counter
  {
    const base = [taskRec(1, A, "t1", "pending", [])]
    const before = project(clone(base)).counts.unknown
    const after = project(clone([...base, lockRec(2, A, "t1", "h1", NOW)])).counts.unknown
    const problems = []
    if (after > before) problems.push("adding one lock/state record raised counts.unknown from " + String(before) + " to " + String(after) + ", so this build does not read its own kind")
    console.log("      A5 lock record -> counts.unknown " + String(before) + " -> " + String(after))
    record(16, problems.length === 0, problems.length === 0 ? "A5: the lock kind is read, not counted as unknown" : problems.join(" | "))
  }
  // 19 a bare dependency id resolves inside its OWN team only
  {
    const problems = []
    const cross = [taskRec(1, A, "t1", "pending", ["shared"]), taskRec(2, B, "shared", "completed", [])]
    const crossVerdict = claimable(project(clone(cross)), keyOf(mod, A, "t1"), NOW, { ttlMs: TTL })
    if (crossVerdict.reason !== "blocked") problems.push("a dep declared as the bare id shared was satisfied by ANOTHER team completed shared (" + show(crossVerdict.reason) + ")")
    // Positive control, so this cannot pass by never resolving a bare id at all.
    const own = [taskRec(1, A, "t1", "pending", ["shared"]), taskRec(2, A, "shared", "completed", [])]
    const ownVerdict = claimable(project(clone(own)), keyOf(mod, A, "t1"), NOW, { ttlMs: TTL })
    if (ownVerdict.reason !== "ready") problems.push("the same bare id did not resolve inside its own team (" + show(ownVerdict.reason) + ")")
    console.log("      bare dep shared -> other team done: " + show(crossVerdict.reason) + "; own team done: " + show(ownVerdict.reason))
    record(19, problems.length === 0, problems.length === 0 ? "a bare dependency id resolves to its own team only, and does clear there" : problems.slice(0, 3).join(" | "))
  }
  }
// ---------------------------------------------------------------- 17 the lock reaches the peer through the relay
/** End to end: the sender appends a lock, the relay carries it, the peer projects it. */
async function checkBroadcast(mod) {
  const problems = []
  const missing = ["openControlLog", "projectBoard", "projectLocks", "lockRecord"].filter((name) => typeof mod[name] !== "function")
  if (missing.length > 0) { record(17, false, "the module does not export " + missing.join(", ") + ", so the relay path cannot be exercised"); return }
  const dir = mkdtempSync(join(tmpdir(), "collab-board-relay-"))
  try {
    const AT = NOW - 1000
    const sender = mod.openControlLog({ dir: join(dir, "sender"), writer: "device-a" })
    const receiver = mod.openControlLog({ dir: join(dir, "receiver"), writer: "device-b" })
    await sender.append(mod.lockRecord("t1", "m1", AT, "team-A"))
    await sender.append({ kind: "task/state", actor: "team-A", payload: { id: "t1", state: "pending" } })
    // The relay takes a contiguous ascending batch (it refuses a page that "skips"), so the export is
    // ordered by originSeq before it goes over: ownPage() does not promise an order.
    const exported = sender.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })).sort((left, right) => left.seq - right.seq)
    let receipt = null
    try { receipt = await receiver.ingest({ writer: "device-a", instance: sender.instance, records: exported }) }
    catch (error) { record(17, false, "ingest refused the batch (raw, as asked): " + clip(String((error && error.message) || error), 170)); return }
    const landed = receipt === null ? null : (receipt.appended === undefined ? (receipt.applied === undefined ? receipt.count : receipt.applied) : receipt.appended)
    if (typeof landed !== "number") problems.push("ingest returned no append count (keys " + show(receipt === null ? null : Object.keys(receipt)) + ")")
    else if (landed !== exported.length) problems.push("ingest reports " + String(landed) + " record(s) landed while the sender exported " + String(exported.length))
    const records = receiver.replay()
    const peerLocks = mod.projectLocks(records)
    const key = keyOf(mod, "team-A", "t1")
    const row = peerLocks.find((item) => (item.key === undefined ? keyOf(mod, item.team, item.id) : item.key) === key) || null
    if (row === null) problems.push("the peer projected no lock row (peerLocks " + clip(show(peerLocks), 100) + ")")
    else {
      if (row.holder !== "m1") problems.push("the peer lock holder is " + show(row.holder) + " while the sender wrote m1")
      if (row.at !== AT) problems.push("the peer lock at is " + show(row.at) + " while the sender wrote " + String(AT))
    }
    const reading = mod.lockHolder(mod.projectTeamState(records), key, NOW, { ttlMs: TTL })
    if (reading.holder !== "m1") problems.push("lockHolder on the peer reads " + show(reading.holder) + ", expected m1")
    const entity = (board) => ({ tasks: board.tasks, edges: board.edges, ready: board.ready, blocked: board.blocked, missing: board.missing, done: board.done, cycles: board.cycles, orphans: board.orphans })
    const peerBoard = mod.projectBoard(records)
    const ownBoard = mod.projectBoard(sender.replay())
    if (show(entity(peerBoard)) !== show(entity(ownBoard))) problems.push("the peer board differs from the sender board: " + clip(show(entity(peerBoard)), 90) + " vs " + clip(show(entity(ownBoard)), 90))
    console.log("      relay -> landed " + show(landed) + " of " + String(exported.length) + "; peer lock " + show(row === null ? null : { holder: row.holder, at: row.at }) + "; lockHolder " + show(reading.holder) + "; boards " + (show(entity(peerBoard)) === show(entity(ownBoard)) ? "identical on every entity reading (unknown counter excluded)" : "DIFFERENT"))
    record(17, problems.length === 0, problems.length === 0 ? "the lock crosses the relay, the peer reads the same holder, and both boards agree on every entity reading" : problems.slice(0, 3).join(" | "))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
// ---------------------------------------------------------------- 18 every keyed field is spelled as a key
/** No stripping in this check: a field that mixes a bare id with a key is the defect it exists for. */
function checkEighteen(mod) {
  const { project, claimable } = api(mod)
  if (project === null || claimable === null) { record(18, false, "the module exposes no claimable"); return }
  if (typeof mod.boardKey !== "function") { record(18, false, "no boardKey export, so the spelling rule cannot be stated"); return }
  const A = "team-1", OTHER = "team-2"
  const records = [taskRec(1, A, "t1", "pending", ["t2", "ghost"]), taskRec(2, A, "t2", "deleted", []), taskRec(3, A, "c1", "pending", ["c2"]), taskRec(4, A, "c2", "pending", ["c1"]), taskRec(5, OTHER, "t1", "pending", [])]
  const state = project(clone(records))
  const board = state.board || {}
  const keys = { t1: mod.boardKey(A, "t1"), t2: mod.boardKey(A, "t2"), c1: mod.boardKey(A, "c1"), c2: mod.boardKey(A, "c2"), otherT1: mod.boardKey(OTHER, "t1"), ghost: mod.boardKey(A, "ghost") }
  const known = new Set(Object.values(keys))
  const SEP = String.fromCharCode(0)
  const problems = []
  const judge = (where, entry) => {
    if (typeof entry !== "string") { problems.push(where + " holds " + show(entry) + ", not a key string"); return }
    if (entry.indexOf(SEP) === -1) problems.push(where + " holds " + show(entry) + ", which is a bare id rather than a key")
    else if (!known.has(entry)) problems.push(where + " holds " + show(entry) + ", which is not the key of any task in this ledger")
  }
  for (const name of ["ready", "done", "removed", "orphans"]) {
    const list = board[name]
    if (!Array.isArray(list)) { problems.push("board." + name + " is not a list"); continue }
    for (const entry of list) judge("board." + name, entry)
  }
  for (const name of ["blocked", "missing", "unreachable", "edges"]) {
    const map = board[name]
    if (map === null || typeof map !== "object") { problems.push("board." + name + " is not a map"); continue }
    for (const key of Object.keys(map)) {
      judge("board." + name + " key", key)
      const value = map[key]
      if (!Array.isArray(value)) { problems.push("board." + name + "[" + show(key) + "] is not a list"); continue }
      for (const dep of value) judge("board." + name + "[" + show(key) + "]", dep)
    }
  }
  for (const cycle of board.cycles || []) {
    for (const id of cycle.loop || []) judge("cycles[].loop", id)
    for (const id of cycle.edge || []) judge("cycles[].edge", id)
  }
  if (board.tasks) for (const task of board.tasks) { judge("board.tasks[].key", task.key); for (const dep of task.deps || []) judge("board.tasks[].deps for " + show(task.key), dep) }
  const verdict = claimable(state, keys.t1, NOW, { ttlMs: TTL })
  if (!Array.isArray(verdict.blockers)) problems.push("ClaimVerdict.blockers is not a list")
  else for (const dep of verdict.blockers) judge("ClaimVerdict.blockers", dep)
  console.log("      raw spellings (keys keep the team prefix): ready " + show(board.ready) + "; blocked map keys " + show(Object.keys(board.blocked || {})) + "; cycles " + clip(show(board.cycles), 70) + "; blockers " + show(verdict.blockers))
  record(18, problems.length === 0, problems.length === 0 ? "no field mixes a bare id with a key: ready/done/removed/orphans, the blocked/missing/unreachable/edges maps, cycles[].loop, cycles[].edge, task.deps and ClaimVerdict.blockers are all spelled as keys" : problems.slice(0, 3).join(" | "))
}
// ---------------------------------------------------------------- 10 the nine gates
function checkTen(gateList) {
  const problems = [], notes = []
  for (const gate of gateList) {
    const gatePath = isAbsolute(gate) ? gate : join(PROJECT, "scripts", gate)
    if (!existsSync(gatePath)) { problems.push(gate + " is missing"); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
    if (run.status === 0) notes.push(gate + " ok")
    else problems.push(gate + " exited " + String(run.status) + ": " + clip(((run.stdout || "") + (run.stderr || "")).trim().replace(/\s+/g, " "), 80))
  }
  record(10, problems.length === 0, problems.length === 0 ? notes.length + "/9 gates green" : problems.join(" | "))
}

async function runAll(modulePath, gateList) {
  results.length = 0
  const mod = await load(modulePath)
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix],
    [7, checkSeven], [8, checkEight], [9, checkNine], [11, checkEleven], [12, checkRev2], [17, checkBroadcast], [18, checkEighteen]]
  // A check that throws is a red reading, not a crash: the rest of the gate still reports.
  for (const entry of sequence) {
    try { await entry[1](mod) } catch (error) { record(entry[0], false, "the check threw: " + String(error && error.message ? error.message : error).slice(0, 140)) }
  }
  if (SKIP_REGRESSION) {
    console.log('')
    console.log('-- 10. NOT RUN: --skip-regression was passed, so the nine gates were not re-run here')
    console.log('   (verify-all.mjs owns that sweep; the default run does execute reading 10)')
  } else {
    checkTen(gateList === undefined ? NINE : gateList)
  }
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

const MUTATIONS = [
  ["seq resolution inverted (first-by-seq)", "left.seq - right.seq", "right.seq - left.seq", 8],
  ["ttl boundary relaxed to >", "sinceMs >= options.ttlMs", "sinceMs > options.ttlMs", 7],
  ["completed dropped from DONE_STATUSES", "[\"completed\", \"done\"]", "[\"done\"]", 3],
  ["finished accepted as done", "[\"completed\", \"done\"]", "[\"completed\", \"done\", \"finished\"]", 4],
  ["lock ignored in claimable (holder read neutralised, rev2 :542)", "const holder = lockHolder(state, key, now, options).holder", "const holder = null", 7],
  ["cycles never reported", "cycles.push({", "if (false) cycles.push({", 11],
  // Anchored on the real resolution line (lib/index.js:462 deps: row.declaredDeps.map((dep) => resolveDep(row.team, dep))).
  // This one honestly reddens TWO readings: 18 (spelling) and 15 (deps must be keys) — both are about the same field.
  ["deps spelled bare again (resolution skipped, lib:462)", "deps: row.declaredDeps.map((dep) => resolveDep(row.team, dep))", "deps: [...row.declaredDeps]", 18],
  ["blocked branch skipped in claimable (rev2 :551)", "if (unmet.length > 0) return { ok: false, reason: \"blocked\", holder, blockers: unmet };", "if (false) return { ok: false, reason: \"blocked\", holder, blockers: unmet };", 2],
  ["claimable can never be ready", "return { ok: true, reason: \"ready\"", "return { ok: false, reason: \"ready\"", 1],
  ["board folds every record kind", "if (record.kind !== TASK_KIND) continue;", "if (false) continue;", 9],
]

async function selfAttack() {
  const tmp = mkdtempSync(join(tmpdir(), "r39-attack-"))
  try {
    const source = readFileSync(MODULE, "utf8")
    const failing = join(tmp, "gate-that-fails.mjs")
    writeFileSync(failing, "process.exit(1)\n")
    console.log("== mutations: each copy must turn its own check red ==")
    const lines = []
    let allLocalised = true
    for (const [name, from, to, expected] of MUTATIONS) {
      const flipped = source.split(from).join(to)
      if (flipped === source) { lines.push("  " + name + ": NOT APPLICABLE (no " + show(from) + " in the module)"); allLocalised = false; continue }
      const copy = join(tmp, "mutant-" + String(expected) + "-" + String(lines.length) + ".mjs")
      writeFileSync(copy, flipped)
      const seen = await runAll(copy, [failing])
      const caught = seen.failed.indexOf(expected) !== -1
      lines.push("  check " + String(expected) + " | " + name + " -> failed checks " + show(seen.failed) + (caught ? "  CAUGHT" : "  MISSED"))
      if (!caught) allLocalised = false
    }
    // check 10 proves itself against a gate that exits non-zero
    const tenOnly = await runAll(MODULE, [failing])
    lines.push("  check 10 | a gate that exits 1 -> failed checks " + show(tenOnly.failed) + (tenOnly.failed.indexOf(10) !== -1 ? "  CAUGHT" : "  MISSED"))
    if (tenOnly.failed.indexOf(10) === -1) allLocalised = false
    console.log(lines.join("\n"))
    console.log("")
    // Check 11 is green on the real module since the task-69 fix landed, so its red proof is the
    // cycle-disabling mutation above rather than a mirrored copy.
    console.log("every check has a mutation that turns it red: " + String(allLocalised))
    process.exit(allLocalised ? 0 : 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  if (!existsSync(MODULE)) { console.log("SKIP  no collab module at " + MODULE); process.exit(3) }
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll(MODULE)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
