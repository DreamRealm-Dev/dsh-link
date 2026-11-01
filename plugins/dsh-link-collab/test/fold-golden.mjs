#!/usr/bin/env node
/**
 * Golden capture for the collab fold (R496).
 *
 * The checkpoint work restructures the fold internals (every projection is split into a resumable
 * step and a materialise step) while the CONTRACT is that a full fold answers byte for byte what it
 * answered before. This script pins that contract: it folds a fixed fixture set through the shipped
 * artifact and writes one sha256 per (fixture, surface) to test/fixtures/fold-golden.json.
 *
 * The golden file is captured from the artifact built BEFORE the refactor and verified after it.
 * It is not a substitute for the differential suite (test/fold-checkpoint.spec.mjs), which compares
 * two paths of the SAME build; this one compares two builds.
 *
 *   node plugins/dsh-link-collab/test/fold-golden.mjs --capture   # write the golden file
 *   node plugins/dsh-link-collab/test/fold-golden.mjs            # verify (default)
 *
 * Exit 0 every hash matches | 1 a hash differs (or the golden is missing) | 3 the artifact could not be imported.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixtureSets } from './fold-fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
const GOLDEN = join(HERE, 'fixtures', 'fold-golden.json')
const CAPTURE = argv.includes('--capture')

let module
try {
  module = await import(pathToFileURL(MODULE_PATH).href)
} catch (error) {
  console.error('could not import the artifact at ' + MODULE_PATH + ': ' + (error && error.message ? error.message : String(error)))
  process.exit(3)
}

/** The surfaces the golden file pins: the whole state, then every exported projection. */
const PROJECTIONS = [
  'projectLocks', 'projectBoard', 'projectPeers', 'projectTeams', 'projectRegistry', 'projectTaskDemands',
  'projectLiveness', 'projectQuarantine', 'projectSessions', 'projectHosting', 'projectManifests',
  'projectMerges', 'projectAdapters', 'projectDispatches', 'projectRetryLeases',
]

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const hash = (value) => {
  try { return sha256(JSON.stringify(value)) } catch { return 'unserialisable' }
}

/** Hash every surface for one fixture. */
function captureSet(records) {
  const out = { projectTeamState: hash(module.projectTeamState(records)) }
  for (const name of PROJECTIONS) {
    const fn = module[name]
    out[name] = typeof fn === 'function' ? hash(fn(records)) : 'missing'
  }
  out.controlPage = typeof module.controlPage === 'function'
    ? hash(module.controlPage(records, { limit: 100 }))
    : 'missing'
  out.readySet = typeof module.readySet === 'function'
    ? hash(module.readySet(records, { asKeys: true }))
    : 'missing'
  return out
}

const libHash = createHash('sha256').update(readFileSync(MODULE_PATH)).digest('hex')
const sets = fixtureSets()
const captures = {}
for (const [name, records] of sets) {
  const started = Date.now()
  captures[name] = captureSet(records)
  if (name === 'mixed-100k') console.error('captured 100k in ' + String(Date.now() - started) + ' ms')
}

if (CAPTURE) {
  const document = {
    format: 'dsh-link.collab.fold-golden/1',
    capturedFrom: { artifact: 'lib/index.js', sha256: libHash },
    note: 'Captured before the R496 resumable-fold refactor; a match proves the full fold is byte-identical after it.',
    sets: captures,
  }
  mkdirSync(dirname(GOLDEN), { recursive: true })
  writeFileSync(GOLDEN, JSON.stringify(document, null, 2) + '\n')
  console.log('captured ' + String(sets.length) + ' fixture sets into ' + GOLDEN)
  console.log('artifact sha256 ' + libHash)
  process.exit(0)
}

let golden
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
} catch (error) {
  console.error('missing or unreadable golden file ' + GOLDEN + ': ' + String(error && error.message ? error.message : error))
  process.exit(1)
}

let failed = 0
for (const [name, records] of sets) {
  const expected = golden.sets?.[name]
  if (expected === undefined) {
    console.log('FAIL ' + name + ' :: no golden entry')
    failed += 1
    continue
  }
  const actual = captureSet(records)
  let setFailed = false
  for (const surface of Object.keys(expected)) {
    if (actual[surface] !== expected[surface]) {
      console.log('FAIL ' + name + ' / ' + surface + ' :: ' + String(actual[surface]) + ' != ' + String(expected[surface]))
      setFailed = true
    }
  }
  if (setFailed) failed += 1
  else console.log('PASS ' + name + ' :: all ' + String(Object.keys(expected).length) + ' surfaces byte-identical')
}
console.log(failed === 0
  ? 'fold golden: ' + String(sets.length) + ' fixture sets identical to the captured artifact (' + String(golden.capturedFrom?.sha256 ?? '?').slice(0, 12) + ')'
  : 'fold golden: ' + String(failed) + ' fixture set(s) differ')
process.exit(failed === 0 ? 0 : 1)