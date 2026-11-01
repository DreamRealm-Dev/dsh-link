# 04 — Device interconnect

**Chapter decision: extend.** Build both gaps on `plugins/dsh-lan-bridge`, which already ships more
of this chapter's subject than anything else in the ecosystem does. Reason: the inventory in §1 is not
a plan — it is a running, tested LAN transport with mutual consent, a permission lattice that already
intersects across hops, a relay with a provenance guard and a hop cap, and an automatic reclaim path.
The two gaps in §2 are features **on top of that**, not a second transport beside it. Proposing a new
one would discard 511 passing checks and re-solve a problem that is already solved here.

> Evidence note. The LAN bridge is a port: the plugin source and its documentation are in
> `plugins/dsh-lan-bridge/`, and its own README records that it has been verified in two directions —
> "合计 **511 项检查，0 失败**" (`README.md:75`) plus a real-host mount check
> (`README.md:76-77`). **更正（2026-10-07 实测）**：下面「未挂载」的说法在运行期不成立——`dsh-link-mods` 里那行 `disabled: true` 是**死旗**（同 id 的插件自带补丁在 bundle 顺序里更靠后，Loader 按 id 建键、后行胜出）；lan-bridge 一直在跑，5 个根层工具 `bridge_devices/bridge_connect/bridge_pair/bridge_approve/bridge_disconnect` 已实测在册，7 套套件 462 项全绿可一键复跑（`scripts/verify-interconnect.mjs`）。证据见 `docs/handoff/R3-enable-rows.md` 与 `docs/handoff/R3-interconnect.md`。
> 原文如下（保留，作为当时的判断）：「It is **dismounted** in this deployment (`plugins/dsh-link-mods/README.md:29`:
> "停用（镜像桌面版）"), so nothing below was observed running in this session.」Every claim is tagged
> `[代码可证]` against the plugin's sources and its frozen contract, or `[外部]` where the comparison is
> to another system.

---

## 1. What already exists — the inventory

### 1.1 LAN discovery and two-sided consent

> `[代码可证]` "Agent 侧自动发现设备；选择设备后 **桥接侧点同意** 即可建立信任（同意界面是右上角的
> **应用内通知卡片**，面板关着也会弹）。" — `plugins/dsh-lan-bridge/README.md:7`

Identity is a **posture, not a capability switch**, and the frozen contract says so explicitly:

> `[代码可证]` "`ROLES = ['agent', 'bridge']`. There is **no** `both`: every role is now both. …
> Identity is a *posture*, not a capability switch. Either role may hold outbound links and inbound
> sessions at the same time, and **no connection disables any other feature**. `role` and
> `discoverable` are persisted to `$DSH_HOME/lan-bridge/prefs.json` and restored on start."
> — `docs/MULTI-DEVICE-CONTRACT.md:8-21`

And `accepts` has a precise meaning that is *not* coupled to discoverability: "`accepts` is `true`
exactly while this machine is **listening** — it is *not* coupled to `discoverable`" (`:23-28`).

**Consent fails closed on the inbound side.** This is the part that makes the whole model safe, and it
is stated as a deliberate asymmetry:

> `[代码可证]` "An inbound session with no stored grant fails closed … When this machine dials a peer
> outbound it pins that peer's key and auto-confirms — which says 'I want to operate you', **not** 'you
> may operate me'. … A device with **no stored grant** therefore receives an empty, read-only,
> relay-disabled grant (it can answer `sys.info` and nothing else), and the local user is asked out of
> band through the normal request path." — `docs/MULTI-DEVICE-CONTRACT.md:176-188`

### 1.2 Multiple simultaneous devices, in both directions

> `[代码可证]` "**多设备**：可同时驱动多台设备，工具用可选的 `device` 参数区分；断一台不影响其他。"
> — `README.md:8`

The state model is three maps, and the routing rule is stated as a preference order:

> `[代码可证]` "`link` — outbound, keyed by the peer's `deviceId`. `state.links: Map`. `session` —
> inbound, keyed by the connecting peer's `deviceId`. `state.incoming: Map`. `target` — a device *this*
> machine can call, keyed by `key` … **A direct route always beats a relayed route for the same device;
> among relayed routes the shallowest wins.**" — `docs/MULTI-DEVICE-CONTRACT.md:30-39`

