/**
 * The gate between detection and any credential read.
 *
 * request() publishes one question and resolves with the person's decision (or 'denied' when the
 * question times out unanswered - the default is deny). The client half reads listPending() and
 * answers decide(); awaitDecision() is for a subsystem that already published a question and wants
 * to wait separately. The service carries display facts only: never a credential, never a token.
 */

import { randomUUID } from 'node:crypto'
import type { ConsentRequest, ConsentService, EventHub } from '../protocol/types.ts'

/** Where the question goes and how long an unanswered question may wait. */
export interface ConsentOptions {
  /** The in-process hub the client half listens to. */
  events?: EventHub
  /** One line into the plugin log. */
  log?: (line: string) => void
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** An unanswered question resolves 'denied' after this long; defaults to 120000. */
  defaultTimeoutMs?: number
  /** Test seam for the request id. */
  idFactory?: () => string
}

/** The service plus the two counts the pane reads. */
export interface ConsentGate extends ConsentService {
  /** Questions still waiting for the person. */
  pendingCount(): number
  /** Questions already answered this process. */
  decidedCount(): number
  /** Resolve every unanswered question 'denied' and clear its timer (the server calls this on stop). */
  dispose(): void
}

type Decision = 'granted' | 'denied'

interface Waiter {
  resolve: (value: 'granted' | 'denied' | 'timeout') => void
  timer: ReturnType<typeof setTimeout>
}

interface Entry {
  request: ConsentRequest
  resolve: (value: Decision) => void
  waiters: Waiter[]
  timer: ReturnType<typeof setTimeout>
}

const cloneRequest = (request: ConsentRequest): ConsentRequest => ({
  ...request,
  scopes: [...request.scopes],
  detail: request.detail === undefined ? undefined : { ...request.detail },
})

/**
 * Build the consent gate.
 * @param options - hub, log, clock, timeout and id seam.
 * @returns the gate.
 */
export function createConsentService(options: ConsentOptions = {}): ConsentGate {
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => Date.now())
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120000
  const idFactory = options.idFactory ?? (() => 'consent_' + randomUUID())
  const pending = new Map<string, Entry>()
  const decided = new Map<string, Decision>()

  const settle = (id: string, decision: Decision, reason: 'decision' | 'timeout'): void => {
    const entry = pending.get(id)
    if (entry === undefined) return
    pending.delete(id)
    clearTimeout(entry.timer)
    decided.set(id, decision)
    if (decided.size > 100) {
      const oldest = decided.keys().next()
      if (!oldest.done) decided.delete(oldest.value)
    }
    for (const waiter of entry.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(decision)
    }
    entry.resolve(decision)
    options.events?.publish({ type: 'consent/decide', at: new Date(now()).toISOString(), data: { id, decision, reason, peerLinkId: entry.request.peerLinkId } })
    log('consent ' + decision + ' id=' + id + ' peer=' + entry.request.peerLinkId + ' (' + reason + ')')
  }

  return {
    request(input): Promise<Decision> {
      const id = idFactory()
      const request: ConsentRequest = {
        ...input,
        id,
        scopes: [...input.scopes],
        detail: input.detail === undefined ? undefined : { ...input.detail },
        createdAt: new Date(now()).toISOString(),
      }
      let resolveRequest: (value: Decision) => void = () => {}
      const promise = new Promise<Decision>((resolve) => { resolveRequest = resolve })
      const timer = setTimeout(() => settle(id, 'denied', 'timeout'), defaultTimeoutMs)
      pending.set(id, { request, resolve: resolveRequest, waiters: [], timer })
      options.events?.publish({ type: 'consent/request', at: request.createdAt, data: { id, peerLinkId: request.peerLinkId, title: request.title, capability: request.capability, scopes: request.scopes, risk: request.risk } })
      log('consent pending id=' + id + ' peer=' + request.peerLinkId + ' scopes=' + request.scopes.join(','))
      return promise
    },
    listPending(): ConsentRequest[] {
      return [...pending.values()].map((entry) => cloneRequest(entry.request)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    decide(id: string, decision: Decision): boolean {
      if (decision !== 'granted' && decision !== 'denied') return false
      if (!pending.has(id)) return false
      settle(id, decision, 'decision')
      return true
    },
    awaitDecision(id: string, timeoutMs = 30000): Promise<'granted' | 'denied' | 'timeout'> {
      const known = decided.get(id)
      if (known !== undefined) return Promise.resolve(known)
      const entry = pending.get(id)
      if (entry === undefined) return Promise.resolve('timeout')
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          entry.waiters = entry.waiters.filter((waiter) => waiter.timer !== timer)
          resolve('timeout')
        }, timeoutMs)
        entry.waiters.push({ resolve, timer })
      })
    },
    pendingCount(): number {
      return pending.size
    },
    decidedCount(): number {
      return decided.size
    },
    dispose(): void {
      for (const entry of [...pending.values()]) {
        clearTimeout(entry.timer)
        for (const waiter of entry.waiters) {
          clearTimeout(waiter.timer)
          waiter.resolve('timeout')
        }
        entry.resolve('denied')
      }
      pending.clear()
    },
  }
}
