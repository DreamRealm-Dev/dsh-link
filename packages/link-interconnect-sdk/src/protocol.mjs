/**
 * link-interconnect/1 - the frozen ids, the error envelope and the manifest validator.
 *
 * This file mirrors plugins/dsh-link-interconnect/src/protocol/types.ts (the FROZEN contract).
 * It is plain ESM with no imports on purpose: the SDK runs on a bare node with no install step,
 * so external software can copy it as-is. test/sdk.test.mjs imports types.ts itself and compares
 * every id below against it, which makes this a checked mirror rather than a second authority.
 */

/** The protocol id. A peer whose major differs is refused with link/version-unsupported. */
export const PROTOCOL_ID = 'link-interconnect/1'
/** The major a peer must speak. Unknown minors are ignored, not refused. */
export const PROTOCOL_MAJOR = 1
/** The minor this build implements. */
export const PROTOCOL_MINOR = 0
/** The contract document version served at GET /link/v1/contract. */
export const CONTRACT_VERSION = '1.0.0'
/** The software-facing prefix the shell forwards to the kernel (src-tauri/src/core/proxy.rs). */
export const LINK_PREFIX = '/link/v1'

/** The one route table; nothing in this SDK spells a protocol path twice. */
export const ROUTES = Object.freeze({
  contract: LINK_PREFIX + '/contract',
  handshake: LINK_PREFIX + '/handshake',
  handshakeConfirm: LINK_PREFIX + '/handshake/confirm',
  invoke: LINK_PREFIX + '/invoke',
  events: LINK_PREFIX + '/events',
  embedToken: LINK_PREFIX + '/embed/token',
  embedSession: LINK_PREFIX + '/embed/session',
  openaiPrefix: LINK_PREFIX + '/openai',
  anthropicPrefix: LINK_PREFIX + '/anthropic',
  /** LINK's own declaration, so software can discover LINK by the same channel. */
  wellKnown: '/.well-known/link-interconnect.json',
})

/** Scopes a peer may be granted. deny-by-default: a capability needs its scope in the grant. */
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

/** Stable machine error codes. The code never changes with the sentence beside it. */
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

/** Protocol limits. Served in the contract; enforced where the complete value is known. */
export const LIMITS = Object.freeze({
  bodyBytes: 1024 * 1024,
  eventBacklog: 200,
  idempotencyMs: 10 * 60 * 1000,
  accessTokenMs: 15 * 60 * 1000,
  refreshTokenMs: 30 * 24 * 60 * 60 * 1000,
  embedTokenMs: 10 * 60 * 1000,
  rpm: 60,
  timeoutMs: 15 * 1000,
  healthMs: 60 * 1000,
  healthFailures: 3,
})

/** The HTTP status a stable code answers with; one table so server and client agree. */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.unauthorized]: 401,
  [ERROR_CODES.scopeMissing]: 403,
  [ERROR_CODES.versionUnsupported]: 400,
  [ERROR_CODES.consentRequired]: 403,
  [ERROR_CODES.peerUnavailable]: 503,
  [ERROR_CODES.rateLimited]: 429,
  [ERROR_CODES.payloadTooLarge]: 413,
  [ERROR_CODES.idempotencyConflict]: 409,
  [ERROR_CODES.badRequest]: 400,
  [ERROR_CODES.notFound]: 404,
  [ERROR_CODES.methodNotAllowed]: 405,
  [ERROR_CODES.internal]: 500,
})

/** The HTTP status for a stable code; an unknown (forward-compatible) code is a 500. */
export function statusForCode(code) {
  return STATUS_BY_CODE[code] ?? 500
}

/** One SDK failure, always carrying a stable protocol code so callers branch on data, not prose. */
export class LinkSdkError extends Error {
  constructor(code, message, status) {
    super(message === undefined || message === '' ? String(code) : String(message))
    this.name = 'LinkSdkError'
    this.code = typeof code === 'string' && code !== '' ? code : ERROR_CODES.internal
    this.status = Number.isInteger(status) ? status : statusForCode(this.code)
  }
}

