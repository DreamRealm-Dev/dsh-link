#!/usr/bin/env node
/**
 * R49 (task-93): responsive layout - the band table is data, the decision is a pure function, and the
 * application seam writes what changed and takes away what is gone. Contract: .tmp/r49-contract.md (section 6).
 * Authority: the shipped plugin plugins/dsh-link-responsive (its src/client modules, its bands.json, its spec),
 * imported the same way the spec imports them.
 *
 * Every expected value is computed HERE: the band table is read from bands.json and the expected band for a
 * width is decided by this gate's own scan of that file's bands, never by asking the implementation; the
 * synthetic tables and the stand-in target are built here; the contract verdict for the new package is
 * RECORDED as it comes out (red is red - the rules are not bent to make this package look green).
 *
 *   1 the shipped table loads and matches the file band for band, bound for bound  [S6.1]
 *   2 both edges inclusive on both sides (720/721, 1080/1079)  [S6.2]
 *   3 an overlap is decided by table order  [S6.3]
 *   4 a width no band covers is refused (no-band, plan null), not guessed  [S6.4]
 *   5 an unreadable table is refused by name (duplicate / decisions / format)  [S6.5]
 *   6 an impossible width THROWS, which is not the same answer as no-band  [S6.6]
 *   7 applying one plan twice writes nothing the second time  [S6.7]
 *   8 going back removes the previous band's own keys, and refuses a target that cannot remove  [S6.8]
 *   9 the shipped spec runs as a subprocess and holds  [S6.9]
 *  10 the R47 contract checker on this new package: reported as it comes out  [S6.10]
 *  11 a live reading over CDP 9222 when it is there, SKIP with the reason when it is not  [S6.11]
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). Reading 11 may SKIP on a missing
 * environment and does not turn the run into exit 3, because the contract asks for a skip with a reason there
 * rather than a failed gate. --self-attack mutates the shipped modules/spec/package (anchors matched out of
 * them, so a refactor cannot leave one silently stale): each mutant must redden exactly its declared set, the
 * coverage matrix is printed, and every reading must be claimed. This gate runs no other gate.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
const PLUGIN = resolve(option('--plugin', join(PROJECT, 'plugins', 'dsh-link-responsive')))
const BANDS_PATH = join(PLUGIN, 'bands.json')
const PLAN_SRC = resolve(option('--plan-src', join(PLUGIN, 'src', 'client', 'layout-plan.ts')))
const APPLY_SRC = resolve(option('--apply-src', join(PLUGIN, 'src', 'client', 'apply-layout.ts')))
const SPEC_PATH = resolve(option('--spec', join(PLUGIN, 'test', 'layout-plan.spec.mjs')))
const CHECKER = join(PROJECT, 'scripts', 'check-plugin-contract.mjs')
// What a run actually reads. The self-attack points these at mutated copies; without that, a mutant is
// never executed and every mutant "survives" (R47 lost two mutants to exactly this).
let ACTIVE_PLUGIN = PLUGIN
let ACTIVE_SPEC = SPEC_PATH
let ACTIVE_BANDS = BANDS_PATH
const SCRATCH = join(PROJECT, '.tmp', 'r49-gate')
const MUTANT_ROOT = join(PROJECT, '.tmp', 'r49-gate-mutants')
const CDP = 'http://127.0.0.1:9222'

// The contract's literal format tag and attribute name, so a rename shows up as a failed reading.
const BANDS_FORMAT = 'dsh-link.responsive-bands/1'
const BAND_ATTRIBUTE = 'data-dsh-link-layout'
const PROPERTY_PREFIX = '--dsh-link-'

const SENTENCES = {
  1: 'the shipped table loads and matches bands.json band for band  [S6.1]',
  2: 'both bounds are inclusive on both sides (720/721, 1080/1079)  [S6.2]',
  3: 'two bands matching at once: the table order decides  [S6.3]',
  4: 'a width no band covers is refused with plan null, not guessed  [S6.4]',
  5: 'a table that cannot be read is refused by name  [S6.5]',
  6: 'an impossible width throws, and that is not the same answer as no-band  [S6.6]',
  7: 'applying one plan twice writes nothing the second time  [S6.7]',
  8: 'going back removes the previous band own keys; a target that cannot remove is refused  [S6.8]',
  9: 'the shipped spec runs as a subprocess and holds  [S6.9]',
  10: 'the R47 contract checker on this new package, reported as it comes out  [S6.10]',
  11: 'the live window agrees with the table (CDP), or SKIP with the reason  [S6.11]',
}

// ---------------------------------------------------------------- helpers
const results = []
const skipped = []
const record = (n, status, detail) => {
  const isSkip = status === 'skip'
  results.push({ n, ok: status === true, skip: isSkip })
  if (isSkip) skipped.push(n)
  console.log('  ' + (status === true ? 'ok  ' : (isSkip ? 'SKIP' : 'FAIL')) + '  ' + n + '. ' + detail)
}
const start = (n) => { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]) }
const clip = (text, n) => { const s = String(text); return s.length > n ? s.slice(0, n) + '...' : s }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
const loadTs = async (file) => { try { return await import(pathToFileURL(file).href + '?v=' + String(Date.now())) } catch { return null } }
const fakeTarget = (options) => {
  const attributes = new Map()
  const properties = new Map()
  const writes = []
  const target = {
    attributes,
    properties,
    writes,
    setAttribute: (name, value) => { attributes.set(name, value); writes.push(['attr', name, value]) },
    style: {
      setProperty: (name, value) => { properties.set(name, value); writes.push(['prop', name, value]) },
      ...(options !== undefined && options.cannotRemove === true ? {} : { removeProperty: (name) => { properties.delete(name); writes.push(['remove', name, null]) } }),
    },
  }
  return target
}
/** This gate's own reading of the table: first band in order that answers for this width. */
const myBand = (width, fileBands) => {
  for (const band of fileBands) {
    if (band.catchAll === true) return { name: band.name, matchedBy: 'catchAll' }
    if (typeof band.maxWidth === 'number' && width <= band.maxWidth) return { name: band.name, matchedBy: 'maxWidth' }
    if (typeof band.minWidth === 'number' && width >= band.minWidth) return { name: band.name, matchedBy: 'minWidth' }
  }
  return null
}

