#!/usr/bin/env node
/**
 * R89 gate: objective 4's door, measured before anybody walks through it.
 *
 * The live profile is the user's document, so this gate READS it and edits a COPY. It measures the four-step
 * recipe the PLAN records for a mount window (add a \`link:\` dependency, add the bundle name, run the package
 * manager, restart and read the live readings) and answers, now, the questions that decide whether the window
 * can be a single command: does the recipe still describe this profile, does applying it produce the intended
 * state, does the target package really exist with a loadable shape, can it be reverted byte for byte, and
 * does a dry run write nothing.
 *
 * AUTHORSHIP: like its sibling, this gate and any recipe it drives share an author (Lead). Recorded, not hidden.
 *
 * R186 (mount-window fixer): R2's ending assertion was tightened from "both counts moved by exactly two" to
 * "the file's OWN style is preserved, and mixed endings are a named failure". Why, and who flattened the live
 * file to LF, is measured in the comment on applyRecipe below. The reading count is still 7.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(process.env.R89_PROJECT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SELF_ATTACK = argv.includes('--self-attack')
const ONLY = (() => { const i = argv.indexOf('--only-mutant'); return i === -1 ? '' : argv[i + 1] })()
const MUTANT = process.env.R89_MUTANT ?? ''
const ROOTS = process.env.R89_ROOTS ?? ''
const SCRATCH = ROOTS === '' ? join(PROJECT, '.tmp', 'r89-preflight') : ROOTS
const PLUGIN = 'dsh-link-compat'
const TARGET = '<workspace>//dsh-link/plugins/' + PLUGIN
const LIVE = join(process.env.APPDATA ?? '', 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'profiles', 'web')
const DECLARED_READINGS = 7

function profileOf(name, kind) {
  const root = join(SCRATCH, 'profile-' + name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  if (kind === 'unreadable') return { root, copied: false }
  if (existsSync(join(LIVE, 'package.json')) === false) return { root, copied: false }
  cpSync(join(LIVE, 'package.json'), join(root, 'package.json'))
  for (const one of ['cordis.yml', 'cordis.patch.yml']) if (existsSync(join(LIVE, one))) cpSync(join(LIVE, one), join(root, one))
  return { root, copied: true }
}
/**
 * R197: the live profile now really CONTAINS the compat mount, so the recipe's own subject - a profile
 * that does NOT have it yet - is a fixture: strip the two rows the recipe adds and the comma they left.
 * Idempotence on an already-mounted profile is a different property and no reading here claims it.
 */
