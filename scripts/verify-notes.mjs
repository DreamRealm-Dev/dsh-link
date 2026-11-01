#!/usr/bin/env node
/**
 * R48 (task-91): notes and EXTERNAL persistence - the data must live outside the process.
 *
 * Subject: .tmp/r48-contract.md. The gate judges the data face only: ledger facts, folding, queries,
 * append-only writing, external persistence and survival across a restart. Its strongest evidence is a real
 * second process: the gate spawns a child node that writes notes and exits, then reopens the same directory
 * here - reopening inside one process would prove nothing about living outside it.
 *
 * Every expectation is computed here from fixtures this gate writes; the records are read back from the log
 * bytes by this gate's own JSONL reader, not from the engine. The engine surface and the two collab pieces it
 * must reuse (openControlLog, foldClaim) are read before any assertion. Self-attack follows R40-R47:
 * declared-set equality per mutant, a coverage matrix with no uncovered reading, anchors from the product
 * under test. This gate runs no other gate. Store directories live under .tmp and are deleted at the end.
 *
 * The shipped artifact cannot be imported where it sits: it imports the bare kernel specifier
 * @deepseek-ai/schemastery and this checkout has no node_modules for it. So this gate stages a copy of those exact
 * bytes one level below the package root - the same depth as lib/, which keeps the artifact's own relative import
 * ../../dsh-link-collab/lib/index.js pointing at the same neighbour - and rewriting the bare kernel specifiers in
 * one table (KERNEL_MODULES) onto the kernel file each one stands for. Every other byte is the shipped byte, nothing
 * is written into lib/, and the staged directory
 * is scratch: it is removed before the gate exits, and stage.1 reports that it is gone. An import failure is never
 * reported as a missing symbol either: a reading says "could not be imported: <error message>", and the load-path
 * pair below reads both directions. `--no-rewrite` empties the rewrite table on purpose, which is how a reader
 * makes this gate go red and name the import failure.
 *
 * Exit 0 all held; 1 a reading failed (a load-path reading too); 3 an input is missing (printed).
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const MODULE = resolve(option("--module", join(PROJECT, "plugins", "dsh-link-notes", "lib", "index.js")))
const COLLAB = resolve(option("--collab", join(PROJECT, "plugins", "dsh-link-collab", "lib", "index.js")))
const SELF_ATTACK = argv.includes("--self-attack")
const KERNEL = join(PROJECT, "core", "deepseek-harness")
/**
 * The bare kernel specifiers the shipped artifact imports, and the exact file each one stands for. The value is the
 * file the package's own "import" export names: schemastery's src/index.ts cannot be imported by node without a
 * TypeScript loader ("TypeScript parameter property is not supported in strip-only mode"), its built lib/index.mjs
 * can, and that file resolves its own @deepseek-ai/cosmokit from vendor/schemastery/node_modules inside the kernel.
 * An EMPTY table is the counter-evidence tool: --no-rewrite empties it, and the gate must then go red naming the
 * import failure rather than pass ten readings about nothing.
 */
const KERNEL_MODULES = {
  "@deepseek-ai/schemastery": join(KERNEL, "vendor", "schemastery", "lib", "index.mjs"),
  "@deepseek-ai/dsh-tools": join(KERNEL, "packages", "core", "tools", "lib", "index.js"),
}
const REWRITES = argv.includes("--no-rewrite") ? {} : KERNEL_MODULES

/**
 * The module under test and the collab it reuses, as this gate last tried to import them. Swallowing an import
 * error is exactly how this gate once reported "the module exposes no R48 surface ... task-90 has not landed" for
 * a module that was never imported at all: the symbols were there, the import never ran. So the missing-surface
 * message and the import failure are kept apart, and the latter always names its own cause.
 */
const MODULE_LOAD = { path: null, error: null }
const COLLAB_LOAD = { path: null, error: null }
const MISSING = "the module exposes no R48 surface (NOTE_KIND/noteRecord/projectNotes/openNotesStore/appendNote/setNoteState) - task-90 has not landed"
const COLLAB_MISSING = "collab exposes no projectTeamState, so the honest-unknown reading has no instrument"
const unreadable = (load) => "the module at " + String(load.path) + " could not be imported: " + String(load.error) + " - nothing of its surface could be read, so this is an import failure and not a missing symbol"
const honest = (detail) => {
  if (detail === MISSING && MODULE_LOAD.error !== null) return unreadable(MODULE_LOAD)
  if (detail === COLLAB_MISSING && COLLAB_LOAD.error !== null) return unreadable(COLLAB_LOAD)
  return detail
}
const results = []
/** The load-path readings are tallied on their own line, so the ten readings keep their own count. */
const LOAD_RESULTS = []
let SINK = results
const record = (n, status, detail) => {
  const text = status === true ? detail : honest(detail)
  SINK.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : status === "skip" ? "SKIP" : "FAIL") + "  " + n + ". " + text)
  return text
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const norm = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
const sortedAsc = (v) => Array.isArray(v) && show(v) === show(v.slice().sort())
/** An import either yields the module or the reason it did not: the reason is never thrown away. */
const load = async (p) => {
  try { return { mod: await import(pathToFileURL(p).href), error: null } }
  catch (error) { return { mod: null, error: String(error && error.message ? error.message : error) } }
}
const api = (mod) => ({
  NOTE_KIND: mod && typeof mod.NOTE_KIND === "string" ? mod.NOTE_KIND : null,
  noteRecord: mod && typeof mod.noteRecord === "function" ? mod.noteRecord : null,
  project: mod && typeof mod.projectNotes === "function" ? mod.projectNotes : null,
  open: mod && typeof mod.openNotesStore === "function" ? mod.openNotesStore : null,
  append: mod && typeof mod.appendNote === "function" ? mod.appendNote : null,
  setState: mod && typeof mod.setNoteState === "function" ? mod.setNoteState : null,
  openNotes: mod && typeof mod.openNotes === "function" ? mod.openNotes : null,
  withTag: mod && typeof mod.notesWithTag === "function" ? mod.notesWithTag : null,
  search: mod && typeof mod.searchNotes === "function" ? mod.searchNotes : null,
})
const need = (a, keys) => keys.every((k) => a[k] !== null)

