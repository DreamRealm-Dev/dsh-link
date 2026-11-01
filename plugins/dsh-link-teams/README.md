# dsh-link-teams

The collaboration bus, made visible. A read-only right-rail pane: the team tree, the task board with who
holds what, each member's declared capabilities and last heartbeat, the peer-permission rows between two
leads, and the stream of control records — the "中间进行的交流" the requirement asks a person to watch.

Two halves, one package:

| half | file | what it is |
|---|---|---|
| host | `src/index.ts` → `lib/index.js` | ONE read-only route, `GET /api/dsh-link-teams/state`, over the live kernel's own fold |
| client | `src/client/index.tsx` → `lib/client.js` | the "智能体团队" rail tab: the tab type, the pane body and the chip |

Both are built by `node plugins/build.mjs` (`PLUGINS`, last entry) and the row is graded by
`scripts/verify-plugin-health.mjs` through `plugins/health-markers.json` (row `link-teams`, marker
`[dsh-link-teams] ready`). R196: before this round the halves were hand-written under `lib/` and in
neither machine, so nothing compared the artifact with the source and no boot graded the row.

## What it does not own

Nothing. It has no store, appends no record, replaces no kernel service and wraps no kernel service.
Everything it renders is folded by `dsh-link-collab` from its append-only control ledger, and read here
through `ctx.get('linkCollab')`. If the bus is not mounted the route answers
`503 { ok: false, error: { code: 'NO_CAPABILITY' } }`; a bus with no `state()` reader answers
`NO_STATE_READER`. An empty board and an absent bus must not look alike.

## One world, from the live fold

The bus answers `collab.state()`, which re-folds the control log on **every** read
(`plugins/dsh-link-collab/src/index.ts:9442`), so the route serves the live kernel's fold at the moment of
the GET. What that fold does not say is which of its teams belong to this machine's real work: the live
ledger still holds the R180-B acceptance run's rows (seq 50-54 of
`<kernel-home>\collab\control.jsonl`), written under `gate-r180-alpha-*` names with `writer: "local"` and
the live instance id — the same provenance as the kernel's own rows. Re-folding cannot remove a row that
is really there, and no reader can tell those rows apart by who wrote them.

So the surface decides what it calls a **team**, in one place (`src/world.ts`):

- a team node is every team the fold **declares** (`team/state`) **or names** in a task/member row — a
  real session team that never declared itself is still drawn, which is what the pane was hiding before
  R196;
- a team id carrying the round's fixture naming (`gate-` / `r18<digit|x>-`) is withheld from the world and
  **counted** in `teams.withheld` — never silently dropped;
- `counts.teams` is the number of nodes the served tree carries, so the pane's "团队 N" chip and the tree
  it draws are the same number by construction;
- the **ledger view** (the stream, the member rows, the capability declarations, the handshakes, the
  isolation rows) keeps what the file holds, and each row that carries a fixture name is flagged
  `fixture: true` so the pane can mark it.

The task board keys rows by the **(team, id)** pair the ledger's own board uses, so two teams that both
hold a `task-1` stay two rows with two labels. The pane draws a team id as `session-<first block>` rather
than its first eight characters: every real team id begins with `session-`, and shortening it the old way
drew every team as the same eight characters.

## The one surface

    GET /api/dsh-link-teams/state        (row config: path, streamLimit)

```json
{
  "ok": true,
  "at": 1792213786233,
  "path": "/api/dsh-link-teams/state",
  "ledger": { "directory": "...", "writer": "local", "instance": "...", "lastSeq": 60, "records": 60, "damage": null },
  "counts": { "folded": 39, "unknown": 14, "tasks": 9, "members": 9, "teams": 2, "unattributed": 0 },
  "through": 60,
  "teams": {
    "teams": [ { "id": "session-d003313d-...", "parent": null, "lead": null, "declared": false, "observed": true, "tasks": 7, "members": 8 } ],
    "children": {}, "roots": ["session-d003313d-..."], "orphans": [], "cycles": [],
    "declared": 2, "named": 3, "observed": 2, "withheld": 3
  },
  "tasks": [ { "id": "task-1", "team": "session-d003313d-...", "status": "completed", "fixture": false } ],
  "members": [ { "id": "seg1-analyst-uuid", "name": "seg1-analyst", "team": "session-d003313d-...", "fixture": false } ],
  "registry": { "members": [], "byCapability": {}, "declarations": 0, "malformed": 0 },
  "liveness": {}, "peers": {}, "board": {}, "quarantine": null,
  "fixtures": { "tasks": 1, "members": 1, "records": 6 },
  "stream": [ { "seq": 60, "kind": "peer/state", "actor": "r182-lead", "subject": "r182-lead->r182-live-peer", "fixture": true } ]
}
```

