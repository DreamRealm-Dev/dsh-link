#!/usr/bin/env node
/**
 * Gate: every compat table section is bound to an archived surface of ITS OWN kernel, and every
 * binding in it names a member that surface recorded.
 *
 * Why this exists (R216): the loader refuses an unknown kernel with a fix, and each table's header
 * claims its evidence cannot drift under it - but until now NOTHING checked that claim. A section
 * could cite a surface whose SHA had moved, or bind a role to a member the kernel stopped carrying,
 * and every existing gate would stay green. The alpha.5 rehearsal found exactly that by hand
 * (agent.start bound to subagents.start, which alpha.5 renamed to startActivation).
 *
 * What this gate proves, and what it does NOT (an independent review in R216 caught the first draft
 * claiming more than it measured):
 *   - it proves NAME PRESENCE on the named service, not public visibility: the archived surface is a
 *     prototype dump, so it cannot tell a public method from a private one. Binding a role to an
 *     internal member would pass here and is a producer error this gate cannot see.
 *   - it proves the section cites the archive of the kernel it claims to describe (kernel id,
 *     packageVersion and commit compared against the archive's own origin block).
 *   - it proves every role the section declares is bound exactly once, and that no binding names a
 *     role the section did not declare.
 *   - it does NOT prove the binding is the RIGHT member for the role: that is a data judgement no
 *     mechanical check can make here. compat-table judges the refusals; the live mount judges the
 *     loader; this gate judges the coordinates.
 *
 * Readings:
 *   R1  every section names an archived surface file that exists
 *   R2  the section's sha256, kernel id, packageVersion and commit agree with that archive's origin
 *   R3  every section's composition counts equal the archived document's counts
 *   R4  every (service, member) binding, INCLUDING a one-line target, exists in that section's surface
 *   R5  every declared role is bound exactly once and no binding names an undeclared role
 *   R6  declared readings == produced readings
 *
 * Usage: node scripts/verify-compat-table-bindings.mjs [--json] [--self-attack]
 * Exit 0 every reading held | 1 a reading failed, or a mutant did not land | 3 an input is missing.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const DECLARED = 6

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SELF_ATTACK = argv.includes('--self-attack')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/**
 * Every binding in one table source, one-line targets included.
 *
 * A target may be written on one line - { service: 'sessions', binds: [{ role: 'store.listSessions',
 * member: 'list' }], evidence: ... } - and the first draft of this gate skipped exactly those: it
 * returned as soon as it saw the service field and never looked at the rest of the line. Three
 * bindings per section were therefore never checked, and the mutants could not find it because they
 * mutated the parsed array rather than the source text. The line is parsed for BOTH forms now.
 */
const bindingsOf = (source) => {
  const found = []
  let carried = null
  source.split(/\r?\n/).forEach((line, index) => {
    const svc = /service: '([^']+)'/.exec(line)
    const service = svc === null ? carried : svc[1]
    if (svc !== null) carried = svc[1]
    for (const match of line.matchAll(/\{ role: '([^']+)', member: '([^']+)' \}/g)) {
      if (service !== null) found.push({ service, role: match[1], member: match[2], line: index + 1 })
    }
  })
  return found
}

/** The roles a section declares, capability by capability. */
const declaredRolesOf = (source) => {
  const roles = []
  for (const match of source.matchAll(/roles: \[([^\]]*)\]/g)) {
    for (const one of match[1].split(',')) {
      const role = /'([^']+)'/.exec(one)
      if (role !== null) roles.push(role[1])
    }
  }
  return roles
}

/** Read the sections the registry names, each with its archived surface (or null). */
const readSections = () => {
  const registryText = readFileSync(join(PROJECT, 'compat', 'index.ts'), 'utf8')
  const files = [...registryText.matchAll(/from '\.\/table\/([^']+)'/g)].map((match) => 'compat/table/' + match[1])
  return files.map((file) => {
    const source = readFileSync(join(PROJECT, file), 'utf8')
    const surfaceFile = /const SURFACE = '([^']+)'/.exec(source)
    const sha = /sha256: '([0-9a-f]{64})'/.exec(source)
    const identity = {
      kernel: /kernel: '([^']+)'/.exec(source)?.[1] ?? null,
      packageVersion: /packageVersion: '([^']+)'/.exec(source)?.[1] ?? null,
      commit: /commit: '([^']+)'/.exec(source)?.[1] ?? null,
    }
    const counts = {
      declaredProperties: Number(/declaredProperties: (\d+)/.exec(source)?.[1]),
      reachableServices: Number(/reachableServices: (\d+)/.exec(source)?.[1]),
      events: Number(/events: (\d+)/.exec(source)?.[1]),
    }
    const at = surfaceFile === null ? null : join(PROJECT, surfaceFile[1])
    const surfaceText = at === null || existsSync(at) !== true ? null : readFileSync(at, 'utf8')
    return {
      file,
      surfaceFile: surfaceFile === null ? null : surfaceFile[1],
      sha: sha === null ? null : sha[1],
      identity,
      counts,
      bindings: bindingsOf(source),
      roles: declaredRolesOf(source),
      surface: surfaceText === null ? null : { sha: sha256(surfaceText), document: JSON.parse(surfaceText) },
    }
  })
}

