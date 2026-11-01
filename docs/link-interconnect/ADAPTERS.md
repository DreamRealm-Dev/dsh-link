# Declarative adapters — LINK adapts software (the LINK-active direction)

An adapter is a JSON declaration first: probe, identify, ask, verify, bind. Script code is the
exception, and it is budgeted.

## 1. Layout and budget

    plugins/dsh-link-interconnect/adapters/<id>/adapter.json   the declaration (always)
    plugins/dsh-link-interconnect/adapters/<id>/adapter.mjs    optional, <= 120 lines

`node scripts/verify-adapter-budget.mjs` fails the build when an `adapter.mjs` is over 120 lines or an
`adapter.json` is missing/malformed. OFM is declaration-only (0 script lines).

## 2. adapter.json fields

| Field | Meaning |
| --- | --- |
| `id`, `name`, `vendor` | Identity of the integration; `id` must equal the directory name. |
| `match.files[]` | `{path, jsonPath?, as}` — a file that proves installation and yields a variable (OFM: lock file -> `port`). `~~/` expands to the user home; `$VAR` expands from the environment. |
| `match.env[]` | Environment variables that also prove installation (name only; values are never read for identity). |
| `match.identity` | `{method, url, contains?, jsonPath?, equals?, expectStatus?}` — one request whose answer proves the service is the declared one (OFM: `/health` contains `our-free-model`). |
| `connect.baseUrl` | Absolute origin, usually `http://127.0.0.1:{port}`. |
| `connect.credential` | `{kind:"file-json", path, jsonPath}`, `{kind:"env", name}` or `{kind:"none"}`. Read **only after consent**. |
| `connect.verify[]` | `{method, path, expectStatus?, auth?}` — the capability check made before anything is written. |
| `capabilities[]` | What the binding provides. Shipped: `models.provide` with `from:"openai"` and `as:{providerId,label}`. |
| `consent` | `{title, scopes[]}` — the card the person sees; it carries display facts only. |
| `limits` | `{rpm, timeoutMs}`. |

## 3. Lifecycle (frozen order; a failure rolls everything back)

1. **Probe** — read the declared files/env. Missing is a normal `not-installed` reading, not an error.
2. **Identify** — call `match.identity`; a wrong fingerprint is `foreign-service`, a silent port is `not-running`.
3. **Ask** — `core.consent.request()`; nothing about the credential is read before this resolves `granted`.
4. **Read credential** — the declaration's credential source, in memory only, never copied out of its directory.
5. **Verify** — every `connect.verify` step must pass.
6. **Bind** — write `adapters.json` (state + a consent receipt: adapter id, scopes, granted-at, declaration
   version) and publish `interconnect/bindings`; the model binder registers the provider.
7. **Audit** — one record per step, codes and durations only, never arguments.
8. **Health** — every 60 s; three consecutive failures mark the binding unavailable (not removed, to avoid flapping).

Restart restore reads the receipt and re-verifies; a changed declaration, a revoked grant or a failed
re-verify restores as `rejoin-required` and reads no credential. A peer's bearer token is memory-only:
a persisted peer binding restores as `rejoin-required` too.

## 4. Probe reason codes (shown verbatim in the pane)

`not-installed` · `no-service` · `not-running` · `foreign-service` ·
`unsupported-version` · `probe-failed`

## 5. Adding an adapter

1. Create `adapters/<id>/adapter.json` (copy OFM's and change probe/identity/consent/limits).
2. If the declaration cannot express a mapping, add `adapter.mjs` — stay under 120 lines.
3. `node scripts/verify-adapter-budget.mjs` and `node scripts/link-interconnect-parse-check.mjs`.
4. Restart the app (adapters are read at apply), open the LINK panel: the row must show detected with
   its fingerprint reason; connect asks once and the provider appears under its declared id.

## 6. OFM as adapter 0

`adapters/ofm/adapter.json` is the worked example: `settings.json.standalonePort` (or `$OFM_HOME/settings.json`) gives the port — the real
`service.lock` carries pid/product/token and no port (corrected against the real product, R476) — `/health`
containing `our-free-model` identifies the service, `settings.json.forwardKey` is the bearer,
`GET /v1/models` must answer 200, and the binding's provider id is `our-free-model`. The real-install
runbook and the measured install are in `OFM-INTEGRATION.md`.