Field meanings this round fixed:

- `counts.teams` — the number of nodes in `teams.teams` (not the fold's own "distinct named teams" count).
- `teams.declared` / `teams.named` — how many teams the fold declares, and how many distinct teams its
  task/member rows name (the fold's own `counts.teams`).
- `teams.observed` — how many served nodes the ledger's task/member rows name.
- `teams.withheld` — how many fixture-named teams the surface refused to present as the world.
- `fixtures` — how many ledger rows on this answer carry a fixture name (counts only; the ids are not
  repeated).

**GET only.** A POST is refused with `405` and a named code (`METHOD_NOT_ALLOWED`): a surface that could
write would need an authorization story of its own, and directing the team is already a message to the lead
in the chat box, which is what the pane tells the user at the bottom.

## Copy: this package's own locale namespace

`src/client/locales.ts` owns every word: namespace `dsh-link-teams`, dictionaries `zh` and `en` with the
same key set (`en` is typed against `zh`). `apply` registers both in **one** call —
`ctx.locale.register(NS, { zh, en })` — and both slot registrations declare `locale: NS`, which is what
binds the framework's `t` seat onto the components. The rail tab type's title and guide description are
function seats the Sidebar calls itself, so they read the bound translate (`ctx.locale.bind(NS)`). No
product sentence is written into the half: `node plugins/dsh-link-teams/test/teams-truth.spec.mjs` reads
the source and the decoded built bundle and fails on any Chinese that is not a dictionary value.

The task-state, member-state and record-kind words are switches over the closed sets `src/client/view.ts`
draws (`taskStateWord`, `memberStateWord`, `kindWord`), each key written as a literal at its own `t(...)`
call — never a key name built at runtime, so gate 125 can match every one against the dictionary, and a
value the dictionary does not name is drawn as the ledger recorded it rather than as a key. The rail
entry's glyph is the first-party `IconUsersOutlineRegular` — 16x16, `currentColor`, one-pixel stroke,
from the module the web shell preloads, so the built half leaves that import external.

## Self-check

    node plugins/dsh-link-teams/test/teams-truth.spec.mjs
    node plugins/dsh-link-teams/test/teams-truth.spec.mjs --self-attack

No browser, no CDP, no DSH, no socket. The host plane drives the built `lib/index.js` through `apply()`
and its captured route with a fold shaped like the live one (the R180-B fixture included) and checks: one
world (`counts.teams` = tree size, both real session teams drawn, two `task-1` rows keyed apart); no
fixture id in the world while the input fold really carries it; the stream is the file's tail with fixture
rows flagged; a fixture-only fold answers zero teams; the 503 branches and the named 405s. The client plane
drives the built `lib/client.js` against the kernel's own `LocaleRuntime`: one registration call for both
dictionaries, the service's own refusal of a second one, equal key sets, every askable key resolving in
both languages, no Chinese outside the dictionary, the pane's own view agreeing with the route, and the
wiring (`inject` names `locale`, both slots keyed and declaring the namespace). `--self-attack` stages a
copy of the host half whose world is the OLD pass-through and requires the three world readings to redden.

## What a live reader should now see

After a client restart with this build: `teams.teams` carries the real `session-*` teams (each also named
by task/member rows), `counts.teams` equals the tree size and the pane's "团队 N", zero tree nodes carry a
`gate-`/`r18x-` id, and the pane still shows the withheld count and the ledger view with its fixture rows
marked. The R196 gate (`teams-pane-truth`) is the live reading of that; this package's own spec is the
offline one.

## Known boundaries

- **The ledger view still carries fixture rows.** They are in the append-only live ledger and the existing
  live gate `teams-panel` requires the stream to be the file's tail and the capability declarations to be
  served (`scripts/verify-teams-panel.mjs` readings 1 and 5). They are marked `fixture: true` and counted,
  and the world never presents them as teams.
- **A second writer's rows are invisible until the ledger is re-opened.** That is the bus's behaviour
  (`plugins/dsh-link-collab/src/index.ts:998-1000`: `replay()` returns the records the kernel read at open),
  not this surface's: the route re-folds on every read but the fold cannot see rows the log never read.
- **The pixels and the live language switch are the live gate's job.** `teams-panel` reads the pane through
  CDP; this package's spec reads the same view functions without a browser.

## Mounting

```jsonc
// <dsh home>/profiles/web/package.json
"dependencies": { "dsh-link-teams": "link:<abs path to this directory>" },
"dsh": { "profile": { "bundles": [ /* ..., */ "dsh-link-teams" ] } }
```

then `pnpm install` in the profile (a `link:` dependency is a symlink) and restart the client. The row is
inserted by this package's `cordis.patch.yml`.
