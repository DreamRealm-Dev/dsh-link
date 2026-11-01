#!/usr/bin/env node
/**
 * R60: the device net's harder shapes — three hops, a cycle, and liveness read at CHOSEN instants.
 *
 * The two device-net gates beside this one read a one-hop join and a two-hop transit. What is left is
 * the shape a network grows into: a three-hop chain that work travels along and answers come back down,
 * two ends whose `via` points at each other (a cycle has to be a verdict, not a wait), and liveness
 * judged from the instants the records carry instead of from the wall clock, so "a live transit behind
 * a quiet member" is decided rather than waited for (the debt recorded when that reading had to use a
 * real-time threshold).
 *
 * It reads the SHIPPED artifact plugins/dsh-link-collab/lib/index.js only, drives the shipped foreign
 * reference implementation as real child processes, and never imports the producer's own self-check.
 *
 * Exit 0 every reading held; 1 a reading failed; 3 an input is missing.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttp } from 'node:http'
import { createServer as createTcp } from 'node:net'
import { createInterface } from 'node:readline'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const FOREIGN = option("--foreign", join(PROJECT, "tools", "foreign-harness", "foreign-end.mjs"))
const SHIPPED_MODULE = option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js"))
const SHIPPED_PAGE = option("--page", join(PROJECT, "docs", "protocol", "device-net-v1.md"))
const CHECKER = option("--checker", join(PROJECT, "scripts", "check-protocol-page.mjs"))
const SELF_ATTACK = argv.includes("--self-attack")
const ONLY_MUTANT = option("--only-mutant", null)

const TOKEN = "r60-token"
const NOW = 1_800_000_000_000
const TIMEOUT = 5_000
const LATER = NOW + 10 * TIMEOUT
const END_A = "end-A"
const PATH = "/api/dsh-link-collab/relay"
const TEAM = "team-1"

if (!existsSync(SHIPPED_MODULE)) { console.error("the plugin is not built: " + SHIPPED_MODULE); process.exit(3) }
if (!existsSync(FOREIGN)) { console.error("the foreign reference implementation is missing: " + FOREIGN); process.exit(3) }

/** The artifact and the page are re-pointable so a mutant can be run against a copy of them. */
let MODULE = SHIPPED_MODULE
let PAGE = SHIPPED_PAGE
let C = null
const loadModule = async (path) => { C = await import(pathToFileURL(path).href + "?r60=" + String(Date.now()) + String(Math.random())) }
await loadModule(MODULE)

const fixtures = []
const record = (id, ok, detail) => fixtures.push({ id, ok: ok === true, detail })
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const freePort = () => new Promise((settle) => { const probe = createTcp(); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => settle(port)) }) })
const urlOn = (port) => "http://127.0.0.1:" + String(port) + PATH
const OWN = (log) => ({ writer: log.writer, instance: log.instance, records: log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) })
const waitFor = async (check, budget = 120) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await sleep(100) } return check() }

/** Our end: a real control log behind a real HTTP route, using the artifacts the product ships. */
async function openOurEnd(root) {
  const log = C.openControlLog({ dir: join(root, "end-A"), writer: END_A })
  const endpoint = C.createRelayEndpoint({ token: TOKEN, log })
  const server = createHttp(endpoint.handler)
  await new Promise((settle) => server.listen(0, "127.0.0.1", settle))
  const url = "http://127.0.0.1:" + String(server.address().port) + endpoint.path
  return {
    log,
    url,
    state: () => C.projectTeamState(log.replay()),
    push: async (target) => fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN },
      body: JSON.stringify(OWN(log)),
    }),
    close: async () => { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); server.close(); await log.close() },
  }
}

/**
 * One foreign end as a real child process. Every flag appears exactly once: the reference reader takes
 * the FIRST match, so a duplicate would silently point the reading at another port (R59 paid for that).
 */
