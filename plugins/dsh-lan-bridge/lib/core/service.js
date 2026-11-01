/**
 * Bridge orchestration: identity, discovery, pairing, grants, links and relay.
 *
 * One service instance owns everything stateful for a host process. It is
 * deliberately transport-agnostic about the DSH side: it exposes plain methods
 * plus a change listener, and `lib/current.js` turns those into tool
 * registrations and an HTTP/RPC surface.
 *
 * ## Identity
 *
 *   'agent'  — this machine drives others. It does NOT listen until a pairing
 *              window is opened, and it never advertises itself as connectable.
 *   'bridge' — this machine is operated by others. It listens from the start and
 *              shows a pairing code immediately.
 *
 * Identity is a *default posture*, not a capability switch. Either role may hold
 * outbound links and inbound sessions at the same time: nothing here is
 * exclusive, and connecting never disables another feature. The role decides
 * only what is opened eagerly (listener, pairing window, connectable announce)
 * and what the panel leads with.
 *
 * ## Many devices
 *
 *   links   — outbound, keyed by the peer's deviceId. One entry per device.
 *   incoming— inbound sessions, keyed by the connecting peer's deviceId.
 *
 * Both maps are unbounded by design: N devices can be driven at once and M
 * devices can drive this machine at once.
 *
 * ## Relay (A -> B -> C)
 *
 * Every machine exposes to each inbound peer a list of *targets*:
 *   - itself (`kind: 'local'`), governed by that peer's grant on this machine;
 *   - every device this machine can itself reach (`kind: 'relay'`), governed by
 *     the INTERSECTION of that peer's grant here and this machine's grant there.
 *
 * A relayed target is addressed by suffixing the op with the target's key
 * (`read@<deviceId>`), so the wire protocol needs no new message type and an
 * older peer answers `unsupported` instead of misinterpreting a call. Each hop
 * appends itself to `$relay.path`; a hop that finds itself already in the path
 * refuses, which is what makes A->B->C->A terminate.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as C from './crypto.js'
import { FrameLink, agentHandshake, createBridgeServer, DEFAULTS, FEATURES as LINK_FEATURES } from './link.js'
import { createDiscovery, DEFAULT_GROUP, DEFAULT_PORT } from './discovery.js'
import { createPolicy } from './policy.js'
import { createExecutor } from './exec.js'
import { log as rootLog } from './log.js'

/** Identity postures. There is deliberately no 'both': it is now every role. */
export const ROLES = Object.freeze(['agent', 'bridge'])
/** A fresh install listens for nobody until its user says so. */
export const DEFAULT_ROLE = 'agent'
export const PROTO = Object.freeze({ min: '0.1', max: '0.2' })
export const DEFAULT_TCP_PORT = 47654
const AUDIT_LIMIT = 300
const DISCOVERY_PROTOCOL = 'dsh-lan-bridge/1'
/** Bumped with the client build; an older host paired with a newer panel is visible. */
export const HOST_BUILD = '2026-10-04.1'

/** Reserved args key carrying relay provenance. Stripped before any executor. */
export const RELAY_FIELD = '$relay'
/** Hop ceiling for a relay chain: A->B->C->D is three hops. */
export const RELAY_MAX_HOPS = 3
const MAX_HOPS_CEILING = 8
/** How often a link re-reads the peer's target list even without a push. */
const DEVICE_REFRESH_MS = 30_000

/**
 * The capability set this application actually implements.
 *
 * This is the app's contract, not the transport library's: it is deliberately
 * narrower than link.js's `CAPABILITIES` (which also lists `process.spawn`, an
 * operation no executor here supports) and wider in one place the product needs
 * — `fs.edit` is a first-class capability because targeted edits, not whole-file
 * rewrites, are the point of a debugging bridge. Both handshake sides and the
 * discovery announce use this one list, so negotiation can never disagree with
 * what the executor will accept.
 */
export const BRIDGE_CAPABILITIES = Object.freeze([
  'sys.info',
  'fs.list',
  'fs.read',
  'fs.write',
  'fs.edit',
  'shell.exec',
])

/** The ops this implementation exposes over a session, keyed by capability. */
export const SESSION_OPS = Object.freeze([
  { cap: 'sys.info', op: 'info' },
  { cap: 'sys.info', op: 'grant' },
  { cap: 'fs.list', op: 'list' },
  { cap: 'fs.read', op: 'read' },
  { cap: 'fs.write', op: 'write' },
  { cap: 'fs.edit', op: 'edit' },
  { cap: 'shell.exec', op: 'exec' },
  { cap: 'media.capture', op: 'record' },
])

/** Additive feature flags; unknown keys are dropped by `negotiate`. */
export const FEATURES = Object.freeze({ ...LINK_FEATURES, relay: true })

/**
 * Short authentication string: a 6-digit value derived from BOTH long-term
 * public keys, so it is identical on the two machines of one session and
 * different for any machine-in-the-middle (which necessarily presents a
 * different key to each side). Comparing it out of band is what turns
 * "the bridge user clicked allow" into "the bridge user allowed THIS peer".
 */
export function sessionSas(keyA, keyB) {
  const [a, b] = [String(keyA ?? ''), String(keyB ?? '')].sort()
  const digest = C.sha256(C.lp('dsh-lan-bridge/sas/v1'), C.lp(a), C.lp(b))
  const n = digest.readUInt32BE(0) % 1_000_000
  return String(n).padStart(6, '0')
}

/** Split `read@<key>` into its base op and its target key. */
export function parseTargetOp(op) {
  const s = String(op ?? '')
  const at = s.indexOf('@')
  if (at < 0) return { baseOp: s, key: undefined }
  const key = s.slice(at + 1)
  return { baseOp: s.slice(0, at), key: key === '' ? undefined : key }
}

/** Compose the wire op for a target key. */
export function targetOp(baseOp, key) {
  return key === undefined || key === null || key === '' ? baseOp : `${baseOp}@${key}`
}

function safeMkdir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    rootLog.warn(`could not create ${dir}`, error?.message ?? error)
  }
}

/** Resolve the harness home the same way DSH does: DSH_HOME, else ~/.dsh. */
export function resolveDataDir(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home.trim() !== '' ? home : path.join(os.homedir(), '.dsh')
  return path.join(base, 'lan-bridge')
}

function deviceName() {
  try {
    return `${os.hostname()}`
  } catch {
    return 'dsh-host'
  }
}

/**
 * Bound any operation so a caller can never wait forever.
 *
 * A UI op that never settles leaves the panel spinning with no way out, so every
 * externally driven step has a hard deadline even when the underlying library
 * has its own timeouts.
 */
function raceTimeout(promise, ms, message) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
      timer.unref?.()
    }),
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

function stripRelay(args) {
  if (args === null || typeof args !== 'object' || args[RELAY_FIELD] === undefined) return args ?? {}
  const copy = { ...args }
  delete copy[RELAY_FIELD]
  return copy
}

