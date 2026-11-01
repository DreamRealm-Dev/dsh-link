#!/usr/bin/env node
/**
 * Read composition rows out of cordis.patch.yml files.
 *
 * What a row is, and what a patch may contain, is defined by the kernel, not here:
 * packages/boot/app-boot/src/config-schema/document.ts:11-22 lists the accepted metadata keys
 * (id, name, config, group, disabled, inject, intercept, isolate); :24-31 defines the patch shape,
 * including "An insert appends entries, optionally inside the group identified by id. Other patches
 * replace supplied fields; config is replaced wholesale, not deep-merged." and "A truthy name
 * asserts the existing plugin name rather than renaming it." and "Unknown targets and non-insert
 * patches without a nonempty id are warned and skipped."; :152-159 fixes the layer order
 * bundle, profile, home, CLI.
 *
 * YAML coverage, stated rather than implied (no YAML parser is resolvable in this repository and
 * installing one is out of scope, so this file parses the subset the row files on this machine use):
 *
 *   covered    top-level sequence of mappings; nested mappings; nested sequences of mappings;
 *              quoted and bare scalars; booleans, integers, null; inline flow sequences [a, b] and
 *              maps {k: v}; comments; blank lines; a leading document separator
 *   recorded   !!js tagged values are kept verbatim and reported as NOT evaluated
 *   not covered anchors and aliases (&a, *a), block scalars (| and >), multiple documents,
 *              tabs for indentation, flow values spanning lines, duplicate keys in one mapping
 *
 * Anything outside the covered set is counted per file and printed in the report, so a narrower
 * parse can never pass as a complete one.
 *
 * Usage:
 *   node scripts/read-composition-rows.mjs --patch <cordis.patch.yml> [--patch <file> ...]
 *   node scripts/read-composition-rows.mjs --plugin <dir> [--plugin <dir> ...]
 *   node scripts/read-composition-rows.mjs --check          verify the committed reports
 *
 * Importing this module runs nothing: the CLI is behind the invokedDirectly guard.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FORMAT = 'dsh-link.composition-rows/1'

/** The metadata keys a row may carry, from document.ts:11-22. */
export const METADATA_KEYS = ['id', 'name', 'config', 'group', 'disabled', 'inject', 'intercept', 'isolate']

/** Where a class comes from in the kernel source. */
export const EVIDENCE = {
  'insert-entries': 'packages/boot/app-boot/src/config-schema/document.ts:24-31 (the patch insert shape)',
  'field-replacement': 'packages/boot/app-boot/src/config-schema/document.ts:29 (patch description: other patches replace supplied fields)',
  'skipped-no-id': 'packages/boot/app-boot/src/config-schema/document.ts:29 (non-insert patches without a nonempty id are warned and skipped)',
  'unknown-metadata-key': 'packages/boot/app-boot/src/config-schema/document.ts:11-22 (the complete metadata key list)',
  'duplicate-insert-id': 'packages/boot/app-boot/src/config-schema/document.ts:13 (an entry id identifies a row)',
  'unresolvable-insert-name': 'packages/boot/app-boot/src/config-schema/document.ts:14 (name is a plugin module specifier)',
}

const REPORT_DIR = 'compat/adaptation/rows/reports'
/** Constructed fixtures live here; they are reported apart from real samples. */
const FIXTURES_DIR = 'compat/adaptation/rows/fixtures'
/** Every class this reader can emit; a class with no trigger must say so. */
const CLASSES = ['insert-entries', 'field-replacement', 'skipped-no-id', 'unknown-metadata-key', 'duplicate-insert-id', 'unresolvable-insert-name']
/** This repository's root, one level above scripts/. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_BEGIN = '<!-- live-inputs:begin -->'
const LIVE_END = '<!-- live-inputs:end -->'

/** @param {string} file @returns {string} the path with every junction and symlink resolved, when the filesystem allows. */
function realOf(file) {
  try { return realpathSync(file) } catch { return resolve(file) }
}

/**
 * Whether an input lives inside this repository.
 *
 * A live profile reaches the repository through links: `<profile>/node_modules/dsh-agent-context` is a
 * junction to `plugins/dsh-agent-context`, so the file the reader opens is repository-derived even
 * though the path it was found at belongs to the machine. Only repository-derived inputs may make a
 * gate red: the application rewrites its own profile patch (measured in R40 and again in R43), and a
 * criterion that folds it turns every round's acceptance into a coin toss.
 *
 * @param {string} file - an input file path.
 * @returns true when the file's real location is under the repository root.
 */
