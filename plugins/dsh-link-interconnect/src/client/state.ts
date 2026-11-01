/**
 * dsh-link-interconnect - the client half's one state owner.
 *
 * The host publishes the whole wire document at ROUTES.state as a PluginSnapshot.
 * This module reads it on one poll loop (3000 ms, one AbortController per request),
 * keeps the last good document when the route is not mounted yet (404/5xx or a
 * transport failure), and exposes the person's writes - a consent answer, an
 * adapter operation, a peer revoke - as plain promise-returning actions.
 *
 * It imports no React and touches no DOM: the apply world (index.tsx) creates one
 * instance and starts/stops it with the plugin fiber; the components receive its
 * snapshot and its callbacks as plain props.
 */
import { ROUTES, type PluginSnapshot } from '../protocol/types.ts'

/** One poll every three seconds: the cadence a consent card has to feel immediate on. */
export const POLL_INTERVAL_MS = 3000

/** How the last poll settled. 'absent' means the host route is not mounted (404/5xx), not an alarm. */
export type RouteReading = 'unknown' | 'live' | 'absent' | 'error'

/** The person's answer to one consent question. */
export type ConsentDecision = 'granted' | 'denied'

/** The three adapter lifecycle operations the peers surface offers. */
export type AdapterOp = 'probe' | 'connect' | 'disconnect'

/** What one write settled to; the surface keeps the row and says a refusal quietly. */
export interface ActionOutcome {
  /** True only when the host answered 2xx with { ok: true }. */
  readonly ok: boolean
  /** The host's own result payload when ok (a ProbeResult, a BindingState, { revoked }). */
  readonly result?: unknown
  /** Stable code and human sentence when not ok. */
  readonly error?: { readonly code?: string; readonly message?: string }
}

/** The one value every component draws from; a new object per change so React can compare it. */
export interface ClientSnapshotState {
  /** Last good PluginSnapshot, or null before the first successful read. */
  readonly data: PluginSnapshot | null
  /** How the last poll settled. */
  readonly route: RouteReading
  /** Epoch ms of the last poll attempt, or null. */
  readonly lastAt: number | null
  /** Whether the peers surface is open (client-local; no host route involved). */
  readonly open: boolean
  /** In-flight write keys: 'consent:<id>', 'adapter:<op>:<id>', 'revoke:<peerLinkId>'. */
  readonly busy: readonly string[]
  /** Last write refusal, shown quietly in the surface; null when the last write settled cleanly. */
  readonly actionError: string | null
}

/** Every write the surface can make. */
export interface ClientActions {
  decideConsent(id: string, decision: ConsentDecision): Promise<ActionOutcome>
  adapterOp(op: AdapterOp, id: string): Promise<ActionOutcome>
  /** POST ROUTES.adapters { op:'revoke-peer', id } - the host contract the Lead confirmed. */
  revokePeer(peerLinkId: string): Promise<ActionOutcome>
  openPanel(): void
  closePanel(): void
  togglePanel(): void
}

/** The poller + actions handle the apply world owns. */
export interface ClientState {
  snapshot(): ClientSnapshotState
  subscribe(listener: () => void): () => void
  start(): void
  stop(): void
  pollNow(): void
  readonly actions: ClientActions
}

/** Options for tests: a shorter cadence and a fake fetch. */
export interface ClientStateOptions {
  /** Poll cadence in ms. Defaults to POLL_INTERVAL_MS. */
  intervalMs?: number
  /** The fetch to use; defaults to the page's own. */
  fetchImpl?: typeof fetch
}

