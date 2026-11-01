/**
 * link-interconnect/1 - the frozen contract every module in this package is written against.
 *
 * ## Ownership map (do not write outside your own column)
 *
 *   protocol core   src/protocol/{types,errors,contract,handshake,invoke,events}.ts
 *                   src/identity/{store,tokens}.ts  src/registry/{peers,grants,consent}.ts
 *                   src/http/{io,routes,client,ratelimit}.ts   -> createProtocolServer()
 *   adapters        src/adapters/{probe,runtime}.ts  src/bind/{models,tools}.ts
 *                   adapters/<id>/adapter.json                 -> createAdapterRuntime()
 *   shellsdk        src-tauri/src/core/proxy.rs (/link/* forwarding)
 *                   packages/link-interconnect-sdk/**          (peer side of this protocol)
 *   clientui        src/client/** (consent card, peers/settings) -> polls /api/dsh-link-interconnect/state
 *   lead            src/index.ts (the only file that imports @deepseek-ai/cordis), package.json,
 *                   cordis.patch.yml, plugins/build.mjs, profile install, build/restart/readings, commits
 *
 * ## Two rules the build gate enforces
 *
 * 1. Cordis-free: only src/index.ts may import '@deepseek-ai/cordis' (or any @deepseek-ai
 *    package). Everything below it is plain ESM so it can be unit-tested with tsx and imported by
 *    the SDK. The gate is scripts/link-interconnect-parse-check.mjs.
 * 2. Declaration before credential: the adapter lifecycle is probe -> identify -> consent ->
 *    THEN read the credential -> verify -> bind. No module reads a peer credential before
 *    core.consent.request() resolved 'granted', and no credential ever enters a manifest, a log
 *    line, an audit record or a snapshot.
 */

/** The protocol id. A peer whose major differs is refused with link/version-unsupported. */
export const PROTOCOL_ID = 'link-interconnect/1'
/** The contract document version served at GET /link/v1/contract. Bumped when a field changes meaning. */
export const CONTRACT_VERSION = '1.0.0'
/** The major a peer must speak. Unknown minors are ignored, not refused. */
export const PROTOCOL_MAJOR = 1
/** The minor this build implements. */
export const PROTOCOL_MINOR = 0

/** The software-facing prefix the shell forwards to the kernel (src-tauri/src/core/proxy.rs). */
export const LINK_PREFIX = '/link/v1'
/** The in-app prefix: cookie-gated /api forwarding, used by our own client half only. */
export const API_PREFIX = '/api/dsh-link-interconnect'
/** Directory name under $DSH_HOME. */
export const DATA_DIR_NAME = 'link-interconnect'

/** The one route table. Handlers and the SDK read these constants; nothing spells a path twice. */
export const ROUTES = Object.freeze({
  // software-facing, forwarded by the shell from /link/*
  contract: LINK_PREFIX + '/contract',
  handshake: LINK_PREFIX + '/handshake',
  handshakeConfirm: LINK_PREFIX + '/handshake/confirm',
  invoke: LINK_PREFIX + '/invoke',
  events: LINK_PREFIX + '/events',
  embedToken: LINK_PREFIX + '/embed/token',
  embedSession: LINK_PREFIX + '/embed/session',
  openaiPrefix: LINK_PREFIX + '/openai',
  anthropicPrefix: LINK_PREFIX + '/anthropic',
  // LINK's own declaration, so software can discover LINK by the same channel (the shell's static
  // catch-all forwards this GET to the kernel; no /link forwarding needed for it).
  wellKnown: '/.well-known/link-interconnect.json',
  // in-app (the client half polls these; all cookie-gated /api paths)
  state: API_PREFIX + '/state',
  consent: API_PREFIX + '/consent',
  adapters: API_PREFIX + '/adapters',
  audit: API_PREFIX + '/audit',
  settings: API_PREFIX + '/settings',
})

/** Scopes a peer may be granted. deny-by-default: a capability needs its scope in the grant intersection. */
export const SCOPES = Object.freeze([
  'models.provide',
  'models.proxy',
  'tools.expose',
  'embed.session',
  'consent.manage',
  'audit.read',
])

/** The four capability kinds of protocol v1. */
export const CAPS = Object.freeze({
  modelsProvide: 'models.provide',
  toolsExpose: 'tools.expose',
  sessionEmbed: 'session.embed',
  modelsProxy: 'models.proxy',
})