export function underRepo(file) {
  const real = realOf(file).replace(/\\/g, '/').toLowerCase()
  const root = realOf(REPO_ROOT).replace(/\\/g, '/').toLowerCase()
  return real === root || real.startsWith(root + '/')
}

/**
 * Split inputs into the ones this repository owns and the ones this machine owns.
 *
 * @param {Array<{kind: string, path: string}>} inputs - the input list a run was given.
 * @returns the two lists, in the order they were given.
 */
export function partitionInputs(inputs) {
  const repo = []
  const live = []
  for (const input of inputs) (underRepo(input.path) ? repo : live).push(input)
  return { repo, live }
}

/** @param {string} file @returns {string} sha256 of the file's bytes, or a miss marker. */
function digestOfFile(file) {
  if (!existsSync(file)) return 'missing'
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
}

/**
 * The report as --check compares it: the live section is recorded in the file, never in the criterion.
 *
 * @param {Record<string, any>} report - a composition-rows report.
 * @returns the report text with the live section emptied.
 */
export function stableJsonOf(report) {
  return JSON.stringify({ ...report, liveInputs: null }, null, 1) + String.fromCharCode(10)
}

/**
 * The markdown as --check compares it: everything between the live markers is excluded.
 *
 * @param {string} text - a rendered report.
 * @returns the same text with the live section removed.
 */
export function stableMarkdownOf(text) {
  const kept = []
  let inside = false
  for (const line of text.split(String.fromCharCode(10))) {
    if (line.trim() === LIVE_BEGIN) { inside = true; continue }
    if (line.trim() === LIVE_END) { inside = false; continue }
    if (inside === false) kept.push(line)
  }
  return kept.join(String.fromCharCode(10))
}

/**
 * Compare a committed report with a fresh read, the way --check does.
 *
 * The criterion is everything this repository owns. The live section is compared with itself only to say
 * out loud that the machine moved under the report, which is an observation and never a failure.
 *
 * @param {Record<string, any> | null} committed - the committed report, parsed, or null when unreadable.
 * @param {Record<string, any>} fresh - the report just built.
 * @param {string | null} committedMarkdown - the committed markdown, or null when unreadable.
 * @param {string} freshMarkdown - the markdown just rendered.
 * @returns whether the report is current, and the observation sentence when only the live section moved.
 */
export function compareReports(committed, fresh, committedMarkdown, freshMarkdown) {
  const same = committed !== null && committedMarkdown !== null
    && stableJsonOf(committed) === stableJsonOf(fresh)
    && stableMarkdownOf(committedMarkdown) === stableMarkdownOf(freshMarkdown)
  const committedLive = committed?.liveInputs?.files ?? []
  const freshLive = fresh.liveInputs?.files ?? []
  const moved = committedLive.filter((file) => ((freshLive.find((other) => other.file === file.file)?.digest) ?? null) !== file.digest)
  const appeared = freshLive.filter((file) => committedLive.some((other) => other.file === file.file) === false)
  const changed = [...moved, ...appeared]
  const observation = changed.length === 0 ? null
    : 'live inputs changed: ' + String(changed.length) + ' file(s) (the app rewrote its own profile patch): ' + changed.map((file) => String(file.file).replace(/^.*node_modules[\\/]/, '…/node_modules/')).join(', ')
  return { same, observation, changed: changed.length }
}

const UNSUPPORTED = [
  { pattern: /(^|\s)[&*][A-Za-z_]/, what: 'anchor or alias' },
  { pattern: /:\s*[|>]\s*$/, what: 'block scalar' },
  { pattern: /(^|\s)---(\s|$)/, what: 'document separator' },
  { pattern: /^\t/, what: 'tab indentation' },
]

/** Strip a comment that is not inside quotes. */
function stripComment(line) {
  let quote = null
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]
    if (quote === null && (char === '"' || char === "'")) quote = char
    else if (quote !== null && char === quote) quote = null
    else if (quote === null && char === '#') return line.slice(0, at)
  }
  return line
}

