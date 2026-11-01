#!/usr/bin/env node
/**
 * link-interconnect-sdk check - the SDK's own reading table.
 *
 * Starts the bundled echo peer in-process and measures every promise the SDK makes: the
 * well-known declaration, invoke auth + dispatch, the stable 404/401 codes, SSE events,
 * models.provide, idempotency, the reverse linkClient, and the frozen-contract mirror (the ids
 * in src/protocol.mjs are compared against plugins/dsh-link-interconnect/src/protocol/types.ts,
 * which is imported directly - node 22.19+ strips the types).
 *
 *   node test/sdk.test.mjs                          (from packages/link-interconnect-sdk)
 *   node scripts/link-interconnect-sdk-check.mjs    (the repo gate)
 *
 * Exit 0 all held | 1 a reading failed.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CAPS,
  CONTRACT_VERSION,
  ERROR_CODES,
  LIMITS,
  PROTOCOL_ID,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  ROUTES,
  SCOPES,
  LinkSdkError,
  declare,
  linkClient,
} from '../src/index.mjs'
import { echoManifest, startEchoService } from '../examples/echo-service/main.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const PROJECT_ROOT = resolve(HERE, '../../..')

/** POST one invoke body to the peer, with or without its bearer token. */
function invokePeer(peer, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = 'Bearer ' + token
  return fetch(peer.url + ROUTES.invoke, { method: 'POST', headers, body: JSON.stringify(body) })
}

/** Read SSE frames until one payload satisfies the predicate (heartbeats and comments skipped). */
async function readSseEvent(reader, predicate, timeoutMs = 4000) {
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  let buffer = ''
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) throw new Error('SSE stream ended before the event arrived')
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const candidate = JSON.parse(line.slice(6))
        if (predicate(candidate)) return candidate
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  throw new Error('no matching SSE event within ' + timeoutMs + 'ms')
}

/** Close an http server and its keep-alive sockets. */
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  })
}

/**
 * Run every reading. Prints the table through log() and resolves true when all held.
 * @param {{ log?: Function, extraReadings?: Array<{label: string, run: Function}> }} options
 *   extraReadings lets a caller (the repo gate) append repo-specific rows to the same table; each
 *   entry needs {label, run}, and its outcome counts toward the pass/fail total.
 */
