# OFM standalone — real access path (LINK adapts it)

~~BT~~our-free-model~~BT~~ (OFM) standalone is the framework's adapter 0. This page is the runbook for a real install,
what DSH-LINK detects, and how the evidence in this repository relates to it.

## What the real standalone looks like (measured R476, v2.5.4)

The main branch was taken as a source archive through the gh mirror (GitHub is unreachable directly on
this machine), extracted outside the repository, and started **from source with no npm install** (the
standalone has no runtime dependency; it bundles its vendor pieces):

    # archive:
    https://gh-proxy.org/https://github.com/Ebony-Vinyl/dsh-our-free-model/archive/refs/heads/main.zip
    # start (prints one-time management login link, API url, key file):
    node packages/standalone/cli.mjs

What it writes into ~~BT~~~/.our-free-model~~BT~~ (measured):

| Fact | Real value |
| --- | --- |
| ~~BT~~service.lock~~BT~~ | ~~BT~~{"pid":27464,"product":"our-free-model-standalone","token":"<uuid>"}~~BT~~ — **no port field** |
| ~~BT~~settings.json~~BT~~ | ~~BT~~standalonePort: 18900~~BT~~, ~~BT~~forwardKey: "ofm-…"~~BT~~, forward/LAN settings, catalog cache time |
| ~~BT~~catalog.json~~BT~~ | the catalog the service advertises (10706 bytes at first run) |
| ~~BT~~GET /health~~BT~~ | ~~BT~~{"ok":true,"service":"our-free-model-standalone","product":"standalone","version":"2.5.4","capabilities":{anonymous,kilo,eac,accountChannels,webUi}}~~BT~~ |
| ~~BT~~GET /v1/models~~BT~~ (Bearer ~~BT~~forwardKey~~BT~~) | 200, **27 models**, e.g. ~~BT~~big-pickle~~BT~~, ~~BT~~beam-free~~BT~~, ~~BT~~glm-5.3-flash-free~~BT~~, ~~BT~~deepseek-v4.1-flash-free~~BT~~ |

Note: the main branch's ~~BT~~package.json~~BT~~ says 2.5.9 while the running service reports 2.5.4 — a
main-branch version string inconsistency, not a LINK problem.

## How LINK finds it (the declaration was corrected by this reading)

The plan's example read the port from ~~BT~~service.lock~~BT~~. The real lock has **no port**; the port lives in
~~BT~~settings.json.standalonePort~~BT~~. The shipped ~~BT~~adapters/ofm/adapter.json~~BT~~ now probes:

1. ~~BT~~~/.our-free-model/settings.json~~BT~~ (or ~~BT~~$OFM_HOME/settings.json~~BT~~) → ~~BT~~standalonePort~~BT~~ = the port;
2. identity ~~BT~~GET http://127.0.0.1:{port}/health~~BT~~ must contain ~~BT~~our-free-model~~BT~~ (real answer does);
3. consent card "接入 Our Free Model 作为模型供应商" (scope ~~BT~~models.provide~~BT~~);
4. only then read ~~BT~~settings.json.forwardKey~~BT~~ (memory only);
5. verify ~~BT~~GET /v1/models~~BT~~ with that bearer → 200;
6. bind: provider id ~~BT~~our-free-model~~BT~~, state + receipt under ~~BT~~<DSH_HOME>/link-interconnect/adapters.json~~BT~~.

## Measured live flow (R476)

- Restart with the corrected declaration: the persisted receipt names the old declaration version, so
  restore answered ~~BT~~rejoin-required: the declaration changed after the person granted access~~BT~~ — the designed
  re-consent rule, now seen against the real product.
- Adapter row: ~~BT~~detected:true~~BT~~ (fingerprint matched the real ~~BT~~/health~~BT~~), consent card shown, "允许" →
  binding ~~BT~~active~~BT~~, ~~BT~~providerId=our-free-model~~BT~~ at ~~BT~~http://127.0.0.1:18900~~BT~~; kernel log:
  ~~BT~~model provider our-free-model registered from adapter ofm~~BT~~ / ~~BT~~adapter ofm bound: models.provide at http://127.0.0.1:18900~~BT~~.
- The whole live acceptance matrix then re-ran against this REAL service: **31/31 held** (the M2 rows
  bind the real product, the M5 rows forward through it).
- M5 proxy end-to-end through the real product: ~~BT~~GET /link/v1/openai/v1/models~~BT~~ with an ~~BT~~lk_~~BT~~ key → **200** with
  the real 27-model catalog; ~~BT~~POST …/chat/completions~~BT~~ was forwarded to the real service and answered with the
  real product's own refusal: ~~BT~~429 {"code":"RATE_LIMIT","message":"Free usage limit reached…"}~~BT~~; one model also
  answered ~~BT~~403 REGION_BLOCKED~~BT~~. So the integration is live and the upstream refusal is passed through
  faithfully — but **no successful completion can be shown on this machine today**: OFM's anonymous free
  quota is exhausted on this network (and one model is region-blocked). Signing in through the management
  page's account channels is what unlocks a successful model call; that needs the person's accounts.

## Operating it

- Management page: one-time login link printed by the CLI at every start (10 minutes, single use); the
  API key is in ~~BT~~~/.our-free-model/settings.json.forwardKey~~BT~~ and also works as the login secret.
- Stop: Ctrl+C in that terminal (or kill the node process); a clean stop removes ~~BT~~service.lock~~BT~~.
- The standalone keeps its own data: ~~BT~~channel-credentials.json~~BT~~, ~~BT~~channel-pack/~~BT~~, ~~BT~~eac-user.json~~BT~~; it does not
  read DSH's config or credentials. Do not point ~~BT~~OFM_HOME~~BT~~ at the DSH plugin's data directory.
- LAN inference is optional (~~BT~~--lan --lan-port 18901~~BT~~) with its own LAN key; LINK's adapter uses the loopback
  API only.
