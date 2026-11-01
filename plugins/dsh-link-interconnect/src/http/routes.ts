/**
 * One route-table factory: every handler in the protocol goes through it.
 *
 * The wrapper applies the method guard, translates any thrown LinkError into the stable
 * { ok: false, error: { code, message } } envelope, and reports unexpected failures to the
 * caller's log. Handlers then only carry their own logic.
 */

import { asLinkError, sendLinkError } from '../protocol/errors.ts'
import type { HttpIo, RouteHandler, RouteSpec } from '../protocol/types.ts'

/** The route builders one subsystem uses. */
export interface RouteTable {
  /** One exact path answering one verb. */
  exact(method: string, path: string, handler: RouteHandler): RouteSpec
  /** One prefix path (p and p/<anything>) answering one verb. */
  prefix(method: string, path: string, handler: RouteHandler): RouteSpec
  /** One exact path answering any verb (the handler guards). */
  anyExact(path: string, handler: RouteHandler): RouteSpec
  /** One prefix answering any verb (the handler guards). */
  anyPrefix(path: string, handler: RouteHandler): RouteSpec
}

/**
 * Build the route table.
 * @param io - the shared helpers, used for the method guard and refusal envelope.
 * @param options - optional onError sink for unexpected failures.
 * @returns the builders.
 */
export function createRouteTable(io: HttpIo, options: { onError?: (error: unknown, req: unknown) => void } = {}): RouteTable {
  const wrap = (kind: 'exact' | 'prefix', method: string | undefined, path: string, handler: RouteHandler): RouteSpec => ({
    kind,
    path,
    handler: async (req, res) => {
      try {
        if (method !== undefined && !io.requireMethod(req, res, method)) return
        await handler(req, res)
      } catch (error) {
        const linkError = asLinkError(error)
        if (options.onError !== undefined && linkError.status >= 500) options.onError(error, req)
        if ((res as { headersSent?: boolean }).headersSent === true) {
          try { res.end() } catch { /* the answer is already on the wire */ }
          return
        }
        sendLinkError(res, linkError)
      }
    },
  })
  return {
    exact: (method, path, handler) => wrap('exact', method, path, handler),
    prefix: (method, path, handler) => wrap('prefix', method, path, handler),
    anyExact: (path, handler) => wrap('exact', undefined, path, handler),
    anyPrefix: (path, handler) => wrap('prefix', undefined, path, handler),
  }
}
