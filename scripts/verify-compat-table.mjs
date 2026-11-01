#!/usr/bin/env node
/**
 * Verify every row of the compat table against archived evidence.
 *
 * Three inputs, all of them checked against each other:
 *
 *   the table      compat/table/<kernel>.ts — roles, bindings, dispositions, refusals
 *   the surface    the archived document the table is bound to by SHA-256
 *   the earlier    a 0.1.x checkout, for the earlier side of every semantic refusal
 *
 * Per disposition:
 *
 *   resolve    every role's bound member exists on this kernel          (missing = FAIL)
 *   translate  the target the row moves to exists                       (missing = FAIL)
 *   refuse     split by class, and counted separately:
 *                semantic-changed — needs an earlier-kernel line, a this-kernel line
 *                                   and a discriminator that goes red if either side
 *                                   stops matching. Only these count as the product.
 *                absent           — the name is not here at all; it is never allowed
 *                                   to stand in for a semantic change.
 *              Witness claims are re-evaluated too; a claim that stopped holding is
 *              reported as an outdated refusal rather than passed over.
 *
 * Usage:
 *   node scripts/verify-compat-table.mjs [--surface <file>] [--table <kernel>]
 *                                        [--old-kernel <dir>] [--verbose]
 *                                        [--allow-kernel-mismatch]
 *
 * Exit codes: 0 every row held, the surface hash matched, and at least two
 *             semantic-changed refusals carry all three parts; 1 otherwise.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCompatModule } from '../compat/load.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Earlier kernel checkout holding the 0.1.x side of every semantic refusal. */
const DEFAULT_EARLIER = '<workspace>\\-studio\\vendor\\deepseek-harness'
const MIN_SEMANTIC_CHANGED = 2

const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const requested = option('--table', '')
const verbose = argv.includes('--verbose')
const allowMismatch = argv.includes('--allow-kernel-mismatch')
const earlierRoot = resolve(option('--old-kernel', process.env.DSH_LINK_OLD_KERNEL ?? DEFAULT_EARLIER))

const failures = []
const trouble = (line) => { failures.push(line); console.log('  FAIL ' + line) }
const say = (line) => console.log(line)

const compat = await loadCompatModule()
/** The pinned kernel this repository runs; the default section is the one that describes it. */
const PINNED_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(PROJECT, 'core', 'deepseek-harness', 'package.json'), 'utf8')).version } catch (error) { return null }
})()
// R218: the default section is the one for the PINNED kernel, not the first one in the build. After the pin
// moved to 0.2.1-alpha.5 this line still selected the alpha.1 section and then read that section's evidence
// paths out of the NEW checkout, so it failed on paths describing a kernel no longer on disk. The other
// sections are not re-verified here: verify-compat-table-bindings still checks every section's surface, hash
// and bindings, and a section for another kernel is history, not a claim about today.
const DEFAULT_SECTION = (PINNED_VERSION === null ? undefined : compat.tableFor(PINNED_VERSION)) ?? compat.TABLES[0]
const table = requested !== '' ? compat.tableFor(requested) : DEFAULT_SECTION
if (table === undefined) {
  console.error('FAIL — this build carries no compat table section' + (requested === '' ? '' : ' for ' + requested))
  console.error('known sections: ' + compat.knownKernels().join(', '))
  process.exit(1)
}
const surfacePath = resolve(PROJECT, option('--surface', table.surface.file))
if (!existsSync(surfacePath)) {
  console.error('no surface document at ' + surfacePath)
  console.error('archive one: node scripts/archive-surface.mjs <probe output> --label ' + table.packageVersion)
  process.exit(1)
}

say('== compat table verification ==')
say('table     : ' + table.kernel + ' @ ' + String(table.commit) + '  (' + table.surface.file + ')')
say('surface   : ' + surfacePath.replace(PROJECT + '\\', ''))

// 1. The table and its evidence are bound by hash: an archive that changed under
// the table is a red gate, not a quiet drift.
const bytes = readFileSync(surfacePath)
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== table.surface.sha256) {
  trouble('evidence drifted: ' + table.surface.file + ' hashes ' + actual.slice(0, 16)
    + ' but the table is bound to ' + table.surface.sha256.slice(0, 16))
} else {
  say('hash      : sha256 ' + actual.slice(0, 16) + ' matches the table binding (' + bytes.length + ' bytes)')
}

const document = JSON.parse(bytes.toString('utf8'))
if (document.format !== 'dsh-link.surface/1') trouble('unexpected surface format: ' + String(document.format))

