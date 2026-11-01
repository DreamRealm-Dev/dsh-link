#!/usr/bin/env node
/**
 * R57: a FOREIGN end joins the device net.
 *
 * docs/protocol/device-net-v1.md claims a process that installs none of our code can join the net by
 * speaking one HTTP route and a handful of record kinds. That page is worth something only if a process
 * sharing nothing with us can really do it, and only if the rules it promises are the rules the shipped
 * artifact enforces. So this gate drives tools/foreign-harness/foreign-end.mjs (a real child process,
 * written against the page, importing nothing from this repository) against a real route built from the
 * shipped artifact, and it writes its OWN rogue ends for the rules a well-behaved peer never breaks.
 *
 * Independence: it reads only the built module and the page, never the producer's self-check and never src.
 * Every expectation is written from the page's wording. --self-attack mutates the artifact (or the world
 * this gate builds) one way per declared mutant and requires each mutant to flip exactly its declared
 * readings, with no declared reading left uncovered.
 *
 * Exit 0 all held; 1 a reading failed; 2 a harness precondition is missing (printed).
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const SELF_ATTACK = argv.includes("--self-attack")
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const FOREIGN = join(PROJECT, "tools", "foreign-harness", "foreign-end.mjs")
const PAGE = join(PROJECT, "docs", "protocol", "device-net-v1.md")
const TEMP_ROOT = join(PROJECT, ".tmp")
const DEFAULT_PATH = "/api/dsh-link-collab/relay"
const TOKEN = "r57-secret"
const MEMBER = "m-foreign"
const TOOL = "sum"
const TEAM = "team-1"
const ROUNDS = "18"
const WORK_MS = 30_000
// The one switch a WORLD mutant uses. It changes the inputs this gate builds, never an expectation.
const WORLD = process.env.DSH_GATE_R57_WORLD ?? ""
// A reading must not be able to read the attack flags: this guard fails loudly if one ever tries.
const expectationsFrozen = Object.freeze({ DEFAULT_PATH, TOKEN, MEMBER, TOOL, TEAM })

const missing = [MODULE, FOREIGN, PAGE].filter((path) => !existsSync(path))
if (missing.length > 0) { console.error("missing input(s): " + JSON.stringify(missing)); process.exit(2) }
const MOD = await import(pathToFileURL(MODULE).href)
const moduleText = readFileSync(MODULE, "utf8")

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const now = () => Date.now()
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const tempDir = (name) => mkdtempSync(join(TEMP_ROOT, "r57-" + name + "-"))

/** Our end: a real control log from the shipped artifact, the shipped route, a real listening socket. */
const startOurEnd = async (tag) => {
  const dir = tempDir(tag)
  const log = MOD.openControlLog({ dir, writer: "gate-end" })
  const endpoint = MOD.createRelayEndpoint({ token: TOKEN, log })
  const server = createServer(endpoint.handler)
  await new Promise((settle) => server.listen(0, "127.0.0.1", settle))
  const port = server.address().port
  const state = () => MOD.projectTeamState(log.replay())
  return {
    log, endpoint, server, port, state,
    url: "http://127.0.0.1:" + String(port) + endpoint.path,
    records: () => log.replay().length,
    close: async () => { await new Promise((settle) => server.close(settle)); await log.close(); rmSync(dir, { recursive: true, force: true }) },
  }
}

/** Our own stream as a relay batch: seq is this end's own numbering, never the merged ledger's. */
const ownBatch = (log) => ({
  writer: log.writer,
  instance: log.instance,
  records: log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })),
})