// ---------------------------------------------------------------- bytes on disk: this gate's own reader
const sha = (buf) => createHash("sha256").update(buf).digest("hex")
const filesUnder = (root) => {
  const out = []
  const walk = (rel) => {
    const abs = rel === "" ? root : join(root, rel)
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel === "" ? name : rel + "/" + name
      if (statSync(join(abs, name)).isDirectory()) walk(childRel)
      else out.push(childRel)
    }
  }
  if (existsSync(root)) walk("")
  return out.sort()
}
const bytesOf = (root) => {
  const map = {}
  for (const rel of filesUnder(root)) map[rel] = readFileSync(join(root, rel))
  return map
}
const digestOf = (map) => sha(Buffer.concat(Object.keys(map).sort().map((rel) => Buffer.concat([Buffer.from(rel + "=", "utf8"), map[rel], Buffer.from(";", "utf8")]))))
const grewByPrefix = (before, after) => {
  const problems = []
  for (const rel of Object.keys(before)) {
    if (after[rel] === undefined) { problems.push(rel + " disappeared"); continue }
    if (after[rel].length < before[rel].length) problems.push(rel + " shrank from " + String(before[rel].length) + " to " + String(after[rel].length) + " bytes")
    else if (!after[rel].slice(0, before[rel].length).equals(before[rel])) problems.push(rel + " is not an append: the old bytes are not a prefix of the new ones")
  }
  return problems
}
// Records are read from the bytes on disk, so no expectation is read back from the engine.
function recordsFrom(dir) {
  const records = []
  for (const rel of filesUnder(dir)) {
    const text = readFileSync(join(dir, rel), "utf8")
    for (const line of text.split(String.fromCharCode(10))) {
      if (line.trim() === "") continue
      let parsed = null
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed !== null && typeof parsed === "object" && Number.isInteger(parsed.seq)) records.push(parsed)
    }
  }
  return records.sort((l, r) => l.seq - r.seq)
}
// My own reading of the fold rule from the contract: compare at when both sides have it, otherwise seq.
const fold = (previous, incoming) => {
  const leftAt = previous.at === undefined ? null : previous.at
  const rightAt = incoming.at === undefined ? null : incoming.at
  if (leftAt !== null && rightAt !== null) return { incomingWins: rightAt > leftAt || (rightAt === leftAt && incoming.seq > previous.seq), byAt: rightAt !== leftAt }
  return { incomingWins: incoming.seq > previous.seq, byAt: false }
}
const byAtThenSeq = (l, r) => (l.at === r.at ? l.seq - r.seq : l.at - r.at)


const noteFact = (a, seq, id, text, tags, state, at, writer) => ({ ...a.noteRecord(id, text, tags, state, "verifier"), seq, writer, instance: "i1", actor: "verifier", at })

function checkSix(mod) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "noteRecord", "project"])) { record(6, false, MISSING); return }
  const problems = []
  // Arrival order must not matter: the same records in two orders fold to the same bytes.
  const batch = [
    noteFact(a, 1, "n-a", "alpha text", ["x"], "open", 100, "w1"),
    noteFact(a, 2, "n-b", "beta text", ["y", "x", "y"], "open", 200, "w2"),
  ]
  const forward = show(a.project(batch))
  const backward = show(a.project([...batch].reverse()))
  if (forward !== backward) problems.push("two arrival orders fold differently: " + clip(forward, 90) + " vs " + clip(backward, 90))
  // A contested edit: my own reading of the rule says the higher at wins, and an equal at is broken by seq.
  const contest = [
    noteFact(a, 11, "n-c", "first version", ["v1"], "open", 1000, "w1"),
    noteFact(a, 12, "n-c", "second version", ["v2"], "done", 2000, "w2"),
    noteFact(a, 13, "n-d", "same clock a", ["a"], "open", 3000, "w3"),
    noteFact(a, 14, "n-d", "same clock b", ["b"], "open", 3000, "w4"),
  ]
  const foldedForward = a.project(contest)
  const foldedBackward = a.project([...contest].reverse())
  if (show(foldedForward) !== show(foldedBackward)) problems.push("a contested batch folds differently when it arrives reversed")
  const c = foldedForward.notes.find((n) => n.id === "n-c")
  const d = foldedForward.notes.find((n) => n.id === "n-d")
  if (c === undefined) problems.push("the contested note n-c is missing")
  else {
    if (c.text !== "second version" || c.state !== "done") problems.push("the winner of n-c reads " + show({ text: c.text, state: c.state }) + ", expected the higher at (second version/done)")
    if (c.resolvedBy !== "at") problems.push("n-c was resolved by " + show(c.resolvedBy) + ", expected at")
    if (c.contested !== true) problems.push("n-c is not marked contested")
    const losers = Array.isArray(c.losers) ? c.losers : []
    if (losers.length !== 1) problems.push("n-c lists " + String(losers.length) + " losers, expected 1")
    else {
      const loser = losers[0]
      if (loser.text !== "first version" || loser.seq !== 11 || loser.at !== 1000 || show(loser.tags) !== show(["v1"]) || loser.state !== "open") problems.push("the loser of n-c reads " + clip(show(loser), 110) + ", expected the losing fact verbatim (text, tags, state, author, at, seq)")
      if (loser.writer !== null && loser.writer !== "w1") problems.push("the loser of n-c carries writer " + show(loser.writer) + ", expected the losing writer or null (the contract types NoteClaim.writer as string | null)")
      console.log("      the losing fact keeps its fields; writer is " + show(loser.writer) + " (the contract allows null, so it is recorded rather than gated)")
    }
  }
  if (d === undefined) problems.push("the same-clock note n-d is missing")
  else {
    if (d.text !== "same clock b") problems.push("n-d reads " + show(d.text) + ", expected the higher seq to win an equal at")
    if (d.resolvedBy !== "seq") problems.push("n-d was resolved by " + show(d.resolvedBy) + ", expected seq (the ats are equal, so the claim rule falls back to seq)")
  }
  console.log("      arrival order free: " + String(forward === backward) + "; n-c winner " + clip(show(c === undefined ? null : { text: c.text, resolvedBy: c.resolvedBy, contested: c.contested, losers: (c.losers ?? []).length }), 120))
  console.log("      equal ats fall back to seq: n-d " + clip(show(d === undefined ? null : { text: d.text, resolvedBy: d.resolvedBy }), 60))
  record(6, problems.length === 0, problems.length === 0 ? "arrival order does not change the fold, and a contested id keeps the winner by the one claim rule with the losing fact preserved in losers" : problems.join(" | "))
}

