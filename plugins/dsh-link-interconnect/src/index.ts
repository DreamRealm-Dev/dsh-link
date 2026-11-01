/**
 * dsh-link-interconnect - the assembly point.
 *
 * This is the ONLY file in the package allowed to touch the Cordis context. It builds the
 * protocol core, starts the declarative adapter runtime, wires the capability bindings, mounts
 * every subsystem's routes on the kernel web server (lazily, exactly like dsh-link-teams), and
 * disposes the whole tree with the row.
 *
 * Read order for a newcomer: docs/link-interconnect/PLAN.md -> ./protocol/types.ts -> this file.
 * The real work lives below this layer and is cordis-free on purpose, so the protocol core and the
 * adapter runtime can be unit-tested with tsx and reused by the SDK.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createProtocolServer } from './protocol/server.ts'
import { createClientRoutes } from './http/client.ts'
import { createAdapterRuntime } from './adapters/runtime.ts'
import { createPeerIngress } from './adapters/ingress.ts'
import { createEmbedSubsystem } from './bind/embed.ts'
import { createProxySubsystem } from './bind/proxy.ts'
import { bindModels } from './bind/models.ts'
import { bindTools } from './bind/tools.ts'
import { API_PREFIX, CONTRACT_VERSION, DATA_DIR_NAME, ERROR_CODES, PROTOCOL_ID } from './protocol/types.ts'
import type { BindHosts, PluginSnapshot, RouteSpec, Subsystem } from './protocol/types.ts'
import type { ProxyUpstream, ProxyUpstreamAnswer } from './bind/proxy.ts'

/** The plugin name the bundle row mounts. */
export const name = 'dsh-link-interconnect'

/** Nothing is injected at apply time: every service is looked up lazily and waited for. */
export const inject = []

/** Row configuration. */
export interface Config {
  /** Absolute data-directory override. Default: <DSH_HOME>/link-interconnect. */
  dataDir?: string
}

/** The package root, so adapters/<id>/adapter.json is found from a built lib/index.js too. */
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ADAPTERS = join(PLUGIN_ROOT, 'adapters')

/**
 * The harness home. $DSH_HOME is the process policy the kernel boots with; the homedir fallback
 * matches @deepseek-ai/dsh-home-paths, so a hand-built context still lands in one place.
 * @returns the absolute kernel home.
 */
function kernelHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/**
 * Resolve the one data directory the framework owns.
 * @param config - row config.
 * @returns the absolute data directory.
 */
function dataDirOf(config?: Config): string {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim() !== '') return resolve(config.dataDir)
  return join(kernelHome(), DATA_DIR_NAME)
}

/**
 * The LAN allowlist: hosts (or host:port authorities) a software peer may be reached at beyond
 * loopback. Two sources, both explicit: <data dir>/lan-allowlist.json as {"hosts": [...]}, and the
 * LINK_PEER_ALLOWLIST environment variable as a comma-separated list. Empty means loopback only.
 * @param dataDir - the plugin data directory.
 * @returns the raw entries (normalized by the ingress).
 */
function loadPeerAllowlist(dataDir: string): string[] {
  const entries: string[] = []
  const fromEnv = (process.env.LINK_PEER_ALLOWLIST ?? '').trim()
  if (fromEnv !== '') entries.push(...fromEnv.split(','))
  try {
    const file = join(dataDir, 'lan-allowlist.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { hosts?: unknown }
    if (Array.isArray(parsed.hosts)) entries.push(...parsed.hosts.filter((host): host is string => typeof host === 'string'))
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    // @ts-expect-error R498: `log` is not in scope here — a pre-existing latent ReferenceError on the
    // non-ENOENT read path, kept byte-identical this round (types-only migration); flagged in the R498 record.
    if (code !== 'ENOENT') log('lan-allowlist.json is unreadable (' + String((error as { message?: string } | null)?.message ?? error) + '); loopback only')
  }
  return entries
}

/**
 * The proxy's upstream channel, from deployment environment.
 *
 * LINK_PROXY_UPSTREAM_URL names one OpenAI-compatible base URL ("http://127.0.0.1:18900"),
 * LINK_PROXY_UPSTREAM_KEY is the bearer that channel expects. Both are read once per apply; an
 * empty URL yields an upstream that answers 503 rather than a proxy that silently fails.
 * @param log - the plugin log.
 * @returns the upstream the proxy subsystem calls.
 */
function envUpstream(log: (line: string) => void): ProxyUpstream {
  const baseUrl = (process.env.LINK_PROXY_UPSTREAM_URL ?? '').trim().replace(/\/+$/, '')
  const apiKey = (process.env.LINK_PROXY_UPSTREAM_KEY ?? '').trim()
  if (baseUrl === '') {
    log('models.proxy has no upstream (LINK_PROXY_UPSTREAM_URL is unset): proxy calls answer 503 link/peer-unavailable')
    return {}
  }
  log('models.proxy upstream channel: ' + baseUrl)
  /** One passthrough call; the raw proxy key never reaches the upstream (the key id is audited instead). */
  const call = async (path: string, method: string, body: unknown, signal?: AbortSignal): Promise<ProxyUpstreamAnswer> => {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
      if (apiKey !== '') headers.authorization = 'Bearer ' + apiKey
      const answer = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      } as RequestInit)
      const forwarded: Record<string, string> = {}
      for (const name of ['content-type', 'retry-after']) {
        const value = answer.headers.get(name)
        if (value !== null) forwarded[name] = value
      }
      const text = await answer.text()
      return { status: answer.status, headers: forwarded, body: text }
    } catch (error) {
      return {
        status: 502,
        body: { error: { code: 'link/peer-unavailable', message: 'upstream channel unreachable: ' + String((error as { message?: string } | null)?.message ?? error) } },
      }
    }
  }
  return {
    openai: (body, context) => call('/v1/chat/completions', 'POST', body, context.signal),
    anthropic: (body, context) => call('/v1/messages', 'POST', body, context.signal),
    listModels: (context) => call('/v1/models', 'GET', undefined, context.signal),
  }
}

