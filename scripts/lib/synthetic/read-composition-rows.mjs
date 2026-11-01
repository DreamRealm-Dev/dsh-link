#!/usr/bin/env node
/**
 * Synthetic stand-in for scripts/read-composition-rows.mjs, used only by
 * scripts/lib/composition-rows-synthetic.mjs --self-attack. Same contracts: exports
 * parseRows/readPatchFile, and a CLI where --check compares the committed report byte for byte.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PRESETS = join(ROOT, "plugins", "dsh-link-mods", "presets.patch.yml")

/** @param {string} file @returns {string} the real path, as far as the filesystem allows. */
function realOf(file) {
  try { return realpathSync(file) } catch { return resolve(file) }
}

/**
 * Whether an input lives inside the repository this stub stands for.
 *
 * The real reader splits by realpath under the repository root and the stub mirrors that rule so checks
 * 10 and 11 can run against it (R53 debt B1). It is written here rather than imported from the stub
 * composer because the composer imports this module for readPatchFile, and a cycle would be worse than
 * eight duplicated lines in a test double.
 *
 * @param {string} file - an input path.
 * @returns true when the file's real location is under the repository root.
 */
export function underRepo(file) {
  const real = realOf(file).replace(/\\/g, "/").toLowerCase()
  const root = realOf(ROOT).replace(/\\/g, "/").toLowerCase()
  return real === root || real.startsWith(root + "/")
}

/**
 * The report as --check compares it: the live-machine half is recorded, never a criterion.
 *
 * @param {Record<string, any>} report - a composition-rows report.
 * @returns the report text with the live section emptied.
 */
export function stableJsonOf(report) {
  return JSON.stringify({ ...report, liveInputs: null }, null, 1) + String.fromCharCode(10)
}

/**
 * The report as --check compares it, with the live section between the markers removed.
 *
 * @param {string} text - a rendered report.
 * @returns the text without the live section.
 */
export function stableMarkdownOf(text) {
  const kept = []
  let inside = false
  for (const line of text.split(String.fromCharCode(10))) {
    if (line.trim() === "<!-- live-inputs:begin -->") { inside = true; continue }
    if (line.trim() === "<!-- live-inputs:end -->") { inside = false; continue }
    if (inside === false) kept.push(line)
  }
  return kept.join(String.fromCharCode(10))
}

/**
 * Compare a committed report with a fresh read, the way --check does.
 *
 * @param {Record<string, any> | null} committed - the committed report, parsed.
 * @param {Record<string, any>} fresh - the report just built.
 * @param {string | null} committedMarkdown - the committed markdown.
 * @param {string} freshMarkdown - the markdown just rendered.
 * @returns whether the report is current, and the observation sentence when only the live section moved.
 */
export function compareReports(committed, fresh, committedMarkdown, freshMarkdown) {
  const same = committed !== null && committedMarkdown !== null
    && stableJsonOf(committed) === stableJsonOf(fresh)
    && stableMarkdownOf(committedMarkdown) === stableMarkdownOf(freshMarkdown)
  const committedLive = committed?.liveInputs?.files ?? []
  const freshLive = fresh.liveInputs?.files ?? []
  const changed = committedLive.filter((file) => ((freshLive.find((other) => other.file === file.file)?.digest) ?? null) !== file.digest)
  const observation = changed.length === 0 ? null
    : "live inputs changed: " + String(changed.length) + " file(s) (the machine rewrote its own input)"
  return { same, observation, changed: changed.length }
}

export function parseRows(text) {
  const lines = text.split(/\r?\n/)
  const rows = []
  let container = null
  let lastId = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === "") continue
    const indent = line.length - line.trimStart().length
    if (container !== null && indent <= container.indent) container = null
    const id = /^\s*- id:\s*(\S+)\s*$/.exec(line)
    if (id !== null) {
      const origin = container === null ? "row" : container.kind
      const nestedUnder = container === null ? null : container.owner
      const hasConfig = /^\s+config:\s*$/.test(lines[index + 1] ?? "")
      const cls = origin === "row" ? "field-replacement" : "insert-entries"
      rows.push({ id: id[1], name: null, line: index + 1, origin, parentLine: container === null ? null : container.line, nestedUnder, hasConfig, keys: ["id"], unknownKeys: [], class: cls, evidence: "plugins/dsh-link-mods/presets.patch.yml:" + String(index + 1), values: { id: { present: true } } })
      lastId = id[1]
      continue
    }
    if (/^\s*- insert:\s*$/.test(line)) { container = { kind: "insert-child", indent, line: index + 1, owner: lastId }; continue }
    if (/^\s*config:\s*$/.test(line)) { container = { kind: "config-child", indent, line: index + 1, owner: lastId }; continue }
  }
  return rows
}
export async function readPatchFile(absPath) {
  return { rows: parseRows(readFileSync(absPath, "utf8")), warnings: [], coverage: 1 }
}
function inputs() {
  const files = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--patch" && process.argv[index + 1] !== undefined) files.push({ key: "extra", path: resolve(process.argv[index + 1]) })
  }
  const rowsDir = join(ROOT, "rows")
  if (existsSync(rowsDir)) for (const name of readdirSync(rowsDir).filter((f) => f.endsWith(".patch.yml"))) files.push({ key: "rows/" + name, path: join(rowsDir, name) })
  if (existsSync(PRESETS)) files.push({ key: "plugins/dsh-link-mods/presets.patch.yml", path: PRESETS })
  // The machine's own input is whatever the environment points at, the way the real reader's inputs include
  // files the repository does not own. A world that wants a live input sets this before spawning the reader.
  const live = process.env.R53_LIVE_PATCH
  if (typeof live === "string" && live !== "") files.push({ key: "live-input", path: resolve(live) })
  return files
}
/**
 * The report over a given input list, or over the reader's own inputs.
 *
 * @param {Array<{path: string}>} [list] - inputs to read; defaults to the reader's own set.
 * @returns the report.
 */
