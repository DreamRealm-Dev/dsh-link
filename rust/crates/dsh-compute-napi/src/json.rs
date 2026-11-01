//! Tolerant readers for the loose JSON rows that arrive at the N-API edge.
//!
//! The inputs are written by other processes (a ledger file, a session journal), so a
//! field may be absent, empty, or the wrong type. Every reader here answers `None` for
//! that instead of failing the whole call; the fold counts those rows as malformed.

use std::cmp::Ordering;

use serde_json::Value;

/// A non-empty string at `key` of an object row, or `None`.
pub fn row_str<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row.get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// A non-empty string at `key` of `payload` (when it is an object), or `None`.
pub fn payload_str<'a>(payload: Option<&'a Value>, key: &str) -> Option<&'a str> {
    payload
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// An integer at `key` of `payload`, or `None`. Floats are refused on purpose: a
/// count or a sequence written as `1.5` is damaged input, not a rounding problem.
pub fn payload_i64(payload: Option<&Value>, key: &str) -> Option<i64> {
    payload
        .and_then(|object| object.get(key))
        .and_then(Value::as_i64)
}

/// Compare two strings the way JavaScript's Array#sort does: by UTF-16 code unit.
///
/// Rust's native string order is UTF-8 byte order. The two agree for ASCII and for most BMP
/// text, but differ as soon as a non-BMP character (encoded as a surrogate pair in UTF-16) is
/// compared against a high BMP character, so the summary rows must use this comparator to stay
/// byte-identical with the TypeScript reference across the whole valid-UTF-8 domain.
pub fn compare_utf16(left: &str, right: &str) -> Ordering {
    let mut left_units = left.encode_utf16();
    let mut right_units = right.encode_utf16();
    loop {
        match (left_units.next(), right_units.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_unit), Some(right_unit)) => match left_unit.cmp(&right_unit) {
                Ordering::Equal => {}
                other => return other,
            },
        }
    }
}

/// The row's own integer `seq`, or `None`.
pub fn seq_of(row: &Value) -> Option<i64> {
    row.get("seq").and_then(Value::as_i64)
}

/// The row's integer `at` (milliseconds), or `0`.
pub fn at_of(row: &Value) -> i64 {
    row.get("at").and_then(Value::as_i64).unwrap_or(0)
}

/// The ordering key of one row: `(seq, index)`.
///
/// Every "last wins" decision compares this tuple instead of read order, so the same
/// rows arranged differently fold to the same answer. A row without an integer `seq`
/// still has a position, so it cannot tie with a numbered row.
pub fn order_of(row: &Value, index: usize) -> (i64, i64) {
    (seq_of(row).unwrap_or(0), index as i64)
}
