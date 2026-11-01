#!/usr/bin/env node
/**
 * echo-service - the smallest software peer of link-interconnect/1.
 *
 * It declares one tool (echo.ping) and one OpenAI-compatible model, then serves what LINK pulls
 * from a peer: GET /.well-known/link-interconnect.json, POST /link/v1/invoke, GET /link/v1/events.
 *
 *   node examples/echo-service/main.mjs
 *   LINK_ECHO_TOKEN=secret PORT=18950 node examples/echo-service/main.mjs
 *
 * Plain node, no dependencies, no build step.
 */
import { pathToFileURL } from 'node:url'
import { serve } from '../../src/index.mjs'

/** The declaration LINK reads before it asks the person for consent. */
export function echoManifest() {
  return {
    protocol: 'link-interconnect/1',
    identity: { linkId: 'svc_echo_01', name: 'Echo Service', vendor: 'dsh-link-example' },
    endpoints: { invoke: '/link/v1/invoke', events: '/link/v1/events' },
    capabilities: [
      { kind: 'models.provide', version: 1, auth: 'bearer', scopes: ['models.provide'], models: { path: '/v1' } },
      {
        kind: 'tools.expose',
        version: 1,
        auth: 'bearer',
        scopes: ['tools.expose'],
        tools: [
          {
            name: 'echo.ping',
            description: '回显调用参数 (echo the invoke arguments)',
            parameters: { type: 'object', properties: { text: { type: 'string' } } },
            call: { cap: 'tools.expose', op: 'echo.ping' },
          },
        ],
      },
    ],
    limits: { rpm: 60 },
  }
}

/** Start the peer; resolves once listening, returning the SDK server plus its bearer token. */
export async function startEchoService(options = {}) {
  // A configured token is enforced exactly (the vendor's own credential). Without one this
  // loopback example accepts any non-empty bearer, which is what lets LINK present the token its
  // pairing minted: the example has no way to know that token in advance. Deployments set
  // LINK_ECHO_TOKEN when they want an exact match.
  const token = options.token !== undefined ? options.token : process.env.LINK_ECHO_TOKEN !== undefined ? process.env.LINK_ECHO_TOKEN : undefined
  const auth = (request) => token === undefined || token === ''
    ? typeof request.token === 'string' && request.token !== ''
    : request.token === token
  const handlers = {
    'tools.expose/echo.ping': async (args, context) => ({ pong: true, echo: args, peer: context.peer === undefined ? null : context.peer }),
  }
  const chat = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : []
    const last = messages.length === 0 ? undefined : messages[messages.length - 1]
    const text = last !== undefined && typeof last.content === 'string' ? last.content : ''
    return {
      id: 'chatcmpl-echo-' + Date.now().toString(36),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: typeof body.model === 'string' ? body.model : 'echo-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'echo: ' + text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }
  const peer = await serve({
    manifest: echoManifest(),
    handlers,
    auth,
    models: { list: [{ id: 'echo-1', owned_by: 'dsh-link-example' }], chat },
    port: options.port === undefined ? Number(process.env.PORT === undefined ? 0 : process.env.PORT) : options.port,
    // Loopback by default, like every protocol client expects. A LAN run sets LINK_ECHO_HOST=0.0.0.0
    // so the allowlist path (M6) can reach it at this machine's LAN address.
    host: options.host !== undefined ? options.host : process.env.LINK_ECHO_HOST !== undefined ? process.env.LINK_ECHO_HOST : '127.0.0.1',
  })
  return {
    url: peer.url,
    manifestUrl: peer.manifestUrl,
    manifest: peer.manifest,
    port: peer.port,
    publish: peer.publish,
    close: peer.close,
    token: token === undefined ? 'loopback-any' : token,
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const peer = await startEchoService()
  console.log('[echo-service] listening on ' + peer.url)
  console.log('[echo-service] declaration  ' + peer.manifestUrl)
  console.log('[echo-service] bearer token ' + peer.token)
  const stop = async () => {
    await peer.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
