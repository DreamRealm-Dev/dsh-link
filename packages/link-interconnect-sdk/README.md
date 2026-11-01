# @dsh-link/link-interconnect-sdk

Zero-dependency ESM SDK for the link-interconnect/1 protocol (see
docs/link-interconnect/PLAN.md and plugins/dsh-link-interconnect/src/protocol/types.ts, the FROZEN
contract this package mirrors).

Three entry points, one import:

    import { declare, serve, linkClient } from '@dsh-link/link-interconnect-sdk'

## Peer side (LINK adapts your software)

    const manifest = declare({
      protocol: 'link-interconnect/1',
      identity: { linkId: 'svc_echo_01', name: 'Echo Service' },
      capabilities: [
        { kind: 'tools.expose', version: 1, auth: 'bearer', scopes: ['tools.expose'],
          tools: [{ name: 'echo.ping', description: 'echo', parameters: { type: 'object' } }] },
        { kind: 'models.provide', version: 1, auth: 'bearer', scopes: ['models.provide'] },
      ],
    })

    const peer = await serve({
      manifest,
      handlers: { 'tools.expose/echo.ping': (args) => ({ pong: args }) },  // or key by op alone
      auth: (request) => request.token === process.env.LINK_PEER_TOKEN,
      models: { list: ['echo-1'], chat: (body) => completionFor(body) },
      port: 0,             // ephemeral by default
      host: '127.0.0.1',   // loopback, as the protocol requires
    })
    // peer.url, peer.manifestUrl, peer.publish(event), await peer.close()

serve() answers GET /.well-known/link-interconnect.json, POST /link/v1/invoke,
GET /link/v1/events (SSE, token in ?token= or Authorization), and - only when the manifest declares
models.provide - GET /v1/models and POST /v1/chat/completions.

Handler lookup is handlers[cap + '/' + op] first, then handlers[op]. A handler receives (args,
context); returning a value answers {ok:true, result}, throwing a LinkSdkError answers its stable
code, throwing anything else answers link/internal. invoke bodies may carry idempotencyKey; the
first answer for a key is replayed for LIMITS.idempotencyMs.

## Reverse side (your software calls LINK)

    const link = linkClient({ baseUrl: 'http://127.0.0.1:31760', token: 'lk_...' })
    const contract = await link.contract()
    const result = await link.invoke({ cap: 'tools.expose', op: 'something', args: {} })
    const embed = await link.embedToken({ sessionId, mode: 'sidebar', origin })
    const models = await link.openai('models')   // /link/v1/openai/v1/models
    const answer = await link.anthropic('messages', { method: 'POST', body: JSON.stringify(body) })

A refusal throws a LinkSdkError carrying the protocol code (link/unauthorized, link/not-found, ...)
so callers branch on data, never on prose.

## The example

examples/echo-service/main.mjs is the runnable peer: one tool, one model, plain node.

    node examples/echo-service/main.mjs

## Reading

    node scripts/link-interconnect-sdk-check.mjs      # from the dsh-link repo root

The check starts the echo peer in-process and measures the declaration, invoke auth/404 paths,
the SSE route, the models surface, idempotency, the reverse linkClient and the frozen-contract
mirror (it imports src/protocol/types.ts and compares ids). Exit 0 means every reading held.
