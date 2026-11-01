/**
 * Host side of the sidebar panel's private RPC.
 *
 * Two carriers, both owned by this plugin's fiber:
 *
 *  1. `ctx.connection.rpc.handle(channel, handler)` — the sanctioned generic
 *     carrier for a static bundle. The DSH web carrier already applies its
 *     Host/Origin fence and browser cookie, so this path adds no new surface.
 *     Used whenever that service is composed.
 *  2. A prefix route on `ctx.webServer` — fallback for a host that composes a web
 *     server without the connection RPC. Because that route is NOT behind the
 *     carrier's fence, it is additionally gated by a per-process random token
 *     that is only ever delivered inside the already-fenced page HTML, plus
 *     fetch-metadata checks that a cross-site request cannot satisfy.
 *
 * Both carriers expose the same op table, so the client can use whichever is
 * available without knowing which one answered.
 */

import { createHash, randomBytes } from 'node:crypto'

const CHANNEL = '/dsh-lan-bridge'
const TOKEN_GLOBAL = '__DSH_LAN_BRIDGE_UI__'
/** Our route inside DSH's browser-trust fence; the fence authenticates the caller. */
const FENCED_PATH = '/api/dsh-lan-bridge'

/** Ops the panel may call. Anything else is refused before reaching the service. */
// R325: `target.list` reads ONE directory on a reachable device. It is a read op because nothing local changes and the
// remote side sees a plain fs.list under the grant it already gave - the narrowest useful action, not a call bridge.
const READ_OPS = new Set(['state', 'audit.tail', 'target.list'])
const WRITE_OPS = new Set([
  // identity and posture
  'role.set',
  'discoverable.set',
  'discover.set', // legacy alias of discoverable.set
  'discover.probe', // legacy alias of probe
  'probe',
  // pairing
  'pair.open',
  'pair.close',
  'pair.submit',
  'approve', // legacy alias of request.decide
  'request.decide',
  // outbound links
  'connect', // legacy alias of device.connect
  'device.connect',
  'disconnect', // legacy alias of device.disconnect
  'device.disconnect',
  'device.forget',
  // inbound sessions and grants
  'peers.disconnect', // legacy alias of session.disconnect
  'session.disconnect',
  'grant.revoke',
  'grant.set',
  // real-effect self tests
  'connection.test', // legacy alias of link.selftest
  'link.selftest',
  // R332: ask a device that advertises media.capture to record; the artifact stays on that device.
  'target.capture',
])

function json(res, status, payload) {
  if (res.headersSent === true) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed
}

/**
 * Make any service value safe to hand to the browser.
 *
 * `snapshot()` is already a plain-data view, but it is assembled from live
 * service state: one stale field (a pending request's `answer` callback, a live
 * session reached through a link) would otherwise turn the whole panel into
 * "failed to serialize" — or, over the connection carrier, throw. This copies
 * what JSON can carry and drops the rest instead of failing on the way out.
 * Cycles become absent rather than infinite.
 */
function toWire(value, seen = new Set()) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'bigint') return String(value)
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const clean = toWire(item, seen)
        return clean === undefined ? null : clean
      })
    }
    if (value instanceof Map) {
      const out = {}
      for (const [key, item] of value) {
        if (typeof key !== 'string') continue
        const clean = toWire(item, seen)
        if (clean !== undefined) out[key] = clean
      }
      return out
    }
    if (value instanceof Set) return [...value].map((item) => toWire(item, seen) ?? null)
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const clean = toWire(item, seen)
      if (clean !== undefined) out[key] = clean
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/** A device id from a payload keyed either `deviceId` or `device`. */
function deviceArg(payload) {
  for (const candidate of [payload.deviceId, payload.device]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}

/** Same, but a per-device op that cannot name one is a user error, not a no-op. */
function requireDevice(payload) {
  const deviceId = deviceArg(payload)
  if (deviceId === undefined) throw new Error('deviceId is required')
  return deviceId
}

/** A TCP port from payload JSON, which may arrive as a string. */
function toPort(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed
  }
  return undefined
}

/**
 * Forget a device completely: drop its inbound session AND revoke its grant.
 *
 * Either half may already be absent (a peer that never connected back, a device
 * that is already gone), and that must not turn 「彻底移除」 into an error the
 * user cannot get past — the grant is the dangerous half and it is revoked
 * unconditionally.
 */
function forgetDevice(service, deviceId) {
  if (deviceId === undefined) throw new Error('deviceId is required')
  return removeDevice(service, deviceId)
}

