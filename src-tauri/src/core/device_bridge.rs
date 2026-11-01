//! The phone as a **bridge end** of the device net.
//!
//! plugins/dsh-lan-bridge is the shipped device net: a LAN peer that opens its files and
//! its shell to another DSH over an encrypted TCP session, paired once with a short code.
//! On a desktop that plugin *is* the bridge side, running in the kernel. The phone has no
//! kernel (ADR-004), so if it is to be the slave end of that net the wire has to be spoken
//! here, in Rust, and this module is where it is spoken.
//!
//! ## Which contract this speaks, and why it is that one
//!
//! The repository carries two wire contracts and only one of them has these operations.
//! docs/protocol/device-net-v1.md is the **collab ledger** relay (POST
//! /api/dsh-link-collab/relay, bearer token, batches of records) and knows no "pair", no
//! fs.list and no fs.read. The operations this slice must serve, the pairing handshake they
//! hang off, and the envelopes a host already expects are all in the other one:
//! plugins/dsh-lan-bridge/lib/core/{frame,crypto,p256,link,exec}.js (protocol v1, written
//! down in that plugin's docs/ARCHITECTURE.md section 4). So this module is a port of that
//! contract rather than an invention, and it keeps the *names and shapes* the shipped host
//! code already speaks:
//!
//! | step | wire | source of truth |
//! |---|---|---|
//! | discovery | not spoken: a peer connects to a known host:port | link.js FrameLink.connect |
//! | framing | u32be totalLen, u32be headerLen, JSON header, payload | frame.js encodeFrame |
//! | handshake | cleartext hello / hello_ack (P-256 ephemeral + transcript) | link.js bridgeHandshake |
//! | pairing | cleartext pair_begin / pair_reply / pair_finish / pair_result, SPAKE2 over P-256 with the code shown on this screen | crypto.js Spake2 |
//! | keys | HKDF-SHA256 over (ECDH, PSK), AES-256-GCM per direction, nonce = salt||seq | crypto.js SecureChannel |
//! | key confirmation | cleartext finish / finish_ok | link.js exchangeFinish |
//! | work | encrypted req {id,cap,op,args} -> res {id,ok,result|error} | link.js Session |
//!
//! Nothing here is re-derived "close enough": the SPAKE2 group elements, the transcript
//! layout, the canonical JSON of the negotiated set and the AEAD framing are reproduced byte
//! for byte, because the shipped host code authenticates them. The unit tests pin the group
//! elements and the password scalar against the values crypto.js produces, and
//! tools/device-bridge/drive.mjs drives this module with the shipped link.js + crypto.js
//! rather than with a second client written for the occasion.
//!
//! ## What this build answers, and what it refuses by name
//!
//! Exactly three things: pair, fs.list, fs.read. The negotiated capability set is
//! ["fs.read", "fs.list"], so a host cannot even ask for the rest by accident; a peer that
//! asks anyway gets a **named refusal** rather than an empty success, in the same words
//! mobile.rs already refuses the shell's desktop-only surface ("reserved: ... is not
//! implemented on Android yet"). Every path served is read-only and must resolve inside a
//! granted root; escapes are path-denied, the same code the host's own executor produces.
//!
//! ## Status a human can see
//!
//! The service publishes Status - listening address, pairing code, the last pairing, the
//! last request - which /__shell/bridge hands to the boot page, so the phone's own screen
//! carries the code that has to be typed on the host.
//!
//! ## Boundaries (stated, not implied)
//!
//! * No UDP discovery: this build does not announce itself and does not answer probes. A
//!   peer reaches it at a known address (adb forward, or the LAN once the port is).
//! * One pairing window per run: five wrong codes close it until the app restarts, and
//!   reconnecting means pairing again - TOFU pinning and the "trusted" (signature-only)
//!   path are not implemented here, so authMode is pake or the peer is turned away.
//! * One session at a time; a second connection is refused by name rather than queued.
//! * Read-only. Nothing in this module can write, move or delete a file on the phone.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::Aes256Gcm;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use p256::elliptic_curve::group::Group;
use p256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use p256::elliptic_curve::PrimeField;
use p256::{AffinePoint, EncodedPoint, ProjectivePoint, Scalar};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

// ---------------------------------------------------------------------------
// The protocol's own constants (copied from frame.js / crypto.js / link.js)
// ---------------------------------------------------------------------------

/// Wire magic carried by hello / hello_ack (frame.js PROTO_MAGIC).
const PROTO_MAGIC: &str = "dsh-lan-bridge/1";
/// Transcript domain separator (crypto.js SESSION_MAGIC).
const SESSION_MAGIC: &str = "dsh-lan-bridge/session/v1";
/// Key-derivation domain separator (crypto.js KDF_MAGIC).
const KDF_MAGIC: &str = "dsh-lan-bridge/kdf/v1";
/// SPAKE2 domain separator (crypto.js PAIRING_MAGIC).
const PAIRING_MAGIC: &str = "dsh-lan-bridge/spake2/v1";

/// First AAD byte, agent to bridge (frame.js).
const DIR_AGENT_TO_BRIDGE: u8 = 0x41;
/// First AAD byte, bridge to agent (frame.js).
const DIR_BRIDGE_TO_AGENT: u8 = 0x42;

/// Versions this build speaks (link.js PROTOCOL_MIN / PROTOCOL_MAX).
const PROTOCOL_MIN: &str = "0.1";
const PROTOCOL_MAX: &str = "0.2";

/// The capabilities this build actually implements, in the host's own order (link.js
/// CAPABILITIES). The negotiated set is the intersection, so naming only these two is what
/// keeps a host from asking for the rest.
// R322: `sys.info` is implemented here now (info + devices), so the Android end is no longer a peer a host
// cannot even ask about: before this, a paired phone answered "reserved: sys.info is not implemented on Android
// yet" and the host's self test / target refresh could never succeed against it. Order matters no more than the
// set does (the agent follows the BRIDGE's advertised order), but it is kept stable on purpose.
const CAPABILITIES: &[&str] = &["fs.read", "fs.list", "sys.info", "media.capture"];

/// Feature flags, in the host's order and with the host's defaults (link.js FEATURES).
/// All five are declared because negotiation intersects them and the intersection is part
/// of the signed transcript: declaring fewer would produce a different transcript than the
/// peer computes.
const FEATURES: &[(&str, bool)] = &[
    ("streamCredit", true),
    ("rekey", true),
    ("cancel", true),
    ("pathRoots", true),
    ("auditStream", false),
];

/// Operations a peer could name that this build refuses **by name**. The refusal text is
/// super::mobile::reserved, the one sentence this shell uses everywhere for a seam an
/// Android build still owes.
const REFUSED_CAPABILITIES: &[&str] = &[
    "fs.write",
    "fs.edit",
    "shell.exec",
    "process.spawn",
];

/// Framing ceilings (frame.js).
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;
/// Ceiling on one fs.read window's bytes (policy.js limits.maxReadBytes default).
const MAX_READ_BYTES: u64 = 1024 * 1024;
/// exec.js: one directory page is capped, and so is one read window.
const LIST_MAX_ENTRIES: usize = 2000;
const READ_DEFAULT_LIMIT: usize = 2000;
const READ_MAX_LIMIT: usize = 20000;
/// Correct guesses allowed against one pairing code (crypto.js PairingGuard).
const PAIRING_MAX_ATTEMPTS: u32 = 5;

/// Base64url without padding - every string on this wire is that.
const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// SPKI DER prefix for an Ed25519 public key: 12 fixed bytes then the 32-byte key, which is
/// the shape crypto.js generateIdentity exports and the host prints as a fingerprint.
const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

// ---------------------------------------------------------------------------
// Byte helpers (crypto.js lp / cat / sha256 / hmac / hkdf / base32 / group)
// ---------------------------------------------------------------------------

/// Length-prefixed part: u32be(len) || bytes.
fn lp_into(out: &mut Vec<u8>, part: &[u8]) {
    out.extend((part.len() as u32).to_be_bytes());
    out.extend(part);
}

/// lp() of one part, for call sites that need the bytes rather than an append.
fn lp(part: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + part.len());
    lp_into(&mut out, part);
    out
}

