#!/usr/bin/env node
/**
 * Turn usage reports into work tickets for the plugins this machine actually has.
 *
 * One ticket per plugin: what it touches, what the current kernel already has, every unresolved name
 * as a named gap rather than a verdict, the composition rows it ships, and the manual judgements a
 * reader has to make. Derived, never hand-written: `--check` fails when a ticket is not what the
 * analyzer now says.
 *
 * Run:  node scripts/build-usage-tickets.mjs [--check]
 * Exit: 0 written (or, with --check, already correct); 1 drift or an unreadable target; 2 no targets file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'
import { buildReport } from './read-composition-rows.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = join(PROJECT, 'compat', 'adaptation', 'usage-targets.json')
const TICKETS = join(PROJECT, 'compat', 'adaptation', 'tickets')
/** The row report R20 produced, the profile composition it was read against, and the loader probes. */
const ROWS = join(PROJECT, 'compat', 'adaptation', 'rows', 'reports', 'rows.json')
const COMPOSITION = join(PROJECT, 'compat', 'adaptation', 'rows', 'profile-composition.json')
const ADMISSION = join(PROJECT, 'compat', 'adaptation', 'rows', 'mount-admission.json')

if (!existsSync(TARGETS)) {
  console.error('no targets file at ' + TARGETS)
  process.exit(2)
}
const targets = JSON.parse(readFileSync(TARGETS, 'utf8'))

/** A filesystem-safe ticket name for a package name. */
const ticketName = (name) => name.replaceAll('@', '').replaceAll('/', '__') + '.json'

/** The loader facts a manual judgement leans on, keyed by case id. */
function admissionCases() {
  const map = {}
  if (!existsSync(ADMISSION)) return map
  for (const entry of JSON.parse(readFileSync(ADMISSION, 'utf8')).cases ?? []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') {
      map[entry.id] = { question: entry.question ?? null, observedTags: entry.observed?.mountedTags ?? null }
    }
  }
  return map
}

/** One measured citation: the case id and the tags that case actually observed. */
const cite = (cases, id) => (cases[id] === undefined ? { case: null, observedTags: null }
  : { case: id, observedTags: cases[id].observedTags })

/**
 * Whether each id inserted here is replaced wholesale by a later layer.
 *
 * The facts live inside compat/adaptation/rows/profile-composition.json at .ids[], one entry per id:
 * its flags, the layer that wins, and which config layers it supersedes. Paths are compared with
 * backslashes normalised, because the composition records Windows paths.
 * @returns id -> { flags, layers: [{ file, line }] }.
 */
function supersededIndex() {
  const index = {}
  if (!existsSync(COMPOSITION)) return index
  const composition = JSON.parse(readFileSync(COMPOSITION, 'utf8'))
  const normalise = (path) => String(path ?? '').replaceAll('\\', '/')
  for (const entry of composition.ids ?? []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
    index[entry.id] = {
      flags: Array.isArray(entry.flags) ? entry.flags : [],
      layers: (Array.isArray(entry.supersededConfigLayers) ? entry.supersededConfigLayers : [])
        .map((layer) => ({ file: normalise(layer.file), line: layer.line })),
    }
  }
  return index
}

/**
 * The rule, stated once: an inserted id whose config a later layer replaces wholesale.
 * @param row - one row of a row report.
 * @param index - the supersession index.
 * @returns true, false, or null when the composition does not know this id at all.
 */
function supersededByLaterLayer(row, index) {
  if (row.origin !== 'insert-child' || typeof row.id !== 'string') return null
  const entry = index[row.id]
  if (entry === undefined) return null
  if (!entry.flags.includes('configSuperseded')) return false
  const file = String(row.file ?? '').replaceAll('\\', '/')
  return entry.layers.some((layer) => layer.file === file && layer.line === row.line)
}