function checkSeven(mod) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "noteRecord", "project", "openNotes", "withTag", "search"])) { record(7, false, MISSING); return }
  const records = [
    noteFact(a, 1, "q-1", "Alpha note", ["x"], "open", 100, "w1"),
    noteFact(a, 2, "q-2", "beta NOTE", ["y"], "done", 200, "w2"),
    noteFact(a, 3, "q-3", "BETA again", ["y"], "open", 300, "w3"),
    noteFact(a, 4, "q-4", "deleted beta", ["y"], "deleted", 400, "w4"),
    noteFact(a, 5, "q-5", "中文便条", ["z"], "open", 500, "w5"),
  ]
  const state = a.project(records)
  const problems = []
  const ids = (list) => (Array.isArray(list) ? list.map((n) => n.id) : ["not-an-array:" + show(list)])
  const open = ids(a.openNotes(state))
  if (show(open) !== show(["q-1", "q-3", "q-5"])) problems.push("openNotes gives " + show(open) + ", expected the open notes only (q-1,q-3,q-5) in (at,seq) order")
  const empty = ids(a.search(state, ""))
  if (show(empty) !== show(["q-1", "q-2", "q-3", "q-5"])) problems.push("searchNotes with the empty string gives " + show(empty) + ", expected every undeleted note")
  const shouted = ids(a.search(state, "BETA"))
  if (show(shouted) !== show(["q-2", "q-3"])) problems.push("searchNotes(BETA) gives " + show(shouted) + ", expected the case-insensitive matches q-2,q-3")
  const chinese = ids(a.search(state, "中文"))
  if (show(chinese) !== show(["q-5"])) problems.push("searchNotes(中文) gives " + show(chinese) + ", expected q-5")
  const tagged = ids(a.withTag(state, "y"))
  if (show(tagged) !== show(["q-2", "q-3"])) problems.push("notesWithTag(y) gives " + show(tagged) + ", expected the undeleted y notes q-2,q-3")
  const absent = ids(a.withTag(state, "nope"))
  if (show(absent) !== show([])) problems.push("notesWithTag(nope) gives " + show(absent) + ", expected nothing")
  let paren = null
  try { paren = ids(a.search(state, "(")) } catch (error) { problems.push("searchNotes with a lone parenthesis threw: " + clip(String(error && error.message ? error.message : error), 60)) }
  if (paren !== null && show(paren) !== show([])) problems.push("searchNotes(\"(\") gives " + show(paren) + ", expected nothing: the query is a substring, not a pattern")
  console.log("      openNotes " + show(open) + "; search(\"\") " + show(empty) + "; search(BETA) " + show(shouted) + "; notesWithTag(y) " + show(tagged))
  record(7, problems.length === 0, problems.length === 0 ? "queries are deterministic and per contract: case-insensitive substring search, an empty query returns every undeleted note, tag queries exclude tombstones, and a regex metacharacter is just a substring" : problems.join(" | "))
}

async function checkEight(mod) {
  const a = api(mod)
  if (!need(a, ["project", "open", "append"])) { record(8, false, MISSING); return }
  const dir = storeDir("r8")
  const store = a.open(dir, { writer: "gate" })
  for (const text of ["damage one", "damage two", "damage three"]) await a.append(store, { text, tags: [], author: "verifier" })
  await store.close()
  // The tail is cut in the middle of its last record: a torn write, not a clean truncation.
  let logRel = null
  let best = 0
  for (const rel of filesUnder(dir)) {
    const text = readFileSync(join(dir, rel), "utf8")
    const count = text.split(String.fromCharCode(10)).filter((line) => { try { const p = JSON.parse(line); return p !== null && typeof p === "object" && Number.isInteger(p.seq) } catch { return false } }).length
    if (count > best) { best = count; logRel = rel }
  }
  const problems = []
  if (logRel === null || best !== 3) problems.push("no log file with three records was found under the store dir: " + show(filesUnder(dir)))
  else {
    const text = readFileSync(join(dir, logRel), "utf8")
    const lines = text.split(String.fromCharCode(10)).filter((line) => line !== "")
    const torn = lines[lines.length - 1].slice(0, Math.max(1, Math.floor(lines[lines.length - 1].length / 2)))
    writeFileSync(join(dir, logRel), lines.slice(0, lines.length - 1).join(String.fromCharCode(10)) + String.fromCharCode(10) + torn, "utf8")
    const survived = recordsFrom(dir).map((row) => row.seq)
    let state = null
    let reopened = null
    try {
      reopened = a.open(dir, { writer: "gate" })
      state = a.project(recordsFrom(dir))
    } catch (error) {
      problems.push("reopening a log with a torn tail threw: " + clip(String(error && error.message ? error.message : error), 90))
    }
    if (survived.length !== 2) problems.push("this gate's own reader found sequences " + show(survived) + " after the tear, expected the two complete records")
    const storeView = reopened !== null && reopened !== undefined && reopened.log !== undefined && typeof reopened.log.replay === "function" ? a.project(reopened.log.replay()) : null
    if (storeView !== null && storeView.counts.notes !== 2) problems.push("the reopened store's own view holds " + show(storeView.counts.notes) + " notes after the tear, expected the two complete ones")
    if (state !== null) {
      if (state.counts.notes !== 2) problems.push("the fold holds " + show(state.counts.notes) + " notes after the tear, expected the two complete ones")
      const texts = state.notes.map((n) => n.text)
      if (show(texts) !== show(["damage one", "damage two"])) problems.push("the surviving notes are " + show(texts) + ", expected the complete prefix")
    }
    const damage = damageOf(reopened)
    if (damage.value === null) problems.push("no damage was reported anywhere on the reopened store (checked store.damage and store.log.damage): the tear was silent")
    else {
      const shape = damage.value
      if (!Array.isArray(shape.brokenLines) || shape.brokenLines.length === 0) problems.push("the damage report carries brokenLines " + show(shape.brokenLines))
      if (shape.lastGoodSeq !== 2) problems.push("the damage report says lastGoodSeq " + show(shape.lastGoodSeq) + ", expected 2")
      if (typeof shape.bytes !== "number") problems.push("the damage report carries bytes " + show(shape.bytes))
      console.log("      damage read from " + damage.source + ": " + clip(show(shape), 120))
    }
    if (reopened !== null && reopened !== undefined && typeof reopened.close === "function") await reopened.close()
  }
  console.log("      torn tail on " + show(logRel) + "; complete prefix survives as " + clip(show(recordsFrom(dir).map((r) => r.seq)), 40))
  record(8, problems.length === 0, problems.length === 0 ? "a torn tail is reported as damage and the complete part is read back: facts are neither thrown away nor silently dropped" : problems.join(" | "))
}

// A ledger that carries notes AND records of other layers, plus two unusable note shapes.
const mixedLedger = (a) => [
  noteFact(a, 1, "m-1", "fine", [], "open", 100, "w1"),
  noteFact(a, 2, "m-2", "fine too", [], "open", 200, "w2"),
  { kind: a.NOTE_KIND, seq: 3, writer: "w3", instance: "i1", actor: "verifier", subject: 42, at: 300, payload: { text: "no id at all", tags: [], state: "open", author: "verifier" } },
  { kind: a.NOTE_KIND, seq: 4, writer: "w4", instance: "i1", actor: "verifier", subject: "m-4", at: 400, payload: { id: "m-4", text: 42, tags: [], state: "open", author: "verifier" } },
  { kind: "member/state", seq: 5, writer: "w5", instance: "i1", actor: "team-1", subject: "m-5", at: 500, payload: { id: "m-5", name: "m-5", state: "active", role: "member" } },
  { kind: "lock/state", seq: 6, writer: "w6", instance: "i1", actor: "team-1", subject: "task-1", at: 600, payload: {} },
]

