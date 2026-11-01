#!/usr/bin/env node
/**
 * R52 (task-99): the conversation-header toolbar entry - the first user-visible deliverable.
 *
 * Subject: .tmp/r52-contract.md. This gate recomputes, on its own: that the slot the entry mounts into exists and is a
 * session-scoped list; that the client half statically registers exactly that slot with `slots` injected; that the pure
 * function behind the menu answers in three DISTINCT states (present, missing -> not-mounted, empty string -> empty-value,
 * because an empty string is not an absence); that its order is fixed and its calls are deterministic; that every labelKey
 * is a dictionary key and no product copy lives outside the dictionary; that no stylesheet carries a literal colour; and it
 * records the package contract verdict as it comes. The live reading is allowed to SKIP, and a file in the build is never
 * treated as mounting evidence (the cost recorded in R49).
 *
 * Expectations are computed here from the contract, from the kernel's own slot declaration and from a fabricated
 * attribute source; the only things read back from the product are the shapes the contract says it must have. Self-attack
 * follows the rulings: declared-set equality per mutant, a coverage matrix with no uncovered reading, anchors taken from
 * the product under test. This gate runs no other gate; the package checker is a product under test and the live probe is
 * a browser read, not a gate. All temporary work stays under .tmp.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : resolve(argv[i + 1]) }
const PKG = resolve(option("--pkg", join(PROJECT, "plugins", "dsh-link-toolbar")))
const SURFACE = resolve(option("--surface", join(PROJECT, "compat", "surface", "client-0.2.1-alpha.1.json")))
const KERNEL = resolve(option("--kernel", join(PROJECT, "core", "deepseek-harness")))
const CHECKER = resolve(option("--checker", join(PROJECT, "scripts", "check-plugin-contract.mjs")))
const BAND_OWNER = resolve(option("--band-owner", join(PROJECT, "plugins", "dsh-link-responsive", "src", "client", "apply-layout.ts")))
const SELF_ATTACK = argv.includes("--self-attack")
const SLOT = "conversation.session.header.actions"
const KERNEL_SLOTS = join(KERNEL, "packages", "client", "ui-conversation", "src", "client", "contract", "slots.ts")
const CDP_PORT = Number(option("--cdp-port", "9222"))
const MODULE = join(PKG, "lib", "index.js")
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : status === "skip" ? "SKIP" : "FAIL") + "  " + n + ". " + detail)
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t)
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? String(v) : text }
const readText = (file) => { try { return readFileSync(file, "utf8") } catch { return null } }
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return null } }
const runNode = (args, timeoutMs = 600000) => {
  const done = spawnSync(process.execPath, args, { cwd: PROJECT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs })
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" }
}
let BASE = null
const base = () => {
  if (BASE === null) { mkdirSync(join(PROJECT, ".tmp"), { recursive: true }); BASE = mkdtempSync(join(PROJECT, ".tmp", "r52-")) }
  return BASE
}
/** Every file under a directory, relative and sorted. */
const filesUnder = (root) => {
  const out = []
  const walk = (rel) => {
    const abs = rel === "" ? root : join(root, rel)
    for (const name of readdirSync(abs).sort()) {
      const child = rel === "" ? name : rel + "/" + name
      if (statSync(join(abs, name)).isDirectory()) walk(child)
      else out.push(child)
    }
  }
  if (existsSync(root)) walk("")
  return out
}
const clientFiles = () => filesUnder(join(PKG, "src", "client"))
const isDictionary = (rel) => /locale/i.test(rel)
const isCss = (rel) => rel.endsWith(".css")
const lineOf = (text, index) => text.slice(0, index).split(String.fromCharCode(10)).length
/** The attribute the responsive half writes on the document root: read from the half that owns it. */
function bandAttribute() {
  const text = readText(BAND_OWNER)
  if (text === null) return { name: null, source: null }
  const match = text.match(/BAND_ATTRIBUTE\s*=\s*['"]([^'"]+)['"]/)
  return { name: match === null ? null : match[1], source: BAND_OWNER }
}
/** A fabricated attribute source: answers from a table and records every name the product asks for. */
function sourceOf(table) {
  const asked = []
  return {
    asked,
    getAttribute(name) { if (asked.indexOf(name) === -1) asked.push(name); return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null },
  }
}
const isItem = (item) => item !== null && typeof item === "object" && typeof item.id === "string" && typeof item.labelKey === "string" && typeof item.enabled === "boolean" && (item.reason === null || typeof item.reason === "string") && (item.value === null || typeof item.value === "string")

