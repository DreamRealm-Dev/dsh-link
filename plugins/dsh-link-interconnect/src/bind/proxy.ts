/**
 * models.proxy - LINK's reverse model surface: a software peer calls LINK, LINK calls a provider.
 *
 * The frozen contract describes it as POST/GET on /link/v1/openai/v1/* and /link/v1/anthropic/v1/*
 * with a bearer key of the form lk_<32+ characters>. This module is the whole key lifecycle plus
 * the forwarding routes:
 *
 *   POST /link/v1/openai/v1/chat/completions   OpenAI chat completion, forwarded to upstream.openai
 *   POST /link/v1/anthropic/v1/messages        Anthropic messages, forwarded to upstream.anthropic
 *   GET  /link/v1/openai/v1/models             the key's model whitelist (or upstream.listModels)
 *   GET  /link/v1/anthropic/v1/models          the same list under the Anthropic prefix
 *
 * The caller's bearer key is an access credential this plugin minted. Only sha256(key) is ever
 * written: <core.dir>/proxy-keys.json holds {id, label, models, rpm, createdAt, revokedAt?} plus
 * keySha256, never the key itself. The raw key is returned exactly once by createProxyKey() and is
 * never logged, audited, echoed in a response or forwarded upstream; audit records name the key id.
 *
 * The upstream is injected by index.ts (cordis-free module): upstream.openai(body, {model, key})
 * and upstream.anthropic(...) answer {status, headers, body} where body may be a string, a Buffer,
 * a node Readable (streamed through) or a plain JSON value; upstream.listModels is optional.
 * Tests pass a fake upstream; the real one is wired by the Lead.
 *
 * The auth/refusal matrix is stable: missing, malformed, unknown or revoked key -> 401
 * link/unauthorized; model outside the key whitelist -> 403 link/scope-missing; over the key's rpm
 * -> 429 link/rate-limited with Retry-After; over LIMITS.bodyBytes -> 413 link/payload-too-large;
 * an upstream failure -> 503 link/peer-unavailable.
 *
 * Cordis-free: node built-ins, the frozen types, the shared http helpers and the key store seam.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRateLimiter } from '../http/ratelimit.ts'
import { createRouteTable } from '../http/routes.ts'
import { bearerToken } from '../identity/tokens.ts'
import { asLinkError, refuse } from '../protocol/errors.ts'
import { CAPS, LIMITS, ROUTES } from '../protocol/types.ts'
import type { AuditRecord, HttpIo, HttpRequest, HttpResponse, InterconnectCore, Subsystem } from '../protocol/types.ts'

/** The file the key ledger lives in, under the data directory. */
const KEYS_FILE = 'proxy-keys.json'
/** Every proxy key starts with these two characters. */
const KEY_PREFIX = 'lk_'
/** lk_ plus at least 32 URL-safe characters; the generated key carries 43. */
const KEY_PATTERN = /^lk_[A-Za-z0-9_-]{32,}$/
/** 32 random bytes -> 43 base64url characters. */
const KEY_BYTES = 32
const LABEL_MAX = 120
const MODEL_MAX = 200
const MODELS_MAX = 64
const RPM_MAX = 60000
/** One key the admin surface asks for. */
export interface ProxyKeyInput {
  /** Human label for the auditing surface. */
  label: string
  /** The only model ids this key may call; at least one. */
  models: string[]
  /** Requests per minute for this key; defaults to LIMITS.rpm. */
  rpm?: number | undefined
}

/** What createProxyKey() answers: the key id and the raw key - the one and only time it is visible. */
export interface ProxyKeyCreated {
  id: string
  key: string
}

/** The public view of one key; never carries the hash or the raw key. */
export interface ProxyKeyView {
  id: string
  label: string
  models: string[]
  rpm: number
  createdAt: string
  revokedAt?: string
}

/** The persisted record: the public view plus the only stored form of the secret. */
interface ProxyKeyRecord extends ProxyKeyView {
  /** hex sha256 of the complete bearer key (prefix included). */
  keySha256: string
}

/** One authentication lookup answer. */
export interface ProxyKeyLookup {
  record: ProxyKeyView
  revoked: boolean
}

