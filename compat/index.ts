/**
 * The compat loader's public half.
 *
 * Two things live here and nothing else: the kernel sections this build carries
 * (one file per kernel under `compat/table/`), and the identity the running kernel
 * reports about itself. The resolver in `compat/engine.ts` is version-blind: it
 * reads a section and asks the kernel, so an unknown kernel is a refusal with a
 * fix rather than a fallback with a warning.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { table as dshV021 } from './table/dsh-v0.2.1-alpha.1.ts'
import { table as dshV021A5 } from './table/dsh-v0.2.1-alpha.5.ts'
import { table as dshV021Rc2 } from './table/dsh-v0.2.1-rc.2.ts'
import { table as dshV022A2 } from './table/dsh-v0.2.2-alpha.2.ts'
import type { CompatTable } from './types.ts'

export { evaluateWitness, createCompatLoader, roleWord, tableProblems, UnsupportedError, validateTable } from './engine.ts'
export { createSimpleLayer } from './simple.ts'
export type {
  CapabilitySource, SimpleSession, SimpleSettingDeclaration, SimpleSurface, SimpleToolHandle, SimpleToolSpec,
} from './simple.ts'
export type {
  CompatLoader, CompatLoaderOptions, CompatReport, CompatRowReport, HostLookup, MembersLookup, RowVerdict, TableVerdict,
} from './engine.ts'
export type {
  CapabilityKind, CapabilityRow, CompatTable, CompatTarget, CompatTranslation, Disposition, RefusalRow, Witness,
} from './types.ts'

/** The kernel root manifest's own package name; the identity probe walks up to it. */
export const KERNEL_ROOT_PACKAGE = '@deepseek-ai/dsh-root'

/** Every kernel section this build carries. */
export const TABLES: CompatTable[] = [dshV021, dshV021A5, dshV021Rc2, dshV022A2]

/**
 * The section for one kernel identity.
 *
 * @param identity - `dsh-v0.2.1-alpha.1` or the bare manifest version `0.2.1-alpha.1`.
 * @returns the section, or `undefined` when this build has none for that kernel.
 */
export function tableFor(identity: string): CompatTable | undefined {
  return TABLES.find((table) => table.kernel === identity || table.packageVersion === identity)
}

/** The kernel identities this build can serve. */
export function knownKernels(): string[] {
  return TABLES.map((table) => table.kernel)
}

/**
 * The running kernel's identity.
 *
 * The kernel process starts with its checkout as the working directory, so the
 * `@deepseek-ai/dsh-root` manifest found by walking up from `process.cwd()` is the
 * kernel being served. `DSH_LINK_KERNEL_VERSION` and `globalThis.__DSH_VERSION__`
 * are honoured first, so a shell that already knows may say so.
 *
 * @returns the identity, or `null` when this process cannot find the kernel.
 */
export function installedKernel(): string | null {
  const handed = process.env.DSH_LINK_KERNEL_VERSION ?? ''
  if (handed !== '') return handed
  const global = (globalThis as { __DSH_VERSION__?: unknown }).__DSH_VERSION__
  if (typeof global === 'string' && global !== '') return global.startsWith('dsh-v') ? global : 'dsh-v' + global
  const version = installedVersion()
  return version === null ? null : 'dsh-v' + version
}

/** The kernel root manifest's version, walking up from the working directory. */
function installedVersion(): string | null {
  let dir = process.cwd()
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = readManifest(dir)
    if (manifest !== null) return manifest
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** One manifest's version, when it is the kernel root's. */
function readManifest(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (parsed.name === KERNEL_ROOT_PACKAGE && typeof parsed.version === 'string') return parsed.version
  } catch {
    // No manifest at this level, or it is not JSON: keep walking up.
  }
  return null
}
