# 03 — The collaboration bus

**Chapter decision: extend.** Build the bus on top of Agent Teams' existing domain service and tool
plane, on documented seams, without replacing either. Reason: Agent Teams already ships the three
hardest parts — a durable mailbox with an at-least-once delivery record, a compare-and-set task board
with a dependency DAG, and a scoped registration mechanism that gives every team member the same nine
tools. What it does not ship is a **lease**, a **capability registry**, a **review state**, and any
way for an agent outside this process to participate at all. Those four are additive. Rewriting any of
the shipped three would trade a working, persistent, tested subsystem for a worse one.

---

## 1. What Agent Teams already gives us

Two packages, both experimental, both in the pinned kernel:

- `@deepseek-ai/dsh-experimental-agent-team` — the domain service `ctx.agentTeams`
- `@deepseek-ai/dsh-experimental-tool-agent-team` — nine scoped tools over that service

### 1.1 The tool plane — nine tools in four capabilities

> `[代码可证]` "The nine tools group into four capabilities: **Create a teammate** — `spawn_teammate`
> takes a name, a description, and the initial task; **only the Lead can call it**. **Send messages** —
> `send_message` steers a running member at its nearest step boundary, starts or resumes an inactive
> member. **See and wait** — `list_agents` returns each member's `target` and availability;
> `wait_agent` waits for the next team change; `interrupt_agent` stops a teammate's current turn (Lead
> only). **Manage the task board** — `team_task_create`, `team_task_list`, `team_task_get`, and
> `team_task_update` add, browse, read, and update shared tasks."
> — `core/deepseek-harness/packages/experimental/tool-agent-team/README.md:57-62`

The nine names are pinned by the package's own test at
`core/deepseek-harness/packages/experimental/tool-agent-team/tests/tool-team.spec.ts:34-42`:
`spawn_teammate`, `wait_agent`, `team_task_create`, `team_task_list`, `team_task_get`,
`team_task_update`, plus `send_message`, `list_agents`, `interrupt_agent`.

Scoping: "Every registration lives on the member Agent's own `ctx`" — the three commitments are
"**Scoped, not global**", "**Declared results, compact JSON**", and "**The domain owns authority**.
Tools delegate to `ctx.agentTeams`, which enforces Lead authority and revision checks; the adapter
adds no weaker path." (`tool-agent-team/README.md:82-86`).

### 1.2 The durable record

The domain service writes whole-value events into the **Team Lead's** session log, with a declared
persistence disposition:

> `[代码可证]` `core/deepseek-harness/packages/experimental/agent-team/src/types.ts:229-244`:
> `team/member` is `{ version: 2; teamId; member: TeamMemberSnapshot }`, "Whole teammate lifecycle
> value, stored only in the Team Lead Session"; `team/task` is the same shape for a task;
> `team/message/queued` is "Durable mailbox enqueue, stored before delivery is attempted"; and
> `team/message/delivered` is `{ version: 2; teamId; messageId; targetId }`, "Durable acknowledgement
> that the target Session recorded the message".

This is the load-bearing fact for the whole chapter: **a persistence plane already exists, with a
queue-before-delivery and a delivery acknowledgement.** Any bus we add must write through it rather
than beside it.

### 1.3 The task board

Statuses are `pending | in_progress | completed | deleted` — at `agent-team/src/task-board.ts:61,136,141,165,170,196`. Actions are exactly eight:

> `[代码可证]` `'claim' | 'release' | 'edit' | 'set_dependencies' | 'complete' | 'reopen' | 'reassign' | 'delete'` — `agent-team/src/types.ts:201-211`.

Authority and concurrency, each enforced in the operation that makes the decision:

| Rule | Evidence |
|---|---|
| Compare-and-set on revision | `if (current.revision !== request.expectedRevision) throw … 'TEAM_TASK_STALE_REVISION'` — `task-board.ts:115-120` |
| Owner-or-Lead only | `if (!lead && !owner) throw new TeamError('task mutation requires its owner or Team Lead', 'TEAM_TASK_UNAUTHORIZED')` — `task-board.ts:125` |
| A claim cannot steal | `throw new TeamError(… 'TEAM_TASK_ALREADY_CLAIMED')` — `task-board.ts:131` |
| A blocked task cannot be claimed | `if (!taskReady(state, current)) throw … 'TEAM_TASK_BLOCKED'` — `task-board.ts:134,184` |
| Release returns it to the pool | `next = this.withoutOwner({ ...current, status: 'pending' })` — `task-board.ts:141` |
| Reassign is Lead-only | "Member target from spawn_teammate or list_agents for Lead-only reassign" — `tool-agent-team/src/index.ts:376` |
| The DAG is checked for cycles | `TEAM_TASK_DEPENDENCY_CYCLE` — `task-board.ts:222-226` |
| A task with dependents cannot be deleted | `throw new TeamError(… 'TEAM_TASK_HAS_DEPENDENTS')` — `task-board.ts:194` |

`blocked_by` is declared on creation (`CreateTeamTaskRequest.blockedBy` — `types.ts:194-199`) and is
settable later through `set_dependencies`, which requires it: `if (request.blockedBy === undefined) throw new TeamError('set_dependencies requires blocked_by', 'TEAM_INVALID_ARGUMENT')` — `task-board.ts:159`.

