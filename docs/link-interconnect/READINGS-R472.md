# link-interconnect — R472 readings (M1 + M2 delivered)

Every line below was measured on this machine in the R472 round. Commands are runnable from `<workspace>\\dsh-link`.
The design these numbers accept or reject is `PLAN.md` next to this file.

## M1 — the protocol skeleton

| # | Reading | Evidence |
| --- | --- | --- |
| 1 | Standalone suite 12/12 | `node scripts/link-interconnect-check.mjs --standalone` → **12/12 held, 0 failed** |
| 2 | Live suite 12/12 through the shell | `node scripts/link-interconnect-check.mjs --live --url http://127.0.0.1:31761 --pairing-code <pairing.json code>` → **12/12 held, 0 failed** |
| 3 | Contract is read-only by construction | two GETs byte-identical: bytes=2523 sha256=b286e697652b9928 |
| 4 | No token is 401 | reading 08: `401 link/unauthorized` |
| 5 | Missing scope is 403 | reading 09: `403 link/scope-missing` |
| 6 | Wrong method keeps its Allow header through the proxy | reading 04: `405 link/method-not-allowed Allow=GET` |
| 7 | Idempotent replay is marked | reading 11: same bytes on the second call (replay marker travels as `x-link-*`) |
| 8 | Events route is a stream | reading 12: `text/event-stream`, backlog replay, invoke frames |
| 9 | Protocol unit suite | `node --import tsx/esm plugins/dsh-link-interconnect/test/protocol.test.mjs` → **13/13 tests** |
| 10 | Wire ids frozen for peers | SDK gate reading `frozen mirror: SDK ids equal src/protocol/types.ts` |
| 11 | Self-declaration | `GET /.well-known/link-interconnect.json` → **200** (through shell and kernel) |
| 12 | Shell forwarding | `/link/v1/contract` → **200** on 31761 (shell) and 31760 (kernel); `cargo build` exit 0 |

### Two integration defects this round found and fixed (both were live-only)

1. **Routes were bound at shutdown, not at boot.** `src/index.ts` pushed `() => release(server.register(route))` into the
   disposer list, so every route registered only when the fiber disposed. Symptom: boot log said "12 route(s)" while
   every /link and /api plugin path answered 404. Fix: register now, keep only the disposer.
2. **The /link proxy dropped the protocol's own headers.** The first forwarding reused the `/api` unary path, which sends
   only body + content-type + cookie. A peer's Bearer token never reached the kernel (invoke → 401) and the response lost
   `Allow`/`x-link-*` (405 without Allow, replay without its marker). Fix: `forward_link` forwards
   authorization/accept/content-type/idempotency-key/dsh-link-client upstream and relays content-type/allow/cache-control/x-link-* back.

## M2 — declarative adapter, OFM as adapter 0