/** One HTTP exchange, with every dial a refusal could depend on exposed. */
const post = async (url, options) => {
  const headers = {}
  if (options.authorization !== null && options.authorization !== undefined) headers.authorization = options.authorization
  if (options.contentType !== null && options.contentType !== undefined) headers["content-type"] = options.contentType
  const response = await fetch(url, { method: options.method ?? "POST", headers, body: options.body ?? undefined, signal: AbortSignal.timeout(20_000) })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

/** A rogue batch: writer and instance are ours to choose, so the identity rules can be broken on purpose. */
const batch = (writer, instance, rows, adopt) => ({
  writer, instance,
  ...(adopt === true ? { adopt: true } : {}),
  records: rows.map((row, index) => ({ seq: row.seq ?? index + 1, at: row.at ?? now(), ...row })),
})
const memberRow = (id, seq, actor) => ({ kind: "member/state", actor: actor ?? TEAM, subject: id, seq: seq ?? 1, payload: { id, name: id, state: "active", role: "member" } })

/** The foreign end this gate drives: a real child process, plus the lines it prints. */
const startForeign = async (options) => {
  const home = tempDir(options.tag)
  const args = [FOREIGN, "--home", home, "--peer", options.peer, "--token", TOKEN, "--port", "0",
    "--member", options.member, "--team", TEAM, "--tool", TOOL, "--rounds", ROUNDS, "--writer", options.writer]
  if (options.capability !== undefined) args.push("--capability", options.capability)
  if (options.noHeartbeat === true) args.push("--no-heartbeat")
  if (options.spoofFrom !== undefined) args.push("--spoof-from", options.spoofFrom)
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] })
  const state = { lines: [], stderr: [], ready: null, done: null, dying: null, pid: child.pid, home }
  let carry = ""
  child.stdout.on("data", (chunk) => {
    carry += chunk.toString("utf8")
    const parts = carry.split(String.fromCharCode(10))
    carry = parts.pop() ?? ""
    for (const line of parts) {
      if (line.trim() === "") continue
      let parsed = null
      try { parsed = JSON.parse(line) } catch { parsed = { unparsed: line } }
      state.lines.push(parsed)
      if (parsed.ready === true) state.ready = parsed
      if (parsed.done === true) state.done = parsed
      if (parsed.dying === true) state.dying = parsed
    }
  })
  child.stderr.on("data", (chunk) => state.stderr.push(chunk.toString("utf8")))
  state.waitReady = async () => { const until = now() + WORK_MS; while (state.ready === null && now() < until) await sleep(20); return state.ready }
  state.waitDone = async () => { const until = now() + WORK_MS; while (state.done === null && now() < until) await sleep(30); return state.done }
  state.wire = () => state.lines.filter((line) => line.wire === "in").map((line) => String(line.kind) + ":" + String(line.id))
  state.kill = async () => { try { child.kill("SIGKILL") } catch { /* already gone */ }; const until = now() + 2000; while (child.exitCode === null && now() < until) await sleep(20); rmSync(home, { recursive: true, force: true }) }
  return state
}

/** Walk our fold until a dispatch is no longer pending, or give up (the caller reports which happened). */
const awaitAnswered = async (our, id) => {
  const until = now() + WORK_MS
  while (now() < until) {
    const folded = our.state()
    const entry = folded.dispatches.dispatches.find((row) => row.id === id)
    if (entry !== undefined && entry.status === "answered") return entry
    await sleep(25)
  }
  return our.state().dispatches.dispatches.find((row) => row.id === id) ?? null
}

/** Wait until a condition over our own records holds, or give up. */
const awaitRecord = async (our, predicate) => {
  const until = now() + WORK_MS
  while (now() < until) {
    const found = our.state().dispatches.refusedResults.find(predicate)
    if (found !== undefined) return found
    await sleep(30)
  }
  return null
}
// ------------------------------------------------------------------------------------------------
// Readings. Every expectation below is written from docs/protocol/device-net-v1.md, not from the code.
// ------------------------------------------------------------------------------------------------

const readR1 = async () => {
  const n = "R1"
  try {
    const anchors = ["/api/dsh-link-collab/relay", "\"UNAUTHORIZED\"", "\"METHOD\"", "\"CONTENT_TYPE\"", "\"TOO_LARGE\"", "\"RELAY_GAP\"", "\"RELAY_HOLE\"", "\"RELAY_WRITER_MISSING\"", "\"RELAY_REWRITTEN\"", "\"RELAY_CONFLICT\"", "\"RELAY_MALFORMED\"", "\"RELAY_IMPERSONATION\"", "^bearer", "^application"]
    const absent = anchors.filter((anchor) => !moduleText.includes(anchor))
    const our = await startOurEnd("r1")
    const unauthorizedGet = await post(our.url, { method: "GET", authorization: null, contentType: null })
    const authorizedGet = await post(our.url, { method: "GET", authorization: "Bearer " + TOKEN })
    const held = absent.length === 0 && our.endpoint.path === expectationsFrozen.DEFAULT_PATH
      && unauthorizedGet.status === 401 && unauthorizedGet.body?.code === "UNAUTHORIZED"
      && authorizedGet.status === 405 && authorizedGet.body?.code === "METHOD"
    record(n, held, "rules the page names, present in the shipped artifact: " + String(anchors.length - absent.length) + "/" + String(anchors.length) + (absent.length > 0 ? " (missing " + JSON.stringify(absent) + ")" : "") + " | default path " + our.endpoint.path + " | unauthorised GET " + String(unauthorizedGet.status) + " " + String(unauthorizedGet.body?.code) + ", so authentication precedes method | authorised GET " + String(authorizedGet.status) + " " + String(authorizedGet.body?.code))
    await our.close()
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR2 = async (our) => {
  const n = "R2"
  try {
    const before = our.state()
    const absentBefore = !before.members.some((row) => row.id === MEMBER) && MOD.capabilitiesOf(before, MEMBER).length === 0
    const foreign = await startForeign({ tag: "main", peer: our.url, member: MEMBER, writer: "foreign-main", capability: WORLD === "capability-none" ? "none" : TOOL })
    const ready = await foreign.waitReady()
    await sleep(80)
    const joined = our.state()
    const member = joined.members.find((row) => row.id === MEMBER) ?? null
    const caps = MOD.capabilitiesOf(joined, MEMBER)
    const host = joined.hosting.hosts.find((row) => row.id === MEMBER) ?? null
    const beat = joined.liveness.lastHeartbeat[MEMBER] ?? null
    const held = ready !== null && absentBefore && member !== null && caps.includes(TOOL) && host !== null && host.end === "foreign-main-end" && typeof beat === "number"
    record(n, held, "absent before the join: " + String(absentBefore) + " | the child announced itself on port " + String(ready?.port ?? null) + " instance " + String(ready?.instance ?? null) + " | member " + String(member?.id ?? null) + " | capabilities " + JSON.stringify(caps) + " | host end " + String(host?.end ?? null) + " | heartbeat " + String(beat))
    return { foreign, ready }
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)); return { foreign: null, ready: null } }
}