Target resolution is defined rather than guessed: "`resolveTarget` matches `key`, `deviceId`, exact
`name`, then a case-insensitive substring of `name`. With exactly one target the argument may be
omitted; with several, omitting it is an error that lists them." (`:155-157`)

### 1.3 The relay: A to B to C, with the minimum over two hops

> `[代码可证]` "**中转**：A 连 B、B 连 C，则 A 能直接调用 C 的工具，**权限取两跳的最小值**（能力取
> 交集、上限取更小、目录用远端那台）。每个节点都追加 `$relay.path` 防环，跳数上限默认 3。"
> — `README.md:9`

The intersection is defined field by field, and the reason directories come from the far side is
stated rather than left implicit:

> `[代码可证]` "`grant` is already the **effective** grant for the asking peer … `kind: 'relay'` →
> `intersectGrants(peerGrantHere, thisGrantThere)`. `intersectGrants` conjoins `write`/`shell`/
> `createDirs`, takes the smaller `timeoutMs`/`maxOutputBytes`, and takes the **far side's**
> `roots`/`cwdRoot` (roots name paths on the far machine; the near side's roots are meaningless there,
> so they can only narrow, never widen)." — `docs/MULTI-DEVICE-CONTRACT.md:51-59`

The provenance guard, and an explicit statement of what it is *not*:

> `[代码可证]` "A relayed target is addressed by suffixing the op with its key: `read` becomes
> `read@<deviceId>` … Every hop appends its own `deviceId` before forwarding. Every hop (including the
> last) refuses when it finds itself already in `path` (`relay-loop`) or when `path.length + 1 > maxHops` (`relay-limit`). `$relay` is stripped before any executor sees the args. … Timeouts are
> narrowed at every hop."
> — `docs/MULTI-DEVICE-CONTRACT.md:65-91`
>
> `[代码可证]` "**`$relay.path` is provenance, not authentication.** A caller controls its own entry in
> `$relay.path`, so a hop can omit itself and the chain will not notice. That is a deliberate, measured
> property, not an oversight: it cannot **amplify** … it cannot **extend** the chain … it cannot
> **widen** permission: every hop re-resolves the target against its own grant and recomputes the
> effective grant itself, so hiding a hop grants nothing." — `docs/MULTI-DEVICE-CONTRACT.md:159-174`

Error codes a caller can see are a closed set: `unknown-device`, `peer-offline`, `relay-loop`,
`relay-limit`, `relay-failed` (`:90-91`).

### 1.4 Half the tool plane is data, half is control

> `[代码可证]` "Two independent triggers, so the catalog never churns on an unrelated change:
> **data** — trigger `snapshot().toolsAvailable` (at least one reachable target) — tools
> `bridge_status`, `bridge_fs_list`, `bridge_fs_read`, `bridge_fs_write`, `bridge_fs_edit`,
> `bridge_shell`. **control** — trigger `snapshot().controlTools` — tools `bridge_devices`,
> `bridge_connect`, `bridge_pair`, `bridge_approve`, `bridge_disconnect`."
> — `docs/MULTI-DEVICE-CONTRACT.md:190-204`

> `[代码可证]` "连接后 Agent 侧自动解锁 6 个远程工具（标准 / PTC / 创造 / 极简模式都会出现，因为工具注册在
> 宿主平面），另有 5 个控制面工具在桥接「在用」时出现。" — `README.md:10`

The six data-plane capabilities are `fs.list`, `fs.read`, `fs.write`, `fs.edit`, `shell.exec`,
`sys.info` (`docs/ARCHITECTURE.md:129`). `controlTools` is `config.controlTools` of
`'auto' | 'always' | 'never'`, default `'auto'`, "true while the bridge is in play — role is `bridge`,
a pairing window is open, a request is pending, a link or session exists, or a peer is visible on the
LAN" (`MULTI-DEVICE-CONTRACT.md:201-204`).

The five control tools are the **entire UI in headless mode**, which is worth noting because it means
they are already designed as a complete surface rather than as helpers:

> `[代码可证]` "没有面板时，那 5 个控制面工具就是全部界面（`bridge_pair` 取码、`bridge_devices` 看请求、
> `bridge_approve` 同意），宿主日志也会大声打印请求与安全码。" — `README.md:12`

### 1.5 Automatic tool reclaim on disconnect

