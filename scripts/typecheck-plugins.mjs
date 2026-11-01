#!/usr/bin/env node
// @ts-check
/**
 * The strict TypeScript gate for the LINK plugins.
 *
 * One command, one program, one verdict:
 *
 *   node scripts/typecheck-plugins.mjs                    the gate (see exit codes)
 *   node scripts/typecheck-plugins.mjs --allow-baseline   tolerate the recorded legacy debt
 *   node scripts/typecheck-plugins.mjs --write-baseline   re-record the debt (never for new modules)
 *   node scripts/typecheck-plugins.mjs --json             machine-readable report
 *
 * The program is plugins/tsconfig.json: every plugin source file is a root, and kernel packages
 * arrive as the kernel's own built declaration files (each package's exports.types). The tsc binary
 * is the kernel's own, so the compiler version the plugins are judged with cannot silently differ
 * from the kernel's.
 *
 * The debt model. The plugins were written before any typecheck ran, so the first honest run has
 * hundreds of errors. plugins/strict-baseline.json freezes, per source file, how many errors are
 * legacy debt. The gate compares live counts against it:
 *
 *   - a file missing from the baseline with errors, or a file above its recorded count, is NEW:
 *     exit 1 in every mode, because new code may not add debt;
 *   - a file below its recorded count, or one that disappeared, is STALE: reported, never failed
 *     (fixing debt must not require a baseline edit first);
 *   - modules listed in BORN_STRICT are never written into the baseline, so a plugin delivered
 *     after the gate has to be strict-clean on the day it lands.
 *
 * Default mode keeps the gate red while legacy debt remains: the gate's claim is "zero errors", so
 * it says FAIL until that is true. --allow-baseline is the incremental mode for work inside the
 * debt: it fails only on NEW errors.
 *
 * Exit codes: 0 pass; 1 type errors (default/strict mode), new errors above the baseline, or
 * born-strict modules with errors; 2 the gate could not judge (missing tsc, missing kernel
 * declarations, unparsable tsconfig/baseline, tsc crashed without diagnostics, or the program has
 * syntactic diagnostics — TypeScript stops before semantic checking then, so the run is refused
 * rather than measured; see isSyntactic()).
 *
 * The gate also refuses to judge with a tsconfig that drifted from the kernel's strict face:
 * the STRICT_FLAGS below are compared against core/deepseek-harness/tsconfig.base.json on every
 * run, so a weakened flag is a gate failure instead of a quieter number.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLUGINS = join(REPO, 'plugins')
const TSCONFIG = join(PLUGINS, 'tsconfig.json')
const BASELINE = join(PLUGINS, 'strict-baseline.json')
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const KERNEL_TSC = join(KERNEL, 'node_modules', 'typescript', 'bin', 'tsc')
const KERNEL_BASE = join(KERNEL, 'tsconfig.base.json')
const KERNEL_LOCK = join(REPO, 'kernel.lock.json')
const REPORT_FORMAT = 'dsh-link.strict-ts-report/1'
const BASELINE_FORMAT = 'dsh-link.strict-ts-baseline/1'

/**
 * Modules that must be born strict: files under these prefixes are never written into the baseline,
 * so every error in them is a new error in every mode.
 *
 * Policy: EVERY new plugin package defaults to born strict — it is in-tree only after it typechecks
 * with zero errors, and it is added here on the day it lands so the baseline can never absorb its
 * debt later. Adding a module to the legacy allowlist is a separate, explicit decision for code
 * that predates the gate; a new module does not get that option.
 */
const BORN_STRICT = [
  'plugins/dsh-link-compute/',
  'plugins/dsh-link-chat-window/',
]

/**
 * Compiler flags that carry the kernel's type-safety face. Each is compared against
 * core/deepseek-harness/tsconfig.base.json before tsc runs.
 */
const STRICT_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
  'noUnusedLocals',
  'noUnusedParameters',
]