function checkNine(mod, collab) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "noteRecord", "project"])) { record(9, false, MISSING); return }
  const problems = []
  const records = [
    noteFact(a, 1, "c-1", "readable note", ["x"], "open", 100, "w1"),
    noteFact(a, 2, "c-2", "also readable", ["x"], "open", 200, "w2"),
    noteFact(a, 3, "c-3", "readable too", ["x"], "done", 300, "w3"),
    noteFact(a, 4, "c-4", "archived note", ["x"], "archived", 400, "w4"),
  ]
  const noteState = a.project(records)
  const archived = noteState === null ? undefined : noteState.notes.find((n) => n.id === "c-4")
  if (archived === undefined) problems.push("the note carrying an unknown state vanished from the fold")
  else if (archived.state !== "archived") problems.push("a state this layer does not know was rewritten to " + show(archived.state) + ", expected archived written verbatim")
  if (noteState !== null && noteState.counts.done !== 2) problems.push("counts.done is " + show(noteState.counts.done) + ", expected 2 (done plus the unknown-but-not-open state)")
  // This fold reads exactly one kind: it has no unknown counter, and records of other kinds are not its business.
  if (noteState !== null && Object.prototype.hasOwnProperty.call(noteState.counts, "unknown")) problems.push("the notes fold carries an unknown counter " + show(noteState.counts.unknown) + "; this layer reads only its own kind, so it has no unknown concept")

  const mixed = mixedLedger(a)
  let state = null
  try { state = a.project(mixed) } catch (error) { problems.push("projectNotes threw on a mixed ledger with two unusable shapes: " + clip(String(error && error.message ? error.message : error), 80)) }
  if (state !== null) {
    if (state.counts.malformed !== 2) problems.push("counts.malformed is " + show(state.counts.malformed) + ", expected 2 (a record without a usable id and one whose text is not a string); records of other kinds are neither counted nor malformed")
    if (state.counts.notes !== 2) problems.push("counts.notes is " + show(state.counts.notes) + ", expected the two usable notes")
    const ids = state.notes.map((n) => n.id)
    if (show(ids) !== show(["m-1", "m-2"])) problems.push("the usable notes are " + show(ids) + ", expected m-1,m-2")
  }
  console.log("      notes over the mixed ledger -> " + clip(show(state === null ? null : state.counts), 110) + " (the two records of other kinds are ignored)")
  record(9, problems.length === 0, problems.length === 0 ? "the notes fold reads only its own kind: a ledger that also carries records of other layers yields the two usable notes and two malformed shapes, with no unknown concept anywhere" : problems.join(" | "))
}

// The same mixed ledger seen by the layer that cannot use note facts. Its unknown count is the honest answer.
// This is NOT the R39 failure: there a fold counted its OWN kind as unreadable; here the unreadable records belong
// to another layer, which has no way to interpret them.
function checkTen(mod, collab) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "noteRecord", "project"])) { record(10, false, MISSING); return }
  const host = collab !== null && typeof collab.projectTeamState === "function" ? collab.projectTeamState : null
  if (host === null) { record(10, false, COLLAB_MISSING); return }
  const mixed = mixedLedger(a)
  const noteFacts = mixed.filter((row) => row.kind === a.NOTE_KIND).length
  const problems = []
  const counts = host(mixed).counts
  if (counts.unknown !== noteFacts) problems.push("collab's fold reports unknown " + show(counts.unknown) + " for " + String(noteFacts) + " note facts, expected exactly that many: the note kind is not collab's to read and saying so is the honest answer (R39 was different: there the fold counted its OWN kind as unreadable)")
  console.log("      collab over the same mixed ledger -> " + clip(show(counts), 120) + " with " + String(noteFacts) + " of those records being note facts it cannot use")
  record(10, problems.length === 0, problems.length === 0 ? "the host layer reports exactly the note facts as unknown: a kind it cannot use is named as such, which is honest, and the mixed ledger still folds its own two records" : problems.join(" | "))
}
// ------------------------------------------------------------- staging: the artifact, imported as it ships
/**
 * The artifact is loaded from a staged copy, never from lib/ itself. The copy lives one level below the package
 * root - the same depth as lib/ - so the artifact's own relative import ../../dsh-link-collab/lib/index.js still
 * finds the same neighbour, and only the specifiers in REWRITES are replaced, by file URL, everywhere they appear
 * in the three quote characters. Nothing else about the text changes: `untouched` is the check that un-rewriting
 * the staged text gives the shipped bytes back exactly.
 */
