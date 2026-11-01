/**
 * crypto.js — pairing, session key agreement, AEAD framing and trust storage.
 * Zero dependencies (node:crypto + ./p256.js only).
 *
 * ============================ THREAT MODEL ============================
 * Assumed attacker (a "hostile LAN"):
 *   A1 PASSIVE  — records every packet on the LAN (announces, handshakes,
 *                 encrypted frames).
 *   A2 ACTIVE   — can inject, drop, reorder, replay and rewrite packets, and
 *                 can run a full man-in-the-middle (two half-connections) on
 *                 the TCP path, including ARP/ND spoofing.
 *   A3 OFFLINE  — after the fact, can spend unlimited CPU on the recording.
 *   A4 ONLINE-GUESS — can open as many connections as it likes and submit
 *                 pairing codes.
 * NOT defended against (stated, not hidden):
 *   - a compromised endpoint (malware on either machine),
 *   - a user who reads the code aloud to an attacker,
 *   - denial of service (the attacker can always drop packets),
 *   - a local attacker measuring BigInt timing (see p256.js header),
 *   - a stolen trust-store file (see "trust model" below).
 *
 * ---- Why the obvious "HMAC over the transcript salted by the code" FAILS ----
 * Plain ECDH + confirm with HMAC(KDF(Z, code), transcript) is *not* safe here.
 * A2 sets up two half-connections, so it knows Z_AM (its own ECDH with the
 * agent) and can therefore test a candidate code completely offline against
 * the agent's confirmation tag: guess code -> recompute KDF(Z_AM, guess) ->
 * compare tag. 10^6 guesses is milliseconds. A 6-digit code is then no better
 * than no code at all. That is exactly the mistake this file avoids.
 *
 * ---- Solution: SPAKE2 (RFC 9382 construction) over P-256 ----
 * The low-entropy code is used as a *scalar* that is added to the DH shares:
 *   A -> X = x*G + w*M          B -> Y = y*G + w*N     (w = H(code))
 *   A: K = x*(Y - w*N)          B: K = y*(X - w*M)     both = x*y*G
 * Properties that matter:
 *   - A1/A3 never see x, y or w, so they cannot compute K at all, and no
 *     message in the protocol is a function of a guessable code alone:
 *     given X and a guess w', X - w'*G... is *always* a valid curve point, so
 *     there is no offline test. The code cannot be brute-forced from a
 *     recording, at any CPU budget.
 *   - A2 doing MITM cannot compute K either: to answer A it must produce
 *     Y' = y'*G + w*N, which needs w, and to check a guess it would need to
 *     solve the discrete log of X - w'*M. Its only option is an *online*
 *     guess, i.e. completing a whole handshake, which PairingGuard throttles
 *     and locks out (see below).
 *   - P-256 has cofactor 1, so every non-identity point is a generator: no
 *     subgroup confinement games, but every received point is still fully
 *     validated (p256.decodePoint) and the degenerate K == infinity case is
 *     rejected, which also kills the reflection attack (feeding A its own X).
 * An alternative, also supported (authMode 'psk'): if the shared secret is
 * *high entropy* (>= ~100 bits, e.g. a pasted base32 key), plain ephemeral
 * ECDH + HKDF with the secret mixed in is safe, because A3's dictionary is
 * empty. `assertPskStrength` enforces the minimum length for that mode.
 *
 * ---- What an attacker learns from a failed handshake ----
 *   - that a bridge is present and currently pairing (it already announces
 *     that, so this is not new information),
 *   - that a specific guess was wrong (inherent to any online protocol), and
 *     how many attempts remain *only* once the counter is nearly exhausted,
 *   - nothing else: every failure path returns one generic `pairing_failed`
 *     error, spends a constant extra delay, and always performs the
 *     constant-time tag comparison so wrong-code / unknown-pairId / expired
 *     window are not distinguishable by code, message length or timing.
 *
 * ---- Persistent trust (TOFU) ----
 * Every device owns a long-term Ed25519 key. After the first successful
 * pairing the bridge pins the agent's public key (and vice versa) after an
 * explicit user confirmation; later connections authenticate by signing the
 * handshake transcript, so no code is needed. Trust is per deviceId, and a
 * known deviceId presenting a *different* key is refused loudly (never
 * silently re-pinned) — that is the whole point of pinning.
 * The trust file holds private keys; protect it (0600 on POSIX, user-profile
 * ACL on Windows). It never holds a session key.
 *
 * ============================ KEY LIFECYCLE ============================
 * - Per connection: fresh ephemeral P-256 keys, fresh sessionId, fresh nonces.
 *   Session keys are HKDF-SHA256 outputs; nothing is reused across
 *   connections, so reconnect == rekey by construction.
 * - Per direction: independent AES-256-GCM key + independent 4-byte nonce
 *   salt + independent frame counter. Both directions may use seq=1 at the
 *   same time without ever repeating a (key, nonce) pair.
 * - Rekey while connected: fresh ephemerals are mixed with the current PRK
 *   and a new epoch is installed; frames carry their epoch so in-flight frames
 *   from the previous epoch still decrypt during a short grace period.
 * - Hard limits: REKEY_AFTER_FRAMES / REKEY_AFTER_BYTES force a rekey well
 *   before GCM's 2^32-frame comfort limit.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import * as p256 from './p256.js';
import { DIR_AGENT_TO_BRIDGE, DIR_BRIDGE_TO_AGENT, buildAAD } from './frame.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PAIRING_MAGIC = 'dsh-lan-bridge/spake2/v1';
export const SESSION_MAGIC = 'dsh-lan-bridge/session/v1';
export const KDF_MAGIC = 'dsh-lan-bridge/kdf/v1';
export const ANNOUNCE_MAGIC = 'dsh-lan-bridge/announce/v1';

/** AES-256-GCM: 32 byte key, 12 byte nonce (4 byte salt || 8 byte counter). */
export const AEAD_KEY_BYTES = 32;
export const AEAD_IV_BYTES = 12;
export const AEAD_TAG_BYTES = 16;
export const IV_SALT_BYTES = 4;

