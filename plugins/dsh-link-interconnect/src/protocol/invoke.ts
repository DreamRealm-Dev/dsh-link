/**
 * POST /link/v1/invoke - one capability call against LINK.
 *
 * Order of checks is the protocol's: bearer token (401) -> rate limit (429) -> capability scope
 * (403 link/scope-missing) -> capability exists (404) -> handler. A handler is executed at most
 * once per (peer, idempotencyKey) within LIMITS.idempotencyMs: the first answer is stored as bytes
 * and replays byte-identical with x-link-idempotent-replay: 1, so a retried call never runs twice.
 *
 * Built-in capability link.info: identity, contract, ping. ping carries a timestamp, which makes
 * an idempotent replay observable as "the same time twice".
 */

import { randomBytes } from 'node:crypto'
import { CONTRACT_VERSION, LIMITS, PROTOCOL_ID, PROTOCOL_MAJOR, ROUTES } from './types.ts'
import type { AuditSink, EventHub, HttpIo, IdentityService, RouteSpec, TokenClaims, TokenService } from './types.ts'
import { asLinkError, refuse } from './errors.ts'
import { buildContract } from './contract.ts'
import { bearerToken, TOKEN_AUDIENCE } from '../identity/tokens.ts'
import { createRateLimiter } from '../http/ratelimit.ts'
import type { RateLimiter } from '../http/ratelimit.ts'
import type { RouteTable } from '../http/routes.ts'

/** What one capability handler is handed. */
export interface CapabilityCall {
  /** The request's args object (empty object when absent). */
  args: Record<string, any>
  /** The authenticated peer's linkId. */
  peer: string
  /** The peer's verified token claims. */
  claims: TokenClaims
}

/** One capability operation. */
export type CapabilityHandler = (call: CapabilityCall) => unknown | Promise<unknown>

/** The capability table a handler is looked up in. */
export interface CapabilityRegistry {
  /** Add/replace one capability operation. */
  register(cap: string, op: string, handler: CapabilityHandler): void
  /** One handler, or undefined. */
  get(cap: string, op: string): CapabilityHandler | undefined
  /** The scopes a capability needs; unknown capabilities need none (they 404 instead). */
  scopes(cap: string): string[]
  /** Every registered "cap/op". */
  operations(): string[]
}

const CAP_SCOPES: Readonly<Record<string, string[]>> = Object.freeze({
  'link.info': [],
  'models.provide': ['models.provide'],
  'tools.expose': ['tools.expose'],
  'session.embed': ['embed.session'],
  'models.proxy': ['models.proxy'],
  'consent.manage': ['consent.manage'],
  'audit.read': ['audit.read'],
})

/**
 * The scopes one capability requires.
 * @param cap - capability kind.
 * @returns the required scopes (empty for link.info and unknown capabilities).
 */
export function requiredScopesFor(cap: string): string[] {
  return [...(CAP_SCOPES[cap] ?? [])]
}

/**
 * Build an empty capability registry.
 * @returns the registry.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const handlers = new Map<string, CapabilityHandler>()
  const key = (cap: string, op: string): string => cap + '\u0000' + op
  return {
    register(cap, op, handler) {
      handlers.set(key(cap, op), handler)
    },
    get(cap, op) {
      return handlers.get(key(cap, op))
    },
    scopes(cap) {
      return requiredScopesFor(cap)
    },
    operations() {
      return [...handlers.keys()].map((entry) => entry.replace('\u0000', '/'))
    },
  }
}

/**
 * Register the built-in introspection capability.
 * @param registry - the registry to fill.
 * @param identity - this instance's identity.
 * @returns the same registry.
 */
export function registerBuiltinCapabilities(registry: CapabilityRegistry, identity: IdentityService): CapabilityRegistry {
  registry.register('link.info', 'identity', () => ({
    protocol: PROTOCOL_ID,
    linkId: identity.linkId,
    publicKey: identity.publicKey,
    contractVersion: CONTRACT_VERSION,
    protocolMajor: PROTOCOL_MAJOR,
  }))
  registry.register('link.info', 'contract', () => buildContract())
  registry.register('link.info', 'ping', () => ({ protocol: PROTOCOL_ID, at: new Date().toISOString() }))
  return registry
}

/** Everything the invoke route needs. */
export interface InvokeOptions {
  table: RouteTable
  io: HttpIo
  tokens: TokenService
  capabilities: CapabilityRegistry
  audit: AuditSink
  events: EventHub
  log: (line: string) => void
  limiter?: RateLimiter
  now?: () => number
  idempotencyMs?: number
}