const STAGES = []
const STAGE_DIR = ".staged-" + String(process.pid)
/** Every module specifier the text names, so a bare one left behind can be listed instead of guessed at. */
const SPECIFIERS = /(?:^|[\s;{(])(?:from|import)\s*\(?\s*["']([^"']+)["']/gu
const bareOf = (text) => [...new Set([...text.matchAll(SPECIFIERS)].map((match) => match[1]))]
  .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:") && !specifier.startsWith("file:"))
const rewriteSource = (source) => {
  let text = source
  const rewritten = []
  for (const [specifier, file] of Object.entries(REWRITES)) {
    const url = pathToFileURL(file).href
    const before = text
    for (const quote of ["'", '"', String.fromCharCode(96)]) text = text.split(quote + specifier + quote).join(quote + url + quote)
    if (text !== before) rewritten.push(specifier + " -> " + url)
  }
  return { text, rewritten }
}
const unrewrite = (text) => {
  let out = text
  for (const [specifier, file] of Object.entries(REWRITES)) out = out.split(pathToFileURL(file).href).join(specifier)
  return out
}
const stageArtifact = (artifactPath, source) => {
  const dir = join(dirname(dirname(artifactPath)), STAGE_DIR)
  const { text, rewritten } = rewriteSource(source)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "index.mjs")
  writeFileSync(file, text, "utf8")
  const stage = {
    dir,
    file,
    gone: false,
    rewritten,
    untouched: unrewrite(text) === source,
    source: { path: artifactPath, bytes: Buffer.byteLength(source, "utf8"), sha256: sha(Buffer.from(source, "utf8")), bare: bareOf(source) },
    staged: { path: file, bytes: Buffer.byteLength(text, "utf8"), sha256: sha(Buffer.from(text, "utf8")), bare: bareOf(text) },
  }
  STAGES.push(stage)
  return stage
}
/** The staged copies are scratch: the tree is left as it was found, and stage.1 reports that they are gone. */
const removeStages = () => {
  for (const stage of STAGES) {
    rmSync(stage.dir, { recursive: true, force: true })
    stage.gone = !existsSync(stage.dir)
  }
}

// ---------------------------------------------------------------- temp stores under .tmp, deleted at the end
let BASE = null
const base = () => {
  if (BASE === null) { mkdirSync(join(PROJECT, ".tmp"), { recursive: true }); BASE = mkdtempSync(join(PROJECT, ".tmp", "r48-")) }
  return BASE
}
let RUN = 0
const storeDir = (name) => { const dir = join(base(), "run-" + String(RUN) + "-" + name); mkdirSync(dir, { recursive: true }); return dir }
const CHILD = () => {
  const path = join(base(), "child-writer.mjs")
  writeFileSync(path, [
    "import { writeFileSync } from \"node:fs\"",
    "import { pathToFileURL } from \"node:url\"",
    "const [dir, out, modulePath] = process.argv.slice(2)",
    "try {",
    "  const mod = await import(pathToFileURL(modulePath).href)",
    "  const store = mod.openNotesStore(dir, { writer: \"child\" })",
    "  const first = await mod.appendNote(store, { text: \"child note one\", tags: [\"child\"], author: \"child\" })",
    "  const second = await mod.appendNote(store, { text: \"child note two\", tags: [], author: \"child\" })",
    "  await store.close()",
    "  writeFileSync(out, JSON.stringify({ ok: true, pid: process.pid, ids: [first.id, second.id] }))",
    "} catch (error) {",
    "  writeFileSync(out, JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }))",
    "  process.exit(3)",
    "}",
  ].join(String.fromCharCode(10)) + String.fromCharCode(10))
  return path
}
// A child process is spawned with stdio ignored (no pipe is captured) and reports through a file it writes.
const runChild = (dir, tag) => {
  const out = join(base(), "child-result-" + tag + ".json")
  const done = spawnSync(process.execPath, [CHILD(), dir, out, CURRENT], { stdio: "ignore", cwd: PROJECT })
  let payload = null
  if (existsSync(out)) { try { payload = JSON.parse(readFileSync(out, "utf8")) } catch { payload = null } }
  return { status: done.status, signal: done.signal, payload }
}

// ---------------------------------------------------------------- readings
// Each one builds its own store under .tmp. Records are re-read from the bytes on disk by this gate's own JSONL
// reader, so every expectation below comes from the fixture and the contract, never from the engine.

async function checkOne(mod) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "noteRecord", "project", "open", "append"])) { record(1, false, MISSING); return }
  const dir = storeDir("r1")
  const store = a.open(dir, { writer: "gate" })
  const first = await a.append(store, { text: "会话一：升级不许丢", tags: ["beta", "alpha", "beta"], author: "verifier" })
  const second = await a.append(store, { text: "Second note", tags: ["beta"], author: "verifier" })
  const third = await a.append(store, { text: "第三个便条", tags: [], author: "verifier" })
  await store.close()
  const records = recordsFrom(dir)
  const state = a.project(records)
  const ids = [first.id, second.id, third.id]
  const problems = []
  if (new Set(ids).size !== 3) problems.push("the three appends reused an id: " + show(ids))
  if (records.length !== 3) problems.push("the log holds " + String(records.length) + " records, expected 3")
  for (const row of records) if (row.kind !== a.NOTE_KIND) problems.push("a record carries kind " + show(row.kind) + ", expected " + show(a.NOTE_KIND))
  if (!records.every((row) => typeof row.at === "number")) problems.push("a record carries no numeric at: " + clip(show(records.map((r) => r.at)), 60))
  if (state === null || typeof state !== "object") problems.push("projectNotes returned " + show(state))
  else {
    if (state.counts.notes !== 3) problems.push("counts.notes is " + show(state.counts.notes))
    if (state.counts.open !== 3) problems.push("counts.open is " + show(state.counts.open))
    if (state.counts.deleted !== 0) problems.push("counts.deleted is " + show(state.counts.deleted))
    if (state.counts.malformed !== 0) problems.push("counts.malformed is " + show(state.counts.malformed))
    const order = state.notes.map((n) => n.id)
    if (show(order) !== show(ids)) problems.push("the fold order is " + show(order) + ", expected the append order " + show(ids))
    const head = state.notes.find((n) => n.id === first.id)
    if (head === undefined) problems.push("the first note is missing from the fold")
    else {
      if (show(head.tags) !== show(["alpha", "beta"])) problems.push("the first note carries tags " + show(head.tags) + ", expected sorted and deduplicated [alpha,beta]")
      if (head.text !== "会话一：升级不许丢") problems.push("the first note carries text " + show(head.text))
      if (head.author !== "verifier") problems.push("the first note carries author " + show(head.author))
      if (head.state !== "open") problems.push("the first note carries state " + show(head.state))
      if (head.contested !== false || show(head.losers) !== show([])) problems.push("the first note is contested " + show([head.contested, head.losers]))
    }
    if (norm(state.byTag) !== norm({ alpha: [first.id], beta: [first.id, second.id] })) problems.push("byTag is " + show(state.byTag) + ", expected alpha:[first] beta:[first,second] in (at,seq) order")
  }
  console.log("      three appends -> " + clip(show({ counts: state === null ? null : state.counts, order: state === null ? null : state.notes.map((n) => n.id), byTag: state === null ? null : state.byTag }), 190))
  record(1, problems.length === 0, problems.length === 0 ? "three appended notes fold to counts.notes 3 / open 3, tags sorted and deduplicated, byTag exact, and the fold order is the append order" : problems.join(" | "))
}

async function checkTwo(mod) {
  const a = api(mod)
  if (!need(a, ["project", "open", "append"])) { record(2, false, MISSING); return }
  const dir = storeDir("r2")
  const store = a.open(dir, { writer: "gate" })
  for (const text of ["restart one", "restart two", "重启三"]) await a.append(store, { text, tags: ["restart"], author: "verifier" })
  const before = a.project(recordsFrom(dir))
  const beforeBytes = bytesOf(dir)
  await store.close()
  const reopened = a.open(dir, { writer: "gate" })
  const after = a.project(recordsFrom(dir))
  const afterBytes = bytesOf(dir)
  const problems = []
  if (reopened === null || reopened === undefined) problems.push("reopening the same directory gave nothing back")
  if (before === null || after === null) problems.push("the fold is empty on one side of the restart: " + show([before === null, after === null]))
  else if (show(before) !== show(after)) problems.push("the fold changed across close/reopen: " + clip(show(before), 90) + " vs " + clip(show(after), 90))
  if (digestOf(beforeBytes) !== digestOf(afterBytes)) problems.push("the bytes on disk changed across close/reopen")
  const view = reopened !== null && reopened !== undefined && reopened.log !== undefined && typeof reopened.log.replay === "function" ? a.project(reopened.log.replay()) : null
  if (view === null) problems.push("the reopened store exposes no replayable log, so it cannot read its own history back")
  else if (before === null || show(view) !== show(before)) problems.push("the reopened store's own view differs from the pre-close fold: " + clip(show(view), 90) + " vs " + clip(show(before), 90))
  if (after !== null && after.counts.notes !== 3) problems.push("after the restart counts.notes is " + show(after.counts.notes) + ", expected 3")
  if (reopened !== null && reopened !== undefined && typeof reopened.close === "function") await reopened.close()
  console.log("      fold before close " + clip(show(before === null ? null : before.counts), 90))
  console.log("      fold after reopen " + clip(show(after === null ? null : after.counts), 90) + "; disk digest " + digestOf(beforeBytes).slice(0, 12) + " -> " + digestOf(afterBytes).slice(0, 12))
  record(2, problems.length === 0, problems.length === 0 ? "closing and reopening the same directory in this process reads the history back byte for byte (same fold, same disk digest)" : problems.join(" | "))
}

