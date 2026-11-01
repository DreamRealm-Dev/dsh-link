/**
 * LINK's own upgrade path: the state-layout migration engine.
 *
 * 《DSH LINK.md》§其他要做的 第 12 条 asks that upgrading LINK lose neither conversations, nor
 * functions, nor the ability to start. The kernel is pinned and audited elsewhere; what had no
 * engine was LINK's **own** state layout. This module is that engine, and it is deliberately three
 * pure functions over a directory: a plan, a validated apply, and the proof that what had to survive
 * did.
 *
 * ## What this is, and what it is not
 *
 * It is: **plan → validate → apply → survival check → report**, with the steps living in data
 * (`migrations.json`) rather than in code branches, so a migration is reviewed as a list of actions
 * instead of as a diff to this file. It is not: a real installer or distribution channel, a download
 * or verification for the kernel (still a pinned read-only checkout), and nothing here is tested
 * against a real power cut — failure is injected through `beforeCommit`, which is the same thing a
 * crash between the two renames would do to this code path.
 *
 * ## The three things that must survive, and how they are read
 *
 * `ledger/` holds the conversations, tasks, locks and turns; every file's **bytes** are hashed before
 * and after, and a single differing byte fails the run. The plugin set may only grow. Configuration
 * keys may not disappear; a key whose **value** changed has to appear in `changed` with both values,
 * because a silent value change is the one edit nobody would notice. Anything in the root that this
 * layout does not describe is never touched and is listed as `preserved`.
 *
 * ## Atomicity, and what a failure leaves behind
 *
 * Nothing is written into the live root until the whole migration has been built somewhere else: a
 * staging directory beside the root is filled from the root itself, the actions are applied there, and
 * only then is the root swapped for it (root → backup, staging → root, backup deleted). A throw from
 * `beforeCommit` — or a failure while filling the staging — leaves the root exactly as it was, and the
 * exception is rethrown rather than translated into a report: `ApplyReport.reason` speaks the plan's
 * vocabulary, and "the commit itself failed" is not a plan reason. A refusal (newer state, no path,
 * unknown action, bad manifest) is a different thing entirely and comes back as a report, because
 * refusing is an answer this engine is expected to give.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, relative, sep } from 'node:path'

/** The migration-manifest format this engine reads. Anything else is refused, not guessed at. */
export const MIGRATIONS_FORMAT = 'dsh-link.migrations/1'

/** The file that carries the state version and the layout version. */
export const VERSION_FILE = 'version.json'
/** The directory of JSON configuration files. */
export const CONFIG_DIR = 'config'
/** The file listing the mounted plugins. */
import { declaredRange, installedClosureVersions, kernelVersionFromClosure, resolveKernelVersion, scanPluginRanges, verdictForRange } from '../../../compat/kernel-range.ts'
import type { KernelVersionResolution } from '../../../compat/kernel-range.ts'

export const PLUGINS_FILE = 'plugins.json'
/** The directory of control-log files: the conversations and the work, byte for byte. */
export const LEDGER_DIR = 'ledger'

/** The paths the layout describes. Everything else in the root is preserved, never touched. */
const LAYOUT_PATHS: readonly string[] = [VERSION_FILE, CONFIG_DIR, PLUGINS_FILE, LEDGER_DIR]

/** One state root, as {@link readState} reads it. */
export interface LinkState {
  /** The directory read. */
  readonly root: string
  /** The LINK version the state was written by. */
  readonly link: string
  /** The layout version: what the migrations move from. */
  readonly layout: number
  /**
   * The configuration, flattened to dot-paths.
   *
   * `config/window.json` holding `{ "scale": 1 }` reads as the key `window.scale`, which is the
   * vocabulary the actions use; a nested object becomes a longer path, and the file itself is
   * `<first segment>.json`.
   */
  readonly config: Readonly<Record<string, unknown>>
  /** The plugins this state mounts, sorted. */
  readonly plugins: readonly string[]
  /** The ledger's files, as root-relative POSIX paths, sorted. */
  readonly ledger: readonly string[]
}

/** One action a migration step performs. The vocabulary is closed: an unknown kind is refused. */
export type MigrationAction =
  | { readonly kind: 'add-config', readonly key: string, readonly value: unknown }
  | { readonly kind: 'set-config', readonly key: string, readonly value: unknown }
  | { readonly kind: 'ensure-plugin', readonly name: string }
  | { readonly kind: 'note', readonly text: string }

/** One step of a migration: everything from one layout version to the next. */
export interface MigrationStep {
  /** The layout version this step starts at. */
  readonly from: number
  /** The layout version it ends at. */
  readonly to: number
  /** What it does, in order. */
  readonly actions: readonly MigrationAction[]
}

/** A migration manifest, as the data file holds it. */
export interface MigrationsManifest {
  /** The format tag. Only {@link MIGRATIONS_FORMAT} is read. */
  readonly format: string
  /** The layout version the steps lead to. */
  readonly current: number
  /** The steps. */
  readonly steps: readonly MigrationStep[]
}

/** One step, as the plan picked it. */
export interface PlannedStep {
  /** The layout version it starts at. */
  readonly from: number
  /** The layout version it ends at. */
  readonly to: number
  /** What it does. */
  readonly actions: readonly MigrationAction[]
}

/** Why a migration may or may not run. */
export type PlanReason = 'ok' | 'already-current' | 'newer-state' | 'no-path' | 'unknown-action' | 'bad-manifest'