/** The async half of `forgetDevice`, so a rejected promise is caught too. */
async function removeDevice(service, deviceId) {
  let disconnected = false
  let note = null
  try {
    await service.disconnectPeer(deviceId)
    disconnected = true
  } catch (error) {
    // "that peer is not connected" is the normal case for a device this machine
    // only ever dialled out to, so it is reported, not thrown.
    note = error?.message ?? String(error)
  }
  const revoked = service.revokeGrant(deviceId)
  return { deviceId, disconnected, note, forgotten: revoked?.ok === true }
}

/**
 * Posture facts for the unauthenticated health endpoint: counts and booleans.
 *
 * `snapshot()` can throw (a service that failed to start, a future field that
 * explodes) and health is exactly the endpoint that must still answer when
 * something is wrong, so this never throws and never carries an identity.
 */
function healthFacts(service) {
  const empty = { hostBuild: null, role: null, accepts: false, links: 0, targets: 0, toolsAvailable: false }
  try {
    const snapshot = typeof service?.snapshot === 'function' ? service.snapshot() : null
    if (snapshot === null || typeof snapshot !== 'object') return empty
    return {
      hostBuild: typeof snapshot.hostBuild === 'string' ? snapshot.hostBuild : null,
      role: typeof snapshot.role === 'string' ? snapshot.role : null,
      accepts: snapshot.accepts === true,
      links: Array.isArray(snapshot.links) ? snapshot.links.length : 0,
      targets: Array.isArray(snapshot.targets) ? snapshot.targets.length : 0,
      toolsAvailable: snapshot.toolsAvailable === true,
      // R203: health answers the discoverability question with the same evidence the boot claim uses.
      discoverable: snapshot.discoverable === true,
      egress: typeof snapshot.egress === 'string' ? snapshot.egress : null,
    }
  } catch {
    return empty
  }
}

/**
 * Build the op table. Every op funnels into one service method and answers with
 * the uniform `{ ok, value } | { ok, error }` envelope the client expects.
 *
 * New ops are ADDITIONS: every name the shipped panel already calls (`connect`,
 * `disconnect`, `approve`, `discover.set`, `connection.test`, …) still resolves
 * to the same service method, and the newer names are what the v2 panel leads
 * with. `state` is a straight pass-through of `service.snapshot()` — passing the
 * full v2 snapshot through is what keeps a host update from blanking a panel.
 */
export function createOps({ service, log, diagnostics }) {
  const dispatch = async (op, args) => {
    if (typeof op !== 'string' || op === '') throw new Error('missing op')
    if (!READ_OPS.has(op) && !WRITE_OPS.has(op)) throw new Error(`unknown op: ${op}`)
    const payload = args !== null && typeof args === 'object' ? args : {}
    switch (op) {
      // ---- read ----------------------------------------------------------
      case 'state':
        return { ...toWire(service.snapshot()), diagnostics: toWire(diagnostics?.() ?? null) }
      case 'audit.tail':
        return service.auditTail(payload.limit)
      case 'target.list':
        return await service.listTarget({ device: deviceArg(payload), path: payload.path })
      case 'target.capture':
        // R380: `kind` picks the sensor ('photo' = one still frame, anything else = audio).
        return await service.captureMedia({ device: deviceArg(payload), ms: payload.ms, kind: payload.kind })

      // ---- identity and posture ------------------------------------------
      case 'role.set':
        return await service.setRole(payload.role)
      case 'discoverable.set':
      case 'discover.set':
        return service.setDiscoverable(payload.enabled === true)
      case 'probe':
      case 'discover.probe':
        return await service.probe()

      // ---- pairing --------------------------------------------------------
      // Opening force-refreshes the code: single-use codes mean a failed attempt
      // needs a new one, and a user may also want to invalidate a code they read
      // aloud on a call.
      case 'pair.open':
        return service.openPairingWindow(payload.force !== false)
      case 'pair.close':
        return service.closePairingWindow(typeof payload.reason === 'string' && payload.reason !== '' ? payload.reason : 'user')
      case 'pair.submit':
        return await service.submitPairingCode(String(payload.code ?? ''), { deviceId: deviceArg(payload) })
      case 'approve':
      case 'request.decide':
        return service.decideRequest(payload)

      // ---- outbound links -------------------------------------------------
      case 'connect':
      case 'device.connect': {
        const target = {
          deviceId: deviceArg(payload),
          host: typeof payload.host === 'string' && payload.host !== '' ? payload.host : undefined,
          port: toPort(payload.port),
          code: typeof payload.code === 'string' && payload.code !== '' ? payload.code : undefined,
          name: typeof payload.name === 'string' && payload.name !== '' ? payload.name : undefined,
        }
        if (target.deviceId === undefined && target.host === undefined) {
          throw new Error('pass a deviceId (or a host and port) to connect to')
        }
        return await service.connect(target)
      }
      case 'disconnect':
      case 'device.disconnect':
        // No device: every outbound link is dropped, which is what the summary
        // row's 断开 button means.
        return await service.disconnect(deviceArg(payload))
      case 'device.forget':
        return await forgetDevice(service, deviceArg(payload))

      // ---- inbound sessions and grants ------------------------------------
      case 'peers.disconnect':
      case 'session.disconnect':
        return await service.disconnectPeer(requireDevice(payload))
      case 'grant.revoke':
        // An empty device id would otherwise revoke nobody and answer "ok",
        // which reads in the panel as "the grant is gone" when it is not.
        return service.revokeGrant(requireDevice(payload))
      case 'grant.set':
        return service.setGrant(requireDevice(payload), payload.grant)

      // ---- real-effect self test ------------------------------------------
      case 'connection.test':
      case 'link.selftest':
        return await service.selfTest({
          device: deviceArg(payload),
          path: typeof payload.path === 'string' && payload.path !== '' ? payload.path : undefined,
        })
      /* c8 ignore next */
      default:
        throw new Error(`unknown op: ${op}`)
    }
  }

  return { dispatch, CHANNEL, TOKEN_GLOBAL }
}

