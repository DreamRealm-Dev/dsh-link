/**
 * link.js — TCP transport, handshake orchestration and the RPC layer.
 *
 * Zero dependencies (node:net + node:crypto + ./frame.js + ./crypto.js).
 *
 * Transport choice: plain TCP with length-prefixed JSON+binary frames. See
 * report-transport-crypto.md §2 for the full comparison against WebSocket and
 * HTTP; the short version is that both peers are Node processes (no browser),
 * so WebSocket would add an RFC 6455 handshake, masking and framing we would
 * have to implement ourselves, and HTTP would add request/response semantics
 * that do not fit bidirectional streaming of shell output. Raw `net` gives
 * authenticated framing, real backpressure (`write()` -> false + 'drain') and
 * TCP_NODELAY with no dependency at all.
 *
 * This file owns:
 *   - FrameLink:  socket <-> frames, send queue with drain handling,
 *                 heartbeat, idle/handshake timeouts, graceful goaway.
 *   - handshake:  hello/hello_ack, capability negotiation, SPAKE2 pairing or
 *                 TOFU-signature auth, key derivation, key confirmation.
 *   - Session:    encrypted request/response/event RPC with per-request
 *                 timeouts, cancellation, streaming chunks and credit-based
 *                 flow control, plus epoch rekey.
 *
 * This file does NOT own authorization. Every inbound request is handed to an
 * `authorize` callback supplied by the bridge application (see policy.js),
 * which returns allow/deny plus the effective limits for that one operation.
 *
 * Versioning rule (see §6 of the report):
 *   protocolVersion is a {min,max} range; both peers negotiate the highest
 *   common minor. Major must match exactly. Unknown capabilities/features are
 *   ignored; unknown header fields are ignored. An op the peer does not know is
 *   answered with `unsupported` and the connection stays up. Never change the
 *   meaning of an existing field in place.
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import {
  PROTO_MAGIC, MAX_FRAME_BYTES, FrameDecoder, FrameError, encodeFrame, buildAAD,
} from './frame.js';
import * as C from './crypto.js';

/** Protocol versions this implementation speaks. */
export const PROTOCOL_MIN = '0.1';
export const PROTOCOL_MAX = '0.2';

/** Capabilities a bridge can expose. Unknown strings are ignored by design. */
export const CAPABILITIES = Object.freeze([
  'fs.read', 'fs.write', 'fs.list', 'shell.exec', 'sys.info', 'process.spawn',
  // R332: the phone as an INPUT. An end that can record advertises media.capture; an end that cannot does not.
  'media.capture',
]);

/** Feature flags: additive, optional, negotiated by intersection. */
export const FEATURES = Object.freeze({
  streamCredit: true,  // receiver-driven flow control for streamed chunks
  rekey: true,         // in-band epoch rekey
  cancel: true,        // request cancellation
  pathRoots: true,     // grant table carries allowed filesystem roots
  auditStream: false,  // bridge can push audit events to the agent (not yet)
});

/** Default timeouts (ms). Every one of them is a hard limit, not a hint. */
export const DEFAULTS = Object.freeze({
  handshakeTimeoutMs: 10000,
  idleTimeoutMs: 45000,
  pingIntervalMs: 15000,
  requestTimeoutMs: 30000,
  closeGraceMs: 2000,
  maxQueueBytes: 32 * 1024 * 1024,
  maxFrameBytes: MAX_FRAME_BYTES,
  connectTimeoutMs: 8000,
  maxPendingRequests: 256,
});

export class LinkError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'LinkError';
    this.code = code;
    /**
     * The detail as its own field, not only baked into `message`.
     *
     * Callers above this layer report remote failures to a human ("the peer
     * granted read-only access", "not permitted through this chain") and were
     * reading `error.detail`, which did not exist: every remote error therefore
     * lost its explanation and surfaced as a bare `not-granted:`. Keeping the
     * field is what makes a refusal legible at the other end of the wire.
     */
    this.detail = detail;
  }
}

/** Compare dotted numeric version strings. Returns -1/0/1. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Negotiate protocol version + caps + features.
 * Rule: majors must match; the agreed minor is min(max) and must be >= both
 * mins. Capabilities/features are intersected; anything unknown is dropped.
 */
export function negotiate(local, remote, opts = {}) {
  const la = local.proto ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX };
  const ra = remote.proto ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX };
  const localMajor = String(la.min).split('.')[0];
  const remoteMajor = String(ra.min).split('.')[0];
  const remoteMaxMajor = String(ra.max).split('.')[0];
  if (localMajor !== remoteMajor || localMajor !== remoteMaxMajor) {
    return { ok: false, code: 'version_incompatible', reason: `major mismatch local=${la.min}-${la.max} remote=${ra.min}-${ra.max}` };
  }
  const agreedMax = compareVersions(la.max, ra.max) <= 0 ? la.max : ra.max;
  const needMax = compareVersions(la.min, ra.min) >= 0 ? la.min : ra.min;
  if (compareVersions(agreedMax, needMax) < 0) {
    return { ok: false, code: 'version_incompatible', reason: `no overlap local=${la.min}-${la.max} remote=${ra.min}-${ra.max}` };
  }
  // R318/R319: the negotiated caps are an ARRAY in the handshake transcript, so the two ends must build the SAME
  // array - and the order they build it in is the whole problem. This module used to intersect in the CALLER's
  // order, which means the agent hashed its own list's order and the bridge its own: two different byte strings for
  // one agreement, PAKE passing (it covers only code/context/ids) and the session finish failing with "agent
  // confirmation tag mismatch". Sorting is NOT the answer: the Android bridge end is a separate Rust implementation
  // that intersects in ITS OWN capability order (device_bridge.rs `negotiate`), and sorting broke the one pairing
  // that used to work (driver <-> phone regressed the moment it was sorted). The rule both shapes can satisfy is
  // "order by the BRIDGE's advertised list": the bridge keeps its own order (order: 'local'), the agent uses the
  // order of the list the bridge advertised (order: 'remote'), and then a JS agent, a JS bridge and the Rust phone
  // all hash the same array. Feature keys do not need this: canonical JSON sorts object keys on both sides.
  const order = opts.order === 'remote' ? (remote.caps ?? []) : (local.caps ?? []);
  const caps = order.filter((c) => (local.caps ?? []).includes(c) && (remote.caps ?? []).includes(c));
  const features = {};
  for (const k of Object.keys(local.features ?? {}).sort()) {
    const v = (local.features ?? {})[k];
    if (remote.features && Object.prototype.hasOwnProperty.call(remote.features, k)) {
      features[k] = !!(v && remote.features[k]);
    }
  }
  return { ok: true, protocolVersion: agreedMax, caps, features };
}

// ---------------------------------------------------------------------------
// FrameLink
// ---------------------------------------------------------------------------

/**
 * One TCP connection carrying length-prefixed frames.
 *
 * Backpressure policy: `send()` never blocks. Frames are queued while
 * `socket.write()` returns false and flushed on 'drain'. If the queue would
 * exceed `maxQueueBytes` the send is REJECTED (LinkError 'backpressure') rather
 * than buffered without bound: an unbounded queue turns a slow peer into an
 * out-of-memory kill for the bridge. Callers streaming large data must handle
 * 'backpressure' by pausing their producer (the RPC layer does this through
 * stream credits).
 */
