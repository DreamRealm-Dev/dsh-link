/**
 * tools.expose binding for software peers (M3 软件主动适配).
 *
 * A peer that declares tools.expose in its well-known manifest gets one kernel tool per declared
 * ToolDeclaration: the declaration's name, description and parameters JSON Schema, plus a handler
 * that POSTs {cap, op, args} to the peer's declared endpoints.invoke with the LINK-minted bearer
 * token and maps the protocol envelope back to a tool result.
 *
 *   { ok: true, result }                  -> the tool's canonical JSON value
 *   { ok: false, error: { code, message } } -> a thrown tool error naming the stable code
 *
 * The token only ever becomes an Authorization header: it is never logged, never rendered and
 * never placed on a tool error. This module is cordis-free (types.ts rule 1), so the unit suite
 * imports it directly and the ingress factory reuses it unchanged.
 */
import { CAPS, LIMITS, ROUTES } from '../protocol/types.ts'
import type { ToolDeclaration } from '../protocol/types.ts'

/** One registered kernel tool definition, structurally (matches the kernel ToolDefinition). */
export interface PeerToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  output: { schema: Record<string, any>; render(args: unknown, value: unknown): Array<Record<string, unknown>> }
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

/** The kernel tools registry as far as this binder needs it. */
export interface PeerToolsHost {
  register(definition: PeerToolDefinition): () => void
}

/** The facts one peer invoke needs. The token never leaves this process except as a header. */
export interface PeerInvokeTarget {
  /** The peer's immutable linkId (the token subject). */
  peerLinkId: string
  /** The peer's absolute origin, e.g. "http://127.0.0.1:41000" (no trailing slash). */
  origin: string
  /** The absolute invoke path from endpoints.invoke; defaults to the protocol ROUTES.invoke. */
  invokePath?: string | undefined
  /** The LINK-minted compact JWS, sized to LIMITS.accessTokenMs and scoped to the declared caps. */
  token: string
  /** One request timeout in ms; defaults to LIMITS.timeoutMs. */
  timeoutMs?: number
}

/** How one invoke performs its fetch; injectable so tests never need a real socket. */
export type PeerFetch = typeof fetch

/** One sentence for a thrown value, safe to log: it carries no token. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The model-wire name rule every provider accepts (OpenAI tool names are [A-Za-z0-9_-]{1,64}).
 *
 * This is load-bearing, not cosmetics: a registration under a declared name with a dot is accepted
 * by the kernel registry but poisons the provider request, which answers 400 INVALID_REQUEST for the
 * WHOLE turn (measured live: a peer tool named echo.ping broke every agent turn until it was
 * removed). Declarations keep their own names; registrations get a provider-safe one.
 */
const MODEL_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u

/**
 * Map one declared tool name to a provider-safe kernel tool name.
 * @param declared - the name the peer declared, e.g. "echo.ping".
 * @param taken - names already used by the same peer; the answer is added to it.
 * @returns a name matching [A-Za-z0-9_-]{1,64}, unique within the peer.
 */
export function peerToolName(declared: string, taken?: Set<string>): string {
  const cleaned = String(declared).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  const base = cleaned === '' ? 'peer_tool' : /^[A-Za-z0-9]/.test(cleaned) ? cleaned : 't_' + cleaned
  if (taken === undefined) return base
  let name = base
  let suffix = 2
  while (taken.has(name)) {
    const room = 64 - String(suffix).length - 1
    name = base.slice(0, room) + '_' + String(suffix)
    suffix += 1
  }
  taken.add(name)
  return name
}

/** Render one peer JSON result as model-facing text without inventing structure. */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? String(value) : text
}

/**
 * The absolute URL one peer tool call POSTs to.
 * @param target - origin plus the declared invoke path.
 * @returns origin + invoke path with exactly one slash between them.
 */
export function peerInvokeUrl(target: PeerInvokeTarget): string {
  const path = target.invokePath === undefined || target.invokePath === '' ? ROUTES.invoke : target.invokePath
  const absolute = path.startsWith('/') ? path : '/' + path
  return target.origin.replace(/\/+$/, '') + absolute
}

/**
 * The invoke body one declared tool maps to.
 * @param tool - the declaration (its call mapping or the tools.expose default).
 * @param args - the kernel tool arguments.
 * @returns the protocol {cap, op, args} body.
 */
export function peerInvokeBody(tool: ToolDeclaration, args: unknown): { cap: string; op: string; args: unknown } {
  const call = tool.call ?? { cap: CAPS.toolsExpose, op: tool.name }
  return { cap: call.cap, op: call.op, args: args === undefined ? {} : args }
}

/**
 * The one invoke request one declared tool makes.
 * @param target - peer origin, token and timeout.
 * @param tool - the declared tool.
 * @param args - the kernel tool arguments.
 * @returns the URL, headers (including the bearer token) and JSON body.
 */
export function peerInvokeRequest(target: PeerInvokeTarget, tool: ToolDeclaration, args: unknown): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: peerInvokeUrl(target),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer ' + target.token,
    },
    body: JSON.stringify(peerInvokeBody(tool, args)),
  }
}

/**
 * Invoke one declared peer tool, mapping the protocol envelope to a tool result.
 *
 * A transport failure answers a thrown "link/peer-unavailable: ..." error, a refused envelope
 * answers a thrown "<code>: <message>" naming the peer's stable code, and {ok:true} answers its
 * result (undefined becomes null). A caller cancellation is forwarded to the fetch.
 *
 * @param target - peer origin, bearer token and timeout.
 * @param tool - the declared tool to call.
 * @param args - the kernel tool arguments.
 * @param options - fetch seam and the kernel call's abort signal.
 * @returns the peer's canonical result value.
 */
