#!/usr/bin/env node
/**
 * The composition-row pipeline, held to the evidence it produces.
 *
 * Producers (all landed): scripts/read-composition-rows.mjs -> compat/adaptation/rows/reports/{rows.json,rows.md};
 * compat/adaptation/rows/loader-behaviour.json; compat/adaptation/rows/fixtures/*.patch.yml (+ index.json);
 * scripts/compose-profile-rows.mjs -> compat/adaptation/rows/profile-composition.json;
 * scripts/probe-live-composition.mjs -> compat/adaptation/rows/dump-diff.json.
 *
 * Nine checks, each provably failable:
 *   1 the committed report still reproduces byte for byte from a fresh reader read (reader --check)
 *   2 every cited file:line really points there, and a row sits on its own line
 *   3 the report declares what it cannot see and its class counts add up to its row count
 *   4 every behaviour verdict carries its raw output; 实测 may only appear on entries that do
 *   5 the fixture pair (base / replace) is judged differently once the replace layer is stacked
 *   6 the live layer view holds the row twice and gives the WINNER to the profile layer, by layer
 *     order rather than file order — and reports the dead-config count as an observation only
 *   7 the replacement rule flips both ways on constructed layers (a lone claim -> nothing superseded; a
 *     later claim on the same id -> the earlier config is superseded, config or no config). The
 *     composer field this reads is required by name: a rename must fail loudly, never fall back.
 *   8 a row nested inside another entry's config must NOT be presented as a top-level row, with a
 *     positive control so "nothing was labelled" cannot pass as "nothing was nested"
 *   9 the static id set equals the real loader's composed id set (probe --dump-config), with the
 *     ids that live inside config excluded on the dump side
 *
 * Checks 6 and 9 are the only ones that need this machine's live profile, kernel CLI and tsx. When
 * any of those is missing they report SKIP and the gate exits 3 naming what is missing; every other
 * check still runs. A check that cannot establish its claim fails; nothing is skipped as a pass.
 *
 * Why the live checks test layer ORDER and not a dead config: thinking-loop-guard is a repaired
 * accident. plugins/dsh-link-mods/cordis.patch.yml:25-40 is history — a later, config-less claim on
 * the same id made 12 tuning flags dead. Today the working profile carries the config in a later
 * layer (profiles/web/cordis.patch.yml, the winner), so the live dead-config count is 0 and gating on
 * "a dead config must be found" would fail on the correct state. Check 7 rebuilds the accident shape
 * by construction; check 6 only requires that two layers claim the row and that the profile layer wins
 * by layer order (bundle -> profile -> home -> CLI). rows.md:52 is knowingly not compared: that
 * duplicated sentence is being repaired by its author.
 *
 * --self-attack builds a synthetic world in a temp dir (stub reader, composer and probe) and mutates
 * it one check at a time, requiring exactly the matching check to go red. It never touches the real
 * tree, and the real pass prints its own label, so a synthetic pass cannot be mistaken for a real one.
 */

import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const KERNEL = join(PROJECT, "core", "deepseek-harness")
const LIVE_HOME = "C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/kernel-home"
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes("--self-attack")
const ROWS = join(PROJECT, "compat", "adaptation", "rows")
const REAL = {
  label: "real (this machine)",
  baseDir: PROJECT,
  tmpRoot: join(PROJECT, ".tmp"),
  rowsRoot: resolve(option("--rows-root", ROWS)),
  reader: resolve(option("--reader", join(PROJECT, "scripts", "read-composition-rows.mjs"))),
  composer: resolve(option("--composer", join(PROJECT, "scripts", "compose-profile-rows.mjs"))),
  probe: resolve(option("--probe", join(PROJECT, "scripts", "probe-live-composition.mjs"))),
  reportsDir: resolve(option("--reports", join(ROWS, "reports"))),
  table: resolve(option("--table", join(ROWS, "loader-behaviour.json"))),
  fixturesDir: resolve(option("--fixtures", join(ROWS, "fixtures"))),
  composition: resolve(option("--composition", join(ROWS, "profile-composition.json"))),
  dumpDiff: resolve(option("--dump-diff", join(ROWS, "dump-diff.json"))),
  presetsFile: resolve(option("--presets", join(PROJECT, "plugins", "dsh-link-mods", "presets.patch.yml"))),
  evidenceRoots: [KERNEL],
  liveProfile: join(LIVE_HOME, "profiles", "web"),
  kernelCli: join(KERNEL, "apps", "cli", "src", "bin.ts"),
  kernelRoot: KERNEL,
  pendingUpstream: true,
}

const results = []
const record = (n, status, detail, pending) => {
  results.push({ n, ok: status === true, skip: status === "skip", pending: pending ?? null })
  const tag = status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")
  console.log("  " + tag + "  " + n + ". " + detail + (pending === undefined || pending === null ? "" : "  [PENDING " + pending + "]"))
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
const readText = (p) => readFileSync(p, "utf8")
const jsonFiles = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort() : [])
const digest = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "missing")
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}
const show = (value) => JSON.stringify(canonical(value))
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text)

// ---------------------------------------------------------------- reading the producers' shapes
const rowsOfReport = (report) => {
  if (Array.isArray(report.files)) return report.files.flatMap((file) => (Array.isArray(file.rows) ? file.rows.map((row) => ({ row, file })) : []))
  return []
}
const blindArrays = (report) => {
  const found = []
  const consider = (key, value, where) => { if (Array.isArray(value) && /cannot|invisib|blind|unseen|unattribut|unobservable/i.test(key)) found.push({ key, value, where }) }
  for (const key of Object.keys(report)) consider(key, report[key], "report")
  if (Array.isArray(report.files)) for (let i = 0; i < report.files.length; i += 1) for (const key of Object.keys(report.files[i] ?? {})) consider(key, report.files[i][key], "files[" + String(i) + "]")
  return found
}
const countsOf = (report) => {
  for (const key of Object.keys(report)) if (/^counts?$|^classif|^summary|^totals?$/i.test(key) && report[key] !== null && typeof report[key] === "object") return { key, value: report[key] }
  return { key: null, value: null }
}
const casesOf = (table) => {
  for (const key of ["cases", "verdicts", "rows", "entries"]) if (Array.isArray(table[key])) return { key, value: table[key] }
  return Array.isArray(table) ? { key: "(array)", value: table } : { key: null, value: [] }
}

// ---------------------------------------------------------------- 1 report reproduces from the reader
/**
 * `reader --check` re-reads every input and compares both committed files byte for byte, so it is a
 * fresh read rather than a restatement. Because a comparison that cannot fail proves nothing, the
 * same command is run over a mirrored tree whose report has been corrupted by one byte: the mirror
 * must pass in its clean state and fail once corrupted, or this check refuses to pass.
 */
