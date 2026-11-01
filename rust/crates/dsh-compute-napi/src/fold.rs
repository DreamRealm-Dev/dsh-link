//! Fold of collaboration-bus control records into the summary a reader asks for.
//!
//! The fold is stateful: {@link FoldState} owns the accumulators and can be fed one JSON array
//! after another, so a live index costs one parse of the new records per append instead of a
//! re-parse and re-fold of the whole ledger per query. {@link fold_collab_records} is the
//! one-shot surface over the same state and is byte-identical to feeding all rows to one
//! {@link FoldState} and calling {@link FoldState::summary_json}.
//!
//! Input rows are shaped like `dsh-link-collab`'s {@code ControlRecord} (`seq`, `at`, `kind`,
//! optional `subject`, `actor` and `payload`). The fold is deterministic: every "last wins"
//! decision compares `(seq, index)` rather than read order, capability declarations are applied
//! in seq order, team parents use the collaboration bus's own arbitration rule (a named parent
//! beats null; at equal specificity the earlier `(at, seq)` wins), and the fingerprint is a
//! commutative sum over rows.
//!
//! The TypeScript reference in `plugins/dsh-link-compute/src/reference.ts` implements the same
//! contract (including the incremental class); `rust/scripts/smoke.mjs` asserts byte equality.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use crate::checksum::{fnv1a64_hex, fnv1a64_update, FNV1A64_OFFSET};
use crate::domain;
use crate::json::{at_of, compare_utf16, order_of, payload_i64, payload_str, row_str, seq_of};

/// Record kind carrying a member's durable state.
const MEMBER_STATE: &str = "member/state";
/// Record kind carrying one heartbeat.
const MEMBER_HEARTBEAT: &str = "member/heartbeat";
/// Record kind carrying a capability declaration.
const CAPABILITY_STATE: &str = "capability/state";
/// Record kind carrying a task's state.
const TASK_STATE: &str = "task/state";
/// Record kind carrying a team declaration.
const TEAM_STATE: &str = "team/state";
/// Record kind carrying a message that flowed between members.
const TEAM_MESSAGE: &str = "team.message";

/// One `byKind` row.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KindCount {
    kind: String,
    count: u64,
}

/// One member row of the registry.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberRow {
    id: String,
    team: Option<String>,
    state: String,
    hearts: u64,
    last_beat_seq: i64,
    last_beat_at: i64,
    caps: Vec<String>,
}

/// One task row of the board.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRow {
    id: String,
    team: Option<String>,
    state: String,
    revision: i64,
    owner: Option<String>,
}

/// One team row of the tree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamRow {
    team: String,
    parent: Option<String>,
    lead: Option<String>,
    members: u64,
    tasks: u64,
    depth: i64,
}

/// Message volume, in records and UTF-8 bytes of payload text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageStats {
    count: u64,
    bytes: u64,
}

/// Shape facts of the team tree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamTree {
    roots: u64,
    max_depth: i64,
    orphans: u64,
    cycles: u64,
    contested: u64,
}

/// The whole summary, in its wire order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FoldSummary {
    ok: bool,
    records: u64,
    malformed_rows: u64,
    last_seq: i64,
    by_kind: Vec<KindCount>,
    members: Vec<MemberRow>,
    tasks: Vec<TaskRow>,
    teams: Vec<TeamRow>,
    messages: MessageStats,
    team_tree: TeamTree,
    checksum: String,
}

/// One capability declaration, waiting to be applied in seq order.
#[derive(Clone)]
enum CapEvent {
    /// A full declaration: it replaces whatever came before it.
    Full(Vec<String>),
    /// An incremental declaration: it adds one name.
    Single(String),
}

