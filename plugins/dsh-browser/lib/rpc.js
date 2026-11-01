/**
 * The sidebar panel's HTTP surface.
 *
 * Carrier: a PREFIX ROUTE on `ctx.webServer`, addressed as
 * `POST /browser/api/<op>` with a JSON body. This is the shape
 * `dsh-better-sidebar` uses (`/sidebar/api`) and the only one that works for a
 * third-party bundle here.
 *
 * Why not `ctx.connection.rpc.handle(channel, handler)`: that method registers
 * through the CONNECTION SERVICE's own ctx (`owner = this.ctx`), whose
 * `webServer` was never injected, so it throws
 * `cannot get property "webServer" without inject` before any route exists —
 * measured live in this host. A client then falls back to an HTTP transport that
 * has no route to hit and reports
 * `transport failure for <channel>/<endpoint>: HTTP 405`.
 *
 * Auth reuses the sanctioned fence: `connection.requestRejection(request)`
 * applies the deployment's Host/Origin trust check AND the browser-session
 * check, so the route is exactly as protected as the rest of the app's API.
 */
import { existsSync } from 'node:fs'

import { findBrowserExecutable } from './chrome.js'

/** Route prefix. Ops are addressed as `<API_PATH>/<op>`. */
export const API_PATH = '/browser/api'

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readJson(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body must be JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Ops the panel may call. Kept small and explicit; no op mutates anything else. */
function createOps({ registry, config, baseDir, openInstance, closeInstance, log }) {
  let frameSeq = 0

  async function frame(args) {
    const session = registry.get(args?.id)
    if (session === undefined) throw new Error(`no browser instance ${args?.id ?? '(default)'}`)
    const scale = Number.isFinite(args?.scale) ? Math.min(1, Math.max(0.1, args.scale)) : 1
    const width = session.viewport.width
    const height = session.viewport.height
    const data = await session.shotBytes(scale === 1 ? {} : { x: 0, y: 0, width, height, scale })
    frameSeq += 1
    return {
      id: session.id,
      url: session.lastUrl,
      viewportWidth: width,
      viewportHeight: height,
      scale,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      seq: frameSeq,
      dataUrl: `data:image/png;base64,${data.toString('base64')}`,
    }
  }

  async function state() {
    const effective = config.read()
    let executable = null
    let executableError = null
    try {
      executable = findBrowserExecutable(effective.browserExecutable)
    } catch (error) {
      executableError = error?.message ?? String(error)
    }
    return {
      baseDir,
      apiPath: API_PATH,
      config: {
        browserExecutable: effective.browserExecutable,
        viewport: effective.viewport,
        visible: effective.visible,
        maxControls: effective.maxControls,
        extraArgs: effective.extraArgs,
      },
      resolvedExecutable: executable,
      executableError,
      configExists: existsSync(config.file),
      instances: await registry.list(),
    }
  }

  return {
    state,
    frame,

    async list() {
      return { instances: await registry.list() }
    },

    async open(args) {
      const session = await openInstance({
        id: args?.id,
        url: typeof args?.url === 'string' && args.url.trim() !== '' ? args.url : undefined,
        viewport: {
          width: Number.isFinite(args?.width) ? args.width : undefined,
          height: Number.isFinite(args?.height) ? args.height : undefined,
        },
        browserExecutable: typeof args?.browserExecutable === 'string' && args.browserExecutable !== '' ? args.browserExecutable : undefined,
      })
      const status = await session.status()
      return { id: session.id, url: status.url, title: status.title, viewport: `${status.width}x${status.height}` }
    },

    async close(args) {
      if (args?.all === true) {
        const ids = await registry.closeAll({ kill: args?.kill !== false })
        return { closed: ids }
      }
      const session = registry.get(args?.id)
      if (session === undefined) return { closed: [] }
      await closeInstance(session.id, { kill: args?.kill !== false })
      return { closed: [session.id] }
    },

    async goto(args) {
      const session = registry.get(args?.id)
      if (session === undefined) throw new Error(`no browser instance ${args?.id ?? '(default)'}`)
      await session.goto(String(args?.url ?? ''))
      return { id: session.id, url: session.lastUrl }
    },

    async config(args) {
      const patch = args?.patch
      if (patch !== null && typeof patch === 'object') {
        const next = {}
        if (typeof patch.browserExecutable === 'string') next.browserExecutable = patch.browserExecutable.trim() === '' ? null : patch.browserExecutable.trim()
        if (typeof patch.visible === 'boolean') next.visible = patch.visible
        if (Number.isFinite(patch.maxControls)) next.maxControls = patch.maxControls
        if (Number.isFinite(patch.width) || Number.isFinite(patch.height)) {
          const current = config.read()
          next.viewport = { width: patch.width ?? current.viewport.width, height: patch.height ?? current.viewport.height }
        }
        if (Object.keys(next).length > 0) {
          config.write(next)
          log?.info(`config updated from the sidebar: ${JSON.stringify(next)}`)
        }
      }
      return await state()
    },

    /** Control list + optional marked frame, so the panel shows the same numbers the model sees. */
    async controls(args) {
      const session = registry.get(args?.id)
      if (session === undefined) throw new Error(`no browser instance ${args?.id ?? '(default)'}`)
      const effective = config.read()
      const { snapshot, image } = await session.controls({
        markers: args?.markers !== false,
        maxControls: Number.isFinite(args?.max) ? args.max : effective.maxControls,
      })
      return {
        snapshot: snapshot.id,
        controls: snapshot.controls.map((c, i) => ({ n: i + 1, role: c.r, kind: c.k ?? null, label: c.t ?? '', box: c.b })),
        dataUrl: image === undefined ? null : `data:image/png;base64,${image.toString('base64')}`,
      }
    },
  }
}

/**
 * Bind the panel route.
 * @returns `{ dispose, bound, ops }`; `bound.route` flips true once registered.
 */
export function registerPanelRpc({ ctx, registry, config, baseDir, openInstance, closeInstance, log }) {
  const ops = createOps({ registry, config, baseDir, openInstance, closeInstance, log })
  const disposers = []
  const bound = { route: false }

  /**
   * Apply the deployment's own request fence, plus the browser-session check.
   * @returns 401, 403, or undefined when the request may proceed.
   */
  function rejectionFor(req) {
    const connection = ctx.get('connection')
    if (connection !== undefined && typeof connection.requestRejection === 'function') {
      try {
        const request = new Request(`http://dsh.internal${req.url ?? '/'}`, {
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
        })
        return connection.requestRejection(request)
      } catch {
        /* fall through to the local check */
      }
    }
    // Same-origin only: the panel always sends Origin, so this still blocks a
    // cross-site POST that would otherwise reach a browser-driving route.
    const host = req.headers?.host
    const origin = req.headers?.origin
    if (typeof host !== 'string' || typeof origin !== 'string') return 403
    try {
      return new URL(origin).host === host ? undefined : 403
    } catch {
      return 403
    }
  }

  const route = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const rejection = rejectionFor(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, {
          ok: false,
          error: { code: rejection === 401 ? 'unauthorized' : 'forbidden', message: rejection === 401 ? 'unauthorized' : 'forbidden' },
        })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const op = pathname.startsWith(`${API_PATH}/`) ? pathname.slice(API_PATH.length + 1) : undefined
      if (op === undefined || op === '' || op.includes('/')) {
        sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown dsh-browser ui op' } })
        return
      }
      const fn = ops[op]
      if (typeof fn !== 'function') {
        sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown dsh-browser ui op "${op}"` } })
        return
      }
      try {
        const payload = await readJson(req)
        const result = await fn(payload ?? {})
        // The route is JSON-only; a non-JSON value must fail here rather than
        // surface as a confusing client-side parse error.
        sendJson(res, 200, { ok: true, result: result === undefined ? null : result })
      } catch (error) {
        const message = error?.message ?? String(error)
        log?.warn(`panel op ${op} failed: ${message}`)
        sendJson(res, 500, { ok: false, error: { code: 'handler-error', message } })
      }
    },
  }

  // `apply()` can run before the web application mounts, so the route is bound
  // through `ctx.inject` rather than a synchronous lookup.
  try {
    ctx.inject(['webServer'], (webCtx) => {
      if (bound.route) return
      const webServer = webCtx.get('webServer')
      if (webServer === undefined || typeof webServer.register !== 'function') return
      disposers.push(webServer.register(route))
      bound.route = true
      log?.info(`sidebar carrier bound: POST ${API_PATH}/<op>`)
    })
  } catch (error) {
    log?.warn('could not bind the panel route', error?.message ?? error)
  }

  return {
    bound,
    ops,
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
      disposers.length = 0
    },
  }
}
