#!/usr/bin/env node
/**
 * Standalone OFM (Our Free Model) stand-in for the link-interconnect adapter checks.
 *
 * It serves exactly the surface adapters/ofm/adapter.json declares, on loopback:
 *   GET /health                  a body containing "our-free-model" (identity fingerprint)
 *   GET /v1/models               bearer-gated; the model catalog
 *   POST /v1/chat/completions    bearer-gated; canned SSE deltas
 *   POST /link/v1/invoke         the software-facing invoke route, for a tools.expose fixture
 * and, when given --data-dir, writes the two files the OFM declaration probes:
 *   service.lock   {"port": actualPort, "pid": ..., "product": "our-free-model-standalone"}
 *   settings.json  {"forwardKey": ...}
 *
 * Usage:
 *   node scripts/ofm-stub.mjs --data-dir <dir> [--port 18900] [--key <forwardKey>]
 *
 * The OFM declaration reads ~/.our-free-model, so the standalone default data dir is
 * <home>/.our-free-model; point --data-dir somewhere else only together with a matching home
 * override (the unit test does that in-process). Import startOfmStub() to drive it from a test
 * on an ephemeral port (port 0).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The port the M2 acceptance reading expects when no --port is given. */
export const DEFAULT_PORT = 18900
/** The forward key written when no --key is given. */
export const DEFAULT_KEY = 'ofm-stub-forward-key'
/** The catalog GET /v1/models advertises. */
export const STUB_MODELS = [
  { id: 'our-free-model', name: 'Our Free Model' },
  { id: 'our-free-model-mini', name: 'Our Free Model Mini' },
]
/** The canned streamed text, split into deltas. */
export const STUB_DELTAS = ['Hello', ' from', ' the', ' OFM', ' stub!']

/** Read a JSON request body; an empty or malformed body is not fatal for a stub. */
function readJson(req) {
  return new Promise((resolvePromise) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', () => resolvePromise(undefined))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolvePromise(undefined)
      try { resolvePromise(JSON.parse(text)) } catch { resolvePromise(undefined) }
    })
  })
}

/**
 * Start the stand-in.
 * @param {{ port?: number, dataDir?: string, forwardKey?: string, silent?: boolean, deltas?: string[] }} options
 * @returns the running stub: its port, recorded requests, setForwardKey() and close().
 */
export async function startOfmStub(options = {}) {
  const requestedPort = options.port ?? DEFAULT_PORT
  const dataDir = options.dataDir ?? join(homedir(), '.our-free-model')
  const silent = options.silent ?? false
  const deltas = options.deltas ?? STUB_DELTAS
  const state = {
    port: null,
    forwardKey: options.forwardKey ?? DEFAULT_KEY,
    dataDir,
    authorizations: [],
    chatRequests: [],
    invokeRequests: [],
    modelsRequests: 0,
  }
  const respond = (res, status, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
    res.end(text)
  }
  const authorized = (req) => req.headers.authorization === 'Bearer ' + state.forwardKey
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/health') {
      return respond(res, 200, { product: 'our-free-model', name: 'Our Free Model', peer: 'link-test-peer', status: 'ok', version: '0.0.0-stub' })
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      state.modelsRequests += 1
      state.authorizations.push(String(req.headers.authorization ?? ''))
      if (!authorized(req)) return respond(res, 401, { error: { message: 'the forward key is missing or invalid', code: 'link/unauthorized' } })
      return respond(res, 200, { object: 'list', data: STUB_MODELS.map((model) => ({ ...model, object: 'model', owned_by: 'our-free-model' })) })
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      state.authorizations.push(String(req.headers.authorization ?? ''))
      if (!authorized(req)) return respond(res, 401, { error: { message: 'the forward key is missing or invalid', code: 'link/unauthorized' } })
      const body = await readJson(req)
      state.chatRequests.push(body)
      const model = body !== undefined && typeof body.model === 'string' ? body.model : 'our-free-model'
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
      for (const part of deltas) {
        res.write('data: ' + JSON.stringify({ id: 'chatcmpl-ofm-stub', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] }) + '\n\n')
      }
      res.write('data: ' + JSON.stringify({ id: 'chatcmpl-ofm-stub', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/link/v1/invoke') {
      const body = await readJson(req) ?? {}
      state.invokeRequests.push(body)
      if (body.op === 'echo.ping') {
        return respond(res, 200, { ok: true, result: { echo: body.args !== undefined && body.args !== null && body.args.text !== undefined ? body.args.text : null, cap: body.cap ?? null, op: body.op } })
      }
      return respond(res, 200, { ok: false, error: { code: 'link/not-found', message: 'the stub holds no handler for ' + String(body.op) } })
    }
    respond(res, 404, { error: { message: 'no route ' + String(req.method) + ' ' + url.pathname } })
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(requestedPort, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  state.port = server.address().port
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'service.lock'), JSON.stringify({ port: state.port, pid: process.pid, product: 'our-free-model-standalone', startedAt: new Date().toISOString() }, null, 2) + '\n')
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ forwardKey: state.forwardKey, apiPort: state.port, writtenBy: 'dsh-link ofm stub' }, null, 2) + '\n')
  if (!silent) console.log('OFM stub: http://127.0.0.1:' + state.port + ' (data dir ' + dataDir + ')')
  return {
    port: state.port,
    url: 'http://127.0.0.1:' + state.port,
    dataDir,
    state,
    setForwardKey(key) { state.forwardKey = key },
    close() {
      return new Promise((resolvePromise) => {
        server.close(() => resolvePromise())
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      })
    },
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (name, fallback) => {
    const at = argv.indexOf(name)
    return at === -1 ? fallback : argv[at + 1]
  }
  const dataDir = flag('--data-dir', join(homedir(), '.our-free-model'))
  const port = Number(flag('--port', String(DEFAULT_PORT)))
  const key = flag('--key', DEFAULT_KEY)
  try {
    const running = await startOfmStub({ dataDir, port, forwardKey: key })
    console.log('OFM stub data dir: ' + running.dataDir)
    console.log('service.lock and settings.json written; the ofm declaration reads ~/.our-free-model')
    const shutdown = async () => {
      await running.close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (error) {
    console.error('OFM stub could not start: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
