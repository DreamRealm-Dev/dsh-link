/**
 * LAN discovery.
 *
 * UDP multicast on a fixed group with a signed announce. Plain multicast would
 * let anyone on the segment inject a fake device into the peer list, so every
 * datagram carries the sender's long-term public key and an Ed25519 signature
 * over its canonical payload; an announce whose signature does not verify is
 * dropped before it can reach the UI.
 *
 * Same-machine discovery matters here (both DSH builds on one PC is the primary
 * test rig), so announces additionally go to 127.0.0.1 and the group is joined on
 * every eligible interface rather than relying on the OS default route — a
 * machine with a VPN adapter otherwise announces only out of that adapter.
 *
 * The announce also carries this machine's IDENTITY — `role`, `accepts` and the
 * relay posture — inside the signed body, so a peer can grey out a machine that
 * cannot accept a connection instead of offering a button that always fails, and
 * cannot lie about it without breaking the signature. A peer running an older
 * build simply announces none of it; the reader substitutes the "unknown" values
 * below and never drops the peer for the missing fields.
 */

import dgram from 'node:dgram'
import os from 'node:os'
import { verifyAnnounce, signAnnounce, randomBytes } from './crypto.js'

export const DEFAULT_GROUP = '239.255.66.66'
export const DEFAULT_PORT = 47653
const MAGIC = 'dsh-lan-bridge/announce/v1'
const ANNOUNCE_INTERVAL_MS = 3000
const PEER_TTL_MS = 15000
/** A /24 sweep is ~250 packets, so repeats are spaced out. */
const SWEEP_MIN_INTERVAL_MS = 5000
/** The identity getters are re-read this often; a change announces without
 *  waiting for the next announce tick. Costs no packets in the steady state. */
const IDENTITY_POLL_MS = 1000
/** The "an older build announces nothing" defaults, in one place. */
const UNKNOWN_RELAY = Object.freeze({ enabled: false, maxHops: 0, devices: 0 })

/** A non-negative integer from somewhere, or 0. Never NaN, never negative. */
function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Relay posture from an announce body, normalised.
 *
 * A build that predates roles announces no `relay` at all; that must read as
 * "this peer relays nothing", never as a malformed peer that gets dropped.
 */
function readRelayInfo(raw) {
  if (raw === null || typeof raw !== 'object') return { ...UNKNOWN_RELAY }
  return { enabled: raw.enabled === true, maxHops: countOf(raw.maxHops), devices: countOf(raw.devices) }
}

/** IPv4 addresses of non-internal interfaces, plus loopback for same-host pairs. */
function localAddresses() {
  const out = ['127.0.0.1']
  try {
    for (const [, addrs] of Object.entries(os.networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && addr.internal !== true) out.push(addr.address)
      }
    }
  } catch {
    /* an exotic host without interfaces is still usable over loopback */
  }
  return [...new Set(out)]
}

/** Dotted-quad to a 32-bit unsigned integer, or null when it is not IPv4. */
function ipToInt(ip) {
  const parts = String(ip).split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    value = ((value << 8) | octet) >>> 0
  }
  return value >>> 0
}