/**
 * Register both carriers as the host composes them.
 *
 * Returns `{ dispose, token, channel, carriers }`; `carriers` is a live object so
 * diagnostics always report which carriers are actually bound.
 */
export function registerUiRpc({ ctx, service, log, diagnostics, build }) {
  const ops = createOps({ service, log, diagnostics })
  const token = randomBytes(32).toString('base64url')
  const disposers = []
  const carriers = { connection: false, fence: false, health: false, route: false }
  /** How many times the index tap actually ran — i.e. whether a page got our token. */
  let tapRuns = 0

  const handler = async (op, args) => {
    try {
      const value = await ops.dispatch(op, args)
      // One last pass on the way out: no op may hand the browser a value the
      // carriers cannot carry, and no op may leak a function, a Map or a live
      // service object into the panel.
      const wire = toWire({ ok: true, value })
      return wire ?? { ok: true, value: null }
    } catch (error) {
      // Readable message only: a stack would name host paths in the browser.
      const message = typeof error?.message === 'string' && error.message !== '' ? error.message : String(error)
      log.warn(`ui op ${op} failed`, message)
      // 0.2.x 的 ConnectionRpcHandler 契约是结构化失败（{code,message,details}）；
      // 内核目前不校验，纯字符串也能透传，但对齐契约省得未来断。
      return { ok: false, error: { code: 'bridge/op-failed', message, details: {} } }
    }
  }

  // --- Carrier 1: the connection RPC (preferred) -----------------------------
  // The carriers must be bound through `ctx.inject`: `apply()` runs before the
  // web application mounts, so a synchronous `ctx.get('webServer')` here would
  // find nothing and leave the panel with no way to reach the host.
  try {
    ctx.inject(['connection'], (connectionCtx) => {
      if (carriers.connection) return
      const rpc = connectionCtx.get('connection')?.rpc
      if (rpc === undefined || typeof rpc.handle !== 'function') return
      disposers.push(rpc.handle(ops.CHANNEL, async (endpoint, payload) => handler(String(endpoint), payload ?? {})))
      carriers.connection = true
      log.info(`ui carrier: connection rpc on ${ops.CHANNEL}`)
    })
  } catch (error) {
    log.warn('could not bind the connection RPC carrier', error?.message ?? error)
  }

  // --- Carrier 2: a route under /api, authenticated by the fence as an oracle -
  //
  // A route registered under `/api/...` does NOT inherit DSH's browser-trust
  // fence — it SHADOWS it (measured: it answers 200 with no cookie at all), so
  // merely living under `/api` authenticates nothing and shipping that would
  // hand the bridge controls to any client on the LAN.
  //
  // What the fence can do is act as an oracle: a path under `/api` that no route
  // claims answers 401/403 without a valid credential, and lets an authenticated
  // caller through to a 404. Forwarding the CALLER's own cookie to such a path
  // therefore proves the cookie is genuine, without this plugin ever holding the
  // signing key. That is what makes this carrier safe AND independent of index
  // injection (which is how the Mac side ended up with a missing token).
  let baseUrlCache = null
  const authCache = new Map()

  function cookieKey(cookie) {
    return createHash('sha256').update(cookie).digest('base64url').slice(0, 22)
  }

  /**
   * Candidate loopback base URLs for probing our own server.
   *
   * The address the request ARRIVED on comes first, then the usual loopback
   * spellings. Assuming `127.0.0.1` alone was wrong: a host that binds only one
   * family (a desktop app on an IPv6 loopback, for instance) would make every
   * probe fail, the fence would look absent, and the panel would be refused even
   * though its cookie is perfectly good.
   */
  function probeCandidates(req) {
    const out = []
    const address = req.socket?.localAddress
    const port = req.socket?.localPort
    if (typeof address === 'string' && typeof port === 'number' && port !== 0) {
      const bare = address.startsWith('::ffff:') ? address.slice(7) : address
      const host = bare.includes(':') ? `[${bare}]` : bare
      out.push(`http://${host}:${port}`)
    }
    if (typeof port === 'number' && port !== 0) {
      out.push(`http://127.0.0.1:${port}`, `http://[::1]:${port}`, `http://localhost:${port}`)
    }
    return [...new Set(out)]
  }

  async function probeRaw(base, path, cookie) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    timer.unref?.()
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: cookie === '' ? {} : { cookie },
        redirect: 'manual',
        signal: controller.signal,
      })
      return response.status
    } catch {
      return 0
    } finally {
      clearTimeout(timer)
    }
  }

  /** Find the base URL that reaches this very server, and whether it is fenced. */
  async function resolveBase(req) {
    const candidates = probeCandidates(req)
    if (candidates.length === 0) return null
    if (baseUrlCache !== null && candidates.includes(baseUrlCache.base)) return baseUrlCache
    for (const base of candidates) {
      const bare = await probeRaw(base, `/api/${randomBytes(9).toString('hex')}`, '')
      if (bare === 0) continue // nothing listening there
      // 401/403 = a fence answered; anything else = our own server past a fence
      // that is not enforcing, or no fence at all. Either way this base is ours.
      const resolved = { base, fenced: bare === 401 || bare === 403 }
      baseUrlCache = resolved
      log.info(
        `ui carrier auth: self-probe reached ${base} (fence ${resolved.fenced ? 'active' : 'NOT enforcing'})`,
      )
      return resolved
    }
    log.warn('ui carrier auth: no loopback address reached this server; the fenced carrier is unusable', candidates)
    return null
  }

  async function isAuthenticatedCaller(req) {
    const cookie = typeof req.headers.cookie === 'string' ? req.headers.cookie : ''
    if (cookie === '') return false
    const resolved = await resolveBase(req)
    // No fence to vouch for anyone: refuse rather than fall open. The token
    // carrier (and a restart to re-render the index) is the answer instead.
    if (resolved === null || resolved.fenced !== true) return false
    const key = cookieKey(cookie)
    const now = Date.now()
    const hit = authCache.get(key)
    if (hit !== undefined && now - hit.at < 60_000) return hit.ok
    const status = await probeRaw(resolved.base, `/api/${randomBytes(9).toString('hex')}`, cookie)
    const ok = status !== 401 && status !== 403 && status !== 0
    authCache.set(key, { at: now, ok })
    if (authCache.size > 64) authCache.clear()
    return ok
  }

  const runHandler = async (req, res, { requireToken }) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'use POST' })
    const presented = req.headers['x-dsh-bridge-ui'] ?? req.headers['x-dsh-lan-bridge-ui']
    const hasToken = typeof presented === 'string' && presented === token
    if (requireToken) {
      // A cross-site request cannot set this header, and browsers will not
      // preflight it because we never answer CORS preflights.
      if (!hasToken) return json(res, 403, { ok: false, error: 'missing or wrong X-DSH-Bridge-UI token' })
    } else if (!hasToken && !(await isAuthenticatedCaller(req))) {
      return json(res, 401, { ok: false, error: 'not authorized (no DSH browser-trust credential)' })
    }
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      return json(res, 403, { ok: false, error: 'cross-site requests are refused' })
    }
    const type = String(req.headers['content-type'] ?? '')
    if (!type.startsWith('application/json')) {
      return json(res, 415, { ok: false, error: 'content-type must be application/json' })
    }
    try {
      const body = await readJsonBody(req)
      const result = await handler(body.op, body.args)
      return json(res, result.ok === true ? 200 : 400, result)
    } catch (error) {
      return json(res, 400, { ok: false, error: error?.message ?? String(error) })
    }
  }

  try {
    ctx.inject(['webServer'], (webCtx) => {
      if (carriers.fence) return
      const server = webCtx.get('webServer')
      if (server === undefined || typeof server.register !== 'function') return
      disposers.push(
        server.register({
          kind: 'prefix',
          path: FENCED_PATH,
          handler: (req, res) => runHandler(req, res, { requireToken: false }),
        }),
      )
      carriers.fence = true
      log.info(`ui carrier: fenced route on ${FENCED_PATH}`)
    })
  } catch (error) {
    log.warn('could not bind the fenced carrier', error?.message ?? error)
  }

  try {
    ctx.inject(['webServer'], (webCtx) => {
      if (carriers.health) return
      const server = webCtx.get('webServer')
      if (server === undefined || typeof server.register !== 'function') return
      // An unauthenticated DIAGNOSTIC endpoint, deliberately carrying no secret
      // and no bridge state: it answers "did the host half load at all, which
      // carriers bound, and does this host enforce its browser-trust fence".
      // Without it, a panel that cannot authenticate can only report "it failed",
      // and every round of support is guesswork.
      //
      // It now also answers the posture question a support session always asks
      // second — which role is this machine in, is it accepting, and can it drive
      // anything — as COUNTS and booleans only: no device id, name, path or grant
      // ever crosses this unauthenticated boundary.
      disposers.push(
        server.register({
          kind: 'exact',
          path: `${ops.CHANNEL}/health`,
          handler: async (req, res) => {
            const resolved = await resolveBase(req)
            const facts = healthFacts(service)
            return json(res, 200, {
              ok: true,
              value: {
                plugin: 'dsh-lan-bridge',
                hostBuild: build ?? facts.hostBuild ?? 'unknown',
                role: facts.role,
                accepts: facts.accepts,
                links: facts.links,
                targets: facts.targets,
                toolsAvailable: facts.toolsAvailable,
                // R203: the discoverability answer this endpoint gives is the SAME evidence-backed one the boot
                // claim uses, with the per-leg record beside it.
                discoverable: facts.discoverable === true,
                egress: facts.egress === undefined ? null : facts.egress,
                carriers: { ...carriers },
                indexTapRan: tapRuns > 0,
                indexTapRuns: tapRuns,
                fence: resolved === null ? null : { base: resolved.base, enforcing: resolved.fenced === true },
                pid: process.pid,
                node: process.version,
              },
            })
          },
        }),
      )
      carriers.health = true
      log.info(`ui carrier: unauthenticated health endpoint on ${ops.CHANNEL}/health`)
    })
  } catch (error) {
    log.warn('could not bind the health endpoint', error?.message ?? error)
  }

  // --- Carrier 3: a token-guarded route of our own (fallback) ---------------
  try {
    ctx.inject(['webServer'], (webCtx) => {
      if (carriers.route) return
      const server = webCtx.get('webServer')
      if (server === undefined || typeof server.register !== 'function') return
      disposers.push(
        server.register({
          kind: 'prefix',
          path: `${ops.CHANNEL}/api`,
          handler: (req, res) => runHandler(req, res, { requireToken: true }),
        }),
      )

      // Hand the page its token. The page itself is behind the DSH browser-trust
      // fence, so this is the only place the token is ever disclosed. The tap runs
      // per index render, so it reports whatever is bound by then.
      if (typeof server.tapIndex === 'function') {
        disposers.push(
          server.tapIndex((html) => {
            tapRuns += 1
            const declared = carriers.fence ? 'fence' : 'route'
            const script =
              `<script>window.${TOKEN_GLOBAL}={token:${JSON.stringify(token)},channel:${JSON.stringify(ops.CHANNEL)},` +
              `fence:${JSON.stringify(FENCED_PATH)},carrier:${JSON.stringify(declared)}};</script>`
            return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`
          }),
        )
      }
      carriers.route = true
      log.info(`ui carrier: token-guarded route on ${ops.CHANNEL}/api`)
    })
  } catch (error) {
    log.warn('could not bind the route carrier', error?.message ?? error)
  }

  return {
    channel: ops.CHANNEL,
    token,
    carriers,
    dispose: () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch (error) {
          log.warn('ui carrier dispose failed', error?.message ?? error)
        }
      }
      disposers.length = 0
    },
  }
}

export { CHANNEL, TOKEN_GLOBAL, FENCED_PATH }
export default { registerUiRpc, createOps, CHANNEL, FENCED_PATH }



