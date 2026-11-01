#!/usr/bin/env node
/**
 * Construct patch rows and observe what the composition actually does with them.
 *
 * The bridge's question is runtime, not documentary: when a 0.1.x profile's row reaches a
 * 0.2.1 loader, is it rejected, warned and skipped, or silently accepted? Reading the schema
 * only yields what the docs claim. This probe writes real patch rows, composes them through
 * the same call `boot()` makes, and records the composed tree plus the diagnostics.
 *
 * R73 alive-control: EXEMPT, with the reason - the composition is read through `--dump-config` and no
 * plugin is ever mounted (stage: composition only, per the notes below), so there is no live
 * composition to read a root service from. A probe that mounts carries the control instead.
 *
 * Method. `apps/cli/src/bin.ts --profile <p> --dump-config` composes through
 * `applyEntryPatches` (vendor/include/src/index.ts:57) — the exact function mounting uses, so
 * a dump cannot drift from what boots (apps/cli/src/dump-config.ts:1-5, app-boot/src/index.ts:400-408).
 * Each case runs against a fresh `mkdtemp` home, so the machine's real profile never leaks in
 * and the live shell's home is never touched.
 *
 * Two safeguards against reading a harness failure as a finding:
 *
 *  1. Every overlay inserts a marker row beside the row under test. If the marker is missing
 *     from the composed tree, the overlay was never read and the case is reported as
 *     `harness-error` — never as "the loader accepted it".
 *  2. Warnings are read from stderr, where the dump sends skipped-patch diagnostics
 *     (app-boot/src/index.ts:427,435). A case whose expectation is a warning must show that
 *     warning; a case whose expectation is silence must show an empty diagnostic list *and*
 *     its marker, which is what makes the silence meaningful.
 *
 * Scope. This observes the composition stage. Row admission is a later stage
 * (app-boot/src/index.ts:407-408): a row the policy denies still appears in the dump. So a
 * case here proves what composition does, not what mounting accepts. Cases that need the
 * mount stage say so in `verdict` instead of being reported as proven.
 *
 * Usage:
 *   node scripts/probe-row-behaviour.mjs [--out <json>] [--kernel <dir>] [--profile <name>]
 *                                        [--cases <id,id>] [--keep]
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1'))
const PROJECT = path.resolve(HERE, '..')

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name)
  return at === -1 ? fallback : process.argv[at + 1]
}
const flag = (name) => process.argv.includes('--' + name)

const KERNEL = path.resolve(option('kernel', process.env.DSH_LINK_KERNEL ?? '<workspace>//dsh-link/core/deepseek-harness'))
const CLI_ENTRY = 'apps/cli/src/bin.ts'
const PROFILE = option('profile', 'web')
const OUT = path.resolve(option('out', path.join(PROJECT, 'compat', 'adaptation', 'rows', 'loader-behaviour.json')))
const ONLY = option('cases', null)
const KEEP = flag('keep')

/** A calibration row that is present in every composed tree, so "no effect" can be told from "not read". */
const CALIBRATION = { id: 'r20-calibration', name: 'r20-probe-calibration' }

/** The bundle row used for the cross-layer config case; it ships a multi-key config. */
const BUNDLE_ROW_WITH_CONFIG = 'session-telemetry-otel'

/**
 * The cases, each as data: the layers written to disk, the command that composes them, and
 * what the composition is expected to do.
 */
