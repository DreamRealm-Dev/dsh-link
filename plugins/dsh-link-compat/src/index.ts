/**
 * Host half of dsh-link-compat: the cross-version compat loader.
 *
 * A plugin names a capability, never a DSH service. This row resolves the
 * capability vocabulary of the running kernel once, at load, before any
 * dependent plugin's `apply runs, and publishes the answer at `ctx.link.compat:
 *
 *   ctx.link.compat.services.get('<kernel service>')   the kernel's own object
 *   ctx.link.compat.capability('<capability>')         the converged object
 *   ctx.link.compat.has / require / report
 *
 * A capability this kernel does not honour throws `UnsupportedError naming the
 * capability, the kernel, the reason and the alternative. Nothing degrades to
 * `undefined and nothing is proxied lazily: a resolved reference is the live
 * object, taken once, so the hot path pays for no lookup at all.
 *
 * The kernel is never modified, and no kernel version is branched on in code:
 * the version selects a section of `compat/table/, and an unknown version is a
 * refusal that names the file to add.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createCompatLoader, createSimpleLayer, installedKernel, knownKernels, tableFor, UnsupportedError } from '../../../compat/index.ts'
import type { CompatLoader, CompatTable, SimpleSurface, Witness } from '../../../compat/index.ts'

/** Loader entry name, for the diagnostics surface. */
export const name = 'dsh-link-compat'

/** Row configuration. */
export interface Config {
  /** Kernel identity to serve; empty asks the running kernel. */
  kernel: string
  /** Fail the load when a refusal's premise has expired. */
  strict: boolean
}

/** Validated row configuration. */
export const Config: z<Config> = z.object({
  kernel: z.string().default(''),
  strict: z.boolean().default(true),
})

/**
 * The claims whose answer needs the named service to exist before the witness can be decided at all.
 *
 * `service-absent` is deliberately not one of them: holding the row until a service that must be
 * absent appears would never let it load.
 */
const PRESENCE_CLAIMS: ReadonlySet<Witness['claim']> = new Set([
  'service-present', 'member-present', 'member-absent', 'member-matching-absent',
])

/**
 * The kernel services a section premises on, so the loader can be held until they exist.
 *
 * A witness is read once, against the live context, when the loader is constructed. A
 * `service-present` witness answered before its service is mounted reads as absent, which makes a
 * live refusal look stale and fails the whole row. Naming the services here lets the loader be
 * constructed after them instead.
 *
 * @param table - the kernel section about to run.
 * @returns the service names, sorted; empty when every witness only claims an absence.
 */
export function servicesTheSectionPremisesOn(table: CompatTable): string[] {
  const needed = new Set<string>()
  for (const row of Object.values(table.refused)) {
    for (const witness of row.witness) {
      if (PRESENCE_CLAIMS.has(witness.claim)) needed.add(witness.service)
    }
  }
  return [...needed].sort()
}

/**
 * Static Cordis `inject` for this row: the services the section is about to be judged against.
 *
 * The list is read from the section rather than written here, so a refusal that premises on a new
 * service extends it without touching this file. An unknown kernel needs nothing: `apply` refuses it
 * with the file to add, which is the answer a reader wants, not a row that waits.
 */
export const inject: string[] = (() => {
  const kernel = installedKernel()
  const table = kernel === null ? undefined : tableFor(kernel)
  return table === undefined ? [] : servicesTheSectionPremisesOn(table)
})()

/**
 * The layer a plugin holds: `ctx.link.compat`.
 *
 * `simple` is the second half of the two-interface strategy — the collapse of multi-step kernel
 * work into one call with plain data out. It is built from the loader's own capability surface,
 * so it sees exactly what the loader resolved and nothing else.
 */
export type CompatFacade = Pick<CompatLoader, 'services' | 'capability' | 'has' | 'require' | 'report'> & {
  /** One call per operation; role words only, plain data out. */
  simple: SimpleSurface
}

/** The `ctx.link namespace this plugin owns. */
export interface LinkNamespace {
  /** The compat loader's two plugin-facing layers. */
  compat: CompatFacade
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The DSH Link namespace: cross-version capabilities, resolved at load. */
    link: LinkNamespace
  }
}

/**
 * Mount the loader: resolve the whole vocabulary against the running kernel.
 *
 * @param ctx - the plugin's context.
 * @param config - the row configuration.
 * @throws UnsupportedError when the running kernel cannot be identified, or this build carries no section for it.
 */
