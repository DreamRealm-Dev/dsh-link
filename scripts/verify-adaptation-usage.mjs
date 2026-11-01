#!/usr/bin/env node
/**
 * The usage tickets, held to the plugins they describe.
 *
 * A ticket is the artifact somebody will act on: it says what a plugin touches and what stands in
 * the way of adopting it. Like any derived artifact it rots, and like any verdict it can be
 * contradicted by its own evidence, so this gate re-derives every ticket from its plugin and
 * checks that the ticket's own numbers agree with each other.
 *
 *   1  every ticket is what the analyzer now says      a changed plugin invalidates its ticket
 *   2  counts agree with the lists they summarise
 *   3  every gap carries a file and line, and its class is named in the work list
 *   4  a target missing from this machine is reported, never silently dropped
 *
 * Run:  node scripts/verify-adaptation-usage.mjs
 * Exit: 0 every check held; 1 a check failed; 2 the manifest is missing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = join(PROJECT, 'compat', 'adaptation', 'usage-targets.json')
const TICKETS = join(PROJECT, 'compat', 'adaptation', 'tickets')
/** The measured loader cases a manual judgement cites. */
const ADMISSION = join(PROJECT, 'compat', 'adaptation', 'rows', 'mount-admission.json')
/** The recorded patches: an installed package this machine changed on purpose, with its provenance. */
const PATCHES = join(PROJECT, 'compat', 'adaptation', 'patched-installed.json')

if (!existsSync(TARGETS)) {
  console.error('no targets manifest at ' + TARGETS)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(TARGETS, 'utf8'))
const ticketName = (name) => name.replaceAll('@', '').replaceAll('/', '__') + '.json'
/** Words a ticket must never state: a verdict nobody has judged. */
const FORBIDDEN_VERDICTS = ['compatible', 'usable', 'works as is', 'drop-in', '\u517c\u5bb9', '\u53ef\u7528']

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}

// ---------------------------------------------------------------- 1 derived, not written
{
  const present = []
  const patched = []
  const missing = []
  const drifted = []
  for (const target of manifest.targets ?? []) {
    const file = join(TICKETS, ticketName(target.name))
    if (!existsSync(target.dir)) { missing.push(target.name); continue }
    if (!existsSync(file)) { drifted.push(target.name + ' has no ticket'); continue }
    const ticket = JSON.parse(readFileSync(file, 'utf8'))
    const fresh = analyze(target.dir)
    if (ticket.sourceDigest === fresh.sourceDigest) { present.push(target.name); continue }
    // R200: a digest that cannot match is either DRIFT or a RECORDED PATCH. The registry
    // (compat/adaptation/patched-installed.json) names the file, the line, the reason and both digests, so a
    // deliberately patched installed package is a fact with a provenance instead of a permanent red - and an
    // unrecorded change is still drift, because it matches no entry.
    const registry = existsSync(PATCHES) ? JSON.parse(readFileSync(PATCHES, 'utf8')) : { patches: [] }
    const recorded = (registry.patches ?? []).filter((one) => one.package === target.name && one.ticketDigest === ticket.sourceDigest && one.installedDigest === fresh.sourceDigest)
    if (recorded.length === 1) { patched.push(target.name + ' <' + recorded[0].file + ':' + String(recorded[0].line) + '>'); continue }
    drifted.push(target.name + ' describes a different revision')
  }
  record('1 every ticket is what the analyzer now says, or a RECORDED patch says why it is not', drifted.length === 0,
    drifted.length === 0 ? String(present.length) + ' ticket(s) current, ' + String(patched.length) + ' recorded patch(es)'
      + (patched.length > 0 ? ': ' + JSON.stringify(patched) : '')
      + ', ' + String(missing.length) + ' target(s) absent from this machine'
      + (missing.length > 0 ? ': ' + JSON.stringify(missing) : '')
      : JSON.stringify(drifted));
}