export class FrameLink extends EventEmitter {
  /**
   * @param {{socket: net.Socket, role:'agent'|'bridge', opts?: object}} cfg
   */
  constructor(cfg) {
    super();
    if (!cfg || !cfg.socket) throw new LinkError('no_socket');
    this.socket = cfg.socket;
    this.role = cfg.role;
    this.opts = { ...DEFAULTS, ...(cfg.opts ?? {}) };
    this.maxFrameBytes = Math.min(this.opts.maxFrameBytes ?? MAX_FRAME_BYTES, MAX_FRAME_BYTES);

    this.decoder = new FrameDecoder({ maxFrameBytes: this.maxFrameBytes });
    this.queue = [];
    this.queuedBytes = 0;
    this.waitingDrain = false;
    this.closed = false;
    this.closeReason = null;
    this.remote = null;
    this.lastRxAt = Date.now();
    this.lastTxAt = Date.now();
    this._frameHandler = null;
    this._inbox = [];
    this.stats = {
      framesSent: 0, framesReceived: 0, bytesSent: 0, bytesReceived: 0,
      backpressureRejections: 0, drainEvents: 0, decryptFailures: 0,
    };

    this.socket.setNoDelay(true);
    try { this.socket.setKeepAlive(true, 15000); } catch { /* not fatal */ }

    /**
     * These four socket callbacks are the ONLY place this library runs outside a
     * promise, so a throw from any of them — including from an application
     * listener they fan out to — escapes as an uncaught exception, which in the
     * DSH host process means the whole app dies. Contain them at the boundary.
     */
    this.socket.on('data', (chunk) => this._guard(() => this._onData(chunk)));
    this.socket.on('error', (err) => this._guard(() => this._onSocketError(err)));
    this.socket.on('close', () => this._guard(() => this._onSocketClose()));
    this.socket.on('drain', () => this._guard(() => this._onDrain()));
    this.socket.on('end', () => { /* half close: wait for our own close */ });

    /**
     * An `error` event with NO listener THROWS in Node, and this library runs
     * inside the DSH host process — so it was a way to kill the whole app.
     *
     * Measured: a socket error arriving during a handshake, before the
     * application has had any chance to attach its own listener, became an
     * uncaught exception, exited the backend with code 1, and took every session
     * in the app down with it. An error event is a notification, never a reason
     * to abort the process.
     *
     * Nothing is hidden by this listener: the link is torn down by its own close
     * path regardless (`_onSocketError` is followed by the socket's `close`,
     * `_flush` destroys explicitly, and `Session` forwards a link close to the
     * session), so the application still learns about the failure through
     * `close`. The error itself is kept on `lastError` for diagnostics.
     */
    this.lastError = null;
    this.on('error', (error) => {
      this.lastError = error;
    });
  }

  /**
   * Run one entry point that Node invoked for us, so a throw cannot become an
   * uncaught exception. The failure is recorded on `lastError`; the connection's
   * own state is already consistent by the time a fan-out can throw.
   */
  _guard(fn) {
    try {
      return fn();
    } catch (error) {
      this.lastError = error;
      return undefined;
    }
  }

  /** Wrap an already-connected socket. */
  static fromSocket(socket, role, opts) {
    const link = new FrameLink({ socket, role, opts });
    link.remote = { address: socket.remoteAddress, port: socket.remotePort };
    return link;
  }

  /** Open a TCP connection (agent side). */
  static connect({ host, port, role = 'agent', opts = {} } = {}) {
    const timeoutMs = opts.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new LinkError('connect_timeout', `${host}:${port}`));
      }, timeoutMs);
      timer.unref?.();
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(new LinkError('connect_failed', err.code || err.message));
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(FrameLink.fromSocket(socket, role, opts));
      });
    });
  }

  /**
   * Install the frame consumer. Any frames buffered before a handler exists are
   * replayed in order. Passing null removes the handler and lets frames buffer
   * again — this matters during the handshake: each step consumes exactly one
   * message, and a message that arrives between two steps (for example the
   * bridge's `err` right after `hello_ack`) must NOT be dropped just because
   * nobody was listening at that exact instant.
   */
  setFrameHandler(fn) {
    this._frameHandler = fn;
    if (typeof fn !== 'function') return;
    const buffered = this._inbox;
    this._inbox = [];
    for (const f of buffered) fn(f);
  }

  get pendingBytes() { return this.queuedBytes + this.decoder.pendingBytes; }

  _onData(chunk) {
    if (this.closed) return;
    this.lastRxAt = Date.now();
    this.stats.bytesReceived += chunk.length;
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (err) {
      // Framing violations are fatal by construction: the byte stream can no
      // longer be trusted, so the peer must be disconnected.
      this.emit('protocolError', err);
      this.destroy(`framing: ${err.code}`);
      return;
    }
    for (const frame of frames) {
      this.stats.framesReceived++;
      if (this._frameHandler) this._frameHandler(frame);
      else this._inbox.push(frame);
    }
  }

  _onSocketError(err) {
    this.emit('error', new LinkError('socket_error', err.code || err.message));
  }

  _onSocketClose() {
    if (this.closed) return;
    this.closed = true;
    this._clearTimers();
    if (!this.decoder.ok) { /* already reported */ }
    this.emit('close', this.closeReason);
  }

  _onDrain() {
    this.waitingDrain = false;
    this.stats.drainEvents++;
    this._flush();
  }

  /**
   * Queue one frame.
   * @returns {boolean} true when queued+written, false when rejected for backpressure
   */
  sendFrame(frameBuffer) {
    if (this.closed) return false;
    if (this.queuedBytes + frameBuffer.length > this.opts.maxQueueBytes) {
      this.stats.backpressureRejections++;
      this.emit('backpressure', { queuedBytes: this.queuedBytes, attempted: frameBuffer.length });
      return false;
    }
    this.queue.push(frameBuffer);
    this.queuedBytes += frameBuffer.length;
    this._flush();
    return true;
  }

  _flush() {
    if (this.closed || this.waitingDrain) return;
    while (this.queue.length > 0) {
      const buf = this.queue.shift();
      this.queuedBytes -= buf.length;
      this.lastTxAt = Date.now();
      this.stats.framesSent++;
      this.stats.bytesSent += buf.length;
      let ok = false;
      try {
        ok = this.socket.write(buf);
      } catch (err) {
        this.emit('error', new LinkError('write_failed', err.code || err.message));
        this.destroy('write_failed');
        return;
      }
      if (!ok) { this.waitingDrain = true; return; }
    }
    // Queue drained: a pending graceful close can proceed now.
    if (this.queuedBytes === 0) this.emit('drainAll');
  }

  /** Send a cleartext frame (used only during the handshake). */
  sendCleartext(header, payload = null) {
    let buf;
    try {
      buf = encodeFrame(header, payload, { maxFrameBytes: this.maxFrameBytes });
    } catch (err) {
      this.emit('protocolError', err);
      return false;
    }
    return this.sendFrame(buf);
  }

  /** Pause reading (consumer too slow). */
  pauseReading() { try { this.socket.pause(); } catch { /* ignore */ } }
  resumeReading() { try { this.socket.resume(); } catch { /* ignore */ } }

  /** Polite close: tell the peer why, then close (with a hard backstop). */
  destroy(reason = 'destroyed') {
    if (this.closed) return;
    this.closeReason = reason;
    this.closed = true;
    this._clearTimers();
    try { this.socket.destroy(); } catch { /* ignore */ }
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.emit('close', reason);
  }

  /** Graceful shutdown: flush the queue, then FIN, then force after grace. */
  close(reason = 'normal', graceMs = this.opts.closeGraceMs) {
    if (this.closed) return;
    this.closeReason = reason;
    const finish = () => this.destroy(reason);
    if (this.queue.length === 0 && !this.waitingDrain) {
      try { this.socket.end(); } catch { /* ignore */ }
    } else {
      this.once('drainAll', finish);
    }
    const t = setTimeout(finish, graceMs);
    t.unref?.();
  }

  _clearTimers() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
  }

  /** Start heartbeat + idle detection. Timers are unref'd: they never hold the
   *  Electron process open on their own. */
  startHeartbeat(onIdle) {
    const { pingIntervalMs, idleTimeoutMs } = this.opts;
    // Timer callbacks also run outside any promise, so they are guarded for the
    // same reason the socket callbacks are: a throw here kills the host process.
    this._pingTimer = setInterval(() => this._guard(() => {
      if (this.closed) return;
      if (Date.now() - this.lastTxAt >= pingIntervalMs) this.emit('needPing');
    }), Math.max(1000, Math.floor(pingIntervalMs / 3)));
    this._pingTimer.unref?.();
    this._idleTimer = setInterval(() => this._guard(() => {
      if (this.closed) return;
      if (Date.now() - this.lastRxAt > idleTimeoutMs) {
        this.emit('idleTimeout', { lastRxAt: this.lastRxAt });
        if (onIdle) onIdle();
        this.destroy('idle_timeout');
      }
    }), Math.max(1000, Math.floor(idleTimeoutMs / 3)));
    this._idleTimer.unref?.();
    return this;
  }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Random 16 byte session id, hex. */
