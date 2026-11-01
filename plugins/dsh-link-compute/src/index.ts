/**
 * dsh-link-compute — the Cordis host half of the native compute core.
 *
 * The row is a thin shell around the binding: it publishes `ctx.linkCompute` (two pure functions
 * plus which half is answering them) and nothing else. It registers no tool, no route, no prompt
 * section and no client half, so a default DSH composition that does not mount the row is
 * unchanged, and a composition that mounts it disabled loads no native code at all.
 *
 * Why a Cordis plugin and not a direct `require`: the policy, the fallback and the lifecycle are
 * TS concerns; the crate stays replaceable. See docs/handoff/R486-napi-mvp.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { ComputeFacade, resolveBinding } from './binding.ts'
import { DEFAULT_CONFIG } from './config.ts'
import type { ComputeConfig } from './config.ts'

/** The Cordis plugin name. */
export const name = 'dsh-link-compute'

/** Kernel services this row needs: none — the core is pure computation. */
export const inject: string[] = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The compute core this row publishes: native addon when available, pure-TS otherwise. */
    linkCompute: ComputeFacade
  }
}

/** Validated row configuration; the defaults keep the feature off. */
export const Config: z<ComputeConfig> = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  nativeEnabled: z.boolean().default(DEFAULT_CONFIG.nativeEnabled),
})

/**
 * Mount the compute core.
 *
 * @param ctx - the plugin's context; the row publishes `linkCompute` on it.
 * @param config - the row configuration; `enabled: false` (the default) loads nothing.
 */
export function apply(ctx: Context, config: ComputeConfig = DEFAULT_CONFIG): void {
  if (!config.enabled) {
    console.log('[link-compute] off: config enabled=false; no addon loaded, no service published')
    return
  }
  const binding = resolveBinding({ native: config.nativeEnabled ? 'auto' : 'off' })
  const facade = new ComputeFacade(binding)
  ctx.provide('linkCompute', facade)
  // Machine-readable ready line: kind / nativeApiVersion / version / pairLocked and the fallback
  // counters. Operators and the health marker can parse this without calling into the addon.
  console.log('[link-compute] ready ' + JSON.stringify(facade.health()))
}