/** The rows of this plugin's patch files, as the R20 report reads them, with the 0.1.x keys they use. */
function rowsFor(report, superseded) {
  // A ticket derives from ITS OWN plugin, so its rows are read from that plugin's own patch files whenever the
  // package is on this machine. Reading them out of the committed R20 report instead worked only while that
  // report happened to cover the package: it is a sample of the tree this repository owns (31 files), so the four
  // installed packages whose rows the tickets carry were reproduced as "no rows at all" - their patch files were
  // on disk and unchanged the whole time. The report stays as the fallback for a target that is not installed.
  const own = []
  if (existsSync(report.dir)) {
    for (const file of buildReport([{ kind: 'plugin', path: report.dir }]).files ?? []) {
      if (file.error === undefined && Array.isArray(file.rows)) own.push(file)
    }
  }
  if (own.length > 0) return compose(own, superseded)
  if (!existsSync(ROWS)) return { composition: [], legacyKeys: [] }
  const rowsReport = JSON.parse(readFileSync(ROWS, 'utf8'))
  const files = (rowsReport.files ?? []).filter((file) => file.file !== undefined
    && (file.bundle === report.plugin.name || String(file.file).toLowerCase().includes('/' + report.plugin.name.toLowerCase() + '/')))
  return compose(files, superseded)
}

/** One composition list out of the patch-file records, whoever read them. */
function compose(files, superseded) {
  const composition = []
  for (const file of files) {
    for (const row of file.rows ?? []) {
      // eslint-disable-next-line no-continue
      composition.push({
        at: file.file + ':' + row.line,
        file: file.file,
        line: row.line,
        origin: row.origin,
        class: row.class,
        insertedId: row.id ?? null,
        hasConfig: (row.keys ?? []).includes('config'),
        nestedUnder: row.nestedUnder ?? null,
        legacyKeys: (row.keys ?? []).filter((key) => ['disable', 'disabled', 'enabled', 'options'].includes(key)),
        supersededByLaterLayer: supersededByLaterLayer({ ...row, file: file.file }, superseded),
      })
    }
  }
  const legacyKeys = [...new Set(composition.flatMap((row) => row.legacyKeys))]
  return { composition, legacyKeys }
}

/**
 * The manual judgements a ticket carries, each citing a measured admission case where one exists.
 * An item with no case says so in words rather than borrowing a case that does not measure it.
 * @param cases - the admission cases.
 * @param legacyKeys - 0.1.x-spelling keys this plugin really uses.
 * @returns one entry per case of silent behaviour.
 */
function manualJudgementFor(cases, legacyKeys) {
  const entries = [
    {
      id: 'silent-foreign-key',
      needs: 'manual decision',
      what: 'the composition keeps a key that is not in the declared list, without saying so',
      measured: { ...cite(cases, 'config-key-outside-schema'), conclusion: 'the measured case mounted the row with a key the schema does not accept, so an unknown key is passed rather than refused' },
    },
    {
      id: 'duplicate-insert',
      needs: 'manual decision',
      what: 'the same id is inserted twice; the later insert wins wholesale',
      measured: { ...cite(cases, 'same-id-two-rows'), conclusion: 'the measured case kept both rows and indexed the later one, so the earlier config is not merged but dropped' },
    },
    {
      id: 'whole-config-replacement',
      needs: 'manual decision',
      what: 'a later layer replaces a config wholesale rather than merging it',
      measured: { case: null, observedTags: null, conclusion: 'no admission case measures a later layer replacing a config wholesale, so this stays a human decision and is not claimed as measured' },
    },
  ]
  if (legacyKeys.length > 0) {
    entries.push({
      id: 'legacy-disable-spelling',
      needs: 'manual decision',
      what: 'this plugin rows use the 0.1.x key ' + legacyKeys.join('/') + ' rather than disabled',
      measured: { ...cite(cases, 'legacy-disable-true'), conclusion: 'the measured case shows the 0.1.x spelling still mounts the row, so a ticket cannot read it as disabled' },
    })
  }
  return entries
}