function stripMount(copy) {
  if (copy.copied !== true) return
  const path = join(copy.root, 'package.json')
  const text = readFileSync(path, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const kept = text.split(eol).filter((line) => line.includes(PLUGIN) === false)
  for (let index = kept.length - 1; index > 0; index -= 1) {
    if (kept[index].trim().startsWith(']') === false) continue
    if (kept[index - 1].trimEnd().endsWith(',')) kept[index - 1] = kept[index - 1].trimEnd().slice(0, -1)
    break
  }
  writeFileSync(path, kept.join(eol), 'utf8')
}
const readText = (path) => { try { return readFileSync(path, 'utf8') } catch { return null } }
const readProfile = (root) => {
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath) === false) return null
  const text = readFileSync(pkgPath, 'utf8')
  let pkg = null
  try { pkg = JSON.parse(text) } catch { return { text, pkg: null } }
  const deps = pkg.dependencies ?? {}
  const bundles = (((pkg.dsh ?? {}).profile ?? {}).bundles ?? [])
  return { text, pkg, deps, bundles }
}
// The recipe, applied textually because that is what the PLAN records: one line into \`dependencies\` and one
// entry into \`dsh.profile.bundles\`. Textual edits keep every other byte of the user's file untouched, and the
// caller checks that claim by diffing the two versions line by line.
function applyRecipe(root, options) {
  const before = readText(join(root, 'package.json'))
  if (before === null) return { ok: false, why: 'no package.json to edit' }
  // R89's own first version got this wrong: the live file was CRLF, so the "does the previous line end with a
  // comma" test looked at a line ending in \r and added an entry with no separator, producing JSON that does
  // not parse. Same family as R87. The recipe is therefore applied in the file's OWN line ending, and the
  // caller asserts that the ending count and the line count move exactly as declared.
  //
  // R186: the live archive is PURE LF today, and this is the measurement of who changed that (2026-10-11,
  // all readings taken this round, live archive read-only). `.tmp/r185-lead/mount-live.mjs:13,22,30` mounted
  // the two R185 packages into the user's profile with a whole-document rewrite — readFileSync(utf8) ->
  // JSON.parse -> `JSON.stringify(doc, null, 2)` -> writeFileSync — and JSON.stringify emits no \r at all.
  // Three stamped readings say it was that script and no other: the live file is 2300 B, crlf=0, lf=53, mtime
  // 2026-10-11T13:14:50.749Z; the pre-write backup `.tmp/r185-lead/profile-package.json.bak` is 2144 B with
  // crlf==lf==49 and mtime 2026-10-11T07:09:30.872Z (its birth time is 13:14:50.748Z, one millisecond before
  // that write, and copyFileSync keeps the source's write time — R186 calibrated that on this host, because it
  // is what makes the backup's stamp the LIVE file's pre-write stamp rather than the copy time); and replaying
  // those four lines of mount-live.mjs on that backup reproduces the live bytes exactly (2300 B, crlf=0, lf=53).
  // `docs/handoff/R185-handoff.md:50` records the same window (deps 18 -> 20, that backup path). Nothing has
  // written the profile since — its mtime is still that write — so the ending the recipe must follow is LF now.
  // The claim itself is unchanged, and so is its falseability: the recipe must move the file's OWN ending. What
  // changed is only where the CRLF half can be proven: on a synthesized CRLF copy (mutant `crlf-bare-lf-insert`
  // in R2's fixtures below), not on the user's document.
  const EOL = MUTANT === 'crlf-bare-lf-insert' ? '\n' : (before.includes('\r\n') ? '\r\n' : '\n')
  const lines = before.split(EOL)
  const depAt = lines.findIndex((line) => /"dependencies"\s*:\s*\{/.test(line))
  if (depAt === -1) return { ok: false, why: 'no dependencies block' }
  if (options.deps) {
    if (lines.slice(depAt, depAt + 40).some((line) => line.includes('"' + PLUGIN + '"'))) return { ok: false, why: 'already a dependency' }
    lines.splice(depAt + 1, 0, '    "' + PLUGIN + '": "link:' + options.target + '",')
  }
  let bundlesAdded = false
  if (options.bundles) {
    const at = lines.findIndex((line) => line.includes('"bundles"'))
    if (at === -1) return { ok: false, why: 'no bundles list' }
    const closeAt = lines.findIndex((line, index) => index > at && line.trim().startsWith(']'))
    if (closeAt === -1) return { ok: false, why: 'bundles list never closes' }
    if (lines.slice(at, closeAt).some((line) => line.includes('"' + PLUGIN + '"'))) return { ok: false, why: 'already a bundle' }
    const last = lines[closeAt - 1].trimEnd()
    if (last.endsWith(',') === false) lines[closeAt - 1] = last + ','
    lines.splice(closeAt, 0, '      "' + PLUGIN + '"')
    bundlesAdded = true
  }
  const after = lines.join(EOL)
  if (options.dryRun !== true) writeFileSync(join(root, 'package.json'), after, 'utf8')
  return { ok: true, after, deps: options.deps === true, bundles: bundlesAdded }
}
// Two inserted lines must move the file's OWN ending, and must not create a third state ("mixed"). The three
// states are judged separately, and the third is named rather than averaged away:
//   style 'lf'    (crlf == 0)   : lf +2 and crlf stays 0 — a single CR introduced anywhere reddens this.
//   style 'crlf'  (crlf == lf)  : crlf +2 and lf +2 — no bare LF appears. The R87 family IS a bare LF inserted
//                                 into a CRLF file, so this half is asserted on the file the recipe edits.
//   style 'mixed' (anything else): mixed before, or mixed after, both fail. Mixed is a reading, not a rounding.
// A bare "lf moved by two" reading is deliberately NOT enough: on a CRLF file it is satisfied by inserting
// bare LFs, which is exactly the bug this assertion exists to catch.
const endlings = (text) => {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length
  return { crlf, lf, bare: lf - crlf }
}
const endingStyle = (one) => (one.crlf === 0 ? 'lf' : (one.crlf === one.lf ? 'crlf' : 'mixed'))
const endingsKept = (before, after, inserted) => {
  const one = endlings(before), two = endlings(after)
  const was = endingStyle(one), now = endingStyle(two)
  if (was === 'mixed' || now !== was) return false
  return two.crlf - one.crlf === (was === 'crlf' ? inserted : 0) && two.lf - one.lf === inserted
}
const endingsReport = (before, after) => {
  const one = endlings(before), two = endlings(after)
  return 'style=' + endingStyle(one) + '->' + endingStyle(two) + ' crlf=' + one.crlf + '->' + two.crlf +
    ' lf=' + one.lf + '->' + two.lf + ' bare=' + one.bare + '->' + two.bare
}
const diffLines = (a, b) => {
  const one = a.split('\n'), two = b.split('\n')
  const added = two.filter((line) => one.includes(line) === false)
  const removed = one.filter((line) => two.includes(line) === false)
  return { added, removed }
}

const runReadings = () => {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail: String(detail) })

  const live = profileOf('live', MUTANT === 'unreadable' ? 'unreadable' : 'plain')
  const liveState = live.copied ? readProfile(live.root) : null
  const mounted = liveState === null ? [] : Object.keys(liveState.deps).filter((one) => one.startsWith('dsh-link-'))
  const inBundles = liveState === null ? [] : liveState.bundles.filter((one) => String(one).startsWith('dsh-link-'))
  held('R1', 'the door is reportable: the live profile parses and the report says which of our plugins are mounted',
    liveState !== null && liveState.pkg !== null && Array.isArray(liveState.bundles),
    liveState === null ? 'the live profile could not be read at ' + LIVE : 'deps=' + JSON.stringify(mounted) + ' bundles=' + JSON.stringify(inBundles) + ' compat-mounted=' + String(mounted.includes(PLUGIN) || inBundles.includes(PLUGIN)))

  const work = profileOf('work', MUTANT === 'unreadable' ? 'unreadable' : 'plain')
  stripMount(work)
  // R2's two ending fixtures, and why they are fixtures: the live archive is LF today (see applyRecipe), so the
  // CRLF half of the assertion has no CRLF file to be proven on, and the third state has no way to appear at
  // all. `crlf-bare-lf-insert` rebuilds the ending style the file had before R185; `mixed-endings-fixture`
  // builds mixed as the third state that a bare count-delta assertion cannot see: an otherwise CRLF document
  // with ONE bare LF left at the end. That shape is deliberate — the recipe still runs on it (it detects the
  // file's ending and appends two CRLF lines), so R2's ending term is the only term this fixture moves. Putting
  // the bare LF earlier instead makes the textual recipe refuse the file outright ("bundles list never closes"),
  // which reddens R3 too and hides what the assertion is supposed to judge.
  if (MUTANT === 'crlf-bare-lf-insert' || MUTANT === 'mixed-endings-fixture') {
    const copyPath = join(work.root, 'package.json')
    const copy = readFileSync(copyPath, 'utf8')
    const crlfCopy = copy.replace(/\r?\n/g, '\r\n')
    writeFileSync(copyPath, MUTANT === 'crlf-bare-lf-insert' ? crlfCopy : crlfCopy.replace(/\r\n$/, '\n'), 'utf8')
  }
  const before = readText(join(work.root, 'package.json')) ?? ''
  writeFileSync(join(work.root, 'package.json.bak-r89'), MUTANT === 'bad-backup' ? before + '\n' : before, 'utf8')
  const applied = applyRecipe(work.root, { deps: true, bundles: MUTANT !== 'skip-bundles', target: MUTANT === 'wrong-target' ? '<workspace>//dsh-link/plugins/does-not-exist' : TARGET })
  const after = readText(join(work.root, 'package.json')) ?? ''
  const state = readProfile(work.root)
  const nowDeps = state === null ? {} : state.deps
  const nowBundles = state === null ? [] : state.bundles
  const { added, removed } = diffLines(before, after)
  // The expectation is the RECORDED target, never a value that mirrors the injection: an assertion that
  // moves with the mutant it is supposed to catch is worse than no assertion (it was, in this gate's first
  // self-attack: 'wrong-target' flipped nothing at all).
  const want = 'link:' + TARGET
  const onlyCommaMoved = removed.length === 0 || (removed.length === 1 && added.filter((line) => line.trimEnd() === removed[0].trimEnd() + ',').length === 1)
  held('R2', 'the recipe is executable, its edits keep the file parseable, and it moves exactly the two lines it claims (ending count and line count included)',
    applied.ok && nowDeps[PLUGIN] === want && nowBundles.includes(PLUGIN) && added.length - removed.length === 2 && onlyCommaMoved && endingsKept(before, after, 2),
    'applied=' + String(applied.ok) + ' dep=' + String(nowDeps[PLUGIN]) + ' in-bundles=' + String(nowBundles.includes(PLUGIN)) + ' added=' + String(added.length) + ' removed=' + String(removed.length) + ' endings kept=' + String(endingsKept(before, after, 2)) + ' (' + endingsReport(before, after) + ')' + ' bare LF introduced=' + String(endlings(after).lf - endlings(before).lf - 2) + (applied.ok ? '' : ' why=' + applied.why))

  // R3 judges the path the recipe ACTUALLY wrote into the copy: a typo in a link target must not be able to
  // look like a successful mount just because the gate looked somewhere else.
  const written = 'link:' + TARGET
  const resolvedTarget = typeof nowDeps[PLUGIN] === 'string' && nowDeps[PLUGIN].startsWith('link:') ? nowDeps[PLUGIN].slice(5) : ''
  const manifestText = resolvedTarget === '' ? null : readText(join(resolvedTarget, 'package.json'))
  let manifest = null
  try { manifest = manifestText === null ? null : JSON.parse(manifestText) } catch { manifest = null }
  const built = resolvedTarget !== '' && existsSync(join(resolvedTarget, 'lib', 'index.js'))
  held('R3', 'the path the recipe actually wrote resolves to an existing package named what the mount expects, with a built artifact',
    nowDeps[PLUGIN] === written && manifest !== null && manifest.name === PLUGIN && built,
    'written=' + String(nowDeps[PLUGIN]) + ' manifest=' + String(manifest === null ? 'unreadable' : manifest.name) + ' lib/index.js=' + String(built) + ' path=' + resolvedTarget)

  const bak = readFileSync(join(work.root, 'package.json.bak-r89'), 'utf8')
  writeFileSync(join(work.root, 'package.json'), bak, 'utf8')
  const reverted = readFileSync(join(work.root, 'package.json'), 'utf8')
  held('R4', 'the mount is revertible byte for byte from the backup the recipe takes first',
    bak === before && reverted === before,
    'backup equals the pre-edit file=' + String(bak === before) + ' revert restores it exactly=' + String(reverted === before) + ' bytes=' + String(Buffer.byteLength(before, 'utf8')))

  const dry = profileOf('dry', 'plain')
