/**
 * The declarative adapter runtime (LINK adapts software).
 *
 * One declaration (adapters/<id>/adapter.json) is probed, identified, consented to, verified,
 * bound and audited in that order, and only that order. The frozen lifecycle is:
 *
 *   probe -> identify (/health fingerprint) -> core.consent.request -> read the credential
 *   -> verify the declared requests -> bind the capabilities -> persist adapters.json -> audit
 *
 * A failure at any step removes everything the attempt produced (no half binding, no half
 * provider, no persisted row) and throws one named AdapterRefusal. The credential is read only
 * after consent resolved granted; it lives in this process's memory and is never written to
 * adapters.json, to a log line, to an audit record or to a published event.
 *
 * Restart rule: adapters.json persists a consent receipt per binding (adapterId, granted scopes,
 * consentGrantedAt, declaration id and declarationVersion) and never the credential. A person who
 * granted access is not asked again on every kernel restart: restore re-probes (the port drifts),
 * re-reads the credential only through that receipt and re-runs the declared verification, and
 * refuses a stale or revoked receipt as rejoin-required - see the rule above restoreBindings().
 * connect() always runs the full frozen lifecycle, consent card included.
 *
 * Capability binders: bindModels()/bindTools() attach through addBinder() so activation happens
 * BEFORE a binding is committed. An activation throw rolls the whole connect back. External (peer)
 * bindings enter through registerExternalBinding(): same binder seam and frozen events, persisted
 * in adapters.json without a consent receipt because the peer grant is their consent. The runtime
 * publishes the two frozen client events on every change:
 *   interconnect/bindings  {bindings: BindingState[]}
 *   interconnect/adapters  {adapters: AdapterStatus[]}
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AdapterDeclaration,
  AdapterRuntime,
  AdapterRuntimeOptions,
  AdapterStatus,
  BindingState,
  ConsentRequest,
  CoreEvent,
  ProbeResult,
} from '../protocol/types.ts'
import { CAPS, LIMITS } from '../protocol/types.ts'
import { expandTemplate, probeDeclaration, readDotPath, type ProbeEnvironment } from './probe.ts'

/** The frozen in-process event names the client half and the capability binders subscribe to. */
export const ADAPTER_EVENTS = Object.freeze({
  /** Published on every binding change (bind, unbind, status, restore). */
  bindings: 'interconnect/bindings',
  /** Published after every probe round. */
  adapters: 'interconnect/adapters',
})

/** The binding file under the interconnect data directory. It never carries a credential. */
export const STATE_FILE = 'adapters.json'

/** Stable refusal codes one adapter attempt can carry. */
export const ADAPTER_REFUSALS = Object.freeze({
  unknown: 'adapter/unknown',
  invalidDeclaration: 'adapter/invalid-declaration',
  consentDenied: 'adapter/consent-denied',
  credentialMissing: 'adapter/credential-missing',
  verifyFailed: 'adapter/verify-failed',
  bindFailed: 'adapter/bind-failed',
  persistFailed: 'adapter/persist-failed',
  notBound: 'adapter/not-bound',
  alreadyBound: 'adapter/already-bound',
  stopped: 'adapter/stopped',
  externalInvalid: 'adapter/external-invalid',
  externalConflict: 'adapter/external-conflict',
  externalUnknown: 'adapter/external-unknown',
})

/** One named refusal from the adapter runtime; code is stable and message is the pane sentence. */
export class AdapterRefusal extends Error {
  /** Stable machine code, e.g. adapter/not-running. */
  readonly code: string
  /** The declaration id the attempt was for, when known. */
  readonly adapterId: string | undefined

  /**
   * @param code - stable machine code.
   * @param message - the sentence the pane prints.
   * @param adapterId - the declaration id the attempt was for.
   */
  constructor(code: string, message: string, adapterId?: string) {
    super(message)
    this.name = 'AdapterRefusal'
    this.code = code
    this.adapterId = adapterId
  }
}

/** What one capability binder receives for one binding. It never leaves this process. */
export interface BindingActivation {
  adapterId: string
  declaration: AdapterDeclaration
  binding: BindingState
  baseUrl: string
  /** Read the credential in memory. undefined means the binding was released or needs rejoin. */
  credential(): string | undefined
  limits: { rpm: number; timeoutMs: number }
}

/** One capability family's binder, attached with AdapterRuntimeInternals.addBinder(). */
export interface CapabilityBinder {
  /** Binder name, used in logs and for per-binding activation bookkeeping. */
  readonly name: string
  /** Capability kinds this binder serves (CAPS values). */
  readonly caps: readonly string[]
  /** Register the binding's capability registrations. Throwing vetoes the connect and rolls it back. */
  activate(activation: BindingActivation): void
  /** Release every registration made by activate for this binding; must tolerate a failed activate. */
  deactivate(activation: BindingActivation): void
}

/**
 * One peer capability set registered as an EXTERNAL binding (the software-active direction). The
 * peer handshake records its grant in the grant store, so no consent receipt is written; the peer
 * id and capabilities are persisted, while the optional bearer token stays in memory only.
 */
export interface ExternalBindingInput {
  /** Stable binding id; unique across declarative and peer bindings. */
  id: string
  /** The peer-side adapter identity this binding is attributed to. */
  adapterId: string
  /** The peer's linkId; its grant is the consent for this binding. */
  peerLinkId: string
  /** Capability kinds this binding provides (CAPS values). */
  caps: string[]
  /** The peer's declared origin. */
  baseUrl: string
  /** Provider route for models.provide (defaults to adapterId). */
  providerId?: string
  /**
   * Static bearer token for the peer's model surface. Never persisted. When neither this nor
   * credential is given, bindModels leaves a models.provide provider to the ingress, which
   * registers it with createOpenAiCompatibleAdapter() itself.
   */
  apiKey?: string
  /** Bearer token getter (token refresh); takes precedence over apiKey. Never persisted. */
  credential?: () => string | undefined
}

/** The runtime plus the seams index.ts and the two binders use; the frozen factory returns it. */
export interface AdapterRuntimeInternals extends AdapterRuntime {
  addBinder(binder: CapabilityBinder): () => void
  healthCheckOnce(): Promise<void>
  declaration(adapterId: string): AdapterDeclaration | undefined
  /** Register one external (peer) binding; committed state is persisted and evented. */
  registerExternalBinding(input: ExternalBindingInput): BindingState
  /** Release one external (peer) binding by its binding id. */
  releaseExternalBinding(id: string): void
}

/**
 * The person's recorded consent receipt for one binding: which declaration (id and content
 * version) was allowed, for which scopes, and when. No credential field exists by construction.
 */
interface PersistedReceipt {
  adapterId: string
  /** The declaration consent.scopes the person granted at that time. */
  scopes: string[]
  consentGrantedAt: string
  /** The declaration id the grant was made for. */
  declarationId: string
  /** The declaration content fingerprint at grant time (see declarationVersion()). */
  declarationVersion: string
  /** Set by a revoke path; a receipt carrying it never restores. */
  revokedAt?: string
}