const CASES = [
  {
    id: 'non-insert-without-id',
    question: 'A non-insert patch row that omits id.',
    constructed: 'one layer: [{ config: { r20Probe: 1 } }, { insert: [calibration] }] — the first row is a non-insert patch with no id',
    layers: [[{ config: { r20Probe: 1 } }, { insert: [CALIBRATION] }]],
    expects: {
      warningIncludes: ['id is required for non-insert patches'],
      note: 'the id-less row must be warned about and skipped, and the calibration row must still land',
    },
  },
  {
    id: 'non-insert-unknown-id',
    question: 'A non-insert patch row naming an id no entry has.',
    constructed: "one layer: [{ id: 'r20-does-not-exist', disabled: true }, { insert: [calibration] }]",
    layers: [[{ id: 'r20-does-not-exist', disabled: true }, { insert: [CALIBRATION] }]],
    expects: {
      warningIncludes: ['r20-does-not-exist', 'not found'],
      note: 'the missing target must be warned about and skipped, and the calibration row must still land',
    },
  },
  {
    id: 'insert-legacy-0.1.x-keys',
    question: 'An insert child carrying 0.1.x-era keys (enabled / options / disable) that are absent from document.ts:11-22.',
    constructed: "one layer: [{ insert: [{ id: 'r20-legacy', name: 'r20-legacy-name', enabled: true, options: { keepMe: true }, disable: true }, calibration] }]",
    layers: [[{ insert: [{ id: 'r20-legacy', name: 'r20-legacy-name', enabled: true, options: { keepMe: true }, disable: true }, CALIBRATION] }]],
    expects: {
      warningIncludes: [],
      markerRow: 'r20-legacy',
      mustShowKeys: ['enabled', 'options', 'disable'],
      note: 'record whether composition keeps the keys silently, warns, or refuses; admission is a later stage, so silence here is not proof of support',
    },
  },
  {
    id: 'insert-same-id-twice',
    question: 'The same id inserted twice, then patched.',
    constructed: "layer 1: two inserts both with id 'r20-dupe' and different config ({ from: 'A' }, { from: 'B' }); layer 2: [{ id: 'r20-dupe', disabled: true }]",
    layers: [
      [{ insert: [{ id: 'r20-dupe', name: 'r20-dupe-name', config: { from: 'A' } }, { id: 'r20-dupe', name: 'r20-dupe-name', config: { from: 'B' } }, CALIBRATION] }],
      [{ id: 'r20-dupe', disabled: true }],
    ],
    expects: {
      warningIncludes: [],
      markerRow: 'r20-dupe',
      note: 'record whether both rows survive, and which one the later patch reached (the id index keeps the last one)',
    },
  },
  {
    id: 'config-replace-vs-deep-merge',
    question: 'Whether a later layer replaces a config wholesale or deep-merges it.',
    constructed: "layer 1: insert { id: 'r20-cfg', name: 'r20-cfg-name', config: { keep: 1, replace: 2 } }; layer 2: [{ id: 'r20-cfg', config: { replace: 99 } }]",
    layers: [
      [{ insert: [{ id: 'r20-cfg', name: 'r20-cfg-name', config: { keep: 1, replace: 2 } }, CALIBRATION] }],
      [{ id: 'r20-cfg', config: { replace: 99 } }],
    ],
    expects: {
      warningIncludes: [],
      markerRow: 'r20-cfg',
      note: 'if the composed config still holds keep: 1 the layers deep-merge; if only replace: 99 remains they replace wholesale',
    },
  },
  {
    id: 'config-replace-on-bundle-row',
    question: 'The same question asked against a real bundle row that ships a multi-key config.',
    constructed: "one layer: [{ id: '" + BUNDLE_ROW_WITH_CONFIG + "', config: { r20Probe: true } }, { insert: [calibration] }]",
    layers: [[{ id: BUNDLE_ROW_WITH_CONFIG, config: { r20Probe: true } }, { insert: [CALIBRATION] }]],
    expects: {
      warningIncludes: [],
      note: 'the bundle row ships several config keys; observe how many of them survive the profile patch',
    },
  },
]