// ---------------------------------------------------------------- 2-4 the tickets themselves
{
  const files = existsSync(TICKETS) ? readdirSync(TICKETS).filter((name) => name.endsWith('.json')) : []
  const bad = []
  const classNotNamed = []
  const withoutEvidence = []
  for (const file of files) {
    const ticket = JSON.parse(readFileSync(join(TICKETS, file), 'utf8'))
    const sum = Object.values(ticket.counts ?? {}).reduce((total, value) => total + Number(value), 0)
    const gaps = ticket.gaps ?? []
    const gapSum = Object.values(ticket.gapCounts ?? {}).reduce((total, value) => total + Number(value), 0)
    const nonPresent = Object.entries(ticket.counts ?? {})
      .filter(([kind]) => kind !== 'present')
      .reduce((total, [, value]) => total + Number(value), 0)
    if (gaps.length !== nonPresent || gapSum !== nonPresent || sum === 0) bad.push(file + ' counts=' + JSON.stringify(ticket.counts) + ' gaps=' + String(gaps.length))
    for (const gap of gaps) {
      if (!Array.isArray(gap.at) || gap.at.length === 0) withoutEvidence.push(file + ':' + gap.name)
      const named = (ticket.work ?? []).some((line) => line.startsWith(gap.classification + ':'))
      if (!named) classNotNamed.push(file + ':' + gap.classification)
    }
  }
  record('2 the counts agree with the lists they summarise', bad.length === 0,
    bad.length === 0 ? String(files.length) + ' ticket(s) self-consistent' : JSON.stringify(bad))
  record('3 every gap carries a file and line', withoutEvidence.length === 0,
    withoutEvidence.length === 0 ? 'all gaps cite where they were found' : JSON.stringify(withoutEvidence))
  record('4 every gap class is named in the work list', classNotNamed.length === 0,
    classNotNamed.length === 0 ? 'every class a ticket found has a line saying what it means' : JSON.stringify([...new Set(classNotNamed)]))
}

// ---------------------------------------------------------------- 5-7 rows and verdicts
{
  const files = existsSync(TICKETS) ? readdirSync(TICKETS).filter((name) => name.endsWith('.json')) : []
  const badLines = []
  const badRows = []
  const badJudgement = []
  const badVerdict = []
  const required = ['silent-foreign-key', 'duplicate-insert', 'whole-config-replacement']
  for (const file of files) {
    const ticket = JSON.parse(readFileSync(join(TICKETS, file), 'utf8'))
    for (const row of ticket.rows ?? []) {
      if (typeof row.at !== 'string' || !row.at.endsWith(':' + row.line)) badRows.push(file + ' ' + String(row.at))
      if (!existsSync(row.file)) { badLines.push(file + ' ' + row.file + ' does not exist'); continue }
      const lines = readFileSync(row.file, 'utf8').split(/\r?\n/)
      if (row.line < 1 || row.line > lines.length) { badLines.push(file + ' ' + row.at + ' is past the end of the file'); continue }
      const content = lines[row.line - 1]
      if (typeof row.insertedId === 'string' && !content.includes(String(row.insertedId))) {
        badLines.push(file + ' ' + row.at + ' does not carry id ' + row.insertedId)
      }
    }
    const judged = new Set((ticket.manualJudgement ?? []).map((entry) => entry.id))
    for (const id of required) if (!judged.has(id)) badJudgement.push(file + ' lacks ' + id)
    const text2 = JSON.stringify(ticket)
    for (const word of FORBIDDEN_VERDICTS) {
      if (text2.toLowerCase().includes(String(word).toLowerCase())) badVerdict.push(file + ' says ' + word)
    }
  }
  record('5 every row cites a file and a line that really holds it', badLines.length === 0,
    badLines.length === 0 ? 'every row line re-read from its file' : JSON.stringify(badLines))
  record('6 every row carries a well formed at field', badRows.length === 0,
    badRows.length === 0 ? 'file:line shape holds' : JSON.stringify(badRows))
  record('7 the three silent composition cases are marked for a human', badJudgement.length === 0 && badVerdict.length === 0,
    badJudgement.length === 0 && badVerdict.length === 0
      ? 'each ticket marks all three, and none states a verdict'
      : JSON.stringify([...badJudgement, ...badVerdict]))
}

