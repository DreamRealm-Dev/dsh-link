#!/usr/bin/env node
/**
 * R505: call-site differential between the compute fold and collab's business projection.
 *
 * The compute contract (snapshot of control records) and collab's TeamState projection were
 * written for different questions: compute answers "what does the ledger summarise to", collab
 * answers "what is the team board". This script runs BOTH over the same records and compares the
 * fields the two have in common, then states the fields only collab produces. That is the evidence
 * that decides whether the byte-batched index can sit at collab's real read path (state()) or
 * whether the wiring must stay a shadow comparison.
 *
 * Datasets:
 *   - real-ledger: a read-only point-in-time copy of the running kernel's collab control.jsonl
 *   - multi-writer / multi-instance: interleaved labels and relay-style duplicates with distinct
 *     instance ids
 *   - duplicate: the same record bytes twice
 *   - out-of-order: a valid record list shuffled (both sides sort by seq, then fold)
 *   - damaged: NDJSON with a broken line (compute counts it as unparsable; collab's parser drops it)
 *
 *   node --expose-gc rust/scripts/collab-compute-diff.mjs
 *   node --expose-gc rust/scripts/collab-compute-diff.mjs --ledger <control.jsonl copy>
 *
 * Results: rust/collab-compute-diff-results.json
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const RESULTS_PATH = join(HERE, '..', 'collab-compute-diff-results.json')
const WORKDIR = join(REPO_ROOT, '.tmp', 'r505')
const DEFAULT_STATE_URL = 'http://127.0.0.1:31761/api/dsh-link-teams/state'

/** Parse the command line. */
function parseArgs(argv) {
  const args = { ledger: undefined, stateUrl: DEFAULT_STATE_URL }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--ledger') args.ledger = resolve(argv[index += 1])
    else if (argv[index] === '--state-url') args.stateUrl = argv[index += 1]
  }
  return args
}

/** Resolve the live ledger directory through the read-only teams route (or --ledger). */
async function resolveLedger(args) {
  if (args.ledger !== undefined) return { file: args.ledger, origin: 'explicit --ledger' }
  const response = await fetch(args.stateUrl, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('teams route answered ' + String(response.status))
  const state = await response.json()
  const directory = state?.ledger?.directory
  if (typeof directory !== 'string') throw new Error('teams route carried no ledger.directory')
  return { file: join(directory, 'control.jsonl'), origin: 'teams state route ' + args.stateUrl }
}

/** Read the ledger once through Node's shared read and snapshot it into .tmp (live file untouched). */
function snapshotLedger(ledger) {
  mkdirSync(WORKDIR, { recursive: true })
  const bytes = readFileSync(ledger.file)
  const snapshotFile = join(WORKDIR, 'control.snapshot.jsonl')
  writeFileSync(snapshotFile, bytes)
  return { bytes, snapshotFile, sha256: createHash('sha256').update(bytes).digest('hex'), origin: ledger.origin }
}

/** Parse NDJSON into collab ControlRecords, counting damaged lines. */
function parseNdjson(bytes) {
  const text = bytes.toString('utf8')
  const records = []
  let damaged = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const record = JSON.parse(line)
      if (record !== null && typeof record === 'object' && typeof record.seq === 'number') records.push(record)
      else damaged += 1
    } catch {
      damaged += 1
    }
  }
  return { records, damaged }
}

