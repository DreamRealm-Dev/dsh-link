# Kernel patches for DSH-LINK

Four patch files, all LF-only. R484/R459/R501 are verified on a pristine `f3803c96` worktree (tag
`dsh-v0.2.2-alpha.2`); the branch `dsh-link/multilevel-team` carries the same commits rebased onto that
tag. Sizes/files: R484 45,318 bytes / 6 files (5 sources + multilevel.spec.ts); R459 2,526 bytes / 1
file; R501 33,388 bytes / 4 files (3 sources + session-window.client.spec.ts); R510 33,812 bytes / 5
files (a draft generated against the pre-upgrade base, not yet rebased or applied):
- **R484-multilevel-team.patch** — the multi-level Agent Teams contract (below).
- **R501-b2-event-window.patch** — optional live-tail event window for the Chat client (default OFF):
  `globalThis.__DSH_EVENT_WINDOW_LIMIT__` policy, structural tail trim after live appends, and an
  opening-page second truncation. Missing/malformed policy = stock behavior. Only the client bundle
  needs rebuilding (`tsc -b tsconfig.client.json` + `pnpm --filter @deepseek-ai/dsh-api-session-controller run bundle`),
  no kernel process restart. Measured on real classes: 99.4x/164.7x window entries at 50k/100k, total replay
  64.1x/141.3x; default-off overhead within noise (R493).
- **R510-draft.patch** — v2 revision of the B2 live-tail event window, superseding R501's client
  trimming decisions (draft; apply only after R501): `RemoteJournalStream.retargetFront()` moves the
  paging front after a trim (the live-gate hole root cause), `trimToTailAligned()` keeps a
  turn/message page boundary and defers when none is in slack (diagnostic `unalignedDeferred`),
  `trimOpeningPage` is removed (resolver always false, field deprecated), and a plain-data
  `__DSH_CHAT_HISTORY_READING__` flag defers live trims while a reader is away from the tail
  (bounded at `maxEvents*4`). Client-only; no wire/server behavior change. Apply-time evidence is
  task-24 kernel integration tests + live gate v2 (A2 no hole / live-trim backfill / reader defer
  incl. bound / page-boundary front) + default-off byte-identical behavior.
- **R459-page-nav-bridge.patch** — publishes the shell navigation moves (`openSession` /
  `openTeammate`) as a scoped global for page-level client plugins, removed by `ctx.effect` on
  teardown. LINK's dynamic client rows run in a page context that has neither `sessions` nor
  `uiWorkspace`, so the shipped teammate-open action is unreachable there without it.

These are **patch series**, not forks. The kernel checkout stays a clean upstream tree plus one branch
(`dsh-link/multilevel-team`) that we rebase on every DSH upgrade.

## R484-multilevel-team.patch

What it does: opens three policy knobs on the Agent Teams service so a loader can run real nested teams
(`maxDepth`, `teammatesMaySpawn`, `interruptScope`), teaches the roster to resolve members anywhere in the
live ancestry, spawns a teammate's child under the caller, records optional `spawnedBy`/`depth`, and admits
ancestor interrupts.

Includes P1 fix (2026-10-26): the model-facing member view schema now declares the optional
`spawnedBy`/`depth` fields that a multi-level roster row carries — without the declaration a successful
spawn surfaced as `INVALID_TOOL_OUTPUT` to the model (LIVE measured) and invited a duplicate spawn.

Why it is safe:
- default config (maxDepth 1 / teammatesMaySpawn false / interruptScope none) produces **byte-identical**
  upstream behavior — 106 upstream tests plus the full kernel typecheck pass unchanged;
- new fields are optional and only written when multi-level is enabled;
- no model-facing schema changes in default mode.

The patch file is LF-only and was verified to apply cleanly with `git apply --check` on a pristine
`f3803c96` worktree (`docs/kernel-patches/R484-multilevel-team.patch`, 45,318 bytes).

Apply / refresh (kernel checkout is a bundled repo whose only remote is `origin` =
https://github.com/deepseek-ai/deepseek-harness.git — there is no `upstream` remote until you add one):

```powershell
# A) fresh bundled checkout at the new release: apply the patch file
cd core/deepseek-harness
git apply --check ..\..\docs\kernel-patches\R484-multilevel-team.patch
git apply        ..\..\docs\kernel-patches\R484-multilevel-team.patch

# B) or keep the branch and rebase it on the new release
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git   # once
git fetch upstream --tags
git rebase <new-release-tag> dsh-link/multilevel-team

# kernel gates (both must be green)
pnpm run typecheck
pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team
```

LINK-side gates (run in `<workspace>\\dsh-link`, NOT in the kernel checkout):

```powershell
node plugins/build.mjs --check
pwsh -File scripts/restart-client.ps1
```

Regenerate the patch file from the branch — use git's own `--output` (or pipe through a LF writer;
PowerShell `Out-File` adds CRLF and the patch then fails `git apply`):

```powershell
git diff dsh-v0.2.2-alpha.2..HEAD --output=..\..\docs\kernel-patches\R484-multilevel-team.patch `
  -- packages/experimental/agent-team packages/experimental/tool-agent-team
```

LINK profile row (hot-applied, `kernel-home/profiles/web/cordis.patch.yml`):

```yaml
- id: agent-team
  config:
    maxMembers: 64
    maxDepth: 3
    teammatesMaySpawn: true
    interruptScope: descendants
```

## maxDepth semantics (measured, R490)

`maxDepth` is the maximum roster depth VALUE, not "the number of spawning generations".
A member whose `depth === maxDepth` is admitted, and only the next spawn below it is refused with
`TEAM_DEPTH_LIMIT` (`callerDepth + 1 > maxDepth`). So with `maxDepth: 2` an L2 may still create an L3
(depth 2), and an L3 may not create an L4. The test suite pins both refusals (maxDepth 1 and
maxDepth 2) and the exact upstream shape under the default configuration.