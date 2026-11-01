#!/usr/bin/env node
/**
 * Prove that the compat loader actually refuses.
 *
 * A loader that can be satisfied by a plugin's own claim is worse than no loader: it
 * launders the claim into a guarantee. This suite therefore drives the shipped
 * resolver (compat/engine.ts) against fixture hosts and asserts the refusal path
 * itself, not a happy path:
 *
 *   0  control — a correct host resolves every capability, refuses only the table's
 *      refusals, and every promised role is not merely present but **called once**
 *      (so a promise cannot be satisfied by a name nobody can invoke)
 *   1  a name that is not in the vocabulary throws UnsupportedError carrying all
 *      four fields — capability, kernelVersion, reason, suggestion
 *   2  a known name, on a host where one bound member is missing, refuses instead
 *      of returning a half-built object
 *   3  a translating capability whose target is absent refuses too
 *   4  the pass-through layer hands over the host's own object, and an unknown
 *      service name throws rather than returning undefined
 *   5  a refusal whose witness no longer holds is reported as outdated (and fails
 *      the load when strict), never passed over
 *   6  the same rules hold for a table this build does not ship: the resolver is
 *      version-blind, so a service-rename whose old name is still present fails, and
 *      a name with two dispositions cannot be loaded at all
 *
 * Usage: node scripts/verify-compat-refusal.mjs
 * Exit codes: 0 every assertion held; 1 otherwise.
 */
import { loadCompatModule } from '../compat/load.mjs'

const compat = await loadCompatModule()
const table = compat.TABLES[0]
if (table === undefined) {
  console.error('FAIL — this build carries no compat table section at all')
  process.exit(1)
}
const roleWord = compat.roleWord

