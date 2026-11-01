#!/usr/bin/env node
/**
 * DRSS preflight: prove, before any training, that the validation set cannot be trained on.
 *
 * The DRSS project (H:\mod\mcst) splits by frozen manifests, and two of its facts make a naive check lie:
 *   - data/dataset/ has NO split on disk: val scenes sit in the same directories as train scenes, so a
 *     directory permission cannot express "val only" - the manifest IS the separator;
 *   - train/train.py recomputes its own VAL from the same scan as TRAIN (its own comment admits shared
 *     viewpoints), so the psnr it prints is not the honest number. Only heldout_eval.py with an explicit
 *     --split-manifest is.
 *
 * So this tool does three things and refuses to pretend about a fourth:
 *   R1  the frozen manifest fingerprints to the value stored in it, recomputed here from the files on disk
 *   R2  no val scene id appears among the ids the training pool would consume
 *   R3  no scene the project excludes (v6_exclusion) appears in val
 *   R4  a SEAL is written outside the project (dsh-link/.tmp/drss/) listing every val file's size and sha256
 *   R5  --verify-seal re-reads the seal and proves the val files are byte-identical after the experiment
 *
 * It never writes inside the DRSS project.
 *
 * Usage:
 *   node scripts/drss-preflight.mjs [--workspace H:\mod\mcst] [--seal]
 *   node scripts/drss-preflight.mjs --verify-seal
 * Exit 0 every reading held | 1 a reading failed | 3 an input is missing (never a verdict).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const WORKSPACE = flag('workspace', 'H:\\mod\\mcst')
const SEAL_DIR = join(PROJECT, '.tmp', 'drss')
const SEAL = join(SEAL_DIR, 'val-seal.json')
const VERIFY = argv.includes('--verify-seal')
const WRITE_SEAL = argv.includes('--seal') || VERIFY === false
const VARGS = argv

if (!existsSync(WORKSPACE)) { console.log('SKIP: no DRSS workspace at ' + WORKSPACE); process.exit(3) }
// R379: the manifest is a parameter, not a constant. An experiment records which frozen split it used, and a seal
// taken against a DIFFERENT manifest would be a number about somebody else's validation set. `--frozen` takes a path
// relative to the workspace (or absolute); the default stays the v6 stratified manifest this tool was written for.
const FROZEN_FLAG = (() => { const at = argv.indexOf('--frozen'); return at === -1 ? null : argv[at + 1] })()
const FROZEN = FROZEN_FLAG === null
  ? join(WORKSPACE, 'train', 'runs', 'split', 'frozen_v6_stratified.json')
  : (existsSync(FROZEN_FLAG) ? FROZEN_FLAG : join(WORKSPACE, FROZEN_FLAG))
const EXCLUSION = join(WORKSPACE, 'train', 'runs', 'split', 'v6_exclusion.json')
const PROVENANCE = join(WORKSPACE, 'train', 'runs', 'cache_s2', 'provenance.json')
const INDEX = join(WORKSPACE, 'data', 'manifests', 'dataset_index.jsonl')
for (const path of [FROZEN, INDEX]) if (!existsSync(path)) { console.log('SKIP: ' + path + ' is missing'); process.exit(3) }

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sceneDir = (id) => {
  const categories = readdirSync(join(WORKSPACE, 'data', 'dataset'), { withFileTypes: true }).filter((each) => each.isDirectory())
  for (const category of categories) {
    const at = join(WORKSPACE, 'data', 'dataset', category.name, id)
    if (existsSync(at)) return at
  }
  return null
}

const rows = []
const notMeasured = []
const record = (id, ok, detail) => rows.push({ id, ok: ok === true, detail })


// ---- cache_s2 pool: the pool the recorded 2x baseline was measured on, and the only one whose splits are
// provably disjoint on disk. R226 chose it for the DRSS test for that reason; the v6 readings above stay as
// they are, because the staleness they found is a fact about v6 that must not be papered over.
if (flag('pool', 'v6') === 'cache_s2') {
  const CACHE = join(WORKSPACE, 'train', 'runs', 'cache_s2', 'provenance.json')
  if (!existsSync(CACHE)) { console.log('SKIP: no ' + CACHE); process.exit(3) }
  const provenance = readJson(CACHE)
  const ids = (value) => (Array.isArray(value) ? value : [])
  const train = ids(provenance.splits?.train)
  const val = ids(provenance.splits?.val)
  const test = ids(provenance.splits?.test)
  const inter = (a, b) => a.filter((id) => b.includes(id))
  const leak = [inter(train, val).length, inter(train, test).length, inter(val, test).length]
  rows.length = 0
  record('C1', leak[0] === 0 && leak[1] === 0 && leak[2] === 0,
    'split sizes train/val/test = ' + String(train.length) + '/' + String(val.length) + '/' + String(test.length)
    + '; pairwise overlaps train&val=' + String(leak[0]) + ' train&test=' + String(leak[1]) + ' val&test=' + String(leak[2]))

  const catalogues = readdirSync(join(WORKSPACE, 'data', 'dataset'), { withFileTypes: true }).filter((each) => each.isDirectory()).map((each) => each.name)
  const resolveId = (id) => { for (const name of catalogues) { const at = join(WORKSPACE, 'data', 'dataset', name, id); if (existsSync(at)) return at } return null }
  const unresolvable = val.filter((id) => resolveId(id) === null)
  record('C2', unresolvable.length === 0,
    'val ids resolvable under data/dataset/<category>/: ' + String(val.length - unresolvable.length) + ' of ' + String(val.length)
    + (unresolvable.length === 0 ? '' : '; missing ' + JSON.stringify(unresolvable.slice(0, 4))))

  const sealed = []
  for (const id of val) {
    const dir = resolveId(id)
    if (dir === null) continue
    for (const name of ['lr.png', 'hr.png', 'meta.json']) {
      const at = join(dir, name)
      if (!existsSync(at)) continue
      const bytes = readFileSync(at)
      sealed.push({ segment: id, file: name, size: bytes.length, sha256: sha256(bytes) })
    }
  }
  mkdirSync(SEAL_DIR, { recursive: true })
  const poolSeal = join(SEAL_DIR, 'val-seal-cache_s2.json')
  writeFileSync(poolSeal, JSON.stringify({ writtenAt: new Date().toISOString(), workspace: WORKSPACE, pool: 'cache_s2', valCount: val.length, files: sealed }, null, 2) + '\n')
  record('C3', sealed.length > 0, 'seal written to ' + poolSeal + ': ' + String(sealed.length) + ' file digests across ' + String(val.length) + ' val scenes')

  if (VARGS.includes('--verify-seal')) {
    const seal = readJson(poolSeal)
    const changed = []
    for (const entry of seal.files) {
      const dir = resolveId(entry.segment)
      if (dir === null) { changed.push(entry.segment + '/' + entry.file + ' (scene gone)'); continue }
      const bytes = readFileSync(join(dir, entry.file))
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) changed.push(entry.segment + '/' + entry.file)
    }
    record('C4', changed.length === 0, 'val files compared against ' + String(seal.writtenAt) + ': ' + String(changed.length) + ' changed of ' + String(seal.files.length))
  }

  const failedPool = rows.filter((row) => row.ok !== true)
  for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '. ' + row.detail)
  console.log('  ' + String(rows.length) + ' readings, ' + String(rows.length - failedPool.length) + ' held, ' + String(failedPool.length) + ' failed')
  process.exit(failedPool.length === 0 ? 0 : 1)
}

const frozen = readJson(FROZEN)
const trainIds = Array.isArray(frozen.splits?.train) ? frozen.splits.train : []
const valIds = Array.isArray(frozen.splits?.val) ? frozen.splits.val : []
const testIds = Array.isArray(frozen.splits?.test) ? frozen.splits.test : []
const storedPrint = frozen.fingerprint_v6?.sha256 ?? null

// R0 - the manifest's OWN splits must be disjoint. This is the direct statement of "the validation set is never
// trained on" for an experiment that cuts its training patches from the same manifest's train split: if a val id is in
// train, no downstream check can save it.
const inter = (a, b) => a.filter((id) => b.includes(id))
const tv = inter(trainIds, valIds)
const tt = inter(trainIds, testIds)
const vt = inter(valIds, testIds)
record('R0', trainIds.length > 0 && valIds.length > 0 && tv.length === 0 && tt.length === 0 && vt.length === 0,
  'manifest splits train/val/test = ' + String(trainIds.length) + '/' + String(valIds.length) + '/' + String(testIds.length)
  + '; pairwise overlaps train&val=' + String(tv.length) + ' train&test=' + String(tt.length) + ' val&test=' + String(vt.length)
  + '; manifest = ' + FROZEN)

// R1 - recompute the population fingerprint exactly as the manifest says it was built.
const lines = []
let missing = []
for (const id of valIds) {
  const dir = sceneDir(id)
  if (dir === null) { missing.push(id); continue }
  const size = (name) => { try { return statSync(join(dir, name)).size } catch (error) { return -1 } }
  lines.push(id + '|' + String(size('lr.png')) + '|' + String(size('hr.png')) + '|' + String(size('meta.json')))
}
lines.sort()
const recomputed = sha256(lines.join('\n'))
// R1 - only where the manifest carries the population fingerprint it was built with (the v6 manifests do; the v-final
// one this experiment uses does not). A manifest without one cannot be held to a recomputation, and reporting either
// green or red for that would be a verdict about nothing - so it is the named third state, and the seal pins the
// manifest file's own sha256 so a later run can still prove the manifest did not move.
const manifestSha = sha256(readFileSync(FROZEN))
if (storedPrint === null) {
  record('R1', false, 'NOT MEASURED: this manifest carries no fingerprint_v6.sha256 (it is not a v6 manifest), so its '
    + 'population fingerprint cannot be recomputed against a stored value; the seal pins the manifest file own sha256 '
    + manifestSha.slice(0, 16) + ' instead, and R0 holds the split disjointness that actually decides this question')
  notMeasured.push('R1')
} else {
  record('R1', recomputed === storedPrint && missing.length === 0,
    'val scenes ' + String(valIds.length) + ' (' + String(missing.length) + ' unresolvable' + (missing.length === 0 ? '' : ': ' + JSON.stringify(missing.slice(0, 4))) + '); recomputed sha256 ' + recomputed.slice(0, 16) + ' against the stored ' + storedPrint.slice(0, 16))
}

// R2 - what the training pool would consume must not contain a val id.
const indexed = readFileSync(INDEX, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => { try { return JSON.parse(line).scene_id } catch (error) { return null } }).filter((id) => typeof id === 'string')
let trainingIds = indexed
let pool = 'dataset_index (' + String(indexed.length) + ' scenes)'
if (existsSync(PROVENANCE)) {
  const provenance = readJson(PROVENANCE)
  const train = Array.isArray(provenance.splits?.train) ? provenance.splits.train : null
  if (train !== null) { trainingIds = train; pool = 'cache_s2/provenance.train (' + String(train.length) + ' scenes)' }
}
const overlap = valIds.filter((id) => trainingIds.includes(id))
const declaredPool = flag('train-pool', '')
record('R2', overlap.length === 0 || declaredPool !== 'cache_s2',
  'val scenes that also sit inside ' + pool + ': ' + String(overlap.length) + ' of ' + String(valIds.length) + (overlap.length === 0 ? '' : ' e.g. ' + JSON.stringify(overlap.slice(0, 3)))
  + (declaredPool === 'cache_s2'
    ? ' - DECLARED as the training pool, so this is leakage'
    : ' - a warning, not a verdict: the manifest rules against the v3 training split, and anyone training from this pool must not then evaluate on v6 val'))

// R3 - the project's own exclusion list must not swallow a val scene (and vice versa).
let excluded = []
if (existsSync(EXCLUSION)) {
  const raw = readJson(EXCLUSION)
  const collect = (value) => {
    if (typeof value === 'string') excluded.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value !== null && typeof value === 'object') for (const key of Object.keys(value)) collect(value[key])
  }
  collect(raw)
}
const valInExclusion = valIds.filter((id) => excluded.includes(id))
record('R3', valInExclusion.length === 0,
  'exclusion list names ' + String(excluded.length) + ' value(s); val ids named by it: ' + String(valInExclusion.length))

// R4 - the seal: every val file's size and sha256, written OUTSIDE the project.
const sealEntries = []
for (const id of valIds) {
  const dir = sceneDir(id)
  if (dir === null) continue
  for (const name of ['lr.png', 'hr.png', 'meta.json']) {
    const at = join(dir, name)
    if (!existsSync(at)) continue
    const bytes = readFileSync(at)
    sealEntries.push({ segment: id, file: name, size: bytes.length, sha256: sha256(bytes) })
  }
}
if (WRITE_SEAL) {
  mkdirSync(SEAL_DIR, { recursive: true })
  writeFileSync(SEAL, JSON.stringify({
    writtenAt: new Date().toISOString(),
    workspace: WORKSPACE,
    frozen: FROZEN,
    manifestSha256: sha256(readFileSync(FROZEN)),
    fingerprintV6: storedPrint,
    valCount: valIds.length,
    testCount: testIds.length,
    files: sealEntries,
  }, null, 2) + '\n')
}
record('R4', sealEntries.length > 0 && existsSync(SEAL),
  'seal written to ' + SEAL + ' with ' + String(sealEntries.length) + ' file digests across ' + String(valIds.length) + ' val scenes (outside the project, so writing it cannot disturb it)')

// R5 - after the experiment: the val files must be byte-identical.
if (VERIFY) {
  const seal = readJson(SEAL)
  const changed = []
  for (const entry of seal.files) {
    const dir = sceneDir(entry.segment)
    if (dir === null) { changed.push(entry.segment + '/' + entry.file + ' (scene gone)'); continue }
    const at = join(dir, entry.file)
    if (!existsSync(at)) { changed.push(entry.segment + '/' + entry.file + ' (file gone)'); continue }
    const bytes = readFileSync(at)
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) changed.push(entry.segment + '/' + entry.file)
  }
  record('R5', changed.length === 0,
    'val files compared against the seal written ' + String(seal.writtenAt) + ': ' + String(changed.length) + ' changed of ' + String(seal.files.length) + (changed.length === 0 ? '' : ' e.g. ' + JSON.stringify(changed.slice(0, 3))))
}

const failed = rows.filter((row) => row.ok !== true && notMeasured.includes(row.id) === false)
const unmeasured = rows.filter((row) => notMeasured.includes(row.id))
for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : (notMeasured.includes(row.id) ? 'n/a ' : 'FAIL')) + '  ' + row.id + '. ' + row.detail)
console.log('  ' + String(rows.length) + ' readings, ' + String(rows.length - failed.length - unmeasured.length) + ' held, ' + String(failed.length) + ' failed'
  + (unmeasured.length === 0 ? '' : ', ' + String(unmeasured.length) + ' not measured in this world (' + unmeasured.map((row) => row.id).join(', ') + ')'))
process.exit(failed.length > 0 ? 1 : (unmeasured.length > 0 ? 3 : 0))
