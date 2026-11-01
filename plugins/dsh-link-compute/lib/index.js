// plugins/dsh-link-compute/src/index.ts
import z from "@deepseek-ai/schemastery";

// plugins/dsh-link-compute/src/binding.ts
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/dsh-link-compute/src/reference.ts
import { TextDecoder, TextEncoder } from "node:util";
var REFERENCE_VERSION = "0.3.0";
var FNV_OFFSET = 0xcbf29ce484222325n;
var FNV_PRIME = 0x100000001b3n;
var MASK64 = 0xffffffffffffffffn;
var UNIT_SEPARATOR = "";
var ENCODER = new TextEncoder();
function fnv1a64Update(hash, text) {
  let running = hash;
  for (const byte of ENCODER.encode(text)) {
    running = (running ^ BigInt(byte)) * FNV_PRIME & MASK64;
  }
  return running;
}
function fnv1a64Hex(hash) {
  return hash.toString(16).padStart(16, "0");
}
var APPEND_STATS_MAGIC = 827347780;
var DELTA_MAGIC = 826561348;
var APPEND_STATS_LEN = 32;
var DELTA_HEADER_LEN = 32;
var DECODER = new TextDecoder();
var STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });
function encodeAppendStats(stats) {
  const out = new Uint8Array(APPEND_STATS_LEN);
  const view = new DataView(out.buffer);
  view.setUint32(0, APPEND_STATS_MAGIC, true);
  view.setUint32(4, stats.accepted, true);
  view.setUint32(8, stats.unparsable, true);
  view.setUint32(12, stats.version, true);
  view.setBigUint64(16, BigInt(stats.records), true);
  view.setBigInt64(24, BigInt(stats.lastSeq), true);
  return out;
}
function encodeDelta(reading) {
  const parts = reading.byKind.map(({ kind, count }) => ({ bytes: ENCODER.encode(kind), count }));
  const payload = parts.reduce((sum, part) => sum + 2 + part.bytes.byteLength + 8, 0);
  const out = new Uint8Array(DELTA_HEADER_LEN + payload);
  const view = new DataView(out.buffer);
  view.setUint32(0, DELTA_MAGIC, true);
  view.setUint32(4, reading.fromVersion, true);
  view.setUint32(8, reading.toVersion, true);
  view.setBigUint64(12, BigInt(reading.records), true);
  view.setBigInt64(20, BigInt(reading.lastSeq), true);
  view.setUint32(28, parts.length, true);
  let at = DELTA_HEADER_LEN;
  for (const part of parts) {
    view.setUint16(at, part.bytes.byteLength, true);
    at += 2;
    out.set(part.bytes, at);
    at += part.bytes.byteLength;
    view.setBigUint64(at, BigInt(part.count), true);
    at += 8;
  }
  return out;
}
function inputError(detail) {
  return new Error("COMPUTE_INPUT: " + detail);
}
var MAX_SAFE_MAGNITUDE = 9007199254740991;
function domainError(detail) {
  return new Error("COMPUTE_DOMAIN: " + detail);
}
function isDomainError(error) {
  return error instanceof Error && error.message.startsWith("COMPUTE_DOMAIN:");
}
function hasLoneSurrogateEscape(text) {
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    if (!inString) {
      if (char === '"') inString = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = false;
      index += 1;
      continue;
    }
    if (char !== "\\") {
      index += 1;
      continue;
    }
    index += 1;
    if (text[index] !== "u") {
      index += 1;
      continue;
    }
    const code = parseInt(text.slice(index + 1, index + 5), 16);
    index += 5;
    if (Number.isNaN(code)) return false;
    if (code >= 55296 && code <= 56319) {
      const low = parseInt(text.slice(index + 2, index + 6), 16);
      const lowEscape = text[index] === "\\" && text[index + 1] === "u";
      if (!lowEscape || Number.isNaN(low) || low < 56320 || low > 57343) return true;
      index += 6;
      continue;
    }
    if (code >= 56320 && code <= 57343) return true;
  }
  return false;
}
function parseJsonValueDomain(text, noun) {
  if (hasLoneSurrogateEscape(text)) throw domainError("lone surrogate escape in JSON text");
  let parsed;
  try {
    parsed = JSON.parse(text, (_key, value) => {
      if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_MAGNITUDE)) {
        throw domainError("number outside the parity domain (finite, |n| <= 2^53-1): " + String(value));
      }
      return value;
    });
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw inputError(noun + " must be valid JSON: " + (error instanceof Error ? error.message : String(error)));
  }
  return parsed;
}
function parseRows(text, noun) {
  const parsed = parseJsonValueDomain(text, noun);
  if (!Array.isArray(parsed)) throw inputError(noun + " must be a JSON array");
  return parsed;
}
function objectOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  return value;
}
function objectString(object, key) {
  if (object === void 0) return void 0;
  const value = object[key];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function objectInteger(object, key) {
  if (object === void 0) return void 0;
  const value = object[key];
  return typeof value === "number" && Number.isInteger(value) ? value : void 0;
}
function seqOf(value) {
  return objectInteger(objectOf(value), "seq");
}
function atOf(value) {
  return objectInteger(objectOf(value), "at") ?? 0;
}
function orderOf(value, index) {
  return [seqOf(value) ?? 0, index];
}
function compareOrder(left, right) {
  return left[0] - right[0] || left[1] - right[1];
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function countTaskStatus(counts, status) {
  if (status === "pending") counts.pending += 1;
  else if (status === "in_progress") counts.inProgress += 1;
  else if (status === "completed") counts.completed += 1;
  else if (status === "deleted") counts.deleted += 1;
  else counts.unknown += 1;
}
function winningParent(acc) {
  let winner;
  for (const declaration of acc.declarations) {
    if (winner === void 0) {
      winner = declaration;
      continue;
    }
    const candidateMoreSpecific = declaration.parent !== null && winner.parent === null;
    const sameSpecificity = declaration.parent === null === (winner.parent === null);
    const earlier = declaration.at < winner.at || declaration.at === winner.at && compareOrder(declaration.order, winner.order) < 0;
    if (candidateMoreSpecific || sameSpecificity && earlier) winner = declaration;
  }
  return winner === void 0 ? null : winner.parent;
}
function resolveTeamDepths(teams) {
  const depths = /* @__PURE__ */ new Map();
  let orphans = 0;
  let cycles = 0;
  let roots = 0;
  let contested = 0;
  for (const team of [...teams.keys()].sort(compareText)) {
    resolveTeamDepth(team, teams, depths, [], () => {
      orphans += 1;
    }, () => {
      cycles += 1;
    });
  }
  for (const acc of teams.values()) {
    const winner = winningParent(acc);
    if (winner === null) roots += 1;
    for (const declaration of acc.declarations) {
      if (declaration.parent !== winner) contested += 1;
    }
  }
  let maxDepth = 0;
  for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth);
  return { depths, tree: { roots, maxDepth, orphans, cycles, contested } };
}
function resolveTeamDepth(team, teams, depths, visiting, countOrphan, countCycle) {
  const known = depths.get(team);
  if (known !== void 0) return known;
  if (visiting.includes(team)) {
    countCycle();
    return 0;
  }
  const acc = teams.get(team);
  const parent = acc === void 0 ? null : winningParent(acc);
  if (parent === null) {
    depths.set(team, 0);
    return 0;
  }
  if (!teams.has(parent)) {
    countOrphan();
    depths.set(team, 0);
    return 0;
  }
  const parentDepth = resolveTeamDepth(parent, teams, depths, [...visiting, team], countOrphan, countCycle);
  const depth = parentDepth + 1;
  depths.set(team, depth);
  return depth;
}
function messageBytes(payload) {
  const text = objectString(payload, "text") ?? objectString(payload, "message");
  return text === void 0 ? 0 : ENCODER.encode(text).length;
}
function foldedCaps(events) {
  const sorted = [...events].sort((left, right) => compareOrder(left.order, right.order));
  const caps = /* @__PURE__ */ new Set();
  for (const event of sorted) {
    if (event.full) {
      caps.clear();
      for (const name2 of event.names) caps.add(name2);
    } else {
      for (const name2 of event.names) caps.add(name2);
    }
  }
  return [...caps].sort(compareText);
}
var FoldState = class {
  byKind = /* @__PURE__ */ new Map();
  members = /* @__PURE__ */ new Map();
  tasks = /* @__PURE__ */ new Map();
  teams = /* @__PURE__ */ new Map();
  messageCount = 0;
  messageByteCount = 0;
  records = 0;
  malformedRows = 0;
  lastSeq = 0;
  checksum = 0n;
  nextIndex = 0;
  /** Parse one JSON array of records and fold it into this state. */
  appendBatch(recordsJson) {
    const rows = parseRows(recordsJson, "records");
    for (const value of rows) this.appendRow(value);
  }
  /**
   * Parse a newline-delimited JSON batch (the collaboration log's on-disk form) and fold every
   * parseable line.
   *
   * A damaged line is counted, not fatal: a tail reader may hand over the last, partially written
   * line of a log and still fold the rest of the batch. A line that parses to a non-object is
   * folded like the corresponding array element (it becomes a malformed row).
   */
  appendNdjson(bytes) {
    let text;
    try {
      text = STRICT_DECODER.decode(bytes);
    } catch {
      throw domainError("invalid UTF-8 in NDJSON batch");
    }
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    const lines = text.split("\n");
    const values = [];
    let unparsable = 0;
    for (const rawLine of lines) {
      const line = rawLine.replace(/^[ \t\r\v\f]+|[ \t\r\v\f]+$/g, "");
      if (line === "") continue;
      let value;
      try {
        value = parseJsonValueDomain(line, "records");
      } catch (error) {
        if (isDomainError(error)) throw error;
        unparsable += 1;
        continue;
      }
      values.push(value);
    }
    for (const value of values) this.appendRow(value);
    return { accepted: values.length, unparsable };
  }
  /** Fold one already-parsed row. */
  appendRow(value) {
    const index = this.nextIndex;
    this.nextIndex += 1;
    const order = orderOf(value, index);
    this.records += 1;
    const row = objectOf(value);
    const kind = objectString(row, "kind");
    const subject = objectString(row, "subject") ?? "";
    this.checksum = this.checksum + fnv1a64Update(FNV_OFFSET, String(order[0]) + UNIT_SEPARATOR + (kind ?? "") + UNIT_SEPARATOR + subject + "\n") & MASK64;
    const seq = seqOf(value);
    if (seq !== void 0) this.lastSeq = Math.max(this.lastSeq, seq);
    if (row === void 0 || kind === void 0) {
      this.malformedRows += 1;
      return;
    }
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1);
    const payload = objectOf(row["payload"]);
    if (kind === "member/state") {
      const id = objectString(payload, "id") ?? objectString(row, "subject") ?? objectString(row, "actor");
      if (id === void 0) {
        this.malformedRows += 1;
        return;
      }
      const entry = memberEntry(this.members, id);
      if (compareOrder(order, entry.order) >= 0) {
        entry.order = order;
        entry.state = objectString(payload, "state") ?? objectString(payload, "status") ?? "unknown";
        entry.team = objectString(payload, "team");
      }
      return;
    }
    if (kind === "member/heartbeat") {
      const id = objectString(payload, "id") ?? objectString(row, "subject");
      if (id === void 0) {
        this.malformedRows += 1;
        return;
      }
      const entry = memberEntry(this.members, id);
      entry.hearts += 1;
      if (compareOrder(order, entry.beatOrder) >= 0) {
        entry.beatOrder = order;
        entry.lastBeatSeq = order[0];
        entry.lastBeatAt = objectInteger(payload, "at") ?? atOf(value);
      }
      return;
    }
    if (kind === "capability/state") {
      const id = objectString(payload, "id") ?? objectString(row, "subject");
      const listed = payload === void 0 ? void 0 : payload["capabilities"];
      const full = Array.isArray(listed) ? listed : void 0;
      const single = objectString(payload, "capability");
      if (id === void 0 || full === void 0 && single === void 0) {
        this.malformedRows += 1;
        return;
      }
      const entry = memberEntry(this.members, id);
      if (full !== void 0) {
        entry.capsEvents.push({ order, full: true, names: full.filter((name2) => typeof name2 === "string" && name2 !== "") });
      } else if (single !== void 0) {
        entry.capsEvents.push({ order, full: false, names: [single] });
      }
      return;
    }
    if (kind === "task/state") {
      const id = objectString(payload, "id") ?? objectString(payload, "task") ?? objectString(row, "subject");
      if (id === void 0) {
        this.malformedRows += 1;
        return;
      }
      let entry = this.tasks.get(id);
      if (entry === void 0) {
        entry = { order, team: void 0, state: "", revision: 0, owner: void 0 };
        this.tasks.set(id, entry);
      }
      if (compareOrder(order, entry.order) >= 0) {
        entry.order = order;
        entry.team = objectString(payload, "team");
        entry.state = objectString(payload, "state") ?? objectString(payload, "status") ?? "unknown";
        entry.revision = objectInteger(payload, "revision") ?? 0;
        entry.owner = objectString(payload, "owner") ?? objectString(payload, "ownerId");
      }
      return;
    }
    if (kind === "team/state") {
      const team = objectString(payload, "team") ?? objectString(row, "subject");
      if (team === void 0) {
        this.malformedRows += 1;
        return;
      }
      let entry = this.teams.get(team);
      if (entry === void 0) {
        entry = { declarations: [], lead: null, leadOrder: [0, 0] };
        this.teams.set(team, entry);
      }
      entry.declarations.push({ parent: objectString(payload, "parent") ?? null, at: atOf(value), order });
      const lead = objectString(payload, "lead");
      if (lead !== void 0 && compareOrder(order, entry.leadOrder) >= 0) {
        entry.leadOrder = order;
        entry.lead = lead;
      }
      return;
    }
    if (kind === "team.message") {
      this.messageCount += 1;
      this.messageByteCount += messageBytes(payload);
    }
  }
  /** Counts by kind folded so far, as a snapshot a caller can diff across an append. */
  kindCounts() {
    return new Map(this.byKind);
  }
  /** Materialise the summary of everything folded so far. */
  summaryJson() {
    const teamMemberCounts = /* @__PURE__ */ new Map();
    for (const member of this.members.values()) {
      if (member.team === void 0) continue;
      teamMemberCounts.set(member.team, (teamMemberCounts.get(member.team) ?? 0) + 1);
    }
    const teamTaskCounts = /* @__PURE__ */ new Map();
    for (const task of this.tasks.values()) {
      if (task.team === void 0) continue;
      teamTaskCounts.set(task.team, (teamTaskCounts.get(task.team) ?? 0) + 1);
    }
    const { depths, tree } = resolveTeamDepths(this.teams);
    const byKindRows = [...this.byKind.keys()].sort(compareText).map((kind) => ({ kind, count: this.byKind.get(kind) ?? 0 }));
    const memberRows = [...this.members.keys()].sort(compareText).map((id) => {
      const acc = this.members.get(id);
      if (acc === void 0) throw new Error("unreachable: member vanished during the fold");
      return {
        id,
        team: acc.team ?? null,
        state: acc.state,
        hearts: acc.hearts,
        lastBeatSeq: acc.lastBeatSeq,
        lastBeatAt: acc.lastBeatAt,
        caps: foldedCaps(acc.capsEvents)
      };
    });
    const taskRows = [...this.tasks.keys()].sort(compareText).map((id) => {
      const acc = this.tasks.get(id);
      if (acc === void 0) throw new Error("unreachable: task vanished during the fold");
      return {
        id,
        team: acc.team ?? null,
        state: acc.state,
        revision: acc.revision,
        owner: acc.owner ?? null
      };
    });
    const teamRows = [...this.teams.keys()].sort(compareText).map((team) => {
      const acc = this.teams.get(team);
      if (acc === void 0) throw new Error("unreachable: team vanished during the fold");
      return {
        team,
        parent: winningParent(acc),
        lead: acc.lead,
        members: teamMemberCounts.get(team) ?? 0,
        tasks: teamTaskCounts.get(team) ?? 0,
        depth: depths.get(team) ?? 0
      };
    });
    const summary = {
      ok: true,
      records: this.records,
      malformedRows: this.malformedRows,
      lastSeq: this.lastSeq,
      byKind: byKindRows,
      members: memberRows,
      tasks: taskRows,
      teams: teamRows,
      messages: { count: this.messageCount, bytes: this.messageByteCount },
      teamTree: tree,
      checksum: fnv1a64Hex(this.checksum)
    };
    return JSON.stringify(summary);
  }
};
function foldCollabRecords(recordsJson) {
  const state = new FoldState();
  state.appendBatch(recordsJson);
  return state.summaryJson();
}
var CollabFoldIndex = class {
  state = new FoldState();
  batches = [];
  currentVersion = 0;
  /** Fold one JSON array of records into the index; returns `{accepted, records, lastSeq, version}`. */
  appendBatch(recordsJson) {
    const recordsBefore = this.state.records;
    const kindsBefore = this.state.kindCounts();
    this.state.appendBatch(recordsJson);
    const result = this.recordBatch(recordsBefore, kindsBefore);
    return JSON.stringify({ accepted: result.accepted, records: result.records, lastSeq: result.lastSeq, version: result.version });
  }
  /**
   * Fold one newline-delimited JSON batch into the index; returns the 32-byte append-stats buffer.
   *
   * This is the byte-batched append: the caller hands over the ledger's own bytes and nothing is
   * re-serialised as a JSON array. `unparsable` in the stats counts damaged lines that were
   * skipped, never fatal.
   */
  appendRecords(frame) {
    const recordsBefore = this.state.records;
    const kindsBefore = this.state.kindCounts();
    const { unparsable } = this.state.appendNdjson(frame);
    const result = this.recordBatch(recordsBefore, kindsBefore);
    return encodeAppendStats({
      accepted: result.accepted,
      unparsable,
      version: result.version,
      records: result.records,
      lastSeq: result.lastSeq
    });
  }
  /** Materialise the summary of everything appended so far. */
  snapshot() {
    return this.state.summaryJson();
  }
  /** The records and kinds added after `sinceVersion`; 0 asks for everything. */
  deltaSince(sinceVersion) {
    const totals = this.deltaTotals(sinceVersion);
    const delta = {
      fromVersion: sinceVersion,
      toVersion: this.currentVersion,
      records: totals.records,
      lastSeq: this.state.lastSeq,
      byKind: totals.byKind.map(([kind, count]) => ({ kind, count }))
    };
    return JSON.stringify(delta);
  }
  /** The records and kinds added after `cursor`; returns the delta buffer. */
  readDelta(cursor) {
    const totals = this.deltaTotals(cursor);
    return encodeDelta({
      fromVersion: cursor,
      toVersion: this.currentVersion,
      records: totals.records,
      lastSeq: this.state.lastSeq,
      byKind: totals.byKind.map(([kind, count]) => ({ kind, count }))
    });
  }
  /** The current version; incremented once per append call. */
  version() {
    return this.currentVersion;
  }
  /** How many rows the index folded so far. */
  records() {
    return this.state.records;
  }
  /** The commutative fingerprint of everything appended so far. */
  checksum() {
    return fnv1a64Hex(this.state.checksum);
  }
  /** Book-keeping for one append, shared by the string and byte forms. */
  recordBatch(recordsBefore, kindsBefore) {
    const kindsAfter = this.state.kindCounts();
    const accepted = this.state.records - recordsBefore;
    const byKind = [];
    for (const kind of [...kindsAfter.keys()].sort(compareText)) {
      const after = kindsAfter.get(kind) ?? 0;
      const before = kindsBefore.get(kind) ?? 0;
      if (after > before) byKind.push([kind, after - before]);
    }
    this.currentVersion += 1;
    this.batches.push({ version: this.currentVersion, records: accepted, byKind });
    return { accepted, records: this.state.records, lastSeq: this.state.lastSeq, version: this.currentVersion };
  }
  /** Aggregate every batch after `sinceVersion`, kinds in sorted order. */
  deltaTotals(sinceVersion) {
    let records = 0;
    const byKind = /* @__PURE__ */ new Map();
    for (const batch of this.batches) {
      if (batch.version <= sinceVersion) continue;
      records += batch.records;
      for (const [kind, count] of batch.byKind) byKind.set(kind, (byKind.get(kind) ?? 0) + count);
    }
    const sorted = [...byKind.keys()].sort(compareText).map((kind) => [kind, byKind.get(kind) ?? 0]);
    return { records, byKind: sorted };
  }
};
function memberEntry(members, id) {
  let entry = members.get(id);
  if (entry === void 0) {
    entry = {
      order: [0, 0],
      state: "",
      team: void 0,
      hearts: 0,
      beatOrder: [0, 0],
      lastBeatSeq: 0,
      lastBeatAt: 0,
      capsEvents: []
    };
    members.set(id, entry);
  }
  return entry;
}
function foldPresence(presence, sessionId, running, order) {
  let entry = presence.get(sessionId);
  if (entry === void 0) {
    entry = { order, running };
    presence.set(sessionId, entry);
    return;
  }
  if (compareOrder(order, entry.order) >= 0) {
    entry.order = order;
    entry.running = running;
  }
}
function deriveDepth(id, parentOf, depths, countCycle) {
  const known = depths.get(id);
  if (known !== void 0) return known;
  const path = [];
  let current = id;
  for (; ; ) {
    const memo = depths.get(current);
    if (memo !== void 0) {
      let depth = memo;
      for (const node of [...path].reverse()) {
        depth += 1;
        depths.set(node, depth);
      }
      return depths.get(id) ?? 0;
    }
    if (path.includes(current)) {
      countCycle();
      for (const node of path) if (!depths.has(node)) depths.set(node, 0);
      if (!depths.has(current)) depths.set(current, 0);
      return depths.get(id) ?? 0;
    }
    path.push(current);
    const parent = parentOf.get(current) ?? null;
    if (parent === null) {
      let depth = 0;
      for (const node of [...path].reverse()) {
        depths.set(node, depth);
        depth += 1;
      }
      return depths.get(id) ?? 0;
    }
    current = parent;
  }
}
function indexTeamStatus(eventsJson) {
  const events = parseRows(eventsJson, "events");
  const teams = /* @__PURE__ */ new Map();
  const tasks = /* @__PURE__ */ new Map();
  const presence = /* @__PURE__ */ new Map();
  let unknownEvents = 0;
  let malformedEvents = 0;
  let lastSeq = 0;
  let checksum = 0n;
  events.forEach((value, index) => {
    const order = orderOf(value, index);
    const row = objectOf(value);
    const eventType = objectString(row, "type") ?? objectString(row, "kind");
    const subject = objectString(row, "subject") ?? "";
    checksum = checksum + fnv1a64Update(FNV_OFFSET, String(order[0]) + UNIT_SEPARATOR + (eventType ?? "") + UNIT_SEPARATOR + subject + "\n") & MASK64;
    const seq = seqOf(value);
    if (seq !== void 0) lastSeq = Math.max(lastSeq, seq);
    if (row === void 0 || eventType === void 0) {
      unknownEvents += 1;
      return;
    }
    const payload = objectOf(row["payload"]);
    if (eventType === "team/member") {
      const member = payload === void 0 ? void 0 : objectOf(payload["member"]);
      const teamId = objectString(payload, "teamId");
      const id = objectString(member, "id");
      if (teamId === void 0 || id === void 0) {
        malformedEvents += 1;
        return;
      }
      const name2 = objectString(member, "name") ?? id;
      const phase = objectString(member, "phase") ?? "active";
      const spawnedBy = objectString(member, "spawnedBy");
      const declaredDepth = objectInteger(member, "depth");
      let team = teams.get(teamId);
      if (team === void 0) {
        team = { members: /* @__PURE__ */ new Map() };
        teams.set(teamId, team);
      }
      let memberAcc = team.members.get(id);
      if (memberAcc === void 0) {
        memberAcc = { order, name: name2, phase, spawnedBy, declaredDepth };
        team.members.set(id, memberAcc);
      } else if (compareOrder(order, memberAcc.order) >= 0) {
        memberAcc.order = order;
        memberAcc.name = name2;
        memberAcc.phase = phase;
        memberAcc.spawnedBy = spawnedBy;
        memberAcc.declaredDepth = declaredDepth;
      }
      return;
    }
    if (eventType === "team/task") {
      const task = payload === void 0 ? void 0 : objectOf(payload["task"]);
      const teamId = objectString(payload, "teamId");
      const id = objectString(task, "id");
      const status = objectString(task, "status");
      if (teamId === void 0 || id === void 0 || status === void 0) {
        malformedEvents += 1;
        return;
      }
      const key = teamId + UNIT_SEPARATOR + id;
      let taskAcc = tasks.get(key);
      if (taskAcc === void 0) {
        taskAcc = { order, teamId, status };
        tasks.set(key, taskAcc);
      } else if (compareOrder(order, taskAcc.order) >= 0) {
        taskAcc.order = order;
        taskAcc.teamId = teamId;
        taskAcc.status = status;
      }
      return;
    }
    if (eventType === "session/presence") {
      const sessionId = objectString(payload, "sessionId");
      const runningValue = payload === void 0 ? void 0 : payload["running"];
      const running = typeof runningValue === "boolean" ? runningValue : void 0;
      if (sessionId === void 0 || running === void 0) {
        malformedEvents += 1;
        return;
      }
      foldPresence(presence, sessionId, running, order);
      return;
    }
    if (eventType === "session/started") {
      const sessionId = objectString(payload, "sessionId");
      if (sessionId === void 0) {
        malformedEvents += 1;
        return;
      }
      foldPresence(presence, sessionId, true, order);
      return;
    }
    if (eventType === "session/ended") {
      const sessionId = objectString(payload, "sessionId");
      if (sessionId === void 0) {
        malformedEvents += 1;
        return;
      }
      foldPresence(presence, sessionId, false, order);
      return;
    }
    unknownEvents += 1;
  });
  const teamTaskCounts = /* @__PURE__ */ new Map();
  const tasksTotal = { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 };
  for (const task of tasks.values()) {
    let counts = teamTaskCounts.get(task.teamId);
    if (counts === void 0) {
      counts = { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 };
      teamTaskCounts.set(task.teamId, counts);
    }
    countTaskStatus(counts, task.status);
    countTaskStatus(tasksTotal, task.status);
  }
  const statusCounts = { running: 0, inactive: 0, provisioning: 0, failed: 0 };
  const tree = { roots: 0, maxDepth: 0, orphanParents: 0, cycles: 0, duplicateNames: 0 };
  const memberRows = [];
  const teamRows = [];
  for (const teamId of [...teams.keys()].sort(compareText)) {
    const roster = teams.get(teamId);
    if (roster === void 0) continue;
    const nameToId = /* @__PURE__ */ new Map();
    for (const id of [...roster.members.keys()].sort(compareText)) {
      const member = roster.members.get(id);
      if (member === void 0) continue;
      if (nameToId.has(member.name)) tree.duplicateNames += 1;
      else nameToId.set(member.name, id);
    }
    const parentOf = /* @__PURE__ */ new Map();
    let orphansHere = 0;
    for (const [id, member] of roster.members) {
      const parentId = member.spawnedBy === void 0 ? void 0 : nameToId.get(member.spawnedBy);
      if (member.spawnedBy !== void 0 && parentId === void 0) orphansHere += 1;
      parentOf.set(id, parentId ?? null);
    }
    tree.orphanParents += orphansHere;
    const depths = /* @__PURE__ */ new Map();
    for (const [id, member] of roster.members) {
      if (member.declaredDepth !== void 0) depths.set(id, member.declaredDepth);
    }
    const children = /* @__PURE__ */ new Map();
    for (const id of roster.members.keys()) {
      deriveDepth(id, parentOf, depths, () => {
        tree.cycles += 1;
      });
      const parentId = parentOf.get(id) ?? null;
      if (parentId !== null) children.set(parentId, (children.get(parentId) ?? 0) + 1);
    }
    for (const id of roster.members.keys()) {
      const member = roster.members.get(id);
      if (member === void 0) continue;
      const depth = depths.get(id) ?? 0;
      const parentId = parentOf.get(id) ?? null;
      const running = presence.get(id)?.running ?? false;
      const status = member.phase === "failed" ? "failed" : member.phase === "provisioning" ? "provisioning" : running ? "running" : "inactive";
      if (status === "running") statusCounts.running += 1;
      else if (status === "provisioning") statusCounts.provisioning += 1;
      else if (status === "failed") statusCounts.failed += 1;
      else statusCounts.inactive += 1;
      memberRows.push(buildMemberRow(id, member, teamId, status, depth, parentId, children.get(id) ?? 0, running));
    }
    let maxDepth = 0;
    for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth);
    let runningCount = 0;
    for (const id of roster.members.keys()) {
      if (presence.get(id)?.running === true) runningCount += 1;
    }
    teamRows.push(buildTeamRow(teamId, roster.members.size, maxDepth, runningCount, orphansHere, teamTaskCounts.get(teamId)));
  }
  memberRows.sort((left, right) => compareText(left.teamId, right.teamId) || left.depth - right.depth || compareText(left.name, right.name) || compareText(left.id, right.id));
  for (const member of memberRows) {
    if (member.spawnedBy === null) tree.roots += 1;
    tree.maxDepth = Math.max(tree.maxDepth, member.depth);
  }
  const state = {
    ok: true,
    events: events.length,
    unknownEvents,
    malformedEvents,
    lastSeq,
    teams: teamRows,
    members: memberRows,
    tree,
    tasks: tasksTotal,
    statusCounts,
    checksum: fnv1a64Hex(checksum)
  };
  return JSON.stringify(state);
}
function buildMemberRow(id, member, teamId, status, depth, parentId, children, running) {
  return {
    id,
    name: member.name,
    teamId,
    role: member.spawnedBy === void 0 ? "lead" : "teammate",
    phase: member.phase,
    status,
    depth,
    spawnedBy: member.spawnedBy ?? null,
    parentId,
    children,
    running
  };
}
function buildTeamRow(teamId, members, maxDepth, running, orphans, tasks) {
  return {
    teamId,
    members,
    maxDepth,
    running,
    orphans,
    tasks: tasks ?? { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 }
  };
}

