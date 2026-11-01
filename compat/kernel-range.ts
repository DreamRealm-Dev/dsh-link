/**
 * Kernel compatibility ranges: a small, dependency-free semver subset.
 *
 * Frozen semantics (R90 S3, feature-pack-spec.md:78/79/81/85/86):
 *   - versions come from a real installed closure, never from a constant;
 *   - syntax this module does not support is a MISMATCH, and the refusal names the index of the
 *     offending token in the original text, so a reader can point at it;
 *   - a range whose text carries no prerelease tag treats X.Y.Z-pre as satisfying exactly when
 *     X.Y.Z does; a range that does carry one compares prereleases ordinally like semver;
 *   - > >= < <= = are unsupported on purpose (the conservative surface is frozen).
 *
 * Erasable syntax only: no enum, no namespace, no parameter properties, no decorators, no
 * experimental modifiers. Plain node must be able to import this file as its own compiled output.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One comparator parsed out of a range. */
export interface Comparator {
  /** ^ (compatible-with), ~ (patch/minor level), exact, partial (0.2 / 0.2.x / *), any. */
  readonly op: 'caret' | 'tilde' | 'exact' | 'partial' | 'any'
  /** The numeric parts a comparator carries, in order; partials may be shorter than three. */
  readonly parts: readonly number[]
  /** The comparator's own prerelease tag when it names one, else null. */
  readonly prerelease: string | null
  /** The text this comparator was read from. */
  readonly raw: string
}

/** The result of parsing a range. */
export type ParseResult =
  | { readonly ok: true, readonly comparators: readonly Comparator[] }
  | { readonly ok: false, readonly reason: 'unsupported-syntax', readonly index: number, readonly token: string }

/** One version, split into the parts the comparators need. */
interface Version {
  readonly parts: readonly number[]
  readonly prerelease: string | null
}

/** A plugin's declared range, where it came from, and what it means against one kernel. */
export interface PluginRangeRow {
  readonly plugin: string
  readonly range: string | null
  readonly source: 'requires.dsh' | 'engines.dsh' | 'peerDependencies[@deepseek-ai/dsh]' | null
  readonly verdict: 'satisfied' | 'mismatch' | 'unsupported-syntax' | 'no-range' | 'unknown-kernel'
}

/** THE unsupported syntax: the frozen conservative surface. */
const UNSUPPORTED_TOKENS = ['>', '<', '=']

/**
 * Parse a range into comparators, or refuse with the offending token's index.
 * @param text - the range text as written.
 * @returns the comparators, or the refusal with the token and its index in text.
 */
export function parseRange(text: string): ParseResult {
  const comparators: Comparator[] = []
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === ' ' || char === '\t') { at += 1; continue }
    if (text.startsWith('||', at)) { at += 2; continue }
    if (UNSUPPORTED_TOKENS.includes(char)) {
      return { ok: false, reason: 'unsupported-syntax', index: at, token: char }
    }
    let end = at
    while (end < text.length && text[end] !== ' ' && text[end] !== '\t' && !text.startsWith('||', end)) end += 1
    const raw = text.slice(at, end)
    const parsed = parseComparator(raw, at)
    if (parsed.ok === false) return parsed
    comparators.push(parsed.comparator)
    at = end
  }
  return { ok: true, comparators }
}

/** Parse one comparator token, keeping the absolute index for a refusal. */
function parseComparator(raw: string, offset: number): { ok: true, comparator: Comparator } | { ok: false, reason: 'unsupported-syntax', index: number, token: string } {
  const bad = UNSUPPORTED_TOKENS.find((token) => raw.includes(token))
  if (bad !== undefined) return { ok: false, reason: 'unsupported-syntax', index: offset + raw.indexOf(bad), token: bad }
  let op: Comparator['op'] = 'exact'
  let body = raw
  if (body.startsWith('^')) { op = 'caret'; body = body.slice(1) }
  else if (body.startsWith('~')) { op = 'tilde'; body = body.slice(1) }
  if (body === '*' || body === '') { return { ok: true, comparator: { op: 'any', parts: [], prerelease: null, raw } } }
  const [core, ...rest] = body.split('-')
  const prerelease = rest.length > 0 ? rest.join('-') : null
  const pieces = core.split('.')
  const parts: number[] = []
  for (const piece of pieces) {
    if (piece === 'x' || piece === 'X' || piece === '*') break
    const value = Number(piece)
    if (!Number.isInteger(value) || value < 0 || piece === '') return { ok: true, comparator: { op: 'partial', parts, prerelease, raw } }
    parts.push(value)
  }
  if (op === 'exact' && parts.length < 3) op = 'partial'
  return { ok: true, comparator: { op, parts, prerelease, raw } }
}

