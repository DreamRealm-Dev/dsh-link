# dsh-link-compat

The cross-version compat loader. It sits under every other DSH Link plugin and answers
one question at load time: **can this kernel honour the capability the plugin asked
for, and if not, why not?**

The refusal is the product. A loader that can be satisfied by a plugin's own claim is
worse than no loader, because it launders the claim into a guarantee. So this package
refuses a capability it cannot honour with a four-field error, before any dependent
plugin's `apply` runs, and never returns a half-built object or a lazy proxy that turns
a load-time error into a first-use error.

- Kernel sections: `compat/table/<kernel>.ts` — one file per kernel, data only.
- Resolver: `compat/engine.ts` — version-blind; it never branches on a version.
- Archived evidence: `compat/surface/<kernel>.json`, bound to the table by SHA-256.
- Verifiers: `scripts/verify-compat-table.mjs`, `scripts/verify-compat-refusal.mjs`.

## Roles: the only plugin-facing contract

A plugin names a capability and one of its **roles**. A role is a neutral word for
something the capability can do — `http.registerRoute` — never a kernel identifier. The
kernel member a role currently binds to is data in a per-kernel section, and that is the
only place a member name appears.

    // the table decides that this kernel's webServer.register answers this role
    ctx.link.compat.capability('http').registerRoute(...)
    ctx.link.compat.require('tools').lookup('read_file')

Two invariants make the promise checkable, and both are enforced at load:

1. every promised role must be bound to a member the kernel actually exposes;
2. a role may not be a name the kernel uses — the capability root may coincide with a
   service name (the vocabulary allows `tools`), the role word may not.

## The two interfaces

Interface A — pass-through. The kernel's own object, resolved once at load and cached,
so the hot path pays for no lookup:

    const sessions = ctx.link.compat.services.get('sessions')   // or it throws

Use it when the converged object does not expose what you need (streaming, cancellation
signals, transcripts, per-session addressing). You then own compatibility with that
kernel yourself, including the right to break later.

Interface B — the converged object:

    ctx.link.compat.capability('tools')   // { register, lookup, schemas } — role words
    ctx.link.compat.require('store')      // same, but reads as "this must exist"
    ctx.link.compat.has('team')           // boolean, never throws
    ctx.link.compat.report()              // kernel, resolved[], refused[] by class, timing

`capability()` hands out a frozen object keyed by role word, whose values are the bound
kernel members. A capability that refuses throws `UnsupportedError`; it is never
`undefined`.

## Three dispositions, two classes of refusal

| Disposition | Meaning | Runtime behaviour |
|---|---|---|
| `resolve` | the roles bind to this kernel's services as they are | resolved once at load, cached, handed over |
| `translate` | renamed or moved carrier, meaning unchanged | mapped by the version-keyed row, target resolved once |
| `refuse` | the same name means something different, or the name is not here at all | `UnsupportedError{capability, kernelVersion, reason, suggestion}` |

Lookup order is fixed: refuse first, then translate, then resolve. A name appears in
exactly one of the three.

Refusals are **typed, and counted separately**, because "the name is not here" is not
evidence of a semantic change:

- **`semantic-changed`** — the name is on both kernels and means something different.
  This is the product, and only this class counts toward the acceptance floor (two).
  Each one must carry all three of: an earlier-kernel `file:line` showing the old
  semantics, a this-kernel `file:line` showing the changed semantics, and a
  **discriminator** — the token whose introduction *is* the change, with the line that
  must carry it here and the file that must not carry it there. Flip either side and the
  verifier goes red.
- **`absent`** — the name is not on this kernel. It may be refused, but it never stands
  in for a semantic change and never counts toward the floor.

Every refusal also carries **witness** claims about the surface (a service is present, a
member is present, no member matches a pattern). A witness that stops holding is
reported as an outdated refusal — and fails the load when `strict` — rather than
continuing to refuse on a stale reason.

## Capability vocabulary (dsh-v0.2.1-alpha.1)

| Capability | Disposition | Roles | Binds to, on this kernel |
|---|---|---|---|
| `store` | resolve | `listSessions`, `readSession` | `sessions.list`, `sessionPersistence.readStoredLog` |
| `tools` | resolve | `register`, `lookup`, `schemas` | `tools.register`, `tools.get`, `tools.schemas` |
| `settings` | resolve | `schema`, `update`, `describe` | `settings.schema/update/describe` |
| `workspace` | resolve | `listFiles`, `readFile`, `statFile` | `workspaceFiles.list/read/stat` |
| `shell` | resolve | `run`, `resolveCommand` | `shell.execute/resolve` |
| `http` | resolve | `registerRoute`, `renderIndex` | `webServer.register/renderIndex` |
| `team` | resolve | `createMember`, `sendMessage`, `createTask`, `updateTask`, `listTasks`, `waitForChange` | `agentTeams.spawnTeammate/sendMessage/createTask/updateTask/listTasks/waitForChange` |
| `agent` | resolve | `start`, `prompt`, `sendMessage` | `subagents.start/prompt/sendMessage` |
| `skill` | resolve | `list`, `get` | `skills.list/get` |
| `telemetry` | resolve | `emit` | `sessionTelemetry.emit` |
| `link` | resolve | `capability`, `has`, `require`, `report`, `services` | the loader itself; no kernel support needed |
| `agent.childRows` | translate | `childRows` | `subagents.listChildren`, row field `kind` -> `mode` |
| `agent.presets` | translate | `declarePreset`, `listPresets` | `agentPresets.register/list`, carrier directory -> declaration row |
| `settings.liveWrite` | **refuse** / semantic-changed | — | 01-upgrade-surface.md B4 |
| `tools.escalation` | **refuse** / semantic-changed | — | 01-upgrade-surface.md B5 |
| `link.peerRange` | **refuse** / semantic-changed | — | 01-upgrade-surface.md B10 |