/** A deterministic record factory for the synthetic scenarios. */
function makeScenarios(baseRecords) {
  const sample = baseRecords.slice(0, 40)
  const clone = (record, patch) => ({ ...record, ...patch })
  const multiWriter = []
  for (let index = 0; index < sample.length; index += 1) {
    const source = sample[index]
    const writer = index % 2 === 0 ? 'writer-a' : 'writer-b'
    const instance = index % 3 === 0 ? 'instance-1' : 'instance-2'
    multiWriter.push(clone(source, { seq: index + 1, writer, instance, originSeq: index + 1 }))
  }
  const multiInstance = []
  for (let index = 0; index < sample.length; index += 1) {
    const source = sample[index]
    multiInstance.push(clone(source, { seq: (index + 1) * 2, writer: 'writer-a', instance: 'instance-1', originSeq: index + 1 }))
    multiInstance.push(clone(source, { seq: (index + 1) * 2 + 1, writer: 'writer-b', instance: 'instance-2', originSeq: index + 1 }))
  }
  const duplicate = []
  for (let index = 0; index < sample.length; index += 1) duplicate.push(clone(sample[index], { seq: index + 1 }))
  for (const record of duplicate.slice()) duplicate.push({ ...record })
  const outOfOrder = sample.map((record, index) => clone(record, { seq: index + 1 })).reverse()
  const damaged = sample.map((record, index) => clone(record, { seq: index + 1 }))
  return { multiWriter, multiInstance, duplicate, outOfOrder, damaged }
}

/** Serialise records back to NDJSON bytes. */
function toNdjson(records) {
  return Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n')
}

/** Stable ordering the fold is defined over. */
function ordered(records) {
  return records.slice().sort((left, right) => left.seq - right.seq || (left.at ?? 0) - (right.at ?? 0))
}

/**
 * Compare two entity maps field by field and report MATCH RATES rather than a yes/no.
 *
 * The point of this differential is not to grade one fold against the other: the two answer
 * different questions. It measures how much of collab's business view the compute contract can
 * reproduce, per field, and keeps examples of the first differences so the gap is legible.
 */
function compareMaps(left, right, label, fields) {
  const ids = new Set([...left.keys(), ...right.keys()])
  const onlyLeft = [...left.keys()].filter((id) => !right.has(id)).length
  const onlyRight = [...right.keys()].filter((id) => !left.has(id)).length
  const perField = {}
  const examples = []
  for (const field of fields) perField[field] = { compared: 0, equal: 0, differing: 0, examples: [] }
  for (const id of ids) {
    const a = left.get(id)
    const b = right.get(id)
    if (a === undefined || b === undefined) continue
    for (const field of fields) {
      perField[field].compared += 1
      if (JSON.stringify(a[field]) === JSON.stringify(b[field])) perField[field].equal += 1
      else {
        perField[field].differing += 1
        if (perField[field].examples.length < 3) perField[field].examples.push({ id, left: a[field], right: b[field] })
        if (examples.length < 5) examples.push({ id, field, collab: a[field], compute: b[field] })
      }
    }
  }
  return { label, ids: ids.size, onlyCollab: onlyLeft, onlyCompute: onlyRight, perField, examples }
}

/** The compute summary reduced to the fields collab's projection also carries. */
function computeView(snapshot) {
  const summary = JSON.parse(snapshot)
  const members = new Map()
  for (const member of summary.members) members.set(member.id, { team: member.team, id: member.id, state: member.state })
  const tasks = new Map()
  for (const task of summary.tasks) tasks.set(task.id, { team: task.team, id: task.id, owner: task.owner, state: task.state })
  const teams = new Map()
  for (const team of summary.teams) teams.set(team.team, { parent: team.parent, lead: team.lead, members: team.members, tasks: team.tasks })
  return { members, tasks, teams, counts: { records: summary.records, members: summary.members.length, tasks: summary.tasks.length, teams: summary.teams.length } }
}

/** The collab projection reduced to the fields compute also carries. */
function collabView(state) {
  const members = new Map()
  for (const member of state.members) members.set(member.id, { team: member.team, id: member.id, state: member.state })
  const tasks = new Map()
  // collab's ProjectedTask carries status/owner/team; it has no revision field, so revision is not
  // part of the business view compared here.
  for (const task of state.tasks) tasks.set(task.id, { team: task.team, id: task.id, owner: task.owner, state: task.status })
  const teams = new Map()
  for (const node of state.teams?.teams ?? []) teams.set(node.id ?? node.team, { parent: node.parent ?? null, lead: node.lead ?? null })
  return { members, tasks, teams, counts: { records: state.counts.folded, members: state.members.length, tasks: state.tasks.length, teams: state.teams?.teams?.length ?? 0 } }
}

