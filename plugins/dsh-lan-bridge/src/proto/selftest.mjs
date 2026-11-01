/**
 * selftest.mjs — runnable end-to-end self-test for the DSH LAN bridge wire layer.
 *
 *   node selftest.mjs            # full run
 *   node selftest.mjs --verbose  # also print details for skipped/unavailable paths
 *
 * Zero dependencies beyond the local modules. Every case prints PASS/FAIL (or
 * SKIP when the environment genuinely cannot exercise it, e.g. no usable NIC for
 * the multicast case). The process exits non-zero if anything failed.
 *
 * Two in-process endpoints talk over a REAL loopback TCP socket; nothing is
 * stubbed except where the test is explicitly about a broken or hostile peer.
 */

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  FrameDecoder, encodeFrame, buildAAD, MAX_FRAME_BYTES, ByteQueue,
} from './frame.js';
import * as C from './crypto.js';
import * as P256 from './p256.js';
import { FrameLink, agentHandshake, bridgeHandshake, negotiate, compareVersions } from './link.js';
import * as POL from './policy.js';
import { Discovery, listCandidateInterfaces, inSubnet, broadcastAddress, platformNotes } from './discovery.js';

const VERBOSE = process.argv.includes('--verbose');
const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  process.stdout.write(`\n=== ${name} ===\n`);
}

async function testCase(name, fn) {
  const t0 = Date.now();
  try {
    const outcome = await fn();
    const ms = Date.now() - t0;
    if (outcome && outcome.skip) {
      results.push({ group: currentGroup, name, status: 'SKIP', detail: outcome.skip, ms });
      process.stdout.write(`SKIP  ${name}  (${outcome.skip})\n`);
    } else {
      const detail = typeof outcome === 'string' ? `  -> ${outcome}` : '';
      results.push({ group: currentGroup, name, status: 'PASS', detail: typeof outcome === 'string' ? outcome : '', ms });
      process.stdout.write(`PASS  ${name}${detail}  [${ms}ms]\n`);
    }
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ group: currentGroup, name, status: 'FAIL', detail: err && err.message, ms });
    process.stdout.write(`FAIL  ${name}  [${ms}ms]\n        ${err && (err.stack ?? err.message ?? err)}\n`);
  }
}

// --- tiny assertion helpers -------------------------------------------------
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not deep equal'}: got ${a}, expected ${b}`);
}
async function rejects(fn, codeOrPredicate, msg) {
  let caught = null;
  try { await fn(); } catch (err) { caught = err; }
  if (!caught) throw new Error(`${msg || 'expected a rejection'}: nothing was thrown`);
  if (typeof codeOrPredicate === 'string') {
    const seen = caught.code ?? caught.name;
    if (seen !== codeOrPredicate) throw new Error(`${msg || 'wrong error'}: got ${seen} (${caught.message}), expected ${codeOrPredicate}`);
  } else if (typeof codeOrPredicate === 'function' && !codeOrPredicate(caught)) {
    throw new Error(`${msg || 'predicate failed'}: ${caught.code} ${caught.message}`);
  }
  return caught;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fail fast instead of hanging if a socket event never arrives. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`timed out after ${ms}ms waiting for ${label}`); }),
  ]);
}

/**
 * Watchdog: a self-test that hangs is worse than one that fails, so the whole
 * run is bounded. unref'd, so it never keeps the process alive by itself.
 */
const WATCHDOG_MS = Number(process.env.DSH_SELFTEST_TIMEOUT_MS ?? 120000);
const watchdog = setTimeout(() => {
  process.stdout.write(`\nWATCHDOG: selftest exceeded ${WATCHDOG_MS}ms, aborting as FAIL\n`);
  process.stdout.write('RESULT: FAIL\n');
  process.exit(3);
}, WATCHDOG_MS);
watchdog.unref?.();

/** Build a frame with arbitrary (possibly invalid) header bytes. */
function encodeFrameRaw(headerBytes) {
  const out = Buffer.alloc(8 + headerBytes.length);
  out.writeUInt32BE(4 + headerBytes.length, 0);
  out.writeUInt32BE(headerBytes.length, 4);
  headerBytes.copy(out, 8);
  return out;
}

// --- fixtures ---------------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lan-bridge-selftest-'));
const CLEANUP = [];
function cleanupAll() {
  for (const fn of CLEANUP.reverse()) { try { fn(); } catch { /* ignore */ } }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ===========================================================================
// 1. Framing
// ===========================================================================

group('1. Framing (frame.js)');

await testCase('frame round trip with JSON header + binary payload', async () => {
  const payload = crypto.randomBytes(1024);
  const frame = encodeFrame({ t: 'req', id: 7, s: 'x' }, payload);
  const d = new FrameDecoder();
  const frames = d.push(frame);
  eq(frames.length, 1, 'frame count');
  eq(frames[0].header.id, 7, 'header id');
  ok(frames[0].payload.equals(payload), 'payload bytes preserved');
  return `${frame.length} bytes`;
});

await testCase('parser handles partial reads and several frames per chunk', async () => {
  const a = encodeFrame({ t: 'a' }, Buffer.from('one'));
  const b = encodeFrame({ t: 'b' }, Buffer.from('two'));
  const c = encodeFrame({ t: 'c' });
  const all = Buffer.concat([a, b, c]);

  const d1 = new FrameDecoder();
  const seen1 = [];
  for (const byte of all) seen1.push(...d1.push(Buffer.from([byte])));
  deepEq(seen1.map((f) => f.header.t), ['a', 'b', 'c'], 'byte-at-a-time');
  eq(seen1[1].payload.toString(), 'two', 'payload across chunk boundaries');

  const d2 = new FrameDecoder();
  eq(d2.push(all).length, 3, 'all frames in one chunk');

  const d3 = new FrameDecoder();
  eq(d3.push(all.subarray(0, a.length + 5)).length, 1, 'split mid-frame: only complete frames come out');
  eq(d3.push(all.subarray(a.length + 5)).length, 2, 'remainder');
  return 'byte-at-a-time + batched + mid-frame split';
});

await testCase('oversized frame is rejected before allocation and poisons the stream', async () => {
  const d = new FrameDecoder();
  const bogus = Buffer.alloc(8);
  bogus.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
  bogus.writeUInt32BE(4, 4);
  const err = await rejects(() => d.push(bogus), 'frame_too_large');
  eq(err.fatal, true, 'fatal');
  eq(d.ok, false, 'decoder poisoned');
  await rejects(() => d.push(Buffer.alloc(4)), 'frame_too_large', 'further pushes keep failing');
  return `declared ${MAX_FRAME_BYTES + 1} bytes refused`;
});

await testCase('malformed frames are rejected (inconsistent length, bad JSON, empty header)', async () => {
  const tooBigHeader = Buffer.alloc(8);
  tooBigHeader.writeUInt32BE(100, 0);
  tooBigHeader.writeUInt32BE(200, 4);
  await rejects(() => new FrameDecoder().push(tooBigHeader), 'frame_inconsistent');
  await rejects(() => new FrameDecoder().push(encodeFrameRaw(Buffer.from('not json at all'))), 'header_not_json');
  const errHeader = Buffer.alloc(8);
  errHeader.writeUInt32BE(4, 0);
  errHeader.writeUInt32BE(0, 4);
  await rejects(() => new FrameDecoder().push(errHeader), 'header_empty');
  await rejects(() => new FrameDecoder().push(encodeFrameRaw(Buffer.from('[1,2,3]'))), 'header_not_object');
  return '4 shapes refused';
});

await testCase('a truncated trailing frame is reported at EOF, not silently ignored', async () => {
  const frame = encodeFrame({ t: 'x' }, Buffer.alloc(64));
  const d = new FrameDecoder();
  d.push(frame.subarray(0, frame.length - 10));
  await rejects(() => d.end(), 'truncated_frame');
  return 'ok';
});

await testCase('AAD binds direction, header length and header bytes unambiguously', async () => {
  const h1 = Buffer.from('{"a":1}');
  const h2 = Buffer.from('{"a":1} ');
  const a1 = buildAAD(0x41, h1), a2 = buildAAD(0x42, h1), a3 = buildAAD(0x41, h2);
  ok(!a1.equals(a2), 'direction changes the AAD');
  ok(!a1.equals(a3), 'header bytes change the AAD');
  ok(!buildAAD(0x41, Buffer.from('AB')).equals(buildAAD(0x41, Buffer.from('AB\0'))), 'length is covered');
  eq(a1.length, 5 + h1.length, 'layout');
  return 'direction + length + bytes';
});

await testCase('ByteQueue keeps byte order across many odd-sized chunks', async () => {
  const q = new ByteQueue();
  const source = crypto.randomBytes(5000);
  let off = 0;
  const sizes = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
  let i = 0;
  while (off < source.length) {
    const n = Math.min(sizes[i++ % sizes.length], source.length - off);
    q.push(source.subarray(off, off + n));
    off += n;
  }
  eq(q.length, source.length, 'queued length');
  ok(q.read(source.length).equals(source), 'byte order preserved');
  eq(q.length, 0, 'drained');
  return '5000 bytes in 15 chunk sizes';
});

// ===========================================================================
// 2. Curve arithmetic and KDFs
// ===========================================================================

group('2. P-256 arithmetic and KDFs');

await testCase('pure-BigInt P-256 matches OpenSSL for random scalars (differential)', async () => {
  const check = P256.selfCheck();
  ok(check.ok, `selfCheck: ${check.why}`);
  for (let i = 0; i < 6; i++) {
    const d = P256.randomScalar();
    const mine = P256.scalarMult(d, P256.G);
    const e = crypto.createECDH('prime256v1');
    e.setPrivateKey(Buffer.from(d.toString(16).padStart(64, '0'), 'hex'));
    const pub = e.getPublicKey();
    eq(mine.x, BigInt('0x' + pub.subarray(1, 33).toString('hex')), `x (d=${d})`);
    eq(mine.y, BigInt('0x' + pub.subarray(33, 65).toString('hex')), `y (d=${d})`);
    eq(P256.encodePoint(mine).toString('hex'), Buffer.from(e.getPublicKey(undefined, 'compressed')).toString('hex'), 'compressed encoding');
  }
  eq(P256.scalarMult(P256.N, P256.G), null, 'n*G must be infinity');
  return '6 random scalars + n*G';
});

await testCase('native and BigInt ECDH agree byte for byte', async () => {
  const a = C.generateEphemeral();
  const b = C.generateEphemeral();
  const native = C.ecdhSharedSecret(a.priv, b.pub, { useNative: true });
  const bigint = C.ecdhSharedSecret(a.priv, b.pub, { useNative: false });
  ok(native.equals(bigint), 'shared secrets differ');
  ok(native.equals(C.ecdhSharedSecret(b.priv, a.pub)), 'ECDH is not symmetric');
  eq(native.length, 32, 'P-256 shared secret is 32 bytes (raw x)');
  return `${native.toString('hex').slice(0, 16)}...`;
});

await testCase('HKDF-SHA256 matches RFC 5869 test vector A.1', async () => {
  const ikm = Buffer.alloc(22, 0x0b);
  const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
  const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
  const prk = C.hkdfExtract(salt, ikm);
  eq(prk.toString('hex'), '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5', 'PRK');
  const okm = C.hkdfExpand(prk, info, 42);
  eq(okm.toString('hex'), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865', 'OKM');
  return 'RFC 5869 A.1';
});

await testCase('P-256 point decoding rejects off-curve and malformed encodings', async () => {
  let accepted = 0; 
  let rejected = 0;
  for (let i = 0; i < 24; i++) {
    const x = BigInt(i) * 0x1fedcba987654321n + 11n;
    const buf = Buffer.concat([Buffer.from([i % 2 ? 0x02 : 0x03]), Buffer.from(x.toString(16).padStart(64, '0'), 'hex')]);
    const v = P256.mod(x * x * x + P256.A * x + P256.B);
    const isQr = P256.modPow(v, (P256.P - 1n) / 2n) === 1n;
    const got = P256.decodePoint(buf);
    if (isQr) { ok(got && P256.isOnCurve(got), 'quadratic residue must decode'); accepted++; }
    else { eq(got, null, 'non-residue must be rejected'); rejected++; }
  }
  eq(P256.decodePoint(Buffer.alloc(32)), null, '32 byte input');
  eq(P256.decodePoint(Buffer.concat([Buffer.from([0x05]), Buffer.alloc(32)])), null, 'bad prefix');
  eq(P256.decodePoint(Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0xff)])), null, 'x >= p');
  return `${accepted} valid / ${rejected} rejected`;
});