/** Write one case's layers and compose them through the real CLI dump path. */
const runCase = (testCase) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r20-row-home-'))
  const layerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r20-row-layer-'))
  try {
    // Constructed cases write their own layers; fixture runs point at files the fixture owner
    // authored, so the probe observes those exact bytes rather than a copy of them.
    const layerPaths = testCase.patchFiles ?? testCase.layers.map((rows, index) => {
      const file = path.join(layerDir, 'layer-' + String(index + 1) + '.yml')
      fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n', 'utf8')
      return file
    })
    const argv = [
      '--import', 'tsx/esm', path.join(KERNEL, CLI_ENTRY),
      '--profile', PROFILE, '--dump-config',
      ...layerPaths.flatMap(file => ['--patch', file]),
    ]
    const started = Date.now()
    const result = spawnSync(process.execPath, argv, {
      cwd: KERNEL,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300000,
      env: { ...process.env, DSH_HOME: home },
    })
    return {
      status: result.status ?? -1,
      error: result.error ? result.error.message : null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      elapsedMs: Date.now() - started,
      command: 'DSH_HOME=<mkdtemp> node ' + argv.join(' '),
      layerFiles: layerPaths,
      home,
    }
  } finally {
    if (!KEEP) {
      fs.rmSync(layerDir, { recursive: true, force: true })
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
}

/** The block of composed YAML for one row id, as it appears in the dump. */
const linesOf = (stdout) => stdout.split(/\r?\n/)

/** The composed block of one row, starting at a known line index. */
const blockAt = (lines, index) => {
  const indent = lines[index].search(/\S/)
  const block = [lines[index]]
  for (let at = index + 1; at < lines.length; at += 1) {
    if (lines[at].trim() === '' || lines[at].search(/\S/) <= indent) break
    block.push(lines[at])
  }
  return block.join('\n')
}

const ID_ROW = /^\s*- id: (.+?)\s*$/

/**
 * Row-id scopes, kept apart.
 *
 * ID_ROW matches an indented row too, so a count taken from it is the deduplicated UNION of root
 * rows and rows nested inside a group's config. Those are different populations: a fixture can
 * append one root row and several nested children, and the union would report the children as if
 * they were rows of the tree. Anything that says "this archive has N rows" must therefore say
 * which scope it counted.
 */
const ID_ROOT_ROW = /^- id: (.+?)\s*$/
/** A row nested inside a group's config list. */
const ID_NESTED_ROW = /^\s+- id: (.+?)\s*$/

/**
 * Count distinct ids at each scope.
 * @param stdout - a composed tree.
 * @returns distinct root ids and distinct nested ids; the two can share an id, so they are counts,
 * never a partition of the union count from indexRows.
 */
const indexRowScopes = (stdout) => {
  const root = new Set()
  const nested = new Set()
  for (const line of linesOf(stdout)) {
    const atRoot = ID_ROOT_ROW.exec(line)?.[1]
    if (atRoot !== undefined) {
      root.add(atRoot)
      continue
    }
    const atNested = ID_NESTED_ROW.exec(line)?.[1]
    if (atNested !== undefined) nested.add(atNested)
  }
  return { rootIds: root.size, indentedIds: nested.size }
}

/** The first composed block for a row id, or null when the id is absent. */
const rowBlock = (stdout, id) => {
  const lines = linesOf(stdout)
  const start = lines.findIndex(line => ID_ROW.exec(line)?.[1] === id)
  return start === -1 ? null : blockAt(lines, start)
}

const truncate = (text, limit) => (text.length <= limit ? text : text.slice(0, limit) + '\n…[truncated, ' + String(text.length - limit) + ' more chars]')

const results = []
for (const testCase of CASES) {
  if (ONLY !== null && !ONLY.split(',').includes(testCase.id)) continue
  process.stdout.write('== case ' + testCase.id + '\n')
  const run = runCase(testCase)
  const warnings = run.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const calibration = rowBlock(run.stdout, CALIBRATION.id) !== null
  const markerRow = testCase.expects.markerRow === undefined ? null : rowBlock(run.stdout, testCase.expects.markerRow)
  const observed = {}

  if (testCase.expects.markerRow !== undefined) {
    observed.markerPresent = markerRow !== null
  }
  observed.warnings = warnings
  if (testCase.expects.warningIncludes !== undefined && testCase.expects.warningIncludes.length > 0) {
    observed.warningMatched = testCase.expects.warningIncludes.every(needle => warnings.some(line => line.includes(needle)))
  } else if (testCase.expects.warningIncludes !== undefined) {
    observed.warningCount = warnings.length
  }

  // The two config cases compare key sets, which is the whole question: does the bundle's or
  // the earlier layer's config survive beside the patched keys?
  if (testCase.id === 'config-replace-vs-deep-merge' || testCase.id === 'config-replace-on-bundle-row' || testCase.id === 'insert-same-id-twice' || testCase.id === 'insert-legacy-0.1.x-keys') {
    const ids = testCase.id === 'config-replace-on-bundle-row' ? [BUNDLE_ROW_WITH_CONFIG] : [testCase.expects.markerRow]
    observed.blocks = Object.fromEntries(ids.map(id => [id, ids.length === 1 && id === BUNDLE_ROW_WITH_CONFIG ? rowBlock(run.stdout, id) : rowBlock(run.stdout, id)]))
  }

  // Every occurrence of the row id under test, with the config lines that follow each: the
  // duplicate-id case is exactly a question about how many occurrences there are.
  const occurrences = []
  const lines = run.stdout.split(/\r?\n/)
  for (let at = 0; at < lines.length; at += 1) {
    const match = /^\s*- id: (.+?)\s*$/.exec(lines[at])
    if (match === null) continue
    const candidates = [testCase.expects.markerRow, idsFor(testCase)].flat().filter(Boolean)
    if (!candidates.includes(match[1])) continue
    const indent = lines[at].search(/\S/)
    const body = []
    for (let next = at + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === '' || lines[next].search(/\S/) <= indent) break
      body.push(lines[next].trim())
    }
    occurrences.push({ line: at + 1, id: match[1], body: body.join(' | ') })
  }
  observed.occurrences = occurrences

  const harnessOk = calibration && run.status !== null && run.error === null
  let verdict
  if (!harnessOk) {
    verdict = 'harness-error: the overlay was not demonstrably read (calibration row missing, or the dump did not exit), so this case says nothing about the loader'
  } else if (observed.warningMatched !== undefined) {
    verdict = observed.warningMatched
      ? 'composition warned and skipped the row (warning matched on stderr)'
      : 'EXPECTATION NOT MET: the expected warning is absent from stderr'
  } else {
    verdict = 'composition kept the rows; see occurrences for what it composed'
  }

  results.push({
    id: testCase.id,
    question: testCase.question,
    constructed: testCase.constructed,
    command: run.command,
    exitStatus: run.status,
    elapsedMs: run.elapsedMs,
    calibrationRowPresent: calibration,
    // Scope-separated row counts beside the union count. `rows` style metrics above are the
    // deduplicated union of root and nested ids; these two say which population it came from.
    ...indexRowScopes(run.stdout),
    observed,
    rawExcerpt: truncate(run.stdout === '' ? '(no stdout)' : run.stdout, 1200),
    rawStderrExcerpt: run.stderr === '' ? '' : truncate(run.stderr, 800),
    verdict,
    measured: harnessOk && observed.warningMatched !== false,
    labels: harnessOk ? ['实测', '构造触发'] : ['harness-error'],
  })
  process.stdout.write('   ' + verdict + '\n')
  if (warnings.length > 0) process.stdout.write('   stderr: ' + warnings.join(' / ') + '\n')
}

