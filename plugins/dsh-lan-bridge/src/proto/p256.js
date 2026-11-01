/**
 * p256.js — minimal, dependency-free NIST P-256 (secp256r1) arithmetic in BigInt.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Node's built-in crypto can do ECDH with P-256 but exposes no point
 * addition / arbitrary-base scalar multiplication. A real PAKE (SPAKE2, see
 * crypto.js) needs `x*G + w*M` with a password-derived scalar `w` and a
 * nothing-up-my-sleeve point `M`; there is no way to express that with
 * `crypto.createECDH` alone, and there is no `ws`/`@noble/curves` allowed.
 * So we implement the ~200 lines of curve arithmetic ourselves and keep it
 * honest by cross-checking it against OpenSSL (the native oracle) in
 * selftest.mjs: for random scalars d, `scalarMult(d, G)` must equal the public
 * point OpenSSL derives for the private key d, and `add(d1*G, d2*G)` must equal
 * `(d1+d2)*G`.
 *
 * SECURITY NOTES / LIMITS (stated honestly, see report)
 *  - P-256 has prime order n and cofactor 1: every non-identity curve point is
 *    a generator, so no cofactor clearing or subgroup checks are needed. This is
 *    a real simplification and the main reason P-256 was chosen over modp groups.
 *  - Operations on BigInt are NOT constant time. The secrets used here are
 *    ephemeral (one handshake) and the scalars are used in a fixed 4-bit window
 *    ladder with dummy additions in every window, which removes the coarsest
 *    timing signal but is not a hardened implementation. Timing side channels
 *    over a LAN against a local JS engine are considered out of scope; if they
 *    matter for you, use the native-ECDH session path (crypto.js,
 *    `useNativeEcdh`) and treat the SPAKE2 pairing as a one-time operation.
 *  - `scalarMult` is not protected against fault attacks; not applicable here.
 */

import crypto from 'node:crypto';

/** Field prime. */
export const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
/** Curve coefficient a = -3 mod p. */
export const A = P - 3n;
/** Curve coefficient b. */
export const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
/** Group order (prime). */
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
/** Generator. */
export const G = {
  x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
};

const ZERO = 0n;
const ONE = 1n;
/** Jacobian point at infinity. */
export const INFINITY = { X: ZERO, Y: ONE, Z: ZERO };

/** @returns {bigint} always in [0, m) */
export function mod(a, m = P) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/** Modular exponentiation (square and multiply, MSB first). */
export function modPow(base, exp, m = P) {
  let b = mod(base, m);
  let e = exp;
  let r = ONE;
  while (e > ZERO) {
    if (e & ONE) r = (r * b) % m;
    b = (b * b) % m;
    e >>= ONE;
  }
  return r % m;
}

/**
 * Modular inverse.
 * P is prime and P % 4 == 3, so a^(P-2) works; for the group order N we also use
 * Fermat because N is prime.
 */
export function modInv(a, m = P) {
  const x = mod(a, m);
  if (x === ZERO) throw new Error('p256: inverse of zero');
  return modPow(x, m - 2n, m);
}

/** True when (x, y) satisfies y^2 = x^3 - 3x + b over F_p and is not infinity. */
export function isOnCurve(pt) {
  if (!pt) return false;
  const { x, y } = pt;
  if (typeof x !== 'bigint' || typeof y !== 'bigint') return false;
  if (x < ZERO || x >= P || y < ZERO || y >= P) return false;
  const lhs = mod(y * y);
  const rhs = mod(x * x * x + A * x + B);
  return lhs === rhs;
}

/** Affine point equality (null === infinity). */
export function pointEq(p1, p2) {
  if (p1 === null || p2 === null) return p1 === p2;
  if (!p1 || !p2) return false;
  return p1.x === p2.x && p1.y === p2.y;
}

// ---------------------------------------------------------------------------
// Jacobian coordinates: (X, Y, Z) represents the affine point (X/Z^2, Y/Z^3).
// Only one field inversion is needed per scalar multiplication.
// ---------------------------------------------------------------------------

function jacFromAffine(pt) {
  if (pt === null) return { ...INFINITY };
  return { X: mod(pt.x), Y: mod(pt.y), Z: ONE };
}

function jacToAffine(j) {
  if (j.Z === ZERO) return null;
  const zi = modInv(j.Z);
  const zi2 = mod(zi * zi);
  const zi3 = mod(zi2 * zi);
  return { x: mod(j.X * zi2), y: mod(j.Y * zi3) };
}