// ---------------------------------------------------------------- the readings
async function run(plan, apply, shippedRaw) {
  const problems = {}
  const notes = {}
  const say = (n, problem) => { (problems[n] = problems[n] ?? []).push(problem) }
  const note = (n, text) => { (notes[n] = notes[n] ?? []).push(text) }
  const done = (n) => { const list = problems[n] ?? []; record(n, list.length === 0, list.length === 0 ? (notes[n] ?? []).join(' | ') : list.slice(0, 3).join(' | ')) }
  const fileBands = Array.isArray(shippedRaw?.bands) ? shippedRaw.bands : []
  const loaded = plan.loadBands(shippedRaw)
  const shipped = loaded.bands

  // ---------------------------------------------------------------- 1 the table
  start(1)
  {
    if (loaded.ok !== true || shipped === null) say(1, 'the shipped table was refused: ' + clip(show({ ok: loaded.ok, reason: loaded.reason, detail: loaded.detail }), 150))
    else {
      if (shipped.format !== BANDS_FORMAT) say(1, 'the loaded table format is ' + show(shipped.format) + ', expected ' + show(BANDS_FORMAT))
      if (plan.BANDS_FORMAT !== undefined && plan.BANDS_FORMAT !== BANDS_FORMAT) say(1, 'the module BANDS_FORMAT is ' + show(plan.BANDS_FORMAT) + ', expected ' + show(BANDS_FORMAT))
      const names = shipped.bands.map((band) => band.name)
      const wantNames = fileBands.map((band) => band.name)
      if (show(names) !== show(wantNames)) say(1, 'the loaded bands are ' + show(names) + ', the file holds ' + show(wantNames))
      if (shipped.bands.length !== fileBands.length) say(1, 'the loaded table has ' + shipped.bands.length + ' band(s), the file has ' + fileBands.length)
      for (const band of fileBands) {
        const got = shipped.bands.find((entry) => entry.name === band.name) ?? null
        if (got === null) { say(1, band.name + ': missing from the loaded table'); continue }
        for (const bound of ['minWidth', 'maxWidth']) if (show(got[bound] ?? null) !== show(band[bound] ?? null)) say(1, band.name + ': ' + bound + ' loaded as ' + show(got[bound] ?? null) + ', the file says ' + show(band[bound] ?? null))
        if (show(got.catchAll ?? null) !== show(band.catchAll ?? null)) say(1, band.name + ': catchAll loaded as ' + show(got.catchAll ?? null) + ', the file says ' + show(band.catchAll ?? null))
        if (show(got.decisions) !== show(band.decisions)) say(1, band.name + ': decisions loaded as ' + clip(show(got.decisions), 100) + ', the file says ' + clip(show(band.decisions), 100))
      }
      const catchAlls = fileBands.filter((band) => band.catchAll === true).length
      if (catchAlls !== 1) say(1, 'the shipped table carries ' + catchAlls + ' catch-all band(s); the contract asks for exactly one')
    }
    note(1, 'bands ' + show(fileBands.map((band) => band.name)) + ' from ' + BANDS_PATH)
    console.log('      ' + notes[1][0])
  }
  done(1)

  // ---------------------------------------------------------------- 2 both edges, both sides
  start(2)
  {
    if (shipped === null) say(2, 'no table to plan with')
    else {
      const cases = [720, 721, 1079, 1080, 0]
      const seen = []
      for (const width of cases) {
        const reading = plan.planLayout(width, shipped)
        const want = myBand(width, fileBands)
        const got = reading.ok === true && reading.plan !== null ? reading.plan.band : reading.reason
        seen.push(width + '->' + got)
        if (want === null) { if (got !== 'no-band') say(2, width + ': expected no-band, got ' + show(got)); continue }
        if (got !== want.name) say(2, width + ': chose ' + show(got) + ', this gate computes ' + show(want.name) + ' from the file bounds')
        else if (reading.plan.matchedBy !== want.matchedBy) say(2, width + ': matchedBy is ' + show(reading.plan.matchedBy) + ', this gate computes ' + show(want.matchedBy))
        if (reading.plan.width !== width) say(2, width + ': the plan echoes width ' + show(reading.plan.width))
      }
      // The two edges named in the contract, spelled out so a reader sees both sides of each.
      if (myBand(720, fileBands).name === myBand(721, fileBands).name) say(2, 'the fixture does not separate 720 from 721, so the upper edge is not measured')
      if (myBand(1080, fileBands).name === myBand(1079, fileBands).name) say(2, 'the fixture does not separate 1080 from 1079, so the lower edge is not measured')
      note(2, seen.join(', '))
    }
    console.log('      ' + (notes[2] ?? ['(no note)'])[0])
  }
  done(2)

  // ---------------------------------------------------------------- 3 overlap by table order
  start(3)
  {
    const raw = { format: BANDS_FORMAT, bands: [
      { name: 'first', maxWidth: 1000, decisions: { sidebar: 'drawer' } },
      { name: 'second', minWidth: 500, decisions: { sidebar: 'docked' } },
      { name: 'rest', catchAll: true, decisions: { sidebar: 'docked' } },
    ] }
    const table = plan.loadBands(raw)
    if (table.bands === null) say(3, 'this gate own two-overlap table was refused: ' + clip(show(table.detail), 120))
    else {
      const reading = plan.planLayout(700, table.bands)
      const want = myBand(700, raw.bands)
      const got = reading.ok === true && reading.plan !== null ? reading.plan.band : reading.reason
      if (got !== want.name) say(3, 'the overlap chose ' + show(got) + ', this gate computes the table order winner ' + show(want.name))
      else if (reading.plan.matchedBy !== want.matchedBy) say(3, 'the winner reports matchedBy ' + show(reading.plan.matchedBy) + ', this gate computes ' + show(want.matchedBy))
      if (reading.ok === true && show(reading.plan.decisions) !== show({ sidebar: 'drawer' })) say(3, 'the winner carries ' + show(reading.plan.decisions) + ', expected first band decisions')
      note(3, '700 with first(maxWidth 1000) before second(minWidth 500) -> ' + show(got) + ' by ' + show(reading.plan === null ? null : reading.plan.matchedBy))
    }
    console.log('      ' + (notes[3] ?? ['(no note)'])[0])
  }
  done(3)

  // ---------------------------------------------------------------- 4 no catch-all
  start(4)
  {
    const raw = { format: BANDS_FORMAT, bands: [
      { name: 'narrow', maxWidth: 720, decisions: { sidebar: 'drawer' } },
      { name: 'wide', minWidth: 1080, decisions: { sidebar: 'docked' } },
    ] }
    const table = plan.loadBands(raw)
    if (table.ok !== true || table.bands === null) say(4, 'a table without a catch-all must still LOAD (the refusal belongs to the width): ' + clip(show(table.detail), 120))
    else {
      const reading = plan.planLayout(900, table.bands)
      if (reading.ok !== false) say(4, 'a width no band covers answered ok ' + show(reading.ok))
      if (reading.reason !== 'no-band') say(4, 'the reason is ' + show(reading.reason) + ', expected no-band')
      if (reading.plan !== null) say(4, 'a band was picked anyway: ' + clip(show(reading.plan), 120) + ' (a nearest-band guess is exactly what the contract forbids)')
      const covered = plan.planLayout(720, table.bands)
      if (covered.ok !== true) say(4, 'the same table still judges a width it does cover: ' + clip(show(covered), 110))
      note(4, 'no catch-all at 900 -> ' + clip(show({ ok: reading.ok, reason: reading.reason, plan: reading.plan }), 110) + '; at 720 -> ' + show(covered.ok === true ? covered.plan.band : covered.reason))
    }
    console.log('      ' + (notes[4] ?? ['(no note)'])[0])
  }
  done(4)

  // ---------------------------------------------------------------- 5 unreadable tables
  start(5)
  {
    const cases = [
      ['duplicate band name', { format: BANDS_FORMAT, bands: [{ name: 'a', catchAll: true, decisions: {} }, { name: 'a', maxWidth: 10, decisions: {} }] }],
      ['decisions is not an object', { format: BANDS_FORMAT, bands: [{ name: 'a', catchAll: true, decisions: 7 }] }],
      ['wrong format', { format: 'something/else', bands: [] }],
      ['bands is not an array', { format: BANDS_FORMAT, bands: {} }],
      ['two catch-alls', { format: BANDS_FORMAT, bands: [{ name: 'a', catchAll: true, decisions: {} }, { name: 'b', catchAll: true, decisions: {} }] }],
      ['a negative bound', { format: BANDS_FORMAT, bands: [{ name: 'a', catchAll: true, decisions: {} }, { name: 'b', minWidth: -1, decisions: {} }] }],
      ['not an object at all', null],
    ]
    const seen = []
    for (const [label, raw] of cases) {
      const reading = plan.loadBands(raw)
      seen.push(label + '->' + reading.reason)
      if (reading.ok !== false) say(5, label + ': accepted (ok ' + show(reading.ok) + ')')
      if (reading.reason !== 'bad-bands') say(5, label + ': reason is ' + show(reading.reason) + ', expected bad-bands')
      if (reading.bands !== null) say(5, label + ': the refused table still came back: ' + clip(show(reading.bands), 90))
      if (typeof reading.detail !== 'string' || reading.detail === '') say(5, label + ': refused without a detail naming what was wrong')
    }
    note(5, seen.join(', '))
    console.log('      ' + notes[5][0])
  }
  done(5)

  // ---------------------------------------------------------------- 6 an impossible width throws
  start(6)
  {
    if (shipped === null) say(6, 'no table to plan with')
    else {
      const cases = [Number.NaN, -1, Number.POSITIVE_INFINITY, -0.5, '800', null, undefined]
      const seen = []
      for (const width of cases) {
        let outcome = 'returned'
        try { plan.planLayout(width, shipped) } catch (error) { outcome = error instanceof TypeError ? 'TypeError' : 'threw ' + String(error?.constructor?.name ?? 'other') }
        seen.push(String(width) + '->' + outcome)
        if (outcome !== 'TypeError') say(6, 'width ' + show(width) + ' ' + outcome + ', expected a TypeError (a caller error is not the same answer as no-band)')
      }
      const refused = plan.planLayout(900, plan.loadBands({ format: BANDS_FORMAT, bands: [{ name: 'narrow', maxWidth: 720, decisions: {} }] }).bands)
      if (refused.reason !== 'no-band') say(6, 'a legal width with no band answers ' + show(refused.reason) + ', expected no-band rather than a throw')
      note(6, seen.join(', ') + '; legal-but-uncovered -> ' + show(refused.reason))
      console.log('      ' + notes[6][0])
    }
  }
  done(6)

  // ---------------------------------------------------------------- 7 idempotence
  start(7)
  {
    if (shipped === null) say(7, 'no table to plan with')
    else {
      const target = fakeTarget()
      const wide = plan.planLayout(1400, shipped).plan
      const first = apply.applyLayout(target, wide, null)
      const second = apply.applyLayout(target, wide, wide)
      if (first.wrote.length === 0) say(7, 'the first apply wrote nothing: ' + clip(show(first), 90))
      if (Object.keys(wide.decisions).length === 0) say(7, 'the band chosen for 1400px decides nothing at all, so this reading cannot observe the write path')
      if (target.attributes.get(BAND_ATTRIBUTE) !== wide.band) say(7, 'the band attribute is ' + show(target.attributes.get(BAND_ATTRIBUTE) ?? null) + ', expected ' + show(wide.band))
      if (!first.wrote.includes(BAND_ATTRIBUTE)) say(7, 'the first apply did not report writing the band attribute: ' + clip(show(first.wrote), 100))
      for (const key of Object.keys(wide.decisions)) if (!first.wrote.includes(PROPERTY_PREFIX + key)) say(7, 'the first apply did not write ' + PROPERTY_PREFIX + key + ': ' + clip(show(first.wrote), 100))
      if (second.wrote.length !== 0) say(7, 'applying the same plan twice wrote again: ' + clip(show(second.wrote), 110))
      if (second.removed.length !== 0) say(7, 'applying the same plan twice removed something: ' + clip(show(second.removed), 90))
      note(7, 'first wrote ' + show(first.wrote) + ', second ' + show({ wrote: second.wrote, removed: second.removed }))
      console.log('      ' + notes[7][0] + ' (attribute ' + BAND_ATTRIBUTE + '=' + String(target.attributes.get(BAND_ATTRIBUTE)) + ')')
    }
  }
  done(7)

  // ---------------------------------------------------------------- 8 removal, and a target that cannot remove
  start(8)
  {
    const raw = { format: BANDS_FORMAT, bands: [
      { name: 'wide', minWidth: 1000, decisions: { sidebar: 'docked', rail: 'shown', gap: 12 } },
      { name: 'narrow', maxWidth: 720, decisions: { sidebar: 'drawer', gap: 4 } },
      { name: 'rest', catchAll: true, decisions: { sidebar: 'docked' } },
    ] }
    const table = plan.loadBands(raw)
    if (table.bands === null) say(8, 'this gate own asymmetric table was refused: ' + clip(show(table.detail), 120))
    else {
      const wide = plan.planLayout(1400, table.bands).plan
      const narrow = plan.planLayout(700, table.bands).plan
      const target = fakeTarget()
      const fromNull = apply.applyLayout(target, wide, null)
      const back = apply.applyLayout(target, narrow, wide)
      // The key only the wide band decided must be gone, reported, and not left behind.
      if (show(back.removed) !== show(['rail'])) say(8, 'removed is ' + clip(show(back.removed), 90) + ', expected the keys only the previous band decided ([\"rail\"])')
      if (target.properties.has(PROPERTY_PREFIX + 'rail')) say(8, 'the property ' + PROPERTY_PREFIX + 'rail is still on the target: ' + show(target.properties.get(PROPERTY_PREFIX + 'rail')) + ' (that is the stale wide gap defect)')
      if (target.properties.get(PROPERTY_PREFIX + 'gap') !== '4') say(8, 'after going back gap is ' + show(target.properties.get(PROPERTY_PREFIX + 'gap') ?? null) + ', expected the narrow value 4')
      if (target.attributes.get(BAND_ATTRIBUTE) !== 'narrow') say(8, 'the band attribute is ' + show(target.attributes.get(BAND_ATTRIBUTE) ?? null) + ', expected narrow')
      if (!fromNull.wrote.includes(PROPERTY_PREFIX + 'rail')) say(8, 'the wide band never wrote ' + PROPERTY_PREFIX + 'rail, so the removal above proves nothing')
      const helpless = fakeTarget({ cannotRemove: true })
      apply.applyLayout(helpless, wide, null)
      let outcome = 'returned'
      try { apply.applyLayout(helpless, narrow, wide) } catch (error) { outcome = error instanceof TypeError ? 'TypeError' : 'threw ' + String(error?.constructor?.name ?? 'other') }
      if (outcome !== 'TypeError') say(8, 'a target with no way to remove a stale key ' + outcome + ', expected a TypeError (leaving it there would let the old band keep winning)')
      note(8, 'removed ' + show(back.removed) + '; gap now ' + show(target.properties.get(PROPERTY_PREFIX + 'gap')) + '; attribute ' + show(target.attributes.get(BAND_ATTRIBUTE)) + '; helpless target -> ' + outcome)
      console.log('      ' + notes[8][0])
    }
  }
  done(8)

  // ---------------------------------------------------------------- 9 the spec as a subprocess
  start(9)
  {
    if (!existsSync(ACTIVE_SPEC)) say(9, 'no spec at ' + ACTIVE_SPEC)
    else {
      const run = spawnSync(process.execPath, [ACTIVE_SPEC], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 })
      const text = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
      const summary = text.split('\n').map((line) => line.trim()).filter((line) => /^\d+ checks?, \d+ held, \d+ failed$/.test(line)).pop() ?? null
      if (run.status !== 0) say(9, 'the spec exited ' + String(run.status) + ': ' + clip(text.replace(/\s+/g, ' '), 150))
      if (summary === null) say(9, 'the spec printed no summary line this gate can parse: ' + clip(text.split('\n').slice(-2).join(' / '), 130))
      else {
        const parts = /^(\d+) checks?, (\d+) held, (\d+) failed$/.exec(summary)
        const total = Number(parts[1]); const held = Number(parts[2]); const failedCount = Number(parts[3])
        if (failedCount !== 0) say(9, 'the spec reports ' + String(failedCount) + ' failed check(s): ' + clip(text.split('\n').filter((line) => line.includes('FAIL')).join(' / '), 150))
        if (held !== total) say(9, 'the spec reports ' + String(held) + ' of ' + String(total) + ' held')
        if (total < 10) say(9, 'the spec covers only ' + String(total) + ' checks; the contract lists 10 things it must cover')
      }
      note(9, 'exit ' + String(run.status) + '; ' + clip(summary ?? '(no summary)', 80))
      console.log('      ' + notes[9][0])
    }
  }
  done(9)

  // ---------------------------------------------------------------- 10 the R47 contract on this package
  start(10)
  {
    if (!existsSync(CHECKER)) say(10, 'no contract checker at ' + CHECKER)
    else {
      const run = spawnSync(process.execPath, [CHECKER, ACTIVE_PLUGIN, '--json'], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 240_000 })
      let parsed = null
      try { parsed = JSON.parse(run.stdout) } catch { parsed = null }
      if (parsed === null) say(10, 'the checker produced no reading for this package: ' + clip(((run.stdout ?? '') + (run.stderr ?? '')).replace(/\s+/g, ' '), 150))
      else {
        const readings = parsed.readings ?? []
        const verdicts = readings.map((entry) => entry.rule + ':' + entry.verdict)
        // Reported as it comes out. The two verdicts this gate can compute on its own are asserted; a red
        // or an unknown anywhere else is named in the output and in the report, not smoothed away.
        const tally = { pass: 0, fail: 0, unknown: 0 }
        for (const entry of readings) tally[entry.verdict] = (tally[entry.verdict] ?? 0) + 1
        if (show(tally) !== show(parsed.counts)) say(10, 'the checker counts ' + show(parsed.counts) + ' but its readings tally ' + show(tally))
        const manifest = readJson(join(ACTIVE_PLUGIN, 'package.json'))
        const readable = readings.find((entry) => entry.rule === 'manifest-readable') ?? null
        if (readable === null) say(10, 'the package was not judged on its manifest at all')
        else if (readable.verdict !== 'pass') say(10, 'this package own manifest does not read as a package: ' + clip(show(readable.basis), 120))
        const licence = readings.find((entry) => entry.rule === 'licence-permissive') ?? null
        const declaredLicence = typeof manifest?.license === 'string' ? manifest.license : null
        if (licence === null) say(10, 'the package was not judged on its licence at all')
        else if (declaredLicence === 'MIT' && licence.verdict !== 'pass') say(10, 'package.json declares MIT but the licence rule reads ' + show(licence.verdict) + ': ' + clip(show(licence.basis), 120))
        const notable = readings.filter((entry) => entry.verdict !== 'pass')
        if (parsed.exitCode !== 0) console.log('      NOTABLE the checker exits ' + String(parsed.exitCode) + ' for this package (a refuse-level rule failed); recorded as it came out, the rules were not bent')
        note(10, show(tally) + ' for ' + ACTIVE_PLUGIN + (notable.length === 0 ? ' (every rule passes)' : '; not passing: ' + show(notable.map((entry) => entry.rule + ':' + entry.verdict))))
        console.log('      ' + notes[10][0])
        console.log('      verdicts ' + clip(verdicts.join(', '), 400))
      }
    }
  }
  done(10)

  // ---------------------------------------------------------------- 11 a live window, if there is one
  start(11)
  {
    const before = notes[11]
    void before
    let live = null
    let why = null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3_000)
      const list = await fetch(CDP + '/json/list', { signal: controller.signal }).then((response) => response.json())
      clearTimeout(timer)
      const page = (Array.isArray(list) ? list : []).find((entry) => entry.type === 'page' && typeof entry.webSocketDebuggerUrl === 'string') ?? null
      if (page === null) why = 'CDP answered but no page target is attached'
      else {
        const expression = 'JSON.stringify({ width: window.innerWidth, band: document.documentElement.getAttribute(' + JSON.stringify(BAND_ATTRIBUTE) + ') })'
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        live = await new Promise((done, fail) => {
          const guard = setTimeout(() => fail(new Error('the debugger socket did not answer in 5s')), 5_000)
          socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
          })
          socket.addEventListener('message', (event) => {
            clearTimeout(guard)
            try { const message = JSON.parse(String(event.data)); done(JSON.parse(message.result.result.value)) } catch (error) { fail(error) }
            try { socket.close() } catch { /* already closing */ }
          })
          socket.addEventListener('error', () => { clearTimeout(guard); fail(new Error('the debugger socket failed')) })
        })
      }
    } catch (error) { why = 'CDP is not usable here: ' + String(error?.message ?? error) }
    // The sentence is "the band this width falls in agrees with what the window reports". Without a live
    // window the DOM half cannot be read, so this gate asserts the other half explicitly: the planner must
    // agree with this gate own scan of bands.json at the widths the live probe would have asked about. A
    // skipped reading with nothing asserted in it would be a reading that can never be wrong.
    const boundaryWidths = [720, 721, 1079, 1080, 800]
    const fallback = []
    for (const width of boundaryWidths) {
      const want = myBand(width, fileBands)
      if (want === null) continue
      const reading = plan.planLayout(width, shipped)
      const got = reading.ok === true && reading.plan !== null ? reading.plan.band : reading.reason
      if (got !== want.name) { say(11, 'off the table: ' + String(width) + 'px is band ' + show(want.name) + ' in bands.json but the planner answers ' + show(got)); break }
      fallback.push(width + '->' + got)
    }
    if (live === null) record(11, (problems[11] ?? []).length === 0 ? 'skip' : false, (problems[11] ?? []).length === 0 ? 'SKIP: ' + String(why ?? 'no live reading') + ' (contract allows a skip with the reason); the table agreement is asserted off the browser at ' + show(boundaryWidths) + ' -> ' + show(fallback) : problems[11].join(' | '))
    else {
      const width = live.width
      const want = myBand(width, fileBands)
      const got = live.band
      if (got === null) record(11, 'skip', 'SKIP: the live window carries no ' + BAND_ATTRIBUTE + ' (the responsive client half is not mounted in this window), so there is nothing to compare; the decision itself is covered by readings 1-4')
      else {
        if (want === null) say(11, 'the live width ' + String(width) + ' falls in no band of the shipped table, so the attribute cannot be right')
        else if (got !== want.name) say(11, 'the live window is ' + String(width) + 'px wide, this gate computes band ' + show(want.name) + ' from the table, and the root carries ' + show(got))
        note(11, 'innerWidth ' + String(width) + ' -> table says ' + show(want === null ? null : want.name) + ', root carries ' + show(got))
        console.log('      ' + notes[11][0])
      }
    }
  }
  done(11)
  return results
}