/** Replay window (frames). 64 keeps the bitmap a single BigInt. */
export const REPLAY_WINDOW = 64;

/** Force a rekey long before GCM's per-key limits. */
export const REKEY_AFTER_FRAMES = 1 << 20; // ~1M frames
export const REKEY_AFTER_BYTES = 1 << 30; // 1 GiB
export const REKEY_AFTER_MS = 60 * 60 * 1000; // 1 h
/** How long the previous epoch's keys stay usable after a rekey. */
export const KEY_RETIRE_MS = 5000;

/** Hard ceiling on a single AEAD plaintext (body + payload). */
export const MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024;

const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function randomBytes(n) {
  return crypto.randomBytes(n);
}

export function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(toBuf(p));
  return h.digest();
}

export function hmac(key, ...parts) {
  const h = crypto.createHmac('sha256', toBuf(key));
  for (const p of parts) h.update(toBuf(p));
  return h.digest();
}

/** HKDF-Extract (RFC 5869). */
export function hkdfExtract(salt, ikm) {
  return hmac(salt, ikm);
}

/** HKDF-Expand (RFC 5869), SHA-256. */
export function hkdfExpand(prk, info, length) {
  const out = Buffer.alloc(length);
  let prev = Buffer.alloc(0);
  let counter = 1;
  let offset = 0;
  while (offset < length) {
    prev = hmac(prk, prev, info, Buffer.from([counter]));
    const take = Math.min(prev.length, length - offset);
    prev.copy(out, offset, 0, take);
    offset += take;
    counter++;
    if (counter > 255 && offset < length) throw new Error('hkdf: output too long');
  }
  return out;
}

/** Convenience: extract + expand in one call. */
export function hkdf(ikm, salt, info, length) {
  return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}

/** Length-prefixed encoding, used everywhere in transcripts to avoid ambiguity. */
export function lp(value) {
  const b = toBuf(value);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length, 0);
  return Buffer.concat([len, b]);
}

/** Concatenate, accepting Buffer | string | Uint8Array | number[]. */
export function cat(...parts) {
  return Buffer.concat(parts.map(toBuf));
}

function toBuf(v) {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (Array.isArray(v)) return Buffer.from(v);
  if (v === null || v === undefined) return Buffer.alloc(0);
  throw new TypeError('crypto: cannot convert to Buffer: ' + typeof v);
}

/**
 * Constant-time buffer comparison. Length is compared first (not secret in our
 * usage: all tags are fixed size), contents with timingSafeEqual.
 */
export function timingSafeEqualBuf(a, b) {
  const x = toBuf(a);
  const y = toBuf(b);
  if (x.length !== y.length) return false;
  if (x.length === 0) return true;
  return crypto.timingSafeEqual(x, y);
}

/** Canonical JSON: object keys sorted, used for anything that gets signed. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/** base32 (Crockford-ish, no padding) — for fingerprints and short codes. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function base32(buf) {
  const b = toBuf(buf);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Group a string into chunks for display: "ABCDEFGH" -> "ABCD-EFGH". */
export function group(str, size = 4) {
  return (str.match(new RegExp(`.{1,${size}}`, 'g')) || []).join('-');
}

/** Uniform random integer in [0, max) via rejection sampling (no modulo bias). */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 48) throw new RangeError('randomInt: bad max');
  const bytesNeeded = Math.ceil(Math.log2(max) / 8) || 1;
  const limit = Math.floor(256 ** bytesNeeded / max) * max;
  for (;;) {
    let v = 0;
    const b = crypto.randomBytes(bytesNeeded);
    for (const x of b) v = v * 256 + x;
    if (v < limit) return v % max;
  }
}

/**
 * A pairing code: `digits` decimal digits (default 6) or `chars` base32
 * characters (default 8 => 40 bits), shown grouped on the bridge screen.
 * Decimal digits are friendlier to type; SPAKE2 makes the low entropy safe.
 */
export function generatePairingCode({ digits = 6, base32Chars = 0 } = {}) {
  if (base32Chars > 0) {
    let s = '';
    for (let i = 0; i < base32Chars; i++) s += B32[randomInt(32)];
    return group(s, 4);
  }
  let s = '';
  for (let i = 0; i < digits; i++) s += String(randomInt(10));
  return s;
}