// 1b. A surface describes a kernel AND the plugin set mounted into it. Mounting one more
// plugin changes every count without changing the kernel, and the hash above would happily
// follow it to the new file. The counts the table declares are what pins the composition: if
// the archive was recaptured against a different plugin set, this fails instead of quietly
// re-basing the whole table onto a composition nobody reviewed.
if (table.surface.composition !== undefined) {
  const declared = table.surface.composition
  const found = {
    declaredProperties: document.counts?.declaredProperties,
    reachableServices: document.counts?.reachableServices,
    events: document.counts?.events,
  }
  const mismatch = Object.keys(declared).filter((key) => declared[key] !== found[key])
  if (mismatch.length > 0) {
    trouble('composition moved: the table declares ' + JSON.stringify(declared)
      + ' but the archive reports ' + JSON.stringify(found)
      + ' — recapture, re-archive, then update the declared counts')
  } else {
    say('composition: ' + JSON.stringify(declared) + ' matches the archived counts')
  }
}
const claimed = typeof document.kernel?.id === 'string' ? document.kernel.id : ''
if (claimed !== table.kernel && !allowMismatch) {
  trouble('the surface document is for ' + (claimed === '' ? '(an unnamed kernel)' : claimed) + ' but the section is ' + table.kernel)
} else if (claimed !== table.kernel) {
  say('note      : surface ' + (claimed === '' ? '(unnamed)' : claimed) + ' checked against section ' + table.kernel + ' by explicit request')
}
// Information, not acceptance: what the probe could see is reported so a reader
// can judge it, but neither count is treated as completeness evidence.
say('info      : ' + document.counts.declaredProperties + ' declared properties, ' + document.counts.reachableServices
  + ' reachable services, ' + document.counts.events + ' event names with listeners, tools contract ' + String(document.counts.tools))

/** Member names and declared property names from the surface document. */
function lookupFrom(doc) {
  const services = doc.services ?? {}
  const declared = Array.isArray(doc.declared) ? doc.declared.map((row) => row?.key).filter((key) => typeof key === 'string') : Object.keys(services)
  return {
    membersOf(service) {
      const entry = services[service]
      if (entry === undefined || entry === null || entry.error !== undefined) return undefined
      return Array.isArray(entry.members) ? entry.members : []
    },
    serviceNames() { return declared },
  }
}

/** Text files an earlier checkout is scanned through, cached per root. */
const scanCache = new Map()
const SCANNED = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml']
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'lib', 'coverage', '.turbo'])

/** Every text file under a checkout, minus build output and dependencies. */
function scanFiles(root) {
  if (scanCache.has(root)) return scanCache.get(root)
  const found = []
  const walk = (dir, depth) => {
    if (depth > 8 || found.length > 20000) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length > 20000) return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIPPED.has(entry.name)) continue
        walk(path, depth + 1)
      } else if (SCANNED.some((extension) => entry.name.endsWith(extension))) {
        found.push(path)
      }
    }
  }
  walk(root, 0)
  scanCache.set(root, found)
  return found
}

/** Paths under an earlier checkout that contain the token. */
function scanTree(root, token) {
  return scanFiles(root).filter((path) => {
    try { return readFileSync(path, 'utf8').includes(token) } catch { return false }
  })
}

/** Read one line of a file, or null when the file or the line is not there. */
function lineOf(path, number) {
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  return number >= 1 && number <= lines.length ? lines[number - 1] : null
}

/** Assert one file:line carries the token it claims to carry. */
function checkFact(fact, root, label) {
  const path = join(root, fact.path)
  const line = lineOf(path, fact.line)
  if (line === null) {
    trouble(label + ': ' + fact.kernel + ' ' + fact.path + ':' + fact.line + ' does not exist on disk (' + root + ')')
    return false
  }
  if (!line.includes(fact.contains)) {
    trouble(label + ': ' + fact.kernel + ' ' + fact.path + ':' + fact.line + ' does not contain ' + JSON.stringify(fact.contains))
    return false
  }
  return true
}

const lookup = lookupFrom(document)
const problems = compat.tableProblems(table)
for (const problem of problems) trouble('table invariant: ' + problem)

// Every evidence path a row cites must exist: evidence that cannot be opened is not
// evidence. Earlier-kernel paths are checked with their own fact check instead.
for (const [name, row] of Object.entries(table.capabilities)) {
  const cited = [row.evidence, ...row.targets.map((target) => target.evidence)]
  for (const evidence of cited) {
    const token = String(evidence).split(' ')[0].split(':')[0]
    if (!/\.(md|ts|mjs|json|yml|js|rs)$/.test(token)) continue
    if (!existsSync(resolve(PROJECT, token))) trouble(name + ': cited evidence does not exist: ' + token)
  }
}