/** @typedef {{ file: string, line: number, column: number, code: string, message: string }} Diagnostic */
/** @typedef {{ total: number, plugins: Record<string, number>, files: Record<string, number> }} Counts */

const argv = process.argv.slice(2)
const ALLOW_BASELINE = argv.includes('--allow-baseline')
const WRITE_BASELINE = argv.includes('--write-baseline')
const JSON_OUT = argv.includes('--json')

/**
 * End the run with an infrastructure failure: the gate could not judge.
 *
 * @param {string} message
 * @returns {never}
 */
function stop(message) {
  const body = JSON_OUT
    ? JSON.stringify({ format: REPORT_FORMAT, verdict: 'error', error: message }) + '\n'
    : 'typecheck-plugins: ' + message + '\n'
  if (JSON_OUT) process.stdout.write(body)
  else process.stderr.write(body)
  process.exit(2)
}

/**
 * Parse the JSON-with-comments form used by tsconfig files. Strings are copied verbatim; only
 * // and block comments are removed.
 *
 * @param {string} text
 * @returns {any}
 */
function parseJsonc(text) {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === '"') inString = false
      i += 1
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return JSON.parse(out)
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The plugin package a repo-relative path belongs to, or null for a shared source outside plugins/.
 *
 * @param {string} file
 * @returns {string | null}
 */
function pluginOf(file) {
  const match = /^plugins\/([^/]+)\//.exec(file)
  const name = match === null ? undefined : match[1]
  return name === undefined ? null : name
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isBornStrict(file) {
  return BORN_STRICT.some((prefix) => file.startsWith(prefix))
}

/**
 * @param {string} directory
 * @returns {boolean}
 */
function hasTypeScript(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (hasTypeScript(join(directory, entry.name))) return true
      continue
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) return true
  }
  return false
}

/**
 * Plugin directories that actually contribute TypeScript sources, so zero-error plugins are listed.
 *
 * @returns {string[]}
 */
function pluginDirectories() {
  /** @type {string[]} */
  const names = []
  for (const entry of readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const src = join(PLUGINS, entry.name, 'src')
    if (!existsSync(src) || !statSync(src).isDirectory()) continue
    if (hasTypeScript(src)) names.push(entry.name)
  }
  return names.sort()
}

/**
 * Kernel identity the report cites. Missing provenance weakens the report, not the run.
 *
 * @returns {{ commit: string, version: string, typescript: string }}
 */
function kernelIdentity() {
  let commit = 'unknown'
  let version = 'unknown'
  try {
    const lock = JSON.parse(readFileSync(KERNEL_LOCK, 'utf8'))
    if (typeof lock.commit === 'string') commit = lock.commit
    if (typeof lock.packageVersion === 'string') version = lock.packageVersion
  } catch {
    // Reported as unknown below.
  }
  let typescript = 'unknown'
  try {
    const manifest = JSON.parse(readFileSync(join(KERNEL, 'node_modules', 'typescript', 'package.json'), 'utf8'))
    if (typeof manifest.version === 'string') typescript = manifest.version
  } catch {
    // The tsc binary check below is what the run requires.
  }
  return { commit, version, typescript }
}

/**
 * Read the gate tsconfig and enforce its two preconditions: the kernel's strict face, and the
 * presence of every kernel declaration file it maps.
 *
 * @returns {{ paths: Record<string, string[]>, tsconfig: any }}
 */