/** The persistent key ledger. The exported createProxyKey()/revokeProxyKey() functions delegate here. */
export interface ProxyKeyStore {
  /** Absolute path of proxy-keys.json. */
  readonly file: string
  /** Mint one key; the raw key is in the answer and never stored or logged. */
  create(input: ProxyKeyInput): ProxyKeyCreated
  /** Revoke one key id; idempotent. Returns false for an unknown id. */
  revoke(id: string): boolean
  /** Every key as a public view (no hash, no raw key), oldest first. */
  list(): ProxyKeyView[]
  /** Resolve one presented bearer string to its record, without ever exposing the hash. */
  resolve(presented: string): ProxyKeyLookup | undefined
}

/** One upstream answer: the wire status, pass-through headers and body. */
export interface ProxyUpstreamAnswer {
  /** HTTP status the caller receives. */
  status: number
  /** Response headers to pass through; only content-type and x-* survive (no set-cookie). */
  headers?: Record<string, string>
  /** A string, a Buffer, a node Readable (streamed) or a plain JSON value. */
  body?: unknown
}

/** What the proxy tells the injected upstream about one call. */
export interface ProxyUpstreamContext {
  /** The model id the caller asked for (already whitelisted). */
  model: string
  /** The proxy key id - an audit fact, never the raw key. */
  key: string
  /** Aborted when the call crosses LIMITS.timeoutMs. */
  signal?: AbortSignal
}

/** The upstream index.ts injects; tests pass a fake. Exactly one of openai/anthropic is enough. */
export interface ProxyUpstream {
  /** Forward one OpenAI-shaped completion body. */
  openai?(body: Record<string, any>, context: ProxyUpstreamContext): Promise<ProxyUpstreamAnswer>
  /** Forward one Anthropic-shaped messages body. */
  anthropic?(body: Record<string, any>, context: ProxyUpstreamContext): Promise<ProxyUpstreamAnswer>
  /** Optional model list source; without it the key whitelist is rendered as an OpenAI list. */
  listModels?(context: { key: string; signal?: AbortSignal }): Promise<ProxyUpstreamAnswer>
}

/** Where the ledger is built. */
export interface ProxyKeyStoreOptions {
  /** The data directory (core.dir). */
  dir: string
  /** One log line sink; never receives the raw key. */
  log?(line: string): void
  /** Optional audit sink (core.audit); records the key id only. */
  audit?: { record(record: Omit<AuditRecord, 'at'>): void }
}

/** Options createProxySubsystem() takes. */
export interface ProxySubsystemOptions {
  core: InterconnectCore
  io: HttpIo
  log(line: string): void
  /** The provider bridge index.ts injects; a fake in tests. */
  upstream: ProxyUpstream
}

/** The mounted subsystem plus the key lifecycle index.ts uses for admin wiring. */
export interface ProxySubsystem extends Subsystem {
  /** The same ledger the exported createProxyKey()/revokeProxyKey() address. */
  readonly keys: ProxyKeyStore
  /** Mint one key (delegates to the ledger). */
  createKey(input: ProxyKeyInput): ProxyKeyCreated
  /** Revoke one key id (delegates to the ledger). */
  revokeKey(id: string): boolean
  /** Every key as a public view. */
  listKeys(): ProxyKeyView[]
}

/** The ledger of the most recently created proxy subsystem; index.ts composes exactly one. */
let activeStore: ProxyKeyStore | undefined

/**
 * hex sha256 of one complete key string.
 * @param key - the presented or freshly minted bearer key.
 * @returns the hash stored in proxy-keys.json.
 */