/**
 * Stable machine error codes. The code never changes with the sentence beside it.
 * Served as {ok:false,error:{code,message}} on /link/v1/invoke and named in /link/v1/contract.
 */
export const ERROR_CODES = Object.freeze({
  unauthorized: 'link/unauthorized',
  scopeMissing: 'link/scope-missing',
  versionUnsupported: 'link/version-unsupported',
  consentRequired: 'link/consent-required',
  peerUnavailable: 'link/peer-unavailable',
  rateLimited: 'link/rate-limited',
  payloadTooLarge: 'link/payload-too-large',
  idempotencyConflict: 'link/idempotency-conflict',
  badRequest: 'link/bad-request',
  notFound: 'link/not-found',
  internal: 'link/internal',
  methodNotAllowed: 'link/method-not-allowed',
})

/** One of the stable codes above. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Protocol limits. Served in the contract; enforced where the complete value is known. */
export const LIMITS = Object.freeze({
  /** Largest request body any /link/v1 route reads, in bytes. */
  bodyBytes: 1024 * 1024,
  /** Largest event backlog / SSE replay window, in events. */
  eventBacklog: 200,
  /** Idempotency records live this long, in ms. */
  idempotencyMs: 10 * 60 * 1000,
  /** access token lifetime, ms. */
  accessTokenMs: 15 * 60 * 1000,
  /** refresh token lifetime, ms. */
  refreshTokenMs: 30 * 24 * 60 * 60 * 1000,
  /** embed token lifetime, ms (aud = origin). */
  embedTokenMs: 10 * 60 * 1000,
  /** Default requests-per-minute cap for an adapter/peer when the declaration names none. */
  rpm: 60,
  /** Default upstream timeout for one adapter request, ms. */
  timeoutMs: 15_000,
  /** Health check period and consecutive failures before unavailable. */
  healthMs: 60_000,
  healthFailures: 3,
})

/** The minimal node:http request facade a handler sees (structural, so tests can fake it). */
export interface HttpRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  on(event: 'data' | 'end' | 'error' | 'close', listener: (chunk?: any) => void): unknown
  [key: string]: any
}

/** The minimal node:http response facade a handler sees. */
export interface HttpResponse {
  statusCode: number
  setHeader(name: string, value: string | number | readonly string[]): unknown
  write(chunk: any): unknown
  end(body?: any): unknown
  on?(event: 'close' | 'error', listener: () => void): unknown
  [key: string]: any
}

/** One handler, ordinary node:http style. */
export type RouteHandler = (req: HttpRequest, res: HttpResponse) => void | Promise<void>

/** What the kernel web server's register() accepts (same form dsh-link-teams uses). */
export interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: RouteHandler
}

/** A mountable part of the plugin: routes plus an optional lifecycle. index.ts registers each route. */
export interface Subsystem {
  routes(): RouteSpec[]
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
}

/** Bytes-in / JSON-out helpers every module shares (src/http/io.ts). */
export interface HttpIo {
  /** Read the whole request body up to LIMITS.bodyBytes; rejects with link/payload-too-large. */
  readJson(req: HttpRequest): Promise<Record<string, any>>
  /** Read raw bytes up to one limit. */
  readBody(req: HttpRequest, limit?: number): Promise<Buffer>
  /** Answer one JSON document with no-store and the given status. */
  sendJson(res: HttpResponse, status: number, body: unknown, headers?: Record<string, string>): void
  /** Answer a named refusal in the protocol's own envelope. */
  sendError(res: HttpResponse, status: number, code: ErrorCode, message: string): void
  /** Parse the request URL (path + query) without trusting the Host header. */
  parseUrl(req: HttpRequest): { path: string; query: URLSearchParams }
  /** Required-method guard: answers 405 with link/method-not-allowed and returns false. */
  requireMethod(req: HttpRequest, res: HttpResponse, method: string): boolean
}

/** A validated bearer token's claims. */
export interface TokenClaims {
  sub: string
  aud: string
  scope: string[]
  iat: number
  exp: number
  jti: string
}

/** One token verification outcome. */
export type TokenVerdict =
  | { ok: true; claims: TokenClaims }
  | { ok: false; code: ErrorCode; message: string }

/** Instance identity: one Ed25519 keypair, linkId derived from the public key and never from a name. */
export interface IdentityService {
  readonly linkId: string
  /** base64url raw public key. */
  readonly publicKey: string
  /** base64url Ed25519 signature over the UTF-8 payload. */
  sign(payload: string): string
  /** Verify with any peer's base64url public key. */
  verify(payload: string, signature: string, publicKey: string): boolean
}

