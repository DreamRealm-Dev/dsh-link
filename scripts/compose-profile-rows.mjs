#!/usr/bin/env node
/**
 * Compose a DSH profile's patch layers and report the row ids that more than one layer claims.
 *
 * A profile is composed as: one patch list per bundle in `dsh.profile.bundles` order, then
 * the profile's own `cordis.patch.yml`, then any `--patch` overlay. Rows are keyed by id and a
 * later layer replaces supplied fields wholesale, so a row id claimed twice means the earlier
 * claim's `config` never reaches the plugin. This report names those ids, their layer order,
 * and which claim wins.
 *
 * Row parsing is `readPatchFile` from ./read-composition-rows.mjs (one file's rows); this script
 * owns layer order, id contention, and the sources it cannot see.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPatchFile } from './read-composition-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const LIVE_PROFILE = 'C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/kernel-home/profiles/web'
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const DEFAULT_OUT = join(REPO, 'compat/adaptation/rows/profile-composition.json')
const FORMAT = 'dsh-link.profile-composition/1'

/** @param {unknown} value @returns {string[]} the declared patch paths, string and array forms alike. */
function patchPaths(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string')
  return []
}

/** @param {string} file @returns {string} sha256 of the file's bytes, or a miss marker. */
function digestOf(file) {
  if (!existsSync(file)) return 'missing'
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
}

/** @param {string} file @returns {string} the path with every junction and symlink resolved, when the filesystem allows. */
function realOf(file) {
  try { return realpathSync(file) } catch { return resolve(file) }
}

/**
 * Whether a layer file lives inside this repository.
 *
 * A live profile reaches the repository through links: `<profile>/node_modules/dsh-agent-context` is a
 * junction to `plugins/dsh-agent-context`, so the file the reader opens is repository-derived even
 * though the path it was found at is the machine's. Resolving the real path is what separates an input
 * this repository owns from one the machine owns, and only the first kind may make a gate red: the app
 * rewrites its own profile patch at will (R40 and R43 both measured that).
 *
 * @param {string} file - a layer file path.
 * @returns true when the file's real location is under the repository root.
 */
function underRepo(file) {
  const real = realOf(file).replace(/\\/g, '/').toLowerCase()
  const root = realOf(REPO).replace(/\\/g, '/').toLowerCase()
  return real === root || real.startsWith(root + '/')
}

/**
 * The report as a gate compares it: live-machine inputs stay recorded but leave the criterion.
 *
 * @param {Record<string, any>} report - a composition report.
 * @returns the report text with the live section emptied and live layer files dropped.
 */
export function stableText(report) {
  const stable = { ...report, liveDigest: null, liveInputs: [] }
  stable.layers = (report.layers ?? []).map((layer) => ({ ...layer, files: layer.files.filter((file) => file.origin === 'repo') }))
  return JSON.stringify(stable, null, 1) + String.fromCharCode(10)
}

/**
 * Read one record of readPatchFile's rows.
 *
 * @param {any} row - one record; `origin` says whether it is an entry a `insert:` list carries
 *   (`insert-child`) or a top-level row of the patch list (`row`).
 * @returns {{kind: 'insert'|'field'|'insert-parent'|'unreadable', id: string|null, hasConfig: boolean}}
 */
function shapeOf(row) {
  const hasConfig = Array.isArray(row.keys) && row.keys.includes('config')
  if (row.origin === 'insert-child') return { kind: 'insert', id: typeof row.id === 'string' ? row.id : null, hasConfig }
  if (row.origin === 'row') {
    // Only the row that carries the `insert` key adds entries; its own id is absent, while a
    // field-replacement row also carries `config` and must not be mistaken for one.
    if (Array.isArray(row.keys) && row.keys.includes('insert')) return { kind: 'insert-parent', id: null, hasConfig }
    return { kind: typeof row.id === 'string' ? 'field' : 'unreadable', id: typeof row.id === 'string' ? row.id : null, hasConfig }
  }
  return { kind: 'unreadable', id: null, hasConfig }
}

/**
 * The repository's own kernel roots: one list, read by the default call of kernelRoster().
 *
 * @type {Array<{origin: 'workspace' | 'app' | 'vendor', at: string}>}
 */