/** What {@link planMigrations} answers, with everything it was decided from. */
export interface PlanResult {
  /** Whether the plan may be applied. True only for reason === 'ok' and 'already-current'. */
  readonly ok: boolean
  /** Why. */
  readonly reason: PlanReason
  /** The layout version the state is at. */
  readonly from: number
  /** The layout version the manifest leads to. */
  readonly to: number
  /** The steps to run, in order. Empty for every refusal and for an up-to-date state. */
  readonly steps: readonly PlannedStep[]
  /** Actions whose kind this engine does not know, with the step index they sat in. */
  readonly unknown: readonly { readonly step: number, readonly kind: string }[]
  /** What was wrong, when the reason needs words, else null. */
  readonly detail: string | null
}

/** One configuration key whose value the migration changed. */
export interface ConfigChange {
  /** The dot-path key. */
  readonly key: string
  /** The value before, or undefined when the key did not exist. */
  readonly before: unknown
  /** The value after. */
  readonly after: unknown
}

/** What {@link applyMigration} answers, or did. */
export interface ApplyReport {
  /** Whether the migration ran (or, for a dry run, would run) and everything survived. */
  readonly ok: boolean
  /** The plan's reason. `ok` means the migration ran. */
  readonly reason: PlanReason
  /** The layout version before. */
  readonly from: number
  /** The layout version after. */
  readonly to: number
  /** The steps executed, as `"1->2"`, in order. */
  readonly applied: readonly string[]
  /** Every configuration key whose value changed, with both values. Sorted by key. */
  readonly changed: readonly ConfigChange[]
  /** Every configuration key that did not exist before. Sorted. */
  readonly added: readonly string[]
  /** Root-relative paths the layout does not describe: untouched, and listed here. Sorted. */
  readonly preserved: readonly string[]
  /** Whether every file under `ledger/` has the same bytes it had before. */
  readonly ledgerUnchanged: boolean
  /** Whether the root's bytes are unchanged. True for every refusal, for a dry run, and for a no-op. */
  readonly rootUnchanged: boolean
  /**
   * The text of every `note` action the plan carried, in step order.
   *
   * A note that reaches no reading is not a note; the contract's report shape has no field for them,
   * and dropping them would make an action that says "write this in the report" a lie.
   */
  readonly notes: readonly string[]
}

/** Options for {@link applyMigration}. */
export interface ApplyOptions {
  /** Build and report the whole migration, then throw the staging away instead of committing it. */
  readonly dryRun?: boolean
  /** Called after the staging tree is complete and before the root is swapped. Throwing aborts. */
  readonly beforeCommit?: () => void
  /**
   * Refuse the migration when a plugin's declared kernel range does not match the installed kernel.
   *
   * **Off unless a caller asks.** The check runs before any staging or backup is created, so a refusal leaves
   * no half-built directory behind and the root keeps every byte it had; a caller that never sets it keeps the
   * behaviour this function had.
   */
  readonly enforceKernelRange?: boolean
  /**
   * What \`enforceKernelRange\` judges: which plugins, and the later ladder levels for the kernel version.
   *
   * \`pluginsDir\` is required when the flag is on - a range check with no directory to check is a
   * misconfiguration, and it is refused by name rather than silently skipped.
   */
  readonly kernelRange?: { readonly pluginsDir: string, readonly closureDir?: string, readonly kernelRoot?: string, readonly lockFile?: string }
}

/** The keys the layout owns, as a set for fast membership. */
const layoutOwned = (relativePath: string): boolean => LAYOUT_PATHS.some((owned) => relativePath === owned || relativePath.startsWith(owned + '/'))

/** Read one JSON file, throwing the same way every reader here throws: loudly, and with the path. */
function readJsonFile(path: string): unknown {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new TypeError('unreadable JSON at ' + path + ': ' + String((error as Error)?.message ?? error))
  }
}

/** The entries of one directory, names only, sorted, or an empty list when it does not exist. */
function entriesOf(path: string): string[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return []
  return readdirSync(path).sort()
}

/** Flatten one configuration value into dot-path keys under a prefix. */
function flattenInto(prefix: string, value: unknown, out: Record<string, unknown>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      out[prefix] = {}
      return
    }
    for (const [key, nested] of entries) flattenInto(prefix === '' ? key : prefix + '.' + key, nested, out)
    return
  }
  out[prefix] = value
}

/** Every configuration file under `config/`, as root-relative POSIX paths, sorted. */
function configFiles(root: string, prefix = CONFIG_DIR): string[] {
  const out: string[] = []
  for (const name of entriesOf(join(root, prefix))) {
    const relativePath = prefix + '/' + name
    if (statSync(join(root, relativePath)).isDirectory()) out.push(...configFiles(root, relativePath))
    else if (name.endsWith('.json')) out.push(relativePath)
  }
  return out.sort()
}

/** The dot-path prefix one configuration file contributes: `config/window.json` reads as `window`. */
function configPrefix(relativePath: string): string {
  const inside = relativePath.slice(CONFIG_DIR.length + 1)
  const withoutExtension = inside.endsWith('.json') ? inside.slice(0, -'.json'.length) : inside
  return withoutExtension.split('/').join('.')
}

/**
 * Read the state root, without writing anything.
 *
 * A root with no usable `version.json` is an error rather than an empty state: a version nobody can
 * read is a version nobody may migrate, and guessing one would migrate state this engine has never
 * been told about.
 * @param root - the state root.
 * @returns the state.
 * @throws TypeError when `version.json` is missing or its shape cannot be read.
 */
