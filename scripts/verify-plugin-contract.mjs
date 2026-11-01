#!/usr/bin/env node
/**
 * R47 (task-89): the plugin contract — is the spec JUDGEABLE, does it judge correctly, and is a
 * reading that cannot be taken reported as unknown rather than as a pass. Contract: .tmp/r47-contract.md
 * (section 4 lists the readings). The authority for every shape is the checker and the two data files
 * on disk: scripts/check-plugin-contract.mjs, compat/plugin-contract.json, compat/adaptation/plugin-contract.json.
 *
 * Every expected value is computed HERE: the rule set (ids, severities, kinds, evidence paths) is read
 * from the data file and re-checked against the closed vocabularies; the synthetic packages are written
 * by this gate and the verdicts they must produce are worked out from the rules' own definitions; the
 * consistency block is recomputed from port-verdicts.json plus a fresh run of the checker. The checker is
 * run as a CHILD PROCESS (it is the product under test, not a gate); this gate runs no other gate.
 *
 *   1 --self-test: exit 0, every rule has a counterexample, each row moved only its own rule  [S4.1]
 *   2 locality: a package written here that breaks TWO rules reddens exactly those two  [S4.2]
 *   3 an unreadable reading is unknown (with why + what would decide it), never pass  [S4.3]
 *   4 exit codes: rewrite-level failure exits 0 with honest counts, refuse-level exits non-zero  [S4.4]
 *   5 three real targets re-judged here match the recorded reading line by line; drift is detected  [S4.5]
 *   6 the recorded consistency block against port-verdicts.json, recomputed independently  [S4.6]
 *   7 the rule set is self-consistent: no orphan rule, kinds/severities closed, evidence exists  [S4.7]
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). --self-attack mutates the CHECKER
 * (anchors matched out of it, so a refactor cannot leave one silently stale): each mutant must redden
 * exactly its declared set, the coverage matrix is printed, and every reading must be claimed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
const CHECKER = resolve(option('--checker', join(PROJECT, 'scripts', 'check-plugin-contract.mjs')))
const RULES_PATH = join(PROJECT, 'compat', 'plugin-contract.json')
const READING_PATH = join(PROJECT, 'compat', 'adaptation', 'plugin-contract.json')
const PORT_PATH = join(PROJECT, 'compat', 'adaptation', 'port-verdicts.json')
const SURFACE_PATH = join(PROJECT, 'compat', 'surface', 'client-0.2.1-alpha.1.json')
const SCRATCH = join(PROJECT, '.tmp', 'r47-gate')
// The mutant copies live in their own root: a reading run wipes the scratch tree, and the mutants must
// outlive each of those runs (the first version of this gate deleted its own mutants mid-attack).
const MUTANT_ROOT = join(PROJECT, '.tmp', 'r47-gate-mutants')

// The closed vocabularies, from the contract (section 1 R2 and R3), not from the checker.
const SEVERITIES = ['refuse', 'rewrite', 'note']
const KINDS = ['package-field', 'row-patch', 'import-specifier', 'client-usage', 'peer-range', 'licence']
const VERDICTS = ['pass', 'fail', 'unknown']
const DEMO_ID = 'r47-gate-demo'

const SENTENCES = {
  1: '--self-test holds, and every rule has a counterexample that moves only that rule  [S4.1]',
  2: 'a package breaking two rules reddens exactly those two (locality)  [S4.2]',
  3: 'an axis captured completely -> a definite fail; an axis never captured -> unknown with its reason, never pass  [S4.3 + ruling]',
  4: 'rewrite-level failure exits 0 with honest counts; refuse-level exits non-zero  [S4.4]',
  5: 'real targets re-judged here match the recorded reading; drift is detected  [S4.5]',
  6: 'the consistency block agrees with an independent recomputation  [S4.6]',
  7: 'the rule set is self-consistent: no orphan, closed vocabularies, evidence exists  [S4.7]',
}

// ---------------------------------------------------------------- helpers
const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === 'skip' })
  console.log('  ' + (status === true ? 'ok  ' : (status === 'skip' ? 'SKIP' : 'FAIL')) + '  ' + n + '. ' + detail)
}
const start = (n) => { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]) }
const clip = (text, n) => { const s = String(text); return s.length > n ? s.slice(0, n) + '...' : s }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
const readText = (file) => { try { return readFileSync(file, 'utf8') } catch { return null } }
// The checker a reading run exercises. The self-attack points this at a mutated copy, so a mutant really
// is executed rather than the pristine file being run again (the first version of this gate made exactly
// that mistake and every mutant "survived").
let ACTIVE_CHECKER = CHECKER
const runChecker = (args) => spawnSync(process.execPath, [ACTIVE_CHECKER, ...args], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240_000 })
const jsonOf = (args) => {
  const run = runChecker([...args, '--json'])
  let parsed = null
  try { parsed = JSON.parse(run.stdout) } catch { parsed = null }
  return { status: run.status, parsed, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}
const verdictOf = (readings, rule) => (readings.find((entry) => entry.rule === rule) ?? {}).verdict ?? '(missing)'
/** How many times a pattern matches. An anchor that matches twice would mutate the wrong branch. */
const occurrences = (text, find) => (text.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) ?? []).length

