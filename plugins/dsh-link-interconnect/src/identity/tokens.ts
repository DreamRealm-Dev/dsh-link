/**
 * Compact JWS (EdDSA) tokens: access (15m), refresh (30d), embed (10m, aud = origin).
 *
 * The signature is the instance Ed25519 key: header {"alg":"EdDSA","typ":"JWT"}, claims
 * {sub,aud,scope,iat,exp,jti}. verify() answers a TokenVerdict whose failure carries the stable
 * protocol code, so a caller refuses without re-deriving the reason. A revoked jti is persisted,
 * so an immediate revoke survives a restart.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITS } from '../protocol/types.ts'
import type { IdentityService, TokenClaims, TokenService, TokenVerdict } from '../protocol/types.ts'

/** The audience LINK mints its own tokens for. */
export const TOKEN_AUDIENCE = 'dsh-link'

const REVOKED_FILE = 'revoked-tokens.json'
const HEADER = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }), 'utf8').toString('base64url')

/** The service plus the file it persists the revoke list in. */
export interface TokenStore extends TokenService {
  /** Absolute path of the persisted jti blacklist. */
  file: string
}

interface RevokedEntry {
  jti: string
  exp: number
}

/**
 * Pull one bearer token out of request headers.
 * @param headers - node:http request headers.
 * @returns the token text, or undefined.
 */
export function bearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers['authorization']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim())
  return match === null ? undefined : match[1]
}

/**
 * Load or create the token service.
 * @param options - data directory, the instance identity, optional log and clock.
 * @returns the token service.
 */
export function createTokenService(options: { dir: string; identity: IdentityService; log?: (line: string) => void; now?: () => number }): TokenStore {
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => Date.now())
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, REVOKED_FILE)
  const revoked = new Map<string, number>()

  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { revoked?: RevokedEntry[] }
      for (const entry of Array.isArray(stored.revoked) ? stored.revoked : []) {
        if (typeof entry?.jti === 'string' && Number.isFinite(entry?.exp)) revoked.set(entry.jti, entry.exp)
      }
    } catch (error) {
      log('revoked-token list is unreadable (' + String((error instanceof Error ? error.message : String(error))) + '); starting empty')
    }
  }
  const prune = (): void => {
    const at = now()
    for (const [jti, exp] of revoked) if (exp <= at) revoked.delete(jti)
  }
  const persist = (): void => {
    prune()
    const temp = file + '.' + String(process.pid) + '.tmp'
    writeFileSync(temp, JSON.stringify({ version: 1, revoked: [...revoked].map(([jti, exp]) => ({ jti, exp })) }, null, 2) + '\n')
    renameSync(temp, file)
  }

  return {
    file,
    mint(claims): { token: string; jti: string; expiresAt: string } {
      const at = now()
      const iat = Math.floor(at / 1000)
      const exp = Math.floor((at + claims.ttlMs) / 1000)
      const jti = 'jti_' + randomBytes(12).toString('base64url')
      const payload = { sub: claims.sub, aud: claims.aud, scope: [...claims.scope], iat, exp, jti }
      const body = HEADER + '.' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
      return { token: body + '.' + options.identity.sign(body), jti, expiresAt: new Date(at + claims.ttlMs).toISOString() }
    },
    verify(token: string | undefined, verifyOptions?: { aud?: string; scope?: string }): TokenVerdict {
      const parts = typeof token === 'string' ? token.split('.') : []
      if (parts.length !== 3 || parts.some((part) => part === '')) {
        return { ok: false, code: 'link/unauthorized', message: 'token is not a compact JWS' }
      }
      let header: Record<string, unknown>
      let claims: TokenClaims
      try {
        header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as Record<string, unknown>
        claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as TokenClaims
      } catch {
        return { ok: false, code: 'link/unauthorized', message: 'token header or claims are not base64url JSON' }
      }
      if (header.alg !== 'EdDSA' || header.typ !== 'JWT') {
        return { ok: false, code: 'link/unauthorized', message: 'token is not an EdDSA JWT' }
      }
      if (!options.identity.verify(parts[0]! + '.' + parts[1]!, parts[2]!, options.identity.publicKey)) {
        return { ok: false, code: 'link/unauthorized', message: 'token signature rejected' }
      }
      if (typeof claims.sub !== 'string' || typeof claims.aud !== 'string' || typeof claims.jti !== 'string' || !Array.isArray(claims.scope) || !Number.isFinite(claims.exp)) {
        return { ok: false, code: 'link/unauthorized', message: 'token claims are incomplete' }
      }
      if (claims.exp <= Math.floor(now() / 1000)) {
        return { ok: false, code: 'link/unauthorized', message: 'token expired' }
      }
      if (revoked.has(claims.jti)) {
        return { ok: false, code: 'link/unauthorized', message: 'token was revoked' }
      }
      if (verifyOptions?.aud !== undefined && claims.aud !== verifyOptions.aud) {
        return { ok: false, code: 'link/unauthorized', message: 'token audience is not ' + verifyOptions.aud }
      }
      if (verifyOptions?.scope !== undefined && !claims.scope.includes(verifyOptions.scope)) {
        return { ok: false, code: 'link/scope-missing', message: 'token lacks scope ' + verifyOptions.scope }
      }
      return { ok: true, claims }
    },
    revoke(jti: string): void {
      revoked.set(jti, now() + LIMITS.refreshTokenMs)
      persist()
      log('token jti revoked (' + String(revoked.size) + ' blacklisted)')
    },
    isRevoked(jti: string): boolean {
      return revoked.has(jti)
    },
  }
}