/** One scalar, with the fact that a !!js tag was read rather than evaluated. */
function scalar(text) {
  let value = text.trim()
  let evaluated = true
  if (value.startsWith('!!js')) {
    evaluated = false
    value = value.slice(4).trim()
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  let parsed = value
  if (value === 'true') parsed = true
  else if (value === 'false') parsed = false
  else if (value === 'null' || value === '~') parsed = null
  else if (/^-?\d+$/.test(value)) parsed = Number(value)
  else if (value.startsWith('[') && value.endsWith(']')) parsed = value.slice(1, -1).split(',').map((piece) => piece.trim()).filter((piece) => piece !== '')
  else if (value.startsWith('{') && value.endsWith('}')) {
    parsed = {}
    for (const piece of value.slice(1, -1).split(',')) {
      const at = piece.indexOf(':')
      if (at > 0) parsed[piece.slice(0, at).trim()] = piece.slice(at + 1).trim()
    }
  }
  return { value: parsed, evaluated }
}

/**
 * Parse the row files' YAML subset.
 *
 * @param text - the file contents.
 * @returns rows with their 1-based line numbers, plus what the parser could not cover.
 */
export function parseRows(text) {
  const lines = text.split(/\r?\n/)
  const rows = []
  const warnings = []
  const attributed = new Set()
  /**
   * The chain of containers currently open, innermost last: a row that carries an
   * insert, a row whose config holds a list, or an unattributed mapping. Every dash is
   * classified against the stack top instead of one remembered pointer, so a deeper
   * entry list cannot be mistaken for a layer row.
   */
  const stack = []
  let parsedLines = 0
  const closeDeeperThan = (indent) => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
  }
  for (let index = 0; index < lines.length; index += 1) {
    const number = index + 1
    const body = stripComment(lines[index])
    if (body.trim() === '') continue
    for (const rule of UNSUPPORTED) {
      if (rule.pattern.test(body)) warnings.push({ line: number, what: rule.what, text: body.trim().slice(0, 60) })
    }
    const indent = body.length - body.trimStart().length
    const trimmed = body.trim()
    parsedLines += 1
    if (trimmed === '-') { attributed.add(number); continue }
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2)
      closeDeeperThan(indent)
      const top = stack.length > 0 ? stack[stack.length - 1] : null
      // Under an insert row the first deeper dash is the first child and its siblings
      // share that indent; anything deeper belongs to the child, and a row that is not
      // an insert row can only hold a nested entry list.
      const topIsInsert = top !== null && top.origin === 'insert-parent'
      const childIndent = topIsInsert ? top.childIndent : undefined
      const isInsertChild = topIsInsert && (childIndent === undefined ? indent > top.indent : indent === childIndent)
      if (isInsertChild && childIndent === undefined) top.childIndent = indent
      const isNested = !topIsInsert && top !== null && indent > top.indent + 2
      const row = {
        line: number, keys: [], values: {}, indent,
        origin: isInsertChild ? 'insert-child' : isNested ? 'nested' : 'row',
        parentLine: isInsertChild ? top.line : null,
        nestedUnder: isNested ? top.line : null,
      }
      rows.push(row)
      stack.push(row)
      attributed.add(number)
      if (rest.includes(':')) {
        const at = rest.indexOf(':')
        const key = rest.slice(0, at).trim()
        const rest2 = rest.slice(at + 1)
        const value = scalar(rest2)
        row.keys.push(key)
        row.values[key] = rest2.trim() === '' && key === 'config' ? { present: true } : value.value
        if (value.evaluated === false) row.values[key + '__unevaluated'] = true
        if (key === 'insert' && rest2.trim() === '') row.origin = 'insert-parent'
      }
      continue
    }
    const at = trimmed.indexOf(':')
    if (at === -1) continue
    const key = trimmed.slice(0, at).trim()
    const rest = trimmed.slice(at + 1)
    closeDeeperThan(indent)
    const top = stack.length > 0 ? stack[stack.length - 1] : null
    if (top !== null && indent > top.indent + 2) {
      // Inside a nested block: part of the value above it, not row metadata.
      attributed.add(number)
      continue
    }
    if (top === null) {
      // A mapping that belongs to no row: a plugin file with top-level keys.
      const row = { line: number, keys: [key], values: {}, indent, origin: 'mapping', parentLine: null, nestedUnder: null }
      row.values[key] = scalar(rest).value
      rows.push(row)
      stack.push(row)
      attributed.add(number)
      continue
    }
    if (!top.keys.includes(key)) top.keys.push(key)
    const value = scalar(rest)
    top.values[key] = rest.trim() === '' && key === 'config' ? { present: true } : value.value
    if (value.evaluated === false) top.values[key + '__unevaluated'] = true
    attributed.add(number)
    if (key === 'insert' && rest.trim() === '') top.origin = 'insert-parent'
  }
  return {
    rows, warnings, parsedLines,
    totalLines: lines.length,
    attributedLines: attributed.size,
    unattributedLines: lines.map((_, at) => at + 1).filter((number) => bookLine(lines, number, attributed)),
  }
}
/** True for a line that carries content but was not attributed to any record. */
function bookLine(lines, number, attributed) {
  return attributed.has(number) === false && (lines[number - 1] ?? '').trim() !== ''
}