function readGateConfig() {
  if (!existsSync(TSCONFIG)) stop('missing ' + TSCONFIG)
  /** @type {any} */
  let tsconfig
  try {
    tsconfig = parseJsonc(readFileSync(TSCONFIG, 'utf8'))
  } catch (error) {
    stop('cannot parse ' + TSCONFIG + ': ' + String(error))
  }
  const options = tsconfig.compilerOptions
  if (!isRecord(options)) stop(TSCONFIG + ' has no compilerOptions')
  /** @type {any} */
  let kernelBase
  try {
    kernelBase = parseJsonc(readFileSync(KERNEL_BASE, 'utf8')).compilerOptions
  } catch (error) {
    stop('cannot read the kernel strict face from ' + KERNEL_BASE + ': ' + String(error))
  }
  if (!isRecord(kernelBase)) stop(KERNEL_BASE + ' has no compilerOptions')
  /** @type {string[]} */
  const drift = []
  for (const flag of STRICT_FLAGS) {
    const ours = options[flag]
    const kernel = kernelBase[flag]
    if (ours !== kernel) drift.push(flag + ': plugins/tsconfig.json has ' + JSON.stringify(ours) + ', kernel has ' + JSON.stringify(kernel))
  }
  if (drift.length > 0) stop('plugins/tsconfig.json drifted from the kernel strict face (' + drift.join('; ') + ')')
  const rawPaths = options.paths
  if (!isRecord(rawPaths)) stop(TSCONFIG + ' declares no compilerOptions.paths for the kernel packages')
  /** @type {Record<string, string[]>} */
  const paths = {}
  /** @type {string[]} */
  const missing = []
  for (const [specifier, targets] of Object.entries(rawPaths)) {
    if (!Array.isArray(targets)) {
      missing.push(specifier + ' (target is not a list)')
      continue
    }
    /** @type {string[]} */
    const list = []
    for (const target of targets) {
      if (typeof target !== 'string') continue
      list.push(target)
      if (!existsSync(resolve(PLUGINS, target))) missing.push(specifier + ' -> ' + target)
    }
    paths[specifier] = list
  }
  if (missing.length > 0) {
    stop('kernel declaration files are missing for ' + missing.length + ' mapping(s): ' + missing.slice(0, 6).join(', ')
      + '. Build the kernel first: pnpm --dir core/deepseek-harness run build:artifacts')
  }
  return { paths, tsconfig }
}

/**
 * Whether one diagnostic is a syntax/grammar error. TypeScript reports these (TS1xxx, plus the
 * TS17xxx JSX parse family) and then stops before semantic analysis, so the program has NOT been
 * judged: a baseline comparison in this state reports a near-empty error list and would let
 * --write-baseline record garbage. This is the failure mode a concurrently-edited file caused once
 * (R498 record); the gate now refuses to judge instead.
 *
 * @param {Diagnostic} diagnostic
 * @returns {boolean}
 */
function isSyntactic(diagnostic) {
  const number = Number(diagnostic.code.slice(2))
  return (number >= 1000 && number <= 1999) || (number >= 17000 && number <= 17999)
}

/**
 * Run the kernel's tsc over plugins/tsconfig.json exactly once.
 *
 * @returns {{ diagnostics: Diagnostic[], durationMs: number }}
 */
