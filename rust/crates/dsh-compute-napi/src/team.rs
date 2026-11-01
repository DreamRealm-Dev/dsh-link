//! Index of a 12/24-member team's status from its durable event stream.
//!
//! Input is the JSON array of events a reader of the kernel journal already holds:
//! `team/member` and `team/task` (the `agent-team` journal's payloads), plus a runtime
//! presence event (`session/presence`, or `session/started`/`session/ended`) that carries
//! the "running" bit a roster read gets from `session/list`.
//!
//! Output is a canonical JSON string: the roster with resolved parent/children/depth, the
//! team rows, global status and task counts, tree-shape facts and a fingerprint. Depth is
//! the durable `depth` when the event carries one, and is otherwise derived from the
//! `spawnedBy` name chain, so a log written by a pre-multi-level kernel still folds.
//!
//! Determinism: "last wins" compares `(seq, index)`; names resolve to ids per team by
//! ascending id (a duplicate name is counted, never silently merged); the fingerprint is a
//! commutative sum over events. The TypeScript reference in
//! `plugins/dsh-link-compute/src/reference.ts` implements the same contract and
//! `rust/scripts/smoke.mjs` asserts byte equality for the fixtures.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::checksum::{fnv1a64_hex, fnv1a64_update, FNV1A64_OFFSET};
use crate::json::{order_of, payload_str, row_str, seq_of};

/// Event type carrying one durable teammate lifecycle snapshot.
const TEAM_MEMBER: &str = "team/member";
/// Event type carrying one durable task snapshot.
const TEAM_TASK: &str = "team/task";
/// Event type carrying a runtime presence reading for one session.
const SESSION_PRESENCE: &str = "session/presence";
/// Event type marking a session as running.
const SESSION_STARTED: &str = "session/started";
/// Event type marking a session as no longer running.
const SESSION_ENDED: &str = "session/ended";

/// Task counts by durable status.
#[derive(Serialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct TaskCounts {
    pending: u64,
    in_progress: u64,
    completed: u64,
    deleted: u64,
    unknown: u64,
}

impl TaskCounts {
    /// Count one task status.
    fn count(&mut self, status: &str) {
        match status {
            "pending" => self.pending += 1,
            "in_progress" => self.in_progress += 1,
            "completed" => self.completed += 1,
            "deleted" => self.deleted += 1,
            _ => self.unknown += 1,
        }
    }
}

/// Roster counts by computed runtime status.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatusCounts {
    running: u64,
    inactive: u64,
    provisioning: u64,
    failed: u64,
}

/// One team row.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamRow {
    team_id: String,
    members: u64,
    max_depth: i64,
    running: u64,
    orphans: u64,
    tasks: TaskCounts,
}

/// One roster row.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberRow {
    id: String,
    name: String,
    team_id: String,
    role: String,
    phase: String,
    status: String,
    depth: i64,
    spawned_by: Option<String>,
    parent_id: Option<String>,
    children: u64,
    running: bool,
}

/// Tree-shape facts.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct TreeOut {
    roots: u64,
    max_depth: i64,
    orphan_parents: u64,
    cycles: u64,
    duplicate_names: u64,
}

/// The whole index, in its wire order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamState {
    ok: bool,
    events: u64,
    unknown_events: u64,
    malformed_events: u64,
    last_seq: i64,
    teams: Vec<TeamRow>,
    members: Vec<MemberRow>,
    tree: TreeOut,
    tasks: TaskCounts,
    status_counts: StatusCounts,
    checksum: String,
}

/// One member's durable fold state.
#[derive(Default)]
struct MemberAcc {
    order: (i64, i64),
    name: String,
    phase: String,
    spawned_by: Option<String>,
    declared_depth: Option<i64>,
}

/// One task's durable fold state.
#[derive(Default)]
struct TaskAcc {
    order: (i64, i64),
    team_id: String,
    status: String,
}

/// One session's runtime presence.
#[derive(Default)]
struct PresenceAcc {
    order: (i64, i64),
    running: bool,
}

/// One team's roster.
#[derive(Default)]
struct TeamAcc {
    members: BTreeMap<String, MemberAcc>,
}

