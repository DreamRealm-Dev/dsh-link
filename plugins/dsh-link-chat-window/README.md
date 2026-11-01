# dsh-link-chat-window — R493 B2 paged Chat event window (prototype, default off)

The R493 deliverable for B2: the **500-entry live-tail ring + old-page eviction** for the Chat
event window, as a default-off prototype. The design, audit numbers, invariants, toggle decision
and rollback are in [../../../docs/handoff/R493-b2-paged-window.md](../../../docs/handoff/R493-b2-paged-window.md);
the kernel client seam it needs is the unapplied draft
[../../../docs/kernel-patches/R501-draft.patch](../../../docs/kernel-patches/R501-draft.patch).

## What is in the box

| Path | Role |
|---|---|
| `src/policy.ts` | pure policy: 500/125 cap + slack, opening-page second truncation, fold ledger, the structural `takeWindowTail` trim primitive |
| `src/tail-window.ts` | the kernel-seam payload: `TailWindow.appendLive/pageIn/trimTo` over the real `MutableSessionEventSource` surface, including the `baseSeq`/`hasMore` bookkeeping a Session owns |
| `src/index.ts` | host half: exports the payload; when `enabled: true` publishes `ctx.linkChatWindow` (inspection only, no runtime effect without the kernel seam) |
| `src/client/index.ts` | browser half: when `enabled: true` publishes the optional plain-data policy object `globalThis.__DSH_EVENT_WINDOW_LIMIT__` that R501 reads; default off is a no-op |
| `bench/window-bench.mjs` | benchmark against the **real** kernel `MutableSessionEventSource` + `ConversationNodeAssembler` (10k/50k/100k), invariants, R495 §5.2 counterfactual, default-off overhead |
| `bench/live-calibration.json` | the live CDP calibration the bench models DOM/memory with (30.0 chat elements per chat node, 843 shell chrome, 0.0657 ms/node render slope) |
| `bench/results.json` | measured output of the last run |
| `tools/` | the read-only live audit probes (CDP 9222 page eval + kernel RPC inventory) that produced R493 §3 |

## Default off

- host half: `config.enabled` defaults to `false`; when false, `apply` registers nothing and logs nothing.
- client half: when false, `apply` returns before touching the global.
- kernel: the R501 draft reads the optional global per Session open; absent/malformed => stock
  unbounded behavior. Measured default-off cost is in `bench/results.json` §`defaultOff` and
  §`defaultOffIsolated`.

## Why a client plugin alone cannot do this

Measured (R493 §4): a dynamic client row runs in a page-level Cordis context whose service store
has no `sessions` service, and the Session face it can reach through slot props exposes
`loadOlder()`/`loadThrough()` but **not** the event window. So the plugin can request pages but
cannot trim the window or retire conversation nodes. The window cap is therefore a kernel client
patch (R501 draft: 3 files, +171/−2, `git apply --check` exit 0 on the current worktree);
this package carries the exact payload that patch calls plus the measurements proving it.

## Build / enable (Lead-owned)

The package is not in `plugins/build.mjs` yet (writing that list is Lead-owned). To build and
mount it:

1. append the row next to `dsh-link-compute` in `plugins/build.mjs`:
   `{ name: 'dsh-link-chat-window', client: 'src/client/index.ts' },`
2. `node plugins/build.mjs --only dsh-link-chat-window` under `.build.lock`
3. add the `cordis.patch.yml` row to the LINK profile bundle list with `enabled: true`
4. apply `docs/kernel-patches/R501-draft.patch` and rebuild the kernel client bundle
   (see R493 §8 for the exact commands; the browser module is `lib/client.js` of
   `@deepseek-ai/dsh-api-session-controller`, and the host webserver reloads rebuilt client
   bundles without a kernel-process restart).