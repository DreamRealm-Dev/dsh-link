/**
 * The in-process event hub and the SSE route that replays it.
 *
 * Every subsystem publishes CoreEvents; the hub keeps the last LIMITS.eventBacklog of them with a
 * monotonically increasing seq. GET /link/v1/events?token= then writes every backlog frame on
 * connect, streams new ones live, and keeps the connection open with a comment heartbeat. The
 * frame is the protocol's: { callId, seq, done } plus the event's own { type, at, data }.
 */

import { CONTRACT_VERSION, LIMITS, PROTOCOL_ID, ROUTES } from './types.ts'
import type { CoreEvent, EventHub, HttpIo, RouteSpec, TokenService } from './types.ts'
import { refuse } from './errors.ts'
import { bearerToken, TOKEN_AUDIENCE } from '../identity/tokens.ts'
import type { RouteTable } from '../http/routes.ts'

/** One backlog entry: the event plus the seq it was published with. */
export interface EventEntry {
  seq: number
  event: CoreEvent
}

/** The hub plus the seq-exposing read the SSE route needs. */
export interface EventHubStore extends EventHub {
  /** The newest entries in publish order (oldest first). */
  entries(limit?: number): EventEntry[]
  /** How many events were published this process. */
  published(): number
}

/**
 * Build the event hub.
 * @param options - backlog size (default LIMITS.eventBacklog) and clock.
 * @returns the hub.
 */
export function createEventHub(options: { backlog?: number; now?: () => number } = {}): EventHubStore {
  const backlog = Math.max(1, Math.floor(options.backlog ?? LIMITS.eventBacklog))
  const now = options.now ?? (() => Date.now())
  const entries: EventEntry[] = []
  const listeners = new Set<(event: CoreEvent) => void>()
  let seq = 0
  let total = 0

  const copy = (event: CoreEvent): CoreEvent => ({ type: event.type, at: event.at, data: event.data === undefined ? undefined : { ...event.data } })

  return {
    publish(event: CoreEvent): void {
      const stored: CoreEvent = { type: String(event.type), at: event.at || new Date(now()).toISOString(), data: event.data === undefined ? undefined : { ...event.data } }
      seq += 1
      total += 1
      entries.push({ seq, event: stored })
      while (entries.length > backlog) entries.shift()
      for (const listener of listeners) {
        try {
          listener(copy(stored))
        } catch {
          /* one broken listener must not stop the others */
        }
      }
    },
    subscribe(listener: (event: CoreEvent) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    recent(limit = 20): CoreEvent[] {
      const count = Math.max(1, Math.floor(limit))
      return entries.slice(-count).map((entry) => copy(entry.event))
    },
    entries(limit = backlog): EventEntry[] {
      const count = Math.max(1, Math.floor(limit))
      return entries.slice(-count).map((entry) => ({ seq: entry.seq, event: copy(entry.event) }))
    },
    published(): number {
      return total
    },
  }
}

/** The SSE routes plus the teardown that ends every open stream. */
export interface EventsRouteSet {
  routes: RouteSpec[]
  stop(): void
}

/**
 * Build the SSE route.
 * @param table - the route table.
 * @param io - the shared helpers.
 * @param tokens - the token service.
 * @param events - the hub to replay and follow.
 * @param log - the plugin log.
 * @returns the route set with its teardown.
 */
export function createEventsRoutes(table: RouteTable, io: HttpIo, tokens: TokenService, events: EventHubStore, _log: (line: string) => void): EventsRouteSet {
  const streams = new Set<{ res: { end(body?: unknown): unknown }; timer: ReturnType<typeof setInterval>; unsubscribe: () => void }>()

  const frame = (entry: EventEntry): string => {
    const callId = typeof entry.event.data?.callId === 'string' ? entry.event.data.callId : null
    return 'data: ' + JSON.stringify({ callId, seq: entry.seq, done: true, type: entry.event.type, at: entry.event.at, data: entry.event.data ?? null }) + '\n\n'
  }

  const closeStream = (stream: { res: { end(body?: unknown): unknown }; timer: ReturnType<typeof setInterval>; unsubscribe: () => void }): void => {
    if (!streams.delete(stream)) return
    clearInterval(stream.timer)
    stream.unsubscribe()
    try { stream.res.end() } catch { /* the peer is already gone */ }
  }

  const route = table.exact('GET', ROUTES.events, (req, res) => {
    const { query } = io.parseUrl(req)
    const token = query.get('token') ?? bearerToken(req.headers)
    if (token === null || token === '') throw refuse('link/unauthorized', 'the events stream requires a bearer token')
    const verdict = tokens.verify(token, { aud: TOKEN_AUDIENCE })
    if (!verdict.ok) throw refuse(verdict.code, verdict.message)

    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    res.write(': ' + PROTOCOL_ID + ' events ' + CONTRACT_VERSION + '\n\n')

    for (const entry of events.entries(LIMITS.eventBacklog)) res.write(frame(entry))

    const stream = {
      res,
      timer: setInterval(() => { try { res.write(': keep-alive\n\n') } catch { closeStream(stream) } }, 15000),
      unsubscribe: () => {},
    }
    stream.timer.unref?.()
    stream.unsubscribe = events.subscribe((event) => {
      const newest = events.entries(1)[0]
      const seq = newest === undefined ? 0 : newest.seq
      const callId = typeof event.data?.callId === 'string' ? event.data.callId : null
      try {
        res.write('data: ' + JSON.stringify({ callId, seq, done: true, type: event.type, at: event.at, data: event.data ?? null }) + '\n\n')
      } catch {
        closeStream(stream)
      }
    })
    streams.add(stream)
    res.on?.('close', () => closeStream(stream))
  })

  return {
    routes: [route],
    stop(): void {
      for (const stream of [...streams]) closeStream(stream)
    },
  }
}