/** Look one service up without the property proxy's topology sensitivity. */
function serviceOf(ctx: any, service: string): any {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(service) : undefined
  } catch (error) {
    return undefined
  }
}

/** Drop one disposer whether it is sync or async. */
function release(dispose: unknown): void {
  if (typeof dispose !== 'function') return
  try {
    const answer = dispose()
    if (answer !== null && typeof answer === 'object' && typeof (answer as Promise<void>).then === 'function') {
      void (answer as Promise<void>).catch(() => {})
    }
  } catch (error) {
    /* a route or registration that is already gone is not an error worth reporting */
  }
}

/**
 * Mount the software interconnect framework.
 * @param ctx - the host plugin context.
 * @param config - resolved row config.
 */
export async function apply(ctx: any, config?: Config): Promise<void> {
  const log = (line: string) => console.log('[dsh-link-interconnect] ' + line)
  const home = kernelHome()
  const dataDir = dataDirOf(config)
  const disposers: Array<() => void> = []
  const subsystems: Subsystem[] = []
  let bound = false

  const protocol = await createProtocolServer({ home, dataDir, log })
  const { core } = protocol
  subsystems.push(protocol)

  const hosts: BindHosts = {
    llm: () => serviceOf(ctx, 'llm'),
    tools: () => serviceOf(ctx, 'tools'),
  }
  const runtime = await createAdapterRuntime({ core, adaptersDir: PLUGIN_ADAPTERS, hosts, log })
  subsystems.push(runtime)

  /**
   * The one document the client half polls. Everything it draws comes from here, and every fact
   * is the subsystem's own answer at the moment of the call - nothing is cached in this file.
   * @returns the current snapshot.
   */
  const snapshot = (): PluginSnapshot => {
    const peers = core.peers.list()
    const grants = core.grants.list()
    const pendingConsent = core.consent.listPending()
    const bindings = runtime.bindings()
    const adapters = runtime.adapters()
    return {
      protocol: PROTOCOL_ID,
      contractVersion: CONTRACT_VERSION,
      linkId: core.identity.linkId,
      at: new Date().toISOString(),
      peers,
      grants,
      pendingConsent,
      bindings,
      adapters,
      audit: core.audit.list(20),
      counts: {
        peers: peers.length,
        activePeers: peers.filter((peer) => peer.status === 'active').length,
        bindings: bindings.length,
        activeBindings: bindings.filter((binding) => binding.status === 'active').length,
        pendingConsent: pendingConsent.length,
      },
    }
  }

  const actions = {
    probeAll: () => runtime.probeAll(),
    connect: (id: string) => runtime.connect(id),
    disconnect: (id: string) => runtime.disconnect(id),
    revokePeer: async (id: string) => {
      const ok = core.grants.revoke(id)
      if (ok) core.peers.update(id, { status: 'revoked' })
      core.events.publish({ type: 'interconnect/peers', at: new Date().toISOString() })
      core.audit.record({ kind: 'revoke', peer: id, ok })
      return { ok }
    },
  }

  const clientRoutes = createClientRoutes({ core, snapshot, actions, log })
  subsystems.push(clientRoutes)

  disposers.push(bindModels({ core, runtime, hosts, log }))
  disposers.push(bindTools({ core, runtime, hosts, log }))

  // M3: the software-active direction. A peer is added by its origin URL, asked about once, and
  // then its declared tools/models are bound through the same seams the declarative adapters use.
  // M6: a non-loopback origin must be named by the LAN allowlist (deny by default).
  const peerAllowlist = loadPeerAllowlist(dataDir)
  subsystems.push(createPeerIngress({ core, io: protocol.io, hosts, runtime, peerAllowlist, log }))
  log('peer discovery policy: loopback always; LAN allowlist ' + (peerAllowlist.length === 0 ? 'empty (loopback only)' : peerAllowlist.length + ' entr(y/ies)'))

  // M4: the session-embed surface (short-lived token, audience = the host origin).
  subsystems.push(createEmbedSubsystem({ core, io: protocol.io, log }))

  // M5: the model reverse proxy. The upstream is deployment config, not a constant: a person who
  // wants software to call this LINK's models names one OpenAI-compatible channel here. Without
  // it every proxy call answers 503 link/peer-unavailable instead of pretending to work.
  const proxy = createProxySubsystem({ core, io: protocol.io, log, upstream: envUpstream(log) })
  subsystems.push(proxy)

  // The proxy key ledger is administered from this app only (the client half is cookie-gated under
  // /api). A raw key is returned exactly once, at creation; the ledger stores sha256 only.
  const proxyKeyRoute: RouteSpec = {
    kind: 'exact',
    path: API_PREFIX + '/proxy-keys',
    handler: async (req, res) => {
      const io = protocol.io
      try {
        if (req.method === 'GET') {
          io.sendJson(res, 200, { ok: true, result: proxy.listKeys() })
          return
        }
        if (req.method !== 'POST') {
          res.setHeader('allow', 'GET, POST')
          io.sendError(res, 405, ERROR_CODES.methodNotAllowed, 'proxy keys are read with GET and written with POST')
          return
        }
        const body = await io.readJson(req)
        const op = String(body.op ?? 'create')
        if (op === 'create') {
          const models = Array.isArray(body.models) ? body.models.map((model: unknown) => String(model)) : []
          const created = proxy.createKey({
            label: String(body.label ?? 'peer'),
            models: models.length === 0 ? ['*'] : models,
            rpm: typeof body.rpm === 'number' ? body.rpm : undefined,
          })
          core.audit.record({ kind: 'consent', cap: 'models.proxy', op: 'proxy-key-create', ok: true, detail: created.id })
          io.sendJson(res, 200, { ok: true, result: created })
          return
        }
        if (op === 'revoke') {
          const revoked = proxy.revokeKey(String(body.id ?? ''))
          core.audit.record({ kind: 'revoke', cap: 'models.proxy', op: 'proxy-key-revoke', ok: revoked, detail: String(body.id ?? '') })
          io.sendJson(res, 200, { ok: true, result: { revoked } })
          return
        }
        io.sendError(res, 400, ERROR_CODES.badRequest, 'unknown proxy-key op ' + op)
      } catch (error) {
        io.sendError(res, 500, ERROR_CODES.internal, String((error as { message?: string } | null)?.message ?? error))
      }
    },
  }
  // Token revocation is an administrative fact the embed/page owner needs after a grant is
  // withdrawn; the jti is unguessable and the route is cookie-gated like every other /api path
  // here, so it names what to kill without minting anything.
  const tokenRevokeRoute: RouteSpec = {
    kind: 'exact',
    path: API_PREFIX + '/tokens/revoke',
    handler: async (req, res) => {
      const io = protocol.io
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        io.sendError(res, 405, ERROR_CODES.methodNotAllowed, 'token revocation is POST')
        return
      }
      try {
        const body = await io.readJson(req)
        const jti = String(body.jti ?? '')
        if (jti === '') {
          io.sendError(res, 400, ERROR_CODES.badRequest, 'body.jti is required')
          return
        }
        core.tokens.revoke(jti)
        core.audit.record({ kind: 'revoke', ok: true, op: 'token-revoke', detail: jti })
        io.sendJson(res, 200, { ok: true, result: { revoked: jti } })
      } catch (error) {
        io.sendError(res, 500, ERROR_CODES.internal, String((error as { message?: string } | null)?.message ?? error))
      }
    },
  }
  subsystems.push({ routes: () => [proxyKeyRoute, tokenRevokeRoute] })

  for (const subsystem of subsystems) {
    if (typeof subsystem.start === 'function') await subsystem.start()
  }

  /** Bind every subsystem's routes the first time a web server is visible. */
  const mount = (): void => {
    if (bound) return
    const webServer = serviceOf(ctx, 'webServer')
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return
    let routes = 0
    for (const subsystem of subsystems) {
      for (const route of subsystem.routes()) {
        try {
          // Register NOW and keep only the disposer: wrapping the register() call itself in the
          // disposer (the first version of this line did) registers nothing at boot and binds
          // every route at shutdown instead, which reads as "all routes 404" from outside.
          const dispose = webServer.register(route)
          disposers.push(() => release(dispose))
          routes += 1
        } catch (error) {
          log('route ' + route.path + ' was not bound: ' + String((error as { message?: unknown } | null)?.message ?? error))
        }
      }
    }
    bound = true
    log(PROTOCOL_ID + ' ready - identity ' + core.identity.linkId + ', ' + String(routes) + ' route(s), ' + String(runtime.bindings().length) + ' binding(s)')
  }
  mount()
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], () => mount())

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const subsystem of subsystems.slice().reverse()) release(subsystem.stop)
      for (const dispose of disposers.splice(0).reverse()) release(dispose)
    }, 'dsh-link-interconnect: protocol core, adapter runtime and capability bindings')
  }

  log('v' + CONTRACT_VERSION + ' data=' + dataDir + ' adapters=' + PLUGIN_ADAPTERS)
}

export default { name, inject, apply }
