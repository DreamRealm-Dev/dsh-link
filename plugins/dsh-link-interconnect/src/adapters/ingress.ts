/**
 * createPeerIngress - the LINK side of the software-active direction (M3 软件主动适配).
 *
 * A software vendor declares itself (GET /.well-known/link-interconnect.json), the person is asked
 * once, and only then does LINK read capabilities, mint a scoped token and bind them:
 *
 *   tools.expose   -> one kernel tool per declaration, whose call POSTs back to the peer's
 *                     endpoints.invoke with the LINK-minted bearer token (src/bind/peer.ts)
 *   models.provide -> one external binding through the adapter runtime, which registers an
 *                     OpenAI-compatible provider against the peer's origin
 *
 * The token lives in memory only: a restart marks every persisted peer rejoin-required instead of
 * pretending its session survived. This module is cordis-free; only the kernel tool registry and
 * the model host arrive through BindHosts.
 */
import { API_PREFIX, CAPS, ERROR_CODES, LIMITS, PROTOCOL_ID, PROTOCOL_MAJOR, SCOPES } from '../protocol/types.ts'
import type { BindHosts, HttpIo, InterconnectCore, PeerManifest, RouteSpec, Subsystem, ToolDeclaration } from '../protocol/types.ts'
import { refuse } from '../protocol/errors.ts'
import { createRouteTable } from '../http/routes.ts'
import { registerPeerTools } from '../bind/peer.ts'
import type { AdapterRuntimeInternals } from './runtime.ts'

/** Where the pane adds/removes a software peer. */
export const PEERS_ROUTE = API_PREFIX + '/peers'

/** The declaration a peer serves. */
const WELL_KNOWN_PATH = '/.well-known/link-interconnect.json'

/** One declaration fetch's ceiling, in ms. */
const MANIFEST_TIMEOUT_MS = 8000

/** The hosts a peer may live on without an allowlist entry: loopback only. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Normalize one allowlist entry: host or host:port, lower case, no scheme or trailing slash.
 * @param entry - one entry from lan-allowlist.json or LINK_PEER_ALLOWLIST.
 * @returns the normalized entry, or undefined when it names nothing.
 */