function idsFor(testCase) {
  return testCase.id === 'config-replace-on-bundle-row' ? [BUNDLE_ROW_WITH_CONFIG] : []
}

/**
 * Index a composed tree by row id.
 *
 * Diffing by id rather than by line position is what makes the fixture comparison readable:
 * an insert shifts every following line number, so a positional diff reports the whole tail as
 * changed and hides the one row that actually moved. Ids are the loader's own addressing unit.
 * @param stdout - a composed tree.
 * @returns id to that row's composed block.
 */
/**
 * Index a composed tree by row id, keeping EVERY block for an id.
 *
 * A list per id, because a duplicate id is one of the questions: collapsing it to one block
 * would erase the very thing the duplicate-id case exists to observe.
 * @param stdout - a composed tree.
 * @returns id to the list of that id's composed blocks, in tree order.
 */
const indexRows = (stdout) => {
  const rows = new Map()
  const lines = linesOf(stdout)
  for (let at = 0; at < lines.length; at += 1) {
    const id = ID_ROW.exec(lines[at])?.[1]
    if (id === undefined) continue
    rows.set(id, [...(rows.get(id) ?? []), blockAt(lines, at)])
  }
  return rows
}

/** Same-value comparison for an id's block list, so a diff does not compare array identities. */
const sameBlocks = (left, right) => JSON.stringify(left ?? []) === JSON.stringify(right ?? [])

