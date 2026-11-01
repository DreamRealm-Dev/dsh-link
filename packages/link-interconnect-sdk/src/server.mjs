/**
 * The peer side of link-interconnect/1: a zero-dependency node:http server.
 *
 * A software peer LINK can bind needs three things: the declaration it serves at
 * GET /.well-known/link-interconnect.json, POST /link/v1/invoke (dispatch by cap and op), and
 * GET /link/v1/events (SSE). When the manifest declares models.provide it also serves the
 * OpenAI-shaped GET /v1/models and POST /v1/chat/completions, which is how LINK binds it as a
 * provider. Everything here is node built-ins.
 */
import { createServer } from 'node:http'
import {
  CAPS,
  ERROR_CODES,
  LIMITS,
  ROUTES,
  LinkSdkError,
  declare,
  isPlainObject,
  statusForCode,
} from './protocol.mjs'

const DEFAULT_HOST = '127.0.0.1'
const SSE_HEARTBEAT_MS = 15 * 1000
const MAX_IDEMPOTENCY_ENTRIES = 200

/**
 * Start one peer.
 *
 * @param {object} options
 * @param {object} options.manifest - the PeerManifest to declare (validated by declare()).
 * @param {object} [options.handlers] - functions keyed by cap + '/' + op, or by op alone.
 *   A handler receives (args, context) and may answer a value or a promise; throwing a
 *   LinkSdkError answers that code, any other throw answers link/internal.
 * @param {Function} [options.auth] - auth(request) answer true or {ok:true, peer?} to allow,
 *   false / {ok:false, code?, message?} to refuse. request is {method, url, headers, token,
 *   route}; token is the bearer token or (for the SSE route) the ?token= query value.
 *   Omit only when the socket itself is the boundary (loopback dev).
 * @param {number} [options.port] - default 0, an ephemeral port.
 * @param {string} [options.host] - default 127.0.0.1 (loopback, as the protocol requires).
 * @param {object} [options.models] - {list, chat} for a manifest that declares models.provide.
 *   list is an array of OpenAI model ids/objects or a function; chat is (body, context) -> an
 *   OpenAI chat completion object.
 * @returns {Promise<{url: string, manifestUrl: string, manifest: object, port: number,
 *   publish: Function, close: Function}>} publish(event) pushes one SSE event to every open
 *   /link/v1/events subscriber; close() ends subscriptions and stops the listener.
 */