/** Normalise user-typed codes: strip separators, uppercase, map look-alikes. */
export function normalizeCode(code) {
  return String(code)
    .replace(/[\s\-_.]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export class CryptoError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CryptoError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// SPAKE2 over P-256
// ---------------------------------------------------------------------------

/** Nothing-up-my-sleeve fixed group elements. Computed once, lazily. */
let SPAKE2_POINTS = null;
export function spake2Points() {
  if (!SPAKE2_POINTS) {
    const M = p256.hashToPoint(`${PAIRING_MAGIC}/M`);
    const N = p256.hashToPoint(`${PAIRING_MAGIC}/N`);
    if (p256.pointEq(M, N) || p256.pointEq(M, p256.G) || p256.pointEq(N, p256.G)) {
      throw new CryptoError('spake2_setup', 'degenerate M/N');
    }
    SPAKE2_POINTS = { M, N, Mbytes: p256.encodePoint(M), Nbytes: p256.encodePoint(N) };
  }
  return SPAKE2_POINTS;
}

/**
 * Derive the password scalar. `context` binds the code to this specific
 * pairing window (bridge id + pair id + protocol magic) so a recording of one
 * handshake cannot be replayed into another window, and so the same 6 digits
 * produce a different scalar every time.
 */
export function spake2Scalar(code, context) {
  const norm = normalizeCode(code);
  if (norm.length === 0) throw new CryptoError('pairing_code_empty');
  const digest = hmac(cat(PAIRING_MAGIC, '/w'), lp(context), norm);
  return p256.scalarFromDigest(digest);
}

/**
 * One side of a SPAKE2 exchange.
 *
 *   const a = new Spake2({ role: 'A', code, context, idA, idB });
 *   send(a.start());
 *   a.finish(peerMessage);
 *   if (!a.verifyPeer(peerConfirmTag)) abort();
 *   const psk = a.psk;   // 32 bytes, authenticated by the code
 */
export class Spake2 {
  /**
   * @param {{role: 'A'|'B', code: string, context: string|Buffer,
   *          idA: string, idB: string}} opts
   *   role 'A' is the initiator (agent), 'B' the responder (bridge).
   */
  constructor(opts) {
    if (opts.role !== 'A' && opts.role !== 'B') throw new CryptoError('spake2_role');
    this.role = opts.role;
    this.code = opts.code;
    this.context = toBuf(opts.context);
    this.idA = String(opts.idA);
    this.idB = String(opts.idB);
    this.w = spake2Scalar(this.code, this.context);
    this._priv = p256.randomScalar();
    this._own = null;
    this._peer = null;
    this._done = false;
    /** @type {Buffer|null} 32-byte PSK, set by finish() */
    this.psk = null;
    /** @type {Buffer|null} our confirmation tag to send to the peer */
    this.confirmOut = null;
    /** @type {Buffer|null} expected peer confirmation tag */
    this.confirmIn = null;
    /** transcript, exposed for auditing/tests */
    this.transcript = null;
  }

  /** @returns {Buffer} 33-byte compressed share to send to the peer */
  start() {
    if (this._own) throw new CryptoError('spake2_started');
    const { M, N } = spake2Points();
    const base = this.role === 'A' ? M : N;
    const wBase = p256.scalarMult(this.w, base);
    const own = p256.pointAdd(p256.scalarMult(this._priv, p256.G), wBase);
    if (own === null) throw new CryptoError('spake2_degenerate');
    this._own = p256.encodePoint(own);
    return this._own;
  }

  /**
   * Absorb the peer's share and derive the shared secret + confirmation tags.
   * @param {Buffer} peerShare 33-byte compressed point
   */
  finish(peerShare) {
    if (this._done) throw new CryptoError('spake2_finished');
    if (!this._own) throw new CryptoError('spake2_not_started');
    const { M, N, Mbytes, Nbytes } = spake2Points();
    const peer = p256.decodePoint(toBuf(peerShare));
    if (peer === null) throw new CryptoError('pairing_failed', 'invalid point');
    if (toBuf(peerShare).equals(this._own)) {
      // Reflection: a peer cannot be its own counterpart.
      throw new CryptoError('pairing_failed', 'reflected share');
    }

    // Strip our own mask, then multiply by our private scalar.
    const peerBase = this.role === 'A' ? N : M; // what the *peer* added
    const mask = p256.scalarMult(this.w, peerBase);
    const unmasked = p256.pointSub(peer, mask);
    if (unmasked === null) throw new CryptoError('pairing_failed', 'degenerate share');
    const K = p256.scalarMult(this._priv, unmasked);
    if (K === null) throw new CryptoError('pairing_failed', 'degenerate secret');

    const Xbytes = this.role === 'A' ? this._own : toBuf(peerShare);
    const Ybytes = this.role === 'A' ? toBuf(peerShare) : this._own;

    const TT = cat(
      lp(PAIRING_MAGIC),
      lp(this.context),
      lp(this.idA),
      lp(this.idB),
      lp(Xbytes),
      lp(Ybytes),
      lp(Mbytes),
      lp(Nbytes),
    );
    const Kbytes = p256.encodePoint(K);
    const Kdh = sha256(lp('K'), TT, Kbytes);
    const kA = sha256(lp('Ka'), TT, Kdh, lp(this.idA), lp(this.idB));
    const kB = sha256(lp('Kb'), TT, Kdh, lp(this.idA), lp(this.idB));
    const confirmA = hmac(kA, lp('confirmA'), TT);
    const confirmB = hmac(kB, lp('confirmB'), TT);

    this.transcript = TT;
    if (this.role === 'A') {
      this.confirmOut = confirmA;
      this.confirmIn = confirmB;
    } else {
      this.confirmOut = confirmB;
      this.confirmIn = confirmA;
    }
    this.psk = sha256(lp('psk'), TT, Kdh, lp(this.idA), lp(this.idB));
    this._peer = peer;
    this._done = true;
    return this;
  }

  /** Constant-time check of the peer's confirmation tag. */
  verifyPeer(tag) {
    if (!this._done) throw new CryptoError('spake2_not_finished');
    return timingSafeEqualBuf(tag, this.confirmIn);
  }
}

// ---------------------------------------------------------------------------
// PSK path (high-entropy secret) — plain ephemeral ECDH is then safe
// ---------------------------------------------------------------------------

/** Minimum length for a pasted base32 PSK: 22 chars ~ 110 bits. */
export const MIN_PSK_CHARS = 22;

export function assertPskStrength(psk) {
  const norm = normalizeCode(psk);
  if (norm.length < MIN_PSK_CHARS) {
    throw new CryptoError('psk_too_weak',
      `a pasted pre-shared key must be at least ${MIN_PSK_CHARS} base32 characters (~110 bits); ` +
      'use the pairing-code (SPAKE2) flow for short codes instead');
  }
  return norm;
}

// ---------------------------------------------------------------------------
// Session key agreement (authenticated ECDH)
// ---------------------------------------------------------------------------

/**
 * Canonical handshake transcript. Both sides build it from the *parsed* field
 * values of `hello`/`hello_ack`, so JSON formatting differences cannot make
 * the two sides disagree.
 */
export function buildTranscript(f) {
  return cat(
    lp(SESSION_MAGIC),
    lp(f.sessionId),
    lp(f.protocolVersion),
    lp(f.idA), lp(f.idB),
    lp(f.nonceA), lp(f.nonceB),
    lp(f.ephA), lp(f.ephB),
    lp(f.fpA), lp(f.fpB),
    lp(canonicalJson(f.negotiated ?? {})),
  );
}

/**
 * Native P-256 ECDH (OpenSSL) with a pure-BigInt fallback, so the code works
 * even on a runtime without ECDH. Both paths return the raw 32-byte
 * x-coordinate of the shared point (that is what `ecdh.computeSecret` returns
 * for P-256), which selftest.mjs asserts they agree on.
 */
export function ecdhSharedSecret(privScalar, peerPointBytes, { useNative = true } = {}) {
  const peer = Buffer.isBuffer(peerPointBytes) ? peerPointBytes : toBuf(peerPointBytes);
  const priv = typeof privScalar === 'bigint' ? privScalar : BigInt('0x' + toBuf(privScalar).toString('hex'));
  if (useNative) {
    try {
      const e = crypto.createECDH('prime256v1');
      e.setPrivateKey(Buffer.from(priv.toString(16).padStart(64, '0'), 'hex'));
      const peerPt = p256.decodePoint(peer.length === 33 ? peer : peer);
      if (peerPt === null) throw new CryptoError('bad_peer_point');
      return Buffer.from(e.computeSecret(p256.encodePointUncompressed(peerPt)));
    } catch (err) {
      if (err instanceof CryptoError) throw err;
      // fall through to the BigInt path on any OpenSSL refusal
    }
  }
  const pt = p256.decodePoint(peer);
  if (pt === null) throw new CryptoError('bad_peer_point');
  const shared = p256.scalarMult(priv, pt);
  if (shared === null) throw new CryptoError('degenerate_shared_secret');
  return Buffer.from(shared.x.toString(16).padStart(64, '0'), 'hex');
}

export function generateEphemeral() {
  const priv = p256.randomScalar();
  const pub = p256.scalarMult(priv, p256.G);
  if (pub === null) throw new CryptoError('ephemeral_degenerate');
  return { priv, pub: p256.encodePoint(pub), pubPoint: pub };
}

/**
 * Derive the per-direction AEAD keys for one epoch.
 *
 * IKM  = ECDH(ephemeral) || psk?          (psk only on the pairing connection)
 * salt = SHA-256(KDF_MAGIC || transcript)
 * PRK  = HKDF-Extract(salt, IKM)
 * km   = HKDF-Expand(PRK, KDF_MAGIC || 'keys' || epoch, 128)
 *
 * Layout of `km` (byte offsets):
 *   [  0, 32) key A->B          [ 32, 64) key B->A
 *   [ 64, 68) nonce salt A->B   [ 68, 72) nonce salt B->A
 *   [ 72,104) handshake confirm key
 *   [104,128) reserved (future: rekey seed / capability-keyed subkeys)
 */
export const KDF_KM_BYTES = 128;

export function deriveEpochKeys({ prk, epoch = 0 }) {
  const km = hkdfExpand(prk, cat(lp(`${KDF_MAGIC}/keys`), lp(String(epoch))), KDF_KM_BYTES);
  return {
    epoch,
    keyA2B: km.subarray(0, 32),
    keyB2A: km.subarray(32, 64),
    saltA2B: km.subarray(64, 68),
    saltB2A: km.subarray(68, 72),
    confirmKey: km.subarray(72, 104),
    reserved: km.subarray(104, 128),
  };
}

export function derivePrk({ transcript, sharedSecret, psk = Buffer.alloc(0) }) {
  const ikm = psk && psk.length > 0 ? cat(sharedSecret, psk) : cat(sharedSecret);
  const salt = sha256(lp(`${KDF_MAGIC}/salt`), transcript);
  return hkdfExtract(salt, ikm);
}

/** Handshake key-confirmation tag. Binds the finished keys to the transcript. */
export function handshakeConfirm(confirmKey, transcriptHash, sideId) {
  return hmac(confirmKey, lp(`${SESSION_MAGIC}/confirm`), lp(transcriptHash), lp(sideId));
}

// ---------------------------------------------------------------------------
// Long-term Ed25519 identity
// ---------------------------------------------------------------------------

export function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  return {
    pubDer: spki,
    privDer: pkcs8,
    pub: Buffer.from(spki).toString('base64url'),
    priv: Buffer.from(pkcs8).toString('base64url'),
    fingerprint: fingerprintOf(spki),
  };
}

export function fingerprintOf(spkiDer) {
  return group(base32(sha256(toBuf(spkiDer))).slice(0, 20), 4);
}

export function signWith(privDerB64u, data) {
  const key = crypto.createPrivateKey({ key: Buffer.from(privDerB64u, 'base64url'), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, toBuf(data), key);
}

export function verifyWith(pubDerB64u, data, sig) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(pubDerB64u, 'base64url'), format: 'der', type: 'spki' });
    return crypto.verify(null, toBuf(data), key, toBuf(sig));
  } catch {
    return false;
  }
}

