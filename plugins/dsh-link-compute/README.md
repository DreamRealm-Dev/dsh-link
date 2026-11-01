# dsh-link-compute

The Cordis host half of DSH-LINK's native compute core (R486). One Host row, no browser half, no
tool, no route, no prompt section: the row publishes `ctx.linkCompute` and loads nothing else.

## What it publishes

`ctx.linkCompute` is a `ComputeFacade` (see `src/binding.ts`):

| member | meaning |
|---|---|
| `kind` | `'native'` or `'typescript'` — which half is answering now |
| `version` / `detail` | the crate/reference version and where the answering half came from |
| `foldCollabRecords(recordsJson)` | fold `dsh-link-collab` control records into the summary JSON |
| `indexTeamStatus(eventsJson)` | index a team event stream into the team-status JSON |
| `openFoldIndex()` | a stateful incremental index over control records; `appendBatch`/`deltaSince` take JSON, `appendRecords`/`readDelta` take the byte layouts (see below) |
| `probe()` | `{ok, kind, nativeApiVersion, features, version, detail}` — which API the answering half speaks |
| `health()` | the ready/health readout: kind, nativeApiVersion, version, pairLocked, fallback counters |
| `nativeCalls` / `nativeFailures` / `lastError` | health counters; only calls change them |

Both functions are pure: the same input produces the same canonical JSON, they touch no I/O and no
kernel service. Inputs are JSON arrays as text; damaged rows are counted in the output, not guessed
at; a non-array root throws `Error('COMPUTE_INPUT: ...')`.

The contract and the two output documents are defined by the crate
(`rust/crates/dsh-compute-napi/src/{fold,team}.rs`) and mirrored byte for byte by
`src/reference.ts`. `rust/scripts/smoke.mjs` asserts the parity on the fixtures.

## Loading and fallback

1. `enabled: false` (default) — `apply` logs one line and returns. No addon is loaded and no
   service is published, so a stock composition is unchanged.
At activation the row prints one machine-readable ready line:
`[link-compute] ready {"kind":"native","nativeApiVersion":2,"version":"0.3.0",...}`. It is built from
`facade.health()`, so a health probe can read the half/API/version and the fallback counters without
calling the addon. The wrapper and the platform package are expected to be version pair-locked
(`nativeVersion()` == `REFERENCE_VERSION`); an API mismatch is refused at load and falls back, a
same-API crate-version skew loads but reports `pairLocked:false`.

2. `enabled: true, nativeEnabled: true` — the addon at `lib/dsh_compute.node` is `require()`d and
   validated. The loader requires the `probe()` handshake to report `nativeApiVersion === 1` and every
   feature this build uses (`byteBatched`, `deltaCursor`, `collabFoldIndex`, ...). A missing file, a
   wrong-platform binary, a broken ABI, an older/newer API version, a missing feature or a module
   that does not export the entry points resolves to the pure-TS reference instead; `detail` says why.
3. `enabled: true, nativeEnabled: false` — the reference only.

After a native **call** fails (a panic surfacing as a JS error, or a non-string return), the facade
re-answers that call from the reference, increments `nativeFailures` once, records `lastError`, and
latches the reference for the rest of the process. A hot path must not retry a broken addon.

Both halves are defined over one explicit input domain: valid UTF-8, finite numbers with magnitude
at most 2^53-1, and no lone surrogate escapes. Out-of-domain input throws \`COMPUTE_DOMAIN\` from
both halves instead of one silently folding what the other refuses. Damaged NDJSON *syntax* is
still counted and skipped. A native domain failure latches the facade to the reference, counts it
in \`nativeFailures\` and rethrows; an already-open native index cannot migrate, so the caller
reopens to get a reference index. See \`docs/handoff/R497-compute-batching.md\` section 2.5.

The **incremental index** keeps its state inside the answering half, so a failure inside an open
index is not replayed (the state is gone); the error surfaces and the caller reopens with
`nativeEnabled: false` if it wants the reference. Load-time fallback still covers the addon being
missing, a wrong ABI, a wrong native API version, or an addon that does not export the class.

The **byte-batched entries** (`appendRecords(frame)` / `readDelta(cursor)`) are for a producer that
already holds ledger bytes: an append takes NDJSON (one record per line, damaged lines counted and
skipped) and returns a 32-byte stats buffer; a delta read returns a compact binary delta instead of
a JSON string. The layouts are documented in `rust/crates/dsh-compute-napi/src/wire.rs` and decoded
by `decodeAppendStats` / `decodeDelta` in `src/reference.ts`. R497 measured the batching and
byte-batched paths against the same-shape TS implementation; the numbers and the enable/disable
verdict live in `docs/handoff/R497-compute-batching.md`.

## Configuration

| key | default | effect |
|---|---|---|
| `enabled` | `false` | load the core at all |
| `nativeEnabled` | `true` | allow the addon; `false` forces the reference |

## Build and test

```powershell
cd <workspace>\\dsh-link
node rust/scripts/build.mjs                  # cargo build + publish lib/dsh_compute.node
node plugins/dsh-link-compute/build.mjs      # bundle lib/index.js
node rust/scripts/smoke.mjs                  # native/TS parity proof (one-shot + incremental)
node --expose-gc rust/scripts/bench-incremental.mjs  # incremental Rust vs incremental TS
node --expose-gc rust/scripts/bench-batched.mjs      # batching multiple + byte-batched vs TS
node rust/scripts/verify-r497-numbers.mjs           # doc claims + coverage gate
node rust/scripts/compare-bench-runs.mjs --baseline-manifest rust/bench-runs/baseline.json --current "rust/bench-runs/bench-batched-*-<label>*.json"
node --test plugins/dsh-link-compute/test/*.spec.mjs
node scripts/typecheck-plugins.mjs --json    # this module is born-strict (no baseline debt)
```

## Integration the Lead owns (outside this package's write scope)

- add `{ name: 'dsh-link-compute', client: null }` to the `PLUGINS` list in `plugins/build.mjs`,
  then run `node plugins/build.mjs --check`;
- add the bundle/row to the LINK profile (e.g. `dsh.profile.bundles` plus the row this package's
  `cordis.patch.yml` inserts) and set `enabled: true` to opt in;
- no kernel change is needed.

## Known limitations and deferred work

- **Synchronous only.** The MVP keeps the two calls inline; the measured cost on the fixtures is in
  `docs/handoff/R486-napi-mvp.md`. A megabyte-scale ledger should move to `AsyncTask` (or a
  pre-parsed/binary edge) before it is called on the event loop.
- **JSON edge only.** Every call serialises the whole input and output. That is the honest limit of
  the current N-API surface; the next iteration should accept a pre-built batch (or a bincode/arrow
  buffer) and return a delta.
- **The incremental index has no mid-life fallback.** `openFoldIndex()` answers from the half
  resolved at load; a native failure while an index is open cannot be replayed into the reference.
  R486 measured the incremental native path against the incremental TS path; see that document for
  the migration threshold.
- **Non-ASCII identifiers.** With ASCII identifiers the two implementations are byte-identical
  (enforced by the smoke test). For identifiers outside ASCII the order of sorted maps can differ
  (Rust sorts UTF-8 bytes, JavaScript sorts UTF-16 code units), and `serde_json` rejects a lone
  surrogate that `JSON.parse` accepts; compare parsed JSON, not bytes, before using such ids.
- **No sidecar yet.** R485 keeps the dual-form idea (cdylib + later a bin); this MVP ships the
  in-process addon only.