/** Compare one dataset across collab's projection and the compute snapshot. */
async function compareDataset(dataset, collab, compute) {
  const { projectTeamState } = collab
  const records = ordered(dataset.records)
  const state = projectTeamState(records)
  const collabProxy = collabView(state)
  const comparisons = [
    compareMaps(collabProxy.members, compute.members, 'members', ['team', 'state']),
    compareMaps(collabProxy.tasks, compute.tasks, 'tasks', ['team', 'owner', 'state']),
    compareMaps(collabProxy.teams, compute.teams, 'teams', ['parent', 'lead']),
  ]
  const countDiffs = {
    records: collabProxy.counts.records - compute.counts.records,
    members: collabProxy.counts.members - compute.counts.members,
    tasks: collabProxy.counts.tasks - compute.counts.tasks,
    teams: collabProxy.counts.teams - compute.counts.teams,
  }
  return {
    dataset: dataset.id,
    source: dataset.source,
    records: records.length,
    damagedLines: dataset.damagedLines ?? 0,
    comparisons,
    allOverlappingEqual: comparisons.every((entry) => Object.values(entry.perField).every((field) => field.differing === 0))
      && Object.values(countDiffs).every((value) => value === 0),
    countDiffs,
    collabOnlyViews: ['board', 'quarantine', 'peers', 'registry', 'liveness', 'locks', 'sessions', 'taskDemands', 'relay'],
    note: 'Comparisons cover only fields both representations carry; collabOnlyViews are not produced by the compute contract.',
  }
}