interface IdempotentAnswer {
  at: number
  cap: string
  op: string
  body: string
}

/**
 * Build the invoke route.
 * @param options - token service, capability table, audit, hub, log and seams.
 * @returns the route list (one route).
 */
export function createInvokeRoutes(options: InvokeOptions): RouteSpec[] {
  const now = options.now ?? (() => Date.now())
  const limiter = options.limiter ?? createRateLimiter({ rpm: LIMITS.rpm })
  const idempotencyMs = options.idempotencyMs ?? LIMITS.idempotencyMs
  const answers = new Map<string, IdempotentAnswer>()

  const sendText = (res: { statusCode: number; setHeader(name: string, value: string): unknown; end(body?: unknown): unknown }, status: number, text: string): void => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(text)
  }

  const route = options.table.exact('POST', ROUTES.invoke, async (req, res) => {
    const body = await options.io.readJson(req)
    const token = bearerToken(req.headers)
    if (token === undefined || token === '') throw refuse('link/unauthorized', 'a bearer token is required')
    const verdict = options.tokens.verify(token, { aud: TOKEN_AUDIENCE })
    if (!verdict.ok) throw refuse(verdict.code, verdict.message)
    const claims = verdict.claims
    const peer = claims.sub

    const decision = limiter.take('invoke:' + peer)
    if (!decision.ok) {
      const retryAfterMs = decision.retryAfterMs ?? 1000
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      throw refuse('link/rate-limited', 'too many invokes; retry in ' + String(retryAfterMs) + 'ms')
    }

    const cap = typeof body.cap === 'string' ? body.cap : ''
    const op = typeof body.op === 'string' ? body.op : ''
    if (cap === '' || op === '') throw refuse('link/bad-request', 'cap and op are required')
    const required = requiredScopesFor(cap)
    for (const scope of required) {
      if (!claims.scope.includes(scope)) throw refuse('link/scope-missing', 'capability ' + cap + ' requires scope ' + scope)
    }

    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey !== '' ? body.idempotencyKey : undefined
    const mapKey = idempotencyKey === undefined ? undefined : peer + '\u0000' + idempotencyKey
    if (mapKey !== undefined) {
      const existing = answers.get(mapKey)
      if (existing !== undefined) {
        if (now() - existing.at >= idempotencyMs) {
          answers.delete(mapKey)
        } else if (existing.cap !== cap || existing.op !== op) {
          throw refuse('link/idempotency-conflict', 'idempotencyKey ' + String(idempotencyKey) + ' was first used for ' + existing.cap + '/' + existing.op)
        } else {
          res.setHeader('x-link-idempotent-replay', '1')
          options.log('invoke-replay cap=' + cap + ' op=' + op + ' peer=' + peer)
          sendText(res, 200, existing.body)
          return
        }
      }
    }

    const handler = options.capabilities.get(cap, op)
    if (handler === undefined) throw refuse('link/not-found', 'unknown capability ' + cap + '/' + op)

    const at = new Date(now()).toISOString()
    const startedAt = now()
    const callId = 'call_' + randomBytes(8).toString('base64url')
    const args = body.args === null || typeof body.args !== 'object' || Array.isArray(body.args) ? {} : body.args
    let result: unknown
    try {
      result = await handler({ args, peer, claims })
    } catch (error) {
      const failure = asLinkError(error)
      options.audit.record({ kind: 'invoke', peer, cap, op, ok: false, code: failure.code, ms: Math.max(0, now() - startedAt) })
      options.events.publish({ type: 'invoke', at, data: { callId, cap, op, ok: false, code: failure.code } })
      options.log('invoke cap=' + cap + ' op=' + op + ' peer=' + peer + ' ok=false code=' + failure.code)
      throw failure
    }
    const text = JSON.stringify({ ok: true, result })
    if (mapKey !== undefined) answers.set(mapKey, { at: now(), cap, op, body: text })
    const ms = Math.max(0, now() - startedAt)
    options.audit.record({ kind: 'invoke', peer, cap, op, ok: true, ms })
    options.events.publish({ type: 'invoke', at, data: { callId, cap, op, ok: true, ms } })
    options.log('invoke cap=' + cap + ' op=' + op + ' peer=' + peer + ' ok=true ms=' + String(ms))
    sendText(res, 200, text)
  })

  return [route]
}