// ===========================================================================
// 3. Pairing (SPAKE2)
// ===========================================================================

group('3. Pairing PAKE and attempt control');

await testCase('SPAKE2: same code both sides -> same PSK and mutual confirmation', async () => {
  const ctx = 'pair-window-1';
  const A = new C.Spake2({ role: 'A', code: '123456', context: ctx, idA: 'agent', idB: 'bridge' });
  const B = new C.Spake2({ role: 'B', code: '123-4 56', context: ctx, idA: 'agent', idB: 'bridge' });
  const X = A.start(); const Y = B.start();
  A.finish(Y); B.finish(X);
  eq(A.psk.toString('hex'), B.psk.toString('hex'), 'PSK mismatch');
  eq(A.psk.length, 32, 'PSK length');
  ok(B.verifyPeer(A.confirmOut), 'bridge rejects the agent confirmation');
  ok(A.verifyPeer(B.confirmOut), 'agent rejects the bridge confirmation');
  return `psk=${A.psk.toString('hex').slice(0, 12)}...`;
});

await testCase('SPAKE2: wrong code fails confirmation and yields unrelated keys', async () => {
  const ctx = 'pair-window-2';
  const A = new C.Spake2({ role: 'A', code: '123456', context: ctx, idA: 'agent', idB: 'bridge' });
  const B = new C.Spake2({ role: 'B', code: '123457', context: ctx, idA: 'agent', idB: 'bridge' });
  const X = A.start(); const Y = B.start();
  A.finish(Y); B.finish(X);
  ok(!B.verifyPeer(A.confirmOut), 'bridge accepted a wrong-code confirmation');
  ok(!A.verifyPeer(B.confirmOut), 'agent accepted a wrong-code confirmation');
  ok(A.psk.toString('hex') !== B.psk.toString('hex'), 'PSKs must differ');
  return 'one digit off is rejected';
});

await testCase('SPAKE2: no message leaks an offline check for the code (MITM has no verifier)', async () => {
  // Simulate what a LAN eavesdropper / MITM holds: X, Y, ids, context. For every
  // candidate code it can compute w', M, N and X - w'*M -- which is a valid curve
  // point for EVERY guess, so no candidate can be confirmed or rejected from the
  // transcript alone. We assert exactly that property.
  const ctx = 'pair-window-3';
  const A = new C.Spake2({ role: 'A', code: '424242', context: ctx, idA: 'agent', idB: 'bridge' });
  const B = new C.Spake2({ role: 'B', code: '424242', context: ctx, idA: 'agent', idB: 'bridge' });
  const X = A.start(); const Y = B.start();
  A.finish(Y); B.finish(X);
  const { M } = C.spake2Points();
  const Xpt = P256.decodePoint(X);
  let distinguishable = 0;
  for (const guess of ['000000', '111111', '424241', '424243', '999999', '424242']) {
    const w = C.spake2Scalar(guess, ctx);
    const candidate = P256.pointSub(Xpt, P256.scalarMult(w, M));
    if (candidate === null) { distinguishable++; continue; }
    ok(P256.isOnCurve(candidate), 'a wrong guess must yield a well-formed point');
  }
  eq(distinguishable, 0, 'a guess produced a distinguishable value');
  return '6 guesses, 0 verifiers';
});

await testCase('SPAKE2: reflection, invalid points and cross-context shares are refused', async () => {
  const mk = () => new C.Spake2({ role: 'A', code: '111111', context: 'c', idA: 'a', idB: 'b' });
  const A1 = mk(); const X = A1.start();
  await rejects(() => A1.finish(X), 'pairing_failed', 'reflection');
  const A2 = mk(); A2.start();
  await rejects(() => A2.finish(Buffer.alloc(33, 7)), 'pairing_failed', 'invalid point');
  await rejects(() => C.spake2Scalar('', 'c'), 'pairing_code_empty', 'empty code');
  // A share produced for a *different pairing window* still parses (it is a
  // valid curve point, which is the whole point of the PAKE), but it must not
  // lead to a usable key: the PSKs differ and the confirmation tags fail.
  const A3 = new C.Spake2({ role: 'A', code: '222222', context: 'ctx-a', idA: 'a', idB: 'b' });
  const B3 = new C.Spake2({ role: 'B', code: '222222', context: 'ctx-b', idA: 'a', idB: 'b' });
  const X3 = A3.start();
  const Y3 = B3.start();
  A3.finish(Y3);
  B3.finish(X3);
  ok(A3.psk.toString('hex') !== B3.psk.toString('hex'), 'different windows must not agree');
  ok(!A3.verifyPeer(B3.confirmOut), 'cross-window confirmation must fail');
  return '4 refusals';
});