/// Index a JSON array of team events into the team-status JSON.
///
/// @param input - JSON array of events, as text.
/// @returns canonical status JSON.
/// @throws `COMPUTE_INPUT` when the text is not JSON or its root is not an array.
pub fn index_team_status(input: &str) -> Result<String, String> {
    let root: Value = crate::domain::parse_json_value(input, "events")?;
    let rows = root
        .as_array()
        .ok_or_else(|| "COMPUTE_INPUT: events must be a JSON array".to_string())?;

    let mut teams: BTreeMap<String, TeamAcc> = BTreeMap::new();
    let mut tasks: BTreeMap<(String, String), TaskAcc> = BTreeMap::new();
    let mut presence: BTreeMap<String, PresenceAcc> = BTreeMap::new();
    let mut unknown_events = 0u64;
    let mut malformed_events = 0u64;
    let mut last_seq = 0i64;
    let mut checksum = 0u64;

    for (index, row) in rows.iter().enumerate() {
        let order = order_of(row, index);
        if let Some(seq) = seq_of(row) {
            last_seq = last_seq.max(seq);
        }
        let event_type = row_str(row, "type").or_else(|| row_str(row, "kind"));
        let subject = row_str(row, "subject").unwrap_or("");
        let fingerprint = format!(
            "{}\u{1f}{}\u{1f}{}\n",
            order.0,
            event_type.unwrap_or(""),
            subject
        );
        checksum = checksum.wrapping_add(fnv1a64_update(FNV1A64_OFFSET, fingerprint.as_bytes()));
        let Some(event_type) = event_type else {
            unknown_events += 1;
            continue;
        };
        let payload = row.get("payload");
        match event_type {
            TEAM_MEMBER => {
                let member = payload.and_then(|object| object.get("member"));
                let team_id = payload_str(payload, "teamId");
                let id = member
                    .and_then(|object| object.get("id"))
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty());
                match (team_id, id) {
                    (Some(team_id), Some(id)) => {
                        let name = member
                            .and_then(|object| object.get("name"))
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .unwrap_or(id);
                        let phase = member
                            .and_then(|object| object.get("phase"))
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .unwrap_or("active");
                        let spawned_by = member
                            .and_then(|object| object.get("spawnedBy"))
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .map(str::to_string);
                        let declared_depth = member
                            .and_then(|object| object.get("depth"))
                            .and_then(Value::as_i64);
                        let entry = teams
                            .entry(team_id.to_string())
                            .or_default()
                            .members
                            .entry(id.to_string())
                            .or_default();
                        if order >= entry.order {
                            entry.order = order;
                            entry.name = name.to_string();
                            entry.phase = phase.to_string();
                            entry.spawned_by = spawned_by;
                            entry.declared_depth = declared_depth;
                        }
                    }
                    _ => malformed_events += 1,
                }
            }
            TEAM_TASK => {
                let task = payload.and_then(|object| object.get("task"));
                let team_id = payload_str(payload, "teamId");
                let id = task
                    .and_then(|object| object.get("id"))
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty());
                let status = task
                    .and_then(|object| object.get("status"))
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty());
                match (team_id, id, status) {
                    (Some(team_id), Some(id), Some(status)) => {
                        let entry = tasks
                            .entry((team_id.to_string(), id.to_string()))
                            .or_default();
                        if order >= entry.order {
                            entry.order = order;
                            entry.team_id = team_id.to_string();
                            entry.status = status.to_string();
                        }
                    }
                    _ => malformed_events += 1,
                }
            }
            SESSION_PRESENCE => {
                let session_id = payload_str(payload, "sessionId");
                let running = payload
                    .and_then(|object| object.get("running"))
                    .and_then(Value::as_bool);
                match (session_id, running) {
                    (Some(session_id), Some(running)) => {
                        fold_presence(&mut presence, session_id, running, order);
                    }
                    _ => malformed_events += 1,
                }
            }
            SESSION_STARTED => match payload_str(payload, "sessionId") {
                Some(session_id) => fold_presence(&mut presence, session_id, true, order),
                None => malformed_events += 1,
            },
            SESSION_ENDED => match payload_str(payload, "sessionId") {
                Some(session_id) => fold_presence(&mut presence, session_id, false, order),
                None => malformed_events += 1,
            },
            _ => unknown_events += 1,
        }
    }

    let mut team_task_counts: BTreeMap<String, TaskCounts> = BTreeMap::new();
    let mut task_counts = TaskCounts::default();
    for task in tasks.values() {
        team_task_counts
            .entry(task.team_id.clone())
            .or_default()
            .count(&task.status);
        task_counts.count(&task.status);
    }

    let mut member_rows: Vec<MemberRow> = Vec::new();
    let mut status_counts = StatusCounts::default();
    let mut team_rows: Vec<TeamRow> = Vec::new();
    let mut tree = TreeOut::default();

    for (team_id, team) in &teams {
        // Name to id, by ascending id: the first id that carries a name owns it.
        let mut name_to_id: BTreeMap<&str, &str> = BTreeMap::new();
        for (id, member) in &team.members {
            if name_to_id.contains_key(member.name.as_str()) {
                tree.duplicate_names += 1;
            } else {
                name_to_id.insert(member.name.as_str(), id.as_str());
            }
        }
        // Resolve each member's parent id, and count the names that resolve nowhere.
        let mut parent_of: BTreeMap<String, Option<String>> = BTreeMap::new();
        let mut orphans_here = 0u64;
        for (id, member) in &team.members {
            let parent = member
                .spawned_by
                .as_deref()
                .and_then(|name| name_to_id.get(name).copied())
                .map(str::to_string);
            if member.spawned_by.is_some() && parent.is_none() {
                orphans_here += 1;
            }
            parent_of.insert(id.clone(), parent);
        }
        tree.orphan_parents += orphans_here;

        let mut depths: BTreeMap<String, i64> = BTreeMap::new();
        for (id, member) in &team.members {
            if let Some(declared) = member.declared_depth {
                depths.insert(id.clone(), declared);
            }
        }
        let mut children: BTreeMap<String, u64> = BTreeMap::new();
        // Two passes: every child must be counted before any row reports its children count.
        for id in team.members.keys() {
            derive_depth(id, &parent_of, &mut depths, &mut tree.cycles);
            if let Some(parent) = parent_of.get(id).and_then(|parent| parent.as_ref()) {
                *children.entry(parent.clone()).or_insert(0) += 1;
            }
        }
        for id in team.members.keys() {
            let member = &team.members[id];
            let depth = depths.get(id).copied().unwrap_or(0);
            let running = presence
                .get(id)
                .map(|reading| reading.running)
                .unwrap_or(false);
            let status = if member.phase == "failed" {
                "failed"
            } else if member.phase == "provisioning" {
                "provisioning"
            } else if running {
                "running"
            } else {
                "inactive"
            };
            match status {
                "running" => status_counts.running += 1,
                "provisioning" => status_counts.provisioning += 1,
                "failed" => status_counts.failed += 1,
                _ => status_counts.inactive += 1,
            }
            member_rows.push(MemberRow {
                role: if member.spawned_by.is_none() {
                    "lead".to_string()
                } else {
                    "teammate".to_string()
                },
                id: id.clone(),
                name: member.name.clone(),
                team_id: team_id.clone(),
                phase: member.phase.clone(),
                status: status.to_string(),
                depth,
                spawned_by: member.spawned_by.clone(),
                parent_id: parent_of.get(id).and_then(|parent| parent.clone()),
                children: children.get(id).copied().unwrap_or(0),
                running,
            });
        }
        let max_depth = team
            .members
            .keys()
            .map(|id| depths.get(id).copied().unwrap_or(0))
            .max()
            .unwrap_or(0);
        let running = team
            .members
            .keys()
            .filter(|id| {
                presence
                    .get(*id)
                    .map(|reading| reading.running)
                    .unwrap_or(false)
            })
            .count() as u64;
        team_rows.push(TeamRow {
            team_id: team_id.clone(),
            members: team.members.len() as u64,
            max_depth,
            running,
            orphans: orphans_here,
            tasks: team_task_counts.get(team_id).copied().unwrap_or_default(),
        });
    }

    member_rows.sort_by(|left, right| {
        left.team_id
            .cmp(&right.team_id)
            .then(left.depth.cmp(&right.depth))
            .then(left.name.cmp(&right.name))
            .then(left.id.cmp(&right.id))
    });
    tree.roots = member_rows
        .iter()
        .filter(|member| member.spawned_by.is_none())
        .count() as u64;
    tree.max_depth = member_rows
        .iter()
        .map(|member| member.depth)
        .max()
        .unwrap_or(0);

    let state = TeamState {
        ok: true,
        events: rows.len() as u64,
        unknown_events,
        malformed_events,
        last_seq,
        teams: team_rows,
        members: member_rows,
        tree,
        tasks: task_counts,
        status_counts,
        checksum: fnv1a64_hex(checksum),
    };
    serde_json::to_string(&state).map_err(|error| format!("COMPUTE_SERIALIZE: {error}"))
}

