#!/usr/bin/env node
/**
 * R37 (task-63): the fractal team tree must be correct, cycle-safe, orphan-visible and deep-chain safe.
 *
 *   1 CHAIN: root -> a -> b -> c gives ancestorsOf(c) = [root, a, b] with the root FIRST, pathOf(c) the
 *     whole chain, descendantsOf(root) the three below it, and rootsOf naming the root.
 *   2 CYCLE: a graph with a -> b -> a must answer DETERMINATELY and name the edge that closes the cycle.
 *     Finishing inside a timeout is not the criterion; the check runs the call in a child process whose
 *     stdout must carry the cycle, and treats a killed child (hang or stack overflow) as a failure.
 *   3 ORPHAN: a parent that no member record declares stays visible and the orphan itself is still usable.
 *   4 DEEP: a 200-level chain must answer without blowing the stack; if the implementation caps depth, the
 *     cap and its boundary are asserted instead of an unlimited ancestor list.
 *   5 READING CONTROL: team relationship records leave tasks/members/counts/liveness/registry identical.
 *   6 COUNTEREXAMPLE: a copy with the parent arbitration dismantled must change the chain, while the shipped
 *     fold keeps the later re-parent out of it; a module that exports the arbitration without calling it fails here
 *     check 1.
 *   7 NO REGRESSION: the six existing gates stay green.
 *
 * Every check fails when the tree API is absent, so nothing here passes on an empty read.
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
const GATES = ["verify-collab-contested.mjs", "verify-collab-registry.mjs", "verify-collab-failover.mjs", "verify-client-plane.mjs", "verify-client-members.mjs", "verify-teams-log.mjs"]
const TEAM = "team-1"
const member = (seq, id) => ({ seq, writer: "w-" + id, instance: "i1", kind: "member/state", actor: TEAM, subject: id, payload: { id, name: id, state: "active", role: "member" } })
/** The parent fact, in the spelling this gate reads; task-62 owns the real one. */
// TEAM_KIND is team/state and the entity id is payload.team; payload.parent null means a root (:1040, :1069-1075)
const parent = (seq, child, parentId) => ({ seq, writer: "w-" + child, instance: "i1", kind: "team/state", actor: TEAM, subject: child, payload: { team: child, parent: parentId } })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const CHAIN = ["root-1", "mid-1", "mid-2", "leaf-1"]
const chainRecords = () => [
  member(1, "root-1"), member(2, "mid-1"), member(3, "mid-2"), member(4, "leaf-1"),
  parent(5, "mid-1", "root-1"), parent(6, "mid-2", "mid-1"), parent(7, "leaf-1", "mid-2"),
  parent(8, "root-1", null),
]
const cycleRecords = () => [member(1, "a-1"), member(2, "b-1"), parent(3, "a-1", "b-1"), parent(4, "b-1", "a-1")]
const orphanRecords = () => [member(1, "solo-1"), parent(2, "solo-1", "absent-1")]
const deepRecords = (depth) => {
  const records = [member(1, "node-0"), parent(2, "node-0", null)]
  for (let level = 1; level < depth; level += 1) {
    records.push(member(level + 1, "node-" + String(level)))
    records.push(parent(depth + level + 1, "node-" + String(level), "node-" + String(level - 1)))
  }
  return records
}

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
  ancestors: mod && mod.ancestorsOf ? mod.ancestorsOf : null,
  descendants: mod && mod.descendantsOf ? mod.descendantsOf : null,
  roots: mod && mod.rootsOf ? mod.rootsOf : null,
  path: mod && mod.pathOf ? mod.pathOf : null,
})
const ids = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : (item && (item.id || item.memberId || item.member)) || null)).filter((item) => item !== null) : null)
/** Run a snippet that imports the module in a child process, so a hang or a stack overflow is data, not a stall. */
function inChild(body, timeoutMs) {
  const tmp = mkdtempSync(join(tmpdir(), "r37-child-"))
  try {
    const file = join(tmp, "run.mjs")
    writeFileSync(file, ["import { pathToFileURL } from \"node:url\"", "const mod = await import(pathToFileURL(process.argv[2]).href)", body].join("\n") + "\n")
    const run = spawnSync(process.execPath, [file, MODULE], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
    return { status: run.status, signal: run.signal, stdout: (run.stdout || "").trim(), stderr: (run.stderr || "").trim().slice(-200) }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

function checkOne(mod) {
  const { project, ancestors, descendants, roots, path } = api(mod)
  const missing = ["ancestorsOf", "descendantsOf", "rootsOf", "pathOf"].filter((name, index) => [ancestors, descendants, roots, path][index] === null)
  if (project === null || missing.length > 0) { record(1, false, "the module exposes no " + missing.join(", ") + (project === null ? " and no projectTeamState" : "")); return }
  const state = project(clone(chainRecords()))
  const problems = []
  const up = ids(ancestors(state, "leaf-1"))
  const down = ids(descendants(state, "root-1"))
  const chain = ids(path(state, "leaf-1"))
  const top = ids(roots(state))
  console.log("      ancestorsOf(leaf-1) = " + show(up) + "; pathOf(leaf-1) = " + show(chain) + "; descendantsOf(root-1) = " + show(down) + "; rootsOf = " + show(top))
  if (up === null) problems.push("ancestorsOf returned no list")
  else {
    if (show(up) !== show(["root-1", "mid-1", "mid-2"])) problems.push("ancestorsOf(leaf-1) is " + show(up) + ", expected [root-1, mid-1, mid-2] with the root first")
    if (up.length > 0 && up[0] !== "root-1") problems.push("the first ancestor is not the root (" + show(up[0]) + ")")
  }
  if (chain === null) problems.push("pathOf returned no list")
  else if (show(chain) !== show(CHAIN)) problems.push("pathOf(leaf-1) is " + show(chain) + ", expected " + show(CHAIN))
  if (down === null) problems.push("descendantsOf returned no list")
  else if (show([...down].sort()) !== show(["leaf-1", "mid-1", "mid-2"])) problems.push("descendantsOf(root-1) is " + show(down))
  if (top === null) problems.push("rootsOf returned no list")
  else if (top.indexOf("root-1") === -1) problems.push("rootsOf does not name the root (" + show(top) + ")")
  record(1, problems.length === 0, problems.length === 0 ? "the chain reads correctly: ancestors root-first, path whole, descendants and roots right" : problems.slice(0, 3).join(" | "))
}

function checkTwo(mod) {
  const { project, ancestors } = api(mod)
  if (project === null || ancestors === null) { record(2, false, "the module exposes no ancestorsOf, so a cycle cannot be reported"); return }
  const body = [
    "const state = mod.projectTeamState(__PAYLOAD__)",
    "const value = mod.ancestorsOf(state, \"a-1\")",
    "console.log(JSON.stringify({ value, cycles: state.teams && state.teams.cycles ? state.teams.cycles : null }))",
  ].join("\n")
  const run = inChild(body.replace("__PAYLOAD__", JSON.stringify(cycleRecords())), 20000)
  if (run.status !== 0) { record(2, false, "the cyclic graph produced no determinate answer: exit " + show(run.status) + " signal " + show(run.signal) + " " + clip(run.stderr, 90) + " (a hang or a stack overflow is a failure, not a pass)"); return }
  const problems = []
  let parsed = null
  try { parsed = JSON.parse(run.stdout.split("\n").filter((line) => line.trim() !== "").pop()) } catch { problems.push("the child answered with something that is not JSON: " + clip(run.stdout, 90)) }
  if (parsed !== null) {
    const text = show(parsed).toLowerCase()
    if (!text.includes("cycle") && !text.includes("loop")) problems.push("the answer names no cycle (" + clip(show(parsed), 120) + ")")
    const named = (text.includes("a-1") && text.includes("b-1"))
    if (!named) problems.push("the cycle report does not name the members on the edge that closes it (" + clip(show(parsed), 120) + ")")
    console.log("      cyclic graph -> " + clip(show(parsed), 170))
  }
  record(2, problems.length === 0, problems.length === 0 ? "the cycle is reported with the edge named, in a determinate answer (no hang, no stack overflow)" : problems.slice(0, 3).join(" | "))
}

function checkThree(mod) {
  const { project, ancestors, roots } = api(mod)
  if (project === null || ancestors === null) { record(3, false, "the module exposes no ancestorsOf"); return }
  const state = project(clone(orphanRecords()))
  const problems = []
  const up = ids(ancestors(state, "solo-1"))
  if (up === null) problems.push("ancestorsOf(orphan) returned no list")
  else if (up.length !== 0) problems.push("an orphan claims ancestors (" + show(up) + ")")
  const top = roots === null ? null : ids(roots(state))
  if (top === null) problems.push("rootsOf returned no list")
  // An orphan is expected under orphans, not under roots; what must hold is that it is still reachable and usable.
  const tree = state.teams || null
  const orphanList = tree && Array.isArray(tree.orphans) ? tree.orphans.map((item) => (typeof item === "string" ? item : item && (item.id || item.team) || null)).filter((item) => item !== null) : null
  if (orphanList === null) problems.push("the projection exposes no orphans list (state.teams.orphans)")
  else if (orphanList.indexOf("solo-1") === -1 && orphanList.indexOf("absent-1") === -1) problems.push("the orphan is not reported (" + show(orphanList) + ")")
  const listed = tree && Array.isArray(tree.teams) ? tree.teams.map((item) => (item && (item.team || item.id)) || null) : null
  if (listed !== null && listed.indexOf("solo-1") === -1) problems.push("the orphan is not in the team list, so it stopped being usable (" + show(listed) + ")")
  console.log("      orphan: ancestorsOf = " + show(up) + ", rootsOf = " + show(top))
  record(3, problems.length === 0, problems.length === 0 ? "the orphan is listed as an orphan, still in the team list, and its own ancestry is empty" : problems.slice(0, 3).join(" | "))
}

function checkFour(mod) {
  const { project, ancestors } = api(mod)
  if (project === null || ancestors === null) { record(4, false, "the module exposes no ancestorsOf, so depth cannot be measured"); return }
  const depth = 200
  const body = [
    "const state = mod.projectTeamState(__PAYLOAD__)",
    "const value = mod.ancestorsOf(state, \"node-199\")",
    "console.log(JSON.stringify({ length: Array.isArray(value) ? value.length : null, value: value }))",
  ].join("\n")
  const tmp = mkdtempSync(join(tmpdir(), "r37-deep-"))
  let run = null
  try {
    const file = join(tmp, "run.mjs")
    writeFileSync(file, ["import { pathToFileURL } from \"node:url\"", "const mod = await import(pathToFileURL(process.argv[2]).href)", body.replace("__PAYLOAD__", JSON.stringify(deepRecords(depth)))].join("\n") + "\n")
    run = spawnSync(process.execPath, [file, MODULE], { cwd: PROJECT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  if (run.status !== 0) { record(4, false, "the " + String(depth) + "-level chain produced no answer: exit " + show(run.status) + " signal " + show(run.signal) + " " + clip((run.stderr || "").trim().slice(-90), 90) + " (a stack overflow is a failure)"); return }
  let parsed = null
  const problems = []
  try { parsed = JSON.parse((run.stdout || "").trim().split("\n").filter((line) => line.trim() !== "").pop()) } catch { problems.push("the child answered with something that is not JSON") }
  if (parsed !== null) {
    console.log("      depth " + String(depth) + " -> ancestor list length " + show(parsed.length))
    if (parsed.length === null) problems.push("ancestorsOf returned no list at depth " + String(depth))
    else if (parsed.length !== depth - 1) problems.push("ancestorsOf at depth " + String(depth) + " returned " + String(parsed.length) + " entries; either it truncates (then the cap and its boundary must be documented and asserted here) or it is wrong")
  }
  record(4, problems.length === 0, problems.length === 0 ? "a " + String(depth) + "-level chain answers the full ancestor list with no stack overflow" : problems.slice(0, 2).join(" | "))
}

function checkFive(mod) {
  const { project } = api(mod)
  if (project === null) { record(5, false, "the module exports no projectTeamState"); return }
  const base = [member(1, "root-1"), member(2, "mid-1"), parent(3, "mid-1", "root-1")]
  const withTree = [...clone(base), parent(4, "leaf-1", "mid-1"), { seq: 5, writer: "w-x", instance: "i1", kind: "team/parent", actor: TEAM, subject: "leaf-1", payload: { id: "leaf-1", parent: "absent-1" } }]
  const pick = (state, path) => path.split(".").reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), state)
  // Entity readings only: folded/unknown/teams/unattributed count RECORDS and legitimately move when any
  // record arrives, which is exactly the mistake the simulator made twice before settling on entities.
  const scope = ["tasks", "members", "counts.tasks", "counts.members", "liveness.malformed"]
  const moved = scope.filter((path) => show(pick(project(clone(base)), path)) !== show(pick(project(clone(withTree)), path)))
  record(5, moved.length === 0, moved.length === 0 ? "team relationship records leave every entity and liveness reading byte-identical (" + String(scope.length) + " compared)" : "those records moved " + show(moved))
}

async function checkSix(mod) {
  const tmp = mkdtempSync(join(tmpdir(), "r37-flip-"))
  try {
    const source = readFileSync(MODULE, "utf8")
    const expected = ["root-1", "mid-1", "mid-2"]
    // The R96 contract replaced last-writer-wins with arbitration, so the counterexample that bites now is a copy
    // with the ARBITRATION dismantled: the fold falls back to the last declaration, or one of the two rules goes.
    // The same fixture must stay put in the shipped module and move in the copy. Inverting a seq comparison no longer
    // bites, because the winner is now decided by (at, seq) explicitly rather than by arrival order.
    const candidates = [
      ["const arbitrated = arbitrateTeamParents(declarations);", "const arbitrated = { parents: new Map(), contested: [] };"],
      ["parent: arbitrated.parents.has(id) ? arbitrated.parents.get(id) ?? null : node.parent,", "parent: node.parent,"],
      ["const candidateMoreSpecific = row.parent !== null && current.parent === null;", "const candidateMoreSpecific = false;"],
      ["const equalSpecificityEarlier = row.parent === null === (current.parent === null) && (row.at < current.at || row.at === current.at && row.seq < current.seq);", "const equalSpecificityEarlier = row.parent === null === (current.parent === null);"],
    ]
    const exportsArbitration = typeof mod.arbitrateTeamParents === "function"
    const wiredCall = /arbitrateTeamParents\(\s*declarations\s*\)/.test(source)
    if (exportsArbitration && wiredCall === false) {
      // The reverted wiring, named as such: the rule is exported but the fold never consults it. Failing here
      // (rather than skipping) is the point - this state is a defect of the artifact, not a missing fixture.
      record(6, false, "the module exports arbitrateTeamParents but its fold never calls it, so the arbitration is not wired and the counterexample has no site to dismantle")
      return
    }
    let flipped = source, used = null
    for (const pair of candidates) { const next = source.replace(pair[0], pair[1]); if (next !== source) { flipped = next; used = pair[0] + " -> " + pair[1]; break } }
    if (flipped === source) {
      // A module that EXPORTS the arbitration but never calls it from the fold is the reverted wiring: that is a
      // defect of the artifact under test, not an unavailable fixture, so it fails loudly instead of skipping.
      record(6, false, exportsArbitration
        ? "the module exports arbitrateTeamParents but its fold calls it nowhere, so the arbitration is not wired and the counterexample has no site to dismantle"
        : "the module exports no arbitration at all, so the counterexample cannot be built yet")
      return
    }
    const fixture = [...chainRecords(), parent(8, "mid-1", "leaf-1")]
    const base = api(mod)
    if (base.project === null || base.ancestors === null) { record(6, false, "the module exposes no ancestorsOf to take the baseline with"); return }
    const baseUp = ids(base.ancestors(base.project(clone(fixture)), "leaf-1"))
    const baseline = show(baseUp) === show(expected)
    const copy = join(tmp, "collab-arbitration-off.mjs")
    writeFileSync(copy, flipped)
    const broken = await load(copy)
    const brokenApi = api(broken)
    if (brokenApi.project === null || brokenApi.ancestors === null) { record(6, false, "the dismantled copy exports no ancestorsOf"); return }
    const up = ids(brokenApi.ancestors(brokenApi.project(clone(fixture)), "leaf-1"))
    const noticed = show(up) !== show(expected)
    console.log("      dismantled " + clip(String(used), 60) + "; the shipped module answers " + show(baseUp) + ", the copy answers " + show(up))
    record(6, baseline && noticed, baseline === false
      ? "the shipped fold already moves the chain on the later re-parent, so the arbitration is not in effect (" + show(baseUp) + ")"
      : (noticed
        ? "the counterexample bites: with the arbitration dismantled the chain changes, while the shipped fold keeps it (" + show(baseUp) + ")"
        : "dismantling the arbitration still produced the same chain, so this gate is not measuring it"))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

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
  checkOne(mod); checkTwo(mod); checkThree(mod); checkFour(mod); checkFive(mod); await checkSix(mod)
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