/// lp(a) || lp(b) || ...
fn lps(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for part in parts {
        lp_into(&mut out, part);
    }
    out
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    for part in parts {
        mac.update(part);
    }
    let digest = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// HKDF-Extract (RFC 5869) - hmac(salt, ikm), as crypto.js writes it.
fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> [u8; 32] {
    hmac_sha256(salt, &[ikm])
}

/// HKDF-Expand (RFC 5869, SHA-256), the same loop crypto.js runs.
fn hkdf_expand(prk: &[u8], info: &[u8], length: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(length);
    let mut previous: Vec<u8> = Vec::new();
    let mut counter: u8 = 1;
    while out.len() < length {
        let block = hmac_sha256(prk, &[&previous, info, &[counter]]);
        out.extend_from_slice(&block);
        previous = block.to_vec();
        counter = counter.wrapping_add(1);
    }
    out.truncate(length);
    out
}

fn b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

fn unb64(text: &str) -> Option<Vec<u8>> {
    B64.decode(text.as_bytes()).ok()
}

/// Crockford base32 without padding - crypto.js base32.
fn base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut out = String::new();
    let mut value: u32 = 0;
    let mut bits = 0;
    for byte in bytes {
        value = (value << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// Group a string for display: "ABCDEFGH" -> "ABCD-EFGH".
fn group(text: &str, size: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(size)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// The fingerprint the host shows beside a device: 20 base32 chars, grouped by four.
fn fingerprint_of(spki: &[u8]) -> String {
    let digest = sha256(&[spki]);
    group(&base32(&digest[..10]), 4)
}

/// Canonical JSON: object keys sorted, exactly crypto.js canonicalJson. The negotiated set
/// is signed through this, so the two sides must agree on it byte for byte.
fn canonical_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .into_iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        canonical_json(&map[key])
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// P-256: the group operations crypto.js had to write by hand
// ---------------------------------------------------------------------------

/// Reduce a 32-byte big-endian digest modulo the field prime. p256's decoder requires a
/// canonical (< p) coordinate and crypto.js reduces first, so this is the difference
/// between agreeing with it and disagreeing on a 2^-32 event.
fn reduce_mod_p(digest: &[u8; 32]) -> [u8; 32] {
    // p = 2^256 - 2^224 + 2^192 + 2^96 - 1
    const P: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff,
    ];
    if digest < &P {
        return *digest;
    }
    let mut out = [0u8; 32];
    let mut borrow: i16 = 0;
    for index in (0..32).rev() {
        let mut diff = i16::from(digest[index]) - i16::from(P[index]) - borrow;
        if diff < 0 {
            diff += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out[index] = diff as u8;
    }
    out
}

/// Reduce a 32-byte big-endian digest modulo the group order, the way crypto.js
/// scalarFromDigest does (one conditional subtraction suffices: for P-256 2^256 < 2n).
fn scalar_from_digest(digest: &[u8; 32]) -> Option<Scalar> {
    // n = 2^256 - 432420386565659656852420866394968145599
    const N: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2,
        0xfc, 0x63, 0x25, 0x51,
    ];
    let mut value = *digest;
    if value >= N {
        let mut borrow: i16 = 0;
        for index in (0..32).rev() {
            let mut diff = i16::from(value[index]) - i16::from(N[index]) - borrow;
            if diff < 0 {
                diff += 256;
                borrow = 1;
            } else {
                borrow = 0;
            }
            value[index] = diff as u8;
        }
    }
    let field = p256::FieldBytes::from_slice(&value);
    let scalar: Scalar = Option::from(Scalar::from_repr(*field))?;
    if scalar == Scalar::ZERO {
        None
    } else {
        Some(scalar)
    }
}

/// Fresh uniform scalar in [1, n-1], matching p256.js randomScalar's range.
fn random_scalar() -> Scalar {
    loop {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        if let Some(scalar) = scalar_from_digest(&bytes) {
            return scalar;
        }
    }
}

fn scalar_mult(scalar: &Scalar, point: &ProjectivePoint) -> ProjectivePoint {
    *point * *scalar
}

fn encode_point(point: &ProjectivePoint) -> Vec<u8> {
    point.to_affine().to_encoded_point(true).as_bytes().to_vec()
}

fn decode_point(bytes: &[u8]) -> Option<ProjectivePoint> {
    let encoded = EncodedPoint::from_bytes(bytes).ok()?;
    let affine: Option<AffinePoint> = Option::from(AffinePoint::from_encoded_point(&encoded));
    affine.map(ProjectivePoint::from)
}

/// p256.js hashToPoint: SHA-256(domain || counter_be) tries, taking the first x that lies on
/// the curve, canonicalised to an even y. The two group elements SPAKE2 is built on come
/// from this, so both ends must land on the same points or pairing can never work.
fn hash_to_point(domain: &str, extra: &[u8]) -> ProjectivePoint {
    for counter in 0u32..256 {
        let digest = sha256(&[domain.as_bytes(), &counter.to_be_bytes(), extra]);
        let x = reduce_mod_p(&digest);
        let mut compressed = Vec::with_capacity(33);
        compressed.push(0x02); // even y, the canonical choice
        compressed.extend_from_slice(&x);
        if let Some(point) = decode_point(&compressed) {
            if !bool::from(point.is_identity()) {
                return point;
            }
        }
    }
    unreachable!("hashToPoint exhausted 256 counters, which cannot happen on P-256")
}

/// The two nothing-up-my-sleeve group elements, computed once (crypto.js spake2Points).
fn spake2_points() -> &'static (ProjectivePoint, ProjectivePoint) {
    static POINTS: OnceLock<(ProjectivePoint, ProjectivePoint)> = OnceLock::new();
    POINTS.get_or_init(|| {
        let m = hash_to_point(&format!("{PAIRING_MAGIC}/M"), &[]);
        let n = hash_to_point(&format!("{PAIRING_MAGIC}/N"), &[]);
        (m, n)
    })
}

/// ECDH shared secret: the x coordinate of priv * peer, 32 bytes big-endian - what
/// OpenSSL's computeSecret returns and what crypto.js ecdhSharedSecret hands on.
fn ecdh_shared_secret(priv_scalar: &Scalar, peer: &ProjectivePoint) -> [u8; 32] {
    let shared = scalar_mult(priv_scalar, peer);
    let encoded = shared.to_affine().to_encoded_point(false);
    let mut out = [0u8; 32];
    out.copy_from_slice(encoded.x().expect("affine point carries an x coordinate"));
    out
}

// ---------------------------------------------------------------------------
// SPAKE2, responder (bridge) side - crypto.js Spake2, role 'B'
// ---------------------------------------------------------------------------

/// Normalise a typed code the way crypto.js normalizeCode does: drop separators, uppercase,
/// map the look-alike letters.
fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_' && *c != '.')
        .flat_map(|c| c.to_uppercase())
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            'U' => 'V',
            other => other,
        })
        .collect()
}

/// The password scalar: HMAC(PAIRING_MAGIC || "/w", lp(context), code) reduced modulo the
/// group order. The context is the pairing window, so a recording cannot be replayed into
/// another one.
fn spake2_scalar(code: &str, context: &[u8]) -> Option<Scalar> {
    let norm = normalize_code(code);
    if norm.is_empty() {
        return None;
    }
    let digest = hmac_sha256(
        &[PAIRING_MAGIC.as_bytes(), b"/w"].concat(),
        &[&lp(context), norm.as_bytes()],
    );
    scalar_from_digest(&digest)
}

/// One side of a SPAKE2 exchange. Only the responder half is needed here: this build is
/// always the bridge.
struct Spake2 {
    w: Scalar,
    private: Scalar,
    context: Vec<u8>,
    id_a: String,
    id_b: String,
    own: Option<Vec<u8>>,
    confirm_out: Option<[u8; 32]>,
    confirm_in: Option<[u8; 32]>,
    psk: Option<[u8; 32]>,
}

impl Spake2 {
    fn responder(code: &str, context: &[u8], id_a: &str, id_b: &str) -> Option<Self> {
        Some(Self {
            w: spake2_scalar(code, context)?,
            private: random_scalar(),
            context: context.to_vec(),
            id_a: id_a.to_owned(),
            id_b: id_b.to_owned(),
            own: None,
            confirm_out: None,
            confirm_in: None,
            psk: None,
        })
    }

    /// Our share Y = priv*G + w*N, SEC1-compressed (33 bytes).
    fn start(&mut self) -> Vec<u8> {
        let (_, n) = spake2_points();
        let base = scalar_mult(&self.w, n);
        let own = ProjectivePoint::GENERATOR * self.private + base;
        let encoded = encode_point(&own);
        self.own = Some(encoded.clone());
        encoded
    }

    /// Absorb the peer's share and derive the PSK and both confirmation tags.
    fn finish(&mut self, peer_share: &[u8]) -> Result<(), String> {
        let (m, n) = spake2_points();
        let Some(own) = self.own.clone() else {
            return Err("spake2_not_started".to_owned());
        };
        if peer_share == own.as_slice() {
            return Err("reflected share".to_owned());
        }
        let peer = decode_point(peer_share).ok_or_else(|| "invalid point".to_owned())?;
        // The peer (role A) masked with M; strip it, then multiply by our scalar.
        let mask = scalar_mult(&self.w, m);
        let unmasked = peer - mask;
        if bool::from(unmasked.is_identity()) {
            return Err("degenerate share".to_owned());
        }
        let k = scalar_mult(&self.private, &unmasked);
        if bool::from(k.is_identity()) {
            return Err("degenerate secret".to_owned());
        }
        let x_bytes = peer_share.to_vec();
        let y_bytes = own;
        let m_bytes = encode_point(m);
        let n_bytes = encode_point(n);
        let transcript = lps(&[
            PAIRING_MAGIC.as_bytes(),
            &self.context,
            self.id_a.as_bytes(),
            self.id_b.as_bytes(),
            &x_bytes,
            &y_bytes,
            &m_bytes,
            &n_bytes,
        ]);
        let k_bytes = encode_point(&k);
        let k_dh = sha256(&[&lp(b"K"), &transcript, &k_bytes]);
        let k_a = sha256(&[
            &lp(b"Ka"),
            &transcript,
            &k_dh,
            &lp(self.id_a.as_bytes()),
            &lp(self.id_b.as_bytes()),
        ]);
        let k_b = sha256(&[
            &lp(b"Kb"),
            &transcript,
            &k_dh,
            &lp(self.id_a.as_bytes()),
            &lp(self.id_b.as_bytes()),
        ]);
        let confirm_a = hmac_sha256(&k_a, &[&lp(b"confirmA"), &transcript]);
        let confirm_b = hmac_sha256(&k_b, &[&lp(b"confirmB"), &transcript]);
        let psk = sha256(&[
            &lp(b"psk"),
            &transcript,
            &k_dh,
            &lp(self.id_a.as_bytes()),
            &lp(self.id_b.as_bytes()),
        ]);
        self.confirm_out = Some(confirm_b);
        self.confirm_in = Some(confirm_a);
        self.psk = Some(psk);
        Ok(())
    }