/** Compact JWS (EdDSA) tokens: access, refresh, embed (aud=origin). */
export interface TokenService {
  /** Mint one compact JWS. jti is generated here and returned with the token. */
  mint(claims: { sub: string; aud: string; scope: string[]; ttlMs: number }): { token: string; jti: string; expiresAt: string }
  /**
   * Verify signature, exp, audience and (when asked) one scope. A non-string token is a
   * `link/unauthorized` verdict, not a throw: the implementation checks the type first.
   */
  verify(token: string | undefined, options?: { aud?: string; scope?: string }): TokenVerdict
  /** Revoke one jti immediately (the blacklist is persisted). */
  revoke(jti: string): void
  isRevoked(jti: string): boolean
}

/** The lifecycle state of one peer. 'pending' exists only between handshake and confirm. */
export type PeerStatus = 'pending' | 'active' | 'unavailable' | 'rejoin-required' | 'revoked'

/** One peer the person allowed. The linkId is immutable; the name is a human alias. */
export interface PeerRecord {
  linkId: string
  name: string
  vendor?: string | undefined
  platform?: string | undefined
  /** base64url public key, from the handshake. */
  pub: string
  scopes: string[]
  status: PeerStatus
  transport: 'loopback' | 'lan'
  baseUrl?: string | undefined
  createdAt: string
  updatedAt: string
  lastSeenAt?: string | undefined
}

/** Persistent peer registry (peers.json under the data dir). */
export interface PeerStore {
  get(linkId: string): PeerRecord | undefined
  list(): PeerRecord[]
  upsert(record: PeerRecord): PeerRecord
  update(linkId: string, patch: Partial<PeerRecord>): PeerRecord | undefined
  remove(linkId: string): boolean
}

/** What one peer may do. The effective permission is the intersection of both sides' grants. */
export interface Grant {
  peerLinkId: string
  scopes: string[]
  rpm?: number
  grantedAt: string
  grantedBy: 'user'
}

/** Persistent grant registry (grants.json). */
export interface GrantStore {
  get(peerLinkId: string): Grant | undefined
  list(): Grant[]
  grant(grant: Grant): Grant
  revoke(peerLinkId: string): boolean
  has(peerLinkId: string, scope: string): boolean
}

/** One consent question waiting for the person. It carries display facts only, never credentials. */
export interface ConsentRequest {
  id: string
  peerLinkId: string
  peerName: string
  /** One line the card shows, e.g. "接入 Our Free Model 作为模型供应商". */
  title: string
  /** Capability kind that motivated the question. */
  capability: string
  scopes: string[]
  /** Extra display rows (label -> value). Never a credential. */
  detail?: Record<string, string> | undefined
  risk: 'low' | 'medium' | 'high'
  createdAt: string
}

/** The gate between detection and any credential read. */
export interface ConsentService {
  /** Publish a question; resolves when the person decides, or 'denied' when never answered. */
  request(input: Omit<ConsentRequest, 'id' | 'createdAt'>): Promise<'granted' | 'denied'>
  listPending(): ConsentRequest[]
  /** The client half calls this with the person's answer. Unknown id -> false. */
  decide(id: string, decision: 'granted' | 'denied'): boolean
  /** Wait for one pending question; 'timeout' when it was never answered. */
  awaitDecision(id: string, timeoutMs?: number): Promise<'granted' | 'denied' | 'timeout'>
}

/** One fact the client half redraws on, published by every subsystem. */
export interface CoreEvent {
  type: string
  at: string
  /** Present only when the publisher carried a payload; the hub writes `undefined` explicitly. */
  data?: Record<string, any> | undefined
}

/** In-process pub/sub between subsystems (adapter runtime -> bindings -> client snapshot). */
export interface EventHub {
  publish(event: CoreEvent): void
  subscribe(listener: (event: CoreEvent) => void): () => void
  recent(limit?: number): CoreEvent[]
}

/** What one audited action was. */
export type AuditKind = 'consent' | 'invoke' | 'revoke' | 'bind' | 'unbind' | 'probe' | 'handshake' | 'error'

/** One audit record. Codes and durations only: never arguments, never credentials. */
export interface AuditRecord {
  at: string
  kind: AuditKind
  peer?: string
  adapter?: string
  cap?: string
  op?: string
  ok: boolean
  code?: ErrorCode | string
  ms?: number
  detail?: string
}

