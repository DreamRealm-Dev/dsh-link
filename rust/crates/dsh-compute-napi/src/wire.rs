//! Fixed binary layouts for the byte-batched N-API entries.
//!
//! Two buffers cross the boundary, both little-endian and both with a four-byte magic so a
//! mismatched caller fails loudly instead of reinterpreting counters:
//!
//! ```text
//! append stats (32 bytes)
//!   0..4    "DSP1"
//!   4..8    u32 accepted      rows appended by this call
//!   8..12   u32 unparsable    lines of this call that were not JSON (never fatal)
//!   12..16  u32 version       index version after this call
//!   16..24  u64 records       total rows folded so far
//!   24..32  i64 lastSeq       highest explicit seq folded so far
//!
//! delta (32 bytes + parts)
//!   0..4    "DSD1"
//!   4..8    u32 fromVersion
//!   8..12   u32 toVersion
//!   12..20  u64 records       rows added after fromVersion
//!   20..28  i64 lastSeq       index lastSeq at toVersion
//!   28..32  u32 kindCount
//!   32..    kindCount × { u16 kindLen, kindBytes (UTF-8), u64 count }   sorted by kind
//! ```
//!
//! The consumers are the TypeScript reference (`plugins/dsh-link-compute/src/reference.ts`) and the
//! plugin binding, which decode the same layouts. The Rust `decode_*` helpers are test-only: they
//! keep the layout honest against the encoder (the cross-language agreement is asserted by
//! `rust/scripts/smoke.mjs`).

/// Magic of an append-stats buffer.
pub const APPEND_STATS_MAGIC: [u8; 4] = *b"DSP1";

/// Magic of a delta buffer.
pub const DELTA_MAGIC: [u8; 4] = *b"DSD1";

/// Size of an append-stats buffer.
pub const APPEND_STATS_LEN: usize = 32;

/// Header size of a delta buffer, before the per-kind parts.
pub const DELTA_HEADER_LEN: usize = 32;

/// The counters one byte-batched append reports back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppendStats {
    pub accepted: u32,
    pub unparsable: u32,
    pub version: u32,
    pub records: u64,
    pub last_seq: i64,
}

/// The values one delta buffer carries, decoded (used by the wire-layout tests).
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeltaView {
    pub from_version: u32,
    pub to_version: u32,
    pub records: u64,
    pub last_seq: i64,
    pub by_kind: Vec<(String, u64)>,
}

/// Encode append stats in the documented layout.
pub fn encode_append_stats(stats: &AppendStats) -> Vec<u8> {
    let mut out = Vec::with_capacity(APPEND_STATS_LEN);
    out.extend_from_slice(&APPEND_STATS_MAGIC);
    out.extend_from_slice(&stats.accepted.to_le_bytes());
    out.extend_from_slice(&stats.unparsable.to_le_bytes());
    out.extend_from_slice(&stats.version.to_le_bytes());
    out.extend_from_slice(&stats.records.to_le_bytes());
    out.extend_from_slice(&stats.last_seq.to_le_bytes());
    out
}

/// Decode an append-stats buffer, or `None` when it is not one.
#[cfg(test)]
pub fn decode_append_stats(bytes: &[u8]) -> Option<AppendStats> {
    if bytes.len() != APPEND_STATS_LEN || bytes[0..4] != APPEND_STATS_MAGIC {
        return None;
    }
    Some(AppendStats {
        accepted: u32::from_le_bytes(bytes[4..8].try_into().ok()?),
        unparsable: u32::from_le_bytes(bytes[8..12].try_into().ok()?),
        version: u32::from_le_bytes(bytes[12..16].try_into().ok()?),
        records: u64::from_le_bytes(bytes[16..24].try_into().ok()?),
        last_seq: i64::from_le_bytes(bytes[24..32].try_into().ok()?),
    })
}