/** Signature over a handshake transcript (reconnect authentication). */
export function signTranscript(privDerB64u, transcript, role) {
  return signWith(privDerB64u, cat(lp(`${SESSION_MAGIC}/auth`), lp(role), lp(transcript)));
}

export function verifyTranscript(pubDerB64u, transcript, role, sig) {
  return verifyWith(pubDerB64u, cat(lp(`${SESSION_MAGIC}/auth`), lp(role), lp(transcript)), sig);
}

/** Announce signatures (discovery): proves the announce came from the key owner. */
export function signAnnounce(privDerB64u, msg) {
  const { sig, ...rest } = msg;
  return signWith(privDerB64u, cat(lp(ANNOUNCE_MAGIC), canonicalJson(rest)));
}

export function verifyAnnounce(pubDerB64u, msg) {
  if (!msg || typeof msg.sig !== 'string') return false;
  const { sig, ...rest } = msg;
  return verifyWith(pubDerB64u, cat(lp(ANNOUNCE_MAGIC), canonicalJson(rest)), Buffer.from(sig, 'base64url'));
}

// ---------------------------------------------------------------------------
// Replay window
// ---------------------------------------------------------------------------

/** Sliding-window replay protection (accepts reordering inside the window). */
export class ReplayWindow {
  constructor(size = REPLAY_WINDOW) {
    if (size < 1 || size > 64) throw new RangeError('replay window must be 1..64');
    this.size = size;
    this.highest = 0;
    this.bitmap = 0n;
    this._mask = (1n << BigInt(size)) - 1n;
    this.accepted = 0;
    this.rejectedReplay = 0;
    this.rejectedStale = 0;
  }