    fn verify_peer(&self, tag: &[u8]) -> bool {
        match self.confirm_in {
            Some(expected) => constant_time_eq(tag, &expected),
            None => false,
        }
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Frames (frame.js)
// ---------------------------------------------------------------------------

/// One decoded frame: the parsed header, the exact header bytes (they are the AAD) and the
/// opaque payload.
struct Frame {
    header: Value,
    header_bytes: Vec<u8>,
    payload: Vec<u8>,
}

impl Frame {
    fn kind(&self) -> &str {
        self.header.get("t").and_then(Value::as_str).unwrap_or("")
    }

    fn text(&self, key: &str) -> Option<&str> {
        self.header.get(key).and_then(Value::as_str)
    }
}

async fn read_frame(stream: &mut TcpStream) -> Result<Frame, String> {
    let mut prefix = [0u8; 8];
    stream
        .read_exact(&mut prefix)
        .await
        .map_err(|error| format!("read frame prefix: {error}"))?;
    let total_len = u32::from_be_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
    let header_len = u32::from_be_bytes([prefix[4], prefix[5], prefix[6], prefix[7]]) as usize;
    if total_len > MAX_FRAME_BYTES {
        return Err(format!("frame_too_large: declared {total_len}"));
    }
    if header_len == 0 {
        return Err("header_empty".to_owned());
    }
    if header_len > MAX_HEADER_BYTES {
        return Err(format!("header_too_large: {header_len}"));
    }
    if total_len < 4 + header_len {
        return Err(format!("frame_inconsistent: {total_len} < 4 + {header_len}"));
    }
    let mut rest = vec![0u8; total_len - 4];
    stream
        .read_exact(&mut rest)
        .await
        .map_err(|error| format!("read frame body: {error}"))?;
    let header_bytes = rest[..header_len].to_vec();
    let payload = rest[header_len..].to_vec();
    let header: Value =
        serde_json::from_slice(&header_bytes).map_err(|error| format!("header_not_json: {error}"))?;
    if !header.is_object() {
        return Err("header_not_object".to_owned());
    }
    Ok(Frame {
        header,
        header_bytes,
        payload,
    })
}

async fn write_frame(
    stream: &mut TcpStream,
    header_bytes: &[u8],
    payload: &[u8],
) -> Result<(), String> {
    let total_len = 4 + header_bytes.len() + payload.len();
    if total_len > MAX_FRAME_BYTES {
        return Err(format!("frame_too_large: {total_len}"));
    }
    let mut out = Vec::with_capacity(8 + header_bytes.len() + payload.len());
    out.extend((total_len as u32).to_be_bytes());
    out.extend((header_bytes.len() as u32).to_be_bytes());
    out.extend(header_bytes);
    out.extend(payload);
    stream
        .write_all(&out)
        .await
        .map_err(|error| format!("write frame: {error}"))
}

/// A cleartext frame: JSON header, no payload (the handshake's shape).
async fn write_cleartext(stream: &mut TcpStream, header: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(header).map_err(|error| format!("encode header: {error}"))?;
    write_frame(stream, &bytes, &[]).await
}

/// AAD = direction byte, u32be(headerLen), header bytes (frame.js buildAAD).
fn build_aad(direction: u8, header_bytes: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(5 + header_bytes.len());
    aad.push(direction);
    aad.extend((header_bytes.len() as u32).to_be_bytes());
    aad.extend_from_slice(header_bytes);
    aad
}

// ---------------------------------------------------------------------------
// Session keys (crypto.js derivePrk / deriveEpochKeys / SecureChannel)
// ---------------------------------------------------------------------------

/// Per-direction AEAD state plus the replay window, i.e. one bridge role's SecureChannel.
struct Channel {
    send_key: [u8; 32],
    send_salt: [u8; 4],
    recv_key: [u8; 32],
    recv_salt: [u8; 4],
    confirm_key: [u8; 32],
    transcript_hash: [u8; 32],
    epoch: u32,
    send_seq: u64,
    recv_highest: u64,
    recv_bitmap: u64,
}

impl Channel {
    fn new(prk: &[u8], transcript_hash: [u8; 32]) -> Self {
        let info = [lp(format!("{KDF_MAGIC}/keys").as_bytes()), lp(b"0")].concat();
        let km = hkdf_expand(prk, &info, 128);
        let mut key_a2b = [0u8; 32];
        key_a2b.copy_from_slice(&km[0..32]);
        let mut key_b2a = [0u8; 32];
        key_b2a.copy_from_slice(&km[32..64]);
        let mut salt_a2b = [0u8; 4];
        salt_a2b.copy_from_slice(&km[64..68]);
        let mut salt_b2a = [0u8; 4];
        salt_b2a.copy_from_slice(&km[68..72]);
        let mut confirm_key = [0u8; 32];
        confirm_key.copy_from_slice(&km[72..104]);
        Self {
            // The bridge seals with the bridge-to-agent key and opens with agent-to-bridge.
            send_key: key_b2a,
            send_salt: salt_b2a,
            recv_key: key_a2b,
            recv_salt: salt_a2b,
            confirm_key,
            transcript_hash,
            epoch: 0,
            send_seq: 0,
            recv_highest: 0,
            recv_bitmap: 0,
        }
    }

    fn iv(salt: &[u8; 4], seq: u64) -> [u8; 12] {
        let mut iv = [0u8; 12];
        iv[..4].copy_from_slice(salt);
        iv[4..].copy_from_slice(&seq.to_be_bytes());
        iv
    }

    /// Seal a body (plus optional payload) into a wire-ready frame.
    fn seal(&mut self, body: &Value, payload: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        self.send_seq += 1;
        let seq = self.send_seq;
        let iv = Self::iv(&self.send_salt, seq);
        let body_bytes =
            serde_json::to_vec(body).map_err(|error| format!("encode body: {error}"))?;
        let mut plain = Vec::with_capacity(4 + body_bytes.len() + payload.len());
        plain.extend((body_bytes.len() as u32).to_be_bytes());
        plain.extend(&body_bytes);
        plain.extend_from_slice(payload);
        let subtype = body.get("t").and_then(Value::as_str).unwrap_or("");
        let header = json!({
            "t": "enc",
            "e": self.epoch,
            "s": seq,
            "iv": b64(&iv),
            "st": subtype,
        });
        let header_bytes =
            serde_json::to_vec(&header).map_err(|error| format!("encode header: {error}"))?;
        let aad = build_aad(DIR_BRIDGE_TO_AGENT, &header_bytes);
        let cipher = Aes256Gcm::new_from_slice(&self.send_key)
            .map_err(|error| format!("aead key: {error}"))?;
        let ciphertext = cipher
            .encrypt(
                aes_gcm::Nonce::from_slice(&iv),
                Payload {
                    msg: &plain,
                    aad: &aad,
                },
            )
            .map_err(|_| "seal_failed".to_owned())?;
        Ok((header_bytes, ciphertext))
    }

    /// Open one received frame. The nonce is derived, never taken from the wire (crypto.js
    /// open explains why), and the whole cleartext header is the AAD.
    fn open(&mut self, frame: &Frame) -> Result<Value, String> {
        if frame.kind() != "enc" {
            return Err("not_encrypted".to_owned());
        }
        let epoch = frame.header.get("e").and_then(Value::as_u64).unwrap_or(0) as u32;
        if epoch != self.epoch {
            return Err(format!("unknown_epoch: {epoch}"));
        }
        let seq = frame
            .header
            .get("s")
            .and_then(Value::as_u64)
            .ok_or_else(|| "bad_seq".to_owned())?;
        if seq < 1 {
            return Err("bad_seq".to_owned());
        }
        if self.replay_verdict(seq) != "ok" {
            return Err(format!("stale_frame: seq={seq}"));
        }
        let iv = Self::iv(&self.recv_salt, seq);
        if frame.payload.len() < 16 {
            return Err("short_ciphertext".to_owned());
        }
        let aad = build_aad(DIR_AGENT_TO_BRIDGE, &frame.header_bytes);
        let cipher = Aes256Gcm::new_from_slice(&self.recv_key)
            .map_err(|error| format!("aead key: {error}"))?;
        let plain = cipher
            .decrypt(
                aes_gcm::Nonce::from_slice(&iv),
                Payload {
                    msg: &frame.payload,
                    aad: &aad,
                },
            )
            .map_err(|_| "auth_failed".to_owned())?;
        if plain.len() < 4 {
            return Err("malformed_plaintext".to_owned());
        }
        let body_len = u32::from_be_bytes([plain[0], plain[1], plain[2], plain[3]]) as usize;
        if 4 + body_len > plain.len() {
            return Err("malformed_plaintext".to_owned());
        }
        let body: Value = serde_json::from_slice(&plain[4..4 + body_len])
            .map_err(|_| "malformed_plaintext".to_owned())?;
        self.accept_replay(seq);
        Ok(body)
    }

    fn replay_verdict(&self, seq: u64) -> &'static str {
        if seq > self.recv_highest {
            return "ok";
        }
        let delta = self.recv_highest - seq;
        if delta >= 64 {
            return "too_old";
        }
        if self.recv_bitmap & (1u64 << delta) != 0 {
            return "replay";
        }
        "ok"
    }

    fn accept_replay(&mut self, seq: u64) {
        if seq > self.recv_highest {
            let shift = seq - self.recv_highest;
            self.recv_bitmap = if shift >= 64 {
                1
            } else {
                (self.recv_bitmap << shift) | 1
            };
            self.recv_highest = seq;
            return;
        }
        let delta = self.recv_highest - seq;
        if delta < 64 {
            self.recv_bitmap |= 1u64 << delta;
        }
    }

    /// Key confirmation for one side of the handshake (crypto.js handshakeConfirm).
    fn expected_confirm(&self, side: &str) -> [u8; 32] {
        hmac_sha256(
            &self.confirm_key,
            &[
                &lp(format!("{SESSION_MAGIC}/confirm").as_bytes()),
                &lp(&self.transcript_hash),
                &lp(side.as_bytes()),
            ],
        )
    }
}

// ---------------------------------------------------------------------------
// Status the screen shows
// ---------------------------------------------------------------------------

/// What a paired peer is, as the screen reports it.
#[derive(Debug, Clone)]
pub struct Paired {
    pub device_id: String,
    pub name: String,
    pub at_ms: u64,
}

/// The last request the bridge answered or refused.
#[derive(Debug, Clone)]
pub struct LastRequest {
    pub cap: String,
    pub op: String,
    pub target: String,
    pub ok: bool,
    pub detail: String,
    pub ms: u64,
    pub at_ms: u64,
}

/// Everything the phone's screen says about this service. One struct, one owner, and the
/// whole of it is also the JSON /__shell/bridge serves.
#[derive(Debug, Clone)]
pub struct Status {
    pub phase: String,
    pub address: String,
    pub pairing_code: String,
    pub attempts_left: u32,
    pub paired: Option<Paired>,
    pub last: Option<LastRequest>,
    pub served: u64,
    pub refused: u64,
    pub note: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            phase: "stopped".to_owned(),
            address: String::new(),
            pairing_code: String::new(),
            attempts_left: PAIRING_MAX_ATTEMPTS,
            paired: None,
            last: None,
            served: 0,
            refused: 0,
            note: None,
        }
    }
}

impl Status {
    fn wire(&self) -> Value {
        json!({
            "phase": self.phase,
            "address": self.address,
            "pairingCode": self.pairing_code,
            "attemptsLeft": self.attempts_left,
            "paired": self.paired.as_ref().map(|paired| json!({
                "deviceId": paired.device_id,
                "name": paired.name,
                "at": paired.at_ms,
            })),
            "last": self.last.as_ref().map(|last| json!({
                "cap": last.cap,
                "op": last.op,
                "target": last.target,
                "ok": last.ok,
                "detail": last.detail,
                "ms": last.ms,
                "at": last.at_ms,
            })),
            "served": self.served,
            "refused": self.refused,
            "note": self.note,
        })
    }
}

/// The service's status, published for the window's own page.
static STATUS: OnceLock<Arc<Mutex<Status>>> = OnceLock::new();

fn shared_status() -> Arc<Mutex<Status>> {
    STATUS
        .get_or_init(|| Arc::new(Mutex::new(Status::default())))
        .clone()
}

/// The JSON /__shell/bridge serves, or a refusal that names its own reason.
pub fn status_json() -> String {
    let Some(status) = STATUS.get() else {
        // Never started on this build (every desktop, and an Android run whose launcher
        // path has not reached the bridge yet). Not a refusal: nothing asked for work.
        return json!({ "phase": "stopped" }).to_string();
    };
    let wire = match status.lock() {
        Ok(guard) => guard.wire(),
        Err(poisoned) => poisoned.into_inner().wire(),
    };
    wire.to_string()
}

fn update_status(mutate: impl FnOnce(&mut Status)) {
    let status = shared_status();
    let mut guard = match status.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    mutate(&mut guard);
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/// How the bridge end is configured. There is deliberately no write flag: this slice is
/// read-only, and a grant that cannot be turned on is not a setting.
#[derive(Debug, Clone)]
pub struct Config {
    /// Port to listen on, on every interface.
    pub port: u16,
    /// Directories a peer may read. Anything else is path-denied.
    pub roots: Vec<PathBuf>,
    /// Name this device shows to the host; the device id is the stable part.
    pub device_name: String,
    /// Where the device's own identity is kept. None keeps it in memory for this run.
    pub state_dir: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 47600,
            roots: vec![PathBuf::from("/sdcard")],
            device_name: "DSH Link (Android)".to_owned(),
            state_dir: None,
        }
    }
}