> `[代码可证]` "**断连自动回收工具**：会话上下文保留、无需重开对话、本地工具不受影响。" — `README.md:11`
>
> `[代码可证]` "任何一侧断开 → 只回收受影响的链路；**最后一台设备消失时**才 dispose 数据面工具（会话
> 历史保留，可继续用本地工具）。控制面工具按 `controlTools` 策略保留。" — `docs/ARCHITECTURE.md:96`

The behavioural claim is pinned by an existing test file: `test/reclaim.mjs`, "36 项（0/1/多设备下的注册与
回收、授权刷新不抖动、飞行中的调用干净失败）" (`README.md:65`).

**This is the single most reusable mechanism in the plugin for §03's M6.** A remote member that
disconnects must have its tools withdrawn and its calls failed cleanly — the LAN bridge already does
exactly that, and already tests the 0-device, 1-device and many-device cases plus in-flight calls.

### 1.6 The security stack, as one line

> `[代码可证]` "Ed25519 长期身份 + X25519 临时密钥 + **SPAKE2 配对**（不存在针对 6 位配对码的离线爆破）
> + AES-256-GCM 会话 + 重放窗口 + TOFU 钉扎 + 路径规范化 + 桥接侧可撤销授权 + 中转取最小权限 +
> 审计日志。" — `README.md:15`

Zero runtime dependencies — "只用 Node 内置模块" (`README.md:14`) — which matters because it means the
transport can be reused by a plugin without adding a dependency edge to this project's tree.

### 1.7 The contract is frozen, and that is a resource

`docs/MULTI-DEVICE-CONTRACT.md` opens by saying what it is for: "This is the contract every half of
the plugin is written against in this round. The host implementation in `lib/core/service.js` is the
source of truth; this document is the agreed shape so the tools, the RPC surface and the browser panel
can be written in parallel without guessing." (`:3-6`)

It declares `service.snapshot()` v2 in full — including the compatibility aliases kept so "an older
panel bundle still renders" (`:118-122`) — and it lists which service methods are unchanged versus
changed (`:128-153`). Both gaps below are **additions to that contract**, and both should be written
into it before any code, by the same rule the document itself states.

### 1.8 Limits the plugin states about itself

> `[代码可证]` `README.md:87-91`: "**未在真实 macOS 上运行过**（本机没有 Mac）… 大文件与长输出是「上限
> 截断」，暂无流式分块。同一台机器上跑两个实例时，第二个实例的 TCP 端口会退让到随机端口（发现报文会广播
> 真实端口）。"

The no-streaming limit is the one that constrains G1 below: a cross-device session read that a user
scrolls through is exactly the "large result" case the plugin does not stream.

---

## 2. The two gaps

### G1 — Cross-device session continuation

**What it means.** Device A manages a session that **lives on device B**. Read-only first: A can list
B's sessions and read one's transcript. A write — a prompt, a rename, a cancel — is **confirmed on B**
before it takes effect.

**Why the current plugin cannot do it.** It is a **file and shell** transport. Its six data-plane
capabilities are `fs.list`, `fs.read`, `fs.write`, `fs.edit`, `shell.exec` and `sys.info`
(`docs/ARCHITECTURE.md:129`). There is no session capability of any kind: nothing lists sessions,
nothing pages a transcript, nothing addresses a session by id. A session is not a file, and reaching it
by reading B's `$DSH_HOME` through `bridge_fs_read` would be both wrong (it bypasses B's own access
rules, its store format, and its projections) and unsafe (it would hand A the ability to read every
other session and the credentials beside them).

**Design.** A new **capability pair** on the existing grant, not a new transport:

| Capability op | Grant field | Semantics |
|---|---|---|
| `session.list` | `sessions.list` | enumerate B's sessions — id, title, updatedAt, running, cwd |
| `session.page` | `sessions.read` | page one session's records, bounded by `maxOutputBytes` |
| `session.prompt` | `sessions.write` | submit a prompt; **requires a confirmation on B** |
| `session.cancel` | `sessions.write` | cancel a turn; requires the same confirmation |

Four rules:

1. **The grant fields are new and default to false.** An existing grant — including every grant already
   persisted in a user's `prefs`/trust store — therefore yields **no session access at all** after the
   upgrade. `normalizeGrant` already "drop[s] unknown keys and clamp[s] numbers so a persisted grant
   cannot be poisoned" (`MULTI-DEVICE-CONTRACT.md:246`), so adding fields is safe in both directions:
   old grants gain nothing, and a peer that does not know the field cannot ask for it.
