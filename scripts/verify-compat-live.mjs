#!/usr/bin/env node
/**
 * R32 (task-55): the compat table must be usable in a REAL boot, not only self-consistent with the archive.
 *
 * Why the existing gate was green while the loader could not attach (task-52): scripts/verify-compat-table.mjs
 * judges the table against compat/surface/*.json — the ARCHIVED surface. The table can be perfectly
 * self-consistent there and still be refused at load time, because the loader judges a LIVE composition and
 * throws when its table carries stale refusals. In the committed compat/adaptation/loader-boot.json the two
 * readings sit next to each other: 1 row did not activate, `ctx.link.compat was not published`, and
 * `Error: compat table dsh-v0.2.1-alpha.1 has 3 stale refusal(s); re-measure before shipping`. Nothing in
 * the table-versus-archive check can see that, because it never boots anything.
 *
 *   1 LIVE SURFACE: in a throwaway profile the shipped plugin mounts as a real row, the boot settles, and
 *     ctx.link.compat IS published; report() carries no stale refusals and no semantic-changed row is
 *     refused at that moment; the kernel does not report an entry that failed to activate.
 *   2 CANNOT-ATTACH, constructed: the same boot from a copy of the repository whose plugin no longer
 *     publishes the layer must FAIL check 1 — otherwise check 1 is not measuring attachment at all.
 *
 * Exit 0 both hold; 1 a check failed; 3 an input is missing (kernel, tsx, probe, plugin — printed).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const KERNEL = join(PROJECT, "core", "deepseek-harness")
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PROBE = resolve(option("--probe", join(PROJECT, "scripts", "probe-loader-boot.mjs")))
const PLUGIN = resolve(option("--plugin", join(PROJECT, "plugins", "dsh-link-compat")))
const PUBLISH = /ctx\.provide\(\s*["\x27]link["\x27]/

const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === "skip" })
  console.log("  " + (status === true ? "ok  " : (status === "skip" ? "SKIP" : "FAIL")) + "  " + n + ". " + detail)
}
const clip = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text)
const show = (value) => JSON.stringify(value)
const textOf = (run) => [run.reading?.bootError, run.stderrTail, run.stdoutTail, ...(Array.isArray(run.findings) ? run.findings : []), run.verdict, run.raw].filter((part) => typeof part === "string").join(" ")

/** Boot the throwaway profile once and read what the loader published. */
function bootProbe(world, outFile) {
  const run = spawnSync(process.execPath, ["--import", "tsx/esm", world.probe, "--out", outFile], { cwd: KERNEL, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 900000 })
  if (!existsSync(outFile)) return { refused: true, detail: "the probe produced no report (exit " + String(run.status) + "): " + clip(((run.stdout ?? "") + (run.stderr ?? "")).trim().replace(/\s+/g, " "), 200) }
  return { refused: false, report: JSON.parse(readFileSync(outFile, "utf8")), status: run.status }
}
/** The runs whose expectation is that the loader publishes its layer. */
const publishingRuns = (report) => (report.runs ?? []).filter((run) => /link\.compat/.test(String(run.expect ?? "")))
/** What check 1 asserts about one boot, so check 2 can run the same criteria over the mutated copy. */
function judgeBoot(report) {
  const problems = []
  const runs = publishingRuns(report)
  const notes = []
  if (runs.length === 0) problems.push("no run expects the loader to publish ctx.link.compat, so nothing here measures attachment")
  for (const [index, run] of runs.entries()) {
    // The probe's run records carry the observation under `reading` (linkPresent / counts / refused /
    // findings); `label` is a 实测/构造触发 tag and `case` is the case id (Lead, R32: the first
    // version read run.observed.* and a non-existent run.id, which printed "(unnamed run)" and
    // "[object Object]" and reported a live surface as absent).
    const name = String(run.case ?? run.label ?? run.why ?? "run " + String(index + 1))
    const text = textOf(run)
    const published = run.reading?.linkPresent === true
    if (!published) problems.push(name + ": ctx.link.compat was not published")
    if (/not published/.test(text)) problems.push(name + ": the run reports that ctx.link.compat was not published")
    if (/did not activate/.test(text)) problems.push(name + ": the kernel reports an entry that did not activate")
    const stale = run.reading?.counts?.stale ?? run.reading?.stale ?? null
    if (typeof stale === "number" && stale !== 0) problems.push(name + ": report() carries " + String(stale) + " stale refusal(s)")
    // The probe hands the refusals over as capability names plus a violation list, not as rows.
    const violations = run.reading?.refusalViolations
    if (Array.isArray(violations) && violations.length > 0) problems.push(name + ": " + String(violations.length) + " refusal violation(s)")
    const refused = run.reading?.refused ?? null
    if (Array.isArray(refused)) {
      const changed = refused.filter((entry) => /semantic-changed/.test(String(entry?.class ?? entry ?? "")))
      if (changed.length > 0) problems.push(name + ": " + String(changed.length) + " semantic-changed row(s) are refused at load time")
    }
    notes.push(name + " -> compat " + (published ? "published" : "absent") + ", stale " + show(stale) + ", refused " + show(Array.isArray(run.reading?.refused) ? run.reading.refused.length : null) + ", reading " + clip(JSON.stringify(run.reading ?? run.verdict ?? ""), 90))
  }
  return { problems, notes, runs }
}