export function buildReport(list = inputs()) {
  const files = []
  for (const entry of list) {
    const text = readFileSync(entry.path, "utf8")
    const lines = text.split(/\r?\n/)
    const rows = parseRows(text).map((row) => ({ ...row, file: entry.path }))
    const blanks = lines.map((l, i) => (l.trim() === "" ? i + 1 : null)).filter((v) => v !== null)
    files.push({ file: entry.path, source: "synthetic", origin: underRepo(entry.path) ? "repo" : "live", bytes: text.length, lines: lines.length, totalLines: lines.length, parsedLines: lines.filter((l) => l.trim() !== "").length, attributedLines: rows.length, unattributedLines: blanks, coverage: 1, warnings: [], rows })
  }
  const all = files.flatMap((f) => f.rows)
  const classes = [...new Set(all.map((r) => r.class))].sort()
  const classCoverage = classes.map((cls) => ({ class: cls, samples: all.filter((r) => r.class === cls).length, fixtures: 0, note: "synthetic", fixtureFiles: [] }))
  const live = files.filter((file) => file.origin === "live")
  return {
    format: "dsh-link.composition-rows/1",
    method: "synthetic reader",
    files,
    counts: { files: files.length, rows: all.length, classCoverage },
    liveInputs: {
      note: "read from this machine and excluded from the --check comparison (R53 debt B1/B2)",
      files: live.map((file) => ({ file: file.file, origin: "live", bytes: file.bytes, lines: file.lines, rows: file.rows.length, digest: createHash("sha256").update(readFileSync(file.file)).digest("hex").slice(0, 16) })),
      digest: createHash("sha256").update(JSON.stringify(live.map((file) => file.file))).digest("hex").slice(0, 16),
    },
    cannotSee: ["the synthetic reader cannot see !!js expressions, comments or YAML outside its subset"],
  }
}
/**
 * Split inputs into the ones this repository owns and the ones this machine owns, by realpath.
 *
 * @param {Array<{path: string}>} list - the input list a run was given.
 * @returns the two lists, in the order they were given.
 */
export function partitionInputs(list) {
  const repo = []
  const live = []
  for (const input of list) (underRepo(input.path) ? repo : live).push(input)
  return { repo, live }
}

const reportsDir = () => join(ROOT, "compat", "adaptation", "rows", "reports")
const reportPath = () => join(reportsDir(), "rows.json")
const markdownPath = () => join(reportsDir(), "rows.md")

/** The markdown companion the real reader ships; the live section sits between the markers --check strips. */
function renderMarkdown(report) {
  const lines = ["# Composition rows (synthetic)", "", String(report.counts.files) + " file(s), " + String(report.counts.rows) + " row record(s)", ""]
  for (const file of report.files) lines.push("- " + file.file + " (" + String(file.rows.length) + " rows, " + file.origin + ")")
  lines.push("", "<!-- live-inputs:begin -->", "## Live-machine inputs (excluded from --check)", "")
  for (const file of report.liveInputs?.files ?? []) lines.push("- " + file.file + " (" + String(file.bytes) + " bytes)")
  lines.push("", "<!-- live-inputs:end -->", "")
  return lines.join(String.fromCharCode(10))
}
function main() {
  const report = buildReport()
  const text = JSON.stringify(report, null, 1) + "\n"
  const markdown = renderMarkdown(report)
  if (process.argv.includes("--check")) {
    const before = existsSync(reportPath()) ? readFileSync(reportPath(), "utf8") : null
    const beforeMd = existsSync(markdownPath()) ? readFileSync(markdownPath(), "utf8") : null
    // The CLI check stays byte for byte: the harness's attack 1 corrupts the committed report by one byte
    // and requires this comparison to notice it. The repository/machine split lives in the exported
    // compareReports, which check 11 calls directly - the same split the real reader's --check applies.
    const same = before === text && beforeMd === markdown
    console.log(same ? "ok: reports match a fresh read" : "stale: reports differ from a fresh read")
    process.exit(same ? 0 : 1)
  }
  mkdirSync(reportsDir(), { recursive: true })
  writeFileSync(reportPath(), text)
  writeFileSync(markdownPath(), markdown)
  console.log("wrote reports/rows.json and rows.md (synthetic)")
}
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