/// The app handle, for the ONE operation that has to reach the phone own page instead of the filesystem.
///
/// R332: `media.capture` is executed by the WebView (it is the only place `getUserMedia` exists), so the bridge evals a
/// self-contained script into the window and waits for the capture route to answer. Installed by `lib.rs` before the
/// bridge starts; a bridge that runs without it answers the op with a named refusal rather than pretending.
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Hand the app handle to the bridge (called once, from the application boot).
pub fn install_app(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

/// The script the phone page runs to capture audio and post it to the capture route.
///
/// Self-contained on purpose: the bridge does not rely on the page having shipped a listener, so the same bytes work on
/// any page the app displays. It posts with `x-dsh-capture-id`, which is what makes the route answer the waiting op.
const CAPTURE_SCRIPT: &str = r#"(function () {
  var id = window.__dshCaptureId
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm'
    var recorder = new MediaRecorder(stream, { mimeType: mime })
    var chunks = []
    recorder.ondataavailable = function (event) { if (event.data && event.data.size > 0) chunks.push(event.data) }
    recorder.onstop = function () {
      stream.getTracks().forEach(function (track) { track.stop() })
      var blob = new Blob(chunks, { type: 'audio/webm' })
      blob.arrayBuffer().then(function (buffer) {
        // The digest travels with the bytes so the host can compare what it reads back against what the page posted.
        // crypto.subtle is available because this page is a secure context (measured R330).
        return crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
          var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) { return ('0' + b.toString(16)).slice(-2) }).join('')
          var headers = { 'content-type': 'audio/webm', 'x-dsh-capture-kind': 'audio/webm', 'x-dsh-capture-id': id, 'x-dsh-capture-sha256': hex }
          return fetch('/__shell/capture', { method: 'POST', headers: headers, body: buffer })
        })
      }).then(function (answer) { return answer.text() }).catch(function (error) {
        return fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'capture failed: ' + String(error) })
      })
    }
    recorder.start()
    setTimeout(function () { recorder.stop() }, window.__dshCaptureMs | 0)
  }).catch(function (error) {
    fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'mic refused: ' + String(error && error.name) })
  })
})()"#;

/// The script the phone page runs to take ONE still picture and post it to the capture route.
///
/// R380: the same shape as the audio script and the same reason - the WebView is the only place `getUserMedia` exists,
/// so the bridge evals a self-contained script and waits for the route to answer. A still frame rather than a stream
/// keeps the phone side to what the device net can already carry: one file, written where `fs.read` can pick it up.
/// `playsinline` + a muted element are what let `play()` resolve without a user gesture (the page was never clicked).
const PHOTO_SCRIPT: &str = r#"(function () {
  var id = window.__dshCaptureId
  navigator.mediaDevices.getUserMedia({ video: true }).then(function (stream) {
    var video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.muted = true
    video.srcObject = stream
    var stop = function () { stream.getTracks().forEach(function (track) { track.stop() }) }
    var shoot = function () {
      try {
        var w = video.videoWidth | 0
        var h = video.videoHeight | 0
        if (w === 0 || h === 0) {
          stop()
          fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'camera produced an empty frame (' + w + 'x' + h + ')' })
          return
        }
        var canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(video, 0, 0, w, h)
        stop()
        canvas.toBlob(function (blob) {
          if (blob === null) {
            fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'camera encoded no blob' })
            return
          }
          blob.arrayBuffer().then(function (buffer) {
            return crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
              var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) { return ('0' + b.toString(16)).slice(-2) }).join('')
              // The size travels with the bytes: a caller can tell a real frame from a black one before reading it back.
              var headers = { 'content-type': 'image/jpeg', 'x-dsh-capture-kind': 'image/jpeg', 'x-dsh-capture-id': id, 'x-dsh-capture-sha256': hex, 'x-dsh-capture-size': String(w) + 'x' + String(h) }
              return fetch('/__shell/capture', { method: 'POST', headers: headers, body: buffer })
            })
          }).then(function (answer) { return answer.text() }).catch(function (error) {
            return fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'photo post failed: ' + String(error) })
          })
        }, 'image/jpeg', 0.92)
      } catch (error) {
        stop()
        fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'photo failed: ' + String(error) })
      }
    }
    var ready = function () { setTimeout(shoot, 350) }
    if (video.readyState >= 2) { ready() } else { video.addEventListener('loadeddata', ready, { once: true }) }
    var played = video.play()
    if (played && typeof played.catch === 'function') { played.catch(function () { /* autoplay refusal is not fatal: loadeddata still fires */ }) }
  }).catch(function (error) {
    fetch('/__shell/capture', { method: 'POST', headers: { 'x-dsh-capture-id': id, 'content-type': 'text/plain' }, body: 'camera refused: ' + String(error && error.name) })
  })
})()"#;

/// A pairing window: the code, how many guesses are left, and the identity the bridge
/// presents.
struct Context {
    config: Config,
    device_id: String,
    spki: Vec<u8>,
    fingerprint: String,
    code: String,
    attempts_left: Mutex<u32>,
    busy: Mutex<bool>,
    roots: Vec<PathBuf>,
}

impl Context {
    fn take_attempt(&self) -> bool {
        let mut left = match self.attempts_left.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if *left == 0 {
            return false;
        }
        *left -= 1;
        let remaining = *left;
        drop(left);
        update_status(|status| {
            status.attempts_left = remaining;
            status.note = if remaining == 0 {
                Some(
                    "every pairing attempt for this run has been used; restart the app for a new code"
                        .to_owned(),
                )
            } else {
                None
            };
        });
        true
    }

    fn restore_attempts(&self) {
        let mut left = match self.attempts_left.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *left = PAIRING_MAX_ATTEMPTS;
        drop(left);
        update_status(|status| {
            status.attempts_left = PAIRING_MAX_ATTEMPTS;
            status.note = None;
        });
    }
}

/// What one request produced: a JSON result, or the named code and detail a refusal
/// carries. Never an empty success.
struct Executed {
    ok: bool,
    value: Value,
    error: Option<(String, String)>,
}

fn refused(code: &str, detail: impl Into<String>) -> Executed {
    Executed {
        ok: false,
        value: Value::Null,
        error: Some((code.to_owned(), detail.into())),
    }
}

fn succeeded(value: Value) -> Executed {
    Executed {
        ok: true,
        value,
        error: None,
    }
}

/// Start the bridge end on this device.
///
/// The listener is bound on every interface so a peer on the LAN can reach it; on an
/// emulator the loopback forward (adb forward tcp:N tcp:N) reaches the same socket.
pub fn start(config: Config) -> Result<(), String> {
    let (device_id, spki) = load_identity(config.state_dir.as_deref());
    let fingerprint = fingerprint_of(&spki);
    let code = pairing_code();
    let roots: Vec<PathBuf> = config
        .roots
        .iter()
        .filter_map(|root| match std::fs::canonicalize(root) {
            Ok(canonical) => Some(canonical),
            Err(error) => {
                eprintln!(
                    "[bridge] granted root {} is not readable: {error}",
                    root.display()
                );
                None
            }
        })
        .collect();
    if roots.is_empty() {
        update_status(|status| {
            status.phase = "failed".to_owned();
            status.note = Some(format!(
                "no granted root could be opened ({:?}); a bridge with nothing to serve is not started",
                config.roots
            ));
        });
        return Err("no granted root".to_owned());
    }
    let context = Arc::new(Context {
        // The two strings are also printed below, so the context gets its own copies.
        device_id: device_id.clone(),
        spki,
        fingerprint: fingerprint.clone(),
        code,
        attempts_left: Mutex::new(PAIRING_MAX_ATTEMPTS),
        busy: Mutex::new(false),
        roots,
        config: config.clone(),
    });
    update_status(|status| {
        status.phase = "starting".to_owned();
        status.pairing_code = context.code.clone();
        status.attempts_left = PAIRING_MAX_ATTEMPTS;
        status.note = None;
    });

    let address = format!("0.0.0.0:{}", config.port);
    let listener = match std::net::TcpListener::bind(&address) {
        Ok(listener) => listener,
        Err(error) => {
            let note = format!("cannot listen on {address}: {error}");
            update_status(|status| {
                status.phase = "failed".to_owned();
                status.address = address.clone();
                status.note = Some(note.clone());
            });
            return Err(note);
        }
    };
    let actual = listener
        .local_addr()
        .map(|address| address.to_string())
        .unwrap_or_else(|_| address.clone());
    if let Err(error) = listener.set_nonblocking(true) {
        return Err(format!("non-blocking listener: {error}"));
    }
    update_status(|status| {
        status.phase = "listening".to_owned();
        status.address = actual.clone();
    });
    eprintln!(
        "[bridge] device bridge listening on {actual} (device {device_id}, fingerprint {fingerprint}), pairing code {}",
        context.code
    );

    std::thread::Builder::new()
        .name("dsh-device-bridge".to_owned())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("[bridge] cannot build a runtime: {error}");
                    update_status(|status| status.phase = "failed".to_owned());
                    return;
                }
            };
            runtime.block_on(async move {
                let listener = match TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(error) => {
                        eprintln!("[bridge] cannot adopt the listener: {error}");
                        update_status(|status| status.phase = "failed".to_owned());
                        return;
                    }
                };
                loop {
                    match listener.accept().await {
                        Ok((stream, peer)) => {
                            eprintln!("[bridge] connection from {peer}");
                            let context = context.clone();
                            tokio::spawn(async move {
                                let mut stream = stream;
                                if let Err(error) = serve(&mut stream, context.clone()).await {
                                    eprintln!("[bridge] session ended: {error}");
                                }
                            });
                        }
                        Err(error) => {
                            eprintln!("[bridge] accept failed: {error}");
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }
                    }
                }
            });
        })
        .map_err(|error| format!("spawn bridge thread: {error}"))?;
    Ok(())
}

/// A six-digit pairing code, drawn the way crypto.js generatePairingCode draws one.
fn pairing_code() -> String {
    let mut digits = String::new();
    for _ in 0..6 {
        // Rejection sampling over a byte: 250 is 25*10, so bytes below 250 are uniform.
        let byte = loop {
            let mut buffer = [0u8; 1];
            OsRng.fill_bytes(&mut buffer);
            if buffer[0] < 250 {
                break buffer[0];
            }
        };
        digits.push(char::from(b'0' + (byte % 10)));
    }
    digits
}