// A role must stay neutral: it may not be a name the kernel uses, nor may any of
// its segments. The kernel identifiers are the ones this table itself names — the
// services it resolves against and the services its witnesses speak about.
const kernelIdentifiers = new Set()
for (const row of Object.values(table.capabilities)) {
  for (const target of row.targets) kernelIdentifiers.add(target.service)
}
for (const row of Object.values(table.refused)) {
  for (const witness of row.witness) kernelIdentifiers.add(witness.service)
}
const checkRoleNeutral = (capability, role) => {
  // The capability root may coincide with a service name (the vocabulary says so
  // for "tools"); the role word may not.
  const segments = [role, ...role.split('.').slice(1)]
  const hits = segments.filter((segment) => kernelIdentifiers.has(segment))
  if (hits.length > 0) trouble(capability + ': role ' + role + ' uses a kernel service name (' + hits.join(', ') + '); roles must stay neutral')
}
for (const [name, row] of Object.entries(table.capabilities)) {
  for (const role of row.roles) checkRoleNeutral(name, role)
  for (const target of row.targets) for (const binding of target.binds) checkRoleNeutral(name, binding.role)
}
// A refusal's prose evidence is documentation; its evidenceRefs are the checked
// claims, so a refusal cannot cite a document that is not on disk.
for (const [name, row] of Object.entries(table.refused)) {
  const refs = row.evidenceRefs ?? []
  if (refs.length === 0) trouble(name + ': cites no machine-checked evidence reference (evidenceRefs)')
  for (const ref of refs) {
    const path = resolve(PROJECT, ref.path)
    if (!existsSync(path)) { trouble(name + ': cited evidence does not exist: ' + ref.path); continue }
    if (ref.line === undefined) continue
    const line = lineOf(path, ref.line)
    if (line === null) trouble(name + ': ' + ref.path + ':' + ref.line + ' does not exist')
    else if (ref.contains !== undefined && !line.includes(ref.contains)) {
      trouble(name + ': ' + ref.path + ':' + ref.line + ' does not contain ' + JSON.stringify(ref.contains))
    }
  }
}

const verdict = compat.validateTable({ table, lookup })

// The earlier-side half of every semantic refusal, plus its discriminator.
const earlierAvailable = existsSync(earlierRoot)
if (!earlierAvailable) {
  say('earlier   : no 0.1.x checkout at ' + earlierRoot)
  say('            a semantic-changed refusal cannot be established without one; pass --old-kernel <dir>')
} else {
  say('earlier   : ' + earlierRoot)
}
const established = new Set()
for (const [name, row] of Object.entries(table.refused)) {
  if (row.class !== 'semantic-changed') continue
  if (!earlierAvailable) {
    trouble(name + ': NOT ESTABLISHED — the earlier kernel is not on disk, so this refusal cannot be shown to be a semantic change')
    continue
  }
  const earlierOk = checkFact(row.wasThere, earlierRoot, name + ' (earlier side)')
  const thisOk = checkFact(row.changedAt, PROJECT, name + ' (this side)')
  const introduced = row.discriminator.introduced
  const presentLine = lineOf(join(PROJECT, row.discriminator.presentAt.path), row.discriminator.presentAt.line)
  if (presentLine === null || !presentLine.includes(introduced)) {
    trouble(name + ' (discriminator): this kernel no longer carries ' + JSON.stringify(introduced) + ' at '
      + row.discriminator.presentAt.path + ':' + row.discriminator.presentAt.line)
  }
  // The location must be proven to exist before its contents count as evidence: a path
  // that is not there proves "we looked in the wrong place", never "the earlier kernel
  // did not have it".
  const earlierPath = join(earlierRoot, row.discriminator.absentIn)
  if (!existsSync(earlierPath)) {
    trouble(name + ' (discriminator): NOT ESTABLISHED — the earlier-kernel path this claim looks at does not exist: '
      + row.discriminator.absentIn)
  } else if (readFileSync(earlierPath, 'utf8').includes(introduced)) {
    trouble(name + ' (discriminator): the earlier kernel already carries ' + JSON.stringify(introduced)
      + ' in ' + row.discriminator.absentIn + ', so the pair no longer describes a change')
  } else if (row.discriminator.absentEverywhere === true) {
    const hits = scanTree(earlierRoot, introduced)
    if (hits.length > 0) {
      trouble(name + ' (discriminator): NOT ESTABLISHED — the token appears elsewhere in the earlier kernel: '
        + hits.slice(0, 3).join(', '))
    } else {
      say('       discriminator: ' + JSON.stringify(introduced) + ' appears nowhere under the earlier checkout (scanned '
        + scanFiles(earlierRoot).length + ' text files)')
    }
  }
  if (earlierOk && thisOk) established.add(name)
}

