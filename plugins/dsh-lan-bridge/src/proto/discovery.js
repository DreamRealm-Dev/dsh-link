/**
 * discovery.js — LAN presence: UDP multicast announce/probe/reply, multi-NIC.
 *
 * Zero dependencies (node:dgram, node:os, node:crypto).
 *
 * WHAT THE PROBES ON THIS WINDOWS BOX SHOWED (and why the design looks odd)
 * ------------------------------------------------------------------------
 * Verified experimentally before writing this file (see the report §1):
 *   1. `setMulticastInterface('127.0.0.1')` succeeds but the next send fails
 *      with ENETUNREACH. So an egress interface must be a *real* non-internal
 *      IPv4 address, and a per-NIC send failure must be survivable.
 *   2. Multicast only loops back to the same host when the egress interface is
 *      a real NIC *and* `setMulticastTTL(1)`+`setMulticastLoopback(true)` are
 *      set *after* bind. Option calls before bind fail (EBADF for
 *      setBroadcast on Windows).
 *   3. Two processes co-binding the fixed UDP port with SO_REUSEADDR both
 *      "succeed", but on Windows only the FIRST binder receives. Therefore a
 *      single fixed port is not a per-instance channel: every instance also
 *      binds an ephemeral unicast port and advertises it, and probes are sent
 *      FROM that port so replies come back to the asking instance.
 *   4. Subnet-directed and limited broadcast both work and are used as a
 *      fallback when multicast is filtered (some managed/VPN networks drop
 *      224.0.0.0/4, and a Windows Firewall inbound rule is often missing).
 *
 * SOCKET LAYOUT PER PROCESS
 *   rx   : bound 0.0.0.0:DISCOVERY_PORT, SO_REUSEADDR, joined per NIC.
 *          Receives announces; sends announces (multicast + broadcast).
 *   uni  : bound 0.0.0.0:0 (ephemeral). Sends probes (so replies are unicast
 *          back to this exact instance) and receives replies. Also carries a
 *          TCP-less "hello, I exist" fallback.
 * A missing/failed rx is not fatal: probes + replies still work.
 *
 * WHAT A DEVICE ADVERTISES
 *   {m, v, t:'announce'|'probe'|'reply'|'bye', deviceId, name, roles, port,
 *    tcp:[...], proto:{min,max}, caps, features, fp, kb, ins, nonce, ts, sig}
 * `kb` is the long-term Ed25519 public key and `sig` signs the canonical JSON of
 * everything else. Unpaired devices are trusted on first use (TOFU) but marked
 * unverified; a *pinned* deviceId presenting a different key is rejected and
 * surfaced as `key_changed` — discovery must never silently accept a new key.
 *
 * macOS: on macOS 15+ the first local-network use triggers the TCC prompt
 * ("…would like to find and connect to devices on your local network"),
 * attributed to the *app bundle*, not to node. Denial does not raise an error:
 * sockets bind, sends "succeed", and nothing is received (or sends fail with
 * EPERM/EHOSTUNREACH). Detection + user guidance lives in
 * `platformNotes()`. An unsigned standalone node process launched by the app
 * inherits the app's identity; a process launched from a terminal inherits the
 * terminal's, which is why "it works in Terminal but not in the app" happens.
 */

import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import * as C from './crypto.js';

/** Administratively scoped IPv4 multicast group (239.0.0.0/8 = organization-local). */
export const DISCOVERY_GROUP = '239.255.77.42';
/** Fixed discovery port. IANA-unassigned; keep it configurable for tests. */
export const DISCOVERY_PORT = 47823;
/** Preferred TCP port for the bridge listener (reduces firewall friction). */
export const PREFERRED_TCP_PORT = 47824;
/** Hard cap so a discovery datagram never fragments on a 1500 byte MTU. */
export const MAX_DATAGRAM = 1200;
/** Discovery-layer protocol magic, checked on every inbound datagram. */
export const DISCOVERY_MAGIC = 'dsh-lan-bridge/1';
/** Multicast TTL: 1 keeps announcements on the local link (never routed). */
export const MULTICAST_TTL = 1;
export const ANNOUNCE_INTERVAL_MS = 30000;
export const ANNOUNCE_BURST = 3;
export const ANNOUNCE_BURST_GAP_MS = 1500;
export const PEER_TTL_MS = 120000;
export const REPLY_JITTER_MS = 200;
export const MIN_RATE_MS = 50;

