//! DSH-LINK native compute core, as a napi-rs addon.
//!
//! The addon carries two pure functions, one stateful incremental index (with a byte-batched
//! surface), one capability probe and one version string; everything else is a Cordis plugin's
//! business:
//!
//! - \`foldCollabRecords(recordsJson)\` — fold \`dsh-link-collab\` control records into the
//!   query-ready summary (counts, member registry, task board, team tree, fingerprint).
//! - \`indexTeamStatus(eventsJson)\` — index a 12/24-member team's event stream into the
//!   roster + status + tree state.
//! - \`CollabFoldIndex\` — the stateful incremental index: \`new\`, \`appendBatch(recordsJson)\`,
//!   \`appendRecords(ndjsonBuffer)\` (byte-batched), \`snapshot()\`, \`deltaSince(version)\`,
//!   \`readDelta(cursor)\` (byte-batched), \`version()\`, \`records()\`, \`checksum()\`.
//! - \`probe()\` — \`{ok, nativeApiVersion, features}\`; the host plugin refuses an addon whose API
//!   version or feature list does not match what it was built against, and falls back to TS.
//! - \`nativeVersion()\` — the crate version, for diagnostics.
//!
//! Safety: this crate contains no \`unsafe\` blocks; the only unsafe code in the built addon is
//! what \`napi-derive\`'s macro expansion emits at the FFI boundary. Every entry point wraps its
//! body in \`std::panic::catch_unwind\`, so a defect surfaces as a JS error instead of taking the
//! kernel process down. The functions are synchronous and allocation-bounded by the input; the
//! host plugin decides whether a call is small enough to run inline (see
//! \`plugins/dsh-link-compute/README.md\`).
//!
//! Byte-batched entries exchange fixed binary buffers (see \`wire.rs\`) instead of JSON strings, so
//! a caller that already holds the ledger's NDJSON bytes can append them without parsing or
//! re-serialising the array envelope.
//!
//! The JS-visible names are camelCase; napi-derive converts them from the Rust names.

mod checksum;
mod domain;
mod fold;
mod json;
mod team;
mod wire;

use std::collections::BTreeMap;
use std::sync::Mutex;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::Serialize;

use fold::FoldState;
use json::compare_utf16;

/// The N-API API version this build speaks. Bump it whenever an entry point's signature or a
/// wire layout in \`wire.rs\` changes incompatibly; the host plugin refuses a mismatched addon.
pub const NATIVE_API_VERSION: u32 = 2;

/// Every capability this build offers. The host plugin requires all of the features it uses, so
/// an addon built before a feature existed is refused instead of failing call by call.
pub const FEATURES: [&str; 6] = [
    "foldCollabRecords",
    "indexTeamStatus",
    "collabFoldIndex",
    "byteBatched",
    "deltaCursor",
    "probe",
];

/// Render a panic payload as text.
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_string();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "panic with a non-string payload".to_string()
}

/// Run one string-producing entry body, converting an error and a panic into a N-API error.
fn guarded<F: FnOnce() -> Result<String, String>>(work: F) -> napi::Result<String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(message)) => Err(napi::Error::new(napi::Status::InvalidArg, message)),
        Err(payload) => Err(napi::Error::new(
            napi::Status::GenericFailure,
            format!("COMPUTE_PANIC: {}", panic_message(payload)),
        )),
    }
}

/// Run one byte-producing entry body, converting an error and a panic into a N-API error.
fn guarded_buffer<F: FnOnce() -> Result<Vec<u8>, String>>(work: F) -> napi::Result<Buffer> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(Ok(bytes)) => Ok(Buffer::from(bytes)),
        Ok(Err(message)) => Err(napi::Error::new(napi::Status::InvalidArg, message)),
        Err(payload) => Err(napi::Error::new(
            napi::Status::GenericFailure,
            format!("COMPUTE_PANIC: {}", panic_message(payload)),
        )),
    }
}

/// Fold collaboration-bus control records into the summary JSON.
///
/// @param records_json - JSON array of control records, as text.
/// @returns canonical summary JSON, as text.
#[napi]
pub fn fold_collab_records(records_json: String) -> napi::Result<String> {
    guarded(move || fold::fold_collab_records(&records_json))
}

/// Index a team's durable event stream into the team-status JSON.
///
/// @param events_json - JSON array of team/session events, as text.
/// @returns canonical status JSON, as text.
#[napi]
pub fn index_team_status(events_json: String) -> napi::Result<String> {
    guarded(move || team::index_team_status(&events_json))
}