/** True for a JSON object (not null, not an array). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deep clone through JSON, which is the whole manifest data model. */
export function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** Freeze a JSON tree so a served manifest cannot be mutated by a handler. */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Parse a protocol id of the form link-interconnect/<major>[.<minor>].
 * Returns {major, minor} or null when the string is not the protocol id.
 */
export function parseProtocolId(value) {
  if (typeof value !== 'string') return null
  const match = /^link-interconnect\/(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: match[2] === undefined ? 0 : Number(match[2]) }
}

const CAP_KINDS = new Set(Object.values(CAPS))
const LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/

function bad(message) {
  return new LinkSdkError(ERROR_CODES.badRequest, message)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isEndpointPath(value) {
  return typeof value === 'string' && value.startsWith('/') && value.length > 1
}

function endpointPath(value, fallback, at) {
  if (value === undefined) return fallback
  if (!isEndpointPath(value)) throw bad('manifest.' + at + ' must be an absolute path starting with "/"')
  return value
}

/**
 * Validate and normalise a peer manifest (the PeerManifest of the frozen contract).
 *
 * Defaults are filled where the contract allows them (endpoints, auth, tool call mapping, scopes,
 * limits), unknown capability kinds are accepted for forward compatibility (the protocol says an
 * unknown capability is ignored, never fatal), and everything obviously wrong throws a
 * LinkSdkError with a stable code: link/version-unsupported for a protocol major mismatch,
 * link/bad-request for everything else.
 *
 * @param {object} manifest - the PeerManifest to declare.
 * @returns {object} the frozen, normalised manifest to serve and to hand to serve().
 */
export function declare(manifest) {
  if (!isPlainObject(manifest)) throw bad('manifest must be a JSON object')
  const parsed = parseProtocolId(manifest.protocol)
  if (parsed === null) throw new LinkSdkError(ERROR_CODES.versionUnsupported, 'manifest.protocol must be ' + PROTOCOL_ID + ', got ' + JSON.stringify(manifest.protocol))
  if (parsed.major !== PROTOCOL_MAJOR) {
    throw new LinkSdkError(ERROR_CODES.versionUnsupported, 'manifest speaks protocol major ' + parsed.major + '; this SDK speaks ' + PROTOCOL_MAJOR)
  }

  if (!isPlainObject(manifest.identity)) throw bad('manifest.identity must be an object')
  const linkId = manifest.identity.linkId
  const name = manifest.identity.name
  if (!isNonEmptyString(linkId)) throw bad('manifest.identity.linkId must be a non-empty string')
  if (!LINK_ID_PATTERN.test(linkId)) throw bad('manifest.identity.linkId must be 1-128 characters of [A-Za-z0-9._:@-] starting alphanumeric, got ' + JSON.stringify(linkId))
  if (!isNonEmptyString(name) || name.length > 200) throw bad('manifest.identity.name must be a non-empty string of at most 200 characters')
  if (manifest.identity.vendor !== undefined && typeof manifest.identity.vendor !== 'string') throw bad('manifest.identity.vendor must be a string when present')

  const endpointsIn = manifest.endpoints === undefined ? {} : manifest.endpoints
  if (!isPlainObject(endpointsIn)) throw bad('manifest.endpoints must be an object when present')
  const endpoints = {
    invoke: endpointPath(endpointsIn.invoke, ROUTES.invoke, 'endpoints.invoke'),
    events: endpointPath(endpointsIn.events, ROUTES.events, 'endpoints.events'),
  }
  if (endpointsIn.models !== undefined) endpoints.models = endpointPath(endpointsIn.models, undefined, 'endpoints.models')

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) throw bad('manifest.capabilities must be a non-empty array')
  const capabilities = manifest.capabilities.map((capability, index) => declareCapability(capability, index))
  const toolNames = new Set()
  for (const capability of capabilities) {
    for (const tool of capability.tools ?? []) {
      if (toolNames.has(tool.name)) throw bad('two capabilities declare the same tool name ' + JSON.stringify(tool.name))
      toolNames.add(tool.name)
    }
  }

  let limits = {}
  if (manifest.limits !== undefined) {
    if (!isPlainObject(manifest.limits)) throw bad('manifest.limits must be an object when present')
    limits = declareLimits(manifest.limits)
  }

  return deepFreeze({
    protocol: manifest.protocol,
    identity: Object.assign({ linkId, name }, manifest.identity.vendor === undefined ? {} : { vendor: manifest.identity.vendor }),
    endpoints,
    capabilities,
    limits,
  })
}