export const DEFAULT_ROOTS = [
  { origin: 'workspace', at: join(KERNEL, 'packages') },
  { origin: 'app', at: join(KERNEL, 'apps') },
  { origin: 'vendor', at: join(KERNEL, 'vendor') },
]

/**
 * Every package the kernel itself carries: its workspace packages, its application packages and its
 * vendored framework packages.
 *
 * Enumerated, never listed. `packages/<group>/<pkg>/package.json` and `vendor/<pkg>/package.json` are read
 * out of the tree, so a vendored framework package (cordis, schemastery, and the other seven under
 * vendor/) counts as host-provided exactly as a workspace one does. Naming the vendor packages here was
 * the hole R50 closed: a module the host loads but this roster did not know about read as one the plugin
 * had to declare for itself.
 *
 * @param {Array<{origin: 'workspace' | 'app' | 'vendor', at: string}>} roots - the roots to read. The
 *   default is the repository's own list and is the only such list; the parameter exists so a gate can
 *   point the same scan at a staged tree and see the three sources counted, and it adds no second branch.
 * @returns {Map<string, {origin: 'workspace' | 'app' | 'vendor', dir: string, exports: any, client: any}>} name
 *   to where the kernel carries it: `packages/<group>/<pkg>` (workspace), `apps/<pkg>` (app),
 *   `vendor/<pkg>` (vendor). Every consumer in the repository reads this one roster; there is no second scan.
 */