2. **Read-only first is enforced by the grant shape, not by a mode flag.** `sessions.list` and
   `sessions.read` are independent booleans from `sessions.write`; there is no state in which a
   read-only peer can reach a write op.
3. **A write is confirmed on B.** This is the rule the brief states and it is also what makes the
   feature honest: B is where the session lives, B is where the human is, and B's approval is the only
   thing that can turn "A asked" into "the session moved". The confirmation reuses the **existing**
   request path — the same in-app notification card the pairing flow uses (`README.md:7`) — so there
   is one approval surface in the product, not two.
4. **The transcript rides the existing envelope rules.** A page is a bounded response truncated at
   `maxOutputBytes` (default 512 KiB — `lib/core/policy.js:122`), and G1 explicitly does **not** add
   streaming. If a transcript does not fit, the caller pages; that is the same answer the file tools
   give today.

**The one new failure mode G1 introduces, and its answer.** A session read is a *sequence*, unlike a
file read; two devices may hold different views of a live session. The answer is not to synchronise
but to **label**: every page carries `asOfSeq` from B's own projection, and A's view is defined as
"whatever B said at that sequence". This reuses a vocabulary the kernel already has — `session/page`
answers with `{records, hasMore}` and `session/projections` with `{asOfSeq, values}` (`GOAL.md:102-103`)
— so a reader of A's transcript sees the same field names as a reader of the local one.

**Acceptance for G1.** (a) With `sessions.read` granted and `sessions.write` withheld, A lists and
pages a live session on B and every write op is refused with `not-granted` and a reason naming the
missing field. (b) With `sessions.write` granted, a prompt from A does not reach B's session until B
confirms, and a declined confirmation leaves B's session byte-identical. (c) A page larger than
`maxOutputBytes` is truncated with `hasMore: true` and the caller can continue from `asOfSeq`.
(d) Disconnecting B mid-page fails the in-flight call cleanly and withdraws the session tools on A,
by the same reclaim path `test/reclaim.mjs` already covers.

### G2 — Cross-device team recruitment

**What it means.** An agent on device B joins A's Team and appears in A's capability registry (§03
M2). It then claims tasks, beats, and returns results like any other member.

**Why the current plugin cannot do it.** Two independent reasons, and both must be fixed:

1. **There is no agent-level vocabulary.** The bridge's capabilities are file and shell ops; §03 M6's
   six verbs (`hello`, `capabilities`, `claim`, `beat`, `result`, `message`) do not exist anywhere in
   the plugin.
2. **The upstream does not support it either.** §03 §1.6 quotes the kernel: "Avoid it when … **when
   several processes must coordinate over one team** … none of those are supported"
   (`agent-team/README.md:32`). So G2 is not a plugin-side addition alone — it needs §03's M6 adapter,
   and the plugin supplies the transport underneath it.

**Design.** Three layers, each already partly present:

| Layer | Provided by | Status |
|---|---|---|
| Transport, identity, pairing, relay, hop cap | `dsh-lan-bridge` | **exists** |
| The six verbs, the handshake, the lease/board semantics | §03 M6 plus M4 | **specified, not built** |
| The Team-side record: a remote member as a roster row | §03 M2 | **specified, not built** |

Reuse, stated so nobody rebuilds it:

- **The `$relay.path` guard and the hop cap apply unchanged.** A recruited agent on a *relayed* device
  must be addressable through the same chain, and the loop guard must see the same `path` — otherwise
  a team could be recruited through itself.
- **The reclaim path applies unchanged.** When B disconnects, its member must leave the roster the same
  way its tools leave the catalog: `test/reclaim.mjs`'s three cases (0, 1 and many devices, plus an
  in-flight call) become "0, 1 and many remote members, plus a member mid-turn".
- **`intersectGrants` applies to the recruitment.** A remote member inherits the intersecting grant of
  every hop to it, which is exactly what makes "the sandbox is the slave device's" true for free (§4).