/** Append-only audit (audit.jsonl). */
export interface AuditSink {
  record(record: Omit<AuditRecord, 'at'>): void
  list(limit?: number): AuditRecord[]
}

/** The one object every subsystem is handed. Built by createProtocolServer(), owned by index.ts. */
export interface InterconnectCore {
  readonly protocol: string
  /** Absolute data directory (created on start). */
  readonly dir: string
  readonly identity: IdentityService
  readonly tokens: TokenService
  readonly peers: PeerStore
  readonly grants: GrantStore
  readonly consent: ConsentService
  readonly events: EventHub
  readonly audit: AuditSink
  /** One line into the plugin's log, already prefixed. */
  log(line: string): void
}

/** Options createProtocolServer() takes from index.ts. */
export interface ProtocolOptions {
  /** $DSH_HOME (the kernel home). The data dir is <home>/link-interconnect. */
  home: string
  /** Absolute data-directory override; wins over <home>/link-interconnect when present. */
  dataDir?: string
  /** One already-prefixed log function. */
  log(line: string): void
}

/** What createProtocolServer() answers. index.ts registers every route and forwards control. */
export interface ProtocolServer extends Subsystem {
  readonly core: InterconnectCore
  /** the shared HTTP helpers (other subsystems use them, so handlers stay one style). */
  readonly io: HttpIo
}

// ---------------------------------------------------------------------------------------------
// Declarative adapters (LINK adapts software)
// ---------------------------------------------------------------------------------------------

/** One probe: a file whose JSON field names the port (OFM: ~/.our-free-model/service.lock). */
export interface AdapterFileProbe {
  /** Expands ~ and env vars. Missing file is a normal not-installed reading, not an error. */
  path: string
  /** Dot path inside a JSON file, e.g. "port". Omit when the file itself is the value. */
  jsonPath?: string
  /** Variable name later probes/connect steps interpolate as {name}. */
  as: string
}

/** How the probe proves the service is the one the declaration names. */
export interface AdapterIdentityProbe {
  method: 'GET' | 'HEAD'
  /** {port} and other {vars} interpolate from earlier probes. */
  url: string
  /** Body must contain this substring (OFM: "our-free-model"). */
  contains?: string
  /** JSON dot path whose value must equal the given value. */
  jsonPath?: string
  equals?: string
  expectStatus?: number
}

/** Where the credential lives. Read ONLY after consent, never copied out of its directory. */
export type AdapterCredential =
  | { kind: 'file-json'; path: string; jsonPath: string }
  | { kind: 'env'; name: string }
  | { kind: 'none' }

/** One verification request made after the credential is read and before the binding is written. */
export interface AdapterVerifyStep {
  method: 'GET' | 'HEAD'
  path: string
  expectStatus?: number
  /** Attach the credential as Authorization: Bearer. */
  auth?: 'bearer'
}

/** One capability a declaration asks for; asOf carries the ids the binding will use. */
export interface AdapterCapabilityDecl {
  kind: string
  version: number
  /** 'openai' for an OpenAI-compatible surface; carried into the contract for a reader. */
  from?: string
  as?: Record<string, string>
  /** tools.expose only */
  tools?: ToolDeclaration[]
}

/** adapter.json - everything a new integration needs, in data. */
export interface AdapterDeclaration {
  id: string
  name: string
  vendor?: string
  match: {
    files?: AdapterFileProbe[]
    env?: string[]
    identity?: AdapterIdentityProbe
  }
  connect: {
    baseUrl: string
    credential?: AdapterCredential
    verify?: AdapterVerifyStep[]
  }
  capabilities: AdapterCapabilityDecl[]
  consent: { title: string; scopes: string[] }
  limits?: { rpm?: number; timeoutMs?: number }
}

/** Why a probe said no. Every reason is a stable code so the card can be honest. */
export type ProbeReasonCode =
  | 'not-installed'
  | 'no-service'
  | 'not-running'
  | 'foreign-service'
  | 'unsupported-version'
  | 'probe-failed'

/** One probe reading. detected:false carries a reason and never triggers a consent card. */
export interface ProbeResult {
  adapterId: string
  detected: boolean
  reasonCode?: ProbeReasonCode
  reason?: string
  /** Set when the probe resolved a base URL; a not-installed reading carries none. */
  baseUrl?: string | undefined
  detail?: Record<string, string>
  at: string
}

/** The state of one binding. active is the only state a capability may serve from. */
export type BindingStatus = 'active' | 'unavailable' | 'rejoin-required' | 'revoked'

