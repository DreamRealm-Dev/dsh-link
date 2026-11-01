//! The input domain every JSON entry point is defined over.
//!
//! The byte-identical contract between the Rust addon and the TypeScript reference only holds
//! inside a small, explicit domain. Outside it the two languages disagree no matter what a fold
//! does: invalid UTF-8 becomes U+FFFD in JS but fails the Rust parser, a lone surrogate escape is
//! rejected by serde_json but accepted by JSON.parse, JSON.parse turns 1e400 into Infinity and
//! silently rounds integers past 2^53-1. Silently skipping or silently folding those inputs
//! would fork the two halves, so both implementations reject them with the same typed error:
//!
//! - valid UTF-8 (the byte-batched entry decodes the frame with a fatal decoder);
//! - JSON numbers that are finite and have magnitude at most 2^53-1 (the JS safe-integer range),
//!   covering 1e400, 1.797e308 and every integer past 2^53-1;
//! - no lone surrogate escapes in the JSON text.
//!
//! Damaged JSON syntax inside NDJSON is still tolerated (counted as unparsable and skipped):
//! that is a documented tail-reader feature. Encoding- and number-domain violations are not
//! syntax damage and are not tolerated.
//!
//! parse_json_value is the whole-document form, parse_ndjson_line the NDJSON line form. Both
//! are pure functions: the caller validates a whole batch before it mutates any fold state.

use serde_json::Value;

/// The largest magnitude a number may have: 2^53-1, the JS safe-integer bound.
pub const MAX_SAFE_MAGNITUDE: f64 = 9_007_199_254_740_991.0;

/// The largest safe integer, as u64.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// A typed COMPUTE_DOMAIN violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    /// The bytes are not valid UTF-8.
    InvalidUtf8(String),
    /// A JSON string carries a surrogate escape that is not a valid pair.
    LoneSurrogate,
    /// A number is non-finite or outside the safe-integer magnitude.
    NumberOutOfDomain(String),
}

impl DomainError {
    /// The JS-facing message. Both halves share the COMPUTE_DOMAIN: prefix.
    pub fn message(&self) -> String {
        match self {
            DomainError::InvalidUtf8(detail) => {
                format!("COMPUTE_DOMAIN: invalid UTF-8 in input ({detail})")
            }
            DomainError::LoneSurrogate => {
                "COMPUTE_DOMAIN: lone surrogate escape in JSON text".to_string()
            }
            DomainError::NumberOutOfDomain(detail) => format!(
                "COMPUTE_DOMAIN: number outside the parity domain (finite, |n| <= 2^53-1): {detail}"
            ),
        }
    }
}

/// Parse one whole JSON document and validate it against the domain.
///
/// @param text - JSON text, valid UTF-8 by construction.
/// @param noun - the input's name, used in the COMPUTE_INPUT syntax message.
/// @returns the parsed value.
/// @throws COMPUTE_DOMAIN for a domain violation, COMPUTE_INPUT for invalid JSON.
pub fn parse_json_value(text: &str, noun: &str) -> Result<Value, String> {
    if has_lone_surrogate_escape(text) {
        return Err(DomainError::LoneSurrogate.message());
    }
    match serde_json::from_str::<Value>(text) {
        Ok(value) => {
            validate_numbers(&value).map_err(|error| error.message())?;
            Ok(value)
        }
        Err(error) => Err(match classify_parse_error(&error) {
            Some(domain) => domain.message(),
            None => format!("COMPUTE_INPUT: {noun} must be valid JSON: {error}"),
        }),
    }
}

/// Parse one NDJSON line and validate it against the domain.
///
/// @param line - one line's bytes, already trimmed.
/// @returns Ok(Some(value)) when the line folds, Ok(None) when it is damaged syntax (tolerated),
///   and Err(COMPUTE_DOMAIN message) when it is outside the domain.
pub fn parse_ndjson_line(line: &[u8]) -> Result<Option<Value>, String> {
    let text = std::str::from_utf8(line).map_err(|error| {
        DomainError::InvalidUtf8(format!("invalid byte at offset {}", error.valid_up_to()))
            .message()
    })?;
    if has_lone_surrogate_escape(text) {
        return Err(DomainError::LoneSurrogate.message());
    }
    match serde_json::from_str::<Value>(text) {
        Ok(value) => {
            validate_numbers(&value).map_err(|error| error.message())?;
            Ok(Some(value))
        }
        Err(error) => match classify_parse_error(&error) {
            Some(domain) => Err(domain.message()),
            None => Ok(None),
        },
    }
}

/// Scan JSON text for a surrogate escape that is not a valid high/low pair.
///
/// serde_json *accepts* unpaired surrogate escapes and substitutes U+FFFD, while JSON.parse keeps
/// a lone surrogate in the JS string: the two would fold different data. This explicit scan (on
/// the raw escape, before any parser normalises it) is what makes the rejection identical.
///
/// @param text - valid UTF-8 JSON text.
/// @returns true when the text contains a lone surrogate escape.
fn has_lone_surrogate_escape(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0usize;
    let mut in_string = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if !in_string {
            if byte == b'"' {
                in_string = true;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = false;
            index += 1;
            continue;
        }
        if byte != b'\\' {
            index += 1;
            continue;
        }
        // Inside a string, a backslash starts an escape.
        index += 1;
        let Some(&escape) = bytes.get(index) else {
            return false;
        };
        if escape != b'u' {
            index += 1;
            continue;
        }
        let Some(code) = hex4(bytes.get(index + 1..index + 5)) else {
            return false;
        };
        index += 5;
        if (0xD800..=0xDBFF).contains(&code) {
            let Some(low) = hex4(bytes.get(index + 2..index + 6)) else {
                return true;
            };
            let is_low_escape =
                bytes.get(index) == Some(&b'\\') && bytes.get(index + 1) == Some(&b'u');
            if !is_low_escape || !(0xDC00..=0xDFFF).contains(&low) {
                return true;
            }
            index += 6;
            continue;
        }
        if (0xDC00..=0xDFFF).contains(&code) {
            return true;
        }
    }
    false
}