function spawnEnd(root, spec, owned) {
  const args = ["--token", TOKEN, "--rounds", String(spec.rounds ?? 400), "--home", join(root, spec.name),
    "--writer", spec.name, "--member", spec.member, "--end", spec.end, "--port", String(spec.port), "--peer", spec.peer]
  if (spec.via !== undefined && spec.via !== null) args.push("--via", spec.via)
  if (spec.tool !== undefined) args.push("--tool", spec.tool)
  if (spec.at !== undefined) args.push("--at", String(spec.at))
  if (spec.forward !== undefined) args.push("--forward", spec.forward.join(","))
  if (spec.beatEvery !== undefined) args.push("--beat-every", String(spec.beatEvery))
  const child = spawn(process.execPath, [FOREIGN, ...args], { stdio: ["ignore", "pipe", "inherit"] })
  const state = { name: spec.name, pid: child.pid, ready: null, forwards: [] }
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message = null
    try { message = JSON.parse(line) } catch { return }
    if (message.ready === true) state.ready = message
    if (message.wire === "forward") state.forwards.push(message)
  })
  owned.push({ child, state })
  return state
}

/** A whole world: our end plus the foreign ends, torn down whatever the reading does. */
async function withWorld(body) {
  const root = mkdtempSync(join(tmpdir(), "r60-variants-"))
  const owned = []
  const ours = await openOurEnd(root)
  try {
    return await body({ root, ours, spawn: (spec) => spawnEnd(root, spec, owned) })
  } finally {
    for (const { child } of owned) child.kill()
    await ours.close()
    rmSync(root, { recursive: true, force: true })
  }
}

// ------------------------------------------------------------------------------------------------
// R1 — a three-hop chain: the far member joins through two transits, work travels it, the answer returns.
const readChain = (mutant) => withWorld(async ({ ours, spawn }) => {
  const portT1 = await freePort(), portT2 = await freePort(), portB = await freePort()
  const urlT1 = urlOn(portT1), urlT2 = urlOn(portT2), urlB = urlOn(portB)
  spawn({ name: "foreign-t1", member: "m-t1", end: "T1-end", via: null, peer: ours.url, forward: [urlT2, ours.url], port: portT1, at: NOW - 100 })
  spawn({ name: "foreign-t2", member: "m-t2", end: "T2-end", via: "T1-end", peer: urlT1, forward: [urlB, ours.url], port: portT2, at: NOW - 200 })
  spawn({ name: "foreign-b", member: "m-b", end: "B-end", via: mutant === "chain-far-direct" ? null : "T2-end", peer: urlT2, tool: "sum", port: portB, at: NOW - 300 })
  const joined = await waitFor(() => ["m-t1", "m-t2", "m-b"].every((id) => ours.state().members.some((row) => row.id === id)))
  const route = C.routes(ours.state(), END_A, NOW, { timeoutMs: TIMEOUT }).find((row) => row.member === "m-b")
  const admitted = C.assignThrough(ours.state(), TEAM, "m-b", END_A, NOW, { timeoutMs: TIMEOUT })
  const chainOk = joined
    && route !== undefined && JSON.stringify(route.path) === JSON.stringify([END_A, "T1-end", "T2-end", "B-end"]) && route.hops === 3
    && admitted.ok === true && admitted.hops === 3
  if (!chainOk) return { ok: false, detail: "members=" + JSON.stringify(ours.state().members.map((row) => row.id)) + " route=" + JSON.stringify(route ?? null) + " admit=" + JSON.stringify(admitted) }
  await ours.log.append(C.dispatchRecord("job-3hop", "m-b", "sum", { a: 40, b: 2 }, NOW))
  const pushed = await ours.push(urlT1)
  const answered = await waitFor(() => C.resolveDispatch(ours.state(), "job-3hop", NOW).verdict === "answered")
  const entry = ours.state().dispatches.dispatches.find((row) => row.id === "job-3hop")
  const ledgerResults = ours.log.replay().filter((row) => row.kind === "task/result").length
  const ok = pushed.status === 200 && answered && entry?.result?.ok === true
    && JSON.stringify(entry.result.value) === JSON.stringify({ sum: 42 }) && ledgerResults === 1
  return { ok, detail: "route hops=" + String(route.hops) + " push=" + String(pushed.status) + " result=" + JSON.stringify(entry?.result ?? null) + " ledger task/result=" + String(ledgerResults) }
})

