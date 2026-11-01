#!/usr/bin/env node
/**
 * One page per external plugin: what taking it into this profile would require.
 *
 * It joins the three things this project measures separately — where the plugin's code touches the
 * kernel (call-site analysis), which rows the plugin's own bundle patch contributes (row reading),
 * and what the live profile does to those rows (layer composition) — into the rewrite items an
 * adapter author has to handle. It deliberately states no overall "usable" verdict: a plugin is a
 * list of concrete items, and an item whose evidence is missing stays in `unknown`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'
import { patchFilesOf, readPatch } from './read-composition-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const TARGETS = join(REPO, 'compat/adaptation/usage-targets.json')
const COMPOSITION = join(REPO, 'compat/adaptation/rows/profile-composition.json')
const RESOLUTION = join(REPO, 'compat/adaptation/import-resolution.json')
const CLIENT_PLANE = join(REPO, 'compat/adaptation/client-plane.json')
const DRIFT = join(REPO, 'compat/adaptation/name-drift.json')
const SURFACE_DIR = join(REPO, 'compat/surface')
// cordis v3 lifecycle listeners. cordis v4 declares only internal/* events (vendor/cordis/src/events.ts:329-352)
// and runs teardown through ctx.effect, so a listener registered for one of these never fires.
const CORDIS_LIFECYCLE = new Set(['dispose', 'ready', 'fork', 'connect', 'disconnect'])
const OUT = join(REPO, 'compat/adaptation/port-verdicts.json')
const FORMAT = 'dsh-link.port-verdicts/1'

/** @param {string} dir @returns {string|null} the id a plugin compares against its own settings namespace. */
function selfEntryId(dir) {
  const files = []
  const walk = (at) => {
    for (const item of readdirSync(at, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name.startsWith('.')) continue
      const path = join(at, item.name)
      if (item.isDirectory()) walk(path)
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(item.name)) files.push(path)
    }
  }
  walk(dir)
  for (const file of files) {
    const match = /ENTRY_ID\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(file, 'utf8'))
    if (match !== null) return { id: match[1], file: file.slice(dir.length + 1) }
  }
  return null
}

/** @param {string} text @returns {{parts: number[], pre: string|null}|null} */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (match === null) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
}

/** @param {any} left @param {any} right @returns {number} semver order, prerelease below its release. */
function compare(left, right) {
  for (let index = 0; index < 3; index += 1) if (left.parts[index] !== right.parts[index]) return left.parts[index] < right.parts[index] ? -1 : 1
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre < right.pre ? -1 : 1
}

/**
 * Whether one version falls inside one range, over the forms these plugins declare.
 *
 * @param {string} version - the version to place.
 * @param {string} range - comparators joined by spaces (all must hold) and by `||` (any alternative).
 * @returns {boolean|null} null when the range uses a form this checker does not implement, which the
 *   caller reports as unknown rather than as a pass.
 */
function satisfies(version, range) {
  const at = parseVersion(version)
  if (at === null) return null
  for (const alternative of range.split('||')) {
    const parts = alternative.trim().split(/\s+/).filter(part => part !== '')
    if (parts.length === 0) return null
    let held = true
    for (const part of parts) {
      const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(part)
      const operator = match[1] ?? '='
      const bound = parseVersion(match[2])
      if (bound === null) return null
      const order = compare(at, bound)
      if (operator === '>=') held = held && order >= 0
      else if (operator === '<=') held = held && order <= 0
      else if (operator === '>') held = held && order > 0
      else if (operator === '<') held = held && order < 0
      else if (operator === '=') held = held && order === 0
      else if (operator === '~') held = held && order >= 0 && compare(at, { parts: [bound.parts[0], bound.parts[1] + 1, 0], pre: null }) < 0
      else {
        const ceiling = bound.parts[0] > 0 ? [bound.parts[0] + 1, 0, 0]
          : bound.parts[1] > 0 ? [0, bound.parts[1] + 1, 0] : [0, 0, bound.parts[2] + 1]
        held = held && order >= 0 && compare(at, { parts: ceiling, pre: null }) < 0
      }
    }
    if (held) return true
  }
  return false
}