export async function runSdkChecks(options = {}) {
  const log = options.log === undefined ? console.log : options.log
  const readings = []
  const reading = async (label, fn) => {
    try {
      const detail = await fn()
      readings.push({ ok: true, label, detail: detail === undefined ? '' : String(detail) })
    } catch (error) {
      const detail = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
      readings.push({ ok: false, label, detail: detail.slice(0, 400) })
    }
  }

  let peer = null
  let fakeLink = null
  try {
    await reading('package.json: no dependencies, type module, ESM exports', () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
      assert.equal(manifest.type, 'module')
      assert.equal(manifest.dependencies, undefined)
      assert.equal(manifest.devDependencies, undefined)
      assert.equal(manifest.peerDependencies, undefined)
      assert.equal(manifest.optionalDependencies, undefined)
      assert.equal(typeof manifest.exports['.'], 'string')
      assert.ok(existsSync(join(PACKAGE_ROOT, manifest.exports['.'])))
      return 'type=module, deps=0, exports["."]=' + manifest.exports['.']
    })

    await reading('declare(): normalises the echo manifest (2 caps, 1 tool)', () => {
      const declared = declare(echoManifest())
      assert.equal(declared.protocol, PROTOCOL_ID)
      assert.equal(declared.capabilities.length, 2)
      const tools = declared.capabilities.find((capability) => capability.kind === CAPS.toolsExpose).tools
      assert.equal(tools.length, 1)
      assert.equal(tools[0].name, 'echo.ping')
      assert.deepEqual(tools[0].call, { cap: CAPS.toolsExpose, op: 'echo.ping' })
      assert.ok(Object.isFrozen(declared))
      return 'caps=2, tools=1, frozen'
    })

    await reading('declare(): wrong protocol major -> link/version-unsupported', () => {
      const manifest = Object.assign({}, echoManifest(), { protocol: 'link-interconnect/2' })
      assert.throws(() => declare(manifest), (error) => error instanceof LinkSdkError && error.code === ERROR_CODES.versionUnsupported)
      return ERROR_CODES.versionUnsupported
    })

    await reading('declare(): malformed manifest -> link/bad-request', () => {
      assert.throws(
        () => declare({ protocol: PROTOCOL_ID, identity: { linkId: 'svc_bad_01', name: 'Bad' }, capabilities: [] }),
        (error) => error instanceof LinkSdkError && error.code === ERROR_CODES.badRequest,
      )
      return ERROR_CODES.badRequest
    })

    peer = await startEchoService()

    await reading('well-known: protocol, identity and echo.ping declaration', async () => {
      const response = await fetch(peer.manifestUrl)
      assert.equal(response.status, 200)
      assert.ok((response.headers.get('content-type') ?? '').startsWith('application/json'))
      const declaration = await response.json()
      assert.equal(declaration.protocol, PROTOCOL_ID)
      assert.equal(declaration.identity.linkId, 'svc_echo_01')
      assert.equal(declaration.identity.name, 'Echo Service')
      assert.equal(declaration.endpoints.invoke, ROUTES.invoke)
      const tools = declaration.capabilities.find((capability) => capability.kind === CAPS.toolsExpose).tools
      assert.ok(tools.some((tool) => tool.name === 'echo.ping' && typeof tool.description === 'string' && typeof tool.parameters === 'object'))
      return 'protocol=' + declaration.protocol + ', id=' + declaration.identity.linkId + ', tools=' + tools.length
    })

    await reading('invoke: bearer token reaches echo.ping and echoes args', async () => {
      const response = await invokePeer(peer, { cap: CAPS.toolsExpose, op: 'echo.ping', args: { text: 'hello' } }, peer.token)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.ok, true)
      assert.equal(body.result.pong, true)
      assert.deepEqual(body.result.echo, { text: 'hello' })
      return 'status=200, pong=true, echo.text=' + body.result.echo.text
    })

    await reading('invoke: no token -> 401 link/unauthorized', async () => {
      const response = await invokePeer(peer, { cap: CAPS.toolsExpose, op: 'echo.ping' })
      assert.equal(response.status, 401)
      const body = await response.json()
      assert.equal(body.ok, false)
      assert.equal(body.error.code, ERROR_CODES.unauthorized)
      return 'status=401, code=' + body.error.code
    })

    await reading('invoke: unknown op -> 404 link/not-found, named', async () => {
      const response = await invokePeer(peer, { cap: CAPS.toolsExpose, op: 'echo.missing' }, peer.token)
      assert.equal(response.status, 404)
      const body = await response.json()
      assert.equal(body.error.code, ERROR_CODES.notFound)
      assert.ok(body.error.message.includes('tools.expose/echo.missing'))
      return 'status=404, code=' + body.error.code
    })

    await reading('routing: unknown path -> 404 with a named code', async () => {
      const response = await fetch(peer.url + '/no/such/route')
      assert.equal(response.status, 404)
      const body = await response.json()
      assert.equal(body.error.code, ERROR_CODES.notFound)
      return 'status=404, code=' + body.error.code
    })

    await reading('models.provide: GET /v1/models lists the echo model', async () => {
      const response = await fetch(peer.url + '/v1/models', { headers: { authorization: 'Bearer ' + peer.token } })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.object, 'list')
      assert.equal(body.data[0].id, 'echo-1')
      return 'models=' + body.data.map((model) => model.id).join(',')
    })

    await reading('models.provide: POST /v1/chat/completions answers', async () => {
      const response = await fetch(peer.url + '/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + peer.token, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'hi' }] }),
      })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.object, 'chat.completion')
      assert.equal(body.choices[0].message.content, 'echo: hi')
      return 'choices=1, content=echo: hi'
    })

    await reading('events: SSE delivers a published event', async () => {
      const response = await fetch(peer.url + ROUTES.events + '?token=' + encodeURIComponent(peer.token))
      assert.equal(response.status, 200)
      assert.ok((response.headers.get('content-type') ?? '').startsWith('text/event-stream'))
      const reader = response.body.getReader()
      try {
        peer.publish({ type: 'echo:test', n: 7 })
        const event = await readSseEvent(reader, (candidate) => candidate.type === 'echo:test')
        assert.equal(event.n, 7)
        return 'type=' + event.type + ', n=' + event.n
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    await reading('idempotency: the same key replays the first answer', async () => {
      const first = await (await invokePeer(peer, { cap: CAPS.toolsExpose, op: 'echo.ping', args: { n: 1 }, idempotencyKey: 'check-key-1' }, peer.token)).json()
      const second = await (await invokePeer(peer, { cap: CAPS.toolsExpose, op: 'echo.ping', args: { n: 2 }, idempotencyKey: 'check-key-1' }, peer.token)).json()
      assert.equal(first.ok, true)
      assert.deepEqual(second, first)
      return 'replayed args=' + JSON.stringify(first.result.echo)
    })

    await reading('linkClient(): contract/invoke/embedToken/openai vs LINK', async () => {
      const seen = []
      fakeLink = createServer((request, response) => {
        const chunks = []
        request.on('data', (chunk) => chunks.push(chunk))
        request.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: raw === '' ? null : JSON.parse(raw) })
          response.setHeader('content-type', 'application/json')
          if (request.url === ROUTES.contract) return response.end(JSON.stringify({ protocol: PROTOCOL_ID, contractVersion: CONTRACT_VERSION }))
          if (request.url === ROUTES.invoke) return response.end(JSON.stringify({ ok: true, result: { pong: true } }))
          if (request.url === ROUTES.embedToken) return response.end(JSON.stringify({ token: 'embed-token-1', expiresAt: 'soon' }))
          if (request.url === ROUTES.openaiPrefix + '/v1/models') return response.end(JSON.stringify({ object: 'list', data: [{ id: 'echo-1' }] }))
          response.statusCode = 404
          response.end(JSON.stringify({ ok: false, error: { code: ERROR_CODES.notFound, message: 'no route' } }))
        })
      })
      fakeLink.listen(0, '127.0.0.1')
      await once(fakeLink, 'listening')
      const address = fakeLink.address()
      const client = linkClient({ baseUrl: 'http://127.0.0.1:' + address.port, token: 'lk_check_token' })
      const contract = await client.contract()
      assert.equal(contract.protocol, PROTOCOL_ID)
      const invoked = await client.invoke({ cap: CAPS.toolsExpose, op: 'echo.ping', args: { text: 'back' } })
      assert.equal(invoked.pong, true)
      const embed = await client.embedToken({ sessionId: 's1', mode: 'sidebar', origin: 'http://127.0.0.1:1' })
      assert.equal(embed.token, 'embed-token-1')
      const models = await client.openai('models')
      assert.equal(models.data[0].id, 'echo-1')
      assert.equal(seen.length, 4)
      assert.ok(seen.every((call) => call.authorization === 'Bearer lk_check_token'))
      assert.deepEqual(seen.find((call) => call.url === ROUTES.invoke).body.args, { text: 'back' })
      assert.equal(seen.find((call) => call.url === ROUTES.openaiPrefix + '/v1/models').method, 'GET')
      await closeServer(fakeLink)
      fakeLink = null
      return seen.length + ' reverse calls, all Bearer-authenticated'
    })

    await reading('frozen mirror: SDK ids equal src/protocol/types.ts', async () => {
      const frozenPath = join(PROJECT_ROOT, 'plugins/dsh-link-interconnect/src/protocol/types.ts')
      if (!existsSync(frozenPath)) return 'skipped: types.ts is not in this checkout'
      const frozen = await import(pathToFileURL(frozenPath).href)
      assert.equal(PROTOCOL_ID, frozen.PROTOCOL_ID)
      assert.equal(PROTOCOL_MAJOR, frozen.PROTOCOL_MAJOR)
      assert.equal(PROTOCOL_MINOR, frozen.PROTOCOL_MINOR)
      assert.equal(CONTRACT_VERSION, frozen.CONTRACT_VERSION)
      for (const [key, value] of Object.entries(ROUTES)) assert.equal(frozen.ROUTES[key], value, 'ROUTES.' + key + ' drifted')
      assert.deepEqual([...SCOPES], [...frozen.SCOPES])
      assert.deepEqual(Object.assign({}, CAPS), Object.assign({}, frozen.CAPS))
      assert.deepEqual(Object.assign({}, ERROR_CODES), Object.assign({}, frozen.ERROR_CODES))
      assert.deepEqual(Object.assign({}, LIMITS), Object.assign({}, frozen.LIMITS))
      return 'protocol/routes/scopes/caps/errors/limits match (' + Object.keys(ERROR_CODES).length + ' codes)'
    })

    await reading('serve(): close() stops the listener', async () => {
      const closing = peer
      peer = null
      await closing.close()
      let reachable = false
      try {
        await fetch(closing.manifestUrl)
        reachable = true
      } catch {
        reachable = false
      }
      assert.equal(reachable, false)
      return 'port ' + closing.port + ' closed'
    })

    await reading('examples/echo-service/main.mjs: runs under plain node', async () => {
      const script = join(PACKAGE_ROOT, 'examples/echo-service/main.mjs')
      const child = spawn(process.execPath, [script], { env: Object.assign({}, process.env, { LINK_ECHO_TOKEN: 'child-token' }), stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      try {
        const base = await new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => rejectPromise(new Error('no listening line; output: ' + output.slice(0, 300))), 8000)
          const settle = (callback, value) => {
            clearTimeout(timer)
            callback(value)
          }
          child.stdout.on('data', (chunk) => {
            output += chunk.toString()
            const match = /listening on (http:\/\/\S+)/.exec(output)
            if (match !== null) settle(resolvePromise, match[1])
          })
          child.stderr.on('data', (chunk) => {
            output += chunk.toString()
          })
          child.on('exit', (code) => settle(rejectPromise, new Error('echo-service exited ' + code + '; output: ' + output.slice(0, 300))))
        })
        const response = await fetch(base + ROUTES.wellKnown)
        assert.equal(response.status, 200)
        const declaration = await response.json()
        assert.equal(declaration.identity.name, 'Echo Service')
        return 'plain node child served ' + base
      } finally {
        child.kill()
      }
    })
  } catch (error) {
    const detail = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
    readings.push({ ok: false, label: 'check harness', detail: detail.slice(0, 400) })
  } finally {
    if (peer !== null) {
      try {
        await peer.close()
      } catch {
        // The harness is already reporting the original failure.
      }
    }
    if (fakeLink !== null) {
      try {
        await closeServer(fakeLink)
      } catch {
        // Same: never mask the reading failure with cleanup noise.
      }
    }
  }

  for (const extra of options.extraReadings === undefined ? [] : options.extraReadings) {
    if (extra === null || typeof extra !== 'object' || typeof extra.label !== 'string' || typeof extra.run !== 'function') {
      readings.push({ ok: false, label: 'extra reading', detail: 'extraReadings entries need {label, run}' })
      continue
    }
    await reading(extra.label, extra.run)
  }

  const failed = readings.filter((reading) => !reading.ok).length
  log('link-interconnect-sdk check')
  log('reading'.padEnd(58) + ' result')
  for (const item of readings) log((item.ok ? 'ok   ' : 'FAIL ') + item.label.padEnd(54) + ' ' + item.detail)
  log('---')
  log(readings.length - failed + ' passed, ' + failed + ' failed')
  return failed === 0
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const held = await runSdkChecks()
  process.exitCode = held ? 0 : 1
}