// ------------------------------------------------------------------------------------------------
// R2 — the two silence verdicts and a control, all read at instants that were chosen.
const quietStamp = (mutant) => {
  if (mutant === "both-future") return { t: NOW + 10 * TIMEOUT, b: NOW + 10 * TIMEOUT }
  if (mutant === "far-fresh") return { t: NOW - 100, b: NOW - 100 }
  return { t: NOW - 100, b: NOW - 9_000 }
}
const silenceWorld = (stamp) => withWorld(async ({ ours, spawn }) => {
  const portT = await freePort(), portB = await freePort()
  const urlT = urlOn(portT), urlB = urlOn(portB)
  spawn({ name: "foreign-t", member: "m-t", end: "T-end", via: null, peer: ours.url, forward: [urlB, ours.url], port: portT, at: stamp.t })
  spawn({ name: "foreign-b", member: "m-b", end: "B-end", via: "T-end", peer: urlT, tool: "sum", port: portB, at: stamp.b })
  const joined = await waitFor(() => ["m-t", "m-b"].every((id) => ours.state().members.some((row) => row.id === id)))
  const at = (now) => C.assignThrough(ours.state(), TEAM, "m-b", END_A, now, { timeoutMs: TIMEOUT })
  const transitAt = (now) => C.assignThrough(ours.state(), TEAM, "m-t", END_A, now, { timeoutMs: TIMEOUT })
  return { joined, at, transitAt }
})
const readSilence = async (mutant) => {
  const quiet = await silenceWorld(quietStamp(mutant))
  const quietVerdict = quiet.at(NOW)
  let ok = quiet.joined && quietVerdict.reason === "member-silent"
    && JSON.stringify(quietVerdict.path) === JSON.stringify([END_A, "T-end", "B-end"]) && quiet.transitAt(NOW).ok === true
  let detail = "quiet-far=" + JSON.stringify(quietVerdict) + " transit=" + JSON.stringify(quiet.transitAt(NOW))
  const fresh = await silenceWorld({ t: NOW - 100, b: NOW - 200 })
  ok = ok && fresh.at(NOW).ok === true && fresh.at(NOW).reason === "ok"
  detail += " | both-fresh=" + JSON.stringify(fresh.at(NOW))
  const dead = await silenceWorld({ t: NOW - 9_000, b: NOW - 100 })
  ok = ok && dead.at(NOW).reason === "route-down" && JSON.stringify(dead.at(NOW).path) === JSON.stringify([END_A, "T-end"])
  detail += " | quiet-transit=" + JSON.stringify(dead.at(NOW))
  return { ok, detail }
}

// ------------------------------------------------------------------------------------------------
// R3 — a cycle is a verdict with its closing edge named, not a long wait.
const readCycle = () => withWorld(async ({ ours, spawn }) => {
  const portX = await freePort(), portY = await freePort()
  spawn({ name: "foreign-x", member: "m-x", end: "X-end", via: "Y-end", peer: ours.url, port: portX, at: NOW - 100 })
  spawn({ name: "foreign-y", member: "m-y", end: "Y-end", via: "X-end", peer: ours.url, port: portY, at: NOW - 100 })
  const joined = await waitFor(() => ["m-x", "m-y"].every((id) => ours.state().members.some((row) => row.id === id)))
  const verdict = C.assignThrough(ours.state(), TEAM, "m-x", END_A, NOW, { timeoutMs: TIMEOUT })
  const failures = C.routeFailures(ours.state(), END_A, NOW, { timeoutMs: TIMEOUT })
  const listed = failures.find((row) => row.member === "m-x")
  const ok = joined && verdict.reason === "path-cycle" && Array.isArray(verdict.loop) && verdict.loop.length > 0
    && listed !== undefined && listed.reason === "path-cycle" && Array.isArray(listed.loop) && listed.loop.length > 0
  return { ok, detail: "verdict=" + JSON.stringify(verdict) + " failures=" + JSON.stringify(failures) }
})