`settings.rowSource` (B11) is **not** in the table: its earlier side lives in the 0.1.x
desktop shell, which this repository cannot open, so the two-sided evidence a
semantic-changed refusal requires cannot be produced. It is recorded as NOT ESTABLISHED
in `docs/handoff/R1-compat.md` rather than refused on a hunch.

## Evidence is archived and bound by hash

A surface document under `.tmp/` is deleted by the next probe run, so no table may cite
one. The table cites `compat/surface/0.2.1-alpha.1.json` and carries its SHA-256;
`verify-compat-table.mjs` recomputes the hash and fails when the archive and the table
disagree ("evidence drifted"). Archiving is `scripts/archive-surface.mjs`.

## Adding the next kernel

1. Probe it and archive the document:
   `node scripts/probe-kernel-surface.mjs --out .tmp/r1-surface/<kernel>.json`
   `node scripts/archive-surface.mjs .tmp/r1-surface/<kernel>.json --label <kernel>`
2. Copy `compat/table/dsh-v0.2.1-alpha.1.ts` to `compat/table/<kernel>.ts`; set
   `kernel`, `packageVersion`, `commit`, `previousKernel` and `surface` (path + new
   SHA-256) from that document.
3. Re-decide every row: a role whose member moved is a new binding; a role that now
   means something different is a refusal, and a semantic-changed refusal needs both
   sides plus a discriminator; a role that is simply gone is class `absent`.
4. Register the section in `compat/index.ts` (`TABLES`).
5. `node scripts/verify-compat-table.mjs` must pass, and `node plugins/build.mjs` must
   rebuild `lib/`.

No code changes are required for a new kernel: the resolver is version-blind, and an
unknown kernel is a refusal that names the file to add.

## Table prose convention

Prose values (`reason`, `suggestion`, `evidence`, `because`, `notes`, `fact`) are
single-quoted and **contain no apostrophes**; a thing is quoted with double quotes
instead. An apostrophe inside a single-quoted string closes it early and breaks the
build — this has already cost one red gate. Roles are camelCase words that are not
kernel identifiers.

## Verify

    node scripts/verify-compat-table.mjs                       # rows, hash, refusals
    node scripts/verify-compat-table.mjs --old-kernel <dir>    # a different 0.1.x checkout
    node scripts/verify-compat-refusal.mjs                     # the refusal path, fixture hosts
    node plugins/build.mjs --check                             # lib/ matches a fresh build

`verify-compat-table.mjs` needs the archived surface (it defaults to the path the table
declares) and a 0.1.x checkout for the earlier side of every semantic refusal; without
one, those refusals are reported as NOT ESTABLISHED and the gate stays red, because "we
cannot see the old behaviour" is not the same claim as "the behaviour changed". Both
verifiers load `compat/index.ts` through the same esbuild bundling the plugin build
uses, so they exercise the shipped resolver, not a copy of it.

## What is not here yet

- No client half: the client-side capabilities (menu surface, corner shape, module
  loader contract) have no rows, so the loader neither resolves nor refuses them.
- One kernel section; the multi-kernel matrix is task-6.
- The probe oracle walks one prototype level and counts three kinds of thing as one
  "reachable service"; both weaknesses are recorded in `docs/handoff/R1-compat.md` and
  the plan for them is the next round, not this one.
- `link` is provided by this row, so its own resolution is a two-phase fill of one
  object rather than a kernel lookup.

## Mounting it in a live profile (R197): the import that has to resolve first

A `link:` mount puts a junction at `<profile>/node_modules/dsh-link-compat` pointing at this package, and
Node resolves a module's imports from its **real path**. This loader imports `@deepseek-ai/schemastery`
(`lib/index.js:2`), which lives in the kernel, not in this package - so without a link the import throws
before `apply()` ever runs, the kernel composes the row, and nothing about it appears anywhere a reader
would look (it reports through `ctx.logger`, and this project's compositions do not sink that logger to a
file). The symptom is silence, not an error.

Run this once per checkout before mounting:

```sh
node plugins/dsh-link-compat/tools/link-kernel-deps.mjs          # create what is missing, print what it did
node plugins/dsh-link-compat/tools/link-kernel-deps.mjs --check  # read-only: is every import resolvable?
```

It junctions this repository's OWN vendored copy (`core/deepseek-harness/vendor/schemastery`) into the
package - no network, no registry, no machine state outside the repository. Then mount the package (a
`link:` dependency plus a `dsh.profile.bundles` entry in the profile's `package.json`), restart, and read the
mounted-ness the only way it can be read: the composition (`--dump-config` naming the row), not a boot log.