/// What this addon can do, and which API version it speaks.
#[napi(object)]
pub struct Probe {
    /// Always true when the addon loaded and can answer this call.
    pub ok: bool,
    /// The N-API API version; the host plugin requires an exact match.
    pub native_api_version: u32,
    /// The capability names this build offers.
    pub features: Vec<String>,
}

/// Report the addon's API version and capabilities.
///
/// @returns \`{ok, nativeApiVersion, features}\`.
#[napi]
pub fn probe() -> Probe {
    Probe {
        ok: true,
        native_api_version: NATIVE_API_VERSION,
        features: FEATURES.iter().map(|name| (*name).to_string()).collect(),
    }
}

/// The answer to one \`appendBatch\` call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppendResult {
    accepted: u64,
    records: u64,
    last_seq: i64,
    version: u32,
}

/// One kind's contribution to a delta.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KindDelta {
    kind: String,
    count: u64,
}

/// Sort one delta's per-kind counts by UTF-16 code unit, the order the TypeScript reference and
/// the wire layout both use.
fn sorted_kind_pairs(by_kind: BTreeMap<String, u64>) -> Vec<(String, u64)> {
    let mut pairs: Vec<(String, u64)> = by_kind.into_iter().collect();
    pairs.sort_by(|left, right| compare_utf16(&left.0, &right.0));
    pairs
}

/// Sort one delta's per-kind rows by UTF-16 code unit, the order the TypeScript reference uses.
fn sorted_kind_deltas(by_kind: BTreeMap<String, u64>) -> Vec<KindDelta> {
    sorted_kind_pairs(by_kind)
        .into_iter()
        .map(|(kind, count)| KindDelta { kind, count })
        .collect()
}

/// The answer to one \`deltaSince\` call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Delta {
    from_version: u32,
    to_version: u32,
    records: u64,
    last_seq: i64,
    by_kind: Vec<KindDelta>,
}

/// One appended batch, kept so a delta can answer without re-reading the fold.
struct BatchDelta {
    version: u32,
    records: u64,
    by_kind: Vec<(String, u64)>,
}

/// The mutable index guarded by one mutex.
struct IndexInner {
    state: FoldState,
    batches: Vec<BatchDelta>,
    version: u32,
}

impl IndexInner {
    /// What an append needs to know about the state before it runs.
    fn before_batch(&self) -> (u64, BTreeMap<String, u64>) {
        (self.state.records(), self.state.kind_counts())
    }

    /// Book-keeping after one append: version bump, per-kind diff, batch log, result.
    fn after_batch(
        &mut self,
        records_before: u64,
        kinds_before: BTreeMap<String, u64>,
    ) -> AppendResult {
        let kinds_after = self.state.kind_counts();
        let accepted = self.state.records() - records_before;
        let mut by_kind: Vec<(String, u64)> = Vec::new();
        for (kind, after) in &kinds_after {
            let before = kinds_before.get(kind).copied().unwrap_or(0);
            if *after > before {
                by_kind.push((kind.clone(), after - before));
            }
        }
        self.version += 1;
        let version = self.version;
        self.batches.push(BatchDelta {
            version,
            records: accepted,
            by_kind,
        });
        AppendResult {
            accepted,
            records: self.state.records(),
            last_seq: self.state.last_seq(),
            version,
        }
    }

    /// Aggregate every batch after \`since_version\`.
    fn delta_totals(&self, since_version: u32) -> (u64, BTreeMap<String, u64>) {
        let mut records = 0u64;
        let mut by_kind: BTreeMap<String, u64> = BTreeMap::new();
        for batch in &self.batches {
            if batch.version <= since_version {
                continue;
            }
            records += batch.records;
            for (kind, count) in &batch.by_kind {
                *by_kind.entry(kind.clone()).or_insert(0) += count;
            }
        }
        (records, by_kind)
    }
}

/// A stateful, append-only index over collaboration-bus control records.
///
/// The one-shot \`foldCollabRecords\` re-parses and re-folds the whole ledger on every call. This
/// object keeps the fold state in Rust instead: an append parses and folds only the new records,
/// and \`snapshot\`/\`deltaSince\`/\`readDelta\` materialise the answer a caller asks for.
///
/// The snapshot is byte-identical to \`foldCollabRecords\` over the concatenation of every batch
/// appended so far, so switching a caller to the index cannot fork the semantics.
#[napi]
pub struct CollabFoldIndex {
    inner: Mutex<IndexInner>,
}

