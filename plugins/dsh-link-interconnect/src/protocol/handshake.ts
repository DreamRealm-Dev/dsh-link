/**
 * POST /link/v1/handshake and /link/v1/handshake/confirm - pairing code plus a signature over a
 * server challenge, so a network attacker who can read traffic still cannot join.
 *
 * handshake  {protocol, client:{linkId,pub,platform}, scopes} -> {challenge, expiresIn}
 * confirm    {signature, pairingCode}                        -> tokens + peer
 *
 * The peer proves possession of its Ed25519 private key by signing LINK's challenge; the person
 * proves authorization by typing the pairing code. A wrong code is 401 link/unauthorized, never a
 * hint about the expected value. The granted scopes are the requested intersection SCOPES, and the
 * peer row plus grant are written only after both checks pass.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { LIMITS, PROTOCOL_MAJOR, ROUTES, SCOPES } from './types.ts'
import type { AuditSink, EventHub, GrantStore, HttpIo, HttpResponse, IdentityService, PeerStore, RouteSpec, TokenService } from './types.ts'
import { refuse } from './errors.ts'
import { isEd25519PublicKey, linkIdForPublicKey } from '../identity/store.ts'
import { TOKEN_AUDIENCE } from '../identity/tokens.ts'
import { createRateLimiter } from '../http/ratelimit.ts'
import type { RateLimiter } from '../http/ratelimit.ts'
import type { RouteTable } from '../http/routes.ts'

/** How long a challenge stays valid. */
export const CHALLENGE_TTL_MS = 120_000
/** How many unconfirmed challenges one process holds before dropping the oldest. */
const MAX_PENDING = 64

interface PendingHandshake {
  linkId: string
  pub: string
  scopes: string[]
  name: string
  platform?: string | undefined
  vendor?: string | undefined
  expiresAt: number
}

/** Everything the two handshake routes need. */
export interface HandshakeOptions {
  table: RouteTable
  io: HttpIo
  identity: IdentityService
  tokens: TokenService
  peers: PeerStore
  grants: GrantStore
  audit: AuditSink
  events: EventHub
  /** The current pairing code; a callable so a rotation would be picked up. */
  pairingCode: () => string
  log: (line: string) => void
  limiter?: RateLimiter
  now?: () => number
}

/**
 * Compare two secrets without leaking their length or first differing byte.
 * @param left - presented value.
 * @param right - expected value.
 * @returns whether they are equal, case-insensitively (the code is typed by a person).
 */
export function samePairingCode(left: string, right: string): boolean {
  const a = createHash('sha256').update(left.trim().toUpperCase()).digest()
  const b = createHash('sha256').update(right.trim().toUpperCase()).digest()
  return timingSafeEqual(a, b)
}

/**
 * Extract the protocol major, or undefined when the text is not link-interconnect/<major>[.<minor>].
 * @param protocol - the peer's declared protocol id.
 * @returns the major, or undefined.
 */
export function protocolMajorOf(protocol: unknown): number | undefined {
  if (typeof protocol !== 'string') return undefined
  const match = /^([a-z][a-z0-9-]*)\/(\d+)(?:\.\d+)?$/.exec(protocol.trim())
  if (match === null || match[1] !== 'link-interconnect') return undefined
  return Number(match[2])
}

/**
 * Refuse a peer protocol that LINK cannot speak; a minor difference is accepted.
 * @param protocol - the declared protocol.
 * @param log - the plugin log.
 */
function assertProtocol(protocol: unknown, log: (line: string) => void): void {
  if (protocol === undefined) throw refuse('link/bad-request', 'protocol is required')
  const major = protocolMajorOf(protocol)
  if (major === undefined) throw refuse('link/version-unsupported', 'protocol must be link-interconnect/' + String(PROTOCOL_MAJOR))
  if (major !== PROTOCOL_MAJOR) throw refuse('link/version-unsupported', 'protocol major ' + String(major) + ' is not supported; this build speaks link-interconnect/' + String(PROTOCOL_MAJOR))
  log('handshake protocol ' + String(protocol))
}

/** One bounded display string from the handshake. */
function displayString(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, 80)
  return trimmed === '' ? fallback : trimmed
}

/**
 * Build the pair of handshake routes.
 * @param options - identity, stores, tokens, audit, hub, the pairing code getter and the log.
 * @returns the routes.
 */
