# dsh-link-collab

The collaboration bus control channel: an append-only, replayable control log beside the
kernel's own Agent Teams service, plus a TTL data channel that shares nothing with it.

## What it does not do

It does not replace, wrap or rename `ctx.agentTeams`. The official service keeps working
exactly as upstream shipped it; this plugin publishes a separate capability, `linkCollab`,
beside it. A wrapper is the easy thing to write and the worst thing to own: the compatibility
layer exists because the kernel renames and re-shapes its services, and a wrapper would freeze
one of those shapes into this repository.

## Why two channels

The kernel keeps one mailbox for everything. The collaboration bus separates two
dispositions, and the separation is the point:

| Channel | Contains | Lives | After a restart |
|---|---|---|---|
| `control` | who changed what, when, with what intent | one JSONL file beside the kernel home | the ledger is still there, with its sequences continuing |
| `data` | token streams, intermediate payloads | memory, with a TTL | gone, which is correct rather than a defect |

The separation is enforced by construction, not by a rule: the two channels share no queue, no
counter and no file. A control append cannot queue behind a data flood because there is
nothing to queue behind. Injection 4 measures that claim (200,000 data puts, then the control
append's latency against a baseline taken first).

## Using it from a plugin

```js
const log = ctx.get('linkCollab').open({ dir: join(home, 'collab') })
await log.append({ kind: 'task.claimed', actor: 'worker-a', subject: 'task-1' })
log.put('tokens', { kind: 'delta', payload: '…' })   // the data channel
log.page(since, 100)                                  // the control channel, by cursor
await log.close()
```

`append` returns the sequence it assigned. `replay()` returns every control record in order.
`damage` reports what the reader could not parse when the log was opened — a truncated tail
is damage to be reported, never a shorter ledger that looks complete.

## How it is held to that

`node scripts/verify-teams-log.mjs` runs seventeen injections: append and read back, restart
continuity, the data channel staying off the disk, a data flood not slowing control, a
truncated tail being reported, concurrent appends staying contiguous, a second process
being refused rather than sharing a counter, the kernel feed driving the ledger, one task per
(team, id) with the team id read from the actor or the payload, named teams counted apart from
unattributed records, an injection flag doing nothing without the master switch, and a writer
lock that names no live writer being reclaimed while a live holder is still refused.

`node scripts/verify-teams-log.mjs --self-attack` arms the decisions whose removal those
injections exist to catch — forgetting the sequence on reopen, skipping the writer lock,
dropping ownership, folding by id alone, and keying the relay by sequence — and must go red.
A test that cannot fail is not evidence.

## Relaying to another log

```js
const peerBatch = { writer: log.writer, instance: log.instance, records: log.ownPage(after) }
// ...over whatever carries it...
await other.ingest(peerBatch)          // returns { appended, skipped }
other.marks()                           // per (writer, instance) high-water marks
```

One log is one device. Two devices both number their records from 1, so a receiver that keys
records by sequence alone either swallows the other side's work or splices two histories into a
state no writer produced. Records therefore carry `writer` (a label) and `instance` (the identity
of the log that wrote them, minted once and kept in its directory), and `ingest` refuses a batch
that would leave a hole (`RELAY_GAP`), contains one (`RELAY_HOLE`), carries a record without a
distinct positive integer sequence (`RELAY_MALFORMED`), names neither writer nor instance
(`RELAY_WRITER_MISSING`), claims this log's own identity (`RELAY_IMPERSONATION`), arrives under a
writer name already held by another instance (`RELAY_REWRITTEN`, unless the sender asks to be
adopted with `adopt: true`), or contradicts a record already applied at that position
(`RELAY_CONFLICT`). Adoption remembers the instance it replaced rather than forgetting it, so both
streams stay idempotent.

`node scripts/verify-collab-relay.mjs` runs fourteen injections over two and three logs and is
declarative about its own attack: `--self-attack` arms the writer-identity defects and the run
passes only when injections 4, 6, 7, 12 and 13 are the ones that fail.

### Reaching a peer over HTTP

```yaml
# row config: the endpoint exists only when a token is configured
- id: link-collab
  config:
    relay:
      token: <shared secret>
      path: /api/dsh-link-collab/relay   # optional
```

```js
const answer = await ctx.get('linkCollab').relayTo({ url, token, since })
// { ok, appended, skipped, code? }
ctx.get('linkCollab').relay   // { bound, path, accepted, refused, lastCode }
```

The endpoint is a write surface, so it does not exist unless a token is configured: there is no
unauthenticated path and no default. A request must be `POST application/json` with
`Authorization: Bearer <token>`; the token is compared after hashing both sides, so an attacker
learns neither its length nor its first differing byte from the response time. Refusals are counted
and named (`UNAUTHORIZED`, `CONTENT_TYPE`, `TOO_LARGE`, `RELAY_MALFORMED`, and the `ingest` codes),
because a peer that cannot be told why it was refused re-sends forever.

`node scripts/verify-collab-relay-http.mjs` drives the route over a real HTTP server and then boots
a real kernel, posts to it while it runs, and grades the kernel's own report. `--self-attack`
configures the kernel with a different secret than the gate sends: if the route did not enforce the
token the checks would stay green, so the run fails unless those checks are the ones that flip.

## Known limitations

- The control log has no rotation or compaction. Its growth is unbounded for now, and that is
  a deliberate deferral rather than an oversight: rotation needs a retention policy, and a
  retention policy needs a consumer that cares.
- A damaged line is reported, never repaired. Repairing it would require deciding what the
  missing record said.
- The data channel is per stream with a count cap and a TTL; there is no byte budget yet.
- The plugin IS mounted in this machine's profile (its bundle is listed in the live profile's
  `dsh.profile.bundles`), and its capability now has a writer and a reader of its own: the
  declaring tools below append, and `records()` hands a surface a page. What is still missing is
  the front-end that renders that page — the shell does not call the capability yet. The sibling
  compat loader (`dsh-link-compat`) is the one that is still unmounted, and that is a separate gap.