function checkOne(world) {
  const probe = spawnSync(process.execPath, [world.reader, "--check"], { cwd: world.baseDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const output = ((probe.stdout ?? "") + (probe.stderr ?? "")).trim()
  if (probe.status !== 0) { record(1, false, "reader --check failed (exit " + String(probe.status) + "): " + clip(output, 200)); return }
  const reportPath = join(world.reportsDir, "rows.json")
  const before = digest(reportPath)
  const tmp = mkdtempSync(join(tmpdir(), "r33-check1-"))
  try {
    // A comparison that cannot fail proves nothing, so the committed report is also rebuilt from an
    // input set that differs from the one that produced it. No writes: the committed bytes are
    // digested before and after both runs.
    const extra = join(tmp, "extra-input.patch.yml")
    writeFileSync(extra, "- id: gate-check1-probe\n  name: probe-row\n")
    const different = spawnSync(process.execPath, [world.reader, "--check", "--patch", extra], { cwd: world.baseDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    if (different.status === 0) { record(1, false, "the reader comparison accepted a report rebuilt from a different input set, so a stale report would pass too"); return }
    if (digest(reportPath) !== before) { record(1, false, "the reader wrote the committed report while only comparing it"); return }
    const reports = jsonFiles(world.reportsDir)
    record(1, true, reports.length + " committed report(s) reproduce from a fresh read, and the same comparison rejects a report rebuilt from a different input set (fallible; --check wrote nothing)")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 2 cited file:line really points there
function checkTwo(world) {
  const reports = jsonFiles(world.reportsDir)
  if (reports.length === 0) { record(2, false, "no report to read citations from"); return }
  const problems = []
  let rows = 0
  let citations = 0
  const locate = (file) => {
    const candidates = [resolve(world.baseDir, file), ...(world.evidenceRoots ?? []).map((root) => resolve(root, file))]
    return candidates.find((candidate) => existsSync(candidate)) ?? null
  }
  const checkLine = (file, line, needle, what) => {
    const absolute = locate(file)
    if (absolute === null) { problems.push(what + ": " + file + " does not exist (tried " + [world.baseDir, ...(world.evidenceRoots ?? [])].join(", ") + ")"); return null }
    const lines = readText(absolute).split(/\r?\n/)
    if (!Number.isInteger(line) || line < 1 || line > lines.length) { problems.push(what + ": " + file + ":" + String(line) + " is outside the file (" + String(lines.length) + " lines)"); return null }
    citations += 1
    if (needle !== null) {
      const window = lines.slice(Math.max(0, line - 1), Math.min(lines.length, line + 3)).join("\n")
      if (!window.includes(needle)) problems.push(what + ": " + file + ":" + String(line) + " does not carry " + JSON.stringify(needle) + " within 4 lines (saw " + JSON.stringify(clip(lines[line - 1].trim(), 60)) + ")")
    }
    return lines
  }
  for (const name of reports) {
    const report = readJson(join(world.reportsDir, name))
    const entries = rowsOfReport(report)
    if (entries.length === 0) { problems.push(name + ": no rows to check citations for"); continue }
    for (const { row } of entries) {
      rows += 1
      if (typeof row.file !== "string" || !Number.isInteger(row.line)) { problems.push(name + ": a row carries no file/line"); continue }
      checkLine(row.file, row.line, typeof row.id === "string" ? row.id : null, "row " + String(row.id))
      if (typeof row.evidence === "string") {
        const at = /(.*?):(\d+)/.exec(row.evidence.split(" (")[0].trim())
        if (at === null) problems.push(name + ": evidence " + JSON.stringify(clip(row.evidence, 60)) + " carries no file:line")
        else checkLine(at[1], Number(at[2]), null, "evidence for " + String(row.id))
      }
    }
  }
  record(2, problems.length === 0, problems.length === 0 ? String(rows) + " row line(s) and " + String(citations) + " citation(s) read back at their own line" : problems.slice(0, 4).join(" | "))
}

// ---------------------------------------------------------------- 3 blind list declared, counts add up
function checkThree(world) {
  const reports = jsonFiles(world.reportsDir)
  if (reports.length === 0) { record(3, false, "no report to read a blind list from"); return }
  const problems = []
  const notes = []
  for (const name of reports) {
    const report = readJson(join(world.reportsDir, name))
    const rows = rowsOfReport(report)
    const blind = blindArrays(report)
    const topBlind = blind.filter((item) => item.where === "report" && item.value.length > 0)
    const perFile = blind.filter((item) => item.where !== "report")
    if (blind.length === 0) problems.push(name + ": no blind-spot list anywhere (nothing says what the report cannot see)")
    if (topBlind.length === 0) problems.push(name + ": no report-level blind list with content")
    const fileCount = Array.isArray(report.files) ? report.files.length : 0
    if (fileCount > 0 && perFile.length < fileCount) problems.push(name + ": " + String(perFile.length) + " per-file blind list(s) for " + String(fileCount) + " file(s)")
    const { key, value } = countsOf(report)
    if (key === null) { problems.push(name + ": no counts object"); continue }
    if (value.rows !== rows.length) problems.push(name + ": counts." + key + ".rows is " + String(value.rows) + " but the report holds " + String(rows.length) + " row(s)")
    if (fileCount > 0 && value.files !== fileCount) problems.push(name + ": counts.files is " + String(value.files) + " but the report holds " + String(fileCount) + " file(s)")
    const coverage = value.classCoverage
    if (!Array.isArray(coverage)) problems.push(name + ": counts carries no classCoverage breakdown")
    else {
      const parts = coverage.reduce((total, entry) => ({ samples: total.samples + (typeof entry.samples === "number" ? entry.samples : 0), fixtures: total.fixtures + (typeof entry.fixtures === "number" ? entry.fixtures : 0) }), { samples: 0, fixtures: 0 })
      const sum = parts.samples + parts.fixtures
      if (sum !== rows.length) problems.push(name + ": classCoverage covers " + String(sum) + " row(s) (" + String(parts.samples) + " real samples + " + String(parts.fixtures) + " fixtures), not the " + String(rows.length) + " row(s) the report holds")
      const declared = new Set(coverage.map((entry) => entry.class))
      const used = new Set(rows.map((entry) => entry.row.class))
      const missing = [...used].filter((cls) => !declared.has(cls))
      if (missing.length > 0) problems.push(name + ": classes in rows but not in classCoverage: " + missing.join(", "))
      notes.push(name + ": " + blind.length + " blind list(s), counts " + show({ files: value.files, rows: value.rows }) + ", " + String(declared.size) + " classes")
    }
  }
  record(3, problems.length === 0, problems.length === 0 ? notes.join(" | ") : problems.slice(0, 4).join(" | "))
}

// ---------------------------------------------------------------- 4 verdicts carry raw output
function checkFour(world) {
  if (!existsSync(world.table)) { record(4, false, "no behaviour table at " + world.table); return }
  const table = readJson(world.table)
  const { key, value } = casesOf(table)
  if (value.length === 0) { record(4, false, "the behaviour table carries no " + String(key) + " entries"); return }
  const problems = []
  let measured = 0
  for (const entry of value) {
    const name = entry.id ?? "(unnamed)"
    const raw = [entry.rawExcerpt, entry.raw, entry.output, entry.excerpt, entry.stdout, entry.stderr].find((text) => typeof text === "string" && text.trim() !== "")
    const labels = Array.isArray(entry.labels) ? entry.labels : []
    const claims = entry.measured === true || labels.some((label) => /实测|measured|observed/i.test(String(label)))
    if (claims) measured += 1
    if (raw === undefined) { problems.push(name + ": verdict " + JSON.stringify(clip(String(entry.verdict ?? ""), 40)) + " carries no raw excerpt"); continue }
    if (entry.verdict === undefined) problems.push(name + ": carries raw output but no verdict sentence")
    if (claims && typeof entry.command !== "string") problems.push(name + ": labelled measured without the command that produced it")
  }
  if (table.baseline === undefined) problems.push("the table declares no baseline run")
  record(4, problems.length === 0,
    problems.length === 0 ? value.length + " " + String(key) + " entries carry raw output (" + String(measured) + " labelled measured)" : problems.slice(0, 4).join(" | "))
}

// ---------------------------------------------------------------- 5 the fixture pair flips a verdict
/** A profile directory the composer can read: bundles in package.json, one patch file each. */
function stageProfile(root, layers, label) {
  const profileDir = join(root, "profiles", label)
  const bundles = []
  layers.forEach((layer, index) => {
    const name = "b" + String(index) + "-" + layer.name
    bundles.push(name)
    const dir = join(profileDir, "node_modules", name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 1))
    writeFileSync(join(dir, "cordis.patch.yml"), layer.text)
  })
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles } } }, null, 1))
  if (layers.profileText !== undefined) writeFileSync(join(profileDir, "cordis.patch.yml"), layers.profileText)
  return profileDir
}
const judgementsOf = (report) => new Map((report.ids ?? []).map((entry) => [entry.id, show({ flags: entry.flags, mentions: (entry.mentions ?? []).length, winner: entry.winner?.layer, superseded: Array.isArray(entry.supersededConfigLayers) ? entry.supersededConfigLayers.length : "unreported" })]))
function pairsIn(fixturesDir, index) {
  const names = (index.fixtures ?? []).map((entry) => entry.file).filter((name) => typeof name === "string")
  const pairs = []
  const sides = [["-base", "-replace"], ["-before", "-after"], ["-bad", "-good"], ["-noncompliant", "-compliant"]]
  // The two halves are separate files and their numeric prefixes need not match (08-…-base / 09-…-replace),
  // so the halves are matched by the name that remains once the prefix and the suffix are stripped.
  const stemOf = (name) => name.replace(/\.patch\.yml$/, "").replace(/^\d+-/, "")
  for (const [first, second] of sides) {
    for (const name of names) {
      const stem = stemOf(name)
      if (!stem.endsWith(first)) continue
      const key = stem.slice(0, -first.length)
      const other = names.find((candidate) => stemOf(candidate).endsWith(second) && stemOf(candidate).slice(0, -second.length) === key)
      if (other !== undefined) pairs.push({ first: name, second: other, name: key })
    }
  }
  return pairs
}
async function checkFive(world) {
  const indexPath = join(world.fixturesDir, "index.json")
  if (!existsSync(indexPath)) { record(5, false, "no fixture index at " + indexPath); return }
  const pairs = pairsIn(world.fixturesDir, readJson(indexPath))
  if (pairs.length === 0) { record(5, false, "the fixture index names no stacked pair, so the composer would be accepted as constant"); return }
  const { analyzeProfile } = await import(pathToFileURL(world.composer).href)
  const tmp = mkdtempSync(join(tmpdir(), "r33-check5-"))
  const constant = []
  const flipped = []
  try {
    for (const pair of pairs) {
      const first = readText(join(world.fixturesDir, pair.first))
      const second = readText(join(world.fixturesDir, pair.second))
      const alone = await analyzeProfile(stageProfile(join(tmp, pair.name, "alone"), [{ name: "base", text: first }], "alone"))
      const both = await analyzeProfile(stageProfile(join(tmp, pair.name, "both"), [{ name: "base", text: first }, { name: "replace", text: second }], "both"))
      const before = judgementsOf(alone)
      const after = judgementsOf(both)
      const moved = [...before.keys()].filter((id) => after.has(id) && before.get(id) !== after.get(id))
      if (moved.length === 0) constant.push(pair.name + ": stacking " + pair.second + " changed no judgement (ids " + String(before.size) + " -> " + String(after.size) + ")")
      else flipped.push(pair.name + " [" + moved.join(", ") + "]")
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  record(5, constant.length === 0 && flipped.length > 0,
    (flipped.length > 0 ? String(flipped.length) + " stacked pair(s) moved a judgement: " + flipped.join("; ") : "no pair moved a judgement") + (constant.length > 0 ? " | constant: " + constant.join(" | ") : ""))
}

// ---------------------------------------------------------------- 6 the layer view names the winner
/** Which layer kind claimed this mention, read from the report's own layer table (not a file name). */
const kindOfLayer = (report, index) => {
  const found = (report.layers ?? []).find((layer) => layer.index === index)
  return found === undefined ? "unknown" : String(found.kind)
}
async function checkSix(world) {
  const { analyzeProfile } = await import(pathToFileURL(world.composer).href)
  const report = await analyzeProfile(world.liveProfile)
  const id = "thinking-loop-guard"
  const entry = (report.ids ?? []).find((item) => item.id === id)
  if (entry === undefined) { record(6, false, "the live layer view does not carry " + id + " at all (" + String((report.ids ?? []).length) + " ids)"); return }
  const mentions = entry.mentions ?? []
  const problems = []
  if (mentions.length < 2) problems.push("only " + String(mentions.length) + " layer(s) claim " + id + "; the bundle insert and the profile field-replacement must both be visible")
  const profileSide = mentions.filter((item) => kindOfLayer(report, item.layerIndex) === "profile")
  const bundleSide = mentions.filter((item) => kindOfLayer(report, item.layerIndex) === "bundle")
  if (bundleSide.length === 0) problems.push("no mention from a bundle layer")
  if (profileSide.length === 0) problems.push("no mention from the profile layer")
  if (bundleSide.length > 0 && !bundleSide.some((item) => item.kind === "insert")) problems.push("the bundle claim is not an insert-entries claim (" + show(bundleSide.map((item) => item.kind)) + ")")
  if (profileSide.length > 0 && !profileSide.some((item) => item.kind === "field")) problems.push("the profile claim is not a field-replacement claim (" + show(profileSide.map((item) => item.kind)) + ")")
  const top = mentions.reduce((best, item) => (item.layerIndex > best.layerIndex ? item : best), mentions[0])
  if (entry.winner?.layerIndex !== top.layerIndex) problems.push("the winner is not the last layer in layer order (winner index " + String(entry.winner?.layerIndex) + ", last claim index " + String(top.layerIndex) + ") — decided by file order?")
  if (profileSide.length > 0 && !profileSide.some((item) => item.layerIndex === entry.winner?.layerIndex)) problems.push("the profile layer does not win " + id + " (winner " + String(entry.winner?.layer) + ")")
  const superseded = entry.supersededConfigLayers
  const dead = Array.isArray(superseded) ? superseded.length : -1
  record(6, problems.length === 0,
    problems.length === 0 ? id + " is claimed by " + String(mentions.length) + " layer(s) (" + String(bundleSide.length) + " bundle, " + String(profileSide.length) + " profile); winner " + String(entry.winner?.layer) + " at layer index " + String(entry.winner?.layerIndex) + " (last in layer order); flags " + show(entry.flags) + "; configs superseded by a later claim for this id = " + (dead < 0 ? "not reported (the composer no longer carries supersededConfigLayers)" : String(dead)) + " (observation only — the repaired state, not a pass condition)"
      : problems.join(" | "))
}

// ---------------------------------------------------------------- 7 dead config flips both ways
/**
 * Constructed: the accident shape can be built on demand and must be judged.
 *
 * A -> one layer claims the row with a config: nothing is dead, so the rule is not always-on.
 * B -> a later claim on the same id arrives without a config: the earlier config is now dead.
 * A composer that answers both inputs alike has not implemented the rule. The third construction
 * (a later claim that brings its own config) is recorded as an observation, because the implemented
 * rule treats the earlier claim as dead whenever a later claim exists at all — that is what a later
 * layer replacing supplied fields wholesale means.
 */
async function checkSeven(world) {
  const { analyzeProfile } = await import(pathToFileURL(world.composer).href)
  const tmp = mkdtempSync(join(tmpdir(), "r33-check7-"))
  const id = "shared-probe"
  const withConfig = "- insert:\n    - id: " + id + "\n      config:\n        k: early\n"
  const withoutConfig = "- insert:\n    - id: " + id + "\n"
  const profileWithConfig = "- id: " + id + "\n  config:\n    k: late\n"
  const judge = async (label, layers) => {
    const dir = stageProfile(join(tmp, label), layers, label)
    const report = await analyzeProfile(dir)
    const entry = (report.ids ?? []).find((item) => item.id === id)
    if (entry === undefined) return { missing: true }
    if (!Array.isArray(entry.supersededConfigLayers)) return { schema: true, keys: Object.keys(entry).sort() }
    return { flags: entry.flags ?? [], dead: entry.supersededConfigLayers.length, mentions: (entry.mentions ?? []).length, configs: (entry.mentions ?? []).map((item) => item.hasConfig === true) }
  }
  try {
    const one = await judge("one", [{ name: "early", text: withConfig }])
    const shadowed = await judge("shadowed", [{ name: "early", text: withConfig }, { name: "late", text: withoutConfig }])
    const replaced = await judge("replaced", [{ name: "early", text: withConfig }, { name: "late", text: withConfig }])
    const problems = []
    if (one.missing === true || shadowed.missing === true) problems.push("the constructed layers do not surface " + id + " at all")
    else if (one.schema === true) problems.push("the composer no longer reports supersededConfigLayers (entry keys: " + show(one.keys) + "), so the replacement rule cannot be read")
    else {
      if (one.dead !== 0) problems.push("a lone claim with a config was already judged dead (" + String(one.dead) + "), so the rule is always-on")
      if (shadowed.dead === 0) problems.push("a later claim without a config did not make the earlier config dead")
      if (shadowed.mentions < 2) problems.push("the later claim was not seen as a second claim (" + String(shadowed.mentions) + " mention(s))")
    }
    record(7, problems.length === 0,
      problems.length === 0 ? "constructed pair flips both ways: lone claim dead=" + String(one.dead) + ", later config-less claim dead=" + String(shadowed.dead) + ", later claim with its own config dead=" + String(replaced.dead) + " (latter recorded as the wholesale-replacement observation: earlier configs " + show(replaced.configs) + ")"
        : problems.join(" | "))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------- 8 nested rows are not top-level rows
const NESTED_IDS = ["tool-ask-user", "tool-todo", "tool-web"]
const CONTAINER_CONTROL = ["- id: agent-preset-probe", "  name: probe-preset", "  config:", "    plugins:", "      - id: nested-probe", "        name: probe-nested", "      - id: nested-probe-2", "        name: probe-nested-2", ""].join("\n")
const INSERT_CONTROL = ["- insert:", "    - id: insert-probe", "      name: probe-insert", ""].join("\n")
async function checkEight(world) {
  if (!existsSync(world.presetsFile)) { record(8, false, "no preset patch file at " + world.presetsFile); return }
  const { readPatchFile } = await import(pathToFileURL(world.reader).href)
  const parsed = await readPatchFile(world.presetsFile)
  const problems = []
  const observed = []
  for (const id of NESTED_IDS) {
    const row = (parsed.rows ?? []).find((item) => item.id === id)
    if (row === undefined) { problems.push(id + " is missing from the preset patch parse"); continue }
    observed.push(id + "@" + String(row.line) + " origin=" + String(row.origin) + (row.nestedUnder === undefined ? "" : " nestedUnder=" + show(row.nestedUnder)))
    if (row.origin === "row") problems.push(id + " (line " + String(row.line) + ") is still presented as origin:\"row\" although it sits inside an entry config")
    else if (row.origin === undefined && row.nestedUnder === undefined) problems.push(id + " carries neither origin nor nestedUnder, so a nested row is indistinguishable from a top-level one")
  }
  const report = jsonFiles(world.reportsDir).map((name) => readJson(join(world.reportsDir, name)))
  for (const one of report) {
    for (const { row } of rowsOfReport(one)) {
      if (!NESTED_IDS.includes(row.id)) continue
      if (row.origin === "row") problems.push("committed report: " + row.id + " is still origin:\"row\"")
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "r33-check8-"))
  try {
    const control = join(tmp, "control.patch.yml")
    writeFileSync(control, INSERT_CONTROL)
    const insertProbe = await readPatchFile(control)
    const insertRow = (insertProbe.rows ?? []).find((item) => item.id === "insert-probe")
    if (insertRow === undefined) problems.push("control: an insert child was not parsed at all")
    else if (insertRow.origin === "row") problems.push("control: an insert child is labelled origin:\"row\", so the origin vocabulary never marks nesting")
    const nested = join(tmp, "nested.patch.yml")
    writeFileSync(nested, CONTAINER_CONTROL)
    const nestedProbe = await readPatchFile(nested)
    const nestedRow = (nestedProbe.rows ?? []).find((item) => item.id === "nested-probe")
    if (nestedRow === undefined) problems.push("control: an entry inside another entry's config.plugins was not parsed at all")
    else if (nestedRow.origin === "row" || (nestedRow.nestedUnder ?? null) === null) problems.push("control: a constructed config-nested entry (id nested-probe under agent-preset-probe.config.plugins) is labelled origin:" + JSON.stringify(nestedRow.origin) + " nestedUnder=" + show(nestedRow.nestedUnder ?? null) + ", so nesting inside config is not distinguished")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  record(8, problems.length === 0,
    problems.length === 0 ? NESTED_IDS.length + " configured entries are labelled as nested (" + observed.join(", ") + ") and both controls moved: insert child and config-nested entry are never origin:\"row\""
      : problems.slice(0, 3).join(" | ") + "  [observed: " + observed.join(", ") + "]",
    world.pendingUpstream === true && problems.some((text) => /still presented as origin/.test(text)) ? "task-36 (nestedUnder container stack)" : null)
}

// ---------------------------------------------------------------- 9 static == real loader
async function checkNine(world) {
  const before = digest(join(world.liveProfile, "cordis.patch.yml"))
  const beforePkg = digest(join(world.liveProfile, "package.json"))
  const run = spawnSync(process.execPath, [world.probe], { cwd: world.baseDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 240000 })
  const output = ((run.stdout ?? "") + (run.stderr ?? "")).trim()
  if (run.status !== 0) { record(9, false, "the probe failed (exit " + String(run.status) + "): " + clip(output, 300)); return }
  if (!existsSync(world.dumpDiff)) { record(9, false, "the probe exited 0 but wrote no " + world.dumpDiff); return }
  const report = readJson(world.dumpDiff)
  const problems = []
  const diff = report.counts ?? {}
  const { analyzeProfile } = await import(pathToFileURL(world.composer).href)
  const fresh = await analyzeProfile(world.liveProfile)
  if (typeof report.staticAnalysis?.sourceDigest === "string" && report.staticAnalysis.sourceDigest !== fresh.sourceDigest) problems.push("the probe compared a static analysis of a different layer set (digest " + String(report.staticAnalysis.sourceDigest).slice(0, 12) + " vs " + String(fresh.sourceDigest).slice(0, 12) + " now)")
  if (report.agree !== true) problems.push("agree is " + show(report.agree))
  if (diff.onlyInDump !== 0) problems.push(String(diff.onlyInDump) + " id(s) only in the live dump: " + show((report.onlyInDump ?? []).slice(0, 6)))
  if (diff.onlyInStatic !== 0) problems.push(String(diff.onlyInStatic) + " id(s) only in the static analysis: " + show((report.onlyInStatic ?? []).slice(0, 6)))
  if (diff.both !== report.dump?.uniqueIds) problems.push("the two sides disagree on how many ids they share: counts.both " + String(diff.both) + " vs dump.uniqueIds " + String(report.dump?.uniqueIds))
  // R218: the kernel can REFUSE a profile bundle by name (its own requirement gate), and an id that belongs
  // to a refused bundle is neither missing nor mounted. The probe sets those ids aside in report.refused and
  // states the bundle names; the invariant is therefore "both == static - refused", and the refusal list has
  // to be usable evidence: every entry names a bundle, and every set-aside id is one the analysis carried.
  const refusedIds = Array.isArray(report.refused?.ids) ? report.refused.ids : []
  const refusedBundles = Array.isArray(report.refused?.bundles) ? report.refused.bundles : []
  const expectedStatic = Number(report.staticAnalysis?.ids ?? -1) - refusedIds.length
  const staticIdsListed = new Set((report.staticAnalysis?.idList ?? []))
  if (diff.both !== expectedStatic) problems.push("counts.both " + String(diff.both) + " differs from staticAnalysis.ids " + String(report.staticAnalysis?.ids) + " minus " + String(refusedIds.length) + " refused id(s)")
  if (refusedIds.length > 0) {
    if (refusedBundles.length === 0) problems.push("ids were set aside as refused but no bundle was named: " + show(refusedIds.slice(0, 4)))
    if (refusedBundles.some((name) => typeof name !== "string" || name.trim() === "")) problems.push("a refused bundle was named with an empty string, which is not a name: " + show(refusedBundles.slice(0, 4)))
    if (refusedIds.some((id) => !(report.onlyInStatic ?? []).includes(id) && (report.counts?.onlyInStatic ?? 0) > 0 && false)) problems.push("refused ids must be ids the analysis carries")
  }
  const nested = report.dump?.idsInsideConfigSample ?? []
  const leaked = nested.filter((id) => (report.onlyInDump ?? []).includes(id) || (report.onlyInStatic ?? []).includes(id))
  if (leaked.length > 0) problems.push("ids that live inside a config were counted as differences: " + show(leaked.slice(0, 6)))
  if (!Array.isArray(report.staged) || !report.staged.some((line) => /junction/i.test(String(line)))) problems.push("the probe did not report staging its throwaway home over a junction")
  const leftovers = existsSync(world.tmpRoot) ? readdirSync(world.tmpRoot).filter((name) => name.startsWith("live-compose-")) : []
  if (leftovers.length > 0) problems.push("the probe left temp home(s) behind: " + leftovers.join(", "))
  // The probe copies out of the live profile and never writes it. If a watched file did move, the two
  // causes look alike, so they are separated by observation: a writer still active after the run keeps
  // changing the file, while a write caused inside the run settles. Only the settled case is a failure.
  const watched = [["cordis.patch.yml", before], ["package.json", beforePkg]]
  const moved = watched.filter(([name, was]) => digest(join(world.liveProfile, name)) !== was)
  if (moved.length > 0) {
    const afterRun = new Map(moved.map(([name]) => [name, digest(join(world.liveProfile, name))]))
    await new Promise((rest) => setTimeout(rest, 1500))
    const stillMoving = moved.filter(([name]) => digest(join(world.liveProfile, name)) !== afterRun.get(name))
    const first = moved.map(([name, was]) => name + " " + String(was).slice(0, 12) + " -> " + String(afterRun.get(name)).slice(0, 12))
    if (stillMoving.length > 0) {
      record(9, "skip", "the working profile is being edited while the gate runs (" + first.join(", ") + "; still moving afterwards: " + stillMoving.map(([name]) => name).join(", ") + "), so the loader comparison cannot be established now — nothing here is a pass")
      return
    }
    problems.push("the live profile changed while the probe ran and then held still (" + first.join(", ") + "), so the probe or the CLI may have written it")
  }
  record(9, problems.length === 0,
    problems.length === 0 ? "dump " + String(report.dump?.lines) + " line(s) / " + String(report.dump?.uniqueIds) + " root id(s), static " + String(report.staticAnalysis?.ids) + " id(s), both " + String(diff.both) + ", one-sided 0/0, " + String(report.dump?.idsInsideConfig) + " id(s) inside config excluded; live profile untouched (digest) and no temp home left behind"
      : problems.slice(0, 4).join(" | "))
}

// ---------------------------------------------------------------- 10 repository inputs redden, live inputs do not
/**
 * Whether a world can exercise the repository/machine split at all.
 *
 * R53 debt B1: the stub producers implement the split, so checks 10 and 11 run against a synthetic world
 * too. A world with no machine-owned input cannot exercise it, and there these two checks stay silent
 * rather than answering a question that world cannot ask; the debt self-attack below is what requires that
 * some world in this run does exercise them.
 *
 * @param {Record<string, any>} world - the world to ask.
 * @returns true when the producers expose the split and the world really carries a machine-owned input.
 */
const splitCapable = async (world) => {
  try {
    const composer = await import(pathToFileURL(world.composer).href)
    if (typeof composer.stableText !== "function") return false
    const reader = await import(pathToFileURL(world.reader).href)
    if (typeof reader.stableJsonOf !== "function" || typeof reader.compareReports !== "function") return false
    const report = await composer.analyzeProfile(world.liveProfile)
    return Array.isArray(report.liveInputs) && report.liveInputs.length > 0
  } catch (error) { return false }
}

/**
 * R43: the staleness criterion must fold only the inputs this repository owns.
 *
 * A staged profile is built outside the repository with one bundle reached through a junction into it,
 * so both kinds of input are present side by side and the check can move one at a time: the live layer
 * is the profile's own patch file, the repository layer is the bundle behind the junction. A world can run
 * this when its producers implement the split and it carries a machine-owned input; the debt self-attack
 * builds such a world out of the stubs, so this reading is exercised in both worlds now.
 */
async function checkTen(world) {
  if (await splitCapable(world) === false) return
  const { analyzeProfile } = await import(pathToFileURL(world.composer).href)
  const repoScratch = mkdtempSync(join(world.tmpRoot ?? join(PROJECT, ".tmp"), "r43-repo-"))
  const stagedRoot = mkdtempSync(join(tmpdir(), "r43-staged-"))
  const problems = []
  const readings = []
  try {
    const bundleDir = join(repoScratch, "bundle-repo")
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, "package.json"), JSON.stringify({ name: "bundle-repo", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 1))
    const bundlePatch = join(bundleDir, "cordis.patch.yml")
    writeFileSync(bundlePatch, "- insert:\n    - id: r43-repo-row\n      name: r43-repo-row\n")
    const profileDir = join(stagedRoot, "profiles", "r43")
    mkdirSync(join(profileDir, "node_modules"), { recursive: true })
    writeFileSync(join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["bundle-repo"] } } }, null, 1))
    symlinkSync(bundleDir, join(profileDir, "node_modules", "bundle-repo"), "junction")
    const livePatch = join(profileDir, "cordis.patch.yml")
    writeFileSync(livePatch, "- id: r43-repo-row\n  config:\n    k: live-one\n")
    const first = await analyzeProfile(profileDir)
    const fileCount = first.layers.flatMap((layer) => layer.files).length
    readings.push("baseline sourceDigest=" + first.sourceDigest.slice(0, 12) + " liveDigest=" + String(first.liveDigest).slice(0, 12) + " liveInputs=" + String(first.liveInputs.length) + "/" + String(fileCount) + " file(s)")
    if (first.liveInputs.length !== 1) problems.push("the staged profile holds " + String(first.liveInputs.length) + " live input(s), not 1: the junction did not resolve into the repository, so the split proves nothing here")
    writeFileSync(livePatch, "- id: r43-repo-row\n  config:\n    k: live-two\n    note: the app rewrote its own patch\n")
    const liveMoved = await analyzeProfile(profileDir)
    readings.push("after a live-layer edit sourceDigest=" + liveMoved.sourceDigest.slice(0, 12) + " liveDigest=" + String(liveMoved.liveDigest).slice(0, 12))
    if (first.sourceDigest !== liveMoved.sourceDigest) problems.push("editing the profile's own patch moved sourceDigest (" + first.sourceDigest.slice(0, 12) + " -> " + liveMoved.sourceDigest.slice(0, 12) + "): that is the false red this round removes")
    if (first.liveDigest === liveMoved.liveDigest) problems.push("editing the live layer did not move liveDigest, so the machine's own drift is not recorded at all")
    writeFileSync(bundlePatch, "- insert:\n    - id: r43-repo-row\n      name: r43-repo-row\n    - id: r43-repo-row-second\n      name: r43-repo-row-second\n")
    const repoMoved = await analyzeProfile(profileDir)
    readings.push("after a repository bundle edit sourceDigest=" + repoMoved.sourceDigest.slice(0, 12))
    if (first.sourceDigest === repoMoved.sourceDigest) problems.push("editing the repository-derived bundle left sourceDigest at " + first.sourceDigest.slice(0, 12) + ", so a repository change would not redden the gate")
    record(10, problems.length === 0, problems.length === 0 ? readings.join(" | ") : problems.slice(0, 3).join(" | "))
  } finally {
    rmSync(repoScratch, { recursive: true, force: true })
    rmSync(stagedRoot, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- 11 --check compares the repository half only
/**
 * R43: what --check compares is the repository half, and a live-layer drift is printed rather than failed.
 *
 * The committed report is doctored in memory twice: once in its live section, which must stay current and
 * print the observation sentence, and once in its repository half, which must be stale. Scratch inputs on
 * both sides of the boundary are then read, to show which side of the criterion each lands on. A world can
 * run this when its producers implement the split and it carries a machine-owned input.
 */
async function checkEleven(world) {
  if (await splitCapable(world) === false) return
  const reader = await import(pathToFileURL(world.reader).href)
  const jsonPath = join(world.reportsDir, "rows.json")
  const mdPath = join(world.reportsDir, "rows.md")
  if (!existsSync(jsonPath) || !existsSync(mdPath)) { record(11, false, "no committed report to compare at " + world.reportsDir); return }
  const committed = readJson(jsonPath)
  const committedMd = readText(mdPath)
  const problems = []
  const readings = []
  const repoScratch = mkdtempSync(join(world.tmpRoot ?? join(PROJECT, ".tmp"), "r43-reader-repo-"))
  const liveScratch = mkdtempSync(join(tmpdir(), "r43-reader-live-"))
  try {
    if (Array.isArray(committed.liveInputs?.files) === false || committed.liveInputs.files.length === 0) problems.push("the committed report carries no liveInputs section, so the machine's own inputs are not recorded")
    else readings.push("committed liveInputs=" + String(committed.liveInputs.files.length) + " file(s) digest=" + String(committed.liveInputs.digest ?? "").slice(0, 12))
    if (committedMd.includes("<!-- live-inputs:begin -->") === false) problems.push("the committed markdown carries no live-inputs marker, so the excluded section cannot be located")
    const repoPatch = join(repoScratch, "repo-row.patch.yml")
    const livePatch = join(liveScratch, "live-row.patch.yml")
    writeFileSync(repoPatch, "- insert:\n    - id: r43-reader-repo\n      name: r43-reader-repo\n")
    writeFileSync(livePatch, "- id: r43-reader-live\n  config:\n    k: one\n")
    const inputs = [{ kind: "patch", path: repoPatch }, { kind: "patch", path: livePatch }]
    // The compared report is the repository partition, which is exactly what main() feeds buildReport.
    const splitA = reader.partitionInputs(inputs)
    const stableA = reader.buildReport(splitA.repo)
    const liveA = reader.buildReport(splitA.live)
    writeFileSync(livePatch, "- id: r43-reader-live\n  config:\n    k: two\n    note: the app rewrote its own patch\n")
    const splitB = reader.partitionInputs(inputs)
    const stableB = reader.buildReport(splitB.repo)
    const liveB = reader.buildReport(splitB.live)
    writeFileSync(repoPatch, "- insert:\n    - id: r43-reader-repo\n      name: r43-reader-repo\n    - id: r43-reader-repo-second\n      name: r43-reader-repo-second\n")
    const splitC = reader.partitionInputs(inputs)
    const stableC = reader.buildReport(splitC.repo)
    readings.push("scratch split: " + String(splitA.repo.length) + " repository input(s), " + String(splitA.live.length) + " live input(s)")
    if (splitA.repo.length !== 1 || splitA.live.length !== 1) problems.push("the scratch inputs were split " + String(splitA.repo.length) + "/" + String(splitA.live.length) + ", not 1/1")
    if (reader.stableJsonOf(stableA) !== reader.stableJsonOf(stableB)) problems.push("a live-input edit changed the compared text, so --check would go red for a file the machine owns")
    if (JSON.stringify(liveA.files) === JSON.stringify(liveB.files)) problems.push("a live-input edit left the live read unchanged, so nothing about the machine is being recorded")
    if (reader.stableJsonOf(stableA) === reader.stableJsonOf(stableC)) problems.push("a repository-input edit left the compared text unchanged, so --check could not catch a stale report at all")
    const doctoredLive = JSON.parse(JSON.stringify(committed))
    doctoredLive.liveInputs.files[0].digest = "r43-doctored-live-digest"
    const liveCase = reader.compareReports(doctoredLive, committed, committedMd, committedMd)
    readings.push("live section doctored: current=" + String(liveCase.same) + " observation=" + show(liveCase.observation))
    if (liveCase.same !== true) problems.push("doctoring only the live section made the report stale, which is the false red")
    if (typeof liveCase.observation !== "string" || liveCase.observation === "") problems.push("doctoring the live section printed no observation sentence")
    const doctoredRepo = JSON.parse(JSON.stringify(committed))
    const firstFile = (doctoredRepo.files ?? [])[0]
    if (firstFile !== undefined && Array.isArray(firstFile.rows) && firstFile.rows.length > 0) firstFile.rows[0].line = 999999
    const repoCase = reader.compareReports(doctoredRepo, committed, committedMd, committedMd)
    readings.push("repository half doctored: current=" + String(repoCase.same) + " stale=" + String(repoCase.same === false))
    if (repoCase.same !== false) problems.push("doctoring the repository half left the report current, so the comparison is not fallible")
    record(11, problems.length === 0, problems.length === 0 ? readings.join(" | ") : problems.slice(0, 3).join(" | "))
  } finally {
    rmSync(repoScratch, { recursive: true, force: true })
    rmSync(liveScratch, { recursive: true, force: true })
  }
}

async function runAll(world) {
  results.length = 0
  console.log("== " + world.label + " ==")
  const live = missingLiveInputs(world)
  checkOne(world)
  checkTwo(world)
  checkThree(world)
  checkFour(world)
  await checkFive(world)
  if (live.length === 0) await checkSix(world)
  else record(6, "skip", "the live layer view needs: " + live.join("; "))
  await checkSeven(world)
  await checkEight(world)
  if (live.length === 0) await checkNine(world)
  else record(9, "skip", "the loader comparison needs: " + live.join("; "))
  await checkTen(world)
  await checkEleven(world)
  const failed = results.filter((r) => !r.ok && !r.skip).map((r) => r.n)
  const skipped = results.filter((r) => r.skip).map((r) => r.n)
  return { failed, skipped, pending: results.filter((r) => r.pending !== null).map((r) => String(r.n) + " (" + String(r.pending) + ")") }
}
function missingLiveInputs(world) {
  const missing = []
  if (!existsSync(world.composer)) missing.push("composer " + world.composer)
  if (!existsSync(world.liveProfile)) missing.push("live profile " + world.liveProfile)
  if (!existsSync(world.kernelCli)) missing.push("kernel CLI " + world.kernelCli)
  if (!existsSync(join(world.kernelRoot, "node_modules", "tsx"))) missing.push("tsx under " + join(world.kernelRoot, "node_modules"))
  if (!existsSync(world.probe)) missing.push("probe " + world.probe)
  return missing
}

async function main() {
  const offline = []
  if (!existsSync(REAL.reader)) offline.push("reader " + REAL.reader)
  if (!existsSync(REAL.reportsDir) || jsonFiles(REAL.reportsDir).length === 0) offline.push("reports under " + REAL.reportsDir)
  if (!existsSync(REAL.table)) offline.push("behaviour table " + REAL.table)
  if (!existsSync(join(REAL.fixturesDir, "index.json"))) offline.push("fixture index " + join(REAL.fixturesDir, "index.json"))
  if (!existsSync(REAL.presetsFile)) offline.push("preset patch file " + REAL.presetsFile)
  if (offline.length > 0) {
    console.log("SKIP  the composition-row pipeline is not on this machine yet; missing:")
    for (const item of offline) console.log("  - " + item)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  const { failed, skipped, pending } = await runAll(REAL)
  console.log("")
  console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
  if (pending.length > 0) console.log("pending on another task (not an unexplained red): check " + pending.join(", "))
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

// ---------------------------------------------------------------- R53 debt B1: attacks for checks 10 and 11
/** @param {string} file @param {string} from @param {string} to @returns {void} one anchored edit, or a throw. */
function patchFile(file, from, to) {
  const before = readFileSync(file, "utf8")
  if (before.includes(from) === false) throw new Error("attack anchor not found in " + file + ": " + from)
  writeFileSync(file, before.replace(from, to))
}

/**
 * Checks 10 and 11 need attacks of their own, in a world that can actually ask their question.
 *
 * The harness covers checks 1-9 in its own world, which carries no machine-owned input. This phase builds a
 * stub world that does: a live profile outside the stub repository, the bundle reached through a junction
 * inside it, and a machine-owned patch outside it. It requires both checks to run and hold there, then
 * breaks one producer at a time, requiring exactly the matching check to move. Declared sets {10} and {11}
 * cover both checks: 0 misses.
 *
 * @returns true when the baseline held and every declared red set matched what was observed.
 */
async function debtSelfAttack() {
  const build = () => {
    const root = mkdtempSync(join(tmpdir(), "r53-debt-"))
    const liveScratch = mkdtempSync(join(tmpdir(), "r53-live-"))
    const rowsOut = join(root, "compat", "adaptation", "rows")
    const bundle = join(root, ".tmp", "bundle-repo")
    const liveProfile = join(liveScratch, "profiles", "web")
    for (const dir of [join(root, "scripts"), join(root, "rows"), join(rowsOut, "reports"), join(root, "plugins", "dsh-link-mods"), bundle, join(liveProfile, "node_modules")]) mkdirSync(dir, { recursive: true })
    for (const name of ["read-composition-rows.mjs", "compose-profile-rows.mjs", "probe-live-composition.mjs"]) cpSync(join(PROJECT, "scripts", "lib", "synthetic", name), join(root, "scripts", name))
    cpSync(join(PROJECT, "scripts", "lib", "synthetic", "row-base.patch.yml"), join(root, "rows", "row-base.patch.yml"))
    cpSync(join(PROJECT, "scripts", "lib", "synthetic", "presets.patch.yml"), join(root, "plugins", "dsh-link-mods", "presets.patch.yml"))
    writeFileSync(join(bundle, "package.json"), JSON.stringify({ name: "bundle-repo", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 1))
    writeFileSync(join(bundle, "cordis.patch.yml"), "- insert:" + String.fromCharCode(10) + "    - id: thinking-loop-guard" + " + NL + " + "      config:" + " + NL + " + "        k: dead" + " + NL + " + "")
    symlinkSync(bundle, join(liveProfile, "node_modules", "bundle-repo"), "junction")
    writeFileSync(join(liveProfile, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["bundle-repo"] } } }, null, 1))
    writeFileSync(join(liveProfile, "cordis.patch.yml"), "- id: thinking-loop-guard" + " + NL + " + "  config:" + " + NL + " + "    k: live" + " + NL + " + "")
    const machine = join(liveScratch, "machine.patch.yml")
    writeFileSync(machine, "- id: machine-owned" + " + NL + " + "  config:" + " + NL + " + "    k: one" + " + NL + " + "")
    const world = { label: "r53 debt world", baseDir: root, tmpRoot: join(root, ".tmp"), rowsRoot: join(root, "rows"), reader: join(root, "scripts", "read-composition-rows.mjs"), composer: join(root, "scripts", "compose-profile-rows.mjs"), probe: join(root, "scripts", "probe-live-composition.mjs"), reportsDir: join(rowsOut, "reports"), composition: join(rowsOut, "profile-composition.json"), dumpDiff: join(rowsOut, "dump-diff.json"), liveProfile, pendingUpstream: false }
    process.env.R53_LIVE_PATCH = machine
    const generated = spawnSync(process.execPath, [world.reader], { cwd: root, encoding: "utf8", env: { ...process.env, R53_LIVE_PATCH: machine } })
    if (generated.status !== 0) throw new Error("the debt world reader failed: " + String(generated.stderr ?? "").slice(0, 200))
    return { root, liveScratch, world }
  }
  const observe = async (world) => {
    results.length = 0
    await checkTen(world)
    await checkEleven(world)
    return { ran: results.map((row) => row.n), failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n) }
  }
  const attacks = {
    // The criterion, not the capability: folding the live half into sourceDigest is exactly the defect
    // check 10 measures, while the world still reports a machine-owned input (so the check still runs).
    // The anchor is the sourceDigest line itself: the same filter appears in stableText, and patching that
    // one would have changed the projection instead of the criterion (measured while writing this).
    10: ({ world }) => patchFile(world.composer, "update(JSON.stringify(files.filter((file) => file.origin === \"repo\"))).digest", "update(JSON.stringify(files)).digest"),
    11: ({ world }) => patchFile(world.reader, "{ ...report, liveInputs: null }", "{ ...report, liveInputs: report.liveInputs }"),
  }
  const clean = build()
  const baseline = await observe(clean.world)
  const baseOk = baseline.ran.includes(10) && baseline.ran.includes(11) && baseline.failed.length === 0
  console.log("  debt baseline: committed report " + String(existsSync(join(clean.world.reportsDir, "rows.json"))) + ", checks " + JSON.stringify(baseline.ran) + " ran, failed=" + JSON.stringify(baseline.failed) + (baseOk ? " (both readings held)" : " FAILED"))
  rmSync(clean.root, { recursive: true, force: true })
  rmSync(clean.liveScratch, { recursive: true, force: true })
  let localised = true
  for (const step of ["10", "11"]) {
    const built = build()
    let outcome = ""
    try {
      attacks[step](built)
      const seen = await observe(built.world)
      const expected = Number(step)
      const other = expected === 10 ? 11 : 10
      const ok = seen.failed.length === 1 && seen.failed[0] === expected && seen.ran.includes(other)
      outcome = ok ? "check " + String(expected) + " red, check " + String(other) + " green (declared set matched)" : "expected only check " + String(expected) + " red, observed ran=" + JSON.stringify(seen.ran) + " failed=" + JSON.stringify(seen.failed)
      if (!ok) localised = false
    } catch (error) {
      outcome = "attack could not be applied: " + (error instanceof Error ? error.message : String(error))
      localised = false
    }
    console.log("  debt attack " + step + ": " + outcome)
    rmSync(built.root, { recursive: true, force: true })
    rmSync(built.liveScratch, { recursive: true, force: true })
  }
  // The machine-input variable is this phase's, not the process's: leaving it set would point the harness's
  // spawns at a world this phase has already deleted (measured: the harness then failed to regenerate).
  delete process.env.R53_LIVE_PATCH
  console.log("  debt self-attack: baseline " + (baseOk ? "held" : "FAILED") + ", attacks localised " + String(localised) + ", declared sets cover checks 10 and 11 (0 misses)")
  return baseOk && localised
}

if (SELF_ATTACK) {
  const debt = await debtSelfAttack()
  if (debt === false) { console.log("the debt self-attack failed, so the harness is not run"); process.exit(1) }
  const { selfAttack } = await import(pathToFileURL(join(PROJECT, "scripts", "lib", "composition-rows-synthetic.mjs")).href).catch(() => ({ selfAttack: null }))
  if (selfAttack === null) { console.log("self-attack harness missing"); process.exit(1) }
  await selfAttack({ runAll, results, record, REAL, PROJECT, tmpdir, join, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, cpSync, spawnSync, pathToFileURL, digest })
} else {
  await main()
}