export function readState(root: string): LinkState {
  const versionPath = join(root, VERSION_FILE)
  if (!existsSync(versionPath)) throw new TypeError('readState: no ' + VERSION_FILE + ' under ' + root + '; a state without a version is not migrated')
  const version = readJsonFile(versionPath) as { link?: unknown, layout?: unknown } | null
  const link = version === null || typeof version.link !== 'string' || version.link === '' ? null : version.link
  const layout = version === null || typeof version.layout !== 'number' || !Number.isInteger(version.layout) || version.layout < 1 ? null : version.layout
  if (link === null) throw new TypeError('readState: ' + VERSION_FILE + ' carries no usable link version')
  if (layout === null) throw new TypeError('readState: ' + VERSION_FILE + ' carries no usable layout version (an integer >= 1)')

  const config: Record<string, unknown> = {}
  for (const relativePath of configFiles(root)) {
    const parsed = readJsonFile(join(root, relativePath))
    flattenInto(configPrefix(relativePath), parsed, config)
  }

  const pluginsPath = join(root, PLUGINS_FILE)
  let plugins: string[] = []
  if (existsSync(pluginsPath)) {
    const parsed = readJsonFile(pluginsPath) as { plugins?: unknown } | null
    if (parsed === null || !Array.isArray(parsed.plugins)) throw new TypeError('readState: ' + PLUGINS_FILE + ' carries no plugins array')
    plugins = [...new Set(parsed.plugins.filter((name): name is string => typeof name === 'string' && name !== ''))].sort()
  }

  const ledger: string[] = []
  const walk = (prefix: string): void => {
    for (const name of entriesOf(join(root, prefix))) {
      const relativePath = prefix + '/' + name
      if (statSync(join(root, relativePath)).isDirectory()) walk(relativePath)
      else ledger.push(relativePath)
    }
  }
  walk(LEDGER_DIR)

  return { root, link, layout, config, plugins, ledger: ledger.sort() }
}

/**
 * Every path in one root, with a digest of its bytes.
 *
 * Directories are included as `path/` mapped to the literal `"dir"`, because "the root is unchanged"
 * has to notice a directory that vanished even when every remaining file is intact. Files are hashed,
 * never measured: two files of the same length with one byte swapped are the difference this reading
 * exists to catch.
 * @param root - the directory.
 * @returns relative POSIX path to digest, sorted by path.
 */
export function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (prefix: string): void => {
    for (const name of entriesOf(join(root, prefix))) {
      const relativePath = (prefix === '' ? '' : prefix + '/') + name
      const full = join(root, relativePath)
      if (statSync(full).isDirectory()) {
        out[relativePath + '/'] = 'dir'
        walk(relativePath)
      } else {
        out[relativePath] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk('')
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(out).sort()) sorted[key] = out[key]
  return sorted
}

/** The paths in one root that the layout does not describe, files and directories alike, sorted. */
export function preservedPaths(root: string): string[] {
  const out: string[] = []
  const walk = (prefix: string): void => {
    for (const name of entriesOf(join(root, prefix))) {
      const relativePath = (prefix === '' ? '' : prefix + '/') + name
      if (statSync(join(root, relativePath)).isDirectory()) {
        out.push(relativePath)
        walk(relativePath)
      } else out.push(relativePath)
    }
  }
  walk('')
  return out.filter((path) => !layoutOwned(path)).sort()
}

/** The ledger's files with their digests, as `path` → sha256. */
function ledgerHashes(root: string, files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const relativePath of files) {
    const full = join(root, relativePath)
    out[relativePath] = existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : 'missing'
  }
  return out
}

/**
 * Work out what a migration would do, without doing any of it.
 *
 * Pure in the strict sense: it reads the state it was handed and nothing else — no clock, no disk, no
 * globals — so the same manifest and the same state answer byte for byte the same question, which is
 * what lets a plan be reviewed before it is trusted. The precedence is the contract's own order:
 * an unreadable manifest, a state **newer** than the manifest (never a downgrade), a state already at
 * the manifest's version, a chain that does not connect, an action whose kind this engine does not
 * know.
 * @param manifest - the migration manifest, as data.
 * @param state - the state root, as read.
 * @returns the plan, or the refusal and everything it was decided from.
 */
export function planMigrations(manifest: MigrationsManifest, state: LinkState): PlanResult {
  const refuse = (reason: PlanReason, unknown: readonly { step: number, kind: string }[], detail: string | null): PlanResult =>
    ({ ok: false, reason, from: state.layout, to: manifest === null || typeof manifest !== 'object' ? state.layout : manifest.current, steps: [], unknown, detail })

  if (manifest === null || typeof manifest !== 'object') return refuse('bad-manifest', [], 'the manifest is not an object')
  if (manifest.format !== MIGRATIONS_FORMAT) return refuse('bad-manifest', [], 'unknown manifest format ' + JSON.stringify(manifest.format ?? null) + '; this engine reads ' + MIGRATIONS_FORMAT)
  if (typeof manifest.current !== 'number' || !Number.isInteger(manifest.current) || manifest.current < 1) return refuse('bad-manifest', [], 'current is ' + JSON.stringify(manifest.current ?? null) + ', not a layout version (an integer >= 1)')
  if (!Array.isArray(manifest.steps)) return refuse('bad-manifest', [], 'steps is not an array')

  // A state written by a newer LINK is not migrated backwards: not one byte is written, because every
  // action in this manifest was designed for a layout that no longer exists here.
  if (state.layout > manifest.current) return refuse('newer-state', [], "state layout " + String(state.layout) + " is newer than the manifest version " + String(manifest.current))
  if (state.layout === manifest.current) return { ok: true, reason: 'already-current', from: state.layout, to: manifest.current, steps: [], unknown: [], detail: null }

  const steps: PlannedStep[] = manifest.steps.map((step) => ({ from: step.from, to: step.to, actions: Array.isArray(step.actions) ? step.actions : [] }))
  const unknown: { step: number, kind: string }[] = []
  steps.forEach((step, index) => {
    for (const action of step.actions) {
      const kind = action !== null && typeof action === 'object' ? (action as { kind?: unknown }).kind : undefined
      if (kind !== 'add-config' && kind !== 'set-config' && kind !== 'ensure-plugin' && kind !== 'note') {
        unknown.push({ step: index, kind: typeof kind === 'string' ? kind : JSON.stringify(kind ?? null) })
      }
    }
  })

  // The chain has to connect, step by step: no skipping a version, and no partial upgrade.
  const chain: PlannedStep[] = []
  let at = state.layout
  for (let guard = 0; at !== manifest.current; guard += 1) {
    if (guard > manifest.steps.length + 1) return refuse('no-path', unknown, 'the steps loop without reaching ' + String(manifest.current))
    const next = steps.find((step) => step.from === at)
    if (next === undefined || next.to <= at) return refuse('no-path', unknown, 'no step leads from layout ' + String(at) + ' towards ' + String(manifest.current))
    chain.push(next)
    at = next.to
  }
  if (unknown.length > 0) return refuse('unknown-action', unknown, 'unknown action kind(s): ' + unknown.map((entry) => entry.kind).join(', '))
  return { ok: true, reason: 'ok', from: state.layout, to: manifest.current, steps: chain, unknown: [], detail: null }
}

