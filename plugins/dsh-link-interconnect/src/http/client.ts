/**
 * createClientRoutes - the in-app /api surface the client half polls.
 *
 * Every route is cookie-gated by the kernel's /api forwarding, answers JSON with no-store, and
 * uses the same method guard/refusal envelope as the software-facing protocol routes. One path is
 * ONE registered route: the kernel web server refuses duplicate (kind, path) pairs, so a path that
 * answers two verbs dispatches inside its handler and names both in Allow on a 405.
 *
 *   GET  /api/dsh-link-interconnect/state           -> PluginSnapshot
 *   GET  /api/dsh-link-interconnect/consent         -> pending consent questions
 *   POST /api/dsh-link-interconnect/consent         -> {id, decision} -> core.consent.decide
 *   GET  /api/dsh-link-interconnect/audit?limit=    -> audit records
 *   GET  /api/dsh-link-interconnect/adapters        -> snapshot().adapters
 *   POST /api/dsh-link-interconnect/adapters        -> {op:probe|connect|disconnect|revoke-peer, id}
 *   GET  /api/dsh-link-interconnect/settings        -> non-secret settings facts
 *
 * An adapter refusal is answered as its own named code with status 409 and details.reasonCode (a
 * client can act on it); only a real fault becomes 500 link/internal. No handler echoes a
 * credential: settings carries the linkId, data dir, limits and scopes, never a token or key.
 */

import { CONTRACT_VERSION, LIMITS, PROTOCOL_ID, ROUTES, SCOPES } from '../protocol/types.ts'
import type { BindingState, HttpIo, HttpRequest, HttpResponse, InterconnectCore, ProbeResult, RouteSpec, SnapshotProvider, Subsystem } from '../protocol/types.ts'
import { isLinkError, refuse } from '../protocol/errors.ts'
import { adapterRefusalBody } from '../adapters/runtime.ts'
import { createHttpIo } from './io.ts'
import { createRouteTable } from './routes.ts'

/** The adapter actions index.ts forwards into the client routes. */
export interface ClientActions {
  /** Probe every declaration now. */
  probeAll(): Promise<ProbeResult[]>
  /** Run the whole connect pipeline for one adapter id. */
  connect(id: string): Promise<BindingState>
  /** Remove one binding. */
  disconnect(id: string): Promise<void>
  /** Revoke one peer: grants, tokens and bindings. */
  revokePeer(id: string): Promise<{ ok: boolean }>
}

/** What createClientRoutes() takes. */
export interface ClientRoutesOptions {
  core: InterconnectCore
  snapshot: SnapshotProvider
  /** Adapter pipeline actions; routed POST /adapters answers 503 when absent. */
  actions?: ClientActions
  log?: (line: string) => void
}

const methodOf = (req: HttpRequest): string => String(req.method ?? 'GET').toUpperCase()

/**
 * Build the in-app routes.
 * @param options - core, snapshot provider, optional adapter actions and log.
 * @returns the client subsystem.
 */