function runTypecheck() {
  if (!existsSync(KERNEL_TSC)) stop('the kernel TypeScript is missing (' + KERNEL_TSC + '); run: pnpm --dir core/deepseek-harness install')
  const started = Date.now()
  const result = spawnSync(process.execPath, [KERNEL_TSC, '-p', TSCONFIG, '--noEmit', '--pretty', 'false'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const durationMs = Date.now() - started
  if (result.error !== undefined) stop('could not run tsc: ' + String(result.error))
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  /** @type {Diagnostic[]} */
  const diagnostics = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
    if (match === null) continue
    const [, file, lineNumber, columnNumber, code, message] = match
    if (file === undefined || lineNumber === undefined || columnNumber === undefined || code === undefined || message === undefined) continue
    diagnostics.push({
      file: file.replaceAll('\\', '/'),
      line: Number(lineNumber),
      column: Number(columnNumber),
      code,
      message,
    })
  }
  if ((result.status ?? 0) !== 0 && diagnostics.length === 0) {
    stop('tsc failed without reporting a TypeScript error (exit ' + String(result.status) + '): ' + (result.stderr ?? '').trim().slice(0, 600))
  }
  return { diagnostics, durationMs }
}

/**
 * Group diagnostics by file and by plugin. "(shared)" collects sources outside plugins/ that the
 * plugin build imports, such as the compat loader's own modules.
 *
 * @param {Diagnostic[]} diagnostics
 * @param {string[]} plugins
 * @returns {Counts}
 */
function countBy(diagnostics, plugins) {
  /** @type {Record<string, number>} */
  const files = {}
  /** @type {Record<string, number>} */
  const byPlugin = {}
  for (const name of plugins) byPlugin[name] = 0
  for (const diagnostic of diagnostics) {
    files[diagnostic.file] = (files[diagnostic.file] ?? 0) + 1
    byPlugin[pluginOf(diagnostic.file) ?? '(shared)'] = (byPlugin[pluginOf(diagnostic.file) ?? '(shared)'] ?? 0) + 1
  }
  return { total: diagnostics.length, plugins: byPlugin, files }
}

/**
 * Read plugins/strict-baseline.json. A missing file is null (first run); a malformed one is fatal.
 *
 * @returns {any | null}
 */
function readBaseline() {
  if (!existsSync(BASELINE)) return null
  /** @type {any} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch (error) {
    stop('cannot parse ' + BASELINE + ': ' + String(error))
  }
  if (!isRecord(baseline) || baseline.format !== BASELINE_FORMAT || !isRecord(baseline.files)) {
    stop(BASELINE + ' is not a ' + BASELINE_FORMAT + ' document')
  }
  return baseline
}

/**
 * Compare the live diagnostic counts with the allowlisted legacy counts.
 *
 * Per-file counts cannot tell a fixed legacy error from a different new one in the same file, so
 * the classification is stated as what it is: errors beyond a file's allowance are NEW, and that
 * file is the actionable unit. The full live diagnostics are always in --json output.
 *
 * @param {Diagnostic[]} diagnostics
 * @param {Counts} live
 * @param {any | null} baseline
 * @returns {{
 *   newDiagnostics: Diagnostic[],
 *   bornStrictDiagnostics: Diagnostic[],
 *   stale: { file: string, recorded: number, live: number }[],
 *   recordedTotal: number,
 *   recordedFiles: Record<string, number>,
 * }}
 */
function classify(diagnostics, live, baseline) {
  /** @type {Record<string, number>} */
  const recorded = isRecord(baseline?.files) ? baseline.files : {}
  /** @type {Diagnostic[]} */
  const newDiagnostics = []
  /** @type {Diagnostic[]} */
  const bornStrictDiagnostics = []
  /** @type {Record<string, number>} */
  const consumed = {}
  for (const diagnostic of diagnostics) {
    const file = diagnostic.file
    if (isBornStrict(file)) {
      bornStrictDiagnostics.push(diagnostic)
      continue
    }
    const allowed = typeof recorded[file] === 'number' ? recorded[file] : 0
    const at = consumed[file] ?? 0
    consumed[file] = at + 1
    if (at >= allowed) newDiagnostics.push(diagnostic)
  }
  /** @type {{ file: string, recorded: number, live: number }[]} */
  const stale = []
  for (const [file, count] of Object.entries(live.files)) {
    const allowed = typeof recorded[file] === 'number' ? recorded[file] : 0
    if (count < allowed) stale.push({ file, recorded: allowed, live: count })
  }
  for (const [file, allowed] of Object.entries(recorded)) {
    if (live.files[file] === undefined && typeof allowed === 'number') stale.push({ file, recorded: allowed, live: 0 })
  }
  let recordedTotal = 0
  for (const value of Object.values(recorded)) if (typeof value === 'number') recordedTotal += value
  return { newDiagnostics, bornStrictDiagnostics, stale, recordedTotal, recordedFiles: recorded }
}

/**
 * Build the baseline document for --write-baseline. Born-strict modules are excluded by contract;
 * their errors are reported and fail the write run.
 *
 * @param {Counts} live
 * @param {{ commit: string, version: string, typescript: string }} kernel
 * @param {any} tsconfig
 * @returns {any}
 */
function baselineDocument(live, kernel, tsconfig) {
  /** @type {Record<string, number>} */
  const files = {}
  for (const file of Object.keys(live.files).sort()) {
    if (isBornStrict(file)) continue
    files[file] = live.files[file] ?? 0
  }
  /** @type {Record<string, number>} */
  const plugins = {}
  for (const [name, count] of Object.entries(live.plugins)) {
    if (count > 0) plugins[name] = count
  }
  return {
    format: BASELINE_FORMAT,
    note: 'Legacy typecheck debt the strict plugin gate tolerates in --allow-baseline mode. Per '
      + 'file error counts only; a count going up is a new error, a count going down is stale and '
      + 'should be re-recorded. Generated by: node scripts/typecheck-plugins.mjs --write-baseline',
    generatedAt: new Date().toISOString(),
    kernel,
    gate: {
      config: 'plugins/tsconfig.json',
      strictFlags: Object.fromEntries(STRICT_FLAGS.map((flag) => [flag, tsconfig.compilerOptions[flag]])),
    },
    totals: { errors: Object.values(files).reduce((sum, count) => sum + count, 0), plugins },
    files,
  }
}

/**
 * @param {string[][]} rows header row first
 * @returns {string}
 */
function renderTable(rows) {
  /** @type {number[]} */
  const widths = []
  for (const row of rows) {
    row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length) })
  }
  return rows.map((row) => row.map((cell, index) => (index === 0 ? cell.padEnd(widths[index] ?? 0) : String(cell).padStart(widths[index] ?? 0))).join('  ')).join('\n')
}