// ------------------------------------------------------------------------------------------------
// R4 — the verdict follows the chosen instant, not the wall clock (the debt R59 recorded).
const readInstant = async (mutant) => {
  const world = await silenceWorld(quietStamp(mutant))
  const first = JSON.stringify(world.at(NOW))
  await sleep(1_500)
  const second = JSON.stringify(world.at(NOW))
  const later = JSON.stringify(world.at(LATER))
  const ok = world.joined && first === second && first !== later
  return { ok, detail: "first=" + first + " second=" + second + " later=" + later }
}

// ------------------------------------------------------------------------------------------------
// R5 — the page keeps the two citations this round's rule rests on, and the checker agrees.
const readPage = () => {
  const page = readFileSync(PAGE, "utf8")
  const rows = page.split(/\r?\n/).filter((line) => /^\| (own-page-one-hop|regroup-helper) \|/.test(line.trim()))
  const run = spawnSync(process.execPath, [CHECKER, "--page", PAGE], { encoding: "utf8" })
  const summary = (run.stdout ?? "").split(/\r?\n/).filter((line) => /citation\(s\) hold/.test(line))
  const ok = run.status === 0 && rows.length === 2 && summary.length === 1
  return { ok, detail: "checker exit=" + String(run.status) + " summary=" + JSON.stringify(summary) + " rows=" + String(rows.length) }
}

// ------------------------------------------------------------------------------------------------
const READINGS = [
  { id: "R1", title: "a three-hop chain carries work out and the answer back", run: (mutant) => readChain(mutant) },
  { id: "R2", title: "the two silence verdicts and a control, at chosen instants", run: (mutant) => readSilence(mutant) },
  { id: "R3", title: "a cycle is path-cycle with its closing edge named", run: (mutant) => readCycle(mutant) },
  { id: "R4", title: "the verdict follows the chosen instant, not the wall clock", run: (mutant) => readInstant(mutant) },
  { id: "R5", title: "the page still cites the rule, and the checker still holds", run: () => readPage() },
]
const runReadings = async (ids, mutant) => {
  const seen = []
  for (const reading of READINGS) {
    if (ids !== null && !ids.includes(reading.id)) continue
    seen.push(reading.id)
    let outcome
    try { outcome = await reading.run(mutant) } catch (error) { outcome = { ok: false, detail: "threw: " + String(error?.message ?? error) } }
    record(reading.id, outcome.ok, outcome.detail)
  }
  return seen
}

// Mutants. Anchors come from the SHIPPED artifacts: an anchor that is not there is a failure, not a skip.
const copyWith = (from, to, replace) => {
  const text = readFileSync(from, "utf8")
  const changed = replace(text)
  if (changed === text) return null
  writeFileSync(to, changed)
  return changed.length
}
const MUTANTS = [
  { name: "cycle-verdict", kind: "artifact", declared: ["R3"], only: ["R3"],
    apply: (dir) => copyWith(SHIPPED_MODULE, join(dir, "lib-cycle.js"), (text) => text.replaceAll("\"path-cycle\"", "\"no-route\"")) },
  // Declared from measurement, not from expectation: the word swap leaves R4 green, because the two
  // reads still differ in the PATH they report (full path at NOW, one hop later on) even though both
  // reasons read route-down. R4 is covered by `both-future` instead.
  { name: "silence-word", kind: "artifact", declared: ["R2"], only: ["R2", "R4"],
    apply: (dir) => copyWith(SHIPPED_MODULE, join(dir, "lib-silence.js"), (text) => text.replaceAll("\"member-silent\"", "\"route-down\"")) },
  { name: "chain-far-direct", kind: "world", declared: ["R1"], only: ["R1"] },
  { name: "far-fresh", kind: "world", declared: ["R2"], only: ["R2"] },
  { name: "both-future", kind: "world", declared: ["R2", "R4"], only: ["R2", "R4"] },
  { name: "page-row-gone", kind: "page", declared: ["R5"], only: ["R5"],
    apply: (dir) => copyWith(SHIPPED_PAGE, join(dir, "page-copy.md"), (text) => text.replace(/\n\| regroup-helper \|[^\n]*/, "")) },
]