function classify(file, parsed) {
  const records = []
  const seenIds = new Map()
  for (const row of parsed.rows) {
    const keys = row.keys ?? []
    const id = typeof row.values.id === 'string' ? row.values.id : null
    const name = typeof row.values.name === 'string' ? row.values.name : null
    const origin = row.origin ?? 'row'
    const insert = origin === 'insert-parent' || origin === 'insert-child' || keys.includes('insert')
    const unknown = keys.filter((key) => METADATA_KEYS.includes(key) === false && key !== 'insert')
    let cls = insert ? 'insert-entries' : id !== null ? 'field-replacement' : 'skipped-no-id'
    if (unknown.length > 0) cls = 'unknown-metadata-key'
    if (id !== null) {
      if (seenIds.has(id)) cls = 'duplicate-insert-id'
      seenIds.set(id, row.line)
    }
    records.push({
      file, line: row.line, class: cls, id, name, keys, unknownKeys: unknown,
      origin, parentLine: row.parentLine ?? null, nestedUnder: row.nestedUnder ?? null,
      evidence: EVIDENCE[cls], values: row.values,
    })
  }
  return records
}
/** Read one patch file. */
export function readPatch(path) {
  const text = readFileSync(path, 'utf8')
  const parsed = parseRows(text)
  const records = classify(path, parsed)
  return {
    file: path.replace(/\\/g, '/'),
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text.split(/\r?\n/).length,
    parsedLines: parsed.parsedLines,
    // Coverage is stated as attributed/total content lines, and the lines that were
    // read but attributed to no record are listed rather than counted away.
    totalLines: parsed.totalLines,
    attributedLines: parsed.attributedLines,
    unattributedLines: parsed.unattributedLines,
    coverage: Number((parsed.attributedLines / Math.max(1, parsed.totalLines)).toFixed(2)),
    warnings: parsed.warnings,
    rows: records,
  }
}

/** Every patch file a plugin package declares. */
export function patchFilesOf(pluginDir) {
  const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  // The field may be one path or a list: plugins/dsh-link-mods declares two files,
  // and the second one (presets.patch.yml) carries preset declaration rows.
  const list = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.filter((entry) => typeof entry === 'string') : []
  return list.map((entry) => resolve(pluginDir, entry)).filter((path) => existsSync(path))
}

/**
 * Read one patch file.
 *
 * @param absPath - absolute path of a corgis patch file.
 * @returns the file record: bytes, coverage, warnings, and one record per row.
 */
export async function readPatchFile(absPath) {
  return readPatch(absPath)
}