let checks = 0
let failures = 0
const check = (label, condition, detail) => {
  checks += 1
  if (condition) {
    console.log('  ok   ' + label)
    return true
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
  return false
}
const section = (title) => { console.log(''); console.log(title) }
const attempt = (run) => {
  try {
    return { value: run(), error: null }
  } catch (error) {
    return { value: undefined, error }
  }
}

/** Every kernel member the table binds a role to, service by service. */
function completeServices() {
  const services = new Map()
  const ensure = (service) => {
    if (!services.has(service)) services.set(service, [])
    return services.get(service)
  }
  for (const row of Object.values(table.capabilities)) {
    for (const target of row.targets) {
      const members = ensure(target.service)
      for (const binding of target.binds) if (!members.includes(binding.member)) members.push(binding.member)
    }
  }
  for (const row of Object.values(table.refused)) {
    for (const witness of row.witness) {
      // A member-absence claim observes the service that would carry the member, so the
      // fixture must mount that service with no matching member — the same rule the
      // resolver enforces in evaluateWitness. Only a service-absence claim wants it gone.
      if (witness.claim === 'service-absent') continue
      ensure(witness.service)
      if (witness.claim === 'member-present') {
        const members = ensure(witness.service)
        if (!members.includes(witness.member)) members.push(witness.member)
      }
    }
  }
  return services
}

/** One host over a member table, recording every call it receives. */
function makeHost(services, label) {
  const values = new Map()
  const calls = []
  const valueOf = (service) => {
    const members = services.get(service)
    if (members === undefined) return undefined
    if (!values.has(service)) {
      const value = {}
      for (const member of members) {
        value[member] = (...args) => {
          calls.push(service + '.' + member)
          return { service, member, args }
        }
      }
      values.set(service, value)
    }
    return values.get(service)
  }
  return { label, membersOf: (service) => services.get(service), valueOf, calls }
}

/** The same host, minus one member of one service — and of that service only. */
const withoutMember = (services, service, member) => {
  const copy = new Map([...services].map(([key, members]) => [key, members.slice()]))
  const members = copy.get(service)
  if (members !== undefined) copy.set(service, members.filter((entry) => entry !== member))
  return copy
}
const withoutService = (services, service) => new Map([...services].filter(([key]) => key !== service))

/** The capabilities the loader itself answers for, derived from the table roles. */
const selfProvided = {}
for (const [name, row] of Object.entries(table.capabilities)) {
  if (row.self !== true) continue
  const provided = {}
  for (const role of row.roles) provided[roleWord(role)] = () => role
  provided.services = {}
  selfProvided[name] = provided
}

const controlServices = completeServices()
const controlHost = makeHost(controlServices, 'complete')
const controlLoad = attempt(() => compat.createCompatLoader({
  table, membersOf: controlHost.membersOf, valueOf: controlHost.valueOf, selfProvided, strict: true,
}))

section('0 — control: a correct host resolves every capability and refuses nothing extra')
if (!check('the loader constructs against a complete host', controlLoad.error === null, String(controlLoad.error?.message ?? ''))) {
  console.log('FAIL — nothing else can be tested without a control run')
  process.exit(1)
}
const loader = controlLoad.value
const controlReport = loader.report()
check('every capability the table declares was exercised',
  Object.keys(table.capabilities).every((name) => controlReport.rows.some((row) => row.capability === name))
  && Object.keys(table.refused).every((name) => controlReport.rows.some((row) => row.capability === name)))
check('the control refused exactly the table refusals',
  controlReport.refused.length === Object.keys(table.refused).length, controlReport.refused.join(', '))
check('and every one of them is counted by class',
  controlReport.refusedSemanticChanged.length + controlReport.refusedAbsent.length === controlReport.refused.length)
check('the control recorded no stale refusal', controlReport.staleRefusals.length === 0)

/** The member each role must reach, so a call can be checked. */
const expectedCalls = []
for (const [name, row] of Object.entries(table.capabilities)) {
  const granted = attempt(() => loader.capability(name))
  check('resolves without throwing: ' + name, granted.error === null, String(granted.error?.message ?? ''))
  if (granted.error !== null) continue
  check('has() agrees: ' + name, loader.has(name) === true)
  const words = row.roles.map(roleWord)
  check('the converged object exposes exactly the promised roles: ' + name,
    JSON.stringify(Object.keys(granted.value).filter((key) => row.roles.map(roleWord).includes(key)).sort())
    === JSON.stringify(words.slice().sort()), Object.keys(granted.value).join(', '))
  for (const word of words) {
    // A role is a thing the capability can do; the loader's own "link.services" is
    // the one role whose value is an object rather than a call, and it is still a
    // usable value rather than undefined.
    const value = granted.value[word]
    check('role is usable: ' + name + '.' + word,
      typeof value === 'function' || (value !== null && typeof value === 'object'), typeof value)
  }
  for (const target of row.targets) {
    for (const binding of target.binds) {
      const call = attempt(() => granted.value[roleWord(binding.role)]('probe'))
      check('role is reachable: ' + binding.role + ' -> ' + target.service + '.' + binding.member, call.error === null,
        String(call.error?.message ?? ''))
      expectedCalls.push(target.service + '.' + binding.member)
    }
  }
}
for (const name of Object.keys(table.refused)) {
  const granted = attempt(() => loader.capability(name))
  check('refuses: ' + name, granted.error !== null && granted.error.name === 'UnsupportedError')
  check('has() says no: ' + name, loader.has(name) === false)
}
const uncalled = expectedCalls.filter((expected) => controlHost.calls.includes(expected) === false)
// What this does and does not prove, stated so nobody over-reads it: the host here is a
// fixture whose members are derived from the same table, so a binding that names a member
// the kernel does not have still passes this line. Member existence against a real kernel
// is asserted by scripts/verify-compat-table.mjs over the measured archived surface.
check('every bound member is reachable through the converged object (fixture host, NOT a live kernel)', uncalled.length === 0, uncalled.join(', '))

// The boundary above is executable rather than a comment: a table with a binding that
// names nothing is still satisfied by the fixture host, and the table validator refuses it.
const bogus = {
  ...table,
  capabilities: {
    ...table.capabilities,
    http: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['http.registerRoute'],
      targets: [{ service: 'webServer', binds: [{ role: 'http.registerRoute', member: 'registerThatNeverExisted' }], evidence: 'fixture' }],
      evidence: 'fixture',
    },
  },
}
// The fixture host is derived from the table under test, so a self-consistent but
// kernel-wrong table satisfies both sides of this suite. That is the exact false safety
// the wording above warns about; here it is shown rather than asserted in prose.
const bogusServices = new Map([...completeServices()].map(([service, members]) => [service, members.slice()]))
bogusServices.get('webServer').push('registerThatNeverExisted')
const bogusHost = makeHost(bogusServices, 'bogus')
const bogusLoad = attempt(() => compat.createCompatLoader({
  table: bogus, membersOf: bogusHost.membersOf, valueOf: bogusHost.valueOf, selfProvided, strict: true,
}))
check('a binding the kernel lacks is invisible to a host derived from the same table (fixture self-consistency, not proof)',
  bogusLoad.error === null && bogusLoad.value.has('http') === true)
check('and the table validator is what refuses it',
  compat.validateTable({ table: bogus, lookup: { membersOf: controlHost.membersOf, serviceNames: () => [] } }).ok === false)

