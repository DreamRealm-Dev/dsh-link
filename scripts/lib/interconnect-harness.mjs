/**
 * Mount Subsystem routes on a plain node:http server - the one test/check mount for
 * link-interconnect. Click: host modules are cordis-free (see src/protocol/types.ts), so tests
 * exercise the real handlers without the app, the kernel or @deepseek-ai/cordis.
 *
 *   import { mountSubsystems, requestJson, openEventStream } from "./lib/interconnect-harness.mjs"
 *   const app = await mountSubsystems([protocol, client])
 *   const contract = await requestJson(app.origin + "/link/v1/contract")
 *   await app.close()
 */
import http from 'node:http'

function buildTable(subsystems) {
  const exact = new Map()
  const prefixes = []
  for (const subsystem of subsystems) {
    for (const route of subsystem.routes()) {
      if (route.kind === 'prefix') {
        if (prefixes.some((registered) => registered.path === route.path)) throw new Error('duplicate prefix route ' + JSON.stringify(route.path) + ' (the kernel web server refuses duplicate (kind, path) pairs)')
        prefixes.push(route)
      } else {
        if (exact.has(route.path)) throw new Error('duplicate exact route ' + JSON.stringify(route.path) + ' (the kernel web server refuses duplicate (kind, path) pairs)')
        exact.set(route.path, route)
      }
    }
  }
  prefixes.sort((a, b) => b.path.length - a.path.length)
  return { exact, prefixes }
}

function matchRoute(table, pathname) {
  const exact = table.exact.get(pathname)
  if (exact !== undefined) return exact
  for (const route of table.prefixes) {
    if (pathname === route.path) return route
    if (pathname.startsWith(route.path + '/')) return route
  }
  return undefined
}

/**
 * Mount subsystems and listen on an ephemeral loopback port.
 * @param {Array<{routes: Function, start?: Function, stop?: Function}>} subsystems
 * @param {{log?: (line: string) => void}} [options]
 * @returns {Promise<{origin: string, server: object, log: string[], close: () => Promise<void>}>}
 */
export async function mountSubsystems(subsystems, options = {}) {
  const log = []
  const note = (line) => { log.push(line); if (typeof options.log === "function") options.log(line) }
  const table = buildTable(subsystems)
  const sockets = new Set()
  for (const subsystem of subsystems) {
    if (typeof subsystem.start === "function") await subsystem.start()
  }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const route = matchRoute(table, pathname)
    if (route === undefined) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({ ok: false, error: { code: 'link/not-found', message: 'no route ' + pathname } }))
      note(req.method + ' ' + pathname + ' -> 404 (harness)')
      return
    }
    note(req.method + ' ' + pathname + ' -> handler')
    Promise.resolve().then(() => route.handler(req, res)).catch((error) => {
      note('handler threw: ' + String(error?.message ?? error))
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: { code: 'link/internal', message: String(error?.message ?? error) } }))
      } else {
        try { res.end() } catch (ignored) { /* response already gone */ }
      }
    })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.keepAliveTimeout = 1000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const origin = 'http://127.0.0.1:' + String(port)
  note('harness listening ' + origin)
  return {
    origin,
    server,
    log,
    async close() {
      for (const subsystem of [...subsystems].reverse()) {
        if (typeof subsystem.stop === "function") {
          try { await subsystem.stop() } catch (error) { note('stop threw: ' + String(error?.message ?? error)) }
        }
      }
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
      note('harness closed')
    },
  }
}

/**
 * One no-pooling JSON request (fetch keep-alive does not settle cleanly at Windows process exit).
 * @param {string} url
 * @param {{method?: string, body?: unknown, headers?: object, timeoutMs?: number}} [options]
 * @returns {Promise<{status: number, headers: object, text: string, json: unknown}>}
 */
export function requestJson(url, options = {}) {
  const target = new URL(url)
  const method = options.method ?? 'GET'
  const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }
  if (payload !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.byteLength)
  }
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method, headers, agent: false },
      (incoming) => {
        let text = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk) => { text += chunk })
        incoming.on('end', () => {
          let json = null
          try { json = JSON.parse(text) } catch (ignored) { json = null }
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, text, json })
        })
      },
    )
    outgoing.setTimeout(options.timeoutMs ?? 10000, () => outgoing.destroy(new Error('request timeout ' + url)))
    outgoing.on('error', reject)
    if (payload !== undefined) outgoing.write(payload)
    outgoing.end()
  })
}

/**
 * Open an SSE endpoint, collect frames for a bounded window, then hang up.
 * @param {string} url
 * @param {{maxEvents?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{status: number, headers: object, events: object[], text: string}>}
 */
export function openEventStream(url, options = {}) {
  const target = new URL(url)
  const maxEvents = options.maxEvents ?? 1
  const timeoutMs = options.timeoutMs ?? 2000
  return new Promise((resolve, reject) => {
    let settled = false
    let status = 0
    let headers = {}
    let buffer = ''
    const events = []
    let incoming = null
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { if (incoming !== null) incoming.destroy() } catch (ignored) { /* already closed */ }
      resolve({ status, headers, events, text: buffer })
    }
    const timer = setTimeout(finish, timeoutMs)
    incoming = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: 'GET', headers: { accept: 'text/event-stream' }, agent: false },
      (response) => {
        status = response.statusCode ?? 0
        headers = response.headers
        response.setEncoding('utf8')
        if (status !== 200 || !String(headers['content-type'] ?? '').startsWith('text/event-stream')) {
          response.on('data', (chunk) => { buffer += chunk })
          response.on('end', finish)
          return
        }
        response.on('data', (chunk) => {
          buffer += chunk
          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
            if (data !== '') { try { events.push(JSON.parse(data)) } catch (ignored) { /* non-JSON frame */ } }
            if (events.length >= maxEvents) { finish(); return }
            boundary = buffer.indexOf('\n\n')
          }
        })
        response.on('end', finish)
      },
    )
    incoming.on('error', (error) => { if (settled) return; clearTimeout(timer); reject(error) })
    incoming.end()
  })
}

export default { mountSubsystems, requestJson, openEventStream }