function sha256(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/**
 * Copy one record's public fields; the hash never leaves the ledger.
 * @param record - the stored record.
 * @returns a public view.
 */
function viewOf(record: ProxyKeyRecord): ProxyKeyView {
  const view: ProxyKeyView = { id: record.id, label: record.label, models: [...record.models], rpm: record.rpm, createdAt: record.createdAt }
  if (record.revokedAt !== undefined) view.revokedAt = record.revokedAt
  return view
}

/**
 * Validate and normalize what the admin surface asked to mint.
 * @param input - {label, models, rpm?}.
 * @returns the normalized fields.
 * @throws TypeError naming the first invalid field (the admin route turns it into a 400).
 */
function readKeyInput(input: ProxyKeyInput): { label: string; models: string[]; rpm: number } {
  if (input === null || typeof input !== 'object') throw new TypeError('createProxyKey needs {label, models, rpm?}')
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (label === '' || label.length > LABEL_MAX) throw new TypeError('proxy key label must be 1-' + String(LABEL_MAX) + ' characters')
  if (!Array.isArray(input.models) || input.models.length === 0) throw new TypeError('proxy key models must be a non-empty array of model ids')
  if (input.models.length > MODELS_MAX) throw new TypeError('proxy key models holds at most ' + String(MODELS_MAX) + ' ids')
  const models: string[] = []
  for (const value of input.models) {
    const model = typeof value === 'string' ? value.trim() : ''
    if (model === '' || model.length > MODEL_MAX) throw new TypeError('proxy key model ids must be 1-' + String(MODEL_MAX) + ' characters')
    if (!models.includes(model)) models.push(model)
  }
  if (models.length === 0) throw new TypeError('proxy key models must name at least one model id')
  const rpm = input.rpm === undefined ? LIMITS.rpm : Math.floor(input.rpm)
  if (!Number.isFinite(rpm) || rpm <= 0 || rpm > RPM_MAX) throw new TypeError('proxy key rpm must be an integer between 1 and ' + String(RPM_MAX))
  return { label, models, rpm }
}

/**
 * Load the persisted key ledger, skipping records that do not carry a usable hash.
 * @param file - absolute path of proxy-keys.json.
 * @param log - one log line sink.
 * @returns the parsed records.
 */
function loadKeys(file: string, log: (line: string) => void): ProxyKeyRecord[] {
  if (!existsSync(file)) return []
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { keys?: unknown }
    if (!Array.isArray(stored.keys)) return []
    const records: ProxyKeyRecord[] = []
    for (const entry of stored.keys as Partial<ProxyKeyRecord>[]) {
      if (typeof entry?.id !== 'string' || typeof entry?.keySha256 !== 'string') continue
      if (!/^[a-f0-9]{64}$/.test(entry.keySha256)) continue
      if (typeof entry.label !== 'string' || !Array.isArray(entry.models) || !entry.models.every((model) => typeof model === 'string')) continue
      if (!Number.isFinite(entry.rpm) || typeof entry.createdAt !== 'string') continue
      const record: ProxyKeyRecord = { id: entry.id, label: entry.label, models: [...entry.models], rpm: entry.rpm as number, createdAt: entry.createdAt, keySha256: entry.keySha256 }
      if (typeof entry.revokedAt === 'string') record.revokedAt = entry.revokedAt
      records.push(record)
    }
    log('proxy key ledger restored: ' + String(records.length) + ' key(s)')
    return records
  } catch (error) {
    log('proxy key ledger is unreadable (' + String(error instanceof Error ? error.message : String(error)) + '); starting empty')
    return []
  }
}

/**
 * Build one persistent proxy key ledger. The exported module functions delegate to the ledger of
 * the most recently created proxy subsystem; tests and index.ts can also use the handle methods.
 *
 * @param options - the data directory, one log sink and an optional audit sink.
 * @returns the ledger.
 */