export async function invokePeerTool(
  target: PeerInvokeTarget,
  tool: ToolDeclaration,
  args: unknown,
  options: { fetch?: PeerFetch | undefined; signal?: AbortSignal | undefined } = {},
): Promise<unknown> {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = target.timeoutMs !== undefined && target.timeoutMs > 0 ? target.timeoutMs : LIMITS.timeoutMs
  const request = peerInvokeRequest(target, tool, args)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('the peer request exceeded ' + String(timeoutMs) + ' ms')), timeoutMs)
  const onAbort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: 'error',
    })
  } catch (error) {
    if (options.signal?.aborted === true) throw error
    throw new Error('link/peer-unavailable: ' + request.url + ' did not answer (' + describeError(error) + ')')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (options.signal?.aborted === true) throw error
    throw new Error('link/peer-unavailable: the answer from ' + request.url + ' was unreadable (' + describeError(error) + ')')
  }
  let envelope: { ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } } | undefined
  if (text.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) envelope = parsed as typeof envelope
    } catch {
      envelope = undefined
    }
  }
  if (envelope !== undefined && envelope.ok === false) {
    const code = typeof envelope.error?.code === 'string' && envelope.error.code !== '' ? envelope.error.code : 'link/internal'
    const message = typeof envelope.error?.message === 'string' && envelope.error.message !== '' ? envelope.error.message : 'the peer refused the call'
    throw new Error(code + ': ' + message)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error('link/peer-unavailable: the peer answered HTTP ' + String(response.status) + ' for ' + JSON.stringify(tool.name))
  }
  if (envelope === undefined || envelope.ok !== true) {
    throw new Error('link/internal: the peer answered no protocol envelope for ' + JSON.stringify(tool.name))
  }
  return envelope.result === undefined ? null : envelope.result
}

/**
 * Build the async handler one registered tool runs: one invoke, mapped to a tool result.
 * @param target - peer origin, bearer token and timeout.
 * @param tool - the declared tool.
 * @param options - fetch seam.
 * @returns an execute-shaped function (args, exec).
 */
export function createPeerToolHandler(
  target: PeerInvokeTarget,
  tool: ToolDeclaration,
  options: { fetch?: PeerFetch | undefined } = {},
): (args: unknown, exec?: { signal?: AbortSignal }) => Promise<unknown> {
  return async (args, exec) => invokePeerTool(target, tool, args, { fetch: options.fetch, signal: exec?.signal })
}

/**
 * Build the kernel tool definition for one declared peer tool.
 * @param target - peer origin, bearer token and timeout.
 * @param tool - the declared tool (name, description, parameters JSON Schema, call mapping).
 * @param options - fetch seam.
 * @returns the definition handed to hosts.tools().register().
 */
export function createPeerToolDefinition(
  target: PeerInvokeTarget,
  tool: ToolDeclaration,
  options: { fetch?: PeerFetch | undefined } = {},
): PeerToolDefinition {
  const parameters =
    tool.parameters !== null && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters)
      ? tool.parameters
      : { type: 'object', properties: {} }
  const publicName = peerToolName(tool.name)
  const declaredNote = MODEL_TOOL_NAME.test(tool.name) ? '' : ' (peer tool ' + tool.name + ')'
  return {
    name: publicName,
    description: (typeof tool.description === 'string' ? tool.description : '') + declaredNote,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderValue(value) }],
    },
    execute: createPeerToolHandler(target, tool, options),
  }
}

/** What registerPeerTools() needs. */
export interface RegisterPeerToolsOptions {
  /** The kernel tools registry. */
  host: PeerToolsHost
  /** Peer origin, bearer token and timeout for every declared tool. */
  target: PeerInvokeTarget
  /** The declarations read from the peer manifest. */
  declarations: ToolDeclaration[]
  /** Fetch seam for tests. */
  fetch?: PeerFetch | undefined
  /** One line into the plugin log. */
  log?(line: string): void
}

/**
 * Register every declared tool of one peer and return the one disposer.
 * A registration throw releases the registrations already made and rethrows, so the caller's
 * addPeer() rollback never leaves a half-bound tool set.
 * @param options - host, target, declarations, fetch seam and log.
 * @returns the disposer that unregisters every tool of this peer.
 */
export function registerPeerTools(options: RegisterPeerToolsOptions): () => void {
  const log = options.log ?? (() => {})
  const disposers: Array<() => void> = []
  const taken = new Set<string>()
  try {
    for (const tool of options.declarations) {
      const definition = createPeerToolDefinition(options.target, tool, { fetch: options.fetch })
      // Names are unique per peer on the model wire even when two declarations collide after
      // sanitizing (a.b and a-b both map to a_b).
      definition.name = peerToolName(tool.name, taken)
      disposers.push(options.host.register(definition))
    }
  } catch (error) {
    for (const dispose of disposers.slice().reverse()) {
      try {
        dispose()
      } catch {
        /* the registration failure is the one being reported */
      }
    }
    throw error
  }
  log('tools registered from peer ' + options.target.peerLinkId + ': ' + options.declarations.map((tool) => tool.name).join(', '))
  return () => {
    for (const dispose of disposers.slice().reverse()) {
      try {
        dispose()
      } catch (error) {
        log('releasing a tool of peer ' + options.target.peerLinkId + ' failed: ' + describeError(error))
      }
    }
  }
}