const api = (mod) => ({ items: mod && typeof mod.toolbarItems === "function" ? mod.toolbarItems : null })
const MISSING = "the built host half exports no toolbarItems, so the pure function cannot be recomputed (task-98 has not landed, or the pure function is not exported from lib/index.js)"

// ---------------------------------------------------------------- readings

function checkOne(mod) {
  const problems = []
  const surface = readJson(SURFACE)
  if (surface === null) { record(1, false, "no readable client surface at " + SURFACE); return }
  const slots = surface.slots ?? null
  if (slots === null) { record(1, false, "the capture carries no slots section"); return }
  const row = slots[SLOT] ?? null
  if (row === null) problems.push("the captured client surface does not carry " + SLOT)
  else {
    const declared = Array.isArray(row.declaredIn) ? row.declaredIn : typeof row.declaredIn === "string" ? [row.declaredIn] : []
    // R237: this used to pin the declaration to slots.ts:156. The rc.2 pin moved the line to 229 and the reading
    // went red for a citation that had simply drifted - a line number is not a fact about the slot. It now resolves
    // the captured anchor and checks the kernel file AT THAT LINE still declares the slot, so the reading survives a
    // pin move while still refusing a capture that points somewhere else.
    const anchor = declared.find((entry) => String(entry).indexOf("ui-conversation") !== -1 && String(entry).indexOf("slots.ts:") !== -1)
    const anchorLine = anchor === undefined ? null : Number(/:([0-9]+)$/.exec(String(anchor))?.[1] ?? '0')
    const kernelLines = anchorLine === null ? [] : String(readText(KERNEL_SLOTS) ?? '').split('\n')
    const atAnchor = anchorLine === null ? '' : String(kernelLines[anchorLine - 1] ?? '')
    if (anchor === undefined) problems.push("the capture declares " + SLOT + " in " + clip(show(declared), 90) + ", expected an anchor into ui-conversation's slots.ts")
    else if (atAnchor.indexOf(SLOT) === -1) problems.push("the capture anchors " + SLOT + " at " + String(anchor) + ", but that line of the kernel declaration reads " + clip(show(atAnchor.trim()), 90) + " - the anchor has drifted")
    console.log("      captured entry " + clip(show(row), 150))
    console.log("      the capture carries " + show(Object.keys(row).sort()) + "; kind and scope are not in it, so they are read from the kernel declaration the entry points at (recorded)")
  }
  const kernelText = readText(KERNEL_SLOTS)
  if (kernelText === null) problems.push("no kernel slot declaration at " + relative(PROJECT, KERNEL_SLOTS))
  else {
    const lines = kernelText.split(String.fromCharCode(10))
    const at = lines.findIndex((line) => line.indexOf("'" + SLOT + "'") !== -1)
    if (at === -1) problems.push("the kernel declaration does not name " + SLOT)
    else {
      const block = lines.slice(at, at + 5).join(" ")
      if (!/kind:\s*'list'/.test(block)) problems.push("the kernel does not declare " + SLOT + " as kind: 'list' at line " + String(at + 1) + ": " + clip(block, 120))
      if (!/scope:\s*'session'/.test(block)) problems.push("the kernel does not declare " + SLOT + " as scope: 'session': " + clip(block, 120))
      console.log("      kernel " + relative(PROJECT, KERNEL_SLOTS) + ":" + String(at + 1) + " -> " + clip(block, 150))
    }
  }
  record(1, problems.length === 0, problems.length === 0 ? "the capture carries " + SLOT + " and the kernel declares it kind 'list' / scope 'session': a session-scoped list is where this entry belongs" : problems.join(" | "))
}