async function checkThree(mod) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "project", "open", "append"])) { record(3, false, MISSING); return }
  const dir = storeDir("r3")
  // The contract's order, deliberately: the second process writes first and exits; this process never opened
  // this directory before it ran, so nothing here can be an in-memory leftover.
  const child = runChild(dir, "r3-" + String(RUN))
  const problems = []
  if (child.status !== 0) problems.push("the child exited with status " + show(child.status) + " signal " + show(child.signal) + ": " + clip(show(child.payload), 90))
  if (child.payload === null || child.payload.ok !== true) problems.push("the child did not report success: " + clip(show(child.payload), 90))
  else if (child.payload.pid === process.pid) problems.push("the child reported this process's pid, so it was not a second process")
  const childIds = child.payload !== null && Array.isArray(child.payload.ids) ? child.payload.ids : []
  if (childIds.length !== 2) problems.push("the child reported " + show(childIds) + ", expected two ids")
  const reopened = a.open(dir, { writer: "gate" })
  const view = reopened !== null && reopened !== undefined && reopened.log !== undefined && typeof reopened.log.replay === "function" ? a.project(reopened.log.replay()) : null
  if (view === null) problems.push("the reopened store exposes no replayable log, so it cannot show what the second process wrote")
  else {
    const seen = view.notes.map((n) => n.id)
    for (const id of childIds) if (seen.indexOf(id) === -1) problems.push("the reopened store's own view does not carry the child's note " + id + ": " + show(seen))
    if (view.counts.notes !== 2) problems.push("the reopened store's own view holds " + show(view.counts.notes) + " notes, expected the child's two")
  }
  const mine = await a.append(reopened, { text: "written here after the child exited", tags: ["gate"], author: "verifier" })
  const state = a.project(recordsFrom(dir))
  if (state !== null && state.counts.notes !== 3) problems.push("after this process appended one note the fold holds " + show(state.counts.notes) + " notes, expected 3")
  if (reopened !== null && reopened !== undefined && typeof reopened.close === "function") await reopened.close()
  const expected = [...childIds]
  if (state === null) problems.push("projectNotes returned nothing after the child ran")
  else {
    if (state.counts.notes !== 3) problems.push("counts.notes is " + show(state.counts.notes) + ", expected 3 (two from the child, one from this process afterwards)")
    const present = state.notes.map((n) => n.id)
    for (const id of expected) if (present.indexOf(id) === -1) problems.push("note " + id + " did not survive the process boundary")
    if (show(present) !== show([...childIds, mine.id])) problems.push("the fold order is " + show(present) + ", expected " + show([...childIds, mine.id]) + " (write order)")
  }
  console.log("      child pid " + show(child.payload === null ? null : child.payload.pid) + " (this process " + String(process.pid) + ") wrote " + show(childIds))
  console.log("      reopened here -> " + clip(show(state === null ? null : { counts: state.counts, order: state.notes.map((n) => n.id) }), 150))
  record(3, problems.length === 0, problems.length === 0 ? "a second process wrote notes and exited; reopening the same directory here finds every note and folds to the same bytes - the data lives outside this process" : problems.join(" | "))
}

async function checkFour(mod) {
  const a = api(mod)
  if (!need(a, ["NOTE_KIND", "project", "open", "append", "setState", "openNotes", "search", "withTag"])) { record(4, false, MISSING); return }
  const dir = storeDir("r4")
  const store = a.open(dir, { writer: "gate" })
  const first = await a.append(store, { text: "keep me", tags: ["beta"], author: "verifier" })
  const second = await a.append(store, { text: "delete me", tags: ["beta", "gone"], author: "verifier" })
  const third = await a.append(store, { text: "keep me too", tags: [], author: "verifier" })
  const tombstone = await a.setState(store, second.id, "deleted")
  await store.close()
  const records = recordsFrom(dir)
  const state = a.project(records)
  const problems = []
  if (records.length !== 4) problems.push("the log holds " + String(records.length) + " records after the deletion, expected 4 (a deletion is a fact, not an erasure)")
  const buried = state === null ? undefined : state.notes.find((n) => n.id === second.id)
  if (buried === undefined) problems.push("the deleted note vanished from notes[] - a tombstone must stay visible")
  else if (buried.state !== "deleted") problems.push("the deleted note reads state " + show(buried.state) + ", expected deleted")
  if (state !== null) {
    if (state.counts.notes !== 3) problems.push("counts.notes is " + show(state.counts.notes) + ", expected 3")
    if (state.counts.deleted !== 1) problems.push("counts.deleted is " + show(state.counts.deleted) + ", expected 1")
    if (state.counts.open !== 2) problems.push("counts.open is " + show(state.counts.open) + ", expected 2")
    const openIds = a.openNotes(state).map((n) => n.id)
    if (show(openIds) !== show([first.id, third.id])) problems.push("openNotes gives " + show(openIds) + ", expected the two survivors in (at,seq) order")
    const searched = a.search(state, "").map((n) => n.id)
    if (show(searched) !== show([first.id, third.id])) problems.push("searchNotes with the empty string gives " + show(searched) + ", expected the two survivors")
    const tagged = a.withTag(state, "beta").map((n) => n.id)
    if (show(tagged) !== show([first.id])) problems.push("notesWithTag(beta) gives " + show(tagged) + ", expected only the surviving tagged note")
    if (typeof tombstone.seq !== "number") problems.push("setNoteState returned " + clip(show(tombstone), 60))
  }
  console.log("      tombstone -> " + clip(show(state === null ? null : { counts: state.counts, openNotes: a.openNotes(state).map((n) => n.id) }), 150))
  record(4, problems.length === 0, problems.length === 0 ? "a deleted note stays in notes[] with state deleted, counts.deleted 1, and the queries hide it while the by-id path still shows it" : problems.join(" | "))
}