Live closed loop, driven end to end on the running app (app up, stub on 127.0.0.1:18900 with the declaration's own data dir):

```
adapters: [{ id:'ofm', name:'Our Free Model', detected:true }]        ← probe found the service by its /health fingerprint
consent pending: id=consent_… title=接入 Our Free Model 作为模型供应商 scopes=models.provide
decide (clicked 允许 in the client card): {"ok":true}
connect result: status=active providerId=our-free-model baseUrl=http://127.0.0.1:18900
after: bindings=1 active=1 providers=our-free-model/active/models.provide
client marker: {route:'live', pendingConsent:0, bindings:1, peers:3, adapters:1, audit:20}
panel row: data-link-adapter="ofm" detected="true" binding="active" → "Our Free Model 已发现 our-free-model 已接入"
```

Kernel log lines that make it a registration and not just a stored row:

```
[dsh-link-interconnect] model provider our-free-model registered from adapter ofm
[dsh-link-interconnect] adapter ofm bound: models.provide at http://127.0.0.1:18900
```

| Reading | Evidence |
| --- | --- |
| Adapter lifecycle suite | adapter test → **115 held, 0 failed** (probe reasons, consent-before-credential, verify, rollback, unregister, receipt restore, external binding) |
| Declaration budget | `node scripts/verify-adapter-budget.mjs` → **2 held, 0 failed**; OFM is declaration-only (0 lines of adapter.mjs, budget 120) |
| Credential never persisted | adapters.json v2 carries a consent receipt (adapterId/scopes/consentGrantedAt/declarationVersion) and **no key** |
| Restart restore | kernel restart re-verified the credential and re-registered the provider from the receipt; a failed verify / revoked grant / changed declaration restores as `rejoin-required` with no credential read |
| Honest not-detected reasons | `not-installed` / `not-running` / `foreign-service` are named and shown verbatim in the pane |

## M3 support + SDK + SDK-side software

| Reading | Evidence |
| --- | --- |
| Zero-dependency SDK | `node scripts/link-interconnect-sdk-check.mjs` → **18 passed, 0 failed** (no dependencies; PEP-style manifest validation; invoke auth; SSE; models surface; idempotency; `linkClient` reverse calls) |
| SDK provenance read | `packages/link-interconnect-sdk/test/sdk.test.mjs` → 17 passed; echo example runs under plain node |
| Provider factory for peers | adapters' additive exports (`createOpenAiCompatibleAdapter`, `registerExternalBinding`/`releaseExternalBinding`) tested in the same 115-reading suite |
| Vendor contract doc | `docs/link-interconnect/SDK.md` (105 lines) |

## Client half (the pane draws the live state)

| Reading | Evidence |
| --- | --- |
| Mounted under live data | `globalThis.__dshLinkInterconnectClient` → `{mounted:true, route:'live', linkId, pendingConsent, peers, adapters, bindings, audit}` |
| Consent card | after a connect: stack `data-link-pending="1"`, card risk=low, title/peer/scope chip, buttons `拒绝`/`允许` |
| Click-driven consent | clicking `[data-link-consent-decision="granted"]` resolved the host consent and the same connect call came back `active` |
| Peers surface | footer `[data-link-footer]` "软件互联"; panel `[data-link-panel="open"]` with 3 peer rows, the active OFM adapter row, grants and the audit list |
| Bundle | `lib/client.js` 49 KB; gate parse green; only the shell's preloaded module baseline imported |

Two live-only client defects found by the pixels/CDP, fixed in this round:

1. **Detached fetch threw "Illegal invocation"** (strict-mode module calling `fetch()` with `this === undefined`), so the
   poller reported `route:'error'` forever while an eval-time sloppy fetch worked. Fix: `globalThis.fetch.bind(globalThis)`.
2. **Primary button label invisible** (white text on the white accent pill) in the consent card and the 接入 button —
   fixed in the client stylesheet after the screenshot review.

## Repo gates that include the new package

```
node scripts/link-interconnect-parse-check.mjs   → 6 held, 0 failed   (parse host+client, cordis-free layering, adapters, manifest)
node scripts/build-pack.mjs --check              → pack/pack.json matches the plugin tree (24 plugins, 21 rows, 13 client bundles)
node scripts/check-plugin-contract.mjs dsh-link-interconnect → 10 pass / 0 fail / 1 unknown (row-id contested is decided by the mounting composition)
node scripts/verify-adapter-budget.mjs           → 2 held, 0 failed
node scripts/dsh-runtime.mjs                     → interlink shell=200 kernel=200; linkstate peers=… bindings=… adapters=["ofm:detected"]
```

## M4 - embed v2 (live matrix, 5/5)

| # | Reading | Evidence |
| --- | --- | --- |
| 1 | A session token is minted for one audience | POST /link/v1/embed/token -> 200 {token, expiresAt, url} |
| 2 | No token is 401 | GET /link/v1/embed/session -> 401 link/unauthorized |
| 3 | A foreign audience is refused | Origin http://127.0.0.1:19499 -> 401 |
| 4 | The correct audience gets the page and its frame policy | Origin http://127.0.0.1:19401 -> 200 text/html; CSP frame-ancestors http://127.0.0.1:19401; default-src 'none'; script-src 'unsafe-inline' ... |
| 5 | Revocation kills the same token | POST /api/.../tokens/revoke {jti} -> 200; the same embed GET -> 401 |

The nonce is minted WITH the token (its url carries it); a hand-picked nonce is refused by design.

## M5 - models.proxy (live matrix, 5/5)

| # | Reading | Evidence |
| --- | --- | --- |
| 1 | An admin mints one proxy key | POST /api/dsh-link-interconnect/proxy-keys {label, models, rpm} -> 200, raw lk_ key returned once |
| 2 | A whitelisted model channel answers 200 | GET /link/v1/openai/v1/models with Bearer -> 200 {"object":"list","data":[{"id":"our-free-model",...}]} (real upstream) |
| 3 | A model outside the key whitelist is 403 | POST /link/v1/openai/v1/chat/completions {model: not-in-the-whitelist} -> 403 link/scope-missing |
| 4 | The one-minute rate cap answers 429 + Retry-After | 4th call inside the minute -> 429 link/rate-limited, retry-after=20 |
| 5 | The raw key is never stored | the admin listing carries ids only; proxy-keys.json holds sha256 |

The upstream is deployment config (LINK_PROXY_UPSTREAM_URL / LINK_PROXY_UPSTREAM_KEY) to an OpenAI-compatible channel;
without it the proxy answers 503 link/peer-unavailable instead of pretending to work. Offline proxy suite: 12/12.

## One live acceptance run (all four milestones at once)

```
cd <workspace>\\dsh-link
node scripts/link-interconnect-live-accept.mjs
→ link-interconnect live acceptance: 23/23 held, 0 failed
   (M1 basics 6, M2 closed loop 7, M4 embed 5, M5 proxy 5)
```

Final gates for the round:

```
node scripts/link-interconnect-parse-check.mjs       6 held, 0 failed
node scripts/link-interconnect-check.mjs --standalone 12/12
node scripts/link-interconnect-edge-check.mjs        16/16
node scripts/link-interconnect-sdk-check.mjs         18 passed, 0 failed
node scripts/link-interconnect-live-accept.mjs       23/23 (live)
node scripts/verify-adapter-budget.mjs               2 held, 0 failed
node scripts/build-pack.mjs --check                  pack.json matches the plugin tree
```

## What is not delivered yet (named, not implied)

- M3 finished end to end (a software peer added by URL -> its tool callable by an agent -> its model in the picker): the SDK,
  the provider factory and the external-binding seam are green; the ingress wiring is the next increment.
- M6 LAN path, the OFM standalone's own well-known declaration, and the public PROTOCOL.md.
- The proxy upstream is deployment config today; pointing it at the kernel's already-configured providers (ctx.llm) is next.