impl Default for CollabFoldIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl CollabFoldIndex {
    /// Lock the index, recovering a poisoned lock: a panic must not wedge the handle forever.
    fn lock(&self) -> std::sync::MutexGuard<'_, IndexInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

#[napi]
impl CollabFoldIndex {
    /// Create an empty index.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(IndexInner {
                state: FoldState::new(),
                batches: Vec::new(),
                version: 0,
            }),
        }
    }

    /// Fold one JSON array of records into the index (the string form of an append).
    ///
    /// @param records_json - JSON array of control records, as text.
    /// @returns JSON \`{accepted, records, lastSeq, version}\`.
    #[napi]
    pub fn append_batch(&self, records_json: String) -> napi::Result<String> {
        guarded(move || {
            let mut inner = self.lock();
            let (records_before, kinds_before) = inner.before_batch();
            inner.state.append_batch(&records_json)?;
            let result = inner.after_batch(records_before, kinds_before);
            serde_json::to_string(&result).map_err(|error| format!("COMPUTE_SERIALIZE: {error}"))
        })
    }

    /// Fold one newline-delimited JSON batch into the index (the byte-batched form).
    ///
    /// The bytes are the collaboration log's own on-disk form: one JSON record per line. Damaged
    /// lines are counted in the returned stats and skipped, never fatal, so a tail reader can pass
    /// the last, partially written line of a log and keep the rest of the batch.
    ///
    /// @param records - UTF-8 NDJSON bytes.
    /// @returns the 32-byte append-stats buffer described in \`wire.rs\`.
    #[napi]
    pub fn append_records(&self, records: Buffer) -> napi::Result<Buffer> {
        guarded_buffer(move || {
            let mut inner = self.lock();
            let (records_before, kinds_before) = inner.before_batch();
            let (_, unparsable) = inner.state.append_ndjson(records.as_ref())?;
            let result = inner.after_batch(records_before, kinds_before);
            let stats = wire::AppendStats {
                accepted: u32::try_from(result.accepted).unwrap_or(u32::MAX),
                unparsable: u32::try_from(unparsable).unwrap_or(u32::MAX),
                version: result.version,
                records: result.records,
                last_seq: result.last_seq,
            };
            Ok(wire::encode_append_stats(&stats))
        })
    }

    /// Materialise the summary of everything appended so far.
    ///
    /// @returns canonical summary JSON, byte-identical to the one-shot fold over the batches.
    #[napi]
    pub fn snapshot(&self) -> napi::Result<String> {
        guarded(|| self.lock().state.summary_json())
    }

    /// The records and kinds added after \`since_version\` (the JSON form of a delta).
    ///
    /// @param since_version - the version the caller already has; 0 asks for everything.
    /// @returns JSON \`{fromVersion, toVersion, records, lastSeq, byKind}\`.
    #[napi]
    #[allow(clippy::needless_pass_by_value)]
    pub fn delta_since(&self, since_version: u32) -> napi::Result<String> {
        guarded(move || {
            let inner = self.lock();
            let (records, by_kind) = inner.delta_totals(since_version);
            let delta = Delta {
                from_version: since_version,
                to_version: inner.version,
                records,
                last_seq: inner.state.last_seq(),
                by_kind: sorted_kind_deltas(by_kind),
            };
            serde_json::to_string(&delta).map_err(|error| format!("COMPUTE_SERIALIZE: {error}"))
        })
    }

    /// The records and kinds added after \`cursor\` (the byte-batched form of a delta).
    ///
    /// @param cursor - the version the caller already has; 0 asks for everything.
    /// @returns the delta buffer described in \`wire.rs\`.
    #[napi]
    pub fn read_delta(&self, cursor: u32) -> napi::Result<Buffer> {
        guarded_buffer(move || {
            let inner = self.lock();
            let (records, by_kind) = inner.delta_totals(cursor);
            let pairs: Vec<(String, u64)> = sorted_kind_pairs(by_kind);
            wire::encode_delta(
                cursor,
                inner.version,
                records,
                inner.state.last_seq(),
                &pairs,
            )
        })
    }

    /// The current version; increment once per append call.
    #[napi]
    pub fn version(&self) -> u32 {
        self.lock().version
    }

    /// How many rows the index folded so far.
    #[napi]
    pub fn records(&self) -> u32 {
        u32::try_from(self.lock().state.records()).unwrap_or(u32::MAX)
    }

    /// The commutative fingerprint of everything appended so far.
    #[napi]
    pub fn checksum(&self) -> String {
        self.lock().state.checksum_hex()
    }
}

/// The addon's crate version.
#[napi]
pub fn native_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