/** Split a version into numeric parts and its prerelease tag. */
function splitVersion(version: string): Version {
  const [core, ...rest] = version.split('-')
  const parts = core.split('.').map((piece) => Number(piece)).filter((value) => Number.isInteger(value))
  return { parts, prerelease: rest.length > 0 ? rest.join('-') : null }
}

/** Compare two prerelease tags ordinally, semver style. */
function comparePrerelease(left: string, right: string): number {
  const a = left.split('.')
  const b = right.split('.')
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const x = a[at]
    const y = b[at]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isInteger(nx) && Number.isInteger(ny)) { if (nx !== ny) return nx < ny ? -1 : 1; continue }
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Compare two cores (major.minor.patch, missing parts read as zero). */
function coreCompare(left: readonly number[], right: readonly number[]): number {
  for (let at = 0; at < 3; at += 1) {
    const a = left[at] ?? 0
    const b = right[at] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/** Compare two versions: core first, then the prerelease rule (a prerelease is below its release). */
function versionCompare(left: Version, right: Version): number {
  const core = coreCompare(left.parts, right.parts)
  if (core !== 0) return core
  if (left.prerelease === null && right.prerelease === null) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** The exclusive upper bound a caret comparator implies. */
function caretUpper(parts: readonly number[]): { parts: number[], prerelease: null } {
  const first = parts.findIndex((value) => value !== 0)
  if (first === -1) return { parts: [0, 0, (parts[2] ?? 0) + 1], prerelease: null }
  const upper = parts.slice(0, first + 1)
  upper[first] = (upper[first] ?? 0) + 1
  return { parts: upper, prerelease: null }
}

/** The exclusive upper bound a tilde comparator implies. */
function tildeUpper(parts: readonly number[]): { parts: number[], prerelease: null } {
  if (parts.length >= 2) return { parts: [parts[0] ?? 0, (parts[1] ?? 0) + 1], prerelease: null }
  return { parts: [(parts[0] ?? 0) + 1], prerelease: null }
}

/**
 * Does one comparator accept one version?
 *
 * A comparator is a lower bound plus, for caret, tilde and partial forms, an exclusive upper bound.
 * Prerelease tolerance is decided by the caller before this runs.
 */
function comparatorAccepts(comparator: Comparator, version: Version): boolean {
  if (comparator.op === 'any') return true
  if (comparator.op === 'partial') {
    // 0.2 and 0.2.x accept anything whose leading parts match.
    for (let at = 0; at < comparator.parts.length; at += 1) {
      if ((version.parts[at] ?? 0) !== comparator.parts[at]) return false
    }
    if (comparator.prerelease !== null) {
      return version.prerelease !== null && comparePrerelease(version.prerelease, comparator.prerelease) >= 0
    }
    return true
  }
  const lower: Version = { parts: comparator.parts, prerelease: comparator.prerelease }
  const aboveLower = versionCompare(version, lower)
  if (aboveLower < 0) return false
  if (comparator.op === 'exact') {
    return comparator.prerelease === null ? version.prerelease === null : aboveLower > 0 || version.prerelease !== null
  }
  const upper = comparator.op === 'tilde' ? tildeUpper(comparator.parts) : caretUpper(comparator.parts)
  return coreCompare(version.parts, upper.parts) < 0
}

/**
 * Does a version satisfy a range?
 * @param range - the range text.
 * @param version - the version text.
 * @returns true when it satisfies; unsupported or unparsable syntax is false (a mismatch).
 */
export function satisfiesRange(range: string, version: string): boolean {
  const parsed = parseRange(range)
  if (parsed.ok === false) return false
  const tolerant = range.includes('-') === false
  const split = splitVersion(version)
  const tested: Version = tolerant && split.prerelease !== null
    ? { parts: split.parts, prerelease: null }
    : split
  const groups = parseGroups(range)
  return groups.some((group) => group.every((comparator) => comparatorAccepts(comparator, tested)))
}

/** Split comparators into AND groups separated by OR, each group an AND list. */
function parseGroups(range: string): Comparator[][] {
  const groups: Comparator[][] = [[]]
  let at = 0
  while (at < range.length) {
    const char = range[at]
    if (char === ' ' || char === '\t') { at += 1; continue }
    if (range.startsWith('||', at)) { groups.push([]); at += 2; continue }
    let end = at
    while (end < range.length && range[end] !== ' ' && range[end] !== '\t' && !range.startsWith('||', end)) end += 1
    const raw = range.slice(at, end)
    const parsed = parseComparator(raw, at)
    if (parsed.ok) groups[groups.length - 1].push(parsed.comparator)
    at = end
  }
  return groups.filter((group) => group.length > 0)
}

/**
 * The verdict for one range and version.
 * @param range - the range text.
 * @param version - the version text.
 * @returns satisfied, mismatch, or unsupported-syntax (which is not a match).
 */
export function verdictForRange(range: string, version: string): 'satisfied' | 'mismatch' | 'unsupported-syntax' {
  if (parseRange(range).ok === false) return 'unsupported-syntax'
  return satisfiesRange(range, version) ? 'satisfied' : 'mismatch'
}

/** Every {name, version} a real installation closure declares, newest walk order. */
export function installedClosureVersions(dir: string): { name: string, version: string }[] {
  const found: { name: string, version: string }[] = []
  const walk = (path: string, depth: number): void => {
    if (depth > 6) return
    let entries: string[] = []
    try { entries = readdirSync(path) } catch { return }
    if (entries.includes('package.json')) {
      try {
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
        if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
          found.push({ name: manifest.name, version: manifest.version })
        }
      } catch {
        // A manifest that does not parse is not a version source; the walk continues.
      }
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const child = join(path, entry)
      try { if (statSync(child).isDirectory()) walk(child, depth + 1) } catch { /* unreadable entry */ }
    }
  }
  walk(dir, 0)
  return found
}

/**
 * The kernel's own version, read from a real closure.
 * @param closure - rows from installedClosureVersions.
 * @param name - the package whose version is the kernel's.
 * @returns the version, or null: a version that cannot be read is never guessed.
 */
export function kernelVersionFromClosure(closure: readonly { name: string, version: string }[], name = '@deepseek-ai/dsh'): string | null {
  const row = closure.find((entry) => entry.name === name)
  return row === undefined ? null : row.version
}

/**
 * Read one plugin's declared kernel range, remembering which field carried it.
 * @param manifest - a plugin's package.json contents.
 * @returns the range and its source field, or nulls when none of the three fields has one.
 */
export function declaredRange(manifest: Record<string, unknown>): { range: string | null, source: PluginRangeRow['source'] } {
  const requires = (manifest.requires ?? {}) as Record<string, unknown>
  if (typeof requires.dsh === 'string') return { range: requires.dsh, source: 'requires.dsh' }
  const engines = (manifest.engines ?? {}) as Record<string, unknown>
  if (typeof engines.dsh === 'string') return { range: engines.dsh, source: 'engines.dsh' }
  const peers = (manifest.peerDependencies ?? {}) as Record<string, unknown>
  if (typeof peers['@deepseek-ai/dsh'] === 'string') return { range: peers['@deepseek-ai/dsh'] as string, source: 'peerDependencies[@deepseek-ai/dsh]' }
  return { range: null, source: null }
}

/**
 * Every plugin under a directory, with the verdict its declared range produces.
 * @param pluginsDir - a directory of plugin packages.
 * @param kernelVersion - the kernel's version, or null when it could not be read.
 * @returns one row per plugin.
 */
export function scanPluginRanges(pluginsDir: string, kernelVersion: string | null): PluginRangeRow[] {
  let entries: string[] = []
  try { entries = readdirSync(pluginsDir) } catch { return [] }
  const rows: PluginRangeRow[] = []
  for (const entry of entries.sort()) {
    const dir = join(pluginsDir, entry)
    let manifest: Record<string, unknown>
    try { manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { continue }
    const name = typeof manifest.name === 'string' ? manifest.name : entry
    const declared = declaredRange(manifest)
    if (declared.range === null) { rows.push({ plugin: name, range: null, source: null, verdict: 'no-range' }); continue }
    const verdict = kernelVersion === null ? 'unknown-kernel' : verdictForRange(declared.range, kernelVersion)
    rows.push({ plugin: name, range: declared.range, source: declared.source, verdict })
  }
  return rows
}

/**
 * The report of everything that is not satisfied, as sorted data.
 * @param rows - plugin rows.
 * @returns the report with sorted rows and stable key order.
 */
export function incompatibleReport(rows: readonly PluginRangeRow[]): Record<string, unknown> {
  const unsat = rows.filter((row) => row.verdict !== 'satisfied')
    .map((row) => ({ plugin: row.plugin, range: row.range, source: row.source, verdict: row.verdict }))
    .sort((left, right) => (left.plugin < right.plugin ? -1 : left.plugin > right.plugin ? 1 : 0))
  return { format: 'dsh-link.kernel-range-report/1', counts: { rows: rows.length, unsatisfied: unsat.length }, rows: unsat }
}

/**
 * Write the report so two runs are byte-identical: sorted, LF, one trailing newline.
 * @param file - the destination.
 * @param rows - plugin rows.
 * @returns the bytes written.
 */
export function writeIncompatibleReport(file: string, rows: readonly PluginRangeRow[]): string {
  const text = JSON.stringify(incompatibleReport(rows), null, 1).replace(/\r\n/g, '\n') + '\n'
  writeFileSync(file, text, 'utf8')
  return text
}
/**
 * The package names the kernel's own root manifest may carry.
 *
 * Evidence: kernel.lock.json:3 records packageName "@deepseek-ai/dsh-root", and
 * core/deepseek-harness/package.json declares the same name at version 0.2.1-alpha.1. The older
 * "@deepseek-ai/dsh" is accepted too, because a fixture or an older closure may carry it.
 */
const KERNEL_PACKAGE_NAMES: readonly string[] = ['@deepseek-ai/dsh-root', '@deepseek-ai/dsh']

/** One source the ladder consulted, and why it did or did not answer. */
export interface KernelVersionAttempt {
  /** The source's name: closure, checkout, or lock. */
  readonly source: string
  /** True for the source that answered. */
  readonly ok: boolean
  /** What that source contained, or why it could not be read. */
  readonly detail: string
}

/** The kernel version the ladder resolved, the source that answered, and every source tried. */
export interface KernelVersionResolution {
  /** The version, or null when no source could answer: a version is never guessed. */
  readonly version: string | null
  /** Which source answered, e.g. "closure:@deepseek-ai/dsh-root", or null. */
  readonly source: string | null
  /** Every source consulted, in order, with its outcome. */
  readonly tried: readonly KernelVersionAttempt[]
}

/**
 * Resolve the kernel's version from the config that set it up, by a declared ladder.
 *
 *   1 the installation closure's manifests (either kernel package name);
 *   2 the kernel checkout root's package.json;
 *   3 the lock file's packageName/packageVersion.
 *
 * When none answers, the result is null and \`tried\` names each source with its failure reason,
 * so a reader can tell "no source had it" from "we did not look".
 *
 * @param options - the closure directory, the checkout root, and the lock file, any of which may be absent.
 * @returns the version, its source, and every attempt.
 */
export function resolveKernelVersion(options: { closureDir?: string, kernelRoot?: string, lockFile?: string }): KernelVersionResolution {
  const tried: KernelVersionAttempt[] = []
  const isKernelName = (name: unknown): boolean => typeof name === 'string' && KERNEL_PACKAGE_NAMES.includes(name)

  if (options.closureDir === undefined) {
    tried.push({ source: 'closure', ok: false, detail: 'no closureDir was given' })
  } else {
    const rows = installedClosureVersions(options.closureDir)
    const hit = rows.find((row) => isKernelName(row.name))
    if (hit !== undefined) {
      tried.push({ source: 'closure', ok: true, detail: options.closureDir + ' declares ' + hit.name + '@' + hit.version })
      return { version: hit.version, source: 'closure:' + hit.name, tried }
    }
    tried.push({
      source: 'closure', ok: false,
      detail: options.closureDir + ' listed ' + rows.length + ' manifest(s), none named ' + KERNEL_PACKAGE_NAMES.join(' or ') + (rows.length === 0 ? ' (a closure with nothing readable in it resolves to nothing)' : ''),
    })
  }

  if (options.kernelRoot === undefined) {
    tried.push({ source: 'checkout', ok: false, detail: 'no kernelRoot was given' })
  } else {
    const manifest = join(options.kernelRoot, 'package.json')
    if (!existsSync(manifest)) {
      tried.push({ source: 'checkout', ok: false, detail: manifest + ' is not there' })
    } else {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown, version?: unknown }
        if (isKernelName(parsed.name) && typeof parsed.version === 'string') {
          tried.push({ source: 'checkout', ok: true, detail: manifest + ' declares ' + String(parsed.name) + '@' + parsed.version })
          return { version: parsed.version, source: 'checkout', tried }
        }
        tried.push({ source: 'checkout', ok: false, detail: manifest + ' declares ' + String(parsed.name) + ', which is not a kernel package name' })
      } catch (error) {
        tried.push({ source: 'checkout', ok: false, detail: manifest + ' is not JSON: ' + String((error as Error).message) })
      }
    }
  }

  if (options.lockFile === undefined) {
    tried.push({ source: 'lock', ok: false, detail: 'no lockFile was given' })
  } else if (!existsSync(options.lockFile)) {
    tried.push({ source: 'lock', ok: false, detail: options.lockFile + ' is not there' })
  } else {
    try {
      const parsed = JSON.parse(readFileSync(options.lockFile, 'utf8')) as { packageName?: unknown, packageVersion?: unknown }
      if (isKernelName(parsed.packageName) && typeof parsed.packageVersion === 'string') {
        tried.push({ source: 'lock', ok: true, detail: options.lockFile + ' declares ' + String(parsed.packageName) + '@' + parsed.packageVersion })
        return { version: parsed.packageVersion, source: 'lock', tried }
      }
      tried.push({ source: 'lock', ok: false, detail: options.lockFile + ' names ' + String(parsed.packageName) + ', which is not a kernel package name' })
    } catch (error) {
      tried.push({ source: 'lock', ok: false, detail: options.lockFile + ' is not JSON: ' + String((error as Error).message) })
    }
  }

  return { version: null, source: null, tried }
}