- **The inbound-fails-closed rule applies to the first `hello`.** A device with no stored grant
  receives "an empty, read-only, relay-disabled grant (it can answer `sys.info` and nothing else)"
  (`MULTI-DEVICE-CONTRACT.md:183-185`) — so a recruited agent arrives with no capability until a human
  on B grants it. That is the correct default and it needs no new code.

**Acceptance for G2.** (a) An agent on B completes `hello → capabilities → claim → beat twice → result(submit)` and appears in A's `list_agents` with its descriptor, its device id, and its route.
(b) B's human grant is the ceiling: revoking `shell` on B while a remote member holds a claimed task
fails that member's next `shell.exec` and nothing else. (c) B disconnecting removes the member from
A's roster and releases its claimed task through §03 M3's `fail` transition — asserted together, since
they are one event. (d) A relayed recruitment (A to B to C) is addressable, honours the hop cap, and
refuses a `path` cycle with `relay-loop`.

---

## 3. The permission lattice

Two gaps add session and agent capabilities to a plugin whose permission model is already a lattice.
The lattice must be written down before either gap is built, because both gaps add rows to it.

**The ordering.** `read ⊂ write ⊂ exec`. As a grant object, the three fields are independent booleans —
`read` is implicit (a grant exists at all), `write` is `grant.write === true`, `exec` is
`grant.shell === true` — and the containment is enforced at the *operation*, not by the shape:

> `[代码可证]` `plugins/dsh-lan-bridge/lib/core/policy.js:165-166`: `if (forWrite && grant.write !== true)`
> returns a refusal carrying the code `not-granted` and the reason "this peer has read-only access; the
> bridge side must grant write access".
>
> `[代码可证]` `plugins/dsh-lan-bridge/lib/core/policy.js:193-198`: `if (grant === undefined || grant === null || grant.shell !== true)`
> refuses, with the reason "this peer has no shell grant; the bridge side must enable shell access for
> it in the 连接 panel".

**The five fields that make up a grant**, from `policy.js:229-241` (the default offered in the approval
UI) and `policy.js:246-270` (the normaliser): `write`, `shell`, `createDirs`, `roots`, `cwdRoot`,
`relay`, `relayPeers`, `timeoutMs`, `maxOutputBytes`. Plus the read-only baseline established by the
absence of a stored grant (`MULTI-DEVICE-CONTRACT.md:183-185`).

**The intersection is a meet, not a filter**, and it is already written:

| Component | Combination | Source |
|---|---|---|
| `write`, `shell`, `createDirs` | conjunction (so the lattice is a meet on a boolean lattice) | `MULTI-DEVICE-CONTRACT.md:56` |
| `timeoutMs`, `maxOutputBytes` | minimum | `:57` |
| `roots`, `cwdRoot` | the **far side's** only — the near side can narrow, never widen | `:57-59` |
| `relay`, `relayPeers` | gated by the near grant's flag and allowlist | `:61-63` |

The prior art for "a constraint at hop *n* binds every downstream hop and can only narrow" is exactly
this pattern, twice over: X.509 name constraints — "The name constraints extension … indicates a name
space within which **all subject names in subsequent certificates in a certification path MUST be
located**" ([RFC 5280 §4.2.1.10](https://www.rfc-editor.org/rfc/rfc5280.html#section-4.2.1.10)) — and
the Linux capability bounding set, where "the capability **bounding set is ANDed with** the file
permitted capability set, and the result … is assigned to the thread's permitted capability set"
([capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)). `intersectGrants` is
the same calculus with path roots carried from the far side, which is the one place our lattice differs
from both: a path root is only meaningful on the machine that holds the path.

**Where `session.*` and `agent.*` sit.** They are additions to the *same* lattice, not a second one:

| New field | Ordering | Intersects by | Containment |
|---|---|---|---|
| `sessions.list` | below `sessions.read` | conjunction | a device that may list but not read is a valid, useful grant (a session picker on A, no content) |
| `sessions.read` | below `sessions.write` | conjunction | reading a transcript requires no confirmation; writing does (G1 rule 3) |
| `sessions.write` | peers with `write` | conjunction | it is a write, and it is confirmed on B |
| `team.join` | peers with `write` | conjunction | a remote member with no write grant may claim and report, never execute |

**The rule that makes the lattice testable, stated once:** *every* new field defaults to `false`, is
intersected by conjunction, and is checked at the operation that uses it — never at the routing layer,
because "Schema omission, prompt filtering, facades, wrappers, and listener order are not enforcement
when direct or alternate callers can bypass them; test denial through the executor"
(`core/deepseek-harness/packages/AGENTS.md`).