const deliver = async (our, foreignUrl, id, to, tool, args) => {
  await our.log.append(MOD.dispatchRecord(id, to, tool, args, now()))
  return our.endpoint.relayTo(foreignUrl, ownBatch(our.log))
}

const readR3 = async (our, scene, jobId) => {
  const n = "R3"
  try {
    const foreignUrl = "http://127.0.0.1:" + String(scene.ready.port) + DEFAULT_PATH
    const pushed = await deliver(our, foreignUrl, jobId, MEMBER, TOOL, { a: 2, b: 5 })
    const entry = await awaitAnswered(our, jobId)
    const done = await scene.foreign.waitDone()
    const executed = done?.executed ?? []
    const wire = scene.foreign.wire()
    const held = pushed?.ok === true && entry !== null && entry.status === "answered" && entry.result !== null && entry.result.ok === true && same(entry.result.value, { sum: 7 }) && executed.includes(jobId) && wire.includes("task/dispatch:" + jobId)
    record(n, held, "our batch to its route " + JSON.stringify(pushed) + " | its wire saw " + JSON.stringify(wire) + " | its own executed " + JSON.stringify(executed) + " | our fold answered with " + JSON.stringify(entry?.result?.value ?? null))
    return entry
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)); return null }
}

const readR4 = async (our) => {
  const n = "R4"
  try {
    // The page's v1.1 rule: a batch carrying the RECEIVER'S OWN writer name under another instance is
    // refused as impersonation. The world mutant swaps in a third-party name, so the same shape lands.
    const senderName = WORLD === "impersonation-control" ? "rogue-own-name" : our.log.writer
    const before = our.records()
    const denial = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch(senderName, our.log.instance + "-not-ours", [memberRow("m-impersonated")])) })
    const afterDenial = our.records()
    const beforeAdopted = our.records()
    // Observed here, judged in R11: `adopt` does not exempt a name that is not the sender's own.
    const adopted = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch(senderName, our.log.instance + "-adopted", [memberRow("m-adopted")], true)) })
    const afterAdopted = our.records()
    const beforeControl = our.records()
    const control = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-a", "inst-a", [memberRow("m-rogue-a")])) })
    const afterControl = our.records()
    const held = denial.status === 400 && denial.body?.code === "RELAY_IMPERSONATION" && afterDenial === before
      && control.status === 200 && control.body?.appended === 1 && afterControl === beforeControl + 1
    record(n, held, "our own writer name under another instance -> " + String(denial.status) + " " + String(denial.body?.code) + ", ledger " + String(before) + "->" + String(afterDenial) + " | the same records under a third-party writer -> " + String(control.status) + " appended " + String(control.body?.appended) + ", ledger " + String(beforeControl) + "->" + String(afterControl) + " | observed here, judged in R11: with adopt -> " + String(adopted.status) + " " + String(adopted.body?.code ?? "") + ", ledger " + String(beforeAdopted) + "->" + String(afterAdopted))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR5 = async (our) => {
  const n = "R5"
  try {
    const before = our.records()
    const gapStart = WORLD === "gap-control" ? 2 : 2
    const gap = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-b", "inst-b", [memberRow("m-rogue-b", gapStart)])) })
    const afterGap = our.records()
    const gapControl = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-g", "inst-g", [memberRow("m-rogue-g", WORLD === "gap-control" ? 2 : 1)])) })
    const afterGapControl = our.records()
    const hole = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-c", "inst-c", [memberRow("m-rogue-c", 1), memberRow("m-rogue-c", 3)])) })
    const afterHole = our.records()
    const holeControl = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-c", "inst-c", [memberRow("m-rogue-c", 1), memberRow("m-rogue-c", 2)])) })
    const afterHoleControl = our.records()
    const held = gap.status === 400 && gap.body?.code === "RELAY_GAP" && afterGap === before
      && gapControl.status === 200 && afterGapControl === before + 1
      && hole.status === 400 && hole.body?.code === "RELAY_HOLE" && afterHole === before + 1
      && holeControl.status === 200 && afterHoleControl === before + 3
    record(n, held, "a first batch at seq 2 -> " + String(gap.status) + " " + String(gap.body?.code) + ", ledger " + String(before) + "->" + String(afterGap) + " | a batch skipping from 1 to 3 -> " + String(hole.status) + " " + String(hole.body?.code) + ", ledger " + String(afterHole) + " | the paired good batches landed: " + String(gapControl.status) + " and " + String(holeControl.status) + ", ledger " + String(afterHoleControl))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR6 = async (our) => {
  const n = "R6"
  try {
    const runOne = async (spoofed) => {
      const id = spoofed ? "job-spoof-1" : "job-spoof-2"
      const member = spoofed ? "m-spoof-a" : "m-spoof-b"
      const writer = spoofed ? "foreign-spoof-a" : "foreign-spoof-b"
      const foreign = await startForeign({ tag: writer, peer: our.url, member, writer, capability: TOOL, spoofFrom: spoofed && WORLD !== "no-spoof" ? "m-imposter" : undefined })
      const ready = await foreign.waitReady()
      const foreignUrl = "http://127.0.0.1:" + String(ready.port) + DEFAULT_PATH
      await deliver(our, foreignUrl, id, member, TOOL, { a: 1, b: 4 })
      const entry = spoofed ? null : await awaitAnswered(our, id)
      const refusal = spoofed ? await awaitRecord(our, (row) => row.id === id) : null
      const done = await foreign.waitDone()
      await foreign.kill()
      return { id, entry, refusal, executed: done?.executed ?? [] }
    }
    const spoofed = await runOne(true)
    const honest = await runOne(false)
    const held = spoofed.refusal !== null && spoofed.refusal.reason === "wrong-writer" && spoofed.refusal.from === "m-imposter"
      && honest.entry !== null && honest.entry.status === "answered" && same(honest.entry.result?.value ?? null, { sum: 5 })
    record(n, held, "an answer whose author is not the addressed member -> refused " + String(spoofed.refusal?.reason ?? null) + " from " + String(spoofed.refusal?.from ?? null) + " (it ran anyway: " + JSON.stringify(spoofed.executed) + ") | the paired honest answer -> " + String(honest.entry?.status ?? null) + " " + JSON.stringify(honest.entry?.result?.value ?? null))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR7 = async (our, acceptedId, acceptedValue) => {
  const n = "R7"
  try {
    const secondValue = WORLD === "duplicate-first" ? acceptedValue : { sum: 99 }
    const second = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-dup", "inst-dup", [{ kind: "task/result", actor: TEAM, subject: acceptedId, seq: 1, payload: { id: acceptedId, from: MEMBER, ok: true, value: secondValue, at: now() } }])) })
    const afterSecond = our.state()
    const entry = afterSecond.dispatches.dispatches.find((row) => row.id === acceptedId) ?? null
    const refusal = afterSecond.dispatches.refusedResults.find((row) => row.id === acceptedId) ?? null
    const freshId = "job-double-answer"
    await our.log.append(MOD.dispatchRecord(freshId, MEMBER, TOOL, { a: 1, b: 1 }, now()))
    const rogueAnswer = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-dup", "inst-dup", [{ kind: "task/result", actor: TEAM, subject: freshId, seq: 2, payload: { id: freshId, from: MEMBER, ok: true, value: { sum: 2 }, at: now() } }])) })
    const afterRogue = our.state()
    const rogueEntry = afterRogue.dispatches.dispatches.find((row) => row.id === freshId) ?? null
    const held = second.status === 200 && refusal !== null && refusal.reason === "duplicate-result" && entry !== null && same(entry.result?.value ?? null, acceptedValue)
      && rogueAnswer.status === 200 && rogueEntry !== null && rogueEntry.status === "answered" && same(rogueEntry.result?.value ?? null, { sum: 2 })
    record(n, held, "a second answer for an answered id -> refused " + String(refusal?.reason ?? null) + "; the accepted value is still " + JSON.stringify(entry?.result?.value ?? null) + " | the paired answer for a still-pending id was accepted: " + String(rogueAnswer.status) + " " + JSON.stringify(rogueEntry?.result?.value ?? null))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR8 = async (our, scene, declaredJobId, undeclaredJobId, pushed) => {
  const n = "R8"
  try {
    const done = await scene.foreign.waitDone()
    const folded = our.state()
    const entry = folded.dispatches.dispatches.find((row) => row.id === undeclaredJobId) ?? null
    const refusal = folded.dispatches.refusedDispatches.find((row) => row.id === undeclaredJobId) ?? null
    const verdict = MOD.resolveDispatch(folded, undeclaredJobId, now()).verdict
    const executed = done?.executed ?? []
    const held = pushed?.ok === true && entry !== null && entry.status === "refused" && refusal !== null && refusal.reason === "capability-mismatch" && verdict === "refused" && !executed.includes(undeclaredJobId) && executed.includes(declaredJobId) && entry.result === null
    record(n, held, "a tool it never declared -> projection " + String(entry?.status ?? null) + " " + String(refusal?.reason ?? null) + ", verdict " + verdict + " | its own executed " + JSON.stringify(executed) + " (the declared job is there, the undeclared one is not) | nothing was written back for it: " + String(entry?.result === null))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR9 = async (our, quiet) => {
  const n = "R9"
  try {
    // The window is deliberately huge: this reading asks whether the heartbeat FACT exists, not how long
    // the rest of the run took. A tight window would make it flaky under a slow mutant.
    const healthy = MOD.livenessOf(our.state(), now(), { timeoutMs: 30 * 60_000 }).find((row) => row.memberId === MEMBER) ?? null
    const member = "m-quiet"
    const foreign = await startForeign({ tag: "quiet", peer: our.url, member, writer: "foreign-quiet", capability: TOOL, noHeartbeat: WORLD === "quiet-heartbeat" ? false : true })
    await foreign.waitReady()
    await sleep(80)
    const state = our.state()
    const reading = MOD.livenessOf(state, now(), { timeoutMs: 30 * 60_000 }).find((row) => row.memberId === member) ?? null
    const beat = state.liveness.lastHeartbeat[member] ?? null
    await foreign.kill()
    const held = healthy !== null && healthy.liveness === "healthy" && reading !== null && reading.liveness === "unknown" && beat === null
    record(n, held, "the end that beats -> " + String(healthy?.liveness ?? null) + " | the end that never beat -> " + String(reading?.liveness ?? null) + " with no heartbeat fact at all: " + String(beat === null) + " (liveness is a ledger fact, not a socket)")
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}

const readR10 = async (our) => {
  const n = "R10"
  try {
    const good = JSON.stringify(batch("rogue-ping", "inst-ping", [memberRow("m-ping")]))
    const plain = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: good })
    const lower = await post(our.url, { authorization: "bearer " + TOKEN, contentType: "application/json", body: good })
    const upper = await post(our.url, { authorization: "BEARER " + TOKEN, contentType: "application/json", body: good })
    const upperType = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "Application/JSON", body: good })
    const wrongType = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "text/plain", body: good })
    const notJson = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: "this is not json" })
    const noRecords = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify({ writer: "rogue-x", instance: "inst-x" }) })
    const tooLarge = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify({ writer: "rogue-y", instance: "inst-y", records: [], pad: "a".repeat(4 * 1024 * 1024 + 1024) }) })
    const anonymous = await post(our.url, { authorization: null, contentType: "application/json", body: good })
    const held = plain.status === 200 && plain.body?.ok === true
      && lower.status === 200 && upper.status === 200 && upperType.status === 200
      && wrongType.status === 415 && wrongType.body?.code === "CONTENT_TYPE"
      && notJson.status === 400 && notJson.body?.code === "RELAY_MALFORMED"
      && noRecords.status === 400 && noRecords.body?.code === "RELAY_MALFORMED"
      && tooLarge.status === 413 && tooLarge.body?.code === "TOO_LARGE"
      && anonymous.status === 401 && anonymous.body?.code === "UNAUTHORIZED"
    record(n, held, "Bearer/bearer/BEARER and Application/JSON all accepted: " + String(plain.status) + "/" + String(lower.status) + "/" + String(upper.status) + "/" + String(upperType.status) + " | text/plain " + String(wrongType.status) + " " + String(wrongType.body?.code) + " | a body that is not JSON " + String(notJson.status) + " " + String(notJson.body?.code) + " | a body with no records array " + String(noRecords.status) + " " + String(noRecords.body?.code) + " | a body over the limit " + String(tooLarge.status) + " " + String(tooLarge.body?.code) + " | anonymous " + String(anonymous.status) + " " + String(anonymous.body?.code))
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}
const readR11 = async (our) => {
  const n = "R11"
  try {
    // (a) our own name under a NEW instance WITH adopt: the page's v1.1 rule says adopt cannot exempt a
    // name that is not the sender's own, so this is refused exactly where R4's batch is.
    const before = our.records()
    const adoptedUs = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch(our.log.writer, our.log.instance + "-adopt-us", [memberRow("m-adopt-us")], true)) })
    const afterAdoptedUs = our.records()
    // (b) our own records coming home verbatim: page v1.2 REQUIRES a refusal. A batch carrying the
    // receiver's OWN writer name is refused whatever its `instance` says and whether or not it asks to be
    // adopted -- `adopt` is a claim about the sender's own log, and an end only ever forwards records it
    // produced itself (`ownPage`), so its own records never need to travel home; a peer sending them back
    // is either looping or impersonating. This reading is a POSITIVE requirement of the page: the artifact
    // turning this batch away is the promised behaviour, not a legitimate batch it blocked. An empty own
    // stream would make the refusal vacuous (nothing would tell "refused" from "nothing to apply"), so the
    // stream is made non-empty first and its length is part of the reading.
    await our.log.append({ kind: "member/state", actor: TEAM, subject: "m-gate-own", payload: { id: "m-gate-own", name: "m-gate-own", state: "active", role: "member" } })
    const home = ownBatch(our.log)
    const beforeHome = our.records()
    const homeResult = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(home) })
    const afterHome = our.records()
    // (b2) the fourth cell of the matrix the page states ("whatever its `instance` says, and whether or
    // not it asks to be adopted"): our own name with our OWN instance AND adopt:true. Page v1.2 makes the
    // name decisive, so this is refused like the other three, and the pairing is what keeps the rule a
    // rule rather than a special case.
    const beforeHomeAdopted = our.records()
    const homeAdopted = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify({ ...home, adopt: true }) })
    const afterHomeAdopted = our.records()
    // (c) the controls, so (b)'s refusal is an answer about WHOSE name rather than about idempotence,
    // adoption or the route itself: a third-party writer's own records land once and read as already
    // applied when re-sent -- twice over, so "already applied" is a repeatable fact and not one lucky
    // reply -- and that same third-party's own name under a NEW instance WITH adopt still lands.
    // The controls run AFTER (b), so they also show the impersonation refusal left the other writers'
    // high-water marks alone.
    const thirdRows = [memberRow("m-third")]
    const third = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-third", "inst-third", thirdRows)) })
    const afterThird = our.records()
    const thirdAgain = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-third", "inst-third", thirdRows)) })
    const thirdAgainAgain = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-third", "inst-third", thirdRows)) })
    const beforeThirdAdopt = our.records()
    const thirdAdopted = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-third", "inst-third-next", [memberRow("m-third-2")], true)) })
    const afterThirdAdopt = our.records()
    // (d) the inverse pairing of (b): a THIRD-PARTY name carrying OUR instance value still lands, so the
    // refusal is about the writer NAME and not about the instance the batch happens to name -- page v1.2
    // says exactly this ("whatever its `instance` says"), so a future implementation that refused by
    // instance instead of by name would redden here.
    const beforeForeignOnOurInstance = our.records()
    const foreignOnOurInstance = await post(our.url, { authorization: "Bearer " + TOKEN, contentType: "application/json", body: JSON.stringify(batch("rogue-on-our-instance", our.log.instance, [memberRow("m-on-our-instance")])) })
    const afterForeignOnOurInstance = our.records()
    const held = adoptedUs.status === 400 && adoptedUs.body?.code === "RELAY_IMPERSONATION" && afterAdoptedUs === before
      && home.records.length > 0 && homeResult.status === 400 && homeResult.body?.code === "RELAY_IMPERSONATION" && afterHome === beforeHome
      && homeAdopted.status === 400 && homeAdopted.body?.code === "RELAY_IMPERSONATION" && afterHomeAdopted === beforeHomeAdopted
      && third.status === 200 && third.body?.appended === thirdRows.length
      && thirdAgain.status === 200 && thirdAgain.body?.appended === 0 && thirdAgain.body?.skipped === thirdRows.length
      && thirdAgainAgain.status === 200 && thirdAgainAgain.body?.appended === 0 && thirdAgainAgain.body?.skipped === thirdRows.length
      && beforeThirdAdopt === afterThird
      && thirdAdopted.status === 200 && thirdAdopted.body?.appended === 1 && afterThirdAdopt === beforeThirdAdopt + 1
      && foreignOnOurInstance.status === 200 && foreignOnOurInstance.body?.appended === 1 && afterForeignOnOurInstance === beforeForeignOnOurInstance + 1
    record(n, held, "page v1.2 requires a refusal here: our own name + a new instance + adopt -> " + String(adoptedUs.status) + " " + String(adoptedUs.body?.code) + ", ledger " + String(before) + "->" + String(afterAdoptedUs) + " | page v1.2 requires a refusal here: our own records pushed back verbatim (" + String(home.records.length) + " record(s), so the refusal is not vacuous) -> " + String(homeResult.status) + " " + String(homeResult.body?.code ?? "-") + ", ledger " + String(beforeHome) + "->" + String(afterHome) + " | the fourth cell: our own name + our own instance + adopt:true -> " + String(homeAdopted.status) + " " + String(homeAdopted.body?.code ?? "-") + ", ledger " + String(beforeHomeAdopted) + "->" + String(afterHomeAdopted) + " | controls: a third-party first send " + String(third.status) + "/" + String(third.body?.appended) + ", then the same batch verbatim twice more " + String(thirdAgain.status) + "/" + String(thirdAgain.body?.appended) + " skipped " + String(thirdAgain.body?.skipped) + " and " + String(thirdAgainAgain.status) + "/" + String(thirdAgainAgain.body?.appended) + " skipped " + String(thirdAgainAgain.body?.skipped) + " with the ledger holding at " + String(afterThird) + "->" + String(beforeThirdAdopt) + ", and that same name under a new instance + adopt " + String(thirdAdopted.status) + "/" + String(thirdAdopted.body?.appended) + " (ledger " + String(beforeThirdAdopt) + "->" + String(afterThirdAdopt) + ") | a third-party NAME carrying our INSTANCE " + String(foreignOnOurInstance.status) + "/" + String(foreignOnOurInstance.body?.appended) + " (ledger " + String(beforeForeignOnOurInstance) + "->" + String(afterForeignOnOurInstance) + "), so the refusal is about the name and not the instance)")
  } catch (error) { record(n, false, "threw: " + String(error && error.message ? error.message : error)) }
}
const DECLARED = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"]