await testCase('pairing guard: single-use windows, bounded attempts, cool-down and hard lockout', async () => {
  let clock = 1_000_000;
  const g = new C.PairingGuard({ maxAttempts: 3, windowMs: 60000, cooldownsMs: [1000, 2000], hardLockAfter: 3, now: () => clock });
  const w1 = g.openWindow({ code: '111111', context: 'c' });
  ok(w1.pairing && w1.pairId, 'window opens');
  eq(g.status().attemptsLeft, 3, 'attempts budget');
  g.beginAttempt(w1.pairId);
  g.fail('bad_code');
  eq(g.status().pairing, false, 'a failed attempt closes the window (code is single use)');
  await rejects(() => g.beginAttempt('nope'), 'locked_out', 'cool-down after a failure');
  clock += 1001;
  const w2 = g.openWindow({ code: '222222', context: 'c' });
  g.beginAttempt(w2.pairId);
  g.fail('bad_code');
  clock += 2001;
  const w3 = g.openWindow({ code: '333333', context: 'c' });
  g.beginAttempt(w3.pairId);
  g.fail('bad_code');
  clock += 2001;
  eq(g.status().hardLocked, true, 'hard lockout after 3 failures');
  await rejects(() => g.openWindow({ code: '444444', context: 'c' }), 'locked_out', 'hard lockout blocks new windows');
  g.reset();
  ok(g.openWindow({ code: '444444', context: 'c' }).pairing, 'manual reset reopens pairing');
  return 'attempts=3, hard lock, reset';
});

await testCase('trust store: TOFU requires explicit confirmation and refuses key changes', async () => {
  const store = new C.TrustStore({ deviceId: 'bridge', requireUserConfirm: true });
  const alice = C.generateIdentity();
  const mallory = C.generateIdentity();
  const first = store.proposePeer({ deviceId: 'agent-1', name: 'Agent', pubKey: alice.pub, fingerprint: alice.fingerprint });
  eq(first.status, 'pending', 'first contact is pending, never auto-trusted');
  eq(store.isTrusted('agent-1'), false, 'not trusted before confirmation');
  store.confirmPeer('agent-1');
  eq(store.isTrusted('agent-1'), true, 'trusted after confirmation');
  eq(store.proposePeer({ deviceId: 'agent-1', pubKey: alice.pub, fingerprint: alice.fingerprint }).status, 'known', 'same key stays trusted');
  const swapped = store.proposePeer({ deviceId: 'agent-1', pubKey: mallory.pub, fingerprint: mallory.fingerprint });
  eq(swapped.status, 'changed', 'a new key is flagged');
  eq(store.getPeer('agent-1').pubKey, alice.pub, 'the pin is NOT silently replaced');
  eq(store.isTrusted('agent-1'), true, 'the device keeps its old pin until a human decides');
  return `fp=${alice.fingerprint}`;
});

// ===========================================================================
// 4. Secure channel: nonce discipline, replay, tamper, rekey
// ===========================================================================

group('4. Secure channel (AEAD, replay, rekey)');

function makeChannels(psk = Buffer.alloc(0)) {
  const ephA = C.generateEphemeral(); const ephB = C.generateEphemeral();
  const fields = {
    sessionId: crypto.randomBytes(16).toString('hex'),
    protocolVersion: '0.2', idA: 'agent-1', idB: 'bridge-1',
    nonceA: crypto.randomBytes(16).toString('base64url'), nonceB: crypto.randomBytes(16).toString('base64url'),
    ephA: ephA.pub.toString('base64url'), ephB: ephB.pub.toString('base64url'),
    fpA: 'FP-A', fpB: 'FP-B', negotiated: { p: '0.2', c: ['fs.read'], f: {} },
  };
  const transcript = C.buildTranscript(fields);
  const hash = C.sha256(transcript);
  const prkA = C.derivePrk({ transcript, sharedSecret: C.ecdhSharedSecret(ephA.priv, ephB.pub), psk });
  const prkB = C.derivePrk({ transcript, sharedSecret: C.ecdhSharedSecret(ephB.priv, ephA.pub), psk });
  return {
    agent: new C.SecureChannel({ role: 'agent', prk: prkA, transcriptHash: hash }),
    bridge: new C.SecureChannel({ role: 'bridge', prk: prkB, transcriptHash: hash }),
    prkA, prkB,
  };
}

await testCase('ordered frames decrypt, and payloads survive the round trip', async () => {
  const { agent, bridge } = makeChannels();
  for (let i = 1; i <= 20; i++) {
    const frame = agent.seal({ t: 'req', i }, Buffer.from(`payload-${i}`));
    const opened = bridge.open(frame);
    eq(opened.body.i, i, 'body field');
    eq(opened.payload.toString(), `payload-${i}`, 'binary payload');
  }
  eq(agent.open(bridge.seal({ t: 'res', ok: true })).body.ok, true, 'reverse direction');
  return '20 frames each way';
});

await testCase('out-of-order frames inside the window are accepted, replays are not', async () => {
  const { agent, bridge } = makeChannels();
  const f1 = agent.seal({ t: 'a', n: 1 });
  const f2 = agent.seal({ t: 'a', n: 2 });
  const f3 = agent.seal({ t: 'a', n: 3 });
  eq(bridge.open(f1).body.n, 1, 'in order');
  eq(bridge.open(f3).body.n, 3, 'gap: forward jump accepted');
  eq(bridge.open(f2).body.n, 2, 'late frame fills the gap');
  await rejects(() => bridge.open(f3), 'replay_detected', 'replayed frame 3');
  await rejects(() => bridge.open(f2), 'replay_detected', 'replayed frame 2');
  await rejects(() => bridge.open(f1), 'replay_detected', 'replayed frame 1');
  eq(bridge.stats.replays, 3, 'replay counter');
  return 'ordered + reordered + replayed';
});

await testCase('frames older than the replay window are refused', async () => {
  const { agent, bridge } = makeChannels();
  let first = null; let last = null;
  for (let i = 1; i <= 200; i++) { last = agent.seal({ t: 'x', i }); if (i === 1) first = last; }
  eq(bridge.open(last).body.i, 200, 'newest frame');
  await rejects(() => bridge.open(first), 'stale_frame', 'frame 1 outside the 64 frame window');
  return 'window = 64 frames';
});

await testCase('tampered ciphertext, tampered header/IV and wrong keys are all refused', async () => {
  const { agent, bridge } = makeChannels();
  const f = agent.seal({ t: 'req', secret: 'value' }, Buffer.from('body'));
  const flipLast = { header: f.header, headerBytes: f.headerBytes, payload: Buffer.from(f.ciphertext) };
  flipLast.payload[flipLast.payload.length - 1] ^= 0x80;
  await rejects(() => bridge.open(flipLast), 'auth_failed', 'tampered tag');
  const flipFirst = { header: f.header, headerBytes: f.headerBytes, payload: Buffer.from(f.ciphertext) };
  flipFirst.payload[0] ^= 0x01;
  await rejects(() => bridge.open(flipFirst), 'auth_failed', 'tampered ciphertext');

  const g = agent.seal({ t: 'req' });
  const hackedHeader = { ...g.header, s: g.header.s + 1000 };
  await rejects(
    () => bridge.open({ header: hackedHeader, headerBytes: Buffer.from(JSON.stringify(hackedHeader)), payload: g.ciphertext }),
    null, 'header is authenticated (AAD)');
  const g2 = agent.seal({ t: 'req' });
  const hackedIv = { ...g2.header, iv: crypto.randomBytes(12).toString('base64url') };
  await rejects(
    () => bridge.open({ header: hackedIv, headerBytes: Buffer.from(JSON.stringify(hackedIv)), payload: g2.ciphertext }),
    null, 'iv field is authenticated');
  const wrong = new C.SecureChannel({ role: 'bridge', prk: Buffer.alloc(32, 0x5a), transcriptHash: C.sha256('other') });
  const err = await rejects(() => wrong.open(agent.seal({ t: 'req' })), null, 'wrong key');
  eq(err.code, 'auth_failed', 'wrong key maps to the same generic error');
  return '4 shapes + wrong key, one generic error';
});

await testCase('nonces never repeat: per-direction counters and fresh salts per epoch', async () => {
  const { agent, bridge } = makeChannels();
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const f = agent.seal({ t: 'x', i });
    const iv = Buffer.from(f.header.iv, 'base64url').toString('hex');
    ok(!seen.has(iv), `nonce reuse at frame ${i}`);
    seen.add(iv);
    bridge.open(f);
  }
  const other = bridge.seal({ t: 'y' });
  eq(other.header.s, 1, 'independent counter per direction');
  ok(!seen.has(Buffer.from(other.header.iv, 'base64url').toString('hex')), 'directions must not share a nonce');
  eq(agent.open(other).seq, 1, 'reverse direction accepted');
  return '64 + 1 nonces, no reuse';
});

await testCase('rekey installs a new epoch, keeps a grace window, and rejects a bad tag', async () => {
  const { agent, bridge, prkA, prkB } = makeChannels();
  const pre = agent.seal({ t: 'pre' });
  eq(bridge.open(pre).body.t, 'pre', 'old epoch works');
  const ephA = C.generateEphemeral(); const ephB = C.generateEphemeral();
  const z = C.ecdhSharedSecret(ephA.priv, ephB.pub);
  const nextA = C.SecureChannel.rekeyPrk({ prk: prkA, sharedSecret: z, transcript: 'rk' });
  const nextB = C.SecureChannel.rekeyPrk({ prk: prkB, sharedSecret: z, transcript: 'rk' });
  ok(nextA.equals(nextB), 'rekey PRK must agree');
  agent.installEpoch(1, nextA); bridge.installEpoch(1, nextB);
  const post = agent.seal({ t: 'post' });
  eq(post.header.e, 1, 'epoch is on the wire');
  eq(bridge.open(post).body.t, 'post', 'new epoch decrypts');
  await rejects(() => agent.installEpoch(1, nextA), 'epoch_not_monotonic', 'epochs must increase');
  return 'epoch 0 -> 1';
});