stripMount(dry)
  const dryBefore = readFileSync(join(dry.root, 'package.json'), 'utf8')
  const dryRun = applyRecipe(dry.root, { deps: true, bundles: true, target: TARGET, dryRun: MUTANT !== 'dry-run-writes' })
  const dryAfter = readFileSync(join(dry.root, 'package.json'), 'utf8')
  const liveNow = live.copied ? readFileSync(join(live.root, 'package.json'), 'utf8') : ''
  const liveUntouched = live.copied === false ? true : liveNow === (liveState === null ? '' : liveState.text)
  held('R5', 'a dry run reports the recipe and writes nothing, in the copy and in the live profile',
    dryRun.ok && dryAfter === dryBefore && liveUntouched,
    'dry-run ok=' + String(dryRun.ok) + ' copy unchanged=' + String(dryAfter === dryBefore) + ' live unchanged=' + String(liveUntouched))

  // R6: the third step of the recipe is load-bearing, and this is the measurement that says so: until the
  // package manager runs, the link dependency is DECLARED but not RESOLVED (node_modules has no entry).
  if (MUTANT === 'preseed-node-modules') { mkdirSync(join(dry.root, 'node_modules', PLUGIN), { recursive: true }) }
  const resolved = existsSync(join(dry.root, 'node_modules', PLUGIN))
  held('R6', 'the recipe step that runs the package manager is load-bearing: a declared link dependency is not a resolved one',
    dryRun.ok && resolved === false,
    'node_modules/' + PLUGIN + ' present before install=' + String(resolved) + ' (so step 3 cannot be skipped)')

  const fixtures = [
    ['    "dsh-link-compat": "link:H:/x",', true, 'a dependency line is recognised'],
    ['      "dsh-link-compat"', true, 'a bundle entry is recognised'],
    ['    "other": "link:H:/x",', false, 'another package does not count as mounted'],
  ]
  const wrong = fixtures.filter(([text, expect]) => text.includes(PLUGIN) !== expect)
  held('RD', 'instrument calibration: the mount detector judges ' + String(fixtures.length) + ' fixtures as declared, and the reading count matches',
    wrong.length === 0 && readings.length + 1 === DECLARED_READINGS,
    String(fixtures.length) + ' fixtures, wrong=' + String(wrong.length) + ', declared=' + String(DECLARED_READINGS) + ' produced=' + String(readings.length + 1))
  return readings
}