const runReadings = async () => {
  await readR1()
  const our = await startOurEnd("main")
  const scene = await readR2(our)
  const declaredJob = "job-net-1"
  const undeclaredJob = "job-net-2"
  let accepted = null
  if (scene.foreign !== null && scene.ready !== null) {
    const foreignUrl = "http://127.0.0.1:" + String(scene.ready.port) + DEFAULT_PATH
    const undeclaredPush = await deliver(our, foreignUrl, undeclaredJob, MEMBER, "not-declared", { any: true })
    accepted = await readR3(our, scene, declaredJob)
    await readR8(our, scene, declaredJob, undeclaredJob, undeclaredPush)
    await scene.foreign.kill()
  } else {
    record("R3", false, "the foreign end never announced itself, so no dispatch could be delivered")
    record("R8", false, "the foreign end never announced itself, so no dispatch could be delivered")
  }
  await readR4(our)
  await readR5(our)
  await readR7(our, declaredJob, { sum: 7 })
  await readR6(our)
  await readR9(our)
  await readR10(our)
  await readR11(our)
  await our.close()
}

const report = () => {
  const held = results.filter((row) => row.ok).length
  const failed = results.filter((row) => !row.ok && !row.skip).length
  const skipped = results.filter((row) => row.skip).length
  console.log("")
  console.log("coverage matrix: " + String(DECLARED.length) + " declared readings, " + String(held) + " held, " + String(failed) + " failed, " + String(skipped) + " skipped")
  return failed
}