export function createProxyKeyStore(options: ProxyKeyStoreOptions): ProxyKeyStore {
  mkdirSync(options.dir, { recursive: true })
  const log = options.log ?? (() => {})
  const audit = options.audit
  const file = join(options.dir, KEYS_FILE)
  const records = loadKeys(file, log)
  const byId = new Map<string, ProxyKeyRecord>()
  const byHash = new Map<string, ProxyKeyRecord>()
  const index = (record: ProxyKeyRecord): void => {
    byId.set(record.id, record)
    byHash.set(record.keySha256, record)
  }
  for (const record of records) index(record)

  const persist = (): void => {
    const temp = file + '.' + String(process.pid) + '.tmp'
    writeFileSync(temp, JSON.stringify({ version: 1, keys: records }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, file)
  }
  const note = (record: Omit<AuditRecord, 'at'>): void => {
    if (audit === undefined) return
    audit.record(record)
  }

  return {
    file,
    create(input): ProxyKeyCreated {
      const normalized = readKeyInput(input)
      const id = 'pk_' + randomBytes(9).toString('base64url')
      const key = KEY_PREFIX + randomBytes(KEY_BYTES).toString('base64url')
      const record: ProxyKeyRecord = {
        id,
        label: normalized.label,
        models: normalized.models,
        rpm: normalized.rpm,
        createdAt: new Date().toISOString(),
        keySha256: sha256(key),
      }
      records.push(record)
      index(record)
      persist()
      log('proxy key created id=' + id + ' label=' + JSON.stringify(record.label) + ' models=' + String(record.models.length) + ' rpm=' + String(record.rpm))
      note({ kind: 'bind', cap: CAPS.modelsProxy, op: 'proxy.key.create', ok: true, detail: 'proxy key ' + id })
      return { id, key }
    },
    revoke(id): boolean {
      const record = byId.get(id)
      if (record === undefined) return false
      if (record.revokedAt === undefined) {
        record.revokedAt = new Date().toISOString()
        persist()
        log('proxy key revoked id=' + id)
        note({ kind: 'revoke', cap: CAPS.modelsProxy, op: 'proxy.key.revoke', ok: true, detail: 'proxy key ' + id })
      }
      return true
    },
    list(): ProxyKeyView[] {
      return records.map((record) => viewOf(record))
    },
    resolve(presented): ProxyKeyLookup | undefined {
      if (typeof presented !== 'string' || !KEY_PATTERN.test(presented)) return undefined
      const record = byHash.get(sha256(presented))
      if (record === undefined) return undefined
      return { record: viewOf(record), revoked: record.revokedAt !== undefined }
    },
  }
}

/**
 * Mint one proxy key on the ledger of the most recently created proxy subsystem.
 * @param input - {label, models, rpm?}.
 * @returns {id, key}; the raw key is visible here once and never persisted or logged.
 * @throws Error when no proxy subsystem has been created yet.
 */
export function createProxyKey(input: ProxyKeyInput): ProxyKeyCreated {
  if (activeStore === undefined) throw new Error('createProxyKey() needs createProxySubsystem() to have built the key ledger first')
  return activeStore.create(input)
}

/**
 * Revoke one proxy key id on the ledger of the most recently created proxy subsystem.
 * @param id - the key id createProxyKey() returned.
 * @returns true when the id exists, false when it does not.
 * @throws Error when no proxy subsystem has been created yet.
 */
export function revokeProxyKey(id: string): boolean {
  if (activeStore === undefined) throw new Error('revokeProxyKey() needs createProxySubsystem() to have built the key ledger first')
  return activeStore.revoke(id)
}

/**
 * List every proxy key (public views only) on the most recently created subsystem's ledger.
 * @returns the keys, oldest first.
 * @throws Error when no proxy subsystem has been created yet.
 */
export function listProxyKeys(): ProxyKeyView[] {
  if (activeStore === undefined) throw new Error('listProxyKeys() needs createProxySubsystem() to have built the key ledger first')
  return activeStore.list()
}

/**
 * Read one model id out of a proxy request body.
 * @param body - the parsed JSON body.
 * @returns the non-empty model id.
 * @throws LinkError link/bad-request when the body does not name one.
 */
function readModel(body: Record<string, any>): string {
  const value = body.model
  if (typeof value !== 'string' || value.trim() === '') throw refuse('link/bad-request', 'the proxy request body needs a non-empty model field')
  return value.trim()
}

/**
 * Answer one upstream result onto the caller's response.
 * @param res - the response facade.
 * @param answer - the upstream answer.
 * @throws LinkError link/internal when the answer carries no usable status.
 */
function sendAnswer(res: HttpResponse, answer: ProxyUpstreamAnswer): void {
  if (answer === null || typeof answer !== 'object') throw refuse('link/internal', 'the upstream answered no result object')
  const status = answer.status
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw refuse('link/internal', 'the upstream answered an invalid status ' + JSON.stringify(status))
  }
  res.statusCode = status
  let contentType = ''
  for (const [name, value] of Object.entries(answer.headers ?? {})) {
    const lower = name.toLowerCase()
    if (lower === 'content-type') contentType = String(value)
    if (lower === 'content-type' || lower.startsWith('x-') || lower === 'retry-after' || lower === 'content-disposition') {
      res.setHeader(lower, String(value))
    }
  }
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const body = answer.body
  if (body !== null && typeof body === 'object' && typeof (body as { pipe?: unknown }).pipe === 'function') {
    // A provider stream (SSE or a chunked body): hand the socket to it and stop owning the answer.
    ;(body as { pipe(target: HttpResponse): void }).pipe(res)
    return
  }
  if (body === undefined || body === null) {
    res.end()
    return
  }
  if (contentType === '') res.setHeader('content-type', typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8')
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body)
    return
  }
  res.end(JSON.stringify(body))
}