// --- run ---------------------------------------------------------------------------------------

const started = Date.now()
const { tsconfig } = readGateConfig()
const kernel = kernelIdentity()
const { diagnostics, durationMs } = runTypecheck()
const syntactic = diagnostics.filter(isSyntactic)
if (syntactic.length > 0) {
  const first = syntactic[0]
  const where = first === undefined ? '' : first.file + '(' + first.line + ',' + first.column + '): ' + first.code + ': ' + first.message
  stop('refusing to judge: ' + syntactic.length + ' syntactic diagnostic(s). tsc suppresses semantic checking in this state, so neither a comparison nor a baseline write would be a measurement. Fix the syntax first. First: ' + where)
}
const plugins = pluginDirectories()
const live = countBy(diagnostics, plugins)

let baseline = readBaseline()
let classified = classify(diagnostics, live, baseline)

/** The baseline document written by this run, if --write-baseline was asked for. */
/** @type {any | null} */
let written = null
if (WRITE_BASELINE) {
  written = baselineDocument(live, kernel, tsconfig)
  writeFileSync(BASELINE, JSON.stringify(written, null, 2) + '\n', 'utf8')
  baseline = written
  classified = classify(diagnostics, live, baseline)
}

/** @type {Record<string, number>} */
const baselinePlugins = {}
for (const [file, count] of Object.entries(classified.recordedFiles)) {
  if (typeof count !== 'number') continue
  const plugin = pluginOf(file) ?? '(shared)'
  baselinePlugins[plugin] = (baselinePlugins[plugin] ?? 0) + count
}

const bornStrictFail = classified.bornStrictDiagnostics.length > 0
const newFail = classified.newDiagnostics.length > 0
const strictFail = !ALLOW_BASELINE && !WRITE_BASELINE && live.total > 0
const verdict = bornStrictFail || newFail || strictFail ? 'fail' : 'pass'
const exitCode = verdict === 'fail' ? 1 : 0