function newSessionId() {
  return C.randomBytes(16).toString('hex');
}

function nowMs() { return Date.now(); }

/** Await the next frame whose header.t is in `types`. */
async function awaitFrame(link, types, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    // Release the consumer before resolving/rejecting so that anything arriving
    // between this step and the next one is buffered instead of dropped.
    const stop = () => { try { link.setFrameHandler(null); } catch { /* link gone */ } };
    const cleanup = () => {
      clearTimeout(timer);
      link.off('close', onClose);
    };
    const onClose = () => {
      if (done) return;
      done = true;
      cleanup();
      stop();
      reject(new LinkError('closed_during_handshake', label));
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      stop();
      reject(new LinkError('handshake_timeout', label));
    }, timeoutMs);
    timer.unref?.();
    link.once('close', onClose);
    link.setFrameHandler((frame) => {
      if (done) return;
      const t = frame.header && frame.header.t;
      if (!types.includes(t)) {
        done = true;
        cleanup();
        stop();
        reject(new LinkError('unexpected_message', `${t} while waiting for ${types.join('|')}`));
        return;
      }
      done = true;
      cleanup();
      stop();
      resolve(frame);
    });
  });
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * Agent (initiator) side of the handshake.
 *
 * @param {FrameLink} link
 * @param {{
 *   identity: {pub:string, priv:string, fingerprint:string},
 *   deviceId: string, name?: string, app?: string,
 *   caps?: string[], features?: object, proto?: {min:string,max:string},
 *   pairCode?: string|null, trustStore?: C.TrustStore|null,
 *   timeoutMs?: number, onPeer?: (peer:object)=>void, acceptBridgeKey?: (peer:object)=>boolean
 * }} opts
 * @returns {Promise<{session: Session, peer: object, negotiated: object}>}
 */