  /**
   * @param {number} seq 1-based frame counter
   * @returns {'ok'|'replay'|'too_old'|'invalid'} and commits the sequence on 'ok'
   */
  accept(seq) {
    if (!Number.isInteger(seq) || seq < 1) return 'invalid';
    if (seq > this.highest) {
      const shift = BigInt(seq - this.highest);
      this.bitmap = ((this.bitmap << shift) | 1n) & this._mask;
      this.highest = seq;
      this.accepted++;
      return 'ok';
    }
    const delta = this.highest - seq;
    if (delta >= this.size) { this.rejectedStale++; return 'too_old'; }
    const bit = 1n << BigInt(delta);
    if ((this.bitmap & bit) !== 0n) { this.rejectedReplay++; return 'replay'; }
    this.bitmap |= bit;
    this.accepted++;
    return 'ok';
  }

  /** Non-mutating check (useful for pre-validation). */
  peek(seq) {
    if (!Number.isInteger(seq) || seq < 1) return 'invalid';
    if (seq > this.highest) return 'ok';
    const delta = this.highest - seq;
    if (delta >= this.size) return 'too_old';
    return (this.bitmap & (1n << BigInt(delta))) !== 0n ? 'replay' : 'ok';
  }

  reset() {
    this.highest = 0;
    this.bitmap = 0n;
  }
}

// ---------------------------------------------------------------------------
// Secure channel
// ---------------------------------------------------------------------------

/**
 * One direction's AEAD state.
 * Nonce = salt(4) || counter(8, big-endian). The salt is unique per key per
 * direction (HKDF output), the counter never repeats inside an epoch, and the
 * key changes on every epoch, so a (key, nonce) pair is never reused.
 */
class Direction {
  constructor(key, salt, epoch, { isSend }) {
    this.key = key;
    this.salt = salt;
    this.epoch = epoch;
    this.isSend = isSend;
    this.counter = 0;
    this.bytes = 0;
    /** Replay window for this epoch's receive direction. Sequence numbers
     *  restart at 1 in every epoch, so the window MUST be per epoch: sharing
     *  one window across a rekey would reject the new epoch's first frames as
     *  "too old". */
    this.replay = isSend ? null : new ReplayWindow();
  }

  nextIv() {
    if (this.counter >= Number.MAX_SAFE_INTEGER) throw new CryptoError('nonce_exhausted');
    this.counter += 1;
    const iv = Buffer.alloc(AEAD_IV_BYTES);
    this.salt.copy(iv, 0);
    iv.writeBigUInt64BE(BigInt(this.counter), IV_SALT_BYTES);
    return { seq: this.counter, iv };
  }

  ivFor(seq) {
    const iv = Buffer.alloc(AEAD_IV_BYTES);
    this.salt.copy(iv, 0);
    iv.writeBigUInt64BE(BigInt(seq), IV_SALT_BYTES);
    return iv;
  }
}

export class SecureChannel {
  /**
   * @param {{role:'agent'|'bridge', prk:Buffer, transcriptHash:Buffer,
   *          confirmKey:Buffer, confirmOut:Buffer, confirmIn:Buffer,
   *          epoch?:number, useNativeEcdh?:boolean}} opts
   */
  constructor(opts) {
    if (opts.role !== 'agent' && opts.role !== 'bridge') throw new CryptoError('bad_role');
    this.role = opts.role;
    this.prk = opts.prk;
    this.transcriptHash = opts.transcriptHash;
    this.epoch = opts.epoch ?? 0;
    this.established = false;
    /** @type {Map<number, {send: Direction, recv: Direction, retiredAt: number}>} */
    this.epochs = new Map();
    this.stats = { sent: 0, received: 0, sendBytes: 0, recvBytes: 0, authFailures: 0, replays: 0 };
    /** AAD direction bytes: ours for what we seal, the peer's for what we open. */
    this.sendDirByte = this.role === 'agent' ? DIR_AGENT_TO_BRIDGE : DIR_BRIDGE_TO_AGENT;
    this.recvDirByte = this.role === 'agent' ? DIR_BRIDGE_TO_AGENT : DIR_AGENT_TO_BRIDGE;
    this._installEpoch(this.epoch, opts.prk);
    this._rekeyStartedAt = Date.now();
    this._rekeyFrames = 0;
    this._rekeyBytes = 0;
  }

  _installEpoch(epoch, prk) {
    const km = deriveEpochKeys({ prk, epoch });
    const isAgent = this.role === 'agent';
    const send = new Direction(isAgent ? km.keyA2B : km.keyB2A, isAgent ? km.saltA2B : km.saltB2A, epoch, { isSend: true });
    const recv = new Direction(isAgent ? km.keyB2A : km.keyA2B, isAgent ? km.saltB2A : km.saltA2B, epoch, { isSend: false });
    this.epochs.set(epoch, { send, recv, retiredAt: 0 });
    this.confirmKey = km.confirmKey;
    return km;
  }

  get dirByte() { return this.sendDirByte; }

  /** Cleartext header carries only what the receiver needs pre-decryption. */
  _headerFor(seq, iv, epoch, subtype) {
    const h = { t: 'enc', e: epoch, s: seq, iv: iv.toString('base64url') };
    if (subtype) h.st = subtype;
    return h;
  }

