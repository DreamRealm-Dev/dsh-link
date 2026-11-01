# Multi-device, relay and identity — frozen interface contract

This is the contract every half of the plugin is written against in this round.
The host implementation in `lib/core/service.js` is the source of truth; this
document is the agreed shape so the tools, the RPC surface and the browser panel
can be written in parallel without guessing.

## 1. Identity

`ROLES = ['agent', 'bridge']`. There is **no** `both`: every role is now both.

| role | eager listener | eager pairing window | announce `accepts` |
|---|---|---|---|
| `agent` (default) | no | no | `false` until a pairing window is opened |
| `bridge` | yes | yes | `true` |

Identity is a *posture*, not a capability switch. Either role may hold outbound
links and inbound sessions at the same time, and **no connection disables any
other feature**. `role` and `discoverable` are persisted to
`$DSH_HOME/lan-bridge/prefs.json` and restored on start; `config.role` /
`config.discoverable` win over the stored value when present.

`accepts` is `true` exactly while this machine is **listening** — it is *not*
coupled to `discoverable`. `discoverable` only decides whether this machine
announces itself on the LAN; a machine can be reachable at a handed-out address
without advertising. Opening a pairing window in *either* role starts the
listener, and switching to `agent` closes the window (and with it the listener)
without evicting live sessions.

## 2. Devices

- **link** — outbound, keyed by the peer's `deviceId`. `state.links: Map`.
- **session** — inbound, keyed by the connecting peer's `deviceId`. `state.incoming: Map`.
- **target** — a device *this* machine can call, keyed by `key` (= the target's
  `deviceId`). Built from what each connected peer advertises about itself and
  its own relays.

A direct route always beats a relayed route for the same device; among relayed
routes the shallowest wins.

## 3. Relay

Every machine answers `sys.info/devices` with what it exposes to *that* peer:

```js
{ devices: [ { key, kind: 'local'|'relay', deviceId, name, os, arch, hops, path, grant } ],
  self:    { deviceId, name, role },
  relay:   { maxHops, supported } }
```

`grant` is already the **effective** grant for the asking peer:

- `kind: 'local'` → that peer's grant on this machine, unchanged.
- `kind: 'relay'` → `intersectGrants(peerGrantHere, thisGrantThere)`.

`intersectGrants` conjoins `write`/`shell`/`createDirs`, takes the smaller
`timeoutMs`/`maxOutputBytes`, and takes the **far side's** `roots`/`cwdRoot`
(roots name paths on the far machine; the near side's roots are meaningless
there, so they can only narrow, never widen).

Relaying is gated by the near grant's `relay` flag (default `true`) and its
`relayPeers` allowlist (empty = every device). Both are part of the grant shape
in `lib/core/policy.js`.

### 3b. Effective grant and executability

The `grant` above answers "what may this peer reach"; it does not answer "will
the call run". Those two answers are produced in different places, and for
`shell` they disagree. Everything in this section is 实测 + 代码可证 — the
matrix in `scripts/verify-interconnect.mjs` (cells :309-362, verdict :371-372)
owns the numbers.

**Caller side (what the panel and `sys.info/devices` publish).**
`exposedTargets` (service.js:590-621) builds the rows a peer receives: the
`local` row carries that peer's own grant on this machine unchanged
(service.js:601, from `grantFor` service.js:317), a relayed row carries
`intersectGrants(outerGrant, target.grant)` (service.js:617). The meet is
service.js:511-527 — `write` and `shell` conjoined (service.js:521-522),
numeric limits minimised, `roots`/`cwdRoot` taken from the far side
(service.js:519-520). `snapshot().targets` (service.js:1965) hands these same
values to the panel.

**Executor side (what actually decides).** The machine that runs the call reads
its **own** grant for the peer that dialled it: service.js:872/874 pass
`live.grant` into the executor, and `record.refresh` rebuilds the executor from
the new grant (service.js:913-919). `$relay` carries no grant — the caller
writes `path` and `maxHops` only (service.js:1522), the executor never sees the
field (service.js:840), and an intermediate hop re-reads `target.grant` from its
own target list (service.js:821).