// A refusal must carry the kind of witness its class implies.
for (const [name, row] of Object.entries(table.refused)) {
  const absence = row.witness.some((witness) => witness.claim === 'service-absent' || witness.claim === 'member-absent' || witness.claim === 'member-matching-absent')
  if (row.class === 'semantic-changed' && !absence) {
    trouble(name + ': a semantic-changed refusal must show what no longer holds on this kernel')
  }
  if (row.class === 'absent' && !row.witness.some((witness) => witness.claim === 'service-absent' || witness.claim === 'member-absent')) {
    trouble(name + ': an absent refusal must claim the name is absent')
  }
}

const byDisposition = { resolve: [], translate: [], refuse: [] }
for (const row of verdict.rows) byDisposition[row.disposition].push(row)

const describeRoles = (name) => {
  const row = table.capabilities[name]
  if (row === undefined) return ''
  if (row.self === true) return 'provided by ' + row.providedBy + ' (' + row.roles.length + ' roles)'
  const bound = row.targets.flatMap((target) => target.binds.map((binding) => binding.role + ' -> ' + target.service + '.' + binding.member))
  return bound.join(', ')
}

for (const disposition of ['resolve', 'translate']) {
  const rows = byDisposition[disposition]
  say('')
  say(disposition.toUpperCase() + ' (' + rows.length + ')')
  if (rows.length === 0) trouble('no capability is disposed as ' + disposition)
  for (const row of rows) {
    const mark = row.verdict === 'ok' ? 'ok  ' : 'FAIL'
    say('  ' + mark + ' ' + row.capability.padEnd(20) + describeRoles(row.capability))
    if (verbose || row.verdict !== 'ok') for (const line of row.detail) say('       ' + line)
    for (const failure of row.failures) trouble(row.capability + ': ' + failure)
  }
}

const refusals = byDisposition.refuse
const semantic = refusals.filter((row) => row.refusalClass === 'semantic-changed')
const absent = refusals.filter((row) => row.refusalClass !== 'semantic-changed')
say('')
say('REFUSE (' + refusals.length + ': semantic-changed ' + semantic.length + ', absent ' + absent.length + ')')
for (const row of refusals) {
  const record = table.refused[row.capability]
  const mark = row.verdict === 'ok' ? 'ok  ' : row.verdict === 'stale' ? 'STALE' : 'FAIL'
  say('  ' + mark + ' ' + row.capability.padEnd(20) + row.refusalClass + ' — ' + record.reason.slice(0, 90) + '...')
  if (row.refusalClass === 'semantic-changed' && row.verdict === 'ok') {
    say('       earlier: ' + record.wasThere.kernel + ' ' + record.wasThere.path + ':' + record.wasThere.line)
    say('       this   : ' + record.changedAt.path + ':' + record.changedAt.line)
    say('       discriminator: ' + JSON.stringify(record.discriminator.introduced) + ' present here, absent earlier'
      + (established.has(row.capability) ? ' — established' : ' — NOT ESTABLISHED'))
  }
  if (verbose || row.verdict !== 'ok') for (const line of row.detail) say('       ' + line)
  for (const failure of row.failures) {
    const label = failure.startsWith('NOT ESTABLISHED') ? ''
      : row.verdict === 'stale' ? 'refusal is outdated: ' : ''
    trouble(row.capability + ': ' + label + failure)
  }
}
if (semantic.length < MIN_SEMANTIC_CHANGED) {
  trouble('only ' + semantic.length + ' semantic-changed refusal(s); the floor is ' + MIN_SEMANTIC_CHANGED
    + ' because a refusal that only says "the name is absent" is not evidence of a semantic change')
}

say('')
say('counts    : resolve=' + byDisposition.resolve.length + ' translate=' + byDisposition.translate.length
  + ' refuse/semantic-changed=' + semantic.length + ' refuse/absent=' + absent.length)
const ok = failures.length === 0 && verdict.ok
say(ok ? 'PASS — every row holds, the surface hash matched, and every semantic refusal carries both sides plus a discriminator' : 'FAIL — ' + failures.length + ' problem(s)')
process.exit(ok ? 0 : 1)