function normalizeAllowlistEntry(entry: string): string | undefined {
  const text = String(entry ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return text === '' ? undefined : text
}

/**
 * Whether an origin's authority is named by the LAN allowlist.
 * @param host - the origin hostname (as URL parsed it).
 * @param port - the origin port ('' when the URL carried none).
 * @param allowlist - normalized entries, each a host or host:port.
 * @returns true when an entry names exactly this host (any port) or this host:port.
 */
function allowlisted(host: string, port: string, allowlist: readonly string[]): boolean {
  const name = host.toLowerCase()
  const authority = port === '' ? name : name + ':' + port
  return allowlist.some((entry) => entry === name || entry === authority || (port === '' && entry === name + ':80') || (port === '' && entry === name + ':443'))
}

/** One live peer session. The token is in memory only and never enters a document or a log. */
interface PeerSession {
  linkId: string
  name: string
  origin: string
  token: string
  tools: string[]
  disposeTools?: (() => void) | undefined
  bindingId?: string | undefined
  providerId?: string | undefined
}

/** What the pane draws for one peer. */
export interface PeerRow {
  linkId: string
  name: string
  /** The peer's recorded vendor alias, when its declaration carried one. */
  vendor?: string | undefined
  origin: string
  scopes: string[]
  tools: string[]
  providerId?: string | undefined
  /** Model ids the peer's OpenAI-compatible channel advertises (read through the kernel provider). */
  models?: string[]
  status: string
}

/** What createPeerIngress() takes from index.ts. */
export interface PeerIngressOptions {
  core: InterconnectCore
  io: HttpIo
  hosts: BindHosts
  runtime: AdapterRuntimeInternals
  /** Normalized LAN allowlist entries (host or host:port); loopback needs none. */
  peerAllowlist?: readonly string[]
  log(line: string): void
}

/** The ingress handle: routes for the pane plus the two operations a caller may drive. */
export interface PeerIngress extends Subsystem {
  list(): PeerRow[]
  addPeer(input: { url: string }): Promise<PeerRow>
  removePeer(linkId: string): { removed: boolean }
}

/** One sentence for a thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Normalize a peer origin and enforce the discovery policy: loopback is always allowed, and any
 * other host must be named by the LAN allowlist (deny by default, plan section 6). The allowlist
 * is the explicit act that opens the LAN - there is no "allow all" mode.
 * @param raw - the URL a person typed.
 * @param allowlist - normalized host / host:port entries that may be reached beyond loopback.
 * @returns the bare origin (scheme + host + port), no trailing slash.
 */
export function peerOriginOf(raw: string, allowlist: readonly string[] = []): string {
  let parsed: URL
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch (error) {
    throw refuse(ERROR_CODES.badRequest, 'peer url is not an absolute URL: ' + String(raw ?? ''))
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw refuse(ERROR_CODES.badRequest, 'peer url must be http(s)')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw refuse(ERROR_CODES.badRequest, 'peer url carries a path; give its origin only')
  }
  const host = parsed.hostname
  const port = parsed.port
  if (!LOOPBACK_HOSTS.has(host) && allowlisted(host, port, allowlist) === false) {
    throw refuse(ERROR_CODES.badRequest, 'peer ' + (port === '' ? host : host + ':' + port) + ' is not loopback and is not named by the LAN allowlist (link-interconnect/lan-allowlist.json or LINK_PEER_ALLOWLIST)')
  }
  return parsed.origin
}

/**
 * Read and validate one peer declaration.
 * @param origin - the peer origin.
 * @param log - the plugin log.
 * @returns the manifest.
 */
async function fetchPeerManifest(origin: string, log: (line: string) => void): Promise<PeerManifest> {
  let answer: Response
  try {
    answer = await fetch(origin + WELL_KNOWN_PATH, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + ' did not answer ' + WELL_KNOWN_PATH + ' (' + describeError(error) + ')')
  }
  if (answer.status !== 200) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + WELL_KNOWN_PATH + ' answered HTTP ' + String(answer.status))
  }
  let parsed: unknown
  try {
    parsed = await answer.json()
  } catch (error) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + ' answered no JSON declaration')
  }
  const manifest = parsed as PeerManifest
  assertPeerManifest(manifest, origin, log)
  return manifest
}

/**
 * Validate one declaration against protocol v1. Unknown capability kinds are ignored by name; a
 * wrong major is a refusal, never a guess.
 * @param manifest - the parsed declaration.
 * @param origin - the origin it came from (for sentences only).
 * @param log - the plugin log.
 */
export function assertPeerManifest(manifest: PeerManifest, origin: string, log: (line: string) => void): void {
  if (manifest === null || typeof manifest !== 'object') throw refuse(ERROR_CODES.badRequest, origin + ' served no declaration object')
  const protocol = typeof manifest.protocol === 'string' ? manifest.protocol : ''
  const parts = protocol.split('/')
  // `parts.length === 2` already guarantees index 1; the assertion keeps the runtime read identical.
  const major = parts.length === 2 && /^[0-9]+$/.test(parts[1]!) ? Number(parts[1]!) : Number.NaN
  if (parts[0] !== 'link-interconnect' || Number.isNaN(major)) {
    throw refuse(ERROR_CODES.versionUnsupported, origin + ' declares protocol ' + JSON.stringify(protocol))
  }
  if (major !== PROTOCOL_MAJOR) {
    throw refuse(ERROR_CODES.versionUnsupported, origin + ' speaks link-interconnect/' + String(major) + ', this build speaks ' + PROTOCOL_ID)
  }
  const identity = manifest.identity
  if (identity === null || typeof identity !== 'object' || typeof identity.linkId !== 'string' || identity.linkId.trim() === '' || typeof identity.name !== 'string' || identity.name.trim() === '') {
    throw refuse(ERROR_CODES.badRequest, origin + ' declaration names no identity.linkId/identity.name')
  }
  const invoke = manifest.endpoints === null || typeof manifest.endpoints !== 'object' ? undefined : manifest.endpoints.invoke
  if (typeof invoke !== 'string' || invoke.trim() === '' || !invoke.trim().startsWith('/')) {
    throw refuse(ERROR_CODES.badRequest, origin + ' declaration names no absolute endpoints.invoke path')
  }
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const known = declared.filter((cap) => cap !== null && typeof cap === 'object' && DECLARED_KINDS.has(String(cap.kind)))
  if (known.length === 0) throw refuse(ERROR_CODES.badRequest, origin + ' declares no known capability')
  for (const cap of declared) {
    const kind = cap !== null && typeof cap === 'object' ? String(cap.kind) : ''
    if (DECLARED_KINDS.has(kind) === false) log('peer ' + identity.linkId + ' declares unknown capability ' + JSON.stringify(kind) + '; ignored')
  }
}