  /**
   * Encrypt one message.
   * @param {object} body plaintext JSON body (message type + fields)
   * @param {Buffer|null} payload optional binary payload
   * @returns {{header: object, headerBytes: Buffer, ciphertext: Buffer, seq: number}}
   */
  seal(body, payload = null) {
    const cur = this.epochs.get(this.epoch);
    const { seq, iv } = cur.send.nextIv();
    const bodyBytes = Buffer.from(JSON.stringify(body), 'utf8');
    const bodyLen = Buffer.alloc(4);
    bodyLen.writeUInt32BE(bodyBytes.length, 0);
    const bodyBuf = payload && payload.length ? Buffer.concat([bodyLen, bodyBytes, payload]) : Buffer.concat([bodyLen, bodyBytes]);
    if (bodyBuf.length > MAX_PLAINTEXT_BYTES) throw new CryptoError('plaintext_too_large');

    const header = this._headerFor(seq, iv, this.epoch, body.t);
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const aad = buildAAD(this.dirByte, headerBytes);

    const cipher = crypto.createCipheriv('aes-256-gcm', cur.send.key, iv, { authTagLength: AEAD_TAG_BYTES });
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(bodyBuf), cipher.final(), cipher.getAuthTag()]);

    cur.send.bytes += ct.length;
    this.stats.sent++;
    this.stats.sendBytes += ct.length;
    this._rekeyFrames++;
    this._rekeyBytes += ct.length;
    return { header, headerBytes, ciphertext: ct, seq };
  }

  /**
   * Decrypt one received frame. Rejects replays, stale frames, wrong epochs and
   * tampered ciphertext/AAD.
   * @param {{header: object, headerBytes: Buffer, payload: Buffer}} frame
   * @returns {{body: object, payload: Buffer, seq: number, epoch: number}}
   */
  open(frame) {
    const header = frame.header;
    if (!header || header.t !== 'enc') throw new CryptoError('not_encrypted');
    const epoch = header.e ?? 0;
    const seq = header.s;
    const slot = this.epochs.get(epoch);
    if (!slot) throw new CryptoError('unknown_epoch', String(epoch));
    if (epoch !== this.epoch) {
      // Only the immediately previous epoch is accepted, and only inside the
      // grace window, so frames already in flight across a rekey still land.
      const insideGrace = epoch === this.epoch - 1
        && slot.retiredAt !== 0
        && (Date.now() - slot.retiredAt) <= KEY_RETIRE_MS;
      if (!insideGrace) throw new CryptoError('unknown_epoch', String(epoch));
    }
    const verdict = slot.recv.replay.peek(seq);
    if (verdict !== 'ok') {
      this.stats.replays++;
      throw new CryptoError(verdict === 'replay' ? 'replay_detected' : 'stale_frame', `seq=${seq}`);
    }
    if (typeof header.iv !== 'string') throw new CryptoError('bad_iv');
    const wireIv = Buffer.from(header.iv, 'base64url');
    if (wireIv.length !== AEAD_IV_BYTES) throw new CryptoError('bad_iv_length');
    // The nonce is DERIVED (salt_of_this_key || seq), never taken from the wire:
    //  - nonce discipline is then structural: no peer can make us decrypt with
    //    an attacker-chosen nonce or a repeated one,
    //  - a tampered `iv` field still fails authentication, because the whole
    //    cleartext header (including it) is the AAD,
    //  - a receiver with the wrong key derives a different nonce and fails with
    //    the same generic error as any other mismatch, so there is no
    //    failure-mode oracle. The wire copy is advisory/debug only.
    const iv = slot.recv.ivFor(seq);

    const aad = buildAAD(this.recvDirByte, frame.headerBytes);
    // `payload` is the wire shape (frame.js decoder); `ciphertext` is the shape
    // returned by seal(). Accepting both keeps seal/open symmetric for tests
    // and for in-process loopback channels.
    const ct = frame.payload ?? frame.ciphertext;
    if (!Buffer.isBuffer(ct) || ct.length < AEAD_TAG_BYTES) throw new CryptoError('short_ciphertext');
    const tag = ct.subarray(ct.length - AEAD_TAG_BYTES);
    const body = ct.subarray(0, ct.length - AEAD_TAG_BYTES);
    let plain;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', slot.recv.key, iv, { authTagLength: AEAD_TAG_BYTES });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      this.stats.authFailures++;
      // One generic error: a wrong key, a tampered tag and a tampered header
      // must not be distinguishable to the peer.
      throw new CryptoError('auth_failed');
    }
    if (plain.length < 4) throw new CryptoError('malformed_plaintext');
    const bodyLen = plain.readUInt32BE(0);
    if (4 + bodyLen > plain.length) throw new CryptoError('malformed_plaintext');
    let parsed;
    try {
      parsed = JSON.parse(plain.subarray(4, 4 + bodyLen).toString('utf8'));
    } catch {
      throw new CryptoError('malformed_plaintext');
    }
    slot.recv.replay.accept(seq);
    slot.recv.counter = Math.max(slot.recv.counter, seq);
    slot.recv.bytes += ct.length;
    this.stats.received++;
    this.stats.recvBytes += ct.length;
    return { body: parsed, payload: plain.subarray(4 + bodyLen), seq, epoch };
  }

  /**
   * Handshake key confirmation. Both sides compute the *same* function of
   * (confirmKey, transcriptHash, senderId); a receiver checks the tag the peer
   * sent for the peer's own id. There is no direction-specific state, so the
   * two sides cannot disagree about which key confirms what.
   */
  expectedConfirm(senderId) {
    return handshakeConfirm(this.confirmKey, this.transcriptHash, senderId);
  }

  /** Constant-time verification of a peer's key-confirmation tag. */
  checkConfirm(senderId, tag) {
    return timingSafeEqualBuf(tag, this.expectedConfirm(senderId));
  }

  /** @returns {boolean} true when a rekey should be initiated now */
  needsRekey(now = Date.now()) {
    return this._rekeyFrames >= REKEY_AFTER_FRAMES
      || this._rekeyBytes >= REKEY_AFTER_BYTES
      || (now - this._rekeyStartedAt) >= REKEY_AFTER_MS;
  }

  /**
   * Install a new epoch. `newPrk` must be derived from BOTH the old PRK and a
   * fresh ephemeral ECDH (see link.js), which gives post-compromise recovery
   * for the new epoch while the peer confirms it under the old keys.
   */
  installEpoch(epoch, newPrk) {
    if (epoch <= this.epoch) throw new CryptoError('epoch_not_monotonic');
    const prev = this.epochs.get(this.epoch);
    if (prev) prev.retiredAt = Date.now();
    this.epoch = epoch;
    this._installEpoch(epoch, newPrk);
    this._rekeyStartedAt = Date.now();
    this._rekeyFrames = 0;
    this._rekeyBytes = 0;
    return this;
  }

  /** Forget epochs whose grace period has elapsed. */
  pruneRetired(now = Date.now()) {
    for (const [epoch, slot] of this.epochs) {
      if (slot.retiredAt !== 0 && now - slot.retiredAt > KEY_RETIRE_MS) this.epochs.delete(epoch);
    }
    return this.epochs.size;
  }

  /** Mix a fresh ECDH into the PRK for the next epoch. */
  static rekeyPrk({ prk, sharedSecret, transcript }) {
    return hkdfExtract(sha256(lp(`${KDF_MAGIC}/rekey`), lp(transcript)), cat(prk, sharedSecret));
  }
}