/// Encode a delta in the documented layout.
///
/// @param from_version - the cursor the caller already has.
/// @param to_version - the index version this delta reflects.
/// @param records - rows added after `from_version`.
/// @param last_seq - the index lastSeq at `to_version`.
/// @param by_kind - per-kind counts, in ascending kind order.
/// @returns the delta bytes.
pub fn encode_delta(
    from_version: u32,
    to_version: u32,
    records: u64,
    last_seq: i64,
    by_kind: &[(String, u64)],
) -> Result<Vec<u8>, String> {
    let kind_count = u32::try_from(by_kind.len())
        .map_err(|_| "COMPUTE_SERIALIZE: too many kinds for one delta".to_string())?;
    let payload_len: usize = by_kind.iter().map(|(kind, _)| 2 + kind.len() + 8).sum();
    let mut out = Vec::with_capacity(DELTA_HEADER_LEN + payload_len);
    out.extend_from_slice(&DELTA_MAGIC);
    out.extend_from_slice(&from_version.to_le_bytes());
    out.extend_from_slice(&to_version.to_le_bytes());
    out.extend_from_slice(&records.to_le_bytes());
    out.extend_from_slice(&last_seq.to_le_bytes());
    out.extend_from_slice(&kind_count.to_le_bytes());
    for (kind, count) in by_kind {
        let len = u16::try_from(kind.len()).map_err(|_| {
            format!("COMPUTE_SERIALIZE: kind too long for the delta layout: {kind}")
        })?;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(kind.as_bytes());
        out.extend_from_slice(&count.to_le_bytes());
    }
    Ok(out)
}

/// Decode a delta buffer, or `None` when it is not one.
#[cfg(test)]
pub fn decode_delta(bytes: &[u8]) -> Option<DeltaView> {
    if bytes.len() < DELTA_HEADER_LEN || bytes[0..4] != DELTA_MAGIC {
        return None;
    }
    let from_version = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
    let to_version = u32::from_le_bytes(bytes[8..12].try_into().ok()?);
    let records = u64::from_le_bytes(bytes[12..20].try_into().ok()?);
    let last_seq = i64::from_le_bytes(bytes[20..28].try_into().ok()?);
    let kind_count = u32::from_le_bytes(bytes[28..32].try_into().ok()?) as usize;
    let mut by_kind = Vec::with_capacity(kind_count);
    let mut at = DELTA_HEADER_LEN;
    for _ in 0..kind_count {
        let len_bytes = bytes.get(at..at + 2)?;
        let len = u16::from_le_bytes(len_bytes.try_into().ok()?) as usize;
        at += 2;
        let kind_bytes = bytes.get(at..at + len)?;
        let kind = String::from_utf8(kind_bytes.to_vec()).ok()?;
        at += len;
        let count_bytes = bytes.get(at..at + 8)?;
        let count = u64::from_le_bytes(count_bytes.try_into().ok()?);
        at += 8;
        by_kind.push((kind, count));
    }
    if at != bytes.len() {
        return None;
    }
    Some(DeltaView {
        from_version,
        to_version,
        records,
        last_seq,
        by_kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_stats_round_trip() {
        let stats = AppendStats {
            accepted: 500,
            unparsable: 2,
            version: 7,
            records: 10_000,
            last_seq: 9_998,
        };
        let bytes = encode_append_stats(&stats);
        assert_eq!(bytes.len(), APPEND_STATS_LEN);
        assert_eq!(decode_append_stats(&bytes), Some(stats));
        assert_eq!(decode_append_stats(&bytes[0..31]), None);
        let mut wrong = bytes.clone();
        wrong[0] = b'X';
        assert_eq!(decode_append_stats(&wrong), None);
    }

    #[test]
    fn delta_round_trip_keeps_order_and_counts() {
        let by_kind = vec![
            ("member/heartbeat".to_string(), 12u64),
            ("task/state".to_string(), 3u64),
        ];
        let bytes = encode_delta(4, 9, 15, 123, &by_kind).expect("encode");
        let view = decode_delta(&bytes).expect("decode");
        assert_eq!(view.from_version, 4);
        assert_eq!(view.to_version, 9);
        assert_eq!(view.records, 15);
        assert_eq!(view.last_seq, 123);
        assert_eq!(view.by_kind, by_kind);
        assert_eq!(decode_delta(&bytes[0..31]), None);
    }
}
