/**
 * The kernel-independent half of the compat loader.
 *
 * Nothing here knows a kernel service name: every kernel-specific fact is read
 * from a section of «compat/table/<kernel>.ts». The same code answers two
 * questions:
 *
 *   «validateTable» asks a kernel surface whether each row is still true. It is
 *   what «scripts/verify-compat-table.mjs» runs, and it turns a stale row into a
 *   red test rather than a user's silent misbehaviour.
 *
 *   «createCompatLoader» does the same against a live kernel, once, before any
 *   plugin's «apply» runs, and caches what it found. A capability that cannot be
 *   honoured throws «UnsupportedError» naming itself, the kernel, the reason and
 *   the alternative — it never returns a half-product and never degrades to
 *   «undefined».
 *
 * A capability resolves to a frozen object keyed by **role word**: the plugin
 * binds «http.registerRoute», and the section decides that this kernel's
 * «webServer.register» answers it.
 */
import type { CapabilityRow, CompatTable, Disposition, RefusalClass, RefusalRow, RoleBinding, Witness } from './types.ts'

/**
 * The one error type this layer throws, with the four fields a reader needs to
 * decide what to do instead: the capability asked for, the kernel it was asked
 * on, why it cannot be honoured, and the concrete alternative.
 */
export class UnsupportedError extends Error {
  /** The capability name the caller asked for. */
  readonly capability: string
  /** The kernel identity the question was asked on. */
  readonly kernelVersion: string
  /** Why this kernel cannot honour it. */
  readonly reason: string
  /** What to do instead. */
  readonly suggestion: string

  /**
   * @param details - the four fields, all required and all non-empty.
   */
  constructor(details: { capability: string; kernelVersion: string; reason: string; suggestion: string }) {
    super(`unsupported capability "${details.capability}" on ${details.kernelVersion}: ${details.reason} (suggestion: ${details.suggestion})`)
    this.name = 'UnsupportedError'
    this.capability = details.capability
    this.kernelVersion = details.kernelVersion
    this.reason = details.reason
    this.suggestion = details.suggestion
  }
}

/** Reads the member names a kernel service exposes, or «undefined» when it is absent. */
export interface MembersLookup {
  /** @param service - the kernel's own service name. */
  membersOf(service: string): readonly string[] | undefined
  /** Every declared context property name, when the surface can enumerate them. */
  serviceNames?(): readonly string[]
}

/** A live kernel: member names for validation, values for the converged objects. */
export interface HostLookup extends MembersLookup {
  /** @param service - the kernel's own service name. */
  valueOf(service: string): unknown
}

/** The role word a frozen role name exposes on the converged object. */
export function roleWord(role: string): string {
  const at = role.indexOf('.')
  return at === -1 ? role : role.slice(at + 1)
}

/** What one row of a table turned out to be on one kernel. */
export interface RowVerdict {
  /** Capability name. */
  capability: string
  /** The disposition the row declares. */
  disposition: Disposition
  /** For a refusal row, which kind of refusal it is. */
  refusalClass?: RefusalClass
  /** «ok»: honoured. «fail»: the row cannot be honoured here. «stale»: a refusal's premise is gone. */
  verdict: 'ok' | 'fail' | 'stale'
  /** One line per fact checked, prefixed «ok» or «FAIL». */
  detail: string[]
  /** The failures, empty when the verdict is «ok». */
  failures: string[]
}

/** The whole table's verdict against one kernel. */
export interface TableVerdict {
  /** Kernel identity the table is keyed by. */
  kernel: string
  /**
   * How many rows of each disposition were checked. Refusals are split by class:
   * only «refuseSemanticChanged» is evidence that a semantic change was found.
   */
  counts: { resolve: number; translate: number; refuseSemanticChanged: number; refuseAbsent: number }
  /** One verdict per capability, ordered by name. */
  rows: RowVerdict[]
  /** True when every row is «ok». */
  ok: boolean
}

/**
 * Check the table's own invariants — the ones that make a wrong table
 * unrepresentable rather than merely discouraged.
 *
 * @param table - the kernel section.
 * @returns one message per broken invariant, empty when the table is well formed.
 */