section('1 — a name outside the vocabulary is refused, not ignored')
const UNKNOWN = 'session.definitelyNotAThing'
const unknown = attempt(() => loader.capability(UNKNOWN))
check('throws', unknown.error !== null)
check('is an UnsupportedError', unknown.error instanceof compat.UnsupportedError)
check('carries capability', unknown.error?.capability === UNKNOWN)
check('carries kernelVersion', unknown.error?.kernelVersion === table.kernel, String(unknown.error?.kernelVersion))
check('carries a non-empty reason', typeof unknown.error?.reason === 'string' && unknown.error.reason !== '')
check('carries a non-empty suggestion', typeof unknown.error?.suggestion === 'string' && unknown.error.suggestion !== '')
check('the message names all four facts',
  [UNKNOWN, table.kernel, unknown.error?.reason, unknown.error?.suggestion]
    .every((part) => String(unknown.error?.message ?? '').includes(String(part))))
check('has() is false rather than throwing', loader.has(UNKNOWN) === false)
check('require() takes the same path', attempt(() => loader.require(UNKNOWN)).error instanceof compat.UnsupportedError)

const sampleEntry = Object.entries(table.capabilities).find(([, row]) => row.self !== true && row.targets.length > 0)
const [sampleName, sampleRow] = sampleEntry
const sampleTarget = sampleRow.targets[0]
const sampleBinding = sampleTarget.binds[sampleTarget.binds.length - 1]

section('2 — a known name whose bound member is missing refuses (no half-product)')
const memberHost = makeHost(withoutMember(controlServices, sampleTarget.service, sampleBinding.member), 'member-missing')
const memberLoader = compat.createCompatLoader({
  table, membersOf: memberHost.membersOf, valueOf: memberHost.valueOf, selfProvided, strict: true,
})
const memberReport = memberLoader.report()
const missing = attempt(() => memberLoader.capability(sampleName))
check('throws', missing.error !== null)
check('is an UnsupportedError', missing.error instanceof compat.UnsupportedError)
check('the reason names the missing member and its service',
  missing.error?.reason?.includes(sampleBinding.member) === true && missing.error?.reason?.includes(sampleTarget.service) === true,
  String(missing.error?.reason))
check('nothing half-built is returned', memberLoader.has(sampleName) === false)
check('the refusal is recorded on the row',
  memberReport.rows.find((row) => row.capability === sampleName)?.status === 'refused')
check('the same row resolved on the complete host (so the assertion can fail)',
  controlReport.rows.find((row) => row.capability === sampleName)?.status === 'resolved')
check('the refused set grew by exactly the row that broke',
  memberReport.refused.length === controlReport.refused.length + 1, memberReport.refused.join(', '))
check('every other capability still resolves',
  Object.keys(table.capabilities).filter((name) => name !== sampleName).every((name) => memberLoader.has(name)))

section('3 — a translating capability whose target is absent refuses')
const translateEntry = Object.entries(table.capabilities).find(([, row]) => row.disposition === 'translate' && row.targets.length > 0)
if (translateEntry === undefined) {
  check('the table declares at least one translating capability', false)
} else {
  const [translateName, translateRow] = translateEntry
  const gone = translateRow.targets[0].service
  const translateHost = makeHost(withoutService(controlServices, gone), 'target-absent')
  const translateLoader = compat.createCompatLoader({
    table, membersOf: translateHost.membersOf, valueOf: translateHost.valueOf, selfProvided, strict: true,
  })
  const translated = attempt(() => translateLoader.capability(translateName))
  check('throws for ' + translateName + ' when ' + gone + ' is absent', translated.error instanceof compat.UnsupportedError)
  check('the reason names the absent service', translated.error?.reason?.includes(gone) === true, String(translated.error?.reason))
  check('it resolved on the complete host', loader.has(translateName) === true)
}

section('4 — the pass-through layer is the kernel object, and never undefined')
const rawValue = controlHost.valueOf(sampleTarget.service)
check('services.get returns the host own object', loader.services.get(sampleTarget.service) === rawValue)
const unknownService = attempt(() => loader.services.get('no.such.service'))
check('an unknown service name throws', unknownService.error instanceof compat.UnsupportedError)
check('its suggestion is non-empty', typeof unknownService.error?.suggestion === 'string' && unknownService.error.suggestion !== '')