/** @param {any} composition @param {string} dir @param {string[]} ids @returns {any[]} superseded claims inside dir. */
function supersededFor(composition, dir, ids) {
  const out = []
  for (const entry of composition.ids ?? []) {
    if (!ids.includes(entry.id)) continue
    for (const layer of entry.supersededConfigLayers ?? []) {
      const normalize = (value) => value.replace(/\\/g, '/').toLowerCase()
      if (normalize(layer.file).startsWith(normalize(dir))) out.push({ id: entry.id, ...layer, winner: entry.winner })
    }
  }
  return out
}

/**
 * The source line a usage was recorded at, so an "absent" claim carries what the code actually does.
 *
 * @param {string} dir - the plugin package directory.
 * @param {string} at - the record's `file:line`, with the analyzer's optional `client ` plane prefix.
 * @returns {string|null} the trimmed line, or null when it cannot be read.
 */
function lineAt(dir, at) {
  if (typeof at !== 'string') return null
  const cleaned = at.startsWith('client ') ? at.slice(7) : at
  const cut = cleaned.lastIndexOf(':')
  if (cut === -1) return null
  const path = join(dir, cleaned.slice(0, cut))
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const text = lines[Number(cleaned.slice(cut + 1)) - 1]
  return text === undefined ? null : text.trim().slice(0, 140)
}

/**
 * Whether the drift table can pay for a name this kernel no longer carries.
 *
 * @param {any} drift - the parsed name-drift table.
 * @param {string} kind - `service` or `event`.
 * @param {string} name - the name as the plugin wrote it.
 * @returns {{coverage: string, detail: string}} what the table says.
 */
function driftCoverage(drift, kind, name) {
  const rows = [...(drift.kept ?? []), ...(drift.unsupported ?? [])].filter(row => row.kind === kind && row.name === name)
  if (rows.length === 0) return { coverage: 'no-row', detail: 'the drift table has no row for it, so the bridge has nothing to substitute' }
  const kept = rows.filter(row => (drift.kept ?? []).includes(row))
  if (kept.length > 0) return { coverage: 'kept', detail: `the drift table keeps it as ${JSON.stringify(kept[0].to ?? 'unchanged')}` }
  return { coverage: 'unsupported', detail: 'the drift table records it as unsupported with no candidate' }
}

/**
 * Which layer has to answer for a name this kernel does not carry.
 *
 * A DSH surface name belongs to the drift table; a cordis lifecycle name belongs to the framework
 * axis, which the drift table does not cover; anything else is the plugin's own optional
 * dependency. Without this split every absence looks like the same kind of problem.
 *
 * @param {string} kind - `service` or `event`.
 * @param {string} name - the name the plugin wrote.
 * @param {any} drift - the parsed drift table.
 * @param {any[]} surfaces - every archived surface document.
 * @returns {{axis: string, detail: string}} the axis and why.
 */
function absenceAxis(kind, name, drift, surfaces) {
  const rows = [...(drift.kept ?? []), ...(drift.unsupported ?? []), ...(drift.refusals ?? [])].filter(row => row.kind === kind && row.name === name)
  if (rows.length > 0) return { axis: 'dsh-surface', detail: 'the drift table carries this name' }
  // A surface document carries its event list under `events` in the archived captures; a document
  // that carries a count there instead is skipped rather than read as a list.
  const archived = surfaces.filter(surface => kind === 'service'
    ? (surface.services ?? {})[name] !== undefined
    : Array.isArray(surface.events) && surface.events.some(event => (typeof event === 'string' ? event : event?.name) === name))
  if (archived.length > 0) return { axis: 'dsh-surface-retired', detail: `an archived surface (kernel ${archived.map(surface => surface.kernel?.version ?? '?').join(', ')}) carried it, the drift table does not` }
  if (kind === 'event' && CORDIS_LIFECYCLE.has(name)) return { axis: 'framework-lifecycle', detail: 'cordis v3 lifecycle listener: cordis v4 declares only internal/* events (vendor/cordis/src/events.ts:329-352) and runs teardown through ctx.effect, so this listener never fires; the drift table covers DSH surface names, not the framework axis' }
  return { axis: 'plugin-optional', detail: 'no archived DSH surface and no drift row carries this name, so it is the plugin\u2019s own optional dependency' }
}