export async function agentHandshake(link, opts) {
  const timeoutMs = opts.timeoutMs ?? link.opts.handshakeTimeoutMs;
  const sessionId = newSessionId();
  const eph = C.generateEphemeral();
  const nonce = C.randomBytes(24);
  const hello = {
    t: 'hello',
    m: PROTO_MAGIC,
    proto: opts.proto ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX },
    app: opts.app ?? 'unknown',
    caps: opts.caps ?? [],
    features: opts.features ?? FEATURES,
    deviceId: opts.deviceId,
    name: opts.name ?? '',
    role: 'agent',
    sessionId,
    nonce: nonce.toString('base64url'),
    eph: eph.pub.toString('base64url'),
    kb: opts.identity.pub,
    fp: opts.identity.fingerprint,
    wantPair: !!opts.pairCode,
    ts: nowMs(),
  };
  if (!link.sendCleartext(hello)) throw new LinkError('send_failed', 'hello');

  const ackFrame = await awaitFrame(link, ['hello_ack', 'err', 'goaway'], timeoutMs, 'hello_ack');
  if (ackFrame.header.t !== 'hello_ack') {
    throw new LinkError(ackFrame.header.code ?? ackFrame.header.t, ackFrame.header.reason ?? ackFrame.header.detail ?? '');
  }
  const ack = ackFrame.header;
  if (ack.m !== PROTO_MAGIC) throw new LinkError('protocol_mismatch', String(ack.m));
  if (ack.sessionId !== sessionId) throw new LinkError('session_mismatch', 'bridge echoed a different session id');

  // R319: the AGENT orders the agreed caps by the BRIDGE's advertised list. That is the one rule that makes every
  // pairing agree: a JS bridge and the Rust phone both build the intersection in their OWN advertised order, so an
  // agent that follows the bridge's list hashes the same array they do. Measured before this: desktop -> phone and
  // driver -> desktop failed the session finish, driver -> phone worked, and sorting the array instead broke
  // driver -> phone - because the phone keeps its own order and does not sort.
  const negotiated = negotiate(
    { proto: hello.proto, caps: hello.caps, features: hello.features },
    { proto: ack.proto, caps: ack.caps, features: ack.features },
    { order: 'remote' },
  );
  if (!negotiated.ok) throw new LinkError(negotiated.code, negotiated.reason);

  const bridgePoint = Buffer.from(ack.eph, 'base64url');
  const transcript = C.buildTranscript({
    sessionId,
    protocolVersion: negotiated.protocolVersion,
    idA: hello.deviceId,
    idB: ack.deviceId,
    nonceA: hello.nonce,
    nonceB: ack.nonce,
    ephA: hello.eph,
    ephB: ack.eph,
    fpA: hello.fp,
    fpB: ack.fp ?? '',
    negotiated: { p: negotiated.protocolVersion, c: negotiated.caps, f: negotiated.features },
  });
  const transcriptHash = C.sha256(transcript);
  const shared = C.ecdhSharedSecret(eph.priv, bridgePoint);

  let psk = Buffer.alloc(0);
  let authMode = ack.authMode;

  if (authMode === 'pake') {
    if (!opts.pairCode) throw new LinkError('pairing_required', 'bridge requires a pairing code');
    const spake = new C.Spake2({
      role: 'A',
      code: opts.pairCode,
      context: ack.pairContext ?? ack.pairId ?? sessionId,
      idA: hello.deviceId,
      idB: ack.deviceId,
    });
    const X = spake.start();
    if (!link.sendCleartext({ t: 'pair_begin', pairId: ack.pairId, x: X.toString('base64url') })) {
      throw new LinkError('send_failed', 'pair_begin');
    }
    const reply = await awaitFrame(link, ['pair_reply', 'err', 'goaway'], timeoutMs, 'pair_reply');
    if (reply.header.t !== 'pair_reply') throw new LinkError(reply.header.code ?? 'pairing_failed', reply.header.detail ?? '');
    spake.finish(Buffer.from(reply.header.y, 'base64url'));
    if (!link.sendCleartext({ t: 'pair_finish', tag: spake.confirmOut.toString('base64url') })) {
      throw new LinkError('send_failed', 'pair_finish');
    }
    const result = await awaitFrame(link, ['pair_result', 'err', 'goaway'], timeoutMs, 'pair_result');
    if (result.header.t !== 'pair_result' || result.header.ok !== true) {
      throw new LinkError(result.header.code ?? 'pairing_failed', result.header.detail ?? 'wrong code?');
    }
    if (!spake.verifyPeer(Buffer.from(result.header.tag, 'base64url'))) {
      throw new LinkError('pairing_failed', 'bridge confirmation tag mismatch');
    }
    psk = spake.psk;
    authMode = 'pake';
  } else if (authMode === 'trusted') {
    const pinned = opts.trustStore ? opts.trustStore.getPeer(ack.deviceId) : null;
    if (!pinned) throw new LinkError('unknown_bridge', 'no pinned key for this bridge; pair first');
    if (pinned.pubKey !== ack.kb) {
      throw new LinkError('bridge_key_changed',
        'the bridge presented a different long-term key than the pinned one; refusing (possible MITM)');
    }
    const sig = C.signTranscript(opts.identity.priv, transcript, 'agent');
    if (!link.sendCleartext({ t: 'auth', sig: sig.toString('base64url') })) throw new LinkError('send_failed', 'auth');
    const ok = await awaitFrame(link, ['auth_ok', 'err', 'goaway'], timeoutMs, 'auth_ok');
    if (ok.header.t !== 'auth_ok') throw new LinkError(ok.header.code ?? 'auth_failed', ok.header.detail ?? '');
    const bridgeSig = Buffer.from(ok.header.sig, 'base64url');
    if (!C.verifyTranscript(ack.kb, transcript, 'bridge', bridgeSig)) {
      throw new LinkError('bridge_auth_failed', 'bridge signature did not verify');
    }
  } else {
    // authMode is 'none' | 'denied' | 'key_changed': the bridge always follows
    // its hello_ack with an `err` frame carrying the precise reason, so read it
    // instead of guessing from the auth mode alone.
    let code = ack.authMode === 'denied' ? 'version_incompatible' : 'auth_mode_unsupported';
    let detail = String(ack.authMode);
    try {
      const f = await awaitFrame(link, ['err', 'goaway'], Math.min(timeoutMs, 3000), 'err');
      if (f.header.code) code = f.header.code;
      if (f.header.detail) detail = f.header.detail;
    } catch { /* the peer closed without explaining; keep the generic code */ }
    throw new LinkError(code, detail);
  }

  const session = finishSession({
    link, role: 'agent', shared, psk, transcript, transcriptHash, negotiated,
    peerDeviceId: ack.deviceId, localDeviceId: hello.deviceId,
  });
  await exchangeFinish(session, transcriptHash, 'agent', timeoutMs);
  const peer = {
    deviceId: ack.deviceId, name: ack.name ?? '', app: ack.app ?? '',
    fingerprint: ack.fp ?? '', pubKey: ack.kb, authMode, negotiated,
  };
  // TOFU on the agent side too: pin the bridge key we just authenticated with
  // the code. A *changed* key for a known bridge is reported, never re-pinned.
  if (opts.trustStore) {
    const proposal = opts.trustStore.proposePeer({
      deviceId: ack.deviceId, name: ack.name, role: 'bridge',
      pubKey: ack.kb, fingerprint: ack.fp ?? '',
    });
    peer.trust = proposal.status;
    if (proposal.status === 'pending' && opts.confirmPeer) {
      const accepted = await opts.confirmPeer({ ...proposal.peer, authMode });
      if (accepted) opts.trustStore.confirmPeer(ack.deviceId);
      else opts.trustStore.rejectPeer(ack.deviceId);
    }
  }
  if (opts.onPeer) opts.onPeer(peer);
  return { session, peer, negotiated };
}

/**
 * Bridge (responder) side of the handshake.
 *
 * @param {FrameLink} link
 * @param {{
 *   identity: {pub:string, priv:string, fingerprint:string},
 *   deviceId: string, name?: string, app?: string,
 *   caps?: string[], features?: object, proto?: {min:string,max:string},
 *   trustStore: C.TrustStore,
 *   pairing: null | { code: string, pairId?: string, context?: string,
 *                     guard?: C.PairingGuard },
 *   requireUserConfirm?: boolean,
 *   confirmPeer?: (info:object)=>Promise<boolean>|boolean,
 *   timeoutMs?: number, failDelayMs?: number
 * }} opts
 * @returns {Promise<{session: Session, peer: object, negotiated: object}>}
 */
