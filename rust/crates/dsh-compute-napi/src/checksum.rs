//! FNV-1a 64-bit fingerprint of the rows a summary was folded from.
//!
//! A caller that stores the summary can compare the checksum of the next fold against
//! it to learn whether the ledger moved, without diffing the whole summary. Both sides
//! (Rust and the TypeScript reference) feed the same UTF-8 bytes, so the value is
//! byte-for-byte comparable across the two implementations.

/// FNV-1a 64-bit offset basis.
pub const FNV1A64_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// FNV-1a 64-bit prime.
pub const FNV1A64_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Feed `bytes` into a running FNV-1a 64-bit hash.
pub fn fnv1a64_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV1A64_PRIME);
    }
    hash
}

/// Render a hash as sixteen lowercase hexadecimal digits.
pub fn fnv1a64_hex(hash: u64) -> String {
    format!("{hash:016x}")
}
