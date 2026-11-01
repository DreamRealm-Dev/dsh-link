#!/usr/bin/env node
/**
 * The name-drift table, held to the evidence it cites.
 *
 * A drift table decides whether an old plugin's dependency can be translated or must be refused, and
 * it is exactly the kind of artifact that reads as authoritative while resting on a regex somebody ran
 * once. This gate does not re-derive the table — it refuses the table unless every claim in it points
 * at something that exists, the tiers hold, and the refusals stay refusals.
 *
 *   1  the counts equal the arrays they summarise
 *   2  every cited evidence file resolves        a citation that does not resolve is invented
 *   3  tiers are respected                       unsupported rows carry no candidates
 *   4  a refusal stays a refusal                 it names its candidates and what would decide
 *   5  no row is silently mapped                 a refused name is translated nowhere
 *
 * Run:  node scripts/verify-name-drift.mjs
 * Exit: 0 every check held; 1 a check failed; 2 the table is missing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = join(PROJECT, 'compat', 'adaptation', 'name-drift.json')
const QUOTE = String.fromCharCode(39)
const DQUOTE = String.fromCharCode(34)

if (!existsSync(TABLE)) {
  console.error('no drift table at ' + TABLE)
  process.exit(2)
}
const drift = JSON.parse(readFileSync(TABLE, 'utf8'))
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}

// ---------------------------------------------------------------- 1 counts
{
  const kept = drift.kept ?? []
  const expected = {
    rows: kept.length + (drift.unsupported ?? []).length,
    certain: kept.filter((row) => row.tier === 'certain').length,
    probable: kept.filter((row) => row.tier === 'probable').length,
    unsupported: (drift.unsupported ?? []).length,
    kept: kept.length,
    refusals: (drift.refusals ?? []).length,
  }
  const same = JSON.stringify(drift.counts) === JSON.stringify(expected)
  record('1 the counts equal the arrays they summarise', same,
    same ? JSON.stringify(drift.counts) : 'table ' + JSON.stringify(drift.counts) + ' vs rows ' + JSON.stringify(expected))
}
// ---------------------------------------------------------------- 2 evidence resolves
{
  const broken = []
  const unverifiable = []
  const referenced = new Set()
  const materialRoot = String(drift.oracle?.materialRoot ?? '')
  let externalCitations = 0
  for (const row of [...(drift.kept ?? []), ...(drift.refusals ?? [])]) {
    for (const item of row.evidence ?? []) {
      const where = String(item.where ?? '')
      const cited = where.split(' ')[0]
      // A citation outside the repository is marked as such and resolved under the material root the
      // oracle declares: an unchecked citation and a checked one must not look the same.
      const external = cited.startsWith('external:')
      const file = external ? cited.slice('external:'.length) : cited
      if (!file.includes('/')) continue
      referenced.add(cited)
      if (external) externalCitations += 1
      const absolute = external ? join(materialRoot, file) : join(PROJECT, file)
      if (existsSync(absolute)) {
        // The file existing is not the claim: the row claims a NAME in that file, and a citation to a
        // property that is not there is how a phantom row survives. The first version of this check
        // asked only for the file, and accepted `services.agent` against a surface with no such
        // service — the verifier found it by parsing the file itself.
        if (!external) {
          const document = JSON.parse(readFileSync(absolute, 'utf8'))
          const tail = where.slice(cited.length).trim()
          const serviceMatch = /^services\.([A-Za-z0-9_]+)$/.exec(tail)
          const eventsCitation = tail === 'events[]'
          if (serviceMatch !== null) {
            const services = document.services ?? {}
            if (!Object.prototype.hasOwnProperty.call(services, serviceMatch[1])) broken.push(where + ' (no such service)')
          } else if (eventsCitation) {
            const events = Array.isArray(document.events) ? document.events : []
            if (!events.includes(row.name)) broken.push(where + ' (' + row.name + ' is not in that events array)')
          }
        }
      } else if (external && materialRoot === '') {
        broken.push(where + ' (external citation with no materialRoot declared)')
      } else if (external && !existsSync(materialRoot)) {
        unverifiable.push(cited)
      } else {
        broken.push(where)
      }
    }
  }
  record('2 every cited evidence resolves to the thing it names', broken.length === 0,
    broken.length === 0 ? String(referenced.size) + ' citation(s): ' + [...referenced].join(', ')
      + ' external=' + String(externalCitations)
      + (unverifiable.length > 0 ? ' (not on this machine: ' + String(unverifiable.length) + ', materialRoot present but the file is not)' : '')
      : 'unresolved: ' + JSON.stringify(broken))
}

// ---------------------------------------------------------------- 3 tiers
{
  const unsupported = drift.unsupported ?? []
  const leaked = unsupported.filter((row) => row.candidates !== undefined).map((row) => row.name)
  const tiers = new Set((drift.kept ?? []).map((row) => row.tier))
  const unknown = [...tiers].filter((tier) => !['certain', 'probable'].includes(tier))
  const whyMissing = unsupported.filter((row) => typeof row.because !== 'string' || row.because === '').map((row) => row.name)
  record('3 unsupported rows carry no candidates and say why they are unsupported',
    leaked.length === 0 && unknown.length === 0 && whyMissing.length === 0,
    'unsupported=' + String(unsupported.length) + ' leakedCandidates=' + JSON.stringify(leaked)
    + ' unknownTiers=' + JSON.stringify(unknown) + ' withoutReason=' + JSON.stringify(whyMissing))
}

// ---------------------------------------------------------------- 4 refusals decide nothing
{
  const refusals = drift.refusals ?? []
  const thin = refusals
    .filter((row) => (row.candidates ?? []).length < 2 || typeof row.refusal !== 'string' || row.refusal.length < 20)
    .map((row) => row.name)
  record('4 a refusal names its candidates and what would decide between them',
    thin.length === 0,
    refusals.length === 0 ? 'no refusals'
      : String(refusals.length) + ' refusal(s): ' + refusals.map((row) => row.name + ' with ' + String((row.candidates ?? []).length) + ' candidates').join(', ')
        + (thin.length > 0 ? '; too thin: ' + JSON.stringify(thin) : ''))
}

// ---------------------------------------------------------------- 5 nothing maps a refusal
{
  const refused = (drift.refusals ?? []).map((row) => row.name)
  const decided = []
  const scan = (dir, pattern) => {
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
      if (!pattern.test(file) || file === 'name-drift.json') continue
      const text = readFileSync(join(dir, file), 'utf8')
      for (const name of refused) {
        const single = QUOTE + name + QUOTE
        const double = DQUOTE + name + DQUOTE
        const arrow = '→ ' + name
        const mapped = new RegExp('(from|old|was|renamedFrom)[^a-zA-Z0-9_]*[' + QUOTE + DQUOTE + ']' + name + '[' + QUOTE + DQUOTE + ']').test(text)
        if (mapped || text.includes(arrow)) decided.push(file + ' maps ' + name)
      }
    }
  }
  scan(join(PROJECT, 'compat', 'adaptation'), /\.(ts|mjs|js|json)$/)
  scan(join(PROJECT, 'compat', 'table'), /\.(ts|mjs|js)$/)
  record('5 a refused name is not translated anywhere', decided.length === 0,
    decided.length === 0 ? 'refused: ' + JSON.stringify(refused) : JSON.stringify(decided))
}


// ---------------------------------------------------------------- 6 ambiguity is recorded
{
  // A table may delete its own refusals and pass every other check: the verifier moved the only
  // refused row into `kept` (candidates intact) and rules 4 and 5 both went green on an empty
  // list. The invariant that actually matters is not "there is always a refusal" — it is that an
  // ambiguous row cannot be quietly kept: a row with two or more plausible candidates has to be a
  // refusal, or carry the decision that settled it.
  const ambiguous = (drift.kept ?? []).filter((row) => (row.candidates ?? []).length >= 2)
  const unrecorded = ambiguous
    .filter((row) => typeof row.refusal !== 'string' || row.refusal.length < 20)
    .filter((row) => row.decision === undefined)
    .map((row) => row.name + ' with ' + String((row.candidates ?? []).length) + ' candidates')
  record('6 a row with two or more plausible candidates is a refusal or carries a decision',
    unrecorded.length === 0,
    ambiguous.length === 0 ? 'no ambiguous rows in kept' : JSON.stringify(unrecorded));
}

// ---------------------------------------------------------------- 7 a name is in one place
{
  // The verifier found the same name sitting in `kept` and in `refusals` at once: two answers to
  // one question, and whichever a consumer reads first wins.
  // Keyed by (kind, name, source version): `codeRuntime` was a real 0.1.1 service and is an
  // unsupported name in 0.1.5, and a check that collapsed the two would demand the table forget one
  // of them.
  const keptKeys = new Set((drift.kept ?? []).map((row) => row.kind + ':' + row.name + '@' + row.from));
  const both = (drift.refusals ?? [])
    .filter((row) => keptKeys.has(row.kind + ':' + row.name + '@' + row.from))
    .map((row) => row.name + '@' + row.from);
  const unsupportedKeys = new Set((drift.unsupported ?? []).map((row) => row.name + '@' + row.from));
  const leaked = (drift.kept ?? [])
    .filter((row) => unsupportedKeys.has(row.name + '@' + row.from))
    .map((row) => row.name + '@' + row.from);
  record('7 a name appears in exactly one section', both.length === 0 && leaked.length === 0,
    both.length === 0 && leaked.length === 0
      ? String(keptKeys.size) + ' kept, ' + String((drift.refusals ?? []).length) + ' refused, ' + String(unsupportedKeys.size) + ' unsupported'
      : 'in both kept and refusals: ' + JSON.stringify(both) + '; in both kept and unsupported: ' + JSON.stringify(leaked));
}
const failed = results.filter((row) => !row.ok)
console.log('')
console.log(results.length + ' checks, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)