section('5 — a refusal whose witness expired is reported, not passed over')
const refusalName = Object.keys(table.refused)[0]
const refusalWitness = table.refused[refusalName].witness.find((witness) => witness.claim === 'member-matching-absent')
if (refusalWitness === undefined) {
  check('the first refusal carries a falsifiable witness', false)
} else {
  const introduced = refusalWitness.pattern.split('|')[0] + 'Fields'
  const staleServices = completeServices()
  staleServices.get(refusalWitness.service).push(introduced)
  const staleHost = makeHost(staleServices, 'refusal-stale')
  const strictRun = attempt(() => compat.createCompatLoader({
    table, membersOf: staleHost.membersOf, valueOf: staleHost.valueOf, selfProvided, strict: true,
  }))
  check('a stale refusal fails the load', strictRun.error !== null)
  check('and says so', /stale|expired|outdated/i.test(String(strictRun.error?.message ?? '')), String(strictRun.error?.message ?? ''))
  const lenient = compat.createCompatLoader({
    table, membersOf: staleHost.membersOf, valueOf: staleHost.valueOf, selfProvided, strict: false,
  })
  check('without strict, it is recorded as a stale refusal', lenient.report().staleRefusals.includes(refusalName))
  check('and the capability still refuses', attempt(() => lenient.capability(refusalName)).error instanceof compat.UnsupportedError)
  check('on the untouched host the same refusal is not stale',
    compat.createCompatLoader({ table, membersOf: controlHost.membersOf, valueOf: controlHost.valueOf, selfProvided, strict: true })
      .report().staleRefusals.length === 0)
}

section('6 — the resolver is version-blind: the same rules hold for another table')
const fixture = {
  kernel: 'fixture-v9.9.9',
  packageVersion: '9.9.9',
  commit: null,
  previousKernel: 'fixture-v0.0.1',
  surface: { file: 'fixture', sha256: 'fixture' },
  roots: ['http'],
  notes: 'fixture table: this build ships no section for it, which is the point.',
  capabilities: {
    http: {
      disposition: 'translate',
      kind: 'service-rename',
      roles: ['http.registerRoute'],
      targets: [{ service: 'webServer', binds: [{ role: 'http.registerRoute', member: 'register' }], evidence: 'fixture' }],
      translation: { from: 'httpServer', to: 'webServer' },
      evidence: 'fixture',
    },
  },
  refused: {},
}
const lookupOf = (names) => ({
  membersOf: (service) => (names.includes(service) ? ['register'] : undefined),
  serviceNames: () => names,
})
const translated = compat.validateTable({ table: fixture, lookup: lookupOf(['webServer']) })
check('the target present: the row holds', translated.ok === true, JSON.stringify(translated.rows[0]?.failures ?? []))
check('and the counts are split by class', translated.counts.translate === 1 && translated.counts.refuseSemanticChanged === 0)
const stillThere = compat.validateTable({ table: fixture, lookup: lookupOf(['webServer', 'httpServer']) })
check('the old name still present: the row fails', stillThere.ok === false)
check('and the failure says why', String(stillThere.rows[0]?.failures?.[0] ?? '').includes('httpServer'),
  String(stillThere.rows[0]?.failures?.[0] ?? ''))
const missingTarget = compat.validateTable({ table: fixture, lookup: lookupOf([]) })
check('the target absent: the row fails', missingTarget.ok === false)
const doubled = {
  ...fixture,
  refused: {
    http: {
      disposition: 'refuse', class: 'semantic-changed', reason: 'r', suggestion: 's', evidence: 'fixture',
      wasThere: { kernel: 'fixture', path: 'p', line: 1, contains: 'c', fact: 'f' },
      changedAt: { kernel: 'fixture', path: 'p', line: 1, contains: 'c', fact: 'f' },
      discriminator: { introduced: 'i', presentAt: { path: 'p', line: 1 }, absentIn: 'q', note: 'n' },
      witness: [{ claim: 'service-present', service: 'webServer', because: 'b' }],
    },
  },
}
const doubledProblems = compat.tableProblems(doubled)
check('one name with two dispositions is a table problem',
  doubledProblems.some((problem) => problem.includes('exactly one disposition')), doubledProblems.join('; '))
check('a semantic refusal without an earlier-side line is a table problem',
  compat.tableProblems({
    ...fixture,
    refused: { 'http.something': { ...doubled.refused.http, wasThere: undefined } },
  }).some((problem) => problem.includes('shows no earlier-kernel line')))
check('and such a table cannot be loaded',
  attempt(() => compat.createCompatLoader({
    table: doubled, membersOf: lookupOf(['webServer']).membersOf, valueOf: () => ({ register: () => undefined }), strict: true,
  })).error !== null)

console.log('')
console.log('LIVE KERNEL: not run — this suite boots nothing.')
console.log('  It proves the resolver refuses, binds and converges. Member existence on a real kernel is')
console.log('  asserted by scripts/verify-compat-table.mjs against the measured archived surface document.')
console.log('  A live-invocation mode (--live-kernel) is not implemented yet and is recorded as NOT RUN.')
console.log('')
console.log('assertions: ' + checks + ', failed: ' + failures)
console.log(failures === 0
  ? 'PASS — the loader refuses unknown names, missing bindings, absent targets and stale premises'
  : 'FAIL — the refusal path is not proven')
process.exit(failures === 0 ? 0 : 1)