function checkTwo(mod) {
  const problems = []
  const sources = clientFiles().filter((rel) => /\.(ts|tsx|js|jsx|mjs)$/.test(rel))
  if (sources.length === 0) { record(2, false, "no client sources under " + relative(PROJECT, join(PKG, "src", "client"))); return }
  const hits = []
  for (const rel of sources) {
    const text = readText(join(PKG, "src", "client", rel))
    if (text !== null && text.indexOf(SLOT) !== -1) hits.push({ rel, text })
  }
  if (hits.length === 0) problems.push("no client source names the slot " + SLOT + "; those present are " + show(sources))
  let injected = false
  for (const hit of hits) {
    const inject = /inject\s*[:=]\s*\[([^\]]*)\]/.exec(hit.text)
    if (inject !== null && inject[1].indexOf("slots") !== -1) injected = true
    console.log("      " + hit.rel + " names the slot; inject " + (inject === null ? "not found" : clip(show(inject[1]), 60)))
  }
  if (!injected) problems.push("no client source that names the slot injects 'slots'")
  const builtText = readText(join(PKG, "lib", "client.js"))
  if (builtText === null) console.log("      the built client bundle is absent; its presence would not be mounting evidence anyway (R49)")
  else console.log("      the built client bundle carries the slot name: " + String(builtText.indexOf(SLOT) !== -1) + " (recorded; a file in the build is not mounting evidence, R49)")
  record(2, problems.length === 0, problems.length === 0 ? "the client half statically registers " + SLOT + " and injects slots, the shape the sibling brand half uses" : problems.join(" | "))
}

function checkThree(mod) {
  const a = api(mod)
  if (a.items === null) { record(3, false, MISSING); return }
  const problems = []
  const probe = sourceOf({})
  const list = a.items(probe)
  if (!Array.isArray(list) || list.length < 3) { record(3, false, "toolbarItems returned " + clip(show(list), 90) + ", expected at least three items"); return }
  for (const item of list) if (!isItem(item)) problems.push("an item does not carry the contract shape (id/labelKey/enabled/reason/value): " + clip(show(item), 110))
  const asked = probe.asked.slice().sort()
  if (asked.length === 0) problems.push("the items never ask the attribute source for anything")
  const band = bandAttribute()
  if (band.name === null) problems.push("no band attribute could be read from " + relative(PROJECT, BAND_OWNER))
  else if (asked.indexOf(band.name) === -1) problems.push("the items never ask for the band attribute " + band.name + "; asked " + show(asked))
  const states = []
  for (const name of asked) {
    const value = "probe-" + String(asked.indexOf(name) + 1)
    const items = a.items(sourceOf({ [name]: value }))
    if (items.length !== list.length) { problems.push("the item count changed with the source: " + String(items.length) + " vs " + String(list.length)); continue }
    const on = items.filter((item) => item.enabled === true)
    const wrongOn = on.filter((item) => item.value !== value || item.reason !== null)
    const wrongOff = items.filter((item) => item.enabled === false && (item.reason !== "not-mounted" || item.value !== null))
    if (on.length === 0) problems.push("with " + name + " present and non-empty no item became enabled")
    if (wrongOn.length > 0) problems.push("with " + name + " present the enabled item carries " + clip(show(wrongOn[0]), 110) + ", expected value " + show(value) + " and reason null")
    if (wrongOff.length > 0) problems.push("with " + name + " present another item reads " + clip(show(wrongOff[0]), 110) + ", expected not-mounted and value null")
    states.push(name + " -> " + String(on.length) + " enabled")
  }
  console.log("      attributes asked: " + show(asked) + "; band attribute " + show(band.name) + " read from " + relative(PROJECT, BAND_OWNER))
  for (const line of states) console.log("      " + line)
  record(3, problems.length === 0, problems.length === 0 ? "every attribute the items read, when present and non-empty, turns exactly its item enabled with that value and reason null, and leaves the rest not-mounted" : problems.join(" | "))
}

function checkFour(mod) {
  const a = api(mod)
  if (a.items === null) { record(4, false, MISSING); return }
  const probe = sourceOf({})
  const list = a.items(probe)
  if (!Array.isArray(list)) { record(4, false, "toolbarItems returned " + clip(show(list), 90)); return }
  const problems = []
  for (const item of list) if (item.enabled !== false || item.reason !== "not-mounted" || item.value !== null) problems.push("with nothing present the item " + show(item.id) + " reads " + clip(show(item), 110) + ", expected enabled false / reason not-mounted / value null")
  console.log("      absent attributes -> " + clip(show(list.map((item) => item.id + ":" + String(item.reason))), 170))
  record(4, problems.length === 0, problems.length === 0 ? "an attribute that is missing reads as not-mounted with no value: absence is stated, not guessed" : problems.join(" | "))
}