export function tableProblems(table: CompatTable): string[] {
  const problems: string[] = []
  const roots = new Set(table.roots)
  if (roots.size === 0) problems.push('the table declares no neutral word roots')
  if (table.surface.sha256.trim() === '') problems.push('the table is not bound to an archived surface document')
  if (table.previousKernel.trim() === '') problems.push('the table names no earlier kernel for its refusals')
  const seen = new Map<string, Disposition>()
  /** Which capability promised each role; a role may have exactly one owner. */
  const roleOwners = new Map<string, string>()
  for (const [name, row] of Object.entries(table.capabilities)) seen.set(name, row.disposition)
  for (const [name, row] of Object.entries(table.refused)) {
    const first = seen.get(name)
    if (first !== undefined) {
      problems.push(`capability "${name}" is declared as ${first} and as ${row.disposition}; a name has exactly one disposition`)
      continue
    }
    seen.set(name, row.disposition)
  }
  for (const [name, row] of Object.entries(table.capabilities)) {
    const root = name.split('.')[0]
    if (!roots.has(root)) problems.push(`capability "${name}" does not start with a neutral word root (${[...roots].join(', ')})`)
    if (row.evidence.trim() === '') problems.push(`capability "${name}" carries no evidence`)
    if (row.disposition === 'translate' && row.translation === undefined) problems.push(`capability "${name}" translates but declares no translation`)
    if (row.disposition === 'resolve' && row.translation !== undefined) problems.push(`capability "${name}" resolves but declares a translation`)
    if (row.roles.length === 0) problems.push(`capability "${name}" promises no roles`)
    if (row.self === true) {
      if (row.targets.length > 0) problems.push(`capability "${name}" is self-provided but names kernel targets`)
      if ((row.providedBy ?? '') === '') problems.push(`capability "${name}" is self-provided but names no providing package`)
    } else {
      if (row.targets.length === 0) problems.push(`capability "${name}" names no kernel target`)
    }
    const bound = new Map<string, string>()
    for (const target of row.targets) {
      if (target.binds.length === 0) problems.push(`capability "${name}" target "${target.service}" binds no roles`)
      if (target.evidence.trim() === '') problems.push(`capability "${name}" target "${target.service}" carries no evidence`)
      for (const binding of target.binds) {
        checkBinding(problems, name, target.service, binding, row.roles, roots, bound)
      }
    }
    for (const role of row.roles) {
      const root0 = role.split('.')[0]
      if (!roots.has(root0)) problems.push(`capability "${name}" promises role "${role}", which is not a neutral name`)
      if (root0 !== root) problems.push(`capability "${name}" promises role "${role}", whose root is not this capability's root`)
      const owner = roleOwners.get(role)
      if (owner !== undefined) problems.push(`role "${role}" is promised by both "${owner}" and "${name}"; a role has one owner`)
      if (owner === undefined) roleOwners.set(role, name)
      if (row.self !== true && bound.has(role) === false) {
        problems.push(`capability "${name}" promises role "${role}", which no target binds; a promise with no binding cannot be honoured`)
      }
    }
    const extra = [...bound.keys()].filter((role) => row.roles.includes(role) === false)
    if (extra.length > 0) problems.push(`capability "${name}" binds ${extra.join(', ')}, which it does not promise`)
  }
  for (const [name, row] of Object.entries(table.refused)) {
    const root = name.split('.')[0]
    if (!roots.has(root)) problems.push(`capability "${name}" does not start with a neutral word root`)
    if (row.reason.trim() === '') problems.push(`refusal "${name}" gives no reason`)
    if (row.suggestion.trim() === '') problems.push(`refusal "${name}" suggests nothing`)
    if (row.evidence.trim() === '') problems.push(`refusal "${name}" carries no evidence`)
    if (row.witness.length === 0) problems.push(`refusal "${name}" rests on no witness`)
    if (row.class === 'semantic-changed') {
      if (row.wasThere === undefined) problems.push(`refusal "${name}" claims a semantic change but shows no earlier-kernel line`)
      if (row.changedAt === undefined) problems.push(`refusal "${name}" claims a semantic change but shows no this-kernel line`)
      if (row.discriminator === undefined) problems.push(`refusal "${name}" claims a semantic change but declares no discriminator`)
      else if (row.discriminator.introduced.trim() === '') problems.push(`refusal "${name}" has an empty discriminator token`)
    } else if (row.wasThere !== undefined || row.changedAt !== undefined || row.discriminator !== undefined) {
      problems.push(`refusal "${name}" is class "${row.class}" and must not carry two-sided semantic evidence`)
    }
  }
  return problems
}