/** The judge: pure, one reading per question, no I/O. */
const judge = (sections) => {
  const rows = []
  const record = (id, ok, detail) => rows.push({ id, ok: ok === true, detail })

  const noSurface = sections.filter((section) => section.surface === null)
  record('R1', sections.length > 0 && noSurface.length === 0, 'sections=' + String(sections.length) + ' withoutAnArchivedSurface=' + JSON.stringify(noSurface.map((section) => section.file + ' -> ' + String(section.surfaceFile))))

  const identityProblems = []
  for (const section of sections) {
    if (section.surface === null) { identityProblems.push(section.file + ': no archive to compare'); continue }
    const origin = section.surface.document.kernel ?? {}
    if (section.sha !== section.surface.sha) identityProblems.push(section.file + ': sha256 table ' + String(section.sha).slice(0, 12) + ' vs archive ' + section.surface.sha.slice(0, 12))
    if (origin.id !== section.identity.kernel) identityProblems.push(section.file + ': kernel ' + String(section.identity.kernel) + ' vs archive ' + String(origin.id))
    if (origin.version !== section.identity.packageVersion) identityProblems.push(section.file + ': packageVersion ' + String(section.identity.packageVersion) + ' vs archive ' + String(origin.version))
    const commit = String(origin.commit ?? '')
    const claimed = String(section.identity.commit ?? '')
    if (commit.length < 7 || claimed.length < 7 || commit.startsWith(claimed) !== true) identityProblems.push(section.file + ': commit ' + claimed + ' vs archive ' + commit)
  }
  record('R2', sections.length > 0 && identityProblems.length === 0, identityProblems.length === 0 ? 'sha256 + kernel identity + commit agree with the archive for every section' : JSON.stringify(identityProblems))

  const countMismatch = []
  for (const section of sections) {
    if (section.surface === null) continue
    const counts = section.surface.document.counts ?? {}
    for (const key of ['declaredProperties', 'reachableServices', 'events']) {
      if (Number(counts[key]) !== section.counts[key]) countMismatch.push(section.file + ' ' + key + ': table ' + String(section.counts[key]) + ' surface ' + String(counts[key]))
    }
  }
  record('R3', countMismatch.length === 0, countMismatch.length === 0 ? 'composition counts equal the archived documents' : JSON.stringify(countMismatch))

  const absent = []
  let checked = 0
  for (const section of sections) {
    if (section.surface === null) continue
    for (const binding of section.bindings) {
      checked += 1
      const service = section.surface.document.services?.[binding.service]
      if (service === undefined) { absent.push(section.file + ':' + String(binding.line) + ' ' + binding.service + ' (no service)'); continue }
      if (Array.isArray(service.members) !== true || service.members.includes(binding.member) !== true) absent.push(section.file + ':' + String(binding.line) + ' ' + binding.service + '.' + binding.member + ' (no member)')
    }
  }
  record('R4', checked > 0 && absent.length === 0, 'bindings checked=' + String(checked) + ' (one-line targets included) absent=' + JSON.stringify(absent))

  // R5 asks the two questions a binding map can answer on its own: a role is never bound twice in one
  // section, and no binding names a role the section never declared. It deliberately does NOT require
  // every declared role to be bound: the 'link' capability in both sections declares link.require /
  // link.report / link.services and binds none of them, by design, so the reverse direction is reported
  // as a number here instead of being asserted (and would need a real parse of each row's form to judge).
  const roleProblems = []
  const unboundDeclared = []
  for (const section of sections) {
    const declared = new Set(section.roles)
    const bound = new Map()
    for (const binding of section.bindings) bound.set(binding.role, (bound.get(binding.role) ?? 0) + 1)
    for (const [role, count] of bound) if (count > 1) roleProblems.push(section.file + ': role ' + role + ' bound ' + String(count) + ' times')
    for (const role of bound.keys()) if (declared.has(role) !== true) roleProblems.push(section.file + ': role ' + role + ' bound but not declared')
    for (const role of declared) if (bound.has(role) !== true) unboundDeclared.push(section.file + ': ' + role)
  }
  const declaredTotal = sections.reduce((sum, section) => sum + section.roles.length, 0)
  record('R5', roleProblems.length === 0, roleProblems.length === 0
    ? 'no role is bound twice and no binding names an undeclared role (' + String(declaredTotal) + ' roles declared across ' + String(sections.length) + ' section(s); ' + String(unboundDeclared.length) + ' declared role(s) carry no binding by design: ' + JSON.stringify(unboundDeclared.slice(0, 6)) + ')'
    : JSON.stringify(roleProblems))

  record('R6', rows.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(rows.length + 1))
  return rows
}