function checkFive(mod) {
  const a = api(mod)
  if (a.items === null) { record(5, false, MISSING); return }
  const probe = sourceOf({})
  const list = a.items(probe)
  if (!Array.isArray(list) || probe.asked.length === 0) { record(5, false, "toolbarItems asked for no attributes: " + clip(show(list), 90)); return }
  const asked = probe.asked.slice().sort()
  const problems = []
  const observed = []
  for (const name of asked) {
    const items = a.items(sourceOf({ [name]: "" }))
    const empty = items.filter((item) => item.reason === "empty-value")
    const enabled = items.filter((item) => item.enabled === true)
    const wrong = empty.filter((item) => item.value !== null)
    if (empty.length === 0) problems.push("with " + name + " present but empty no item reports empty-value (missing and empty are being conflated)")
    if (wrong.length > 0) problems.push("the empty-value item carries value " + show(wrong[0].value) + ", expected null")
    if (enabled.length > 0) problems.push("with " + name + " empty an item became enabled: " + clip(show(enabled[0]), 110))
    const unaccounted = items.filter((item) => item.reason !== "empty-value" && item.reason !== "not-mounted")
    if (unaccounted.length > 0) problems.push("with " + name + " empty an item reports " + clip(show(unaccounted[0]), 100) + ", expected empty-value or not-mounted")
    observed.push(name + " -> " + String(empty.length) + " empty-value")
  }
  console.log("      empty string -> " + clip(show(observed), 180))
  record(5, problems.length === 0, problems.length === 0 ? "an attribute that is present but empty is reported as empty-value, distinctly from the same attribute missing: the empty string is not treated as an absence" : problems.join(" | "))
}

function checkSix(mod) {
  const a = api(mod)
  if (a.items === null) { record(6, false, MISSING); return }
  const problems = []
  const probe = sourceOf({})
  const first = a.items(probe)
  const second = a.items(probe)
  if (show(first) !== show(second)) problems.push("two calls on the same source differ: " + clip(show(first), 90) + " vs " + clip(show(second), 90))
  const asked = probe.asked.slice().sort()
  const full = {}
  asked.forEach((name, index) => { full[name] = "value-" + String(index) })
  const withValues = a.items(sourceOf(full))
  const reversed = {}
  asked.slice().reverse().forEach((name, index) => { reversed[name] = "r-" + String(index) })
  const reversedItems = a.items(sourceOf(reversed))
  const order = (list) => show(list.map((item) => item.id))
  if (order(first) !== order(withValues)) problems.push("the item order changed when the values changed: " + order(first) + " vs " + order(withValues))
  if (order(first) !== order(reversedItems)) problems.push("the item order followed the attribute source: " + order(first) + " vs " + order(reversedItems))
  const ids = first.map((item) => item.id)
  if (new Set(ids).size !== ids.length) problems.push("two items share an id: " + show(ids))
  const keys = first.map((item) => item.labelKey)
  if (new Set(keys).size !== keys.length) problems.push("two items share a labelKey: " + show(keys))
  console.log("      id order " + show(ids) + " - same source twice, changed values and a reversed table all give this order")
  record(6, problems.length === 0, problems.length === 0 ? "the item order is fixed by the list itself, not by the attribute values: the same input twice is byte-identical and different values only move enabled/value" : problems.join(" | "))
}

