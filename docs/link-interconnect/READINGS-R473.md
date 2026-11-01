# link-interconnect - R473 readings (M3 ingress: software adapts to LINK)

The SDK and the peer-side protocol were already green in R472. R473 delivers the LINK side of the
software-active direction: a software peer is added by its well-known origin, asked about once, and
its declared tools and model channel are bound through the same seams the declarative OFM adapter uses.

## The live closed loop

Measured on the running app with the SDK's own echo peer (`packages/link-interconnect-sdk/examples/echo-service/main.mjs`):

```
POST /api/dsh-link-interconnect/peers {op:'add', url:'http://127.0.0.1:19500'}
  -> consent pending: 接入 Echo Service 的工具与模型  scopes=models.provide,tools.expose
POST /api/dsh-link-interconnect/consent {id, decision:'granted'}
  -> add result: {linkId:'svc_echo_01', status:'active', tools:['echo.ping'], providerId:'svc_echo_01'}
GET /api/dsh-link-interconnect/peers
  -> [{ linkId:'svc_echo_01', tools:['echo.ping'], providerId:'svc_echo_01', models:['echo-1'] }]
kernel boot log:
  [dsh-link-interconnect] tools registered from peer svc_echo_01: echo.ping
  [dsh-link-interconnect] model provider svc_echo_01 registered from adapter peer:svc_echo_01
  [dsh-link-interconnect] peer svc_echo_01 (Echo Service) bound at http://127.0.0.1:19500: 1 tool(s), 1 model channel
```

**The agent-call reading** (the acceptance sentence "agent 调 echo.ping 成功"): a model turn was sent
through the app's own composer, asking it to call the peer tool. The transcript shows the tool result:

```
已完成，用时 8 秒
json
{
  "pong": true,
  "echo": { "text": "hello-from-agent" },
  "peer": null
}
```

![agent called the peer tool](artifacts/R473-agent-echo-call.png)

The model-facing tool name is `echo_ping`, not the declared `echo.ping` - see the measured defect below.

## Measured defect found by this round (and fixed)

**A dotted tool name poisons the whole model request.** Registering the peer tool under its declared
name `echo.ping` is accepted by the kernel registry, but the provider wire rejects the request with
`400 status code (no body) INVALID_REQUEST` - every agent turn in that session failed until the peer
was removed. The kernel's own convention for tool names is `[A-Za-z0-9_-]{1,64}`; OpenAI tool names
have the same rule. Fix: `bind/peer.ts` maps every declaration to a provider-safe, per-peer-unique
registration name (`echo.ping` -> `echo_ping`, original named in the description) while the invoke
call keeps the declared `call.op` (`echo.ping`). Re-measured after the fix: with the tool registered,
a plain turn answers normally, and the echo call above returns `{"pong":true}`.

## The M3 rows in the live acceptance matrix

`node scripts/link-interconnect-live-accept.mjs` now starts the echo peer in-process and takes these
rows (it removes the peer at the end, so the run is repeatable):

| # | Reading | Evidence |
| --- | --- | --- |
| M3.0 | the SDK echo service starts in-process | `http://127.0.0.1:<ephemeral>` |
| M3.1 | adding a peer by URL raises one consent question naming it | `接入 Echo Service 的工具与模型` |
| M3.2 | the question carries the scopes the declaration asks for | `models.provide,tools.expose` |
| M3.3 | the peer is active with its declared tool | `{status:'active', tools:['echo.ping']}` |
| M3.4 | the peer contributes a model channel | `providerId='svc_echo_01'` |
| M3.5 | the model catalog answers through the registered provider | `models:['echo-1']` (the adapter asked the peer's GET /v1/models) |
| M3.6 | the kernel registered the peer tool | boot log: `tools registered from peer` |
| M3.7 | removing the peer drops the binding | `{removed:true}` |

Whole matrix that run: **31/31 held, 0 failed** (M1 basics 6, M2 7, M3 8, M4 5, M5 5).

## What the peer ingress refuses (and why)

- non-loopback origin not named by the LAN allowlist: named `link/bad-request` (SSRF rule of the
  plan: only declared loopback/allowlist; M6 landed the allowlist, see READINGS-R475.md);
- a declaration with a wrong protocol major: `link/version-unsupported`; unknown capability kinds are
  ignored by name, not guessed;
- a denied question: `link/consent-required`, and no token is minted;
- any failure during binding: the session is released and the peer row, grant, tools and provider are
  rolled back together (no half-bound peer).

A peer's bearer token is memory-only. After a restart the peer row is restored as `rejoin-required`
rather than pretending its session survived, and re-adding it reuses the same persistent row.

## Gates after this round

```
node scripts/link-interconnect-parse-check.mjs     6 held, 0 failed
node scripts/link-interconnect-live-accept.mjs     31/31 (live)
node scripts/link-interconnect-sdk-check.mjs       18 passed, 0 failed
node scripts/link-interconnect-check.mjs --live    12/12
node scripts/build-pack.mjs --check                matches (24 plugins)
```