---

## 4. The sandbox is always the slave device's

This is a one-line rule with large consequences, and the plugin's architecture already makes it true.

> **The sandbox is the slave device's.** An operation executes under the effective sandbox of the
> machine that *performs* it — the far side — and never under the requester's. A permissive sandbox on
> A does not loosen anything on B; a strict sandbox on B binds every operation A requests, including
> ones A would be allowed to run locally.

Three mechanisms already enforce this, and both gaps must inherit all three rather than each inventing
a version:

1. **The path fence is resolved on the far side.** `resolveFsPath` refuses a path outside
   `grant.roots`, computed from `grant.cwdRoot` and canonicalised *there*
   (`lib/core/policy.js:157-180`). The requester's view of the filesystem never participates.
2. **The approval decision is the far side's.** "权限设置继续生效并继承：完全访问直接执行，否则走 DSH 审批；
   `never` 策略下返回可读的拒绝原因，绝不静默绕过。" (`README.md:13`). The far side's policy — including a
   `never` policy — is terminal, and the refusal is a readable reason rather than a silent bypass.
3. **Grants are revocable from the far side.** "桥接侧可撤销授权" (`README.md:15`); the service exposes
   `revokeGrant` and `setGrant` (`MULTI-DEVICE-CONTRACT.md:130-133`), and the panel gives "per-device
   grant editing" (`:228`).

**Corollary for the two gaps.** G1's `session.write` confirmation belongs on B (§2, G1 rule 3) because
B is the slave device for that session; G2's remote member executes under B's sandbox for the same
reason, and this is precisely what `intersectGrants` already yields over a relay — the effective grant
is the intersection along the whole path, so a relay can only tighten.

---

## 5. Acceptance — the permission-lattice enumeration test