export function apply(ctx: Context, config: Config): void {
  const kernel = config.kernel !== '' ? config.kernel : installedKernel()
  if (kernel === null) {
    throw new UnsupportedError({
      capability: 'link',
      kernelVersion: 'unknown',
      reason: 'this process cannot tell which kernel it is running inside',
      suggestion: 'set the row config kernel: to one of ' + knownKernels().join(', '),
    })
  }
  const table = tableFor(kernel)
  if (table === undefined) {
    throw new UnsupportedError({
      capability: 'link',
      kernelVersion: kernel,
      reason: 'this build carries no compat table for ' + kernel,
      suggestion: 'add compat/table/' + kernel + '.ts with the same shape, then run: node plugins/build.mjs',
    })
  }

  // The loader answers for the "link" capability itself, so the facade has to
  // exist before it: capability('link') hands out this exact object.
  const compat = {} as CompatFacade
  const loader = createCompatLoader({
    table,
    membersOf: (service) => membersOfService(ctx, service),
    valueOf: (service) => valueOfService(ctx, service),
    // The loader answers for "link" itself, keyed by role word. The facade is
    // filled immediately below, so these thunks only ever run after it exists.
    selfProvided: {
      link: {
        capability: (name: string) => compat.capability(name),
        has: (name: string) => compat.has(name),
        require: (name: string) => compat.require(name),
        report: () => compat.report(),
        services: { get: (service: string) => compat.services.get(service) },
      },
    },
    strict: config.strict,
  })
  // The simple layer is built over the loader's own capability surface, so it can only reach what
  // the loader resolved. Registering through it therefore cannot bypass a refusal.
  const simple = createSimpleLayer({ kernel: loader.kernel, has: (name) => loader.has(name), require: (name) => loader.require(name) })

  Object.assign(compat, {
    services: loader.services,
    capability: loader.capability,
    has: loader.has,
    require: loader.require,
    report: loader.report,
    simple,
  })

  // Registrations the simple layer made belong to this fiber: the body below runs now and returns
  // the teardown, which is the shape ctx.effect keeps (a teardown passed AS the body would run at
  // load, which is the mistake this project already paid for once).
  const effect = (ctx as unknown as { effect?: (work: () => () => void) => unknown }).effect
  if (typeof effect === 'function') effect(() => () => { simple.dispose() })

  ctx.provide('link', { compat })

  const report = loader.report()
  const logger = ctx.logger?.('dsh-link-compat')
  logger?.info('kernel ' + report.kernel + ': ' + report.resolved.length + ' capabilities resolved, '
    + report.refused.length + ' refused, in ' + report.resolveMs + 'ms')
  for (const refused of report.refused) {
    const row = report.rows.find((entry) => entry.capability === refused)
    logger?.info('refused: ' + refused + ' — ' + (row?.failures.join('; ') ?? 'see the table'))
  }
  if (report.staleRefusals.length > 0) {
    logger?.error('compat table ' + report.kernel + ' has stale refusals: ' + report.staleRefusals.join(', '))
  }
}

/** The kernel service's own object, or `undefined when it is not mounted. */
function valueOfService(ctx: Context, service: string): unknown {
  try {
    return ctx.reflect.get(service, false)
  } catch {
    // A property whose getter refuses to be read (a function-only activation
    // marker, for example) is not a service this loader can hand over.
    return undefined
  }
}

/**
 * The member names a kernel service exposes: the callable ones, own and inherited.
 *
 * Read from the instance and its prototype, exactly as the surface probe reads them, so a table row is
 * checked against the same facts it was written from. The surface document is the authority for the
 * classification: it records a service as `members` (the names that can be called) and `fields` (the
 * data it carries), and a witness names a member — `member-matching-absent` on the settings service asks
 * what that service can be asked to do, not which data it happens to hold. Merging the two let a data
 * field called `writable` answer a member question, which read as a stale refusal on a live kernel.
 *
 * A name whose read throws is not a member either: the value cannot be reached, so nothing can be said
 * about it.
 */
function membersOfService(ctx: Context, service: string): readonly string[] | undefined {
  const value = valueOfService(ctx, service)
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' && typeof value !== 'function') return undefined
  const own = Object.getOwnPropertyNames(value).filter((member) => !member.startsWith('#'))
  const proto = Object.getPrototypeOf(value) as object | null
  const inherited = proto === null
    ? []
    : Object.getOwnPropertyNames(proto).filter((member) => member !== 'constructor' && !member.startsWith('#'))
  return [...new Set([...own, ...inherited])].filter((member) => isCallableMember(value, member))
}

/**
 * Whether one name on a service value is callable, which is what makes it a member.
 *
 * @param value - the service object or class instance.
 * @param member - the property name to read.
 * @returns true when the name holds a function; false when it holds data or cannot be read.
 */
function isCallableMember(value: object, member: string): boolean {
  try {
    return typeof (value as Record<string, unknown>)[member] === 'function'
  } catch {
    // An accessor that refuses to be read cannot be called, so it is not a member.
    return false
  }
}