/** Put one value at a dot-path inside a parsed JSON document, creating the objects it needs. */
function setAtPath(document: Record<string, unknown>, segments: readonly string[], value: unknown): void {
  let cursor = document
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const existing = cursor[segment]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}

/** Copy a directory tree, bytes first: the staging root is the live root plus the migration. */
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const name of entriesOf(from)) {
    const source = join(from, name)
    const target = join(to, name)
    if (statSync(source).isDirectory()) copyTree(source, target)
    else writeFileSync(target, readFileSync(source))
  }
}

/**
 * Whether a rename failure is the transient kind this module retries.
 *
 * On Windows a rename can fail with `EPERM` (or `EIO`) because an antivirus, an indexer or a file
 * watcher holds the handle for a moment; the same call typically succeeds immediately after. The
 * condition is read from the error code, with the message as a fallback because the runtime has
 * surfaced it as `(1175)` text in the past. Anything else is a real failure and is never retried:
 * swallowing `ENOSPC` or a genuine permission problem would turn a broken migration into a report.
 * @param error - the error thrown by the rename.
 * @returns true when the failure is worth exactly one more attempt.
 */
function isTransientRename(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'EPERM' || code === 'EIO') return true
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return message.includes('EPERM') || message.includes('(1175)')
}

/**
 * Rename, retrying exactly once for a transient handle failure.
 *
 * The retry is bounded at one attempt on purpose: a loop would hide a permanent problem behind a
 * timeout, and one attempt is what the measured failure needed. A second failure propagates
 * unchanged, so the caller's rollback and the thrown error still describe the real state of the root.
 * @param from - the path to move.
 * @param to - the path to move it to.
 * @returns how many retries were needed, so the report can say the commit was not a first-try commit.
 */
function renameWithRetry(from: string, to: string): number {
  try {
    renameSync(from, to)
    return 0
  } catch (error) {
    if (!isTransientRename(error)) throw error
    renameSync(from, to)
    return 1
  }
}

/**
 * Run a migration against one state root: validate everything, build it elsewhere, then swap.
 *
 * The order is the whole design. The plan is computed first and every refusal returns before anything
 * is written. Then the staging root is filled **from** the live root, so the ledger and every path the
 * layout does not describe are copies of the bytes that were there; the actions are applied to the
 * copy; and only then is the root swapped for it. A throw from `beforeCommit` — the stand-in for a
 * power cut between the two renames — or while the staging is being filled leaves the root untouched
 * and rethrows.
 *
 * A dry run builds exactly the same staging tree and reads the same report off it, then throws the
 * staging away without touching the root: the report is the real one, because it was decided from the
 * real result of the real actions.
 * @param root - the state root.
 * @param manifest - the migration manifest.
 * @param options - dry run, and the pre-commit hook.
 * @returns the report.
 * @throws Error when the commit itself fails, and TypeError when the root cannot be read at all.
 */