/** @param {any} target @param {any} composition @param {any} resolution @param {any} clientPlane @param {any} drift @param {any[]} surfaces @returns {any} one plugin's item list. */
function verdictOf(target, composition, resolution, clientPlane, drift, surfaces) {
  const dir = target.dir
  const items = []
  const unknown = []
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const declared = Object.entries({ ...manifest.peerDependencies ?? {}, ...manifest.engines?.dsh === undefined ? {} : { '@deepseek-ai/dsh': manifest.engines.dsh } })
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  const excludedPeers = []
  for (const [name, range] of declared) {
    const inside = satisfies(target.kernelVersion, range)
    if (inside === true) continue
    if (inside === null) unknown.push(`peer ${name}: "${range}" uses a form this checker does not implement, so it is not judged`)
    else excludedPeers.push({ name, range })
  }
  if (excludedPeers.length > 0) {
    // One item per plugin, not one per peer: a plugin with a fourteen-package peer set would
    // otherwise bury every other finding under identical lines.
    items.push({
      category: 'peer-range-excludes-kernel', severity: 'rewrite',
      detail: `${excludedPeers.length} declared peer/engine range(s) exclude this kernel (${excludedPeers.slice(0, 3).map(peer => peer.name + ' ' + peer.range).join('; ')}${excludedPeers.length > 3 ? `; + ${excludedPeers.length - 3} more listed under peers` : ''}) and this kernel is ${target.kernelVersion}: installing asks for an explicit exemption (dsh plugin allow-version ${target.name}@${target.version})`,
      peers: excludedPeers,
      evidence: 'package.json peerDependencies/engines.dsh plus kernel.lock.json packageVersion',
    })
  }
  const usage = analyze(dir)
  const counts = usage.counts ?? {}
  // Every absent name gets its own item carrying the call site, the drift table's answer, and the
  // line itself: a name-level absence says nothing about whether the plugin still works without it.
  for (const entry of usage.usages ?? []) {
    if (entry.classification !== 'absent' && entry.classification !== 'loss') continue
    const coverage = driftCoverage(drift, entry.kind, entry.name)
    const axis = absenceAxis(entry.kind, entry.name, drift, surfaces)
    items.push({
      category: entry.classification === 'loss' ? 'host-callsite-lost' : 'host-callsite-absent',
      severity: 'rewrite',
      name: entry.name, kind: entry.kind, driftCoverage: coverage.coverage, axis: axis.axis,
      detail: `${entry.kind} ${entry.name} is ${entry.classification === 'loss' ? 'known-lost' : 'not in the 0.2.1 surface'}; axis: ${axis.axis} (${axis.detail}); drift table: ${coverage.coverage} (${coverage.detail}); first call site ${(entry.at ?? [])[0] ?? 'unknown'}: ${lineAt(dir, (entry.at ?? [])[0]) ?? 'line not read'}`,
      evidence: 'compat/adaptation/name-drift.json + compat/surface/* + the plugin source line',
    })
  }
  const files = patchFilesOf(dir)
  const rows = files.flatMap(file => readPatch(file).rows)
  const insertIds = []
  for (const file of files) {
    for (const row of readPatch(file).rows) {
      if (row.origin === 'insert-child' && typeof row.id === 'string') insertIds.push({ id: row.id, file, line: row.line, hasConfig: row.keys.includes('config') })
      if (Array.isArray(row.unknownKeys) && row.unknownKeys.length > 0) {
        items.push({ category: 'row-unknown-metadata-key', severity: 'rewrite', detail: `${row.unknownKeys.join(', ')} at ${row.file.split('/').slice(-1)[0]}:${row.line} is not entry metadata the 0.2.1 loader reads`, evidence: row.evidence })
      }
    }
  }
  for (const [plane, count] of Object.entries(counts)) {
    if (count === 0) continue
    // absent/loss are enumerated per name above, with their call sites and drift coverage.
    if (plane === 'absent' || plane === 'loss') continue
    if (plane === 'client-plane') {
      const client = (clientPlane.plugins ?? []).find(entry => entry.name === target.name)
      const absent = (client?.rows ?? []).filter(row => row.class !== 'present').map(row => row.name)
      const names = [...new Set((client?.rows ?? []).map(row => row.name))]
      if (absent.length > 0) {
        items.push({ category: 'client-service-absent', severity: 'rewrite', detail: `the client surface does not declare ${[...new Set(absent)].join(', ')}, so this client half cannot inject it`, evidence: 'compat/adaptation/client-plane.json' })
      } else {
        const slots = (client?.slotRows ?? []).map(row => row.name)
        const absentSlots = (client?.slotRows ?? []).filter(row => row.class !== 'present').map(row => row.name)
        if (absentSlots.length > 0) items.push({ category: 'client-slot-absent', severity: 'rewrite', detail: `the client half registers into ${absentSlots.join(', ')}, which SlotMap no longer declares, so rendering it fails at load`, evidence: 'compat/adaptation/client-plane.json' })
        items.push({ category: 'client-plane-methodsets-unverified', severity: 'unknown', detail: `${count} usage(s) in the client half name service(s) ${names.join(', ')} that the 0.2.1 client surface still declares${slots.length > 0 ? ` and register into slot(s) ${slots.join(', ')} that SlotMap still declares` : ''} (compat/adaptation/client-plane.json); the method sets and the props each slot owner passes are not verified`, evidence: 'scripts/capture-client-surface.mjs + compat/adaptation/import-resolution.json' })
      }
    }
  }
  if (files.length === 0) items.push({ category: 'no-declared-rows', severity: 'unknown', detail: 'the package declares no dsh.bundle.patch, so this plugin contributes no row of its own', evidence: 'package.json dsh.bundle.patch' })
  if (insertIds.length === 0 && files.length > 0) items.push({ category: 'rows-are-overrides-only', severity: 'rewrite', detail: 'every row of this plugin edits an id another layer inserts; nothing of it is mounted by its own layer', evidence: files.map(f => f.slice(dir.length + 1)).join(', ') })
  const self = selfEntryId(dir)
  for (const row of insertIds) {
    if (self !== null && self.id !== row.id) items.push({ category: 'row-id-mismatch', severity: 'rewrite', detail: `row id "${row.id}" at ${row.file.split('/').slice(-1)[0]}:${row.line} is not the id the plugin uses for its own settings namespace ("${self.id}" at ${self.file})`, evidence: 'string literal ENTRY_ID in the plugin sources' })
  }
  const imports = (resolution.plugins ?? []).find(entry => entry.name === target.name)?.counts ?? null
  for (const row of (resolution.plugins ?? []).find(entry => entry.name === target.name)?.rows ?? []) {
    // Only a package that exists but no longer exports the subpath is a rewrite item; a name no
    // dependency section declares is reported as a count, not as a missing package.
    if (row.class === 'missing-subpath') items.push({ category: 'import-subpath-gone', severity: 'rewrite', detail: `${row.plane} import ${row.specifier} no longer resolves: ${row.package} exists but does not export ./${row.subpath}`, evidence: 'compat/adaptation/import-resolution.json' })
  }
  const superseded = supersededFor(composition, dir, insertIds.map(row => row.id))
  for (const entry of superseded) items.push({ category: 'row-config-superseded', severity: 'rewrite', detail: `${entry.id}: this plugin's own config at ${entry.file.split('/').slice(-1)[0]}:${entry.line} never reaches the plugin; ${entry.winner.file.split('/').slice(-1)[0]}:${entry.winner.line} replaces the config wholesale`, evidence: 'compat/adaptation/rows/profile-composition.json' })
  for (const row of files.flatMap(file => readPatch(file).rows)) {
    const legacy = (row.unknownKeys ?? []).filter(key => ['disable', 'enable', 'enabled', 'options'].includes(key))
    if (legacy.length > 0) items.push({
      category: 'row-legacy-key-inert', severity: 'rewrite',
      detail: `${legacy.join(', ')} at ${row.file.split('/').slice(-1)[0]}:${row.line} is not read at admission either: measured on 0.2.1 the row mounts anyway and the keys never reach the plugin config`,
      evidence: 'compat/adaptation/rows/mount-admission.json cases legacy-disable-true and legacy-enabled-and-options',
    })
  }
  unknown.push('admission is measured for the cases in compat/adaptation/rows/mount-admission.json (a disabled row does not mount; disable/enabled/options are inert; an undeclared config key is passed through). Schema refusals for a missing required key or a wrong type are not measured.')
  for (const row of insertIds) unknown.push(`row ${row.id} (${row.file.split('/').slice(-1)[0]}:${row.line}): targets the live composition? ${(composition.ids ?? []).some(entry => entry.id === row.id) ? 'yes' : 'not found in the composed profile'}`)
  return {
    name: target.name, version: target.version, license: target.license, dir,
    rowFiles: files.map(file => file.slice(dir.length + 1)),
    insertIds,
    counts,
    imports,
    items,
    unknown,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const targets = JSON.parse(readFileSync(TARGETS, 'utf8'))
  const kernelVersion = JSON.parse(readFileSync(join(REPO, 'kernel.lock.json'), 'utf8')).packageVersion
  targets.targets = targets.targets.map(target => ({ ...target, kernelVersion }))
  const composition = existsSync(COMPOSITION) ? JSON.parse(readFileSync(COMPOSITION, 'utf8')) : { ids: [], absent: true }
  const resolution = existsSync(RESOLUTION) ? JSON.parse(readFileSync(RESOLUTION, 'utf8')) : { plugins: [] }
  const clientPlane = existsSync(CLIENT_PLANE) ? JSON.parse(readFileSync(CLIENT_PLANE, 'utf8')) : { plugins: [] }
  const drift = existsSync(DRIFT) ? JSON.parse(readFileSync(DRIFT, 'utf8')) : { kept: [], unsupported: [] }
  const surfaces = existsSync(SURFACE_DIR)
    ? readdirSync(SURFACE_DIR).filter(name => name.endsWith('.json')).map(name => ({ ...JSON.parse(readFileSync(join(SURFACE_DIR, name), 'utf8')), file: name }))
    : []
  const verdicts = targets.targets.map(target => verdictOf(target, composition, resolution, clientPlane, drift, surfaces))
  const report = {
    format: FORMAT,
    note: 'No overall verdict on purpose: each plugin is a list of concrete items. An item stays under unknown when the evidence to decide it does not exist yet.',
    compositionPresent: composition.absent !== true,
    verdicts,
    counts: {
      plugins: verdicts.length,
      items: verdicts.reduce((total, entry) => total + entry.items.length, 0),
      rewrite: verdicts.reduce((total, entry) => total + entry.items.filter(item => item.severity === 'rewrite').length, 0),
      unknown: verdicts.reduce((total, entry) => total + entry.items.filter(item => item.severity === 'unknown').length, 0),
    },
    sourceDigest: createHash('sha256').update(JSON.stringify(verdicts.map(entry => ({ name: entry.name, rows: entry.insertIds, counts: entry.counts })))).digest('hex').slice(0, 16),
  }
  const text = JSON.stringify(report, null, 1) + '\n'
  if (argv.includes('--check')) {
    if (!existsSync(OUT)) { console.log('FAIL  no committed report at ' + OUT); process.exit(1) }
    if (readFileSync(OUT, 'utf8') !== text) { console.log('FAIL  the committed verdicts no longer describe the plugins'); process.exit(1) }
    console.log(`PASS  ${OUT}: ${report.counts.plugins} plugin(s), ${report.counts.rewrite} rewrite item(s), ${report.counts.unknown} unknown`)
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  for (const entry of verdicts) {
    console.log(`
${entry.name}@${entry.version}  rows: ${entry.insertIds.map(row => row.id + (row.hasConfig ? '+config' : '')).join(', ') || '(none)'}`)
    for (const item of entry.items) console.log(`  [${item.severity}] ${item.category}: ${item.detail}`)
    for (const line of entry.unknown) console.log(`  [unresolved] ${line}`)
  }
  console.log(`
${report.counts.plugins} plugin(s), ${report.counts.rewrite} rewrite item(s), ${report.counts.unknown} unknown -> ${OUT}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