export async function bridgeHandshake(link, opts) {
  const timeoutMs = opts.timeoutMs ?? link.opts.handshakeTimeoutMs;
  const failDelayMs = opts.failDelayMs ?? 250;

  const helloFrame = await awaitFrame(link, ['hello'], timeoutMs, 'hello');
  const hello = helloFrame.header;
  if (hello.m !== PROTO_MAGIC) throw new LinkError('protocol_mismatch', String(hello.m));
  if (!hello.deviceId || typeof hello.deviceId !== 'string') throw new LinkError('bad_hello', 'deviceId');
  if (!hello.eph || !hello.kb) throw new LinkError('bad_hello', 'eph/kb');

  const eph = C.generateEphemeral();
  const nonce = C.randomBytes(24);

  const negotiated = negotiate(
    { proto: opts.proto ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX }, caps: opts.caps ?? [], features: opts.features ?? FEATURES },
    { proto: hello.proto, caps: hello.caps, features: hello.features },
  );
  const pinned = opts.trustStore ? opts.trustStore.getPeer(hello.deviceId) : null;
  const keyMatchesPin = !!(pinned && pinned.pubKey === hello.kb);

  let authMode;
  if (!negotiated.ok) authMode = 'denied';
  else if (pinned && !keyMatchesPin) authMode = 'key_changed'; // never auto-repair
  else if (pinned && keyMatchesPin) authMode = 'trusted';
  else if (opts.pairing && opts.pairing.code) authMode = 'pake';
  else authMode = 'none';

  const ack = {
    t: 'hello_ack',
    m: PROTO_MAGIC,
    proto: opts.proto ?? { min: PROTOCOL_MIN, max: PROTOCOL_MAX },
    app: opts.app ?? 'unknown',
    caps: opts.caps ?? [],
    features: opts.features ?? FEATURES,
    deviceId: opts.deviceId,
    name: opts.name ?? '',
    role: 'bridge',
    sessionId: hello.sessionId,
    nonce: nonce.toString('base64url'),
    eph: eph.pub.toString('base64url'),
    kb: opts.identity.pub,
    fp: opts.identity.fingerprint,
    authMode,
    ts: nowMs(),
  };
  if (authMode === 'pake') {
    ack.pairId = opts.pairing.pairId ?? opts.pairing.guard?.window?.id ?? 'pair';
    ack.pairContext = opts.pairing.context ?? ack.pairId;
  }
  link.sendCleartext(ack);

  if (authMode === 'denied' || authMode === 'none' || authMode === 'key_changed') {
    const code = authMode === 'denied' ? negotiated.code
      : authMode === 'key_changed' ? 'key_changed'
        : 'pairing_closed';
    const detail = authMode === 'denied' ? negotiated.reason
      : authMode === 'key_changed'
        ? 'this device is already paired with a different long-term key; re-pair explicitly from the bridge UI'
        : 'no pairing window is open on the bridge';
    link.sendCleartext({ t: 'err', code, detail });
    await sleep(failDelayMs);
    link.close('handshake_denied');
    throw new LinkError(code, detail);
  }

  const transcript = C.buildTranscript({
    sessionId: hello.sessionId,
    protocolVersion: negotiated.protocolVersion,
    idA: hello.deviceId,
    idB: ack.deviceId,
    nonceA: hello.nonce,
    nonceB: ack.nonce,
    ephA: hello.eph,
    ephB: ack.eph,
    fpA: hello.fp ?? '',
    fpB: ack.fp,
    negotiated: { p: negotiated.protocolVersion, c: negotiated.caps, f: negotiated.features },
  });
  const transcriptHash = C.sha256(transcript);
  const shared = C.ecdhSharedSecret(eph.priv, Buffer.from(hello.eph, 'base64url'));

  let psk = Buffer.alloc(0);

  if (authMode === 'pake') {
    const guard = opts.pairing.guard;
    let attempt = null;
    try {
      attempt = guard ? guard.beginAttempt(ack.pairId) : { attemptsLeft: null };
    } catch (err) {
      link.sendCleartext({ t: 'err', code: 'pairing_failed', detail: 'pairing unavailable' });
      await sleep(failDelayMs);
      link.close('pairing_unavailable');
      throw new LinkError(err.code ?? 'pairing_failed', err.message);
    }
    const begin = await awaitFrame(link, ['pair_begin', 'goaway'], timeoutMs, 'pair_begin');
    try {
      const spake = new C.Spake2({
        role: 'B', code: opts.pairing.code, context: ack.pairContext,
        idA: hello.deviceId, idB: ack.deviceId,
      });
      const Y = spake.start(); // our share; must be sent exactly once
      spake.finish(Buffer.from(begin.header.x, 'base64url'));
      link.sendCleartext({ t: 'pair_reply', y: Y.toString('base64url') });
      const fin = await awaitFrame(link, ['pair_finish', 'goaway'], timeoutMs, 'pair_finish');
      const tagOk = spake.verifyPeer(Buffer.from(fin.header.tag, 'base64url'));
      if (!tagOk) throw new LinkError('pairing_failed', 'agent confirmation tag mismatch');
      psk = spake.psk;
      if (guard) guard.success();

      // TOFU: pin the agent's key, optionally after an explicit user decision.
      let trusted = true;
      if (opts.trustStore) {
        const proposal = opts.trustStore.proposePeer({
          deviceId: hello.deviceId, name: hello.name, role: 'agent',
          pubKey: hello.kb, fingerprint: hello.fp,
        });
        if (proposal.status === 'pending' && (opts.requireUserConfirm !== false)) {
          trusted = opts.confirmPeer ? await opts.confirmPeer({ ...proposal.peer, remote: link.remote }) : false;
          if (trusted) opts.trustStore.confirmPeer(hello.deviceId);
          else { opts.trustStore.rejectPeer(hello.deviceId); link.sendCleartext({ t: 'err', code: 'pairing_denied', detail: 'rejected by the bridge user' }); link.close('pairing_denied'); throw new LinkError('pairing_denied'); }
        }
      }
      link.sendCleartext({ t: 'pair_result', ok: true, tag: spake.confirmOut.toString('base64url'), trusted });
    } catch (err) {
      if (guard) guard.fail(err.code ?? 'bad_code');
      // One generic error + a constant delay: nothing distinguishes a wrong
      // code from an expired window or a malformed share.
      link.sendCleartext({ t: 'err', code: 'pairing_failed', detail: 'pairing failed' });
      await sleep(failDelayMs);
      link.close('pairing_failed');
      throw new LinkError('pairing_failed', err.message);
    }
  } else if (authMode === 'trusted') {
    const authFrame = await awaitFrame(link, ['auth', 'goaway'], timeoutMs, 'auth');
    const sig = Buffer.from(authFrame.header.sig ?? '', 'base64url');
    if (!C.verifyTranscript(pinned.pubKey, transcript, 'agent', sig)) {
      link.sendCleartext({ t: 'err', code: 'auth_failed', detail: 'signature did not verify' });
      await sleep(failDelayMs);
      link.close('auth_failed');
      throw new LinkError('auth_failed', 'agent signature did not verify');
    }
    const bridgeSig = C.signTranscript(opts.identity.priv, transcript, 'bridge');
    link.sendCleartext({ t: 'auth_ok', sig: bridgeSig.toString('base64url') });
    if (opts.trustStore) opts.trustStore.getPeer(hello.deviceId).lastSeen = Date.now();
  }

  const session = finishSession({
    link, role: 'bridge', shared, psk, transcript, transcriptHash, negotiated,
    peerDeviceId: hello.deviceId, localDeviceId: ack.deviceId,
  });
  await exchangeFinish(session, transcriptHash, 'bridge', timeoutMs);
  const peer = {
    deviceId: hello.deviceId, name: hello.name ?? '', app: hello.app ?? '',
    fingerprint: hello.fp ?? '', pubKey: hello.kb, authMode, negotiated,
  };
  return { session, peer, negotiated };
}

function finishSession({ link, role, shared, psk, transcript, transcriptHash, negotiated, peerDeviceId, localDeviceId }) {
  const prk = C.derivePrk({ transcript, sharedSecret: shared, psk });
  const channel = new C.SecureChannel({ role, prk, transcriptHash });
  const session = new Session({ link, channel, role, peerDeviceId, localDeviceId, negotiated });
  return session;
}

/**
 * Rekey transcript: built from values both sides hold, in a fixed A/B order, so
 * the two never disagree. Kept in one place on purpose — a duplicated
 * transcript builder is exactly how rekey implementations drift apart.
 */