export async function serve(options = {}) {
  if (options === null || typeof options !== 'object') throw new LinkSdkError(ERROR_CODES.badRequest, 'serve needs an options object')
  const manifest = declare(options.manifest)
  const handlers = options.handlers === undefined ? {} : options.handlers
  if (!isPlainObject(handlers)) throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.handlers must be an object of functions')
  for (const [key, handler] of Object.entries(handlers)) {
    if (typeof handler !== 'function') throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.handlers[' + JSON.stringify(key) + '] is not a function')
  }
  const auth = options.auth === undefined || options.auth === null ? null : options.auth
  if (auth !== null && typeof auth !== 'function') throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.auth must be a function when given')
  const host = options.host === undefined ? DEFAULT_HOST : options.host
  if (typeof host !== 'string' || host === '') throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.host must be a non-empty string')
  const port = options.port === undefined ? 0 : options.port
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.port must be an integer between 0 and 65535')
  const bodyLimit = manifest.limits.bodyBytes === undefined ? LIMITS.bodyBytes : manifest.limits.bodyBytes

  const modelsCapability = manifest.capabilities.find((capability) => capability.kind === CAPS.modelsProvide)
  const models = normaliseModels(options.models, modelsCapability)
  const modelsBase = modelsCapability !== undefined && modelsCapability.models !== undefined && modelsCapability.models.path !== undefined ? modelsCapability.models.path : '/v1'
  const modelsBaseClean = modelsBase.replace(/\/+$/, '')
  const modelsListPath = modelsBaseClean + '/models'
  const chatPath = modelsBaseClean + '/chat/completions'

  const invokePaths = new Set([ROUTES.invoke, manifest.endpoints.invoke])
  const eventsPaths = new Set([ROUTES.events, manifest.endpoints.events])
  const sseClients = new Set()
  const idempotency = new Map()

  /** Push one event to every open SSE subscriber; returns how many received it. */
  function publish(event) {
    const frame = 'data: ' + JSON.stringify(event === undefined ? {} : event) + '\n\n'
    let delivered = 0
    for (const client of sseClients) {
      if (client.writableEnded) {
        sseClients.delete(client)
        continue
      }
      client.write(frame)
      delivered += 1
    }
    return delivered
  }

  async function handle(req, res) {
    let path
    let query
    try {
      const url = new URL(req.url === undefined || req.url === null ? '/' : req.url, 'http://peer.invalid')
      path = url.pathname
      query = url.searchParams
    } catch {
      return sendError(res, 400, ERROR_CODES.badRequest, 'request URL is not parseable')
    }
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'

    if (path === ROUTES.wellKnown) {
      if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, ERROR_CODES.methodNotAllowed, 'the well-known declaration is a GET')
      return sendJson(res, 200, manifest, method === 'HEAD')
    }

    if (invokePaths.has(path)) {
      if (method !== 'POST') return sendError(res, 405, ERROR_CODES.methodNotAllowed, 'invoke is a POST')
      return handleInvoke(req, res)
    }

    if (eventsPaths.has(path)) {
      if (method !== 'GET') return sendError(res, 405, ERROR_CODES.methodNotAllowed, 'events is a GET (SSE)')
      return handleEvents(req, res, query)
    }

    if (modelsCapability !== undefined && path === modelsListPath) {
      if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, ERROR_CODES.methodNotAllowed, 'models is a GET')
      const peer = await authorize(req, null, 'models')
      if (!peer.ok) return sendError(res, peer.status, peer.code, peer.message)
      const data = await listModels(peer.peer)
      return sendJson(res, 200, { object: 'list', data }, method === 'HEAD')
    }

    if (modelsCapability !== undefined && path === chatPath) {
      if (method !== 'POST') return sendError(res, 405, ERROR_CODES.methodNotAllowed, 'chat completions is a POST')
      const peer = await authorize(req, null, 'chat')
      if (!peer.ok) return sendError(res, peer.status, peer.code, peer.message)
      const body = await readJsonBody(req, res)
      if (body === null) return
      if (typeof models.chat !== 'function') return sendError(res, 501, ERROR_CODES.internal, 'models.provide is declared but serve.models.chat is not implemented')
      const answer = await models.chat(body, { peer: peer.peer, manifest, request: { method: req.method, url: req.url, headers: req.headers } })
      return sendJson(res, 200, answer)
    }

    return sendError(res, 404, ERROR_CODES.notFound, 'no route ' + method + ' ' + path)
  }

  async function handleInvoke(req, res) {
    const peer = await authorize(req, null, 'invoke')
    if (!peer.ok) return sendError(res, peer.status, peer.code, peer.message)
    const body = await readJsonBody(req, res)
    if (body === null) return
    const cap = body.cap
    const op = body.op
    if (typeof cap !== 'string' || cap === '') return sendError(res, 400, ERROR_CODES.badRequest, 'invoke body needs a non-empty cap')
    if (typeof op !== 'string' || op === '') return sendError(res, 400, ERROR_CODES.badRequest, 'invoke body needs a non-empty op')
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey !== '' ? body.idempotencyKey : null
    if (idempotencyKey !== null) {
      const remembered = idempotentGet(idempotencyKey)
      if (remembered !== null) return sendJson(res, remembered.status, remembered.body)
    }
    const handler = handlers[cap + '/' + op] ?? handlers[op]
    if (typeof handler !== 'function') return sendError(res, 404, ERROR_CODES.notFound, 'no handler for ' + JSON.stringify(cap + '/' + op))
    const context = {
      cap,
      op,
      args: body.args === undefined ? {} : body.args,
      peer: peer.peer,
      idempotencyKey: idempotencyKey === null ? undefined : idempotencyKey,
      manifest,
      request: { method: req.method, url: req.url, headers: req.headers },
    }
    let result
    try {
      result = await handler(context.args, context)
    } catch (error) {
      const failure = failureOf(error)
      return sendError(res, failure.status, failure.code, failure.message)
    }
    const answer = { ok: true, result: result === undefined ? null : result }
    if (idempotencyKey !== null) idempotentSet(idempotencyKey, { status: 200, body: answer })
    return sendJson(res, 200, answer)
  }

  async function handleEvents(req, res, query) {
    const peer = await authorize(req, query, 'events')
    if (!peer.ok) return sendError(res, peer.status, peer.code, peer.message)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    sseClients.add(res)
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n')
    }, SSE_HEARTBEAT_MS)
    if (typeof heartbeat.unref === 'function') heartbeat.unref()
    const cleanup = () => {
      clearInterval(heartbeat)
      sseClients.delete(res)
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)
  }

  /** The one auth seam: normalize whitelist / refusal shapes into {ok, status, code, message, peer}. */
  async function authorize(req, query, route) {
    let token = bearerToken(req.headers.authorization)
    if (token === undefined && query !== null && query !== undefined) token = query.get('token') ?? undefined
    if (auth === null) return { ok: true, peer: undefined }
    const request = { method: req.method, url: req.url, headers: req.headers, token, route }
    let verdict
    try {
      verdict = await auth(request)
    } catch (error) {
      return authFailure(error)
    }
    if (verdict === true) return { ok: true, peer: undefined }
    if (isPlainObject(verdict) && verdict.ok === true) return { ok: true, peer: verdict.peer ?? verdict.claims ?? undefined }
    if (isPlainObject(verdict) && verdict.ok === false) {
      const code = typeof verdict.code === 'string' && verdict.code !== '' ? verdict.code : ERROR_CODES.unauthorized
      return {
        ok: false,
        status: Number.isInteger(verdict.status) ? verdict.status : statusForCode(code),
        code,
        message: typeof verdict.message === 'string' && verdict.message !== '' ? verdict.message : code,
      }
    }
    return { ok: false, status: 401, code: ERROR_CODES.unauthorized, message: 'auth(req) refused the request' }
  }

  async function listModels(peer) {
    const now = Math.floor(Date.now() / 1000)
    const entries = models.list === undefined ? [] : typeof models.list === 'function' ? await models.list({ peer, manifest }) : models.list
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      if (typeof entry === 'string') return { id: entry, object: 'model', created: now, owned_by: manifest.identity.linkId }
      return Object.assign({ object: 'model', created: now, owned_by: manifest.identity.linkId }, entry)
    })
  }

  function idempotentGet(key) {
    const entry = idempotency.get(key)
    if (entry === undefined) return null
    if (entry.expiresAt <= Date.now()) {
      idempotency.delete(key)
      return null
    }
    return entry.response
  }

  function idempotentSet(key, response) {
    if (idempotency.size >= MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = idempotency.keys().next().value
      if (oldest !== undefined) idempotency.delete(oldest)
    }
    idempotency.set(key, { response, expiresAt: Date.now() + LIMITS.idempotencyMs })
  }

  function readJsonBody(req, res) {
    return new Promise((resolve) => {
      const chunks = []
      let size = 0
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      req.on('data', (chunk) => {
        if (settled) return
        size += chunk.length
        if (size > bodyLimit) {
          finish(null)
          sendError(res, 413, ERROR_CODES.payloadTooLarge, 'request body is larger than ' + bodyLimit + ' bytes')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (settled) return
        const raw = Buffer.concat(chunks).toString('utf8')
        if (raw.trim() === '') return finish({})
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          finish(null)
          sendError(res, 400, ERROR_CODES.badRequest, 'request body is not JSON')
          return
        }
        if (!isPlainObject(parsed)) {
          finish(null)
          sendError(res, 400, ERROR_CODES.badRequest, 'request body must be a JSON object')
          return
        }
        finish(parsed)
      })
      req.on('error', () => {
        if (settled) return
        finish(null)
        sendError(res, 400, ERROR_CODES.badRequest, 'could not read the request body')
      })
    })
  }

  function sendJson(res, status, body, headOnly = false) {
    if (res.writableEnded) return
    const text = JSON.stringify(body)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('content-length', Buffer.byteLength(text))
    res.setHeader('cache-control', 'no-store')
    if (headOnly) res.end()
    else res.end(text)
  }

  function sendError(res, status, code, message) {
    sendJson(res, status, { ok: false, error: { code, message } })
  }

  function close() {
    for (const client of sseClients) {
      try {
        client.end()
      } catch {
        // The subscription is already gone; nothing to end.
      }
    }
    sseClients.clear()
    return new Promise((resolve) => {
      server.close(() => resolve())
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const failure = failureOf(error)
      if (res.headersSent) {
        try {
          res.end()
        } catch {
          // The socket is gone; the failure has nowhere left to go.
        }
        return
      }
      sendError(res, failure.status, failure.code, failure.message)
    })
  })

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(new LinkSdkError(ERROR_CODES.peerUnavailable, 'could not listen on ' + host + ':' + port + ': ' + String(error && error.message !== undefined ? error.message : error)))
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })

  const address = server.address()
  const boundPort = address !== null && typeof address === 'object' ? address.port : port
  const urlHost = host.includes(':') ? '[' + host + ']' : host
  const url = 'http://' + urlHost + ':' + boundPort
  return {
    url,
    manifestUrl: url + ROUTES.wellKnown,
    manifest,
    port: boundPort,
    publish,
    close,
  }
}