function checkSeven(mod) {
  const problems = []
  const files = clientFiles()
  const dicts = files.filter(isDictionary)
  const others = files.filter((rel) => !isDictionary(rel) && /\.(ts|tsx|js|jsx|mjs)$/.test(rel))
  if (dicts.length === 0) problems.push("no dictionary file under the client half: " + show(files))
  const dictText = dicts.map((rel) => readText(join(PKG, "src", "client", rel)) ?? "").join(String.fromCharCode(10))
  const dictKeys = new Set()
  for (const match of dictText.matchAll(/['"]([A-Za-z0-9_.\-]+)['"]\s*:/g)) dictKeys.add(match[1])
  const a = api(mod)
  const labelKeys = []
  if (a.items !== null) {
    const probe = sourceOf({})
    const absent = a.items(probe)
    const present = {}
    for (const name of probe.asked) present[name] = "mounted"
    const states = [absent, a.items(sourceOf(present)), a.items(sourceOf(Object.fromEntries(probe.asked.map((name) => [name, ""]))))]
    for (const list of states) for (const item of list) if (labelKeys.indexOf(item.labelKey) === -1) labelKeys.push(item.labelKey)
  }
  for (const key of labelKeys) if (!dictKeys.has(key)) problems.push("the item labelKey " + show(key) + " is not a key of the dictionary " + show(dicts))
  const hits = []
  const suspects = []
  for (const rel of others) {
    const text = readText(join(PKG, "src", "client", rel))
    if (text === null) continue
    text.split(String.fromCharCode(10)).forEach((line, index) => {
      const trimmed = line.trim()
      const comment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")
      if (/[\u3400-\u9fff\uff00-\uffef]/.test(line) && !comment) hits.push(rel + ":" + String(index + 1) + " CJK outside the dictionary: " + clip(trimmed, 80))
      const copy = /(label|tooltip|title|aria-label|placeholder)\s*[:=]\s*(['"])([^'"]{2,})\2/.exec(line)
      if (copy !== null) hits.push(rel + ":" + String(index + 1) + " literal copy in " + show(copy[1]) + ": " + clip(trimmed, 80))
      if (!comment) for (const match of line.matchAll(/['"]([^'"]{6,})['"]/g)) if (/\s/.test(match[1]) && /[A-Za-z]/.test(match[1])) suspects.push(rel + ":" + String(index + 1) + " " + clip(match[1], 50))
    })
  }
  for (const hit of hits) problems.push(hit)
  console.log("      dictionary " + show(dicts) + " -> " + String(dictKeys.size) + " key(s); item labelKeys " + show(labelKeys))
  console.log("      criterion: dictionary files match /locale/i; elsewhere a CJK character outside a comment, or a label/tooltip/title/aria-label/placeholder literal, is a violation")
  if (suspects.length > 0) console.log("      recorded for review, NOT gated (a false positive would show up here): " + clip(show(suspects), 220))
  record(7, problems.length === 0, problems.length === 0 ? "every labelKey the menu returns is a dictionary key and no product copy lives outside the dictionary file; the criterion and the review list are both printed" : problems.join(" | "))
}

function checkEight(mod) {
  const problems = []
  const css = clientFiles().filter(isCss)
  if (css.length === 0) problems.push("no stylesheet under the client half: " + show(clientFiles()))
  const literals = []
  let tokens = 0
  let seen = 0
  for (const rel of css) {
    const text = readText(join(PKG, "src", "client", rel)) ?? ""
    text.split(String.fromCharCode(10)).forEach((line, index) => {
      seen += 1
      if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\brgba?\(/.test(line) || /\bhsla?\(/.test(line)) literals.push(rel + ":" + String(index + 1) + " " + clip(line.trim(), 70))
      if (/var\(--dsw-[a-z0-9-]+\)/.test(line)) tokens += 1
    })
  }
  for (const hit of literals) problems.push("literal colour in " + hit)
  if (tokens === 0) problems.push("the stylesheets never reach a token through var(--dsw-*)")
  console.log("      " + String(css.length) + " stylesheet(s), " + String(seen) + " line(s), " + String(tokens) + " var(--dsw-*) use(s), literal colours " + String(literals.length))
  record(8, problems.length === 0, problems.length === 0 ? "the stylesheet speaks in tokens only: no #hex, rgb() or hsl() literal, and colours and radii come through var(--dsw-*)" : problems.join(" | "))
}

function checkNine(mod) {
  const run = runNode([CHECKER, PKG, "--json"])
  let judged = null
  try { judged = JSON.parse(run.stdout) } catch { judged = null }
  if (judged === null) { record(9, false, "the package checker printed no JSON (exit " + show(run.status) + "): " + clip(run.stderr, 110)); return }
  const rows = Array.isArray(judged.readings) ? judged.readings : []
  const refuse = rows.filter((row) => row.verdict === "fail" && row.severity === "refuse")
  const problems = []
  if (run.status === 0 && refuse.length > 0) problems.push("the checker exited 0 while " + String(refuse.length) + " refuse-level reading(s) failed")
  if (run.status !== 0 && refuse.length === 0) problems.push("the checker exited " + show(run.status) + " with no refuse-level reading failing")
  console.log("      package contract: " + clip(show(judged.counts), 90) + " (checker exit " + show(run.status) + " for the same reason the exit code always has: severity)")
  for (const row of rows) if (row.verdict !== "pass") console.log("      " + row.verdict + " " + row.rule + " (" + String(row.severity) + "): " + clip(show(row.basis), 130))
  record(9, problems.length === 0, problems.length === 0 ? "the package checker's verdict for this package is recorded as it came (" + clip(show(judged.counts), 70) + "): a red reading stays red and no rule was touched" : problems.join(" | "))
}

function cdpEval(url, expression, timeoutMs) {
  return new Promise((done) => {
    let settled = false
    let socket = null
    const finish = (value) => {
      if (settled) return
      settled = true
      try { socket.close() } catch { void 0 }
      done(value)
    }
    try { socket = new WebSocket(url) } catch { finish(null); return }
    const timer = setTimeout(() => finish(null), timeoutMs)
    socket.addEventListener("error", () => { clearTimeout(timer); finish(null) })
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    })
    socket.addEventListener("message", (event) => {
      let parsed = null
      try { parsed = JSON.parse(String(event.data)) } catch { parsed = null }
      if (parsed === null || parsed.id !== 1) return
      clearTimeout(timer)
      const inner = parsed.result === undefined || parsed.result.result === undefined ? null : parsed.result.result.value
      finish(typeof inner === "string" ? inner : null)
    })
  })
}

async function checkTen(mod) {
  const endpoint = "http://127.0.0.1:" + String(CDP_PORT) + "/json/list"
  let targets = null
  try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) }); targets = await response.json() } catch { targets = null }
  if (targets === null || !Array.isArray(targets) || targets.length === 0) {
    record(10, "skip", "no CDP endpoint answered on port " + String(CDP_PORT) + ", so nothing about a live shell can be read; this round delivers the entry and its honest content, not its visibility (contract boundary)")
    return
  }
  const page = targets.find((entry) => entry.type === "page" && typeof entry.webSocketDebuggerUrl === "string") ?? null
  if (page === undefined || page === null) { record(10, "skip", "CDP answered but no page target carries a websocket url"); return }
  const expression = "JSON.stringify({marker: !!document.querySelector('[data-dsh-link-toolbar]'), layout: !!document.querySelector('[data-dsh-link-layout]')})"
  const answer = await cdpEval(page.webSocketDebuggerUrl, expression, 4000)
  if (answer === null) { record(10, "skip", "the CDP page did not answer the probe in time, so the live state could not be read"); return }
  let seen = null
  try { seen = JSON.parse(answer) } catch { seen = null }
  if (seen === null) { record(10, false, "the live page answered something this gate cannot read: " + clip(answer, 90)); return }
  console.log("      live page -> " + show(seen))
  if (seen.marker !== true) {
    record(10, "skip", "the client half is not mounted in the live shell (no [data-dsh-link-toolbar] on the page); a file in the build is not mounting evidence and is never treated as such here (the cost recorded in R49)")
    return
  }
  record(10, true, "the live shell carries this package's marker with the responsive layout attribute alongside: " + show(seen))
}