/// The device's long-term identity: a stable id and an Ed25519 public key (SPKI DER), kept
/// in the app's own directory when there is one. The seed is stored beside it for the
/// "trusted" path this slice does not implement yet; nothing reads it today.
fn load_identity(state_dir: Option<&Path>) -> (String, Vec<u8>) {
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    let mut suffix = [0u8; 4];
    OsRng.fill_bytes(&mut suffix);
    let fresh_id = format!("dsh-link-{}", base32(&suffix).to_lowercase());
    let Some(dir) = state_dir else {
        return (fresh_id, spki_from_seed(&seed));
    };
    let path = dir.join("device-bridge.json");
    if let Ok(document) = std::fs::read_to_string(&path) {
        if let Ok(value) = serde_json::from_str::<Value>(&document) {
            let device_id = value
                .get("deviceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let stored = value.get("seed").and_then(Value::as_str).and_then(unb64);
            if !device_id.is_empty() {
                if let Some(bytes) = stored {
                    if bytes.len() == 32 {
                        let mut seed = [0u8; 32];
                        seed.copy_from_slice(&bytes);
                        return (device_id, spki_from_seed(&seed));
                    }
                }
                return (device_id, spki_from_seed(&seed));
            }
        }
    }
    let document = json!({ "deviceId": fresh_id, "seed": b64(&seed) });
    if let Err(error) = std::fs::create_dir_all(dir) {
        eprintln!("[bridge] cannot create {}: {error}", dir.display());
    } else if let Err(error) = std::fs::write(&path, document.to_string()) {
        eprintln!("[bridge] cannot write {}: {error}", path.display());
    }
    (fresh_id, spki_from_seed(&seed))
}

fn spki_from_seed(seed: &[u8; 32]) -> Vec<u8> {
    let signing = ed25519_dalek::SigningKey::from_bytes(seed);
    let public = signing.verifying_key().to_bytes();
    let mut spki = Vec::with_capacity(44);
    spki.extend_from_slice(&ED25519_SPKI_PREFIX);
    spki.extend_from_slice(&public);
    spki
}

// ---------------------------------------------------------------------------
// One connection: handshake, pairing, then work
// ---------------------------------------------------------------------------

/// Negotiation, reproduced from link.js negotiate: majors must match, the agreed version is
/// the smaller maximum, capabilities and features are intersected.
fn negotiate(hello: &Value) -> Result<(String, Vec<String>, Vec<(&'static str, bool)>), String> {
    let remote = hello.get("proto").cloned().unwrap_or(Value::Null);
    let remote_min = remote.get("min").and_then(Value::as_str).unwrap_or(PROTOCOL_MIN);
    let remote_max = remote.get("max").and_then(Value::as_str).unwrap_or(PROTOCOL_MAX);
    let major = |version: &str| version.split('.').next().unwrap_or("").to_owned();
    if major(PROTOCOL_MIN) != major(remote_min) || major(PROTOCOL_MIN) != major(remote_max) {
        return Err(format!(
            "version_incompatible: major mismatch local={PROTOCOL_MIN}-{PROTOCOL_MAX} remote={remote_min}-{remote_max}"
        ));
    }
    let agree_max = if version_cmp(PROTOCOL_MAX, remote_max) <= 0 {
        PROTOCOL_MAX
    } else {
        remote_max
    };
    let need_max = if version_cmp(PROTOCOL_MIN, remote_min) >= 0 {
        PROTOCOL_MIN
    } else {
        remote_min
    };
    if version_cmp(agree_max, need_max) < 0 {
        return Err(format!(
            "version_incompatible: no overlap local={PROTOCOL_MIN}-{PROTOCOL_MAX} remote={remote_min}-{remote_max}"
        ));
    }
    let remote_caps: Vec<String> = hello
        .get("caps")
        .and_then(Value::as_array)
        .map(|caps| {
            caps.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let caps: Vec<String> = CAPABILITIES
        .iter()
        .filter(|cap| remote_caps.iter().any(|remote| remote == *cap))
        .map(|cap| (*cap).to_owned())
        .collect();
    let remote_features = hello.get("features").and_then(Value::as_object);
    let features: Vec<(&'static str, bool)> = FEATURES
        .iter()
        .filter(|(name, _)| remote_features.is_some_and(|map| map.contains_key(*name)))
        .map(|(name, ours)| {
            let theirs = remote_features
                .and_then(|map| map.get(*name))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            (*name, *ours && theirs)
        })
        .collect();
    Ok((agree_max.to_owned(), caps, features))
}

/// Dotted numeric comparison, link.js compareVersions.
fn version_cmp(left: &str, right: &str) -> i32 {
    let parse = |text: &str| -> Vec<u32> {
        text.split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let a = parse(left);
    let b = parse(right);
    let len = a.len().max(b.len());
    for index in 0..len {
        let x = a.get(index).copied().unwrap_or(0);
        let y = b.get(index).copied().unwrap_or(0);
        if x != y {
            return if x < y { -1 } else { 1 };
        }
    }
    0
}

/// The canonical form of the negotiated set, which both sides hash into the transcript.
fn negotiated_json(version: &str, caps: &[String], features: &[(&'static str, bool)]) -> Value {
    let mut feature_map = serde_json::Map::new();
    for (name, value) in features {
        feature_map.insert((*name).to_owned(), Value::Bool(*value));
    }
    json!({
        "p": version,
        "c": caps,
        "f": Value::Object(feature_map),
    })
}

async fn serve(stream: &mut TcpStream, context: Arc<Context>) -> Result<(), String> {
    // One session at a time; a second connection is refused rather than queued, so the
    // screen never claims to be paired with two hosts at once.
    // The guard is taken and released twice, never across an await: a std Mutex guard is
    // not Send, so holding one while the connection is awaited would make this future
    // unable to run on the executor at all.
    let already_busy = match context.busy.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    };
    if already_busy {
        let _ = write_cleartext(
            stream,
            &json!({
                "t": "err",
                "code": "busy",
                "detail": "this bridge already has a session",
            }),
        )
        .await;
        return Err("busy".to_owned());
    }
    match context.busy.lock() {
        Ok(mut guard) => *guard = true,
        Err(poisoned) => *poisoned.into_inner() = true,
    }
    let outcome = session(stream, context.clone()).await;
    {
        let mut busy = match context.busy.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *busy = false;
    }
    outcome
}

async fn session(stream: &mut TcpStream, context: Arc<Context>) -> Result<(), String> {
    // ---- hello ------------------------------------------------------------
    let hello_frame = read_frame(stream).await?;
    if hello_frame.kind() != "hello" {
        return Err(format!(
            "unexpected_message: {} while waiting for hello",
            hello_frame.kind()
        ));
    }
    let hello = hello_frame.header.clone();
    if hello.get("m").and_then(Value::as_str) != Some(PROTO_MAGIC) {
        return Err("protocol_mismatch".to_owned());
    }
    let peer_device_id = hello
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or_else(|| "bad_hello: deviceId".to_owned())?
        .to_owned();
    let peer_name = hello.get("name").and_then(Value::as_str).unwrap_or("").to_owned();
    let peer_nonce = hello
        .get("nonce")
        .and_then(Value::as_str)
        .ok_or_else(|| "bad_hello: nonce".to_owned())?
        .to_owned();
    let peer_eph = hello
        .get("eph")
        .and_then(Value::as_str)
        .ok_or_else(|| "bad_hello: eph".to_owned())?
        .to_owned();
    let peer_kb = hello.get("kb").and_then(Value::as_str).unwrap_or("").to_owned();
    if peer_kb.is_empty() {
        return Err("bad_hello: kb".to_owned());
    }
    let session_id = hello
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "bad_hello: sessionId".to_owned())?
        .to_owned();
    let peer_fp = hello.get("fp").and_then(Value::as_str).unwrap_or("").to_owned();

    let (version, caps, features) = negotiate(&hello)?;
    let pairing_open = *match context.attempts_left.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    } > 0;

    // ---- hello_ack --------------------------------------------------------
    let private = random_scalar();
    let ephemeral = ProjectivePoint::GENERATOR * private;
    let own_eph = b64(&encode_point(&ephemeral));
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let own_nonce = b64(&nonce);
    let pair_id = {
        let mut raw = [0u8; 8];
        OsRng.fill_bytes(&mut raw);
        raw.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    };
    let mut ack = json!({
        "t": "hello_ack",
        "m": PROTO_MAGIC,
        "proto": { "min": PROTOCOL_MIN, "max": PROTOCOL_MAX },
        "app": "dsh-link-android",
        "caps": caps,
        "features": {
            "streamCredit": true, "rekey": true, "cancel": true,
            "pathRoots": true, "auditStream": false,
        },
        "deviceId": context.device_id,
        "name": context.config.device_name,
        "role": "bridge",
        "sessionId": session_id,
        "nonce": own_nonce,
        "eph": own_eph,
        "kb": b64(&context.spki),
        "fp": context.fingerprint,
        "authMode": if pairing_open { "pake" } else { "none" },
        "ts": now_ms(),
    });
    if pairing_open {
        ack["pairId"] = Value::String(pair_id.clone());
        ack["pairContext"] = Value::String(pair_id.clone());
    }
    write_cleartext(stream, &ack).await?;
    if !pairing_open {
        let _ = write_cleartext(
            stream,
            &json!({
                "t": "err",
                "code": "pairing_closed",
                "detail": "no pairing window is open on the bridge",
            }),
        )
        .await;
        return Err("pairing_closed".to_owned());
    }

    // ---- transcript -------------------------------------------------------
    let negotiated = negotiated_json(&version, &caps, &features);
    let mut transcript = Vec::new();
    lp_into(&mut transcript, SESSION_MAGIC.as_bytes());
    lp_into(&mut transcript, session_id.as_bytes());
    lp_into(&mut transcript, version.as_bytes());
    lp_into(&mut transcript, peer_device_id.as_bytes());
    lp_into(&mut transcript, context.device_id.as_bytes());
    lp_into(&mut transcript, peer_nonce.as_bytes());
    lp_into(&mut transcript, own_nonce.as_bytes());
    lp_into(&mut transcript, peer_eph.as_bytes());
    lp_into(&mut transcript, own_eph.as_bytes());
    lp_into(&mut transcript, peer_fp.as_bytes());
    lp_into(&mut transcript, context.fingerprint.as_bytes());
    lp_into(&mut transcript, canonical_json(&negotiated).as_bytes());
    let transcript_hash = sha256(&[&transcript]);

    let peer_point = decode_point(&unb64(&peer_eph).ok_or_else(|| "bad_hello: eph".to_owned())?)
        .ok_or_else(|| "bad_hello: eph is not a curve point".to_owned())?;
    let shared = ecdh_shared_secret(&private, &peer_point);

    // ---- pairing (SPAKE2 with the code on this screen) --------------------
    if !context.take_attempt() {
        let _ = write_cleartext(
            stream,
            &json!({ "t": "err", "code": "pairing_failed", "detail": "pairing unavailable" }),
        )
        .await;
        return Err("pairing_unavailable".to_owned());
    }
    let mut spake = Spake2::responder(
        &context.code,
        pair_id.as_bytes(),
        &peer_device_id,
        &context.device_id,
    )
    .ok_or_else(|| "pairing_code_empty".to_owned())?;
    let our_share = spake.start();
    let begin = read_frame(stream).await?;
    if begin.kind() != "pair_begin" {
        return Err(format!(
            "unexpected_message: {} while waiting for pair_begin",
            begin.kind()
        ));
    }
    let peer_share = begin
        .text("x")
        .and_then(unb64)
        .ok_or_else(|| "pair_begin without a share".to_owned())?;
    spake.finish(&peer_share)?;
    write_cleartext(stream, &json!({ "t": "pair_reply", "y": b64(&our_share) })).await?;
    let finish = read_frame(stream).await?;
    if finish.kind() != "pair_finish" {
        return Err(format!(
            "unexpected_message: {} while waiting for pair_finish",
            finish.kind()
        ));
    }
    let peer_tag = finish.text("tag").and_then(unb64).unwrap_or_default();
    if !spake.verify_peer(&peer_tag) {
        // One generic refusal: a wrong code and a malformed share must look the same.
        let _ = write_cleartext(
            stream,
            &json!({ "t": "err", "code": "pairing_failed", "detail": "pairing failed" }),
        )
        .await;
        return Err("pairing_failed".to_owned());
    }
    let psk = spake.psk.ok_or_else(|| "pairing_failed".to_owned())?;
    let confirm_out = spake.confirm_out.ok_or_else(|| "pairing_failed".to_owned())?;
    write_cleartext(
        stream,
        &json!({
            "t": "pair_result",
            "ok": true,
            "tag": b64(&confirm_out),
            "trusted": true,
        }),
    )
    .await?;
    context.restore_attempts();

    // ---- keys and key confirmation ---------------------------------------
    let prk = {
        let salt = sha256(&[&lp(format!("{KDF_MAGIC}/salt").as_bytes()), &transcript]);
        let mut ikm = shared.to_vec();
        ikm.extend_from_slice(&psk);
        hkdf_extract(&salt, &ikm)
    };
    let mut channel = Channel::new(&prk, transcript_hash);
    let finish_frame = read_frame(stream).await?;
    if finish_frame.kind() != "finish" {
        return Err(format!(
            "unexpected_message: {} while waiting for finish",
            finish_frame.kind()
        ));
    }
    let agent_tag = finish_frame.text("tag").and_then(unb64).unwrap_or_default();
    if !constant_time_eq(&agent_tag, &channel.expected_confirm("agent")) {
        let _ = write_cleartext(
            stream,
            &json!({ "t": "err", "code": "finish_failed", "detail": "key confirmation mismatch" }),
        )
        .await;
        return Err("finish_failed".to_owned());
    }
    let bridge_tag = channel.expected_confirm("bridge");
    write_cleartext(stream, &json!({ "t": "finish_ok", "tag": b64(&bridge_tag) })).await?;

    update_status(|status| {
        status.phase = "paired".to_owned();
        status.paired = Some(Paired {
            device_id: peer_device_id.clone(),
            name: if peer_name.is_empty() {
                peer_device_id.clone()
            } else {
                peer_name.clone()
            },
            at_ms: now_ms(),
        });
        status.note = None;
    });
    eprintln!(
        "[bridge] paired with {} [{}] over protocol v{version} (caps: {})",
        if peer_name.is_empty() {
            &peer_device_id
        } else {
            &peer_name
        },
        peer_device_id,
        caps.join(", ")
    );

    // ---- work -------------------------------------------------------------
    loop {
        let frame = match read_frame(stream).await {
            Ok(frame) => frame,
            Err(error) => {
                update_status(|status| status.phase = "listening".to_owned());
                return Err(error);
            }
        };
        let body = channel.open(&frame)?;
        match body.get("t").and_then(Value::as_str).unwrap_or("") {
            "req" => answer_request(stream, &mut channel, &context, &body).await?,
            "ping" => {
                let pong =
                    json!({ "t": "pong", "n": body.get("n").cloned().unwrap_or(Value::Null) });
                let (header_bytes, ciphertext) = channel.seal(&pong, &[])?;
                write_frame(stream, &header_bytes, &ciphertext).await?;
            }
            "cancel" => { /* a request already answered; nothing to unwind */ }
            other => eprintln!("[bridge] ignoring message type {other:?}"),
        }
    }
}

/// Serve one req. Every branch either produces a result or a **named** refusal.
async fn answer_request(
    stream: &mut TcpStream,
    channel: &mut Channel,
    context: &Arc<Context>,
    body: &Value,
) -> Result<(), String> {
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let cap = body.get("cap").and_then(Value::as_str).unwrap_or("").to_owned();
    let op = body.get("op").and_then(Value::as_str).unwrap_or("").to_owned();
    let args = body.get("args").cloned().unwrap_or_else(|| json!({}));
    let target = args
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let started = now_ms();
    let outcome = match (cap.as_str(), op.as_str()) {
        ("fs.list", "list") => fs_list(context, &args),
        ("fs.read", "read") => fs_read(context, &args),
        ("sys.info", "info") => sys_info(context),
        ("sys.info", "devices") => sys_devices(context),
        ("sys.info", "grant") => sys_grant(context),
        ("media.capture", "record") => capture_audio(&args).await,
        ("media.capture", "photo") => capture_photo(&args).await,
        (cap, _) if REFUSED_CAPABILITIES.contains(&cap) => {
            // The same sentence the shell already uses for an Android seam it still owes.
            refused("reserved", super::mobile::reserved(cap))
        }
        _ => refused("unsupported", format!("no handler for {cap}/{op}")),
    };
    let elapsed = now_ms().saturating_sub(started);
    let response = match (&outcome.error, outcome.ok) {
        (Some((code, detail)), false) => json!({
            "t": "res",
            "id": id,
            "ok": false,
            "error": { "code": code, "detail": detail },
        }),
        _ => json!({
            "t": "res",
            "id": id,
            "ok": true,
            "result": outcome.value,
            "meta": { "ms": elapsed },
        }),
    };
    let (header_bytes, ciphertext) = channel.seal(&response, &[])?;
    write_frame(stream, &header_bytes, &ciphertext).await?;
    update_status(|status| {
        status.last = Some(LastRequest {
            cap: cap.clone(),
            op: op.clone(),
            target: target.clone(),
            ok: outcome.ok,
            detail: match &outcome.error {
                Some((code, detail)) => format!("{code}: {detail}"),
                None => String::new(),
            },
            ms: elapsed,
            at_ms: started,
        });
        if outcome.ok {
            status.served += 1;
        } else {
            status.refused += 1;
        }
    });
    eprintln!(
        "[bridge] {cap}/{op} {target} -> {} ({elapsed} ms)",
        match &outcome.error {
            Some((code, detail)) => format!("{code}: {detail}"),
            None => "ok".to_owned(),
        }
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The two operations this build serves
// ---------------------------------------------------------------------------

/// Resolve a peer's path against the granted roots, read-only.
///
/// realpath first, then a separator-aware prefix comparison - the same shape the host's own
/// policy uses - so "..", a symlink pointing out and an absolute path outside the grant all
/// land on the same answer: path-denied.
fn resolve_path(context: &Context, given: &str) -> Result<PathBuf, (String, String)> {
    if given.is_empty() {
        return Err((
            "bad-arg".to_owned(),
            "path must be a non-empty string".to_owned(),
        ));
    }
    let requested = if Path::new(given).is_absolute() {
        PathBuf::from(given)
    } else {
        match context.roots.first() {
            Some(root) => root.join(given),
            None => {
                return Err((
                    "not-granted".to_owned(),
                    "no directory root is granted".to_owned(),
                ))
            }
        }
    };
    let canonical = std::fs::canonicalize(&requested).map_err(|error| {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "not-found",
            io::ErrorKind::PermissionDenied => "path-denied",
            _ => "io",
        };
        (code.to_owned(), format!("{given}: {error}"))
    })?;
    if !context.roots.iter().any(|root| canonical.starts_with(root)) {
        return Err((
            "path-denied".to_owned(),
            format!("{given} is outside every directory this peer granted"),
        ));
    }
    Ok(canonical)
}


/// sys.info / info - who is on the other end of the link.
///
/// A host asks this to learn the peer and to PING it (`ping` is this op and nothing else, service.js:1582), so a
/// reserved answer here is what made a paired phone look unreachable. Only facts this platform really has are named:
/// `platform` is the constant this build runs on, `arch` comes from the compiler, and the roots are the directories
/// the shell was started with rather than a guess about the device tree.
fn sys_info(context: &Context) -> Executed {
    let name = context.config.device_name.clone();
    let roots: Vec<String> = context
        .roots
        .iter()
        .map(|root| root.to_string_lossy().to_string())
        .collect();
    succeeded(json!({
        "app": "dsh-link-android",
        "hostname": name,
        "name": name,
        "platform": "android",
        "arch": std::env::consts::ARCH,
        "deviceId": context.device_id,
        "role": "bridge",
        "roots": roots,
        "protocol": { "min": PROTOCOL_MIN, "max": PROTOCOL_MAX },
    }))
}



/// `media.capture` / `record` - the phone as a microphone, asked for over the wire.
///
/// The WebView is the only place `getUserMedia` exists, so this hands the phone own page a self-contained script and
/// waits for the capture route to answer. Until then nothing was listening, so the refusal names that plainly.
async fn capture_audio(args: &Value) -> Executed {
    let Some(app) = APP.get() else {
        return refused(
            "reserved",
            "this end cannot capture: the application handle was never installed, so there is no page to record from",
        );
    };
    let ms = args
        .get("ms")
        .and_then(Value::as_u64)
        .filter(|value| *value >= 250 && *value <= 60000)
        .unwrap_or(2000);
    // The trait has to be in scope: `get_webview_window` lives on `Manager`, and importing it at the top of a module of
    // this size would pull a wildcard of methods used in exactly one place.
    use tauri::Manager;
    let Some(window) = app.get_webview_window(crate::embed::window_label()) else {
        return refused("unavailable", "the application has no page to capture from (no window with that label)");
    };
    let id = format!("cap-{}-{}", now_ms(), std::process::id());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    crate::core::capture::register(&id, sender);
    // The page reads the id and the duration off the window, then posts to the capture route with the id attached.
    let script = format!(
        "window.__dshCaptureId = {}; window.__dshCaptureMs = {}; {}",
        serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_owned()),
        ms,
        CAPTURE_SCRIPT
    );
    if let Err(error) = window.eval(&script) {
        crate::core::capture::forget(&id);
        return refused("unavailable", format!("the page did not accept the capture script: {error}"));
    }
    // Bounded wait: the recording itself plus a margin for the page to encode and post it.
    let deadline = std::time::Duration::from_millis(ms + 8000);
    match tokio::time::timeout(deadline, receiver).await {
        Ok(Ok(Ok(value))) => succeeded(value),
        Ok(Ok(Err(error))) => refused("capture-failed", error),
        Ok(Err(_)) => {
            crate::core::capture::forget(&id);
            refused("capture-failed", "the capture waiter was dropped before the page answered")
        }
        Err(_) => {
            crate::core::capture::forget(&id);
            refused(
                "timeout",
                format!("the page produced no capture within {ms} ms + 8 s (is the microphone granted?)"),
            )
        }
    }
}

/// `media.capture` / `photo` - the phone as a camera, asked for over the wire.
///
/// R380: one still frame, for the same reason the audio op exists: only the phone has the sensor, and only its WebView
/// has `getUserMedia`. The frame is written by the SAME capture route (it already knows `image/jpeg`), so the host reads
/// it back with the `fs.read` it already has. The refusal names the camera permission, because "no capture" and "the
/// camera was never granted" look identical from the host otherwise.
async fn capture_photo(args: &Value) -> Executed {
    let Some(app) = APP.get() else {
        return refused(
            "reserved",
            "this end cannot take a picture: the application handle was never installed, so there is no page to shoot from",
        );
    };
    // The one knob: how long the page may take to reach a frame. A cold camera start on this emulator measured ~1 s;
    // the floor keeps a caller from asking for something impossible, the ceiling keeps the op from hanging a link.
    let wait_ms = args
        .get("ms")
        .and_then(Value::as_u64)
        .filter(|value| *value >= 250 && *value <= 30000)
        .unwrap_or(4000);
    use tauri::Manager;
    let Some(window) = app.get_webview_window(crate::embed::window_label()) else {
        return refused("unavailable", "the application has no page to shoot from (no window with that label)");
    };
    let id = format!("photo-{}-{}", now_ms(), std::process::id());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    crate::core::capture::register(&id, sender);
    let script = format!(
        "window.__dshCaptureId = {}; {}",
        serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_owned()),
        PHOTO_SCRIPT
    );
    if let Err(error) = window.eval(&script) {
        crate::core::capture::forget(&id);
        return refused("unavailable", format!("the page did not accept the photo script: {error}"));
    }
    // The camera itself plus an encode and a post: the same 8 s margin the audio op takes.
    let deadline = std::time::Duration::from_millis(wait_ms + 8000);
    match tokio::time::timeout(deadline, receiver).await {
        Ok(Ok(Ok(value))) => succeeded(value),
        Ok(Ok(Err(error))) => refused("capture-failed", error),
        Ok(Err(_)) => {
            crate::core::capture::forget(&id);
            refused("capture-failed", "the photo waiter was dropped before the page answered")
        }
        Err(_) => {
            crate::core::capture::forget(&id);
            refused(
                "timeout",
                format!("the page produced no frame within {wait_ms} ms + 8 s (is CAMERA granted to this app?)"),
            )
        }
    }
}

/// sys.info / grant - the table a peer must obey when it calls this device.
///
/// R324: the host reads this right after a link comes up (`session.request("sys.info","grant")`), and without an answer
/// its `grant` for the peer stays empty - which is why a self test against the phone reported "the peer granted no
/// directory root" and skipped `fs.list`/`fs.read` on a device that had just told us `roots: ["/storage/emulated/0"]`.
/// The shape is the same one the host answers with (service.js), so a phone link and a desktop link are read the same
/// way: roots, three booleans, and nothing this build cannot honour (write and shell are false on Android by design).
fn sys_grant(context: &Context) -> Executed {
    let roots: Vec<String> = context
        .roots
        .iter()
        .map(|root| root.to_string_lossy().to_string())
        .collect();
    succeeded(json!({
        "grant": {
            "roots": roots,
            "write": false,
            "shell": false,
            "relay": false,
        },
        "deviceId": context.device_id,
        "name": context.config.device_name,
    }))
}
/// sys.info / devices - what this end can reach for a peer.
///
/// The phone is the slave half of the pair: it reaches no other device, so the list is empty and SAYS so instead of
/// being absent. The host has a defined answer for that shape (service.js relayTargets, R321: a connected link whose
/// peer announces nothing contributes the peer itself as a target), which is why an empty list here is the honest
/// value rather than a refusal.
fn sys_devices(context: &Context) -> Executed {
    succeeded(json!({
        "devices": [],
        "self": { "deviceId": context.device_id, "name": context.config.device_name, "role": "bridge" },
        "relay": { "maxHops": 0, "supported": false },
    }))
}
/// fs.list - one directory page, directories first, capped at 2000 entries, with the exact
/// value shape exec.js returns.
fn fs_list(context: &Context, args: &Value) -> Executed {
    let Some(given) = args.get("path").and_then(Value::as_str) else {
        return refused("bad-arg", "path must be a non-empty string");
    };
    let absolute = match resolve_path(context, given) {
        Ok(path) => path,
        Err((code, detail)) => return refused(&code, detail),
    };
    let entries = match std::fs::read_dir(&absolute) {
        Ok(entries) => entries,
        Err(error) => {
            let code = match error.kind() {
                io::ErrorKind::NotFound => "not-found",
                _ => "is-file",
            };
            return refused(code, format!("{given}: {error}"));
        }
    };
    let mut rows: Vec<(String, &'static str, bool, u64, i64)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = std::fs::symlink_metadata(entry.path()).ok();
        let kind = match metadata.as_ref().map(|meta| meta.file_type()) {
            Some(file_type) if file_type.is_dir() => "dir",
            Some(file_type) if file_type.is_file() => "file",
            Some(file_type) if file_type.is_symlink() => "link",
            _ => "other",
        };
        let size = metadata.as_ref().map(|meta| meta.len()).unwrap_or(0);
        let modified = metadata
            .as_ref()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        rows.push((name, kind, kind == "dir", size, modified));
    }
    rows.sort_by(|left, right| {
        // Directories first, then case-insensitive name order, then exact order - the
        // comparison exec.js uses.
        let by_kind = right.2.cmp(&left.2);
        if by_kind != std::cmp::Ordering::Equal {
            return by_kind;
        }
        let x = left.0.to_lowercase();
        let y = right.0.to_lowercase();
        x.cmp(&y).then_with(|| left.0.cmp(&right.0))
    });
    let truncated = rows.len() > LIST_MAX_ENTRIES;
    let entries: Vec<Value> = rows
        .into_iter()
        .take(LIST_MAX_ENTRIES)
        .map(|(name, kind, _is_dir, size, modified)| {
            json!({ "name": name, "type": kind, "size": size, "mtimeMs": modified })
        })
        .collect();
    succeeded(json!({ "path": given, "entries": entries, "truncated": truncated }))
}

/// fs.read - UTF-8 text, one-based line window, byte-capped, with the exact value shape
/// exec.js returns. A byte-capped read is not the file total, and truncated says so.
fn fs_read(context: &Context, args: &Value) -> Executed {
    let Some(given) = args.get("path").and_then(Value::as_str) else {
        return refused("bad-arg", "path must be a non-empty string");
    };
    let offset = match args.get("offset") {
        None | Some(Value::Null) => 1u64,
        Some(value) => match value.as_u64() {
            Some(number) if number >= 1 => number,
            _ => return refused("bad-arg", "offset must be an integer of at least 1"),
        },
    };
    let limit = match args.get("limit") {
        None | Some(Value::Null) => READ_DEFAULT_LIMIT,
        Some(value) => match value.as_u64() {
            Some(number) => number.min(READ_MAX_LIMIT as u64) as usize,
            None => return refused("bad-arg", "limit must be a number"),
        },
    };
    let absolute = match resolve_path(context, given) {
        Ok(path) => path,
        Err((code, detail)) => return refused(&code, detail),
    };
    let metadata = match std::fs::metadata(&absolute) {
        Ok(metadata) => metadata,
        Err(error) => {
            let code = match error.kind() {
                io::ErrorKind::NotFound => "not-found",
                io::ErrorKind::PermissionDenied => "path-denied",
                _ => "io",
            };
            return refused(code, format!("{given}: {error}"));
        }
    };
    if metadata.is_dir() {
        return refused("is-dir", format!("{given} is a directory, not a file"));
    }
    let take = metadata.len().min(MAX_READ_BYTES) as usize;
    let bytes = match read_capped(&absolute, take) {
        Ok(bytes) => bytes,
        Err((code, detail)) => return refused(&code, detail),
    };
    let trimmed = trim_partial_utf8(&bytes);
    let text = String::from_utf8_lossy(trimmed).into_owned();
    let line_count = split_lines(&text).len();
    let (content, taken) = line_window(&text, offset.saturating_sub(1), limit);
    let read_lines = offset.saturating_sub(1) + taken as u64;
    let truncated = (metadata.len() as usize) > bytes.len() || read_lines < line_count as u64;
    succeeded(json!({
        "path": given,
        "content": content,
        "offset": offset,
        "totalLines": line_count,
        "truncated": truncated,
    }))
}

fn read_capped(path: &Path, take: usize) -> Result<Vec<u8>, (String, String)> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|error| ("io".to_owned(), format!("{}: {error}", path.display())))?;
    let mut buffer = vec![0u8; take];
    let mut read = 0usize;
    while read < take {
        match file.read(&mut buffer[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(error) => {
                return Err(("io".to_owned(), format!("{}: {error}", path.display())))
            }
        }
    }
    buffer.truncate(read);
    Ok(buffer)
}

/// Drop a multi-byte sequence cut in half by the byte cap - exec.js trimPartialUtf8.
fn trim_partial_utf8(buffer: &[u8]) -> &[u8] {
    if buffer.is_empty() {
        return buffer;
    }
    let mut index = buffer.len() - 1;
    let mut steps = 0;
    while (buffer[index] & 0xc0) == 0x80 && steps < 3 {
        if index == 0 {
            return buffer;
        }
        index -= 1;
        steps += 1;
    }
    let lead = buffer[index];
    let expected = if lead >= 0xf0 {
        4
    } else if lead >= 0xe0 {
        3
    } else if lead >= 0xc0 {
        2
    } else {
        1
    };
    if buffer.len() - index < expected {
        &buffer[..index]
    } else {
        buffer
    }
}

/// Split text into lines, ignoring the empty tail a trailing newline produces.
fn split_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

/// The window taken as an exact substring, so no terminator is normalised away:
/// (text, lines taken), mirroring exec.js lineWindow.
fn line_window(text: &str, start_line: u64, limit: usize) -> (String, usize) {
    if limit == 0 {
        return (String::new(), 0);
    }
    let mut position = 0usize;
    let mut line = 0u64;
    while line < start_line {
        match text[position..].find('\n') {
            Some(offset) => {
                position += offset + 1;
                line += 1;
            }
            None => return (String::new(), 0),
        }
    }
    let mut end = position;
    let mut taken = 0usize;
    loop {
        if taken >= limit {
            break;
        }
        match text[end..].find('\n') {
            Some(offset) => {
                end += offset + 1;
                taken += 1;
            }
            None => {
                end = text.len();
                taken += 1;
                break;
            }
        }
    }
    (text[position..end].to_owned(), taken)
}

// ---------------------------------------------------------------------------
// Entry point the launcher path calls
// ---------------------------------------------------------------------------

/// Start the device bridge if this build should.
///
/// On Android the launcher path calls this once and the phone becomes the slave end of the
/// device net. On a desktop build nothing starts unless DSH_LINK_BRIDGE_ROOTS names the
/// directories to serve - the seam a proof run uses to drive the very same code locally,
/// without pretending a desktop is a phone.
///
/// Environment:
/// * DSH_LINK_BRIDGE_PORT - listen port (default 47600).
/// * DSH_LINK_BRIDGE_ROOTS - ";"-separated granted roots (Android default /sdcard).
/// * DSH_LINK_BRIDGE_NAME - the device name a host sees.
pub fn boot(state_dir: Option<&Path>) -> Result<(), String> {
    let port = match std::env::var("DSH_LINK_BRIDGE_PORT") {
        Ok(text) => text
            .trim()
            .parse::<u16>()
            .map_err(|error| format!("DSH_LINK_BRIDGE_PORT: {error}"))?,
        Err(_) => 47600,
    };
    let roots: Vec<PathBuf> = match std::env::var("DSH_LINK_BRIDGE_ROOTS") {
        Ok(text) if !text.trim().is_empty() => text
            .split(';')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(PathBuf::from)
            .collect(),
        _ => {
            if cfg!(target_os = "android") {
                vec![PathBuf::from("/sdcard")]
            } else {
                return Ok(()); // a desktop has no phone end to be
            }
        }
    };
    let name = std::env::var("DSH_LINK_BRIDGE_NAME")
        .unwrap_or_else(|_| "DSH Link (Android)".to_owned());
    start(Config {
        port,
        roots,
        device_name: name,
        state_dir: state_dir.map(Path::to_path_buf),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The group elements SPAKE2 stands on, pinned to the bytes the shipped crypto.js
    /// computes. If these two values ever differ, pairing with a real host can only fail,
    /// and this is the assertion that says so instead of leaving it to a handshake.
    #[test]
    fn the_spake2_points_match_the_shipped_implementation() {
        let (m, n) = spake2_points();
        assert_eq!(
            hex(&encode_point(m)),
            "027380ed2ef9263afa32f71f6e255d7821bc0f231f3c9bf6d719a123199e413d69",
            "M drifted from crypto.js spake2Points"
        );
        assert_eq!(
            hex(&encode_point(n)),
            "02c9ea3bf20edad28321744afaedac806da41cdc74fca80fe14e49114e4dfd721a",
            "N drifted from crypto.js spake2Points"
        );
    }

    /// The password scalar for a code and context, pinned the same way. This is the one
    /// derivation that silently breaks pairing when a byte order changes.
    #[test]
    fn the_password_scalar_matches_the_shipped_implementation() {
        let scalar = spake2_scalar("123456", b"ctx").expect("a code and a context derive a scalar");
        assert_eq!(
            hex(&scalar.to_bytes()),
            "8904fb18fd51994165305ab215b3fcbe0295eff70fea4aba4e17c81d73ae85c1"
        );
    }

    /// The context the two `sys.info` readings run against: the defaults a shell starts with.
    fn test_context() -> Context {
        Context {
            config: Config::default(),
            device_id: "test-device".to_owned(),
            spki: vec![0u8; 44],
            fingerprint: "0000".to_owned(),
            code: "000000".to_owned(),
            attempts_left: Mutex::new(PAIRING_MAX_ATTEMPTS),
            busy: Mutex::new(false),
            roots: vec![std::path::PathBuf::from("/sdcard")],
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// R322: the phone answers `sys.info` now, and answers it with facts rather than a refusal.
    ///
    /// Before this, a paired host asked who was on the other end, got "reserved: sys.info is not implemented on
    /// Android yet", and the host's self test and target refresh could never succeed against a phone. The readings
    /// here pin the two shapes the host actually consumes: `info` (hostname/platform/arch, which is also what `ping`
    /// is) and `devices` (an EMPTY list with a reason, which the host has a defined answer for).
    #[test]
    fn sys_info_answers_with_this_platform_and_no_invented_fields() {
        let context = test_context();
        let info = sys_info(&context);
        assert!(info.ok, "info must not be a refusal");
        assert_eq!(info.value["platform"], "android");
        assert_eq!(info.value["arch"], std::env::consts::ARCH);
        assert_eq!(info.value["deviceId"], context.device_id);
        assert_eq!(info.value["name"], context.config.device_name);
        assert_eq!(info.value["role"], "bridge");
        assert!(info.value["roots"].is_array(), "the roots are stated, not implied");
    }


    /// R324: the grant table a peer reads after a link comes up. Without it a paired phone looked like a device with
    /// nothing to offer, and the host skipped every read step of its own self test.
    #[test]
    fn sys_grant_states_the_roots_this_build_serves_and_what_it_refuses() {
        let context = test_context();
        let grant = sys_grant(&context);
        assert!(grant.ok, "a grant table is a fact, not a refusal");
        let roots = grant.value["grant"]["roots"].as_array().expect("roots is an array");
        assert_eq!(roots.len(), context.roots.len());
        assert_eq!(roots[0], "/sdcard", "the roots are the ones this shell was started with");
        assert_eq!(grant.value["grant"]["write"], false, "Android serves reads only");
        assert_eq!(grant.value["grant"]["shell"], false);
        assert_eq!(grant.value["grant"]["relay"], false);
        assert_eq!(grant.value["deviceId"], context.device_id);
    }
    #[test]
    fn sys_devices_is_an_empty_list_that_says_why_rather_than_a_refusal() {
        let context = test_context();
        let devices = sys_devices(&context);
        assert!(devices.ok, "an empty list is a fact, not a refusal");
        assert_eq!(devices.value["devices"].as_array().map(|rows| rows.len()), Some(0));
        assert_eq!(devices.value["self"]["deviceId"], context.device_id);
        assert_eq!(devices.value["relay"]["supported"], false);
    }

    #[test]
    fn sys_info_is_no_longer_a_refused_capability() {
        assert!(CAPABILITIES.contains(&"sys.info"), "the phone advertises sys.info");
        assert!(!REFUSED_CAPABILITIES.contains(&"sys.info"), "and no longer refuses it");
    }


    #[test]
    fn a_typed_code_is_normalised_the_way_the_host_normalises_it() {
        assert_eq!(normalize_code("123 456"), "123456");
        assert_eq!(normalize_code("12-34.56"), "123456");
        assert_eq!(normalize_code("OILU"), "011V");
    }

    #[test]
    fn the_line_window_preserves_terminators_and_refuses_beyond_the_end() {
        let text = "a\r\nb\nc\n";
        assert_eq!(line_window(text, 0, 1).0, "a\r\n");
        assert_eq!(line_window(text, 1, 2).0, "b\nc\n");
        assert_eq!(line_window(text, 9, 2).0, "");
        assert_eq!(line_window(text, 0, 0).1, 0);
        assert_eq!(split_lines(text).len(), 3);
    }

    #[test]
    fn a_cut_multibyte_sequence_is_trimmed_before_decoding() {
        let mut utf8 = "hello".as_bytes().to_vec();
        utf8.extend_from_slice("é".as_bytes());
        utf8.truncate(utf8.len() - 1); // the first half of a two-byte sequence
        assert_eq!(trim_partial_utf8(&utf8), b"hello");
    }

    #[test]
    fn versions_negotiate_the_way_the_host_negotiates_them() {
        assert_eq!(version_cmp("0.1", "0.2"), -1);
        assert_eq!(version_cmp("0.2", "0.2"), 0);
        let hello = json!({
            "proto": { "min": "0.1", "max": "0.2" },
            "caps": ["fs.read", "fs.write", "fs.list", "shell.exec", "sys.info", "process.spawn"],
            "features": {
                "streamCredit": true, "rekey": true, "cancel": true,
                "pathRoots": true, "auditStream": false,
            },
        });
        let (version, caps, features) = negotiate(&hello).expect("a full host negotiates");
        assert_eq!(version, "0.2");
        // R322: the phone advertises sys.info now, so the intersection with a full host carries it.
        assert_eq!(caps, vec!["fs.read".to_owned(), "fs.list".to_owned(), "sys.info".to_owned()]);
        assert_eq!(features.len(), 5);
        // The canonical form is what both sides hash, so pin its exact bytes.
        assert_eq!(
            canonical_json(&negotiated_json(&version, &caps, &features)),
            r#"{"c":["fs.read","fs.list","sys.info"],"f":{"auditStream":false,"cancel":true,"pathRoots":true,"rekey":true,"streamCredit":true},"p":"0.2"}"#
        );
    }

    #[test]
    fn a_path_outside_the_granted_roots_is_refused_by_name() {
        let root = std::env::temp_dir().join("dsh-bridge-test-roots");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("inside")).unwrap();
        std::fs::write(root.join("inside/note.txt"), "hello\n").unwrap();
        let outside = root.parent().unwrap().join("dsh-bridge-test-outside.txt");
        std::fs::write(&outside, "secret\n").unwrap();
        let context = Context {
            config: Config::default(),
            device_id: "test".to_owned(),
            spki: vec![0u8; 44],
            fingerprint: String::new(),
            code: "000000".to_owned(),
            attempts_left: Mutex::new(PAIRING_MAX_ATTEMPTS),
            busy: Mutex::new(false),
            roots: vec![std::fs::canonicalize(&root).unwrap()],
        };
        assert!(resolve_path(&context, "inside/note.txt").is_ok());
        assert_eq!(
            resolve_path(&context, "../dsh-bridge-test-outside.txt")
                .unwrap_err()
                .0,
            "path-denied"
        );
        assert_eq!(
            resolve_path(&context, outside.to_str().unwrap()).unwrap_err().0,
            "path-denied"
        );
        assert_eq!(
            resolve_path(&context, "inside/missing.txt").unwrap_err().0,
            "not-found"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }

    /// The proof this slice is judged by: a host driving this bridge with the *shipped* wire
    /// code (plugins/dsh-lan-bridge/lib/core/link.js + crypto.js) pairs with a code, lists a
    /// directory and reads a file - and is refused by name when it asks for something this
    /// build does not implement.
    ///
    /// Skipped (not failed) when node is not on PATH: the wire itself is still pinned by the
    /// known-answer tests above, and a missing interpreter is not a protocol failure.
    #[test]
    fn a_shipped_host_pairs_lists_and_reads_through_this_bridge() {
        let node = std::process::Command::new("node").arg("--version").output();
        if node.map(|output| !output.status.success()).unwrap_or(true) {
            eprintln!("skipping: node is not on PATH, so the shipped host cannot be run");
            return;
        }
        let root = std::env::temp_dir().join("dsh-bridge-live");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub")).expect("create the served root");
        std::fs::write(root.join("note.txt"), "alpha\nbeta\ngamma\n").expect("write a fixture");
        std::fs::write(root.join("sub/inner.txt"), "inner\n").expect("write a fixture");

        // A free port, then released: start() binds synchronously, so by the time it returns
        // the socket is listening and this race is closed.
        let port = {
            let probe = std::net::TcpListener::bind("127.0.0.1:0").expect("probe a port");
            probe.local_addr().expect("probe address").port()
        };
        start(Config {
            port,
            roots: vec![root.clone()],
            device_name: "dsh-bridge-test".to_owned(),
            state_dir: None,
        })
        .expect("the bridge starts");

        let code = match shared_status().lock() {
            Ok(status) => status.pairing_code.clone(),
            Err(poisoned) => poisoned.into_inner().pairing_code.clone(),
        };
        assert_eq!(code.len(), 6, "the phone shows a six-digit pairing code");

        let driver = crate::core::locator::dev_repo_root()
            .expect("the crate lives inside the repository")
            .join("tools/device-bridge/drive.mjs");
        assert!(driver.exists(), "the host driver is missing at {}", driver.display());
        let output = std::process::Command::new("node")
            .arg(&driver)
            .arg("--host").arg("127.0.0.1")
            .arg("--port").arg(port.to_string())
            .arg("--code").arg(&code)
            .arg("--list").arg(root.to_str().expect("a UTF-8 temp path"))
            .arg("--read").arg(root.join("note.txt").to_str().expect("a UTF-8 path"))
            .arg("--refuse").arg("fs.write")
            .output()
            .expect("run the shipped host driver");
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("--- host driver transcript ---\n{stdout}{stderr}--- end ---");
        assert!(
            output.status.success(),
            "the shipped host driver failed (exit {:?})",
            output.status.code()
        );
        assert!(stdout.contains("authMode=pake"), "the pairing code authenticated the session");
        assert!(
            stdout.contains("caps=fs.read,fs.list"),
            "the negotiated set is what this build serves"
        );
        assert!(stdout.contains("note.txt"), "the directory listing names the file");
        assert!(stdout.contains("alpha"), "the read returned the file's bytes");
        assert!(
            stdout.contains("reserved: fs.write is not implemented on Android yet"),
            "an unimplemented operation is refused by name"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
    /// An unimplemented capability refuses by name - the shell's own sentence - and never
    /// answers with an empty success.
    #[test]
    fn an_unimplemented_capability_refuses_by_name() {
        let outcome = refused("reserved", super::super::mobile::reserved("fs.write"));
        assert!(!outcome.ok);
        let (code, detail) = outcome.error.unwrap();
        assert_eq!(code, "reserved");
        assert!(detail.starts_with("reserved: fs.write"));
        assert!(detail.ends_with("is not implemented on Android yet"));
    }
}