/** The capability kinds this build can accept from a peer. */
const DECLARED_KINDS: ReadonlySet<string> = new Set([CAPS.modelsProvide, CAPS.toolsExpose])

/**
 * The scopes one declaration asks for: the declared per-capability scopes, else the kind itself.
 * @param manifest - the validated declaration.
 * @returns the unique scope names (protocol scope vocabulary only).
 */
export function peerScopesOf(manifest: PeerManifest): string[] {
  const scopes = new Set<string>()
  for (const cap of manifest.capabilities) {
    if (DECLARED_KINDS.has(String(cap.kind)) === false) continue
    const named = Array.isArray(cap.scopes) ? cap.scopes : []
    for (const scope of named) {
      if (SCOPES.includes(String(scope))) scopes.add(String(scope))
    }
    scopes.add(String(cap.kind))
  }
  return [...scopes].filter((scope) => SCOPES.includes(scope))
}

/**
 * Every declared tool across the tools.expose capabilities.
 * @param manifest - the validated declaration.
 * @returns the flat declarations.
 */
export function peerToolsOf(manifest: PeerManifest): ToolDeclaration[] {
  const tools: ToolDeclaration[] = []
  for (const cap of manifest.capabilities) {
    if (String(cap.kind) !== CAPS.toolsExpose) continue
    const declared = Array.isArray(cap.tools) ? cap.tools : []
    for (const tool of declared) {
      if (tool !== null && typeof tool === 'object' && typeof tool.name === 'string' && tool.name.trim() !== '') tools.push(tool)
    }
  }
  return tools
}

/** Whether the declaration offers an OpenAI-compatible model channel. */
function peerModelsDeclared(manifest: PeerManifest): boolean {
  return manifest.capabilities.some((cap) => cap !== null && typeof cap === 'object' && String(cap.kind) === CAPS.modelsProvide)
}

/** A provider route name derived from the peer's immutable id. */
function providerIdOf(linkId: string): string {
  return String(linkId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 48) || 'peer'
}

/**
 * Build the peer ingress.
 * @param options - core, io, hosts, adapter runtime and log.
 * @returns the ingress handle (a Subsystem with the two operations on the side).
 */