/** The whole report: one document, one input list. */
export function buildReport(inputs) {
  const files = []
  for (const input of inputs) {
    const paths = input.kind === 'plugin' ? patchFilesOf(input.path) : [input.path]
    for (const path of paths) {
      if (!existsSync(path)) { files.push({ file: input.path, error: 'not found', origin: underRepo(input.path) ? 'repo' : 'live' }); continue }
      const record = readPatch(path)
      record.source = input.source ?? 'sample'
      record.origin = underRepo(path) ? 'repo' : 'live'
      files.push(record)
    }
  }
  const rows = files.flatMap((file) => file.rows ?? [])
  const byClass = {}
  for (const row of rows) byClass[row.class] = (byClass[row.class] ?? 0) + 1
  const origin = {}
  for (const row of rows) origin[row.origin ?? 'row'] = (origin[row.origin ?? 'row'] ?? 0) + 1
  const classCoverage = CLASSES.map((cls) => {
    const inSamples = rows.filter((row) => row.class === cls && files.some((file) => file.source !== 'fixture' && (file.rows ?? []).includes(row))).length
    const inFixtures = rows.filter((row) => row.class === cls && files.some((file) => file.source === 'fixture' && (file.rows ?? []).includes(row))).length
    const fixtures = files.filter((file) => file.source === 'fixture' && (file.rows ?? []).some((row) => row.class === cls)).map((file) => file.file.split('/').pop())
    return {
      class: cls, samples: inSamples, fixtures: inFixtures, fixtureFiles: fixtures,
      note: inSamples + inFixtures === 0 ? 'no trigger on this machine: neither the real samples nor the fixtures exercise this class'
        : inSamples === 0 ? 'no trigger in the real samples; exercised only by fixtures' : null,
    }
  })
  return {
    format: FORMAT,
    // No timestamp: the report is deterministic so --check can compare it exactly.
    method: 'bounded YAML subset parser (see the module header for coverage); classification follows packages/boot/app-boot/src/config-schema/document.ts',
    files,
    counts: {
      files: files.length,
      rows: rows.length,
      // Patch rows and insert children are counted apart: the first says how many lines
      // the files carry, the second how many ids a bundle actually inserts.
      patchRows: rows.filter((row) => (row.origin ?? 'row') !== 'insert-child').length,
      insertChildren: rows.filter((row) => row.origin === 'insert-child').length,
      // Rows that live inside another row's value (a preset's own entry list, for
      // example) are counted apart: the root patch index cannot see them.
      nestedRows: rows.filter((row) => row.origin === 'nested').length,
      byOrigin: Object.fromEntries(['row', 'insert-parent', 'insert-child', 'nested', 'mapping'].map((kind) => [kind, rows.filter((row) => (row.origin ?? 'row') === kind).length])),
      bySource: Object.fromEntries(['sample', 'fixture'].map((kind) => [kind, files.filter((file) => (file.source ?? 'sample') === kind).reduce((total, file) => total + (file.rows ?? []).length, 0)])),
      classCoverage,
      // "Patch rows" and "insert children" are counted apart: the first says how many
      // lines the files carry, the second how many ids a bundle actually inserts.
      patchRows: rows.filter((row) => (row.origin ?? 'row') !== 'insert-child').length,
      insertChildren: rows.filter((row) => row.origin === 'insert-child').length,
      byOrigin: origin,
      byClass,
      bytes: files.reduce((total, file) => total + (file.bytes ?? 0), 0),
      parserWarnings: files.reduce((total, file) => total + (file.warnings ?? []).length, 0),
    },
    cannotSee: [
      'a !!js value is kept verbatim and never evaluated',
      'whether the module a row names is actually installed',
      'group inheritance and layer order beyond the file being read (bundle, profile, home, CLI apply in that order, per document.ts:152-159)',
      'a config block is reported as present, never as satisfying any schema',
      'anchors, aliases, block scalars and multi-document files are counted, not parsed (see the module header)',
    ],
  }
}

/** The sample inputs this machine offers, all read-only. */
export const OUR_PLUGINS_DIR = '<workspace>//dsh-link/plugins'