/** The product copy every component draws, held once in index.tsx (Chinese product copy). */
export interface CopyFace {
  readonly footerLabel: string
  readonly footerTitle: string
  readonly footerPendingSuffix: string
  readonly panelTitle: string
  readonly panelSubtitle: string
  readonly close: string
  readonly ownId: string
  readonly peersTitle: string
  readonly peersEmpty: string
  readonly peerScopesEmpty: string
  readonly revoke: string
  readonly revoking: string
  readonly adaptersTitle: string
  readonly adaptersEmpty: string
  readonly adapterDetected: string
  readonly adapterMissing: string
  readonly adapterProbe: string
  readonly adapterConnect: string
  readonly adapterDisconnect: string
  readonly adapterBusy: string
  readonly adapterNoBinding: string
  readonly grantsTitle: string
  readonly grantsEmpty: string
  readonly auditTitle: string
  readonly auditEmpty: string
  readonly auditOk: string
  readonly auditFail: string
  readonly riskLow: string
  readonly riskMedium: string
  readonly riskHigh: string
  readonly allow: string
  readonly deny: string
  readonly deciding: string
  readonly consentAria: string
  readonly consentPeer: string
  readonly routePending: string
  readonly routeStale: string
  readonly updatedAt: string
  readonly refreshing: string
  readonly noData: string
  readonly rpmSuffix: string
  readonly statusActive: string
  readonly statusPending: string
  readonly statusUnavailable: string
  readonly statusRejoin: string
  readonly statusRevoked: string
  readonly bindingActive: string
  readonly bindingUnavailable: string
  readonly bindingRejoin: string
  readonly bindingRevoked: string
}

/** The pending consent questions in the last good document, safe before the first poll. */
export function pendingConsentOf(data: PluginSnapshot | null): PluginSnapshot['pendingConsent'] {
  return data === null ? [] : data.pendingConsent
}

/** A linkId shortened for a row: the first ten characters keep it unique enough to read. */
export function shortLinkId(linkId: string): string {
  if (linkId.length <= 12) return linkId
  return linkId.slice(0, 10) + '…'
}

/** One error's own words, whatever shape it arrived in. */
export function messageOf(error: unknown): string {
  const held = error as { message?: unknown } | null
  if (held !== null && typeof held === 'object' && held.message !== undefined) return String(held.message)
  return String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The wire boundary: only a document carrying every array the surface draws is accepted. */
function isPluginSnapshot(value: unknown): value is PluginSnapshot {
  if (!isRecord(value)) return false
  return typeof value.protocol === 'string'
    && typeof value.linkId === 'string'
    && Array.isArray(value.peers)
    && Array.isArray(value.grants)
    && Array.isArray(value.pendingConsent)
    && Array.isArray(value.bindings)
    && Array.isArray(value.adapters)
    && Array.isArray(value.audit)
    && isRecord(value.counts)
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
}

/** The host's error sentence from a { ok:false, error:{ code, message } } answer. */
function refusalOf(payload: unknown, status: number): { code?: string; message: string } {
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = typeof payload.error.code === 'string' ? payload.error.code : undefined
    const message = typeof payload.error.message === 'string' ? payload.error.message : 'HTTP ' + String(status)
    return code === undefined ? { message } : { code, message }
  }
  return { message: 'HTTP ' + String(status) }
}

const EMPTY_STATE: ClientSnapshotState = Object.freeze({
  data: null,
  route: 'unknown' as RouteReading,
  lastAt: null,
  open: false,
  busy: Object.freeze([]) as readonly string[],
  actionError: null,
})

/**
 * The one poller. Constructed once by apply(), started on mount, stopped on dispose.
 * @param options - test seams (cadence, fetch); production passes none.
 * @returns the handle the apply world starts and the components read.
 */
export function createClientState(options: ClientStateOptions = {}): ClientState {
  return new InterconnectClientState(options)
}

class InterconnectClientState implements ClientState {
  private current: ClientSnapshotState = EMPTY_STATE
  private readonly listeners = new Set<() => void>()
  private readonly intervalMs: number
  private readonly fetcher: typeof fetch | undefined
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null
  private polling = false
  private again = false
  readonly actions: ClientActions