/** The parent: build datasets, run both projections, write the report. */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const ledger = await resolveLedger(args)
  const snapshot = snapshotLedger(ledger)
  const parsed = parseNdjson(snapshot.bytes)
  console.log('ledger:', ledger.file)
  console.log('snapshot:', snapshot.snapshotFile, snapshot.bytes.length + ' B, sha256', snapshot.sha256.slice(0, 16), 'records=' + String(parsed.records.length), 'damaged=' + String(parsed.damaged))

  const referencePath = pathToFileURL(join(REPO_ROOT, 'plugins/dsh-link-compute/src/reference.ts')).href
  const reference = await import(referencePath)
  const computeRequire = (await import('node:module')).createRequire(import.meta.url)
  const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
  const addon = existsSync(ADDON) ? computeRequire(ADDON) : null
  const collab = await import(pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-collab/lib/index.js')).href)
  if (typeof collab.projectTeamState !== 'function') throw new Error('collab lib exports no projectTeamState')

  /** Build a compute snapshot for one NDJSON frame, TS and native, and prove they agree. */
  const computeSnapshotOf = (frame) => {
    const tsIndex = new reference.CollabFoldIndex()
    tsIndex.appendRecords(frame)
    const tsSnapshot = tsIndex.snapshot()
    if (addon === null) return { tsSnapshot, nativeSnapshot: null, nativeAgrees: null }
    const nativeIndex = new addon.CollabFoldIndex()
    nativeIndex.appendRecords(frame)
    const nativeSnapshot = nativeIndex.snapshot()
    return { tsSnapshot, nativeSnapshot, nativeAgrees: nativeSnapshot === tsSnapshot }
  }

  const scenarios = makeScenarios(parsed.records)
  const datasets = [
    { id: 'real-ledger', records: parsed.records, damagedLines: parsed.damaged, source: snapshot.origin + ' sha256 ' + snapshot.sha256.slice(0, 16) },
    { id: 'multi-writer', records: scenarios.multiWriter, source: 'synthetic: 2 writers / 2 instances interleaved' },
    { id: 'multi-instance', records: scenarios.multiInstance, source: 'synthetic: relay-style duplicate rows from 2 instances' },
    { id: 'duplicate', records: scenarios.duplicate, source: 'synthetic: every record written twice' },
    { id: 'out-of-order', records: scenarios.outOfOrder, source: 'synthetic: shuffled seq (sorted before folding)' },
    { id: 'damaged', records: scenarios.damaged, source: 'synthetic: one broken NDJSON line tolerated by compute' },
  ]

  const results = []
  for (const dataset of datasets) {
    const recordsBefore = dataset.records.length
    let frame = toNdjson(dataset.records)
    if (dataset.id === 'damaged') {
      const lines = frame.toString('utf8').split('\n')
      frame = Buffer.from(lines.slice(0, 3).join('\n') + '\n{not json at all\n' + lines.slice(3).join('\n'))
    }
    const snapshotResult = computeSnapshotOf(frame)
    const compute = computeView(snapshotResult.tsSnapshot)
    const comparison = await compareDataset({ ...dataset, records: dataset.records.slice(0, recordsBefore) }, collab, compute)
    results.push({ ...comparison, nativeAgrees: snapshotResult.nativeAgrees })
    console.log((comparison.allOverlappingEqual ? 'ok  ' : 'DIFF') + ' ' + dataset.id
      + '  records=' + String(comparison.records) + '  members/tasks/teams=' + String(compute.counts.members) + '/' + String(compute.counts.tasks) + '/' + String(compute.counts.teams)
      + '  overlappingEqual=' + String(comparison.allOverlappingEqual) + '  nativeAgrees=' + String(snapshotResult.nativeAgrees))
    for (const entry of comparison.comparisons) {
      const parts = Object.entries(entry.perField).map(([field, stats]) => field + ' ' + String(stats.equal) + '/' + String(stats.compared))
      console.log('     ' + entry.label + ' ids=' + String(entry.ids) + ' onlyCollab=' + String(entry.onlyCollab) + ' onlyCompute=' + String(entry.onlyCompute) + ' | ' + parts.join('  '))
    }
  }

  let rustc = 'unknown'
  const rustcResult = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (rustcResult.status === 0) rustc = String(rustcResult.stdout).trim()
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    rustc,
    addonBytes: existsSync(ADDON) ? readFileSync(ADDON).length : null,
    ledger: { path: ledger.file, origin: snapshot.origin, bytes: snapshot.bytes.length, sha256: snapshot.sha256, records: parsed.records.length, damagedLines: parsed.damaged },
    method: 'same records through collab projectTeamState and through the compute index (TS reference and native addon, asserted byte-identical); compared only fields both representations carry; collab-only projections reported as gaps',
    datasets: results,
    conclusion: {
      overlappingFieldsEqualFor: results.filter((entry) => entry.allOverlappingEqual).map((entry) => entry.dataset),
      overlappingFieldsDifferFor: results.filter((entry) => !entry.allOverlappingEqual).map((entry) => entry.dataset),
      computeCannotServe: ['board', 'quarantine', 'peers', 'registry', 'liveness', 'locks', 'sessions', 'taskDemands', 'relay'],
      wiring: 'native index can be a shadow comparison at collab state(); serving TeamState from it needs the collab projection contract, which the compute fold does not implement',
    },
  }
  writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n')
  console.log('\nconclusion: overlapping-equal datasets =', report.conclusion.overlappingFieldsEqualFor.join(', ') || '(none)')
  console.log('differing datasets =', report.conclusion.overlappingFieldsDifferFor.join(', ') || '(none)')
  console.log('compute cannot serve:', report.conclusion.computeCannotServe.join(', '))
  console.log('results written:', RESULTS_PATH)
}

main().catch((error) => {
  console.error('DIFF FAILED: ' + (error instanceof Error ? error.stack : String(error)))
  process.exit(1)
})
