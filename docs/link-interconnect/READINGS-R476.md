# link-interconnect — R476 readings (the REAL Our Free Model standalone, installed and measured)

R472 measured the adapter against a stub of OFM's documented shape. This round installs the real
product and re-runs the integration against it — which changed one line of adapter data (the real
lock file carries no port) and produced the first real end-to-end numbers.

## 1. What was installed, and how

The standalone has **no published installer artifact yet** (its own README: "独立安装制品尚未发布",
"本阶段从完整仓库运行"). So it was taken as a source archive and run from source:

    # GitHub is blocked on this machine; the gh mirror serves the archive
    https://gh-proxy.org/https://github.com/Ebony-Vinyl/dsh-our-free-model/archive/refs/heads/main.zip
    # extracted outside the repo, then (no npm install needed - no runtime dependency):
    node packages/standalone/cli.mjs

Measured facts of the run:

| Fact | Value |
| --- | --- |
| service | `our-free-model-standalone 2.5.4` (the main-branch `package.json` says 2.5.9 — a main-branch version-string inconsistency, not a LINK problem) |
| API | `http://127.0.0.1:18900/v1` |
| data dir | `~/.our-free-model` (fresh; the stub's fake dir was set aside) |
| key file | `~/.our-free-model/settings.json`, field `forwardKey` |
| lock file | `{"pid":…,"product":"our-free-model-standalone","token":"…"}` — **no port field** |
| port source | `settings.json.standalonePort: 18900` |
| `GET /health` | `{"ok":true,"service":"our-free-model-standalone","product":"standalone","version":"2.5.4","capabilities":{"anonymous":true,"kilo":true,"eac":true,"accountChannels":true,"webUi":true}}` |
| `GET /v1/models` (Bearer `forwardKey`) | 200, **27 models** (`big-pickle`, `beam-free`, `glm-5.3-flash-free`, `deepseek-v4.1-flash-free`, …) |

## 2. The one adapter correction this real install forced

The plan's example (and R472's stub) read the port from the lock file. The real lock has **no port**;
the port lives in `settings.json.standalonePort`. `adapters/ofm/adapter.json` now probes
`~/.our-free-model/settings.json` (or `$OFM_HOME/settings.json`) for `standalonePort`; identity, credential
(`forwardKey`) and verify (`GET /v1/models` 200) are unchanged. Data only — the 120-line budget is
untouched and the declaration stays script-free.

## 3. Real live readings

| # | Reading | Evidence |
| --- | --- | --- |
| R476.1 | the real service is detected by its own fingerprint | adapter row `detected:true` after restart; the real `/health` contains `our-free-model` |
| R476.2 | the changed declaration refuses the old receipt | kernel log: `adapter ofm needs to be connected again: the declaration changed after the person granted access (receipt 5bcef2…, current 555fe9…)` → binding `rejoin-required`, no credential read |
| R476.3 | one consent question, then the real product binds | card `接入 Our Free Model 作为模型供应商` (`models.provide`) → `{"status":"active","providerId":"our-free-model","baseUrl":"http://127.0.0.1:18900"}` |
| R476.4 | the kernel registers the real provider | boot log: `model provider our-free-model registered from adapter ofm` / `adapter ofm bound: models.provide at http://127.0.0.1:18900` |
| R476.5 | the whole live acceptance matrix runs against the REAL product | `link-interconnect-live-accept.mjs` → **31/31 held, 0 failed** (M2 binds the real product; M5 forwards through it) |
| R476.6 | a models.proxy key reaches the real catalog through LINK | `GET /link/v1/openai/v1/models` (Bearer `lk_…`) → **200**, the real 27-model list, at `/link/v1/openai/…` |
| R476.7 | a chat call is forwarded to the real product and its refusal passed through faithfully | `POST /link/v1/openai/v1/chat/completions` (`glm-5.3-flash-free`) → **429** `{"code":"RATE_LIMIT","message":"Free usage limit reached. Subscribe to OpenCode Go …"}` — the product's own answer |
| R476.8 | a region-blocked model is forwarded as such | `beam-free` → `403 REGION_BLOCKED` from the real product |
| R476.9 | the proxy key ledger still stores only sha256 | `proxy-keys.json` keys carry `keySha256`; the raw key is absent; revoke → 200 |

**Honest limit:** no *successful completion* could be shown on this machine today, because OFM's
anonymous free quota is exhausted on this network (and one model is region-blocked). That is the real
product's upstream state, visible through LINK unchanged — the integration path itself is measured
(R476.4/R476.6/R476.7). Unlocking a successful call means signing in through the real product's
management page account channels (needs the person's accounts) or its EAC/kilo channels.

## 4. Operating notes

- Management page: the CLI prints a one-time login URL at every start (10 min, single use); the API key
  in `settings.json.forwardKey` also works as the login secret.
- Stop: Ctrl+C in its terminal; a clean stop removes `service.lock`.
- The stub used in R472 is kept at `scripts/ofm-stub.mjs` for offline/CI shapes, but the live acceptance
  now meets whatever OFM service is running: with the real product it holds 31/31.
- The stub's fake data dir was moved to `~/.our-free-model.stub-backup` before the real install; delete it if
  nothing needs the old test data.

## 5. Gates after the correction

    node scripts/link-interconnect-parse-check.mjs   6 held / 0 failed
    node scripts/verify-adapter-budget.mjs           2 held / 0 failed (OFM: declaration only)
    node scripts/link-interconnect-live-accept.mjs   31/31 (against the REAL service)