/** One role binding, checked against the row it belongs to. */
function checkBinding(
  problems: string[], name: string, service: string, binding: RoleBinding, roles: string[], roots: Set<string>, bound: Map<string, string>,
): void {
  if (binding.role.trim() === '' || binding.member.trim() === '') {
    problems.push(`capability "${name}" has an empty binding on "${service}"`)
    return
  }
  if (binding.member.startsWith('_')) problems.push(`capability "${name}" binds role "${binding.role}" to private member "${binding.member}"`)
  const held = bound.get(binding.role)
  if (held !== undefined) problems.push(`capability "${name}" binds role "${binding.role}" twice ("${held}" and "${binding.member}")`)
  bound.set(binding.role, binding.member)
  if (roles.includes(binding.role) === false) problems.push(`capability "${name}" binds "${binding.role}" without promising it`)
  if (roots.has(binding.role.split('.')[0]) === false || binding.role.split('.')[0] !== name.split('.')[0]) {
    problems.push(`capability "${name}" binds "${binding.role}", whose root is not this capability's root`)
  }
}

/**
 * Ask one kernel surface whether one witness still holds.
 *
 * @param witness - the claim to test.
 * @param lookup - the kernel's member names.
 * @returns whether it holds, and what was observed either way.
 */
export function evaluateWitness(witness: Witness, lookup: MembersLookup): { holds: boolean; observed: string; established?: boolean } {
  switch (witness.claim) {
    case 'service-present': {
      const members = lookup.membersOf(witness.service)
      return members === undefined
        ? { holds: false, observed: `service "${witness.service}" is absent` }
        : { holds: true, observed: `service "${witness.service}" present (${members.length} members)` }
    }
    case 'service-absent': {
      // An absence claim is only evidence when the thing that would show presence
      // can be looked at: with no enumerable surface, "not found" means "we could
      // not look", which is not the same statement.
      if (lookup.serviceNames === undefined) {
        return { holds: false, established: false, observed: `the surface cannot enumerate its services, so "${witness.service}" being absent is not an observation` }
      }
      const members = lookup.membersOf(witness.service)
      return members === undefined
        ? { holds: true, observed: `service "${witness.service}" is absent from ${lookup.serviceNames().length} declared properties` }
        : { holds: false, observed: `service "${witness.service}" is present with ${members.length} members` }
    }
    case 'member-present': {
      const members = lookup.membersOf(witness.service)
      if (members === undefined) return { holds: false, observed: `service "${witness.service}" is absent, so "${witness.member}" cannot be present` }
      return members.includes(witness.member)
        ? { holds: true, observed: `"${witness.service}.${witness.member}" present` }
        : { holds: false, observed: `"${witness.service}.${witness.member}" is absent` }
    }
    case 'member-absent': {
      const members = lookup.membersOf(witness.service)
      if (members === undefined) {
        return { holds: false, established: false, observed: `service "${witness.service}" is absent, so its members cannot be observed` }
      }
      return members.includes(witness.member)
        ? { holds: false, observed: `"${witness.service}.${witness.member}" is present` }
        : { holds: true, observed: `"${witness.service}.${witness.member}" absent` }
    }
    case 'member-matching-absent': {
      const members = lookup.membersOf(witness.service)
      if (members === undefined) {
        return { holds: false, established: false, observed: `service "${witness.service}" is absent, so what its members match cannot be observed` }
      }
      const pattern = new RegExp(witness.pattern)
      const matched = members.filter((member) => pattern.test(member))
      return matched.length === 0
        ? { holds: true, observed: `no member of "${witness.service}" matches /${witness.pattern}/` }
        : { holds: false, observed: `"${witness.service}" now exposes ${matched.map((member) => `"${member}"`).join(', ')}, matching /${witness.pattern}/` }
    }
    default:
      return { holds: false, observed: `unknown witness claim ${JSON.stringify(witness)}` }
  }
}