/** One persisted binding. No credential field exists by construction. */
interface PersistedBinding {
  adapterId: string
  caps: string[]
  providerId?: string
  toolNames?: string[]
  baseUrl: string
  boundAt: string
  receipt?: PersistedReceipt
  /** Binding id; external bindings only (a declarative binding's id is its adapterId). */
  id?: string
  /** True for a peer binding: its consent lives in the grant store, so it carries no receipt. */
  external?: boolean
  /** The peer's linkId, for an external binding. */
  peerLinkId?: string
}

/** adapters.json as written under <core.dir>; version 1 predates consent receipts. */
interface PersistedState {
  version: 1 | 2
  bindings: PersistedBinding[]
}

/** One live binding plus the in-process facts the binders need. */
interface LiveBinding {
  state: BindingState
  declaration: AdapterDeclaration
  baseUrl: string
  limits: { rpm: number; timeoutMs: number }
  /** The verified credential, cleared on disconnect/rollback; `undefined` is assigned explicitly. */
  credential?: string | undefined
  /** In-memory peer token getter; external bindings only, never persisted. */
  credentialSource?: () => string | undefined
  /** Present exactly for an external (peer) binding: its consent is the peer grant. */
  externalPeerLinkId?: string
  receipt?: PersistedReceipt
  activeBinderNames: Set<string>
}

/** One readable sentence for a thrown value, safe to log: it carries no credential. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Right now, as an ISO timestamp. */
function nowIso(): string {
  return new Date().toISOString()
}

/** The wire body for one adapter refusal; index.ts answers route requests with it. */
export function adapterRefusalBody(error: unknown): { ok: false; error: { code: string; message: string; adapterId?: string } } {
  if (error instanceof AdapterRefusal) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.adapterId === undefined ? {} : { adapterId: error.adapterId }),
      },
    }
  }
  return { ok: false, error: { code: 'adapter/internal', message: describeError(error) } }
}

/** The first declared capability of one kind. */
function capabilityOf(declaration: AdapterDeclaration, kind: string): AdapterDeclaration['capabilities'][number] | undefined {
  return declaration.capabilities.find((capability) => capability.kind === kind)
}

/** The provider id a models.provide declaration binds under. */
function providerIdOf(declaration: AdapterDeclaration): string | undefined {
  const capability = capabilityOf(declaration, CAPS.modelsProvide)
  if (capability === undefined) return undefined
  return capability.as?.providerId ?? declaration.id
}

/** The tool names a tools.expose declaration registers. */
function toolNamesOf(declaration: AdapterDeclaration): string[] | undefined {
  const capability = capabilityOf(declaration, CAPS.toolsExpose)
  if (capability === undefined || !Array.isArray(capability.tools)) return undefined
  return capability.tools.map((tool) => tool.name)
}

/** The declared limits with the protocol defaults materialized. */
function limitsOf(declaration: AdapterDeclaration): { rpm: number; timeoutMs: number } {
  return {
    rpm: declaration.limits?.rpm ?? LIMITS.rpm,
    timeoutMs: declaration.limits?.timeoutMs ?? LIMITS.timeoutMs,
  }
}

/**
 * The declaration content fingerprint a consent receipt is bound to. It is deterministic over the
 * declaration data, so an unchanged declaration keeps its receipt valid across restarts while any
 * edit that could change what the binding does invalidates it.
 * @param declaration - the loaded declaration.
 * @returns 16 hex characters of the declaration content hash.
 */
function declarationVersion(declaration: AdapterDeclaration): string {
  const content = JSON.stringify({
    id: declaration.id,
    name: declaration.name,
    vendor: declaration.vendor,
    match: declaration.match,
    connect: declaration.connect,
    capabilities: declaration.capabilities,
    consent: declaration.consent,
    limits: declaration.limits,
  })
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Why one persisted receipt can not be replayed, or undefined when it is the person's current grant.
 * @param receipt - the persisted receipt, possibly absent on a legacy binding file.
 * @param adapterId - the declaration id the receipt is being replayed for.
 * @param declaration - the current declaration.
 * @returns one sentence naming the refusal, or undefined.
 */
function receiptProblem(receipt: PersistedReceipt | undefined, adapterId: string, declaration: AdapterDeclaration): string | undefined {
  if (receipt === undefined || receipt === null || typeof receipt !== 'object') return 'the binding file carries no consent receipt; connect again'
  if (typeof receipt.revokedAt === 'string' && receipt.revokedAt !== '') return 'the recorded grant was revoked at ' + receipt.revokedAt + '; connect again'
  if (typeof receipt.adapterId !== 'string' || receipt.adapterId !== adapterId) return 'the consent receipt names adapter ' + JSON.stringify(receipt.adapterId) + '; connect again'
  if (typeof receipt.declarationId !== 'string' || receipt.declarationId !== declaration.id) return 'the consent receipt was granted for declaration ' + JSON.stringify(receipt.declarationId) + '; connect again'
  if (!Array.isArray(receipt.scopes) || !receipt.scopes.every((scope) => typeof scope === 'string')) return 'the consent receipt carries no granted scopes; connect again'
  const missing = declaration.consent.scopes.filter((scope) => !(receipt.scopes as string[]).includes(scope))
  if (missing.length > 0) return 'the recorded grant does not cover ' + JSON.stringify(missing) + ' (granted ' + JSON.stringify(receipt.scopes) + '); connect again'
  if (typeof receipt.consentGrantedAt !== 'string' || receipt.consentGrantedAt === '') return 'the consent receipt carries no grant time; connect again'
  const currentVersion = declarationVersion(declaration)
  if (typeof receipt.declarationVersion !== 'string' || receipt.declarationVersion !== currentVersion) {
    return 'the declaration changed after the person granted access (receipt ' + String(receipt.declarationVersion) + ', current ' + currentVersion + '); connect again'
  }
  return undefined
}

/** The synthetic declaration a peer binding activates through: capabilities only, no verify/credential. */
function externalDeclaration(input: { adapterId: string; peerLinkId: string; caps: string[]; baseUrl: string; providerId?: string }): AdapterDeclaration {
  return {
    id: input.adapterId,
    name: input.adapterId,
    match: {},
    connect: { baseUrl: input.baseUrl },
    capabilities: input.caps.map((kind) => ({
      kind,
      version: 1,
      ...(kind === CAPS.modelsProvide ? { from: 'openai', ...(input.providerId === undefined ? {} : { as: { providerId: input.providerId } }) } : {}),
    })),
    consent: { title: 'peer binding ' + input.peerLinkId, scopes: [...input.caps] },
  }
}

/** Read one external-binding string field or refuse by name. */
function externalText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): ' + field + ' must be a non-empty string')
  }
  return value.trim()
}