export function kernelRoster(roots = DEFAULT_ROOTS) {
  const roster = new Map()
  for (const root of roots) {
    if (!existsSync(root.at)) continue
    for (const entry of readdirSync(root.at, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const nested = join(root.at, entry.name)
      // One shape for every root: a package sits either directly under it (vendor/cordis, apps/web) or one
      // level further (packages/client/locale). Both are read, so this stays the repository's only scan.
      const candidates = existsSync(join(nested, 'package.json'))
        ? [nested]
        : readdirSync(nested, { withFileTypes: true }).filter((child) => child.isDirectory()).map((child) => join(nested, child.name))
      for (const dir of candidates) {
        const manifest = join(dir, 'package.json')
        if (!existsSync(manifest)) continue
        try {
          const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
          if (typeof parsed.name === 'string') {
            // exports and dsh.client travel with the record: a consumer that needs them would otherwise
            // open the manifest again, which is how a second scan starts.
            roster.set(parsed.name, { dir, origin: root.origin, exports: parsed.exports ?? null, client: parsed.dsh?.client ?? null })
          }
        } catch {
          // A manifest that is not JSON names no package; the roster records what it could read.
        }
      }
    }
  }
  return roster
}

/**
 * Find a bundle package outside the profile.
 *
 * The kernel's own bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) are not installed
 * under the profile's node_modules: the CLI composes them from its own tree, so a profile-only
 * lookup reports them missing and silently drops every row they contribute.
 *
 * @returns {(name: string) => string | null} resolver over the kernel workspace and vendored manifests.
 */
export function kernelPackages() {
  const roster = kernelRoster()
  return (name) => roster.get(name)?.dir ?? null
}

/** @param {string} profileDir @returns {Promise<{layers: any[], limits: string[]}>} ordered layers. */
async function readLayers(profileDir) {
  const limits = []
  const manifest = join(profileDir, 'package.json')
  if (!existsSync(manifest)) throw new Error(`no profile manifest at ${manifest}`)
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  const bundles = parsed?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error(`${manifest} declares no dsh.profile.bundles array`)
  const layers = []
  const resolveFromKernel = kernelPackages()
  bundles.forEach((name, index) => {
    let packageJson = join(profileDir, 'node_modules', name, 'package.json')
    let origin = 'profile'
    if (!existsSync(packageJson)) {
      const fromKernel = resolveFromKernel(name)
      if (fromKernel === null) {
        limits.push(`bundle ${name} is declared but not found in profile node_modules or the kernel workspace: its rows are absent from this report`)
        layers.push({ index, kind: 'bundle', name, packageJson, files: [], missing: true })
        return
      }
      packageJson = join(fromKernel, 'package.json')
      origin = 'kernel'
    }
    const meta = JSON.parse(readFileSync(packageJson, 'utf8'))
    const declared = patchPaths(meta?.dsh?.bundle?.patch)
    if (declared.length === 0) limits.push(`bundle ${name} declares no dsh.bundle.patch: it contributes no rows here`)
    const packageDir = dirname(packageJson)
    const files = declared.map(rel => ({ declared: rel, path: resolve(packageDir, rel), exists: existsSync(resolve(packageDir, rel)) }))
    for (const file of files) if (!file.exists) limits.push(`bundle ${name} declares patch ${file.declared} which does not exist at ${file.path}`)
    layers.push({ index, kind: 'bundle', name, packageJson, resolvedFrom: origin, files, missing: false })
  })
  const profilePatch = join(profileDir, 'cordis.patch.yml')
  layers.push({
    index: bundles.length, kind: 'profile', name: 'cordis.patch.yml',
    files: [{ declared: 'cordis.patch.yml', path: profilePatch, exists: existsSync(profilePatch) }],
    missing: !existsSync(profilePatch),
  })
  if (!existsSync(profilePatch)) limits.push(`no profile layer at ${profilePatch}`)
  limits.push('Home and command-line overlays are not read: they apply after the profile layer and can replace any claim below.')
  limits.push('A row target is matched by id text alone; whether the id is reached at runtime (group nesting, disabled carriers, !!js) is not evaluated.')
  return { layers, limits }
}

/** @param {any[]} layers @returns {Promise<any>} id index over every layer's rows. */
async function indexIds(layers) {
  const rowsTotal = { read: 0, unreadable: 0, withoutId: 0 }
  const ids = new Map()
  const mention = (id, entry) => {
    const list = ids.get(id) ?? []
    list.push(entry)
    ids.set(id, list)
  }
  for (const layer of layers) {
    for (const file of layer.files) {
      if (!file.exists) continue
      const parsed = await readPatchFile(file.path)
      file.coverage = parsed.coverage
      file.parserWarnings = parsed.warnings.length
      for (const row of parsed.rows) {
        rowsTotal.read += 1
        const { kind, id, hasConfig } = shapeOf(row)
        rowsTotal[kind === 'unreadable' ? 'unreadable' : kind] = (rowsTotal[kind === 'unreadable' ? 'unreadable' : kind] ?? 0) + 1
        if (kind === 'unreadable' || kind === 'insert-parent') continue
        if (id === null) {
          rowsTotal.withoutId += 1
          continue
        }
        mention(id, { layerIndex: layer.index, layer: layer.name, file: file.path, line: row.line, kind, hasConfig })
      }
    }
  }
  const out = []
  for (const [id, mentions] of ids) {
    const ordered = [...mentions].sort((left, right) => left.layerIndex - right.layerIndex || left.line - right.line)
    const winner = ordered[ordered.length - 1]
    const flags = []
    if (ordered.length > 1) flags.push('contested')
    if (ordered.filter(item => item.kind === 'insert').length > 1) flags.push('duplicateInsert')
    if (ordered.some(item => item.kind === 'field') && !ordered.some(item => item.kind === 'insert')) flags.push('orphanTarget')
    // An earlier claim whose config the winner replaces wholesale (document.ts:29). Normal for an
    // intentional override, and a silent field loss when the earlier author expected the value to survive.
    const superseded = ordered.filter(item => item !== winner && item.hasConfig)
    if (superseded.length > 0) flags.push('configSuperseded')
    out.push({ id, flags, winner, supersededConfigLayers: superseded.map(item => ({ layer: item.layer, file: item.file, line: item.line })), mentions: ordered })
  }
  out.sort((left, right) => left.id < right.id ? -1 : 1)
  return { ids: out, rowsTotal }
}

/** @param {{ids: any[], rowsTotal: any, layers: any[], limits: string[]}} input @returns {Record<string, any>} */
function countOf(input) {
  const flags = ['contested', 'duplicateInsert', 'orphanTarget', 'configSuperseded']
  const counts = { rowsRead: input.rowsTotal.read, rowsUnreadable: input.rowsTotal.unreadable, rowsWithoutId: input.rowsTotal.withoutId, ids: input.ids.length, flagged: input.ids.filter(item => item.flags.length > 0).length }
  for (const flag of flags) counts[flag] = input.ids.filter(item => item.flags.includes(flag)).length
  return counts
}

/** @param {string} profileDir @returns {Promise<Record<string, any>>} the whole report. */
export async function analyzeProfile(profileDir) {
  const { layers, limits } = await readLayers(profileDir)
  const indexed = await indexIds(layers)
  const files = layers.flatMap(layer => layer.files.map(file => ({ path: file.path, declared: file.declared, exists: file.exists, digest: digestOf(file.path), origin: underRepo(file.path) ? 'repo' : 'live' })))
  const repoFiles = files.filter(file => file.origin === 'repo')
  const liveFiles = files.filter(file => file.origin === 'live')
  const sourceDigest = createHash('sha256').update(JSON.stringify(repoFiles)).digest('hex')
  const liveDigest = createHash('sha256').update(JSON.stringify(liveFiles)).digest('hex')
  return {
    format: FORMAT,
    note: 'Derived from one machine\u2019s live profile, which is not in this repository. sourceDigest folds only the layer files whose real path is inside this repository (a bundle reached through a junction into plugins/ counts here, so a repository change moves it); liveDigest folds the inputs this machine owns — the profile\u2019s own cordis.patch.yml and bundles installed outside the repository — and is recorded rather than gated, because the app rewrites its own profile patch (R40, R43). --check compares the report without the live section.'  ,
    sourceDigestIs: 'repository-derived layer files only',
    liveDigestIs: 'the machine\u2019s own profile patch and out-of-repository bundles: recorded, never a gate criterion',
    profileDir,
    bundles: layers.filter(layer => layer.kind === 'bundle').map(layer => layer.name),
    layers: layers.map(layer => ({
      index: layer.index, kind: layer.kind, name: layer.name, missing: layer.missing,
      files: layer.files.map(file => ({ declared: file.declared, path: file.path, exists: file.exists, digest: digestOf(file.path), origin: underRepo(file.path) ? 'repo' : 'live' })),
    })),
    counts: countOf({ ...indexed, layers, limits }),
    ids: indexed.ids,
    limits,
    sourceDigest,
    liveDigest,
    liveInputs: liveFiles,
  }
}

/** Build a throwaway profile whose shapes are known, then require the analysis to name them. */
async function selfTest() {
  const root = join(REPO, '.tmp', 'row-compose-selftest', String(process.pid))
  const profileDir = join(root, 'profiles', 'web')
  const write = (rel, text) => { const file = join(profileDir, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  rmSync(root, { recursive: true, force: true })
  try {
    write('package.json', JSON.stringify({ dsh: { profile: { bundles: ['bundle-early', 'bundle-late'] } } }))
    write('node_modules/bundle-early/package.json', JSON.stringify({ name: 'bundle-early', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    write('node_modules/bundle-early/cordis.patch.yml', [
      '- insert:',
      '    - id: shared',
      '      name: bundle-early',
      '      config:',
      '        k: dead',
      '    - id: only-early',
      '      name: bundle-early-helper',
      '',
    ].join('\n'))
    write('node_modules/bundle-late/package.json', JSON.stringify({ name: 'bundle-late', dsh: { bundle: { patch: ['./cordis.patch.yml'] } } }))
    write('node_modules/bundle-late/cordis.patch.yml', [
      '- insert:',
      '    - id: shared',
      '      name: bundle-late',
      '',
    ].join('\n'))
    write('cordis.patch.yml', [
      '- id: shared',
      '  name: bundle-late',
      '  config:',
      '    k: live',
      '- id: nowhere',
      '  name: absent-everywhere',
      '  config:',
      '    k: orphan',
      '',
    ].join('\n'))
    const report = await analyzeProfile(profileDir)
    const byId = new Map(report.ids.map(item => [item.id, item]))
    const checks = [
      ['shared is contested', byId.get('shared')?.flags.includes('contested') === true],
      ['shared is inserted twice', byId.get('shared')?.flags.includes('duplicateInsert') === true],
      ['shared has a config the winner replaces wholesale', byId.get('shared')?.flags.includes('configSuperseded') === true],
      ['nowhere is an orphan target', byId.get('nowhere')?.flags.includes('orphanTarget') === true],
      ['the profile layer wins shared', byId.get('shared')?.winner.layer === 'cordis.patch.yml'],
      ['only-early carries no flag', byId.get('only-early')?.flags.length === 0],
      ['three ids were found', report.counts.ids === 3],
      // R50: the roster must carry the vendored framework packages too, and it must say so by enumerating
      // the vendor directory rather than by matching a list written here.
      ['the roster holds every vendored kernel package', (() => {
        const vendorRoot = join(KERNEL, 'vendor')
        if (!existsSync(vendorRoot)) return false
        const dirs = readdirSync(vendorRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        const seen = [...kernelRoster().values()].filter((entry) => entry.origin === 'vendor').map((entry) => entry.dir.split(/[\\/]/).pop())
        return dirs.length > 0 && dirs.every((dir) => seen.includes(dir))
      })()],
    ]
    let failed = 0
    for (const [what, held] of checks) {
      console.log(`  ${held ? 'ok  ' : 'FAIL'} ${what}`)
      if (!held) failed += 1
    }
    console.log(`self-test: ${checks.length - failed}/${checks.length} held`)
    return failed === 0
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit((await selfTest()) ? 0 : 1)
  const at = argv.indexOf('--profile-dir')
  const profileDir = at === -1 ? LIVE_PROFILE : argv[at + 1]
  const outAt = argv.indexOf('--out')
  const out = outAt === -1 ? DEFAULT_OUT : argv[outAt + 1]
  const report = await analyzeProfile(profileDir)
  const text = JSON.stringify(report, null, 1) + '\n'
  if (argv.includes('--check')) {
    if (!existsSync(out)) {
      console.log(`FAIL  no committed report at ${out}`)
      process.exit(1)
    }
    const committed = readFileSync(out, 'utf8')
    let committedReport = null
    try { committedReport = JSON.parse(committed) } catch { committedReport = null }
    // The criterion is the repository-derived half. The live half is printed when it moves, because a
    // reader wants to know the machine changed under the report, and never fails the gate for it.
    const same = committedReport !== null && stableText(committedReport) === stableText(report)
    const committedLive = committedReport?.liveInputs ?? []
    const moved = committedLive.filter((file) => (report.liveInputs.find((other) => other.path === file.path)?.digest ?? null) !== file.digest)
    const added = report.liveInputs.filter((file) => committedLive.some((other) => other.path === file.path) === false)
    if (!same) {
      console.log('FAIL  the committed composition report no longer describes the profile layers')
      console.log(`      committed sourceDigest ${committedReport === null ? '(unreadable)' : committedReport.sourceDigest}`)
      console.log(`      derived   sourceDigest ${report.sourceDigest}`)
      process.exit(1)
    }
    if (moved.length + added.length > 0) {
      console.log(`      live inputs changed: ${moved.length + added.length} file(s) (the app rewrites its own profile patch): ` + [...moved, ...added].map((file) => file.path.split('/').slice(-2).join('/')).join(', '))
      console.log('      recorded in liveDigest; not part of the --check criterion')
    }
    console.log(`PASS  ${out} matches ${report.counts.ids} ids over ${report.counts.rowsRead} rows (${report.liveInputs.length} live input(s) recorded)`)
    return
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
  console.log(`wrote ${out}: ${report.counts.ids} ids, ${report.counts.contested} contested, ${report.counts.configSuperseded} whose earlier config the winner replaces wholesale, ${report.counts.orphanTarget} orphan targets`)
  for (const id of report.ids.filter(item => item.flags.includes('configSuperseded'))) {
    console.log(`  ${id.id}: winner ${id.winner.layer}:${id.winner.line}; superseded config at ${id.supersededConfigLayers.map(layer => layer.layer + ':' + layer.line).join(', ')}`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main()
}