function intToIp(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

/**
 * Every other host in the local subnets, for a unicast probe sweep.
 *
 * Multicast is the cheap way to find peers, but it is also the part of LAN
 * traffic most likely to be silently dropped — macOS gates multicast (not
 * inbound TCP) behind the 本地网络 permission, and a switch with client
 * isolation drops it outright. A unicast sweep of the subnet keeps discovery
 * working in exactly those networks. Subnets wider than /20 are skipped rather
 * than hammering thousands of addresses.
 */
function sweepTargets(limit = 1024) {
  const out = []
  let entries = []
  try {
    entries = Object.values(os.networkInterfaces()).flat()
  } catch {
    return out
  }
  for (const info of entries) {
    if (info === null || info === undefined) continue
    if (info.family !== 'IPv4' || info.internal === true) continue
    const ip = ipToInt(info.address)
    const mask = ipToInt(info.netmask)
    if (ip === null || mask === null) continue
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const hostCount = broadcast - network - 1
    if (hostCount <= 0 || hostCount > 4096) continue
    for (let value = network + 1; value < broadcast && out.length < limit; value += 1) {
      if (value === ip) continue
      out.push(intToIp(value))
    }
  }
  return out
}

export function createDiscovery({
  identity,
  deviceId,
  name,
  os: platform = process.platform,
  arch = process.arch,
  app = 'dsh',
  proto,
  caps = [],
  getPort,
  /**
   * Identity getters. All three are optional: a caller that predates roles still
   * discovers and is still discovered, because a missing getter degrades to the
   * very values an older BUILD announces (`unknown` / "try" / no relay).
   */
  getRole,
  getAccepts,
  getRelay,
  onPeer = () => {},
  onLost = () => {},
  log,
  group = DEFAULT_GROUP,
  port = DEFAULT_PORT,
  /** Port the unicast sweep targets. Always the well-known one, even if this
   *  instance was moved off it, because that is where peers listen. */
  sweepPort = DEFAULT_PORT,
  intervalMs = ANNOUNCE_INTERVAL_MS,
  /** How often the identity getters are compared, to announce a change early. */
  identityPollMs = IDENTITY_POLL_MS,
} = {}) {
  /** @type {Map<string, object>} */
  const peers = new Map()
  let socket = null
  let timer = null
  let enabled = true
  let started = false
  /** When the last unicast sweep went out, for the rate limit. */
  let lastSweepAt = 0
  let seq = 0
  /** Identity of the last announce that actually went out; a change re-announces
   *  immediately instead of waiting for the next interval boundary. */
  let lastIdentity = null
  let lastAnnounceAt = 0

  /**
   * This machine's identity as it will be ANNOUNCED.
   *
   * Every getter is wrapped: a throwing or absent getter must degrade this
   * machine's own announce, never take discovery down and never make us look
   * unreachable. `accepts` defaults to TRUE, because "we do not know" has to mean
   * "try", not "this machine is greyed out everywhere."
   */
  function identityFor() {
    let role = 'unknown'
    try {
      const value = typeof getRole === 'function' ? getRole() : undefined
      if (value === 'agent' || value === 'bridge') role = value
    } catch (error) {
      log?.warn?.('getRole failed', error?.message ?? error)
    }
    let accepts = true
    try {
      const value = typeof getAccepts === 'function' ? getAccepts() : undefined
      if (typeof value === 'boolean') accepts = value
    } catch (error) {
      log?.warn?.('getAccepts failed', error?.message ?? error)
    }
    let relay = { ...UNKNOWN_RELAY }
    try {
      relay = readRelayInfo(typeof getRelay === 'function' ? getRelay() : undefined)
    } catch (error) {
      log?.warn?.('getRelay failed', error?.message ?? error)
    }
    // `accepts` is the caller's answer and is NOT coupled to discoverability: a
    // bridge-side machine is connectable at an address it handed out while it
    // announces nothing. Silence is enforced at the SEND sites below, not by
    // rewriting this value — a non-discoverable machine simply never emits it.
    return { role, accepts: accepts === true, relay }
  }

  /** Cheap comparable form of an identity, for change detection. */
  function identityKeyOf(who) {
    return [who.role, who.accepts === true, who.relay.enabled === true, who.relay.maxHops, who.relay.devices].join('|')
  }

  function buildMessage(type, who = identityFor()) {
    const base = {
      m: MAGIC,
      t: type,
      seq: (seq += 1),
      deviceId,
      name,
      os: platform,
      arch,
      app,
      proto: proto ?? { min: '0.1', max: '0.2' },
      caps,
      port: getPort() ?? 0,
      kb: identity.pub,
      fp: identity.fingerprint,
      discoverable: enabled,
      // Identity rides INSIDE the signed body: `signAnnounce` covers every field
      // except `sig`, so a peer cannot claim a role or a relay posture that is
      // not its own. An older reader re-serialises the same body and verifies
      // the same signature, which is why this stays backwards compatible.
      role: who.role,
      accepts: who.accepts,
      relay: who.relay,
      nonce: randomBytes(8).toString('base64url'),
      tsMs: Date.now(),
    }
    return { ...base, sig: signAnnounce(identity.priv, base).toString('base64url') }
  }

  /**
   * Send an announce right now: multicast out of every real NIC, plus loopback.
   *
   * The loopback leg is not optional — two DSH builds on one PC is the primary
   * rig, and multicast to the group is the part a network drops first.
   *
   * `enabled === false` means this machine does not advertise, so EVERY announce
   * is suppressed here rather than at each call site: no multicast, no loopback,
   * no exception for a startup announce. The service calls `start()` and then
   * `setEnabled(discoverable)` in the same turn, and the socket's bind callback
   * runs after that turn — which is exactly how a non-discoverable machine used
   * to emit one announce and appear in every other machine's peer list.
   */
  function announceNow(reason) {
    if (socket === null || enabled !== true) return false
    const who = identityFor()
    const payload = JSON.stringify(buildMessage('announce', who))
    lastIdentity = identityKeyOf(who)
    lastAnnounceAt = Date.now()
    sendMulticast(payload)
    // The loopback leg is recorded like any other: it is the leg that proves this machine can be found by a
    // peer on this same PC, and until R203 it left no record at all (its send callback was a no-op).
    send(payload, '127.0.0.1', port, '127.0.0.1', 'loopback')
    if (reason === 'identity-change') {
      log?.info?.(`identity changed (role=${who.role} accepts=${who.accepts} relay=${who.relay.enabled ? who.relay.devices : 'off'}); announced immediately`)
    }
    return true
  }

  /**
   * Force a fresh announce.
   *
   * The periodic tick below already notices a role/accepts/relay change on its
   * own, so the service does not have to call this; it exists for a caller that
   * knows the identity just changed and does not want to wait for the poll.
   * Returns false when there is nothing to send (not started, or not
   * discoverable), because an invisible machine must stay invisible.
   */
  function refreshAnnounce() {
    if (started !== true || enabled !== true || socket === null) return false
    return announceNow('refresh')
  }

  /**
   * The single place this socket writes to.
   *
   * `enabled !== true` is enforced HERE as well as at every call site: "does not
   * advertise" has to mean "not one packet identifying this machine leaves the
   * socket", and an invariant that only holds by convention at five call sites is
   * an invariant that breaks at the sixth.
   */
  // R203: what the egress actually DID, per leg. The claim used to be printed before anything was sent, and
  // the per-NIC lines this file wrote were `setMulticastInterface` errors from an UNBOUND socket - a
  // socket-state error dressed up as a NIC verdict. Now an attempt is recorded only after the bind, every leg
  // (each NIC and the loopback leg) has its own row, and `discoverable` is DERIVED from at least one success.
  const egress = { rows: new Map(), attempted: 0, pending: 0, ok: 0, loopbackOk: false, bound: false }
  function recordEgress(leg, ok, detail, kind = 'multicast') {
    const previous = egress.rows.get(leg)
    egress.rows.set(leg, { ok, detail, kind })
    if (ok === true) { egress.ok += 1; if (kind === 'loopback') egress.loopbackOk = true }
    // One line per leg per OUTCOME, not per announce: the tick announces on a cadence, and a log that repeats
    // four lines every tick is a log nobody reads. A leg that keeps failing keeps saying so only when it starts
    // failing or recovers.
    if (previous !== undefined && previous.ok === ok) return
    // ONE record family for the whole announce — `multicast egress via <leg> <result>` — with the KIND of
    // leg named in the detail. The loopback leg used to be written as `loopback egress via ...`, which no
    // reader looking for the announce's legs matches, so the leg a same-machine peer is found on was still a
    // silence in the boot record.
    const what = kind === 'loopback' ? 'loopback unicast leg: ' + detail
      : kind === 'default' ? 'default route (no NIC): ' + detail
        : detail
    log?.info?.(`multicast egress via ${leg} ${ok === true ? 'ok — ' + what : 'unavailable — ' + what}`)
  }

  function send(buffer, address = group, portOverride = port, leg = null, kind = 'multicast') {
    if (socket === null || enabled !== true) return
    if (leg !== null) { egress.attempted += 1; egress.pending += 1 }
    try {
      socket.send(buffer, 0, buffer.length, portOverride, address, (error) => {
        if (leg === null) return
        egress.pending -= 1
        if (error === undefined || error === null) recordEgress(leg, true, String(buffer.length) + ' byte(s)', kind)
        else recordEgress(leg, false, error?.message ?? String(error), kind)
      })
    } catch (error) {
      if (leg !== null) { egress.pending -= 1; recordEgress(leg, false, error?.message ?? String(error), kind) }
      log?.warn?.(`discovery send to ${address} failed`, error?.message ?? error)
    }
  }

  /**
   * Multicast egress is per-interface, not per-destination.
   *
   * A plain `send()` to the group follows the routing table, so on a machine
   * whose default route is a VPN/utun tunnel the announce goes INTO the tunnel
   * and never reaches the segment — while TCP still works over the normal LAN
   * route, which is exactly the "discovery never finds anything but a direct
   * address connects fine" symptom. Pinning the multicast interface to each real
   * NIC sends the announce out of every one of them.
   *
   * Loopback is deliberately excluded: setting it as the multicast interface
   * fails with ENETUNREACH, and same-host delivery is handled separately by a
   * plain unicast to 127.0.0.1.
   */
  function sendMulticast(buffer) {
    if (socket === null || enabled !== true) return
    // R203: an unbound socket turns every attempt into a socket-state error that reads like a NIC verdict.
    // Nothing is measured or claimed before the bind; the bind callback announces, and that is the first
    // announce whose legs are recorded.
    if (egress.bound !== true) return
    const interfaces = localAddresses().filter((address) => address !== '127.0.0.1')
    if (interfaces.length === 0) {
      send(buffer, group, port, '0.0.0.0')
      return
    }
    for (const address of interfaces) {
      try {
        socket.setMulticastInterface(address)
      } catch (error) {
        egress.attempted += 1
        recordEgress(address, false, error?.message ?? String(error))
        continue
      }
      send(buffer, group, port, address)
    }
  }

  function forget(deviceIdKey, reason) {
    if (!peers.has(deviceIdKey)) return
    const peer = peers.get(deviceIdKey)
    peers.delete(deviceIdKey)
    try {
      onLost(peer, reason)
    } catch (error) {
      log?.warn?.('onLost handler failed', error?.message ?? error)
    }
  }

  function expire() {
    const cutoff = Date.now() - PEER_TTL_MS
    for (const [key, peer] of [...peers]) if (peer.lastSeenMs < cutoff) forget(key, 'expired')
  }

  function ingest(msg, rinfo) {
    if (msg === null || typeof msg !== 'object' || msg.m !== MAGIC) return
    if (typeof msg.deviceId !== 'string' || msg.deviceId === '' || msg.deviceId === deviceId) return
    if (typeof msg.kb !== 'string' || typeof msg.sig !== 'string') return
    if (verifyAnnounce(msg.kb, msg) !== true) {
      log?.warn?.(`dropped an announce with an invalid signature from ${rinfo?.address ?? '?'}`)
      return
    }
    if (msg.t === 'probe' && enabled !== true) return // invisible while discoverability is off
    const peer = {
      deviceId: msg.deviceId,
      name: typeof msg.name === 'string' && msg.name !== '' ? msg.name : msg.deviceId,
      os: typeof msg.os === 'string' ? msg.os : '?',
      arch: typeof msg.arch === 'string' ? msg.arch : '?',
      app: typeof msg.app === 'string' ? msg.app : 'dsh',
      proto: msg.proto ?? { min: '0.1', max: '0.2' },
      caps: Array.isArray(msg.caps) ? msg.caps : [],
      port: typeof msg.port === 'number' ? msg.port : 0,
      fingerprint: typeof msg.fp === 'string' ? msg.fp : '',
      publicKey: msg.kb,
      discoverable: msg.discoverable === true,
      // Identity from the SIGNED body. None of these exist in an announce from a
      // build that predates roles, and "unknown" must mean "try": defaulting
      // `accepts` to false would grey out every older peer on the segment.
      role: msg.role === 'agent' || msg.role === 'bridge' ? msg.role : 'unknown',
      accepts: typeof msg.accepts === 'boolean' ? msg.accepts : true,
      relay: readRelayInfo(msg.relay),
      host: rinfo?.address ?? '',
      lastSeenMs: Date.now(),
      firstSeenMs: peers.get(msg.deviceId)?.firstSeenMs ?? Date.now(),
    }
    const known = peers.get(peer.deviceId)
    peers.set(peer.deviceId, peer)
    const changed =
      known === undefined ||
      known.name !== peer.name ||
      known.host !== peer.host ||
      known.port !== peer.port ||
      known.discoverable !== peer.discoverable ||
      known.role !== peer.role ||
      known.accepts !== peer.accepts ||
      known.relay?.enabled !== peer.relay.enabled ||
      known.relay?.maxHops !== peer.relay.maxHops ||
      known.relay?.devices !== peer.relay.devices
    if (changed) {
      log?.info?.(`peer ${peer.name} (${peer.deviceId}) at ${peer.host}:${peer.port}`)
      try {
        onPeer(peer, known === undefined)
      } catch (error) {
        log?.warn?.('onPeer handler failed', error?.message ?? error)
      }
    }
    // Always answer an explicit probe so the other side does not wait — and answer
    // it UNICAST to the prober, because a multicast reply is exactly what a
    // multicast-blocked network would drop. This is what makes the unicast sweep
    // work end to end.
    if (msg.t === 'probe' && enabled === true) {
      const payload = JSON.stringify(buildMessage('announce'))
      if (rinfo !== null && rinfo !== undefined && typeof rinfo.address === 'string' && typeof rinfo.port === 'number') {
        send(payload, rinfo.address, rinfo.port)
      } else {
        sendMulticast(payload)
      }
    }
  }

  function start() {
    if (started) return
    started = true
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (error) => {
      // A unicast sweep provokes ICMP unreachable/refused from hosts that are up
      // but not running this plugin. Those are expected answers, not socket
      // failures: closing on them would kill discovery the moment the sweep runs.
      const code = error?.code
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EPERM' || code === 'EACCES') {
        log?.info?.(`discovery: ${code} while sweeping (expected for hosts without the plugin)`)
        return
      }
      log?.warn?.('discovery socket error', error?.message ?? error)
      try {
        socket?.close()
      } catch {
        /* already closed */
      }
      socket = null
    })
    socket.on('message', (buffer, rinfo) => {
      let msg
      try {
        msg = JSON.parse(buffer.toString('utf8'))
      } catch {
        return
      }
      ingest(msg, rinfo)
    })
    socket.bind(port, () => {
      for (const address of localAddresses()) {
        try {
          socket.addMembership(group, address)
        } catch (error) {
          // A VPN/loopback adapter that cannot carry multicast is expected.
          log?.info?.(`multicast join on ${address} skipped`, error?.message ?? error)
        }
      }
      try {
        socket.setMulticastTTL(1) // never leaves the local segment
        socket.setMulticastLoopback(true)
      } catch {
        /* optional tuning */
      }
      egress.bound = true
      log?.info?.(`discovery listening on ${group}:${port} (${localAddresses().join(', ')})`)
      announceNow('start')
      if (timer === null) {
        // One timer, two cadences: the getters are compared every identityPollMs
        // so a role/accepts/relay change announces within a second, while actual
        // announce packets still go out once per intervalMs in the steady state.
        timer = setInterval(() => {
          expire()
          if (enabled !== true) return
          const key = identityKeyOf(identityFor())
          if (key === lastIdentity && Date.now() - lastAnnounceAt < intervalMs) return
          announceNow(key === lastIdentity ? 'tick' : 'identity-change')
        }, Math.max(250, Math.min(identityPollMs, intervalMs)))
        timer.unref?.()
      }
    })
  }

  function stop() {
    if (timer !== null) clearInterval(timer)
    timer = null
    started = false
    const active = socket
    socket = null
    try {
      active?.close()
    } catch {
      /* already closed */
    }
    peers.clear()
  }

  function setEnabled(next) {
    enabled = next === true
    if (enabled === true) {
      // Coming back into view announces at once, multicast AND loopback: a peer on
      // this very machine must not have to wait for the next tick.
      announceNow('enabled')
    } else {
      // Going dark is immediate and total. Forgetting what was announced also
      // means the first tick after re-enabling cannot be skipped as "nothing
      // changed".
      lastIdentity = null
      lastAnnounceAt = 0
    }
    return enabled
  }

  /**
   * Active probe: ask over multicast, over loopback, AND by unicast sweep.
   *
   * The sweep is what makes 「重新扫描」 work in a network that drops multicast —
   * which is the common case on macOS, where the 本地网络 permission gates
   * multicast while leaving inbound TCP alone (so a direct address connects while
   * discovery finds nothing). Replies come back unicast, so this direction works
   * even when both halves have multicast blocked.
   *
   * A probe packet IS this machine's announcement: it is signed with our key and
   * carries our device id, name, port and identity, and every peer that receives
   * one lists us (and answers unicast). So a machine that is not discoverable
   * sends none of it — it still LISTENS, keeps listing whatever it hears, and
   * still answers the caller with the peer list it has.
   */
  function probe(waitMs = 1200) {
    if (!started) start()
    const settle = () =>
      new Promise((resolve) => {
        const done = setTimeout(() => resolve(list()), waitMs)
        done.unref?.()
      })
    if (enabled !== true) {
      log?.info?.('discovery probe suppressed: this machine does not announce itself')
      return settle()
    }
    const buffer = JSON.stringify(buildMessage('probe'))
    sendMulticast(buffer)
    // Loopback goes to the WELL-KNOWN port, not this instance's own: a peer on the
    // same machine may be the one we are looking for, and it listens there.
    send(buffer, '127.0.0.1', sweepPort)
    // A sweep is ~250 packets per /24, so it is rate limited: a panel button that
    // can be clicked repeatedly, or a retry loop, must not turn into a flood.
    let swept = 0
    if (Date.now() - lastSweepAt >= SWEEP_MIN_INTERVAL_MS) {
      lastSweepAt = Date.now()
      for (const address of sweepTargets()) {
        send(buffer, address, sweepPort)
        swept += 1
      }
    }
    log?.info?.(`discovery probe sent: multicast + loopback + ${swept} unicast subnet targets`)
    return settle()
  }

  function list() {
    return [...peers.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * R203: the discoverability claim, derived from evidence.
   *
   * `enabled` is the user's intent; this is what the machine can support. True only when at least one leg
   * of the first announce was recorded as sent (a NIC or the loopback leg). The summary is printed beside the
   * claim so a reader never has to infer which legs worked from the absence of lines.
   */
  function discoverable() {
    if (enabled !== true) return false
    // DERIVED FROM THE LATEST ROW PER LEG, not from a cumulative counter: a machine whose egress worked once and
    // fails now is not discoverable now. (A counter would ratchet to true and never come back - the claim would
    // stop following the evidence after the first success.)
    // NIC legs only: the loopback unicast leg on its own proves a peer on THIS machine was reached, not that
    // any peer on the LAN can see this device — and the announce's NIC results are what 'discoverable' means.
    return [...egress.rows.values()].some((row) => row.ok === true && row.kind !== 'loopback')
  }
  /** R203: the NIC count behind a false claim, so the line can say 'no working egress: 3/3 NIC(s) failed'. */
  function egressCounts() {
    const rows = [...egress.rows.values()].filter((row) => row.kind !== 'loopback')
    return { attempted: rows.length, worked: rows.filter((row) => row.ok === true).length }
  }
  function egressSummary() {
    const rows = [...egress.rows.entries()]
    const ok = rows.filter(([, row]) => row.ok === true).map(([leg]) => leg)
    const bad = rows.filter(([, row]) => row.ok !== true).map(([leg]) => leg)
    return String(ok.length) + '/' + String(rows.length) + ' leg(s) ok' + (ok.length > 0 ? ' (' + ok.join(', ') + ')' : '')
      + (bad.length > 0 ? '; failed: ' + bad.join(', ') : '')
  }
  /** Resolve once the first announce's legs have all reported, or after `ms` (whichever comes first). */
  function egressSettled(ms = 1200) {
    return new Promise((done) => {
      const started = Date.now()
      const tick = () => {
        if (egress.attempted > 0 && egress.pending === 0) return done(true)
        if (Date.now() - started > ms) return done(false)
        setTimeout(tick, 25)
      }
      tick()
    })
  }

  return {
    start,
    stop,
    setEnabled,
    /** R203: the claim derived from recorded egress, and the record it came from. */
    discoverable,
    egressCounts,
    egressSummary,
    egressSettled,
    probe,
    list,
    /**
     * Announce the current identity immediately.
     *
     * The tick already detects a role/accepts/relay change by itself, so nothing
     * has to call this; it is here for a caller that wants the packet out without
     * waiting for the poll. False means nothing was sent — not started, or not
     * discoverable, in which case staying invisible is the correct behaviour.
     */
    refreshAnnounce,
    /** The identity as it would be announced right now (diagnostics only). */
    currentIdentity: identityFor,
    get enabled() {
      return enabled
    },
    get started() {
      return started
    },
    forget,
    localAddresses,
  }
}

export default { createDiscovery, DEFAULT_GROUP, DEFAULT_PORT, IDENTITY_POLL_MS }