export function applyMigration(root: string, manifest: MigrationsManifest, options: ApplyOptions = {}): ApplyReport {
  const before = readState(root)
  const plan = planMigrations(manifest, before)
  const preserved = preservedPaths(root)
  const beforeTree = hashTree(root)
  const beforeLedger = ledgerHashes(root, before.ledger)
  const refused = (): ApplyReport => ({
    ok: false,
    reason: plan.reason,
    from: plan.from,
    to: plan.to,
    applied: [],
    changed: [],
    added: [],
    preserved,
    ledgerUnchanged: true,
    rootUnchanged: JSON.stringify(beforeTree) === JSON.stringify(hashTree(root)),
    notes: [],
  })
  if (!plan.ok) return refused()
  if (plan.reason === 'already-current') {
    return { ok: true, reason: 'already-current', from: plan.from, to: plan.to, applied: [], changed: [], added: [], preserved, ledgerUnchanged: true, rootUnchanged: true, notes: [] }
  }

  // The range check belongs here: after the plan is known and BEFORE anything is built, so a refusal cannot
  // leave a staging or backup directory behind and the root is untouched by construction rather than by cleanup.
  if (options.enforceKernelRange === true) {
    const range = options.kernelRange
    if (range === undefined || typeof range.pluginsDir !== 'string' || range.pluginsDir === '') {
      throw new TypeError('applyMigration: enforceKernelRange is on but kernelRange.pluginsDir is missing: give the plugin directory to check, or turn the flag off')
    }
    assertRangesSatisfied(range.pluginsDir, { closureDir: range.closureDir, kernelRoot: range.kernelRoot, lockFile: range.lockFile })
  }

  const staging = join(dirname(root), '.' + basename(root) + '.staging-' + randomUUID())
  const backup = join(dirname(root), '.' + basename(root) + '.backup-' + randomUUID())
  let committed = false
  try {
    copyTree(root, staging)

    const config: Record<string, unknown> = { ...before.config }
    const documents = new Map<string, Record<string, unknown>>()
    const documentFor = (prefix: string): Record<string, unknown> => {
      const held = documents.get(prefix)
      if (held !== undefined) return held
      const path = join(staging, CONFIG_DIR, prefix.split('.').join('/') + '.json')
      const loaded = existsSync(path) ? (readJsonFile(path) as Record<string, unknown>) : {}
      const document = loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {}
      documents.set(prefix, document)
      return document
    }
    const changed: ConfigChange[] = []
    const added: string[] = []
    const applied: string[] = []
    const notes: string[] = []
    let plugins = [...before.plugins]

    for (const step of plan.steps) {
      for (const action of step.actions) {
        if (action.kind === 'note') { notes.push(action.text); continue }
        if (action.kind === 'ensure-plugin') {
          if (!plugins.includes(action.name)) plugins = [...plugins, action.name].sort()
          continue
        }
        const segments = action.key.split('.')
        const prefix = segments[0]
        const existed = Object.prototype.hasOwnProperty.call(config, action.key)
        if (action.kind === 'add-config') {
          if (existed) continue
          added.push(action.key)
        } else {
          if (!existed) added.push(action.key)
          else if (JSON.stringify(config[action.key]) !== JSON.stringify(action.value)) {
            changed.push({ key: action.key, before: config[action.key], after: action.value })
          }
        }
        setAtPath(documentFor(prefix), segments.slice(1), action.value)
        config[action.key] = action.value
      }
      applied.push(String(step.from) + '->' + String(step.to))
    }

    for (const [prefix, document] of documents) {
      mkdirSync(join(staging, CONFIG_DIR), { recursive: true })
      writeFileSync(join(staging, CONFIG_DIR, prefix.split('.').join('/') + '.json'), JSON.stringify(document, null, 2) + '\n')
    }
    const pluginsChanged = JSON.stringify(plugins) !== JSON.stringify(before.plugins)
    if (pluginsChanged) changed.push({ key: PLUGINS_FILE, before: [...before.plugins], after: [...plugins] })
    writeFileSync(join(staging, PLUGINS_FILE), JSON.stringify({ plugins }, null, 2) + '\n')
    const version = readJsonFile(join(staging, VERSION_FILE)) as Record<string, unknown>
    writeFileSync(join(staging, VERSION_FILE), JSON.stringify({ ...version, layout: plan.to }, null, 2) + '\n')

    // The pre-commit hook sees the finished migration and the untouched root: throwing here is the
    // stand-in for a power cut between the two renames.
    options.beforeCommit?.()

    const staged = readState(staging)
    const afterLedger = ledgerHashes(staging, staged.ledger)
    const ledgerUnchanged = JSON.stringify(beforeLedger) === JSON.stringify(afterLedger)
    const pluginsKept = before.plugins.every((name) => staged.plugins.includes(name))
    const keysKept = Object.keys(before.config).every((key) => Object.prototype.hasOwnProperty.call(staged.config, key))
    const report: ApplyReport = {
      ok: ledgerUnchanged && pluginsKept && keysKept,
      reason: 'ok',
      from: plan.from,
      to: plan.to,
      applied,
      changed: [...changed].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
      added: [...added].sort(),
      preserved,
      ledgerUnchanged,
      rootUnchanged: options.dryRun === true,
      notes,
    }
    // A survival check that fails here is this engine writing the wrong thing — a defect, not a state
    // a caller could have refused. It throws rather than borrowing the plan's vocabulary for it.
    if (!ledgerUnchanged) throw new Error('applyMigration: the staging copy lost ledger bytes')
    if (!pluginsKept) throw new Error('applyMigration: the staging copy dropped a plugin')
    if (!keysKept) throw new Error('applyMigration: the staging copy dropped a configuration key')

    if (options.dryRun === true) return report

    // Three renames, not one: the root is moved aside, the staging is moved in, and the backup is
    // dropped. The window between them is the crash window `beforeCommit` stands in for, so the steps
    // stay separate even though each of them now tolerates one transient handle failure.
    let renameRetries = 0
    renameRetries += renameWithRetry(root, backup)
    try {
      renameRetries += renameWithRetry(staging, root)
      committed = true
    } catch (error) {
      renameWithRetry(backup, root)
      throw error
    }
    rmSync(backup, { recursive: true, force: true })
    return {
      ...report,
      notes: renameRetries === 0 ? notes : [...notes, 'retried:rename:' + String(renameRetries)],
      rootUnchanged: JSON.stringify(beforeTree) === JSON.stringify(hashTree(root)),
    }
  } finally {
    if (!committed) rmSync(staging, { recursive: true, force: true })
    if (committed && existsSync(backup)) rmSync(backup, { recursive: true, force: true })
  }
}
/**
 * Every plugin's declared kernel range, read from a real directory of plugins.
 *
 * The range logic is not reimplemented here: compat/kernel-range.ts owns it, and this only supplies
 * the directory. Two copies of a range rule would drift, and the copy that drifts is the one the
 * gate does not read.
 *
 * @param pluginsDir - a directory whose children are plugin packages.
 * @returns one row per plugin, with its range, the field that carried it, and the verdict.
 */
export function installedRangeRows(pluginsDir: string, options: KernelRangeOptions = {}) {
  const kernel = resolveRangeKernel(join(pluginsDir, 'node_modules'), options)
  return scanPluginRanges(pluginsDir, kernel.version)
}