const isWindows = process.platform === 'win32';
const isDarwin = process.platform === 'darwin';

// ---------------------------------------------------------------------------
// Interface selection
// ---------------------------------------------------------------------------

/** Names that are almost always virtual/VPN adapters. */
const VIRTUAL_PATTERNS = [
  /vmware/i, /vmnet/i, /virtualbox/i, /vbox/i, /hyper-?v/i, /vethernet/i, /wsl/i,
  /docker/i, /^br-/, /^veth/i, /^utun/i, /^ipsec/i, /^tap/i, /^tun\d/i, /tailscale/i,
  /zerotier/i, /hamachi/i, /radmin/i, /^ppp/i, /^nordlynx/i, /^proton/i, /^wg\d/i,
  /bluetooth/i, /^lo\d?$/, /loopback/i, /^awdl/i, /^llw/i, /^bridge\d/i, /^anpi/i,
  /thunderbolt/i, /^nap/i, /^gpd/i, /^zt/i,
];
/** Names that are almost always the real LAN adapter. */
const PHYSICAL_PATTERNS = [
  /^en\d/i, /^eth\d/i, /^ethernet/i, /^wi-?fi/i, /^wlan/i, /^wl\d/i, /^wlp/i,
  /^enp/i, /^eno/i, /^ens/i, /^以太网/, /^无线/, /^本地连接/,
];