// ---------------------------------------------------------------- 8 positive controls
{
  const read = (file) => { const path = join(TICKETS, file); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null }
  // The child row is the one that carries the inserted id; the parent row of the same file
  // holds no id and can never be superseded, so it is not the control.
  const find = (ticket, suffix) => (ticket?.rows ?? []).find((row) => row.origin === 'insert-child' && String(row.file).replaceAll('\\', '/').endsWith(suffix))
  const repetition = read('dsh-repetition-guard.json')
  const repeat = read('dsh-repeat-guard.json')
  const replaced = find(repetition, 'dsh-repetition-guard/cordis.patch.yml')
  const kept = find(repeat, 'dsh-repeat-guard/cordis.patch.yml')
  const failures = []
  if (replaced === undefined) failures.push('dsh-repetition-guard has no row for its own cordis.patch.yml')
  else if (replaced.supersededByLaterLayer !== true) failures.push('dsh-repetition-guard:' + replaced.line + ' reads ' + String(replaced.supersededByLaterLayer) + ', expected true (the profile layer replaces that config wholesale)')
  if (kept === undefined) failures.push('dsh-repeat-guard has no row for its own cordis.patch.yml')
  else if (kept.supersededByLaterLayer !== false) failures.push('dsh-repeat-guard:' + kept.line + ' reads ' + String(kept.supersededByLaterLayer) + ', expected false')
  record('8 supersession is read from the composition, on both sides', failures.length === 0,
    failures.length === 0
      ? 'one row replaced wholesale (true), one not (false)'
      : JSON.stringify(failures))
}

// ---------------------------------------------------------------- 9 measured citations
{
  const cases = new Map()
  if (existsSync(ADMISSION)) {
    for (const entry of JSON.parse(readFileSync(ADMISSION, 'utf8')).cases ?? []) {
      if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') cases.set(entry.id, entry.observed?.mountedTags ?? null)
    }
  }
  const files = existsSync(TICKETS) ? readdirSync(TICKETS).filter((name) => name.endsWith('.json')) : []
  const failures = []
  for (const file of files) {
    const ticket = JSON.parse(readFileSync(join(TICKETS, file), 'utf8'))
    for (const entry of ticket.manualJudgement ?? []) {
      const measured = entry.measured
      if (measured === undefined || typeof measured !== 'object') { failures.push(file + ' ' + entry.id + ' cites nothing'); continue }
      if (measured.case === null) {
        if (typeof measured.conclusion !== 'string' || !measured.conclusion.includes('no admission case')) {
          failures.push(file + ' ' + entry.id + ' has no case and does not say so')
        }
        continue
      }
      if (!cases.has(measured.case)) { failures.push(file + ' ' + entry.id + ' cites ' + String(measured.case) + ', which is not an admission case'); continue }
      const expected = cases.get(measured.case)
      if (JSON.stringify(expected) !== JSON.stringify(measured.observedTags ?? null)) {
        failures.push(file + ' ' + entry.id + ' claims ' + JSON.stringify(measured.observedTags ?? null) + ' for ' + measured.case + ', but the case observed ' + JSON.stringify(expected))
      }
    }
  }
  record('9 every measured citation names a real case and repeats what it observed', failures.length === 0,
    failures.length === 0 ? String(files.length) + ' ticket(s) cite measured cases faithfully' : JSON.stringify(failures))
}

const failed = results.filter((row) => !row.ok)
console.log('')
console.log(results.length + ' checks, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)