await testCase('handshake confirmation tags bind the transcript and the sender', async () => {
  const { agent, bridge } = makeChannels();
  const tag = agent.expectedConfirm('agent');
  ok(bridge.checkConfirm('agent', tag), 'bridge accepts the agent tag');
  ok(!bridge.checkConfirm('bridge', tag), 'the same tag must not confirm the other role');
  ok(!bridge.checkConfirm('agent', crypto.randomBytes(32)), 'random tag refused');
  const altered = Buffer.from(tag); altered[0] ^= 1;
  ok(!bridge.checkConfirm('agent', altered), 'flipped bit refused');
  return 'ok';
});

// ===========================================================================
// 5. End-to-end over a real loopback TCP socket
// ===========================================================================

group('5. End-to-end over loopback TCP');

const BRIDGE_IDENTITY = C.generateIdentity();
const AGENT_IDENTITY = C.generateIdentity();
fs.writeFileSync(path.join(TMP, 'hello.txt'), 'hi there');

/** A bridge endpoint: TCP listener + handshake + policy engine + handlers. */
function startBridge(opts = {}) {
  const trustStore = opts.trustStore ?? new C.TrustStore({ deviceId: 'bridge-1', requireUserConfirm: false });
  const auditFile = path.join(TMP, `audit-${crypto.randomBytes(4).toString('hex')}.jsonl`);
  const audit = new POL.AuditLog({ file: auditFile, required: true });
  const engine = new POL.PolicyEngine({ audit });
  // NB: no spread here. The caller mutates `pairing.current` between
  // connections (that is how a pairing window is opened), so this must stay a
  // live reference, not a snapshot.
  const pairing = opts.pairing ?? {};
  const state = { server: null, trustStore, engine, audit, auditFile, failures: [], sessions: [] };
  const server = net.createServer((socket) => {
    const link = FrameLink.fromSocket(socket, 'bridge', { handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 4000 });
    const timer = setTimeout(() => link.destroy('handshake_timeout'), opts.handshakeTimeoutMs ?? 4000);
    timer.unref?.();
    bridgeHandshake(link, {
      identity: BRIDGE_IDENTITY, deviceId: 'bridge-1', name: 'Bridge', app: '0.2.0-rc.2',
      caps: ['fs.read', 'fs.list', 'fs.write', 'shell.exec', 'sys.info'],
      trustStore, pairing: pairing.current ?? null,
      requireUserConfirm: pairing.requireConfirm ?? false,
      confirmPeer: pairing.confirmPeer,
      timeoutMs: opts.handshakeTimeoutMs ?? 4000,
    }).then(({ session, peer }) => {
      clearTimeout(timer);
      state.sessions.push({ session, peer });
      engine.createGrant(peer.deviceId, opts.grant ?? {
        caps: ['fs.read', 'fs.list', 'sys.info'],
        roots: [{ path: opts.root ?? TMP, mode: 'rw' }],
        cwd: opts.root ?? TMP,
        shell: { mode: 'allowlist', allow: ['node'], allowInterpreters: true },
        limits: { maxReadBytes: 65536, maxWriteBytes: 65536, maxOutputBytes: 65536, execMs: 5000, fsReadMs: 5000 },
      });
      POL.registerStandardHandlers(session, engine, { sessionKey: peer.deviceId });
      if (opts.onSession) opts.onSession(session, peer);
      server.emit('session', session, peer);
    }).catch((err) => {
      clearTimeout(timer);
      state.failures.push(err);
      server.emit('hsFail', err);
    });
  });
  state.server = server;
  CLEANUP.push(() => { for (const s of state.sessions) s.session.close('cleanup'); try { server.close(); } catch { /* ignore */ } });
  return state;
}

function startAgent(port, opts = {}) {
  const deviceId = opts.deviceId ?? 'agent-1';
  const trustStore = opts.trustStore ?? new C.TrustStore({ deviceId, requireUserConfirm: false });
  return FrameLink.connect({ host: '127.0.0.1', port })
    .then((link) => agentHandshake(link, {
      identity: opts.identity ?? AGENT_IDENTITY, deviceId, name: opts.name ?? 'Agent', app: '0.1.5-rc.1',
      caps: ['fs.read', 'fs.list', 'sys.info'],
      trustStore, ...opts.handshake,
    }));
}

async function listen(state, port = 0) {
  await new Promise((resolve, reject) => {
    state.server.once('error', reject);
    state.server.listen(port, '127.0.0.1', resolve);
  });
  return state.server.address().port;
}

const progress = { pairedTrust: null };

await testCase('wrong pairing code fails on BOTH sides and closes the connection', async () => {
  const guard = new C.PairingGuard({ maxAttempts: 3, windowMs: 60000 });
  const pairing = { current: null, requireConfirm: false };
  const bridge = startBridge({ pairing });
  const port = await listen(bridge);
  pairing.current = { ...guard.openWindow({ code: '135790', context: 'st' }), guard };
  let bridgeErr = null;
  const bridgeFail = new Promise((r) => bridge.server.once('hsFail', (e) => { bridgeErr = e; r(e); }));

  const agentErr = await rejects(() => startAgent(port, { handshake: { pairCode: '999999' } }), 'pairing_failed', 'agent side');
  await bridgeFail;
  ok(bridgeErr, 'bridge must also report the failure');
  eq(bridgeErr.code, 'pairing_failed', 'bridge error code');
  eq(guard.status().failures, 1, 'the attempt counted against the guard');
  eq(guard.status().pairing, false, 'the code is now burned');
  ok(!/attempt/i.test(agentErr.message), 'error message must not leak attempt state');
  bridge.server.close();
  return 'both sides rejected, window burned';
});

await testCase('correct code pairs, negotiates capabilities and completes an RPC', async () => {
  const guard = new C.PairingGuard({ maxAttempts: 3, windowMs: 60000 });
  const pairing = { current: null, requireConfirm: false };
  const bridge = startBridge({ pairing });
  const port = await listen(bridge);
  pairing.current = { ...guard.openWindow({ code: '246810', context: 'st2' }), guard };
  const agent = await startAgent(port, { handshake: { pairCode: '246 810' } });
  progress.pairedTrust = { bridgeTrust: bridge.trustStore };
  eq(agent.peer.authMode, 'pake', 'auth mode');
  eq(agent.peer.deviceId, 'bridge-1', 'peer id');
  eq(agent.negotiated.protocolVersion, '0.2', 'negotiated version');
  deepEq(agent.negotiated.caps, ['fs.read', 'fs.list', 'sys.info'], 'capability intersection (agent did not ask for fs.write/shell.exec)');
  ok((await agent.session.request('sys.info', 'get', {})).result.os, 'sys.info answered');
  eq((await agent.session.request('fs.read', 'read', { path: 'hello.txt' })).result.content, 'hi there', 'file content over the wire');
  ok(bridge.trustStore.isTrusted('agent-1'), 'bridge pinned the agent key');
  ok(agent.session.established && bridge.sessions[0].session.established, 'both sessions established');
  agent.session.close('done');
  bridge.server.close();
  return agent.peer.fingerprint;
});