function rekeyTranscript({ channel, negotiated, role, peerDeviceId, localDeviceId, r, epoch, ephA, ephB }) {
  return C.buildTranscript({
    sessionId: channel.transcriptHash.toString('base64url'),
    protocolVersion: negotiated.protocolVersion,
    idA: role === 'agent' ? localDeviceId : peerDeviceId,
    idB: role === 'agent' ? peerDeviceId : localDeviceId,
    nonceA: r,
    nonceB: String(epoch),
    ephA,
    ephB,
    fpA: '',
    fpB: '',
    negotiated: { rekey: epoch },
  });
}

/**
 * Key confirmation. One exchange, both directions: the sender proves it derived
 * the same keys, and each side checks the peer's tag, so a wrong key (or a
 * mismatched transcript) fails before any application frame is sent.
 */
async function exchangeFinish(session, transcriptHash, role, timeoutMs) {
  const myTag = session.channel.expectedConfirm(role);
  const peerRole = role === 'agent' ? 'bridge' : 'agent';
  if (role === 'agent') {
    session.sendRaw({ t: 'finish', tag: myTag.toString('base64url') });
    const f = await awaitFrame(session.link, ['finish_ok', 'err', 'goaway'], timeoutMs, 'finish_ok');
    if (f.header.t !== 'finish_ok') throw new LinkError(f.header.code ?? 'finish_failed', f.header.detail ?? '');
    if (!session.channel.checkConfirm(peerRole, Buffer.from(f.header.tag, 'base64url'))) {
      throw new LinkError('finish_failed', 'peer key confirmation mismatch');
    }
  } else {
    const f = await awaitFrame(session.link, ['finish', 'goaway'], timeoutMs, 'finish');
    if (!session.channel.checkConfirm(peerRole, Buffer.from(f.header.tag, 'base64url'))) {
      session.sendRaw({ t: 'err', code: 'finish_failed', detail: 'key confirmation mismatch' });
      session.link.close('finish_failed');
      throw new LinkError('finish_failed', 'agent key confirmation mismatch');
    }
    session.sendRaw({ t: 'finish_ok', tag: myTag.toString('base64url') });
  }
  session.established = true;
  session.link.setFrameHandler((frame) => session._onFrame(frame));
  session.startTimers();
  session.emit('established');
  return session;
}

// ---------------------------------------------------------------------------
// Session (encrypted RPC)
// ---------------------------------------------------------------------------

/**
 * Post-handshake message layer.
 *
 * Frames are sealed/opened by SecureChannel; the cleartext header only carries
 * (type, epoch, seq, nonce). RPC semantics:
 *   req  {id, cap, op, args, timeoutMs, streamId?}   -> res {id, ok, result|error}
 *   evt  {kind, ...}  (+ binary payload for chunk/credit)
 *   ping/pong, cancel, goaway, rekey/rekey_ack
 */
export class Session extends EventEmitter {
  constructor({ link, channel, role, peerDeviceId, localDeviceId, negotiated }) {
    super();
    this.link = link;
    this.channel = channel;
    this.role = role;
    this.peerDeviceId = peerDeviceId;
    this.localDeviceId = localDeviceId ?? '';
    /** Key used to look up this session's grant table on the bridge side. */
    this.sessionKey = peerDeviceId;
    this.negotiated = negotiated;
    this.established = false;
    this.closed = false;
    this._nextId = 1;
    this._pending = new Map(); // id -> {resolve, reject, timer, cap, op}
    this._streams = new Map(); // streamId -> {credit, onChunk}
    this._handlers = new Map(); // op -> {cap, fn}
    this._active = new Map();  // requestId -> {onCancel}
    this._cancelled = new Set();
    this._chunkSeq = new Map();
    /** Bridge callback: async (req) => {ok, result|error, limits}. Set by app. */
    this.authorize = null;
    this._pingSeq = 0;
    /**
     * Same hazard as FrameLink's: `send()` emits `error` when the channel cannot
     * seal, and an unhandled `error` event throws — in the host process that
     * means the whole app dies. The application attaches its own handler once
     * the session is handed to it, which is strictly AFTER the handshake, so
     * during the handshake there would be nobody listening. Record it instead;
     * the caller still sees `send()` return false, and a broken channel surfaces
     * as a `close`.
     */
    this.lastError = null;
    this.on('error', (error) => {
      this.lastError = error;
    });
    /**
     * A socket that dies must also end the SESSION.
     *
     * Without this, `link.destroy()` (idle timeout, socket error, a peer that
     * vanishes) emitted `close` only on the FrameLink, and the Session stayed
     * `closed: false` for the rest of the process: pending requests hung until
     * their own deadlines, the application never saw the disconnect, and a dead
     * link kept its tools unlocked. The `goaway` path already worked; this is the
     * path that did not.
     */
    this.link.on('close', (reason) => this._onLinkClose(reason));
  }