/** The tail options of a range scan: the two later ladder levels, used only when the closure answers nothing. */
export interface KernelRangeOptions {
  /** The kernel checkout root, consulted when the closure cannot name a version. */
  readonly kernelRoot?: string
  /** The lockfile, consulted after the checkout root. */
  readonly lockFile?: string
}

/**
 * Resolve the kernel version a scan judges against: the closure first, then the caller's later two levels.
 *
 * The ladder itself lives in compat/kernel-range.ts and is asked in two steps on purpose: the later levels are
 * consulted ONLY when the closure yielded null. Handing them all over at once would let a stale lockfile outrank
 * the installation actually being judged, which is the one thing this order exists to prevent.
 * @param closureDir - the installation closure to read first.
 * @param options - the later levels and nothing else.
 * @returns the version and the source that answered.
 */
function resolveRangeKernel(closureDir: string, options: KernelRangeOptions): { version: string | null, source: string | null } {
  const fromClosure = resolveKernelVersion({ closureDir })
  if (fromClosure.version !== null) return { version: fromClosure.version, source: fromClosure.source }
  const later = resolveKernelVersion({ closureDir, kernelRoot: options.kernelRoot, lockFile: options.lockFile })
  return { version: later.version, source: later.source }
}

/**
 * The whole ladder reading, for a caller that needs the sources as well as the answer.
 * @param options - the closure, checkout root and lockfile to consult, in ladder order.
 * @returns what the ladder resolved, including which source answered and every source it tried.
 */
export function kernelVersionReportAt(options: { closureDir?: string, kernelRoot?: string, lockFile?: string }): KernelVersionResolution {
  return resolveKernelVersion(options)
}


/** The kernel's version from a real installation closure, or null when it cannot be read. */
function kernelVersionAtFromClosure(closureDir: string): string | null {
  return kernelVersionFromClosure(installedClosureVersions(closureDir))
}

/**
 * The kernel version this installation ships, read from its closure.
 * @param closureDir - a directory tree that contains the installed packages.
 * @returns the version, or null: a version that cannot be read is never guessed.
 */
export function kernelVersionAt(closureDir: string): string | null {
  return kernelVersionAtFromClosure(closureDir)
}

/** What a registry entry looks like once its range has been judged. */
export interface RangeVerdictEntry {
  /** True exactly when the verdict is not 'satisfied'. */
  readonly incompatible: boolean
  /** Non-empty for an incompatible entry: the verdict, the range, and the kernel it was judged against. */
  readonly reason: string | null
}

/**
 * Mark every plugin in a registry with the verdict its declared range produces.
 *
 * The registry's existing shape is preserved: \`plugins\` stays the string array the rest of this
 * module reads, and the verdicts are recorded alongside it, keyed by plugin name. A missing or
 * unparsable registry fails loudly instead of being created half-written — a registry this function
 * invented would be indistinguishable from one the user has.
 *
 * @param registryFile - the path of plugins.json.
 * @param pluginsDir - a directory whose children are plugin packages.
 * @param closureDir - a directory tree holding the installed closure.
 * @returns the registry as written.
 * @throws TypeError when the registry is missing or is not JSON with a plugins array.
 */
export function markRangeVerdicts(registryFile: string, pluginsDir: string, closureDir: string, options: KernelRangeOptions = {}): { plugins: readonly string[], verdicts: Record<string, RangeVerdictEntry> } {
  if (!existsSync(registryFile)) throw new TypeError('markRangeVerdicts: no registry at ' + registryFile)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(registryFile, 'utf8'))
  } catch (error) {
    throw new TypeError('markRangeVerdicts: registry is not JSON: ' + String((error as Error).message))
  }
  const registry = parsed as { plugins?: unknown }
  if (registry === null || typeof registry !== 'object' || !Array.isArray(registry.plugins)) {
    throw new TypeError('markRangeVerdicts: registry has no plugins array at ' + registryFile)
  }
  const kernel = resolveRangeKernel(closureDir, options)
  const kernelVersion = kernel.version
  const rows = scanPluginRanges(pluginsDir, kernelVersion)
  // Both directions are closed here: every name the registry lists gets a verdict, and a name only
  // the scan knows about is never added. An entry whose package.json cannot be read is the one that
  // most needs marking, so it is reported as unscannable rather than silently dropped.
  // The registry drives the result: every name it lists gets a verdict, and a name only the scan
  // knows about is never added. Resolution order is fixed because a directory name is the
  // registry's own key: a readable <pluginsDir>/<name>/package.json answers for that entry even when
  // other directories declare the same package name; a unique match by declared name is next; more
  // than one match is named as ambiguous rather than letting one entry overwrite another.
  const declaredNames = new Map<string, string[]>()
  for (const entry of readdirSync(pluginsDir).sort()) {
    // Only the read and the parse are tolerated here. Anything raised below is a defect in this
    // function rather than unreadable data, and a catch this wide would disguise it as bad data.
    let declaredManifest: { name?: unknown } | null = null
    try {
      declaredManifest = JSON.parse(readFileSync(join(pluginsDir, entry, 'package.json'), 'utf8')) as { name?: unknown }
    } catch {
      // A directory without a readable manifest is not a candidate; it is reported as unscannable.
    }
    if (declaredManifest !== null) {
      const declared = typeof declaredManifest.name === 'string' ? declaredManifest.name : entry
      declaredNames.set(declared, [...(declaredNames.get(declared) ?? []), entry])
    }
  }
  const verdicts: Record<string, RangeVerdictEntry> = {}
  for (const name of [...(registry.plugins as string[])].sort()) {
    let row: PluginRangeRow | undefined
    let reason: string | null = null
    const ownManifest = join(pluginsDir, name, 'package.json')
    if (existsSync(ownManifest)) {
      // Only the read and the parse may become unscannable. The judgement below is this function
      // own code: if it throws, that is a defect and it must be heard, not reported as bad JSON.
      let ownDocument: Record<string, unknown> | null = null
      try {
        ownDocument = JSON.parse(readFileSync(ownManifest, 'utf8')) as Record<string, unknown>
      } catch (error) {
        reason = 'unscannable: package.json under ' + ownManifest + ' is not JSON: ' + String((error as Error).message)
      }
      if (ownDocument !== null) {
        const declared = declaredRange(ownDocument)
        const verdict = declared.range === null ? 'no-range'
          : kernelVersion === null ? 'unknown-kernel' : verdictForRange(declared.range, kernelVersion)
        row = { plugin: typeof ownDocument.name === 'string' ? ownDocument.name : name, range: declared.range, source: declared.source, verdict }
      }
    }
    if (row === undefined && reason === null) {
      const sameName = rows.filter((candidate) => candidate.plugin === name)
      const dirs = declaredNames.get(name) ?? []
      if (sameName.length === 1) row = sameName[0]
      else if (sameName.length > 1 || dirs.length > 1) {
        reason = 'ambiguous: ' + Math.max(sameName.length, dirs.length) + ' directories declare ' + name + ' (' + dirs.join(', ') + ')'
      } else {
        reason = 'unscannable: no package.json under ' + join(pluginsDir, name)
      }
    }
    if (row === undefined) { verdicts[name] = { incompatible: true, reason: reason ?? 'unscannable' }; continue }
    const incompatible = row.verdict !== 'satisfied'
    verdicts[name] = {
      incompatible,
      reason: incompatible
        ? (row.verdict === 'unscannable'
          ? 'unscannable: no package.json under ' + join(pluginsDir, name)
          : row.verdict + ': range ' + String(row.range) + ' from ' + String(row.source) + ' against kernel ' + String(kernelVersion) + ' (from ' + String(kernel.source) + ')')
        : null,
    }
  }
  // Read-modify-write: every top-level key the registry already carried survives. Dropping them
  // would be a silent edit to a document this function does not own.
  const document = { ...(registry as Record<string, unknown>), plugins: [...(registry.plugins as string[])], verdicts }
  writeFileSync(registryFile, JSON.stringify(document, null, 1).replace(/\r\n/g, '\n') + '\n', 'utf8')
  return document
}

