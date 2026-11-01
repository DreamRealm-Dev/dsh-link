#!/usr/bin/env node
/**
 * R44 (task-83): cross-endpoint teaming — a member may run on another end, reached through a transit path,
 * and work can be assigned to it only while the WHOLE path and that member are alive right now.
 *
 * Shapes read from plugins/dsh-link-collab/lib/index.js before any assertion: foldClaim (:364) is the one
 * claim rule, READABLE_KINDS (:1006) is the readable-kind set, and the R44 symbols (HOST_KIND, hostRecord,
 * projectHosting, routes, routeFailures, assignThrough, hosting) must appear before the readings can pass.
 *
 * The thirteen readings of .tmp/r44-contract.md section 6, each with an expectation computed from the
 * records and the clock this gate passes in — never read back from the implementation. Self-attack follows
 * the R40-R43 rulings: declared-set equality per mutant, a coverage matrix with no uncovered reading, and
 * anchors taken from lib/index.js. This gate runs no other gate: regression belongs to the suite.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). Intermediate red readings are held.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const SELF_ATTACK = argv.includes("--self-attack")
const TEAM = "team-1", LOCAL = "end-A"
const NOW = 1_800_000_000_000
const TIMEOUT = 60_000
const M = { a: "m-a", b: "m-b", c: "m-c", silent: "m-silent", never: "m-never", other: "m-other", live: "m-live" }
const END_B = "end-B", END_C = "end-C", END_D = "end-D"
const member = (seq, id, team) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: team === undefined ? TEAM : team, subject: id, payload: { id, name: id, state: "active", role: "member" } })
const beat = (seq, id, atMs) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/heartbeat", actor: TEAM, subject: id, payload: { id, at: atMs } })
const host = (seq, id, end, via, atMs) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/host", actor: TEAM, subject: id, payload: { id, end, via, at: atMs === undefined ? NOW - 1000 : atMs } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({ project: mod && mod.projectTeamState ? mod.projectTeamState : null, assign: mod && mod.assignThrough ? mod.assignThrough : null, routes: mod && mod.routes ? mod.routes : null, failures: mod && mod.routeFailures ? mod.routeFailures : null, hosting: mod && mod.projectHosting ? mod.projectHosting : null })
const MISSING = "the module exposes no R44 surface (assignThrough/routes/projectHosting) — task-82 has not landed"
const state = (mod, records) => api(mod).project(clone(records))
const verdict = (mod, records, memberId, target, now) => api(mod).assign(state(mod, records), target === undefined ? TEAM : target, memberId, LOCAL, now === undefined ? NOW : now, { timeoutMs: TIMEOUT })
const shape = (v) => ({ ok: v.ok, reason: v.reason, path: v.path, hops: v.hops, loop: v.loop })

// ---------------------------------------------------------------- 1 no host fact means local
function checkOne(mod) {
  const a = api(mod)
  if (a.assign === null || a.project === null) { record(1, false, MISSING); return }
  const v = verdict(mod, [member(1, M.a), beat(2, M.a, NOW - 1000)], M.a)
  const ok = v.ok === true && v.reason === "local" && v.hops === 0
  console.log("      no host fact -> " + clip(show(shape(v)), 120))
  record(1, ok, ok ? "a member with no member/host fact is local: ok, hops 0 (absence is not a broken route)" : "expected ok/local/hops 0, read " + show(shape(v)))
}

// ---------------------------------------------------------------- 2 one hop
function checkTwo(mod) {
  const a = api(mod)
  if (a.assign === null) { record(2, false, MISSING); return }
  const records = [member(1, M.b), beat(2, M.b, NOW - 1000), host(3, M.b, END_B, LOCAL)]
  const v = verdict(mod, records, M.b)
  const ok = v.ok === true && v.reason === "ok" && show(v.path) === show([LOCAL, END_B]) && v.hops === 1
  console.log("      one hop -> " + clip(show(shape(v)), 130))
  record(2, ok, ok ? "a remote member one end away is assignable with path [local, end-B] and hops 1" : "expected ok/path [local,end-B]/hops 1, read " + show(shape(v)))
}

// ---------------------------------------------------------------- 3 two hops
function checkThree(mod) {
  const a = api(mod)
  if (a.assign === null) { record(3, false, MISSING); return }
  // The middle end is represented by a member of its own whose host fact says end-B is reached from here.
  const records = [member(1, M.b), beat(2, M.b, NOW - 1000), host(3, M.b, END_B, LOCAL), member(4, M.c), beat(5, M.c, NOW - 1000), host(6, M.c, END_C, END_B)]
  const v = verdict(mod, records, M.c)
  const ok = v.ok === true && show(v.path) === show([LOCAL, END_B, END_C]) && v.hops === 2
  console.log("      two hops -> " + clip(show(shape(v)), 140))
  record(3, ok, ok ? "a member two ends away resolves hop by hop: [local, end-B, end-C], hops 2" : "expected hops 2 over [local,end-B,end-C], read " + show(shape(v)))
}

// ---------------------------------------------------------------- 4 a cycle is reported, not walked
function checkFour(mod) {
  const a = api(mod)
  if (a.assign === null) { record(4, false, MISSING); return }
  // B and C point at each other. The cycle MEMBERS are fixed by the fixture; the reported loop is a rotation
  // and which rotation you see is a property of the member the route is resolved for, so the member set and
  // determinism are gated while the rotation itself is recorded. The cycle is never walked into.
  const records = [member(1, M.b), beat(2, M.b, NOW - 1000), host(3, M.b, END_B, END_C), member(4, M.c), beat(5, M.c, NOW - 1000), host(6, M.c, END_C, END_B)]
  const cycle = [END_B, END_C].slice().sort()
  const problems = []
  const views = []
  for (const target of [M.b, M.c]) {
    const v = verdict(mod, records, target)
    const again = verdict(mod, records, target)
    views.push([target, v])
    if (v.ok !== false || v.reason !== "path-cycle") { problems.push("target " + target + " read " + show(shape(v)) + ", expected path-cycle"); continue }
    if (!Array.isArray(v.loop) || v.loop.length === 0) { problems.push("target " + target + " loop is " + show(v.loop)); continue }
    if (show(v.loop.slice().sort()) !== show(cycle)) problems.push("target " + target + " loop " + show(v.loop) + ", expected the cycle members " + show(cycle))
    if (!Array.isArray(v.path) || v.path[0] !== LOCAL) problems.push("target " + target + " path does not start at this end: " + show(v.path))
    else if (v.path[v.path.length - 1] !== v.loop[0]) problems.push("target " + target + " loop starts at " + show(v.loop[0]) + ", expected the repeated end " + show(v.path[v.path.length - 1]))
    if (Array.isArray(v.path) && new Set(v.path).size !== v.path.length) problems.push("target " + target + " walked into the cycle: " + show(v.path))
    if (v.hops !== v.path.length - 1) problems.push("target " + target + " hops " + show(v.hops) + " over a path of " + String(v.path.length))
    if (show(shape(again)) !== show(shape(v))) problems.push("target " + target + " is not deterministic on a fixed input")
  }
  for (const [target, v] of views) console.log("      cycle (resolved for " + target + ") -> " + clip(show(shape(v)), 130))
  const rotations = views.filter(([, v]) => Array.isArray(v.loop)).map(([, v]) => show(v.loop))
  const sameSet = views.every(([, v]) => Array.isArray(v.loop) && show(v.loop.slice().sort()) === show(cycle))
  console.log("      loop member set " + show(cycle) + " for every target: " + String(sameSet) + "; rotations " + show(rotations) + " " + (rotations.length === 2 && rotations[0] !== rotations[1] ? "differ per target (recorded, not gated)" : "agree (recorded, not gated)"))
  record(4, problems.length === 0, problems.length === 0 ? "a cycle is reported as path-cycle over the cycle members for every target, deterministic on a fixed input, and never walked into" : problems.join(" | "))
}

// ---------------------------------------------------------------- 5 a dead transit, and the 1ms counterexample
function checkFive(mod) {
  const a = api(mod)
  if (a.assign === null) { record(5, false, MISSING); return }
  const problems = []
  for (const [name, offset, expectDown] of [["dead (>= timeout)", TIMEOUT, true], ["alive (1ms inside)", TIMEOUT - 1, false]]) {
    // The TRANSIT is end-B (its representative member m-b), the target is m-c two hops away and healthy:
    // a stale target would be member-silent, which is a different reading (6).
    const records = [member(1, M.b), beat(2, M.b, NOW - offset), host(3, M.b, END_B, LOCAL), member(4, M.c), beat(5, M.c, NOW - 1000), host(6, M.c, END_C, END_B)]
    const verdictFor = (records2) => api(mod).assign(state(mod, records2), TEAM, M.c, LOCAL, NOW, { timeoutMs: TIMEOUT })
    const v = verdictFor(records)
    console.log("      " + name + " -> " + clip(show(shape(v)), 110))
    if (expectDown) {
      if (v.reason !== "route-down" || v.ok !== false) problems.push(name + ": expected route-down, read " + show(v.reason))
      if (!Array.isArray(v.path) || v.path.indexOf(END_B) === -1) problems.push(name + ": the break point is not visible in path (" + show(v.path) + ")")
    } else if (v.reason === "route-down") problems.push(name + ": one millisecond inside the timeout was already route-down")
  }
  record(5, problems.length === 0, problems.length === 0 ? "a dead transit is route-down with the break point visible, and one ms earlier it is not" : problems.join(" | "))
}

// ---------------------------------------------------------------- 6 the member itself is silent
function checkSix(mod) {
  const a = api(mod)
  if (a.assign === null) { record(6, false, MISSING); return }
  const problems = []
  const seen = []
  const stale = [member(1, M.silent), beat(2, M.silent, NOW - TIMEOUT), host(3, M.silent, END_B, LOCAL), member(4, M.b), beat(5, M.b, NOW - 1000), host(6, M.b, END_B, LOCAL)]
  const vStale = verdict(mod, stale, M.silent)
  seen.push("stale -> " + show(vStale.reason))
  if (vStale.reason !== "member-silent" || vStale.ok !== false) problems.push("a stale member read " + show(vStale.reason) + ", expected member-silent")
  const unknown = [member(1, M.never), host(2, M.never, END_B, LOCAL), member(3, M.b), beat(4, M.b, NOW - 1000), host(5, M.b, END_B, LOCAL)]
  const vUnknown = verdict(mod, unknown, M.never)
  seen.push("never beat -> " + show(vUnknown.reason))
  if (vUnknown.reason !== "member-silent") problems.push("a member that never beat read " + show(vUnknown.reason) + ", expected member-silent (unknown is not alive)")
  console.log("      " + seen.join("; "))
  record(6, problems.length === 0, problems.length === 0 ? "a healthy path with a silent member is member-silent, stale and never-beaten alike" : problems.join(" | "))
}

// ---------------------------------------------------------------- 7 no next hop
function checkSeven(mod) {
  const a = api(mod)
  if (a.assign === null) { record(7, false, MISSING); return }
  // via names an end that has no host fact anywhere and is not this end
  const records = [member(1, M.b), beat(2, M.b, NOW - 1000), host(3, M.b, END_B, END_D)]
  const v = verdict(mod, records, M.b)
  const ok = v.ok === false && v.reason === "no-route"
  console.log("      unknown next hop -> " + clip(show(shape(v)), 120))
  record(7, ok, ok ? "an end with no host fact and not this end is no-route, never assumed direct" : "expected no-route, read " + show(shape(v)))
}

// ---------------------------------------------------------------- 8 not in this team, and not a member at all
function checkEight(mod) {
  const a = api(mod)
  if (a.assign === null) { record(8, false, MISSING); return }
  const problems = []
  const seen = []
  const foreign = [member(1, M.other, "team-2"), beat(2, M.other, NOW - 1000)]
  const vForeign = verdict(mod, foreign, M.other, TEAM)
  seen.push("other team -> " + show(vForeign.reason))
  if (vForeign.reason !== "not-in-team") problems.push("a member of team-2 read " + show(vForeign.reason) + ", expected not-in-team")
  const vAbsent = verdict(mod, [member(1, M.a), beat(2, M.a, NOW - 1000)], "m-ghost")
  seen.push("absent -> " + show(vAbsent.reason))
  if (vAbsent.reason !== "not-member") problems.push("a member absent from the ledger read " + show(vAbsent.reason) + ", expected not-member")
  console.log("      " + seen.join("; "))
  record(8, problems.length === 0, problems.length === 0 ? "an existing member of another team is not-in-team, an unknown id is not-member" : problems.join(" | "))
}

// ---------------------------------------------------------------- 9 priority overlaps
function checkNine(mod) {
  const a = api(mod)
  if (a.assign === null) { record(9, false, MISSING); return }
  const problems = []
  const seen = []
  // cycle AND a dead transit at the same time: the cycle must win.
  const cycled = [member(1, M.b), beat(2, M.b, NOW - 5 * TIMEOUT), host(3, M.b, END_B, END_C), member(4, M.c), beat(5, M.c, NOW - 5 * TIMEOUT), host(6, M.c, END_C, END_B)]
  const vCycle = verdict(mod, cycled, M.b)
  seen.push("cycle+dead -> " + show(vCycle.reason))
  if (vCycle.reason !== "path-cycle") problems.push("cycle plus a dead transit read " + show(vCycle.reason) + ", expected path-cycle")
  // not in this team AND no route: the membership answer must win.
  const foreignNoRoute = [member(1, M.other, "team-2"), host(2, M.other, END_B, END_D)]
  const vBoth = verdict(mod, foreignNoRoute, M.other, TEAM)
  seen.push("not-in-team+no-route -> " + show(vBoth.reason))
  if (vBoth.reason !== "not-in-team") problems.push("not-in-team plus no-route read " + show(vBoth.reason) + ", expected not-in-team")
  console.log("      " + seen.join("; "))
  record(9, problems.length === 0, problems.length === 0 ? "overlapping reasons resolve by the fixed order: path-cycle over route-down, not-in-team over no-route" : problems.join(" | "))
}

// ---------------------------------------------------------------- 10 competing host facts
function checkTen(mod) {
  const a = api(mod)
  if (a.hosting === null || a.project === null) { record(10, false, MISSING); return }
  const first = [member(1, M.b), host(2, M.b, END_B, LOCAL, NOW - 9000), host(3, M.b, END_C, LOCAL, NOW - 1000)]
  const second = [...clone(first)].reverse()
  const one = a.hosting(clone(first))
  const two = a.hosting(clone(second))
  const problems = []
  if (show(one) !== show(two)) problems.push("the two arrival orders fold differently")
  const row = (one.hosts || []).find((entry) => entry.id === M.b) || null
  if (row === null) problems.push("no hosting row for " + M.b)
  else {
    if (row.end !== END_C) problems.push("the winner is end " + show(row.end) + ", expected end-C (later at)")
    if (row.resolvedBy !== "at") problems.push("resolvedBy is " + show(row.resolvedBy) + ", expected at")
    if (row.contested !== true) problems.push("contested is " + show(row.contested) + " although two facts competed")
    if (!Array.isArray(row.losers) || row.losers.length !== 1 || row.losers[0].end !== END_B) problems.push("the losing fact is not in losers (" + clip(show(row.losers), 80) + ")")
  }
  console.log("      competing facts -> " + clip(show(row), 150))
  record(10, problems.length === 0, problems.length === 0 ? "two host facts fold byte-identically in either arrival order, the later at wins, the loser is listed" : problems.join(" | "))
}

// ---------------------------------------------------------------- 11 real two endpoints through the relay
async function checkEleven(mod) {
  const a = api(mod)
  const missing = ["openControlLog", "hostRecord"].filter((name) => typeof mod[name] !== "function")
  if (missing.length > 0 || a.assign === null) { record(11, false, "the module does not export " + (missing.join(", ") || "assignThrough") + " — the two-endpoint reading cannot run"); return }
  const dir = mkdtempSync(join(tmpdir(), "r44-teaming-"))
  try {
    const A = mod.openControlLog({ dir: join(dir, "A"), writer: "end-A" })
    const B = mod.openControlLog({ dir: join(dir, "B"), writer: "end-B" })
    // end-B is represented by its own member (the transit), and m9 is the remote teammate living there.
    await B.append(mod.hostRecord(M.b, END_B, LOCAL, NOW - 1000))
    await B.append({ kind: "member/state", actor: TEAM, payload: { id: M.b, name: M.b, state: "active", role: "member" } })
    await B.append({ kind: "member/heartbeat", actor: TEAM, payload: { id: M.b, at: NOW - 1000 } })
    await B.append(mod.hostRecord(M.live, END_B, LOCAL, NOW - 1000))
    await B.append({ kind: "member/state", actor: TEAM, payload: { id: M.live, name: M.live, state: "active", role: "member" } })
    await B.append({ kind: "member/heartbeat", actor: TEAM, payload: { id: M.live, at: NOW - 1000 } })
    const exportFrom = (log) => log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })).sort((l, r) => l.seq - r.seq)
    let receipt = null
    try { receipt = await A.ingest({ writer: "end-B", instance: B.instance, records: exportFrom(B) }) }
    catch (error) { record(11, false, "the relay refused the batch (raw): " + clip(String((error && error.message) || error), 150)); return }
    const live = api(mod).assign(a.project(A.replay()), TEAM, M.live, LOCAL, NOW, { timeoutMs: TIMEOUT })
    const problems = []
    const landed = receipt === null ? null : (receipt.appended === undefined ? receipt.applied : receipt.appended)
    if (typeof landed === "number" && landed !== 6) problems.push("ingest reports " + String(landed) + " of 6 records landed")
    if (live.ok !== true || show(live.path) !== show([LOCAL, END_B])) problems.push("A did not resolve B: " + clip(show(shape(live)), 100))
    // Now B stops beating: the same reading, on the same peer state, must become route-down.
    await B.append({ kind: "member/heartbeat", actor: TEAM, payload: { id: M.b, at: NOW - 5 * TIMEOUT } })
    await B.append({ kind: "member/heartbeat", actor: TEAM, payload: { id: M.live, at: NOW - 1000 } })
    await A.ingest({ writer: "end-B", instance: B.instance, records: exportFrom(B) })
    const dead = api(mod).assign(a.project(A.replay()), TEAM, M.live, LOCAL, NOW, { timeoutMs: TIMEOUT })
    if (dead.reason !== "route-down") problems.push("after B stopped beating the same reading says " + show(dead.reason) + ", expected route-down")
    console.log("      live -> " + clip(show(shape(live)), 110) + "; after B stops beating -> " + clip(show(shape(dead)), 90))
    record(11, problems.length === 0, problems.length === 0 ? "the host fact and heartbeat cross the relay: A resolves [end-A, end-B] and assigns, and stops assigning once B goes quiet" : problems.slice(0, 3).join(" | "))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 12 counters and the other readings
function checkTwelve(mod) {
  const a = api(mod)
  if (a.project === null) { record(12, false, "the module exports no projectTeamState"); return }
  const base = [member(1, M.a), beat(2, M.a, NOW - 1000)]
  const withHost = [...clone(base), host(3, M.b, END_B, LOCAL)]
  const problems = []
  const before = a.project(clone(base)).counts.unknown
  const after = a.project(clone(withHost)).counts.unknown
  if (after > before) problems.push("a host fact raised counts.unknown from " + String(before) + " to " + String(after) + " (HOST_KIND must be readable)")
  // Only the tested record type in the comparison fixture: a host-only ledger has no members to show.
  const hostsOnly = a.project([host(1, M.b, END_B, LOCAL)])
  const entity = (state2) => ({ tasks: state2.tasks, members: state2.members, teams: state2.teams, peers: state2.peers })
  const emptyState = a.project([])
  if (show(entity(hostsOnly)) !== show(entity(emptyState))) problems.push("a host-only ledger moved the entity readings: " + clip(show(entity(hostsOnly)), 100))
  console.log("      counts.unknown " + String(before) + " -> " + String(after) + "; host-only ledger entities equal the empty ledger: " + String(show(entity(hostsOnly)) === show(entity(emptyState))))
  record(12, problems.length === 0, problems.length === 0 ? "host facts are readable kinds and touch no other reading" : problems.join(" | "))
}

// ---------------------------------------------------------------- 13 arriving at this end ends the chain
function checkThirteen(mod) {
  const a = api(mod)
  if (a.assign === null) { record(13, false, MISSING); return }
  // A three-hop chain whose last hop lands back on this end is SUCCESS (section 8), not a cycle.
  const records = [
    member(1, M.b), beat(2, M.b, NOW - 1000), host(3, M.b, END_B, LOCAL),
    member(4, M.c), beat(5, M.c, NOW - 1000), host(6, M.c, END_C, END_B),
    member(7, M.live), beat(8, M.live, NOW - 1000), host(9, M.live, END_D, END_C),
  ]
  const v = verdict(mod, records, M.live)
  const ok = v.ok === true && v.reason === "ok" && show(v.path) === show([LOCAL, END_B, END_C, END_D]) && v.hops === 3
  console.log("      chain ending here -> " + clip(show(shape(v)), 150))
  record(13, ok, ok ? "a chain that arrives back at this end is a successful route (hops 3), not path-cycle" : "expected ok over [local,end-B,end-C,end-D] with hops 3, read " + clip(show(shape(v)), 130))
}
async function runAll(modulePath) {
  results.length = 0
  const mod = await load(modulePath)
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [8, checkEight], [9, checkNine], [10, checkTen], [11, checkEleven], [12, checkTwelve], [13, checkThirteen]]
  for (const entry of sequence) {
    try { await entry[1](mod === null ? {} : mod) } catch (error) { record(entry[0], false, "the reading threw: " + clip(String((error && error.message) || error), 130)) }
  }
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

const MUTATIONS = [
  // Anchors are substrings of plugins/dsh-link-collab/lib/index.js. If an anchor is not present the mutant
  // is NOT APPLICABLE and the run fails, which is the R40-R43 rule: anchors are taken from the bundle.
  // each anchor was verified to occur exactly once in the landed bundle
  ['absence of a host fact becomes unreachable', 'if (path.length === 1) return { ok: true, reason: "local"', 'if (path.length === 1) return { ok: false, reason: "no-route"', [1]],
  // arriving at this end is the common tail of every remote resolution, so this mutant reddens the
  // success readings (2, 3, 13) and the failure readings that need a resolved path first (5, 6, 11), and
  // nothing else: reading 1 returns before the loop, 4 and 7 break out as cycle / no-route, 8 is checked
  // for membership first, 10 and 12 do not route.
  ['arrival at this end treated as a cycle', 'if (next === localEnd) break;', 'if (next === localEnd) { const walked = [localEnd, ...[...chain].reverse()]; return { path: walked, failure: { member, reason: "path-cycle", path: walked, loop: [next] } }; }', [2, 3, 5, 6, 11, 13]],
  ['dead transit tolerated', 'reason: "route-down"', 'reason: "no-route"', [5, 11]],
  ['cycle walked into', 'reason: "path-cycle"', 'reason: "no-route"', [4, 9]],
  ['silence counted as alive', 'reason: "member-silent"', 'reason: "ok"', [6]],
  ['foreign member read as an unrouted end', 'elsewhere ? "not-in-team" : "not-member"', 'elsewhere ? "no-route" : "not-member"', [8, 9]],
  ['an end with no host fact assumed reachable', 'reason: "no-route"', 'reason: "route-down"', [7]],
  ['host fact folded by arrival order instead of the claim rule', 'const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: rawAt, seq: record.seq });', 'const folded = { incomingWins: true, byAt: false };', [10]],
  ['host facts unreadable to the projection', ', HOST_KIND];', '];', [12]],
]

async function selfAttack() {
  const src = readFileSync(MODULE, "utf8")
  const tmp = mkdtempSync(join(tmpdir(), "r44-attack-"))
  try {
    const lines = []
    const rows = []
    let applied = 0, matched = 0
    for (const [name, from, to, declared] of MUTATIONS) {
      const flipped = src.split(from).join(to)
      if (flipped === src) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(from) + " in the bundle)"); continue }
      applied += 1
      const copy = join(tmp, "mutant-" + String(applied) + ".mjs")
      writeFileSync(copy, flipped)
      const seen = await runAll(copy)
      const observed = seen.failed.slice().sort((l, r) => l - r)
      const want = declared.slice().sort((l, r) => l - r)
      const clean = show(observed) === show(want)
      if (clean) matched += 1
      lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
      rows.push({ name, declared })
    }
    console.log("== mutants: each must redden exactly its declared set ==")
    console.log(lines.join("\n"))
    const READINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    const uncovered = READINGS.filter((n) => rows.every((r) => r.declared.indexOf(n) === -1))
    console.log("")
    console.log("coverage matrix (reading -> mutants that claim it):")
    for (const n of READINGS) console.log("  " + n + ": " + (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED"))
    console.log("")
    console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(matched) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
    process.exit(applied === MUTATIONS.length && matched === applied && uncovered.length === 0 ? 0 : 1)
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