export function createPeerIngress(options: PeerIngressOptions): PeerIngress {
  const { core, io, hosts, runtime } = options
  const log = options.log
  const allowlist = (options.peerAllowlist ?? []).map((entry) => normalizeAllowlistEntry(entry)).filter((entry): entry is string => entry !== undefined)
  const sessions = new Map<string, PeerSession>()
  const table = createRouteTable(io, { onError: (error) => log('peer route failed: ' + describeError(error)) })

  const rowOf = (session: PeerSession): PeerRow => {
    const record = core.peers.get(session.linkId)
    return {
      linkId: session.linkId,
      name: session.name,
      vendor: record?.vendor,
      origin: session.origin,
      scopes: [...(record?.scopes ?? [])],
      tools: [...session.tools],
      providerId: session.providerId,
      status: record?.status ?? 'unknown',
    }
  }

  /**
   * The model ids one peer contributes, read through the kernel provider route so the answer is the
   * catalog a model call would actually see (the adapter asks the peer's GET /v1/models).
   * @param providerId - the provider route the binding registered.
   * @returns model ids, or an empty list when the host or the peer cannot answer.
   */
  const modelsOf = async (providerId: string): Promise<string[]> => {
    const llm = hosts.llm?.()
    if (llm === undefined || llm === null || typeof llm.listModels !== 'function') return []
    try {
      const rows = await llm.listModels(providerId)
      const ids = (Array.isArray(rows) ? rows : []).map((row: { id?: unknown }) => String(row?.id ?? '')).filter((id: string) => id !== '')
      return ids
    } catch (error) {
      log('listing models of ' + providerId + ' failed: ' + describeError(error))
      return []
    }
  }

  const list = (): PeerRow[] => [...sessions.values()].map(rowOf)

  /** Release every live registration of one peer; stores are touched by the caller. */
  const releaseSession = (session: PeerSession): void => {
    if (session.disposeTools !== undefined) {
      try {
        session.disposeTools()
      } catch (error) {
        log('releasing tools of peer ' + session.linkId + ' failed: ' + describeError(error))
      }
      session.disposeTools = undefined
    }
    if (session.bindingId !== undefined) {
      try {
        runtime.releaseExternalBinding(session.bindingId)
      } catch (error) {
        log('releasing the model binding of peer ' + session.linkId + ' failed: ' + describeError(error))
      }
      session.bindingId = undefined
    }
  }

  /**
   * Add one software peer: read its declaration, ask the person, mint a scoped token, bind its
   * capabilities. Any failure rolls back completely (no half tool set, no half provider).
   * @param input - the peer origin URL.
   * @returns the peer row.
   */
  const addPeer = async (input: { url: string }): Promise<PeerRow> => {
    const origin = peerOriginOf(input.url, allowlist)
    const manifest = await fetchPeerManifest(origin, log)
    const linkId = manifest.identity.linkId.trim()
    const name = manifest.identity.name.trim()
    if (sessions.has(linkId)) throw refuse(ERROR_CODES.badRequest, 'peer ' + linkId + ' is already added; remove it first')
    const scopes = peerScopesOf(manifest)
    const tools = peerToolsOf(manifest)
    const models = peerModelsDeclared(manifest)
    const kinds = [tools.length > 0 ? CAPS.toolsExpose : undefined, models ? CAPS.modelsProvide : undefined].filter((kind) => kind !== undefined)

    const decision = await core.consent.request({
      peerLinkId: linkId,
      peerName: name,
      title: '接入 ' + name + ' 的' + (tools.length > 0 ? '工具' : '') + (tools.length > 0 && models ? '与' : '') + (models ? '模型' : ''),
      capability: kinds.join('+'),
      scopes,
      detail: {
        origin,
        tools: tools.length > 0 ? tools.map((tool) => tool.name).join(', ') : '无',
        models: models ? 'OpenAI 兼容模型通道' : '无',
      },
      risk: tools.length > 0 ? 'medium' : 'low',
    })
    core.audit.record({ kind: 'consent', peer: linkId, cap: kinds.join('+'), ok: decision === 'granted', detail: 'peer at ' + origin })
    if (decision !== 'granted') throw refuse(ERROR_CODES.consentRequired, 'the person denied access to ' + name)

    const minted = core.tokens.mint({ sub: linkId, aud: origin, scope: scopes, ttlMs: LIMITS.accessTokenMs })
    const session: PeerSession = { linkId, name, origin, token: minted.token, tools: tools.map((tool) => tool.name) }
    sessions.set(linkId, session)
    try {
      const now = new Date().toISOString()
      core.peers.upsert({
        linkId,
        name,
        vendor: typeof manifest.identity.vendor === 'string' ? manifest.identity.vendor : undefined,
        platform: 'software',
        pub: 'manifest-only',
        scopes,
        status: 'active',
        transport: 'loopback',
        baseUrl: origin,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      })
      core.grants.grant({ peerLinkId: linkId, scopes, rpm: manifest.limits?.rpm ?? LIMITS.rpm, grantedAt: now, grantedBy: 'user' })

      if (tools.length > 0) {
        const toolHost = hosts.tools?.()
        if (toolHost === undefined || toolHost === null || typeof toolHost.register !== 'function') {
          throw refuse(ERROR_CODES.internal, 'the kernel tool registry is not mounted; cannot bind ' + name + ' tools')
        }
        session.disposeTools = registerPeerTools({
          host: toolHost,
          target: { peerLinkId: linkId, origin, invokePath: manifest.endpoints.invoke, token: minted.token, timeoutMs: LIMITS.timeoutMs },
          declarations: tools,
          log,
        })
        core.audit.record({ kind: 'bind', peer: linkId, cap: CAPS.toolsExpose, ok: true, detail: tools.map((tool) => tool.name).join(', ') })
      }
      if (models) {
        const binding = runtime.registerExternalBinding({
          id: 'peer:' + linkId,
          adapterId: 'peer:' + linkId,
          peerLinkId: linkId,
          caps: [CAPS.modelsProvide],
          baseUrl: origin,
          providerId: providerIdOf(linkId),
          apiKey: minted.token,
        })
        session.bindingId = binding.id
        session.providerId = binding.providerId ?? providerIdOf(linkId)
        core.audit.record({ kind: 'bind', peer: linkId, cap: CAPS.modelsProvide, ok: true, detail: session.providerId })
      }
      core.events.publish({ type: 'interconnect/peers', at: now, data: { linkId, tools: session.tools, providerId: session.providerId ?? null } })
      log('peer ' + linkId + ' (' + name + ') bound at ' + origin + ': ' + String(session.tools.length) + ' tool(s)' + (models ? ', 1 model channel' : ''))
      return rowOf(session)
    } catch (error) {
      releaseSession(session)
      sessions.delete(linkId)
      try {
        core.grants.revoke(linkId)
        core.peers.remove(linkId)
      } catch (cleanupError) {
        log('rolling back peer ' + linkId + ' failed: ' + describeError(cleanupError))
      }
      core.audit.record({ kind: 'error', peer: linkId, ok: false, code: error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : ERROR_CODES.internal, detail: describeError(error).slice(0, 200) })
      throw error
    }
  }

  /**
   * Remove one peer: unregister its tools, release its provider, revoke its grant.
   * @param linkId - the peer's immutable id.
   * @returns whether something was removed.
   */
  const removePeer = (linkId: string): { removed: boolean } => {
    const session = sessions.get(String(linkId))
    if (session === undefined) return { removed: false }
    releaseSession(session)
    sessions.delete(session.linkId)
    core.grants.revoke(session.linkId)
    core.peers.remove(session.linkId)
    core.audit.record({ kind: 'revoke', peer: session.linkId, ok: true, detail: 'peer removed from ' + session.origin })
    core.events.publish({ type: 'interconnect/peers', at: new Date().toISOString(), data: { linkId: session.linkId, removed: true } })
    log('peer ' + session.linkId + ' removed')
    return { removed: true }
  }

  const route: RouteSpec = table.anyExact(PEERS_ROUTE, async (req, res) => {
    if (req.method === 'GET') {
      const rows = []
      for (const session of sessions.values()) {
        const row = rowOf(session)
        if (row.providerId !== undefined) row.models = await modelsOf(row.providerId)
        rows.push(row)
      }
      io.sendJson(res, 200, { ok: true, result: rows })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST')
      io.sendError(res, 405, ERROR_CODES.methodNotAllowed, 'peers are read with GET and written with POST')
      return
    }
    const body = await io.readJson(req)
    const op = String(body.op ?? 'add')
    if (op === 'add') {
      io.sendJson(res, 200, { ok: true, result: await addPeer({ url: String(body.url ?? '') }) })
      return
    }
    if (op === 'remove') {
      io.sendJson(res, 200, { ok: true, result: removePeer(String(body.id ?? '')) })
      return
    }
    io.sendError(res, 400, ERROR_CODES.badRequest, 'unknown peers op ' + op)
  })

  return {
    routes: () => [route],
    start(): void {
      // A peer's bearer token is memory-only, so a persisted active row cannot be served after a
      // restart: say so instead of drawing a peer that would refuse every call.
      const now = new Date().toISOString()
      for (const record of core.peers.list()) {
        if (record.status !== 'active') continue
        core.peers.update(record.linkId, { status: 'rejoin-required' })
        core.audit.record({ kind: 'error', peer: record.linkId, ok: false, code: 'link/consent-required', detail: 'peer session token is memory-only; re-add after restart' })
        log('peer ' + record.linkId + ' restored as rejoin-required (its bearer token is memory-only)')
        void now
      }
    },
    stop(): void {
      for (const session of [...sessions.values()]) releaseSession(session)
      sessions.clear()
    },
    list,
    addPeer,
    removePeer,
  }
}