// ------------------------------------------------------------------------------------------------
// Self-attack: one mutation per declared mutant, each required to flip exactly its declared readings.
// A product mutant edits a copy of the shipped artifact; a world mutant changes the inputs this gate
// builds. No expectation reads either switch.
// ------------------------------------------------------------------------------------------------
const MUTANTS = [
  { id: "unauthorized-code", kind: "product", anchor: "return refuse(401, \"UNAUTHORIZED\");", replacement: "return refuse(401, \"UNAUTHORIZED_MUTED\");", expect: ["R1", "R10"] },
  { id: "scheme-case", kind: "product", anchor: "/^bearer[ \\t]+/i", replacement: "/^Bearer[ \\t]+/", all: true, expect: ["R1", "R10"] },
  { id: "default-path", kind: "product", anchor: "var RELAY_PATH = \"/api/dsh-link-collab/relay\";", replacement: "var RELAY_PATH = \"/api/dsh-link-collab/other\";", expect: ["R1"] },
  { id: "impersonation-open", kind: "product", anchor: "if (batch.writer === localWriter) {", replacement: "if (false) {", expect: ["R4", "R11"] },
  { id: "gap-open", kind: "product", anchor: "if (fresh[0].seq !== have + 1) {", replacement: "if (false) {", expect: ["R5"] },
  { id: "hole-open", kind: "product", anchor: "if (incoming[index].seq !== incoming[index - 1].seq + 1) {", replacement: "if (false) {", expect: ["R5"] },
  { id: "capability-id", kind: "product", anchor: "const id = payload?.id ?? record.subject;", replacement: "const id = null;", expect: ["R2", "R3", "R6", "R7"] },
  { id: "capability-check", kind: "product", anchor: "if (!declared.byCapability[request.tool]?.includes(request.to)) {", replacement: "if (false) {", expect: ["R8"] },
  { id: "duplicate-reason", kind: "product", anchor: "reason: \"duplicate-result\" });", replacement: "reason: \"duplicate-result-muted\" });", expect: ["R7"] },
  { id: "capability-none", kind: "world", expect: ["R2", "R3", "R7", "R8"] },
  { id: "quiet-heartbeat", kind: "world", expect: ["R9"] },
  { id: "no-spoof", kind: "world", expect: ["R6"] },
  { id: "gap-control", kind: "world", expect: ["R5"] },
  { id: "impersonation-control", kind: "world", expect: ["R4"] },
]