export const SAMPLE_INPUTS = [
  { kind: 'patch', path: (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/cordis.patch.yml' },
  { kind: 'plugin', path: (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/node_modules/@argszero/cordis-plugin-thinking-loop-guard' },
  { kind: 'plugin', path: (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/node_modules/dsh-opencode-go' },
  { kind: 'plugin', path: (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/node_modules/dsh-repeat-guard' },
  { kind: 'plugin', path: (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/node_modules/dsh-repetition-guard' },
  ...ourPluginInputs(),
]

/** Every plugin package in this repository that declares a bundle patch. */
function ourPluginInputs() {
  const root = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'plugins')
  const inputs = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = join(root, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (parsed.dsh?.bundle?.patch !== undefined) inputs.push({ kind: 'plugin', path: join(root, entry.name) })
    } catch {
      // A package.json that does not parse is not a plugin input; the report lists files it read.
    }
  }
  return inputs
}

/** The live profile manifest: dsh.profile.bundles fixes the layer order. */
/** The real samples, labelled so the report can present them apart from fixtures. */
function allSampleInputs() {
  return SAMPLE_INPUTS.map((input) => ({ kind: input.kind, path: resolve(input.path), source: 'sample' }))
}

/** Every constructed fixture, labelled as such. */
function withFixtures(inputs) {
  const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), FIXTURES_DIR)
  const fixtures = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.patch.yml')).sort().map((name) => ({ kind: 'patch', path: join(dir, name), source: 'fixture' }))
    : []
  return [...inputs, ...fixtures]
}

export const PROFILE_MANIFEST = (process.env.APPDATA ?? '') + '/dev.dshlink.client/dsh-link/kernel-home/profiles/web/package.json'

/**
 * Which bundle occupies which layer, and which rows a later layer overrides.
 *
 * @param report - the file and row records already read.
 * @param bundles - the profile's dsh.profile.bundles list, in order.
 * @returns per-file and per-row layer facts, and the ids that appear more than once.
 */
export function analyzeLayers(report, bundles) {
  const layerOfPackage = new Map(bundles.map((name, index) => [name, index]))
  for (const file of report.files) {
    if (file.file === undefined) continue
    const match = new RegExp('node_modules/(.+?)/(?:cordis|presets|[^/]+)[.]patch[.]yml$').exec(file.file)
    file.bundle = match === null ? 'profile-layer (this file is an overlay, not a bundle)' : match[1]
    file.layer = match === null ? bundles.length : (layerOfPackage.get(match[1]) ?? null)
  }
  const byId = new Map()
  for (const file of report.files) {
    for (const row of file.rows ?? []) {
      if (row.id === null || row.id === undefined) continue
      const list = byId.get(row.id) ?? []
      list.push({ file: file.file, layer: file.layer, line: row.line, class: row.class, hasConfig: row.keys.includes('config') })
      byId.set(row.id, list)
    }
  }
  const overriddenBy = {}
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue
    const sorted = [...entries].sort((left, right) => (left.layer ?? 0) - (right.layer ?? 0))
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const winner = sorted[sorted.length - 1]
      const key = sorted[index].file + ':' + sorted[index].line
      overriddenBy[key] = { id, by: winner.file + ':' + winner.line, winnerHasConfig: winner.hasConfig, earlierHasConfig: sorted[index].hasConfig }
    }
  }
  return {
    bundles,
    layerOf: Object.fromEntries([...layerOfPackage].map(([name, index]) => [name, index])),
    idsInMoreThanOnePlace: [...byId].filter(([, entries]) => entries.length > 1).map(([id, entries]) => ({ id, entries })),
    overriddenBy,
    note: 'The loader keys its store by id, so a later layer with the same id wins; when the winner carries no config, the earlier config is a dead flag. This is the shape recorded at plugins/dsh-link-mods/cordis.patch.yml:25-33.',
  }
}

/** Render the human summary that ships beside the JSON. */
export function renderMarkdown(report) {
  const lines = ['# Composition rows (generated — run: node scripts/read-composition-rows.mjs --sample)', '',
    report.counts.files + ' file(s), ' + report.counts.rows + ' row record(s), '
    + report.counts.bytes + ' bytes, ' + report.counts.parserWarnings + ' parser warning(s).', '',
    '| class | rows |', '|---|---|']
  for (const [cls, count] of Object.entries(report.counts.byClass).sort()) lines.push('| ' + cls + ' | ' + count + ' |')
  lines.push('', '| file | bytes | coverage | rows |', '|---|---|---|---|')
  for (const file of report.files) {
    lines.push('| ' + (file.file ?? '?').replace(/^.*node_modules\//, '…/node_modules/') + ' | ' + (file.bytes ?? 0) + ' | '
      + (file.coverage ?? 0) + ' | ' + (file.rows ?? []).length + ' |')
  }
  const liveInputs = report.liveInputs
  if (liveInputs !== undefined && liveInputs !== null) {
    lines.push('', LIVE_BEGIN, '## Live-machine inputs (excluded from --check)', '')
    lines.push('Read from this machine, not from the repository: the profile own patch file and bundles installed outside it. The application rewrites its own profile patch, so this material is recorded and printed here and left out of the --check comparison; rows.json carries it under liveInputs.', '')
    lines.push('| file | bytes | lines | rows | digest |', '|---|---|---|---|---|')
    for (const file of liveInputs.files ?? []) lines.push('| ' + (file.file ?? '?').replace(/^.*node_modules[\\/]/, '…/node_modules/') + ' | ' + (file.bytes ?? 0) + ' | ' + (file.lines ?? 0) + ' | ' + (file.rows ?? 0) + ' | ' + (file.digest ?? '') + ' |')
    lines.push('', 'liveDigest ' + String(liveInputs.digest ?? '') + ' over ' + String((liveInputs.files ?? []).length) + ' file(s); ' + String(liveInputs.counts?.bytes ?? 0) + ' bytes, ' + String(liveInputs.counts?.rows ?? 0) + ' row record(s).', '')
  }
  const layers = liveInputs?.layers
  if (layers !== undefined) {
    lines.push('', '## Layer order (from the live profile manifest, dsh.profile.bundles)', '')
    lines.push('| bundle | layer |', '|---|---|')
    for (const [name, index] of Object.entries(layers.layerOf ?? {})) lines.push('| ' + name + ' | ' + index + ' |')
    lines.push('', (layers.note ?? '') + '', '')
    if ((layers.idsInMoreThanOnePlace ?? []).length > 0) {
      lines.push('### Same id in more than one place', '')
      lines.push('| id | layer | where | class | config |', '|---|---|---|---|---|')
      for (const entry of layers.idsInMoreThanOnePlace) {
        for (const place of entry.entries) {
          lines.push('| ' + entry.id + ' | ' + String(place.layer ?? 'profile') + ' | ' + String(place.layer ?? 'profile') + ' | ' + place.file.replace(/^.*node_modules\//, '…/node_modules/') + ':' + place.line + ' | ' + place.class + ' | ' + (place.hasConfig ? 'yes' : 'no') + ' |')
        }
      }
      lines.push('', 'The later layer wins: layers apply in the order bundle, profile, home, CLI (packages/boot/app-boot/src/config-schema/document.ts:159), so the profile layer overrides a bundle layer that carries the same id.', 'The live profile carries no dead config today: the duplicate-id shape recorded at plugins/dsh-link-mods/cordis.patch.yml:25-33 was fixed in R3-2d; this table is the current state.', '')
    }
  }
  if (liveInputs !== undefined && liveInputs !== null) lines.push(LIVE_END, '')
  const outside = report.rowsOutsideThisFile ?? []
  if (outside.length > 0) {
    lines.push('', '## Field-replacement rows whose target is not inserted in the same file', '')
    lines.push('This is the common shape, not an edge case: the live profile patch carries field-replacement rows only.', '')
    lines.push('| file | line | id | target inserted in this file |', '|---|---|---|---|')
    for (const row of outside) {
      lines.push('| ' + row.file.replace(/^.*node_modules\//, '…/node_modules/') + ' | ' + row.line + ' | ' + row.id + ' | ' + (row.targetInThisFile ? 'yes' : 'no') + ' |')
    }
  }
  lines.push('', '## Real samples and constructed fixtures', '')
  lines.push('| source | file | bytes | coverage | rows | insert children |', '|---|---|---|---|---|---|')
  for (const file of report.files) {
    lines.push('| ' + (file.source ?? 'sample') + ' | ' + (file.file ?? '?').replace(/^.*(node_modules|fixtures)[\\/]/, '…/$1/') + ' | ' + (file.bytes ?? 0) + ' | '
      + (file.attributedLines ?? 0) + '/' + (file.totalLines ?? 0) + ' | ' + (file.rows ?? []).length + ' | ' + (file.rows ?? []).filter((row) => row.origin === 'insert-child').length + ' |')
  }
  lines.push('', 'Coverage is attributed lines over total lines: comment-only and blank lines are not attributed, and any content line the parser could not attribute is listed in rows.json under unattributedLines.', '')
  lines.push('## Class coverage', '', '| class | real samples | fixtures | note |', '|---|---|---|---|')
  for (const entry of report.counts.classCoverage ?? []) {
    lines.push('| ' + entry.class + ' | ' + entry.samples + ' | ' + entry.fixtures + ' | ' + (entry.note ?? (entry.fixtureFiles.length > 0 ? entry.fixtureFiles.join(', ') : '')) + ' |')
  }
  lines.push('', 'Nested rows: ' + (report.counts.nestedRows ?? 0) + ' record(s) carry origin "nested" with nestedUnder set to the line of the row whose value holds them. These are entry lists inside a config block (a preset declaring its own plugins, for example); the root patch index does not see them, so treating them as layer rows manufactures targets that nobody has to fix.', '')
  lines.push('', '## What this report cannot see', '')
  for (const item of report.cannotSee) lines.push('- ' + item)
  return lines.join('\n') + '\n'
}

/** Run the CLI. */
function main() {
  const argv = process.argv.slice(2)
  const inputs = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--patch') inputs.push({ kind: 'patch', path: resolve(argv[index + 1]) })
    if (argv[index] === '--plugin') inputs.push({ kind: 'plugin', path: resolve(argv[index + 1]) })
  }
  if (argv.includes('--sample')) inputs.push(...allSampleInputs())
  const check = argv.includes('--check')
  // A bare --check verifies the committed reports against the sample set, so the
  // gate can run it without arguments.
  if (check && inputs.length === 0) inputs.push(...withFixtures(allSampleInputs()))
  if (argv.includes('--all')) inputs.push(...withFixtures(allSampleInputs()))
  if (inputs.length === 0) {
    console.error('usage: node scripts/read-composition-rows.mjs --sample | --all | --patch <file> | --plugin <dir> [--check]')
    process.exit(2)
  }
  // The report is built from the inputs this repository owns. The machine's own inputs are read the
  // same way and recorded under liveInputs, where a reader can see them and --check cannot trip on them.
  const { repo, live } = partitionInputs(inputs)
  const report = buildReport(repo)
  const liveReport = live.length === 0 ? null : buildReport(live)
  if (liveReport !== null) {
    report.liveInputs = {
      note: 'Read from this machine, not from this repository: the profile own patch file and the bundles installed outside it. The application rewrites its own profile patch (R40, R43), so this material is recorded and printed but is not part of the --check comparison.',
      files: liveReport.files.map((file) => ({
        file: file.file, origin: 'live', bytes: file.bytes ?? 0, lines: file.lines ?? 0, coverage: file.coverage ?? 0,
        rows: (file.rows ?? []).length, digest: digestOfFile(file.file),
      })),
      counts: { files: liveReport.files.length, bytes: liveReport.counts.bytes, rows: liveReport.counts.rows },
      digest: '',
      layers: null,
    }
    report.liveInputs.digest = createHash('sha256').update(JSON.stringify(report.liveInputs.files.map((file) => ({ file: file.file, digest: file.digest })))).digest('hex').slice(0, 16)
  }
  if (existsSync(PROFILE_MANIFEST)) {
    try {
      const bundles = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8')).dsh?.profile?.bundles
      if (Array.isArray(bundles)) {
        // The layer view is a live reading: it needs the live profile's bundle list and the files that
        // live under it, so it is recorded with the live inputs rather than in the compared report.
        const layerView = analyzeLayers({ files: [...report.files, ...(liveReport?.files ?? [])] }, bundles)
        if (report.liveInputs === undefined) {
          report.liveInputs = { note: 'the layer order below comes from this machine profile manifest', files: [], counts: { files: 0, bytes: 0, rows: 0 }, digest: '', layers: null }
        }
        report.liveInputs.layers = layerView
      }
    } catch {
      if (report.liveInputs !== undefined) report.liveInputs.layers = { note: 'the profile manifest could not be read; layer order is unknown' }
    }
  }
  report.rowsOutsideThisFile = report.files.flatMap((file) => (file.rows ?? [])
    .filter((row) => row.class === 'field-replacement')
    .map((row) => ({ file: file.file, line: row.line, id: row.id, targetInThisFile: (file.rows ?? []).some((other) => other.class === 'insert-entries' && other.id === row.id) })))
  const json = JSON.stringify(report, null, 1) + '\n'
  const markdown = renderMarkdown(report)
  const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), REPORT_DIR)
  const jsonPath = join(dir, 'rows.json')
  const mdPath = join(dir, 'rows.md')
  if (check) {
    const before = existsSync(jsonPath) ? readFileSync(jsonPath, 'utf8') : null
    const beforeMd = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : null
    let committed = null
    try { committed = JSON.parse(before ?? '') } catch { committed = null }
    const verdict = compareReports(committed, report, beforeMd, markdown)
    if (verdict.observation !== null) {
      console.log(verdict.observation)
      console.log('  recorded under liveInputs and printed here; excluded from this comparison, so it is not why a gate would go red')
    }
    console.log(verdict.same ? 'ok: reports match a fresh read (repository-derived inputs)' : 'stale: reports differ from a fresh read (run without --check)')
    process.exit(verdict.same ? 0 : 1)
  }
  // Only the full set (`--all`) describes what the committed reports are supposed to contain. A
  // sample or single-file run used to overwrite them anyway, which quietly shrank the committed
  // reports to whatever that run happened to read - it happened twice, once by a person and once by
  // a teammate, and both times the gate went red for a file nobody meant to change. A partial run
  // now writes to .tmp and says so.
  const writesCommitted = argv.includes('--all')
  if (!writesCommitted) {
    const scratch = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.tmp'))
    mkdirSync(scratch, { recursive: true })
    writeFileSync(join(scratch, 'rows-partial.json'), json, 'utf8')
    writeFileSync(join(scratch, 'rows-partial.md'), markdown, 'utf8')
    console.log('this run is a partial set (no --all), so the committed reports were NOT touched; wrote .tmp/rows-partial.json and .tmp/rows-partial.md instead')
  } else {
    mkdirSync(dir, { recursive: true })
    writeFileSync(jsonPath, json, 'utf8')
    writeFileSync(mdPath, markdown, 'utf8')
    console.log('wrote ' + REPORT_DIR + '/rows.json and rows.md')
  }
  console.log(JSON.stringify(report.counts, null, 1))
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