/** @type {string[]} */
const notes = []
if (written !== null) {
  notes.push('baseline written to plugins/strict-baseline.json (' + Object.keys(written.files).length + ' files, ' + written.totals.errors + ' errors)')
} else if (baseline === null) {
  notes.push('no baseline recorded; every error counts as new until --write-baseline')
} else {
  const recordedCommit = isRecord(baseline.kernel) && typeof baseline.kernel.commit === 'string' ? baseline.kernel.commit : 'unknown'
  if (recordedCommit !== 'unknown' && kernel.commit !== 'unknown' && recordedCommit !== kernel.commit) {
    notes.push('baseline was recorded against kernel ' + recordedCommit + ', this checkout is ' + kernel.commit + '; refresh it after re-verifying the new kernel')
  }
  const recordedTs = isRecord(baseline.kernel) && typeof baseline.kernel.typescript === 'string' ? baseline.kernel.typescript : 'unknown'
  if (recordedTs !== 'unknown' && kernel.typescript !== 'unknown' && recordedTs !== kernel.typescript) {
    notes.push('baseline was recorded with TypeScript ' + recordedTs + ', this run used ' + kernel.typescript + '; refresh it')
  }
}
if (classified.stale.length > 0) notes.push(classified.stale.length + ' baseline entr(ies) are stale (counts shrank); re-record with --write-baseline')