async function runAll(paths) {
  results.length = 0
  skipped.length = 0
  const planMod = await loadTs(paths.plan)
  const applyMod = await loadTs(paths.apply)
  const missing = []
  if (planMod === null || typeof planMod.loadBands !== 'function' || typeof planMod.planLayout !== 'function') missing.push('loadBands/planLayout from ' + paths.plan)
  if (applyMod === null || typeof applyMod.applyLayout !== 'function') missing.push('applyLayout from ' + paths.apply)
  if (missing.length > 0) {
    for (const n of Object.keys(SENTENCES).map(Number)) { start(n); record(n, false, 'the module exposes no ' + missing.join(', ') + ' - the sentence cannot be read') }
    return { failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n) }
  }
  ACTIVE_PLUGIN = paths.plugin
  ACTIVE_SPEC = paths.spec
  ACTIVE_BANDS = join(paths.plugin, 'bands.json')
  const shippedRaw = readJson(ACTIVE_BANDS)
  if (shippedRaw === null) {
    for (const n of Object.keys(SENTENCES).map(Number)) { start(n); record(n, false, 'no readable band table at ' + ACTIVE_BANDS) }
    return { failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n) }
  }
  try {
    await run(planMod, applyMod, shippedRaw)
  } catch (error) {
    const already = new Set(results.map((row) => row.n))
    for (const n of Object.keys(SENTENCES).map(Number)) {
      if (already.has(n)) continue
      start(n)
      record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
    }
  }
  return { failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n), skipped }
}