/// One member's fold state.
#[derive(Default)]
struct MemberAcc {
    order: (i64, i64),
    state: String,
    team: Option<String>,
    hearts: u64,
    beat_order: (i64, i64),
    last_beat_seq: i64,
    last_beat_at: i64,
    /// Declarations kept unsorted: a replace must be applied in seq order, not arrival order.
    caps_events: Vec<((i64, i64), CapEvent)>,
}

/// One task's fold state.
#[derive(Default)]
struct TaskAcc {
    order: (i64, i64),
    team: Option<String>,
    state: String,
    revision: i64,
    owner: Option<String>,
}

/// One team's declaration history; parents are arbitrated when the summary is built.
#[derive(Default)]
struct TeamAcc {
    declarations: Vec<(Option<String>, i64, (i64, i64))>,
    lead: Option<String>,
    lead_order: (i64, i64),
}

/// The mutable fold state behind both the one-shot function and the incremental index.
///
/// One instance owns every accumulator; {@link FoldState::append_batch} adds one parsed JSON array
/// and {@link FoldState::summary_json} materialises the summary. Appending is O(rows in the batch)
/// and does not touch the summary; materialising is O(total rows) and allocates the output rows.
#[derive(Default)]
pub struct FoldState {
    by_kind: BTreeMap<String, u64>,
    members: BTreeMap<String, MemberAcc>,
    tasks: BTreeMap<String, TaskAcc>,
    teams: BTreeMap<String, TeamAcc>,
    message_count: u64,
    message_bytes: u64,
    records: u64,
    malformed_rows: u64,
    last_seq: i64,
    checksum: u64,
    next_index: u64,
}

impl FoldState {
    /// An empty state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse one JSON array of records and fold it into this state.
    ///
    /// @param input - JSON array of control records, as text.
    /// @throws `COMPUTE_INPUT` when the text is not JSON or its root is not an array.
    pub fn append_batch(&mut self, input: &str) -> Result<(), String> {
        // Validate the whole batch (syntax, numbers, encoding domain) before touching any
        // accumulator: a rejected batch must leave the fold exactly as it was.
        let root: Value = domain::parse_json_value(input, "records")?;
        let rows = root
            .as_array()
            .ok_or_else(|| "COMPUTE_INPUT: records must be a JSON array".to_string())?;
        for row in rows {
            self.append_row(row);
        }
        Ok(())
    }

    /// Parse a newline-delimited JSON batch (the collaboration log's own on-disk form) and fold
    /// every parseable line.
    ///
    /// Damaged lines are counted and skipped, never fatal: a tail reader can hand over the last
    /// partial line of a log that is still being written and still fold the rest of the batch. A
    /// line that parses to a non-object is folded like the corresponding array element would be
    /// (it becomes a malformed row, which is what the one-shot function does with `42`).
    ///
    /// @param bytes - UTF-8 NDJSON; a leading BOM, CRLF line endings, blank lines and a trailing
    ///   newline are tolerated.
    /// @returns `(accepted, unparsable)` for this batch.
    /// @throws COMPUTE_DOMAIN when a line is outside the parity input domain (invalid UTF-8, lone
    ///   surrogate escape, non-finite or out-of-range number); nothing is folded in that case.
    pub fn append_ndjson(&mut self, bytes: &[u8]) -> Result<(u64, u64), String> {
        let (records, unparsable) = parse_ndjson_batch(bytes)?;
        for row in &records {
            self.append_row(row);
        }
        Ok((records.len() as u64, unparsable))
    }