/** Check one row against a kernel surface. */
function evaluateRow(name: string, row: CapabilityRow | RefusalRow, lookup: MembersLookup): RowVerdict {
  const detail: string[] = []
  const failures: string[] = []
  if (row.disposition === 'refuse') {
    for (const witness of row.witness) {
      const { holds, observed, established } = evaluateWitness(witness, lookup)
      const mark = established === false ? 'NOT-ESTABLISHED' : holds ? 'ok  ' : 'STALE'
      detail.push(`${mark} ${observed} — ${witness.because}`)
      if (established === false) failures.push(`NOT ESTABLISHED — ${observed} (${witness.because})`)
      else if (!holds) failures.push(`${observed} — the refusal's premise no longer holds: ${witness.because}`)
    }
    return {
      capability: name,
      disposition: 'refuse',
      refusalClass: row.class,
      verdict: failures.length === 0 ? 'ok' : 'stale',
      detail,
      failures,
    }
  }
  if (row.self === true) {
    detail.push(`ok   provided by ${row.providedBy ?? '(unnamed package)'}, not by the kernel`)
    return { capability: name, disposition: row.disposition, verdict: 'ok', detail, failures }
  }
  for (const target of row.targets) {
    const members = lookup.membersOf(target.service)
    if (members === undefined) {
      failures.push(`the capability resolves to service "${target.service}", which is absent from this kernel`)
      detail.push(`FAIL service "${target.service}" absent — ${target.evidence}`)
      continue
    }
    detail.push(`ok   service "${target.service}" present (${members.length} members) — ${target.evidence}`)
    for (const binding of target.binds) {
      if (members.includes(binding.member)) {
        detail.push(`ok   role "${binding.role}" is served by "${target.service}.${binding.member}"`)
      } else {
        failures.push(`role "${binding.role}" binds to "${target.service}.${binding.member}", which this kernel does not expose`)
        detail.push(`FAIL "${target.service}.${binding.member}" absent`)
      }
    }
  }
  if (row.translation !== undefined && row.kind === 'service-rename') {
    const stillThere = lookup.membersOf(row.translation.from)
    if (stillThere !== undefined) {
      failures.push(`the row translates "${row.translation.from}" to "${row.translation.to}", but "${row.translation.from}" is still on this kernel`)
    }
  }
  return { capability: name, disposition: row.disposition, verdict: failures.length === 0 ? 'ok' : 'fail', detail, failures }
}

/**
 * Check every row of a table against one kernel surface.
 *
 * The file-level half of a «semantic-changed» refusal — the earlier-kernel line,
 * the this-kernel line and the discriminator — is checked by
 * «scripts/verify-compat-table.mjs», which has the earlier checkout. This function
 * checks the surface half, which is all a running kernel can answer.
 *
 * @param input.table - the kernel section.
 * @param input.lookup - the surface: member names by service, and its property names when it can enumerate them.
 * @returns the per-row verdicts and whether the whole table held.
 */
export function validateTable(input: { table: CompatTable; lookup: MembersLookup }): TableVerdict {
  const rows: RowVerdict[] = []
  for (const [name, row] of Object.entries(input.table.capabilities)) rows.push(evaluateRow(name, row, input.lookup))
  for (const [name, row] of Object.entries(input.table.refused)) rows.push(evaluateRow(name, row, input.lookup))
  rows.sort((left, right) => left.capability.localeCompare(right.capability))
  const counts = { resolve: 0, translate: 0, refuseSemanticChanged: 0, refuseAbsent: 0 }
  for (const row of rows) {
    if (row.disposition === 'refuse') {
      if (row.refusalClass === 'semantic-changed') counts.refuseSemanticChanged += 1
      else counts.refuseAbsent += 1
    } else counts[row.disposition] += 1
  }
  return { kernel: input.table.kernel, counts, rows, ok: rows.every((row) => row.verdict === 'ok') }
}

/** One row's outcome after the loader has run it. */
export interface CompatRowReport {
  /** Capability name. */
  capability: string
  /** Its disposition. */
  disposition: Disposition
  /** For a refusal row, which kind of refusal it is. */
  refusalClass?: RefusalClass
  /** «resolved» when a value was cached; «refused» when the row refuses here. */
  status: 'resolved' | 'refused' | 'stale-refusal'
  /** Wall-clock milliseconds spent resolving this row, at load. */
  ms: number
  /** Failures, empty when the row resolved. */
  failures: string[]
}

/** What the loader found, for «report()» and for the row's own log line. */
export interface CompatReport {
  /** Kernel identity the table is keyed by. */
  kernel: string
  /** The same kernel as its own manifest states it. */
  packageVersion: string
  /** Commit the kernel is pinned at, when known. */
  commit: string | null
  /** Milliseconds from loader construction to the last row resolved. */
  resolveMs: number
  /** Capabilities that resolved, by name. */
  resolved: string[]
  /**
   * Every capability this kernel does not honour: a refusal row, and any row whose
   * target or role bindings are missing on this kernel.
   */
  refused: string[]
  /** The refusals that came from a semantic change — the ones the table exists for. */
  refusedSemanticChanged: string[]
  /** The refusals that only say the name is absent here. */
  refusedAbsent: string[]
  /** Refusals whose premise has expired; a table bug, not a kernel fact. */
  staleRefusals: string[]
  /** Every row's outcome. */
  rows: CompatRowReport[]
}