// ---------------------------------------------------------------- 1 the live surface
async function checkOne(world) {
  const outFile = join(world.tmp, "loader-boot.json")
  const boot = bootProbe(world, outFile)
  if (boot.refused) { record(1, "skip", boot.detail + " (environment, not a verdict)"); return null }
  const { problems, notes } = judgeBoot(boot.report)
  for (const note of notes) console.log("      " + note)
  record(1, problems.length === 0, problems.length === 0 ? "the boot settled and the loader published its layer in " + String(notes.length) + " run(s), with no stale refusal and no refused semantic-changed row" : problems.slice(0, 3).join(" | "))
  return boot.report
}

// ---------------------------------------------------------------- 2 cannot attach, constructed
async function checkTwo(world) {
  const tmp = mkdtempSync(join(tmpdir(), "r32-nolayer-"))
  try {
    const repo = join(tmp, "repo")
    for (const part of ["scripts", "plugins", "compat"]) if (existsSync(join(PROJECT, part))) cpSync(join(PROJECT, part), join(repo, part), { recursive: true })
    const built = join(repo, "plugins", "dsh-link-compat", "lib", "index.js")
    if (!existsSync(built)) { record(2, "skip", "the copied plugin ships no built entry to mutate"); return }
    const source = readFileSync(built, "utf8")
    if (!PUBLISH.test(source)) { record(2, "skip", "the copied plugin does not publish the layer through a form the gate can break"); return }
    writeFileSync(built, source.replace(PUBLISH, "ctx.provide('link-never', { compat })"))
    const outFile = join(tmp, "loader-boot.json")
    const boot = bootProbe({ probe: join(repo, "scripts", "probe-loader-boot.mjs"), tmp }, outFile)
    if (boot.refused) { record(2, "skip", "the mutated repository could not be booted: " + boot.detail); return }
    const { problems, notes } = judgeBoot(boot.report)
    for (const note of notes.slice(0, 3)) console.log("      mutated: " + note)
    record(2, problems.length > 0, problems.length > 0 ? "construction reds as it must: with the layer no longer published, the criteria fail (" + clip(problems[0], 150) + ")" : "a repository that never publishes ctx.link.compat still satisfied the criteria, so check 1 is not measuring attachment")
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function runAll(world) {
  results.length = 0
  console.log("== " + world.label + " ==")
  await checkOne(world)
  await checkTwo(world)
  return { failed: results.filter((r) => !r.ok && !r.skip).map((r) => r.n), skipped: results.filter((r) => r.skip).map((r) => r.n) }
}

async function main() {
  const missing = []
  if (!existsSync(PROBE)) missing.push("boot probe " + PROBE)
  if (!existsSync(PLUGIN)) missing.push("compat plugin " + PLUGIN)
  if (!existsSync(join(KERNEL, "apps", "cli", "src", "bin.ts"))) missing.push("kernel CLI " + join(KERNEL, "apps", "cli", "src", "bin.ts"))
  if (!existsSync(join(KERNEL, "node_modules", "tsx"))) missing.push("tsx under " + join(KERNEL, "node_modules"))
  if (missing.length > 0) {
    console.log("SKIP  the live compat surface cannot be booted here; missing:")
    for (const item of missing) console.log("  - " + item)
    console.log("nothing was verified; this is an environment gap, not a pass.")
    process.exit(3)
  }
  const tmp = mkdtempSync(join(tmpdir(), "r32-live-"))
  try {
    const { failed, skipped } = await runAll({ label: "real (this machine)", probe: PROBE, tmp })
    console.log("")
    console.log(String(results.length) + " checks, " + String(results.length - failed.length - skipped.length) + " held, " + String(skipped.length) + " skipped, " + String(failed.length) + " failed")
    if (failed.length > 0) process.exit(1)
    if (skipped.length > 0) process.exit(3)
    process.exit(0)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

await main()