function normaliseModels(models, modelsCapability) {
  if (modelsCapability === undefined) return { list: undefined, chat: null }
  if (models === undefined || models === null) return { list: [], chat: null }
  if (typeof models === 'function') return { list: [], chat: models }
  if (!isPlainObject(models)) throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.models must be an object {list, chat}')
  if (models.list !== undefined && typeof models.list !== 'function' && !Array.isArray(models.list)) throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.models.list must be an array or a function')
  if (models.chat !== undefined && typeof models.chat !== 'function') throw new LinkSdkError(ERROR_CODES.badRequest, 'serve.models.chat must be a function')
  return { list: models.list, chat: models.chat === undefined ? null : models.chat }
}

function bearerToken(header) {
  if (typeof header !== 'string') return undefined
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim())
  return match === null ? undefined : match[1]
}

function authFailure(error) {
  if (error instanceof LinkSdkError) return { ok: false, status: error.status, code: error.code, message: error.message }
  return { ok: false, status: 500, code: ERROR_CODES.internal, message: 'auth() threw: ' + failureMessage(error) }
}

function failureOf(error) {
  if (error instanceof LinkSdkError) return { status: error.status, code: error.code, message: error.message }
  return { status: 500, code: ERROR_CODES.internal, message: failureMessage(error) }
}

function failureMessage(error) {
  const message = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
  return message === '' ? ERROR_CODES.internal : message
}