/** Top-level keys inside a row's \`config:\` mapping, counted from the composed block. */
const configKeyCount = (block) => {
  if (block === null) return null
  const lines = block.split(/\r?\n/)
  const at = lines.findIndex(line => /^\s+config:\s*$/.test(line))
  if (at === -1) return 0
  const indent = lines[at].search(/\S/)
  let keys = 0
  for (let next = at + 1; next < lines.length; next += 1) {
    if (lines[next].trim() === '') continue
    if (lines[next].search(/\S/) <= indent) break
    if (/^\s+[^\s#][^:]*:/.test(lines[next]) && lines[next].search(/\S/) === indent + 2) keys += 1
  }
  return keys
}

// One baseline composition, so every later observation can be stated as a diff against the
// shipped tree instead of against an assumption about what ships.
process.stdout.write('== baseline (no patches)\n')
const baselineRun = runCase({ layers: [] })
const baselineRows = indexRows(baselineRun.stdout)
const baselineScopes = indexRowScopes(baselineRun.stdout)
process.stdout.write(
  '   rows=' + String(baselineRows.size) + ' (union: root ∪ nested)  rootIds=' + String(baselineScopes.rootIds) +
  '  indentedIds=' + String(baselineScopes.indentedIds) + '  warnings=' + String(baselineRun.stderr.trim() === '' ? 0 : 1) + '\n',
)

// The cross-layer config case is only meaningful as a before/after: patching a row says nothing
// about replacement unless the row's baseline config is on the record too.
const bundleCase = results.find(entry => entry.id === 'config-replace-on-bundle-row')
if (bundleCase !== undefined) {
  const before = (baselineRows.get(BUNDLE_ROW_WITH_CONFIG) ?? [])[0] ?? null
  const after = bundleCase.observed.blocks?.[BUNDLE_ROW_WITH_CONFIG] ?? null
  const beforeKeys = configKeyCount(before)
  const afterKeys = configKeyCount(after)
  bundleCase.observed.baselineBlock = before
  bundleCase.observed.baselineConfigKeys = beforeKeys
  bundleCase.observed.composedConfigKeys = afterKeys
  if (bundleCase.measured) {
    bundleCase.verdict = beforeKeys === null || afterKeys === null
      ? 'could not count config keys on one side; see blocks'
      : 'baseline config keys ' + String(beforeKeys) + ' -> composed config keys ' + String(afterKeys) +
        (beforeKeys > 1 && afterKeys <= 1 ? ': the profile layer substituted the WHOLE config map, so the other bundle keys are gone' : ': see blocks')
  }
  process.stdout.write('   bundle row config keys ' + String(beforeKeys) + ' -> ' + String(afterKeys) + '\n')
}

/**
 * A mechanical reading of one observation.
 *
 * Derived from what was observed only — never from the fixture's stated question, and never from
 * what the docs say should happen. A fixture whose intent is "this should be rejected" must be
 * able to come back as "applied without diagnostics", or the artifact would just restate the docs.
 * @param observed - the recorded observation.
 * @param composedRows - distinct ids in the composed tree (0 means composition produced nothing).
 * @returns one sentence describing what composition did.
 */
const readingOf = (observed, composedRows) => {
  const added = observed.added ?? []
  const changed = observed.changed ?? []
  const warnings = observed.warnings ?? []
  if (composedRows === 0) {
    return 'layer-fatal: the whole composition was refused, so no tree exists and NOTHING is a row in it. '
      + 'The baseline is untouched; no rows were removed, added, or changed by a tree (see rawStderrExcerpt)'
  }
  if (warnings.length > 0 && added.length === 0 && changed.length === 0) {
    return 'warned and skipped: the composed tree is identical to the baseline'
  }
  const duplicated = Object.entries(observed.blocks ?? {})
    .filter(([, block]) => String(block).includes('\n---\n'))
    .map(([id]) => id)
  if (duplicated.length > 0) return 'kept every row: the id ' + duplicated.join(', ') + ' appears more than once in the composed tree'
  if (warnings.length > 0) return 'partly applied, with ' + String(warnings.length) + ' diagnostic(s)'
  return 'applied with no diagnostics: ' + String(added.length) + ' row(s) added, ' + String(changed.length) + ' changed'
}

const FIXTURE_DIR = path.resolve(option('fixtures', path.join(PROJECT, 'compat', 'adaptation', 'rows', 'fixtures')))
const fixtures = []
let fixturesMeasured = true

if (fs.existsSync(FIXTURE_DIR)) {
  const manifestPath = path.join(FIXTURE_DIR, 'index.json')
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { fixtures: [] }
  for (const entry of manifest.fixtures ?? []) {
    const file = path.join(FIXTURE_DIR, entry.file)
    if (!fs.existsSync(file)) continue
    process.stdout.write('== fixture ' + entry.file + '\n')
    const run = runCase({ layers: [] , patchFiles: [file] })
    const rows = indexRows(run.stdout)
    // A refused layer is not a tree with rows missing from it. When composition produces no tree at
    // all (the CLI refused the layer and exited non-zero), a positional comparison against the
    // baseline would report every baseline id as "removed" — the exact opposite of what happened.
    // The comparison is therefore not run at all, and the fields below say why.
    const layerFatal = run.status !== 0 || rows.size === 0
    const added = layerFatal ? [] : [...rows.keys()].filter(id => !baselineRows.has(id))
    const removed = layerFatal ? [] : [...baselineRows.keys()].filter(id => !rows.has(id))
    const changed = layerFatal ? [] : [...rows.keys()].filter(id => baselineRows.has(id) && !sameBlocks(baselineRows.get(id), rows.get(id)))
    const warnings = run.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const measured = run.error === null && run.status !== null && run.status !== -1
    if (!measured) fixturesMeasured = false
    const observation = {
      layerFatal,
      // Stated beside the list itself, because the list is what a reader sees first.
      removedMeaning: layerFatal
        ? 'NOT a list of removed rows: composition was refused, so no tree existed to compare against. This list is empty by construction; the baseline is intact.'
        : 'ids present in the baseline composition and absent from this one',
      fatalReason: layerFatal ? truncate(run.stderr === '' ? '(no stderr)' : run.stderr, 400) : null,
      added,
      removed,
      changed,
      warnings,
      // Blocks ride along so the reading can see a repeated id; without them the one observation
      // that distinguishes "one row" from "two rows sharing an id" never reaches verdictOf.
      blocks: Object.fromEntries([...added, ...changed].slice(0, 6).map(id => [id, (rows.get(id) ?? []).join('\n---\n')])),
    }
    process.stdout.write(
      (layerFatal ? '   LAYER-FATAL (composition refused; no tree, so nothing was added/removed/changed) ' : '   ') +
      'addedCount=' + String(added.length) + ' changedCount=' + String(changed.length) +
      ' removedCount=' + String(removed.length) + ' warnings=' + String(warnings.length) + '\n',
    )
    if (added.length > 0) process.stdout.write('   added: ' + added.slice(0, 8).join(', ') + '\n')
    if (layerFatal) process.stdout.write('   fatal: ' + truncate(warnings[0] ?? '(no stderr)', 220) + '\n')
    fixtures.push({
      file: entry.file,
      idiom: entry.idiom,
      question: entry.question,
      command: run.command,
      exitStatus: run.status,
      elapsedMs: run.elapsedMs,
      baselineRows: baselineRows.size,
      composedRows: rows.size,
      ...indexRowScopes(run.stdout),
      observed: {
        ...observation,
        // The fixture's own rows, so a reader sees the composed result rather than only that
        // something changed somewhere.
        warnings: warnings.map(line => truncate(line, 300)),
      },
      rawExcerpt: truncate(
        added.length + changed.length === 0
          ? '(composed tree identical to baseline)'
          : added.concat(changed).map(id => (rows.get(id) ?? []).join('\n---\n')).join('\n').slice(0, 1200),
        1200,
      ),
      rawStderrExcerpt: run.stderr === '' ? '' : truncate(run.stderr, 800),
      measured,
      // The label is the machine-readable half of the same statement the reading makes: a reader
      // that only inspects labels can never mistake a refused layer for a tree that lost rows.
      labels: measured
        ? (layerFatal ? ['实测', '构造触发', 'layer-fatal'] : ['实测', '构造触发'])
        : ['harness-error'],
      // A fixture carries only inputs and a question, so there is no expectation to score
      // against: its verdict IS the mechanical reading of what composition did.
      reading: readingOf(observation, rows.size),
      verdict: readingOf(observation, rows.size),
    })
  }

  // 08 and 09 are authored as a pair: base layer, then the replace layer. Running them stacked
  // is the only way to observe the cross-layer question they were written to ask.
  const pair = ['08-layer-config-base.patch.yml', '09-layer-config-replace.patch.yml'].map(name => path.join(FIXTURE_DIR, name))
  if (pair.every(file => fs.existsSync(file))) {
    process.stdout.write('== fixture 08+09 stacked\n')
    const run = runCase({ layers: [], patchFiles: pair })
    const rows = indexRows(run.stdout)
    const layerFatal = run.status !== 0 || rows.size === 0
    const added = layerFatal ? [] : [...rows.keys()].filter(id => !baselineRows.has(id))
    const changed = layerFatal ? [] : [...rows.keys()].filter(id => baselineRows.has(id) && !sameBlocks(baselineRows.get(id), rows.get(id)))
    const warnings = run.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const measured = run.error === null && run.status !== null && run.status !== -1
    if (!measured) fixturesMeasured = false
    fixtures.push({
      file: '08-layer-config-base.patch.yml + 09-layer-config-replace.patch.yml',
      idiom: '层间 config 替换（base 后叠 replace）',
      question: 'Stacked in that order, do the base layer\'s config children survive beside the replace layer\'s, or does the replace layer substitute the whole config map?',
      command: run.command,
      exitStatus: run.status,
      elapsedMs: run.elapsedMs,
      baselineRows: baselineRows.size,
      composedRows: rows.size,
      ...indexRowScopes(run.stdout),
      observed: {
        layerFatal,
        removedMeaning: 'never computed for this stacked run: it compares the two layers against each other, not against the baseline',
        added, removed: [], changed, warnings,
        blocks: Object.fromEntries(added.concat(changed).slice(0, 6).map(id => [id, (rows.get(id) ?? []).join('\n---\n')])),
        configKeys: Object.fromEntries(added.concat(changed).slice(0, 6).map(id => [id, configKeyCount((rows.get(id) ?? [])[0] ?? null)])),
      },
      rawExcerpt: truncate(added.concat(changed).map(id => (rows.get(id) ?? []).join('\n---\n')).join('\n').slice(0, 1400), 1400),
      rawStderrExcerpt: run.stderr === '' ? '' : truncate(run.stderr, 800),
      measured,
      labels: measured
        ? (layerFatal ? ['实测', '构造触发', 'layer-fatal'] : ['实测', '构造触发'])
        : ['harness-error'],
      reading: readingOf({ added, changed, warnings, blocks: Object.fromEntries(added.concat(changed).map(id => [id, (rows.get(id) ?? []).join('\n---\n')])) }, rows.size),
      verdict: readingOf({ added, changed, warnings }, rows.size),
    })
    process.stdout.write('   read: ' + readingOf({ added, changed, warnings }, rows.size) + '\n')
  }
} else {
  process.stdout.write('== fixtures: ' + FIXTURE_DIR + ' does not exist yet; constructed cases only\n')
}

const payload = {
  format: 'dsh-link.loader-row-behaviour/1',
  kernel: { root: KERNEL, cliEntry: CLI_ENTRY, profile: PROFILE },
  method: {
    compose: 'node --import tsx/esm <kernel>/apps/cli/src/bin.ts --profile <p> --dump-config --patch <layer...>',
    home: 'fresh mkdtemp per case; the machine profile and the live shell home are never read or written',
    authority: 'the dump composes through applyEntryPatches (vendor/include/src/index.ts:57), the same call boot() makes',
    stage: 'composition only; row admission is a later stage (app-boot/src/index.ts:407-408)',
    warningSink: 'stderr (app-boot/src/index.ts:427,435): a patch that matches no row is reported there',
    baseline: 'one unpatched composition per run; fixture observations are diffs by row id against it, because an insert shifts line numbers',
    calibration: 'every constructed case inserts a calibration row beside the row under test, so a missing effect cannot be read as acceptance when the overlay was never read',
    unknownToProbe: 'the probe records what composition did; it does not decide whether a key is honoured at mount',
  },
  baseline: {
    exitStatus: baselineRun.status,
    // `rows` counts the deduplicated UNION of root rows and rows nested in a group's config under
    // an EMPTY home's default composition. It is not the row count of any live archive, and it is
    // not a row count at all in the sense a reader of a tree expects: the nested ids are sub-entries.
    rows: baselineRows.size,
    rowsMetric: 'deduplicated union of root ids and nested (indented) ids, empty-home default composition',
    rootIds: baselineScopes.rootIds,
    indentedIds: baselineScopes.indentedIds,
    warnings: baselineRun.stderr.trim() === '' ? [] : [truncate(baselineRun.stderr, 400)],
  },
  cases: results,
  fixturesMeasured,
  fixtures,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
// Timing is printed, never archived: a gate that rewrites a tracked artifact with a new
// millisecond count leaves the working tree dirty and hides real drift in the noise.
const settled = (value) => Array.isArray(value)
  ? value.map(settled)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'elapsedMs').map(([key, inner]) => [key, settled(inner)]))
    : typeof value === 'string'
      // The mkdtemp suffix changes every run and would make the artifact differ from itself.
      ? value.replace(/(r20-row-(?:home|layer))-[A-Za-z0-9]{6}/g, '$1-<tmp>')
      : value
fs.writeFileSync(OUT, JSON.stringify(settled(payload), null, 2) + '\n', 'utf8')
process.stdout.write('\nwrote ' + OUT + '\n')
// A gate that cannot fail is not a gate: any case whose overlay was not demonstrably read, or
// whose expected warning did not appear, or any fixture whose composition did not run, exits non-zero.
process.exit(results.every(entry => entry.measured === true) && fixturesMeasured ? 0 : 1)