  /** The transport died underneath us. Idempotent with `close()`. */
  _onLinkClose(reason) {
    if (this.closed) return;
    this.closed = true;
    if (this._housekeep) clearInterval(this._housekeep);
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new LinkError('closed', reason ?? 'link_closed'));
    }
    this._pending.clear();
    this._streams.clear();
    this._active.clear();
    this.emit('close', reason ?? 'link_closed');
  }

  /** Raw cleartext send (handshake tail only). */
  sendRaw(header, payload = null) {
    return this.link.sendCleartext(header, payload);
  }

  /** Encrypted send. Returns false when rejected for backpressure. */
  send(body, payload = null) {
    if (this.closed) return false;
    let sealed;
    try {
      sealed = this.channel.seal(body, payload);
    } catch (err) {
      this.emit('error', err);
      return false;
    }
    const buf = encodeFrame(sealed.header, sealed.ciphertext, { maxFrameBytes: this.link.maxFrameBytes });
    return this.link.sendFrame(buf);
  }

  _onFrame(frame) {
    let opened;
    try {
      opened = this.channel.open(frame);
    } catch (err) {
      if (err.code === 'replay_detected' || err.code === 'stale_frame') {
        // Duplicated/reordered data is not fatal for an authenticated channel,
        // but it is a signal worth surfacing and counting.
        this.link.stats.decryptFailures++;
        this.emit('protocolWarning', err);
        return;
      }
      this.link.stats.decryptFailures++;
      this.emit('protocolError', err);
      this.link.destroy(`secure: ${err.code}`);
      return;
    }
    /**
     * `_onFrame` runs from inside the socket's `data` listener, so ANY synchronous
     * throw here escapes as an uncaught exception — fatal in the host process.
     * `_dispatch` reaches application callbacks (a stream chunk handler, a grant
     * listener), and an application callback is allowed to be wrong without
     * taking the app down. Contain it: report it, drop the link, keep running.
     */
    try {
      this._dispatch(opened.body, opened.payload);
    } catch (err) {
      this.emit('protocolError', err);
      this.link.destroy(`dispatch: ${err?.code ?? err?.message ?? 'error'}`);
    }
  }

  _dispatch(body, payload) {
    const t = body && body.t;
    switch (t) {
      case 'req': return this._onRequest(body);
      case 'res': return this._onResponse(body, payload);
      case 'evt': return this._onEvent(body, payload);
      case 'ping': return this.send({ t: 'pong', n: body.n });
      case 'pong': return;
      case 'cancel': return this._onCancel(body);
      case 'rekey': return this._onRekey(body);
      case 'rekey_ack': return this._onRekeyAck(body);
      case 'rekey_done': return this._onRekeyDone(body);
      case 'goaway':
        this.emit('goaway', body);
        this.close('peer_goaway');
        return;
      default:
        // Forward compatibility: unknown message types are ignored, never fatal.
        this.emit('unknownMessage', body);
    }
  }

  startTimers() {
    this.link.on('needPing', () => {
      if (!this.closed) this.send({ t: 'ping', n: ++this._pingSeq });
    });
    this.link.startHeartbeat(() => this.emit('idle'));
    // Housekeeping: prune retired epochs and reject requests that outlived
    // their own deadline even if the peer never answers. Guarded because a timer
    // callback runs outside any promise: a throw here is an uncaught exception,
    // which in the host process takes the whole app down.
    this._housekeep = setInterval(() => {
      try {
        this.channel.pruneRetired();
        const now = Date.now();
        for (const [id, p] of this._pending) {
          if (p.deadline && now > p.deadline) {
            this._pending.delete(id);
            clearTimeout(p.timer);
            p.reject(new LinkError('request_timeout', `${p.cap}/${p.op}`));
          }
        }
        if (!this.closed && this.channel.needsRekey()) this.rekey().catch(() => {});
      } catch (error) {
        this.lastError = error;
      }
    }, 5000);
    this._housekeep.unref?.();
  }

  // ---- agent side -------------------------------------------------------

  /**
   * Send a request and await its response.
   * @param {string} cap capability being exercised (bridge re-checks it)
   * @param {string} op operation name
   * @param {object} args arguments
   * @param {{timeoutMs?:number, streamId?:string, onChunk?:Function}} [opts]
   */
  request(cap, op, args, opts = {}) {
    if (this.closed) return Promise.reject(new LinkError('closed'));
    if (this._pending.size >= (this.link.opts.maxPendingRequests ?? 256)) {
      return Promise.reject(new LinkError('too_many_pending', String(this._pending.size)));
    }
    const id = this._nextId++;
    const timeoutMs = opts.timeoutMs ?? this.link.opts.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        this.send({ t: 'cancel', id });
        reject(new LinkError('request_timeout', `${cap}/${op} after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this._pending.set(id, { resolve, reject, timer, cap, op, deadline: Date.now() + timeoutMs });
      if (opts.streamId && opts.onChunk) {
        this._streams.set(opts.streamId, { credit: opts.initialCredit ?? 32, onChunk: opts.onChunk });
      }
      const ok = this.send({
        t: 'req', id, cap, op, args: args ?? {},
        timeoutMs, streamId: opts.streamId ?? null,
      });
      if (!ok) {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(new LinkError('backpressure', `${cap}/${op}`));
      }
    });
  }

  _onResponse(body, payload) {
    const p = this._pending.get(body.id);
    if (!p) return; // late response after timeout: ignore
    this._pending.delete(body.id);
    clearTimeout(p.timer);
    if (body.ok) p.resolve({ result: body.result, payload, meta: body.meta ?? {} });
    else p.reject(new LinkError(body.error?.code ?? 'remote_error', body.error?.detail ?? ''));
  }

  _onEvent(body, payload) {
    if (body.kind === 'chunk') {
      const s = this._streams.get(body.id);
      if (s) {
        if (s.onChunk) s.onChunk({ seq: body.seq, payload, final: !!body.final });
        if (this.negotiated.features?.streamCredit) {
          s.credit -= 1;
          if (s.credit <= 0) {
            s.credit += 32;
            this.send({ t: 'evt', kind: 'credit', id: body.id, credit: 32 });
          }
        }
      }
      return;
    }
    if (body.kind === 'credit') {
      const w = this._writers?.get(body.id);
      if (w) w.credit += body.credit;
      this.emit('credit', body);
      return;
    }
    if (body.kind === 'grant') { this.emit('grant', body.table); return; }
    this.emit('event', body, payload);
  }

  _onCancel(body) {
    this._cancelled.add(body.id);
    const h = this._active.get(body.id);
    if (h && h.onCancel) { try { h.onCancel(); } catch { /* handler's problem */ } }
    this.emit('cancel', body);
  }

  // ---- bridge side ------------------------------------------------------

  /** Register a handler for an operation. Authorization is NOT done here. */
  handle(cap, op, fn) {
    this._handlers.set(`${cap}\u0000${op}`, { cap, fn });
    return this;
  }

  /** Set the authorization callback: async (req) => decision. */
  setAuthorizer(fn) {
    this.authorize = fn;
    return this;
  }

  async _onRequest(body) {
    const key = `${body.cap}\u0000${body.op}`;
    const handler = this._handlers.get(key);
    let decision = { ok: false, error: { code: 'unsupported', detail: `unknown op ${body.cap}/${body.op}` } };
    const cancelCtl = { onCancel: null };
    this._active.set(body.id, cancelCtl);
    try {
      if (!this.authorize) {
        decision = { ok: false, error: { code: 'no_policy', detail: 'bridge has no authorizer attached' } };
      } else {
        decision = await this.authorize({
          id: body.id, cap: body.cap, op: body.op, args: body.args ?? {},
          streamId: body.streamId ?? null, session: this, peerDeviceId: this.peerDeviceId,
          timeoutMs: body.timeoutMs ?? this.link.opts.requestTimeoutMs,
        });
      }
      if (this._cancelled.has(body.id)) {
        this._cancelled.delete(body.id);
        return; // peer gave up while we were authorizing
      }
      if (decision && decision.ok && !handler) {
        decision = { ok: false, error: { code: 'unsupported', detail: `no handler for ${body.cap}/${body.op}` } };
      }
      if (decision && decision.ok) {
        const sid = body.streamId ?? body.id;
        const t0 = Date.now();
        const result = await handler.fn({
          args: body.args ?? {}, limits: decision.limits ?? {}, decision,
          session: this, requestId: body.id, streamId: sid,
          emitChunk: (payload, final = false) => {
            const seq = (this._chunkSeq.get(sid) ?? 0) + 1;
            this._chunkSeq.set(sid, seq);
            return this.send({ t: 'evt', kind: 'chunk', id: sid, seq, final }, payload);
          },
          isCancelled: () => this._cancelled.has(body.id),
          registerCancel: (fn) => { cancelCtl.onCancel = fn; },
        });
        this.send({ t: 'res', id: body.id, ok: true, result: result ?? null, meta: { ms: Date.now() - t0 } });
      } else {
        const err = (decision && decision.error) || { code: 'denied' };
        this.send({ t: 'res', id: body.id, ok: false, error: { code: err.code, detail: err.detail ?? '' } });
      }
    } catch (err) {
      this.send({ t: 'res', id: body.id, ok: false, error: { code: err.code ?? 'handler_error', detail: String(err.message ?? err).slice(0, 300) } });
    } finally {
      this._active.delete(body.id);
      this._cancelled.delete(body.id);
      this._chunkSeq.delete(body.streamId ?? body.id);
    }
  }

  // ---- rekey ------------------------------------------------------------

  /**
   * Rekey handshake (initiator side), driven over the *current* epoch:
   *
   *   I -> R  rekey     { e, ephA }                       (old epoch)
   *   R -> I  rekey_ack { e, ephB, tag }                  (old epoch; tag proves
   *                                                        R derived the new keys)
   *   I -> R  rekey_done{ e, tag }                        (NEW epoch: proves I
   *                                                        actually switched)
   *
   * Both sides compute prk' = HKDF-Extract(salt,
   *   old_prk || ECDH(ephA, ephB)) with the same transcript, so the new epoch
   * cannot be derived from the old keys alone (post-compromise recovery).
   * A failure here is a connection failure on purpose: silently continuing with
   * half-switched keys would be worse than dropping the link.
   */
  async rekey() {
    if (this.closed || this._rekeyInFlight) return false;
    this._rekeyInFlight = true;
    try {
      const eph = C.generateEphemeral();
      const epoch = this.channel.epoch + 1;
      const r = C.randomBytes(8).toString('base64url');
      this._rekeyPending = { eph, epoch, r };
      this.send({ t: 'rekey', e: epoch, eph: eph.pub.toString('base64url'), r });
      return true;
    } finally {
      this._rekeyInFlight = false;
    }
  }

  /** Responder side of a rekey. */
  _onRekey(body) {
    if (typeof body.e !== 'number' || body.e <= this.channel.epoch) return; // stale/duplicate
    const ephB = C.generateEphemeral();
    const shared = C.ecdhSharedSecret(ephB.priv, Buffer.from(body.eph, 'base64url'));
    const transcript = rekeyTranscript({
      channel: this.channel, negotiated: this.negotiated, role: this.role,
      peerDeviceId: this.peerDeviceId, localDeviceId: this.localDeviceId,
      r: body.r, epoch: body.e, ephA: body.eph, ephB: ephB.pub.toString('base64url'),
    });
    const prk = C.SecureChannel.rekeyPrk({ prk: this.channel.prk, sharedSecret: shared, transcript });
    const newConfirm = C.deriveEpochKeys({ prk, epoch: body.e }).confirmKey;
    const tag = C.hmac(newConfirm, C.lp('rekey_ack'), C.lp(String(body.e)), C.lp(body.r));
    this._rekeyOut = { epoch: body.e, prk, ephB, r: body.r };
    // The ack must go out under the OLD epoch, so it is sent before switching.
    this.send({ t: 'rekey_ack', e: body.e, eph: ephB.pub.toString('base64url'), tag: tag.toString('base64url') });
    this.channel.installEpoch(body.e, prk);
    this.channel.prk = prk;
    this.emit('rekeyed', body.e);
  }

  /** Initiator side: verify the ack tag, then switch to the new epoch. */
  _onRekeyAck(body) {
    const p = this._rekeyPending;
    if (!p || body.e !== p.epoch) return;
    const ephA = p.eph.pub.toString('base64url');
    const shared = C.ecdhSharedSecret(p.eph.priv, Buffer.from(body.eph, 'base64url'));
    const transcript = rekeyTranscript({
      channel: this.channel, negotiated: this.negotiated, role: this.role,
      peerDeviceId: this.peerDeviceId, localDeviceId: this.localDeviceId,
      r: p.r, epoch: p.epoch, ephA, ephB: body.eph,
    });
    const prk = C.SecureChannel.rekeyPrk({ prk: this.channel.prk, sharedSecret: shared, transcript });
    const newConfirm = C.deriveEpochKeys({ prk, epoch: p.epoch }).confirmKey;
    const expect = C.hmac(newConfirm, C.lp('rekey_ack'), C.lp(String(p.epoch)), C.lp(p.r));
    if (!C.timingSafeEqualBuf(Buffer.from(body.tag ?? '', 'base64url'), expect)) {
      this.emit('protocolError', new C.CryptoError('rekey_tag_mismatch'));
      this.link.destroy('rekey_failed');
      return;
    }
    this.channel.installEpoch(p.epoch, prk);
    this.channel.prk = prk;
    this._rekeyPending = null;
    const tag = C.hmac(newConfirm, C.lp('rekey_done'), C.lp(String(p.epoch)));
    this.send({ t: 'rekey_done', e: p.epoch, tag: tag.toString('base64url') });
    this.emit('rekeyed', p.epoch);
  }

  /** Responder side: the initiator proved it switched to the new epoch. */
  _onRekeyDone(body) {
    const o = this._rekeyOut;
    if (!o || body.e !== o.epoch) return;
    const expected = C.hmac(C.deriveEpochKeys({ prk: o.prk, epoch: o.epoch }).confirmKey,
      C.lp('rekey_done'), C.lp(String(o.epoch)));
    if (!C.timingSafeEqualBuf(Buffer.from(body.tag ?? '', 'base64url'), expected)) {
      this.emit('protocolError', new C.CryptoError('rekey_done_mismatch'));
      this.link.destroy('rekey_failed');
      return;
    }
    this._rekeyOut = null;
    this.emit('rekeyConfirmed', o.epoch);
  }

  // ---- lifecycle --------------------------------------------------------

  close(reason = 'normal') {
    if (this.closed) return;
    // Tell the peer first: `send` refuses once `closed` is set.
    this.send({ t: 'goaway', code: reason });
    this.closed = true;
    if (this._housekeep) clearInterval(this._housekeep);
    for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new LinkError('closed')); }
    this._pending.clear();
    this._streams.clear();
    this._active.clear();
    if (!this.link.closed) this.link.close(reason);
    this.emit('close', reason);
  }
}

/**
 * Convenience: a listening bridge socket that runs bridgeHandshake per
 * connection. The application supplies `authorize` and handlers.
 */
export function createBridgeServer(opts) {
  const emitter = new EventEmitter();
  /**
   * The listening socket's `error` is forwarded to the application, and an
   * `error` event with no listener throws. The application does attach one, but
   * this emitter is created before that line runs, so a bind failure in between
   * would have killed the host process instead of reporting itself.
   */
  emitter.lastError = null;
  emitter.on('error', (error) => {
    emitter.lastError = error;
  });
  const server = net.createServer((socket) => {
    const link = FrameLink.fromSocket(socket, 'bridge', opts.linkOpts);
    const timer = setTimeout(() => link.destroy('handshake_timeout'), opts.timeoutMs ?? DEFAULTS.handshakeTimeoutMs);
    timer.unref?.();
    bridgeHandshake(link, opts)
      .then(({ session, peer }) => {
        clearTimeout(timer);
        if (opts.onSession) opts.onSession(session, peer);
      })
      .catch((err) => {
        clearTimeout(timer);
        emitter.emit('handshakeFailed', err, link.remote);
      });
  });
  server.on('error', (err) => emitter.emit('error', err));
  emitter.server = server;
  emitter.listen = (port, host = '0.0.0.0') => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address()));
  });
  emitter.close = () => new Promise((resolve) => server.close(resolve));
  return emitter;
}

export default {
  PROTOCOL_MIN, PROTOCOL_MAX, CAPABILITIES, FEATURES, DEFAULTS,
  LinkError, compareVersions, negotiate, FrameLink, Session,
  agentHandshake, bridgeHandshake, createBridgeServer,
};