/** Normalize one external-binding origin. */
function externalBaseUrl(value: unknown): string {
  const text = externalText(value, 'baseUrl')
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): baseUrl must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): baseUrl must be an absolute http(s) URL')
  }
  return text.replace(/\/+$/, '')
}

/** Build the in-memory token getter an external binding may carry; undefined means no token. */
function externalCredentialSource(input: ExternalBindingInput): (() => string | undefined) | undefined {
  if (input.credential !== undefined) {
    if (typeof input.credential !== 'function') throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): credential must be a function')
    return () => {
      const value = (input.credential as () => string | undefined)()
      return typeof value === 'string' && value !== '' ? value : undefined
    }
  }
  if (input.apiKey === undefined) return undefined
  if (typeof input.apiKey !== 'string' || input.apiKey === '') throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): apiKey must be a non-empty string')
  const apiKey = input.apiKey
  return () => apiKey
}

/**
 * Validate one parsed adapter.json.
 * @param id - the directory name the declaration lives in.
 * @param parsed - the parsed JSON document.
 * @returns the declaration, or throws one sentence naming what is wrong.
 */
function validateDeclaration(id: string, parsed: unknown): AdapterDeclaration {
  if (parsed === null || typeof parsed !== 'object') throw new Error('adapter.json is not a JSON object')
  const declaration = parsed as AdapterDeclaration
  if (declaration.id !== id) throw new Error('adapter.json declares id ' + JSON.stringify(declaration.id) + ' but lives in adapters/' + id + '/')
  if (typeof declaration.name !== 'string' || declaration.name === '') throw new Error('name must be a non-empty string')
  if (declaration.match === null || typeof declaration.match !== 'object') throw new Error('match must be an object')
  if (declaration.connect === null || typeof declaration.connect !== 'object') throw new Error('connect must be an object')
  if (typeof declaration.connect.baseUrl !== 'string' || declaration.connect.baseUrl === '') throw new Error('connect.baseUrl must be a non-empty string')
  if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) throw new Error('capabilities must be a non-empty array')
  if (declaration.consent === null || typeof declaration.consent !== 'object') throw new Error('consent must be an object')
  if (typeof declaration.consent.title !== 'string' || declaration.consent.title === '') throw new Error('consent.title must be a non-empty string')
  if (!Array.isArray(declaration.consent.scopes) || declaration.consent.scopes.length === 0) throw new Error('consent.scopes must be a non-empty array')
  for (const capability of declaration.capabilities) {
    if (capability === null || typeof capability !== 'object') throw new Error('each capability must be an object')
    if (typeof capability.kind !== 'string' || capability.kind === '') throw new Error('each capability needs a non-empty kind')
    if (!Number.isInteger(capability.version) || (capability.version as number) < 1) throw new Error('capability ' + capability.kind + ' needs an integer version >= 1')
    if (capability.kind === CAPS.modelsProvide && capability.as !== undefined && typeof capability.as.providerId !== 'string') {
      throw new Error('models.provide as.providerId must be a string when present')
    }
    if (capability.kind === CAPS.toolsExpose) {
      if (!Array.isArray(capability.tools) || capability.tools.length === 0) throw new Error('tools.expose must declare at least one tool')
      for (const tool of capability.tools) {
        if (tool === null || typeof tool !== 'object') throw new Error('each declared tool must be an object')
        if (typeof tool.name !== 'string' || tool.name === '') throw new Error('each declared tool needs a non-empty name')
        if (typeof tool.description !== 'string') throw new Error('tool ' + tool.name + ' needs a description string')
        if (tool.parameters === null || typeof tool.parameters !== 'object') throw new Error('tool ' + tool.name + ' needs a parameters JSON schema object')
      }
    }
  }
  return declaration
}

/**
 * Create the adapter runtime. index.ts calls this once, then binds models/tools.
 * @param options - core services, declarations directory, host accessors and one log line sink.
 * @returns the runtime plus the binder seam.
 */