**Where they diverge.** `shell.exec` passes the authorizer on `grant.shell`
alone (exec.js:514 → policy.js:193-200), then resolves its working directory
through `resolveCwd` (exec.js:109-113) → `resolveShellCwd` (policy.js:183-190),
whose last line is `resolveFsPath(grant, inputCwd, { forWrite: true })`
(policy.js:189). With a working directory present that refuses a `write !== true`
grant with `not-granted` (policy.js:165-167), and `shellExec` substitutes
`ctx.grant.cwdRoot` when the caller passes no `cwd` (exec.js:517), so the check
runs on ordinary shell calls. `sanitizeGrant` fills `cwdRoot` from `roots[0]`
(policy.js:252), so it holds for every grant carrying a root; only the
no-cwd/no-`cwdRoot` fallback (policy.js:184-188) returns without it.

So the implementation's implication is `shell ⇒ write` **on the executing
grant**, while the caller's effective grant publishes `shell: near.shell &&
far.shell` (service.js:522) and never reads `write`. Two consequences, both
measured over the 64-cell `{write, shell, roots}` × `{write, shell, roots}`
execution matrix:

- **4 cells with `eff.shell === true` are refused**, because the executing side
  is read-only (`--strict` fails on exactly this: `expected 0, got 4`);
- **2 cells with `eff.write === false` execute shell**, because the executing
  side holds `write`.

A relayed target shows both directions at once. A direct link shows the weaker
form of the same defect inside a single grant: `shell=true, write=false` is
representable, is published, and can never execute a shell that resolves a cwd —
the effective grant there equals the executing grant and still fails to predict
the outcome. `eff.shell === true` is therefore an upper bound and
`eff.write === true` a lower bound on shell, with the refusal carrying the truth.

**What the panel shows.** The target list prints the effective value as
`生效授权 / effective grant` (client.js:2367) and states "that grant is the
minimum of both hops — the narrower side wins" (client.js:2368-2369), while
`grantSummary` renders it as `只读 · Shell 开` (client.js:922-934) — a
combination the executor refuses. Reading the panel as a capability forecast
under-reports shell in the `write`-off case and over-reports it in the
read-only-executor case; read the refusal instead. Live-app confirmation of the
operator-facing sentence: 未测 (no refusal was triggered).

**If a caller-visible equivalent price is wanted**, the smallest change that
leaves execution untouched is grant normalisation: `policy.sanitizeGrant`
(policy.js:247-272; `shell: source.shell === true` at policy.js:263) can return
`shell: write && shell`, after which no grant advertises shell that no executor
will honour and the meet is honest in both directions. The two alternatives each
move semantics: fold the executing side's `write` into the meet at
service.js:522, or drop `{ forWrite: true }` at policy.js:189 (the caller of
that path is exec.js:518) so shell runs wherever the shell flag is set.

### Wire convention

A relayed target is addressed by suffixing the op with its key:

```
read            -> this machine
read@<deviceId> -> the device with that key
```

Helpers: `parseTargetOp(op) -> { baseOp, key }`, `targetOp(baseOp, key)`.

Provenance rides in the reserved args key `$relay`:

```js
{ $relay: { path: ['<deviceId>', ...], maxHops: 3 } }
```

- Every hop appends its own `deviceId` before forwarding.
- Every hop (including the last) refuses when it finds itself already in `path`
  (`relay-loop`) or when `path.length + 1 > maxHops` (`relay-limit`).
- `$relay` is stripped before any executor sees the args.
- The op suffix is kept when the next hop is itself relayed, and dropped when the
  next hop is a direct peer. That one convention is what makes A→B→C→D compose.
- Timeouts are narrowed at every hop (`min` of hop grant, session grant, request).

Error codes a caller may see: `unknown-device`, `peer-offline`, `relay-loop`,
`relay-limit`, `relay-failed`.

## 4. `service.snapshot()` (v2)

```js
{
  role, discoverable, accepts, port, deviceId, deviceName, os, arch,
  protocolVersion, hostBuild, protocolRange, dataDir, listenError,

  peers:    [ { deviceId, name, os, arch, host, port, lastSeenMs, trusted,
                fingerprint, role, accepts, relayDevices, connected } ],
  links:    [ { deviceId, name, host, port,
                state: 'connecting'|'pairing'|'connected'|'error',
                protocolVersion, sas, trust, sinceMs, grant, relaySupported,
                devices: [ { key, deviceId, name, os, arch,
                             kind: 'direct'|'relay', hops, path, grant } ],
                reconnect: { attempts, wanted }, error } ],
  sessions: [ { deviceId, name, host, port, sinceMs, sas, grant,
                exposes: [ { key, deviceId, name, kind, hops, path, grant } ] } ],
  targets:  [ { key, deviceId, name, os, arch, kind, hops, path, grant, linkDeviceId } ],
  toolsAvailable: boolean,      // exactly `targets.length > 0`
  controlTools:  boolean,       // see §6
  relay:    { supported: true, maxHops, reachable },
  requests: [ { id, deviceId, name, os, sas, requestedCaps, defaultGrant, reason,
                createdAtMs, expiresAtMs } ],
  pairing, audit, sasHint,

  // compatibility aliases — an older panel bundle still renders:
  connection:    <first connected link | null>,
  peersConnected: <alias of sessions>,
  request:       <requests[0] | null>,
}
```

`peers[].role` is `'agent' | 'bridge' | 'unknown'` (an older peer announces
nothing). `peers[].accepts` is `false` only when the peer explicitly said so.

## 5. Service methods

Unchanged: `start`, `stop`, `onChange`, `setRole`, `setDiscoverable`, `probe`,
`disconnectPeer`, `revokeGrant`, `setGrant`, `auditTail`, `openPairingWindow`,
`closePairingWindow`, `ensureListening`, `dataDir`, `role`. `trustStore` and
`policy` are **properties**, not methods.

`onChange(listener)` calls the listener with a `snapshot()` — never with the
service's internal state.

Changed / new:

```js
connect(target, { automatic })        // ADDS a link; never replaces another
disconnect(deviceId?)                 // one device, or every link when omitted
submitPairingCode(code, { deviceId })
decideRequest({ id | deviceId, decision, grant, remember })
snapshot()                            // v2, above
connectionSnapshot(deviceId?)         // single-link view, for legacy callers
listTargets()                         // sorted, direct first
resolveTarget(device?)                // throws a readable list when ambiguous
remoteCall(cap, op, args, { device, signal, timeoutMs, toolName })
ping(device?, timeoutMs?)
selfTest({ device, path })
refreshDevices(linkRecord)
```

`resolveTarget` matches `key`, `deviceId`, exact `name`, then a case-insensitive
substring of `name`. With exactly one target the argument may be omitted; with
several, omitting it is an error that lists them.

## 5b. `$relay.path` is provenance, not authentication

A caller controls its own entry in `$relay.path`, so a hop can omit itself and
the chain will not notice. That is a deliberate, measured property, not an
oversight:

- it cannot **amplify**: each machine executes at most once per request, and an
  intermediate hop executes nothing at all — it only forwards;
- it cannot **extend** the chain: every hop still appends its own id, so
  `path.length + 1 > maxHops` binds regardless of what the caller wrote, and a
  crafted `maxHops` is clamped to the ceiling;
- it cannot **widen** permission: every hop re-resolves the target against its own
  grant and recomputes the effective grant itself, so hiding a hop grants nothing.

What the path is FOR is loop prevention and the visible "via" chain the panel
shows. The authority is the grant at each hop.

## 5c. An inbound session with no stored grant fails closed

TOFU pinning is symmetric; the decision is not. When this machine dials a peer
outbound it pins that peer's key and auto-confirms — which says "I want to
operate you", **not** "you may operate me". The peer dialling back in is
`authMode: 'trusted'`, so no approval gate runs.

A device with **no stored grant** therefore receives an empty, read-only,
relay-disabled grant (it can answer `sys.info` and nothing else), and the local
user is asked out of band through the normal request path. Anything they allow
arrives through `decideRequest`, which persists the grant and refreshes the live
session. A first pairing is unaffected: there the user's decision already
persisted the grant before the session attached.

## 6. Tool plane

Two independent triggers, so the catalog never churns on an unrelated change:

| plane | trigger | tools |
|---|---|---|
| data | `snapshot().toolsAvailable` (≥1 reachable target) | `bridge_status`, `bridge_fs_list`, `bridge_fs_read`, `bridge_fs_write`, `bridge_fs_edit`, `bridge_shell` |
| control | `snapshot().controlTools` | `bridge_devices`, `bridge_connect`, `bridge_pair`, `bridge_approve`, `bridge_disconnect` |

Data-plane tools each take an optional `device` string.

`controlTools` comes from `controlToolsVisible()`: `config.controlTools` is
`'auto' | 'always' | 'never'`, default `'auto'`, which is true while the bridge is
in play — role is `bridge`, a pairing window is open, a request is pending, a link
or session exists, or a peer is visible on the LAN.

### 极简模式 / terminal-only

极简模式 is the `minimal` agent preset (`presets/minimal/agent.cordis.yml`): a
persistent shell and nothing else, with `persona.complete: true` so no prompt
section can be added, and no runtime context. There is no browser panel and no
toast, so the five control-plane tools **are** the user interface:

```
bridge_devices     what is out there, what is connected, who is asking
bridge_connect     open a link (deviceId, or host+port, plus the pairing code)
bridge_pair        open a pairing window and read the 6-digit code
bridge_approve     answer a pending request (compare the safety code first)
bridge_disconnect  drop one device or every link
```

The host also writes every incoming request to the log, loudly and with the
safety code and the instruction for answering it, because on a headless host the
log is the only notification surface that exists.


## 7. Browser panel

The panel renders `links` and `sessions` as two lists, each with per-device grant
editing, and a relay badge on targets reached through another machine. Peers with
`accepts === false` are shown greyed out and are not connectable.

### 7b. How a refusal reaches the panel

代码可证 (the display path is determined by source; no refusal was triggered in
the live app — 未测):

- The host's two carriers answer a failed op differently. The connection RPC
  returns `{ ok: false, error: { code: 'bridge/op-failed', message } }`
  (rpc.js:328-335); the HTTP route flattens the same failure to
  `{ ok: false, error: <message string> }` (rpc.js:481).
- The client turns either shape into an `Error` carrying only the message text —
  client.js:537-540 for the HTTP route, client.js:617-624 for the connection RPC,
  where `asStr` reads `error.message` out of the object (client.js:234-240,
  object branch client.js:238). Only `carrierOk` is copied onto that Error
  (client.js:539, :623); the contract code is not a property of the error the
  panel holds.
- The panel shows the string verbatim: `run()` calls
  `store.setError(msgOf(err))` (client.js:748), `msgOf` returns `err.message`
  unchanged (client.js:223-228), and the banner renders that value as-is
  (client.js:2593-2594). Nothing on the client strips a leading
  `<code>: ` — the only `startsWith` there parses the pairing code
  (client.js:1919).
- A service refusal carries the contract code twice: the message is built as
  `<code>: <reason>` and the same value sits on `error.code`
  (service.js:1456-1460), for example
  `not-granted: the peer granted read-only access; ask its user to allow 写入`
  (service.js:1470-1479). That whole string is what the banner would print.
- It does not reach the banner today: the panel invokes `discover.set`,
  `pair.open`, `pair.submit`, `grant.set`, `grant.revoke`,
  `peers.disconnect`, `disconnect`, `connect`, `discover.probe`, `role.set`,
  `approve`, `audit.tail` and `state` (client.js:1741-3100), and none of them
  funnels into `remoteCall` — the only thrower of `refusalError`
  (service.js:1516). Its live callers are the bridge tools (tools.js:338) and
  `selfTest`, whose remote calls are wrapped by `step()` and recorded as step
  rows instead of thrown (service.js:1575-1585); the only throwing call there is
  `resolveTarget`, which reports plain prose (service.js:1430-1443).

Verdict: 可接受. If the prefix should stay out of the user interface anyway, the
single line to change is the display call `store.setError(msgOf(err))` at
client.js:748 — strip a leading `/^[a-z-]+:\s/` before setting it (or, to let
the panel branch on the code, copy `payload.error.code` onto the Error at
client.js:617-624 and :537-540). The code never arrives as a property today, so a
prefixed message is currently the only signal of which contract code fired.