async function checkFive(mod) {
  const a = api(mod)
  if (!need(a, ["open", "append", "setState"])) { record(5, false, MISSING); return }
  const dir = storeDir("r5")
  const store = a.open(dir, { writer: "gate" })
  const first = await a.append(store, { text: "append only one", tags: [], author: "verifier" })
  const second = await a.append(store, { text: "append only two", tags: [], author: "verifier" })
  const before = bytesOf(dir)
  await a.setState(store, second.id, "done")
  const middle = bytesOf(dir)
  await a.append(store, { text: "append only three", tags: [], author: "verifier" })
  const after = bytesOf(dir)
  await store.close()
  const problems = []
  problems.push(...grewByPrefix(before, middle))
  problems.push(...grewByPrefix(middle, after))
  const grew = Object.keys(after).some((rel) => before[rel] !== undefined && after[rel].length > before[rel].length)
  if (!grew) problems.push("no file grew at all, so the fixture proves nothing")
  const seqs = recordsFrom(dir).map((row) => row.seq)
  if (show(seqs) !== show([1, 2, 3, 4])) problems.push("the log holds sequences " + show(seqs) + ", expected 1,2,3,4 in one stream (two appends, one state fact, one more append)")
  if (first.id === second.id) problems.push("two appends returned the same id")
  const sizes = Object.keys(before).sort().map((rel) => rel + ": " + String(before[rel].length) + " -> " + String(after[rel].length) + " bytes")
  console.log("      files " + show(sizes))
  console.log("      the old bytes stay a prefix of the new ones at every step; sequences " + show(seqs))
  record(5, problems.length === 0, problems.length === 0 ? "the state change and the third append only extend the log: every pre-existing byte survives as a prefix, no file shrinks, and the sequences stay one unbroken stream" : problems.join(" | "))
}
const damageOf = (store) => {
  if (store === null || store === undefined) return { source: "none", value: null }
  if (store.damage !== undefined && store.damage !== null) return { source: "store.damage", value: store.damage }
  const log = store.log
  if (log !== undefined && log !== null) {
    if (typeof log.damage === "function") { const value = log.damage(); if (value !== undefined && value !== null) return { source: "store.log.damage()", value } }
    if (log.damage !== undefined && log.damage !== null) return { source: "store.log.damage", value: log.damage }
  }
  return { source: "none", value: null }
}

// ---------------------------------------------------------------- self-attack (R40-R47 rulings)
const MUTATIONS = [
  // Anchors are exact substrings of the product under test, plugins/dsh-link-notes/lib/index.js, each verified
  // to occur exactly once. The declared set is what the mutant MUST redden: extra or missing reds are a mismatch.
  ["tag queries stop excluding tombstones", "if (note.state === DELETED) continue;", "if (false) continue;", [4, 7]],
  ["a tombstone vanishes from notes[]", "notes: ordered,", "notes: ordered.filter((note) => note.state !== DELETED),", [4]],
  ["counts.deleted is hardcoded", "deleted: ordered.filter((note) => note.state === DELETED).length,", "deleted: 0,", [4]],
  ["search stops being case-insensitive", "const needle = typeof text === \"string\" ? text.toLowerCase() : \"\";", "const needle = typeof text === \"string\" ? text : \"\";", [7]],
  ["an empty query returns nothing", "return state.notes.filter((note) => note.state !== DELETED && note.text.toLowerCase().includes(needle));", "if (needle === \"\") return []; return state.notes.filter((note) => note.state !== DELETED && note.text.toLowerCase().includes(needle));", [4, 7]],
  ["the store cannot read its own history", "return projectNotes(store.log.replay());", "return projectNotes([]);", [4, 5]],
  ["the claim rule is bypassed for seq", "const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: incoming.at, seq: incoming.seq });", "const folded = { incomingWins: incoming.seq > previous.seq, byAt: false };", [6]],
  ["arrival order decides the fold", "for (const record of [...records].sort((left, right) => left.seq - right.seq)) {", "for (const record of records) {", [6]],
  ["an unusable shape breaks the fold instead of being counted", "      malformed += 1;\n      continue;", "      malformed += 1;\n      throw new Error(\"unusable note shape\");", [9]],
  ["malformed is never counted", "      malformed\n    }", "      malformed: 0\n    }", [9]],
  ["an unknown state is corrected to open", "state: typeof payload?.state === \"string\" && payload.state !== \"\" ? payload.state : OPEN,", "state: typeof payload?.state === \"string\" && [\"open\", \"done\", \"deleted\"].includes(payload.state) ? payload.state : OPEN,", [9]],
  ["tags are neither sorted nor deduplicated", "return [...new Set(usable)].sort();", "return usable;", [1]],
  ["every open starts a fresh log", "const log = openControlLog({ dir: join(dir, \"notes\"), writer: options?.writer ?? \"notes\" });", "const log = openControlLog({ dir: join(dir, \"notes-\" + randomUUID()), writer: options?.writer ?? \"notes\" });", [2, 3, 8]],
  ["records of other kinds stop being ignored", "if (record.kind !== NOTE_KIND) continue;", "if (false) continue;", [9]],
  ["the note kind is renamed into one collab can read", "var NOTE_KIND = \"note/state\";", "var NOTE_KIND = \"team/state\";", [10]],
]
const READINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// A mutant build must keep the sibling package reachable: the product imports collab through a relative path.
let CURRENT = MODULE
let SIBLING = false
const copyTree = (src, dst) => {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name), to = join(dst, name)
    if (statSync(from).isDirectory()) copyTree(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}
const prepareSibling = () => {
  if (SIBLING) return
  copyTree(dirname(dirname(COLLAB)), join(base(), "dsh-link-collab"))
  SIBLING = true
}