/** What a plugin sees through «ctx.link.compat». */
export interface CompatLoader {
  /** Kernel identity this loader was built for. */
  readonly kernel: string
  /** Pass-through layer: the kernel's own service object, by its own name. */
  readonly services: { get(service: string): unknown }
  /** Simplified layer: the converged object for a capability name. */
  capability(name: string): unknown
  /** Whether «capability(name)» would return a value, without throwing. */
  has(name: string): boolean
  /** «capability(name)», kept as the name the vocabulary promises. */
  require(name: string): unknown
  /** Capability × disposition × evidence, for a plugin's self-check and for review. */
  report(): CompatReport
}

/** Options for {@link createCompatLoader}. */
export interface CompatLoaderOptions extends HostLookup {
  /** The kernel section to run. */
  table: CompatTable
  /** Implementations this loader owns, for rows marked «self», keyed by role word. */
  selfProvided?: Record<string, Record<string, unknown>>
  /** Fail the load when a refusal's premise has expired. Defaults to true. */
  strict?: boolean
  /** Clock, for the per-row timing record. Defaults to «Date.now». */
  now?: () => number
}

/** Copy a record's «from» key onto «to», leaving the rest of the record alone. */
function rename(record: unknown, from: string, to: string): Record<string, unknown> {
  if (record === null || typeof record !== 'object') throw new TypeError(`cannot translate ${typeof record} as a row`)
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>), [to]: (record as Record<string, unknown>)[from] }
  delete out[from]
  return out
}

/**
 * Resolve a whole kernel section once, against a live host, and cache it.
 *
 * @param options - the table, the host, and this loader's own capabilities.
 * @returns the two plugin-facing layers and the report.
 * @throws when the table is malformed, or when «strict» and a refusal is stale.
 */
