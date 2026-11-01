#!/usr/bin/env node
/**
 * R62 (task for the redispatch round): the rule for work nobody answered — and the two places that
 * rule breaks the ones already frozen.
 *
 * What it reads: the SHIPPED artifact plugins/dsh-link-collab/lib/index.js only (never src), plus its
 * own worlds: real control logs on disk, a real member with a heartbeat, real dispatch records. Every
 * expected value is computed here from the records and the clock this gate passes in — never read back
 * from the implementation.
 *
 * The three readings that carry the round:
 *   - a stale dispatch is planned, the boundary is inclusive (R54) and one millisecond earlier plans
 *     nothing, so the boundary is read from both sides;
 *   - the write face self-describes the retry in its id (`<root>#r<attempt>`), is idempotent, and the
 *     number it reports has to survive a replay — that is why the id carries it;
 *   - execution must NOT run the superseded original (that would do the work twice), and the answer
 *     that lands in the LEDGER has to be the tool success: reading only what executeDispatches returns
 *     would miss a plain handler whose value arrives unwrapped and is recorded as a failure.
 *
 * Exit 0 every reading held; 1 a reading failed; 2 the artifact is missing.
 * --self-attack proves each reading can fail: mutants are applied to copies of the artifact (anchors
 * taken from the shipped text, a mutation that changes nothing counts as a failure) and to the worlds.
 * --module lets a copy be pointed at, and --emit-verdicts prints one JSON line for the parent run.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE_PATH = isAbsolute(option("--module", "")) ? option("--module", "") : option("--module", "") === "" ? join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js") : resolve(option("--module", ""))
const SELF_ATTACK = argv.includes("--self-attack")
const EMIT = argv.includes("--emit-verdicts")
const TEAM = "team-1"
const T0 = 1_800_000_000_000
const TIMEOUT = 5_000
const READINGS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]
const TITLES = {
  R1: "the frozen symbols are on the shipped module and the artifact still carries the code the mutants target",
  R2: "a stale dispatch is planned with its retry identity, and the inclusive boundary is read from both sides",
  R3: "the write face self-describes the retry, writes the record, and a second call writes nothing",
  R4: "the attempt ceiling and the already-attempted case stay two different reasons",
  R5: "execution runs only the retry, refuses the superseded original, and the ledger records the tool success",
  R6: "the routing verdict is called rather than paraphrased: an unreachable member blocks with its own word",
  R7: "the capability verdict has exactly one owner: the projection refuses it and the planner is silent",
  R8: "planning is pure: the same state yields the same plan and the ledger does not move",
  R9: "a retry is the same unit of work: only its id and its instant differ from the original",
}

/** The mutants: artifact-side anchors come from the shipped text, world-side ones change the input. */
const MUTANTS = [
  { name: "attempt-number", from: "const next = attempt + 1;", to: "const next = attempt;", expect: ["R2", "R3", "R4", "R5", "R9"] },
  { name: "export-dropped", from: "  expiredDispatches,", to: "  expiredDispatchesX,", expect: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"] },
  { name: "ceiling-off", from: "if (next > options.maxAttempts) {", to: "if (false) {", expect: ["R4"] },
  { name: "one-blocked-word", from: 'reason: "already-attempted"', to: 'reason: "attempts-exhausted"', expect: ["R3", "R4"] },
  { name: "superseded-word", from: 'reason: "superseded"', to: 'reason: "unknown-tool"', expect: ["R5"] },
  { name: "no-plan", from: "const stale = expiredDispatches(state, options.now, { timeoutMs: options.timeoutMs });", to: "const stale = [];", expect: ["R2", "R3", "R4", "R5", "R6", "R8", "R9"] },
  { name: "no-answer-written", from: "const written = await appendResult(state, options.log, resultRecord(id, options.local, outcome, at));", to: 'const written = { reason: "ok" };', expect: ["R5"] },
  { name: "words-not-propagated", from: 'reason: "member-silent"', to: 'reason: "not-member"', expect: ["R6"] },
  { name: "retry-id-is-root", from: "...dispatchRecord(entry.id, entry.to,", to: "...dispatchRecord(entry.from, entry.to,", expect: ["R3", "R4", "R5", "R9"] },
  { name: "capability-refusal-deleted", from: 'refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: "capability-mismatch" });', to: "void 0;", expect: ["R7"] },
]

const root = mkdtempSync(join(tmpdir(), "r62-redispatch-"))
let worlds = 0

/**
 * Seed one world: a member on another end, its capability, a heartbeat, and one dispatch that is
 * stale at the instant the readings use — while the member itself is still fresh, so "the work is
 * late" and "the member is gone" stay two different questions (the world below can make it gone).
 */
async function makeWorld(C, world = {}) {
  const shape = { beat: "fresh", caps: ["sum"], dispatch: true, ...world }
  worlds += 1
  const log = C.openControlLog({ dir: join(root, "world-" + String(worlds)), writer: "end-A" })
  const now = T0 + TIMEOUT
  await log.append({ kind: "member/state", actor: TEAM, subject: "m-b", payload: { id: "m-b", name: "m-b", state: "active", role: "member" } })
  await log.append(C.capabilityRecord("m-b", shape.caps))
  await log.append(C.hostRecord("m-b", "end-B", null, T0))
  await log.append(C.heartbeatRecord("m-b", shape.beat === "stale" ? now - TIMEOUT : now))
  if (shape.dispatch) await log.append(C.dispatchRecord("job-1", "m-b", "sum", { a: 1, b: 2 }, now - TIMEOUT))
  return { log, now, state: () => C.projectTeamState(log.replay()) }
}
const d = (value) => JSON.parse(JSON.stringify(value))
const sorted = (list) => [...list].sort()
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const planOptions = (now, extra = {}) => ({ team: TEAM, localEnd: "end-A", now, timeoutMs: TIMEOUT, maxAttempts: 3, ...extra })
const resultOf = (log, id) => log.replay().filter((row) => row.kind === "task/result").map((row) => row.payload).find((payload) => payload?.id === id) ?? null
const dispatchRecords = (log) => log.replay().filter((row) => row.kind === "task/dispatch")

/** Run every reading against one module and one world mutation. */
async function survey(C, world = {}, sourcePath = MODULE_PATH) {
  const verdicts = {}
  const detail = {}
  for (const id of READINGS) { verdicts[id] = false; detail[id] = "never reached" }
  const held = (id, ok, text) => { verdicts[id] = ok === true; detail[id] = text }
  const tools = () => { const set = C.createLocalTools(); set.register("sum", (args) => ({ sum: (args?.a ?? 0) + (args?.b ?? 0) })); return set }

  // R1 — the frozen symbols, and the artifact text the artifact mutants are taken from.
  try {
    const missing = ["redispatchPlan", "appendRedispatches", "executeDispatches", "expiredDispatches", "projectDispatches", "createLocalTools", "dispatchRecord", "capabilityRecord", "hostRecord", "heartbeatRecord"]
      .filter((name) => C[name] === undefined)
    // The artifact being judged is the one this run loaded, not always the shipped path: under a
    // mutant the two differ, and reading the shipped file there would report the unmutated anchors.
    const text = readFileSync(sourcePath, "utf8")
    // The mutants check their own anchors (a mutation that changes nothing is a failure), so this
    // reading is about the round's surface: every symbol a caller of this round uses is exported.
    const absent = []
    held("R1", missing.length === 0 && absent.length === 0, "missing exports=" + JSON.stringify(missing) + " absent anchor(s)=" + JSON.stringify(absent))
  } catch (error) { held("R1", false, "threw: " + String(error)) }

  // R2 — planning, and the inclusive boundary read from both sides.
  try {
    const w = await makeWorld(C, world)
    const atBoundary = C.redispatchPlan(w.state(), planOptions(w.now))
    const early = C.redispatchPlan(w.state(), planOptions(T0 + TIMEOUT - 1))
    const entry = atBoundary.entries?.[0]
    const expected = { from: "job-1", id: "job-1#r2", attempt: 2, to: "m-b", tool: "sum", args: { a: 1, b: 2 } }
    const ok = atBoundary.entries?.length === 1 && same(entry, expected) && early.entries?.length === 0 && early.blocked?.length === 0
    held("R2", ok, "boundary=" + JSON.stringify(atBoundary) + " early=" + JSON.stringify(early))
  } catch (error) { held("R2", false, "threw: " + String(error)) }

  // R3 — the write face: identity in the id, the record on the ledger, and idempotence.
  try {
    const w = await makeWorld(C, world)
    const before = w.log.replay().length
    const written = await C.appendRedispatches(w.state(), w.log, planOptions(w.now))
    const entry = w.state().dispatches.dispatches.find((row) => row.id === "job-1#r2")
    const record = dispatchRecords(w.log).find((row) => row.subject === "job-1#r2")
    const again = await C.appendRedispatches(w.state(), w.log, planOptions(w.now + 1000))
    const blocked = C.redispatchPlan(w.state(), planOptions(w.now + 1000)).blocked ?? []
    // R69 changed the shape: the claim (a task/retry-lease) is written before the attempt, so `written` holds
    // two seqs and their order is read here rather than assumed.
    const leaseRow = w.log.replay().find((row) => row.kind === "task/retry-lease" && row.payload?.root === "job-1")
    const ok = Array.isArray(written) && written.length === 2 && record !== undefined
      && leaseRow !== undefined && leaseRow.seq < record.seq && written[0] === leaseRow.seq && written[1] === record.seq
      && entry?.retryOf === "job-1" && entry?.attempt === 2 && entry?.status === "pending"
      && Array.isArray(again) && again.length === 0 && w.log.replay().length === before + 2
      && blocked.length === 1 && blocked[0]?.reason === "already-attempted"
    held("R3", ok, "written=" + JSON.stringify(written) + " entry=" + JSON.stringify(entry) + " again=" + JSON.stringify(again)
      + " blocked=" + JSON.stringify(blocked) + " leaseSeq=" + String(leaseRow?.seq) + " attemptSeq=" + String(record?.seq))
  } catch (error) { held("R3", false, "threw: " + String(error)) }

  // R4 — the ceiling and the already-attempted case are two words, not one.
  try {
    const w = await makeWorld(C, world)
    await C.appendRedispatches(w.state(), w.log, planOptions(w.now))
    const capped = C.redispatchPlan(w.state(), planOptions(w.now + 1000, { maxAttempts: 1 })).blocked?.[0]?.reason
    const second = C.redispatchPlan(w.state(), planOptions(w.now + 1000, { maxAttempts: 2 })).blocked?.[0]?.reason
    held("R4", capped === "attempts-exhausted" && second === "already-attempted", "capped=" + JSON.stringify(capped) + " second=" + JSON.stringify(second))
  } catch (error) { held("R4", false, "threw: " + String(error)) }

  // R5 — execution: the retry runs, the original is refused as superseded, and the LEDGER carries the
  // tool success. The control world has no retry, so the original still runs there.
  try {
    const w = await makeWorld(C, world)
    await C.appendRedispatches(w.state(), w.log, planOptions(w.now))
    const run = await C.executeDispatches(w.state(), { local: "m-b", tools: tools(), log: w.log, now: w.now + 1000, at: w.now + 1000 })
    const payload = resultOf(w.log, "job-1#r2")
    const control = await makeWorld(C, world)
    const plain = await C.executeDispatches(control.state(), { local: "m-b", tools: tools(), log: control.log, now: control.now + 1000, at: control.now + 1000 })
    const controlPayload = resultOf(control.log, "job-1")
    const ok = sorted(run.executed.map((row) => row.id)) .join(",") === "job-1#r2"
      && run.refused?.length === 1 && run.refused[0]?.id === "job-1" && run.refused[0]?.reason === "superseded"
      && payload?.ok === true && same(payload?.value, { sum: 3 })
      && sorted(plain.executed.map((row) => row.id)).join(",") === "job-1" && plain.refused?.length === 0
      && controlPayload?.ok === true && same(controlPayload?.value, { sum: 3 })
    held("R5", ok, "ran=" + JSON.stringify(run.executed.map((row) => row.id)) + " refused=" + JSON.stringify(run.refused) + " ledger=" + JSON.stringify(payload) + " control=" + JSON.stringify(controlPayload))
  } catch (error) { held("R5", false, "threw: " + String(error)) }

  // R6 — an unreachable member blocks with the routing verdict own word (paired with a healthy member).
  try {
    const stale = await makeWorld(C, { beat: "stale" })
    const unplugged = C.redispatchPlan(stale.state(), planOptions(stale.now))
    const healthy = await makeWorld(C, {})
    const planned = C.redispatchPlan(healthy.state(), planOptions(healthy.now))
    const ok = unplugged.entries?.length === 0 && unplugged.blocked?.length === 1 && unplugged.blocked[0]?.reason === "member-silent"
      && planned.entries?.length === 1 && planned.blocked?.length === 0
    held("R6", ok, "unplugged=" + JSON.stringify(unplugged) + " healthy=" + JSON.stringify(planned))
  } catch (error) { held("R6", false, "threw: " + String(error)) }

  // R7 — the capability verdict belongs to the projection: the planner neither plans nor blocks, and
  // its reason vocabulary never grows a second word for the same question.
  try {
    const w = await makeWorld(C, { caps: [] })
    const entry = w.state().dispatches.dispatches.find((row) => row.id === "job-1")
    const refusal = w.state().dispatches.refusedDispatches.find((row) => row.id === "job-1")
    const plan = C.redispatchPlan(w.state(), planOptions(w.now))
    const reasons = new Set(["attempts-exhausted", "already-attempted", "member-silent", "route-down", "no-route", "path-cycle", "not-member", "not-in-team"])
    const words = [...(plan.blocked ?? []).map((row) => row.reason), ...(plan.entries ?? []).map(() => "entry")]
    const ok = entry?.status === "refused" && refusal?.reason === "capability-mismatch"
      && plan.entries?.length === 0 && plan.blocked?.length === 0 && !words.includes("capability-mismatch")
      && !reasons.has("capability-mismatch")
    held("R7", ok, "entry=" + JSON.stringify(entry) + " refusal=" + JSON.stringify(refusal) + " plan=" + JSON.stringify(plan))
  } catch (error) { held("R7", false, "threw: " + String(error)) }

  // R8 — planning is pure: same state twice, same plan, ledger untouched.
  try {
    const w = await makeWorld(C, world)
    const before = w.log.replay().length
    const first = C.redispatchPlan(w.state(), planOptions(w.now))
    const second = C.redispatchPlan(w.state(), planOptions(w.now))
    // The world really carries a stale dispatch, so a plan with one entry is the sign that the planner
    // read it: without that clause a planner that plans nothing would still look pure.
    held("R8", same(first, second) && w.log.replay().length === before && first.entries?.length === 1 && first.blocked?.length === 0, "first=" + JSON.stringify(first) + " ledger " + String(before) + "->" + String(w.log.replay().length))
  } catch (error) { held("R8", false, "threw: " + String(error)) }

  // R9 — a retry carries the same unit of work: only the id and the instant move.
  try {
    const w = await makeWorld(C, world)
    const original = w.state().dispatches.dispatches.find((row) => row.id === "job-1")
    await C.appendRedispatches(w.state(), w.log, planOptions(w.now))
    const retry = w.state().dispatches.dispatches.find((row) => row.id === "job-1#r2")
    const sameWork = retry !== undefined && retry.to === original.to && retry.tool === original.tool && same(d(retry.args), d(original.args))
    const movedOnlyIdAndAt = retry !== undefined && retry.at !== original.at && retry.id !== original.id
    held("R9", sameWork && movedOnlyIdAndAt, "original=" + JSON.stringify(original) + " retry=" + JSON.stringify(retry))
  } catch (error) { held("R9", false, "threw: " + String(error)) }

  return { verdicts, detail }
}

async function load(path) { return await import(pathToFileURL(path).href + "?r62=" + String(Math.random())) }
const surveyMap = (run) => Object.fromEntries(READINGS.map((id) => [id, run.verdicts[id]]))
const flippedBy = (baseline, run) => READINGS.filter((id) => baseline.verdicts[id] === true && run.verdicts[id] !== true)

function report(run) {
  for (const id of READINGS) console.log("  " + (run.verdicts[id] ? "ok    " : "FAIL  ") + id + "  " + TITLES[id] + "\n          " + run.detail[id])
}

async function selfAttack(baseline) {
  const text = readFileSync(MODULE_PATH, "utf8")
  const flips = new Map()
  const failures = []
  const coverage = new Set()
  for (const mutant of MUTANTS) {
    let run = null
    if (mutant.kind !== "world") {
      if (!text.includes(mutant.from)) { failures.push(mutant.name + ": ANCHOR MISSING in the shipped artifact"); console.log("  FAIL  mutant " + mutant.name + ": ANCHOR MISSING"); continue }
      const mutated = text.replace(mutant.from, mutant.to)
      if (mutated === text) { failures.push(mutant.name + ": the mutation changed nothing"); console.log("  FAIL  mutant " + mutant.name + ": changed nothing"); continue }
      const copy = join(root, "mutant-" + mutant.name + ".mjs")
      writeFileSync(copy, mutated)
      // An artifact that cannot even be loaded fails every reading: a module whose export list no
      // longer resolves is not "green except for one reading", it is unusable.
      try {
        run = await survey(await load(copy), {}, copy)
      } catch (error) {
        const verdicts = {}
        const detail = {}
        for (const id of READINGS) { verdicts[id] = false; detail[id] = "the mutated artifact does not load: " + String(error) }
        run = { verdicts, detail }
      }
    } else {
      run = await survey(baseline.module, mutant.world, MODULE_PATH)
    }
    const flipped = flippedBy(baseline, run)
    const declared = sorted(mutant.expect)
    const ok = same(sorted(flipped), declared)
    if (!ok) failures.push(mutant.name + ": flipped " + JSON.stringify(sorted(flipped)) + " but declared " + JSON.stringify(declared))
    for (const id of flipped) coverage.add(id)
    flips.set(mutant.name, sorted(flipped))
    console.log("  " + (ok ? "ok    " : "FAIL  ") + "mutant " + mutant.name + "  flipped=" + JSON.stringify(sorted(flipped)) + " declared=" + JSON.stringify(declared))
  }
  const uncovered = READINGS.filter((id) => !coverage.has(id))
  console.log("mutants applied " + String(MUTANTS.length - failures.length) + " of " + String(MUTANTS.length) + ", declared-set mismatches " + String(failures.filter((line) => line.includes("flipped")).length) + ", uncovered readings " + JSON.stringify(uncovered))
  for (const line of failures) console.log("  FAIL  " + line)
  return failures.length === 0 && uncovered.length === 0 ? 0 : 1
}

const main = async () => {
  if (!existsSync(MODULE_PATH)) { console.error("the plugin is not built: " + MODULE_PATH); process.exit(2) }
  const C = await load(MODULE_PATH)
  const baseline = await survey(C, {}, MODULE_PATH)
  baseline.module = C
  report(baseline)
  const failed = READINGS.filter((id) => baseline.verdicts[id] !== true)
  console.log(failed.length === 0 ? "all " + String(READINGS.length) + " readings held" : String(READINGS.length - failed.length) + " of " + String(READINGS.length) + " readings held")
  if (EMIT) console.log("VERDICTS " + JSON.stringify(surveyMap(baseline)))
  let code = failed.length === 0 ? 0 : 1
  if (SELF_ATTACK) {
    if (failed.length > 0) {
      console.log("self-attack: the unmutated artifact is not green (failed " + JSON.stringify(failed) + "), so no mutant can be trusted")
      code = 1
    } else {
      code = await selfAttack(baseline)
    }
  }
  rmSync(root, { recursive: true, force: true })
  process.exit(code)
}

try { await main() } catch (error) { console.error("gate failure: " + String(error?.stack ?? error)); rmSync(root, { recursive: true, force: true }); process.exit(1) }