function toInt(ip) {
  return ip.split('.').reduce((a, o) => ((a << 8) >>> 0) + (Number(o) & 0xff), 0) >>> 0;
}
function fromInt(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** True when `ip` is inside `address/netmask`. */
export function inSubnet(ip, address, netmask) {
  if (!netmask || !ip || !address) return false;
  const m = toInt(netmask);
  return (toInt(ip) & m) >>> 0 === (toInt(address) & m) >>> 0;
}

/** Subnet-directed broadcast address for an interface. */
export function broadcastAddress(address, netmask) {
  const m = toInt(netmask);
  return fromInt((((toInt(address) & m) | (~m >>> 0)) >>> 0));
}

/**
 * Enumerate usable IPv4 interfaces, best first.
 *
 * Range filtering is deliberately conservative:
 *   - skip 169.254.0.0/16 (APIPA: no DHCP, no LAN)
 *   - skip 100.64.0.0/10  (CGNAT, which is what Tailscale hands out)
 *   - do NOT skip public ranges: a corporate LAN may legitimately use them.
 * Virtual adapters are not skipped either — they are scored lower and tried
 * last, because a wrong guess costs one failed send while a missing adapter
 * costs a whole network.
 *
 * @param {{includeVirtual?:boolean, preferredSubnets?:string[]}} [opts]
 * @returns {Array<{name:string,address:string,netmask:string,broadcast:string,mac:string,score:number,kind:'physical'|'virtual'|'other'}>}
 */
export function listCandidateInterfaces(opts = {}) {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const addr = a.address;
      if (addr.startsWith('169.254.')) continue; // APIPA
      const inCgnat = inSubnet(addr, '100.64.0.0', '255.192.0.0');
      if (inCgnat) continue; // carrier-grade NAT / Tailscale
      const virtual = VIRTUAL_PATTERNS.some((re) => re.test(name));
      const physical = PHYSICAL_PATTERNS.some((re) => re.test(name));
      const kind = physical ? 'physical' : virtual ? 'virtual' : 'other';
      if (virtual && opts.includeVirtual === false) continue;
      let score = 0;
      if (physical) score += 40;
      if (virtual) score -= 40;
      if (/^10\./.test(addr) || /^192\.168\./.test(addr) || /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score += 10;
      if (opts.preferredSubnets?.length) {
        for (const subnet of opts.preferredSubnets) {
          const [net, mask] = String(subnet).split('/');
          const implied = mask ? fromInt(~(2 ** (32 - Number(mask)) - 1) >>> 0) : '255.255.255.0';
          if (inSubnet(addr, net, implied)) score += 25;
        }
      }
      out.push({
        name,
        address: addr,
        netmask: a.netmask ?? '255.255.255.0',
        broadcast: broadcastAddress(addr, a.netmask ?? '255.255.255.0'),
        mac: a.mac ?? '',
        score,
        kind,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

/** Platform-specific guidance about permissions/firewall. */
export function platformNotes() {
  if (isWindows) {
    return {
      platform: 'windows',
      needsUserAction: true,
      summary: 'Windows Defender Firewall must allow inbound UDP 47823 and inbound TCP on the bridge port for private/domain networks.',
      detail: [
        'The first time the bridge listens, Windows usually shows an "Allow access" dialog; if it was dismissed, add rules manually:',
        '  netsh advfirewall firewall add rule name="DSH LAN Bridge (discovery UDP)" dir=in action=allow protocol=UDP localport=47823 profile=private,domain',
        '  netsh advfirewall firewall add rule name="DSH LAN Bridge (bridge TCP)" dir=in action=allow protocol=TCP localport=47824 profile=private,domain',
        'The network profile must be Private or Domain; on a Public profile Windows blocks inbound by default.',
        'Hyper-V/VMware/WSL virtual adapters appear in discovery and are tried last; they can also produce phantom peers on the same host.',
      ],
      firewallCommands: [
        'netsh advfirewall firewall add rule name="DSH LAN Bridge (discovery UDP)" dir=in action=allow protocol=UDP localport=47823 profile=private,domain',
        'netsh advfirewall firewall add rule name="DSH LAN Bridge (bridge TCP)" dir=in action=allow protocol=TCP localport=47824 profile=private,domain',
      ],
    };
  }
  if (isDarwin) {
    return {
      platform: 'macos',
      needsUserAction: true,
      summary: 'macOS 15+ asks for "Local Network" permission on first use; denial is silent (sockets bind, nothing arrives).',
      detail: [
        'The prompt is attributed to the responsible app bundle. Launching the same code from Terminal gives it the terminal\'s identity, so behaviour differs.',
        'Denial symptoms: UDP binds fine, sends "succeed", zero packets received; or sends fail with EPERM/EHOSTUNREACH. TCP to a LAN address is also blocked.',
        'Fix: System Settings > Privacy & Security > Local Network > enable DeepSeek Harness, then RELAUNCH the app (the decision is cached per process).',
        'The Info.plist needs NSLocalNetworkUsageDescription; add NSBonjourServices only if you also browse mDNS (this module does not).',
        'If the macOS application firewall is on, also allow incoming connections for the app, or the peer cannot reach the bridge TCP port.',
      ],
      settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork',
    };
  }
  return { platform: process.platform, needsUserAction: false, summary: 'No local-network permission prompt on this platform.', detail: [] };
}

// ---------------------------------------------------------------------------
// Discovery service
// ---------------------------------------------------------------------------

let instanceCounter = 0;

export class Discovery extends EventEmitter {
  /**
   * @param {{
   *   deviceId: string, name?: string, roles?: string[], tcpPort?: number,
   *   protocolVersion?: {min:string,max:string}, caps?: string[], features?: object,
   *   identity?: {pub:string, priv:string, fingerprint:string},
   *   trustStore?: C.TrustStore|null,
   *   group?: string, port?: number, staticPeers?: Array<{host:string,port?:number}>,
   *   includeVirtual?: boolean, broadcastFallback?: boolean, log?: Function
   * }} opts
   */
  constructor(opts) {
    super();
    if (!opts || !opts.deviceId) throw new Error('discovery: deviceId is required');
    this.deviceId = opts.deviceId;
    this.name = opts.name ?? os.hostname();
    this.roles = opts.roles ?? ['agent'];
    this.tcpPort = opts.tcpPort ?? null;
    this.protocolVersion = opts.protocolVersion ?? { min: '0.1', max: '0.2' };
    this.caps = opts.caps ?? [];
    this.features = opts.features ?? {};
    this.identity = opts.identity ?? C.generateIdentity();
    this.trustStore = opts.trustStore ?? null;
    this.group = opts.group ?? DISCOVERY_GROUP;
    this.port = opts.port ?? DISCOVERY_PORT;
    this.staticPeers = opts.staticPeers ?? [];
    this.includeVirtual = opts.includeVirtual !== false;
    this.broadcastFallback = opts.broadcastFallback !== false;
    this.log = opts.log ?? (() => {});
    this.instanceId = `${process.pid.toString(36)}-${(++instanceCounter).toString(36)}`;

    this.rx = null;
    this.uni = null;
    this.rxAvailable = false;
    this.uniPort = null;
    this.interfaces = [];
    /** @type {Map<string, object>} deviceId -> peer record */
    this.peers = new Map();
    this.started = false;
    this.stats = {
      announcesSent: 0, probesSent: 0, repliesSent: 0, datagramsReceived: 0,
      dropped: 0, badSignature: 0, keyChanged: 0, sendErrors: 0, rateLimited: 0,
    };
    this._rate = new Map(); // source ip -> {count, windowStart}
    this._replyRate = new Map();
    this._seen = new Map(); // dedupe key -> ts
    this._failedEgress = new Map(); // iface address -> retry-after ts
    this._timers = [];
  }

  /** Snapshot advertised to peers (never includes private material). */
  descriptor(extra = {}) {
    const tcp = this.interfaces
      .filter((i) => this.tcpPort)
      .map((i) => `${i.address}:${this.tcpPort}`);
    return {
      m: DISCOVERY_MAGIC,
      v: 1,
      deviceId: this.deviceId,
      name: this.name,
      roles: this.roles,
      ins: this.instanceId,
      port: this.uniPort,
      tcp,
      proto: this.protocolVersion,
      caps: this.caps,
      features: this.features,
      fp: this.identity.fingerprint,
      kb: this.identity.pub,
      ts: Date.now(),
      ...extra,
    };
  }

  _sign(msg) {
    const sig = C.signAnnounce(this.identity.priv, msg);
    msg.sig = sig.toString('base64url');
    return msg;
  }

  // ---- lifecycle --------------------------------------------------------

  /** Bind sockets and start announcing. Safe to call once. */
  async start() {
    if (this.started) return this;
    this.interfaces = listCandidateInterfaces({ includeVirtual: this.includeVirtual });
    this.log('discovery: interfaces', this.interfaces.map((i) => `${i.name}=${i.address}(${i.kind},${i.score})`).join(' '));

    // 1. instance unicast socket (ephemeral) — this is our reply address.
    this.uni = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._wireSocket(this.uni, 'uni');
    await new Promise((resolve, reject) => {
      this.uni.once('error', reject);
      this.uni.bind({ port: 0, address: '0.0.0.0', exclusive: false }, () => {
        this.uniPort = this.uni.address().port;
        try { this.uni.setBroadcast(true); } catch (err) { this.log('discovery: uni setBroadcast failed', err.code); }
        resolve();
      });
    });

    // 2. shared announce socket (fixed port, best effort).
    this.rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._wireSocket(this.rx, 'rx');
    await new Promise((resolve) => {
      const done = (ok, why) => {
        this.rxAvailable = ok;
        if (!ok) this.log('discovery: fixed port unavailable', why, '- continuing with probes only');
        resolve();
      };
      this.rx.once('error', (err) => done(false, err.code));
      this.rx.bind({ port: this.port, address: '0.0.0.0', exclusive: false }, () => {
        try { this.rx.setMulticastTTL(MULTICAST_TTL); } catch (err) { this.log('discovery: TTL failed', err.code); }
        try { this.rx.setMulticastLoopback(true); } catch (err) { this.log('discovery: loopback failed', err.code); }
        for (const iface of this.interfaces) {
          try {
            this.rx.addMembership(this.group, iface.address);
            this.log(`discovery: joined ${this.group} on ${iface.name} (${iface.address})`);
          } catch (err) {
            // One bad NIC must not kill discovery: VPN adapters disappear,
            // Hyper-V switches refuse membership, etc.
            this.log(`discovery: addMembership failed on ${iface.address}: ${err.code || err.message}`);
          }
        }
        done(true, 'ok');
      });
    });

    this.started = true;
    // Startup burst so the other side is found quickly, then steady state.
    for (let i = 0; i < ANNOUNCE_BURST; i++) {
      this._timer(() => this.announceNow(), i * ANNOUNCE_BURST_GAP_MS);
    }
    this._timer(() => this.probeNow(), 250);
    this._interval(() => this.announceNow(), ANNOUNCE_INTERVAL_MS);
    this._interval(() => this._prunePeers(), 15000);
    this._interval(() => this.probeNow(), 30000);
    return this;
  }

  async stop({ bye = true } = {}) {
    if (!this.started) return this;
    if (bye) { try { this._sendControl('bye'); } catch { /* ignore */ } }
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    for (const s of [this.rx, this.uni]) {
      if (!s) continue;
      try { s.close(); } catch { /* already closed */ }
    }
    this.rx = null; this.uni = null;
    this.started = false;
    return this;
  }

  _timer(fn, ms) {
    const t = setTimeout(() => { if (this.started) fn(); }, ms);
    t.unref?.();
    this._timers.push(t);
    return t;
  }

  _interval(fn, ms) {
    const t = setInterval(() => { if (this.started) fn(); }, ms);
    t.unref?.();
    this._timers.push(t);
    return t;
  }

  // ---- sockets ----------------------------------------------------------

  _wireSocket(socket, tag) {
    socket.on('message', (buf, rinfo) => this._onDatagram(buf, rinfo, tag));
    socket.on('error', (err) => {
      this.emit('socketError', { tag, code: err.code, message: err.message });
    });
  }

  /** Send one datagram out of every interface, via multicast and/or broadcast. */
  _sendAll(msg, { from = 'rx', broadcast = true } = {}) {
    const socket = from === 'uni' ? this.uni : (this.rxAvailable ? this.rx : this.uni);
    if (!socket) return 0;
    let payload;
    try {
      payload = Buffer.from(JSON.stringify(msg), 'utf8');
    } catch (err) {
      this.emit('error', err);
      return 0;
    }
    if (payload.length > MAX_DATAGRAM) {
      this.emit('error', new Error(`discovery: datagram ${payload.length} > ${MAX_DATAGRAM} bytes`));
      return 0;
    }
    let sent = 0;
    const now = Date.now();
    for (const iface of this.interfaces) {
      const retryAt = this._failedEgress.get(iface.address) ?? 0;
      if (retryAt > now) continue;
      // The egress interface is per-send state on the socket, so it must be set
      // immediately before every send (probe finding #1/#2).
      try { socket.setMulticastInterface(iface.address); } catch (err) {
        this.log(`discovery: setMulticastInterface(${iface.address}) failed: ${err.code}`);
        this._failedEgress.set(iface.address, now + 60000);
        continue;
      }
      socket.send(payload, this.port, this.group, (err) => {
        if (err) {
          this.stats.sendErrors++;
          // ENETUNREACH/EACCES/EADDRNOTAVAIL: this NIC cannot carry multicast.
          this._failedEgress.set(iface.address, Date.now() + 60000);
          this.emit('egressFailed', { iface: iface.address, code: err.code });
        }
      });
      sent++;

      if (broadcast && this.broadcastFallback) {
        for (const target of new Set(['255.255.255.255', iface.broadcast])) {
          try { socket.send(payload, this.port, target, (err) => { if (err) this.stats.sendErrors++; }); sent++; }
          catch (err) { this.log(`discovery: broadcast to ${target} failed: ${err.code}`); }
        }
      }
    }
    for (const peer of this.staticPeers) {
      // Cross-subnet: multicast will not route, so unicast the probe directly.
      try {
        socket.send(payload, peer.port ?? this.port, peer.host, (err) => { if (err) this.stats.sendErrors++; });
        sent++;
      } catch (err) { this.log(`discovery: static peer ${peer.host} failed: ${err.code}`); }
    }
    return sent;
  }

  _sendTo(address, port, msg, viaSocket = null) {
    const socket = viaSocket ?? this.uni;
    if (!socket) return false;
    try {
      socket.send(Buffer.from(JSON.stringify(msg), 'utf8'), port, address, (err) => {
        if (err) { this.stats.sendErrors++; this.emit('sendError', { address, code: err.code }); }
      });
      return true;
    } catch (err) {
      this.emit('sendError', { address, code: err.code });
      return false;
    }
  }

  // ---- outbound messages ------------------------------------------------

  announceNow() {
    if (!this.started) return 0;
    const msg = this._sign(this.descriptor({ t: 'announce' }));
    const n = this._sendAll(msg, { from: 'rx' });
    this.stats.announcesSent++;
    this.lastAnnounceAt = Date.now();
    return n;
  }

  probeNow() {
    if (!this.started) return 0;
    const nonce = C.randomBytes(8).toString('base64url');
    const msg = this._sign(this.descriptor({ t: 'probe', nonce, replyPort: this.uniPort }));
    const n = this._sendAll(msg, { from: 'uni' }); // replies come back to uni
    this.stats.probesSent++;
    return n;
  }

  _sendControl(t) {
    const msg = this._sign(this.descriptor({ t }));
    return this._sendAll(msg, { from: 'rx' });
  }

  setTcpPort(port) { this.tcpPort = port; return this; }
  setRoles(roles) { this.roles = roles; return this; }
  setCaps(caps) { this.caps = caps; return this; }

  /** Remember which local interface reaches a peer, so TCP dials use its source address. */
  preferredLocalAddress(peerAddress) {
    for (const iface of this.interfaces) {
      if (inSubnet(peerAddress, iface.address, iface.netmask)) return iface.address;
    }
    return null;
  }

  // ---- inbound ----------------------------------------------------------

  _rateLimited(ip, table = this._rate, maxPerWindow = 40, windowMs = 1000) {
    const now = Date.now();
    const rec = table.get(ip);
    if (!rec || now - rec.windowStart > windowMs) {
      table.set(ip, { count: 1, windowStart: now });
      return false;
    }
    rec.count++;
    if (rec.count > maxPerWindow) { this.stats.rateLimited++; return true; }
    return false;
  }

  _onDatagram(buf, rinfo, tag) {
    this.stats.datagramsReceived++;
    if (buf.length > MAX_DATAGRAM) { this.stats.dropped++; return; }
    if (this._rateLimited(rinfo.address)) { this.stats.dropped++; return; }

    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { this.stats.dropped++; return; }
    if (!msg || typeof msg !== 'object' || msg.v !== 1) { this.stats.dropped++; return; }
    if (msg.m !== DISCOVERY_MAGIC) { this.stats.dropped++; return; }
    if (!['announce', 'probe', 'reply', 'bye'].includes(msg.t)) { this.stats.dropped++; return; }
    if (msg.deviceId === this.deviceId && msg.ins === this.instanceId) return; // our own echo
    if (typeof msg.deviceId !== 'string' || msg.deviceId.length > 128) { this.stats.dropped++; return; }

    // Signature policy: a *changed* key for a pinned device is reported first
    // (and refused), because that is the more important signal; then the
    // signature is verified against the pinned key when we have one, TOFU
    // otherwise. Discovery must never silently accept a new key.
    const peerRecord = this.peers.get(msg.deviceId) ?? this.trustStore?.getPeer(msg.deviceId) ?? null;
    let verified = false;
    if (peerRecord?.pubKey && typeof msg.kb === 'string' && peerRecord.pubKey !== msg.kb) {
      this.stats.keyChanged++;
      this.emit('keyChanged', { deviceId: msg.deviceId, address: rinfo.address, expected: peerRecord.pubKey, got: msg.kb });
      return;
    }
    if (typeof msg.sig === 'string' && typeof msg.kb === 'string') {
      const pub = peerRecord?.pubKey ?? msg.kb;
      if (!C.verifyAnnounce(pub, msg)) {
        this.stats.badSignature++;
        this.emit('badSignature', { deviceId: msg.deviceId, address: rinfo.address });
        return;
      }
      verified = !!peerRecord?.pubKey;
    } else if (peerRecord?.pubKey) {
      this.stats.badSignature++;
      this.emit('badSignature', { deviceId: msg.deviceId, address: rinfo.address, reason: 'unsigned announce from a pinned device' });
      return;
    }

    // Deduplicate: the same message arrives up to 3x per NIC (multicast +
    // limited broadcast + subnet broadcast) and again on both sockets.
    const dedupeKey = `${msg.deviceId}|${msg.ins}|${msg.t}|${msg.ts}|${msg.nonce ?? ''}`;
    const now = Date.now();
    if (this._seen.has(dedupeKey) && now - this._seen.get(dedupeKey) < 5000) return;
    this._seen.set(dedupeKey, now);
    if (this._seen.size > 512) {
      for (const [k, ts] of this._seen) if (now - ts > 10000) this._seen.delete(k);
    }

    if (msg.t === 'bye') {
      const p = this.peers.get(msg.deviceId);
      if (p) { this.peers.delete(msg.deviceId); this.emit('peerGone', p, 'bye'); }
      return;
    }

    const iface = this.interfaces.find((i) => inSubnet(rinfo.address, i.address, i.netmask));
    const tcp = Array.isArray(msg.tcp) ? msg.tcp.filter((s) => typeof s === 'string').slice(0, 16) : [];
    const record = {
      deviceId: msg.deviceId,
      name: typeof msg.name === 'string' ? msg.name.slice(0, 128) : '',
      roles: Array.isArray(msg.roles) ? msg.roles.filter((r) => typeof r === 'string').slice(0, 4) : [],
      address: rinfo.address,
      unicastPort: typeof msg.port === 'number' ? msg.port : null,
      replyPort: typeof msg.replyPort === 'number' ? msg.replyPort : null,
      discoveryPort: rinfo.port,
      tcp,
      proto: msg.proto && typeof msg.proto === 'object' ? { min: String(msg.proto.min), max: String(msg.proto.max) } : null,
      caps: Array.isArray(msg.caps) ? msg.caps.filter((c) => typeof c === 'string').slice(0, 32) : [],
      features: msg.features && typeof msg.features === 'object' ? msg.features : {},
      fingerprint: typeof msg.fp === 'string' ? msg.fp : '',
      pubKey: typeof msg.kb === 'string' ? msg.kb : '',
      verified,
      interface: iface ? { name: iface.name, address: iface.address } : null,
      lastSeen: now,
      firstSeen: this.peers.get(msg.deviceId)?.firstSeen ?? now,
      viaSocket: tag,
    };
    // Prefer the address the packet actually came from over anything claimed
    // in the payload: the source address is provably routable from here.
    record.connectHost = rinfo.address;
    record.connectPort = record.tcp.length
      ? Number(String(record.tcp[0]).split(':').pop())
      : null;

    const prev = this.peers.get(msg.deviceId);
    this.peers.set(msg.deviceId, record);
    if (!prev) this.emit('peerUp', record);
    else this.emit('peerUpdate', record);

    if (msg.t === 'probe' && this.roles.includes('bridge')) {
      this._scheduleReply(record, msg, rinfo);
    }
  }

  _scheduleReply(record, probeMsg, rinfo) {
    if (this._rateLimited(rinfo.address, this._replyRate, 5, 1000)) return;
    const jitter = Math.floor(Math.random() * REPLY_JITTER_MS);
    const t = setTimeout(() => {
      if (!this.started) return;
      const reply = this._sign(this.descriptor({
        t: 'reply',
        nonce: probeMsg.nonce,
        to: probeMsg.deviceId,
        replyPort: this.uniPort,
      }));
      // Reply unicast to the port the probe came FROM: that is the asking
      // instance's own socket, which is the only one that can receive it when
      // several DSH instances share this host.
      this._sendTo(rinfo.address, rinfo.port, reply, this.uni);
      this.stats.repliesSent++;
      this.emit('replied', { to: record.deviceId, address: rinfo.address });
    }, jitter);
    t.unref?.();
    this._timers.push(t);
  }

  _prunePeers() {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        this.emit('peerGone', p, 'ttl');
      }
    }
    for (const [k, ts] of this._failedEgress) if (ts < now) this._failedEgress.delete(k);
  }

  /** Bridges the gap between "I can see it" and "I can talk to it". */
  listPeers({ role, verifiedOnly = false } = {}) {
    const out = [];
    for (const p of this.peers.values()) {
      if (role && !p.roles.includes(role)) continue;
      if (verifiedOnly && !p.verified) continue;
      out.push({ ...p });
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** TCP dial hints for the best known bridge, if any. */
  bridgeCandidates() {
    return this.listPeers({ role: 'bridge' })
      .filter((p) => p.connectPort ?? p.unicastPort)
      .map((p) => ({
        deviceId: p.deviceId,
        name: p.name,
        host: p.connectHost,
        port: p.connectPort ?? p.unicastPort,
        localAddress: this.preferredLocalAddress(p.connectHost),
        verified: p.verified,
        fingerprint: p.fingerprint,
        proto: p.proto,
        caps: p.caps,
      }));
  }

  status() {
    return {
      started: this.started,
      deviceId: this.deviceId,
      instanceId: this.instanceId,
      discoveryPort: this.port,
      unicastPort: this.uniPort,
      rxAvailable: this.rxAvailable,
      interfaces: this.interfaces,
      peers: this.listPeers().length,
      stats: { ...this.stats },
      notes: platformNotes(),
    };
  }
}

export default {
  DISCOVERY_GROUP, DISCOVERY_PORT, PREFERRED_TCP_PORT, MAX_DATAGRAM, MULTICAST_TTL,
  ANNOUNCE_INTERVAL_MS, PEER_TTL_MS,
  listCandidateInterfaces, inSubnet, broadcastAddress, platformNotes, Discovery,
};