/** Build one ticket from one usage report. */
function ticketFor(report, superseded, cases) {
  const rows = rowsFor(report, superseded)
  const gaps = report.usages
    .filter((usage) => usage.classification !== 'present')
    .map((usage) => ({
      name: usage.name,
      kind: usage.kind,
      via: usage.via,
      classification: usage.classification,
      ...(usage.to === undefined ? {} : { to: usage.to }),
      at: usage.at,
    }))
  const kinds = {}
  for (const gap of gaps) kinds[gap.classification] = (kinds[gap.classification] ?? 0) + 1
  return {
    format: 'dsh-link.usage-ticket/1',
    generatedBy: 'scripts/build-usage-tickets.mjs',
    plugin: report.plugin,
    dir: report.dir,
    filesScanned: report.filesScanned,
    sourceDigest: report.sourceDigest,
    counts: report.counts,
    imports: report.imports,
    gaps,
    gapCounts: kinds,
    limits: report.limits,
    work: workFor(report),
    rows: rows.composition,
    manualJudgement: manualJudgementFor(cases, rows.legacyKeys),
  }
}

/** The work a plugin needs, in words a reader can act on. */
function workFor(report) {
  const present = report.counts.present ?? 0
  const client = report.counts['client-plane'] ?? 0
  const absent = report.counts.absent ?? 0
  const loss = report.counts.loss ?? 0
  return [
    'present: ' + String(present) + ' name(s) this plugin uses exist in the 0.2.1 surface, so nothing needs translating',
    'client-plane: ' + String(client) + ' usage(s) live in files only the client plane loads, and no archived surface covers that plane — unverified, not broken (R22: the packages and subpaths they import do resolve; see compat/adaptation/import-resolution.json)',
    'absent: ' + String(absent) + ' name(s) are in neither the 0.2.1 surface nor the drift table; each needs a shim or a rewrite before adoption',
    'loss: ' + String(loss) + ' name(s) are known-lost (a drift row with no candidate), which a bridge can only report',
    'composition: this plugin ships ' + (report.plugin.patch === null ? 'no patch' : 'its own patch')
      + ', so its contract lives in its rows; adopting it means reading those rows, not only its imports',
  ]
}

const superseded = supersededIndex()
const cases = admissionCases()
const reports = []
const skipped = []
for (const target of targets.targets ?? []) {
  if (!existsSync(target.dir)) { skipped.push(target.name + ' (dir not on this machine: ' + target.dir + ')'); continue }
  reports.push({ target, report: analyze(target.dir) })
}

const json = {}
for (const { report } of reports) json[ticketName(report.plugin.name)] = JSON.stringify(ticketFor(report, superseded, cases), null, 1) + '\n'

if (process.argv.includes('--check')) {
  const drift = []
  for (const [file, expected] of Object.entries(json)) {
    const path = join(TICKETS, file)
    if (!existsSync(path)) { drift.push(file + ' is missing'); continue }
    if (readFileSync(path, 'utf8') !== expected) drift.push(file + ' is not what the analyzer now says')
  }
  if (drift.length === 0) {
    console.log('every ticket matches its plugin: ' + String(Object.keys(json).length) + ' ticket(s), '
      + String(skipped.length) + ' target(s) not on this machine')
    process.exit(0)
  }
  console.error('tickets are out of date; run node scripts/build-usage-tickets.mjs')
  for (const row of drift) console.error('  ' + row)
  process.exit(1)
}

mkdirSync(TICKETS, { recursive: true })
for (const [file, content] of Object.entries(json)) writeFileSync(join(TICKETS, file), content, 'utf8')
console.log('wrote ' + String(Object.keys(json).length) + ' ticket(s) to ' + TICKETS)
for (const { report } of reports) console.log('  ' + report.plugin.name + ' ' + JSON.stringify(report.counts))
for (const row of skipped) console.log('  skipped ' + row)
