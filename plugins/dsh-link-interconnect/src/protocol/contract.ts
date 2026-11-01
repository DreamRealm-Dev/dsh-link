/**
 * GET /link/v1/contract - the read-only protocol document software and adapters both read, and
 * GET /.well-known/link-interconnect.json - LINK's own declaration on the same discovery channel.
 *
 * The contract is built from the frozen constants in types.ts and serialized once at module load:
 * two reads are byte-identical by construction, and it names every stable error code. It carries
 * no instance fact at all (no linkId, no pairing code, no port), so a cache can hold it forever.
 */

import { CAPS, CONTRACT_VERSION, ERROR_CODES, LIMITS, PROTOCOL_ID, PROTOCOL_MAJOR, PROTOCOL_MINOR, ROUTES, SCOPES } from './types.ts'
import type { HttpIo, PeerManifest, RouteSpec } from './types.ts'
import type { RouteTable } from '../http/routes.ts'

/** One endpoint row the contract advertises. */
export interface ContractEndpoint {
  method: string
  path: string
  auth: 'none' | 'bearer'
  summary: string
}

/** One capability kind the protocol carries. */
export interface ContractCapability {
  kind: string
  version: number
  direction: 'software-to-link' | 'link-to-software'
  scopes: string[]
  summary: string
}

/** The whole contract document. Field order is part of the byte-identity reading. */
export interface ContractDocument {
  protocol: string
  version: string
  major: number
  minor: number
  endpoints: ContractEndpoint[]
  caps: ContractCapability[]
  scopes: string[]
  errors: string[]
  limits: Record<string, number>
  csp: Record<string, string>
}

/**
 * Build the contract document.
 * @returns the document built only from frozen constants.
 */
export function buildContract(): ContractDocument {
  return {
    protocol: PROTOCOL_ID,
    version: CONTRACT_VERSION,
    major: PROTOCOL_MAJOR,
    minor: PROTOCOL_MINOR,
    endpoints: [
      { method: 'GET', path: ROUTES.contract, auth: 'none', summary: 'this document' },
      { method: 'GET', path: ROUTES.wellKnown, auth: 'none', summary: "LINK's own declaration" },
      { method: 'POST', path: ROUTES.handshake, auth: 'none', summary: 'ask for a pairing challenge' },
      { method: 'POST', path: ROUTES.handshakeConfirm, auth: 'none', summary: 'prove the challenge with the pairing code' },
      { method: 'POST', path: ROUTES.invoke, auth: 'bearer', summary: 'one capability call, idempotent' },
      { method: 'GET', path: ROUTES.events, auth: 'bearer', summary: 'SSE call progress with backlog replay' },
      { method: 'POST', path: ROUTES.embedToken, auth: 'bearer', summary: 'short-lived embed token (aud = origin)' },
      { method: 'GET', path: ROUTES.embedSession, auth: 'bearer', summary: 'embed session document' },
      { method: 'GET', path: ROUTES.openaiPrefix + '/*', auth: 'bearer', summary: 'proxied OpenAI-compatible model calls' },
      { method: 'GET', path: ROUTES.anthropicPrefix + '/*', auth: 'bearer', summary: 'proxied Anthropic-compatible model calls' },
    ],
    caps: [
      { kind: CAPS.modelsProvide, version: 1, direction: 'software-to-link', scopes: [CAPS.modelsProvide], summary: 'software offers an OpenAI-compatible model surface' },
      { kind: CAPS.toolsExpose, version: 1, direction: 'software-to-link', scopes: [CAPS.toolsExpose], summary: 'software offers tools LINK registers' },
      { kind: CAPS.sessionEmbed, version: 1, direction: 'link-to-software', scopes: ['embed.session'], summary: 'software embeds a LINK session window' },
      { kind: CAPS.modelsProxy, version: 1, direction: 'link-to-software', scopes: [CAPS.modelsProxy], summary: 'software calls LINK model proxies with a bearer key' },
    ],
    scopes: [...SCOPES],
    errors: Object.values(ERROR_CODES),
    limits: { ...LIMITS },
    csp: {
      frameAncestors: "'self' {origin}",
      connectSrc: "'self' {origin}",
      scriptSrc: "'self'",
      styleSrc: "'self' 'unsafe-inline'",
      imgSrc: "'self' data: {origin}",
    },
  }
}

/** The one serialized contract; module-load time, byte-identical on every read. */
const CONTRACT_TEXT = JSON.stringify(buildContract())

/**
 * The serialized contract bytes.
 * @returns the same string on every call.
 */
export function contractText(): string {
  return CONTRACT_TEXT
}

/**
 * Build LINK's own declaration (the well-known discovery document).
 * @param linkId - this instance's derived id.
 * @returns the peer manifest software reads to adapt to LINK.
 */
export function buildWellKnown(linkId: string): PeerManifest {
  return {
    protocol: PROTOCOL_ID,
    identity: { linkId, name: 'DSH-LINK', vendor: 'deepseek' },
    endpoints: { invoke: ROUTES.invoke, events: ROUTES.events },
    capabilities: [
      { kind: CAPS.modelsProxy, version: 1, auth: 'bearer', scopes: [CAPS.modelsProxy] },
      { kind: CAPS.toolsExpose, version: 1, auth: 'bearer', scopes: [CAPS.toolsExpose] },
      { kind: CAPS.sessionEmbed, version: 1, auth: 'bearer', scopes: ['embed.session'] },
    ],
    limits: { rpm: LIMITS.rpm, bodyBytes: LIMITS.bodyBytes },
  }
}

/**
 * The two read-only discovery routes.
 * @param table - the route table.
 * @param io - the shared helpers.
 * @param identity - this instance's identity (for the well-known linkId).
 * @param log - the plugin log.
 * @returns the routes.
 */
export function createContractRoutes(table: RouteTable, io: HttpIo, identity: { linkId: string }, log: (line: string) => void): RouteSpec[] {
  return [
    table.exact('GET', ROUTES.contract, (_req, res) => {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(CONTRACT_TEXT)
      log('contract read')
    }),
    table.exact('GET', ROUTES.wellKnown, (_req, res) => {
      io.sendJson(res, 200, buildWellKnown(identity.linkId))
    }),
  ]
}