/// Read four ASCII hex digits as a u16 code unit, or None when they are not hex.
fn hex4(digits: Option<&[u8]>) -> Option<u16> {
    let digits = digits?;
    if digits.len() != 4 {
        return None;
    }
    let mut value = 0u16;
    for digit in digits {
        let nibble = match digit {
            b'0'..=b'9' => digit - b'0',
            b'a'..=b'f' => digit - b'a' + 10,
            b'A'..=b'F' => digit - b'A' + 10,
            _ => return None,
        };
        value = (value << 4) | u16::from(nibble);
    }
    Some(value)
}

/// Map a serde_json parse failure to a domain violation, or to None when it is damaged syntax.
///
/// serde_json's error text is the only signal it exposes for these classes, so the mapping is
/// pinned by unit tests (the_reported_divergences_are_domain_violations).
pub fn classify_parse_error(error: &serde_json::Error) -> Option<DomainError> {
    let text = error.to_string();
    if text.contains("surrogate") || text.contains("invalid unicode code point") {
        return Some(DomainError::LoneSurrogate);
    }
    if text.contains("number out of range") || text.contains("invalid number") {
        return Some(DomainError::NumberOutOfDomain(text));
    }
    None
}

/// Validate every number in a parsed value: finite, and magnitude at most 2^53-1.
fn validate_numbers(value: &Value) -> Result<(), DomainError> {
    match value {
        Value::Number(number) => {
            if let Some(integer) = number.as_u64() {
                if integer > MAX_SAFE_INTEGER {
                    return Err(DomainError::NumberOutOfDomain(integer.to_string()));
                }
                return Ok(());
            }
            if let Some(integer) = number.as_i64() {
                if integer.unsigned_abs() > MAX_SAFE_INTEGER {
                    return Err(DomainError::NumberOutOfDomain(integer.to_string()));
                }
                return Ok(());
            }
            match number.as_f64() {
                Some(float) if float.is_finite() && float.abs() <= MAX_SAFE_MAGNITUDE => Ok(()),
                _ => Err(DomainError::NumberOutOfDomain(number.to_string())),
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_numbers(item)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for item in map.values() {
                validate_numbers(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A valid document parses.
    #[test]
    fn valid_json_in_the_domain_parses() {
        let value =
            parse_json_value(r#"{"seq":1,"at":1791337204154,"x":1.5}"#, "records").expect("valid");
        assert_eq!(value["seq"], 1);
        assert!(parse_ndjson_line(br#"{"seq":1}"#)
            .expect("valid line")
            .is_some());
    }

    /// Damaged syntax is tolerated by the NDJSON reader but rejected by the whole-document form.
    #[test]
    fn damaged_syntax_is_tolerated_only_by_the_ndjson_reader() {
        assert!(parse_ndjson_line(br#"{"seq":1"#)
            .expect("syntax damage tolerated")
            .is_none());
        assert!(parse_ndjson_line(br#"42"#)
            .expect("non-object line")
            .is_some());
        let error = parse_json_value(r#"{"seq":1"#, "records").expect_err("whole doc");
        assert!(error.starts_with("COMPUTE_INPUT: records must be valid JSON"));
    }

    /// The four reported divergences are all domain violations.
    #[test]
    fn the_reported_divergences_are_domain_violations() {
        for line in [
            br#"{"seq":1,"id":"\ud800"}"#.as_slice(),
            br#"{"seq":1,"x":1e400}"#.as_slice(),
            br#"{"seq":1,"x":1.797e308}"#.as_slice(),
            br#"{"seq":9007199254740993}"#.as_slice(),
            br#"{"seq":-9007199254740993}"#.as_slice(),
        ] {
            let error = parse_ndjson_line(line).expect_err("outside the domain");
            assert!(
                error.starts_with("COMPUTE_DOMAIN:"),
                "unexpected message: {error}"
            );
        }
        let surrogate = parse_ndjson_line(br#"{"seq":1,"id":"\ud800"}"#).expect_err("surrogate");
        assert!(surrogate.contains("surrogate"));
        let number = parse_ndjson_line(br#"{"seq":1,"x":1e400}"#).expect_err("1e400");
        assert!(number.contains("number outside the parity domain"));
    }

    /// Invalid UTF-8 is a domain violation, not damaged syntax: JS would decode U+FFFD.
    #[test]
    fn invalid_utf8_is_a_domain_violation() {
        let error = parse_ndjson_line(&[b'{', b'"', 0xff, b'"', b'}']).expect_err("invalid utf8");
        assert!(error.starts_with("COMPUTE_DOMAIN: invalid UTF-8"));
    }

    /// The safe-integer boundary itself is accepted; one past it is refused.
    #[test]
    fn the_safe_integer_boundary_is_exact() {
        assert!(parse_json_value("9007199254740991", "records").is_ok());
        assert!(parse_json_value("-9007199254740991", "records").is_ok());
        assert!(parse_json_value("9007199254740992", "records").is_err());
        assert!(parse_json_value("-9007199254740992", "records").is_err());
    }
}