await testCase('a pinned bridge reconnects with signatures, no code', async () => {
  const bridgeTrust = progress.pairedTrust.bridgeTrust;
  const agentTrust = new C.TrustStore({ deviceId: 'agent-1', requireUserConfirm: false });
  const pairing = { current: null };
  const bridge = startBridge({ pairing, trustStore: bridgeTrust });
  const port = await listen(bridge);

  // (a) A device the bridge has never seen, with no pairing window open, must
  // be refused outright - never silently trusted.
  const strangerLink = await FrameLink.connect({ host: '127.0.0.1', port });
  const strangerErr = await rejects(
    () => agentHandshake(strangerLink, {
      identity: C.generateIdentity(), deviceId: 'agent-2', name: 'Stranger', caps: ['sys.info'],
      trustStore: new C.TrustStore({ deviceId: 'agent-2', requireUserConfirm: false }),
    }),
    'pairing_closed', 'unknown device with no pairing window',
  );
  eq(strangerErr.code, 'pairing_closed', 'fail closed');
  strangerLink.destroy('done');

  // (b) Pair a device the bridge has never seen with a code; both sides pin
  // each other. (A fresh device id is used on purpose: the bridge would refuse
  // to re-pair an id it already trusts, which is the documented recovery gap -
  // see the report, "bridge trusts / agent forgot".)
  const newIdentity = C.generateIdentity();
  const newAgentTrust = new C.TrustStore({ deviceId: 'agent-3', requireUserConfirm: false });
  const guard = new C.PairingGuard({ maxAttempts: 3, windowMs: 60000 });
  pairing.current = { ...guard.openWindow({ code: '112233', context: 'st3' }), guard };
  const paired = await startAgent(port, {
    deviceId: 'agent-3', identity: newIdentity, trustStore: newAgentTrust,
    handshake: { pairCode: '112233' },
  });
  eq(paired.peer.authMode, 'pake', 'first pairing');
  eq(newAgentTrust.isTrusted('bridge-1'), true, 'the agent pinned the bridge');

  // (c) Reconnect with no code at all.
  const again = await startAgent(port, { deviceId: 'agent-3', identity: newIdentity, trustStore: newAgentTrust });
  eq(again.peer.authMode, 'trusted', 'reconnect uses the pinned key');
  eq(again.peer.trust, 'known', 'agent sees the bridge as known');
  ok((await again.session.request('sys.info', 'get', {})).result.hostname, 'rpc after reconnect');

  // (d) Bridge still trusts agent-1 but the agent lost its store: this MUST
  // fail closed rather than silently re-pair (that would be a key-swap window).
  const forgot = await startAgent(port, { trustStore: new C.TrustStore({ deviceId: 'agent-1', requireUserConfirm: false }) })
    .then(() => null, (err) => err);
  ok(forgot, 'a forgotten pin must not silently re-pair');
  eq(forgot.code, 'unknown_bridge', 'the agent refuses to trust an unverified bridge key');
  again.session.close('done');
  paired.session.close('done');
  bridge.server.close();
  return 'unpaired refused -> pake -> trusted (forgotten pin fails closed)';
});

await testCase('a pinned agent presenting a different key is refused (no silent re-pair)', async () => {
  const bridgeTrust = progress.pairedTrust.bridgeTrust;
  const malloryIdentity = C.generateIdentity();
  const bridge = startBridge({ pairing: { current: null }, trustStore: bridgeTrust });
  const port = await listen(bridge);
  const link = await FrameLink.connect({ host: '127.0.0.1', port });
  const err = await rejects(
    () => agentHandshake(link, {
      identity: malloryIdentity, deviceId: 'agent-1', name: 'Mallory', caps: ['sys.info'],
      trustStore: new C.TrustStore({ deviceId: 'agent-1', requireUserConfirm: false }),
    }),
    'key_changed', 'impostor',
  );
  eq(err.code, 'key_changed', 'impostor refused');
  eq(bridgeTrust.getPeer('agent-1').pubKey, AGENT_IDENTITY.pub, 'pin unchanged');
  link.destroy('done');
  bridge.server.close();
  return 'key_changed';
});

await testCase('unknown ops and ungranted capabilities are refused, session stays usable', async () => {
  const bridgeTrust = progress.pairedTrust.bridgeTrust;
  const agentTrust = new C.TrustStore({ deviceId: 'agent-1', requireUserConfirm: false });
  agentTrust.upsertPeer({ deviceId: 'bridge-1', pubKey: BRIDGE_IDENTITY.pub, fingerprint: BRIDGE_IDENTITY.fingerprint });
  const bridge = startBridge({ trustStore: bridgeTrust });
  const port = await listen(bridge);
  const agent = await startAgent(port, { trustStore: agentTrust });
  const err = await rejects(() => agent.session.request('shell.exec', 'run', { cmd: 'echo hi' }), null, 'capability not granted');
  eq(err.code, POL.DENY.NO_GRANT, 'shell.exec not granted');
  bridge.engine.getGrant('agent-1').grant('shell.exec');
  bridge.engine.getGrant('agent-1').setShell({ mode: 'allowlist', allow: ['node'], deny: ['rm'], allowInterpreters: true });
  const err2 = await rejects(() => agent.session.request('shell.exec', 'run', { cmd: 'rm -rf /' }), null, 'deny list');
  eq(err2.code, POL.DENY.SHELL_UNSAFE, 'deny list');
  const err3 = await rejects(() => agent.session.request('fs.read', 'readFile', { path: 'hello.txt' }), null, 'unknown op name');
  eq(err3.code, 'unsupported', 'unknown op');
  ok((await agent.session.request('sys.info', 'get', {})).result.os, 'session survived the errors');
  agent.session.close('done');
  bridge.server.close();
  return 'no_grant -> deny list -> unsupported -> still alive';
});