The LAN bridge already has eight self-test suites totalling 511 checks
(`README.md:42-75`), and two of them are the direct model for what §04 needs: `test/relay-three-host.mjs`
(88 checks — "A→B→C 真实握手，权限取两跳最小值，min 上限，目录取远端") and `test/relay-safety.mjs`
(121 checks — "A→B→A 与 A→B→C→A 防环、跳数上限、伪造 op 后缀、relayPeers、取消传播、子树被杀干净、
跳数不塌缩"). Those two cover the *relay* lattice. Neither covers the new fields, so the acceptance bar
for §04 is an **enumeration** test, not a spot-check suite.

**The enumeration.** For a path of *n* hops, enumerate every grant assignment and assert the effective
grant equals the meet. The cases, by growing path length:

| Path | Enumerate | Assert |
|---|---|---|
| A→B (1 hop) | all combinations of `read`, `write`, `shell`, `sessions.list`, `sessions.read`, `sessions.write`, `team.join` on B's grant to A | the effective grant equals B's grant; every withheld op is refused with `not-granted` |
| A→B→C (2 hops) | all combinations on *both* hops (2^7 × 2^7 with the booleans, sampled exhaustively at a smaller field count and pair-wise at the full count) | effective = `intersectGrants(grantAtoB, grantBtoC)`; the **roots are C's**; `timeoutMs` and `maxOutputBytes` are the smaller of the two |
| A→B→C→D (3 hops) | the boundary: `path.length + 1 > maxHops` | the third hop is refused with `relay-limit`, and the default cap is 3 |
| A→B→A and A→B→C→A | the cycle cases | refused with `relay-loop` at the hop that finds itself in `path` |

**The three assertions that make it an enumeration rather than a smoke test:**

1. **Exhaustiveness is asserted, not assumed.** The test computes the expected matrix from
   `intersectGrants` itself and fails if the executed matrix differs in **any** cell — including cells
   where the answer is "both grant it, so it works". A lattice test that only checks refusals cannot
   detect a field that silently widened.
2. **Directories come from the remote side, proved by construction.** Give A a root that exists only
   on A (`/tmp/only-on-a`) and C a root that exists only on C. Assert: a read of A's root through the
   A→B→C path is refused, and a read of C's root succeeds. This is the assertion that would fail if
   `roots` were ever combined by union instead of by taking the far side.
3. **The refusal is read from the executor, not from the router.** Each denied op is asserted to fail
   **at the point of execution** with the plugin's own `not-granted` code and reason
   (`policy.js:165-166`, `:193-198`) — the repo rule quoted in §3 — so a future routing shortcut cannot
   pass the test.

**Plus the reclaim half, which is the reason this chapter can reuse `test/reclaim.mjs`.** The §04 suite
extends that file's three cases (0, 1 and many devices, plus an in-flight call) to the new capability
fields, and adds the two cross-device cases the two gaps introduce: a session page in flight when B
disconnects, and a remote member mid-turn when B disconnects.

**Acceptance bar for §04:** the enumeration matrix complete with zero mismatched cells; the
remote-directory assertion passing in both directions; every refusal carrying the plugin's own code and
reason; and the extended reclaim cases green. A suite that does not run the 1-hop and 3-hop boundary
cases is incomplete, by the same rule §03's phase 2 follows.

---

## 6. Decision

**Extend.** Concretely:

| Item | Verdict | Because |
|---|---|---|
| The transport (discovery, pairing, encryption, relay, hop cap) | **Extend** | It exists, it is tested (511 checks), it is zero-dependency, and it is Rust-free — nothing about it needs replacing |
| Multi-device targeting and the `device` parameter | **Adopt unchanged** | Already supports many devices in both directions with per-device independence |
| The reclaim path | **Adopt unchanged, and reuse it for §03 M6** | It is the only tested implementation of "a remote member left, withdraw its tools and fail its calls cleanly" that this project has |
| G1 cross-device session continuation | **Build**, as new grant fields (`sessions.list/read/write`), read-only first, write confirmed on B | A session is not a file; reaching it through `bridge_fs_read` would bypass B's own rules and expose everything beside it |
| G2 cross-device team recruitment | **Build**, on §03's M6 verbs, over this transport | The transport is done; what is missing is the vocabulary, and that belongs to §03, not here |
| The permission lattice | **Extend**, with the new fields defaulting to false and intersecting by conjunction | The meet already exists and is already field-by-field; the new fields are rows in it, not a second model |
| The sandbox | **Adopt the existing rule explicitly: always the slave device's** | Three mechanisms already enforce it, and `intersectGrants` makes it hold over a relay for free |

---

## 7. Things this chapter could not establish

- **The LAN bridge is dismounted in this deployment** (`plugins/dsh-link-mods/README.md:29`), so
  nothing in §1 was observed running here. The 511-check figure and the real-host mount result are
  quoted from the plugin's own README (`README.md:75-77`), not re-run. **Whether the plugin currently
  functions in this install is NOT ESTABLISHED.**
- **The permission lattice was not exercised.** `intersectGrants` is documented in the frozen contract
  (`docs/MULTI-DEVICE-CONTRACT.md:51-59`) and referenced from `lib/core/policy.js`, but I did not read
  its implementation, and I did not run `test/relay-three-host.mjs`. The lattice in §3 is reconstructed
  from the contract's prose plus the two policy checks I did read.
- **The `sessions.*` and `team.join` grant fields do not exist** anywhere in the plugin or the kernel;
  they are this chapter's proposal. Their names are chosen to match the plugin's existing `fs.*` and
  `shell.exec` capabilities and the kernel's `session/list` and `session/page` endpoints, but no
  upstream precedent fixes them.
- **No cross-device session protocol exists to compare against.** I found no prior art for "device A
  manages a session that lives on device B" — the closest analogues are remote-control surfaces and
  SSH-style session forwarding, and neither matches a session that is itself an agent turn. §2's design
  is therefore first-principles and should be reviewed as such.
- **Whether B's session store is safe to read page-by-page over a bridge was not verified.** §2 G1
  reuses the kernel's `session/page` `{records, hasMore}` shape (`GOAL.md:102-103`) because it is the
  documented contract, but I did not confirm that a paged read of a **live, mid-turn** session returns
  a consistent `asOfSeq` in this kernel version. If it does not, G1's "label, do not synchronise" rule
  needs a different anchor.
- **The relay hop cap's enforcement was read from the contract, not the code.** The clause "`path.length + 1 > maxHops` … a crafted `maxHops` is clamped to the ceiling" (`MULTI-DEVICE-CONTRACT.md:169`) is quoted;
  `lib/core/relay`-side clamping was not inspected.