function jacDouble(j) {
  if (j.Z === ZERO || j.Y === ZERO) return { ...INFINITY };
  const delta = mod(j.Z * j.Z); // Z^2
  const gamma = mod(j.Y * j.Y); // Y^2
  const beta = mod(j.X * gamma);
  // alpha = 3*X^2 + a*Z^4 with a = -3  =>  3*(X - Z^2)*(X + Z^2)
  const alpha = mod(3n * mod(j.X - delta) * mod(j.X + delta));
  const X3 = mod(alpha * alpha - 8n * beta);
  const Z3 = mod(mod(j.Y + j.Z) ** 2n - gamma - delta);
  const Y3 = mod(alpha * mod(4n * beta - X3) - 8n * gamma * gamma);
  return { X: X3, Y: Y3, Z: Z3 };
}

/** Jacobian + affine (madd-2007-bl). */
function jacAddAffine(j, pt) {
  if (j.Z === ZERO) return jacFromAffine(pt);
  const Z1Z1 = mod(j.Z * j.Z);
  const U2 = mod(pt.x * Z1Z1);
  const S2 = mod(pt.y * j.Z * Z1Z1);
  const H = mod(U2 - j.X);
  const r = mod(2n * mod(S2 - j.Y));
  if (H === ZERO) {
    if (r === ZERO) return jacDouble(j);
    return { ...INFINITY };
  }
  const HH = mod(H * H);
  const I = mod(4n * HH);
  const J = mod(H * I);
  const V = mod(j.X * I);
  const X3 = mod(r * r - J - 2n * V);
  const Y3 = mod(r * mod(V - X3) - 2n * j.Y * J);
  const Z3 = mod(mod(j.Z + H) ** 2n - Z1Z1 - HH);
  return { X: X3, Y: Y3, Z: Z3 };
}

/** Jacobian + Jacobian (add-2007-bl). */
function jacAdd(j1, j2) {
  if (j1.Z === ZERO) return j2;
  if (j2.Z === ZERO) return j1;
  const Z1Z1 = mod(j1.Z * j1.Z);
  const Z2Z2 = mod(j2.Z * j2.Z);
  const U1 = mod(j1.X * Z2Z2);
  const U2 = mod(j2.X * Z1Z1);
  const S1 = mod(j1.Y * j2.Z * Z2Z2);
  const S2 = mod(j2.Y * j1.Z * Z1Z1);
  const H = mod(U2 - U1);
  const r = mod(2n * mod(S2 - S1));
  if (H === ZERO) {
    if (r === ZERO) return jacDouble(j1);
    return { ...INFINITY };
  }
  const I = mod(mod(2n * H) ** 2n);
  const J = mod(H * I);
  const V = mod(U1 * I);
  const X3 = mod(r * r - J - 2n * V);
  const Y3 = mod(r * mod(V - X3) - 2n * S1 * J);
  const Z3 = mod(mod(mod(j1.Z + j2.Z) ** 2n - Z1Z1 - Z2Z2) * H);
  return { X: X3, Y: Y3, Z: Z3 };
}

/** Affine addition. Returns null for infinity. */
export function pointAdd(p1, p2) {
  if (p1 === null) return p2 === null ? null : { x: p2.x, y: p2.y };
  if (p2 === null) return { x: p1.x, y: p1.y };
  return jacToAffine(jacAdd(jacFromAffine(p1), jacFromAffine(p2)));
}

/** Affine negation. */
export function pointNeg(pt) {
  if (pt === null) return null;
  return { x: mod(pt.x), y: mod(-pt.y) };
}

/** Affine subtraction. */
export function pointSub(p1, p2) {
  return pointAdd(p1, pointNeg(p2));
}

/**
 * Scalar multiplication k*pt using a fixed 4-bit window (left to right).
 *
 * Every window performs exactly 4 doublings followed by 1 addition; when the
 * window digit is 0 the addition is against the point at infinity (table[0]),
 * which is the identity. This keeps the *structure* of the computation
 * independent of the scalar. It is NOT a constant-time implementation:
 * BigInt arithmetic and the identity short-circuit in jacAdd still leak
 * fine-grained timing. See the file header.
 *
 * @returns {{x: bigint, y: bigint}|null} null means the point at infinity
 */
export function scalarMult(k, pt) {
  let e = mod(k, N);
  if (e === ZERO || pt === null) return null;
  const base = { x: mod(pt.x), y: mod(pt.y) };
  if (!isOnCurve(base)) throw new Error('p256: scalarMult on a point not on the curve');

  // table[i] = i*base in Jacobian form; table[0] is the identity.
  const table = [{ ...INFINITY }, jacFromAffine(base)];
  for (let i = 2; i < 16; i++) table.push(jacAdd(table[i - 1], table[1]));

  const nibbles = [];
  while (e > ZERO) { nibbles.push(Number(e & 15n)); e >>= 4n; }
  nibbles.reverse();

  let acc = { ...INFINITY };
  for (const nib of nibbles) {
    acc = jacDouble(acc);
    acc = jacDouble(acc);
    acc = jacDouble(acc);
    acc = jacDouble(acc);
    acc = jacAdd(acc, table[nib]);
  }
  return jacToAffine(acc);
}