/** One bound capability set from one adapter or peer. */
export interface BindingState {
  id: string
  adapterId: string
  peerLinkId?: string
  caps: string[]
  status: BindingStatus
  boundAt: string
  updatedAt: string
  lastCheckAt?: string
  failures: number
  providerId?: string | undefined
  toolNames?: string[] | undefined
  baseUrl?: string
}

/** The pane's per-adapter row. */
export interface AdapterStatus {
  id: string
  name: string
  vendor?: string
  detected: boolean
  reasonCode?: ProbeReasonCode
  reason?: string
  binding?: BindingState
}

/** Hosts createAdapterRuntime() needs: cordis-backed abilities index.ts injects. */
export interface BindHosts {
  /** ctx.get('llm') at call time. */
  llm?: () => any
  /** ctx.get('tools') at call time. */
  tools?: () => any
}

/** What createAdapterRuntime() answers. */
export interface AdapterRuntime extends Subsystem {
  /** Probe every declaration now. */
  probeAll(): Promise<ProbeResult[]>
  /** One adapter's last probe. */
  probe(adapterId: string): ProbeResult | undefined
  /** The whole pipeline for one adapter; refuses by name on any failure (rollback, no half config). */
  connect(adapterId: string, options?: { onConsent?: (request: ConsentRequest) => void }): Promise<BindingState>
  /** Remove a binding and dispose its capability registrations. */
  disconnect(adapterId: string): Promise<void>
  /** Every binding, live. */
  bindings(): BindingState[]
  /** Per-adapter rows for the pane. */
  adapters(): AdapterStatus[]
}

/** Options createAdapterRuntime() takes. */
export interface AdapterRuntimeOptions {
  core: InterconnectCore
  /** Directory holding <id>/adapter.json declarations. */
  adaptersDir: string
  hosts: BindHosts
  log(line: string): void
}

/** One tool a software peer declares. */
export interface ToolDeclaration {
  name: string
  description: string
  parameters: Record<string, any>
  call?: { cap: string; op: string }
}

/** One capability a peer declares in its manifest. */
export interface CapabilityDeclaration {
  kind: string
  version: number
  auth: 'bearer' | 'none'
  scopes?: string[]
  tools?: ToolDeclaration[]
  models?: { path?: string }
}

/** GET /.well-known/link-interconnect.json - a software peer's own declaration. */
export interface PeerManifest {
  protocol: string
  identity: { linkId: string; name: string; vendor?: string }
  endpoints: { invoke?: string; events?: string; models?: string }
  capabilities: CapabilityDeclaration[]
  limits?: { rpm?: number; bodyBytes?: number }
}

// ---------------------------------------------------------------------------------------------
// The one snapshot the client half draws
// ---------------------------------------------------------------------------------------------

/** Everything the consent card and the peers surface need, in one polled document. */
export interface PluginSnapshot {
  protocol: string
  contractVersion: string
  linkId: string
  at: string
  peers: PeerRecord[]
  grants: Grant[]
  pendingConsent: ConsentRequest[]
  bindings: BindingState[]
  adapters: AdapterStatus[]
  audit: AuditRecord[]
  counts: {
    peers: number
    activePeers: number
    bindings: number
    activeBindings: number
    pendingConsent: number
  }
}

/** The snapshot producer index.ts hands to createClientRoutes(). */
export type SnapshotProvider = () => PluginSnapshot

// ---------------------------------------------------------------------------------------------
// Factory names + module paths (index.ts imports exactly these)
// ---------------------------------------------------------------------------------------------
/*
 *   './protocol/server.ts'   export function createProtocolServer(options: ProtocolOptions): Promise<ProtocolServer>
 *   './http/client.ts'       export function createClientRoutes(options: { core; snapshot: SnapshotProvider; log }): Subsystem
 *   './adapters/runtime.ts'  export function createAdapterRuntime(options: AdapterRuntimeOptions): Promise<AdapterRuntime>
 *   './bind/models.ts'       export function bindModels(options: { core; runtime; hosts; log }): () => void
 *   './bind/tools.ts'        export function bindTools(options: { core; runtime; hosts; log }): () => void
 *   './bind/embed.ts'        export function createEmbedSubsystem(options: { core; io; log }): Subsystem            // M4
 *   './bind/proxy.ts'        export function createProxySubsystem(options: { core; io; hosts; log }): Subsystem     // M5
 */
export const FACTORY_CONTRACT = 'see the comment block above - index.ts imports exactly these names'
