/**
 * Instance identity: one Ed25519 keypair under <dir>/identity.json.
 *
 * linkId = base32(sha256(raw public key))[0:26] - derived from the key, never from a name, so a
 * rename never changes who this instance is. The private key never leaves this file: no log line,
 * no contract, no snapshot, no audit record carries it.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IdentityService } from '../protocol/types.ts'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const LINK_ID_LENGTH = 26
const KEY_BYTES = 32
const HEAD = 'identity.json'

/**
 * Encode bytes as RFC 4648 base32, lowercase, no padding.
 * @param bytes - the bytes.
 * @returns the encoded text.
 */
export function toBase32(bytes: Buffer | Uint8Array): string {
  let accumulator = 0
  let bits = 0
  let out = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31]
  return out
}

/**
 * Decode base64url strictly; returns null on any non-alphabet character.
 * @param text - the encoded text.
 * @returns the bytes, or null.
 */
export function fromBase64Url(text: string): Buffer | null {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 === 1) return null
  if (/[^A-Za-z0-9_-]/.test(text)) return null
  try {
    return Buffer.from(text, 'base64url')
  } catch {
    return null
  }
}

/**
 * Derive the instance id from a base64url raw Ed25519 public key.
 * @param publicKey - base64url raw public key (32 bytes).
 * @returns linkId, 26 base32 characters.
 * @throws when the key is not a 32-byte base64url value.
 */
export function linkIdForPublicKey(publicKey: string): string {
  const raw = fromBase64Url(publicKey)
  if (raw === null || raw.byteLength !== KEY_BYTES) throw new Error('not a base64url Ed25519 public key')
  return toBase32(createHash('sha256').update(raw).digest()).slice(0, LINK_ID_LENGTH)
}

/**
 * True when the text is a usable base64url raw Ed25519 public key.
 * @param publicKey - candidate text.
 * @returns whether node:crypto accepts it as an Ed25519 public key.
 */
export function isEd25519PublicKey(publicKey: string): boolean {
  const raw = fromBase64Url(publicKey)
  if (raw === null || raw.byteLength !== KEY_BYTES) return false
  try {
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' })
    return true
  } catch {
    return false
  }
}

/** The identity service plus what createProtocolServer logs about it. */
export interface IdentityStore {
  identity: IdentityService
  /** Absolute path of identity.json. */
  file: string
  /** true when this run created the keypair. */
  created: boolean
}

/**
 * Load or create the instance keypair; self-heals a corrupt or mis-derived file by regenerating.
 * @param options - the data directory and the one log sink.
 * @returns the identity service and its file.
 */
export function createIdentityStore(options: { dir: string; log?: (line: string) => void }): IdentityStore {
  const log = options.log ?? (() => {})
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, HEAD)

  const build = (publicKey: string, privateKeyDer: Buffer, linkId: string, _createdAt: string, created: boolean): IdentityStore => {
    const privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' })
    const identity: IdentityService = {
      linkId,
      publicKey,
      sign(payload: string): string {
        return signBytes(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url')
      },
      verify(payload: string, signature: string, peerPublicKey: string): boolean {
        const rawSignature = fromBase64Url(signature)
        if (rawSignature === null || rawSignature.byteLength !== 64) return false
        try {
          const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: peerPublicKey }, format: 'jwk' })
          return verifyBytes(null, Buffer.from(payload, 'utf8'), key, rawSignature)
        } catch {
          return false
        }
      },
    }
    return { identity, file, created }
  }

  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { publicKey?: string; privateKey?: string; linkId?: string; createdAt?: string }
      const publicKey = String(stored.publicKey ?? '')
      const privateKeyDer = fromBase64Url(String(stored.privateKey ?? ''))
      if (isEd25519PublicKey(publicKey) && privateKeyDer !== null) {
        const linkId = linkIdForPublicKey(publicKey)
        if (stored.linkId !== linkId) {
          writeFileSync(file, JSON.stringify({ version: 1, algorithm: 'Ed25519', linkId, publicKey, privateKey: String(stored.privateKey), createdAt: stored.createdAt ?? new Date().toISOString() }, null, 2) + '\n')
          log('identity linkId repaired to ' + linkId + ' (' + file + ')')
        }
        return build(publicKey, privateKeyDer, linkId, stored.createdAt ?? new Date().toISOString(), false)
      }
      log('identity file ' + file + ' is unusable; regenerating the keypair')
    } catch (error) {
      log('identity file ' + file + ' is unreadable (' + String((error as Error)?.message ?? error) + '); regenerating the keypair')
    }
  }

  const pair = generateKeyPairSync('ed25519')
  const publicKey = String(pair.publicKey.export({ format: 'jwk' }).x)
  const privateKeyDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' })
  const linkId = linkIdForPublicKey(publicKey)
  const createdAt = new Date().toISOString()
  const temp = file + '.' + String(process.pid) + '.tmp'
  writeFileSync(temp, JSON.stringify({ version: 1, algorithm: 'Ed25519', linkId, publicKey, privateKey: privateKeyDer.toString('base64url'), createdAt }, null, 2) + '\n')
  renameSync(temp, file)
  log('identity ' + linkId + ' created (' + file + ')')
  return build(publicKey, privateKeyDer, linkId, createdAt, true)
}
