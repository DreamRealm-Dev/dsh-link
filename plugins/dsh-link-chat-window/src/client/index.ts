/**
 * dsh-link-chat-window — the browser half of the R493 B2 paged-window prototype.
 *
 * Default off. When enabled, this half sets the optional policy object the v2 kernel client
 * patch (docs/kernel-patches/R510-draft.patch) reads before it opens a Session:
 *
 *   globalThis.__DSH_EVENT_WINDOW_LIMIT__ = { maxEvents, slackEvents, trimOpeningPage, setBy, version }
 *
 * It also publishes the reader state the v2 data layer uses to defer live trims:
 *
 *   globalThis.__DSH_CHAT_HISTORY_READING__ = true   // while the chat is not following the tail
 *
 * The kernel never imports this package (or any LINK package): the object is plain data, validated
 * by the patch, and an absent or malformed value means the stock unbounded behavior — exactly
 * today's behavior. That is the toggle decision recorded in R493 §5: the thinnest LINK-settable
 * switch whose failure mode is "off", and the one an option flag or profile value can replace later
 * without another kernel change.
 *
 * What this half deliberately does NOT do: it does not reimplement paging, wrap the event source,
 * or reach into the Session controller. A dynamic client row has no `sessions` service (R459
 * measured the page-level service store answers undefined) and the Session face does not expose the
 * event window, so a plugin cannot trim it; the audit in R493 §4 states that boundary.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** The Cordis plugin name. */
export const name = 'dsh-link-chat-window'

/** Services this half needs: none. The policy object is plain data on the global. */
export const inject: string[] = []

/** The policy object name the draft kernel patch reads. */
export const EVENT_WINDOW_LIMIT_GLOBAL = '__DSH_EVENT_WINDOW_LIMIT__'

/** Reader-state global the v2 kernel client patch reads before a live trim (absent means reading=false). */
export const HISTORY_READING_GLOBAL = '__DSH_CHAT_HISTORY_READING__'

/** Row configuration accepted by the browser half (validated on the host half). */
export interface ChatWindowClientConfig {
  readonly enabled?: boolean
  readonly windowEvents?: number
  readonly slackEvents?: number
  /** @deprecated the v2 kernel always resolves false (opening-page truncation removed); kept so an old row still loads. */
  readonly trimOpeningPage?: boolean
}

/** The plain-data policy object the draft kernel patch validates and reads. */
export interface EventWindowLimitPolicy {
  readonly maxEvents: number
  readonly slackEvents: number
  readonly trimOpeningPage: boolean
  readonly setBy: string
  readonly version: 1
}

/**
 * Build the policy object from row configuration.
 *
 * @param config - browser-half row configuration.
 * @returns the plain policy object; numbers are validated again by the kernel patch.
 */
export function eventWindowLimitPolicy(config: ChatWindowClientConfig = {}): EventWindowLimitPolicy {
  const maxEvents = config.windowEvents === undefined ? 500 : config.windowEvents
  const slackEvents = config.slackEvents === undefined ? 125 : config.slackEvents
  return {
    maxEvents,
    slackEvents,
    trimOpeningPage: config.trimOpeningPage === true,
    setBy: 'dsh-link-chat-window',
    version: 1,
  }
}

/**
 * Publish the reader-away flag from the chat surface and keep it current.
 *
 * The data layer cannot observe scrolling (R493 §11), so this half watches the chat root the
 * shell already marks: `[data-chat-following-tail]` is present exactly while the viewport follows
 * the live tail. Scroll capture and an attribute MutationObserver keep the plain global boolean
 * in sync; absent `document` (tests, worker) the flag stays false. The observer writes only on a
 * change, so a settled page costs nothing per frame.
 * @param ctx - client root context; listener and observer teardown rides on one ctx effect.
 */
function publishHistoryReading(ctx: ClientContext): void {
  const host = globalThis as { __DSH_CHAT_HISTORY_READING__?: boolean }
  const surface = typeof document === 'undefined' ? undefined : document
  const following = (): boolean => surface !== undefined && surface.querySelector('[data-chat-following-tail]') !== null
  const publish = (): void => {
    const reading = surface !== undefined && !following()
    if (host[HISTORY_READING_GLOBAL] === reading) return
    if (reading) host[HISTORY_READING_GLOBAL] = true
    else delete host[HISTORY_READING_GLOBAL]
  }
  if (surface === undefined) return
  let queued = false
  const schedule = (): void => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; publish() })
  }
  surface.addEventListener('scroll', schedule, { capture: true, passive: true })
  const observer = new MutationObserver(schedule)
  observer.observe(surface.documentElement, { attributes: true, attributeFilter: ['data-chat-following-tail'], subtree: true })
  publish()
  ctx.effect(() => () => {
    surface.removeEventListener('scroll', schedule, { capture: true })
    observer.disconnect()
    delete host[HISTORY_READING_GLOBAL]
  }, 'dsh-link-chat-window: reader state')
}

/**
 * Mount the browser half.
 *
 * @param ctx - client root context.
 * @param config - row configuration; `enabled` must be true for anything to happen.
 */
export function apply(ctx: ClientContext, config: ChatWindowClientConfig = {}): void {
  if (config.enabled !== true) return
  const policy = eventWindowLimitPolicy(config)
  const host = globalThis as {
    __DSH_EVENT_WINDOW_LIMIT__?: EventWindowLimitPolicy
  }
  host[EVENT_WINDOW_LIMIT_GLOBAL] = policy
  publishHistoryReading(ctx)
  ctx.effect(() => () => {
    if (host[EVENT_WINDOW_LIMIT_GLOBAL] === policy) delete host[EVENT_WINDOW_LIMIT_GLOBAL]
  }, 'dsh-link-chat-window: policy object')
  console.log('[link-chat-window] client policy published: maxEvents=' + String(policy.maxEvents)
    + ' slackEvents=' + String(policy.slackEvents) + ' trimOpeningPage=' + String(policy.trimOpeningPage)
    + ' (needs R501 kernel client patch for runtime effect)')
}