const MUTANTS = [
  { name: 'skip-bundles', moved: ['R2'], touched: ['R2'], why: 'apply only half the recipe: a dependency without a bundle entry must be reported as an incomplete mount' },
  { name: 'wrong-target', moved: ['R2', 'R3'], touched: ['R2', 'R3'], why: 'point the recipe at a package that does not exist: R3 exists so a typo in the link target cannot look like a successful mount' },
  { name: 'unreadable', moved: ['R1', 'R2', 'R3'], touched: ['R1', 'R2', 'R3', 'R4'], why: 'a profile that cannot be read must not be reported as a door ready to open, and it must fail as a reading rather than as a crash' },
  { name: 'bad-backup', moved: ['R4'], touched: ['R4'], why: 'take a backup that is not the file you are about to edit: "revertible" is only true of a backup taken from the real thing' },
  { name: 'dry-run-writes', moved: ['R5'], touched: ['R5'], why: 'a dry run that writes is exactly the promise this reading exists to keep' },
  { name: 'preseed-node-modules', moved: ['R6'], touched: ['R6'], why: 'if the link were already resolved, step 3 of the recipe would not be load-bearing and R6 must say so' },
  { name: 'calibration-expectation-flipped', patch: { from: "    ['    \"other\": \"link:H:/x\",', false,", to: "    ['    \"other\": \"link:H:/x\",', true," }, moved: ['RD'], touched: ['RD'], why: 'flip one calibration expectation: the mount detector must redden rather than rubber-stamp itself' },
  { name: 'crlf-bare-lf-insert', moved: ['R2'], touched: ['R2', 'R4'], why: 'apply the recipe in the wrong ending: two bare LFs into a CRLF copy is the R87 bug itself, and "the counts moved by two" must not hold for it - this is the half that has to stay falseable while the live file is LF' },
  { name: 'mixed-endings-fixture', moved: ['R2'], touched: ['R2', 'R4'], why: 'the third state: one bare LF at the end of an otherwise CRLF document moves both counts by exactly two and so satisfies a bare count-delta assertion - the pre-R186 gate HOLDS on these exact bytes (pair reading kept in .tmp/r186-mountfix) - so the style has to be named and has to redden' },
]