export function createHandshakeRoutes(options: HandshakeOptions): RouteSpec[] {
  const now = options.now ?? (() => Date.now())
  const limiter = options.limiter ?? createRateLimiter({ rpm: LIMITS.rpm })
  const pending = new Map<string, PendingHandshake>()

  const takeToken = (req: { [key: string]: any }, res: HttpResponse, bucket: string): void => {
    const remote = typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : 'loopback'
    const decision = limiter.take(bucket + ':' + remote)
    if (decision.ok) return
    const retryAfterMs = decision.retryAfterMs ?? 1000
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
    throw refuse('link/rate-limited', 'too many handshake requests; retry in ' + String(retryAfterMs) + 'ms')
  }

  const handshake = options.table.exact('POST', ROUTES.handshake, async (req, res) => {
    takeToken(req, res, 'handshake')
    const body = await options.io.readJson(req)
    assertProtocol(body.protocol, options.log)
    const client = body.client
    if (client === null || typeof client !== 'object' || Array.isArray(client)) {
      throw refuse('link/bad-request', 'client {linkId,pub,platform} is required')
    }
    const pub = typeof client.pub === 'string' ? client.pub : ''
    if (!isEd25519PublicKey(pub)) throw refuse('link/bad-request', 'client.pub is not a base64url raw Ed25519 public key')
    const linkId = linkIdForPublicKey(pub)
    if (client.linkId !== undefined && client.linkId !== linkId) {
      throw refuse('link/bad-request', 'client.linkId does not match client.pub')
    }
    const requested = Array.isArray(body.scopes)
      ? [...new Set(body.scopes.filter((scope: unknown): scope is string => typeof scope === 'string').filter((scope: string) => (SCOPES as readonly string[]).includes(scope)))]
      : []
    const at = now()
    for (const [candidate, entry] of pending) {
      if (entry.expiresAt <= at) pending.delete(candidate)
    }
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next()
      if (!oldest.done) pending.delete(oldest.value)
    }
    const challenge = randomBytes(24).toString('base64url')
    pending.set(challenge, {
      linkId,
      pub,
      scopes: requested,
      name: displayString(client.name) ?? ('peer-' + linkId.slice(0, 8)),
      platform: displayString(client.platform),
      vendor: displayString(client.vendor),
      expiresAt: at + CHALLENGE_TTL_MS,
    })
    options.log('handshake challenge issued peer=' + linkId + ' scopes=' + String(requested.length))
    options.io.sendJson(res, 200, { challenge, expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000) })
  })

  const confirm = options.table.exact('POST', ROUTES.handshakeConfirm, async (req, res) => {
    takeToken(req, res, 'handshake-confirm')
    const body = await options.io.readJson(req)
    const signature = typeof body.signature === 'string' ? body.signature : ''
    const pairingCode = typeof body.pairingCode === 'string' ? body.pairingCode : ''
    if (signature === '') throw refuse('link/bad-request', 'signature is required')
    if (pairingCode === '') throw refuse('link/bad-request', 'pairingCode is required')
    if (!samePairingCode(pairingCode, options.pairingCode())) {
      options.audit.record({ kind: 'handshake', ok: false, code: 'link/unauthorized', detail: 'pairing-code' })
      options.log('handshake refused: pairing code')
      throw refuse('link/unauthorized', 'pairing code rejected')
    }
    const at = now()
    let found: { challenge: string; entry: PendingHandshake } | undefined
    if (typeof body.challenge === 'string') {
      const entry = pending.get(body.challenge)
      if (entry !== undefined) found = { challenge: body.challenge, entry }
    } else {
      for (const [challenge, entry] of pending) {
        if (entry.expiresAt <= at) continue
        if (options.identity.verify(challenge, signature, entry.pub)) {
          found = { challenge, entry }
          break
        }
      }
    }
    if (found === undefined) {
      options.audit.record({ kind: 'handshake', ok: false, code: 'link/unauthorized', detail: 'no-pending-challenge' })
      throw refuse('link/unauthorized', 'no pending challenge matches the signature; run handshake again')
    }
    if (found.entry.expiresAt <= at) {
      pending.delete(found.challenge)
      throw refuse('link/unauthorized', 'challenge expired; run handshake again')
    }
    if (!options.identity.verify(found.challenge, signature, found.entry.pub)) {
      options.audit.record({ kind: 'handshake', ok: false, code: 'link/unauthorized', detail: 'bad-signature' })
      throw refuse('link/unauthorized', 'challenge signature rejected')
    }
    pending.delete(found.challenge)

    const scopes = found.entry.scopes.filter((scope) => (SCOPES as readonly string[]).includes(scope))
    const atIso = new Date(at).toISOString()
    const existing = options.peers.get(found.entry.linkId)
    const peer = options.peers.upsert({
      linkId: found.entry.linkId,
      name: found.entry.name,
      vendor: found.entry.vendor,
      platform: found.entry.platform,
      pub: found.entry.pub,
      scopes,
      status: 'active',
      transport: 'loopback',
      createdAt: existing?.createdAt ?? atIso,
      updatedAt: atIso,
      lastSeenAt: atIso,
    })
    options.grants.grant({ peerLinkId: peer.linkId, scopes, grantedAt: atIso, grantedBy: 'user' })
    const access = options.tokens.mint({ sub: peer.linkId, aud: TOKEN_AUDIENCE, scope: scopes, ttlMs: LIMITS.accessTokenMs })
    const refresh = options.tokens.mint({ sub: peer.linkId, aud: TOKEN_AUDIENCE, scope: scopes, ttlMs: LIMITS.refreshTokenMs })
    options.events.publish({ type: 'handshake/confirmed', at: atIso, data: { linkId: peer.linkId, name: peer.name, scopes } })
    options.audit.record({ kind: 'handshake', peer: peer.linkId, ok: true })
    options.log('handshake confirmed peer=' + peer.linkId + ' name=' + peer.name + ' scopes=' + scopes.join(','))
    options.io.sendJson(res, 200, {
      accessToken: access.token,
      refreshToken: refresh.token,
      scopes,
      expiresAt: access.expiresAt,
      peer: { linkId: peer.linkId, name: peer.name },
    })
  })

  return [handshake, confirm]
}