/// Fold one presence reading: the highest order wins, so event order does not matter.
fn fold_presence(
    presence: &mut BTreeMap<String, PresenceAcc>,
    session_id: &str,
    running: bool,
    order: (i64, i64),
) {
    let entry = presence.entry(session_id.to_string()).or_default();
    if order >= entry.order {
        entry.order = order;
        entry.running = running;
    }
}

/// Depth of one member, derived from the spawnedBy name chain when not declared.
fn derive_depth(
    id: &str,
    parent_of: &BTreeMap<String, Option<String>>,
    depths: &mut BTreeMap<String, i64>,
    cycles: &mut u64,
) -> i64 {
    if let Some(depth) = depths.get(id) {
        return *depth;
    }
    let mut path: Vec<String> = Vec::new();
    let mut current = id.to_string();
    loop {
        if let Some(depth) = depths.get(&current).copied() {
            let mut depth = depth;
            for node in path.iter().rev() {
                depth += 1;
                depths.insert(node.clone(), depth);
            }
            return depths.get(id).copied().unwrap_or(0);
        }
        if path.iter().any(|node| node == &current) {
            *cycles += 1;
            for node in path.iter() {
                depths.entry(node.clone()).or_insert(0);
            }
            depths.entry(current.clone()).or_insert(0);
            return depths.get(id).copied().unwrap_or(0);
        }
        path.push(current.clone());
        match parent_of.get(&current).and_then(|parent| parent.as_ref()) {
            Some(parent) => current = parent.clone(),
            None => {
                for (depth, node) in path.iter().rev().enumerate() {
                    depths.insert(node.clone(), depth as i64);
                }
                return depths.get(id).copied().unwrap_or(0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(input: &str) -> Value {
        serde_json::from_str(&index_team_status(input).expect("index succeeds"))
            .expect("state is JSON")
    }

    #[test]
    fn a_two_level_roster_resolves_parents_children_and_depth() {
        let state = index(
            r#"[
                {"seq":1,"type":"team/member","payload":{"version":2,"teamId":"root","member":{"id":"s-lead","name":"lead","phase":"active"}}},
                {"seq":2,"type":"team/member","payload":{"version":2,"teamId":"root","member":{"id":"s-a","name":"builder","phase":"active","spawnedBy":"lead","depth":1}}},
                {"seq":3,"type":"team/member","payload":{"version":2,"teamId":"root","member":{"id":"s-a1","name":"builder-ui","phase":"active","spawnedBy":"builder","depth":2}}},
                {"seq":4,"type":"session/presence","payload":{"sessionId":"s-a","running":true}}
            ]"#,
        );
        assert_eq!(state["teams"][0]["members"], 3);
        assert_eq!(state["teams"][0]["maxDepth"], 2);
        assert_eq!(state["members"][0]["id"], "s-lead");
        assert_eq!(state["members"][0]["children"], 1);
        assert_eq!(state["members"][1]["depth"], 1);
        assert_eq!(state["members"][1]["status"], "running");
        assert_eq!(state["members"][2]["parentId"], "s-a");
        assert_eq!(state["tree"]["maxDepth"], 2);
        assert_eq!(state["statusCounts"]["running"], 1);
    }

    #[test]
    fn depth_is_derived_when_the_event_omits_it() {
        let state = index(
            r#"[
                {"seq":1,"type":"team/member","payload":{"teamId":"t","member":{"id":"a","name":"a"}}},
                {"seq":2,"type":"team/member","payload":{"teamId":"t","member":{"id":"b","name":"b","spawnedBy":"a"}}},
                {"seq":3,"type":"team/member","payload":{"teamId":"t","member":{"id":"c","name":"c","spawnedBy":"b"}}}
            ]"#,
        );
        assert_eq!(state["members"][2]["depth"], 2);
        assert_eq!(state["tree"]["roots"], 1);
    }

    #[test]
    fn an_unresolved_spawned_by_counts_as_an_orphan_and_stays_a_teammate() {
        let state = index(
            r#"[{"seq":1,"type":"team/member","payload":{"teamId":"t","member":{"id":"x","name":"x","spawnedBy":"ghost"}}}]"#,
        );
        assert_eq!(state["tree"]["orphanParents"], 1);
        assert_eq!(state["members"][0]["role"], "teammate");
        assert_eq!(state["members"][0]["parentId"], Value::Null);
    }

    #[test]
    fn unknown_and_malformed_events_are_counted_not_fatal() {
        let state = index(
            r#"[
                {"seq":1,"kind":"something/else","payload":{}},
                {"seq":2,"type":"team/member","payload":{"teamId":"t"}},
                {"seq":3,"type":"team/task","payload":{"teamId":"t","task":{"id":"k","status":"pending"}}}
            ]"#,
        );
        assert_eq!(state["unknownEvents"], 1);
        assert_eq!(state["malformedEvents"], 1);
        assert_eq!(state["tasks"]["pending"], 1);
        assert_eq!(state["events"], 3);
    }

    #[test]
    fn the_same_events_in_another_order_index_the_same() {
        let forward = index_team_status(
            r#"[{"seq":1,"type":"team/member","payload":{"teamId":"t","member":{"id":"a","name":"a"}}},{"seq":2,"type":"session/presence","payload":{"sessionId":"a","running":true}}]"#,
        )
        .expect("index");
        let reversed = index_team_status(
            r#"[{"seq":2,"type":"session/presence","payload":{"sessionId":"a","running":true}},{"seq":1,"type":"team/member","payload":{"teamId":"t","member":{"id":"a","name":"a"}}}]"#,
        )
        .expect("index");
        assert_eq!(forward, reversed);
    }
}