if (JSON_OUT) {
  /** @type {Record<string, { errors: number, baseline: number, delta: number, files: number }>} */
  const pluginReport = {}
  for (const name of plugins) {
    const errors = live.plugins[name] ?? 0
    const recorded = baselinePlugins[name] ?? 0
    pluginReport[name] = { errors, baseline: recorded, delta: errors - recorded, files: Object.keys(live.files).filter((file) => pluginOf(file) === name).length }
  }
  const sharedErrors = live.plugins['(shared)'] ?? 0
  const sharedBaseline = baselinePlugins['(shared)'] ?? 0
  pluginReport['(shared)'] = { errors: sharedErrors, baseline: sharedBaseline, delta: sharedErrors - sharedBaseline, files: Object.keys(live.files).filter((file) => pluginOf(file) === null).length }
  process.stdout.write(JSON.stringify({
    format: REPORT_FORMAT,
    verdict,
    mode: WRITE_BASELINE ? 'write-baseline' : ALLOW_BASELINE ? 'allow-baseline' : 'strict',
    kernel,
    typescript: kernel.typescript,
    durationMs: Date.now() - started,
    totals: { errors: live.total, baseline: classified.recordedTotal, new: classified.newDiagnostics.length, bornStrict: classified.bornStrictDiagnostics.length, staleEntries: classified.stale.length },
    baselineWritten: written === null ? null : { files: Object.keys(written.files).length, errors: written.totals.errors },
    files: live.files,
    plugins: pluginReport,
    newErrors: classified.newDiagnostics,
    bornStrictErrors: classified.bornStrictDiagnostics,
    stale: classified.stale,
    notes,
  }, null, 2) + '\n')
} else {
  process.stdout.write('strict-ts gate — plugins/tsconfig.json\n')
  process.stdout.write('  kernel ' + kernel.version + ' @ ' + kernel.commit + ' · TypeScript ' + kernel.typescript + ' · judge ' + durationMs + ' ms · strict face matches kernel (' + STRICT_FLAGS.length + ' flags)\n')
  process.stdout.write('\n')
  if (live.total > 0 || Object.keys(classified.recordedFiles).length > 0) {
    /** @type {string[][]} */
    const rows = [['plugin', 'errors', 'baseline', 'delta', 'files']]
    const names = [...plugins].sort((a, b) => (live.plugins[b] ?? 0) - (live.plugins[a] ?? 0) || a.localeCompare(b))
    for (const name of names) {
      const errors = live.plugins[name] ?? 0
      const recorded = baselinePlugins[name] ?? 0
      if (errors === 0 && recorded === 0) continue
      rows.push([name, String(errors), String(recorded), (errors - recorded >= 0 ? '+' : '') + (errors - recorded), String(Object.keys(live.files).filter((file) => pluginOf(file) === name).length)])
    }
    const shared = live.plugins['(shared)'] ?? 0
    const sharedRecorded = baselinePlugins['(shared)'] ?? 0
    if (shared > 0 || sharedRecorded > 0) rows.push(['(shared sources)', String(shared), String(sharedRecorded), (shared - sharedRecorded >= 0 ? '+' : '') + (shared - sharedRecorded), String(Object.keys(live.files).filter((file) => pluginOf(file) === null).length)])
    rows.push(['TOTAL', String(live.total), String(classified.recordedTotal), (live.total - classified.recordedTotal >= 0 ? '+' : '') + (live.total - classified.recordedTotal), String(Object.keys(live.files).length)])
    process.stdout.write(renderTable(rows) + '\n\n')
  } else {
    process.stdout.write('  no type errors\n\n')
  }
  if (classified.bornStrictDiagnostics.length > 0) {
    process.stdout.write('NEW errors in modules that must be born strict (' + classified.bornStrictDiagnostics.length + '):\n')
    for (const diagnostic of classified.bornStrictDiagnostics.slice(0, 40)) {
      process.stdout.write('  ' + diagnostic.file + '(' + diagnostic.line + ',' + diagnostic.column + '): ' + diagnostic.code + ': ' + diagnostic.message + '\n')
    }
    if (classified.bornStrictDiagnostics.length > 40) process.stdout.write('  ... and ' + (classified.bornStrictDiagnostics.length - 40) + ' more (--json)\n')
    process.stdout.write('\n')
  }
  if (classified.newDiagnostics.length > 0) {
    process.stdout.write('NEW errors above the baseline (' + classified.newDiagnostics.length + '):\n')
    for (const diagnostic of classified.newDiagnostics.slice(0, 40)) {
      process.stdout.write('  ' + diagnostic.file + '(' + diagnostic.line + ',' + diagnostic.column + '): ' + diagnostic.code + ': ' + diagnostic.message + '\n')
    }
    if (classified.newDiagnostics.length > 40) process.stdout.write('  ... and ' + (classified.newDiagnostics.length - 40) + ' more (--json)\n')
    process.stdout.write('\n')
  }
  /** @type {[string, number][]} */
  const worst = Object.entries(live.files).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (worst.length > 0) {
    process.stdout.write('worst files: ' + worst.map(([file, count]) => file + ' (' + count + ')').join(', ') + '\n\n')
  }
  for (const note of notes) process.stdout.write('note: ' + note + '\n')
  if (notes.length > 0) process.stdout.write('\n')
  const legacy = live.total - classified.newDiagnostics.length - classified.bornStrictDiagnostics.length
  if (verdict === 'pass') {
    process.stdout.write(WRITE_BASELINE
      ? 'PASS — baseline recorded\n'
      : ALLOW_BASELINE
        ? 'PASS (baseline) — no new errors; ' + legacy + ' legacy error(s) remain allowlisted\n'
        : 'PASS — 0 type errors\n')
  } else {
    if (bornStrictFail) process.stdout.write('FAIL — ' + classified.bornStrictDiagnostics.length + ' type error(s) in modules that must be born strict (never allowlisted)\n')
    if (newFail) process.stdout.write('FAIL — ' + classified.newDiagnostics.length + ' new type error(s) above plugins/strict-baseline.json\n')
    if (strictFail && !newFail && !bornStrictFail) process.stdout.write('FAIL — ' + live.total + ' type error(s) remain; the gate turns green at zero. --allow-baseline enforces regressions only\n')
    else if (strictFail) process.stdout.write('also: ' + live.total + ' total type error(s) remain (strict mode)\n')
  }
}

process.exit(exitCode)