/**
 * Refuse a directory of plugins whose declared kernel range the installed kernel does not satisfy.
 *
 * Opt-in: nothing calls this unless a caller asks, so the migration path keeps the behaviour it had. Every
 * unsatisfied row is named, because "the batch was rejected" without the names is a diagnosis nobody can act on.
 * @param pluginsDir - the directory whose children are the plugins to judge.
 * @param options - the same tail options the scan takes.
 * @returns the rows it judged, when every one of them is satisfied.
 * @throws TypeError when the scan cannot be taken, or RangeError naming every unsatisfied plugin.
 */
export function assertRangesSatisfied(pluginsDir: string, options: KernelRangeOptions = {}): ReturnType<typeof installedRangeRows> {
  const rows = installedRangeRows(pluginsDir, options)
  const bad = rows.filter((row) => row.verdict !== 'satisfied')
  if (bad.length === 0) return rows
  const named = bad.map((row) => row.plugin + ' [range ' + String(row.range) + ' from ' + String(row.source) + '] -> ' + row.verdict)
  throw new RangeError('assertRangesSatisfied: ' + String(bad.length) + ' of ' + String(rows.length)
    + ' plugin(s) do not satisfy the installed kernel range: ' + named.join('; '))
}
// ---------------------------------------------------------------- EAC S2: a lock failure becomes a pending op

/** Where a state root keeps its pending operations. */
export const PENDING_DIR = '.ops'
/** The file inside it that holds the queue. */
export const PENDING_FILE = 'pending.json'
/** What a driver returns when the work was queued instead of done. */
export const LOCK_EXIT_CODE = 75

/** One operation that could not run because a lock was held. */
export interface PendingOp {
  /** The identity of the operation: re-queueing the same key is the same obligation, not a second one. */
  readonly key: string
  /** What kind of operation it is, for whatever resumes it. */
  readonly kind: string
  /** When it was queued. */
  readonly at: string
  /** Anything the resumer needs, already rendered. */
  readonly detail?: string
}

/**
 * Whether an error is a lock failure rather than a real one.
 *
 * Only EPERM and EBUSY count, including the Windows message that names the same condition as "(1175)". Anything
 * else - ENOSPC, a permission error that is not a lock - is a real failure, and calling it a lock would hide it.
 * @param error - the thrown value to judge.
 * @returns whether this is the lock condition the queue exists for.
 */
export function isLockFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code === 'EPERM' || code === 'EBUSY') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.indexOf('(1175)') !== -1
}

const pendingFilePath = (root: string): string => join(root, PENDING_DIR, PENDING_FILE)

/** The queue's one canonical form: keys sorted, LF endings, exactly one trailing newline. */
const pendingText = (ops: readonly PendingOp[]): string => {
  const sorted = [...ops].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
  return JSON.stringify(sorted, null, 1).replace(/\r\n/g, '\n') + '\n'
}

/**
 * Queue one operation, unless its key is already queued.
 * @param root - the state root the queue belongs to.
 * @param op - the operation to remember.
 * @returns whether it was added, and how many are queued afterwards.
 */
