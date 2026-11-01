/**
 * Minimal JSON-over-HTTP helper for the probe scripts.
 *
 * The scripts deliberately avoid `fetch`: its connection pool keeps idle sockets
 * alive, and Node aborts on Windows while tearing them down at process exit, which
 * makes a passing run report a nonzero exit code. A one-shot request per call with
 * no pooling keeps the exit status meaningful.
 */

import http from 'node:http'
import https from 'node:https'

/**
 * Issue one JSON request and read the whole reply.
 *
 * @param {string} url - absolute URL.
 * @param {object} options - request options.
 * @param {string} [options.method] - HTTP method; defaults to `POST`.
 * @param {object} [options.body] - JSON body, when the method takes one.
 * @param {string} [options.accept] - `accept` header; defaults to `application/json`.
 * The kernel content-negotiates its index, so fetching a document requires asking for
 * one rather than accepting anything.
 * @returns {Promise<{status: number, headers: object, text: string}>} the reply.
 */
export function requestJson(url, { method = 'POST', body, accept = 'application/json' } = {}) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? https : http
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const headers = { accept }
  if (payload !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.byteLength)
  }

  return new Promise((resolve, reject) => {
    const outgoing = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        // No keep-alive: the socket must be released before the process exits.
        agent: false,
      },
      (incoming) => {
        let text = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk) => {
          text += chunk
        })
        incoming.on('end', () =>
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, text }),
        )
      },
    )
    outgoing.on('error', reject)
    if (payload !== undefined) outgoing.write(payload)
    outgoing.end()
  })
}

/**
 * Call one DSH endpoint and unwrap its `server-response` envelope.
 *
 * @param {string} origin - the shell's origin, e.g. `http://127.0.0.1:31761`. The proxy
 * mirrors the kernel's routes at the root, so the endpoint path is appended directly.
 * @param {string} endpoint - channel-relative endpoint, e.g. `session/list`.
 * @param {object} args - endpoint-owned named arguments.
 * @returns {Promise<object>} the endpoint's success value.
 * @throws {Error} on a transport failure or a Host-reported failure.
 */
export async function callEndpoint(origin, endpoint, args) {
  const rpcId = crypto.randomUUID()
  const reply = await requestJson(`${origin}/api/${endpoint}`, {
    body: { type: 'client-request', rpcId, method: endpoint, payload: { args } },
  })

  if (reply.status !== 200) {
    throw new Error(`${endpoint}: HTTP ${reply.status} ${reply.text.slice(0, 200)}`)
  }

  let envelope
  try {
    envelope = JSON.parse(reply.text)
  } catch {
    throw new Error(`${endpoint}: unreadable reply ${reply.text.slice(0, 200)}`)
  }
  if (envelope.rpcId !== rpcId) throw new Error(`${endpoint}: rpcId mismatch`)
  if (envelope.result?.ok !== true) {
    const error = envelope.result?.error ?? {}
    throw new Error(`${endpoint}: ${error.code ?? 'unknown'} ${error.message ?? ''}`.trim())
  }
  return envelope.result.value
}

/**
 * Print one check line.
 *
 * @param {string} name - what was checked.
 * @param {boolean} ok - whether it passed.
 * @param {string} [detail] - supporting detail.
 * @returns {boolean} `ok`, so callers can count failures inline.
 */
export function report(name, ok, detail) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`)
  return ok
}