// plugins/dsh-link-compute/src/binding.ts
var NATIVE_API_VERSION = 2;
var REQUIRED_NATIVE_FEATURES = Object.freeze([
  "foldCollabRecords",
  "indexTeamStatus",
  "collabFoldIndex",
  "byteBatched",
  "deltaCursor",
  "probe"
]);
var PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
var ADDON_PATH = join(PLUGIN_ROOT, "lib", "dsh_compute.node");
var REFERENCE_FEATURES = Object.freeze([
  "foldCollabRecords",
  "indexTeamStatus",
  "collabFoldIndex",
  "byteBatched",
  "deltaCursor"
]);
function referenceProbe() {
  return {
    ok: true,
    kind: "typescript",
    nativeApiVersion: null,
    features: REFERENCE_FEATURES,
    version: REFERENCE_VERSION,
    detail: "pure-TypeScript reference"
  };
}
var REFERENCE = Object.freeze({
  kind: "typescript",
  version: REFERENCE_VERSION,
  detail: "pure-TypeScript reference",
  foldCollabRecords,
  indexTeamStatus,
  openFoldIndex: () => new CollabFoldIndex(),
  probe: referenceProbe
});
function functionOf(record, name2) {
  const value = record[name2];
  return typeof value === "function" ? value : void 0;
}
function jsonStringOf(name2, value) {
  if (typeof value !== "string") {
    throw new Error("compute addon " + name2 + " returned " + typeof value + " instead of a JSON string");
  }
  return value;
}
function nativeFoldIndexOf(constructor, path) {
  if (typeof constructor !== "function") {
    throw new Error("compute addon at " + path + " exports no CollabFoldIndex");
  }
  const instance = new constructor();
  if (typeof instance !== "object" || instance === null) {
    throw new Error("compute addon CollabFoldIndex did not construct an object");
  }
  const record = instance;
  const call = (name2, args) => {
    const method = record[name2];
    if (typeof method !== "function") {
      throw new Error("compute addon CollabFoldIndex is missing " + name2);
    }
    return method.call(instance, ...args);
  };
  const callString = (name2, args) => jsonStringOf("CollabFoldIndex." + name2, call(name2, args));
  const callNumber = (name2, args) => {
    const value = call(name2, args);
    if (typeof value !== "number") {
      throw new Error("compute addon CollabFoldIndex." + name2 + " returned " + typeof value + " instead of a number");
    }
    return value;
  };
  const callBytes = (name2, args) => {
    const value = call(name2, args);
    if (!(value instanceof Uint8Array)) {
      throw new Error("compute addon CollabFoldIndex." + name2 + " returned " + typeof value + " instead of bytes");
    }
    return value;
  };
  return {
    appendBatch: (recordsJson) => callString("appendBatch", [recordsJson]),
    snapshot: () => callString("snapshot", []),
    deltaSince: (sinceVersion) => callString("deltaSince", [sinceVersion]),
    // The napi Buffer argument wraps the very same memory as the caller's Uint8Array view
    // (Buffer.from(arrayBuffer, offset, length) copies nothing), so the byte path stays one copy.
    appendRecords: (frame) => callBytes("appendRecords", [Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)]),
    readDelta: (cursor) => callBytes("readDelta", [cursor]),
    version: () => callNumber("version", []),
    records: () => callNumber("records", []),
    checksum: () => callString("checksum", [])
  };
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function nativeProbeOf(record, path, version) {
  const probeFunction = record["probe"];
  if (typeof probeFunction !== "function") return "addon at " + path + " exports no probe()";
  let raw;
  try {
    raw = probeFunction();
  } catch (error) {
    return "addon at " + path + " probe() threw: " + messageOf(error);
  }
  if (typeof raw !== "object" || raw === null) return "addon at " + path + " probe() did not return an object";
  const probe = raw;
  if (probe["ok"] !== true) return "addon at " + path + " probe() reported ok=false";
  const apiVersion = probe["nativeApiVersion"];
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion)) {
    return "addon at " + path + " probe() reported no integer nativeApiVersion";
  }
  if (apiVersion !== NATIVE_API_VERSION) {
    return "addon at " + path + " speaks native API version " + String(apiVersion) + ", host requires " + String(NATIVE_API_VERSION) + "; using the TypeScript reference";
  }
  const features = probe["features"];
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== "string")) {
    return "addon at " + path + " probe() reported no string features list";
  }
  const offered = new Set(features);
  const missing = REQUIRED_NATIVE_FEATURES.filter((feature) => !offered.has(feature));
  if (missing.length > 0) {
    return "addon at " + path + " is missing native features " + missing.join(", ") + "; using the TypeScript reference";
  }
  return {
    ok: true,
    kind: "native",
    nativeApiVersion: apiVersion,
    features,
    version,
    detail: "napi addon at " + path
  };
}
function nativeBindingOf(value, path) {
  if (typeof value !== "object" || value === null) return "addon at " + path + " exported no functions";
  const record = value;
  const fold = functionOf(record, "foldCollabRecords");
  const index = functionOf(record, "indexTeamStatus");
  const versionFunction = record["nativeVersion"];
  if (fold === void 0 || index === void 0 || typeof versionFunction !== "function") {
    return "addon at " + path + " does not export foldCollabRecords/indexTeamStatus/nativeVersion";
  }
  if (typeof record["CollabFoldIndex"] !== "function") {
    return "addon at " + path + " exports no CollabFoldIndex class";
  }
  let reported;
  try {
    reported = versionFunction();
  } catch (error) {
    return "addon at " + path + " nativeVersion() threw: " + messageOf(error);
  }
  const version = typeof reported === "string" ? reported : "unknown";
  const probed = nativeProbeOf(record, path, version);
  if (typeof probed === "string") return probed;
  return {
    kind: "native",
    version,
    detail: "napi addon at " + path,
    foldCollabRecords: (recordsJson) => jsonStringOf("foldCollabRecords", fold(recordsJson)),
    indexTeamStatus: (eventsJson) => jsonStringOf("indexTeamStatus", index(eventsJson)),
    openFoldIndex: () => nativeFoldIndexOf(record["CollabFoldIndex"], path),
    probe: () => probed
  };
}
function loadAddon(path) {
  try {
    const require2 = createRequire(import.meta.url);
    const value = require2(path);
    return nativeBindingOf(value, path);
  } catch (error) {
    return "addon at " + path + " failed to load: " + messageOf(error);
  }
}
function resolveBinding(options = {}) {
  if (options.native === "off") {
    return { ...REFERENCE, detail: "pure-TypeScript reference (native disabled by config)" };
  }
  const candidates = options.addonPath === void 0 ? [ADDON_PATH] : [options.addonPath];
  const reasons = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      reasons.push("no addon at " + candidate);
      continue;
    }
    const loaded = loadAddon(candidate);
    if (typeof loaded !== "string") return loaded;
    reasons.push(loaded);
  }
  return { ...REFERENCE, detail: reasons.join("; ") };
}
var ComputeFacade = class {
  /** The pure-TypeScript reference, always available. */
  reference;
  active;
  /** Calls the native addon answered. */
  nativeCalls = 0;
  /** Native calls that threw; the first one latched the reference. */
  nativeFailures = 0;
  /** The message of the first native call failure, when there was one. */
  lastError = void 0;
  /**
   * @param binding - the resolved binding to start with.
   */
  constructor(binding) {
    this.active = binding;
    this.reference = REFERENCE;
  }
  /** Which half is answering now. */
  get kind() {
    return this.active.kind;
  }
  /** The version of the half answering now. */
  get version() {
    return this.active.version;
  }
  /** Where the half answering now came from. */
  get detail() {
    return this.active.detail;
  }
  /**
   * Fold collaboration-bus control records into the summary JSON.
   * @param recordsJson - JSON array of control records, as text.
   * @returns canonical summary JSON, as text.
   */
  foldCollabRecords(recordsJson) {
    return this.answer("fold", recordsJson);
  }
  /**
   * Index a team's durable event stream into the team-status JSON.
   * @param eventsJson - JSON array of team/session events, as text.
   * @returns canonical status JSON, as text.
   */
  indexTeamStatus(eventsJson) {
    return this.answer("index", eventsJson);
  }
  /** Report the API version and capabilities of the half answering now. */
  probe() {
    return this.active.probe();
  }
  /**
   * Report the health/ready readout for logs and probes: half, API version, implementation
   * version, pair-lock status and the fallback counters. Cheap and side-effect free.
   * @returns the health readout.
   */
  health() {
    const report = this.active.probe();
    return {
      ok: this.nativeFailures === 0,
      kind: this.active.kind,
      nativeApiVersion: report.nativeApiVersion,
      version: report.version,
      referenceVersion: REFERENCE_VERSION,
      pairLocked: this.active.kind !== "native" || report.version === REFERENCE_VERSION,
      features: report.features,
      nativeCalls: this.nativeCalls,
      nativeFailures: this.nativeFailures,
      lastError: this.lastError ?? null,
      detail: this.active.detail
    };
  }
  /**
   * Open a stateful incremental index on the half answering now.
   *
   * A native index keeps its state inside the addon, so a native failure inside an open index
   * cannot be replayed into the reference. The failure is surfaced (typed), the facade latches
   * the reference and counts the failure, and the caller reopens to get a reference index: the
   * already-open native index never keeps serving after a failure. The stateless calls above
   * re-answer from the reference immediately.
   */
  openFoldIndex() {
    if (this.active.kind === "typescript") return this.active.openFoldIndex();
    return new LatchingFoldIndex(this, this.active.openFoldIndex());
  }
  /**
   * Latch the reference after a native call failure: counts it and stops using the addon.
   * @param errorMessage - the message of the failure, kept as the diagnostic.
   */
  latchToReference(errorMessage) {
    if (this.active.kind === "typescript") return;
    this.nativeFailures += 1;
    this.lastError = errorMessage;
    this.active = this.reference;
  }
  /** Answer one call, latching the reference when the native half fails. */
  answer(kind, input) {
    if (this.active.kind === "typescript") {
      return kind === "fold" ? this.active.foldCollabRecords(input) : this.active.indexTeamStatus(input);
    }
    try {
      const result = kind === "fold" ? this.active.foldCollabRecords(input) : this.active.indexTeamStatus(input);
      this.nativeCalls += 1;
      return result;
    } catch (error) {
      this.latchToReference(error instanceof Error ? error.message : String(error));
      return kind === "fold" ? this.reference.foldCollabRecords(input) : this.reference.indexTeamStatus(input);
    }
  }
};
var LatchingFoldIndex = class {
  facade;
  inner;
  failed = false;
  constructor(facade, inner) {
    this.facade = facade;
    this.inner = inner;
  }
  /** Run one index call; on failure latch the reference, mark this index unusable, rethrow. */
  guard(work) {
    if (this.failed) throw new Error("COMPUTE_FALLBACK: this index failed over; reopen for the reference index");
    try {
      return work(this.inner);
    } catch (error) {
      this.failed = true;
      this.facade.latchToReference(messageOf(error));
      throw error;
    }
  }
  appendBatch(recordsJson) {
    return this.guard((inner) => inner.appendBatch(recordsJson));
  }
  snapshot() {
    return this.guard((inner) => inner.snapshot());
  }
  deltaSince(version) {
    return this.guard((inner) => inner.deltaSince(version));
  }
  appendRecords(frame) {
    return this.guard((inner) => inner.appendRecords(frame));
  }
  readDelta(cursor) {
    return this.guard((inner) => inner.readDelta(cursor));
  }
  version() {
    return this.guard((inner) => inner.version());
  }
  records() {
    return this.guard((inner) => inner.records());
  }
  checksum() {
    return this.guard((inner) => inner.checksum());
  }
};

// plugins/dsh-link-compute/src/config.ts
var DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  nativeEnabled: true
});

// plugins/dsh-link-compute/src/index.ts
var name = "dsh-link-compute";
var inject = [];
var Config = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  nativeEnabled: z.boolean().default(DEFAULT_CONFIG.nativeEnabled)
});
function apply(ctx, config = DEFAULT_CONFIG) {
  if (!config.enabled) {
    console.log("[link-compute] off: config enabled=false; no addon loaded, no service published");
    return;
  }
  const binding = resolveBinding({ native: config.nativeEnabled ? "auto" : "off" });
  const facade = new ComputeFacade(binding);
  ctx.provide("linkCompute", facade);
  console.log("[link-compute] ready " + JSON.stringify(facade.health()));
}
export {
  Config,
  apply,
  inject,
  name
};