async function selfAttack() {
  const source = readFileSync(MODULE, "utf8")
  const lines = [], rows = []
  let applied = 0, matched = 0
  for (const [name, from, to, declared] of MUTATIONS) {
    const flipped = source.split(from).join(to)
    if (flipped === source) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(from) + " in the product)") } else {
      applied += 1
      prepareSibling()
      const dir = join(base(), "mutant-" + String(applied))
      copyTree(dirname(dirname(MODULE)), dir)
      writeFileSync(join(dir, "lib", "index.js"), flipped)
      // The mutant is staged exactly the way the shipped artifact is: a mutant has to be judged as a product, not
      // as a module this checkout happens not to be able to import.
      const mutant = stageArtifact(join(dir, "lib", "index.js"), flipped)
      const attempt = await load(mutant.file)
      if (attempt.mod === null) {
        lines.push("  " + name + " -> the mutant does not import at all (" + attempt.error + "), so no reading can judge it")
        rows.push({ name, declared })
        continue
      }
      const seen = await runAll(mutant.file)
      const observed = seen.failed.slice().sort((l, r) => l - r)
      const want = declared.slice().sort((l, r) => l - r)
      const clean = show(observed) === show(want)
      if (clean) matched += 1
      lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
    }
    rows.push({ name, declared })
  }
  console.log("== mutants: each must redden exactly its declared set ==")
  console.log(lines.join(String.fromCharCode(10)))
  const uncovered = READINGS.filter((n) => rows.every((r) => r.declared.indexOf(n) === -1))
  console.log("")
  console.log("coverage matrix (reading -> mutants that claim it):")
  for (const n of READINGS) console.log("  " + n + ": " + (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED"))
  console.log("")
  console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(matched) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
  return applied === MUTATIONS.length && matched === applied && uncovered.length === 0 ? 0 : 1
}

async function runAll(modulePath) {
  results.length = 0
  RUN += 1
  CURRENT = modulePath
  const attempt = await load(modulePath)
  MODULE_LOAD.path = modulePath
  MODULE_LOAD.error = attempt.error
  const mod = attempt.mod
  const collabAttempt = await load(COLLAB)
  COLLAB_LOAD.path = COLLAB
  COLLAB_LOAD.error = collabAttempt.error
  const collab = collabAttempt.mod
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [8, checkEight], [9, checkNine], [10, checkTen]]
  const failed = [], skipped = []
  for (const [n, check] of sequence) {
    const mark = results.length
    try { await check(mod, collab) } catch (error) { record(n, false, "the check threw: " + (error && error.message ? error.message : String(error))) }
    if (results.length === mark) record(n, false, "no reading was recorded")
    const row = results[results.length - 1]
    if (row.skip) skipped.push(n)
    else if (!row.ok) failed.push(n)
  }
  return { failed, skipped }
}

async function main() {
  if (!existsSync(MODULE)) { console.log("SKIP  no notes engine at " + MODULE); return 3 }
  const absent = Object.entries(REWRITES).filter(([, file]) => !existsSync(file))
  if (absent.length > 0) {
    console.log("SKIP  the kernel module " + absent.map(([specifier, file]) => specifier + " -> " + file).join(", ") + " is missing, so the shipped artifact cannot be staged and this gate will not stand in a fake one")
    return 3
  }
  const stage = stageArtifact(MODULE, readFileSync(MODULE, "utf8"))
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll(stage.file)
  console.log("")
  console.log(String(results.length) + " readings, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  removeStages()
  const loadCode = await loadPathReadings(stage)
  if (failed.length > 0) return 1
  if (skipped.length > 0) return 3
  return loadCode
}

// ------------------------------------------------- the load path: the staging facts, and the honest pair
/**
 * stage.1 says what was staged, which specifier was rewritten, both sha256 digests, and that the staged directory
 * is gone again - each fact checkable by hand. load.1/load.2 are a PAIR over the one lie this gate used to tell: a
 * module that cannot be imported must never read as a module whose symbols are missing.
 */
async function loadPathReadings(stage) {
  console.log("")
  console.log("== the load path (the staged artifact, and what an import failure is called) ==")
  console.log("  (rerun: node scripts/verify-notes.mjs   from " + PROJECT + ")")
  SINK = LOAD_RESULTS
  const problems = []
  if (stage.gone !== true) problems.push("the staged directory is still there: " + stage.dir)
  if (stage.untouched !== true) problems.push("the staged text differs from the shipped bytes by more than the rewritten specifiers")
  if (stage.staged.bare.length > 0) problems.push("the staged artifact still imports the bare specifier(s) " + show(stage.staged.bare) + ", so importing it cannot work and every reading below would be about nothing")
  const facts = "staged " + stage.source.path + " (" + String(stage.source.bytes) + " B, sha256 " + stage.source.sha256 + ") as " + stage.staged.path
    + " (" + String(stage.staged.bytes) + " B, sha256 " + stage.staged.sha256 + "), one level below the package root - the same depth as lib/, so the artifact's own relative import ../../dsh-link-collab/lib/index.js still finds the same neighbour"
    + "; rewrote " + String(stage.rewritten.length) + " specifier(s) " + (stage.rewritten.length === 0 ? "(none: the rewrite table is empty)" : "(" + stage.rewritten.join(", ") + ")")
    + "; every other byte of the staged text is the shipped byte (" + String(stage.untouched) + "); bare specifiers left in the staged text " + show(stage.staged.bare)
    + "; the staged directory is gone again (" + String(stage.gone) + ")"
  record("stage.1", problems.length === 0, problems.length === 0 ? facts : facts + " | PROBLEMS: " + problems.join(" | "))

  // The pair, asked of the same honest() a failing reading goes through: not a mock of it.
  const noSurface = join(base(), "probe-imports-but-exposes-no-surface.mjs")
  writeFileSync(noSurface, "export const nothing = true" + String.fromCharCode(10))
  const cannotImport = join(base(), "probe-cannot-be-imported.mjs")
  writeFileSync(cannotImport, 'import "@deepseek-ai/r48-gate-nothing-installs-this"' + String.fromCharCode(10) + "export const nothing = true" + String.fromCharCode(10))
  const allowed = await load(noSurface)
  const refused = await load(cannotImport)
  const asReading = (attempt, path) => {
    const saved = { path: MODULE_LOAD.path, error: MODULE_LOAD.error }
    MODULE_LOAD.path = path
    MODULE_LOAD.error = attempt.error
    const text = honest(MISSING)
    MODULE_LOAD.path = saved.path
    MODULE_LOAD.error = saved.error
    return text
  }
  const missingText = asReading(allowed, noSurface)
  record("load.1", missingText === MISSING, "a module that imports but exposes no R48 surface still reads as the missing-surface message: " + show(missingText))
  const brokenText = asReading(refused, cannotImport)
  record("load.2", refused.mod === null && brokenText !== MISSING && brokenText.indexOf("could not be imported") !== -1 && brokenText.indexOf(String(refused.error)) !== -1,
    "a module that cannot be imported reads as an import failure, never as a missing surface: " + show(brokenText))
  console.log("")
  const loadFailed = LOAD_RESULTS.filter((row) => !row.ok).length
  console.log(String(LOAD_RESULTS.length) + " load-path readings, " + String(LOAD_RESULTS.length - loadFailed) + " held, 0 skipped, " + String(loadFailed) + " failed")
  SINK = results
  return loadFailed === 0 ? 0 : 1
}

let code = 3
try { code = SELF_ATTACK ? await selfAttack() : await main() } finally { removeStages() }
const roots = BASE
if (BASE !== null) rmSync(BASE, { recursive: true, force: true })
console.log("")
console.log("store roots: " + (roots === null ? "none were needed" : roots + " (built under .tmp, removed again: " + String(!existsSync(roots)) + ")"))
process.exit(code)