function checkEleven(mod) {
  const problems = []
  const exported = mod !== null && mod !== undefined && typeof mod.toolbarItems === "function"
  const attributes = mod !== null && mod !== undefined && Array.isArray(mod.MARKER_ATTRIBUTES)
  if (!exported) problems.push("the shipped host half no longer exports toolbarItems, so the judgement cannot be recomputed from the shipped artifact")
  console.log("      recorded, not gated: the host half re-exports the pure function (" + String(exported) + ") and its marker table (" + String(attributes) + "). The kernel's client discipline is that a UI plugin does not export implementation values; this package deviates deliberately so a check can recompute the menu rows from the shipped artifact (accepted in the contract, R49 precedent).")
  record(11, problems.length === 0, problems.length === 0 ? "recorded deviation, kept visible: the pure function is exported from the shipped host half so the rows are recomputable without a browser; not judged as a defect" : problems.join(" | "))
}
// ---------------------------------------------------------------- self-attack (R40-R52 rulings)
const MUTATIONS = [
  // [name, what it mutates, anchor, replacement, declared set]. Anchors are exact substrings of the product under test
  // (the shipped host half, the client sources, the stylesheet, the dictionary, the manifest, or a staged copy of the
  // capture) and each was verified to occur exactly once. A missing anchor is NOT APPLICABLE and fails the run.
  ["the capture loses the slot", "surface", "\"conversation.session.header.actions\": {", "\"conversation.session.header.actionsX\": {", [1]],
  ["the client half registers a different slot", "client", "conversation.session.header.actions", "conversation.session.header.utilities", [2]],
  ["a missing marker is reported as empty", "module", "      return { id: marker.id, labelKey: \"item.\" + marker.id, enabled: false, reason: \"not-mounted\", value: null };", "      return { id: marker.id, labelKey: \"item.\" + marker.id, enabled: false, reason: \"empty-value\", value: null };", [3, 4]],
  ["the rows follow the attribute values instead of the table", "module", "  return MARKERS.map((marker) => {", "  return [...MARKERS].sort((left, right) => String(source.getAttribute(left.attribute)).localeCompare(String(source.getAttribute(right.attribute)))).map((marker) => {", [6]],
  // The dead null branch also enables the other markers in reading 5's fixture (they are missing, not empty).
  ["the missing branch is never taken", "module", "    if (raw === null || raw === void 0) {", "    if (false) {", [3, 4, 5]],
  ["an empty marker falls through as a value", "module", "    if (raw === \"\") {\n      return { id: marker.id, labelKey: \"item.\" + marker.id, enabled: false, reason: \"empty-value\", value: null };\n    }\n", "", [5]],
  ["the rows read a global instead of the injected source", "module", "    const raw = source === null || source === void 0 ? null : source.getAttribute(marker.attribute);", "    const raw = typeof document === \"undefined\" ? null : document.documentElement.getAttribute(marker.attribute);", [3, 5]],
  ["the label stops being a dictionary key", "module", "    return { id: marker.id, labelKey: \"item.\" + marker.id, enabled: true, reason: null, value: raw };", "    return { id: marker.id, labelKey: \"Layout is mounted\", enabled: true, reason: null, value: raw };", [7]],
  ["a dictionary key is renamed away", "dictionary", "'item.layout':", "'item.layoutX':", [7]],
  ["a literal colour enters the stylesheet", "css", "  border: 1px solid var(--dsw-alias-border-l4);\n  border-radius: var(--dsw-radius-md);", "  border: 1px solid #ff0000;\n  border-radius: var(--dsw-radius-md);", [8]],
  // An unreadable manifest breaks node's own module resolution for the package, so the module readings fall with it;
  // this mutant is about that coupling, not about the checker's verdict (reading 9 has its own mutant below).
  ["the manifest stops parsing", "manifest", "\"name\": \"dsh-link-toolbar\",", "\"name\": \"dsh-link-toolbar\"", [3, 4, 5, 6, 11]],
]
// Three readings are outside the coverage matrix, each for a measured reason:
//  10  the live reading SKIPs by design this round (the contract's boundary excludes live visibility), and a mutation
//      of the package cannot redden a SKIP.
//  11  the recorded deviation only records; it has no red set to claim.
//  9   records the package checker's verdict and gates only the exit-code/severity consistency that belongs to the
//      checker rather than to the package. Two product-side attempts to redden it (an unreadable manifest, an
//      unparseable shipped client bundle) left every gated reading unchanged, so it is declared mutant-free instead
//      of papered over.
// Every gated reading - 1 through 8 - is claimed by at least one mutant.
const READINGS = [1, 2, 3, 4, 5, 6, 7, 8]
const THIS_GATE = fileURLToPath(import.meta.url)