export function createBridgeService({ ctx, config = {}, log = rootLog } = {}) {
  const dataDir = resolveDataDir(config.dataDir)
  safeMkdir(dataDir)

  // ---- persisted identity ---------------------------------------------------
  const identityFile = path.join(dataDir, 'identity.json')
  let identity
  try {
    const raw = JSON.parse(fs.readFileSync(identityFile, 'utf8'))
    if (typeof raw?.priv === 'string' && typeof raw?.pub === 'string') {
      identity = { pub: raw.pub, priv: raw.priv, fingerprint: raw.fingerprint ?? C.fingerprintOf(Buffer.from(raw.pub, 'base64url')) }
    }
  } catch {
    /* missing or unreadable: a fresh identity is generated below */
  }
  if (identity === undefined) {
    const generated = C.generateIdentity()
    identity = { pub: generated.pub, priv: generated.priv, fingerprint: generated.fingerprint }
    try {
      const tmp = `${identityFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ ...identity, createdAtMs: Date.now() }, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, identityFile)
    } catch (error) {
      log.warn('could not persist the device identity; it will change on restart', error?.message ?? error)
    }
  }

  const trustStore = new C.TrustStore({
    file: path.join(dataDir, 'trust.json'),
    identity,
    requireUserConfirm: true,
  })

  // ---- persisted preferences ------------------------------------------------
  // Role and discoverability are part of this machine's IDENTITY: a user who set
  // the Mac to 桥接侧 must still find it there after a restart, otherwise the
  // other machine silently cannot reach it any more.
  const prefsFile = path.join(dataDir, 'prefs.json')
  let prefs = {}
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8')) ?? {}
  } catch {
    prefs = {}
  }
  function savePrefs() {
    try {
      fs.writeFileSync(`${prefsFile}.tmp`, JSON.stringify({ role: state.role, discoverable: state.discoverable }, null, 2), {
        mode: 0o600,
      })
      fs.renameSync(`${prefsFile}.tmp`, prefsFile)
    } catch (error) {
      log.warn('could not persist preferences', error?.message ?? error)
    }
  }

  // ---- grants --------------------------------------------------------------
  const grantsFile = path.join(dataDir, 'grants.json')
  let grants = {}
  try {
    grants = JSON.parse(fs.readFileSync(grantsFile, 'utf8'))?.grants ?? {}
  } catch {
    grants = {}
  }

  // ---- audit ---------------------------------------------------------------
  const auditFile = path.join(dataDir, 'audit.jsonl')
  const auditRing = []
  function audit(entry) {
    const row = { tsMs: Date.now(), ...entry }
    auditRing.push(row)
    if (auditRing.length > AUDIT_LIMIT) auditRing.splice(0, auditRing.length - AUDIT_LIMIT)
    try {
      fs.appendFileSync(auditFile, `${JSON.stringify(row)}\n`, { mode: 0o600 })
    } catch {
      /* auditing must never break an operation */
    }
  }

  const policy = createPolicy({ limits: config.limits, audit })
  const executor = createExecutor({ policy, log })

  // ---- state ---------------------------------------------------------------
  const configuredRole = ROLES.includes(config.role) ? config.role : undefined
  const storedRole = ROLES.includes(prefs.role) ? prefs.role : undefined
  const state = {
    role: configuredRole ?? storedRole ?? DEFAULT_ROLE,
    discoverable: typeof config.discoverable === 'boolean' ? config.discoverable : prefs.discoverable !== false,
    deviceId: identity.fingerprint.replace(/-/g, ''),
    deviceName: deviceName(),
    port: typeof config.port === 'number' ? config.port : DEFAULT_TCP_PORT,
    /** Outbound links: peerDeviceId -> link record. Never mutually exclusive. */
    links: new Map(),
    /** Inbound sessions: peerDeviceId -> session record. */
    incoming: new Map(),
    /** deviceId -> interactive pairing request awaiting a human answer. */
    pendingRequests: new Map(),
    pairing: null, // { code, attemptsLeft, expiresAtMs }
    /**
     * Where a pairing code has to go, when a MANUAL connect asked for one (R320).
     *
     * The panel's own flow is: type host:port, press 连接, see that a code is needed, type the code, press 提交. That
     * middle step used to leave nothing behind - a manual attempt that fails with `pairing_required` never lands in
     * `state.links`, which is the only place `submitPairingCode` looked - so the panel answered "pick a device first"
     * to somebody who had just picked one (measured R316 against the real phone). Remembering the target is what
     * makes the two halves of the flow the same attempt.
     */
    manualPair: null, // { host, port, at }
    lastError: null,
    connecting: new Set(),
    started: false,
    listenError: null,
    maxHops: Number.isFinite(config.maxHops) ? Math.min(MAX_HOPS_CEILING, Math.max(1, Math.round(config.maxHops))) : RELAY_MAX_HOPS,
  }

  const listeners = new Set()
  /**
   * Notify every change listener with a SNAPSHOT, never the internal state.
   *
   * The internal `state` has no `toolsAvailable` / `controlTools` and holds live
   * Maps and sessions; handing it to a listener invited exactly one bug — a
   * listener reading a field that is not there, concluding "not available", and
   * churning the tool registry on every boot notification. The listener contract
   * is now the same plain-data view the panel and the tools already consume.
   */
  function notify() {
    if (listeners.size === 0) return
    const view = snapshot()
    for (const listener of [...listeners]) {
      try {
        listener(view)
      } catch (error) {
        log.warn('change listener failed', error?.message ?? error)
      }
    }
  }
  function onChange(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function grantFor(deviceId) {
    const stored = grants[deviceId]
    if (stored !== undefined) return policy.sanitizeGrant(stored)
    return null
  }

  function persistGrants() {
    try {
      fs.writeFileSync(`${grantsFile}.tmp`, JSON.stringify({ grants }, null, 2), { mode: 0o600 })
      fs.renameSync(`${grantsFile}.tmp`, grantsFile)
    } catch (error) {
      log.warn('could not persist grants', error?.message ?? error)
    }
  }

  function setGrantFor(deviceId, grant, { persist = true } = {}) {
    const clean = policy.sanitizeGrant(grant)
    if (persist) {
      grants[deviceId] = clean
      persistGrants()
    }
    return clean
  }

  // ---- discovery -----------------------------------------------------------
  const discovery = createDiscovery({
    identity,
    deviceId: state.deviceId,
    name: state.deviceName,
    app: DISCOVERY_PROTOCOL,
    proto: PROTO,
    caps: BRIDGE_CAPABILITIES,
    getPort: () => state.port,
    // Identity travels in the announce so a peer can grey out a machine that
    // cannot be connected to instead of offering a button that always fails.
    getRole: () => state.role,
    getAccepts: () => acceptsInbound(),
    getRelay: () => ({ enabled: true, maxHops: state.maxHops, devices: relayTargets().size }),
    log: log.child('discovery'),
    onPeer: () => notify(),
    onLost: () => notify(),
  })

  // ---- pairing window ------------------------------------------------------
  const pairingGuard = new C.PairingGuard({ maxAttempts: 5, lockoutMs: 60_000 })
  const pairingWindowMs = 10 * 60 * 1000

  /**
   * Make sure this machine is actually accepting.
   *
   * An `agent`-posture machine is not listening, so opening a pairing window on
   * it must start the listener — a code with nothing behind it is the exact
   * failure mode where the user types a correct code and still gets a timeout.
   */
  async function ensureListening() {
    await startListener()
    notify()
    return { port: state.port, accepts: acceptsInbound() }
  }

  function openPairingWindow(force = false) {
    if (
      !force &&
      state.pairing !== null &&
      state.pairing.expiresAtMs > Date.now() &&
      state.pairing.attemptsLeft > 0
    ) {
      return state.pairing
    }
    if (pairingGuard.lockedOut) {
      throw new Error(`too many failed pairing attempts; retry in ${Math.ceil((pairingGuard.lockRemainingMs ?? 0) / 1000)} s`)
    }
    const code = C.generatePairingCode({ digits: 6 })
    // The guard owns single-use semantics: opening a window invalidates any
    // previous one, so a leaked code cannot be replayed after a failure.
    const window = pairingGuard.openWindow({ code, context: 'dsh-lan-bridge' })
    bridgeOpts.pairing = window
    state.pairing = {
      code,
      pairId: window.pairId,
      attemptsLeft: typeof window.attemptsLeft === 'number' ? window.attemptsLeft : 5,
      expiresAtMs: typeof window.expiresAt === 'number' ? window.expiresAt : Date.now() + pairingWindowMs,
      openedAtMs: Date.now(),
    }
    log.info(`pairing window open — code ${code} (valid ${Math.round(pairingWindowMs / 60000)} min)`)
    // Opening a window is the user saying "I accept a connection now", which is
    // what a non-bridge posture requires before anything can reach this machine.
    void ensureListening().catch((error) => log.warn('could not start the listener for the pairing window', error?.message ?? error))
    notify()
    return state.pairing
  }

  function closePairingWindow(reason) {
    pairingGuard.closeWindow(reason)
    bridgeOpts.pairing = null
    // Only a 桥接侧 posture keeps listening on its own; anything else stops
    // accepting new connections the moment the window closes. Live sessions are
    // untouched — this closes the door, it does not evict the guests.
    if (state.role !== 'bridge') stopListener()
    if (state.pairing === null) return
    state.pairing = null
    log.info(`pairing window closed (${reason})`)
    notify()
  }

  /** The live opts object handed to `createBridgeServer`; mutated per connection. */
  const bridgeOpts = {
    identity,
    deviceId: state.deviceId,
    name: state.deviceName,
    app: DISCOVERY_PROTOCOL,
    caps: BRIDGE_CAPABILITIES,
    features: FEATURES,
    proto: PROTO,
    trustStore,
    pairing: null,
    requireUserConfirm: true,
    confirmPeer: async (info) => requestUserApproval(info),
    onSession: (session, peer) => attachBridgeSession(session, peer),
    // The bridge handshake WAITS FOR A HUMAN when a new device asks to pair, so
    // the library default (10 s per awaited frame) is far too tight to find the
    // mouse. This is the ceiling for the whole handshake, approval card included.
    timeoutMs: 150_000,
  }

  /**
   * The bridge user's gate. Resolves when the panel answers 同意/拒绝.
   * Called from inside the handshake, so a rejection aborts the handshake.
   *
   * Several devices may ask at the same time — each request is its own entry in
   * `state.pendingRequests`, so one slow human decision never blocks another
   * machine's handshake.
   */
  function requestUserApproval(info) {
    const deviceId = info.deviceId ?? ''
    const sas = sessionSas(identity.pub, info.pubKey ?? '')
    return new Promise((resolve) => {
      const existing = state.pendingRequests.get(deviceId)
      if (existing !== undefined) existing.answer(false)
      const id = randomUUID()
      const request = {
        id,
        deviceId,
        name: info.name ?? deviceId,
        os: info.os ?? '?',
        fingerprint: info.fingerprint ?? '',
        sas,
        requestedCaps: [...BRIDGE_CAPABILITIES],
        defaultGrant: grantFor(deviceId) ?? policy.defaultGrant({ workspaceRoot: defaultWorkspaceRoot() }),
        reason: info.reason ?? 'new-peer',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 120_000,
        answer: (decision) => {
          const current = state.pendingRequests.get(deviceId)
          if (current !== undefined && current.id === id) state.pendingRequests.delete(deviceId)
          notify()
          resolve(decision)
        },
      }
      state.pendingRequests.set(deviceId, request)
      // 极简模式 / a headless host has no panel and no toast. The log IS the
      // notification surface there, so an incoming request is announced loudly
      // and with everything the human needs to decide — including how to answer.
      log.warn(
        `连接请求：${request.name}（${deviceId}）安全码 ${sas} —— ` +
          '核对两端安全码一致后在「连接」面板点同意；仅终端时请让 Agent 调用 bridge_approve。',
      )
      notify()
      // An unanswered request must not hold the socket forever.
      setTimeout(() => request.answer(false), 120_000).unref?.()
    })
  }

  function defaultWorkspaceRoot() {
    const cwd = ctx?.get?.('workspaceRegistry')
    try {
      const first = cwd?.list?.()?.[0]
      if (typeof first?.path === 'string' && first.path !== '') return first.path
    } catch {
      /* registry absent in this profile */
    }
    return process.cwd()
  }

  // ---- grant arithmetic ----------------------------------------------------
  /**
   * The grant that governs a relayed operation: the minimum of the two grants.
   *
   * Flags are conjoined (a capability needs both sides to allow it), numeric
   * limits take the smaller value, and the ROOTS come from the far side because
   * they name paths on the far machine — the near side's roots name paths here
   * and mean nothing there. That asymmetry is the whole point: the near side can
   * only ever narrow the far side's grant, never widen it.
   */
  function intersectGrants(outer, inner) {
    const far = inner ?? {}
    const near = outer ?? {}
    const minNum = (a, b, fallback) => {
      const values = [a, b].filter((v) => typeof v === 'number' && Number.isFinite(v))
      return values.length === 0 ? fallback : Math.min(...values)
    }
    return policy.sanitizeGrant({
      roots: Array.isArray(far.roots) ? far.roots : [],
      cwdRoot: far.cwdRoot,
      write: near.write === true && far.write === true,
      shell: near.shell === true && far.shell === true,
      createDirs: near.createDirs === true && far.createDirs === true,
      timeoutMs: minNum(near.timeoutMs, far.timeoutMs, policy.limits.defaultTimeoutMs),
      maxOutputBytes: minNum(near.maxOutputBytes, far.maxOutputBytes, policy.limits.maxOutputBytes),
    })
  }

  // ---- target registry -----------------------------------------------------
  /**
   * Devices THIS machine can call, keyed by target key (the device id).
   *
   * Built from what each connected peer advertises about itself and its own
   * relays. A direct route always wins over a relayed one for the same device,
   * and a shallower relay wins over a deeper one, so the effective permission is
   * the widest the topology honestly supports.
   */
  function relayTargets() {
    const out = new Map()
    for (const [linkDeviceId, link] of state.links) {
      if (link.state !== 'connected' || link.session === undefined) continue
      // R321: a peer that advertises NOTHING is still a peer. The Android app implements fs.read/fs.list itself and
      // answers `sys.info` with a reserved refusal, so its `devices` list stays empty - and this machine then said "no
      // device is reachable. Open the sidebar 连接 panel and connect to a peer first" WHILE a session was up, with
      // self-test and every tool refusing to run. The link own device is the target in that case: one hop, its own
      // grant, and the caps it negotiated (which is what actually decides whether a call can succeed).
      const announced = Array.isArray(link.devices) && link.devices.length > 0
        ? link.devices
        : [{
            key: link.peerInfo?.deviceId ?? linkDeviceId,
            deviceId: link.peerInfo?.deviceId ?? linkDeviceId,
            name: link.peerName ?? link.peerInfo?.name ?? linkDeviceId,
            os: link.peerInfo?.os ?? '',
            arch: link.peerInfo?.arch ?? '',
            kind: 'local',
            hops: 0,
            path: [],
            grant: link.grant ?? {},
          }]
      for (const row of announced) {
        const key = typeof row?.key === 'string' && row.key !== '' ? row.key : row?.deviceId
        if (typeof key !== 'string' || key === '') continue
        const candidate = {
          key,
          deviceId: row.deviceId ?? key,
          name: row.name ?? key,
          os: row.os ?? '',
          arch: row.arch ?? '',
          kind: row.kind === 'local' ? 'direct' : 'relay',
          // `row.hops` is the PEER's own count, so it is incremented here. A
          // peer's local target is one hop from the peer and therefore two from
          // this machine; a target the peer itself reaches by relay is one more
          // than the peer reported. The old form clamped everything at 2, which
          // made a three-link chain indistinguishable from a two-link one.
          hops: row.kind === 'local' ? 1 : Math.round(row.hops ?? 1) + 1,
          path: Array.isArray(row.path) ? row.path : [],
          grant: row.grant ?? {},
          linkDeviceId,
        }
        const existing = out.get(key)
        if (
          existing === undefined ||
          (existing.kind === 'relay' && candidate.kind === 'direct') ||
          (existing.kind === candidate.kind && candidate.hops < existing.hops)
        ) {
          out.set(key, candidate)
        }
      }
    }
    return out
  }

  /** Public shape of the target list, ordered direct-first then by name. */
  function listTargets() {
    return [...relayTargets().values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'direct' ? -1 : 1
      return String(a.name).localeCompare(String(b.name))
    })
  }

  /**
   * What this machine offers to one inbound peer.
   *
   * `grant` here is already the effective grant for that peer: for the local
   * target it is the peer's grant on this machine, and for a relayed target it
   * is the intersection computed by `intersectGrants`.
   */
  function exposedTargets(outerGrant) {
    const rows = [
      {
        key: state.deviceId,
        kind: 'local',
        deviceId: state.deviceId,
        name: state.deviceName,
        os: process.platform,
        arch: process.arch,
        hops: 0,
        path: [],
        grant: outerGrant,
      },
    ]
    if (outerGrant?.relay === false) return rows
    const allow = Array.isArray(outerGrant?.relayPeers) ? outerGrant.relayPeers.filter((x) => typeof x === 'string') : []
    for (const target of relayTargets().values()) {
      if (allow.length > 0 && !allow.includes(target.deviceId)) continue
      rows.push({
        key: target.key,
        kind: 'relay',
        deviceId: target.deviceId,
        name: target.name,
        os: target.os,
        arch: target.arch,
        hops: target.hops,
        path: [...target.path, state.deviceName],
        grant: intersectGrants(outerGrant, target.grant),
      })
    }
    return rows
  }

  /** Resolve a target key to the hop that actually reaches it from here. */
  function hopFor(key) {
    return relayTargets().get(key)
  }

  function relayError(code, detail) {
    const error = new Error(detail)
    error.code = code
    return error
  }

  /** Read the peer's advertised targets over a live link. */
  async function refreshDevices(link) {
    if (link.state !== 'connected' || link.session === undefined) return
    const before = deviceSignature(link.devices)
    try {
      const { result } = await link.session.request('sys.info', 'devices', {}, { timeoutMs: 5000 })
      const rows = Array.isArray(result?.devices) ? result.devices : []
      link.devices = rows
      link.devicesAtMs = Date.now()
      notify()
    } catch (error) {
      // An older peer has no `devices` op: that is not an error, it just means
      // it exposes nothing but itself. Anything else is worth a line in the log.
      if (error?.code !== 'unsupported') log.warn(`could not read the target list of ${link.peerName}`, error?.message ?? error)
      link.devices = link.devices ?? []
      notify()
    }
    // What THIS machine can reach just changed, which changes what every peer
    // can reach through it. Telling them is not optional: without the push a
    // peer keeps a stale list and a relay that came up a second ago looks
    // unreachable until something else happens to refresh it.
    if (deviceSignature(link.devices) !== before) broadcastDevices()
  }

  /**
   * Identity of a device list, for cheap change detection.
   *
   * The numeric limits are part of the identity: a far-side grant change that
   * only narrows `timeoutMs` or `maxOutputBytes` changes what the caller may do
   * just as much as flipping `write`, and hashing only the flags meant the peer
   * kept the stale pair until the 30 s backstop happened to run.
   */
  function deviceSignature(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return ''
    return rows
      .map((r) => {
        const g = r?.grant ?? {}
        return `${r?.key ?? r?.deviceId}:${r?.kind ?? ''}:${g.write === true}:${g.shell === true}:${g.relay === false}:${g.timeoutMs ?? ''}:${g.maxOutputBytes ?? ''}:${(g.roots ?? []).join(',')}`
      })
      .sort()
      .join('|')
  }

  /** Tell every inbound peer that the set of devices it can reach changed. */
  function broadcastDevices() {
    for (const [, record] of state.incoming) {
      try {
        // Order matters: the handlers must exist before the peer is told it can
        // call them, otherwise the very first relayed call races the push and
        // comes back `unsupported`.
        record.ensureHandlers?.()
        record.pushDevices?.()
      } catch (error) {
        log.warn('could not push the target list', error?.message ?? error)
      }
    }
  }

  // ---- bridge side ---------------------------------------------------------
  function attachBridgeSession(session, peer) {
    const deviceId = peer.deviceId ?? session.peerDeviceId
    const storedGrant = grantFor(deviceId)
    /**
     * Fail CLOSED for an inbound session that has no stored grant.
     *
     * TOFU is symmetric; the DECISION is not. When this machine dialled the peer
     * outbound it pinned the peer's key and auto-confirmed (`confirmPeer: () =>
     * true`) — that says "I want to operate you", NOT "you may operate me". The
     * peer dialling back in is `authMode: 'trusted'`, so the approval gate never
     * runs, and the old fallback handed it `policy.defaultGrant()`: a live,
     * WRITE-enabled grant on this machine that no human ever agreed to.
     *
     * A device with no stored grant therefore gets an empty, read-only,
     * relay-disabled grant — enough to answer `sys.info` and nothing else — and
     * the local user is asked out of band. Anything they allow arrives through
     * `decideRequest`, which persists the grant and refreshes the live session.
     */
    const initialGrant =
      storedGrant ?? policy.sanitizeGrant({ roots: [], write: false, shell: false, createDirs: false, relay: false })
    const awaitingGrant = storedGrant === null
    const sas = sessionSas(identity.pub, peer.pubKey ?? peer.kb ?? '')
    const caps = new Set(session.negotiated?.caps ?? [])
    const relaySupported = session.negotiated?.features?.relay !== false

    /**
     * The session's live grant view.
     *
     * A grant is not immutable: the bridge user can revoke write or shell access
     * (or widen it) while the session is up. Every decision — the authorizer, the
     * handlers, the target list — therefore reads `live.grant` at call time
     * instead of closing over the value that was in force when the session
     * attached.
     */
    const buildExecutor = (grant) =>
      createExecutor({
        policy: createPolicy({
          limits: {
            ...policy.limits,
            // Per-peer limits are enforced, not merely advertised.
            defaultTimeoutMs: grant.timeoutMs ?? policy.limits.defaultTimeoutMs,
            maxTimeoutMs: Math.max(grant.timeoutMs ?? 0, policy.limits.maxTimeoutMs),
            maxOutputBytes: Math.min(grant.maxOutputBytes ?? policy.limits.maxOutputBytes, policy.limits.maxOutputBytes),
          },
          audit,
        }),
        log,
      })

    const live = { grant: initialGrant, executor: buildExecutor(initialGrant) }

    /**
     * The limits one operation runs under.
     *
     * Never longer than the caller is willing to wait: a command that outlives
     * the RPC deadline is a command nobody is waiting for — the caller has
     * already been told the call failed, and the executor would keep running on
     * its own grant default instead.
     */
    const limitsFor = (grant, req) => {
      const asked = Number.isFinite(req?.timeoutMs) ? req.timeoutMs : undefined
      const granted = Number.isFinite(grant?.timeoutMs) ? grant.timeoutMs : undefined
      const candidates = [asked, granted].filter((v) => v !== undefined)
      return {
        timeoutMs: candidates.length === 0 ? policy.limits.defaultTimeoutMs : Math.min(...candidates),
        maxOutputBytes: grant?.maxOutputBytes,
        maxWriteBytes: policy.limits.maxWriteBytes,
      }
    }

    /** Relay provenance checks, applied at EVERY hop including the last. */
    const relayCheck = (args) => {
      const info = args?.[RELAY_FIELD]
      if (info === undefined || info === null) return { ok: true, path: [], maxHops: state.maxHops }
      const rawPath = Array.isArray(info.path) ? info.path.filter((x) => typeof x === 'string') : []
      const maxHops = Number.isFinite(info.maxHops) ? Math.min(MAX_HOPS_CEILING, Math.max(1, Math.round(info.maxHops))) : state.maxHops
      if (rawPath.includes(state.deviceId)) {
        return { ok: false, error: { code: 'relay-loop', detail: 'this machine already handled that request' } }
      }
      if (rawPath.length + 1 > maxHops) {
        return { ok: false, error: { code: 'relay-limit', detail: `the request already crossed ${rawPath.length} machines (limit ${maxHops})` } }
      }
      return { ok: true, path: rawPath, maxHops }
    }

    session.setAuthorizer(async (req) => {
      const grant = live.grant
      const { baseOp, key } = parseTargetOp(req.op)
      const allowed = caps.has(req.cap)
      if (!allowed) {
        audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'capability not negotiated' })
        return { ok: false, error: { code: 'not-granted', detail: `capability ${req.cap} was not negotiated for this session` } }
      }
      const hops = relayCheck(req.args)
      if (!hops.ok) {
        audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: hops.error.code })
        return hops
      }

      if (key === undefined) {
        // ---- this machine ------------------------------------------------
        const write = req.cap === 'fs.write' || req.cap === 'fs.edit'
        if (write && grant.write !== true) {
          audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'read-only grant' })
          return { ok: false, error: { code: 'not-granted', detail: 'this peer has read-only access' } }
        }
        if (req.cap === 'shell.exec' && grant.shell !== true) {
          audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'no shell grant' })
          return { ok: false, error: { code: 'shell-denied', detail: 'shell access is not granted to this peer' } }
        }
        if (req.cap !== 'sys.info' && (grant.roots ?? []).length === 0) {
          return { ok: false, error: { code: 'not-granted', detail: 'no directory root is granted' } }
        }
        return { ok: true, limits: limitsFor(grant, req) }
      }

      // ---- a device this machine relays to -------------------------------
      const target = exposedTargets(grant).find((t) => t.key === key && t.kind === 'relay')
      if (target === undefined) {
        audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'unknown-device' })
        return {
          ok: false,
          error: {
            code: 'unknown-device',
            detail: `this machine does not expose a device ${key}; call sys.info/devices for the current list`,
          },
        }
      }
      const effective = target.grant
      if ((req.cap === 'fs.write' || req.cap === 'fs.edit') && effective.write !== true) {
        audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'relayed device is read-only' })
        return { ok: false, error: { code: 'not-granted', detail: `write access to ${target.name} is not permitted through this chain` } }
      }
      if (req.cap === 'shell.exec' && effective.shell !== true) {
        audit({ peer: deviceId, action: `${req.cap}/${req.op}`, allowed: false, reason: 'relayed device has no shell' })
        return { ok: false, error: { code: 'shell-denied', detail: `shell access to ${target.name} is not permitted through this chain` } }
      }
      if (req.cap !== 'sys.info' && (effective.roots ?? []).length === 0) {
        return { ok: false, error: { code: 'not-granted', detail: `no directory root is available on ${target.name}` } }
      }
      return { ok: true, limits: limitsFor(effective, req) }
    })

    /** Every local capability funnels into the executor, which re-checks the grant. */
    const bind = (cap, op, run) => {
      session.handle(cap, op, async (req) => {
        const started = Date.now()
        const args = stripRelay(req.args)
        // A caller that gives up sends a `cancel` frame. Without this the far
        // executor ran on with `signal: undefined`: a relayed call was cut off at
        // the narrowest hop's deadline while the shell command it had started was
        // still writing files on this machine seconds later.
        const controller = new AbortController()
        try {
          req.registerCancel(() => controller.abort())
        } catch {
          /* no cancellation seam here; the timeout cap below still applies */
        }
        try {
          const value = await run({ ...req, args, signal: controller.signal })
          audit({ peer: deviceId, action: `${cap}/${op}`, allowed: true, detail: summarise(value), ms: Date.now() - started })
          return value
        } catch (error) {
          audit({
            peer: deviceId,
            action: `${cap}/${op}`,
            allowed: false,
            reason: `${error?.code ?? 'error'}: ${error?.message ?? String(error)}`,
            ms: Date.now() - started,
          })
          throw error
        }
      })
    }

    for (const { cap, op } of SESSION_OPS) {
      if (cap === 'sys.info' && op === 'grant') {
        bind(cap, op, async () => ({ grant: live.grant, sas, deviceId: state.deviceId, name: state.deviceName }))
      } else if (cap === 'sys.info') {
        bind(cap, op, async (req) => live.executor.handle(cap, req.args, { grant: live.grant, signal: req.signal }))
      } else {
        bind(cap, op, async (req) => live.executor.handle(cap, req.args, { grant: live.grant, signal: req.signal }))
      }
    }

    // The target list is how a peer learns what it may reach through here.
    session.handle('sys.info', 'devices', async () => ({
      devices: exposedTargets(live.grant),
      self: { deviceId: state.deviceId, name: state.deviceName, role: state.role },
      relay: { maxHops: state.maxHops, supported: relaySupported },
    }))

    /**
     * One handler per relayed target, registered on demand.
     *
     * `Session.handle` has no unregister, so a handler is never removed once
     * registered; instead every relayed call re-resolves its target at call time
     * and fails with `unknown-device` if the device has gone away. That is
     * cheaper and safer than a registration set that can drift out of sync with
     * the live topology.
     */
    const boundRelayKeys = new Set()
    function ensureRelayHandlers() {
      for (const target of exposedTargets(live.grant)) {
        if (target.kind !== 'relay' || boundRelayKeys.has(target.key)) continue
        boundRelayKeys.add(target.key)
        for (const { cap, op } of SESSION_OPS) {
          session.handle(cap, targetOp(op, target.key), async (req) => relayForward(deviceId, target.key, cap, op, req))
        }
      }
    }
    ensureRelayHandlers()

    const record = {
      session,
      peer,
      sas,
      sinceMs: Date.now(),
      grant: initialGrant,
      /** Swap in a new grant (used by setGrant while the session is live). */
      refresh(next) {
        live.grant = next
        live.executor = buildExecutor(next)
        record.grant = next
        ensureRelayHandlers()
        record.pushDevices()
      },
      /** Tell the peer its reachable set changed. */
      pushDevices() {
        try {
          session.send({ t: 'evt', kind: 'devices' })
        } catch (error) {
          log.warn('could not push the target list', error?.message ?? error)
        }
      },
    }
    // Exposed to `broadcastDevices` so a link that comes up (or drops) later
    // registers the handlers for the devices it just added. `Session.handle` has
    // no unregister, so this only ever ADDS; a device that has gone away is
    // caught at call time by the authorizer, which re-resolves the target list.
    record.ensureHandlers = ensureRelayHandlers
    const previous = state.incoming.get(deviceId)
    if (previous !== undefined && previous.session !== session) {
      // A reconnect supersedes the older session; keeping both would let one
      // device hold two live grants and confuse every "which session is this"
      // decision downstream.
      try {
        previous.session.close('superseded')
      } catch {
        /* already gone */
      }
    }
    state.incoming.set(deviceId, record)
    session.on('close', () => {
      if (state.incoming.get(deviceId) === record) state.incoming.delete(deviceId)
      audit({ peer: deviceId, action: 'session.close', allowed: true })
      notify()
    })
    session.on('error', (error) => log.warn(`session error with ${deviceId}`, error?.message ?? error))
    // Push the grant table so the agent UI can render limits without asking.
    try {
      session.send({ t: 'evt', kind: 'grant', table: live.grant })
    } catch (error) {
      log.warn('could not push the grant table', error?.message ?? error)
    }
    if (awaitingGrant) {
      // Out of band, never awaited: the handshake is already finished, so blocking
      // here would only stall the socket. The session stays up and stays unable
      // to do anything until the local user answers.
      void requestUserApproval({
        deviceId,
        name: peer.name ?? deviceId,
        os: peer.os ?? '?',
        pubKey: peer.pubKey ?? peer.kb ?? '',
        reason: 'inbound-without-grant',
      })
        .then((allowed) => {
          if (allowed !== true) return
          const next = grantFor(deviceId)
          if (next !== null) record.refresh(next)
        })
        .catch((error) => log.warn('the inbound grant request failed', error?.message ?? error))
    }
    audit({ peer: deviceId, action: 'session.open', allowed: true, detail: `${peer.name ?? deviceId} sas=${sas}` })
    log.info(
      `bridge session established with ${peer.name ?? deviceId} (sas ${sas})` +
        (awaitingGrant ? ' — no stored grant: read-only until this machine\'s user allows it' : ''),
    )
    notify()
  }

  /**
   * Forward one relayed call to the next hop.
   *
   * The op suffix is preserved when the next hop is itself relayed and dropped
   * when it is a direct peer, which is what makes the chain compose to any
   * depth with one convention. The timeout is narrowed at every hop so a deep
   * chain can never outlive the caller's own patience.
   */
  async function relayForward(fromDeviceId, key, cap, op, req) {
    const record = state.incoming.get(fromDeviceId)
    if (record === undefined) throw relayError('unknown-device', 'the session that made this call is gone')
    const target = exposedTargets(record.grant).find((t) => t.key === key)
    if (target === undefined || target.kind !== 'relay') throw relayError('unknown-device', `device ${key} is no longer exposed`)
    const hop = hopFor(key)
    if (hop === undefined) throw relayError('peer-offline', `${target.name} is not reachable right now`)
    const link = state.links.get(hop.linkDeviceId)
    if (link === undefined || link.state !== 'connected' || link.session === undefined) {
      throw relayError('peer-offline', `the link to ${target.name} is down`)
    }
    const info = req.args?.[RELAY_FIELD]
    const path = [...(Array.isArray(info?.path) ? info.path : []), state.deviceId]
    const maxHops = Number.isFinite(info?.maxHops) ? info.maxHops : state.maxHops
    const nextOp = hop.kind === 'direct' ? op : targetOp(op, hop.key)
    const nextArgs = { ...stripRelay(req.args), [RELAY_FIELD]: { path, maxHops } }
    const candidates = [hop.grant?.timeoutMs, record.grant?.timeoutMs, req.limits?.timeoutMs].filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
    )
    const timeoutMs = candidates.length === 0 ? DEFAULTS.requestTimeoutMs : Math.min(...candidates)
    try {
      const { result } = await link.session.request(cap, nextOp, nextArgs, { timeoutMs })
      return result
    } catch (error) {
      throw relayError(error?.code ?? 'relay-failed', error?.detail ?? error?.message ?? String(error))
    }
  }

  function summarise(value) {
    if (value === null || typeof value !== 'object') return String(value)
    if (typeof value.bytes === 'number') return `${value.bytes} bytes`
    if (typeof value.replaced === 'number') return `${value.replaced} replacements`
    if (typeof value.exitCode === 'number') return `exit ${value.exitCode}`
    if (Array.isArray(value.entries)) return `${value.entries.length} entries`
    return undefined
  }

  // ---- listener ------------------------------------------------------------
  let server = null
  let deviceRefreshTimer = null

  /**
   * This machine accepts inbound connections exactly while it is listening.
   *
   * `discoverable` is a separate, narrower thing: it only decides whether this
   * machine ANNOUNCES itself on the LAN. A machine can be reachable by manual
   * address without advertising, and conflating the two made "do not announce"
   * silently mean "do not accept", which is not what the words say.
   */
  function acceptsInbound() {
    return server !== null
  }

  /**
   * Bind the inbound listener and resolve once it is actually accepting.
   *
   * Discovery must not announce before this resolves: an announce carrying
   * port 0 tells every peer on the segment that this machine is not reachable,
   * which is exactly how a first connection fails.
   *
   * `createBridgeServer` returns an emitter wrapper whose `listen()` is a
   * promise (and which reports socket errors as `error`), not a raw net.Server.
   */
  function startListener() {
    if (server !== null) return Promise.resolve(state.port)
    const wantPort = state.port
    const listener = createBridgeServer(bridgeOpts)
    server = listener
    listener.on('error', (error) => {
      state.listenError = error?.message ?? String(error)
      log.warn('bridge listener error', state.listenError)
      notify()
    })
    listener.on('handshakeFailed', (error) => {
      log.warn('inbound handshake failed', error?.code ?? error?.message ?? error)
    })
    return listener
      .listen(wantPort)
      .then((address) => {
        state.port = typeof address === 'object' && address !== null ? address.port : wantPort
        state.listenError = null
        log.info(`bridge listener on 0.0.0.0:${state.port}`)
        notify()
        return state.port
      })
      .catch((error) => {
        state.listenError = error?.message ?? String(error)
        log.warn(`bridge listener could not bind ${wantPort}: ${state.listenError}`)
        // The configured port is taken: fall back to an ephemeral one so this
        // machine stays reachable instead of failing the whole bridge.
        if (wantPort !== 0) {
          server = null
          state.port = 0
          return startListener()
        }
        notify()
        return 0
      })
  }

  function stopListener() {
    if (server === null) return
    const listener = server
    server = null
    try {
      void listener.close()
    } catch (error) {
      log.warn('listener close failed', error?.message ?? error)
    }
  }

  /**
   * Apply the identity posture to the runtime.
   *
   * The ONLY thing role decides is what is opened eagerly:
   *   'bridge' — listen now, show a code now, announce as connectable.
   *   'agent'  — announce, but do not listen until a pairing window is opened.
   *
   * Neither posture blocks the other direction: an 'agent' machine still accepts
   * a peer once its user opens a pairing window, and a 'bridge' machine still
   * connects out. Connecting never disables anything.
   */
  async function applyRoleToRuntime() {
    const eager = state.role === 'bridge'
    // 桥接侧 listens from the start; Agent 侧 listens only while its user has an
    // open pairing window. Switching to Agent 侧 therefore CLOSES the door for
    // new peers without touching the sessions that are already up.
    const wantsListener = eager || state.pairing !== null
    if (wantsListener) await startListener()
    else stopListener()
    if (!discovery.started) discovery.start()
    discovery.setEnabled(state.discoverable)
    // A machine that can be operated must have a code on screen from the start:
    // codes are single-use, and making the user hunt for a button before any peer
    // can even attempt to pair is exactly how a first connection stalls. This is
    // independent of `discoverable`: being connectable is a 桥接侧 machine's whole
    // purpose, and a user who does not want to be announced still wants to be
    // reachable at the address they handed out.
    if (eager && state.pairing === null) {
      try {
        openPairingWindow(false)
      } catch (error) {
        log.warn('could not open the initial pairing window', error?.message ?? error)
      }
    }
    return { accepts: acceptsInbound(), role: state.role }
  }

  // ---- agent side ----------------------------------------------------------
  function closeLink(deviceId, reason, { wanted = false } = {}) {
    const active = state.links.get(deviceId)
    if (active === undefined) return null
    state.links.delete(deviceId)
    active.state = 'closed'
    active.wanted = wanted
    if (!wanted && active.reconnectTimer !== null) {
      clearTimeout(active.reconnectTimer)
      active.reconnectTimer = null
    }
    if (active.session !== undefined) {
      try {
        active.session.close(reason)
      } catch (error) {
        log.warn('session close failed', error?.message ?? error)
      }
    }
    audit({ peer: deviceId, action: 'agent.close', allowed: true, reason })
    // Losing a link removes devices from this machine's reach, which removes
    // them from every peer that was reaching through it. Say so immediately.
    broadcastDevices()
    notify()
    return active
  }

  /**
   * Re-read every connected peer's target list on a slow tick.
   *
   * The push above is the fast path; this is the backstop for a push that was
   * missed because a session was mid-handshake at that instant. One unref'd
   * timer for the whole service, and it does nothing while there are no links.
   */
  function ensureDeviceRefreshTimer() {
    if (deviceRefreshTimer !== null) return
    deviceRefreshTimer = setInterval(() => {
      for (const [, link] of state.links) {
        // Never leave a rejection unattended: this plugin shares the host process,
        // where an unhandled rejection is fatal by default.
        if (link.state === 'connected') {
          void refreshDevices(link).catch((error) => log.warn('device refresh failed', error?.message ?? error))
        }
      }
    }, DEVICE_REFRESH_MS)
    deviceRefreshTimer.unref?.()
  }

  function stopDeviceRefreshTimer() {
    if (deviceRefreshTimer === null) return
    clearInterval(deviceRefreshTimer)
    deviceRefreshTimer = null
  }

  function scheduleReconnect(deviceId) {
    const link = state.links.get(deviceId)
    if (link === undefined || link.wanted !== true) return
    if (link.reconnectAttempts >= 3) {
      log.warn(`giving up on automatic reconnect to ${link.peerName} after 3 attempts`)
      link.wanted = false
      notify()
      return
    }
    link.reconnectAttempts += 1
    const delayMs = 1500 * link.reconnectAttempts
    link.reconnectTimer = setTimeout(() => {
      link.reconnectTimer = null
      void connect(link.target, { automatic: true }).catch(() => {})
    }, delayMs)
    link.reconnectTimer.unref?.()
    log.info(`reconnect to ${link.peerName} attempt ${link.reconnectAttempts} in ${delayMs} ms`)
  }

  /**
   * Open (or reuse) an outbound link to one device.
   *
   * Multi-device is the point: asking for a second device ADDS a link, it never
   * replaces the first. Asking again for a device already connected is a no-op
   * instead of a second handshake, and asking again for a device that is
   * currently dialling joins the attempt in flight.
   */
  async function connect(target = {}, { automatic = false } = {}) {
    const peerList = discovery.list()
    const chosen =
      target.deviceId !== undefined && target.deviceId !== ''
        ? peerList.find((p) => p.deviceId === target.deviceId) ?? { deviceId: target.deviceId, name: target.name ?? target.deviceId, host: target.host, port: target.port, proto: PROTO, publicKey: '' }
        : { deviceId: '', name: `${target.host}:${target.port}`, host: target.host, port: target.port, proto: PROTO, publicKey: '' }
    if (target.deviceId !== undefined && target.deviceId !== '' && (chosen.host === undefined || chosen.host === '')) {
      throw new Error('that device has no address yet; run 刷新 to scan again')
    }
    if (chosen.port === undefined || chosen.port === 0 || chosen.port === null) {
      throw new Error(`the chosen device is not listening yet; make sure ${chosen.name ?? 'the other machine'} is set to 桥接侧 (or open a pairing window on it)`)
    }
    // An announce that says "I am not connectable" is a promise the panel keeps:
    // refusing here is far better than a 15 s connect timeout with no reason.
    if (chosen.accepts === false) {
      throw new Error(`${chosen.name ?? 'that machine'} is currently set to Agent 侧 and is not accepting connections; open a pairing window there first`)
    }

    const identityKey = chosen.deviceId !== '' ? chosen.deviceId : `${chosen.host}:${chosen.port}`
    const existing = state.links.get(identityKey)
    if (existing !== undefined) {
      if (existing.state === 'connected' && target.code === undefined) return existing
      if (existing.state === 'connecting' || existing.state === 'pairing') {
        if (target.code === undefined) throw new Error(`上一次连接还在进行中，请稍候再试`)
      }
    }
    if (state.connecting.has(identityKey) && target.code === undefined) {
      throw new Error('上一次连接还在进行中，请稍候再试')
    }

    const record =
      existing ??
      {
        deviceId: identityKey,
        peerName: chosen.name ?? identityKey,
        peerHost: chosen.host,
        peerPort: chosen.port,
        state: 'connecting',
        sinceMs: Date.now(),
        protocolVersion: undefined,
        sas: undefined,
        trust: undefined,
        grant: null,
        devices: [],
        devicesAtMs: 0,
        error: null,
        session: undefined,
        reconnectAttempts: 0,
        reconnectTimer: null,
        wanted: false,
        target: { deviceId: chosen.deviceId, host: chosen.host, port: chosen.port, name: chosen.name },
      }
    record.state = 'connecting'
    record.error = null
    record.target = { deviceId: chosen.deviceId, host: chosen.host, port: chosen.port, name: chosen.name }
    record.wanted = true
    if (!automatic) record.reconnectAttempts = 0
    state.links.set(identityKey, record)
    state.connecting.add(identityKey)
    state.lastError = null
    notify()

    let link = null
    try {
      link = await raceTimeout(
        FrameLink.connect({ host: chosen.host, port: chosen.port, role: 'agent' }),
        15_000,
        '连接超时：对方没有应答（检查防火墙是否放行 TCP ' + chosen.port + '）',
      )
      const code = typeof target.code === 'string' && target.code.trim() !== '' ? C.normalizeCode(target.code) : null
      const { session, peer, negotiated } = await raceTimeout(
        agentHandshake(link, {
          identity,
          deviceId: state.deviceId,
          name: state.deviceName,
          app: DISCOVERY_PROTOCOL,
          caps: BRIDGE_CAPABILITIES,
          features: FEATURES,
          proto: PROTO,
          pairCode: code,
          trustStore,
          requireUserConfirm: false,
          confirmPeer: async () => true,
          // Submitting a code hands control to the OTHER machine's user, who has
          // to click 同意. The library default of 10 s per frame meant a normal
          // human could not approve in time, so the pairing phase gets the same
          // generous ceiling the bridge side uses.
          timeoutMs: 120_000,
          onPeer: (info) => {
            record.state = 'pairing'
            record.peerName = info.name ?? record.peerName
            notify()
          },
        }),
        130_000,
        '握手超时：对方没有完成配对（如果这是第一次连接，请在对方电脑上开启配对窗口并填入配对码，然后在对端点「同意」）',
      )

      const sas = sessionSas(identity.pub, peer.pubKey ?? peer.kb ?? chosen.publicKey ?? '')
      record.state = 'connected'
      record.deviceId = peer.deviceId
      record.peerName = peer.name ?? record.peerName
      record.protocolVersion = negotiated.protocolVersion
      record.sas = sas
      record.trust = peer.trust ?? 'unknown'
      record.sinceMs = Date.now()
      record.grant = null
      record.relaySupported = negotiated.features?.relay === true
      record.session = session
      record.peerInfo = peer
      record.reconnectAttempts = 0
      record.error = null
      // A manual address produces a key we did not know; re-key the map so a
      // later discovery-based connect reuses this very link.
      if (identityKey !== peer.deviceId) state.links.delete(identityKey)
      state.links.set(peer.deviceId, record)

      session.on('close', (reason) => {
        if (state.links.get(peer.deviceId) === record) {
          const detail = reason === 'normal' ? null : `link closed: ${reason}`
          record.error = detail
          if (detail !== null) state.lastError = detail
          closeLink(peer.deviceId, `peer_closed:${reason}`, { wanted: record.wanted })
          scheduleReconnect(peer.deviceId)
        }
      })
      // A completed pairing consumes the remembered target: a later code belongs to a later attempt.
      state.manualPair = null
      session.on('error', (error) => log.warn(`agent session error with ${peer.deviceId}`, error?.message ?? error))
      session.on('grant', (table) => {
        record.grant = table
        notify()
      })
      session.on('event', (body) => {
        if (body?.kind === 'devices') {
          void refreshDevices(record).catch((error) => log.warn('device refresh failed', error?.message ?? error))
        }
      })

      // Pull the grant; the push event may arrive before the listener is ready.
      try {
        const { result } = await session.request('sys.info', 'grant', {}, { timeoutMs: 5000 })
        if (result?.grant !== undefined) record.grant = result.grant
      } catch (error) {
        log.warn('could not read the grant table', error?.message ?? error)
      }
      await refreshDevices(record)
      ensureDeviceRefreshTimer()
      // This machine just gained (or regained) a route, so every peer reaching
      // through it gained one too.
      broadcastDevices()
      audit({ peer: peer.deviceId, action: 'agent.connect', allowed: true, detail: `sas=${sas} trust=${peer.trust ?? 'unknown'}` })
      log.info(`connected to ${peer.name ?? peer.deviceId} (protocol v${negotiated.protocolVersion}, sas ${sas}, ${record.devices?.length ?? 0} targets)`)
      notify()
      return record
    } catch (error) {
      // R320: a manual attempt that only lacks a code keeps its target, so 提交配对码 can continue THIS attempt.
      if (error?.code === 'pairing_required' && typeof chosen.host === 'string' && typeof chosen.port === 'number') {
        state.manualPair = { host: chosen.host, port: chosen.port, at: Date.now() }
      }
      const detail =
        error?.code === 'pairing_closed' || error?.code === 'auth_mode_unsupported'
          ? '对端还没有开启配对窗口：请在对方电脑的「连接」面板点「开启配对窗口」，再把显示的 6 位配对码填进来。'
          : error?.code === 'pairing_failed'
            ? '配对码不正确或配对窗口已失效（配对窗口是一次性的，失败后请重新生成）。'
            : error?.code === 'pairing_denied'
              ? '桥接侧用户拒绝了这次连接。'
              : error?.code === 'key_changed'
                ? '对端记录的这台设备的密钥发生了变化，需要在对方电脑上重新配对。'
                : (error?.message ?? String(error))
      state.lastError = detail
      record.error = detail
      record.state = 'error'
      record.session = undefined
      // A handshake that timed out or failed can leave a half-open socket; the
      // peer must not be left holding a session for a device that gave up.
      if (link !== null && link.closed !== true) {
        try {
          link.destroy?.('connect_failed')
        } catch {
          /* already gone */
        }
      }
      if (!automatic) record.wanted = false
      const gone = state.links.get(record.deviceId)
      if (gone === undefined || gone.wanted !== true) {
        state.links.delete(record.deviceId)
        if (identityKey !== record.deviceId) state.links.delete(identityKey)
      } else {
        scheduleReconnect(record.deviceId)
      }
      notify()
      throw new Error(detail)
    } finally {
      state.connecting.delete(identityKey)
      notify()
    }
  }

  /**
   * Pick the device a tool call means.
   *
   * With exactly one device reachable the argument is optional — that keeps the
   * common single-machine case free of ceremony — but with several the error
   * lists them, so the model can choose instead of guessing.
   */
  function resolveTarget(device) {
    const targets = listTargets()
    if (targets.length === 0) {
      throw new Error(
        'no device is reachable. Open the sidebar 连接 panel and connect to a peer first (or wait for a link to come back up).',
      )
    }
    const query = device === undefined || device === null ? '' : String(device).trim()
    if (query === '') {
      if (targets.length === 1) return targets[0]
      throw new Error(
        `several devices are reachable (${targets.map((t) => `${t.name} [${t.deviceId}]`).join(', ')}); ` +
          'pass "device" to choose one.',
      )
    }
    const q = query.toLowerCase()
    const hit =
      targets.find((t) => t.key.toLowerCase() === q || String(t.deviceId).toLowerCase() === q) ??
      targets.find((t) => String(t.name).toLowerCase() === q) ??
      targets.find((t) => String(t.name).toLowerCase().includes(q))
    if (hit === undefined) {
      throw new Error(
        `no reachable device matches "${query}"; reachable now: ${targets.map((t) => `${t.name} [${t.deviceId}]`).join(', ')}`,
      )
    }
    return hit
  }

  /**
   * A refusal the caller can branch on.
   *
   * The contract code travels in both places on purpose: the message keeps the
   * `code: reason` shape the wire path already uses (and every existing caller
   * and test matches against), while the `code` property lets a caller switch on
   * the contract code itself instead of pattern-matching the prose.
   */
  function refusalError(code, reason) {
    const error = new Error(`${code}: ${reason}`.trim())
    error.code = code
    return error
  }

  /**
   * Why this target may not serve this capability, or null when it may.
   *
   * The codes are the ones the far-side authorizer answers with for the same
   * situation (write -> `not-granted` at service.js:797/824, shell ->
   * `shell-denied` at 801/828), so a pre-checked refusal and an executor-side
   * refusal are indistinguishable to the caller.
   */
  function targetRefusal(cap, target) {
    const grant = target.grant ?? {}
    if ((cap === 'fs.write' || cap === 'fs.edit') && grant.write !== true) {
      return {
        code: 'not-granted',
        reason:
          target.kind === 'relay'
            ? `write access to ${target.name} is not permitted through this chain (permissions are the minimum of both hops).`
            : 'the peer granted read-only access; ask its user to allow 写入',
      }
    }
    if (cap === 'shell.exec' && grant.shell !== true) {
      return {
        code: 'shell-denied',
        reason:
          target.kind === 'relay'
            ? `shell access to ${target.name} is not permitted through this chain (permissions are the minimum of both hops).`
            : 'the peer did not grant Shell access; ask its user to enable 允许执行 Shell',
      }
    }
    return null
  }

  /** One RPC to one reachable device, direct or relayed. */
  async function remoteCall(cap, op, args, { device, signal, timeoutMs, toolName } = {}) {
    let target = resolveTarget(device)
    let link = state.links.get(target.linkDeviceId)
    if (link === undefined || link.state !== 'connected' || link.session === undefined) {
      throw new Error(`${target.name} is not reachable right now (its link went down).`)
    }
    if (targetRefusal(cap, target) !== null) {
      // The cached grant may simply be stale: the bridge user can widen a grant
      // while the session is live and the push takes a moment to arrive. Re-read
      // once before refusing, so a permission that was just granted is never
      // reported as missing.
      await refreshDevices(link)
      const again = listTargets().find((t) => t.key === target.key)
      if (again !== undefined) {
        target = again
        link = state.links.get(again.linkDeviceId) ?? link
        if (link.state !== 'connected' || link.session === undefined) {
          throw new Error(`${target.name} is not reachable right now (its link went down).`)
        }
      }
    }
    const why = targetRefusal(cap, target)
    if (why !== null) throw refusalError(why.code, why.reason)

    const grant = target.grant ?? {}
    const rpcTimeout = timeoutMs ?? grant.timeoutMs ?? DEFAULTS.requestTimeoutMs
    if (signal?.aborted === true) throw new Error('cancelled')
    const buildArgs = (t) =>
      t.kind === 'direct' ? args ?? {} : { ...(args ?? {}), [RELAY_FIELD]: { path: [state.deviceId], maxHops: state.maxHops } }
    const buildOp = (t) => (t.kind === 'direct' ? op : targetOp(op, t.key))
    try {
      const { result } = await link.session.request(cap, buildOp(target), buildArgs(target), { timeoutMs: rpcTimeout })
      return result
    } catch (error) {
      // The topology moved under us: re-read the target list once and retry, so
      // a device that was just added or re-granted does not look broken.
      if (error?.code === 'unknown-device') {
        await refreshDevices(link)
        const again = listTargets().find((t) => t.key === target.key)
        if (again !== undefined) {
          const retryLink = state.links.get(again.linkDeviceId)
          if (retryLink?.state === 'connected' && retryLink.session !== undefined) {
            const { result } = await retryLink.session.request(cap, buildOp(again), buildArgs(again), { timeoutMs: rpcTimeout })
            return result
          }
        }
      }
      if (error?.code === 'not-granted' || error?.code === 'path-denied' || error?.code === 'shell-denied') {
        throw refusalError(error.code, error.detail ?? '')
      }
      throw new Error(`${error?.code ?? 'bridge error'}: ${error?.detail ?? error?.message ?? String(error)}`)
    }
  }

  async function ping(device, timeoutMs = 3000) {
    const started = Date.now()
    await remoteCall('sys.info', 'info', {}, { device, timeoutMs })
    return Date.now() - started
  }


  /**
   * Ask a reachable device to record audio and answer with the artifact it wrote.
   *
   * R332: the device records (only it has a microphone) and writes the bytes where this machine can already read them;
   * what comes back is {path, bytes, sha256, kind}, so the caller can read the file and compare. A device that does not
   * advertise media.capture fails with the wire own refusal, which names the capability.
   */
  async function captureMedia({ device, ms, kind } = {}) {
    const target = resolveTarget(device)
    // R380: two kinds of capture on one wire op. `photo` takes ONE still frame (no duration), `record` records audio;
    // the phone decides with what sensor it has, and the artifact comes back the same shape either way.
    const still = kind === 'photo'
    const wait = Number.isFinite(ms) === true ? Math.max(250, Math.min(still ? 30000 : 60000, Math.round(ms))) : (still ? 4000 : 2000)
    const started = Date.now()
    const result = await remoteCall('media.capture', still ? 'photo' : 'record', still ? { ms: wait } : { ms: wait }, { device: target.key, timeoutMs: wait + 12000 })
    return {
      device: { key: target.key, name: target.name },
      path: typeof result?.path === 'string' ? result.path : null,
      bytes: Number.isFinite(result?.bytes) === true ? result.bytes : null,
      sha256: typeof result?.sha256 === 'string' ? result.sha256 : null,
      kind: typeof result?.kind === 'string' ? result.kind : null,
      // The frame size rides along when the page reported one, so a caller can tell a real picture from a black one.
      size: typeof result?.size === 'string' ? result.size : null,
      ms: Date.now() - started,
    }
  }
  /**
   * List one directory on a reachable device, through the grant that device gave this machine.
   *
   * The board had exactly one concrete action (the self test); "show me what is on that device" is the first thing a
   * person wants after pairing, and it is the only read the phone implements. Deliberately NARROW: one directory (the
   * target's first granted root unless a path is named), at most 12 names returned, read-only - not a general
   * remote-call surface behind an HTTP op.
   */
  async function listTarget({ device, path } = {}) {
    const target = resolveTarget(device)
    const grant = target.grant ?? {}
    const roots = Array.isArray(grant.roots) ? grant.roots.filter((root) => typeof root === 'string' && root !== '') : []
    const root = typeof path === 'string' && path !== '' ? path : roots[0]
    if (root === undefined) {
      throw new Error('this device granted no directory root, so there is nothing to list')
    }
    const started = Date.now()
    const result = await remoteCall('fs.list', 'list', { path: root }, { device: target.key, timeoutMs: 8000 })
    const rows = Array.isArray(result?.entries) ? result.entries : []
    return {
      device: { key: target.key, name: target.name },
      root,
      count: rows.length,
      truncated: result?.truncated === true,
      entries: rows.slice(0, 12).map((row) => ({
        name: String(row?.name ?? ''),
        type: String(row?.type ?? ''),
        size: Number(row?.size ?? 0),
      })),
      ms: Date.now() - started,
    }
  }
  /**
   * Connection self-test: prove the whole remote path with real effects.
   *
   * Writes a marker file inside the first granted root, reads it back, edits it,
   * lists the directory and runs one shell command. This is what the panel's
   * 「测试连接」 uses, and it is the honest answer to "is the bridge actually
   * working?" — a ping only proves the socket is up.
   *
   * The marker is deliberately LEFT BEHIND: there is no delete capability in the
   * contract, so the only ways to remove it would be a platform-specific shell
   * command (which needs a shell grant this test may not have) or a truncating
   * rewrite (which leaves an empty file anyway). It is one file at a fixed path,
   * overwritten by every run, and its contents name themselves as a test
   * artifact — visible proof of the round trip rather than litter.
   */
  async function selfTest({ device, path: requestedPath } = {}) {
    const target = resolveTarget(device)
    const results = {
      device: { key: target.key, name: target.name, kind: target.kind, via: target.path },
      steps: [],
    }
    const step = async (name, run) => {
      const started = Date.now()
      try {
        const value = await run()
        results.steps.push({ name, ok: true, ms: Date.now() - started, detail: value })
        return value
      } catch (error) {
        results.steps.push({ name, ok: false, ms: Date.now() - started, error: error?.message ?? String(error) })
        return undefined
      }
    }

    // Re-read the target list first: a relayed device's grant may have changed
    // since the panel last painted, and the self-test must report the truth.
    const link = state.links.get(target.linkDeviceId)
    if (link !== undefined) await refreshDevices(link)
    const fresh = listTargets().find((t) => t.key === target.key) ?? target
    const grant = fresh.grant ?? {}
    results.grant = grant

    const info = await step('sys.info', () => remoteCall('sys.info', 'info', {}, { device: fresh.key, timeoutMs: 5000 }))
    results.peerHost = info?.hostname
    results.peerPlatform = info ? `${info.platform}/${info.arch}` : undefined
    results.rttMs = await step('ping', () => ping(fresh.key, 3000))

    const root = Array.isArray(grant.roots) && grant.roots.length > 0 ? grant.roots[0] : undefined
    const marker = requestedPath ?? (root === undefined ? undefined : `${root}/.dsh-lan-bridge-selftest.txt`)
    if (marker === undefined) {
      results.steps.push({ name: 'skipped', ok: false, error: 'the peer granted no directory root' })
      results.ok = false
      results.failed = results.steps.filter((s) => s.ok !== true).map((s) => s.name)
      return results
    }
    const stamp = `dsh-lan-bridge self-test ${new Date().toISOString()}`
    if (grant.write === true) {
      await step('fs.write', () => remoteCall('fs.write', 'write', { path: marker, content: `${stamp}\n` }, { device: fresh.key }))
      const back = await step('fs.read', () => remoteCall('fs.read', 'read', { path: marker }, { device: fresh.key }))
      results.roundTripOk = typeof back?.content === 'string' && back.content.includes(stamp)
      await step('fs.edit', () =>
        remoteCall('fs.edit', 'edit', { path: marker, oldString: 'self-test', newString: '自检', replaceAll: false }, { device: fresh.key }),
      )
    } else {
      results.steps.push({ name: 'fs.write', ok: false, error: 'read-only grant; write steps skipped' })
    }
    await step('fs.list', () => remoteCall('fs.list', 'list', { path: root }, { device: fresh.key }))
    if (grant.shell === true) {
      await step('shell.exec', () => remoteCall('shell.exec', 'exec', { command: 'echo dsh-lan-bridge-selftest-ok' }, { device: fresh.key }))
    } else {
      results.steps.push({ name: 'shell.exec', ok: false, error: 'no shell grant' })
    }
    results.ok = results.steps.every((s) => s.ok === true || s.name === 'fs.write' || s.name === 'shell.exec')
    results.failed = results.steps.filter((s) => s.ok !== true).map((s) => s.name)
    return results
  }

  // ---- public surface ------------------------------------------------------
  async function start() {
    if (state.started) return
    state.started = true
    await applyRoleToRuntime()
    // Record the effective posture on the first boot, so this machine's identity
    // exists on disk and is explicit from the start rather than only after the
    // user happens to change something. A value that came from the profile's
    // patch row is deliberately NOT written: config wins over the remembered
    // value, so persisting it would only set up a fight the next time the user
    // changed it in the panel.
    if (configuredRole === undefined && typeof config.discoverable !== 'boolean') savePrefs()
    // R203: the claim follows the EVIDENCE. `state.discoverable` is the user's intent; what the machine can
    // support is what its first announce's legs reported. Waiting here is bounded (1.2 s) and it is the whole
    // point: a line that says `discoverable=true` before anything was sent is a claim nobody made.
    await discovery.egressSettled(1200)
    const supported = discovery.discoverable()
    // A false claim carries its REASON and its COUNT on the line itself: 'discoverable=false' with no number
    // behind it is a silence with better grammar.
    const counts = discovery.egressCounts()
    const why = supported === true
      ? ''
      : state.discoverable !== true
        ? ' — discoverability is off: nothing is announced'
        : ` — no working egress: ${counts.attempted - counts.worked}/${counts.attempted} NIC(s) failed`
    log.info(`service started role=${state.role} discoverable=${supported} port=${state.port} data=${dataDir}${why}`)
    log.info(`discovery egress: ${discovery.egressSummary()}`
      + (supported === state.discoverable ? '' : ` — requested discoverable=${String(state.discoverable)}, supported by egress=${String(supported)}`))
    notify()
  }

  async function stop() {
    state.started = false
    stopDeviceRefreshTimer()
    for (const [deviceId] of [...state.links]) closeLink(deviceId, 'shutdown')
    for (const [, record] of state.incoming) {
      try {
        record.session.close('shutdown')
      } catch {
        /* best effort */
      }
    }
    state.incoming.clear()
    stopListener()
    discovery.stop()
    notify()
  }

  async function setRole(role) {
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`)
    state.role = role
    // Switching to Agent 侧 means "stop accepting". Closing the window here is
    // what makes that promise true; the user can still open one deliberately for
    // a temporary accept. Established sessions are never evicted by this.
    if (role === 'agent' && state.pairing !== null) closePairingWindow('role_changed_to_agent')
    savePrefs()
    await applyRoleToRuntime()
    log.info(`role set to ${role}`)
    notify()
    return { role, accepts: acceptsInbound() }
  }

  function setDiscoverable(enabled) {
    state.discoverable = enabled === true
    discovery.setEnabled(state.discoverable)
    if (state.discoverable && state.role === 'bridge') openPairingWindow(false)
    savePrefs()
    notify()
    return { discoverable: state.discoverable, pairing: state.pairing, accepts: acceptsInbound() }
  }

  async function probe() {
    await discovery.probe()
    notify()
    return { peers: discovery.list() }
  }

  /** Drop one link, or every link when no device is named. */
  async function disconnect(deviceId) {
    if (deviceId === undefined || deviceId === null || deviceId === '') {
      for (const [id] of [...state.links]) closeLink(id, 'user')
      return { links: [] }
    }
    const link = state.links.get(deviceId)
    if (link === undefined) throw new Error('that device is not connected')
    closeLink(deviceId, 'user')
    return { links: listTargets() }
  }

  async function disconnectPeer(deviceId) {
    const record = state.incoming.get(deviceId)
    if (record === undefined) throw new Error('that peer is not connected')
    record.session.close('revoked_by_bridge')
    state.incoming.delete(deviceId)
    audit({ peer: deviceId, action: 'bridge.disconnect', allowed: true })
    notify()
    return { ok: true }
  }

  async function submitPairingCode(code, { deviceId } = {}) {
    const candidates = [...state.links.values()].filter((l) => l.state !== 'connected')
    const chosen =
      deviceId !== undefined && deviceId !== ''
        ? state.links.get(deviceId)
        : candidates.find((l) => l.state === 'pairing') ?? candidates[0] ?? [...state.links.values()].find((l) => l.state === 'connected')
    const target = chosen?.target ?? { deviceId: '', host: undefined, port: undefined }
    if (target.host === undefined || target.port === undefined) {
      // R320: the panel flow that needs this is "type host:port, then the code". The manual attempt that asked for
      // the code is the pending attempt, and ten minutes is the pairing window the service itself opens.
      const remembered = state.manualPair
      if (remembered !== null && Date.now() - remembered.at <= 10 * 60 * 1000) {
        return connect({ host: remembered.host, port: remembered.port, code }, { automatic: false })
      }
      throw new Error('there is no pending connection to submit a pairing code for; pick a device first')
    }
    return connect({ ...target, code }, { automatic: false })
  }

  function decideRequest(payload = {}) {
    const deviceId = payload.deviceId
    const pending =
      payload.id !== undefined
        ? [...state.pendingRequests.values()].find((r) => r.id === payload.id)
        : deviceId !== undefined
          ? state.pendingRequests.get(deviceId)
          : [...state.pendingRequests.values()][0]
    if (pending === undefined) throw new Error('there is no pending connection request')
    const decision = payload.decision === 'allow'
    if (decision) {
      const grant = payload.grant !== undefined && payload.grant !== null ? payload.grant : pending.defaultGrant
      const clean = setGrantFor(pending.deviceId, grant, { persist: payload.remember !== false })
      grants[pending.deviceId] = clean
      audit({
        peer: pending.deviceId,
        action: 'pairing.approve',
        allowed: true,
        detail: `roots=${clean.roots.join('|')} write=${clean.write} shell=${clean.shell} relay=${clean.relay !== false}`,
      })
    } else {
      trustStore.rejectPeer(pending.deviceId)
      audit({ peer: pending.deviceId, action: 'pairing.reject', allowed: false })
    }
    pending.answer(decision)
    return { decided: decision ? 'allow' : 'deny', deviceId: pending.deviceId }
  }

  function revokeGrant(deviceId) {
    delete grants[deviceId]
    trustStore.revokePeer(deviceId)
    persistGrants()
    const live = state.incoming.get(deviceId)
    if (live !== undefined) {
      live.session.close('grant_revoked')
      state.incoming.delete(deviceId)
    }
    audit({ peer: deviceId, action: 'grant.revoke', allowed: true })
    notify()
    return { ok: true }
  }

  function setGrant(deviceId, grant) {
    const clean = setGrantFor(deviceId, grant, { persist: true })
    const record = state.incoming.get(deviceId)
    if (record !== undefined) {
      // Bind the new grant to the live session: the authorizer, the executor and
      // the exposed target list all read the refreshed view, so a downgrade
      // takes effect on the very next call rather than at the next reconnect.
      record.refresh(clean)
      try {
        record.session.send({ t: 'evt', kind: 'grant', table: clean })
      } catch (error) {
        log.warn('could not push the updated grant', error?.message ?? error)
      }
    }
    audit({ peer: deviceId, action: 'grant.set', allowed: true, detail: `write=${clean.write} shell=${clean.shell}` })
    notify()
    return clean
  }

  function auditTail(limit = 40) {
    const n = Number.isFinite(limit) ? Math.min(300, Math.max(1, Math.round(limit))) : 40
    return { rows: auditRing.slice(-n).reverse() }
  }

  /**
   * Whether the control-plane tools should be in the model's catalog.
   *
   * These five tools (`bridge_devices`, `bridge_connect`, `bridge_pair`,
   * `bridge_approve`, `bridge_disconnect`) are the ENTIRE user interface when
   * there is no browser panel — 极简模式 with its single persistent shell, or a
   * headless host. They are not free, though: every registered tool is part of
   * the catalog of every session, and injecting bridge tools into an unrelated
   * preset that deliberately ships one tool would be bad citizenship.
   *
   * `auto` (the default) therefore registers them exactly while the bridge is
   * "in play": this machine is 桥接侧, a pairing window is open, a request is
   * waiting, a link or session exists, or a peer is visible on the LAN. On a
   * dual-machine debugging setup that is the whole time the bridge matters, and
   * it is never the case on a machine that has never seen another device.
   *
   * Set `config.controlTools` to `'always'` for a terminal-only host whose peer
   * may not be discoverable, or to `'never'` for a pristine catalog.
   */
  function controlToolsVisible() {
    const mode = config.controlTools ?? 'auto'
    if (mode === 'always') return true
    if (mode === 'never') return false
    if (state.role === 'bridge') return true
    if (state.pairing !== null) return true
    if (state.pendingRequests.size > 0) return true
    if (state.links.size > 0 || state.incoming.size > 0) return true
    return discovery.list().length > 0
  }

  function snapshot() {
    const peers = discovery.list().map((peer) => {
      const known = trustStore.getPeer(peer.deviceId)
      const linked = state.links.get(peer.deviceId)
      return {
        deviceId: peer.deviceId,
        name: peer.name,
        os: peer.os,
        arch: peer.arch,
        host: peer.host,
        port: peer.port,
        lastSeenMs: peer.lastSeenMs,
        trusted: known?.trusted === true && known.pubKey === peer.publicKey,
        fingerprint: peer.fingerprint,
        // Identity travels in the announce: a machine that cannot be connected to
        // is greyed out instead of offering a button that always fails.
        role: peer.role ?? 'unknown',
        accepts: peer.accepts !== false,
        relayDevices: peer.relay?.devices ?? 0,
        connected: linked !== undefined && linked.state === 'connected',
      }
    })
    const links = [...state.links.values()].map((link) => ({
      deviceId: link.deviceId,
      name: link.peerName,
      host: link.peerHost,
      port: link.peerPort,
      state: link.state,
      protocolVersion: link.protocolVersion,
      sas: link.sas,
      trust: link.trust,
      sinceMs: link.sinceMs,
      grant: link.grant ?? null,
      relaySupported: link.relaySupported === true,
      devices: (link.devices ?? []).map((d) => ({
        key: d.key,
        deviceId: d.deviceId,
        name: d.name,
        os: d.os,
        arch: d.arch,
        kind: d.kind === 'local' ? 'direct' : 'relay',
        hops: d.hops ?? (d.kind === 'local' ? 1 : 2),
        path: d.path ?? [],
        grant: d.grant ?? null,
      })),
      reconnect: { attempts: link.reconnectAttempts, wanted: link.wanted === true },
      error: link.error ?? null,
    }))
    const sessions = [...state.incoming.values()].map((record) => ({
      deviceId: record.peer.deviceId,
      name: record.peer.name ?? record.peer.deviceId,
      // Where the peer connects FROM. The bridge side has this on the socket, and
      // a panel that can only say "something is driving this machine" without
      // saying from where is not useful for the decision the user is making.
      host: record.session?.link?.remote?.address ?? null,
      port: record.session?.link?.remote?.port ?? null,
      sinceMs: record.sinceMs,
      sas: record.sas,
      grant: record.grant,
      exposes: exposedTargets(record.grant).map((t) => ({
        key: t.key,
        deviceId: t.deviceId,
        name: t.name,
        kind: t.kind,
        hops: t.hops,
        path: t.path,
        grant: t.grant,
      })),
    }))
    const targets = listTargets().map((t) => ({
      key: t.key,
      deviceId: t.deviceId,
      name: t.name,
      os: t.os,
      arch: t.arch,
      kind: t.kind,
      hops: t.hops,
      path: t.path,
      grant: t.grant,
      linkDeviceId: t.linkDeviceId,
    }))
    const firstConnected = links.find((l) => l.state === 'connected') ?? null
    return {
      role: state.role,
      // R203: the reported claim is the EVIDENCE-BACKED one; the user's intent and the record behind it are
      // beside it, so a reader can tell 'asked to be discoverable' from 'can actually be found'.
      discoverable: discovery.discoverable(),
      discoverableRequested: state.discoverable,
      egress: discovery.egressSummary(),
      accepts: acceptsInbound(),
      port: state.port,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      os: process.platform,
      arch: process.arch,
      protocolVersion: PROTO.max,
      hostBuild: HOST_BUILD,
      protocolRange: PROTO,
      dataDir,
      listenError: state.listenError,
      peers,
      // ---- the multi-device surface ----------------------------------------
      links,
      sessions,
      targets,
      /** True exactly while at least one device can be driven from here. */
      toolsAvailable: targets.length > 0,
      /** True while the control-plane tools belong in the catalog (see above). */
      controlTools: controlToolsVisible(),
      // `supported` is a capability statement, not a setting: this build always
      // speaks the relay convention. Whether a GIVEN peer may relay is per-peer
      // and lives on that peer's grant (`relay`, `relayPeers`).
      relay: { supported: true, maxHops: state.maxHops, reachable: relayTargets().size },
      // ---- compatibility aliases -------------------------------------------
      // An older client bundle still renders one connection; keeping these means
      // a host update never leaves a stale panel blank.
      connection: firstConnected,
      peersConnected: sessions,
      // R320c: the panel needs to know that a MANUAL attempt is waiting for a code, or its own submit button stays
      // disabled and the two-step flow cannot be finished from the UI (measured: "submit-disabled" while the phone
      // was sitting there waiting for its code). Service state, said out loud instead of being knowable only from
      // internals the panel must not reach into.
      pairing: state.pairing,
      awaitingCode: state.manualPair === null ? null : { host: state.manualPair.host, port: state.manualPair.port },
      requests: [...state.pendingRequests.values()].map((r) => ({ ...r, answer: undefined })),
      request: state.pendingRequests.size === 0 ? null : { ...[...state.pendingRequests.values()][0], answer: undefined },
      audit: auditRing.slice(-20).reverse(),
      sasHint:
        '安全码由两端公钥共同推导，两台机器上显示的 6 位安全码相同才说明中间没有人冒充；首次配对时建议核对。',
    }
  }

  /** The single-link view, kept for the older callers and the panel's summary. */
  function connectionSnapshot(deviceId) {
    const link =
      deviceId === undefined || deviceId === null || deviceId === ''
        ? [...state.links.values()].find((l) => l.state === 'connected')
        : state.links.get(deviceId)
    if (link === undefined || link.state !== 'connected') return null
    return {
      state: 'connected',
      peer: {
        deviceId: link.deviceId,
        name: link.peerName,
        os: link.peerInfo?.os ?? '',
        arch: link.peerInfo?.arch ?? '',
      },
      grant: link.grant,
      protocolVersion: link.protocolVersion,
      sinceMs: link.sinceMs,
      sas: link.sas,
      targets: listTargets(),
    }
  }

  return {
    start,
    stop,
    onChange,
    snapshot,
    connectionSnapshot,
    setRole,
    setDiscoverable,
    probe,
    connect,
    disconnect,
    disconnectPeer,
    submitPairingCode,
    decideRequest,
    revokeGrant,
    setGrant,
    auditTail,
    remoteCall,
    ping,
    selfTest,
    listTarget,
    captureMedia,
    openPairingWindow,
    closePairingWindow,
    ensureListening,
    listTargets,
    resolveTarget,
    refreshDevices,
    trustStore,
    policy,
    get role() {
      return state.role
    },
    get dataDir() {
      return dataDir
    },
    _internals: { state, discovery, grants, relayTargets, exposedTargets, intersectGrants },
  }
}

export default { createBridgeService, ROLES, PROTO, sessionSas, parseTargetOp, targetOp }