- A task record's claim state is read from `payload.state`, and the projection reports it as
  `status`. The recorder is the only producer today and writes `state` (mapping the Team service's
  own `task.status` into it), but a producer that writes `payload.status` instead gets the default
  `open` with no diagnostic — found while writing the contested-fold gate's fixtures (R29). Worth a
  loud refusal if a second producer ever appears.
- The relay has only been exercised with the kernel as the receiver; two kernels pushing to each
  other (and the acknowledgement advancing the sender's own marks) is not gated yet.
- A relay is one hop by contract: `ownPage()` exports only this log's own records, so a receiver
  does forward its own work and not the peer's. A path through a middle hop therefore regroups the
  held records by `record.writer`/`record.instance` and sends one batch per origin — the shape a
  first hop already has. `node scripts/verify-collab-multihop.mjs` exercises three logs over two
  hops and also measures the trap: a middle hop that forwards `ownPage()` forwards nothing.
- A batch header is a claim, not a credential: a log that has seen a peer's records can present
  them under its own identity, and the receiver records them as that log's work. The three-node
  gate measures this rather than assuming it away; signing batches needs a key distribution story
  this plugin does not have.
- The fold resolves a contested task by arrival order, not by the records' `at`: a fact that
  happened earlier but arrived later becomes the projected status. The records all survive and
  `at` still shows when each happened, so the loss is in the projection, not in the ledger — the
  next step is for the projection to report the contest instead of picking a winner.
## Folding the ledger back into a state

```js
const state = projectTeamState(log.replay())
// { tasks: [{ id, status, owner, records, at }], members: [...], through, counts }
```

A ledger that cannot be folded back into a state is a log file, not a control channel. The
projection recognizes two record kinds — `task/state` and `member/state`, each carrying
`{ id, state, owner? }` — and is total: a kind it does not recognize is counted in
`counts.unknown` and changes nothing, so an older reader facing a newer writer reports what it
could not use instead of guessing at it.

Folding a **prefix** of the records is the state after that prefix, which is what makes a
cursor meaningful: a reader can page the ledger and hold a state without reading the file.
Folding is deterministic — two folds of the same records agree — which is what makes a replay
an audit rather than a re-run.

### Why the projection is not wired to `ctx.agentTeams`

The kernel's Team service publishes no events, and cordis interception merges configuration
rather than wrapping methods. Observing it would therefore mean polling it or wrapping it, and
both would tie this projection to a service shape that the compatibility layer exists to
survive. What the fold does own is the part that must be right: the same records always
produce the same state, and it never invents a task no record mentioned.

Binding the two — a writer that records what `ctx.agentTeams` does — is a separate step with
its own decision to make about how that service is observed.

## Recording what the Team service actually does

```js
const log = ctx.get('linkCollab').open({ dir: join(home, 'collab') })
const recorder = recordTeamEvents(ctx, log)   // subscribes to the kernel session/event feed
// the team works
recorder.dispose()                             // detaches; nothing writes through a dead log
projectTeamState(log.replay())                 // the same state the service keeps
```

`ctx.agentTeams` publishes no events and cordis interception merges configuration rather than
wrapping methods, so the Team service cannot be observed from outside. It does not need to be:
it appends every task and member change to its Lead Session log as `team/task`, `team/member`,
`team/message/queued` and `team/message/delivered`, and the Session publishes those appends as
`session/event` — post-commit, fire-and-forget, and documented as an observer that cannot break
the writer it observes.

`teamEventToRecord()` keeps the service vocabulary verbatim (`pending`, `in_progress`,
`completed`, `ownerName`) rather than translating it: two vocabularies for one fact is how a
reader of the ledger and a reader of the service end up disagreeing about the same row. Message
bodies are not copied — that they were sent is the auditable fact, and the body already lives in
the session log.

The kernel's `blockedBy` list on a task snapshot (`agent-team/src/types.ts:81`) is copied into
the payload's `deps` field, which is the field `projectBoard()` resolves into the dependency
graph. Without that copy the graph folds to nothing: the edge, ready, unmet, missing/orphan,
tombstone and cycle readings all read a field no producer wrote, so the board reported every task
ready. It is copied on every `team/task` record, empty arrays included, because one record is a
whole task snapshot: "this revision blocks on nothing" has to be able to clear a graph an earlier
revision declared, while a record that carries no `deps` at all leaves the previous declaration
alone.

## The capability registry is a ledger fact, not a mapping of a kernel concept

A member declares what it can do by appending one `capability/state` record; `projectTeamState()`
folds those records into a registry beside the task and member folds. The registry is **this
layer's own concept**: the kernel's Team service has members, tasks and messages and no notion of
capability at all, so there is nothing to map it onto. Mapping it to something kernel-shaped would
buy three problems: the registry would change shape with the kernel, it would exist only while that
service happens to be mounted, and "who can do X" would become a question about a service instead
of about the ledger. Written down as a record instead, the question is always about the ledger, and
it is answered the same way after a restart, after a splice, or on a kernel that carries none of
the services the rest of this plugin binds to.

The fold is **by sequence, not by arrival**: records are ordered by `seq` before folding, so the
same declarations arranged differently produce the same registry, and a member that declares twice
ends up with the highest-`seq` statement. A declaration is read in both shapes a member can
naturally write it — a whole set in `payload.capabilities` (replacing that member's set) or one
capability per row in `payload.capability` (extending it) — because reading only one of them made
a member that had declared look like a member that had declared nothing.

### Two lessons from building this

**A payload shape read the wrong way is a silent empty registry.** The first version accepted only
`payload.capabilities` (an array). A producer writing one capability per row
(`payload.capability`) was therefore folded into an empty registry — no error, no diagnostic, just
a registry that answers "nobody can do that" to every question. Both shapes are read now, and each
row carries whether it replaces or extends. When a reader and a writer disagree about the shape of
a fact, the reader's answer must not be silence.

**Where a query is reachable is part of the interface.** These queries are exported module-level
*and* attached (non-enumerably, so the state stays lossless JSON) to the registry carried in the
folded state. A caller holding only a folded state should not have to import this module to ask it
a question; an implementation that is correct but reachable from only one of the two places reads,
to the caller, as an absent feature.

## Liveness is a fact in the ledger; the verdict is a pure function

A member says it is alive by appending `member/heartbeat`; the fold keeps the latest instant per
member, and every decision — `livenessOf`, `isQuarantined`, `recoverable` — takes `now` as a
parameter and reads no clock. A verdict that asks the wall clock cannot be reproduced, and a
failure-handling path nobody can reproduce is a path nobody can test. The threshold comparison is
stated rather than left to habit: `now - lastHeartbeat === timeoutMs` is **already unhealthy**.

Isolation is a consequence of that fold, not a second mechanism: an `unhealthy` member is offered no
task, and one more heartbeat releases it — the same rule that quarantined it clears it. A member that
never beat is `unknown`: not quarantined, but not a candidate either, because eligibility comes from
the capability registry rather than from the member list. A healthy member that cannot do the work is
never a candidate; offering it would move a stuck task somewhere it stays stuck while looking assigned.

## A sub-team is a declaration, not a nested runtime object

A team declares its parent with a `team/state` record; the tree is folded from those declarations
into `state.teams` (`teams`, `children`, `roots`, `orphans`, `cycles`), and the queries —
`ancestorsOf`, `pathOf`, `descendantsOf`, `rootsOf` — are pure functions of it. Nesting runtime
objects would put the hierarchy in whichever process happened to build it: it would not survive a
restart, it could not be read by a member that never held the parent, and a sub-team created by a
different writer would be invisible. Declared on the ledger, the hierarchy is one more thing a
reader of the log can answer, on the same terms as task and member state.

## Permission between two leads is a ledger state, not a question asked per call

Two leads handshake by appending `peer/state` records (`{from, to, request, state}`), and the fold
keeps one row per **ordered** pair — `t1 -> t2` granted says nothing about `t2 -> t1`. `mayExchange`
is true only for a granted pair in that direction, so asking the reverse is false until the reverse
side grants it, and two rows of the same pair in either order fold to the same answer because the
higher `seq` wins. A later `denied` clears an earlier `granted` as a consequence of that rule, not
by a separate revocation path.

Asking the other lead at call time was the alternative, and it fails in the case this module exists
for: when the asking side is the one that stopped answering, there is nobody to ask, and there is
nothing left to audit afterwards. Written down, a permission survives a restart, is visible to a
reader of the log, and can be answered by `pendingRequests` without the other lead being reachable.

Two shapes are handled explicitly rather than by discipline. **A cycle is reported, not followed**:
the walk up from each team carries a visited set, so `A -> B -> A` yields the closing edge and the
loop and then stops, instead of hanging or hitting a limit. **A deep chain is walked iteratively,
with no depth limit**: a limit would silently truncate a legitimate deep tree, and a truncated tree
reads exactly like a short one. A parent that was never declared shows up in `orphans` rather than
being dropped: a team whose parent is missing is a fact about the ledger, not an absence to hide.

### Who writes it down: the two handshake tools

That table is only as real as its producer, and `peer/state` was the last record kind whose only writer was a
gate: a live ledger held no handshake at all, so "may these two exchange?" answered no on every
installation. Two model-facing tools append them, registered with the declaring tools and by the same rule -
a deployment that configured nothing still gets them.

| Tool | Appends | Input | Refused with |
|---|---|---|---|
| `team_request_peer` | `peer/state` | `{ from, to, request }` | `PEER_INPUT`, `PEER_FROM_EMPTY`, `PEER_FROM_NAME`, `PEER_TO_EMPTY`, `PEER_TO_NAME`, `PEER_REQUEST_EMPTY`, `PEER_REQUEST_TEXT`, `PEER_REQUEST_LONG`, `PEER_SELF`, `PEER_ALREADY_GRANTED` |
| `team_answer_peer` | `peer/state` | `{ from, to, state, request? }` | `PEER_INPUT`, `PEER_FROM_EMPTY`, `PEER_FROM_NAME`, `PEER_TO_EMPTY`, `PEER_TO_NAME`, `PEER_STATE_EMPTY`, `PEER_STATE`, `PEER_SELF`, `PEER_REQUEST_NONE`, `PEER_REQUEST_BLANK` |

The direction is in the arguments rather than in who calls: `from` asks and `to` answers, and the answer
keeps that order, so a grant records that `from` may reach `to` and says nothing about the way back, which
needs its own request and its own answer. Both tools answer with the pair's two verdicts - `allowed` for
`from -> to` and `reversed` for `to -> from` - read back from the ledger after the append, so a caller sees
the asymmetry instead of inferring it. `request` is free text bounded at 200 characters, because the ordered
pair is the key and no reader looks a row up by what it asked for; an answer carries the request the ledger
already holds for the pair unless the caller names one.

Three refusals are worth knowing by name. `PEER_SELF` refuses a lead handshaking with itself. `PEER_STATE`
refuses the word `requested` at the answering tool: the asking side is the other tool, and two doors to one
state would disagree about who asked. `PEER_ALREADY_GRANTED` refuses a second request against a standing
grant, because the fold keeps the highest sequence per pair and a duplicate request would silently clear a
permission both leads had already settled - an answer of `denied` is the way to reopen one. `PEER_REQUEST_NONE`
refuses an answer to a pair nobody asked about, which is what a caller who swapped `from` and `to` meets.

Every refusal is a `PeerRefusal` whose code leads the message, and a refusal appends nothing: the producer's
probe drives nineteen of them and the ledger's sha256 and byte length are identical before and after. Like the
declaring tools, these two have no switch: a switch would make "these two leads may not exchange"
indistinguishable from "nobody wired the tool". Registering two more names does change the model-visible face,
which `verify-collab-declare` pins by name - and the two widenings that admission needed are recorded, with
the exact readings and the reason each gate owns its own question, in `docs/handoff/R182-A-peer-tools.md`.

## Who writes it down: three tools, and a page a surface reads

The folds above are only as real as their producers. `capability/state`, `team/state` and
`member/heartbeat` had gates as their only writer, so the ledger this machine runs held none of them:
49 records, all `task/state`, `member/state` and `team.message`, and every fold above answering
"nobody declared anything". Three model-facing tools now append them, into whatever tool registry the
composition mounts, and each one writes exactly the record its fold reads:

| Tool | Appends | Input | Refused with |
|---|---|---|---|
| `team_declare_capability` | `capability/state` | `{ member, capabilities, team? }` | `DECLARE_MEMBER_EMPTY`, `DECLARE_MEMBER_NAME`, `DECLARE_CAPABILITY_LIST`, `DECLARE_CAPABILITY_EMPTY`, `DECLARE_CAPABILITY_NAME`, `DECLARE_TEAM_EMPTY`, `DECLARE_TEAM_NAME` |
| `team_declare_subteam` | `team/state` | `{ team, parent?, lead? }` | `DECLARE_TEAM_EMPTY`, `DECLARE_TEAM_NAME`, `DECLARE_PARENT_NAME`, `DECLARE_PARENT_SELF` |
| `team_heartbeat` | `member/heartbeat` | `{ member, at?, team? }` | `DECLARE_MEMBER_EMPTY`, `DECLARE_MEMBER_NAME`, `DECLARE_HEARTBEAT_AT` |

A refusal throws, and the tool registry renders a thrown error as `Error: <code>: <detail>`, so the model
reads which rule it broke rather than "invalid input". A refusal appends nothing — the ledger's record
count is the same before and after the twelve refusals the producer's script drives. A name is 1-64
characters from letters, digits and `. _ - : @` starting with a letter or a digit, and whitespace is
refused rather than trimmed, because `worker a` and `worker a ` are two names no caller means as one.
The `team` a caller names rides on the record's `actor`, the field the kernel's own team events carry
it in and the field `teamOf` reads first, so the declaration folds into the right team bucket.

The three tools are declared structurally rather than through the kernel's `defineTool`: this plugin's
host bundle shares nothing with the kernel but cordis and schemastery, and importing the tool package
would inline a second copy of the registry's own validation here. The fields are the same four
`defineTool` produces, and the kernel surface probe registers a plain definition the same way.

`at` on a heartbeat is data, not a clock read inside a fold: the caller may pass it, and when it does
not, the tool stamps both the payload and the record with this end's clock — the same value in both
places, so no reader finds a heartbeat that happened at two times. The clock is an argument of the tool
set (`declaringTools({ log, now })`), which is how a reading is taken without waiting.

### The page

```js
const page = ctx.get('linkCollab').records({ since: cursor, limit: 50 })
// {
//   from, through, next,                        // the cursor asked from, the fold's end, the next cursor
//   rows: [{ seq, kind, at, actor?, subject?, payload? }],
//   state,                                      // the fold of every record up to through
//   counts: { total, returned, more },
//   damage,                                     // what the reader could not parse, or null
// }
```

`state` is the fold of the page's **prefix**, not of the whole ledger: folding everything would answer
with a state the rows above do not produce, and a cursor whose two halves disagree is worse than no
cursor. `records()` is pure the way every reading here is — no clock is read and none is accepted, so
two calls over the same ledger return the same page — and the module-level `controlPage(records, options)`
is that same fold, so a caller holding records without a log can take the page without this capability.

### When there is no registry

The tools register through the composition's own `tools` service, and nothing else depends on it: a
context that cannot inject one, or a composition that mounts none, keeps the log, the recorder and every
fold, and `ctx.get('linkCollab').tools` answers `{ available, names, reason }` — `available` is true only
when every declared tool was registered, and `reason` names what happened otherwise (`waiting for the
tools service`, `this composition mounts no tool registry`, `this context cannot inject the tools
service`). A plugin that vanished when one optional service was absent would be quieter than the
problem it hides.

The registration is an effect of the plugin's own fiber, so unloading the plugin unregisters the three
tools with everything else it contributed. They are registered globally rather than per agent: the ledger
is one, so a declaration made by a teammate and one made by its lead are answers to the same question.

## The bus's own status route, and the LINK panel's row

The bus holds the facts every other LINK surface reads, and until R204 none of them was visible: the
template's two real panel entries were both presses (open the browser pane, open the team pane), and the
layer underneath had no row at all. This package now ships a browser half that declares ONE row of kind
`status` into the LINK panel's contribution seam (`dsh-link-panel`), so "how many teams, how much ledger,
can a peer reach me" is one line in the panel rather than a `curl` somebody remembers to run.

It is a reading, not a button: the row carries no `invoke`, because the bus has no operation a click
would perform that the tools, the routes and the chat box do not already do, and the seam refuses a
press on a row that is not an action.

The numbers travel from ONE place. The host half binds a read-only route beside the relay — bound
whether or not a relay token exists, because "can a peer reach me" has to answer on an ordinary
install — and folds the live ledger there:

```
GET /api/dsh-link-collab/status
  { ok: true, path, at,
    ledger:  { records, lastSeq, writer, instance, damage | null },
    world:   { teams, members, tasks, folded, unknown },
    relay:   { bound, path, accepted, refused, lastCode },
    recorded:{ seen, recorded, ignored, failed } }
```

`world.teams` is the team TREE's node count — the teams the ledger declares — and not the fold's team
buckets, which count the scopes the task and member rows name. `damage` is `null` when every line of
the ledger parsed, rather than three zeros describing a reading nobody took. A POST is refused with
`STATUS_READ_ONLY` (405) and a ledger the fold cannot read answers `STATUS_UNREADABLE` (500); nothing on
the path writes. `ctx.get('linkCollab').status` is the same document without the round trip, plus
`bound`/`served`/`refused`/`lastError` for the route itself.

The browser half reads that route and nothing else, so the row cannot disagree with the bus it
describes. `linkCollab` is a host capability and the page cannot see it; the route is the one seam
between them.

NO CADENCE. The half starts no timer — no `setInterval`, no `setTimeout`, no self-scheduled re-read —
because a row kept fresh by a clock is a row that can only be as true as its cadence (R191) and because
the seam already owns the way a reading is published: the provider calls `notify()`. A reading is taken
when the page can know a person is looking: once at mount, again when the document becomes visible,
again on window focus. Each read is compared with the text the row was last told about, and only a
change is published through `notify()`, which makes the panel take a fresh projection in that same
step; a read that answered the same numbers announces nothing. A language switch is announced by the
kernel's locale service and republished the same way, so the row's words follow the page without the
item being re-declared.

FAIL-CLOSED, NAMED. Four absences are recorded in this package's own marker
(`globalThis.__dshLinkCollabPanel`) and none of them is thrown: no `locale` service (the words then come
from this package's own zh dictionary, and the marker says so), no `linkPanel` service
(`linkPanel-unavailable`), a `declare()` that threw (`linkPanel-declare-refused`, carrying the seam's own
text), and a seam drawn without `notify()` (the row keeps the text it was declared with, and the marker
names that too). A page with no `fetch`, a route that is not there, a body that is not JSON and an
`ok: false` answer each become the row's own named failure line rather than an empty row that reads like
a healthy bus.

`plugins/dsh-link-collab/test/panel-status-selfcheck.mjs` is the gate: it bundles `dsh-link-panel`'s own
`contributions.ts` and declares into THAT seam, then measures the row's admission, its words in both
languages, the zero timers, the `notify()`-on-change rule, each named absence, and the host route's
answer over a real ledger.
## Reclaiming the work of a silent owner

《DSH LINK.md》§2.4 (md:208-218) asks for four steps — notice a heartbeat that timed out, release the
work that member was holding, hand it out again, and keep the failed member out of new work. Three of the
four were unreachable here, and the reason was a doctrine: `claimable`, `reclaimable` and
`lockReclaimable` count only `unhealthy` as dead, and a member that never beat reads `unknown`. On a
ledger with `beats: 0` — which is what this machine's own ledger reads — no member is ever `unhealthy`,
so nothing was ever reclaimable. `RECLAIM_SILENT_OWNER` is the second rule that doctrine needed, named,
so that "silence is not death" keeps its meaning for a member that holds nothing.

| Code | Verdict | The fact |
|---|---|---|
| `NOT_IN_PROGRESS` | refuse | the row is pending, completed or deleted: nothing is being held |
| `NO_OWNER` | **reclaimable** | `in_progress` and no owner was recorded: the row holds a slot against nobody, and the kernel will not hand it out either (`claim` requires `pending`, `agent-team/src/task-board.ts:133`) |
| `NEVER_BEAT` | **reclaimable** | the owner holds the task and the ledger holds no heartbeat for it at all |
| `HEARTBEAT_STALE` | **reclaimable** | `now - heartbeatAt >= timeoutMs` — the equality is already out of bounds, the same boundary `livenessOf` states |
| `OWNER_ALIVE` | refuse | the owner beat inside the threshold: the control arm, and a call that meets it writes nothing |

`reclaimVerdict(subject, now, { timeoutMs })` is that rule over `{ id, status, ownerId?, heartbeatAt? }`
and reads no clock; `reclaimReading(state, key, now, options)` is the same rule over a folded board row
(one implementation, two doors), and `inFlightReadings(state, now, options)` is the board's whole held
work, one reading each, whatever the verdict.

**The tool.** `team_reclaim_task({ task, team?, reason?, at? })` registers with the three declaring tools;
`{ reclaim: { enabled: false } }` in the row config takes the tool away while leaving the rule, the fold
and `ctx.get('linkCollab').reclaim(...)` in place. A successful call appends:

1. one `task/state` — the task's own row, back to `pending`, `revision` continued, the owner **not written
   at all** (an absent `payload.owner` folds to `null`), and a `reclaimed` block naming the member it
   cleared, the rule, the code, the instant, the writer and the caller's reason;
2. one `member/quarantine` — the isolation of that member, which is what puts it in `state.quarantine`
   and keeps `isIsolated` true until it beats again (a later heartbeat clears it, by sequence, no clock).
   A row that named **no** owner writes the release row alone: there is nobody to isolate.

A refusal throws before the first append: `OWNER_ALIVE`, `NOT_IN_PROGRESS`, `UNKNOWN_TASK`, and
`AMBIGUOUS_TASK` when two teams share a task id and the caller named none; `RECLAIM_TASK_EMPTY`,
`RECLAIM_TASK_NAME`, `RECLAIM_TEAM_NAME`, `RECLAIM_REASON_EMPTY`, `RECLAIM_REASON_LONG`, `TIMEOUT` and
`AT` for the arguments. One more is worth knowing: `STALE_AT` refuses a call whose instant is older than
the claim it releases, because the board crowns claims by `(at, seq)` (`foldClaim`) — such a call would
leave both rows in the ledger and the task still reading `in_progress`. That is a silent no-op, this round
measured it, and it is a name now instead.

**What it does not do.** It does not call the kernel's Team service: md:214's release is a fact about
*this* board, and the kernel's own board is the Lead's (only a Lead may `reassign` there). Handing the task
out again is the next step and is already machinery — the R62 redispatch rule and the Lead's own claim both
work from `pending`.

## Pairing exchanges capability manifests, and a path keeps only what every hop carries

《DSH LINK.md》md:374 asks the pairing moment to exchange a **capability manifest**, md:384-388 asks the
rights along a multi-hop path to be the **smallest** on it, and md:376-382 asks for a face that lets one
end use another end's provider "as a local key", with failure mapped to "the service is gone". Three
things with three owners, and the first two are ledger facts read by pure functions.

**`end/manifest`.** One row per end, `{ end, via, platform, protocolVersion, capabilities, at }`, written
when an end pairs or comes up. `via` is the **next hop** towards the end reading the row — the same word,
with the same meaning, that `member/host` already uses — and the whole path is a fold over one fact
per hop, never an array inside one row. Two owners of "which way to that end" is what R44 removed, and
this fact does not put it back. `platform` is the writer's own word for what kind of end it is;
`protocolVersion` must be one this build speaks (`dsh-link-device/1`), and a refusal comes back with the
list that would have been accepted instead of leaving the caller to guess.

`manifestRecord(input)` is the pure builder and `appendManifest(state, log, input)` is the write, and
the write is where the names are checked: a capability name must be one the **capability registry**
already holds, because that registry is the single authority for what a capability is called on this
bus. `MANIFEST_END`, `MANIFEST_VIA`, `MANIFEST_PLATFORM`, `MANIFEST_VERSION`,
`MANIFEST_CAPABILITY`, `MANIFEST_AT` and `MANIFEST_INPUT` refuse the arguments, each before the first
append: the ledger is byte for byte as it was. `MANIFEST_NOT_AUTHORIZED` is the eighth word of that
family and the only one about **who is writing**: it refuses a row that speaks for an end the writer
is not (see below).

**One row, one writer.** An `end/manifest` row may only be written by the end it names, and the two
faces that can tell refuse it by name before the first append, so the ledger does not move.
* The **relay** refuses a batch whose writer declared a manifest **about itself** - in that batch, or
  in the rows this ledger already holds - and then carries a manifest row for another end. That is the
  case the truth-teller cannot tell from the liar, and it is the case that buys a road: a lying hop
  with a manifest of its own gets capability keys offered through it.
* The **write face** refuses a row from a ledger that knows which end its writer is (a manifest row
  that writer wrote about itself) when the row names an end the ledger holds nothing about: no manifest
  row names it and no member runs on it, so the row would stand in for an end nobody has ever declared.

Neither face refuses on the batch header alone. A header is a declaration, not a proof (the protocol
page, section five-two), so a writer that never declared a manifest of its own is taken at its word:
its row lands, and the fold then reads exactly the road it wrote - which is a road that breaks at the
hop it named, not one that carries it. And an end the ledger already holds may have its row written by
the ledger's own writer: recording a fact you were told is what a ledger is for. What is refused is
standing in for an end, not gathering one.

The fold keeps **both halves of the list**. `declared` is what the row said, exactly as it was written;
`capabilities` is what the registry recognises — the same pair of readings the board keeps in
`declaredDeps` and `deps`. A name nobody ever declared therefore shows up as a row counted in
`malformed` while the end stays visible with its own words: a reader never has to choose between "the
record is gone" and "the record was odd", and an unreadable name is never quietly read as "this end
does not have it".

**The decay along a path.** `effectiveCapabilities(state, end, now, { timeoutMs, localEnd? })` walks the
`via` chain one hop at a time and answers the **intersection** of the hops' capability sets, so a smaller
directory further out shrinks what arrives here. Every hop must have a manifest: a chain is only as long
as its facts. Name the end asking and the chain is the whole road, `[localEnd, ..., end]` — the shape
`routes` answers with — so the near end's own declaration is a hop like any other.

| Code | Means | Not to be confused with |
|---|---|---|
| `NO_MANIFEST` | that hop never declared one, and the path stops there | a hop that declared less |
| `PEER_SILENT` | the end being asked went quiet | a relay that went quiet |
| `ROUTE_DOWN` | a relay on the way went quiet, and the path stops at it | the far end being quiet |

Silence and a broken road stay two answers (R59), and a member that never beat reads `unknown`, which is
**not** silence here either (R40) — which is why a capability reading never has to wait for a timeout.
The boundary is stated, not left to chance: `sinceMs >= timeoutMs` is already out, and a hop that
repeats is where the road is down rather than something to walk forever. `now`, the threshold and the
chain are all parameters; no clock is read.

**Our own facade: `ctx.get('linkCollab').broker`.**

> **This is not the kernel's service broker and not an RPC provider.**（这不是内核 service broker /
> RPC provider。）No kernel provider is injected, no key space of the kernel's is touched, and nothing
> here reaches the network: the keys are a reading of this ledger, and the transport a caller uses to
> act on them is the relay that already exists. `TODO.md:70` draws that line, and the R183 ruling made
> writing it down part of opening this face at all.

`brokerKeys(state, now, { timeoutMs, localEnd? })` is the **only** generator of keys, and the key space
is `remote:<end>:<providerKey>`. A key is listed exactly when its link is up and the name survived the
intersection; the end reading the table is excluded when the caller names it, so "a remote provider" has
one owner and this end's own capabilities never appear as somebody else's. `brokerCall` never splits a
key on a separator — names may contain one — it matches the whole string against the rows' own words.

| Code | Means |
|---|---|
| `unknown-key` | no row ever offered this end and this name |
| `service-gone` | the key was offered and is not usable now: the chain broke, the name did not survive the path, or the end declared less than it used to (md:382, with the hop named in `reason`) |
| `not-granted` | the road is up and the two leads have no granted exchange in that direction (`mayExchange` is asked, never re-derived) |
| `no-provider` | nobody **on that end** declares the capability, or nobody declaring it is answering |
| `provider-silent` | a provider on that end is answering and this end cannot reach it |
| `ok` | the road is up, the exchange is granted, and a healthy provider is reachable |

The precedence is fixed and total: unknown-key, service-gone, not-granted, no-provider,
provider-silent, ok. `no-provider` and `provider-silent` are the MCP face's own words with the MCP
face's own meanings — the verdict is {@link mcpCall}'s, called rather than re-implemented — and
`service-gone` is paired with the listing by construction: at one instant a key that is in `brokerKeys`
is not answered `service-gone`, and a key that has left the listing is. `lastCode` is the only memory
the facade keeps: the code the last `call` gave.

## Recruiting and being recruited: one tree, one writer

md:274 asks that A can recruit B **and** that A can choose to be recruited by B. The tree already existed
(`team/state`, R37/R98); the act did not. `team/merge` is one row per act —
`{ from, to, state: 'requested'|'granted'|'denied', mode: 'join'|'absorb', by, at }`, subject `from`, so one
ordered pair has one address. `join` means `from` is taken in by `to`; `absorb` means `from` takes
`to` in. A request is not a permission, a later `denied` clears an earlier `granted` because the higher
sequence wins rather than by a second mechanism, and **no merge without a handshake**: whether two leads
may exchange is `mayExchange`"s question, and `mayMerge` composes it with the granted pair instead of
answering it a second time.

**A merge never writes another team's `team/state`.** The party being merged in writes its own row (its
parent is the team taking it in) and then the authorization that names who did it — so an agreement
written by the asking side, or a parent written for a third team, is refused by name rather than
recorded. Two writers of one parent is two answers to one question, which is exactly what the
`team-parent-arbitration` and `subagent-contention` gates exist to catch.

| Tool | Appends | Input | Refused with |
|---|---|---|---|
| `team_request_merge` | one `team/merge` | `{ team, mode }` | `MERGE_INPUT`, `MERGE_TEAM_EMPTY`, `MERGE_TEAM_NAME`, `MERGE_MODE`, `MERGE_SELF`, `MERGE_LOCAL_TEAM`, `MERGE_PEER_REQUIRED`, `MERGE_ALREADY_GRANTED` |
| `team_answer_merge` | a grant: two rows (the merged-in party's own `team/state`, then the authorization). A denial: one row. | `{ from, team?, grant }` | `MERGE_INPUT`, `MERGE_FROM_EMPTY`, `MERGE_FROM_NAME`, `MERGE_TEAM_EMPTY`, `MERGE_TEAM_NAME`, `MERGE_GRANT`, `MERGE_REQUEST_NONE`, `MERGE_REQUEST_AMBIGUOUS`, `MERGE_NOT_AUTHORIZED`, `MERGE_PEER_REQUIRED` |

`team` on the request is always the team at the **other** end, and the asking team is the one this
ledger's writer leads — a fact the ledger holds rather than an argument the model repeats. On the answer,
`team` names the party being merged in, which is the one fact that tells two standing agreements from
one asking team apart; with two and none named, the call refuses to guess which tree it is moving.
A grant carries the lead the team's own last declaration held, because the fold reads a row without one
as "no lead at all" — clearing one fact while writing another is what this layer refuses everywhere else.

Both tools register with the declaring and handshake tools and by the same rule: no switch, because a
switch would make "these two teams may not merge" indistinguishable from "nobody wired the tool".
Registering them widens the model-visible face, which `verify-collab-declare` pins by name; the
widening is reported rather than smuggled, with the exact tool names and readings, in
[docs/handoff/R183-A-ledger.md](../../docs/handoff/R183-A-ledger.md).

**How this is held to what it says.** `test/manifest-selfcheck.mjs` (9 readings) and
`test/merge-selfcheck.mjs` (6 readings) drive the shipped artifact through a real `apply()`
composition and a real `control.jsonl` they parse themselves; refusal batches are measured against
the file's sha256 and byte length; the same rows in any array order fold byte for byte the same. The
three-process reading — A, B and C as real node processes, two arrival orders, and a relay that never
arrives making one key `service-gone` — lives in `.tmp/r183-a/two-order.mjs`. One fact that reading
established and that a naive comparison would miss: **a relay assigns its own arrival order**, so the same
fact lands at a different local `seq` depending on when it got there, and "two arrival orders fold byte
for byte the same" is true of the same records handed to the fold (sequence included) and true of a real
relay's **fact table** (ends, hops, versions and capability sets), but not of the two relays' raw sequence
numbers.