**So "claim/lock" already exists as optimistic concurrency plus an owner field.** What does not exist
is any expiry on that ownership — which is item M4.

### 1.4 The mailbox

> `[代码可证]` `SendTeamMessageResult` is `{ messageId: TeamMessageId; status: 'accepted' | 'queued' }`
> — `agent-team/src/types.ts:187-191`. The upstream contract: "Sending a message succeeds as soon as
> it is safely stored: the result is `accepted` (delivered now) or `queued` (waiting), and a queued
> message must not be resent." — `tool-agent-team/README.md:68`

A teammate is torn down between turns, so "inactive" is the normal state, and the mailbox is what
makes a message to an inactive member survivable:

> `[代码可证]` "a teammate is torn down between turns (`status: inactive`)" —
> `plugins/dsh-agent-context/README.md:28`

### 1.5 Limits and configuration

> `[代码可证]` `core/deepseek-harness/packages/experimental/agent-team/README.md:49-55`:
> `maxMembers` 16, `maxTasks` 256, `maxPendingMessagesPerMember` 64, `maxMessageBytes` 65,536,
> `disposalTimeoutMs` 5,000.

### 1.6 What upstream itself says it does not support

This is the most useful sentence in the evidence base for this chapter, because it is the upstream
admitting exactly our gap:

> `[代码可证]` "Avoid it when teammates need separate working directories, **when several processes
> must coordinate over one team**, or **when a task owner should be released automatically** — none of
> those are supported. The team features need durable session storage to activate."
> — `agent-team/README.md:32`, emphasis added

And on the hierarchy:

> `[代码可证]` "**Only the Lead can create teammates or interrupt them.**" — `agent-team/README.md:65`

---

## 2. What is missing, exactly

Six items. Each is stated as today / missing / design, and each ends in a testable acceptance
condition.

### M1 — The message envelope: a persisted **control** channel versus a TTL **data** channel

**Today.** One channel, one shape: a message is `ContentBlock[]` addressed to a `target`
(`SendTeamMessageRequest` — `types.ts:180-185`), stored durably before delivery is attempted
(`team/message/queued`), acknowledged on delivery (`team/message/delivered`). An instruction and a
4 KB build log travel the same path and pay the same durability cost.