    /// Fold one already-parsed row.
    fn append_row(&mut self, row: &Value) {
        let index = self.next_index;
        self.next_index += 1;
        let order = order_of(row, index as usize);
        self.records += 1;
        if let Some(seq) = seq_of(row) {
            self.last_seq = self.last_seq.max(seq);
        }
        let kind = row_str(row, "kind");
        let subject = row_str(row, "subject").unwrap_or("");
        let fingerprint = format!("{}\u{1f}{}\u{1f}{}\n", order.0, kind.unwrap_or(""), subject);
        self.checksum = self
            .checksum
            .wrapping_add(fnv1a64_update(FNV1A64_OFFSET, fingerprint.as_bytes()));
        let Some(kind) = kind else {
            self.malformed_rows += 1;
            return;
        };
        *self.by_kind.entry(kind.to_string()).or_insert(0) += 1;
        let payload = row.get("payload");
        match kind {
            MEMBER_STATE => {
                let id = payload_str(payload, "id")
                    .or_else(|| row_str(row, "subject"))
                    .or_else(|| row_str(row, "actor"));
                match id {
                    Some(id) => {
                        let entry = self.members.entry(id.to_string()).or_default();
                        if order >= entry.order {
                            entry.order = order;
                            entry.state = payload_str(payload, "state")
                                .or_else(|| payload_str(payload, "status"))
                                .unwrap_or("unknown")
                                .to_string();
                            entry.team = payload_str(payload, "team").map(str::to_string);
                        }
                    }
                    None => self.malformed_rows += 1,
                }
            }
            MEMBER_HEARTBEAT => {
                let id = payload_str(payload, "id").or_else(|| row_str(row, "subject"));
                match id {
                    Some(id) => {
                        let entry = self.members.entry(id.to_string()).or_default();
                        entry.hearts += 1;
                        if order >= entry.beat_order {
                            entry.beat_order = order;
                            entry.last_beat_seq = order.0;
                            entry.last_beat_at =
                                payload_i64(payload, "at").unwrap_or_else(|| at_of(row));
                        }
                    }
                    None => self.malformed_rows += 1,
                }
            }
            CAPABILITY_STATE => {
                let id = payload_str(payload, "id").or_else(|| row_str(row, "subject"));
                let full = payload
                    .and_then(|object| object.get("capabilities"))
                    .and_then(Value::as_array);
                let single = payload_str(payload, "capability");
                match (id, full, single) {
                    (Some(id), Some(list), _) => {
                        let names = list
                            .iter()
                            .filter_map(|name| name.as_str().filter(|text| !text.is_empty()))
                            .map(str::to_string)
                            .collect();
                        self.members
                            .entry(id.to_string())
                            .or_default()
                            .caps_events
                            .push((order, CapEvent::Full(names)));
                    }
                    (Some(id), None, Some(name)) => {
                        self.members
                            .entry(id.to_string())
                            .or_default()
                            .caps_events
                            .push((order, CapEvent::Single(name.to_string())));
                    }
                    _ => self.malformed_rows += 1,
                }
            }
            TASK_STATE => {
                let id = payload_str(payload, "id")
                    .or_else(|| payload_str(payload, "task"))
                    .or_else(|| row_str(row, "subject"));
                match id {
                    Some(id) => {
                        let entry = self.tasks.entry(id.to_string()).or_default();
                        if order >= entry.order {
                            entry.order = order;
                            entry.team = payload_str(payload, "team").map(str::to_string);
                            entry.state = payload_str(payload, "state")
                                .or_else(|| payload_str(payload, "status"))
                                .unwrap_or("unknown")
                                .to_string();
                            entry.revision = payload_i64(payload, "revision").unwrap_or(0);
                            entry.owner = payload_str(payload, "owner")
                                .or_else(|| payload_str(payload, "ownerId"))
                                .map(str::to_string);
                        }
                    }
                    None => self.malformed_rows += 1,
                }
            }
            TEAM_STATE => {
                let team = payload_str(payload, "team").or_else(|| row_str(row, "subject"));
                match team {
                    Some(team) => {
                        let parent = payload_str(payload, "parent").map(str::to_string);
                        let entry = self.teams.entry(team.to_string()).or_default();
                        entry.declarations.push((parent, at_of(row), order));
                        if let Some(lead) = payload_str(payload, "lead") {
                            if order >= entry.lead_order {
                                entry.lead_order = order;
                                entry.lead = Some(lead.to_string());
                            }
                        }
                    }
                    None => self.malformed_rows += 1,
                }
            }
            TEAM_MESSAGE => {
                self.message_count += 1;
                let text = payload_str(payload, "text").or_else(|| payload_str(payload, "message"));
                if let Some(text) = text {
                    self.message_bytes += text.len() as u64;
                }
            }
            _ => {}
        }
    }