const copyTree = (src, dst) => {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name), to = join(dst, name)
    if (statSync(from).isDirectory()) copyTree(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}

async function selfAttack() {
  const lines = [], rows = []
  let applied = 0, matched = 0
  for (const [name, kind, from, to, declared] of MUTATIONS) {
    const root = join(base(), "mutant-" + String(applied + 1))
    mkdirSync(root, { recursive: true })
    let changed = null
    let pkgPath = PKG
    let surfacePath = SURFACE
    if (kind !== "surface") {
      pkgPath = join(root, "pkg")
      copyTree(PKG, pkgPath)
      const target = kind === "module" ? join(pkgPath, "lib", "index.js")
        : kind === "client" ? join(pkgPath, "src", "client", "index.tsx")
          : kind === "dictionary" ? join(pkgPath, "src", "client", "locales.ts")
            : kind === "css" ? join(pkgPath, "src", "client", "toolbar.css")
              : kind === "patch" ? join(pkgPath, "cordis.patch.yml")
                  : join(pkgPath, "package.json")
      const text = readFileSync(target, "utf8")
      changed = text.split(from).join(to)
      if (changed === text) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(clip(from, 50)) + " in " + kind + ")"); rows.push({ name, declared }); continue }
      writeFileSync(target, changed)
    } else {
      const text = readFileSync(SURFACE, "utf8")
      changed = text.split(from).join(to)
      if (changed === text) { lines.push("  " + name + " -> NOT APPLICABLE (no " + show(clip(from, 50)) + " in the capture)"); rows.push({ name, declared }); continue }
      surfacePath = join(root, "surface.json")
      writeFileSync(surfacePath, changed)
    }
    applied += 1
    const run = runNode([THIS_GATE, "--pkg", pkgPath, "--surface", surfacePath, "--checker", CHECKER, "--band-owner", BAND_OWNER, "--kernel", KERNEL])
    const observed = []
    for (const line of run.stdout.split(String.fromCharCode(10))) {
      const match = /^\s*FAIL\s+(\d+)\./.exec(line)
      if (match !== null) { const n = Number(match[1]); if (observed.indexOf(n) === -1) observed.push(n) }
    }
    observed.sort((l, r) => l - r)
    const want = declared.slice().sort((l, r) => l - r)
    const clean = show(observed) === show(want)
    if (clean) matched += 1
    lines.push("  " + name + " -> declared " + show(want) + ", observed " + show(observed) + (clean ? "  LOCALISED" : "  MISMATCH"))
    rows.push({ name, declared })
  }
  console.log("== mutants: each must redden exactly its declared set ==")
  console.log(lines.join(String.fromCharCode(10)))
  const uncovered = READINGS.filter((n) => rows.every((r) => r.declared.indexOf(n) === -1))
  console.log("")
  console.log("coverage matrix (reading -> mutants that claim it; 9, 10 and 11 are outside it, see the note above):")
  for (const n of READINGS) console.log("  " + n + ": " + (rows.filter((r) => r.declared.indexOf(n) !== -1).map((r) => r.name.split(" ")[0]).join(",") || "UNCOVERED"))
  console.log("")
  console.log("mutants applied " + String(applied) + " of " + String(MUTATIONS.length) + "; declared-set matches " + String(matched) + " of " + String(applied) + "; uncovered readings " + String(uncovered.length))
  return applied === MUTATIONS.length && matched === applied && uncovered.length === 0 ? 0 : 1
}