export function queuePendingOp(root: string, op: PendingOp): { queued: boolean, count: number } {
  const held = readPendingOps(root)
  if (held.some((row) => row.key === op.key)) return { queued: false, count: held.length }
  const next = [...held, op]
  mkdirSync(join(root, PENDING_DIR), { recursive: true })
  writeFileSync(pendingFilePath(root), pendingText(next), 'utf8')
  return { queued: true, count: next.length }
}

/**
 * Read the queue.
 * @param root - the state root the queue belongs to.
 * @returns the queued operations, or none when nothing was ever queued.
 * @throws TypeError when the file exists but is not a queue: an unreadable queue is not an empty one.
 */
export function readPendingOps(root: string): PendingOp[] {
  const path = pendingFilePath(root)
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new TypeError('readPendingOps: ' + path + ' is not JSON: ' + String((error as Error)?.message ?? error))
  }
  if (!Array.isArray(parsed)) throw new TypeError('readPendingOps: ' + path + ' does not hold an array of pending operations')
  return parsed as PendingOp[]
}

/**
 * Try every queued operation exactly once, keeping the ones that fail.
 * @param root - the state root the queue belongs to.
 * @param apply - called once per queued operation; a throw keeps that operation queued.
 * @returns how many were attempted, which succeeded, which failed, and how many are left.
 */
export function resumePendingOps(root: string, apply: (op: PendingOp) => void): { attempted: number, resumed: string[], failed: { key: string, error: string }[], remaining: number } {
  const held = readPendingOps(root)
  const resumed: string[] = []
  const failed: { key: string, error: string }[] = []
  let attempted = 0
  for (const op of held) {
    attempted += 1
    try {
      apply(op)
      resumed.push(op.key)
    } catch (error) {
      failed.push({ key: op.key, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const left = held.filter((op) => !resumed.includes(op.key))
  // An empty queue writes nothing: a resume that had nothing to do must leave no trace at all.
  if (attempted > 0) writeFileSync(pendingFilePath(root), pendingText(left), 'utf8')
  return { attempted, resumed, failed, remaining: left.length }
}

/** The inputs `startup` takes: the range gate, and the function that carries out one queued operation. */
export interface StartupOptions {
  /** Run the range check before the queue is touched. Off unless asked, like the migration gate. */
  readonly enforceKernelRange?: boolean
  /** What `enforceKernelRange` judges: which plugins, and the later ladder levels for the kernel version. */
  readonly kernelRange?: {
    readonly pluginsDir: string
    readonly closureDir?: string
    readonly kernelRoot?: string
    readonly lockFile?: string
  }
  /** How one queued operation is carried out. Without it a non-empty queue is refused, never drained. */
  readonly applyOp?: (op: PendingOp) => void
}

/** What one `startup` did: which kernel it resolved, and what the queue did. */
export interface StartupReport {
  /** The ladder reading for `kernelRange`, or null when no kernelRange was given. */
  readonly kernel: KernelVersionResolution | null
  /** The resume counts, exactly as `resumePendingOps` reports them. */
  readonly pending: { attempted: number, resumed: string[], failed: { key: string, error: string }[], remaining: number }
}

/**
 * Start an installation: refuse first, then resume.
 *
 * Both machines this calls were written and tested before they had a single caller, and the order
 * between them is the whole point. A plugin set the installed kernel cannot serve is refused BEFORE
 * the queue is read, so a refusal cannot have half-resumed anything: the root the caller is told to
 * fix is the root it had. Reading the queue second is what makes that true by construction rather
 * than by cleanup.
 *
 * The queue is never drained silently. It exists to hold work that has to happen, so an empty
 * `applyOp` beside a non-empty queue is a caller that forgot to say HOW, not an instruction to
 * forget the work: it is refused, by name and with the count, and the queue file is left untouched.
 * An empty queue with no `applyOp` is the one quiet case, because there is nothing to lose and
 * `attempted` says so.
 *
 * @param root - the state root whose queue is to be resumed.
 * @param options - the range gate and the resumer; both off unless given.
 * @returns the kernel reading and the resume counts.
 * @throws TypeError when the range gate is on without a plugin directory, or when the queue is not
 * empty and no `applyOp` was given.
 * @throws RangeError when the range gate is on and a plugin declares a range the kernel does not satisfy.
 */
export function startup(root: string, options: StartupOptions = {}): StartupReport {
  // Leg one: the refusal, before anything else touches the root.
  if (options.enforceKernelRange === true) {
    const range = options.kernelRange
    if (range === undefined || typeof range.pluginsDir !== 'string' || range.pluginsDir === '') {
      throw new TypeError('startup: enforceKernelRange is on but kernelRange.pluginsDir is missing: give the plugin directory to check, or turn the flag off')
    }
    assertRangesSatisfied(range.pluginsDir, { closureDir: range.closureDir, kernelRoot: range.kernelRoot, lockFile: range.lockFile })
  }
  const range = options.kernelRange
  const kernel = range === undefined
    ? null
    : kernelVersionReportAt({ closureDir: range.closureDir, kernelRoot: range.kernelRoot, lockFile: range.lockFile })
  // Leg two: the queue is read only now that the gate has passed.
  const held = readPendingOps(root)
  const applyOp = options.applyOp
  if (held.length > 0 && typeof applyOp !== 'function') {
    throw new TypeError('startup: ' + String(held.length) + ' pending operation(s) at ' + pendingFilePath(root) + ' but options.applyOp is not a function: supply one to resume them, or empty the queue knowingly')
  }
  if (typeof applyOp !== 'function') {
    return { kernel, pending: { attempted: 0, resumed: [], failed: [], remaining: held.length } }
  }
  // The resume itself is the existing machine, called rather than copied: a second implementation
  // would be the one that drifts, and the gate reads the first.
  return { kernel, pending: resumePendingOps(root, applyOp) }
}