await testCase('an oversized frame on the wire kills that connection, not the listener', async () => {
  // Observed on the RECEIVING side, which is where the decoder lives.
  const server = net.createServer((socket) => {
    const link = FrameLink.fromSocket(socket, 'bridge', {});
    link.once('protocolError', (err) => server.emit('protocolError', err));
    link.once('close', (reason) => server.emit('peerClosed', reason));
    link.setFrameHandler(() => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  CLEANUP.push(() => { try { server.close(); } catch { /* ignore */ } });
  const protocolError = new Promise((r) => server.once('protocolError', r));
  const closed = new Promise((r) => server.once('peerClosed', r));
  const client = await FrameLink.connect({ host: '127.0.0.1', port: server.address().port });
  const bogus = Buffer.alloc(8);
  bogus.writeUInt32BE(MAX_FRAME_BYTES + 4096, 0);
  bogus.writeUInt32BE(4, 4);
  client.socket.write(bogus);
  const [err, reason] = await Promise.all([withTimeout(protocolError, 3000, 'protocolError'), withTimeout(closed, 3000, 'close')]);
  eq(err.code, 'frame_too_large', 'protocol error surfaced');
  ok(String(reason).includes('frame_too_large'), `close reason: ${reason}`);
  client.destroy('done');
  // The listener is still healthy: a fresh connection is accepted.
  const second = await FrameLink.connect({ host: '127.0.0.1', port: server.address().port });
  ok(!second.closed, 'listener still accepts connections');
  second.destroy('done');
  server.close();
  return 'frame_too_large, listener healthy';
});

await testCase('an oversized frame over a real session is fatal for that connection only', async () => {
  const bridge = startBridge({});
  const port = await listen(bridge);
  const link = await FrameLink.connect({ host: '127.0.0.1', port });
  const closed = new Promise((r) => link.once('close', r));
  const bogus = Buffer.alloc(8);
  bogus.writeUInt32BE(MAX_FRAME_BYTES + 8, 0);
  bogus.writeUInt32BE(4, 4);
  link.socket.write(bogus);
  const reason = await withTimeout(closed, 3000, 'bridge closed the connection');
  ok(reason !== undefined, `close reason: ${reason}`);
  const health = await startAgent(port, { handshake: { pairCode: '000000' } }).then(() => 'unexpected-success', (e) => e.code);
  eq(health, 'pairing_closed', 'the listener still accepts and refuses normally');
  bridge.server.close();
  return 'connection dropped, listener alive';
});

await testCase('backpressure is refused, not buffered without bound', async () => {
  const slow = net.createServer((socket) => { socket.pause(); /* a peer that never reads */ });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  CLEANUP.push(() => { try { slow.close(); } catch { /* ignore */ } });
  const link = await FrameLink.connect({ host: '127.0.0.1', port: slow.address().port, opts: { maxQueueBytes: 256 * 1024 } });
  const rejection = new Promise((r) => link.once('backpressure', r));
  const chunk = crypto.randomBytes(64 * 1024);
  let rejected = 0;
  for (let i = 0; i < 40; i++) {
    if (!link.sendFrame(encodeFrame({ t: 'enc', i }, chunk))) rejected++;
  }
  ok(rejected > 0, 'the queue limit was never hit, so this test proved nothing');
  const info = await rejection;
  ok(info.queuedBytes <= 256 * 1024, 'queued bytes stay inside the budget');
  eq(link.stats.backpressureRejections, rejected, 'rejections are counted');
  link.destroy('done');
  slow.close();
  return `${rejected} frames refused, queue capped at 256 KiB`;
});

await testCase('a request that outlives its deadline times out and is cancelled', async () => {
  const bridgeTrust = new C.TrustStore({ deviceId: 'bridge-1', requireUserConfirm: false });
  bridgeTrust.upsertPeer({ deviceId: 'agent-1', pubKey: AGENT_IDENTITY.pub, fingerprint: AGENT_IDENTITY.fingerprint, trusted: true });
  let cancelled = false;
  const server = net.createServer((socket) => {
    const link = FrameLink.fromSocket(socket, 'bridge', {});
    bridgeHandshake(link, {
      identity: BRIDGE_IDENTITY, deviceId: 'bridge-1', caps: ['sys.info'], trustStore: bridgeTrust,
      pairing: null, requireUserConfirm: false,
    }).then(({ session }) => {
      session.setAuthorizer(async () => ({ ok: true, limits: {} }));
      session.handle('sys.info', 'get', async ({ registerCancel, isCancelled }) => {
        registerCancel(() => { cancelled = true; });
        await sleep(2000);
        return { wasCancelled: isCancelled() };
      });
    }).catch(() => { /* the peer hangs up */ });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  CLEANUP.push(() => { try { server.close(); } catch { /* ignore */ } });
  const link = await FrameLink.connect({ host: '127.0.0.1', port: server.address().port });
  const t = new C.TrustStore({ deviceId: 'agent-1' });
  t.upsertPeer({ deviceId: 'bridge-1', pubKey: BRIDGE_IDENTITY.pub, fingerprint: BRIDGE_IDENTITY.fingerprint });
  const { session } = await agentHandshake(link, {
    identity: AGENT_IDENTITY, deviceId: 'agent-1', caps: ['sys.info'], trustStore: t,
  });
  const t0 = Date.now();
  const err = await rejects(() => session.request('sys.info', 'get', {}, { timeoutMs: 300 }), 'request_timeout', 'slow handler');
  const elapsed = Date.now() - t0;
  ok(elapsed < 1500, `timeout took ${elapsed}ms, too slow`);
  await sleep(250);
  ok(cancelled, 'the bridge side was told to cancel the in-flight work');
  eq(err.code, 'request_timeout', 'error code');
  session.close('done');
  server.close();
  return `timeout in ${elapsed}ms, cancel delivered`;
});

await testCase('a bridge that never answers hello times out the handshake', async () => {
  const server = net.createServer((socket) => { socket.pause(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  CLEANUP.push(() => { try { server.close(); } catch { /* ignore */ } });
  const link = await FrameLink.connect({ host: '127.0.0.1', port: server.address().port, opts: { handshakeTimeoutMs: 400 } });
  const t0 = Date.now();
  const err = await rejects(
    () => agentHandshake(link, { identity: AGENT_IDENTITY, deviceId: 'agent-1', caps: [], timeoutMs: 400 }),
    'handshake_timeout',
  );
  ok(Date.now() - t0 < 2000, 'timeout honoured');
  link.destroy('done');
  server.close();
  return err.code;
});

await testCase('negotiation: major mismatch is refused, unknown caps are ignored', async () => {
  const bad = negotiate(
    { proto: { min: '0.1', max: '0.2' }, caps: ['fs.read'], features: {} },
    { proto: { min: '1.0', max: '1.4' }, caps: ['fs.read'], features: {} },
  );
  eq(bad.ok, false, 'major mismatch');
  eq(bad.code, 'version_incompatible', 'code');
  eq(negotiate(
    { proto: { min: '0.5', max: '0.6' }, caps: [], features: {} },
    { proto: { min: '0.1', max: '0.4' }, caps: [], features: {} },
  ).ok, false, 'no overlap');
  const good = negotiate(
    { proto: { min: '0.1', max: '0.3' }, caps: ['fs.read', 'shell.exec', 'future.cap'], features: { streamCredit: true, auditStream: true, futureFeature: true } },
    { proto: { min: '0.1', max: '0.2' }, caps: ['fs.read', 'future.cap', 'their.cap'], features: { streamCredit: true } },
  );
  eq(good.ok, true, 'same major, overlapping minors');
  eq(good.protocolVersion, '0.2', 'highest common minor');
  deepEq(good.caps, ['fs.read', 'future.cap'], 'intersection, unknown dropped');
  deepEq(good.features, { streamCredit: true }, 'feature intersection');
  eq(compareVersions('0.10', '0.9'), 1, 'numeric comparison, not lexicographic');
  return '0.1.5 <-> 0.2.0 style negotiation';
});

await testCase('revoking a grant takes effect on the next request', async () => {
  const bridgeTrust = progress.pairedTrust.bridgeTrust;
  const agentTrust = new C.TrustStore({ deviceId: 'agent-1' });
  agentTrust.upsertPeer({ deviceId: 'bridge-1', pubKey: BRIDGE_IDENTITY.pub, fingerprint: BRIDGE_IDENTITY.fingerprint });
  const bridge = startBridge({ trustStore: bridgeTrust });
  const port = await listen(bridge);
  const agent = await startAgent(port, { trustStore: agentTrust });
  eq((await agent.session.request('fs.read', 'read', { path: 'hello.txt' })).result.content, 'hi there', 'allowed before revocation');
  bridge.engine.revokeGrant('agent-1', 'fs.read');
  const err = await rejects(() => agent.session.request('fs.read', 'read', { path: 'hello.txt' }), null, 'after revocation');
  eq(err.code, POL.DENY.REVOKED, 'revoked');
  ok(Array.isArray((await agent.session.request('fs.list', 'list', { path: '.', depth: 1 })).result.entries), 'other capabilities unaffected');
  agent.session.close('done');
  bridge.server.close();
  return 'fs.read revoked, fs.list intact';
});

await testCase('every request is audited: allow and deny, without leaking contents', async () => {
  const bridgeTrust = progress.pairedTrust.bridgeTrust;
  const agentTrust = new C.TrustStore({ deviceId: 'agent-1' });
  agentTrust.upsertPeer({ deviceId: 'bridge-1', pubKey: BRIDGE_IDENTITY.pub, fingerprint: BRIDGE_IDENTITY.fingerprint });
  const bridge = startBridge({ trustStore: bridgeTrust });
  const port = await listen(bridge);
  const agent = await startAgent(port, { trustStore: agentTrust });
  await agent.session.request('fs.write', 'write', { path: 'written.txt', content: 'SECRET-CONTENT-MARKER' }).catch(() => null);
  await agent.session.request('fs.read', 'read', { path: 'hello.txt' });
  await agent.session.request('fs.read', 'read', { path: '../../etc/passwd' }).catch(() => null);
  await sleep(50);
  const raw = fs.readFileSync(bridge.auditFile, 'utf8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
  ok(lines.some((l) => l.decision === 'allow'), 'an allow entry exists');
  ok(lines.some((l) => l.decision === 'deny'), 'a deny entry exists');
  ok(lines.every((l) => l.argsDigest === undefined || l.argsDigest.length === 32), 'args are digested');
  ok(!raw.includes('SECRET-CONTENT-MARKER'), 'file contents must never reach the audit log');
  ok(lines.filter((l) => l.event === 'request').every((l) => l.peer === 'agent-1'), 'peer recorded on every request');
  agent.session.close('done');
  bridge.server.close();
  return `${lines.length} entries`;
});

// ===========================================================================
// 6. Authorization policy (paths, shell, limits)
// ===========================================================================

group('6. Authorization policy (policy.js)');

const POLROOT = path.join(TMP, 'root');
const POLOUT = path.join(TMP, 'outside');
fs.mkdirSync(path.join(POLROOT, 'sub'), { recursive: true });
fs.mkdirSync(POLOUT, { recursive: true });
fs.writeFileSync(path.join(POLROOT, 'hello.txt'), 'hi there');
fs.writeFileSync(path.join(POLOUT, 'secret.txt'), 'TOP SECRET');
let symlinksAvailable = true;
try {
  fs.symlinkSync(path.join(POLOUT, 'secret.txt'), path.join(POLROOT, 'link-file'), 'file');
  fs.symlinkSync(POLOUT, path.join(POLROOT, 'link-dir'), 'dir');
} catch (err) {
  symlinksAvailable = false;
  if (VERBOSE) process.stdout.write(`      (symlinks unavailable: ${err.code})\n`);
}
const SIBLING = `${POLROOT}dir`;
fs.mkdirSync(SIBLING, { recursive: true });
fs.writeFileSync(path.join(SIBLING, 'neighbour.txt'), 'n');

const AUDIT_FILE = path.join(TMP, 'policy-audit.jsonl');
const policyAudit = new POL.AuditLog({ file: AUDIT_FILE, required: true });
const policyEngine = new POL.PolicyEngine({ audit: policyAudit });
policyEngine.createGrant('peer', {
  caps: ['fs.read', 'fs.list', 'fs.write', 'shell.exec', 'sys.info'],
  roots: [{ path: POLROOT, mode: 'rw' }],
  cwd: POLROOT,
  shell: { mode: 'allowlist', allow: ['node', 'git', 'echo'], deny: ['rm', 'curl'], allowInterpreters: true },
  limits: { maxReadBytes: 4096, maxWriteBytes: 4096, maxOutputBytes: 4096, execMs: 5000, fsReadMs: 5000 },
});
const auth = (cap, op, args) => policyEngine.authorize({ sessionKey: 'peer', peer: { deviceId: 'peer' }, cap, op, args, requestId: 1 });
function expectAllow(cap, op, args) {
  const d = auth(cap, op, args);
  ok(d.ok, `${cap}/${op} ${JSON.stringify(args)} should be allowed: ${JSON.stringify(d.error)}`);
  return d;
}
function expectDeny(cap, op, args, code) {
  const d = auth(cap, op, args);
  ok(!d.ok, `${cap}/${op} ${JSON.stringify(args)} should be denied`);
  if (code) eq(d.error.code, code, `${cap}/${op} ${JSON.stringify(args)} denial code`);
  return d.error.code;
}

await testCase('legitimate paths inside the granted root are allowed', async () => {
  expectAllow('fs.read', 'read', { path: 'hello.txt' });
  expectAllow('fs.read', 'read', { path: path.join(POLROOT, 'hello.txt') });
  expectAllow('fs.read', 'read', { path: './sub/../hello.txt' });
  expectAllow('fs.list', 'list', { path: '.', depth: 2 });
  expectAllow('sys.info', 'get', {});
  return 'relative, absolute, normalised';
});

await testCase('traversal and absolute escapes are denied (.. and outside root)', async () => {
  const cases = [
    ['../outside/secret.txt', POL.DENY.PATH_OUTSIDE_ROOT],
    [path.join(POLOUT, 'secret.txt'), POL.DENY.PATH_OUTSIDE_ROOT],
    ['sub/../../outside/secret.txt', POL.DENY.PATH_OUTSIDE_ROOT],
    ['..', POL.DENY.PATH_OUTSIDE_ROOT],
    ['../rootdir/../outside/secret.txt', POL.DENY.PATH_OUTSIDE_ROOT],
    [path.join(SIBLING, 'neighbour.txt'), POL.DENY.PATH_OUTSIDE_ROOT],
    [path.join(POLROOT, '..', 'outside', 'secret.txt'), POL.DENY.PATH_OUTSIDE_ROOT],
  ];
  for (const [p, code] of cases) expectDeny('fs.read', 'read', { path: p }, code);
  expectDeny('fs.write', 'write', { path: '../outside/pwned.txt', content: 'x' }, POL.DENY.PATH_OUTSIDE_ROOT);
  expectDeny('fs.list', 'list', { path: '../..' }, POL.DENY.PATH_OUTSIDE_ROOT);
  return `${cases.length + 2} escapes refused`;
});

await testCase('symlink escapes are denied (file link, directory link, write through a link)', async () => {
  if (!symlinksAvailable) return { skip: 'creating symlinks is not permitted in this environment' };
  expectDeny('fs.read', 'read', { path: 'link-file' }, POL.DENY.PATH_SYMLINK_ESCAPE);
  expectDeny('fs.read', 'read', { path: 'link-dir/secret.txt' }, POL.DENY.PATH_SYMLINK_ESCAPE);
  expectDeny('fs.list', 'list', { path: 'link-dir' }, POL.DENY.PATH_SYMLINK_ESCAPE);
  expectDeny('fs.write', 'write', { path: 'link-dir/pwned.txt', content: 'x' }, POL.DENY.PATH_SYMLINK_ESCAPE);
  expectDeny('fs.write', 'write', { path: 'link-file', content: 'x' }, POL.DENY.PATH_SYMLINK_ESCAPE);
  return 'file + directory + write-through';
});

await testCase('Windows-specific path shapes are denied (drive-relative, UNC, device, ADS, reserved)', async () => {
  if (process.platform !== 'win32') return { skip: 'Windows-only path shapes' };
  expectDeny('fs.read', 'read', { path: 'C:hello.txt' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.read', 'read', { path: '\\\\?\\C:\\Windows\\win.ini' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.read', 'read', { path: '\\\\.\\PhysicalDrive0' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.read', 'read', { path: '\\\\server\\share\\x' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.read', 'read', { path: 'hello.txt:stream' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.write', 'write', { path: 'CON', content: 'x' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.write', 'write', { path: 'sub/NUL.txt', content: 'x' }, POL.DENY.PATH_MALFORMED);
  const c = POL.canonicalizePath('HELLO.TXT', POLROOT, POLROOT);
  eq(path.basename(c.realPath).toLowerCase(), 'hello.txt', 'case-insensitive resolution');
  return '6 shapes + case folding';
});

await testCase('POSIX keeps backslashes literal (a Windows-style escape must not work)', async () => {
  if (process.platform === 'win32') return { skip: 'POSIX-only semantics' };
  const weird = 'weird\\..\\..\\etc';
  fs.writeFileSync(path.join(POLROOT, weird), 'w');
  const c = POL.canonicalizePath(weird, POLROOT, POLROOT);
  ok(POL.isInsideRoot(c.realPath, POLROOT), 'backslash stays a filename character');
  expectAllow('fs.read', 'read', { path: weird });
  return 'literal backslash';
});

await testCase('malformed paths, protected patterns and read-only roots are denied', async () => {
  expectDeny('fs.read', 'read', { path: 'hello.txt\u0000.png' }, POL.DENY.PATH_MALFORMED);
  expectDeny('fs.read', 'read', { path: '' }, POL.DENY.BAD_ARGS);
  expectDeny('fs.read', 'read', { path: 'x'.repeat(5000) }, POL.DENY.BAD_ARGS);
  expectDeny('fs.read', 'read', { path: 'a\nb' }, POL.DENY.PATH_MALFORMED);
  fs.mkdirSync(path.join(POLROOT, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(POLROOT, '.ssh', 'id_rsa'), 'PRIVATE');
  expectDeny('fs.read', 'read', { path: '.ssh/id_rsa' }, POL.DENY.PATH_PROTECTED);
  const ro = new POL.PolicyEngine({ audit: policyAudit });
  ro.createGrant('ro', { caps: ['fs.write', 'fs.read'], roots: [{ path: POLROOT, mode: 'ro' }], cwd: POLROOT });
  const d = ro.authorize({ sessionKey: 'ro', peer: {}, cap: 'fs.write', op: 'write', args: { path: 'new.txt', content: 'x' }, requestId: 2 });
  eq(d.ok, false, 'read-only root refuses writes');
  eq(d.error.code, POL.DENY.READONLY, 'read-only code');
  return 'malformed + protected + read-only';
});

await testCase('per-operation limits are enforced (read size, write size, depth)', async () => {
  expectDeny('fs.read', 'read', { path: 'hello.txt', maxBytes: 1 << 20 }, POL.DENY.LIMIT);
  expectDeny('fs.write', 'write', { path: 'big.txt', content: 'x'.repeat(8192) }, POL.DENY.LIMIT);
  expectDeny('fs.list', 'list', { path: '.', depth: 99 }, POL.DENY.LIMIT);
  const allowed = expectAllow('fs.read', 'read', { path: 'hello.txt', maxBytes: 1024 });
  eq(allowed.limits.maxBytes, 4096, 'server ceiling wins over the request');
  eq(allowed.limits.timeoutMs, 5000, 'timeout comes from the grant, not the request');
  eq(expectAllow('fs.read', 'read', { path: 'hello.txt', timeoutMs: 600000 }).limits.timeoutMs, 5000, 'a long request cannot extend its own deadline');
  return 'clamped to the grant, not the request';
});

await testCase('shell policy: interpreters, deny list, allow list, argv mode, cwd escape', async () => {
  const allowNode = expectAllow('shell.exec', 'run', { cmd: 'node --version' });
  eq(allowNode.limits.mode, 'argv', 'allowlist mode must never use a shell');
  deepEq(allowNode.limits.argv, ['node', '--version'], 'parsed argv');
  expectAllow('shell.exec', 'run', { cmd: 'git status' });
  expectDeny('shell.exec', 'run', { cmd: 'rm -rf /' }, POL.DENY.SHELL_UNSAFE);
  expectDeny('shell.exec', 'run', { cmd: 'curl http://evil' }, POL.DENY.SHELL_UNSAFE);
  expectDeny('shell.exec', 'run', { cmd: 'powershell -c whoami' }, POL.DENY.SHELL_NOT_ALLOWED);
  expectDeny('shell.exec', 'run', { cmd: '/usr/bin/git status' }, POL.DENY.SHELL_NOT_ALLOWED);
  expectDeny('shell.exec', 'run', { cmd: '' }, POL.DENY.BAD_ARGS);
  expectDeny('shell.exec', 'run', { cmd: 'git log "unterminated' }, POL.DENY.BAD_ARGS);
  expectDeny('shell.exec', 'run', { cmd: 'node -v', cwd: '../outside' }, POL.DENY.PATH_OUTSIDE_ROOT);
  const meta = expectAllow('shell.exec', 'run', { cmd: 'node -e 1 && rm -rf /' });
  deepEq(meta.limits.argv, ['node', '-e', '1', '&&', 'rm', '-rf', '/'], 'metacharacters are inert arguments, no shell');
  const strict = new POL.PolicyEngine({ audit: policyAudit });
  strict.createGrant('strict', { caps: ['shell.exec'], roots: [{ path: POLROOT, mode: 'rw' }], cwd: POLROOT, shell: { mode: 'allowlist', allow: ['node'] } });
  eq(strict.authorize({ sessionKey: 'strict', peer: {}, cap: 'shell.exec', op: 'run', args: { cmd: 'node -v' }, requestId: 3 }).error.code,
    POL.DENY.SHELL_UNSAFE, 'interpreter needs allowInterpreters');
  const none = new POL.PolicyEngine({ audit: policyAudit });
  none.createGrant('none', { caps: ['shell.exec'], roots: [{ path: POLROOT, mode: 'rw' }], cwd: POLROOT });
  eq(none.authorize({ sessionKey: 'none', peer: {}, cap: 'shell.exec', op: 'run', args: { cmd: 'echo hi' }, requestId: 4 }).error.code,
    POL.DENY.SHELL_DENIED, 'default shell mode is deny');
  return 'argv mode, deny list, opt-in interpreters';
});

await testCase('spawned commands get a scrubbed environment (no PATH/loader override)', async () => {
  process.env.DSH_SELFTEST_SECRET = 'must-not-leak';
  const env = POL.safeEnv({
    FOO: 'ok', PATH: 'C:\\evil', NODE_OPTIONS: '--require ./evil.js',
    LD_PRELOAD: '/tmp/evil.so', DYLD_INSERT_LIBRARIES: '/tmp/e.dylib', dsh_home: '/tmp/x', n: 5,
  }, { allowCallerKeys: true });
  eq(env.DSH_SELFTEST_SECRET, undefined, 'DSH_* must not be inherited');
  eq(env.FOO, 'ok', 'harmless keys pass');
  ok(env.PATH !== 'C:\\evil', 'PATH is not caller-controlled');
  eq(env.NODE_OPTIONS, undefined, 'NODE_OPTIONS stripped');
  eq(env.LD_PRELOAD, undefined, 'LD_PRELOAD stripped');
  eq(env.DYLD_INSERT_LIBRARIES, undefined, 'DYLD_* stripped');
  eq(env.dsh_home, undefined, 'DSH_* stripped');
  eq(env.n, undefined, 'non-string dropped');
  return 'PATH/loader/DSH_* blocked';
});

await testCase('approved commands really run, with a hard timeout that kills the tree', async () => {
  const decision = expectAllow('shell.exec', 'run', { cmd: 'node -e "console.log(6*7)"' });
  const res = await POL.runCommand({ mode: 'argv', argv: decision.limits.argv }, {
    cwd: decision.limits.cwd, timeoutMs: decision.limits.timeoutMs, maxOutputBytes: decision.limits.maxBytes,
  });
  eq(res.code, 0, 'exit code');
  eq(res.stdout.trim(), '42', 'stdout');
  const t0 = Date.now();
  const slow = await POL.runCommand({ mode: 'argv', argv: ['node', '-e', 'setTimeout(()=>{},60000)'] }, { cwd: POLROOT, timeoutMs: 700, maxOutputBytes: 1024 });
  eq(slow.timedOut, true, 'timeout flagged');
  ok(Date.now() - t0 < 8000, `timeout was not enforced (${Date.now() - t0}ms)`);
  const noisy = await POL.runCommand({ mode: 'argv', argv: ['node', '-e', 'process.stdout.write("x".repeat(100000))'] }, { cwd: POLROOT, timeoutMs: 10000, maxOutputBytes: 4096 });
  eq(noisy.truncated, true, 'output cap flagged');
  eq(noisy.bytes, 100000, 'all bytes counted');
  ok(noisy.stdout.length <= 8192, 'output actually capped');
  return 'argv exec + timeout kill + output cap';
});

// ===========================================================================
// 7. Discovery (real sockets; skipped when the host has no usable NIC)
// ===========================================================================

group('7. Discovery (real UDP sockets)');

await testCase('interface scoring and broadcast maths', async () => {
  const ifaces = listCandidateInterfaces();
  for (const i of ifaces) {
    ok(i.kind !== 'physical' || i.score >= 40, 'physical adapters score high');
    ok(!i.address.startsWith('169.254.'), 'APIPA filtered');
    ok(!inSubnet(i.address, '100.64.0.0', '255.192.0.0'), 'CGNAT/Tailscale filtered');
  }
  eq(broadcastAddress('192.168.10.6', '255.255.255.0'), '192.168.10.255', 'subnet broadcast');
  eq(broadcastAddress('10.1.2.3', '255.255.0.0'), '10.1.255.255', 'class B broadcast');
  ok(inSubnet('192.168.10.99', '192.168.10.6', '255.255.255.0'), 'same subnet');
  ok(!inSubnet('192.168.11.99', '192.168.10.6', '255.255.255.0'), 'different subnet');
  ok(platformNotes().summary.length > 10, 'platform notes present');
  return `${ifaces.length} interfaces`;
});

await testCase('two instances find each other over multicast and enforce announce signatures', async () => {
  const ifaces = listCandidateInterfaces();
  if (ifaces.length === 0) return { skip: 'no non-internal IPv4 interface available' };
  // A private test group and port: a real bridge instance must not be disturbed.
  const group = '239.255.77.61';
  const port = 47837;
  const quiet = () => {};
  const a = new Discovery({
    deviceId: 'selftest-bridge', name: 'Bridge', roles: ['bridge'], tcpPort: 47899,
    identity: C.generateIdentity(), caps: ['fs.read'], group, port, log: quiet,
  });
  const b = new Discovery({
    deviceId: 'selftest-agent', name: 'Agent', roles: ['agent'],
    identity: C.generateIdentity(), group, port, log: quiet,
  });
  CLEANUP.push(() => { a.stop({ bye: false }); b.stop({ bye: false }); });
  let replies = 0;
  a.on('replied', () => { replies++; });
  await a.start();
  await b.start();
  if (!a.rxAvailable && !b.rxAvailable) {
    await a.stop({ bye: false }); await b.stop({ bye: false });
    return { skip: 'the fixed discovery port could not be bound in this environment' };
  }
  b.probeNow();
  await sleep(1200);
  const peer = b.listPeers().find((p) => p.deviceId === 'selftest-bridge');
  if (!peer) {
    await a.stop({ bye: false }); await b.stop({ bye: false });
    return { skip: 'multicast/broadcast delivery did not work here (see platformNotes) - not a protocol failure' };
  }
  eq(peer.verified, true, 'TOFU pinned the announce key on first sight');
  deepEq(peer.roles, ['bridge'], 'roles advertised');
  ok(peer.connectPort === 47899 || peer.tcp.length > 0, 'TCP port advertised');
  ok(peer.fingerprint.includes('-'), 'fingerprint advertised');

  // A different key claiming the same deviceId must be rejected.
  const before = b.stats.keyChanged;
  const mallory = C.generateIdentity();
  const spoof = { ...a.descriptor({ t: 'announce' }), kb: mallory.pub, fp: mallory.fingerprint, ins: 'mallory' };
  spoof.sig = C.signAnnounce(mallory.priv, spoof).toString('base64url');
  const dgram = await import('node:dgram');
  const s = dgram.default.createSocket('udp4');
  await new Promise((r) => s.bind(0, '0.0.0.0', r));
  for (const i of ifaces) {
    try { s.setMulticastInterface(i.address); } catch { /* skip this NIC */ }
    await new Promise((r) => s.send(Buffer.from(JSON.stringify(spoof)), port, group, () => r()));
  }
  await sleep(300);
  ok(b.stats.keyChanged > before, 'a swapped key was detected');
  eq(b.listPeers().find((p) => p.deviceId === 'selftest-bridge').pubKey, a.identity.pub, 'the original pin is unchanged');

  // A correctly-keyed announce with a broken signature is also refused.
  const badSigBefore = b.stats.badSignature;
  const forged = { ...a.descriptor({ t: 'announce' }), ins: 'forged', sig: Buffer.from('deadbeef', 'hex').toString('base64url') };
  for (const i of ifaces) {
    try { s.setMulticastInterface(i.address); } catch { /* skip */ }
    await new Promise((r) => s.send(Buffer.from(JSON.stringify(forged)), port, group, () => r()));
  }
  await sleep(300);
  ok(b.stats.badSignature > badSigBefore, 'a forged signature was rejected');
  s.close();
  await a.stop();
  await b.stop();
  return `peer at ${peer.address}, ${replies} replies, spoofed key rejected`;
});

// ===========================================================================
// Summary
// ===========================================================================

const failed = results.filter((r) => r.status === 'FAIL');
const passed = results.filter((r) => r.status === 'PASS');
const skipped = results.filter((r) => r.status === 'SKIP');

process.stdout.write(`\n${'='.repeat(78)}\n`);
process.stdout.write(`SUMMARY  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped\n`);
for (const s of skipped) process.stdout.write(`  SKIP  ${s.name}  (${s.detail})\n`);
if (failed.length) {
  process.stdout.write('FAILED CASES:\n');
  for (const f of failed) process.stdout.write(`  FAIL  [${f.group}] ${f.name}\n        ${f.detail}\n`);
}
process.stdout.write(`total ${results.reduce((a, r) => a + r.ms, 0)}ms\n`);
process.stdout.write(`${failed.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL'}\n`);

cleanupAll();
process.exit(failed.length === 0 ? 0 : 1);