export async function createAdapterRuntime(options: AdapterRuntimeOptions): Promise<AdapterRuntimeInternals> {
  const { core, adaptersDir, log } = options
  const probeEnvironment: ProbeEnvironment = {}
  const declarations = new Map<string, AdapterDeclaration>()
  const declarationOrder: string[] = []
  const declarationErrors = new Map<string, string>()
  const probes = new Map<string, ProbeResult>()
  const live = new Map<string, LiveBinding>()
  const binders: CapabilityBinder[] = []
  const inFlight = new Map<string, Promise<BindingState>>()
  const stateFile = join(core.dir, STATE_FILE)
  let persistCounter = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  /** One audit record; the sink adds the timestamp. */
  function audit(record: { kind: 'probe' | 'bind' | 'unbind' | 'consent' | 'error' | 'revoke'; adapter?: string; peer?: string; cap?: string; op?: string; ok: boolean; code?: string; ms?: number; detail?: string }): void {
    try {
      core.audit.record({ ...record, ...(record.detail === undefined ? {} : { detail: record.detail.slice(0, 240) }) })
    } catch (error) {
      log('adapter audit record could not be appended: ' + describeError(error))
    }
  }

  /** Clone one binding so a caller can not mutate runtime state. */
  function cloneBinding(state: BindingState): BindingState {
    return {
      ...state,
      caps: [...state.caps],
      ...(state.toolNames === undefined ? {} : { toolNames: [...state.toolNames] }),
    }
  }

  /** Every live binding, detached. */
  function bindings(): BindingState[] {
    return [...live.values()].map((record) => cloneBinding(record.state))
  }

  /** Every declaration row the pane draws, detached. */
  function adapters(): AdapterStatus[] {
    return declarationOrder.map((id) => {
      const declaration = declarations.get(id)
      const reading = probes.get(id)
      const record = live.get(id)
      const row: AdapterStatus = {
        id,
        name: declaration?.name ?? id,
        detected: reading?.detected ?? false,
        ...(declaration?.vendor === undefined ? {} : { vendor: declaration.vendor }),
        ...(reading?.reasonCode === undefined ? {} : { reasonCode: reading.reasonCode }),
        ...(reading?.reason === undefined ? {} : { reason: reading.reason }),
        ...(record === undefined ? {} : { binding: cloneBinding(record.state) }),
      }
      return row
    })
  }

  /** Publish the frozen binding event. */
  function publishBindings(): void {
    const event: CoreEvent = { type: ADAPTER_EVENTS.bindings, at: nowIso(), data: { bindings: bindings() } }
    try {
      core.events.publish(event)
    } catch (error) {
      log('adapter runtime could not publish ' + ADAPTER_EVENTS.bindings + ': ' + describeError(error))
    }
  }

  /** Publish the frozen adapter-row event. */
  function publishAdapters(): void {
    const event: CoreEvent = { type: ADAPTER_EVENTS.adapters, at: nowIso(), data: { adapters: adapters() } }
    try {
      core.events.publish(event)
    } catch (error) {
      log('adapter runtime could not publish ' + ADAPTER_EVENTS.adapters + ': ' + describeError(error))
    }
  }

  /** The activation handed to one binder; the credential getter reads memory only. */
  function activationFor(record: LiveBinding): BindingActivation {
    return {
      adapterId: record.state.adapterId,
      declaration: record.declaration,
      binding: cloneBinding(record.state),
      baseUrl: record.baseUrl,
      credential: () => record.credential ?? record.credentialSource?.(),
      limits: { ...record.limits },
    }
  }

  /** Release every binder registration this live record holds. */
  function releaseBinding(record: LiveBinding): void {
    const activation = activationFor(record)
    for (const binder of [...binders].reverse()) {
      if (!record.activeBinderNames.delete(binder.name)) continue
      try {
        binder.deactivate(activation)
      } catch (error) {
        log('capability binder ' + binder.name + ' failed to release adapter ' + record.state.adapterId + ': ' + describeError(error))
      }
    }
  }

  /** Read the declared credential into memory. Only call this after consent resolved granted. */
  function readCredential(declaration: AdapterDeclaration): string | undefined {
    const credential = declaration.connect?.credential
    if (credential === undefined || credential.kind === 'none') return undefined
    if (credential.kind === 'env') {
      const value = process.env[credential.name]
      return value !== undefined && value.trim() !== '' ? value.trim() : undefined
    }
    const path = expandTemplate(credential.path, {}, process.env, homedir())
    if (path === undefined) return undefined
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed = JSON.parse(raw)
      const value = readDotPath(parsed, credential.jsonPath)
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch {
      return undefined
    }
  }

  /** Where a declared credential lives, named for a refusal. Never its value. */
  function credentialLocation(declaration: AdapterDeclaration): string {
    const credential = declaration.connect?.credential
    if (credential === undefined || credential.kind === 'none') return 'none'
    if (credential.kind === 'env') return 'the environment variable ' + credential.name
    return credential.path
  }

  /** Run the declared verification requests. Throws one AdapterRefusal on the first mismatch. */
  async function verifyDeclaration(declaration: AdapterDeclaration, baseUrl: string, credential: string | undefined): Promise<void> {
    const steps = declaration.connect?.verify ?? []
    const limits = limitsOf(declaration)
    if (steps.length === 0) {
      log('adapter ' + declaration.id + ': the declaration names no connect.verify step; the binding rests on the identity probe only')
      return
    }
    for (const step of steps) {
      const path = step.path.startsWith('/') ? step.path : '/' + step.path
      const url = baseUrl + path
      const headers: Record<string, string> = { accept: 'application/json, text/plain;q=0.9' }
      if (step.auth === 'bearer' && credential !== undefined) headers.authorization = 'Bearer ' + credential
      let response: Response
      try {
        response = await fetch(url, { method: step.method, headers, redirect: 'error', signal: AbortSignal.timeout(limits.timeoutMs) })
      } catch (error) {
        throw new AdapterRefusal(ADAPTER_REFUSALS.verifyFailed, declaration.name + ': ' + step.method + ' ' + path + ' could not be reached: ' + describeError(error).slice(0, 160), declaration.id)
      }
      const expected = step.expectStatus ?? 200
      if (response.status !== expected) {
        const credentialNote = step.auth === 'bearer' ? ' (the credential the person allowed was not accepted)' : ''
        throw new AdapterRefusal(ADAPTER_REFUSALS.verifyFailed, declaration.name + ': ' + step.method + ' ' + path + ' answered HTTP ' + response.status + ', expected ' + expected + credentialNote, declaration.id)
      }
    }
  }

  /** Load every adapter declaration under adaptersDir; a broken one keeps its own honest row. */
  async function loadDeclarations(): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await readdir(adaptersDir, { withFileTypes: true })
    } catch (error) {
      log('adapter declarations directory ' + adaptersDir + ' can not be read: ' + describeError(error))
      return
    }
    for (const entry of entries.slice().sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      if (!entry.isDirectory()) continue
      const id = entry.name
      declarationOrder.push(id)
      try {
        const raw = await readFile(join(adaptersDir, id, 'adapter.json'), 'utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          throw new Error('adapter.json is not JSON: ' + describeError(error))
        }
        declarations.set(id, validateDeclaration(id, parsed))
      } catch (error) {
        declarationErrors.set(id, 'adapters/' + id + '/adapter.json: ' + describeError(error))
      }
    }
  }

  /** Probe every declaration now; this is the only path that publishes adapter rows. */
  async function probeAll(): Promise<ProbeResult[]> {
    const readings: ProbeResult[] = []
    for (const id of declarationOrder) {
      const declaration = declarations.get(id)
      if (declaration === undefined) {
        const reading: ProbeResult = { adapterId: id, detected: false, reasonCode: 'probe-failed', reason: declarationErrors.get(id) ?? 'the declaration could not be loaded', at: nowIso() }
        probes.set(id, reading)
        readings.push(reading)
        continue
      }
      const startedAt = Date.now()
      let reading: ProbeResult
      try {
        reading = await probeDeclaration(declaration, probeEnvironment)
      } catch (error) {
        reading = { adapterId: id, detected: false, reasonCode: 'probe-failed', reason: 'the probe failed: ' + describeError(error), at: nowIso() }
      }
      probes.set(id, reading)
      readings.push(reading)
      audit({ kind: 'probe', adapter: id, ok: reading.detected, code: reading.detected ? 'detected' : 'adapter/' + String(reading.reasonCode), ms: Date.now() - startedAt, ...(reading.reason === undefined ? {} : { detail: reading.reason }) })
    }
    publishAdapters()
    return readings
  }

  /** One adapter's last probe reading. */
  function probe(adapterId: string): ProbeResult | undefined {
    return probes.get(adapterId)
  }

  /** The full frozen lifecycle for one adapter. */
  async function connectNow(adapterId: string, connectOptions: { onConsent?: (request: ConsentRequest) => void } = {}): Promise<BindingState> {
    if (stopped) throw new AdapterRefusal(ADAPTER_REFUSALS.stopped, 'the adapter runtime was stopped; no binding can be made', adapterId)
    const declaration = declarations.get(adapterId)
    if (declaration === undefined) {
      const problem = declarationErrors.get(adapterId)
      if (problem !== undefined) throw new AdapterRefusal(ADAPTER_REFUSALS.invalidDeclaration, problem, adapterId)
      throw new AdapterRefusal(ADAPTER_REFUSALS.unknown, 'there is no adapter declaration for ' + JSON.stringify(adapterId) + ' under ' + adaptersDir, adapterId)
    }
    const existing = live.get(adapterId)
    if (existing !== undefined) {
      if (existing.state.status === 'active') throw new AdapterRefusal(ADAPTER_REFUSALS.alreadyBound, 'adapter ' + JSON.stringify(adapterId) + ' is already bound; disconnect it before connecting again', adapterId)
      await disconnect(adapterId)
    }
    const startedAt = Date.now()
    const reading = await probeDeclaration(declaration, probeEnvironment)
    probes.set(adapterId, reading)
    publishAdapters()
    audit({ kind: 'probe', adapter: adapterId, ok: reading.detected, code: reading.detected ? 'detected' : 'adapter/' + String(reading.reasonCode), ms: Date.now() - startedAt, ...(reading.reason === undefined ? {} : { detail: reading.reason }) })
    if (!reading.detected) {
      throw new AdapterRefusal('adapter/' + String(reading.reasonCode ?? 'probe-failed'), reading.reason ?? 'adapter ' + JSON.stringify(adapterId) + ' was not detected', adapterId)
    }
    const detectedBaseUrl = reading.baseUrl ?? expandTemplate(declaration.connect.baseUrl, reading.detail ?? {}, process.env, homedir()) ?? declaration.connect.baseUrl
    const baseUrl = detectedBaseUrl.replace(/\/+$/, '')
    // loadDeclaration() refuses a declaration with no capabilities; the assertion is compile-time only.
    const firstCapability = declaration.capabilities[0]!
    const consentInput: Omit<ConsentRequest, 'id' | 'createdAt'> = {
      peerLinkId: 'adapter:' + adapterId,
      peerName: declaration.name,
      title: declaration.consent.title,
      capability: firstCapability!.kind,
      scopes: [...declaration.consent.scopes],
      detail: {
        adapter: adapterId,
        ...(declaration.vendor === undefined ? {} : { vendor: declaration.vendor }),
        baseUrl,
      },
      risk: 'low',
    }
    connectOptions.onConsent?.({ ...consentInput, id: 'adapter:' + adapterId, createdAt: nowIso() })
    const decision = await core.consent.request(consentInput)
    audit({ kind: 'consent', adapter: adapterId, cap: firstCapability!.kind, ok: decision === 'granted', code: decision === 'granted' ? 'granted' : ADAPTER_REFUSALS.consentDenied, ms: Date.now() - startedAt })
    if (decision !== 'granted') {
      throw new AdapterRefusal(ADAPTER_REFUSALS.consentDenied, 'the person did not grant ' + declaration.name + ' access (' + decision + '); nothing was bound', adapterId)
    }
    const receipt: PersistedReceipt = {
      adapterId,
      scopes: [...declaration.consent.scopes],
      consentGrantedAt: nowIso(),
      declarationId: declaration.id,
      declarationVersion: declarationVersion(declaration),
    }
    const declaredCredential = declaration.connect?.credential
    const credential = readCredential(declaration)
    if (declaredCredential !== undefined && declaredCredential.kind !== 'none' && credential === undefined) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.credentialMissing, declaration.name + ' declares its credential at ' + credentialLocation(declaration) + ' but nothing usable was found there (read only after consent); nothing was bound', adapterId)
    }
    await verifyDeclaration(declaration, baseUrl, credential)
    const boundAt = nowIso()
    const state: BindingState = {
      id: adapterId,
      adapterId,
      caps: declaration.capabilities.map((capability) => capability.kind),
      status: 'active',
      boundAt,
      updatedAt: boundAt,
      failures: 0,
      ...(providerIdOf(declaration) === undefined ? {} : { providerId: providerIdOf(declaration) }),
      ...(toolNamesOf(declaration) === undefined ? {} : { toolNames: toolNamesOf(declaration) }),
      baseUrl,
    }
    const record: LiveBinding = { state, declaration, baseUrl, limits: limitsOf(declaration), credential, receipt, activeBinderNames: new Set<string>() }
    const activation = activationFor(record)
    const activated: CapabilityBinder[] = []
    try {
      for (const binder of binders) {
        if (!binder.caps.some((capability) => state.caps.includes(capability))) continue
        binder.activate(activation)
        activated.push(binder)
        record.activeBinderNames.add(binder.name)
      }
    } catch (error) {
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation)
        } catch (releaseError) {
          log('capability binder ' + binder.name + ' failed to roll back adapter ' + adapterId + ': ' + describeError(releaseError))
        }
      }
      audit({ kind: 'bind', adapter: adapterId, ok: false, code: ADAPTER_REFUSALS.bindFailed, ms: Date.now() - startedAt, detail: describeError(error) })
      throw new AdapterRefusal(ADAPTER_REFUSALS.bindFailed, 'binding the capabilities of ' + declaration.name + ' failed: ' + describeError(error), adapterId)
    }
    live.set(adapterId, record)
    try {
      await persist()
    } catch (error) {
      live.delete(adapterId)
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation)
        } catch {
          /* the rollback error is already the failure being reported */
        }
      }
      record.credential = undefined
      throw new AdapterRefusal(ADAPTER_REFUSALS.persistFailed, 'the binding of ' + declaration.name + ' could not be written to ' + stateFile + ': ' + describeError(error), adapterId)
    }
    audit({ kind: 'bind', adapter: adapterId, cap: state.caps.join(','), ok: true, ms: Date.now() - startedAt, detail: baseUrl })
    publishBindings()
    publishAdapters()
    log('adapter ' + adapterId + ' bound: ' + state.caps.join(', ') + ' at ' + baseUrl)
    return cloneBinding(record.state)
  }

  /** connect() with one in-flight attempt per adapter. */
  async function connect(adapterId: string, connectOptions?: { onConsent?: (request: ConsentRequest) => void }): Promise<BindingState> {
    const running = inFlight.get(adapterId)
    if (running !== undefined) return running
    const attempt = connectNow(adapterId, connectOptions ?? {})
    inFlight.set(adapterId, attempt)
    try {
      return await attempt
    } catch (error) {
      audit({ kind: 'error', adapter: adapterId, ok: false, ...(error instanceof AdapterRefusal ? { code: error.code } : {}), detail: describeError(error) })
      throw error
    } finally {
      inFlight.delete(adapterId)
    }
  }

  /** Remove one binding and dispose its capability registrations. */
  async function disconnect(adapterId: string): Promise<void> {
    const record = live.get(adapterId)
    if (record === undefined) throw new AdapterRefusal(ADAPTER_REFUSALS.notBound, 'adapter ' + JSON.stringify(adapterId) + ' has no binding to remove', adapterId)
    if (record.externalPeerLinkId !== undefined) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalUnknown, JSON.stringify(adapterId) + ' is a peer binding; release it with releaseExternalBinding(id)', adapterId)
    }
    releaseBinding(record)
    record.credential = undefined
    live.delete(adapterId)
    await persist()
    audit({ kind: 'unbind', adapter: adapterId, ok: true })
    publishBindings()
    publishAdapters()
    log('adapter ' + adapterId + ' disconnected')
  }

  /**
   * Register one EXTERNAL binding: a peer capability set LINK binds from the software-active
   * direction. Its consent is the peer grant already in the grant store, so no consent receipt is
   * written; the optional bearer token stays in memory. It goes through the same binder seam as a
   * declarative binding (activation before commit, rollback on a throw), the same frozen
   * interconnect/bindings event, and adapters.json persistence.
   * @param input - binding identity, peer, capabilities, origin and optional model token.
   * @returns the committed binding state.
   */
  function registerExternalBinding(input: ExternalBindingInput): BindingState {
    if (stopped) throw new AdapterRefusal(ADAPTER_REFUSALS.stopped, 'the adapter runtime was stopped; no binding can be made')
    if (input === null || typeof input !== 'object') throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding() needs one object argument')
    const id = externalText(input.id, 'id')
    const adapterId = externalText(input.adapterId, 'adapterId')
    const peerLinkId = externalText(input.peerLinkId, 'peerLinkId')
    const baseUrl = externalBaseUrl(input.baseUrl)
    const caps: string[] = []
    for (const raw of Array.isArray(input.caps) ? input.caps : []) {
      if (typeof raw === 'string' && raw.trim() !== '' && !caps.includes(raw.trim())) caps.push(raw.trim())
    }
    if (caps.length === 0) throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, 'registerExternalBinding(): caps must name at least one capability', id)
    const existing = live.get(id)
    if (existing !== undefined) {
      if (existing.externalPeerLinkId === undefined) throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, 'a declarative binding already holds the id ' + JSON.stringify(id), id)
      if (existing.state.status === 'active') throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, 'the peer binding ' + JSON.stringify(id) + ' is already active; release it first', id)
      // A peer session re-established after a restart replaces its own rejoin-required row.
      releaseExternalBinding(id)
    }
    for (const record of live.values()) {
      if (record.state.adapterId !== adapterId) continue
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, 'adapter id ' + JSON.stringify(adapterId) + ' is already bound as ' + JSON.stringify(record.state.id), id)
    }
    const providerId = input.providerId === undefined ? undefined : externalText(input.providerId, 'providerId')
    const credentialSource = externalCredentialSource(input)
    const declaration = externalDeclaration({ adapterId, peerLinkId, caps, baseUrl, ...(providerId === undefined ? {} : { providerId }) })
    const boundAt = nowIso()
    const state: BindingState = {
      id,
      adapterId,
      peerLinkId,
      caps: [...caps],
      status: 'active',
      boundAt,
      updatedAt: boundAt,
      failures: 0,
      ...(providerId === undefined ? {} : { providerId }),
      baseUrl,
    }
    const record: LiveBinding = {
      state,
      declaration,
      baseUrl,
      limits: limitsOf(declaration),
      ...(credentialSource === undefined ? {} : { credentialSource }),
      externalPeerLinkId: peerLinkId,
      activeBinderNames: new Set<string>(),
    }
    const activation = activationFor(record)
    const activated: CapabilityBinder[] = []
    try {
      for (const binder of binders) {
        if (!binder.caps.some((capability) => caps.includes(capability))) continue
        binder.activate(activation)
        activated.push(binder)
        record.activeBinderNames.add(binder.name)
      }
    } catch (error) {
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation)
        } catch (releaseError) {
          log('capability binder ' + binder.name + ' failed to roll back peer binding ' + id + ': ' + describeError(releaseError))
        }
      }
      throw new AdapterRefusal(ADAPTER_REFUSALS.bindFailed, 'binding the capabilities of peer ' + peerLinkId + ' failed: ' + describeError(error), id)
    }
    live.set(id, record)
    try {
      persistSync()
    } catch (error) {
      live.delete(id)
      releaseBinding(record)
      record.credential = undefined
      throw new AdapterRefusal(ADAPTER_REFUSALS.persistFailed, 'the peer binding ' + JSON.stringify(id) + ' could not be written to ' + stateFile + ': ' + describeError(error), id)
    }
    audit({ kind: 'bind', peer: peerLinkId, adapter: adapterId, cap: caps.join(','), ok: true, detail: baseUrl })
    publishBindings()
    publishAdapters()
    log('peer binding ' + id + ' registered: ' + caps.join(', ') + ' from ' + peerLinkId + ' at ' + baseUrl)
    return cloneBinding(record.state)
  }

  /**
   * Release one external (peer) binding and dispose its capability registrations.
   * @param id - the binding id registerExternalBinding() returned.
   */
  function releaseExternalBinding(id: string): void {
    const record = live.get(id)
    if (record === undefined || record.externalPeerLinkId === undefined) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalUnknown, 'there is no external binding ' + JSON.stringify(id) + ' to release', id)
    }
    releaseBinding(record)
    record.credential = undefined
    live.delete(id)
    try {
      persistSync()
    } catch (error) {
      log('peer binding ' + id + ' was released but adapters.json could not be rewritten: ' + describeError(error))
    }
    audit({ kind: 'unbind', peer: record.externalPeerLinkId, adapter: record.state.adapterId, ok: true })
    publishBindings()
    publishAdapters()
    log('peer binding ' + id + ' released')
  }

  /** Mark one binding unavailable after repeated health failures and dispose its registrations. */
  function markUnavailable(record: LiveBinding, reason: string): void {
    releaseBinding(record)
    record.state = { ...record.state, status: 'unavailable', updatedAt: nowIso() }
    audit({ kind: 'error', adapter: record.state.adapterId, ok: false, code: 'adapter/peer-unavailable', detail: reason })
    publishBindings()
    publishAdapters()
    log('adapter ' + record.state.adapterId + ' marked unavailable after ' + String(record.state.failures) + ' failed health checks: ' + reason)
  }

  /** One health sweep: re-run each active binding's declared verification. */
  async function healthCheckOnce(): Promise<void> {
    for (const record of [...live.values()]) {
      if (record.state.status !== 'active') continue
      // A peer binding's health is its peer session; the ingress owns that probe, not the declaration.
      if (record.externalPeerLinkId !== undefined) continue
      const checkedAt = nowIso()
      let failure: string | undefined
      try {
        await verifyDeclaration(record.declaration, record.baseUrl, record.credential)
      } catch (error) {
        failure = describeError(error)
      }
      const failures = failure === undefined ? 0 : record.state.failures + 1
      record.state = { ...record.state, updatedAt: checkedAt, lastCheckAt: checkedAt, failures }
      if (failure === undefined) continue
      audit({ kind: 'probe', adapter: record.state.adapterId, ok: false, code: 'adapter/health', detail: failure })
      if (failures >= LIMITS.healthFailures) markUnavailable(record, failure)
    }
    publishBindings()
  }

  /** The adapters.json document for the current live map; external bindings carry no receipt. */
  function bindingDocument(): PersistedState {
    return {
      version: 2,
      bindings: [...live.values()].map((record) => ({
        ...(record.externalPeerLinkId === undefined
          ? {}
          : { external: true as const, id: record.state.id, peerLinkId: record.externalPeerLinkId }),
        adapterId: record.state.adapterId,
        caps: [...record.state.caps],
        ...(record.state.providerId === undefined ? {} : { providerId: record.state.providerId }),
        ...(record.state.toolNames === undefined ? {} : { toolNames: [...record.state.toolNames] }),
        baseUrl: record.baseUrl,
        boundAt: record.state.boundAt,
        ...(record.receipt === undefined
          ? {}
          : {
              receipt: {
                adapterId: record.receipt.adapterId,
                scopes: [...record.receipt.scopes],
                consentGrantedAt: record.receipt.consentGrantedAt,
                declarationId: record.receipt.declarationId,
                declarationVersion: record.receipt.declarationVersion,
                ...(record.receipt.revokedAt === undefined ? {} : { revokedAt: record.receipt.revokedAt }),
              },
            }),
      })),
    }
  }

  /** Throw when a document would carry an in-memory credential. */
  function assertCredentialFree(text: string): void {
    for (const record of live.values()) {
      let secret = record.credential
      if ((secret === undefined || secret === '') && record.credentialSource !== undefined) {
        try {
          secret = record.credentialSource()
        } catch {
          secret = undefined
        }
      }
      if (secret !== undefined && secret !== '' && text.includes(secret)) {
        throw new Error('refusing to persist adapters.json: it would carry a credential')
      }
    }
  }

  /** Write the binding file atomically. It never contains a credential; that is asserted. */
  async function persist(): Promise<void> {
    await mkdir(core.dir, { recursive: true })
    const text = JSON.stringify(bindingDocument(), null, 2) + '\n'
    assertCredentialFree(text)
    persistCounter += 1
    const temporary = stateFile + '.' + String(process.pid) + '.' + String(persistCounter) + '.tmp'
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, stateFile)
  }

  /** Synchronous persist for the external-binding calls that must return committed state. */
  function persistSync(): void {
    mkdirSync(core.dir, { recursive: true })
    const text = JSON.stringify(bindingDocument(), null, 2) + '\n'
    assertCredentialFree(text)
    persistCounter += 1
    const temporary = stateFile + '.' + String(process.pid) + '.' + String(persistCounter) + '.tmp'
    writeFileSync(temporary, text, 'utf8')
    renameSync(temporary, stateFile)
  }

  /**
   * Restore persisted bindings after a restart.
   *
   * The person granted access once; a kernel restart must not ask again. That is why the persisted
   * receipt records adapterId, the granted scopes, consentGrantedAt, and the declaration id plus
   * its content version (see declarationVersion()). Restore re-reads the current declaration and
   * lock file (the port drifts) and only then re-reads the credential. It refuses the receipt -
   * presenting the binding as rejoin-required, with the reason audited and logged - when
   *
   *   (a) the declared verification no longer passes,
   *   (b) the grant was revoked: the receipt carries revokedAt, is missing or malformed, or its
   *       recorded scopes no longer cover the scopes the current declaration asks for (in M2
   *       disconnect() is the revocation path and deletes the receipt entirely, so a revoked
   *       receipt can never restore; this branch is what a future revoke path will hit),
   *   (c) the receipt predates the declaration version it is being replayed against (the
   *       declaration content changed after the person granted access), or
   *   (d) the receipt was written by adapters.json version 1, which carries no receipt at all.
   *
   * A refused receipt is kept in memory as a rejoin-required binding row so the pane can name the
   * reason; only connect() writes a fresh receipt, and it runs the full frozen lifecycle.
   */
  async function restoreBindings(): Promise<void> {
    let text: string
    try {
      text = await readFile(stateFile, 'utf8')
    } catch {
      return
    }
    let document: PersistedState
    try {
      document = JSON.parse(text) as PersistedState
    } catch (error) {
      log('ignoring ' + stateFile + ': it is not JSON (' + describeError(error) + ')')
      return
    }
    if (document === null || typeof document !== 'object' || !Array.isArray(document.bindings)) {
      log('ignoring ' + stateFile + ': it is not a binding document')
      return
    }
    const version = (document as { version?: unknown }).version
    if (version !== 1 && version !== 2) {
      log('ignoring ' + stateFile + ': unsupported version ' + JSON.stringify(version))
      return
    }
    const capsOf = (persisted: PersistedBinding, declaration: AdapterDeclaration): string[] => {
      if (Array.isArray(persisted.caps) && persisted.caps.length > 0) return [...persisted.caps]
      return declaration.capabilities.map((capability) => capability.kind)
    }
    /** Keep one refused receipt as an honest rejoin-required row; no credential is read. */
    const keepRejoin = (persisted: PersistedBinding, declaration: AdapterDeclaration, reason: string): void => {
      const baseUrl = (typeof persisted.baseUrl === 'string' && persisted.baseUrl !== '' ? persisted.baseUrl : declaration.connect.baseUrl).replace(/\/+$/, '')
      const boundAt = typeof persisted.boundAt === 'string' ? persisted.boundAt : nowIso()
      live.set(persisted.adapterId, {
        state: {
          id: persisted.adapterId,
          adapterId: persisted.adapterId,
          caps: capsOf(persisted, declaration),
          status: 'rejoin-required',
          boundAt,
          updatedAt: nowIso(),
          lastCheckAt: nowIso(),
          failures: 0,
          ...(persisted.providerId === undefined ? {} : { providerId: persisted.providerId }),
          ...(persisted.toolNames === undefined ? {} : { toolNames: [...persisted.toolNames] }),
          baseUrl,
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        receipt: { adapterId: persisted.adapterId, scopes: [], consentGrantedAt: '', declarationId: declaration.id, declarationVersion: '' },
        activeBinderNames: new Set<string>(),
      })
      audit({ kind: 'bind', adapter: persisted.adapterId, ok: false, code: 'rejoin-required', detail: reason })
      log('adapter ' + persisted.adapterId + ' needs to be connected again: ' + reason)
    }
    /**
     * A peer binding's consent lives in the grant store, not in a receipt. The peer session token
     * is not persisted, so a live grant restores the row as rejoin-required for the ingress to
     * re-establish without a new consent card; a missing or reduced grant drops the persisted row.
     */
    const restoreExternalBinding = (persisted: PersistedBinding): void => {
      const id = typeof persisted.id === 'string' && persisted.id !== '' ? persisted.id : persisted.adapterId
      const peerLinkId = typeof persisted.peerLinkId === 'string' ? persisted.peerLinkId : ''
      const caps = Array.isArray(persisted.caps) ? persisted.caps.filter((cap) => typeof cap === 'string' && cap !== '') : []
      if (peerLinkId === '' || caps.length === 0) {
        log('dropping the persisted peer binding ' + id + ': the record is incomplete')
        return
      }
      let covered = true
      try {
        covered = caps.every((cap) => core.grants.has(peerLinkId, cap))
      } catch {
        covered = false
      }
      if (!covered) {
        audit({ kind: 'revoke', peer: peerLinkId, adapter: persisted.adapterId, ok: false, code: 'peer-binding-revoked', detail: 'the persisted peer binding ' + id + ' was not restored: the grant no longer covers ' + caps.join(',') })
        log('dropping the persisted peer binding ' + id + ': the grant for ' + peerLinkId + ' no longer covers ' + caps.join(', '))
        return
      }
      const baseUrl = (typeof persisted.baseUrl === 'string' ? persisted.baseUrl : '').replace(/\/+$/, '')
      const declaration = externalDeclaration({ adapterId: persisted.adapterId, peerLinkId, caps, baseUrl, ...(persisted.providerId === undefined ? {} : { providerId: persisted.providerId }) })
      const boundAt = typeof persisted.boundAt === 'string' ? persisted.boundAt : nowIso()
      live.set(id, {
        state: {
          id,
          adapterId: persisted.adapterId,
          peerLinkId,
          caps: [...caps],
          status: 'rejoin-required',
          boundAt,
          updatedAt: nowIso(),
          lastCheckAt: nowIso(),
          failures: 0,
          ...(persisted.providerId === undefined ? {} : { providerId: persisted.providerId }),
          ...(persisted.toolNames === undefined ? {} : { toolNames: [...persisted.toolNames] }),
          baseUrl,
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        externalPeerLinkId: peerLinkId,
        activeBinderNames: new Set<string>(),
      })
      audit({ kind: 'bind', peer: peerLinkId, adapter: persisted.adapterId, ok: false, code: 'rejoin-required', detail: 'peer binding restored rejoin-required: the peer session token is not persisted; the ingress re-establishes it (the grant is on record)' })
      log('peer binding ' + id + ' restored rejoin-required: awaiting the ingress to re-establish the peer session (no new consent card; the grant is on record)')
    }
    for (const persisted of document.bindings) {
      if (persisted === null || typeof persisted !== 'object' || typeof persisted.adapterId !== 'string') continue
      if (persisted.external === true) {
        restoreExternalBinding(persisted)
        continue
      }
      const declaration = declarations.get(persisted.adapterId)
      if (declaration === undefined) {
        log('dropping the persisted binding of ' + persisted.adapterId + ': its declaration is gone')
        continue
      }
      if (version === 1) {
        keepRejoin(persisted, declaration, 'the persisted binding predates consent receipts (adapters.json version 1); connect again')
        continue
      }
      const problem = receiptProblem(persisted.receipt, persisted.adapterId, declaration)
      if (problem !== undefined) {
        keepRejoin(persisted, declaration, problem)
        continue
      }
      const receipt = persisted.receipt as PersistedReceipt
      const reading = await probeDeclaration(declaration, probeEnvironment)
      probes.set(persisted.adapterId, reading)
      const declaredCredential = declaration.connect?.credential
      const credential = reading.detected ? readCredential(declaration) : undefined
      let failure: string | undefined
      if (!reading.detected) {
        failure = reading.reason ?? 'adapter/' + String(reading.reasonCode)
      } else if (declaredCredential !== undefined && declaredCredential.kind !== 'none' && credential === undefined) {
        failure = 'the credential the person allowed is no longer readable at ' + credentialLocation(declaration)
      } else {
        const baseUrl = (reading.baseUrl ?? persisted.baseUrl ?? declaration.connect.baseUrl).replace(/\/+$/, '')
        try {
          await verifyDeclaration(declaration, baseUrl, credential)
        } catch (error) {
          failure = describeError(error)
        }
      }
      if (failure !== undefined) {
        keepRejoin(persisted, declaration, failure)
        continue
      }
      const baseUrl = (reading.baseUrl ?? (typeof persisted.baseUrl === 'string' ? persisted.baseUrl : declaration.connect.baseUrl)).replace(/\/+$/, '')
      const boundAt = typeof persisted.boundAt === 'string' ? persisted.boundAt : nowIso()
      live.set(persisted.adapterId, {
        state: {
          id: persisted.adapterId,
          adapterId: persisted.adapterId,
          caps: capsOf(persisted, declaration),
          status: 'active',
          boundAt,
          updatedAt: nowIso(),
          failures: 0,
          ...(persisted.providerId === undefined ? {} : { providerId: persisted.providerId }),
          ...(persisted.toolNames === undefined ? {} : { toolNames: [...persisted.toolNames] }),
          baseUrl,
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        ...(credential === undefined ? {} : { credential }),
        receipt,
        activeBinderNames: new Set<string>(),
      })
      audit({ kind: 'bind', adapter: persisted.adapterId, ok: true, code: 'restored-active', detail: baseUrl })
      log('adapter ' + persisted.adapterId + ' restored active from ' + stateFile)
    }
    await persist().catch((error: unknown) => log('adapters.json could not be rewritten after restore: ' + describeError(error)))
    publishAdapters()
    publishBindings()
  }

  /** Attach one capability binder. The binder is activated for already-active bindings too. */
  function addBinder(binder: CapabilityBinder): () => void {
    binders.push(binder)
    for (const record of [...live.values()]) {
      if (record.state.status !== 'active') continue
      if (!binder.caps.some((capability) => record.state.caps.includes(capability))) continue
      try {
        binder.activate(activationFor(record))
        record.activeBinderNames.add(binder.name)
      } catch (error) {
        markUnavailable(record, 'capability binder ' + binder.name + ' failed for adapter ' + record.state.adapterId + ': ' + describeError(error))
      }
    }
    return () => {
      const at = binders.indexOf(binder)
      if (at === -1) return
      binders.splice(at, 1)
      for (const record of [...live.values()]) {
        if (!record.activeBinderNames.delete(binder.name)) continue
        try {
          binder.deactivate(activationFor(record))
        } catch (error) {
          log('capability binder ' + binder.name + ' failed to release adapter ' + record.state.adapterId + ': ' + describeError(error))
        }
      }
    }
  }

  /** Start the 60s health sweep. Subsystem lifecycle, called by index.ts. */
  function start(): void {
    if (stopped || timer !== undefined) return
    timer = setInterval(() => {
      void healthCheckOnce().catch((error: unknown) => log('adapter health sweep failed: ' + describeError(error)))
    }, LIMITS.healthMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** Stop the health sweep and release every capability registration. Bindings stay persisted. */
  function stop(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    stopped = true
    for (const record of [...live.values()]) releaseBinding(record)
    binders.length = 0
  }

  await loadDeclarations()
  // One detection round at mount time: the pane must be able to name why an adapter is not
  // detected before the person clicks anything, so the adapter rows carry the last probe reading
  // from the first snapshot on. The loopback probes are read-only and bounded by the probe timeout.
  await probeAll()
  await restoreBindings()

  return {
    probeAll,
    probe,
    connect,
    disconnect,
    bindings,
    adapters,
    routes: () => [],
    start,
    stop,
    addBinder,
    healthCheckOnce,
    declaration: (adapterId: string) => declarations.get(adapterId),
    registerExternalBinding,
    releaseExternalBinding,
  }
}