    /// Materialise the summary of everything folded so far.
    ///
    /// @returns canonical summary JSON.
    pub fn summary_json(&self) -> Result<String, String> {
        let mut team_member_counts: BTreeMap<String, u64> = BTreeMap::new();
        for member in self.members.values() {
            if let Some(team) = &member.team {
                *team_member_counts.entry(team.clone()).or_insert(0) += 1;
            }
        }
        let mut team_task_counts: BTreeMap<String, u64> = BTreeMap::new();
        for task in self.tasks.values() {
            if let Some(team) = &task.team {
                *team_task_counts.entry(team.clone()).or_insert(0) += 1;
            }
        }
        let (depths, team_tree) = resolve_team_depths(&self.teams);
        // Rows are emitted in UTF-16 code-unit order, the order Array#sort uses in the
        // TypeScript reference, not in Rust's native UTF-8 byte order: the two differ once a
        // non-BMP character is compared against a high BMP character, and the byte-identical
        // contract covers every valid UTF-8 identifier.
        let mut by_kind_rows: Vec<KindCount> = self
            .by_kind
            .iter()
            .map(|(kind, count)| KindCount {
                kind: kind.clone(),
                count: *count,
            })
            .collect();
        by_kind_rows.sort_by(|left, right| compare_utf16(&left.kind, &right.kind));
        let mut member_rows: Vec<MemberRow> = self
            .members
            .iter()
            .map(|(id, acc)| MemberRow {
                id: id.clone(),
                team: acc.team.clone(),
                state: acc.state.clone(),
                hearts: acc.hearts,
                last_beat_seq: acc.last_beat_seq,
                last_beat_at: acc.last_beat_at,
                caps: folded_caps(acc.caps_events.clone()),
            })
            .collect();
        member_rows.sort_by(|left, right| compare_utf16(&left.id, &right.id));
        let mut task_rows: Vec<TaskRow> = self
            .tasks
            .iter()
            .map(|(id, acc)| TaskRow {
                id: id.clone(),
                team: acc.team.clone(),
                state: acc.state.clone(),
                revision: acc.revision,
                owner: acc.owner.clone(),
            })
            .collect();
        task_rows.sort_by(|left, right| compare_utf16(&left.id, &right.id));
        let mut team_rows: Vec<TeamRow> = self
            .teams
            .iter()
            .map(|(team, acc)| TeamRow {
                team: team.clone(),
                parent: winning_parent(acc),
                lead: acc.lead.clone(),
                members: team_member_counts.get(team).copied().unwrap_or(0),
                tasks: team_task_counts.get(team).copied().unwrap_or(0),
                depth: depths.get(team).copied().unwrap_or(0),
            })
            .collect();
        team_rows.sort_by(|left, right| compare_utf16(&left.team, &right.team));
        let summary = FoldSummary {
            ok: true,
            records: self.records,
            malformed_rows: self.malformed_rows,
            last_seq: self.last_seq,
            by_kind: by_kind_rows,
            members: member_rows,
            tasks: task_rows,
            teams: team_rows,
            messages: MessageStats {
                count: self.message_count,
                bytes: self.message_bytes,
            },
            team_tree,
            checksum: fnv1a64_hex(self.checksum),
        };
        serde_json::to_string(&summary).map_err(|error| format!("COMPUTE_SERIALIZE: {error}"))
    }

    /// How many rows this state folded.
    pub fn records(&self) -> u64 {
        self.records
    }

    /// The highest explicit `seq` this state saw, or 0.
    pub fn last_seq(&self) -> i64 {
        self.last_seq
    }