/** n*G must be infinity; cheap structural self-check. */
export function selfCheck() {
  if (!isOnCurve(G)) return { ok: false, why: 'G not on curve' };
  if (scalarMult(N - 1n, G) === null) return { ok: false, why: '(n-1)*G is infinity' };
  const g2 = scalarMult(2n, G);
  if (!pointEq(g2, pointAdd(G, G))) return { ok: false, why: '2G mismatch' };
  if (scalarMult(N, G) !== null) return { ok: false, why: 'n*G != infinity' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Point encoding (SEC1)
// ---------------------------------------------------------------------------

/** 33 byte compressed encoding: 0x02|0x03 (y parity) || x32be. */
export function encodePoint(pt) {
  if (pt === null) throw new Error('p256: cannot encode the point at infinity');
  const out = Buffer.alloc(33);
  out[0] = (pt.y & ONE) === ONE ? 0x03 : 0x02;
  writeBigInt(out, 1, pt.x);
  return out;
}

/** 65 byte uncompressed encoding: 0x04 || x32be || y32be. */
export function encodePointUncompressed(pt) {
  if (pt === null) throw new Error('p256: cannot encode the point at infinity');
  const out = Buffer.alloc(65);
  out[0] = 0x04;
  writeBigInt(out, 1, pt.x);
  writeBigInt(out, 33, pt.y);
  return out;
}

/**
 * Decode + fully validate a SEC1 point (33 byte compressed or 65 byte
 * uncompressed). Returns null when the encoding is not a valid curve point.
 * All peers' points MUST go through this before any arithmetic.
 */
export function decodePoint(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length === 65) {
    if (buf[0] !== 0x04) return null;
    const pt = { x: readBigInt(buf, 1), y: readBigInt(buf, 33) };
    return isOnCurve(pt) ? pt : null;
  }
  if (buf.length !== 33) return null;
  const prefix = buf[0];
  if (prefix !== 0x02 && prefix !== 0x03) return null;
  const x = readBigInt(buf, 1);
  if (x >= P) return null;
  const v = mod(x * x * x + A * x + B);
  // P % 4 == 3, so the square root is v^((P+1)/4) when v is a QR.
  const y = modPow(v, (P + ONE) / 4n);
  if (mod(y * y) !== v) return null; // x is not on the curve
  const wantOdd = prefix === 0x03;
  let yy = y;
  if (((yy & ONE) === ONE) !== wantOdd) yy = mod(-yy);
  if (yy === ZERO) return null; // no order-2 point exists on P-256
  return { x, y: yy };
}

function writeBigInt(buf, offset, value) {
  let v = value;
  for (let i = offset + 31; i >= offset; i--) { buf[i] = Number(v & 0xffn); v >>= 8n; }
}

function readBigInt(buf, offset) {
  let v = ZERO;
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(buf[offset + i]);
  return v;
}

// ---------------------------------------------------------------------------
// Random scalars and hash-to-curve
// ---------------------------------------------------------------------------

/** Uniform-ish random scalar in [1, n-1] (rejection sampling, no modulo bias). */
export function randomScalar() {
  for (;;) {
    const bytes = crypto.randomBytes(32);
    const v = readBigInt(bytes, 0);
    if (v > ZERO && v < N) return v;
  }
}

/** Reduce a 32 byte digest to a non-zero scalar mod n. */
export function scalarFromDigest(digest) {
  const v = mod(readBigInt(digest, 0), N);
  if (v === ZERO) throw new Error('p256: scalar reduced to zero');
  return v;
}

/**
 * Nothing-up-my-sleeve hash-to-curve: try-and-increment on x.
 * Safe here because P-256 has cofactor 1 (any non-identity point is a
 * generator), so there is no small-subgroup attack to worry about. The returned
 * point is canonicalised to even y so both peers agree bit for bit.
 */
export function hashToPoint(domain, extra = Buffer.alloc(0)) {
  const domainBytes = Buffer.isBuffer(domain) ? domain : Buffer.from(domain, 'utf8');
  for (let counter = 0; counter < 256; counter++) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter, 0);
    const h = crypto.createHash('sha256').update(domainBytes).update(c).update(extra).digest();
    const x = mod(readBigInt(h, 0));
    const v = mod(x * x * x + A * x + B);
    const y = modPow(v, (P + ONE) / 4n);
    if (mod(y * y) !== v) continue;
    const yy = (y & ONE) === ONE ? mod(-y) : y; // canonical: even y
    const pt = { x, y: yy };
    if (yy !== ZERO && isOnCurve(pt)) return pt;
  }
  throw new Error('p256: hashToPoint failed');
}

export default {
  P, A, B, N, G,
  mod, modPow, modInv, isOnCurve, pointEq, pointAdd, pointNeg, pointSub,
  scalarMult, selfCheck, encodePoint, encodePointUncompressed, decodePoint,
  randomScalar, scalarFromDigest, hashToPoint,
};