**Missing.** No distinction between a message that **must** survive a restart because it changes the
team's state, and a message that is worthless in ten minutes. Every heartbeat-shaped or
telemetry-shaped message therefore either becomes permanent session history or is not sent at all.
The prior art is unanimous that the split is required, and for different reasons: MCP names the
ephemeral half explicitly — the same JSON-RPC object **without an `id`** is a notification
([MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)); A2A
separates a durable task from a `TaskStatusUpdateEvent` pushed to a webhook
([A2A streaming and async](https://a2a-protocol.org/latest/topics/streaming-and-async/)); and
Temporal's guidance is that the *lack* of an option is the bug — "The Temporal Server doesn't detect
failures when a Worker loses communication with the Server or crashes. Therefore, the Temporal Server
relies on the Start-To-Close Timeout to force Activity retries"
([Temporal](https://docs.temporal.io/encyclopedia/detecting-activity-failures)).

**Design.** One envelope, two dispositions, declared at the send site and never inferred:

```ts
type Channel = 'control' | 'data'

interface Envelope {
  readonly channel: Channel
  readonly id: MessageId          // minted by the sender; the dedupe key
  readonly from: MemberTarget
  readonly to: MemberTarget | 'team'
  readonly sentAt: number         // sender's clock, for display ordering only, never for correctness
  readonly body: ControlBody | DataBody
  readonly ttlMs?: number         // REQUIRED on 'data', FORBIDDEN on 'control'
}

// control: persisted through team/message/queued -> team/message/delivered, exactly as today.
// data:    never persisted to the session log; delivered on the live path only, dropped at ttlMs.
```

| Rule | Why |
|---|---|
| `ttlMs` is required on `data` and forbidden on `control` | The two failure modes are opposite: a control message that expires is a lost instruction, and a data message that persists is permanent history pollution. Making the type express both forbids each. |
| `data` never appends a session event | The session log is the model-visible truth (repo rule: "Model-visible is congruent with logged", `core/deepseek-harness/AGENTS.md`). A heartbeat is not model-visible and must not become reconstructable history. |
| `control` keeps its `accepted` or `queued` result unchanged | That result is already the right contract and is already tested; do not touch it. |
| Ordering is per-`(from, to, channel)` FIFO | Cross-channel ordering is meaningless, and asserting it would be a lie. |
| `id` is the dedupe key, not a sequence | Retries happen; the receiver drops a duplicate `id` and answers with the original outcome. |

**Acceptance for M1.** (a) A `data` envelope is never present in the session log after the boot —
assert by scanning the persisted log for its `id`. (b) A `control` envelope sent to an inactive
member is delivered after a cold resume, exactly once — assert a `team/message/delivered` count of 1.
(c) An envelope whose `channel` is `data` and which omits `ttlMs` fails at the type level and is
refused at runtime by the same validator.

### M2 — The capability registry

**Today.** `list_agents` returns each member's `target` and availability — `running`, `inactive`,
`provisioning`, `failed` (`types.ts:62`). That is a **liveness** roster. Nothing says what a member
can *do*: which tools it has, which model or provider it is routed to, which skills it holds, whether
it can execute shell commands at all.

**Missing.** A registry. The consequence today is that a Lead assigns work by guessing, and a teammate
discovers it cannot do the job only after it has claimed the task and failed — which is exactly the
failure mode that produces a stuck `in_progress` row (M4).

**Design.** Capabilities are **declared by the member, recorded by the Lead, and never inferred by the
assigner.** Three rules:

1. **Declared at spawn, immutable for the member's life.** `spawn_teammate` already prefixes the
   initial message with a fixed identity block (`tool-agent-team/README.md:127`); the capability
   descriptor rides in the same step, so it cannot drift from the member it describes.
2. **Recorded as data in the Lead's log**, beside `team/member` — an added field on the existing event
   rather than a new event type, so the roster projection needs no new fold. This is the least
   invasive shape, and it is why M2 needs no persistence-format change.
3. **Matchable, not authoritative.** Matching a capability against a task's declared needs is a
   **warning** that shapes assignment, never a gate. The upstream already made that call for the
   analogous feature — write-scope overlap "produces warnings … they never block anything"
   (`agent-team/README.md:79`) — and copying the precedent keeps us consistent with a rule the kernel
   authors already tested.

Descriptor, deliberately small:

```ts
interface CapabilityDescriptor {
  readonly tools: readonly string[]        // tool names this member actually has
  readonly skills: readonly string[]
  readonly route?: { provider: string; model: string }   // see section 3.2
  readonly exec: boolean                   // may this member run shell commands
  readonly writeScopes: readonly string[]  // declared by the same author, same lifetime
}
```

**Acceptance for M2.** (a) `list_agents` on a two-member team returns a non-empty descriptor for each
member, and the **Lead's own descriptor is not fabricated** — if the Lead has none, the field is
absent, not an empty object. (b) Assigning a task whose declared needs exceed a member's descriptor
produces a warning containing both the missing capability and the member's `target`, and the claim
**still succeeds**. (c) After a cold resume of an inactive member, its descriptor is identical to the
one recorded at spawn.

### M3 — The task board's `review` state, and failure release

**Today.** Four statuses, and the only exit from `in_progress` is `complete`, `release` (back to
`pending`), `reassign`, or `delete`. `complete` is reachable by the **owner** — the same agent that did
the work (`task-board.ts:162-165`).

**Missing.** Two things, and they are one problem:

1. **No `review` state.** Work that is finished but not accepted is indistinguishable from work still
   being done. There is no way to say "the teammate says it is done, the Lead has not agreed".
2. **No failure release.** Nothing transitions a task out of `in_progress` because the attempt
   *failed*. Absent a lease (M4) the row is simply stuck, and the closest comparable system names the
   same symptom from the other side: "**Task status can lag**: teammates sometimes fail to mark tasks
   as completed, which blocks dependent tasks" — Claude Code Agent Teams
   ([docs](https://code.claude.com/docs/en/agent-teams)).

**Missing, precisely.** A2A's task-state vocabulary is the right reference and it contains **no state
named `review`** — its interrupted states are `TASK_STATE_INPUT_REQUIRED` and
`TASK_STATE_AUTH_REQUIRED`, and its terminal set is COMPLETED, FAILED, CANCELED, REJECTED
([Life of a Task](https://a2a-protocol.org/latest/topics/life-of-a-task/)). So we should not invent a
tenth name; we should add the transitions Agent Teams lacks, with the A2A mapping written down:

| New transition | From | To | Who may call it | A2A mapping |
|---|---|---|---|---|
| `submit` | `in_progress` | `review` | the owner | WORKING to INPUT_REQUIRED |
| `accept` | `review` | `completed` | the Lead | to COMPLETED |
| `reject` | `review` | `in_progress` or `pending` | the Lead | back to WORKING, or to the pool |
| `fail` | `in_progress` | `pending`, owner cleared | **the framework**, on lease expiry (M4) | to FAILED, then re-queued |

`review` is added to the status union; `submit`, `accept`, `reject` and `fail` are added to the action
union. Everything else about the board is untouched, including the revision CAS — a `reject` is a CAS
write like any other, so it cannot race an `accept`.

**Acceptance for M3.** (a) `complete` by a non-Lead owner on a task in `in_progress` is **refused**
once `review` is enabled, with a message naming `submit`. (b) The sequence `claim → submit → reject → claim → submit → accept` lands on `completed` with exactly one owner change and no lost revision.
(c) `fail` moves the task to `pending` with a cleared owner and appends a diagnostic naming the lease
that expired.

### M4 — Heartbeat, release, and reassignment

**Today.** Ownership has **no expiry**. A member that claims a task and then dies holds it forever.
The upstream states the absence directly: "**when a task owner should be released automatically** —
none of those are supported" (`agent-team/README.md:32`).

**Missing.** A lease. This item has the most prior art and the clearest warning attached to it, and
both should be read before designing.

*The mechanism.* Kubernetes' Lease object is the reference shape: `leaseDurationSeconds` is "a duration
that candidates for a lease need to wait to force acquire it … measured against the time of last
observed `renewTime`", with `holderIdentity`, `acquireTime`, `renewTime` and `leaseTransitions` (a
coarse fencing counter)
([LeaseSpec](https://kubevirt-ui.github.io/kubevirt-api/interfaces/kubernetes_models.IoK8sApiCoordinationV1LeaseSpec.html),
[Leases](https://kubernetes.io/docs/concepts/architecture/leases/)). Kubernetes runs kubelet liveness
on the same object: every Node has a same-named Lease in the `kube-node-lease` namespace, and "every
kubelet heartbeat is an update request to this Lease object, updating the `spec.renewTime` field".

*The warning, which we must not skip.* client-go's own package documentation says: "This implementation
**does not guarantee that only one client is acting as a leader (a.k.a. fencing)**. It is tolerant to
arbitrary clock skew, but is not tolerant to arbitrary clock skew rate"
([leaderelection](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection)). Jepsen's etcd 3.4.3
analysis goes further, concluding that "**mutex violations cannot be eliminated altogether, because
distributed locks are a fundamentally unsafe concept in asynchronous systems**" — with failure rows
reading "Locks return after blocking without checking ownership"
([jepsen.io](https://jepsen.io/analyses/etcd-3.4.3)).

**Design, with the warning taken seriously.** Three rules:

1. **The lease is a liveness heuristic, not a mutual-exclusion primitive.** It answers "has this owner
   gone quiet", never "is this owner the only one". The board's revision CAS remains the only authority
   on writes, and it is already there (`task-board.ts:115-120`).
2. **A monotonic fencing token is carried on every write.** `leaseTransitions` from the Kubernetes
   shape is the token: it increments on each acquire, and a write carrying an older token is refused.
   This is the Chubby lease-plus-sequencer pattern, the classical answer to exactly the hazard above
   ([Burrows, OSDI '06](https://www.usenix.org/legacy/events/osdi06/tech/burrows.html)); without it the
   lease would *introduce* the double-writer bug it looks like it prevents.
3. **Expiry is a release, and release has a defined owner.** On expiry the framework appends a `fail`
   transition (M3): the task returns to `pending`, the owner is cleared, and the fencing token is
   bumped. No reassignment is implicit; the Lead or any member may then claim it.

Numbers come from the same sources rather than from taste: Kubernetes' node-monitor defaults are
`--node-monitor-period 5s` with a 50 s grace period, and client-go's jitter factor is `1.2`
([kubelet flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)). A first
baseline is therefore **heartbeat every 5 s, lease expiry at 50 s, jitter of 1.2** — and the obligation
is to make each of the three a validated config field rather than a constant, since the repo rule is
"No hardcoded tunables in plugins".

**Acceptance for M4.** (a) A member that stops heartbeating has its task released at the configured
expiry, with a diagnostic naming the elapsed time. (b) A write attempted with a stale fencing token is
**refused**, and the refusal names both tokens. (c) A member that resumes after its lease expired
cannot write to its old task without re-claiming. (d) The clock is never compared across members: the
lease is measured against the **framework's** observed `renewTime`, exactly as Kubernetes does it, so
two machines' clocks may be wrong in opposite directions without producing a false expiry.

### M5 — The fractal lease: today only the Lead can spawn

**Today.** `spawn_teammate` and `interrupt_agent` are Lead-only, enforced in the domain service and
repeated in the tool descriptions: "Create one named, durable teammate. **Only the Team Lead may call
this tool.**" (`tool-agent-team/src/index.ts:177`); "Interrupt one teammate's current turn while
preserving its pending inbox. **Team Lead only.**" (`index.ts:279`). A teammate holds the same nine
schemas — "All nine Team schemas are identical for Leads and teammates; execution enforces Lead-only
operations" (`tool-agent-team/README.md:127`) — and is refused at execution.

**Missing.** Recursion. A teammate cannot build its own team. Every comparable system draws this line
somewhere, and they draw it in the same direction:

> `[外部]` Claude Code Agent Teams: "**No nested teams**: teammates cannot spawn their own teammates.
> Only the lead can manage the team"; "**Lead is fixed** … can't promote a teammate to lead"; "**One
> team per session**" ([docs](https://code.claude.com/docs/en/agent-teams)). Third-party reports put
> Claude Code's *subagent* recursion at depth 3 behind a `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
> kill-switch, but those are blog sources and are recorded as unverified.

**Design — and this is the whole departure.** A **fractal lease**: the right to spawn is itself a
leased, delegable capability, not a role.

```ts
interface SpawnLease {
  readonly holder: MemberTarget      // who may now spawn
  readonly depth: number             // 0 = the root Lead; the root's children are 1
  readonly maxDepth: number          // validated config, not a constant
  readonly subtreeBudget: number     // members this holder may create, transitively
  readonly expiresAt: number         // the same lease machinery as M4
  readonly fencingToken: number
}
```

Four rules make it safe:

1. **The tree is the authority structure, not a policy text.** A member may spawn only under a
   `SpawnLease` it holds; the lease's `depth` bounds recursion the way IP's TTL does — "an upper bound
   on the lifetime of an internet datagram … reduced at the points along the route where it is
   processed. If the time to live reaches zero … the internet datagram is destroyed"
   ([RFC 791](https://www.rfc-editor.org/rfc/rfc791.txt)) — except that here it bounds a subtree
   rather than a packet.
2. **The budget is subtractive and transitive.** A parent passing a lease to a child splits its own
   `subtreeBudget`; the sum of live children's budgets never exceeds the parent's. This is the
   capability-bounding-set calculus: "the capability **bounding set is ANDed with** the file permitted
   capability set, and the result … is assigned to the thread's permitted capability set"
   ([capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)) — a child can only
   narrow, never widen.
3. **Every spawn carries the full ancestor path**, and a member that finds itself in the path refuses
   with `spawn-loop`. This is the same ordering as the LAN bridge's relay guard — "Every hop appends
   its own `deviceId` before forwarding. Every hop (including the last) refuses when it finds itself
   already in `path`" (`plugins/dsh-lan-bridge/docs/MULTI-DEVICE-CONTRACT.md:82-84`) — and that is not
   a coincidence: it is the same problem, and we should reuse the vocabulary.
4. **A lease is revocable and its revocation cascades.** Interrupting a subtree is one operation on the
   lease, not a walk of the roster.

**Acceptance for M5.** (a) At `maxDepth` 2 the tree is Lead then teammate then teammate, and a spawn
at depth 3 is refused with a message naming the depth and the limit. (b) A parent that spawns three
children splitting a budget of 5 leaves the parent 2, and a fourth child is refused. (c) A revoked
lease cascades: after revocation no descendant can spawn, and each live descendant is interrupted.
(d) A cycle in the ancestor path is refused as `spawn-loop` — asserted by constructing the path
directly, since the tree shape makes a real cycle unreachable.

### M6 — External-Agent adapters, with a minimal verb set

**Today.** Zero support, stated twice by upstream: "when several processes must coordinate over one
team … none of those are supported" (`agent-team/README.md:32`). Every team member is an in-process
Agent of this kernel.

**Missing.** An adapter boundary at which an agent that is **not this process** — another device (see
§04), another kernel version, a different framework entirely — can join a team as a first-class member.

**Design: six verbs, and no seventh without amending this section.**

```
hello        -> identity, protocol version, capability descriptor (M2)
capabilities -> the descriptor again, on demand, so a stale cache is always correctable
claim        -> claim a task by id, carrying the fencing token if the board has one (M4)
beat         -> renew the lease; the only verb a member must call on a timer
result       -> submit | accept | reject | fail, that is, M3's transitions as data
message      -> one control or data envelope (M1)
```

Design constraints, each with its source:

| Constraint | Source |
|---|---|
| The session is **opt-in and revocable**, and a missing or expired session has a distinct answer | MCP: the server MAY assign a session id; a server requiring one "SHOULD answer a missing-session request with **400** … Server MAY terminate at any time and MUST then answer that session with **404**; on 404 the client MUST re-`initialize`" — [transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) |
| The version handshake is **bidirectional and can end in a disconnect**, with the supported set returned | MCP: the client MUST send a version it supports; the server "**MUST respond with that same version**", otherwise replies with another supported version, and "if the client cannot support that, it **MUST disconnect**"; the failure is **-32602** "Unsupported protocol version" with `data: {supported: [...], requested: "..."}` — [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) |
| Verbs are **capability-declared**, and an unknown required extension fails the handshake rather than being ignored | A2A: `AgentCapabilities` is four flags — `streaming`, `push_notifications`, `extensions[]`, `extended_agent_card` — and `AgentExtension` carries a `required` flag meaning "peer MUST understand" ([a2a.proto](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto)) |
| Discovery is a **single declarative document**, not a conversation | A2A's AgentCard — `name`, `description`, `supported_interfaces` (ordered, first preferred), `capabilities`, `security_schemes`, `skills[]`, `signatures[]` — is one document fetched once |
| Every request has a bounded timeout, then a **cancellation**, then a hard maximum | MCP: "implementations SHOULD timeout every request, then send a cancellation notification [`notifications/cancelled`], and SHOULD enforce an absolute maximum even across progress notifications" — [transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) |
| `beat` is mandatory and its absence is a defined failure, not a silence | Temporal: "If the Cluster does not receive a Heartbeat within a Heartbeat Timeout … the Activity will be considered failed and another Activity Task Execution may be scheduled according to the Retry Policy" — [Temporal](https://docs.temporal.io/encyclopedia/detecting-activity-failures) |

**Acceptance for M6.** (a) A reference external agent (a separate process) completes `hello → claim → beat twice → result(submit) → accept` end to end and appears in `list_agents` with its descriptor.
(b) An agent presenting an unsupported protocol version is refused with the supported set listed.
(c) An agent that stops beating is released by M4's lease and its task returns to `pending`.
(d) Killing the external process mid-claim leaves the board consistent — the task is released, not
stuck — and no tool from that member remains registered.

---

## 3. What this repository already ships in this area

Both of these are 0.1.5-era work that already lives in `plugins/`, and both are load-bearing for the
bus rather than incidental to it.

### 3.1 `plugins/dsh-agent-context` — `agent_context` and `compact_agent`

Two model-facing tools that give a Team Lead "a window and a handle on the context of the agents it
delegated to" (`plugins/dsh-agent-context/README.md:3-4`):

| Tool | What it does |
|---|---|
| `agent_context` | "Measured context status of every delegated agent the caller can see: routed provider/model, measured tokens, that model's context window, pressure %, liveness, mid-turn vs idle, whether a compaction is already in flight … and whether an inactive target can be resumed for compaction." |
| `compact_agent` | "Compacts ONE delegated agent's own history in place — the same operation as the human `/compact`, addressed to that teammate/subagent instead of to the caller." |

Three facts in it matter to the bus:

1. **It is the existing measurement surface.** `agent_context` already returns provider, model, tokens,
   window, pressure and liveness per child — which is most of M2's descriptor and the *input* to M4's
   heartbeat decision. The capability registry should consume it rather than duplicate it.
2. **The compaction backend is unreachable from the host plane, and the workaround is a record.** "
   `compaction` is a preset-realm service, so a host-plane plugin cannot resolve `ctx.compaction`
   (verified live: `agent.ctx.get('compaction')` is `undefined` for every agent)"
   (`README.md:33-34`). The tool therefore drives the human entry point instead:
   `await ctx.commands.execute(targetAgent, '/compact', [], signal)` (`README.md:39`). **This is a
   realm-boundary fact the bus must respect: a host-plane coordinator cannot reach a preset-realm
   service.** Any bus design that assumes otherwise is dead on arrival.
3. **Cold resume has a documented shape.** For a target whose agent no longer exists,
   `ctx.agents.resume({ resumeSessionId: targetId, parentAgent: caller, setup: (childCtx) => childCtx.get('agentPresets')?.composeFrom(childCtx, caller.ctx) })`, then dispose in a `finally`
   (`README.md:51-58`). M4's expiry handler and M6's reconnect both need this exact call; it should be
   reused, not re-derived.

Authority is stated rather than implied: "A caller may compact itself, any member of the Team it leads,
and any of its own live descendants. Every other target is refused." (`README.md:62-63`) — which is the
same authority shape M5's fractal lease generalizes.

### 3.2 The model-routing and context-health changes to Agent Teams

`plugins/dsh-delegation-model-choice` is the record. It opens by answering whether DSH already has the
feature, and the answer is "**half**" (`README.md:6-15`):

> `[代码可证]` "`spawn_teammate` — **no**. `SpawnTeammateRequest`
> (`@deepseek-ai/dsh-experimental-agent-team`) has only `name/description/prompt/context/provider/signal`,
> where `provider` is the subagent backend name (`spawn` or `fork`), not a model; `spawnAdmitted()`
> calls `ctx.subagents.startContinuable({... request:{prompt,parent}})` **without `agentOptions`**, so a
> teammate always inherits the Lead's model."
> — `plugins/dsh-delegation-model-choice/README.md:13`

The plugin's workaround is the important part, because it is a **realm-boundary spanning technique the
bus will need again**: it reproduces "the Team service's own two-stage log protocol" — (1) append
`team/member` with `phase: provisioning` and flush, (2)
`ctx.subagents.startContinuable({ childId, provider, label, request: { prompt, parent, agentOptions } })`
with the explicit route, (3) append `team/member` with `phase: active` and flush, or `phase: failed`
with the error (`README.md:46-49`) — so that the member stays a first-class citizen of `list_agents`,
`send_message`, the shared task board and teardown. It routes around `spawnTeammate` **without leaving
the durable record**, and it says why it can: "`team/member` v2 is a known event type of `dsh-session`
with a persistence disposition, and the `agentTeam` projection folds the roster from it".

Verified, with evidence a reviewer can check (`README.md:110-114`): `list_delegation_models` returns 36
live routes; a teammate was created on `tokenrhythm/glm-5` through the approval card; `list_agents`
shows `lead` plus `glm5-check`; and the child's own log carries `subagent/descriptor {mode:continuable, provider:spawn, agentProvider:tokenrhythm, agentModel:glm-5}` and `request/header config={provider:tokenrhythm, model:glm-5}`.

The context-health half is `dsh-agent-context`'s: pressure measured as a fraction of the routed model's
window, over the same routed provider and model the routing plugin sets. Together the two are why M2's
descriptor can carry `route` and why M4 can decide *when* to renew — the two plugins already answer
"which model is this member on" and "how close to its window is it".

> **更正（2026-10-07 实测）**：本节据此推出的「两者都停用」**在运行期不成立**——那两行 `disabled: true` 是死旗（同 id 的插件自带补丁在 bundle 顺序里更靠后，Loader 按 id 建键、后行胜出）。agent-context 与 lan-bridge 一直在跑；四行里只有 `browser` 真停用。证据与数字见 `docs/handoff/R3-enable-rows.md`。
>
 `README.md:44-47` records that the four capability rows the desktop
edition had dismounted ship `disabled: true`, and `dsh-agent-context` is one of them
(`plugins/dsh-link-mods/README.md:28`). Re-enabling is deleting one line's flag (`README.md:347-350`).
That is the first action of phase 1 below, not a later one.

---

## 4. Roadmap

> `[外部: 用户简报]` **The three phases, verbatim from the user's brief.** They were supplied by the
> Lead in this session, after this chapter's first draft; the table below them is retained as the
> *gap-dependency order* that those phases resolve to (content grounded in §2), not as the roadmap
> itself. Implement against the three phases; use the table to decide what lands inside each.
>
> - **阶段一 — 控制总线 + 任务板 + 能力注册表.** 先实现最核心的协作基础设施。验证 DSH Lead 能创建子
>   Agent，子 Agent 能认领任务、上报状态。
> - **阶段二 — 故障隔离与任务重调度.** 加入心跳检测和任务回收机制。验证一个 Agent "宕机"（可能是模型
>   缺陷，也可能是网络问题）后，lead（此指那个子 Agent 所属的 lead，不一定是总的 lead）会发现，任务能被
>   自动重新分配。
> - **阶段三 — 分形团队与多平台 Agent 接入.** 实现递归的团队创建机制，并通过 Adapter 接入 HanaAgent
>   等外部 Agent 平台。外部 Agent 只需要安装一个小桥接插件，就可以由 lead 接入任意会话了（可以是新建
>   的，也可以是原有的，lead 有能力去管理上下文）。
>
> Two further requirements from the same brief, which are *not* phases but constraints on all three:
> **必要时子 Agent 可向整个网络中同级/上级/下级的 Agent 直接发送消息，不经过任何中间商**；以及
> **下级 Agent 自动继承上级的模型选择，上级也可以指定**（同样继承）。
>
> | Gap-dependency order (what the phases resolve to) | Delivers | Why here and not later |
> |---|---|---|
> | **Inside 阶段一** | Re-mount `dsh-agent-context` and `dsh-delegation-model-choice`; add M2's descriptor, sourced from `agent_context`'s existing measurement | Everything else needs the registry. The registry needs a measurement source, and one already exists and is merely dismounted. No new persistence and no new event type. |
> | **Inside 阶段二** | M1 (envelope, both channels), M3 (`review` and failure release), M4 (heartbeat, lease, fencing token) | One mechanism in three parts: a lease only means something if failure has a transition (M3), and a lease renewal is a data-channel message (M1). M4 without M1 makes every heartbeat permanent history; without M3 an expired lease has nowhere to go. |
> | **Inside 阶段三** | M5 (fractal lease), M6 (external adapters) | Both multiply an authority structure that must already be correct. M5 generalizes M4's lease from a task to a subtree; M6 exposes M2's descriptor and M3/M4's verbs across a process boundary. §04's cross-device recruitment is the first M6 consumer. |

---

## 5. Acceptance — the fault-injection test

The bar for §03 is **not** a happy-path integration run. Every gap in §2 is a failure-handling gap, so
the acceptance bar is a fault-injection suite, specified here so it can be built without further
questions.

**Framing.** The standard is chaos engineering's four steps: define "steady state" as a measurable
output, hypothesise it holds in a control and an experimental group, "Introduce variables that reflect
real world events", and "Try to disprove the hypothesis by looking for a difference in steady state"
([principlesofchaos.org](https://principlesofchaos.org/)).

**Steady state, stated as a measurable invariant.** For every moment of the run, and for every task on
the board, exactly one of these holds:

- the task is `pending` with no owner;
- the task is `in_progress` with an owner whose lease is live;
- the task is `review` with a recorded submitter and no lease;
- the task is `completed` or `deleted`.

Steady-state violations to detect: a task `in_progress` whose owner's lease has been expired for more
than one expiry interval; two members holding a live lease for one task; a write accepted with a
fencing token older than the task's current token; a `data` envelope present in the persisted log.

**The injected faults.** Named after the shipped vocabulary, so an implementer can pick a tool source
directly. Chaos Mesh's `PodChaos` actions are `pod-failure`, `pod-kill` and `container-kill`, and its
`NetworkChaos` actions are "`netem`, `delay`, `loss`, `duplicate`, `corrupt`, `partition`, and
`bandwidth`" with `direction` of `to|from|both`
([Pod Faults](https://chaos-mesh.org/docs/simulate-pod-chaos-on-kubernetes/),
[Network Faults](https://chaos-mesh.org/docs/simulate-network-chaos-on-kubernetes/)).

| Fault | Injects | Targets which gap |
|---|---|---|
| `member-pause` | Suspend a member's turn loop without killing it, past one lease interval | M4 — the stale-owner case, and the one that produces double writers |
| `member-kill` | Kill a member mid-turn with a task claimed | M3 plus M4 — that there is a `fail` path at all |
| `heartbeat-suppress` | Drop `beat` envelopes only, leaving every other message flowing | M4 — that expiry is driven by the missing beat, not by general silence |
| `message-loss` | Drop a fraction of `data` envelopes | M1 — that a lost data message is survivable and a lost control message is not |
| `duplicate-delivery` | Re-deliver every control envelope once | M1 — the `id` dedupe key |
| `partition` | Non-transitive partitions with overlapping majorities, "as well as specifically targeting leaders for failure" ([jepsen.io](https://jepsen.io/analyses/etcd-3.4.3)) | M4 plus M5 — split-brain on the board and on the spawn tree |
| `clock-skew` | Skew one member's clock | M4 — that expiry is measured against the framework's observed `renewTime`, never a member's own clock |
| `resume-late` | Cold-resume an expired owner after a new owner has claimed | M4's fencing token — the zombie writer, and the most important case in the suite |

**Assertions.** (a) The steady-state invariant is checked continuously and never violated, including
during and immediately after each fault. (b) Every expected recovery happens within twice the expiry
interval, and the elapsed time is recorded — this is where a timeout default becomes evidence rather
than taste. (c) Every unexpected state is a **test failure**, including a state that is merely "stuck
but eventually fine". (d) Each fault is run against the **control** configuration first and must be
undetectable there — a suite that cannot fail proves nothing, which is a lesson this repository has
already learned once in writing (`docs/eac-pitfalls.md:63`).

**What the prior art could not give us, and why we write this ourselves.** There is no published
fault-injection methodology for handoff atomicity, duplicate or parallel handoff, or a zombie agent
holding a lease. AWS Fault Injection Simulator has no lease- or heartbeat-specific action, and its
per-action duration caps at 12 hours with `actionsMode: run-all|skip-all`
([actions](https://docs.aws.amazon.com/fis/latest/userguide/fis-actions-reference.html),
[options](https://docs.aws.amazon.com/fis/latest/userguide/experiment-options.md)); the two academic
references are trace annotation (MAST: 14 failure modes in 3 categories,
[arXiv:2503.13657](https://arxiv.org/abs/2503.13657)) and LLM-API-layer fault injection (AgentChaos,
[arXiv:2608.06790](https://arxiv.org/abs/2608.06790)), neither of which injects at the lease. So the
mapping above is ours, and the table is the deliverable.

---

## 6. Decision

**Extend.** Concretely:

| Item | Verdict | Because |
|---|---|---|
| M1 envelope | **Build**, on the existing `team/message/*` record | The durability plane exists and is tested; only the second disposition is new |
| M2 capability registry | **Build**, sourced from `agent_context` and `team/member` | The measurement exists; only the descriptor and its matching rule are new |
| M3 `review` and failure release | **Build**, as new transitions in the existing CAS board | The board already has the revision CAS, the authorization check and the DAG; four transitions are additive |
| M4 heartbeat, lease, fencing | **Build**, with a fencing token from the first line | The upstream states the absence, the prior art states the hazard, and the token is what keeps us out of it |
| M5 fractal lease | **Build**, as a leased capability rather than a role | Every comparable system bans nesting; a lease is the smallest change that permits it safely |
| M6 external adapters | **Build**, six verbs, MCP/A2A-shaped handshake | §04's cross-device recruitment is a concrete first consumer; without M6 it has no protocol |
| Agent Teams itself | **Adopt unchanged** | It already ships the durable mailbox, the CAS board and scoped registration, and its own README documents the three gaps we are filling |

---

## 7. Things this chapter could not establish

- **The roadmap's attribution is now settled.** The first draft's three phases were the author's
  reconstruction, marked `[推断]`; the Lead then supplied the user's brief, and §4 now carries the three
  phases **verbatim** (`[外部: 用户简报]`) with the reconstruction kept beside them as the
  gap-dependency order. Nothing else in §4 changed, and no claim elsewhere in this chapter depends on
  the attribution.
- **The Lead's model-routing and context-health changes to Agent Teams are recorded only from the
  plugins' own READMEs.** `plugins/dsh-delegation-model-choice/README.md` and
  `plugins/dsh-agent-context/README.md` are the sources; I found no separate design note, and both
  plugins are **currently dismounted** (`plugins/dsh-link-mods/README.md:28`), so nothing in this
  chapter was observed running.
- **No measurement of the live team was performed.** The kernel's Agent Teams tools are present in the
  pinned checkout, but the running app was not driven (as instructed), and I did not verify that this
  deployment's composition mounts the Team packages at all — `plugins/dsh-link-mods/README.md` lists
  `dsh-agent-context` as disabled and says nothing about the Team packages' mount state. **Whether
  Agent Teams is currently active in this install is NOT ESTABLISHED.**
- **Claude Code Agent Teams' subagent-depth figures are third-party.** The depth-3 claim and the
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` variable come from blog posts, not a primary source; only the
  "no nested teams / fixed lead / one team per session" statements are from official docs.
- **No external-agent fault-injection precedent was found.** The mapping in §5 is constructed by
  applying Chaos Mesh's and Jepsen's vocabulary to our resources; it is not copied from a system that
  already tests a task board this way, and it should be reviewed as a design rather than cited as prior
  art.
- **Temporal's Schedule-To-Start default is `infinity` and "non-retryable by design"**
  ([source](https://docs.temporal.io/encyclopedia/detecting-activity-failures)); the equivalent choice
  for a claim-to-first-beat timeout is a decision this chapter deliberately leaves to the
  fault-injection results in §5 rather than fixing a number now.