const report = () => {
  for (const reading of fixtures) console.log("  " + (reading.ok ? "ok    " : "FAIL  ") + reading.id + "  " + reading.detail)
}

if (!SELF_ATTACK) {
  await runReadings(null, null)
  report()
  const failed = fixtures.filter((reading) => !reading.ok)
  console.log(String(fixtures.length - failed.length) + " of " + String(fixtures.length) + " readings held")
  process.exitCode = failed.length === 0 ? 0 : 1
} else {
  const dir = mkdtempSync(join(tmpdir(), "r60-attack-"))
  const baseline = []
  await runReadings(null, null)
  for (const reading of fixtures) baseline.push(reading)
  const baselineRed = baseline.filter((reading) => !reading.ok)
  if (baselineRed.length > 0) {
    for (const reading of baselineRed) console.log("  FAIL  baseline " + reading.id + "  " + reading.detail)
    console.log("the unmutated run is not green, so no mutant can be trusted")
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = 1
  } else {
    let mismatches = 0
    const flipped = new Set()
    for (const mutant of MUTANTS) {
      if (ONLY_MUTANT !== null && mutant.name !== ONLY_MUTANT) continue
      let modulePath = MODULE, pagePath = PAGE, anchor = "world"
      if (mutant.kind !== "world") {
        const size = mutant.apply(dir)
        if (size === null) { console.log("  FAIL  mutant " + mutant.name + ": ANCHOR MISSING in the shipped artifact"); mismatches += 1; continue }
        anchor = "anchored"
        if (mutant.kind === "artifact") modulePath = join(dir, mutant.name === "cycle-verdict" ? "lib-cycle.js" : "lib-silence.js")
        else pagePath = join(dir, "page-copy.md")
      }
      MODULE = modulePath
      PAGE = pagePath
      await loadModule(MODULE)
      fixtures.length = 0
      await runReadings(mutant.only, mutant.name)
      const observed = fixtures.filter((reading) => !reading.ok).map((reading) => reading.id)
      const declared = [...mutant.declared].sort()
      const sortedObserved = [...observed].sort()
      const match = JSON.stringify(declared) === JSON.stringify(sortedObserved)
      if (!match) mismatches += 1
      for (const id of sortedObserved) flipped.add(id)
      console.log("  " + (match ? "ok  " : "FAIL") + "  mutant " + mutant.name + " (" + mutant.kind + ", " + anchor + ")  declared=" + JSON.stringify(declared) + " observed=" + JSON.stringify(sortedObserved))
      // A declared reading that stayed green is where the reasoning was wrong, so its detail is printed
      // here rather than left for the next run.
      for (const id of declared) { if (sortedObserved.includes(id)) continue; const kept = fixtures.find((reading) => reading.id === id); console.log("        kept green: " + id + "  " + String(kept?.detail ?? "(never ran)")) }
    }
    MODULE = SHIPPED_MODULE
    PAGE = SHIPPED_PAGE
    await loadModule(MODULE)
    const uncovered = READINGS.map((reading) => reading.id).filter((id) => !flipped.has(id))
    for (const id of uncovered) console.log("  FAIL  uncovered reading " + id)
    console.log("coverage: " + String(READINGS.length) + " declared readings, " + String(flipped.size) + " flipped, " + String(uncovered.length) + " uncovered")
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = mismatches === 0 && uncovered.length === 0 ? 0 : 1
  }
}