    /// The commutative fingerprint of everything folded so far.
    pub fn checksum_hex(&self) -> String {
        fnv1a64_hex(self.checksum)
    }

    /// Counts by kind folded so far, as a snapshot a caller can diff across an append.
    pub fn kind_counts(&self) -> BTreeMap<String, u64> {
        self.by_kind.clone()
    }
}

/// Parse and domain-validate one whole NDJSON batch without touching any fold state.
///
/// Damaged lines are counted and dropped; a domain violation aborts the whole batch. Keeping the
/// validation pure is what lets an append be atomic: the caller folds only after every line of
/// the batch passed.
///
/// @param bytes - UTF-8 NDJSON (leading BOM, CRLF, blank lines and trailing newline tolerated).
/// @returns the parsed records that fold, and how many damaged lines were skipped.
/// @throws COMPUTE_DOMAIN when a line is outside the parity input domain.
pub fn parse_ndjson_batch(bytes: &[u8]) -> Result<(Vec<Value>, u64), String> {
    let mut records: Vec<Value> = Vec::new();
    let mut unparsable = 0u64;
    let mut rest = bytes;
    if rest.starts_with(&[0xef, 0xbb, 0xbf]) {
        rest = &rest[3..];
    }
    for line in rest.split(|byte| *byte == b'\n') {
        let line = trim_ascii_whitespace(line);
        if line.is_empty() {
            continue;
        }
        match domain::parse_ndjson_line(line)? {
            Some(value) => records.push(value),
            None => unparsable += 1,
        }
    }
    Ok((records, unparsable))
}

/// Trim ASCII whitespace (including CR) from both ends of a byte slice.
fn trim_ascii_whitespace(mut bytes: &[u8]) -> &[u8] {
    while let Some((first, rest)) = bytes.split_first() {
        if first.is_ascii_whitespace() {
            bytes = rest;
        } else {
            break;
        }
    }
    while let Some((last, rest)) = bytes.split_last() {
        if last.is_ascii_whitespace() {
            bytes = rest;
        } else {
            break;
        }
    }
    bytes
}

/// Fold a JSON array of control records into the summary JSON (the one-shot surface).
///
/// @param input - JSON array of records, as text.
/// @returns canonical summary JSON.
/// @throws `COMPUTE_INPUT` when the text is not JSON or its root is not an array.
pub fn fold_collab_records(input: &str) -> Result<String, String> {
    let mut state = FoldState::new();
    state.append_batch(input)?;
    state.summary_json()
}

/// Apply one member's capability declarations in seq order, and return the sorted set.
///
/// Sorting is what makes the fold independent of arrival order: a full declaration must wipe
/// exactly the declarations numbered before it, not the ones that happened to be read first.
fn folded_caps(mut events: Vec<((i64, i64), CapEvent)>) -> Vec<String> {
    events.sort_by_key(|event| event.0);
    let mut caps: BTreeSet<String> = BTreeSet::new();
    for (_, event) in events {
        match event {
            CapEvent::Full(names) => {
                caps.clear();
                caps.extend(names);
            }
            CapEvent::Single(name) => {
                caps.insert(name);
            }
        }
    }
    let mut ordered: Vec<String> = caps.into_iter().collect();
    ordered.sort_by(|left, right| compare_utf16(left, right));
    ordered
}

/// The winning parent of one team declaration history.
///
/// The collaboration bus's rule (R98/P43 rule 2), reused rather than re-invented: a named
/// parent beats null, and at equal specificity the earlier `(at, seq)` wins. The rule is
/// order-independent, so the answer does not depend on how the declarations arrived.
fn winning_parent(acc: &TeamAcc) -> Option<String> {
    let mut winner: Option<&(Option<String>, i64, (i64, i64))> = None;
    for declaration in &acc.declarations {
        match winner {
            None => winner = Some(declaration),
            Some(current) => {
                let candidate_more_specific = declaration.0.is_some() && current.0.is_none();
                let same_specificity = declaration.0.is_none() == current.0.is_none();
                let earlier = declaration.1 < current.1
                    || (declaration.1 == current.1 && declaration.2 < current.2);
                if candidate_more_specific || (same_specificity && earlier) {
                    winner = Some(declaration);
                }
            }
        }
    }
    winner.and_then(|declaration| declaration.0.clone())
}