/** Write the synthetic packages this gate judges. Only ever under .tmp: real plugin dirs are read-only. */
function fakePackages(root) {
  const write = (base, rel, text) => { const file = join(base, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text, 'utf8') }
  const patchOf = (name) => '- insert:\n    - id: ' + DEMO_ID + '\n      name: ' + name + '\n'
  const manifestOf = (extra) => JSON.stringify(Object.assign({ name: '@r47-gate/dsh-contract-demo', version: '1.0.0', type: 'module', license: 'MIT', main: './lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }, extra ?? {}), null, 1)
  const build = (name, mutate) => {
    const base = join(root, name)
    write(base, 'package.json', manifestOf())
    write(base, 'cordis.patch.yml', patchOf('./helper.mjs'))
    write(base, 'helper.mjs', 'export const nothing = 1\n')
    if (typeof mutate === 'function') mutate(base, { write, manifestOf, patchOf, root })
    return base
  }
  mkdirSync(root, { recursive: true })
  const clean = build('clean')
  // Two violations at once: a kernel peer range that excludes this kernel, and a licence the host may not load.
  const pair = build('pair', (base, tool) => {
    tool.write(base, 'package.json', tool.manifestOf({ license: 'GPL-3.0-only', peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.0-rc.6' } }))
  })
  const rewriteOnly = build('rewrite-only', (base, tool) => {
    tool.write(base, 'package.json', tool.manifestOf({ peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.0-rc.6' } }))
  })
  const refuseOnly = build('refuse-only', (base, tool) => {
    tool.write(base, 'package.json', tool.manifestOf({ license: 'GPL-3.0-only' }))
  })
  const refuseModule = build('refuse-module', (base, tool) => {
    tool.write(base, 'cordis.patch.yml', tool.patchOf('./does-not-exist.mjs'))
  })
  // A client-plane member usage against a surface whose member set was never enumerated.
  const unknownMember = build('unknown-member', (base, tool) => {
    tool.write(base, 'lib/client.js', 'export const wire = (ctx) => ctx.slots.r47GateNoSuchMember()\n')
  })
  const unknownService = build('unknown-service', (base, tool) => {
    tool.write(base, 'lib/client.js', 'export const wire = (ctx) => ctx.r47GateNoSuchService.run()\n')
  })
  // The composition this gate hands the checker: it claims the demo id and supersedes nothing.
  const composition = join(root, 'composition.json')
  writeFileSync(composition, JSON.stringify({ ids: [{ id: DEMO_ID, flags: [] }] }, null, 1), 'utf8')
  // The partial surface: one service whose member set could not be enumerated (the checker own unknown path).
  const surface = readJson(SURFACE_PATH)
  const partial = join(root, 'surface-partial.json')
  if (surface !== null) {
    const copy = JSON.parse(JSON.stringify(surface))
    const target = copy.services?.slots ?? null
    if (target !== null) { target.membersComplete = false; target.members = null; target.membersReason = 'synthetic: this gate did not enumerate that service type' }
    writeFileSync(partial, JSON.stringify(copy), 'utf8')
  }
  return { clean, pair, rewriteOnly, refuseOnly, refuseModule, unknownMember, unknownService, composition, partial, surface: surface !== null, patchOf, manifestOf, write }
}

// ---------------------------------------------------------------- the readings
async function run() {
  const problems = {}
  const notes = {}
  const say = (n, problem) => { (problems[n] = problems[n] ?? []).push(problem) }
  const note = (n, text) => { (notes[n] = notes[n] ?? []).push(text) }
  const done = (n) => { const list = problems[n] ?? []; record(n, list.length === 0, list.length === 0 ? (notes[n] ?? []).join(' | ') : list.slice(0, 3).join(' | ')) }
  const rules = readJson(RULES_PATH)
  const reading = readJson(READING_PATH)
  const port = readJson(PORT_PATH)
  const ruleList = Array.isArray(rules?.rules) ? rules.rules : []
  const ctx = ['--composition', join(SCRATCH, 'composition.json')]
  rmSync(SCRATCH, { recursive: true, force: true })
  const fake = fakePackages(SCRATCH)

  // ---------------------------------------------------------------- 1 the self-test
  start(1)
  {
    const run1 = runChecker(['--self-test'])
    const stdout = run1.stdout ?? ''
    if (run1.status !== 0) say(1, '--self-test exited ' + String(run1.status) + ': ' + clip((stdout + ' ' + (run1.stderr ?? '')).replace(/\s+/g, ' '), 160))
    const rows = stdout.split('\n').filter((line) => /^\s+(ok|FAIL)\s/.test(line))
    const covered = new Set()
    for (const line of rows) {
      const body = line.replace(/^\s+(ok|FAIL)\s+/, '')
      const id = body.slice(0, 36).trim()
      const moved = body.slice(36 + 64 + 10 + 10).trim()
      const ok = line.trim().startsWith('ok')
      if (id !== '') covered.add(id)
      if (!ok) say(1, 'the self-test row for ' + id + ' did not hold (moved: ' + clip(moved, 70) + ')')
    }
    const orphans = ruleList.map((rule) => rule.id).filter((id) => covered.has(id) === false)
    if (orphans.length > 0) say(1, 'no counterexample was built for: ' + show(orphans))
    const summary = stdout.split('\n').find((line) => line.includes('has a counterexample')) ?? ''
    if (!/every one of the \d+ rule\(s\) has a counterexample: true/.test(summary)) say(1, 'the self-test does not claim full coverage: ' + clip(summary.trim(), 120))
    if (/has a counterexample: false/.test(summary)) say(1, 'a rule has no counterexample (the self-test says so): ' + clip(summary.trim(), 120))
    note(1, rows.length + ' self-test row(s) for ' + ruleList.length + ' rule(s); exit ' + String(run1.status) + '; ' + clip(summary.trim(), 90))
    console.log('      ' + notes[1][0])
  }
  done(1)

  // ---------------------------------------------------------------- 2 locality
  start(2)
  {
    const clean = jsonOf([fake.clean, ...ctx])
    const pair = jsonOf([fake.pair, ...ctx])
    if (clean.parsed === null) say(2, 'the clean package could not be judged: ' + clip(clean.stdout + clean.stderr, 160))
    else {
      const wrong = (clean.parsed.readings ?? []).filter((entry) => entry.verdict !== 'pass')
      if (wrong.length > 0) say(2, 'the clean package is not clean: ' + show(wrong.map((entry) => entry.rule + ':' + entry.verdict)))
      if ((clean.parsed.counts?.pass ?? -1) !== ruleList.length) say(2, 'the clean package reads ' + show(clean.parsed.counts) + ', expected ' + ruleList.length + ' pass')
      if (clean.parsed.exitCode !== 0) say(2, 'the clean package exited ' + show(clean.parsed.exitCode) + ', expected 0')
    }
    if (pair.parsed === null) say(2, 'the two-violation package could not be judged: ' + clip(pair.stdout + pair.stderr, 160))
    else {
      const failed = (pair.parsed.readings ?? []).filter((entry) => entry.verdict === 'fail').map((entry) => entry.rule).sort()
      const want = ['licence-permissive', 'peer-range-admits-kernel']
      if (show(failed) !== show(want)) say(2, 'the two-violation package reddened ' + show(failed) + ', expected exactly ' + show(want))
      const others = (pair.parsed.readings ?? []).filter((entry) => entry.verdict !== 'pass' && !want.includes(entry.rule))
      if (others.length > 0) say(2, 'breaking two rules also moved: ' + show(others.map((entry) => entry.rule + ':' + entry.verdict)))
    }
    note(2, 'clean ' + show(clean.parsed?.counts ?? null) + '; two violations -> ' + clip(show((pair.parsed?.readings ?? []).filter((entry) => entry.verdict === 'fail').map((entry) => entry.rule)), 80))
    console.log('      ' + notes[2][0])
  }
  done(2)

  // ---------------------------------------------------------------- 3 unknown is not pass
  start(3)
  {
    if (fake.surface === false) say(3, 'no captured client surface at ' + SURFACE_PATH + ', so the unreadable case cannot be built')
    else {
      const judged = jsonOf([fake.unknownMember, '--surface-client', fake.partial, ...ctx])
      if (judged.parsed === null) say(3, 'the unreadable package could not be judged: ' + clip(judged.stdout + judged.stderr, 160))
      else {
        const entry = (judged.parsed.readings ?? []).find((row) => row.rule === 'client-member-collected') ?? null
        if (entry === null) say(3, 'the member rule produced no reading at all')
        else {
          if (entry.verdict !== 'unknown') say(3, 'a member set that was never enumerated read ' + show(entry.verdict) + ', expected unknown (unknown is never pass)')
          if (typeof entry.unknownBecause !== 'string' || entry.unknownBecause === '') say(3, 'the unknown carries no reason (unknownBecause is ' + show(entry.unknownBecause ?? null) + ')')
          if (typeof entry.toDecide !== 'string' || entry.toDecide === '') say(3, 'the unknown does not say what would decide it (toDecide is ' + show(entry.toDecide ?? null) + ')')
          if ((entry.basis ?? []).length === 0) say(3, 'the unknown carries no basis')
        }
        if ((judged.parsed.counts?.unknown ?? 0) < 1) say(3, 'the summary counts ' + show(judged.parsed.counts) + ', expected at least one unknown')
        if (judged.parsed.exitCode !== 0) say(3, 'an unknown (note-level) should not fail the run: exit ' + show(judged.parsed.exitCode))
        if (judged.status !== 0) say(3, 'the checker exited ' + String(judged.status) + ' for a note-level unknown')
      }
      // The contract S4.3 example reads "a service the capture does not declare" as unknown; this build
      // answers that case with a definite verdict on the service layer and reserves unknown for the member
      // layer whose completeness the capture records. Printed here, reported to the Lead, not asserted.
      // The ruled boundary (Lead, R47 revision): FAIL is for an axis that WAS captured completely - the
      // service table is complete, so an absent service is a conclusion - while UNKNOWN is for an axis that
      // was never captured at all (a member set the capture records as not enumerated). Both sides are
      // asserted here; the contract S4.3 example was amended to this reading, not the other way round.
      const service = jsonOf([fake.unknownService, ...ctx])
      const serviceEntry = (service.parsed?.readings ?? []).find((row) => row.rule === 'client-service-collected') ?? null
      if (serviceEntry === null) say(3, 'the service rule produced no reading for a service the capture does not declare')
      else {
        if (serviceEntry.verdict !== 'fail') say(3, 'a service the capture does not declare read ' + show(serviceEntry.verdict) + ', expected fail (that axis was captured completely, so absence is a conclusion)')
        if ((serviceEntry.basis ?? []).length === 0) say(3, 'the service-layer fail carries no basis')
        else if (!String((serviceEntry.basis ?? []).join(' ')).includes('r47GateNoSuchService')) say(3, 'the service-layer basis does not name the service it is about: ' + clip(show(serviceEntry.basis), 120))
        if (serviceEntry.unknownBecause !== undefined) say(3, 'a definite fail carries an unknownBecause (' + show(serviceEntry.unknownBecause) + '); the two verdicts must not blur')
      }
      const memberEntry = (judged.parsed?.readings ?? []).find((row) => row.rule === 'client-member-collected') ?? null
      note(3, 'member layer (set never enumerated) -> ' + show(memberEntry?.verdict ?? '(no reading)') + ' with reason ' + show(clip(String(memberEntry?.unknownBecause ?? ''), 60)))
      note(3, 'service layer (a name the capture does not declare) -> ' + show(serviceEntry?.verdict ?? '(no reading)') + ' — the contract S4.3 example reads unknown here; observed ' + show(serviceEntry?.verdict ?? null))
    }
    console.log('      ' + notes[3].join(' | '))
  }
  done(3)

  // ---------------------------------------------------------------- 4 exit codes
  start(4)
  {
    const rewrite = jsonOf([fake.rewriteOnly, ...ctx])
    const refuse = jsonOf([fake.refuseOnly, ...ctx])
    const refuse2 = jsonOf([fake.refuseModule, ...ctx])
    if (rewrite.parsed === null) say(4, 'the rewrite-level package could not be judged: ' + clip(rewrite.stdout + rewrite.stderr, 140))
    else {
      if (rewrite.status !== 0) say(4, 'a rewrite-level failure exited ' + String(rewrite.status) + ', expected 0')
      if (rewrite.parsed.exitCode !== 0) say(4, 'the reading says exit ' + show(rewrite.parsed.exitCode) + ' for a rewrite-level failure, expected 0')
      if ((rewrite.parsed.counts?.fail ?? -1) !== 1) say(4, 'the summary counts ' + show(rewrite.parsed.counts) + ', expected exactly one fail for this package')
      if ((rewrite.parsed.failsBySeverity?.rewrite ?? -1) !== 1) say(4, 'the severity counts are ' + show(rewrite.parsed.failsBySeverity) + ', expected one rewrite')
      if ((rewrite.parsed.failsBySeverity?.refuse ?? -1) !== 0) say(4, 'a rewrite-level failure was counted as refuse: ' + show(rewrite.parsed.failsBySeverity))
    }
    for (const [label, judged] of [['licence', refuse], ['row module', refuse2]]) {
      if (judged.parsed === null) say(4, 'the refuse-level package (' + label + ') could not be judged: ' + clip(judged.stdout + judged.stderr, 140))
      else {
        if ((judged.parsed.failsBySeverity?.refuse ?? 0) < 1) say(4, 'the ' + label + ' package did not produce a refuse-level failure: ' + show(judged.parsed.failsBySeverity))
        if (judged.status === 0) say(4, 'a refuse-level failure exited 0 for the ' + label + ' package, expected non-zero')
        if (judged.parsed.exitCode === 0) say(4, 'the reading says exit 0 for the ' + label + ' package, expected non-zero')
      }
    }
    note(4, 'rewrite-only exit ' + String(rewrite.status) + ' ' + show(rewrite.parsed?.counts ?? null) + ' ' + show(rewrite.parsed?.failsBySeverity ?? null) + '; refuse exit ' + String(refuse.status) + ' / ' + String(refuse2.status))
    console.log('      ' + notes[4][0])
  }
  done(4)

  // ---------------------------------------------------------------- 5 real targets
  start(5)
  {
    const targets = Array.isArray(reading?.targets) ? reading.targets : []
    const usable = targets.filter((entry) => entry.missing !== true && Array.isArray(entry.readings) && entry.readings.length > 0)
    if (usable.length < 3) say(5, 'the recorded reading holds ' + usable.length + ' usable target(s), the contract asks for at least 3')
    const picked = usable.slice(0, 3)
    const fields = (entry) => ({ rule: entry.rule ?? null, severity: entry.severity ?? null, kind: entry.kind ?? null, category: entry.category ?? null, verdict: entry.verdict ?? null, basis: entry.basis ?? null, unknownBecause: entry.unknownBecause ?? null, toDecide: entry.toDecide ?? null })
    for (const target of picked) {
      if (!existsSync(target.dir)) { say(5, target.name + ': the recorded directory is not on this machine (' + target.dir + ')'); continue }
      // No overrides here: the recorded reading was produced against the repository's own composition and
      // captured surface, and a re-judgment that changed them would be comparing two different questions.
      const judged = jsonOf([target.dir])
      if (judged.parsed === null) { say(5, target.name + ': re-judging produced no reading: ' + clip(judged.stdout + judged.stderr, 140)); continue }
      const mine = (judged.parsed.readings ?? []).map(fields)
      const theirs = (target.readings ?? []).map(fields)
      if (show(mine) !== show(theirs)) {
        const firstDiff = mine.findIndex((entry, index) => show(entry) !== show(theirs[index]))
        say(5, target.name + ': the re-judged reading differs from the recorded one at row ' + String(firstDiff) + ': mine ' + clip(show(mine[firstDiff] ?? null), 130) + ' vs recorded ' + clip(show(theirs[firstDiff] ?? null), 130))
      }
      if (show(judged.parsed.counts) !== show(target.counts)) say(5, target.name + ': counts differ: ' + show(judged.parsed.counts) + ' vs recorded ' + show(target.counts))
    }
    // The producer path, re-derived here into a scratch file (the tracked reading is never written).
    const recomputedPath = join(SCRATCH, 'recomputed.json')
    const recomputed = runChecker(['--all', '--out', recomputedPath])
    if (recomputed.status !== 0) say(5, 'recomputing every target exited ' + String(recomputed.status) + ': ' + clip((recomputed.stdout + recomputed.stderr).replace(/\s+/g, ' '), 150))
    else {
      const fresh = readText(recomputedPath)
      const tracked = readText(READING_PATH)
      if (fresh === null || tracked === null) say(5, 'the recomputation wrote no file to compare (got ' + show(fresh === null ? null : fresh.length) + ' bytes; the tracked reading is ' + show(tracked === null ? null : tracked.length) + ')')
      else if (fresh !== tracked) {
        const at = [...fresh].findIndex((char, index) => char !== tracked[index])
        say(5, 'the tracked reading no longer matches a fresh run (byte ' + String(at) + '): ' + clip(fresh.slice(Math.max(0, at - 60), at + 60), 140) + ' vs ' + clip(tracked.slice(Math.max(0, at - 60), at + 60), 140))
      }
      const check = runChecker(['--all', '--check'])
      if (check.status !== 0) say(5, 'the checker own --all --check rejected the tracked reading: ' + clip((check.stdout + check.stderr).replace(/\s+/g, ' '), 150))
      // Drift must be visible: one altered character in a copy has to fail the same check.
      const drifted = join(SCRATCH, 'drifted.json')
      const altered = tracked.replace(/"unknown": 4/, '"unknown": 5')
      if (altered === tracked) say(5, 'this gate could not build a drifted copy (the totals line changed shape)')
      else {
        writeFileSync(drifted, altered, 'utf8')
        const drift = runChecker(['--all', '--check', '--out', drifted])
        if (drift.status === 0) say(5, 'a copy whose totals were altered passed --all --check, so drift would go unnoticed')
      }
    }
    note(5, picked.length + ' target(s) re-judged row by row' + (usable.length > picked.length ? ' (of ' + usable.length + ' usable)' : '') + '; recomputation ' + String(recomputed.status) + ', drift copy detected')
    console.log('      ' + notes[5][0])
  }
  done(5)

  // ---------------------------------------------------------------- 6 consistency with the recorded verdicts
  start(6)
  {
    const consistency = reading?.consistency ?? null
    if (consistency === null) say(6, 'the recorded reading carries no consistency block')
    else {
      const targets = new Map((reading.targets ?? []).map((entry) => [entry.name, entry]))
      const portByPackage = new Map((port?.verdicts ?? []).map((entry) => [entry.name, entry]))
      const agree = Array.isArray(consistency.agree) ? consistency.agree : []
      const notReproduced = Array.isArray(consistency.notReproduced) ? consistency.notReproduced : []
      const fresh = Array.isArray(consistency.newFindings) ? consistency.newFindings : []
      if (agree.length < 2) say(6, 'the consistency block lists ' + agree.length + ' agreement(s); the contract asks for at least 2')
      // Recompute the classification from port-verdicts.json plus the recorded readings.
      const mineAgree = []
      const mineNot = []
      for (const [name, target] of targets) {
        const items = portByPackage.get(name)?.items ?? []
        const fails = new Map((target.readings ?? []).filter((row) => row.verdict === 'fail').map((row) => [row.category ?? ('rule:' + row.rule), row]))
        for (const item of items) {
          const found = fails.get(item.category)
          if (found === undefined) mineNot.push(name + '|' + item.category)
          else mineAgree.push(name + '|' + item.category)
          fails.delete(item.category)
        }
      }
      const theirsAgree = agree.map((entry) => entry.package + '|' + entry.category).sort()
      const theirsNot = notReproduced.map((entry) => entry.package + '|' + entry.category).sort()
      if (show(theirsAgree) !== show(mineAgree.sort())) say(6, 'the agree list disagrees with an independent recomputation: recorded ' + clip(show(theirsAgree), 140) + ' vs recomputed ' + clip(show(mineAgree), 140))
      if (show(theirsNot) !== show(mineNot.sort())) say(6, 'the notReproduced list disagrees with an independent recomputation: recorded ' + clip(show(theirsNot), 140) + ' vs recomputed ' + clip(show(mineNot), 140))
      for (const entry of agree) {
        const target = targets.get(entry.package)
        const row = (target?.readings ?? []).find((readingRow) => readingRow.rule === entry.rule) ?? null
        if (row === null) say(6, entry.package + ' / ' + entry.category + ': the named rule ' + entry.rule + ' has no reading')
        else if (row.verdict !== 'fail') say(6, entry.package + ' / ' + entry.category + ': the named rule reads ' + show(row.verdict) + ', expected fail')
        else if (row.severity !== entry.ruleSeverity) say(6, entry.package + ' / ' + entry.category + ': the named rule severity is ' + show(row.severity) + ', the block says ' + show(entry.ruleSeverity))
        const portItem = (portByPackage.get(entry.package)?.items ?? []).find((item) => item.category === entry.category) ?? null
        if (portItem === null) say(6, entry.package + ' / ' + entry.category + ': the port-verdicts entry is gone')
        else if (portItem.severity !== entry.portSeverity) say(6, entry.package + ' / ' + entry.category + ': port severity is ' + show(portItem.severity) + ', the block says ' + show(entry.portSeverity))
      }
      for (const entry of notReproduced) {
        if (typeof entry.criterion !== 'string' || entry.criterion.length < 40) say(6, entry.package + ' / ' + entry.category + ': the disagreement is named without a usable criterion (' + show(entry.criterion ?? null) + ')')
      }
      const named = notReproduced.map((entry) => entry.package + '|' + entry.category)
      for (const want of ['dsh-opencode-go|client-service-absent', 'dsh-repeat-guard|client-service-absent']) {
        if (!named.includes(want)) say(6, 'the named disagreement ' + want + ' is missing from notReproduced')
      }
      const member = notReproduced.find((entry) => entry.package === 'dsh-opencode-go' && entry.category === 'client-service-absent') ?? null
      if (member !== null && !/member/i.test(member.criterion)) say(6, 'the client-service-absent criterion does not name the member layer that supersedes it: ' + clip(member.criterion, 120))
      for (const want of ['@mars-sea/dsh-commandcode-provider|host-callsite-absent', 'dsh-search-failover|host-callsite-absent']) {
        if (!named.includes(want)) say(6, 'the named disagreement ' + want + ' is missing from notReproduced')
      }
      const host = notReproduced.find((entry) => entry.category === 'host-callsite-absent') ?? null
      if (host !== null && !/kind|host/i.test(host.criterion)) say(6, 'the host-callsite-absent criterion does not say which layer judges that fact: ' + clip(host.criterion, 120))
      for (const entry of fresh) {
        const target = targets.get(entry.package)
        const row = (target?.readings ?? []).find((readingRow) => readingRow.rule === entry.rule) ?? null
        if (row === null || row.verdict !== 'fail') say(6, 'a new finding names ' + entry.rule + ' for ' + entry.package + ', but that rule does not read fail there')
        const carried = (portByPackage.get(entry.package)?.items ?? []).some((item) => item.category === (row?.category ?? ''))
        if (carried) say(6, 'a new finding is actually already carried by port-verdicts.json: ' + entry.package + ' / ' + show(row?.category ?? null))
      }
      // The block must also be RECOMPUTED, not only recorded: a fresh producer run into scratch has to
      // classify exactly what this gate classified, and keep a criterion on every disagreement.
      const freshPath = join(SCRATCH, 'consistency-fresh.json')
      const rerun = runChecker(['--all', '--out', freshPath])
      const block = rerun.status === 0 ? (readJson(freshPath) ?? {}).consistency ?? null : null
      if (block === null) say(6, 'the fresh recomputation produced no consistency block (exit ' + String(rerun.status) + ')')
      else {
        const freshAgree = (block.agree ?? []).map((entry) => entry.package + '|' + entry.category).sort()
        const freshNot = (block.notReproduced ?? []).map((entry) => entry.package + '|' + entry.category).sort()
        if (show(freshAgree) !== show(mineAgree)) say(6, 'the fresh block agree list is ' + clip(show(freshAgree), 130) + ', expected ' + clip(show(mineAgree), 130))
        if (show(freshNot) !== show(mineNot)) say(6, 'the fresh block notReproduced list is ' + clip(show(freshNot), 130) + ', expected ' + clip(show(mineNot), 130))
        for (const entry of block.notReproduced ?? []) if (typeof entry.criterion !== 'string' || entry.criterion.length < 40) say(6, 'the fresh block names ' + show(entry.category ?? null) + ' without a usable criterion')
      }
      note(6, agree.length + ' agree, ' + notReproduced.length + ' notReproduced, ' + fresh.length + ' newFinding(s); recorded block and fresh recomputation both match this gate own classification')
      console.log('      ' + notes[6][0])
    }
  }
  done(6)

  // ---------------------------------------------------------------- 7 the rule set is self-consistent
  start(7)
  {
    const ids = ruleList.map((rule) => rule.id)
    if (new Set(ids).size !== ids.length) say(7, 'the rule set repeats an id: ' + show(ids))
    if (rules?.format !== 'dsh-link.plugin-contract/1') say(7, 'the rule set format is ' + show(rules?.format ?? null))
    for (const rule of ruleList) {
      if (!SEVERITIES.includes(rule.severity)) say(7, rule.id + ': severity ' + show(rule.severity) + ' is not one of ' + show(SEVERITIES))
      if (!KINDS.includes(rule.check?.kind)) say(7, rule.id + ': check.kind ' + show(rule.check?.kind ?? null) + ' is not one of ' + show(KINDS))
      if (typeof rule.what !== 'string' || rule.what === '') say(7, rule.id + ': no "what"')
      const evidence = typeof rule.evidence === 'string' ? rule.evidence : ''
      if (evidence === '') { say(7, rule.id + ': no evidence'); continue }
      const tokens = evidence.split(/[\s,;()]+/).map((token) => token.replace(/[.:]\d+(-\d+)?$/, '')).filter((token) => /^[A-Za-z0-9_.\/-]+\.(json|md|ts|mjs|yml|js|lock)$/.test(token))
      const found = tokens.map((token) => resolve(PROJECT, token.replace(/^\.\//, ''))).filter((file) => existsSync(file))
      if (found.length === 0) say(7, rule.id + ': none of its evidence paths exists on disk (' + clip(show(tokens), 110) + ')')
      else {
        const bad = tokens.map((token) => resolve(PROJECT, token.replace(/^\.\//, ''))).find((file) => existsSync(file) && statSync(file).isDirectory())
        if (bad !== undefined) say(7, rule.id + ': an evidence path is a directory, not a file: ' + bad)
      }
    }
    const kindsDoc = Array.isArray(rules?.kinds) ? rules.kinds : []
    if (show(kindsDoc.slice().sort()) !== show(KINDS.slice().sort())) say(7, 'the rule set kinds list is ' + show(kindsDoc) + ', expected the closed list ' + show(KINDS))
    // No orphan and no phantom: judging one package must yield exactly the rule set ids, all pass when clean.
    const judged = jsonOf([fake.clean, ...ctx])
    if (judged.parsed === null) say(7, 'the clean package could not be judged for the orphan check')
    else {
      const got = (judged.parsed.readings ?? []).map((entry) => entry.rule)
      if (show(got) !== show(ids)) say(7, 'judging a package yields ' + clip(show(got), 140) + ', expected exactly the rule set ' + clip(show(ids), 140))
      const notPassing = (judged.parsed.readings ?? []).filter((entry) => entry.verdict !== 'pass').map((entry) => entry.rule + ':' + entry.verdict)
      if (notPassing.length > 0) say(7, 'on a conforming package these rules do not pass: ' + show(notPassing))
    }
    const recordedRules = (reading?.ruleSet?.rules ?? []).map((entry) => entry.id + '|' + entry.severity + '|' + entry.kind).sort()
    const fileRules = ruleList.map((rule) => rule.id + '|' + rule.severity + '|' + rule.check?.kind).sort()
    if (show(recordedRules) !== show(fileRules)) say(7, 'the recorded reading rule set does not mirror compat/plugin-contract.json')
    // The boundary the R47 ruling froze: a rule may answer fail only where its axis was captured completely
    // (the service table), and must answer unknown where the axis itself was never captured (a member set the
    // capture records as not enumerated). A rule that blurred the two would be a spec that guesses.
    const judgedShape = judged.parsed === null ? null : (judged.parsed.readings ?? []).filter((entry) => VERDICTS.includes(entry.verdict))
    if (judgedShape !== null && judgedShape.some((entry) => entry.verdict === 'fail' && entry.unknownBecause !== undefined)) say(7, 'a fail carries an unknownBecause: ' + show(judgedShape.filter((entry) => entry.verdict === 'fail' && entry.unknownBecause !== undefined).map((entry) => entry.rule)))
    note(7, ruleList.length + ' rule(s), ' + KINDS.length + ' kinds, every evidence path exists; judging one package yields exactly those rules; boundary: fail = the axis was captured completely (absence is a conclusion), unknown = the axis was never captured (never a pass)')
    console.log('      ' + notes[7][0])
  }
  done(7)
  rmSync(SCRATCH, { recursive: true, force: true })
  return results
}

async function runAll(checkerPath) {
  results.length = 0
  if (!existsSync(checkerPath)) {
    for (const n of Object.keys(SENTENCES).map(Number)) { start(n); record(n, false, 'no checker at ' + checkerPath + ' — the sentence cannot be read') }
    return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
  }
  rmSync(SCRATCH, { recursive: true, force: true })
  ACTIVE_CHECKER = checkerPath
  try {
    await run()
  } catch (error) {
    const already = new Set(results.map((row) => row.n))
    for (const n of Object.keys(SENTENCES).map(Number)) {
      if (already.has(n)) continue
      start(n)
      record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
    }
  }
  rmSync(SCRATCH, { recursive: true, force: true })
  return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
}

// Anchors are matched out of the checker itself; a mutant whose anchor is missing FAILS the self-attack
// instead of quietly disappearing (R40 lost a mutant that way once).
const MUTATIONS = [
  {
    name: 'a member set that was never enumerated reads pass instead of unknown',
    // Reading 5 joins in: the real targets carry member unknowns, so the recomputed reading no longer
    // matches the tracked one byte for byte.
    declared: [1, 3, 5],
    edits: [{
      // Unique to the client-usage branch: the peer-range branch has the same shape above it, and an
      // ambiguous anchor silently mutated that one instead (the ambiguity guard now refuses such an anchor).
      find: /else if \(undecided\.length > 0\) readings\.push\(verdict\(rule, 'unknown', undecided\.map\(\(entry\) => entry\.head/,
      replace: () => "else if (undecided.length > 0) readings.push(verdict(rule, 'pass', undecided.map((entry) => entry.head",
    }],
  },
  {
    name: 'the licence rule stops refusing a licence the host may not load',
    declared: [1, 2, 4],
    edits: [{
      find: /else readings\.push\(verdict\(rule, 'fail', \['licence ' \+ raw\.trim\(\) \+ ' is not on the loadable list \('/,
      replace: () => "else readings.push(verdict(rule, 'pass', ['licence ' + raw.trim() + ' is not on the loadable list ('",
    }],
  },
  {
    name: 'the exit code ignores refuse-level failures',
    declared: [4],
    edits: [{
      find: /exitCode: failsBySeverity\.refuse > 0 \? 1 : 0/,
      replace: () => 'exitCode: 0',
    }],
  },
  {
    name: 'the self-test stops building a counterexample for one rule',
    declared: [1],
    edits: [{
      find: /\n\s*add\('dependency-declared', 'a bare specifier is imported and not declared'[^\n]*\n/,
      replace: () => '\n',
    }],
  },
  {
    name: 'the contested-composition case tolerates a superseded id',
    declared: [1, 5, 6],
    edits: [{
      find: /if \(contested\.length > 0\) readings\.push\(verdict\(rule, 'fail', contested\.map/,
      replace: () => "if (contested.length > 0) readings.push(verdict(rule, 'pass', contested.map",
    }],
  },
  {
    name: 'a row module that does not resolve is tolerated',
    declared: [1, 4],
    edits: [{
      find: /: verdict\(rule, 'fail', unresolved\)\)/,
      replace: () => ": verdict(rule, 'pass', unresolved))",
    }],
  },
  {
    name: 'a kernel-excluding peer range is tolerated',
    declared: [1, 2, 4, 5, 6],
    edits: [{
      find: /if \(excluded\.length > 0\) readings\.push\(verdict\(rule, 'fail', excluded\)\)/,
      replace: () => "if (excluded.length > 0) readings.push(verdict(rule, 'pass', excluded))",
    }],
  },
  {
    name: 'the drift check is weakened (a copy that changed passes --all --check)',
    declared: [5],
    edits: [{
      find: /if \(readFileSync\(out, 'utf8'\) !== text\) \{/,
      replace: () => 'if (false) {',
    }],
  },
  {
    name: 'the consistency block stops classifying by category',
    declared: [5, 6],
    edits: [{
      find: /const reading = mine\.get\(item\.category\)/,
      replace: () => "const reading = mine.get('r47-gate-no-such-category')",
    }],
  },
  {
    name: 'the named disagreement loses its criterion',
    declared: [5, 6],
    edits: [{
      find: /criterion: criterionFor\(item\.category, entry\)/,
      replace: () => "criterion: ''",
    }],
  },
  {
    name: 'a service the capture does not declare stops being a definite failure',
    declared: [1, 3, 5, 6],
    edits: [{
      find: /: verdict\(rule, 'fail', absent\.map\(\(entry\) => entry\.head \+ ' used at '/,
      replace: () => ": verdict(rule, 'unknown', absent.map((entry) => entry.head + ' used at '",
    }],
  },
  {
    name: 'a closed kind falls out of the checker vocabulary',
    declared: [1, 2, 4, 5, 7],
    edits: [{
      find: /const READ_KINDS = \['package-field', 'row-patch', 'import-specifier', 'client-usage', 'peer-range', 'licence'\]/,
      replace: () => "const READ_KINDS = ['package-field', 'row-patch', 'import-specifier', 'client-usage', 'peer-range']",
    }],
  },
]

// A mutated copy is placed in this gate's own scratch root, so the checker's relative roots (REPO and its
// three sibling imports) have to be re-anchored onto the real repository. These are not mutations: a copy
// that cannot find the rule set is not a mutant, it is a broken file, and every reading would redden.
const relocation = () => [
  { find: /const REPO = resolve\(HERE, '\.\.'\)/, replace: () => 'const REPO = ' + JSON.stringify(PROJECT) },
  { find: /from '\.\/analyze-plugin-usage\.mjs'/, replace: () => 'from ' + JSON.stringify(pathToFileURL(join(PROJECT, 'scripts', 'analyze-plugin-usage.mjs')).href) },
  { find: /from '\.\/read-composition-rows\.mjs'/, replace: () => 'from ' + JSON.stringify(pathToFileURL(join(PROJECT, 'scripts', 'read-composition-rows.mjs')).href) },
  { find: /from '\.\/compose-profile-rows\.mjs'/, replace: () => 'from ' + JSON.stringify(pathToFileURL(join(PROJECT, 'scripts', 'compose-profile-rows.mjs')).href) },
]

async function selfAttack() {
  const tmp = MUTANT_ROOT
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    const source = readFileSync(CHECKER, 'utf8')
    console.log('attacking ' + CHECKER + ' (' + String(source.length) + ' bytes)')
    const lines = []
    const anchors = []
    const rows = []
    let localised = 0
    let applied = 0
    let notApplicable = 0
    for (const mutation of MUTATIONS) {
      const id = 'M' + String(MUTATIONS.indexOf(mutation) + 1)
      let text = source
      let anchor = null
      let dead = null
      for (const edit of mutation.edits) {
        const hits = occurrences(text, edit.find)
        if (hits !== 1) { dead = (hits === 0 ? 'no match for ' : 'AMBIGUOUS anchor (' + String(hits) + ' matches) ') + show(edit.find); break }
        const match = edit.find.exec(text)
        anchor = anchor === null ? match[0] : anchor + ' && ' + match[0]
        text = text.replace(edit.find, edit.replace)
      }
      if (dead === null && text !== source) {
        for (const edit of relocation()) {
          const hits = occurrences(text, edit.find)
          if (hits !== 1) { dead = 'relocation (' + String(hits) + ' matches): ' + show(edit.find); break }
          text = text.replace(edit.find, edit.replace)
        }
      }
      if (dead !== null || text === source) {
        notApplicable += 1
        lines.push('  ' + id + ' ' + mutation.name + ' -> ANCHOR NOT FOUND in the checker (' + clip(dead ?? 'the edit was a no-op', 90) + ')')
        continue
      }
      applied += 1
      anchors.push('  ' + id + ' ' + mutation.name + ' -> ' + clip(anchor.replace(/\s+/g, ' '), 150))
      const copy = join(tmp, 'mutant-' + String(applied) + '.mjs')
      writeFileSync(copy, text, 'utf8')
      const seen = await runAll(copy)
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.slice().sort((left, right) => left - right)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push('  ' + id + ' ' + mutation.name + ' -> declared ' + show(declared) + ', observed ' + show(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
      rows.push({ id, name: mutation.name, declared, clean })
    }
    console.log('== anchors taken from the checker (' + CHECKER + ') ==')
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
    // Set DSH_KEEP_MUTANTS=1 to leave the mutated copies behind for inspection.
    if (process.env.DSH_KEEP_MUTANTS !== '1') rmSync(MUTANT_ROOT, { recursive: true, force: true })
    rmSync(SCRATCH, { recursive: true, force: true })
  }
}

async function main() {
  if (!existsSync(CHECKER)) { console.log('SKIP  no checker at ' + CHECKER); process.exit(3) }
  if (!existsSync(RULES_PATH)) { console.log('SKIP  no rule set at ' + RULES_PATH); process.exit(3) }
  console.log('== real (this machine): ' + CHECKER + ' ==')
  const { failed } = await runAll(CHECKER)
  console.log('')
  console.log('boundary (R47 ruling): fail = the axis was captured completely, so an absence is a conclusion;')
  console.log('                         unknown = the axis itself was never captured, and it must never read as a pass')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length) + ' held, 0 skipped, ' + String(failed.length) + ' failed')
  if (failed.length > 0) process.exit(1)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