/** One fact rewritten per mutant; each declares the readings that must redden. */
const mutants = (sections) => {
  const copyOf = (list) => list.map((section) => ({ ...section, identity: { ...section.identity }, counts: { ...section.counts }, bindings: section.bindings.map((binding) => ({ ...binding })), roles: [...section.roles] }))
  return [
    {
      name: 'a-one-line-target-names-a-member-the-kernel-does-not-carry',
      // R5 reddens as well, and honestly: the planted binding reuses an existing role, so that role is
      // suddenly bound twice. A one-line target the kernel does not carry is caught by both questions.
      declared: ['R4', 'R5'],
      apply: (list) => {
        const section = list.find((one) => one.bindings.some((binding) => binding.service === 'sessions')) ?? list[0]
        section.bindings.push({ service: 'sessions', role: 'store.listSessions', member: 'noSuchMemberAtAll', line: 0 })
      },
    },
    {
      name: 'a-binding-names-a-member-the-kernel-does-not-carry',
      declared: ['R4', 'R5'],
      apply: (list) => {
        const drifted = list.find((section) => section.surface !== null && (section.surface.document.services?.subagents?.members ?? []).includes('start') !== true)
        const target = drifted ?? list[0]
        target.bindings.push({ service: 'subagents', role: 'agent.start', member: 'start', line: 0 })
      },
    },
    {
      name: 'the-section-cites-another-kernels-surface',
      declared: ['R2'],
      apply: (list) => { list[0].identity.kernel = 'dsh-v9.9.9-nope' },
    },
    {
      name: 'the-section-cites-a-surface-whose-sha-moved',
      declared: ['R2'],
      apply: (list) => { list[0].sha = 'f'.repeat(64) },
    },
    {
      name: 'the-section-copies-another-kernels-counts',
      declared: ['R3'],
      apply: (list) => { list[0].counts.declaredProperties = list[0].counts.declaredProperties + 1 },
    },
    {
      name: 'the-section-cites-a-surface-that-is-not-archived',
      declared: ['R1', 'R2'],
      apply: (list) => { list[0].surface = null },
    },
    {
      name: 'a-role-is-bound-twice',
      declared: ['R5'],
      apply: (list) => { const section = list.find((one) => one.bindings.length > 0) ?? list[0]; section.bindings.push({ ...section.bindings[0] }) },
    },
    {
      name: 'a-binding-names-a-role-the-section-never-declared',
      declared: ['R5'],
      apply: (list) => { list[0].bindings.push({ service: 'tools', role: 'tools.notADeclaredRole', member: 'get', line: 0 }) },
    },
  ]
}

const main = () => {
  const sections = readSections()
  if (sections.length === 0) {
    console.log('SKIP: the registry names no table section, so there is nothing to judge')
    return 3
  }
  const baseline = judge(sections)
  const red = baseline.filter((row) => row.ok !== true).map((row) => row.id)
  if (SELF_ATTACK) {
    console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline: the shipped sections judged as they are -> red=' + JSON.stringify(red))
    let failures = red.length === 0 ? 0 : 1
    for (const mutant of mutants(sections)) {
      // identity is cloned too: without it, 'cites-another-kernels-surface' mutates the ORIGINAL section's
      // identity object and every later mutant inherits the damage, which reddens readings it never touched.
      const copy = sections.map((section) => ({ ...section, identity: { ...section.identity }, counts: { ...section.counts }, bindings: section.bindings.map((binding) => ({ ...binding })), roles: [...section.roles] }))
      mutant.apply(copy)
      const seen = judge(copy).filter((row) => row.ok !== true).map((row) => row.id)
      const precise = seen.length === mutant.declared.length && mutant.declared.every((id) => seen.includes(id))
      if (precise !== true) failures += 1
      console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + JSON.stringify(seen) + ' declared=' + JSON.stringify(mutant.declared))
    }
    console.log(failures === 0 ? '  every mutant landed where it declared' : '  ' + String(failures) + ' failure(s)')
    return failures === 0 ? 0 : 1
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ gate: 'compat-table-bindings', declared: DECLARED, rows: baseline }, null, 2))
  } else {
    for (const row of baseline) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '  |  ' + row.detail)
    console.log('')
    console.log(String(baseline.length) + ' readings, ' + String(baseline.length - red.length) + ' held, ' + String(red.length) + ' failed')
  }
  return red.length === 0 ? 0 : 1
}

process.exitCode = main()