export function createCompatLoader(options: CompatLoaderOptions): CompatLoader {
  const { table, membersOf, valueOf } = options
  const strict = options.strict ?? true
  const now = options.now ?? (() => Date.now())
  const started = now()

  const problems = tableProblems(table)
  if (problems.length > 0) {
    throw new Error(`compat table ${table.kernel} is malformed: ${problems.join('; ')}`)
  }

  const byService = new Map<string, CapabilityRow[]>()

  /** One capability's cached outcome. */
  interface RowRecord { value?: unknown; error?: UnsupportedError; row: CompatRowReport }
  const records = new Map<string, RowRecord>()

  const refusedNames: string[] = []
  const refusedSemanticChanged: string[] = []
  const refusedAbsent: string[] = []
  const staleNames: string[] = []

  const entries: [string, CapabilityRow | RefusalRow][] = [
    ...Object.entries(table.capabilities),
    ...Object.entries(table.refused),
  ]
  entries.sort(([left], [right]) => left.localeCompare(right))

  for (const [name, row] of entries) {
    const rowStart = now()
    const verdict = evaluateRow(name, row, { membersOf })
    const ms = now() - rowStart
    if (row.disposition === 'refuse') {
      const error = new UnsupportedError({
        capability: name,
        kernelVersion: table.kernel,
        reason: row.reason,
        suggestion: row.suggestion,
      })
      const record = { capability: name, disposition: 'refuse' as const, refusalClass: row.class, ms }
      if (verdict.verdict === 'stale') {
        staleNames.push(name)
        records.set(name, { error, row: { ...record, status: 'stale-refusal', failures: verdict.failures } })
      } else {
        refusedNames.push(name)
        if (row.class === 'semantic-changed') refusedSemanticChanged.push(name)
        else refusedAbsent.push(name)
        records.set(name, { error, row: { ...record, status: 'refused', failures: [] } })
      }
      continue
    }
    for (const target of row.targets) {
      const list = byService.get(target.service) ?? []
      list.push(row)
      byService.set(target.service, list)
    }
    if (verdict.verdict !== 'ok') {
      refusedNames.push(name)
      const error = new UnsupportedError({
        capability: name,
        kernelVersion: table.kernel,
        reason: verdict.failures[0] ?? 'this kernel does not satisfy the capability',
        suggestion: row.suggestion ?? `use a capability this kernel offers, or add "${name}" to compat/table/${table.kernel}.ts after measuring it`,
      })
      records.set(name, {
        error,
        row: { capability: name, disposition: row.disposition, status: 'refused', ms, failures: verdict.failures },
      })
      continue
    }
    if (row.self === true) {
      const provided = options.selfProvided?.[name] ?? {}
      const missing = row.roles.filter((role) => provided[roleWord(role)] === undefined)
      if (missing.length > 0) {
        const error = new UnsupportedError({
          capability: name,
          kernelVersion: table.kernel,
          reason: `"${name}" is provided by ${row.providedBy ?? 'this loader'}, which supplied nothing for ${missing.join(', ')}`,
          suggestion: `pass ${name} in selfProvided, keyed by role word`,
        })
        records.set(name, {
          error,
          row: { capability: name, disposition: row.disposition, status: 'refused', ms, failures: [error.reason] },
        })
        continue
      }
      const value: Record<string, unknown> = {}
      for (const role of row.roles) value[roleWord(role)] = provided[roleWord(role)]
      records.set(name, { value: Object.freeze(value), row: { capability: name, disposition: row.disposition, status: 'resolved', ms, failures: [] } })
      continue
    }
    const value: Record<string, unknown> = {}
    for (const target of row.targets) {
      const raw = valueOf(target.service) as Record<string, unknown> | undefined
      for (const binding of target.binds) {
        const member = raw?.[binding.member]
        value[roleWord(binding.role)] = typeof member === 'function'
          ? (member as (...args: unknown[]) => unknown).bind(raw)
          : member
      }
    }
    if (row.translation !== undefined) {
      value.translation = Object.freeze({ kind: row.kind, from: row.translation.from, to: row.translation.to })
      if (row.kind === 'field-rename') {
        const { from, to } = row.translation
        value.mapping = Object.freeze({ from, to })
        value.toKernel = (record: unknown) => rename(record, from, to)
        value.fromKernel = (record: unknown) => rename(record, to, from)
      }
    }
    records.set(name, { value: Object.freeze(value), row: { capability: name, disposition: row.disposition, status: 'resolved', ms, failures: [] } })
  }

  if (strict && staleNames.length > 0) {
    const lines = staleNames.map((name) => {
      const record = records.get(name)
      return `${name}: ${record?.row.failures.join('; ') ?? 'premise expired'}`
    })
    throw new Error(`compat table ${table.kernel} has ${staleNames.length} stale refusal(s); re-measure before shipping: ${lines.join(' | ')}`)
  }

  const resolveMs = now() - started
  const names = [...records.keys()]
  const resolved = names.filter((name) => records.get(name)?.error === undefined)
  const vocabulary = names.join(', ')

  const loader: CompatLoader = {
    kernel: table.kernel,
    services: {
      get(service: string): unknown {
        const rows = byService.get(service)
        if (rows === undefined) {
          throw new UnsupportedError({
            capability: service,
            kernelVersion: table.kernel,
            reason: `service "${service}" is not named by this kernel's table`,
            suggestion: `ask for a capability instead (${vocabulary}), or add "${service}" to the table's ${table.kernel} section`,
          })
        }
        const value = valueOf(service)
        if (value === undefined) {
          throw new UnsupportedError({
            capability: service,
            kernelVersion: table.kernel,
            reason: `service "${service}" is not mounted on this kernel`,
            suggestion: `guard the call with ctx.link.compat.has(...) before asking for a service by name`,
          })
        }
        return value
      },
    },
    capability(name: string): unknown {
      const record = records.get(name)
      if (record === undefined) {
        throw new UnsupportedError({
          capability: name,
          kernelVersion: table.kernel,
          reason: `"${name}" is not in the vocabulary for ${table.kernel}`,
          suggestion: `the vocabulary is closed; use one of: ${vocabulary}`,
        })
      }
      if (record.error !== undefined) throw record.error
      return record.value
    },
    has(name: string): boolean {
      const record = records.get(name)
      return record !== undefined && record.error === undefined
    },
    require(name: string): unknown {
      return loader.capability(name)
    },
    report(): CompatReport {
      return {
        kernel: table.kernel,
        packageVersion: table.packageVersion,
        commit: table.commit,
        resolveMs,
        resolved,
        refused: refusedNames,
        refusedSemanticChanged,
        refusedAbsent,
        staleRefusals: staleNames,
        rows: names.map((name) => records.get(name)!.row),
      }
    },
  }
  return loader
}