const runChild = async (world, modulePath) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--module", modulePath], { cwd: PROJECT, env: { ...process.env, DSH_GATE_R57_WORLD: world }, stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  let err = ""
  child.stdout.on("data", (chunk) => { out += chunk.toString("utf8") })
  child.stderr.on("data", (chunk) => { err += chunk.toString("utf8") })
  const code = await new Promise((settle) => child.on("exit", settle))
  const seen = new Map()
  for (const line of out.split(String.fromCharCode(10))) {
    const match = /^  (ok|SKIP|FAIL)  +(R\d+)\./.exec(line)
    if (match !== null) seen.set(match[2], match[1] !== "FAIL")
  }
  const failed = [...seen.entries()].filter(([, ok]) => ok === false).map(([id]) => id).sort()
  return { code, failed, seen, out, err }
}

const attack = async () => {
  const baseline = await runChild("", MODULE)
  const baselineGreen = DECLARED.every((id) => baseline.seen.get(id) === true)
  console.log("baseline: " + String(baseline.seen.size) + " readings seen, failed " + JSON.stringify(baseline.failed) + ", exit " + String(baseline.code))
  if (!baselineGreen) { console.log("self-attack: the unmutated artifact is not green, so no mutant can be trusted"); return 1 }
  const covered = new Set()
  let wrong = 0
  for (const mutant of MUTANTS) {
    let modulePath = MODULE
    if (mutant.kind === "product") {
      const text = readFileSync(MODULE, "utf8")
      if (!text.includes(mutant.anchor)) { console.log("  ANCHOR MISSING  " + mutant.id + ": " + mutant.anchor); wrong += 1; continue }
      modulePath = join(TEMP_ROOT, "r57-mutant-" + mutant.id + ".mjs")
      const mutated = mutant.all === true ? text.split(mutant.anchor).join(mutant.replacement) : text.replace(mutant.anchor, mutant.replacement)
      writeFileSync(modulePath, mutated)
    }
    const run = await runChild(mutant.kind === "world" ? mutant.id : "", modulePath)
    if (mutant.kind === "product") rmSync(modulePath, { force: true })
    const expected = [...mutant.expect].sort()
    const ok = same(run.failed, expected)
    for (const id of run.failed) covered.add(id)
    if (!ok) wrong += 1
    console.log("  " + (ok ? "ok  " : "FAIL") + "  " + mutant.id + " (" + mutant.kind + ") flipped " + JSON.stringify(run.failed) + " declared " + JSON.stringify(expected))
  }
  const uncovered = DECLARED.filter((id) => !covered.has(id))
  console.log("mutants applied " + String(MUTANTS.length) + " of " + String(MUTANTS.length) + ", declared-set mismatches " + String(wrong) + ", uncovered readings " + JSON.stringify(uncovered))
  return wrong === 0 && uncovered.length === 0 ? 0 : 1
}

if (SELF_ATTACK) {
  const outcome = await attack()
  process.exit(outcome)
}
await runReadings()
const failed = report()
process.exit(failed === 0 ? 0 : 1)
