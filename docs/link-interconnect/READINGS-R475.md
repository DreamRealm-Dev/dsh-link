# link-interconnect — R475 readings (M6: LAN declaration, docs complete, OFM real-access path)

This is the closing round of the M1→M6 objective. The rows below were measured on this machine with
DSH-LINK running; every command is runnable from `<workspace>\\dsh-link`.

## M6.1 LAN — the allowlist is the declaration, and it is measured with a second process

Policy (`LAN.md`, `SECURITY.md §5`): loopback is always reachable; any other host must be named, either by
`<DSH_HOME>/link-interconnect/lan-allowlist.json` (`{"hosts": ["<lan-ip>", "laptop.local:19510"]}`) or by
`LINK_PEER_ALLOWLIST` (comma list of `host` / `host:port`). There is no allow-all switch. No listener is opened for
the LAN: in the software-active direction LINK is the HTTP **client**, so the allowlist opens egress only.

`node scripts/link-interconnect-lan-check.mjs --prepare` writes this machine's LAN address into the allowlist
(named <lan-ip> here); after a restart the plugin logs
`peer discovery policy: loopback always; LAN allowlist 1 entr(y/ies)`. Then:

    node scripts/link-interconnect-lan-check.mjs --run

| # | Reading | Evidence |
| --- | --- | --- |
| M6.1 | the allowlist names this machine LAN address | `lan-allowlist.json hosts=["<lan-ip>"]` |
| M6.2 | a **second process** serves its declaration over the LAN address | echo service child bound 0.0.0.0, answered `http://<lan-ip>:19610/.well-known/link-interconnect.json` with protocol `link-interconnect/1` |
| M6.3 | a host outside the allowlist is refused by name | `400 link/bad-request`: "peer 192.0.2.10:1 is not loopback and is not named by the LAN allowlist" |
| M6.4 | adding the LAN peer raises one consent question naming it | `接入 Echo Service 的工具与模型` |
| M6.5 | it binds tools + model channel | `{status:'active', tools:['echo.ping'], providerId:'svc_echo_01'}` at origin `http://<lan-ip>:19610` |
| M6.6 | its model catalog answers through the kernel provider | `models:["echo-1"]` |
| M6.7 | the kernel registered its tool and provider | boot.log: `tools registered from peer` + `model provider` |
| M6.8 | removal releases it | `{removed:true}` |

**M6 LAN check: 8/8 held, 0 failed, exit 0.** A literal second machine uses the same path (outbound HTTP
client + allowlist); the second process is the address-level proof available on one machine.

## M6.2 Docs — the set is complete

| File | Lines | Role |
| --- | --- | --- |
| `README.md` | 33 | index + quickstart + where it lives |
| `PROTOCOL.md` | 139 | stable public spec: discovery, identity, handshake, invoke/events, codes, four capabilities, contract |
| `ADAPTERS.md` | 64 | declaration schema, frozen lifecycle, 120-line budget, probe codes, OFM as adapter 0 |
| `SECURITY.md` | 63 | trust boundaries, consent order, credential rules, tokens/revocation, embed CSP, LAN policy, known limits |
| `LAN.md` | 47 | allowlist format/sources, egress-not-ingress, discovery plan (reuse lan-bridge announce), measured reading |
| `OFM-INTEGRATION.md` | 56 | real OFM standalone runbook, detection, install steps, what was measured vs what was not |
| `SDK.md` | 105 | peer-side vendor contract (R472) |
| `EMBED-AND-PROXY.md` | 127 | M4/M5 routes, matrix, wiring, limits (R472) |

## M6.3 OFM standalone — real access path

`adapters/ofm/adapter.json` (declaration only) reads the real install's surface: `settings.json.standalonePort`
(or `$OFM_HOME/settings.json`) → port, `GET /health` containing `our-free-model` as the identity fingerprint,
consent, then `settings.json.forwardKey` as bearer, `GET /v1/models` 200, provider `our-free-model`.
**Correction (R476):** the plan-era belief that the lock file names the port was wrong for the real
product — its lock carries pid/product/token only; the port lives in `settings.json.standalonePort`. The
shipped declaration now reads that. The runbook and the real measured install are in
`OFM-INTEGRATION.md` / `READINGS-R476.md`.

**What is measured and what is not:** the live loop (R472) ran against a stub that speaks exactly that
documented shape, because the real standalone artifact is not installed on this machine
(`~/.our-free-model` absent) and its releases are not published. Everything the adapter depends on lives in
`adapter.json` (data), so a real install with a different key path changes data only, and the 120-line budget
gate keeps that true. This is the "real access path", stated honestly rather than claimed as an installed run.

## Closing gate matrix (M1→M6)

| Gate / reading | Result |
| --- | --- |
| `link-interconnect-parse-check.mjs` | 6 held / 0 failed |
| M1 `link-interconnect-check.mjs --standalone` | 12/12 |
| M1 `... --live` (through the shell) | 12/12, incl. no-token 401 and missing-scope 403 |
| M2 (inside live acceptance) | 7/7: probe → consent card → bind → provider `our-free-model` → counts |
| M3 (inside live acceptance) | 8/8 + agent call transcript `{"pong":true}` (R473) |
| M4 embed v2 | 5/5 live + 8 unit; no token 401 / correct token+nonce 200 with CSP / revoked 401 |
| M5 models.proxy | 5/5 live + 12 unit; 200 / 403 whitelist / 429 + retry-after / sha256-only ledger |
| M6 LAN | 8/8 live (above) |
| `link-interconnect-live-accept.mjs` total | **31/31 held, 0 failed** |
| `link-interconnect-sdk-check.mjs` | 18/18 |
| `link-interconnect-edge-check.mjs` | 16/16 |
| `verify-adapter-budget.mjs` | 2/0; OFM declaration-only |
| unit suites | protocol 13/13, adapter 115/115, embed 8/8, proxy 12/12 |
| `check-plugin-contract` | interconnect 10 pass/0 fail; liquid-glass 10 pass/0 fail |
| `build-pack --check` | matches (24 plugins / 21 rows / 13 client bundles) |
| `dsh-runtime.mjs` | `interlink shell=200 kernel=200`; linkstate peers/bindings/adapters one line |

## Known limits (carried forward, named)

- Peer authentication is declaration-level: a peer that accepts any bearer is trusted to the extent the
  person consented. Mutual key verification (peer validating LINK's JWS with LINK's published key) is next.
- LAN **discovery** still reuses the operator step (add peer by URL); multicast discovery over lan-bridge's
  announce/grants is planned, not shipped (`LAN.md`).
- The link-interconnect pane can show peers but not yet add one by URL (the API and the check script can);
  the clients' add-peer row is the next UI increment.
- models.proxy upstream is one deployment-level OpenAI-compatible channel, not per-peer routing.
