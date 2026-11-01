/**
 * The reverse direction: a peer calling LINK's software-facing routes.
 *
 * A peer LINK has bound (a provider, a tool source) sometimes needs to call back: read the
 * contract, invoke a LINK capability, mint an embed token, or reach a model through LINK's proxy.
 * linkClient() is that side, plain functions over fetch, no dependencies.
 *
 *   import { linkClient } from '@dsh-link/link-interconnect-sdk'
 *   const link = linkClient({ baseUrl: 'http://127.0.0.1:31760', token: 'lk_...' })
 *   const models = await link.openai('models')
 */
import { ERROR_CODES, ROUTES, LinkSdkError } from './protocol.mjs'

/**
 * Build the reverse client.
 * @param {{ baseUrl: string, token?: string, fetchImpl?: Function, timeoutMs?: number }} options
 * @returns {object} the client; see the methods below.
 */
export function linkClient(options = {}) {
  if (options === null || typeof options !== 'object') throw new LinkSdkError(ERROR_CODES.badRequest, 'linkClient needs an options object')
  if (typeof options.baseUrl !== 'string' || !/^https?:\/\//i.test(options.baseUrl)) throw new LinkSdkError(ERROR_CODES.badRequest, 'linkClient needs an http(s) baseUrl')
  if (options.token !== undefined && (typeof options.token !== 'string' || options.token === '')) throw new LinkSdkError(ERROR_CODES.badRequest, 'linkClient token must be a non-empty string when given')
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new LinkSdkError(ERROR_CODES.internal, 'no fetch implementation: pass fetchImpl or run on a node that has fetch')
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const token = options.token === undefined ? null : options.token
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0

  async function request(path, init = {}) {
    const headers = Object.assign({}, init.headers ?? {})
    if (token !== null) headers.authorization = 'Bearer ' + token
    if (init.body !== undefined && headers['content-type'] === undefined) headers['content-type'] = 'application/json'
    const signal = init.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined)
    let response
    try {
      response = await doFetch(baseUrl + path, Object.assign({}, init, { headers, signal }))
    } catch (error) {
      throw new LinkSdkError(ERROR_CODES.peerUnavailable, 'request to ' + baseUrl + path + ' failed: ' + String(error && error.message !== undefined ? error.message : error))
    }
    const text = await response.text()
    let payload = null
    if (text.trim() !== '') {
      try {
        payload = JSON.parse(text)
      } catch {
        throw new LinkSdkError(ERROR_CODES.internal, 'LINK answered ' + path + ' with HTTP ' + response.status + ' and bytes that are not JSON', response.status)
      }
    }
    if (!response.ok) {
      const failure = payload !== null && typeof payload === 'object' ? payload.error : undefined
      throw new LinkSdkError(codeOf(failure), messageOf(failure, path, response.status), response.status)
    }
    return payload
  }

  function postJson(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body === undefined ? {} : body) })
  }

  return Object.freeze({
    baseUrl,
    token,
    /** One raw protocol route, verbatim path; for anything newer than this SDK. */
    fetch: request,
    /** GET /link/v1/contract: identities, endpoints, scopes, limits and the CSP template. */
    contract() {
      return request(ROUTES.contract, { method: 'GET' })
    },
    /** POST /link/v1/invoke: {cap, op, args} in, the handler result out. A refusal throws its code. */
    async invoke(call = {}) {
      if (call === null || typeof call !== 'object' || typeof call.cap !== 'string' || call.cap === '' || typeof call.op !== 'string' || call.op === '') {
        throw new LinkSdkError(ERROR_CODES.badRequest, 'invoke needs {cap, op, args?, idempotencyKey?}')
      }
      const payload = await postJson(ROUTES.invoke, { cap: call.cap, op: call.op, args: call.args === undefined ? {} : call.args, idempotencyKey: call.idempotencyKey })
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const failure = payload !== null && typeof payload === 'object' ? payload.error : undefined
        throw new LinkSdkError(codeOf(failure), messageOf(failure, ROUTES.invoke, 200))
      }
      return payload.result
    },
    /** POST /link/v1/embed/token: {sessionId, mode, origin} in, a 10 minute aud=origin token out. */
    embedToken(body = {}) {
      return postJson(ROUTES.embedToken, body)
    },
    /** /link/v1/openai/v1/*: LINK's OpenAI-shaped proxy, as the peer's own provider surface. */
    openai(path, init) {
      return request(proxyPath(ROUTES.openaiPrefix, path), init)
    },
    /** /link/v1/anthropic/v1/*: the same for an Anthropic-shaped surface. */
    anthropic(path, init) {
      return request(proxyPath(ROUTES.anthropicPrefix, path), init)
    },
  })
}

function proxyPath(prefix, path) {
  if (typeof path !== 'string' || path.trim() === '') throw new LinkSdkError(ERROR_CODES.badRequest, 'proxy path must be a non-empty string')
  const clean = path.replace(/^\/+/, '')
  const versioned = clean === 'v1' || clean.startsWith('v1/') ? clean : 'v1/' + clean
  return prefix + '/' + versioned
}

function codeOf(failure) {
  if (failure !== null && typeof failure === 'object' && typeof failure.code === 'string' && failure.code !== '') return failure.code
  return ERROR_CODES.internal
}

function messageOf(failure, path, status) {
  if (failure !== null && typeof failure === 'object' && typeof failure.message === 'string' && failure.message !== '') return failure.message
  return 'LINK answered ' + path + ' with HTTP ' + status
}
