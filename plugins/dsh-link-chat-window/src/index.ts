/**
 * dsh-link-chat-window — the host half of the R493 B2 paged-window prototype.
 *
 * This package carries the payload of the proposed kernel client seam, not a second implementation
 * of it: {@link TailWindowPolicy} decides when the event window is trimmed and how fold state is
 * kept, and {@link TailWindow} performs the trim through the same operations the Session controller
 * exposes (replace/prepend) plus the two bookkeeping writes a Session owns (baseSeq, hasMore).
 * The kernel patch that calls it — docs/kernel-patches/R501-draft.patch — is a separate delivery and
 * is NOT applied by this package.
 *
 * Default off: a normal composition that does not mount the row is unchanged, and a composition
 * that mounts it with enabled:false registers nothing (no service, no log line, no global).
 *
 * Why the parity matters: B2 is a client-window problem. The page/follow APIs, loadOlder() and
 * loadThrough() already exist (R495 §6.1) and this package must not reimplement them; it only makes
 * the window bounded and evicts old pages oldest-first, keeping paging on the official paths.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { DEFAULT_WINDOW_POLICY } from './policy.ts'
import type { WindowPolicyNumbers } from './policy.ts'

/** The Cordis plugin name. */
export const name = 'dsh-link-chat-window'

/** Kernel services this row needs: none — the policy and controller are pure. */
export const inject: string[] = []

/** Validated row configuration; every default keeps the feature off. */
export interface ChatWindowConfig extends WindowPolicyNumbers {
  /** Master switch; the default keeps the prototype inert. */
  readonly enabled: boolean
  /** Opt-in second truncation of the opening page; v2 defaults it off (R510 §12). */
  readonly trimOpeningPage: boolean
}

/** Row configuration defaults. */
export const DEFAULT_CHAT_WINDOW_CONFIG: ChatWindowConfig = Object.freeze({
  enabled: false,
  windowEvents: DEFAULT_WINDOW_POLICY.windowEvents,
  slackEvents: DEFAULT_WINDOW_POLICY.slackEvents,
  trimOpeningPage: false,
})

/** Validated row configuration schema. */
export const Config: z<ChatWindowConfig> = z.object({
  enabled: z.boolean().default(DEFAULT_CHAT_WINDOW_CONFIG.enabled),
  windowEvents: z.number().default(DEFAULT_CHAT_WINDOW_CONFIG.windowEvents),
  slackEvents: z.number().default(DEFAULT_CHAT_WINDOW_CONFIG.slackEvents),
  trimOpeningPage: z.boolean().default(DEFAULT_CHAT_WINDOW_CONFIG.trimOpeningPage),
})

/** What the row publishes when enabled: the policy identity, not a live window. */
export interface ChatWindowFacade {
  /** The kernel seam this payload belongs to. */
  readonly seam: 'R510-b2-tail-window'
  /** Prototype status: the seam must be applied for the policy to have runtime effect. */
  readonly status: 'prototype-awaiting-kernel-seam'
  /** Validated policy numbers. */
  readonly numbers: WindowPolicyNumbers
  /** @returns a one-line human-readable status. */
  describe(): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Paged Chat event-window policy published by this row (only when enabled). */
    linkChatWindow?: ChatWindowFacade
  }
}

/**
 * Mount the prototype.
 *
 * @param ctx - the plugin's context.
 * @param config - row configuration; `enabled: false` (the default) registers nothing.
 */
export function apply(ctx: Context, config: ChatWindowConfig = DEFAULT_CHAT_WINDOW_CONFIG): void {
  if (!config.enabled) return
  const facade: ChatWindowFacade = {
    seam: 'R510-b2-tail-window',
    status: 'prototype-awaiting-kernel-seam',
    numbers: { windowEvents: config.windowEvents, slackEvents: config.slackEvents },
    describe: () => 'dsh-link-chat-window: windowEvents=' + String(config.windowEvents)
      + ' slackEvents=' + String(config.slackEvents)
      + ' trimOpeningPage=' + String(config.trimOpeningPage)
      + ' — needs docs/kernel-patches/R510-draft.patch for runtime effect',
  }
  ctx.provide('linkChatWindow', facade)
  console.log('[link-chat-window] ' + facade.describe())
}

export { DEFAULT_WINDOW_POLICY, TailWindowPolicy, takeWindowTail } from './policy.ts'
export type { TrimDecision, WindowPolicyNumbers, WindowPolicyStats, WindowNode, WindowEntry } from './policy.ts'
export { TailWindow } from './tail-window.ts'
export type { EventWindowSource, TailWindowSnapshot, WindowSnapshotView } from './tail-window.ts'