// Anchors are matched out of the shipped product itself; an anchor that matches more or less than once is a
// failure of the attack, not a mutation (R47 taught this gate that an ambiguous anchor mutates the wrong place).
const MUTATIONS = [
  {
    target: 'plan',
    name: 'the upper bound stops being inclusive',
    declared: [2, 4, 11],
    edits: [{ find: /width <= band\.maxWidth/, replace: () => 'width < band.maxWidth' }],
  },
  {
    target: 'plan',
    name: 'the lower bound stops being inclusive',
    declared: [2, 11],
    edits: [{ find: /width >= band\.minWidth/, replace: () => 'width > band.minWidth' }],
  },
  {
    target: 'plan',
    name: 'the last matching band wins instead of the first',
    declared: [2, 3, 8, 11],
    edits: [{ find: /for \(const band of bands\.bands\) \{/, replace: () => 'for (const band of [...bands.bands].reverse()) {' }],
  },
  {
    target: 'plan',
    name: 'a width no band covers gets the nearest band instead of a refusal',
    declared: [4, 6],
    edits: [{ find: /return \{ ok: false, reason: 'no-band', plan: null \}/, replace: () => "return { ok: true, reason: 'ok', plan: { band: bands.bands[0].name, width, decisions: { ...bands.bands[0].decisions }, matchedBy: 'catchAll' } }" }],
  },
  {
    target: 'plan',
    name: 'an unreadable table is accepted (the format check goes)',
    declared: [5],
    edits: [{ find: /if \(raw\.format !== BANDS_FORMAT\) return bad\(/, replace: () => 'if (false) return bad(' }],
  },
  {
    target: 'plan',
    name: 'two bands may share a name',
    declared: [5],
    edits: [{ find: /if \(names\.has\(name\)\) return bad\(/, replace: () => 'if (false) return bad(' }],
  },
  {
    target: 'plan',
    name: 'a decisions value that is not an object is accepted',
    declared: [5],
    edits: [{ find: /if \(!isPlainObject\(entry\.decisions\)\) return bad\(/, replace: () => 'if (false) return bad(' }],
  },
  {
    target: 'plan',
    name: 'an impossible width is refused instead of thrown',
    declared: [6],
    edits: [{ find: /if \(typeof width !== 'number' \|\| !Number\.isFinite\(width\) \|\| width < 0\) \{\n    throw new TypeError\(/, replace: () => "if (false) {\n    throw new TypeError(" }],
  },
  {
    target: 'plan',
    name: 'the loaded bands lose their decisions',
    declared: [1, 3, 7, 8],
    edits: [{ find: /decisions: \{ \.\.\.entry\.decisions \},/, replace: () => 'decisions: {},' }],
  },
  {
    target: 'apply',
    name: 'applying the same plan writes everything again',
    declared: [7],
    edits: [{ find: /if \(previous !== null && Object\.prototype\.hasOwnProperty\.call\(previous\.decisions, key\) && String\(previous\.decisions\[key\]\) === value\) continue/, replace: () => 'if (previous !== null && false && Object.prototype.hasOwnProperty.call(previous.decisions, key) && String(previous.decisions[key]) === value) continue' }],
  },
  {
    target: 'apply',
    name: 'the previous band own keys are left behind',
    declared: [8],
    edits: [{ find: /const stale = previous === null\n    \? \[\]\n    : Object\.keys\(previous\.decisions\)\.filter\(\(key\) => !Object\.prototype\.hasOwnProperty\.call\(plan\.decisions, key\)\)\.sort\(\)/, replace: () => 'const stale = []' }],
  },
  {
    target: 'apply',
    name: 'a target that cannot remove a stale key is not refused',
    declared: [8],
    edits: [{ find: /if \(stale\.length > 0 && typeof target\.style\.removeProperty !== 'function'\) \{\n    throw new TypeError\(/, replace: () => "if (false && stale.length > 0 && typeof target.style.removeProperty !== 'function') {\n    throw new TypeError(" }],
  },
  {
    target: 'spec',
    name: 'the shipped spec swallows its own failures',
    declared: [9],
    // Two edits on purpose: swallowing an exit code only matters when there is a failure to swallow, so the
    // same mutant also breaks one spec check. A mutant that changes nothing observable is not a mutant.
    edits: [
      { find: /process\.exit\(bad\.length === 0 \? 0 : 1\)/, replace: () => 'process.exit(0)' },
      { find: /check\('3 the catch-all answers what no band covers', at\(800\) === 'default'/, replace: () => "check('3 the catch-all answers what no band covers', at(800) === 'nope'" },
    ],
  },
  {
    target: 'plugin',
    name: 'the package manifest stops being a readable package (the contract reading must notice)',
    declared: [10],
    // Corrupting the manifest is the honest way to make this read red: dropping just the licence field would
    // make the licence rule answer unknown, which is the CORRECT verdict for that input, not a finding.
    edits: [{ find: /"name": "dsh-link-responsive"/, replace: () => '"name" "dsh-link-responsive"' }],
  },
]

const targetPath = (paths, target) => target === 'plan' ? paths.plan : target === 'apply' ? paths.apply : target === 'spec' ? paths.spec : join(paths.plugin, 'package.json')
const targetCopy = (paths, root, target) => target === 'plan' ? join(root, 'layout-plan.ts') : target === 'apply' ? join(root, 'apply-layout.ts') : target === 'spec' ? join(root, 'layout-plan.spec.mjs') : join(root, 'package.json')

async function selfAttack() {
  const tmp = MUTANT_ROOT
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    const base = { plan: PLAN_SRC, apply: APPLY_SRC, spec: SPEC_PATH, plugin: PLUGIN }
    const lines = []
    const anchors = []
    const rows = []
    let localised = 0
    let applied = 0
    let notApplicable = 0
    for (const mutation of MUTATIONS) {
      const id = 'M' + String(MUTATIONS.indexOf(mutation) + 1)
      const from = targetPath(base, mutation.target)
      if (!existsSync(from)) { notApplicable += 1; lines.push('  ' + id + ' ' + mutation.name + ' -> the target is missing: ' + from); continue }
      let text = readFileSync(from, 'utf8')
      const original = text
      let anchor = null
      let dead = null
      for (const edit of mutation.edits) {
        const hits = (text.match(new RegExp(edit.find.source, edit.find.flags.includes('g') ? edit.find.flags : edit.find.flags + 'g')) ?? []).length
        if (hits !== 1) { dead = (hits === 0 ? 'no match for ' : 'AMBIGUOUS anchor (' + String(hits) + ' matches) ') + show(edit.find); break }
        const match = edit.find.exec(text)
        anchor = anchor === null ? match[0] : anchor + ' && ' + match[0]
        text = text.replace(edit.find, edit.replace)
      }
      if (dead !== null || text === original) { notApplicable += 1; lines.push('  ' + id + ' ' + mutation.name + ' -> ANCHOR NOT FOUND (' + clip(dead ?? 'the edit was a no-op', 80) + ')'); continue }
      applied += 1
      anchors.push('  ' + id + ' ' + mutation.name + ' -> ' + clip(anchor.replace(/\s+/g, ' '), 140))
      const root = join(tmp, 'm' + String(applied))
      mkdirSync(root, { recursive: true })
      if (mutation.target === 'plugin') {
        cpSync(PLUGIN, join(root, 'plugin'), { recursive: true })
        writeFileSync(join(root, 'plugin', 'package.json'), text, 'utf8')
      } else {
        writeFileSync(targetCopy(base, root, mutation.target), text, 'utf8')
      }
      const paths = {
        plan: mutation.target === 'plan' ? targetCopy(base, root, 'plan') : PLAN_SRC,
        apply: mutation.target === 'apply' ? targetCopy(base, root, 'apply') : APPLY_SRC,
        spec: mutation.target === 'spec' ? targetCopy(base, root, 'spec') : SPEC_PATH,
        plugin: mutation.target === 'plugin' ? join(root, 'plugin') : PLUGIN,
      }
      const seen = await runAll(paths)
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.slice().sort((left, right) => left - right)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push('  ' + id + ' ' + mutation.name + ' -> declared ' + show(declared) + ', observed ' + show(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
      rows.push({ id, name: mutation.name, declared, clean })
    }
    console.log('== anchors taken from the shipped product ==')
    console.log(anchors.join('\n'))
    console.log('')
    console.log('== mutations: each mutant must redden exactly its declared set ==')
    console.log(lines.join('\n'))
    console.log('')
    const READINGS = Object.keys(SENTENCES).map(Number)
    console.log('coverage matrix (reading -> mutants that declare it):')
    for (const n of READINGS) {
      const claimants = rows.filter((row) => row.declared.includes(n)).map((row) => row.id)
      console.log('  ' + n + ': ' + (claimants.join(', ') || 'UNCOVERED'))
    }
    const uncovered = READINGS.filter((n) => rows.every((row) => !row.declared.includes(n)))
    if (uncovered.length > 0) console.log('  UNCOVERED READINGS: ' + show(uncovered))
    const mismatched = rows.filter((row) => !row.clean).map((row) => row.id + ' ' + row.name)
    console.log('')
    console.log('mutants applied ' + String(applied) + ' of ' + String(MUTATIONS.length) + ' (anchors not found ' + String(notApplicable) + '); declared-set matches ' + String(localised) + ' of ' + String(applied) + '; uncovered readings ' + String(uncovered.length))
    if (mismatched.length > 0) console.log('mutants whose red set is not the declared one: ' + show(mismatched))
    process.exit(applied === MUTATIONS.length && localised === applied && uncovered.length === 0 ? 0 : 1)
  } finally {
    if (process.env.DSH_KEEP_MUTANTS !== '1') rmSync(MUTANT_ROOT, { recursive: true, force: true })
  }
}

async function main() {
  if (!existsSync(PLAN_SRC) || !existsSync(APPLY_SRC)) { console.log('SKIP  no responsive plugin modules at ' + PLUGIN); process.exit(3) }
  if (!existsSync(BANDS_PATH)) { console.log('SKIP  no band table at ' + BANDS_PATH); process.exit(3) }
  console.log('== real (this machine): ' + PLUGIN + ' ==')
  const { failed } = await runAll({ plan: PLAN_SRC, apply: APPLY_SRC, spec: SPEC_PATH, plugin: PLUGIN })
  console.log('')
  console.log('boundary: a bound is inclusive on both sides, ties go to table order, and a width no band covers is')
  console.log('          refused with no-band rather than crowned with the nearest band.')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length - skipped.length) + ' held, ' + String(skipped.length) + ' skipped, ' + String(failed.length) + ' failed')
  if (failed.length > 0) process.exit(1)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