function declareCapability(capability, index) {
  const at = 'manifest.capabilities[' + index + ']'
  if (!isPlainObject(capability)) throw bad(at + ' must be an object')
  if (!isNonEmptyString(capability.kind)) throw bad(at + '.kind must be a non-empty string')
  if (!Number.isInteger(capability.version) || capability.version < 1) throw bad(at + '.version must be an integer >= 1')
  const auth = capability.auth === undefined ? 'bearer' : capability.auth
  if (auth !== 'bearer' && auth !== 'none') throw bad(at + '.auth must be "bearer" or "none"')
  let scopes = capability.scopes === undefined ? [] : capability.scopes
  if (!Array.isArray(scopes) || scopes.some((scope) => !isNonEmptyString(scope))) throw bad(at + '.scopes must be an array of non-empty strings')
  scopes = [...new Set(scopes)]
  if (CAP_KINDS.has(capability.kind) && scopes.length === 0) scopes = [capability.kind]

  if (!CAP_KINDS.has(capability.kind)) {
    // Forward compatibility: a capability this SDK does not know is carried intact, never refused.
    const carried = Object.assign(clonePlain(capability), { auth, scopes })
    return carried
  }

  const declared = { kind: capability.kind, version: capability.version, auth, scopes }
  if (capability.kind === CAPS.toolsExpose) {
    if (!Array.isArray(capability.tools) || capability.tools.length === 0) throw bad(at + ' declares tools.expose but no tools')
    declared.tools = capability.tools.map((tool, toolIndex) => declareTool(tool, at + '.tools[' + toolIndex + ']', capability.kind))
  } else if (capability.tools !== undefined) {
    throw bad(at + ' declares tools but its kind is ' + JSON.stringify(capability.kind) + ', not ' + JSON.stringify(CAPS.toolsExpose))
  }
  if (capability.kind === CAPS.modelsProvide) {
    if (capability.models !== undefined) {
      if (!isPlainObject(capability.models)) throw bad(at + '.models must be an object when present')
      if (capability.models.path !== undefined && !isEndpointPath(capability.models.path)) throw bad(at + '.models.path must be an absolute path starting with "/"')
      declared.models = capability.models.path === undefined ? {} : { path: capability.models.path }
    }
  } else if (capability.models !== undefined) {
    throw bad(at + ' declares models but its kind is ' + JSON.stringify(capability.kind) + ', not ' + JSON.stringify(CAPS.modelsProvide))
  }
  return declared
}

function declareTool(tool, at, capabilityKind) {
  if (!isPlainObject(tool)) throw bad(at + ' must be an object')
  if (!isNonEmptyString(tool.name) || tool.name.length > 128) throw bad(at + '.name must be a non-empty string of at most 128 characters')
  if (tool.description !== undefined && typeof tool.description !== 'string') throw bad(at + '.description must be a string when present')
  if (tool.parameters !== undefined && !isPlainObject(tool.parameters)) throw bad(at + '.parameters must be a JSON Schema object when present')
  const call = tool.call === undefined ? { cap: capabilityKind, op: tool.name } : tool.call
  if (!isPlainObject(call) || !isNonEmptyString(call.cap) || !isNonEmptyString(call.op)) throw bad(at + '.call must be {cap, op} with non-empty strings')
  return {
    name: tool.name,
    description: tool.description === undefined ? '' : tool.description,
    parameters: clonePlain(tool.parameters === undefined ? { type: 'object', properties: {} } : tool.parameters),
    call: { cap: call.cap, op: call.op },
  }
}

function declareLimits(limits) {
  const declared = {}
  for (const [key, value] of Object.entries(limits)) {
    if (key === 'rpm' || key === 'bodyBytes') {
      if (!Number.isInteger(value) || value < 1) throw bad('manifest.limits.' + key + ' must be a positive integer')
      declared[key] = value
    } else {
      // A limit newer than this SDK: carried, not interpreted (unknown fields are ignored).
      declared[key] = clonePlain(value)
    }
  }
  return declared
}