  constructor(options: ClientStateOptions) {
    this.intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
    // bind: the bundled module half is strict, and a bare fetch() call with this === undefined
    // is refused by the browser with "Illegal invocation" (measured in WebView2). The eval probes
    // that called it sloppily did NOT reproduce that, which is why this was a live-only failure.
    this.fetcher = options.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined)
    this.actions = Object.freeze({
      decideConsent: (id: string, decision: ConsentDecision) => this.write('consent:' + id, ROUTES.consent, { id, decision }),
      adapterOp: (op: AdapterOp, id: string) => this.write('adapter:' + op + ':' + id, ROUTES.adapters, { op, id }),
      revokePeer: (peerLinkId: string) => this.write('revoke:' + peerLinkId, ROUTES.adapters, { op: 'revoke-peer', id: peerLinkId }),
      openPanel: () => { this.patch({ open: true }) },
      closePanel: () => { this.patch({ open: false }) },
      togglePanel: () => { this.patch({ open: !this.current.open }) },
    })
  }

  snapshot(): ClientSnapshotState {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const controller = this.controller
    this.controller = null
    if (controller !== null) controller.abort()
  }

  pollNow(): void {
    if (!this.running) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.polling) {
      this.again = true
      return
    }
    void this.poll()
  }

  /** One state read. Keeps the last good document on every failure, by design. */
  private async poll(): Promise<void> {
    if (!this.running) return
    if (this.fetcher === undefined) {
      this.patch({ route: 'absent', lastAt: Date.now() })
      return
    }
    this.polling = true
    const controller = new AbortController()
    this.controller = controller
    try {
      const response = await this.fetcher(ROUTES.state, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!this.running) return
      if (response.status === 404 || response.status >= 500) {
        this.patch({ route: 'absent', lastAt: Date.now() })
        return
      }
      if (!response.ok) {
        this.patch({ route: 'error', lastAt: Date.now(), actionError: 'state HTTP ' + String(response.status) })
        return
      }
      const payload: unknown = await response.json()
      if (!this.running) return
      if (!isPluginSnapshot(payload)) {
        this.patch({ route: 'error', lastAt: Date.now(), actionError: 'state document failed the wire check' })
        return
      }
      this.patch({ data: payload, route: 'live', lastAt: Date.now() })
    } catch (error) {
      if (isAbortError(error) || !this.running) return
      this.patch({ route: 'error', lastAt: Date.now(), actionError: messageOf(error) })
    } finally {
      if (this.controller === controller) this.controller = null
      this.polling = false
      this.schedule()
    }
  }

  /** The single scheduler: one timer, never two, and none after stop(). */
  private schedule(): void {
    if (!this.running) return
    if (this.again) {
      this.again = false
      void this.poll()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.poll()
    }, this.intervalMs)
  }

  /** One JSON write; the poll is refreshed as soon as the write settles. */
  private async write(key: string, path: string, body: Record<string, unknown>): Promise<ActionOutcome> {
    this.patch({ busy: this.busyWith(key), actionError: null })
    if (this.fetcher === undefined) {
      this.patch({ busy: this.busyWithout(key), actionError: 'fetch is unavailable on this page' })
      return { ok: false, error: { message: 'fetch is unavailable on this page' } }
    }
    try {
      const response = await this.fetcher(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch (error) {
        void error
      }
      const ok = response.status >= 200 && response.status < 300 && isRecord(payload) && payload.ok === true
      if (!ok) {
        const refusal = refusalOf(payload, response.status)
        this.patch({ busy: this.busyWithout(key), actionError: refusal.message })
        return { ok: false, error: refusal }
      }
      this.patch({ busy: this.busyWithout(key), actionError: null })
      this.pollNow()
      return { ok: true, result: isRecord(payload) ? payload.result : undefined }
    } catch (error) {
      const message = messageOf(error)
      this.patch({ busy: this.busyWithout(key), actionError: message })
      return { ok: false, error: { message } }
    }
  }

  private busyWith(key: string): readonly string[] {
    return this.current.busy.includes(key) ? this.current.busy : Object.freeze([...this.current.busy, key])
  }

  private busyWithout(key: string): readonly string[] {
    return Object.freeze(this.current.busy.filter((held) => held !== key))
  }

  private patch(partial: Partial<ClientSnapshotState>): void {
    this.current = Object.freeze({ ...this.current, ...partial })
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch (error) {
        void error
      }
    }
  }
}