// ---------------------------------------------------------------------------
// Pairing attempt guard (bounded attempts + hard lockout)
// ---------------------------------------------------------------------------

export class PairingGuard {
  /**
   * @param {{maxAttempts?:number, windowMs?:number, cooldownsMs?:number[],
   *          hardLockAfter?:number, stateFile?:string|null, now?:()=>number}} opts
   */
  constructor(opts = {}) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.windowMs = opts.windowMs ?? 120000;
    this.cooldownsMs = opts.cooldownsMs ?? [30000, 120000, 600000, 3600000];
    this.hardLockAfter = opts.hardLockAfter ?? 20;
    this.stateFile = opts.stateFile ?? null;
    this.now = opts.now ?? (() => Date.now());

    this.window = null; // { code, context, pairId, openedAt, expiresAt, attempts, id }
    this.failures = 0; // cumulative failures (across windows)
    this.lockedUntil = 0;
    this.hardLocked = false;
    this.log = [];
    if (this.stateFile) this._load();
  }

  get lockedOut() {
    return this.hardLocked || this.now() < this.lockedUntil;
  }

  get lockRemainingMs() {
    return this.hardLocked ? Infinity : Math.max(0, this.lockedUntil - this.now());
  }

  /**
   * Open a fresh pairing window. Any previous window is invalidated, which is
   * what makes a code single-use: after a failure the user must generate a new
   * one (and an attacker cannot keep guessing against the same code).
   *
   * The return value is directly usable as `pairing` for bridgeHandshake():
   * `{ pairId, code, context, ...status }`.
   */
  openWindow({ code, context, pairId = randomBytes(8).toString('hex') } = {}) {
    if (this.lockedOut) throw new CryptoError('locked_out', `retry in ${this.lockRemainingMs} ms`);
    if (!code) throw new CryptoError('pairing_code_missing');
    const now = this.now();
    this.window = {
      id: pairId,
      code,
      context: context ?? pairId,
      openedAt: now,
      expiresAt: now + this.windowMs,
      attempts: 0,
    };
    this._audit('window_open', { id: pairId });
    return { pairId, code, context: this.window.context, ...this.status() };
  }

  closeWindow(reason = 'closed') {
    if (this.window) this._audit('window_close', { id: this.window.id, reason });
    this.window = null;
  }

  _windowValid(w) {
    const now = this.now();
    return !!(w && now < w.expiresAt);
  }

  /**
   * Authorise one attempt attempt. Throws when the window is closed/expired or
   * the source is throttled. Constant behaviour for unknown pair ids: callers
   * must treat "no window" and "expired" identically.
   */
  beginAttempt(pairId) {
    if (this.hardLocked) throw new CryptoError('locked_out', 'hard lockout; manual reset required');
    const now = this.now();
    if (now < this.lockedUntil) throw new CryptoError('locked_out', `retry in ${this.lockRemainingMs} ms`);
    const w = this.window;
    if (!this._windowValid(w)) throw new CryptoError('pairing_failed', 'no active pairing window');
    if (pairId !== undefined && pairId !== null && pairId !== w.id) {
      // Same generic error as a wrong code: an attacker must not be able to
      // probe for a live window id.
      throw new CryptoError('pairing_failed', 'unknown pair id');
    }
    if (w.attempts >= this.maxAttempts) {
      this._fail('attempts_exhausted');
      throw new CryptoError('locked_out', 'attempts exhausted');
    }
    w.attempts++;
    this._audit('attempt', { id: w.id, n: w.attempts });
    return { windowId: w.id, attemptsUsed: w.attempts, attemptsLeft: this.maxAttempts - w.attempts };
  }

  success() {
    this._audit('success', { id: this.window ? this.window.id : null });
    this.failures = 0;
    this.lockedUntil = 0;
    this.hardLocked = false;
    this.closeWindow('paired');
    this._save();
  }

  /** Record a failed attempt and apply the cool-down schedule. */
  fail(reason = 'bad_code') {
    if (this.window) this.window.attempts = Math.max(this.window.attempts, this.maxAttempts);
    this._fail(reason);
  }

  _fail(reason) {
    this.failures++;
    const cooldown = this.cooldownsMs[Math.min(this.failures - 1, this.cooldownsMs.length - 1)];
    this.lockedUntil = Math.max(this.lockedUntil, this.now() + cooldown);
    if (this.failures >= this.hardLockAfter) this.hardLocked = true;
    this._audit('fail', { reason, failures: this.failures, cooldown, hardLocked: this.hardLocked });
    this.closeWindow(reason);
    this._save();
  }

  /** Manual unlock from the bridge UI (audited). */
  reset() {
    this.failures = 0;
    this.lockedUntil = 0;
    this.hardLocked = false;
    this.closeWindow('manual_reset');
    this._audit('manual_reset', {});
    this._save();
  }

  status() {
    const w = this.window;
    return {
      pairing: this._windowValid(w),
      windowId: this._windowValid(w) ? w.id : null,
      attemptsUsed: w ? w.attempts : 0,
      attemptsLeft: w ? Math.max(0, this.maxAttempts - w.attempts) : 0,
      lockedOut: this.lockedOut,
      lockRemainingMs: this.lockRemainingMs === Infinity ? null : this.lockRemainingMs,
      hardLocked: this.hardLocked,
      failures: this.failures,
    };
  }

  _audit(event, data) {
    this.log.push({ ts: this.now(), event, ...data });
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      this.failures = raw.failures ?? 0;
      this.lockedUntil = raw.lockedUntil ?? 0;
      this.hardLocked = !!raw.hardLocked;
    } catch { /* first run */ }
  }

  _save() {
    if (!this.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({
        failures: this.failures, lockedUntil: this.lockedUntil, hardLocked: this.hardLocked,
      }), { mode: 0o600 });
    } catch { /* a failed persist must not take the bridge down */ }
  }
}