export function createClientRoutes(options: ClientRoutesOptions): Subsystem {
  const core = options.core
  const log = options.log ?? core.log
  const io: HttpIo = createHttpIo()
  const table = createRouteTable(io, {
    onError(error) {
      log('client route failed: ' + String(error instanceof Error ? error.message : error))
    },
  })

  const requireActions = (): ClientActions => {
    if (options.actions === undefined) throw refuse('link/peer-unavailable', 'adapter actions are not wired yet')
    return options.actions
  }

  /** Answer one multi-verb path; 405 names every accepted verb when none matches. */
  const verbRoutes = (path: string, handlers: Record<string, (req: HttpRequest, res: HttpResponse) => void | Promise<void>>): RouteSpec =>
    table.anyExact(path, async (req, res) => {
      const handler = handlers[methodOf(req)]
      if (handler !== undefined) {
        await handler(req, res)
        return
      }
      const methods = Object.keys(handlers)
      res.setHeader('Allow', methods.join(', '))
      io.sendError(res, 405, 'link/method-not-allowed', 'method not allowed; use ' + methods.join(' or '))
    })

  /**
   * Answer an adapter action failure: a named adapter refusal becomes its own code at 409 with
   * details.reasonCode; a LinkError keeps its protocol status; anything else is a real fault.
   */
  const answerActionFailure = (error: unknown, res: HttpResponse): boolean => {
    if (isLinkError(error)) return false
    const body = adapterRefusalBody(error)
    if (body.error.code === 'adapter/internal') return false
    const reasonFromError = (error as { reasonCode?: unknown } | null)?.reasonCode
    const reasonCode = typeof reasonFromError === 'string' ? reasonFromError : body.error.code.includes('/') ? body.error.code.split('/')[1] : null
    io.sendJson(res, 409, { ok: false, error: { ...body.error, ...(reasonCode === null ? {} : { details: { reasonCode } }) } })
    return true
  }

  const routes: RouteSpec[] = [
    table.exact('GET', ROUTES.state, (_req, res) => {
      io.sendJson(res, 200, options.snapshot())
    }),
    verbRoutes(ROUTES.consent, {
      GET: (_req, res) => {
        io.sendJson(res, 200, { ok: true, pending: core.consent.listPending() })
      },
      POST: async (req, res) => {
        const body = await io.readJson(req)
        const id = typeof body.id === 'string' ? body.id : ''
        const decision = body.decision
        if (id === '') throw refuse('link/bad-request', 'id is required')
        if (decision !== 'granted' && decision !== 'denied') throw refuse('link/bad-request', 'decision must be granted or denied')
        if (!core.consent.decide(id, decision)) throw refuse('link/not-found', 'unknown consent request ' + id)
        io.sendJson(res, 200, { ok: true })
      },
    }),
    table.exact('GET', ROUTES.audit, (_req, res) => {
      const { query } = io.parseUrl(_req)
      const asked = Number(query.get('limit') ?? '100')
      const limit = Number.isFinite(asked) ? Math.min(500, Math.max(1, Math.floor(asked))) : 100
      io.sendJson(res, 200, { ok: true, records: core.audit.list(limit) })
    }),
    verbRoutes(ROUTES.adapters, {
      GET: (_req, res) => {
        io.sendJson(res, 200, { ok: true, adapters: options.snapshot().adapters })
      },
      POST: async (req, res) => {
        const body = await io.readJson(req)
        const op = typeof body.op === 'string' ? body.op : ''
        const id = typeof body.id === 'string' ? body.id : ''
        const actions = requireActions()
        try {
          if (op === 'probe') {
            io.sendJson(res, 200, { ok: true, result: await actions.probeAll() })
            return
          }
          if (op === 'connect' || op === 'disconnect' || op === 'revoke-peer') {
            if (id === '') throw refuse('link/bad-request', 'id is required for op ' + op)
            if (op === 'connect') {
              io.sendJson(res, 200, { ok: true, result: await actions.connect(id) })
              return
            }
            if (op === 'disconnect') {
              await actions.disconnect(id)
              io.sendJson(res, 200, { ok: true, result: { disconnected: true } })
              return
            }
            io.sendJson(res, 200, { ok: true, result: await actions.revokePeer(id) })
            return
          }
          throw refuse('link/bad-request', 'unknown adapters op ' + JSON.stringify(op) + '; use probe, connect, disconnect or revoke-peer')
        } catch (error) {
          if (answerActionFailure(error, res)) return
          throw error
        }
      },
    }),
    table.exact('GET', ROUTES.settings, (_req, res) => {
      io.sendJson(res, 200, {
        ok: true,
        linkId: core.identity.linkId,
        protocol: PROTOCOL_ID,
        contractVersion: CONTRACT_VERSION,
        dir: core.dir,
        pairingFile: core.dir + '/pairing.json',
        scopes: [...SCOPES],
        limits: { ...LIMITS },
        routes: ROUTES,
      })
    }),
  ]

  return {
    routes(): RouteSpec[] {
      return routes.slice()
    },
    async start(): Promise<void> {
      log('client routes ready (' + String(routes.length) + ')')
    },
  }
}