/// Depth of every declared team, plus the tree's shape facts.
fn resolve_team_depths(teams: &BTreeMap<String, TeamAcc>) -> (BTreeMap<String, i64>, TeamTree) {
    let mut depths: BTreeMap<String, i64> = BTreeMap::new();
    let mut orphans = 0u64;
    let mut cycles = 0u64;
    let mut roots = 0u64;
    let mut contested = 0u64;
    for team in teams.keys() {
        resolve_depth(
            team,
            teams,
            &mut depths,
            &mut Vec::new(),
            &mut orphans,
            &mut cycles,
        );
    }
    for acc in teams.values() {
        let winner = winning_parent(acc);
        if winner.is_none() {
            roots += 1;
        }
        contested += acc
            .declarations
            .iter()
            .filter(|declaration| declaration.0.as_deref() != winner.as_deref())
            .count() as u64;
    }
    let max_depth = depths.values().copied().max().unwrap_or(0);
    (
        depths,
        TeamTree {
            roots,
            max_depth,
            orphans,
            cycles,
            contested,
        },
    )
}

/// Depth of one team; an undeclared parent makes it a root and counts as an orphan.
fn resolve_depth(
    team: &str,
    teams: &BTreeMap<String, TeamAcc>,
    depths: &mut BTreeMap<String, i64>,
    visiting: &mut Vec<String>,
    orphans: &mut u64,
    cycles: &mut u64,
) -> i64 {
    if let Some(depth) = depths.get(team) {
        return *depth;
    }
    if visiting.iter().any(|node| node == team) {
        *cycles += 1;
        return 0;
    }
    let parent = match winning_parent(&teams[team]) {
        Some(parent) => parent,
        None => {
            depths.insert(team.to_string(), 0);
            return 0;
        }
    };
    if !teams.contains_key(&parent) {
        *orphans += 1;
        depths.insert(team.to_string(), 0);
        return 0;
    }
    visiting.push(team.to_string());
    let parent_depth = resolve_depth(&parent, teams, depths, visiting, orphans, cycles);
    visiting.pop();
    let depth = parent_depth + 1;
    depths.insert(team.to_string(), depth);
    depth
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(input: &str) -> Value {
        serde_json::from_str(&fold_collab_records(input).expect("fold succeeds"))
            .expect("summary is JSON")
    }

    #[test]
    fn empty_ledger_folds_to_an_empty_summary() {
        let summary = fold("[]");
        assert_eq!(summary["ok"], true);
        assert_eq!(summary["records"], 0);
        assert_eq!(summary["lastSeq"], 0);
        assert_eq!(summary["byKind"].as_array().expect("array").len(), 0);
        assert_eq!(summary["members"].as_array().expect("array").len(), 0);
    }

    #[test]
    fn last_heartbeat_wins_by_seq_not_by_read_order() {
        let forward = fold(
            r#"[{"seq":1,"kind":"member/heartbeat","payload":{"id":"m1","at":10}},{"seq":2,"kind":"member/heartbeat","payload":{"id":"m1","at":20}}]"#,
        );
        let reversed = fold(
            r#"[{"seq":2,"kind":"member/heartbeat","payload":{"id":"m1","at":20}},{"seq":1,"kind":"member/heartbeat","payload":{"id":"m1","at":10}}]"#,
        );
        assert_eq!(forward["members"][0]["lastBeatSeq"], 2);
        assert_eq!(forward["members"][0]["lastBeatAt"], 20);
        assert_eq!(forward["members"][0]["hearts"], 2);
        assert_eq!(forward, reversed);
    }

    #[test]
    fn a_named_team_parent_beats_null_whatever_the_order() {
        let summary = fold(
            r#"[
            {"seq":1,"kind":"team/state","payload":{"team":"child","parent":null,"lead":"l1"}},
            {"seq":2,"kind":"team/state","payload":{"team":"child","parent":"root"}},
            {"seq":1,"kind":"team/state","payload":{"team":"root","parent":null}}
        ]"#,
        );
        let teams = summary["teams"].as_array().expect("teams array");
        let child = teams
            .iter()
            .find(|row| row["team"] == "child")
            .expect("child row");
        assert_eq!(child["parent"], "root");
        assert_eq!(child["depth"], 1);
        assert_eq!(summary["teamTree"]["maxDepth"], 1);
        assert_eq!(summary["teamTree"]["roots"], 1);
        assert_eq!(summary["teamTree"]["contested"], 1);
    }

    #[test]
    fn capability_names_are_sorted_and_replace_older_sets() {
        let summary = fold(
            r#"[
            {"seq":1,"kind":"capability/state","payload":{"id":"m1","capabilities":["b","a"]}},
            {"seq":2,"kind":"capability/state","payload":{"id":"m1","capability":"c"}}
        ]"#,
        );
        assert_eq!(
            summary["members"][0]["caps"]
                .as_array()
                .expect("array")
                .len(),
            3
        );
        assert_eq!(summary["members"][0]["caps"][0], "a");
        assert_eq!(summary["members"][0]["caps"][2], "c");
    }

    #[test]
    fn incremental_batches_materialise_the_same_summary_as_one_shot() {
        let one_shot = fold_collab_records(
            r#"[
            {"seq":1,"kind":"member/state","payload":{"id":"m1","team":"t1","state":"active"}},
            {"seq":2,"kind":"member/heartbeat","payload":{"id":"m1","at":20}},
            {"seq":3,"kind":"team/state","payload":{"team":"t1","parent":null,"lead":"m1"}}
        ]"#,
        )
        .expect("one shot");
        let mut state = FoldState::new();
        state
            .append_batch(r#"[{"seq":1,"kind":"member/state","payload":{"id":"m1","team":"t1","state":"active"}}]"#)
            .expect("first batch");
        state
            .append_batch(r#"[{"seq":2,"kind":"member/heartbeat","payload":{"id":"m1","at":20}},{"seq":3,"kind":"team/state","payload":{"team":"t1","parent":null,"lead":"m1"}}]"#)
            .expect("second batch");
        assert_eq!(state.records(), 3);
        assert_eq!(state.last_seq(), 3);
        assert_eq!(state.summary_json().expect("summary"), one_shot);
    }

    #[test]
    fn ndjson_batches_fold_to_the_same_summary_as_the_array_form() {
        let rows = r#"[
            {"seq":1,"kind":"member/state","payload":{"id":"m1","team":"t1","state":"active"}},
            {"seq":2,"kind":"member/heartbeat","payload":{"id":"m1","at":20}},
            {"seq":3,"kind":"team/state","payload":{"team":"t1","parent":null,"lead":"m1"}}
        ]"#;
        let ndjson = "\u{feff}{\"seq\":1,\"kind\":\"member/state\",\"payload\":{\"id\":\"m1\",\"team\":\"t1\",\"state\":\"active\"}}\r\n{\"seq\":2,\"kind\":\"member/heartbeat\",\"payload\":{\"id\":\"m1\",\"at\":20}}\n\n{\"seq\":3,\"kind\":\"team/state\",\"payload\":{\"team\":\"t1\",\"parent\":null,\"lead\":\"m1\"}}\n";
        let mut from_array = FoldState::new();
        from_array.append_batch(rows).expect("array batch");
        let mut from_bytes = FoldState::new();
        let (accepted, unparsable) = from_bytes
            .append_ndjson(ndjson.as_bytes())
            .expect("ndjson batch");
        assert_eq!(accepted, 3);
        assert_eq!(unparsable, 0);
        assert_eq!(
            from_bytes.summary_json().expect("summary"),
            from_array.summary_json().expect("summary")
        );
    }

    #[test]
    fn damaged_ndjson_lines_are_counted_and_skipped_not_fatal() {
        let ndjson =
            "{\"seq\":1,\"kind\":\"member/state\",\"payload\":{\"id\":\"m1\"}}\n{not json\n42\n";
        let mut state = FoldState::new();
        let (accepted, unparsable) = state
            .append_ndjson(ndjson.as_bytes())
            .expect("ndjson batch");
        assert_eq!(accepted, 2);
        assert_eq!(unparsable, 1);
        let summary: Value =
            serde_json::from_str(&state.summary_json().expect("summary")).expect("json");
        assert_eq!(summary["records"], 2);
        assert_eq!(summary["malformedRows"], 1);
    }

    #[test]
    fn a_domain_violation_is_atomic_and_typed() {
        let mut state = FoldState::new();
        state
            .append_ndjson(b"{\"seq\":1,\"kind\":\"member/state\",\"payload\":{\"id\":\"m1\"}}\n")
            .expect("first batch");
        let records_before = state.records();
        let checksum_before = state.checksum_hex();
        let last_seq_before = state.last_seq();

        let error = state
            .append_ndjson(b"{\"seq\":2,\"kind\":\"member/state\",\"payload\":{\"id\":\"m2\"}}\n{\"seq\":3,\"x\":1e400}\n")
            .expect_err("domain violation");
        assert!(error.starts_with("COMPUTE_DOMAIN"), "{error}");
        // The rejected batch folded nothing: state is exactly as it was.
        assert_eq!(state.records(), records_before);
        assert_eq!(state.checksum_hex(), checksum_before);
        assert_eq!(state.last_seq(), last_seq_before);

        // A later valid batch still folds; the index is usable after a rejected append.
        let (accepted, unparsable) = state
            .append_ndjson(b"{\"seq\":4,\"kind\":\"member/state\",\"payload\":{\"id\":\"m3\"}}\n")
            .expect("valid after domain error");
        assert_eq!(accepted, 1);
        assert_eq!(unparsable, 0);
        assert_eq!(state.records(), records_before + 1);
    }

    #[test]
    fn utf16_code_unit_order_matches_the_typescript_sort() {
        // U+FFFD sorts after U+1D518 in UTF-8 byte order but before its surrogate pair range in
        // UTF-16 order, so this input proves the two implementations now agree on the ordering.
        let mut state = FoldState::new();
        state
            .append_ndjson(
                "{\"seq\":1,\"kind\":\"member/state\",\"payload\":{\"id\":\"\u{fffd}\"}}\n{\"seq\":2,\"kind\":\"member/state\",\"payload\":{\"id\":\"\u{1d518}\"}}\n"
                    .as_bytes(),
            )
            .expect("batch");
        let summary = state.summary_json().expect("summary");
        let utf16_first = summary.find("\u{1d518}").expect("astral id present");
        let replacement = summary.find("\u{fffd}").expect("replacement id present");
        assert!(
            utf16_first < replacement,
            "UTF-16 order is astral then U+FFFD: {summary}"
        );
    }

    #[test]
    fn bad_root_is_reported_as_compute_input() {
        let error = fold_collab_records("{}").expect_err("object root is refused");
        assert!(error.starts_with("COMPUTE_INPUT"), "{error}");
        let mut state = FoldState::new();
        assert!(state
            .append_batch("not json")
            .expect_err("bad json")
            .starts_with("COMPUTE_INPUT"));
    }
}