const signature = () => { const out = {}; for (const row of runReadings()) out[row.id] = { ok: row.ok, detail: row.detail }; return out }
const flippedBetween = (before, after) => Object.keys(after).filter((id) => before[id].ok !== after[id].ok).sort()
const touchedBetween = (before, after) => Object.keys(after).filter((id) => before[id].detail !== after[id].detail).sort()
const agrees = (got, declared) => got.length === declared.length && got.every((id, at) => id === declared[at])

if (SELF_ATTACK) {
  const base = signature()
  let mismatches = 0
  let built = 0
  const movedAll = new Set()
  for (const mutant of MUTANTS) {
    if (ONLY !== '' && ONLY !== mutant.name) continue
    built += 1
    let target = fileURLToPath(import.meta.url)
    if (mutant.patch !== undefined) {
      const text = readFileSync(target, 'utf8')
      if (text.includes(mutant.patch.from) === false) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  anchor gone'); continue }
      target = join(SCRATCH, 'gate-' + mutant.name + '.mjs')
      mkdirSync(SCRATCH, { recursive: true })
      writeFileSync(target, text.replace(mutant.patch.from, mutant.patch.to), 'utf8')
    }
    const child = spawnSync(process.execPath, [target, '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 180000,
      env: { ...process.env, R89_PROJECT: PROJECT, R89_MUTANT: mutant.name, R89_ROOTS: SCRATCH },
    })
    const run = (child.stdout ?? '') + (child.stderr ?? '')
    const line = run.split(/\r?\n/).filter((one) => one.startsWith('[')).pop()
    if (line === undefined) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  produced no readings'); continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = { ok: row.ok, detail: row.detail }
    const flipped = flippedBetween(base, after)
    const touched = touchedBetween(base, after)
    for (const id of flipped) movedAll.add(id)
    const ok = agrees(flipped, mutant.moved) && agrees(touched, mutant.touched)
    if (!ok) mismatches += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + mutant.name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + mutant.moved.join(',') +
      ' touched=' + touched.join(',') + ' touched-declared=' + mutant.touched.join(',') + '  |  ' + mutant.why)
  }
  const uncovered = Object.keys(base).filter((id) => movedAll.has(id) === false)
  console.log('coverage: ' + String(Object.keys(base).length) + ' readings, ' + String(movedAll.size) + ' moved by at least one mutant, uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(mismatches) + '; mutants that could not be built: ' + String(MUTANTS.length - built))
  process.exit(mismatches === 0 && uncovered.length === 0 && built === MUTANTS.length ? 0 : 1)
}

const readings = runReadings()
if (JSON_OUT) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.id + '  ' + row.name + '  |  ' + row.detail)
  const failed = readings.filter((row) => row.ok === false).length
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
}
process.exit(readings.every((row) => row.ok) ? 0 : 1)