// ---------------------------------------------------------------------------
// Trust store (TOFU with explicit confirmation)
// ---------------------------------------------------------------------------

export class TrustStore {
  /**
   * @param {{file?:string|null, deviceId:string, name?:string, role?:string,
   *          requireUserConfirm?:boolean}} opts
   */
  constructor(opts = {}) {
    this.file = opts.file ?? null;
    this.requireUserConfirm = opts.requireUserConfirm !== false;
    this.data = {
      version: 1,
      identity: null, // { pub, priv, fingerprint, createdAt }
      self: { deviceId: opts.deviceId, name: opts.name ?? '', role: opts.role ?? '' },
      peers: {}, // deviceId -> peer record
      pending: {}, // deviceId -> proposed record awaiting user confirmation
    };
    this.loaded = false;
    if (this.file) this.load();
    this.ensureIdentity();
  }

  get deviceId() { return this.data.self.deviceId; }
  get identity() { return this.data.identity; }
  get fingerprint() { return this.data.identity.fingerprint; }
  get pub() { return this.data.identity.pub; }

  ensureIdentity() {
    if (!this.data.identity) {
      const id = generateIdentity();
      this.data.identity = { pub: id.pub, priv: id.priv, fingerprint: id.fingerprint, createdAt: Date.now() };
      this.save();
    }
    return this.data.identity;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.version === 1) {
        this.data = {
          version: 1,
          identity: raw.identity ?? null,
          self: { ...this.data.self, ...(raw.self ?? {}) },
          peers: raw.peers ?? {},
          pending: raw.pending ?? {},
        };
      }
    } catch { /* first run or unreadable: start empty (fail closed for writes) */ }
    this.loaded = true;
    return this;
  }

  save() {
    if (!this.file) return this;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      // 0o600: the file holds private keys. On Windows the mode is ignored and
      // the ACL of the (per-user) parent directory applies.
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* ignore: an unwritable trust store degrades to "not paired" */ }
    return this;
  }

  getPeer(deviceId) {
    return this.data.peers[deviceId] ?? null;
  }

  isTrusted(deviceId) {
    const p = this.data.peers[deviceId];
    return !!(p && p.trusted);
  }

  /**
   * TOFU step 1: record the key we just saw. With requireUserConfirm the peer
   * is not usable until the user accepts it in the bridge UI. A *changed* key
   * for a known device is never auto-accepted.
   * @returns {{status:'new'|'pending'|'known'|'changed', peer: object}}
   */
  proposePeer({ deviceId, name, role, pubKey, fingerprint }) {
    const existing = this.data.peers[deviceId];
    if (existing) {
      if (existing.pubKey !== pubKey) {
        existing.keyChangedTo = { pubKey, fingerprint, at: Date.now() };
        this.data.pending[deviceId] = { deviceId, name, role, pubKey, fingerprint, reason: 'key_changed', at: Date.now() };
        this.save();
        return { status: 'changed', peer: existing };
      }
      existing.lastSeen = Date.now();
      if (name) existing.name = name;
      this.save();
      return { status: 'known', peer: existing };
    }
    if (this.requireUserConfirm) {
      const rec = { deviceId, name, role, pubKey, fingerprint, at: Date.now() };
      this.data.pending[deviceId] = rec;
      this.save();
      return { status: 'pending', peer: rec };
    }
    const rec = this.upsertPeer({ deviceId, name, role, pubKey, fingerprint, trusted: true });
    return { status: 'new', peer: rec };
  }

  upsertPeer({ deviceId, name, role, pubKey, fingerprint, trusted = true }) {
    const prev = this.data.peers[deviceId] ?? {};
    const rec = {
      ...prev,
      deviceId,
      name: name ?? prev.name ?? '',
      role: role ?? prev.role ?? '',
      pubKey,
      fingerprint: fingerprint ?? prev.fingerprint ?? '',
      trusted,
      pairedAt: prev.pairedAt ?? Date.now(),
      lastSeen: Date.now(),
    };
    delete rec.keyChangedTo;
    this.data.peers[deviceId] = rec;
    delete this.data.pending[deviceId];
    this.save();
    return rec;
  }

  /** TOFU step 2: the user accepted the fingerprint in the UI. */
  confirmPeer(deviceId) {
    const p = this.data.pending[deviceId];
    if (!p) throw new CryptoError('no_pending_peer', deviceId);
    return this.upsertPeer({ ...p, trusted: true });
  }

  rejectPeer(deviceId) {
    delete this.data.pending[deviceId];
    this.save();
  }

  revokePeer(deviceId) {
    delete this.data.peers[deviceId];
    this.save();
  }

  listPeers() {
    return Object.values(this.data.peers);
  }

  listPending() {
    return Object.values(this.data.pending);
  }

  sign(data) { return signWith(this.data.identity.priv, data); }
  verify(deviceId, data, sig) {
    const peer = this.getPeer(deviceId);
    if (!peer || !peer.trusted) return false;
    return verifyWith(peer.pubKey, data, sig);
  }
}

export default {
  PAIRING_MAGIC, SESSION_MAGIC, KDF_MAGIC,
  AEAD_KEY_BYTES, AEAD_IV_BYTES, AEAD_TAG_BYTES, IV_SALT_BYTES,
  REPLAY_WINDOW, REKEY_AFTER_FRAMES, REKEY_AFTER_BYTES, REKEY_AFTER_MS, KEY_RETIRE_MS,
  randomBytes, sha256, hmac, hkdf, hkdfExtract, hkdfExpand, lp, cat,
  timingSafeEqualBuf, canonicalJson, base32, group, randomInt,
  generatePairingCode, normalizeCode, CryptoError,
  Spake2, spake2Scalar, spake2Points,
  assertPskStrength, MIN_PSK_CHARS,
  buildTranscript, ecdhSharedSecret, generateEphemeral, derivePrk, deriveEpochKeys, handshakeConfirm,
  generateIdentity, fingerprintOf, signWith, verifyWith, signTranscript, verifyTranscript,
  signAnnounce, verifyAnnounce,
  ReplayWindow, SecureChannel, PairingGuard, TrustStore,
};