async function runAll(modulePath) {
  results.length = 0
  const mod = await load(modulePath)
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [8, checkEight], [9, checkNine], [10, checkTen], [11, checkEleven]]
  const failed = [], skipped = []
  for (const [n, check] of sequence) {
    const mark = results.length
    try { await check(mod) } catch (error) { record(n, false, "the check threw: " + (error && error.message ? error.message : String(error))) }
    if (results.length === mark) record(n, false, "no reading was recorded")
    const row = results[results.length - 1]
    if (row.skip) skipped.push(n)
    else if (!row.ok) failed.push(n)
  }
  return { failed, skipped }
}

async function main() {
  if (!existsSync(PKG)) { console.log("SKIP  no package at " + PKG); return 3 }
  console.log("== real (this machine) ==")
  const { failed, skipped } = await runAll(MODULE)
  const gating = skipped.filter((n) => n !== 10)
  console.log("")
  console.log(String(results.length) + " readings, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (skipped.indexOf(10) !== -1) console.log("(reading 10 is the live reading and skips by design: this round delivers the entry and its honest content, not its visibility, so that skip does not gate - contract boundary)")
  if (failed.length > 0) return 1
  if (gating.length > 0) return 3
  return 0
}

const code = SELF_ATTACK ? await selfAttack() : await main()
const roots = BASE
if (BASE !== null) rmSync(BASE, { recursive: true, force: true })
console.log("")
console.log("temporary work: " + (roots === null ? "none was needed" : roots + " (built under .tmp, removed again: " + String(!existsSync(roots)) + ")"))
process.exit(code)