/**
 * Build the models.proxy subsystem: the key ledger plus the four forwarding routes.
 *
 * @param options - core, io, log and the injected upstream.
 * @returns the subsystem plus the key lifecycle for index.ts's admin wiring.
 */
export function createProxySubsystem(options: ProxySubsystemOptions): ProxySubsystem {
  const { core, io, log, upstream } = options
  const store = createProxyKeyStore({ dir: core.dir, log, audit: core.audit })
  activeStore = store
  const table = createRouteTable(io)
  const limiters = new Map<string, ReturnType<typeof createRateLimiter>>()

  /** Read the bearer key and answer the authenticated record, or refuse link/unauthorized. */
  const authenticate = (headers: HttpRequest['headers']): ProxyKeyView => {
    const presented = bearerToken(headers)
    if (presented === undefined) throw refuse('link/unauthorized', 'this proxy route needs Authorization: Bearer lk_<key>')
    if (!KEY_PATTERN.test(presented)) throw refuse('link/unauthorized', 'the presented proxy key is not a lk_ key')
    const found = store.resolve(presented)
    if (found === undefined) throw refuse('link/unauthorized', 'the proxy key is unknown')
    if (found.revoked) throw refuse('link/unauthorized', 'the proxy key was revoked')
    return found.record
  }

  /** Apply the key's own requests-per-minute bucket; a refusal carries Retry-After. */
  const enforceRate = (record: ProxyKeyView, res: HttpResponse): void => {
    let limiter = limiters.get(record.id)
    if (limiter === undefined) {
      limiter = createRateLimiter({ rpm: record.rpm })
      limiters.set(record.id, limiter)
    }
    const decision = limiter.take('model')
    if (decision.ok) return
    const seconds = Math.max(1, Math.ceil((decision.retryAfterMs ?? 1000) / 1000))
    res.setHeader('retry-after', String(seconds))
    throw refuse('link/rate-limited', 'proxy key ' + record.id + ' is over its ' + String(record.rpm) + ' requests per minute; retry after ' + String(seconds) + 's')
  }

  /** One audit record for one proxy attempt: key id and outcome, never the raw key or the body. */
  const auditAttempt = (op: string, ok: boolean, code: string | undefined, ms: number, keyId: string | undefined): void => {
    const record: Omit<AuditRecord, 'at'> = { kind: ok ? 'invoke' : 'error', cap: CAPS.modelsProxy, op, ok, ms }
    if (code !== undefined) record.code = code
    if (keyId !== undefined) record.peer = 'proxy-key:' + keyId
    core.audit.record(record)
  }

  /** Forward one body to the injected upstream, bounded by LIMITS.timeoutMs. */
  const callUpstream = async (kind: 'openai' | 'anthropic', body: Record<string, any>, context: { model: string; key: string }): Promise<ProxyUpstreamAnswer> => {
    const call = kind === 'openai' ? upstream.openai : upstream.anthropic
    if (typeof call !== 'function') throw refuse('link/peer-unavailable', 'no upstream is wired for the ' + kind + ' proxy surface')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('the upstream call exceeded ' + String(LIMITS.timeoutMs) + ' ms')), LIMITS.timeoutMs)
    try {
      return await call.call(upstream, body, { model: context.model, key: context.key, signal: controller.signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'LinkError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw refuse('link/peer-unavailable', 'the upstream ' + kind + ' call failed: ' + message)
    } finally {
      clearTimeout(timer)
    }
  }

  /** The whole matrix for one model call: auth -> body -> model whitelist -> rpm -> upstream. */
  const forward = async (kind: 'openai' | 'anthropic', op: string, req: HttpRequest, res: HttpResponse): Promise<void> => {
    const started = Date.now()
    let keyId: string | undefined
    try {
      const record = authenticate(req.headers)
      keyId = record.id
      const body = await io.readJson(req)
      const model = readModel(body)
      if (!record.models.includes(model)) {
        throw refuse('link/scope-missing', 'model ' + JSON.stringify(model) + ' is not in this proxy key model list')
      }
      enforceRate(record, res)
      const answer = await callUpstream(kind, body, { model, key: record.id })
      sendAnswer(res, answer)
      auditAttempt(op, true, undefined, Date.now() - started, keyId)
      log('proxy ' + op + ' key=' + record.id + ' -> ' + String(answer.status) + ' (' + String(Date.now() - started) + ' ms)')
    } catch (error) {
      const refusal = asLinkError(error)
      auditAttempt(op, false, refusal.code, Date.now() - started, keyId)
      log('proxy ' + op + ' key=' + (keyId ?? 'none') + ' -> ' + String(refusal.status) + ' ' + refusal.code + ' (' + String(Date.now() - started) + ' ms)')
      throw refusal
    }
  }

  /** GET models: the key's whitelist, or upstream.listModels when index.ts injected one. */
  const listModels = async (op: string, req: HttpRequest, res: HttpResponse): Promise<void> => {
    const started = Date.now()
    let keyId: string | undefined
    try {
      const record = authenticate(req.headers)
      keyId = record.id
      let answer: ProxyUpstreamAnswer
      if (typeof upstream.listModels === 'function') {
        try {
          answer = await upstream.listModels({ key: record.id })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw refuse('link/peer-unavailable', 'the upstream model list failed: ' + message)
        }
      } else {
        answer = {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: { object: 'list', data: record.models.map((model) => ({ id: model, object: 'model', created: 0, owned_by: 'dsh-link' })) },
        }
      }
      sendAnswer(res, answer)
      auditAttempt(op, true, undefined, Date.now() - started, keyId)
      log('proxy ' + op + ' key=' + record.id + ' -> ' + String(answer.status) + ' (' + String(Date.now() - started) + ' ms)')
    } catch (error) {
      const refusal = asLinkError(error)
      auditAttempt(op, false, refusal.code, Date.now() - started, keyId)
      log('proxy ' + op + ' key=' + (keyId ?? 'none') + ' -> ' + String(refusal.status) + ' ' + refusal.code + ' (' + String(Date.now() - started) + ' ms)')
      throw refusal
    }
  }

  const routes = [
    table.exact('POST', ROUTES.openaiPrefix + '/v1/chat/completions', (req, res) => forward('openai', 'openai/chat.completions', req, res)),
    table.exact('GET', ROUTES.openaiPrefix + '/v1/models', (req, res) => listModels('openai/models', req, res)),
    table.exact('POST', ROUTES.anthropicPrefix + '/v1/messages', (req, res) => forward('anthropic', 'anthropic/messages', req, res)),
    table.exact('GET', ROUTES.anthropicPrefix + '/v1/models', (req, res) => listModels('anthropic/models', req, res)),
  ]
  let started = false
  return {
    keys: store,
    createKey: (input) => store.create(input),
    revokeKey: (id) => store.revoke(id),
    listKeys: () => store.list(),
    routes() {
      return routes.slice()
    },
    async start() {
      if (started) return
      started = true
      log('models.proxy ready (keys=' + String(store.list().length) + ')')
    },
    async stop() {
      started = false
      limiters.clear()
    },
  }
}

export default { createProxySubsystem, createProxyKey, revokeProxyKey, listProxyKeys, createProxyKeyStore }
