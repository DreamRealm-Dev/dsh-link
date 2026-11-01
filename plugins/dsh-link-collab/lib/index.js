// plugins/dsh-link-collab/src/index.ts
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync as readFileSync2, readSync, renameSync, rmSync, statSync as statSync2, utimesSync, writeFileSync } from "node:fs";
import { join as join2, resolve } from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { serialize as v8Serialize, deserialize as v8Deserialize } from "node:v8";
import { Worker } from "node:worker_threads";

// plugins/dsh-link-collab/src/fold-worker.ts
var FOLD_WORKER_SOURCE = [
  "'use strict'",
  "const { parentPort, workerData } = require('node:worker_threads')",
  "let modulePromise = null",
  "const loadModule = () => (modulePromise === null ? (modulePromise = import(workerData.moduleUrl)) : modulePromise)",
  "const ledgers = new Map()",
  "/** One ledger view, through the HOST reader: one parser, one damage rule (R507/Y5). */",
  "function readLedger(mod, dir) {",
  "  return mod.readLedgerView(dir)",
  "}",
  "/** A compact reply: readings and named answers only, never the expanded state. */",
  "function replyOf(mod, session, answers, extra) {",
  "  const reading = mod.foldReading(session.accumulator)",
  "  const reply = {",
  "    ok: true,",
  "    through: reading.through,",
  "    records: reading.records,",
  "    counts: reading.counts,",
  "    teams: reading.teams,",
  "    messages: reading.messages,",
  "    checkpointPrefix: session.checkpointPrefix,",
  "    answers,",
  "    reloaded: extra.reloaded === true,",
  "    reason: extra.reason === undefined ? null : extra.reason,",
  "  }",
  "  if (extra.stateJson !== undefined) reply.stateJson = extra.stateJson",
  "  if (extra.checkpoint !== undefined) reply.checkpoint = extra.checkpoint",
  "  if (extra.rssBytes !== undefined) reply.rssBytes = extra.rssBytes",
  "  return reply",
  "}",
  "function failed(error) {",
  "  return {",
  "    ok: false,",
  "    error: String(error && error.message ? error.message : error),",
  "    through: 0,",
  "    records: 0,",
  "    counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 },",
  "    teams: 0,",
  "    messages: { journal: 0, inbox: 0, source: 'none', scope: 'none' },",
  "    checkpointPrefix: 0,",
  "    answers: [],",
  "    reloaded: false,",
  "    reason: null,",
  "  }",
  "}",
  "/** Fold a suffix into a session; on a non-resumable suffix re-read the ledger and fold it whole. */",
  "function step(mod, session, suffix) {",
  "  if (suffix.length === 0) return { reloaded: false, reason: null }",
  "  const blocked = mod.foldResumeSafety(session.accumulator, suffix)",
  "  if (blocked === null) {",
  "    mod.foldTeamRecords(session.accumulator, suffix)",
  "    return { reloaded: false, reason: null }",
  "  }",
  "  const view = readLedger(mod, session.view.directory)",
  "  session.view = view",
  "  session.accumulator = mod.emptyTeamFold()",
  "  mod.foldTeamRecords(session.accumulator, view.replay())",
  "  view.releaseRecords()",
  "  return { reloaded: true, reason: blocked }",
  "}",
  "async function openSession(mod, frame) {",
  "  const view = readLedger(mod, frame.dir)",
  "  let accumulator = mod.emptyTeamFold()",
  "  let checkpointPrefix = 0",
  "  if (frame.checkpoint === true) {",
  "    const loaded = mod.loadFoldCheckpoint(view)",
  "    if (loaded.accumulator !== null) {",
  "      accumulator = loaded.accumulator",
  "      checkpointPrefix = accumulator.through",
  "    }",
  "  }",
  "  const session = { view, accumulator, checkpointPrefix }",
  "  const outcome = step(mod, session, view.page(accumulator.through))",
  "  session.view.releaseRecords()",
  "  ledgers.set(frame.dir, session)",
  "  return { session, outcome }",
  "}",
  "async function handle(frame) {",
  "  const mod = await loadModule()",
  "  if (frame.op === 'open') {",
  "    const opened = await openSession(mod, frame)",
  "    const queries = Array.isArray(frame.queries) ? frame.queries : []",
  "    const answers = queries.map((query) => mod.answerFoldQuery(opened.session.accumulator, query))",
  "    return replyOf(mod, opened.session, answers, { reloaded: opened.outcome.reloaded, reason: opened.outcome.reason })",
  "  }",
  "  let session = ledgers.get(frame.dir)",
  "  if (session === undefined) {",
  "    const opened = await openSession(mod, frame)",
  "    session = opened.session",
  "  }",
  "  if (frame.op === 'sync') {",
  "    const rows = typeof frame.records === 'string' ? JSON.parse(frame.records) : []",
  "    if (!Array.isArray(rows)) throw new TypeError('a sync frame carries a records array')",
  "    if (rows.length > 0) session.view.absorb(rows)",
  "    const outcome = step(mod, session, rows)",
  "    session.view.releaseRecords()",
  "    const queries = Array.isArray(frame.queries) ? frame.queries : []",
  "    const answers = queries.map((query) => mod.answerFoldQuery(session.accumulator, query))",
  "    return replyOf(mod, session, answers, { reloaded: outcome.reloaded, reason: outcome.reason })",
  "  }",
  "  if (frame.op === 'reading') {",
  "    return replyOf(mod, session, [], { reloaded: false })",
  "  }",
  "  if (frame.op === 'checkpoint') {",
  "    const info = mod.writeFoldCheckpoint(session.view, session.accumulator)",
  "    if (info.outcome === 'saved' && typeof info.prefixEndSeq === 'number') session.checkpointPrefix = info.prefixEndSeq",
  "    return replyOf(mod, session, [], { reloaded: false, checkpoint: info })",
  "  }",
  "  if (frame.op === 'snapshot') {",
  "    return replyOf(mod, session, [], { reloaded: false, stateJson: JSON.stringify(mod.finishTeamFold(session.accumulator)) })",
  "  }",
  "  if (frame.op === 'status') {",
  "    return replyOf(mod, session, [], { reloaded: false, rssBytes: process.memoryUsage().rss })",
  "  }",
  "  if (frame.op === 'dispose') {",
  "    ledgers.delete(frame.dir)",
  "    return replyOf(mod, session, [], { reloaded: false })",
  "  }",
  "  throw new Error('unknown fold worker op: ' + String(frame.op))",
  "}",
  "parentPort.on('message', (message) => {",
  "  let parsed",
  "  try { parsed = JSON.parse(message) } catch (error) { parentPort.postMessage(JSON.stringify({ id: -1, reply: failed('frame is not JSON: ' + String(error && error.message ? error.message : error)) })); return }",
  "  const id = typeof parsed.id === 'number' ? parsed.id : -1",
  "  let frame",
  "  try { frame = JSON.parse(parsed.frame) } catch (error) { parentPort.postMessage(JSON.stringify({ id, reply: failed('frame payload is not JSON: ' + String(error && error.message ? error.message : error)) })); return }",
  "  handle(frame).then(",
  "    (reply) => { parentPort.postMessage(JSON.stringify({ id, reply })) },",
  "    (error) => { parentPort.postMessage(JSON.stringify({ id, reply: failed(error) })) },",
  "  )",
  "})"
].join("\n");

// plugins/dsh-link-collab/src/index.ts
import { spawn as spawnChild } from "node:child_process";

// plugins/dsh-link-collab/src/status-path.ts
var STATUS_PATH = "/api/dsh-link-collab/status";

// plugins/dsh-link-collab/src/bus-status.ts
function busStatus(input) {
  return {
    ok: true,
    path: input.path,
    at: input.at,
    ledger: {
      records: input.records,
      lastSeq: input.log.lastSeq,
      writer: input.log.writer,
      instance: input.log.instance,
      damage: input.log.damage === null ? null : {
        brokenLines: input.log.damage.brokenLines.length,
        lastGoodSeq: input.log.damage.lastGoodSeq,
        bytes: input.log.damage.bytes
      }
    },
    world: {
      teams: input.teams,
      members: input.counts.members,
      tasks: input.counts.tasks,
      folded: input.counts.folded,
      unknown: input.counts.unknown
    },
    relay: input.relay,
    messages: input.messages,
    recorded: {
      seen: input.recorded.seen,
      recorded: input.recorded.recorded,
      ignored: input.recorded.ignored,
      failed: input.recorded.failed
    }
  };
}

// plugins/dsh-link-collab/src/compute-engine.ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
function emptyDiagnostics(mode) {
  return {
    mode,
    enabled: mode === "native-shadow",
    runs: 0,
    calls: 0,
    skipped: 0,
    overlapped: 0,
    oversizeSkips: 0,
    cacheHits: 0,
    diffs: 0,
    firstDiff: null,
    lastMs: 0,
    failures: 0,
    lastError: null,
    disabledReason: null,
    computeKind: "none"
  };
}
function resolveFoldEngine(config) {
  const requested = config?.fold?.engine;
  if (requested === void 0 || requested === "ts") return { engine: "ts", reason: "default: TypeScript fold (native shadow off)" };
  if (requested === "native-shadow") return { engine: "native-shadow", reason: "configured: native index runs as a shadow comparison only" };
  throw new TypeError("dsh-link-collab: fold.engine must be 'ts' or 'native-shadow'; got " + String(requested));
}
function compareState(state, snapshotJson) {
  const snapshot = JSON.parse(snapshotJson);
  const collabMembers = /* @__PURE__ */ new Map();
  for (const member of state.members ?? []) collabMembers.set(String(member.id), { team: member.team ?? null, state: member.state ?? null });
  const computeMembers = /* @__PURE__ */ new Map();
  for (const member of snapshot.members ?? []) computeMembers.set(String(member.id), { team: member.team ?? null, state: member.state ?? null });
  const collabTasks = /* @__PURE__ */ new Map();
  for (const task of state.tasks ?? []) collabTasks.set(String(task.id), { team: task.team ?? null, owner: task.owner ?? null, status: task.status ?? null });
  const computeTasks = /* @__PURE__ */ new Map();
  for (const task of snapshot.tasks ?? []) computeTasks.set(String(task.id), { team: task.team ?? null, owner: task.owner ?? null, state: task.state ?? null });
  const collabTeams = /* @__PURE__ */ new Map();
  for (const node of state.teams?.teams ?? []) collabTeams.set(String(node.id ?? node.team), { parent: node.parent ?? null, lead: node.lead ?? null });
  const computeTeams = /* @__PURE__ */ new Map();
  for (const node of snapshot.teams ?? []) computeTeams.set(String(node.team), { parent: node.parent ?? null, lead: node.lead ?? null });
  let diffs = 0;
  let firstDiff = null;
  const check = (entity, id, field) => {
    diffs += 1;
    if (firstDiff === null) firstDiff = { entity, id, field };
  };
  for (const [id, collab] of collabMembers) {
    const compute = computeMembers.get(id);
    if (compute === void 0) {
      check("member", id, "presence");
      continue;
    }
    if (JSON.stringify(collab.team) !== JSON.stringify(compute.team)) check("member", id, "team");
    if (JSON.stringify(collab.state) !== JSON.stringify(compute.state)) check("member", id, "state");
  }
  for (const id of computeMembers.keys()) if (!collabMembers.has(id)) check("member", id, "presence");
  for (const [id, collab] of collabTasks) {
    const compute = computeTasks.get(id);
    if (compute === void 0) {
      check("task", id, "presence");
      continue;
    }
    if (JSON.stringify(collab.team) !== JSON.stringify(compute.team)) check("task", id, "team");
    if (JSON.stringify(collab.owner) !== JSON.stringify(compute.owner)) check("task", id, "owner");
    if (JSON.stringify(collab.status) !== JSON.stringify(compute.state)) check("task", id, "status");
  }
  for (const id of computeTasks.keys()) if (!collabTasks.has(id)) check("task", id, "presence");
  for (const [id, collab] of collabTeams) {
    const compute = computeTeams.get(id);
    if (compute === void 0) {
      check("team", id, "presence");
      continue;
    }
    if (JSON.stringify(collab.parent) !== JSON.stringify(compute.parent)) check("team", id, "parent");
    if (JSON.stringify(collab.lead) !== JSON.stringify(compute.lead)) check("team", id, "lead");
  }
  for (const id of computeTeams.keys()) if (!collabTeams.has(id)) check("team", id, "presence");
  return { diffs, firstDiff };
}
function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0;
}
function createComputeShadow(options) {
  const sampleEvery = options.sampleEvery ?? 20;
  const sampleIntervalMs = options.sampleIntervalMs ?? 2e3;
  const shadowMaxBytes = options.shadowMaxBytes ?? 8 * 1024 * 1024;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((task) => {
    setTimeout(task, 0);
  });
  const diagnostics = emptyDiagnostics("native-shadow");
  const sampleTimes = [];
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  let lastKey = "";
  let lastSnapshot = null;
  let sampleInFlight = false;
  let pendingState = null;
  let pendingScheduled = false;
  let disposed = false;
  const sample = () => {
    if (disposed) return;
    sampleInFlight = true;
    const began = now();
    try {
      const service = options.getService();
      if (service === null || typeof service !== "object") {
        diagnostics.failures += 1;
        diagnostics.lastError = "linkCompute is not mounted (compute row disabled or absent)";
        return;
      }
      const facade = service;
      if (typeof facade.openFoldIndex !== "function") {
        diagnostics.failures += 1;
        diagnostics.lastError = "linkCompute publishes no openFoldIndex";
        return;
      }
      const path = join(options.directory, "control.jsonl");
      const stat = statSync(path);
      if (stat.size > shadowMaxBytes) {
        diagnostics.oversizeSkips += 1;
        diagnostics.enabled = false;
        diagnostics.disabledReason = "ledger exceeds shadowMaxBytes (" + String(stat.size) + " > " + String(shadowMaxBytes) + ")";
        return;
      }
      const key = String(stat.size) + ":" + String(stat.mtimeMs);
      let snapshotJson = lastSnapshot;
      if (key !== lastKey || snapshotJson === null) {
        const bytes = readFileSync(path);
        const index = facade.openFoldIndex();
        const chunk = 500 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunk) {
          index.appendRecords(bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
        }
        snapshotJson = index.snapshot();
        lastSnapshot = snapshotJson;
        lastKey = key;
      } else {
        diagnostics.cacheHits += 1;
      }
      diagnostics.computeKind = facade.kind === "native" ? "native" : "typescript";
      diagnostics.runs += 1;
      const comparison = compareState(pendingState ?? {}, snapshotJson);
      diagnostics.diffs = comparison.diffs;
      diagnostics.firstDiff = comparison.firstDiff;
      diagnostics.lastMs = now() - began;
      sampleTimes.push(diagnostics.lastMs);
      if (sampleTimes.length > 64) sampleTimes.shift();
    } catch (error) {
      diagnostics.failures += 1;
      diagnostics.lastError = error instanceof Error ? error.message : String(error);
      diagnostics.lastMs = now() - began;
    } finally {
      sampleInFlight = false;
    }
  };
  return {
    observe(state) {
      if (disposed) return;
      diagnostics.calls += 1;
      const firstSample = diagnostics.runs === 0 && !sampleInFlight && !pendingScheduled;
      if (diagnostics.enabled && firstSample) {
        lastSampleAt = now();
        pendingState = state;
        pendingScheduled = true;
        schedule(() => {
          pendingScheduled = false;
          sample();
        });
        return;
      }
      if (diagnostics.calls % sampleEvery !== 0) {
        diagnostics.skipped += 1;
        return;
      }
      if (sampleInFlight || pendingScheduled) {
        diagnostics.overlapped += 1;
        return;
      }
      if (now() - lastSampleAt < sampleIntervalMs) {
        diagnostics.skipped += 1;
        return;
      }
      lastSampleAt = now();
      pendingState = state;
      pendingScheduled = true;
      schedule(() => {
        pendingScheduled = false;
        sample();
      });
    },
    dispose() {
      disposed = true;
      pendingScheduled = false;
      pendingState = null;
    },
    diagnostics() {
      const sorted = sampleTimes.slice().sort((left, right) => left - right);
      const max = sorted.length === 0 ? 0 : sorted[sorted.length - 1] ?? 0;
      return {
        ...diagnostics,
        enabled: disposed ? false : diagnostics.enabled,
        disabledReason: disposed ? "disposed" : diagnostics.disabledReason,
        firstDiff: diagnostics.firstDiff === null ? null : { ...diagnostics.firstDiff },
        sampleP50Ms: percentile(sorted, 0.5),
        sampleP99Ms: percentile(sorted, 0.99),
        sampleMaxMs: max
      };
    }
  };
}
var SHADOWS = /* @__PURE__ */ new Map();
function computeShadowFor(options) {
  const existing = SHADOWS.get(options.directory);
  if (existing !== void 0) return existing;
  const created = createComputeShadow(options);
  SHADOWS.set(options.directory, created);
  return created;
}
function computeShadowDiagnostics() {
  return [...SHADOWS.values()].map((shadow) => shadow.diagnostics());
}
function disposeComputeShadow(directory) {
  const shadow = SHADOWS.get(directory);
  if (shadow === void 0) return;
  shadow.dispose();
  SHADOWS.delete(directory);
}

// plugins/dsh-link-collab/src/index.ts
var name = "dsh-link-collab";
var RelayError = class extends Error {
  /**
   * @param code - `RELAY_GAP` for a batch that starts after a hole, `RELAY_HOLE` for a batch that
   * contains one, `RELAY_WRITER_MISSING` for a batch that names no writer or instance,
   * `RELAY_REWRITTEN` for a writer name already held under another instance without `adopt`,
   * `RELAY_CONFLICT` for a record whose content differs from the one already applied at that
   * position, `RELAY_MALFORMED` for a batch whose records do not carry distinct positive integer
   * sequences, and `RELAY_IMPERSONATION` for a batch that claims this log's own identity —
   * including this log's own writer name under another instance, which `adopt` does not exempt.
   * @param message - what happened, in terms of the sequences involved.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RelayError";
  }
};
var RELAY_BODY_LIMIT = 4 * 1024 * 1024;
var RELAY_PATH = "/api/dsh-link-collab/relay";
function sameSecret(present, expected) {
  const left = createHash("sha256").update(present).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
function answer(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
async function pushBatch(url, token, batch, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(timeoutMs ?? 1e4)
  });
  const parsed = await response.json().catch(() => null);
  return {
    ok: parsed?.ok === true,
    appended: Number(parsed?.appended ?? 0),
    skipped: Number(parsed?.skipped ?? 0),
    ...typeof parsed?.code === "string" ? { code: parsed.code } : {}
  };
}
function createRelayEndpoint(options) {
  const requested = typeof options?.token === "string" ? options.token : "";
  if (requested.trim() === "") throw new TypeError("createRelayEndpoint: token must be a non-empty secret");
  const log = options.log;
  if (log === null || typeof log?.ingest !== "function") throw new TypeError("createRelayEndpoint: log must be an open control log");
  const token = requested;
  const path = options.path ?? RELAY_PATH;
  const handler = async (req, res) => {
    const refuse = (status, code, detail) => {
      answer(res, status, detail === void 0 ? { ok: false, code } : { ok: false, code, error: detail });
      return { ok: false, code };
    };
    const authorization = req.headers.authorization;
    const presented = typeof authorization === "string" && /^bearer[ \t]+/i.test(authorization) ? authorization.replace(/^bearer[ \t]+/i, "") : null;
    if (presented === null || !sameSecret(presented, token)) return refuse(401, "UNAUTHORIZED");
    if (req.method !== "POST") return refuse(405, "METHOD");
    const contentType = String(req.headers["content-type"] ?? "");
    if (!/^application\/json\b/i.test(contentType)) return refuse(415, "CONTENT_TYPE");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = chunk;
      size += buffer.length;
      if (size > RELAY_BODY_LIMIT) {
        res.setHeader("connection", "close");
        return refuse(413, "TOO_LARGE");
      }
      chunks.push(buffer);
    }
    let batch;
    try {
      batch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return refuse(400, "RELAY_MALFORMED", "the body is not JSON");
    }
    const rows = batch?.records;
    if (!Array.isArray(rows)) return refuse(400, "RELAY_MALFORMED", "the body carries no records array");
    try {
      const result = await log.ingest(batch);
      answer(res, 200, { ok: true, appended: result.appended, skipped: result.skipped });
      return { ok: true, appended: result.appended, skipped: result.skipped };
    } catch (error) {
      const code = error?.code ?? "RELAY_REFUSED";
      return refuse(400, code, String(error?.message ?? error));
    }
  };
  return {
    path,
    handler,
    relayTo: (url, batch, push) => pushBatch(url, push?.token ?? token, batch, push?.timeoutMs)
  };
}
var LOCK = ".writer";
var LOCK_HEARTBEAT_MS = 5e3;
var LOCK_STALE_MS = 3e4;
var INSTANCE = ".instance";
function canonical(value) {
  let persisted;
  try {
    persisted = JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return "<unrepresentable>";
  }
  const render = (node) => {
    if (node === null || typeof node !== "object") return JSON.stringify(node) ?? "null";
    if (Array.isArray(node)) return "[" + node.map(render).join(",") + "]";
    const source = node;
    return "{" + Object.keys(source).sort().map((key) => JSON.stringify(key) + ":" + render(source[key])).join(",") + "}";
  };
  return render(persisted);
}
var ATTACKS = "DSH_LINK_COLLAB_ATTACKS";
function attackFlag(name2) {
  return process.env[ATTACKS] === "1" && process.env[name2] === "1";
}
var TRACE = "DSH_LINK_COLLAB_TRACE";
function traceEnabled() {
  const value = process.env[TRACE];
  return value !== void 0 && value !== "" && value !== "0";
}
if (process.env[ATTACKS] === "1") {
  console.error("[dsh-link-collab] FAULT INJECTION ARMED: " + ATTACKS + "=1 \u2014 test switches are live in this process");
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
var LEDGER_STAMP_FILE = "control.stamp.json";
var LEDGER_STAMP_FORMAT = "dsh-link.collab.ledger-stamp/1";
var LEDGER_STAMP_VERSION = 1;
var STAMP_SUFFIX_MAX_BYTES = 64 * 1024 * 1024;
var STAMP_NUL = String.fromCharCode(0);
var STAMP_NEWLINE = String.fromCharCode(10);
function ledgerStampChecksum(body) {
  return createHash("sha256").update(body.format + STAMP_NUL + String(body.version)).update(STAMP_NUL + body.instance).update(STAMP_NUL + body.identity).update(STAMP_NUL + String(body.bytes)).update(STAMP_NUL + String(body.lines)).update(STAMP_NUL + String(body.records)).update(STAMP_NUL + String(body.lastSeq)).update(STAMP_NUL + body.digest).update(STAMP_NUL + body.mtimeNs).update(STAMP_NUL + String(body.verifiedAt)).digest("hex");
}
var stampSequence = 0;
function readLedgerStamp(directory) {
  const path = join2(directory, LEDGER_STAMP_FILE);
  let raw;
  try {
    raw = readFileSync2(path, "utf8");
  } catch {
    return { stamp: null, present: false, reason: "no-stamp-file" };
  }
  FOLD_STATS.stampsRead += 1;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { stamp: null, present: true, reason: "stamp-unreadable" };
  }
  if (parsed === null || typeof parsed !== "object") return { stamp: null, present: true, reason: "stamp-not-a-document" };
  const seen = parsed;
  if (seen.format !== LEDGER_STAMP_FORMAT) return { stamp: null, present: true, reason: "stamp-foreign-format" };
  if (seen.version !== LEDGER_STAMP_VERSION) return { stamp: null, present: true, reason: "stamp-format-version" };
  if (typeof seen.instance !== "string" || typeof seen.identity !== "string" || typeof seen.digest !== "string" || typeof seen.mtimeNs !== "string" || typeof seen.checksum !== "string" || typeof seen.bytes !== "number" || !Number.isInteger(seen.bytes) || seen.bytes < 0 || typeof seen.lines !== "number" || !Number.isInteger(seen.lines) || seen.lines < 0 || typeof seen.records !== "number" || !Number.isInteger(seen.records) || seen.records < 0 || typeof seen.lastSeq !== "number" || !Number.isInteger(seen.lastSeq) || seen.lastSeq < 0 || typeof seen.verifiedAt !== "number" || !Number.isFinite(seen.verifiedAt) || typeof seen.writtenAt !== "number" || !Number.isFinite(seen.writtenAt)) {
    return { stamp: null, present: true, reason: "stamp-malformed" };
  }
  const body = {
    format: seen.format,
    version: seen.version,
    instance: seen.instance,
    identity: seen.identity,
    bytes: seen.bytes,
    lines: seen.lines,
    records: seen.records,
    lastSeq: seen.lastSeq,
    digest: seen.digest,
    mtimeNs: seen.mtimeNs,
    verifiedAt: seen.verifiedAt
  };
  if (ledgerStampChecksum(body) !== seen.checksum) return { stamp: null, present: true, reason: "stamp-checksum-mismatch" };
  const stamp = { ...body, writtenAt: seen.writtenAt, checksum: seen.checksum };
  return { stamp, present: true, reason: null };
}
function writeLedgerStamp(directory, body) {
  const path = join2(directory, LEDGER_STAMP_FILE);
  stampSequence += 1;
  const temporary = path + "." + String(process.pid) + "." + String(stampSequence) + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify({ ...body, checksum: ledgerStampChecksum(body), writtenAt: Date.now() }), "utf8");
    renameSync(temporary, path);
    return null;
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
    }
    return String(error?.message ?? error);
  }
}
function discardLedgerStamp(directory) {
  try {
    rmSync(join2(directory, LEDGER_STAMP_FILE), { force: true });
  } catch {
  }
}
var STAMP_WRITERS = /* @__PURE__ */ new WeakMap();
function parseControlText(text, options = {}) {
  const firstLine = options.firstLine ?? 0;
  const records = [];
  const brokenLines = [];
  const lines = text.split(STAMP_NEWLINE);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.seq !== "number" || !Number.isInteger(parsed.seq)) throw new Error("record without an integer sequence");
      records.push(parsed);
    } catch {
      brokenLines.push(firstLine + index + 1);
    }
  }
  records.sort((left, right) => left.seq - right.seq);
  const lastSeq = records.length > 0 ? records[records.length - 1]?.seq ?? 0 : 0;
  return {
    records,
    brokenLines,
    lastSeq,
    lines: lines.length - 1,
    bytes: Buffer.byteLength(text),
    hash: options.digest === true ? createHash("sha1").update(text) : null
  };
}
function countNewlines(text) {
  let lines = 0;
  for (let index = text.indexOf(STAMP_NEWLINE); index !== -1; index = text.indexOf(STAMP_NEWLINE, index + 1)) lines += 1;
  return lines;
}
function readControlLedger(path, digest = false) {
  if (!existsSync(path)) return { records: [], damage: null, hash: digest ? createHash("sha1") : null, lineCount: 0, bytes: 0 };
  const text = readFileSync2(path, "utf8");
  const parsed = parseControlText(text, digest ? { digest: true } : {});
  if (parsed.hash !== null) FOLD_STATS.digestsComputed += 1;
  const damage = parsed.brokenLines.length > 0 ? { brokenLines: parsed.brokenLines, lastGoodSeq: parsed.lastSeq, bytes: parsed.bytes } : null;
  return { records: parsed.records, damage, hash: parsed.hash, lineCount: parsed.lines, bytes: parsed.bytes };
}
function readLedgerView(directory) {
  const path = join2(directory, "control.jsonl");
  const ledger = readControlLedger(path, true);
  let records = ledger.records;
  let lastSeq = records.length > 0 ? records[records.length - 1]?.seq ?? 0 : 0;
  const digestHash = ledger.hash;
  const damage = ledger.damage;
  let instance = "";
  try {
    instance = readFileSync2(join2(directory, ".instance"), "utf8").trim();
  } catch {
  }
  const view = {
    directory,
    instance,
    get lastSeq() {
      return lastSeq;
    },
    get digest() {
      return digestHash === null ? "" : digestHash.copy().digest("hex");
    },
    get damage() {
      return damage;
    },
    get records() {
      return records;
    },
    get recordsMaterialised() {
      return records.length > 0;
    },
    page(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      const out = [];
      for (const record of records) {
        if (record.seq <= since) continue;
        out.push(record);
        if (out.length >= limit) break;
      }
      return out;
    },
    replay() {
      return [...records];
    },
    absorb(rows) {
      for (const row of rows) {
        if (typeof row?.seq !== "number" || !Number.isInteger(row.seq)) continue;
        records.push(row);
        if (row.seq > lastSeq) lastSeq = row.seq;
        digestHash?.update(JSON.stringify(row) + STAMP_NEWLINE);
      }
    },
    releaseRecords() {
      records = [];
    }
  };
  return view;
}
function openControlLedgerPlain(path) {
  const ledger = readControlLedger(path, false);
  const lastSeq = ledger.records.length > 0 ? ledger.records[ledger.records.length - 1]?.seq ?? 0 : 0;
  return {
    records: ledger.records,
    complete: true,
    floor: ledger.records.length > 0 ? ledger.records[0]?.seq ?? 1 : lastSeq + 1,
    damage: ledger.damage,
    hash: null,
    digestHex: null,
    verifiedAt: 0,
    lastSeq,
    lines: ledger.lineCount,
    bytes: ledger.bytes,
    count: ledger.records.length,
    tier: ledger.records.length === 0 && ledger.bytes === 0 ? "empty" : "full-parse",
    stampReason: null
  };
}
function streamLedgerDigest(path, prefixBytes, size) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  const whole = createHash("sha1");
  const prefix = createHash("sha1");
  const wholeIsPrefix = prefixBytes === size;
  const buffer = Buffer.allocUnsafe(1 << 20);
  let offset = 0;
  let prefixLines = 0;
  try {
    for (; ; ) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      const chunk = buffer.subarray(0, read);
      whole.update(chunk);
      for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1)) {
        if (offset + index < prefixBytes) prefixLines += 1;
      }
      if (!wholeIsPrefix && offset < prefixBytes) {
        const take = Math.min(read, prefixBytes - offset);
        if (take > 0) prefix.update(chunk.subarray(0, take));
      }
      offset += read;
    }
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
  const wholeHex = whole.copy().digest("hex");
  FOLD_STATS.digestsComputed += 1;
  return {
    hash: whole,
    whole: wholeHex,
    prefix: wholeIsPrefix ? wholeHex : prefix.digest("hex"),
    prefixLines
  };
}
function readLedgerSuffix(path, offset, size) {
  if (offset >= size) return "";
  const length = size - offset;
  if (length > STAMP_SUFFIX_MAX_BYTES) return null;
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const chunk = readSync(fd, buffer, read, length - read, offset + read);
      if (chunk <= 0) break;
      read += chunk;
    }
    if (read !== length) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
function openControlLedgerAccelerated(path, directory, instance) {
  let size = 0;
  let mtimeNs = "0";
  let identity = "unavailable@" + resolve(path);
  try {
    const stats = statSync2(path, { bigint: true });
    size = Number(stats.size);
    mtimeNs = String(stats.mtimeNs);
    identity = String(stats.dev) + ":" + String(stats.ino) + "@" + resolve(path);
  } catch {
    return {
      records: [],
      complete: true,
      floor: 1,
      damage: null,
      hash: createHash("sha1"),
      digestHex: null,
      verifiedAt: Date.now(),
      lastSeq: 0,
      lines: 0,
      bytes: 0,
      count: 0,
      tier: "empty",
      stampReason: null
    };
  }
  const reading = readLedgerStamp(directory);
  const stamp = reading.stamp;
  if (stamp === null && reading.present) {
    FOLD_STATS.stampsIgnored += 1;
    FOLD_STATS.lastStampReason = reading.reason;
    FOLD_STATS.lastStampRefusal = reading.reason;
  }
  const approvedAt = Date.now();
  const binding = (() => {
    if (stamp === null) return reading.reason;
    if (stamp.instance !== instance) return "stamp-instance-changed";
    if (stamp.identity !== identity) return "stamp-identity-changed";
    if (stamp.bytes > size) return "stamp-size-changed";
    return null;
  })();
  if (binding === null && stamp !== null && FOLD_SETTINGS_STATE.fastOpen && stamp.bytes === size && stamp.mtimeNs === mtimeNs && stamp.records === stamp.lastSeq && approvedAt - stamp.verifiedAt <= FOLD_SETTINGS_STATE.stampVerifyMs) {
    FOLD_STATS.stampTrusted += 1;
    return {
      records: null,
      complete: false,
      floor: stamp.lastSeq + 1,
      damage: null,
      hash: null,
      digestHex: stamp.digest,
      verifiedAt: stamp.verifiedAt,
      lastSeq: stamp.lastSeq,
      lines: stamp.lines,
      bytes: stamp.bytes,
      count: stamp.records,
      tier: "stamp-trusted",
      stampReason: "trusted"
    };
  }
  if (binding === null && stamp !== null) {
    const streamed = streamLedgerDigest(path, stamp.bytes, size);
    if (streamed !== null && streamed.prefix === stamp.digest) {
      const suffixText = stamp.bytes === size ? "" : readLedgerSuffix(path, stamp.bytes, size);
      if (suffixText !== null) {
        const suffix = suffixText === "" ? null : parseControlText(suffixText, { firstLine: stamp.lines });
        const suffixRecords = suffix === null ? [] : suffix.records;
        const broken = suffix === null ? [] : suffix.brokenLines;
        const lastSeq2 = Math.max(stamp.lastSeq, suffix?.lastSeq ?? 0);
        FOLD_STATS.stampVerified += 1;
        FOLD_STATS.lastStampReason = null;
        return {
          records: suffixRecords,
          complete: false,
          floor: suffixRecords.length > 0 ? suffixRecords[0]?.seq ?? lastSeq2 + 1 : lastSeq2 + 1,
          damage: broken.length > 0 ? { brokenLines: broken, lastGoodSeq: lastSeq2, bytes: size } : null,
          hash: streamed.hash,
          digestHex: null,
          verifiedAt: approvedAt,
          lastSeq: lastSeq2,
          lines: stamp.lines + (suffix === null ? 0 : suffix.lines),
          bytes: size,
          count: stamp.records + suffixRecords.length,
          tier: "stream-verified",
          stampReason: null
        };
      }
    }
    FOLD_STATS.stampsIgnored += 1;
    FOLD_STATS.lastStampReason = streamed === null ? "stamp-unreadable-file" : "stamp-content-changed";
    FOLD_STATS.lastStampRefusal = FOLD_STATS.lastStampReason;
  } else if (stamp !== null) {
    FOLD_STATS.stampsIgnored += 1;
    FOLD_STATS.lastStampReason = binding;
    FOLD_STATS.lastStampRefusal = binding;
  }
  const ledger = readControlLedger(path, true);
  const lastSeq = ledger.records.length > 0 ? ledger.records[ledger.records.length - 1]?.seq ?? 0 : 0;
  return {
    records: ledger.records,
    complete: true,
    floor: ledger.records.length > 0 ? ledger.records[0]?.seq ?? 1 : lastSeq + 1,
    damage: ledger.damage,
    hash: ledger.hash,
    digestHex: null,
    verifiedAt: approvedAt,
    lastSeq,
    lines: ledger.lineCount,
    bytes: ledger.bytes,
    count: ledger.records.length,
    tier: "full-parse",
    stampReason: FOLD_STATS.lastStampReason
  };
}
function openControlLog(options) {
  const { dir, dataTtlMs = 3e4, dataCapacity = 256 } = options;
  const now = options.now ?? (() => Date.now());
  mkdirSync(dir, { recursive: true });
  const path = join2(dir, "control.jsonl");
  const lockPath = join2(dir, LOCK);
  const localWriter = options.writer ?? "local";
  const instancePath = join2(dir, INSTANCE);
  const localInstance = (() => {
    if (existsSync(instancePath)) {
      const kept = readFileSync2(instancePath, "utf8").trim();
      if (kept !== "") return kept;
    }
    const minted = randomUUID();
    writeFileSync(instancePath, minted + "\n", "utf8");
    return minted;
  })();
  if (!attackFlag("DSH_LINK_COLLAB_NO_LOCK") && existsSync(lockPath)) {
    const raw = readFileSync2(lockPath, "utf8").trim();
    const holder = Number(raw);
    const holdsAPid = /^\d+$/.test(raw) && Number.isFinite(holder) && holder > 0;
    const lockAgeMs = (() => {
      try {
        return Date.now() - statSync2(lockPath).mtimeMs;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    })();
    const beating = lockAgeMs < LOCK_STALE_MS;
    if (holdsAPid && isProcessAlive(holder) && beating && options.reclaim !== true) {
      throw new Error("control log at " + dir + " is already open by process " + String(holder) + " (heartbeat " + String(Math.round(lockAgeMs)) + " ms old, stale after " + String(LOCK_STALE_MS) + " ms)");
    }
    if (holdsAPid && isProcessAlive(holder)) {
      console.log("[dsh-link-collab] reclaiming writer lock " + lockPath + " held by live process " + String(holder) + " because the caller asked for it (reclaim: true)");
    } else {
      console.log("[dsh-link-collab] reclaiming writer lock " + lockPath + " content " + (raw === "" ? "<empty>" : raw) + " names no live writer");
    }
  }
  writeFileSync(lockPath, String(process.pid), "utf8");
  const heartbeat = setInterval(() => {
    try {
      utimesSync(lockPath, /* @__PURE__ */ new Date(), /* @__PURE__ */ new Date());
    } catch {
    }
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref?.();
  const wantDigest = FOLD_SETTINGS_STATE.checkpoint === true;
  const opened = wantDigest ? openControlLedgerAccelerated(path, dir, localInstance) : openControlLedgerPlain(path);
  let records = opened.records;
  let recordsComplete = opened.complete;
  let recordsFloor = opened.floor;
  let damage = opened.damage;
  let digestHash = opened.hash;
  let digestHex = opened.digestHex;
  let digestVerifiedAt = opened.verifiedAt;
  let lineCount = opened.lines;
  let ledgerBytes = opened.bytes;
  let recordCount = opened.count;
  let lastSeq = attackFlag("DSH_LINK_COLLAB_FORGET_SEQ") ? 0 : opened.lastSeq;
  function ensureRecords() {
    if (records !== null && recordsComplete) return records;
    const ledger = readControlLedger(path, digestHash === null);
    if (digestHash === null && ledger.hash !== null) {
      digestHash = ledger.hash;
      digestHex = null;
      digestVerifiedAt = Date.now();
      FOLD_STATS.digestsComputed += 1;
    }
    records = ledger.records;
    recordsComplete = true;
    recordsFloor = records.length > 0 ? records[0]?.seq ?? lastSeq + 1 : lastSeq + 1;
    damage = ledger.damage;
    lineCount = ledger.lineCount;
    ledgerBytes = ledger.bytes;
    recordCount = records.length;
    rebuildMarks();
    return records;
  }
  function currentDigest() {
    if (digestHash !== null) return digestHash.copy().digest("hex");
    if (digestHex !== null) return digestHex;
    const text = readFileSync2(path, "utf8");
    digestHash = createHash("sha1").update(text);
    lineCount = countNewlines(text);
    digestVerifiedAt = Date.now();
    FOLD_STATS.digestsComputed += 1;
    return digestHash.copy().digest("hex");
  }
  let stampScheduled = false;
  const writeStampNow = () => {
    if (!FOLD_SETTINGS_STATE.checkpoint || damage !== null) return;
    if (digestHash === null && digestHex === null) return;
    let size = -1;
    let mtimeNs = "0";
    let identity = "";
    try {
      const stats = statSync2(path, { bigint: true });
      size = Number(stats.size);
      mtimeNs = String(stats.mtimeNs);
      identity = String(stats.dev) + ":" + String(stats.ino) + "@" + resolve(path);
    } catch {
      return;
    }
    if (size !== ledgerBytes) return;
    const failure = writeLedgerStamp(dir, {
      format: LEDGER_STAMP_FORMAT,
      version: LEDGER_STAMP_VERSION,
      instance: localInstance,
      identity,
      bytes: size,
      lines: lineCount,
      records: recordCount,
      lastSeq,
      digest: currentDigest(),
      mtimeNs,
      verifiedAt: digestVerifiedAt
    });
    if (failure === null) {
      FOLD_STATS.stampsWritten += 1;
      FOLD_STATS.lastStampReason = null;
    } else {
      FOLD_STATS.lastStampReason = "stamp-write-failed: " + failure;
    }
  };
  const scheduleStamp = () => {
    if (stampScheduled || !FOLD_SETTINGS_STATE.checkpoint) return;
    stampScheduled = true;
    const handle = setImmediate(() => {
      stampScheduled = false;
      try {
        writeStampNow();
      } catch {
      }
    });
    handle.unref?.();
  };
  const stream = createWriteStream(path, { flags: "a" });
  stream.on("error", () => {
  });
  const data = /* @__PURE__ */ new Map();
  let closed = false;
  let closing = false;
  let pending = 0;
  let queue = Promise.resolve();
  const serialise = (work) => {
    const next = queue.then(work);
    queue = next.then(() => void 0, () => void 0);
    return next;
  };
  const admit = (work) => {
    if (closed || closing) return Promise.reject(new Error("control log is closed"));
    return serialise(work);
  };
  const drained = () => new Promise((done) => {
    if (pending === 0) {
      done();
      return;
    }
    const check = () => {
      if (pending === 0) done();
      else setTimeout(check, 1);
    };
    check();
  });
  const sweep = () => {
    const deadline = now() - dataTtlMs;
    for (const [key, entries] of data) {
      const live = entries.filter((entry) => entry.at >= deadline);
      if (live.length === 0) data.delete(key);
      else if (live.length !== entries.length) data.set(key, live);
    }
  };
  const seqOnly = attackFlag("DSH_LINK_COLLAB_RELAY_SEQ_ONLY");
  const nameOnly = attackFlag("DSH_LINK_COLLAB_RELAY_NAME_ONLY");
  const keyOf = (name2, instance) => seqOnly ? "" : nameOnly ? name2 : name2 + "\0" + instance;
  const marks = /* @__PURE__ */ new Map();
  const identOf = (instance) => nameOnly ? "*" : instance;
  const knownInstances = /* @__PURE__ */ new Map();
  const know = (name2, instance) => {
    knownInstances.set(name2, (knownInstances.get(name2) ?? /* @__PURE__ */ new Set()).add(identOf(instance)));
  };
  const rebuildMarks = () => {
    marks.clear();
    knownInstances.clear();
    for (const record2 of records ?? []) {
      const name2 = record2.writer ?? localWriter;
      const instance = record2.instance ?? localInstance;
      const key = keyOf(name2, instance);
      know(name2, instance);
      const previous = marks.get(key);
      const seq = record2.originSeq ?? record2.seq;
      marks.set(key, { writer: name2, instance, lastSeq: Math.max(previous?.lastSeq ?? 0, seq), records: (previous?.records ?? 0) + 1 });
    }
  };
  if (recordsComplete) rebuildMarks();
  const ownNext = (writer, instance) => {
    const mark = marks.get(keyOf(writer, instance));
    return Math.max(mark?.records ?? 0, mark?.lastSeq ?? 0) + 1;
  };
  const writeNow = (record2, writer, instance, originSeq) => new Promise((done, fail) => {
    if (closed) {
      fail(new Error("control log is closed"));
      return;
    }
    lastSeq += 1;
    const entry = {
      seq: lastSeq,
      channel: "control",
      at: record2.at ?? now(),
      kind: record2.kind,
      writer,
      instance,
      originSeq: originSeq ?? ownNext(writer, instance),
      ...record2.actor === void 0 ? {} : { actor: record2.actor },
      ...record2.subject === void 0 ? {} : { subject: record2.subject },
      ...record2.payload === void 0 ? {} : { payload: record2.payload }
    };
    let line;
    try {
      line = JSON.stringify(entry) + "\n";
    } catch (error) {
      lastSeq -= 1;
      fail(error);
      return;
    }
    pending += 1;
    stream.write(line, (error) => {
      pending -= 1;
      if (error) {
        lastSeq -= 1;
        fail(error);
      } else {
        if (records !== null) records.push(entry);
        if (digestHash !== null) digestHash.update(line);
        lineCount += 1;
        ledgerBytes += Buffer.byteLength(line);
        recordCount += 1;
        const key = keyOf(writer, instance);
        know(writer, instance);
        const previous = marks.get(key);
        marks.set(key, { writer, instance, lastSeq: Math.max(previous?.lastSeq ?? 0, entry.originSeq ?? entry.seq), records: (previous?.records ?? 0) + 1 });
        scheduleStamp();
        done(entry.seq);
      }
    });
  });
  const record = {
    append(record2) {
      return admit(() => {
        ensureRecords();
        return writeNow(record2, localWriter, localInstance, null);
      });
    },
    ingest(batch) {
      return admit(async () => {
        const held = ensureRecords();
        if (typeof batch?.writer !== "string" || batch.writer === "" || typeof batch?.instance !== "string" || batch.instance === "") {
          throw new RelayError("RELAY_WRITER_MISSING", "a relay batch must name its writer and its instance");
        }
        if (batch.writer === localWriter && batch.instance === localInstance) {
          throw new RelayError("RELAY_IMPERSONATION", "a batch from " + batch.writer + "/" + batch.instance + " claims this log's own identity; a peer must relay under its own name and instance");
        }
        if (batch.writer === localWriter) {
          throw new RelayError("RELAY_IMPERSONATION", "a batch from " + batch.writer + "/" + batch.instance + " carries this log's own writer name under another instance; adopting it would merge a second end's history into this log's own stream");
        }
        const known = knownInstances.get(batch.writer) ?? /* @__PURE__ */ new Set();
        const seen = known.has(identOf(batch.instance));
        if (!seen && known.size > 0 && batch.adopt !== true) {
          throw new RelayError("RELAY_REWRITTEN", "writer " + batch.writer + " is already held as instance " + [...known].join(", ") + "; a log that starts over must be adopted explicitly (adopt: true)");
        }
        if (!seen && known.size > 0) {
          console.log("[dsh-link-collab] adopting a rebuilt log: " + batch.writer + " " + [...known].join(", ") + " -> " + batch.instance + "; earlier records stay, and the old stream stays idempotent");
        }
        know(batch.writer, batch.instance);
        const manifestRows = batch.records.filter((row) => row?.kind === MANIFEST_KIND);
        if (manifestRows.length > 0 && (declaresItself(held, batch.writer) || manifestRows.some((row) => manifestEndOf(row) === batch.writer))) {
          const speaking = manifestRows.find((row) => manifestEndOf(row) !== null && manifestEndOf(row) !== batch.writer) ?? null;
          if (speaking !== null) {
            throw new ManifestRefusal("MANIFEST_NOT_AUTHORIZED", "batch from " + batch.writer + " carries an end/manifest row for " + describeValue(manifestEndOf(speaking)) + ", and " + describeValue(batch.writer) + " declared a manifest of its own; a manifest row may only be written by the end it names, so an end may declare itself and nobody else (nothing was appended)");
          }
        }
        for (const row of batch.records) {
          if (!Number.isInteger(row?.seq) || row.seq < 1) {
            throw new RelayError("RELAY_MALFORMED", "batch from " + batch.writer + " carries a record whose seq is " + JSON.stringify(row?.seq ?? null) + ", not a positive integer");
          }
        }
        const incoming = [...batch.records].sort((left, right) => left.seq - right.seq);
        for (let index = 1; index < incoming.length; index += 1) {
          if (incoming[index].seq === incoming[index - 1].seq) {
            throw new RelayError("RELAY_MALFORMED", "batch from " + batch.writer + " carries sequence " + String(incoming[index].seq) + " twice");
          }
          if (incoming[index].seq !== incoming[index - 1].seq + 1) {
            throw new RelayError("RELAY_HOLE", "batch from " + batch.writer + " skips from " + String(incoming[index - 1].seq) + " to " + String(incoming[index].seq));
          }
        }
        const have = marks.get(keyOf(batch.writer, batch.instance))?.lastSeq ?? 0;
        const applied = /* @__PURE__ */ new Map();
        const positionKey = (candidate) => String(candidate.writer ?? localWriter) + "\0" + String(candidate.instance ?? localInstance) + "\0" + String(candidate.originSeq ?? candidate.seq);
        const byPosition = /* @__PURE__ */ new Map();
        for (const candidate of held) {
          const key = positionKey(candidate);
          if (byPosition.has(key) === false) byPosition.set(key, candidate);
        }
        for (const row of incoming) {
          if (row.seq > have) break;
          if (!applied.has(String(row.seq))) {
            const stored2 = byPosition.get(positionKey({ writer: batch.writer, instance: batch.instance, originSeq: row.seq }));
            if (stored2 !== void 0) applied.set(String(row.seq), stored2);
          }
          const stored = applied.get(String(row.seq));
          if (stored === void 0) continue;
          const same = stored.kind === row.kind && String(stored.actor ?? "") === String(row.actor ?? "") && String(stored.subject ?? "") === String(row.subject ?? "") && canonical(stored.payload) === canonical(row.payload);
          if (!same) {
            throw new RelayError("RELAY_CONFLICT", "record " + String(row.seq) + " from " + batch.writer + "/" + batch.instance + " contradicts the record this log already applied at that position");
          }
        }
        const fresh = incoming.filter((row) => row.seq > have);
        if (fresh.length === 0) return { writer: batch.writer, appended: 0, skipped: incoming.length };
        if (fresh[0].seq !== have + 1) {
          throw new RelayError("RELAY_GAP", "batch from " + batch.writer + " starts at " + String(fresh[0].seq) + " but this log holds up to " + String(have));
        }
        let appended = 0;
        for (const row of fresh) {
          await writeNow(
            {
              kind: row.kind,
              ...row.actor === void 0 ? {} : { actor: row.actor },
              ...row.subject === void 0 ? {} : { subject: row.subject },
              ...row.payload === void 0 ? {} : { payload: row.payload },
              ...row.at === void 0 ? {} : { at: row.at }
            },
            seqOnly ? localWriter : batch.writer,
            seqOnly ? localInstance : batch.instance,
            row.seq
          );
          appended += 1;
        }
        return { writer: batch.writer, appended, skipped: incoming.length - fresh.length };
      });
    },
    marks() {
      ensureRecords();
      return [...marks.values()].map((mark) => ({ ...mark }));
    },
    ownPage(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      ensureRecords();
      const out = [];
      for (const record2 of records ?? []) {
        if ((record2.writer ?? localWriter) !== localWriter) continue;
        if ((record2.instance ?? localInstance) !== localInstance) continue;
        if ((record2.originSeq ?? record2.seq) <= since) continue;
        out.push(record2);
        if (out.length >= limit) break;
      }
      return out;
    },
    writer: localWriter,
    instance: localInstance,
    page(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      if (!recordsComplete) {
        if (records === null) {
          if (since >= lastSeq) return [];
          ensureRecords();
        } else if (since < recordsFloor - 1) {
          ensureRecords();
        }
      }
      const out = [];
      for (const record2 of records ?? []) {
        if (record2.seq <= since) continue;
        out.push(record2);
        if (out.length >= limit) break;
      }
      return out;
    },
    replay() {
      ensureRecords();
      return [...records ?? []];
    },
    get lastSeq() {
      return lastSeq;
    },
    get digest() {
      return currentDigest();
    },
    directory: dir,
    get damage() {
      return damage;
    },
    get recordsMaterialised() {
      return recordsComplete;
    },
    get openTier() {
      return opened.tier;
    },
    put(key, entry) {
      if (closed) throw new Error("control log is closed");
      const list = data.get(key) ?? [];
      list.push({ channel: "data", at: entry.at ?? now(), kind: entry.kind, ...entry.payload === void 0 ? {} : { payload: entry.payload } });
      if (list.length > dataCapacity) list.splice(0, list.length - dataCapacity);
      data.set(key, list);
      sweep();
    },
    take(key) {
      sweep();
      return [...data.get(key) ?? []];
    },
    dataSize() {
      sweep();
      let total = 0;
      for (const entries of data.values()) total += entries.length;
      return total;
    },
    async close() {
      closing = true;
      await queue.catch(() => void 0);
      closed = true;
      await drained();
      if (FOLD_SETTINGS_STATE.checkpoint) {
        try {
          writeStampNow();
        } catch {
        }
      }
      STAMP_WRITERS.delete(record);
      await new Promise((done) => {
        stream.end(done);
      });
      try {
        clearInterval(heartbeat);
        rmSync(lockPath, { force: true });
      } catch {
      }
    }
  };
  STAMP_WRITERS.set(record, writeStampNow);
  if (FOLD_SETTINGS_STATE.checkpoint) {
    if (damage === null && recordCount > 0 && opened.tier !== "stamp-trusted") writeStampNow();
    else if (damage !== null) discardLedgerStamp(dir);
  }
  return record;
}
function boardKey(team, id) {
  return attackFlag("DSH_LINK_COLLAB_DROP_TEAM_KEY") ? id : (team ?? "") + "\0" + id;
}
function teamOf(record) {
  const payload = record.payload;
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  return text(record.actor) ?? text(payload?.teamId) ?? text(payload?.team);
}
function foldClaim(previous, incoming) {
  if (previous.at !== null && incoming.at !== null) {
    return {
      incomingWins: incoming.at > previous.at || incoming.at === previous.at && incoming.seq > previous.seq,
      byAt: incoming.at !== previous.at
    };
  }
  return { incomingWins: incoming.seq > previous.seq, byAt: false };
}
var byKey = (left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
function resolveDep(team, declared) {
  return declared.includes("\0") ? declared : boardKey(team, declared);
}
var LOCK_KIND = "lock/state";
function lockRecord(taskId, holder, at, team) {
  if (typeof taskId !== "string" || taskId === "") throw new TypeError("lockRecord: taskId must be a non-empty string");
  if (holder !== null && (typeof holder !== "string" || holder === "")) throw new TypeError("lockRecord: holder must be null or a non-empty string");
  if (!Number.isFinite(at)) throw new TypeError("lockRecord: at must be a finite number of milliseconds");
  if (team !== void 0 && team !== null && (typeof team !== "string" || team === "")) throw new TypeError("lockRecord: team must be omitted, null, or a non-empty string");
  return { kind: LOCK_KIND, subject: taskId, payload: { task: taskId, holder, at, team: team === void 0 || team === null ? null : team } };
}
var ORDERED = /* @__PURE__ */ new WeakMap();
function orderedRecords(records) {
  const last = records[records.length - 1];
  const lastSeq = last === void 0 ? void 0 : last.seq;
  const cached = ORDERED.get(records);
  if (cached !== void 0 && cached.length === records.length && cached.lastSeq === lastSeq) return cached.ordered;
  let ordered = records;
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    if (previous === void 0 || current === void 0) continue;
    if (previous.seq > current.seq) {
      ordered = [...records].sort((left, right) => left.seq - right.seq);
      break;
    }
  }
  ORDERED.set(records, { length: records.length, lastSeq, ordered });
  return ordered;
}
function emptyLocksFold() {
  return { latest: /* @__PURE__ */ new Map() };
}
function foldLocks(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== LOCK_KIND) continue;
    const payload = record.payload;
    const id = typeof payload?.task === "string" && payload.task !== "" ? payload.task : record.subject;
    if (typeof id !== "string" || id === "") continue;
    if (typeof payload?.at !== "number" || !Number.isFinite(payload.at)) continue;
    const raw = payload?.holder;
    const holder = typeof raw === "string" && raw !== "" ? raw : null;
    const team = teamOf(record);
    const key = boardKey(team, id);
    state.latest.set(key, { key, id, team, holder, at: payload.at, seq: record.seq });
  }
}
function finishLocks(state) {
  return [...state.latest.values()].sort(byKey);
}
function projectLocks(records) {
  const state = emptyLocksFold();
  foldLocks(state, records);
  return finishLocks(state);
}
function lockHolder(state, key, now, options) {
  const row = state.locks.find((lock) => lock.key === key);
  if (row === void 0) return { task: key, holder: null, sinceMs: null, expired: false };
  const sinceMs = Math.max(0, now - row.at);
  const expired = sinceMs >= options.ttlMs;
  return { task: key, holder: expired || row.holder === null ? null : row.holder, sinceMs, expired };
}
var DONE_STATUSES = ["completed", "done"];
var KNOWN_STATUSES = ["pending", "in_progress", "pending-claim", ...DONE_STATUSES, "deleted"];
function emptyBoardFold() {
  return { latest: /* @__PURE__ */ new Map(), unknown: 0 };
}
function foldBoard(state, records) {
  const order = orderedRecords(records);
  for (const record of order) {
    if (record.kind !== TASK_KIND) continue;
    const payload = record.payload;
    const id = typeof payload?.id === "string" && payload.id !== "" ? payload.id : record.subject;
    if (typeof id !== "string" || id === "") continue;
    const status = typeof payload?.state === "string" && payload.state !== "" ? payload.state : "unknown";
    if (!KNOWN_STATUSES.includes(status)) state.unknown += 1;
    const team = teamOf(record);
    const key = boardKey(team, id);
    const previous = state.latest.get(key);
    const declared = Array.isArray(payload?.deps) ? [...new Set(payload.deps.filter((dep) => typeof dep === "string" && dep !== ""))].sort() : null;
    const declaredDeps = declared ?? previous?.declaredDeps ?? [];
    const incoming = {
      status,
      owner: typeof payload?.owner === "string" && payload.owner !== "" ? payload.owner : null,
      at: record.at ?? null,
      seq: record.seq
    };
    const writers = new Set(previous?.writers ?? []);
    writers.add(String(record.writer ?? ""));
    if (previous === void 0) {
      state.latest.set(key, { key, id, team, claim: incoming, declaredDeps, records: 1, resolvedBy: "seq", contested: false, writers });
      continue;
    }
    const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq });
    const winner = folded.incomingWins ? incoming : previous.claim;
    const loser = folded.incomingWins ? previous.claim : incoming;
    const disagrees = winner.status !== loser.status || winner.owner !== loser.owner;
    state.latest.set(key, {
      key,
      id,
      team,
      claim: winner,
      declaredDeps,
      records: previous.records + 1,
      // The clocks decided, or the winning claim is the only one of the pair carrying a clock — in
      // which case the clock is the only evidence in play rather than an appeal to arrival order.
      resolvedBy: folded.byAt || winner.at !== null && winner.at !== loser.at ? "at" : "seq",
      contested: previous.contested || disagrees,
      writers
    });
  }
}
function finishBoard(state) {
  const latest = state.latest;
  const keys = [...latest.keys()].sort();
  const tasks = keys.map((key) => {
    const row = latest.get(key);
    return {
      key,
      id: row.id,
      team: row.team,
      status: row.claim.status,
      owner: row.claim.owner,
      declaredDeps: [...row.declaredDeps],
      deps: row.declaredDeps.map((dep) => resolveDep(row.team, dep)),
      records: row.records,
      resolvedBy: row.resolvedBy,
      contested: row.contested,
      multiWriter: row.writers.size > 1
    };
  });
  const statusOf = (key) => latest.get(key).claim.status;
  const doneSet = new Set(keys.filter((key) => DONE_STATUSES.includes(statusOf(key))));
  const removedSet = new Set(keys.filter((key) => statusOf(key) === "deleted"));
  const edges = {};
  const blocked = {};
  const missing = {};
  const unreachable = {};
  const orphans = /* @__PURE__ */ new Set();
  for (const task of tasks) {
    const deps = [...task.deps];
    edges[task.key] = deps;
    const unmet = deps.filter((dep) => !doneSet.has(dep));
    if (unmet.length > 0) blocked[task.key] = unmet;
    const absent = deps.filter((dep) => !latest.has(dep));
    if (absent.length > 0) {
      missing[task.key] = absent;
      for (const dep of absent) orphans.add(dep);
    }
    const tombstones = deps.filter((dep) => removedSet.has(dep));
    if (tombstones.length > 0) unreachable[task.key] = tombstones;
  }
  const cycles = [];
  const seenLoops = /* @__PURE__ */ new Set();
  const color = new Map(keys.map((key) => [key, "white"]));
  const depsOf = (key) => doneSet.has(key) || removedSet.has(key) ? [] : edges[key] ?? [];
  for (const root of keys) {
    if (color.get(root) !== "white") continue;
    color.set(root, "gray");
    const stack = [{ key: root, at: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = depsOf(frame.key);
      if (frame.at < deps.length) {
        const dep = deps[frame.at];
        frame.at += 1;
        if (!latest.has(dep)) continue;
        const seen = color.get(dep) ?? "white";
        if (seen === "gray") {
          const start = stack.findIndex((entry) => entry.key === dep);
          const loop = stack.slice(start).map((entry) => entry.key);
          const signature = [...loop].sort().join("|");
          if (!seenLoops.has(signature)) {
            seenLoops.add(signature);
            cycles.push({ edge: [frame.key, dep], loop: [...loop].sort() });
          }
        } else if (seen === "white") {
          color.set(dep, "gray");
          stack.push({ key: dep, at: 0 });
        }
      } else {
        color.set(frame.key, "black");
        stack.pop();
      }
    }
  }
  const inCycle = /* @__PURE__ */ new Set();
  for (const cycle of cycles) for (const key of cycle.loop) inCycle.add(key);
  const ready = keys.filter((key) => !doneSet.has(key) && !removedSet.has(key) && !inCycle.has(key) && (blocked[key] ?? []).length === 0);
  return {
    tasks,
    edges,
    ready,
    blocked,
    missing,
    done: [...doneSet].sort(),
    cycles,
    orphans: [...orphans].sort(),
    removed: [...removedSet].sort(),
    unreachable,
    unknown: state.unknown
  };
}
function projectBoard(records) {
  const state = emptyBoardFold();
  foldBoard(state, records);
  return finishBoard(state);
}
function boardTasksNamed(state, id) {
  return state.board.tasks.filter((task) => task.id === id);
}
function keyId(key) {
  const at = key.lastIndexOf("\0");
  return at === -1 ? key : key.slice(at + 1);
}
function latestTitles(records) {
  const titles = /* @__PURE__ */ new Map();
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue;
    const payload = record.payload;
    if (typeof payload?.title !== "string" || payload.title === "") continue;
    const id = typeof payload?.id === "string" && payload.id !== "" ? payload.id : record.subject;
    if (typeof id !== "string" || id === "") continue;
    titles.set(boardKey(teamOf(record), id), payload.title);
  }
  return titles;
}
function readySetOf(board, titleOf, asKeys) {
  const byKey2 = new Map(board.tasks.map((task) => [task.key, task]));
  const ref = (key) => asKeys ? key : byKey2.get(key)?.id ?? keyId(key);
  const doneKeys = new Set(board.done);
  const removedKeys = new Set(board.removed);
  const ready = [];
  for (const key of board.ready) {
    const task = byKey2.get(key);
    if (task === void 0) continue;
    ready.push({ id: ref(key), team: task.team, title: titleOf(key) });
  }
  const blocked = [];
  const unknown = [];
  for (const task of board.tasks) {
    const missing = board.missing[task.key] ?? [];
    if (missing.length > 0) unknown.push({ id: ref(task.key), missing: [...missing].map(ref).sort() });
    if (doneKeys.has(task.key) || removedKeys.has(task.key)) continue;
    const unmet = board.blocked[task.key] ?? [];
    if (unmet.length === 0) continue;
    blocked.push({ id: ref(task.key), waitingOn: [...unmet].map(ref).sort() });
  }
  const done = [...new Set(board.done.map(ref))].sort();
  const seenLoops = /* @__PURE__ */ new Set();
  const cycles = [];
  for (const cycle of board.cycles) {
    const ids = [...new Set(cycle.loop.map(ref))].sort();
    const signature = ids.join("\0");
    if (seenLoops.has(signature)) continue;
    seenLoops.add(signature);
    cycles.push(ids);
  }
  cycles.sort((left, right) => left.join("\0") < right.join("\0") ? -1 : left.join("\0") > right.join("\0") ? 1 : 0);
  return { ready, blocked, done, unknown, cycles };
}
function readySet(records, options = {}) {
  const asKeys = options !== null && typeof options === "object" && options.asKeys === true;
  if (Array.isArray(records)) {
    const titles = latestTitles(records);
    return readySetOf(projectBoard(records), (key) => titles.get(key) ?? null, asKeys);
  }
  if (records !== null && typeof records === "object") {
    const source = records;
    const rows = Array.isArray(source.rows) ? source.rows : Array.isArray(source.records) ? source.records : null;
    if (rows !== null) {
      const titles = latestTitles(rows);
      return readySetOf(projectBoard(rows), (key) => titles.get(key) ?? null, asKeys);
    }
    const board = source.board;
    if (board !== null && board !== void 0 && Array.isArray(board.tasks)) {
      return readySetOf(board, () => null, asKeys);
    }
  }
  throw new TypeError("readySet: records must be the ledger's records (an array, a records() page, or a folded state)");
}
function claimReasonOf(state, key) {
  const board = state.board;
  const row = board.tasks.find((entry) => entry.key === key);
  if (row === void 0) return { reason: "unknown", blockers: [] };
  if (row.status === "deleted") return { reason: "removed", blockers: [] };
  if (DONE_STATUSES.includes(row.status)) return { reason: "done", blockers: [] };
  if ((board.unreachable[key] ?? []).length > 0) return { reason: "unreachable", blockers: board.blocked[key] ?? [] };
  const onCycle = board.cycles.some((cycle) => cycle.loop.includes(key));
  if (onCycle) return { reason: "cycle", blockers: board.blocked[key] ?? [] };
  const unmet = board.blocked[key] ?? [];
  if (unmet.length > 0) return { reason: "blocked", blockers: unmet };
  return { reason: "ready", blockers: [] };
}
function claimable(state, key, now, options) {
  const holder = lockHolder(state, key, now, options).holder;
  const blind = claimReasonOf(state, key);
  const dead = options.timeoutMs === void 0 || holder === null || !isQuarantined(state, holder, now, { timeoutMs: options.timeoutMs }) ? null : holder;
  const verdict = (ok, reason, blockers, reclaimed) => ({
    ok,
    reason,
    holder,
    blockers,
    reclaimedFrom: reclaimed
  });
  if (blind.reason !== "ready") return verdict(false, blind.reason, blind.blockers, null);
  if (holder !== null && dead === null) return verdict(false, "locked", [], null);
  return verdict(true, "ready", [], dead);
}
function lockReclaimable(state, key, now, options) {
  const lock = lockHolder(state, key, now, { ttlMs: options.ttlMs });
  const lastHolder = state.locks.find((entry) => entry.key === key)?.holder ?? null;
  return lock.expired && lastHolder !== null || lock.holder !== null && isQuarantined(state, lock.holder, now, { timeoutMs: options.timeoutMs });
}
function reclaimable(state, key, now, options) {
  const lock = lockHolder(state, key, now, { ttlMs: options.ttlMs });
  const lastHolder = state.locks.find((entry) => entry.key === key)?.holder ?? null;
  const holder = lock.holder;
  const holderUnhealthy = holder !== null && isQuarantined(state, holder, now, { timeoutMs: options.timeoutMs });
  const blind = claimReasonOf(state, key);
  return {
    key,
    holder,
    lastHolder,
    holderUnhealthy,
    expired: lock.expired,
    reason: blind.reason,
    reclaimable: blind.reason === "ready" && lockReclaimable(state, key, now, options)
  };
}
var PEER_KIND = "peer/state";
function peerRecord(from, to, request, state) {
  if (typeof from !== "string" || from === "") throw new TypeError("peerRecord: from must be a non-empty string");
  if (typeof to !== "string" || to === "") throw new TypeError("peerRecord: to must be a non-empty string");
  if (typeof request !== "string" || request === "") throw new TypeError("peerRecord: request must be a non-empty string");
  if (state !== "requested" && state !== "granted" && state !== "denied") throw new TypeError("peerRecord: state must be requested, granted or denied");
  return { kind: PEER_KIND, subject: from + "->" + to, payload: { from, to, request, state } };
}
function emptyPeersFold() {
  return { latest: /* @__PURE__ */ new Map() };
}
function foldPeers(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== PEER_KIND) continue;
    const payload = record.payload;
    const from = typeof payload?.from === "string" ? payload.from : "";
    const to = typeof payload?.to === "string" ? payload.to : "";
    const stateOfPair = payload?.state;
    if (from === "" || to === "") continue;
    if (stateOfPair !== "requested" && stateOfPair !== "granted" && stateOfPair !== "denied") continue;
    const request = typeof payload?.request === "string" ? payload.request : "";
    state.latest.set(from + "->" + to, { from, to, request, state: stateOfPair, seq: record.seq });
  }
}
function finishPeers(state) {
  return {
    pairs: [...state.latest.values()].sort((left, right) => {
      if (left.from !== right.from) return left.from < right.from ? -1 : 1;
      return left.to < right.to ? -1 : left.to > right.to ? 1 : 0;
    })
  };
}
function projectPeers(records) {
  const state = emptyPeersFold();
  foldPeers(state, records);
  return finishPeers(state);
}
function mayExchange(state, from, to) {
  return state.peers.pairs.find((pair) => pair.from === from && pair.to === to)?.state === "granted";
}
function pendingRequests(state, to) {
  return state.peers.pairs.filter((pair) => pair.to === to && pair.state === "requested").sort((left, right) => left.from < right.from ? -1 : left.from > right.from ? 1 : 0);
}
var TEAM_KIND = "team/state";
var MESSAGE_KIND = "team.message";
function emptyTeamParentArbitration() {
  return { parents: /* @__PURE__ */ new Map(), seen: /* @__PURE__ */ new Map(), contested: [] };
}
function stepTeamParentArbitration(state, row) {
  const current = state.seen.get(row.subject);
  if (current === void 0) {
    state.seen.set(row.subject, { parent: row.parent, at: row.at, seq: row.seq });
    state.parents.set(row.subject, row.parent);
    return;
  }
  if (current.parent === row.parent) return;
  const candidateMoreSpecific = row.parent !== null && current.parent === null;
  const equalSpecificityEarlier = row.parent === null === (current.parent === null) && (row.at < current.at || row.at === current.at && row.seq < current.seq);
  if (candidateMoreSpecific || equalSpecificityEarlier) {
    state.contested.push({ subject: row.subject, winner: row.parent, loser: current.parent, at: row.at, seq: row.seq });
    state.seen.set(row.subject, { parent: row.parent, at: row.at, seq: row.seq });
    state.parents.set(row.subject, row.parent);
    return;
  }
  state.contested.push({ subject: row.subject, winner: current.parent, loser: row.parent, at: row.at, seq: row.seq });
}
function arbitrateTeamParents(rows) {
  const state = emptyTeamParentArbitration();
  for (const row of rows) stepTeamParentArbitration(state, row);
  return { parents: state.parents, contested: state.contested };
}
function teamRecord(team, parent, lead) {
  if (typeof team !== "string" || team === "") throw new TypeError("teamRecord: team must be a non-empty string");
  if (parent !== null && (typeof parent !== "string" || parent === "")) throw new TypeError("teamRecord: parent must be null or a non-empty string");
  return { kind: TEAM_KIND, subject: team, payload: { team, parent, ...lead === void 0 ? {} : { lead } } };
}
function emptyTeamsFold() {
  return { latest: /* @__PURE__ */ new Map(), arbitration: emptyTeamParentArbitration() };
}
function foldTeams(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== TEAM_KIND) continue;
    const payload = record.payload;
    const id = typeof payload?.team === "string" && payload.team !== "" ? payload.team : record.subject;
    if (typeof id !== "string" || id === "") continue;
    const parent = payload?.parent === null || payload?.parent === void 0 ? null : typeof payload.parent === "string" && payload.parent !== "" ? payload.parent : null;
    const lead = typeof payload?.lead === "string" && payload.lead !== "" ? payload.lead : null;
    const declaration = { subject: id, parent, at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0, seq: record.seq };
    stepTeamParentArbitration(state.arbitration, declaration);
    state.latest.set(id, { id, parent, lead, seq: record.seq });
  }
}
function finishTeams(state) {
  const arbitrated = { parents: state.arbitration.parents, contested: state.arbitration.contested };
  const latest = new Map(state.latest);
  const lost = /* @__PURE__ */ new Map();
  for (const claim of arbitrated.contested) {
    lost.set(claim.subject, [...lost.get(claim.subject) ?? [], { parent: claim.loser, at: claim.at, seq: claim.seq }]);
  }
  for (const [id, node] of [...latest.entries()]) {
    const losers = (lost.get(id) ?? []).sort((left, right) => right.seq - left.seq);
    latest.set(id, {
      ...node,
      parent: arbitrated.parents.has(id) ? arbitrated.parents.get(id) ?? null : node.parent,
      contested: losers.length > 0,
      losers
    });
  }
  const teams = [...latest.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const children = {};
  for (const team of teams) {
    if (team.parent === null) continue;
    children[team.parent] = [...children[team.parent] ?? [], team.id];
  }
  for (const key of Object.keys(children)) children[key].sort();
  const roots = teams.filter((team) => team.parent === null).map((team) => team.id);
  const orphans = teams.filter((team) => team.parent !== null && !latest.has(team.parent)).map((team) => team.id);
  const cycles = [];
  const seen = /* @__PURE__ */ new Set();
  for (const team of teams) {
    const walked = [team.id];
    const onPath = /* @__PURE__ */ new Set([team.id]);
    let cursor = team.parent;
    while (cursor !== null) {
      if (onPath.has(cursor)) {
        const loop = walked.slice(walked.indexOf(cursor));
        const key = [...loop].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({ edge: [walked[walked.length - 1], cursor], loop: [...loop] });
        }
        break;
      }
      walked.push(cursor);
      onPath.add(cursor);
      cursor = latest.get(cursor)?.parent ?? null;
    }
  }
  return { teams, children, roots, orphans, cycles };
}
function projectTeams(records) {
  const state = emptyTeamsFold();
  foldTeams(state, records);
  return finishTeams(state);
}
function walkUp(state, teamId) {
  const by = new Map(state.teams.map((team) => [team.id, team]));
  if (!by.has(teamId)) return [];
  const path = [teamId];
  const onPath = /* @__PURE__ */ new Set([teamId]);
  let cursor = by.get(teamId)?.parent ?? null;
  while (cursor !== null && by.has(cursor)) {
    if (onPath.has(cursor)) break;
    path.push(cursor);
    onPath.add(cursor);
    cursor = by.get(cursor)?.parent ?? null;
  }
  return path.reverse();
}
function ancestorsOf(state, teamId) {
  const path = walkUp(state.teams, teamId);
  return path.slice(0, Math.max(0, path.length - 1));
}
function pathOf(state, teamId) {
  return walkUp(state.teams, teamId);
}
function descendantsOf(state, teamId) {
  const out = [];
  const queue = [...state.teams.children[teamId] ?? []];
  const seen = /* @__PURE__ */ new Set([teamId]);
  while (queue.length > 0) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    queue.push(...state.teams.children[next] ?? []);
  }
  return out;
}
function rootsOf(state) {
  return state.teams.roots;
}
var TASK_KIND = "task/state";
var MEMBER_KIND = "member/state";
var CAPABILITY_KIND = "capability/state";
function capabilityRecord(memberId, capabilities) {
  if (typeof memberId !== "string" || memberId === "") throw new TypeError("capabilityRecord: memberId must be a non-empty string");
  const unique = [...new Set(capabilities.filter((name2) => typeof name2 === "string" && name2 !== ""))].sort();
  return { kind: CAPABILITY_KIND, subject: memberId, payload: { id: memberId, capabilities: unique } };
}
function declarationOf(record) {
  if (record.kind !== CAPABILITY_KIND) return null;
  const payload = record.payload;
  const id = payload?.id ?? record.subject;
  if (typeof id !== "string" || id === "") return null;
  const named = (value) => typeof value === "string" && value !== "" ? value : null;
  if (Array.isArray(payload?.capabilities)) {
    const listed = payload.capabilities.filter((name2) => named(name2) !== null);
    return { id, capabilities: [...new Set(listed)], replace: true };
  }
  const single = named(payload?.capability);
  if (single !== null) return { id, capabilities: [single], replace: false };
  return null;
}
function emptyRegistryFold() {
  return { latest: /* @__PURE__ */ new Map(), declarations: 0, malformed: 0 };
}
function foldRegistry(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== CAPABILITY_KIND) continue;
    const declaration = declarationOf(record);
    if (declaration === null) {
      state.malformed += 1;
      continue;
    }
    state.declarations += 1;
    const previous = state.latest.get(declaration.id);
    const merged = declaration.replace ? declaration.capabilities : [.../* @__PURE__ */ new Set([...previous?.capabilities ?? [], ...declaration.capabilities])];
    state.latest.set(declaration.id, { capabilities: merged, seq: record.seq });
  }
}
function finishRegistry(state) {
  const members = [...state.latest.entries()].map(([id, entry]) => ({ id, capabilities: [...entry.capabilities].sort(), seq: entry.seq })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const byCapability = {};
  for (const member of members) {
    for (const capability of member.capabilities) {
      byCapability[capability] = [...byCapability[capability] ?? [], member.id];
    }
  }
  for (const capability of Object.keys(byCapability)) byCapability[capability].sort();
  const registry = { members, byCapability, declarations: state.declarations, malformed: state.malformed };
  Object.defineProperties(registry, {
    membersWith: {
      value: (capability) => registry.byCapability[capability] ?? [],
      enumerable: false
    },
    capabilitiesOf: {
      value: (memberId) => registry.members.find((member) => member.id === memberId)?.capabilities ?? [],
      enumerable: false
    }
  });
  return registry;
}
function projectRegistry(records) {
  const state = emptyRegistryFold();
  foldRegistry(state, records);
  return finishRegistry(state);
}
function membersWith(state, capability) {
  return state.registry.byCapability[capability] ?? [];
}
function capabilitiesOf(state, memberId) {
  return state.registry.members.find((member) => member.id === memberId)?.capabilities ?? [];
}
function emptyTaskDemandsFold() {
  return { demands: {} };
}
function foldTaskDemands(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue;
    const payload = record.payload;
    const id = payload?.id ?? record.subject;
    if (typeof id !== "string" || id === "") continue;
    if (typeof payload?.capability === "string" && payload.capability !== "") state.demands[id] = payload.capability;
  }
}
function finishTaskDemands(state) {
  return { ...state.demands };
}
function projectTaskDemands(records) {
  const state = emptyTaskDemandsFold();
  foldTaskDemands(state, records);
  return finishTaskDemands(state);
}
var HEARTBEAT_KIND = "member/heartbeat";
function heartbeatRecord(memberId, at) {
  if (typeof memberId !== "string" || memberId === "") throw new TypeError("heartbeatRecord: memberId must be a non-empty string");
  if (!Number.isFinite(at)) throw new TypeError("heartbeatRecord: at must be a finite number of milliseconds");
  return { kind: HEARTBEAT_KIND, subject: memberId, payload: { id: memberId, at } };
}
function emptyLivenessFold() {
  return { lastHeartbeat: {}, beatSeq: {}, beats: 0, malformed: 0 };
}
function foldLiveness(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== HEARTBEAT_KIND) continue;
    const payload = record.payload;
    const id = payload?.id ?? record.subject;
    if (typeof id !== "string" || id === "" || typeof payload?.at !== "number" || !Number.isFinite(payload.at)) {
      state.malformed += 1;
      continue;
    }
    state.beats += 1;
    state.lastHeartbeat[id] = payload.at;
    state.beatSeq[id] = record.seq;
  }
}
function finishLiveness(state) {
  return { lastHeartbeat: { ...state.lastHeartbeat }, beatSeq: { ...state.beatSeq }, beats: state.beats, malformed: state.malformed };
}
function projectLiveness(records) {
  const state = emptyLivenessFold();
  foldLiveness(state, records);
  return finishLiveness(state);
}
function livenessOf(state, now, options) {
  const { timeoutMs } = options;
  const ids = [.../* @__PURE__ */ new Set([...Object.keys(state.liveness.lastHeartbeat), ...state.members.map((member) => member.id)])].sort();
  return ids.map((memberId) => {
    const last = state.liveness.lastHeartbeat[memberId] ?? null;
    if (last === null) return { memberId, liveness: "unknown", lastHeartbeat: null, now, timeoutMs, sinceMs: null };
    const sinceMs = now - last;
    return { memberId, liveness: sinceMs >= timeoutMs ? "unhealthy" : "healthy", lastHeartbeat: last, now, timeoutMs, sinceMs };
  });
}
function isQuarantined(state, memberId, now, options) {
  return livenessOf(state, now, options).find((reading) => reading.memberId === memberId)?.liveness === "unhealthy";
}
var RECLAIM_RULE = "RECLAIM_SILENT_OWNER";
var RECLAIM_DEFAULT_TTL_MS = 15 * 60 * 1e3;
function reclaimVerdict(subject, now, options) {
  const timeoutMs = options?.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("reclaimVerdict: timeoutMs must be a positive integer of milliseconds; got " + describeValue(timeoutMs));
  }
  const owner = typeof subject?.ownerId === "string" && subject.ownerId !== "" ? subject.ownerId : null;
  const status = typeof subject?.status === "string" ? subject.status : "unknown";
  const taskId = typeof subject?.id === "string" ? subject.id : "";
  const last = typeof subject?.heartbeatAt === "number" && Number.isFinite(subject.heartbeatAt) ? subject.heartbeatAt : null;
  const verdict = (sinceMs2, deadlineMs2, reclaimable2, code, reason) => ({
    rule: RECLAIM_RULE,
    taskId,
    status,
    owner,
    heartbeatAt: last,
    sinceMs: sinceMs2,
    deadlineMs: deadlineMs2,
    reclaimable: reclaimable2,
    code,
    reason
  });
  if (status !== "in_progress") {
    return verdict(null, now, false, "NOT_IN_PROGRESS", "this task is " + describeValue(status) + ", not in_progress: nothing is being held");
  }
  if (owner === null) {
    return verdict(null, now, true, "NO_OWNER", "this task is in_progress and no owner was recorded on it: no member is holding it, and nobody can claim it while it stays in flight");
  }
  if (last === null) {
    return verdict(null, now, true, "NEVER_BEAT", "owner " + describeValue(owner) + " holds this task and the ledger holds no heartbeat for it at all");
  }
  const sinceMs = now - last;
  const deadlineMs = last + timeoutMs;
  if (sinceMs >= timeoutMs) {
    return verdict(sinceMs, deadlineMs, true, "HEARTBEAT_STALE", "owner " + describeValue(owner) + " last beat " + String(sinceMs) + " ms ago, which reaches the " + String(timeoutMs) + " ms threshold");
  }
  return verdict(sinceMs, deadlineMs, false, "OWNER_ALIVE", "owner " + describeValue(owner) + " beat " + String(sinceMs) + " ms ago, inside the " + String(timeoutMs) + " ms threshold");
}
function reclaimReading(state, key, now, options) {
  const row = state.board.tasks.find((entry) => entry.key === key);
  if (row === void 0) {
    return {
      rule: RECLAIM_RULE,
      key,
      taskId: key,
      team: null,
      status: "unknown",
      owner: null,
      heartbeatAt: null,
      sinceMs: null,
      deadlineMs: now,
      reclaimable: false,
      code: "UNKNOWN_TASK",
      reason: "no task is on the board under this key"
    };
  }
  const verdict = reclaimVerdict({
    id: row.id,
    status: row.status,
    ownerId: row.owner,
    heartbeatAt: row.owner === null ? null : state.liveness.lastHeartbeat[row.owner] ?? null
  }, now, options);
  return { ...verdict, key, team: row.team };
}
function inFlightReadings(state, now, options) {
  return state.board.tasks.filter((row) => row.status === "in_progress").map((row) => reclaimReading(state, row.key, now, options)).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
var QUARANTINE_KIND = "member/quarantine";
function quarantineRecord(memberId, at, detail) {
  if (typeof memberId !== "string" || memberId === "") throw new TypeError("quarantineRecord: memberId must be a non-empty string");
  if (!Number.isFinite(at)) throw new TypeError("quarantineRecord: at must be a finite number of milliseconds");
  return {
    kind: QUARANTINE_KIND,
    subject: memberId,
    payload: {
      id: memberId,
      at,
      reason: detail.reason,
      task: detail.task ?? null,
      by: detail.by ?? null
    }
  };
}
function quarantineFact(record) {
  const payload = record.payload;
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  if (record.kind === MEMBER_KIND && text(payload?.state) === "quarantined") {
    const id = text(payload?.id) ?? text(record.subject);
    if (id !== null) {
      return {
        memberId: id,
        at: typeof payload?.at === "number" && Number.isFinite(payload.at) ? payload.at : record.at ?? 0,
        reason: text(payload?.reason) ?? "",
        task: text(payload?.task),
        by: text(payload?.by)
      };
    }
  }
  if (record.kind === QUARANTINE_KIND) {
    const id = text(payload?.id) ?? text(record.subject);
    if (id === null) return null;
    return {
      memberId: id,
      at: typeof payload?.at === "number" && Number.isFinite(payload.at) ? payload.at : record.at ?? 0,
      reason: text(payload?.reason) ?? "",
      task: text(payload?.task),
      by: text(payload?.by)
    };
  }
  return null;
}
function emptyQuarantineFold() {
  return { latest: /* @__PURE__ */ new Map() };
}
function foldQuarantine(state, records) {
  for (const record of orderedRecords(records)) {
    const fact = quarantineFact(record);
    if (fact === null) continue;
    state.latest.set(fact.memberId, { ...fact, seq: record.seq });
  }
}
function finishQuarantine(state) {
  return [...state.latest.values()].sort((left, right) => left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0);
}
function projectQuarantine(records) {
  const state = emptyQuarantineFold();
  foldQuarantine(state, records);
  return finishQuarantine(state);
}
function isIsolated(state, memberId) {
  const row = state.quarantine.find((entry) => entry.memberId === memberId);
  if (row === void 0) return false;
  const beat = state.liveness.beatSeq[memberId] ?? null;
  return beat === null || beat < row.seq;
}
function recoverable(state, now, options) {
  const readings = new Map(livenessOf(state, now, { timeoutMs: options.timeoutMs }).map((reading) => [reading.memberId, reading.liveness]));
  const healthy = [...readings.entries()].filter(([, liveness]) => liveness === "healthy").map(([id]) => id).sort();
  const ttlMs = options.ttlMs;
  return state.tasks.filter((task) => {
    const inFlight = task.state !== "completed" && task.state !== "deleted";
    const holder = task.owner ?? null;
    return inFlight && holder !== null && readings.get(holder) !== "healthy";
  }).map((task) => {
    const named = state.taskDemands[task.id] ?? null;
    const able = named === null ? healthy : membersWith(state, named).filter((id) => readings.get(id) === "healthy");
    const owner = task.owner ?? null;
    const heldLocks = ttlMs === void 0 ? null : state.locks.filter((lock) => lock.key === boardKey(task.team, task.id) && lock.holder === owner).map((lock) => lock.key).sort();
    const takenNow = heldLocks !== null && heldLocks.some((key) => lockReclaimable(state, key, now, { ttlMs, timeoutMs: options.timeoutMs }));
    return {
      id: task.id,
      owner,
      capability: named,
      candidates: [...able].sort(),
      heldLocks,
      lockReclaimable: takenNow
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
var SESSION_KIND = "session/claim";
var HANDOFF_KIND = "session/handoff";
function sessionClaim(session, end, epoch, at) {
  if (typeof session !== "string" || session === "") throw new TypeError("sessionClaim: session must be a non-empty string");
  if (typeof end !== "string" || end === "") throw new TypeError("sessionClaim: end must be a non-empty string");
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError("sessionClaim: epoch must be a positive safe integer");
  if (!Number.isFinite(at)) throw new TypeError("sessionClaim: at must be a finite number of milliseconds");
  return { kind: SESSION_KIND, subject: session, payload: { session, end, epoch, at } };
}
function sessionHandoff(session, from, to, epoch, at) {
  if (typeof session !== "string" || session === "") throw new TypeError("sessionHandoff: session must be a non-empty string");
  if (typeof from !== "string" || from === "") throw new TypeError("sessionHandoff: from must be a non-empty string");
  if (typeof to !== "string" || to === "") throw new TypeError("sessionHandoff: to must be a non-empty string");
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError("sessionHandoff: epoch must be a positive safe integer");
  if (!Number.isFinite(at)) throw new TypeError("sessionHandoff: at must be a finite number of milliseconds");
  return { kind: HANDOFF_KIND, subject: session, payload: { session, from, to, epoch, at } };
}
var TURN_KIND = "session/turn";
function turnRecord(turn, at) {
  if (typeof turn?.session !== "string" || turn.session === "") throw new TypeError("turnRecord: session must be a non-empty string");
  if (typeof turn?.end !== "string" || turn.end === "") throw new TypeError("turnRecord: end must be a non-empty string");
  if (!Number.isSafeInteger(turn?.epoch) || turn.epoch < 1) throw new TypeError("turnRecord: epoch must be a positive safe integer");
  if (typeof turn?.text !== "string") throw new TypeError("turnRecord: text must be a string");
  if (!Number.isFinite(at)) throw new TypeError("turnRecord: at must be a finite number of milliseconds");
  return { kind: TURN_KIND, subject: turn.session, payload: { session: turn.session, end: turn.end, epoch: turn.epoch, text: turn.text, at } };
}
function turnReason(held, end, epoch) {
  if (held === null) return "no-author";
  if (end === held.end && epoch === held.epoch) return null;
  if (epoch <= held.epoch) return "stale-epoch";
  if (end !== held.end) return "not-author";
  return "unrecorded-epoch";
}
var bySessionThenSeq = (left, right) => {
  if (left.session !== right.session) return left.session < right.session ? -1 : 1;
  return left.seq - right.seq;
};
function emptySessionsFold() {
  return { owners: /* @__PURE__ */ new Map(), steps: [], refused: [], turns: [], rejectedTurns: [], malformed: 0 };
}
function foldSessions(state, records) {
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  for (const record of orderedRecords(records)) {
    if (record.kind === TURN_KIND) {
      const said = record.payload;
      const session2 = text(said?.session) ?? text(record.subject);
      const end2 = text(said?.end);
      const rawEpoch2 = said?.epoch;
      const rawAt2 = said?.at;
      const spoken = said?.text;
      const usableTurn = session2 !== null && end2 !== null && typeof rawEpoch2 === "number" && Number.isSafeInteger(rawEpoch2) && typeof rawAt2 === "number" && Number.isFinite(rawAt2) && typeof spoken === "string";
      if (!usableTurn) {
        state.malformed += 1;
        state.rejectedTurns.push(session2 === null ? { session: null, end: null, epoch: 0, seq: record.seq, reason: "malformed" } : { session: session2, end: end2, epoch: typeof rawEpoch2 === "number" && Number.isSafeInteger(rawEpoch2) ? rawEpoch2 : 0, seq: record.seq, reason: "malformed" });
        continue;
      }
      const epoch2 = rawEpoch2;
      const reason = turnReason(state.owners.get(session2) ?? null, end2, epoch2);
      if (reason !== null) state.rejectedTurns.push({ session: session2, end: end2, epoch: epoch2, seq: record.seq, reason });
      else state.turns.push({ session: session2, end: end2, epoch: epoch2, text: spoken, at: rawAt2, seq: record.seq });
      continue;
    }
    if (record.kind !== SESSION_KIND && record.kind !== HANDOFF_KIND) continue;
    const by = record.kind === HANDOFF_KIND ? "handoff" : "claim";
    const payload = record.payload;
    const session = text(payload?.session) ?? text(record.subject);
    const end = by === "claim" ? text(payload?.end) : text(payload?.to);
    const from = by === "handoff" ? text(payload?.from) : null;
    const rawEpoch = payload?.epoch;
    const rawAt = payload?.at;
    const usable = session !== null && end !== null && typeof rawEpoch === "number" && Number.isSafeInteger(rawEpoch) && typeof rawAt === "number" && Number.isFinite(rawAt) && (by === "claim" || from !== null);
    if (!usable) {
      state.malformed += 1;
      state.refused.push(session === null ? { session: null, end: null, epoch: 0, seq: record.seq, reason: "malformed", by } : { session, end, epoch: typeof rawEpoch === "number" && Number.isSafeInteger(rawEpoch) ? rawEpoch : 0, seq: record.seq, reason: "malformed", by });
      continue;
    }
    const epoch = rawEpoch;
    const at = rawAt;
    const held = state.owners.get(session) ?? null;
    if (held === null && epoch < 1) {
      state.malformed += 1;
      state.refused.push({ session, end, epoch, seq: record.seq, reason: "malformed", by });
      continue;
    }
    if (held !== null && epoch <= held.epoch) {
      state.refused.push({ session, end, epoch, seq: record.seq, reason: "stale-epoch", by });
      continue;
    }
    if (by === "handoff") {
      if (held === null || from !== held.end) {
        state.refused.push({ session, end, epoch, seq: record.seq, reason: "not-owner", by });
        continue;
      }
      if (epoch !== held.epoch + 1) {
        state.refused.push({ session, end, epoch, seq: record.seq, reason: "epoch-gap", by });
        continue;
      }
    }
    const step = { session, end, epoch, at, seq: record.seq, by };
    state.steps.push(step);
    state.owners.set(session, step);
  }
}
function finishSessions(state) {
  return {
    owners: [...state.owners.values()].sort((left, right) => left.session < right.session ? -1 : left.session > right.session ? 1 : 0),
    steps: state.steps,
    refused: state.refused,
    malformed: state.malformed,
    turns: [...state.turns].sort(bySessionThenSeq),
    rejectedTurns: [...state.rejectedTurns].sort(bySessionThenSeq)
  };
}
function projectSessions(records) {
  const state = emptySessionsFold();
  foldSessions(state, records);
  return finishSessions(state);
}
function sessionOwner(state, session) {
  return state.sessions.owners.find((row) => row.session === session) ?? null;
}
function mayContinue(state, session, end, epoch, now, options) {
  const held = sessionOwner(state, session);
  if (held === null) return { ok: true, reason: "none", owner: null, epoch: null };
  if (epoch <= held.epoch) return { ok: false, reason: "stale-epoch", owner: held.end, epoch: held.epoch };
  if (end === held.end) return { ok: true, reason: "ok", owner: held.end, epoch: held.epoch };
  const silent = options.timeoutMs !== void 0 && isQuarantined(state, held.end, now, { timeoutMs: options.timeoutMs });
  return silent ? { ok: true, reason: "silent-owner", owner: held.end, epoch: held.epoch } : { ok: false, reason: "owned-by-other", owner: held.end, epoch: held.epoch };
}
function mayWrite(state, session, end, epoch) {
  const held = sessionOwner(state, session);
  return held !== null && held.end === end && held.epoch === epoch;
}
function continuations(state, session) {
  return state.sessions.steps.filter((step) => step.session === session);
}
function writeRefusalReason(verdict) {
  if (!verdict.ok) return verdict.reason;
  return verdict.reason === "none" ? "none" : "unrecorded-epoch";
}
async function appendTurn(log, state, turn, options) {
  const record = turnRecord(turn, options?.at ?? Date.now());
  const verdict = mayContinue(state, turn.session, turn.end, turn.epoch, options?.now ?? 0, options?.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs });
  if (!mayWrite(state, turn.session, turn.end, turn.epoch)) return { appended: false, reason: writeRefusalReason(verdict), seq: null };
  const seq = await log.append(record);
  return { appended: true, reason: "ok", seq };
}
var HOST_KIND = "member/host";
function hostRecord(memberId, end, via, at) {
  if (typeof memberId !== "string" || memberId === "") throw new TypeError("hostRecord: memberId must be a non-empty string");
  if (typeof end !== "string" || end === "") throw new TypeError("hostRecord: end must be a non-empty string");
  if (via !== null && (typeof via !== "string" || via === "")) throw new TypeError("hostRecord: via must be null or a non-empty string");
  if (!Number.isFinite(at)) throw new TypeError("hostRecord: at must be a finite number of milliseconds");
  return { kind: HOST_KIND, subject: memberId, payload: { id: memberId, end, via, at } };
}
function emptyHostingFold() {
  return { hosts: /* @__PURE__ */ new Map(), malformed: 0 };
}
function foldHosting(state, records) {
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  for (const record of orderedRecords(records)) {
    if (record.kind !== HOST_KIND) continue;
    const payload = record.payload;
    const id = text(payload?.id) ?? text(record.subject);
    const end = text(payload?.end);
    const rawAt = payload?.at;
    if (id === null || end === null || typeof rawAt !== "number" || !Number.isFinite(rawAt)) {
      state.malformed += 1;
      continue;
    }
    const via = text(payload?.via);
    const previous = state.hosts.get(id);
    if (previous === void 0) {
      state.hosts.set(id, { id, end, via, at: rawAt, seq: record.seq, resolvedBy: "seq", contested: false, losers: [] });
      continue;
    }
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: rawAt, seq: record.seq });
    const winner = folded.incomingWins ? { end, via, at: rawAt, seq: record.seq, writer: record.actor ?? null } : { end: previous.end, via: previous.via, at: previous.at, seq: previous.seq, writer: null };
    const loser = folded.incomingWins ? { end: previous.end, via: previous.via, at: previous.at, seq: previous.seq, writer: null } : { end, via, at: rawAt, seq: record.seq, writer: record.actor ?? null };
    const disagrees = loser.end !== winner.end || loser.via !== winner.via;
    state.hosts.set(id, {
      id,
      end: winner.end,
      via: winner.via,
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? "at" : "seq",
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers
    });
  }
}
function finishHosting(state) {
  return { hosts: [...state.hosts.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0), malformed: state.malformed };
}
function projectHosting(records) {
  const state = emptyHostingFold();
  foldHosting(state, records);
  return finishHosting(state);
}
function hostOf(state, member) {
  return state.hosting.hosts.find((row) => row.id === member) ?? null;
}
function representativeOf(state, end, exclude) {
  const candidates = state.hosting.hosts.filter((row) => (row.id === end || row.end === end) && row.id !== exclude);
  if (candidates.length === 0) return null;
  return candidates.find((row) => row.id === end) ?? candidates[0];
}
function resolveRoute(state, member, localEnd, livenesses) {
  const host = hostOf(state, member);
  const memberEnd = host === null ? localEnd : host.end;
  if (memberEnd === localEnd) return { path: [localEnd], failure: null };
  const chain = [memberEnd];
  const seen = /* @__PURE__ */ new Set([memberEnd]);
  let via = host === null ? null : host.via;
  for (; ; ) {
    const next = via === null ? localEnd : via;
    if (next === localEnd) break;
    if (seen.has(next)) {
      const walked = [localEnd, ...[...chain].reverse()];
      return { path: walked, failure: { member, reason: "path-cycle", path: walked, loop: chain.slice(chain.indexOf(next)) } };
    }
    const representative = representativeOf(state, next, member);
    if (representative === null) {
      const walked = [localEnd, ...[...chain].reverse(), next];
      return { path: walked, failure: { member, reason: "no-route", path: walked, loop: [] } };
    }
    chain.push(next);
    seen.add(next);
    via = representative.via;
  }
  const path = [localEnd, ...[...chain].reverse()];
  for (const end of chain) {
    const representative = representativeOf(state, end, member);
    if (representative === null) continue;
    if ((livenesses.get(representative.id) ?? "unknown") !== "unhealthy") continue;
    const stopped = path.slice(0, path.indexOf(end) + 1);
    return { path: stopped, failure: { member, reason: "route-down", path: stopped, loop: [] } };
  }
  return { path, failure: null };
}
var byMemberThenTeam = (left, right) => {
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  const leftTeam = left.team ?? "";
  const rightTeam = right.team ?? "";
  return leftTeam < rightTeam ? -1 : leftTeam > rightTeam ? 1 : 0;
};
function routes(state, localEnd, now, options) {
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]));
  const out = [];
  for (const row of [...state.members].sort(byMemberThenTeam)) {
    const resolved = resolveRoute(state, row.id, localEnd, livenesses);
    if (resolved.failure !== null) continue;
    out.push({ member: row.id, end: resolved.path[resolved.path.length - 1], path: resolved.path, hops: resolved.path.length - 1 });
  }
  return out;
}
function routeFailures(state, localEnd, now, options) {
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]));
  const out = [];
  for (const row of [...state.members].sort(byMemberThenTeam)) {
    const resolved = resolveRoute(state, row.id, localEnd, livenesses);
    if (resolved.failure !== null) out.push(resolved.failure);
  }
  return out;
}
function assignThrough(state, team, member, localEnd, now, options) {
  const inTeam = state.members.some((row) => row.id === member && row.team === team);
  if (!inTeam) {
    const elsewhere = state.members.some((row) => row.id === member);
    return { ok: false, reason: elsewhere ? "not-in-team" : "not-member", path: [], hops: 0, loop: [] };
  }
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]));
  const resolved = resolveRoute(state, member, localEnd, livenesses);
  if (resolved.failure !== null) {
    return { ok: false, reason: resolved.failure.reason, path: resolved.failure.path, hops: resolved.failure.path.length - 1, loop: resolved.failure.loop };
  }
  const path = resolved.path;
  if (path.length === 1) return { ok: true, reason: "local", path, hops: 0, loop: [] };
  if ((livenesses.get(member) ?? "unknown") !== "healthy") return { ok: false, reason: "member-silent", path, hops: path.length - 1, loop: [] };
  return { ok: true, reason: "ok", path, hops: path.length - 1, loop: [] };
}
var MANIFEST_KIND = "end/manifest";
var MANIFEST_PROTOCOLS = ["dsh-link-device/1"];
var ManifestRefusal = class extends Error {
  /** The stable code this refusal is named by. */
  code;
  /** The manifest versions this build speaks; empty on every refusal but a version one. */
  supported;
  /**
   * @param code - the code, e.g. MANIFEST_VIA, or MANIFEST_NOT_AUTHORIZED when the row would be written by an end that is not the one it names (see {@link appendManifest}).
   * @param detail - what was refused, and what the caller should send instead.
   * @param supported - the version list, on a version refusal.
   */
  constructor(code, detail, supported = []) {
    super(code + ": " + detail);
    this.name = "ManifestRefusal";
    this.code = code;
    this.supported = supported;
  }
};
function textOf(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function nameOf(value) {
  const text = textOf(value);
  return text !== null && text.trim() !== "" ? text : null;
}
function hostedEndOf(state, memberId) {
  return state.hosting.hosts.find((row) => row.id === memberId)?.end ?? null;
}
function manifestEndOf(row) {
  const payload = row.payload;
  return textOf(payload?.end) ?? textOf(row.subject);
}
function declaresItself(rows, writer) {
  return rows.some((row) => row?.kind === MANIFEST_KIND && (row.writer ?? null) === writer && manifestEndOf(row) === writer);
}
function endsHeld(state) {
  const ends = /* @__PURE__ */ new Set();
  for (const row of state.manifests.ends) ends.add(row.end);
  for (const row of state.hosting.hosts) ends.add(row.end);
  return ends;
}
function manifestRecord(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ManifestRefusal("MANIFEST_INPUT", "this takes one object of arguments; got " + describeValue(input));
  }
  const args = input;
  const end = nameOf(args.end);
  if (end === null) throw new ManifestRefusal("MANIFEST_END", "end is required and must be a non-empty name; got " + describeValue(args.end ?? null));
  const rawVia = args.via;
  let via = null;
  if (rawVia !== null && rawVia !== void 0) {
    const hop = nameOf(rawVia);
    if (hop === null) throw new ManifestRefusal("MANIFEST_VIA", "via must be null or a non-empty end name; got " + describeValue(rawVia));
    if (hop === end) throw new ManifestRefusal("MANIFEST_VIA", "via " + describeValue(hop) + " names the end itself; a hop towards nowhere is not a shorter path, use null when it is this end");
    via = hop;
  }
  const platform = textOf(args.platform);
  if (platform === null) throw new ManifestRefusal("MANIFEST_PLATFORM", "platform is required and must be a non-empty string; got " + describeValue(args.platform ?? null));
  const rawVersion = args.protocolVersion;
  const version = textOf(rawVersion);
  if (version === null || !MANIFEST_PROTOCOLS.includes(version)) {
    throw new ManifestRefusal("MANIFEST_VERSION", "protocolVersion " + describeValue(rawVersion ?? null) + " is not one this build speaks; supported: " + MANIFEST_PROTOCOLS.join(", "), [...MANIFEST_PROTOCOLS]);
  }
  const listed = args.capabilities;
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new ManifestRefusal("MANIFEST_CAPABILITY", "capabilities must be a non-empty array of names; got " + describeValue(listed ?? null));
  }
  const names = [];
  for (const entry of listed) {
    if (typeof entry !== "string" || !DECLARED_NAME.test(entry)) {
      throw new ManifestRefusal("MANIFEST_CAPABILITY", "capabilities carries " + describeValue(entry) + ", which is not a name; use 1-64 characters from letters, digits and . _ - : @, starting with a letter or a digit");
    }
    names.push(entry);
  }
  const at = args.at;
  if (typeof at !== "number" || !Number.isFinite(at)) {
    throw new ManifestRefusal("MANIFEST_AT", "at must be a finite number of milliseconds; got " + describeValue(at ?? null));
  }
  return { kind: MANIFEST_KIND, subject: end, payload: { end, via, platform, protocolVersion: version, capabilities: [...new Set(names)].sort(), at } };
}
async function appendManifest(state, log, input) {
  const draft = manifestRecord(input);
  const unknown = draft.payload.capabilities.filter((name2) => membersWith(state, name2).length === 0);
  if (unknown.length > 0) {
    throw new ManifestRefusal("MANIFEST_CAPABILITY", "these names are not in the capability registry, so no end can be read as offering them: " + unknown.map((name2) => describeValue(name2)).join(", ") + "; declare them with the capability producer first (the registry is the only authority for what a capability is called)");
  }
  const end = draft.payload.end;
  if (end !== log.writer && declaresItself(log.replay(), log.writer) && endsHeld(state).has(end) !== true) {
    throw new ManifestRefusal("MANIFEST_NOT_AUTHORIZED", "this ledger knows its writer (" + describeValue(log.writer) + ") as an end, and " + describeValue(end) + " is an end it holds nothing about: no manifest row names it and no member runs on it. A manifest row may only be written by the end it names, so this row has to come from that end (its own log, its own row) or that end has to be held first - a member/host fact putting one of its members on it");
  }
  const seq = await log.append({ ...draft, actor: draft.payload.end });
  const folded = projectManifests(log.replay()).ends.find((row) => row.end === draft.payload.end) ?? null;
  return {
    seq,
    kind: draft.kind,
    subject: draft.subject,
    end: draft.payload.end,
    via: draft.payload.via,
    platform: draft.payload.platform,
    protocolVersion: draft.payload.protocolVersion,
    capabilities: draft.payload.capabilities,
    at: draft.payload.at,
    folded
  };
}
function emptyManifestsFold() {
  return { latest: /* @__PURE__ */ new Map(), unreadable: 0 };
}
function foldManifests(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== MANIFEST_KIND) continue;
    const payload = record.payload;
    const end = textOf(payload?.end) ?? textOf(record.subject);
    const platform = textOf(payload?.platform);
    const version = textOf(payload?.protocolVersion);
    const at = payload?.at;
    const rawVia = payload?.via;
    const via = rawVia === null || rawVia === void 0 ? null : textOf(rawVia);
    if (end === null || platform === null || version === null || typeof at !== "number" || !Number.isFinite(at) || rawVia !== null && rawVia !== void 0 && via === null) {
      state.unreadable += 1;
      continue;
    }
    const listed = Array.isArray(payload?.capabilities) ? payload.capabilities.flatMap((entry) => textOf(entry) === null ? [] : [entry]) : [];
    const declared = [...new Set(listed)].sort();
    const previous = state.latest.get(end);
    if (previous !== void 0 && previous.seq > record.seq) continue;
    state.latest.set(end, { end, via, platform, protocolVersion: version, capabilities: declared, declared, at, seq: record.seq });
  }
}
function finishManifests(state, known) {
  const ends = [...state.latest.values()].map((row) => ({
    end: row.end,
    via: row.via,
    platform: row.platform,
    protocolVersion: row.protocolVersion,
    capabilities: row.declared.filter((name2) => known.has(name2)),
    declared: row.declared,
    at: row.at,
    seq: row.seq
  })).sort((left, right) => left.end < right.end ? -1 : left.end > right.end ? 1 : 0);
  const unreadable = state.unreadable;
  return { ends, malformed: unreadable + ends.filter((row) => row.capabilities.length !== row.declared.length).length };
}
function projectManifests(records) {
  const state = emptyManifestsFold();
  foldManifests(state, records);
  return finishManifests(state, new Set(Object.keys(projectRegistry(records).byCapability)));
}
function effectiveCapabilities(state, end, now, options) {
  if (typeof end !== "string" || end === "") throw new TypeError("effectiveCapabilities: end must be a non-empty string");
  if (typeof now !== "number" || !Number.isFinite(now)) throw new TypeError("effectiveCapabilities: now must be a finite number of milliseconds");
  const timeoutMs = options?.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError("effectiveCapabilities: timeoutMs must be a finite number of milliseconds and not negative");
  const local = textOf(options?.localEnd ?? null);
  const byEnd = new Map(state.manifests.ends.map((row) => [row.end, row]));
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor = end;
  while (cursor !== null) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    chain.push(cursor);
    if (local !== null && cursor === local) break;
    const row = byEnd.get(cursor);
    if (row === void 0) break;
    const via = row.via;
    cursor = via === null ? null : via;
  }
  const arrived = chain[chain.length - 1];
  if (local !== null && arrived !== void 0 && arrived !== local && byEnd.get(arrived)?.via === null) {
    chain.push(local);
  }
  const livenesses = new Map(livenessOf(state, now, { timeoutMs }).map((reading) => [reading.memberId, reading.liveness]));
  const missing = [];
  const path = [];
  const reached = [];
  for (const hop of [...chain].reverse()) {
    path.push(hop);
    const row = byEnd.get(hop);
    if (row === void 0) {
      missing.push({ hop, code: "NO_MANIFEST" });
      break;
    }
    reached.push(row);
    const representative = representativeOf(state, hop, null);
    if (representative !== null && (livenesses.get(representative.id) ?? "unknown") === "unhealthy") {
      missing.push({ hop, code: hop === end ? "PEER_SILENT" : "ROUTE_DOWN" });
      break;
    }
  }
  const capabilities = [];
  if (missing.length === 0 && reached.length > 0) {
    for (const name2 of reached[reached.length - 1].capabilities) {
      if (reached.every((row) => row.capabilities.includes(name2))) capabilities.push(name2);
    }
    capabilities.sort();
  }
  return { end, path, capabilities, missing, through: state.through };
}
function brokerKeyOf(end, providerKey) {
  return "remote:" + end + ":" + providerKey;
}
function brokerKeys(state, now, options) {
  const local = textOf(options?.localEnd ?? null);
  const rows = [];
  for (const manifest of state.manifests.ends) {
    if (local !== null && manifest.end === local) continue;
    const reading = effectiveCapabilities(state, manifest.end, now, options);
    if (reading.missing.length > 0) continue;
    if (reading.capabilities.length === 0) continue;
    for (const name2 of reading.capabilities) {
      rows.push({ key: brokerKeyOf(manifest.end, name2), end: manifest.end, providerKey: name2, via: manifest.via, capabilities: reading.capabilities });
    }
  }
  return rows.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
function brokerCall(state, key, now, options) {
  if (typeof key !== "string" || key === "") throw new TypeError("brokerCall: key must be a non-empty string, as brokerKeys spelled it");
  const local = textOf(options?.localEnd ?? null);
  if (local === null) throw new TypeError('brokerCall: localEnd must name the end asking; "may this end call that one" has no answer without it');
  const offered = /* @__PURE__ */ new Map();
  for (const manifest of state.manifests.ends) {
    for (const name2 of manifest.declared) offered.set(brokerKeyOf(manifest.end, name2), { end: manifest.end, providerKey: name2 });
  }
  const hit = offered.get(key);
  if (hit === void 0) return { code: "unknown-key", key, end: null, providerKey: null };
  const reading = effectiveCapabilities(state, hit.end, now, { timeoutMs: options.timeoutMs, localEnd: local });
  if (reading.missing.length > 0) {
    return { code: "service-gone", key, end: hit.end, providerKey: hit.providerKey, reason: reading.missing[0].code };
  }
  if (!reading.capabilities.includes(hit.providerKey)) {
    const lost = reading.path.find((hop) => (state.manifests.ends.find((row) => row.end === hop)?.capabilities ?? []).includes(hit.providerKey) === false) ?? hit.end;
    return { code: "service-gone", key, end: hit.end, providerKey: hit.providerKey, reason: "meet:" + lost };
  }
  if (!mayExchange(state, local, hit.end)) return { code: "not-granted", key, end: hit.end, providerKey: hit.providerKey };
  const onEnd = membersWith(state, hit.providerKey).filter((id) => hostedEndOf(state, id) === hit.end);
  if (onEnd.length === 0) return { code: "no-provider", key, end: hit.end, providerKey: hit.providerKey };
  const provider = mcpCall(state, hit.providerKey, now, { timeoutMs: options.timeoutMs, localEnd: local });
  if (provider.reason === "ok") return { code: "ok", key, end: hit.end, providerKey: hit.providerKey };
  if (provider.reason === "provider-silent") return { code: "provider-silent", key, end: hit.end, providerKey: hit.providerKey };
  return { code: "no-provider", key, end: hit.end, providerKey: hit.providerKey };
}
var MERGE_KIND = "team/merge";
var MergeRefusal = class extends Error {
  /** The stable code this refusal is named by. */
  code;
  /**
   * @param code - the code, e.g. MERGE_NOT_AUTHORIZED.
   * @param detail - what was refused, and what the caller should send instead.
   */
  constructor(code, detail) {
    super(code + ": " + detail);
    this.name = "MergeRefusal";
    this.code = code;
  }
};
function mergeRecord(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MergeRefusal("MERGE_INPUT", "this takes one object of arguments; got " + describeValue(input));
  }
  const args = input;
  const refuse = (code, detail) => new MergeRefusal(code, detail);
  const from = requiredName(args.from, "from", "MERGE_", refuse);
  const to = requiredName(args.to, "to", "MERGE_", refuse);
  const by = requiredName(args.by, "by", "MERGE_", refuse);
  if (from === to) {
    throw new MergeRefusal("MERGE_SELF", "team " + describeValue(from) + " cannot merge with itself; name the team at the other end (a team cannot be its own parent)");
  }
  const mode = args.mode;
  if (mode !== "join" && mode !== "absorb") {
    throw new MergeRefusal("MERGE_MODE", "mode " + describeValue(mode ?? null) + " is not a direction; use join (the asking team is taken in) or absorb (the asking team takes the other in)");
  }
  const state = args.state;
  if (state !== "requested" && state !== "granted" && state !== "denied") {
    throw new MergeRefusal("MERGE_STATE", "state " + describeValue(state ?? null) + " is not one of the three this vocabulary holds: requested, granted or denied");
  }
  const at = args.at;
  if (typeof at !== "number" || !Number.isFinite(at)) {
    throw new MergeRefusal("MERGE_AT", "at must be a finite number of milliseconds; got " + describeValue(at ?? null));
  }
  return { kind: MERGE_KIND, subject: from, payload: { from, to, state, mode, by, at } };
}
function emptyMergesFold() {
  return { rows: [], malformed: 0 };
}
function foldMerges(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== MERGE_KIND) continue;
    const payload = record.payload;
    const from = textOf(payload?.from) ?? textOf(record.subject);
    const to = textOf(payload?.to);
    const by = textOf(payload?.by);
    const at = payload?.at;
    const mode = payload?.mode;
    const stateName = payload?.state;
    if (from === null || to === null || by === null || typeof at !== "number" || !Number.isFinite(at)) {
      state.malformed += 1;
      continue;
    }
    if (mode !== "join" && mode !== "absorb") {
      state.malformed += 1;
      continue;
    }
    if (stateName !== "requested" && stateName !== "granted" && stateName !== "denied") {
      state.malformed += 1;
      continue;
    }
    state.rows.push({ from, to, mode, state: stateName, by, at, seq: record.seq });
  }
}
function finishMerges(state) {
  const winners = /* @__PURE__ */ new Map();
  for (const row of state.rows) winners.set(row.from + "->" + row.to, row);
  const pairs = [...winners.values()].sort((left, right) => {
    if (left.from !== right.from) return left.from < right.from ? -1 : 1;
    return left.to < right.to ? -1 : left.to > right.to ? 1 : 0;
  });
  return { merges: state.rows, pairs, malformed: state.malformed };
}
function projectMerges(records) {
  const state = emptyMergesFold();
  foldMerges(state, records);
  return finishMerges(state);
}
function mayMerge(state, from, to) {
  if (!mayExchange(state, from, to)) return false;
  return state.merges.pairs.find((pair) => pair.from === from && pair.to === to)?.state === "granted";
}
var ADAPTER_KIND = "adapter/state";
var SUPPORTED_PROTOCOLS = ["dsh-link-adapter/1"];
var MCP_SERVER_INFO = { name: "dsh-link-collab", version: "1" };
function adapterRecord(adapterId, platform, protocolVersion, offers) {
  if (typeof adapterId !== "string" || adapterId === "") throw new TypeError("adapterRecord: adapterId must be a non-empty string");
  if (typeof platform !== "string" || platform === "") throw new TypeError("adapterRecord: platform must be a non-empty string");
  if (typeof protocolVersion !== "string" || protocolVersion === "") throw new TypeError("adapterRecord: protocolVersion must be a non-empty string");
  if (!Array.isArray(offers)) throw new TypeError("adapterRecord: offers must be an array of capability names");
  return { kind: ADAPTER_KIND, subject: adapterId, payload: { id: adapterId, platform, protocolVersion, offers: sortedNames(offers) } };
}
function sortedNames(names) {
  return [...new Set(names.filter((name2) => typeof name2 === "string" && name2 !== ""))].sort();
}
function adapterClaimOf(record) {
  const payload = record.payload;
  const subject = typeof record.subject === "string" && record.subject !== "" ? record.subject : null;
  const id = typeof payload?.id === "string" && payload.id !== "" ? payload.id : subject;
  if (id === null) return null;
  if (typeof payload?.platform !== "string") return null;
  if (typeof payload?.protocolVersion !== "string") return null;
  if (!Array.isArray(payload?.offers)) return null;
  const at = typeof payload.at === "number" && Number.isFinite(payload.at) ? payload.at : record.at;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { id, platform: payload.platform, protocolVersion: payload.protocolVersion, offers: sortedNames(payload.offers), at };
}
function emptyAdaptersFold() {
  return { adapters: /* @__PURE__ */ new Map(), refused: [] };
}
function foldAdapters(state, records) {
  for (const record of orderedRecords(records)) {
    if (record.kind !== ADAPTER_KIND) continue;
    const claim = adapterClaimOf(record);
    if (claim === null) {
      const payload = record.payload;
      const subject = typeof record.subject === "string" && record.subject !== "" ? record.subject : null;
      const named = typeof payload?.id === "string" && payload.id !== "" ? payload.id : subject;
      state.refused.push({ id: named, reason: "malformed", seq: record.seq });
      continue;
    }
    const previous = state.adapters.get(claim.id);
    const incoming = { platform: claim.platform, protocolVersion: claim.protocolVersion, offers: [...claim.offers], at: claim.at, seq: record.seq, writer: record.actor ?? null };
    if (previous === void 0) {
      state.adapters.set(claim.id, {
        id: claim.id,
        platform: incoming.platform,
        protocolVersion: incoming.protocolVersion,
        offers: [...incoming.offers],
        at: incoming.at,
        seq: incoming.seq,
        resolvedBy: "seq",
        contested: false,
        losers: []
      });
      continue;
    }
    const held = { platform: previous.platform, protocolVersion: previous.protocolVersion, offers: [...previous.offers], at: previous.at, seq: previous.seq, writer: null };
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: incoming.at, seq: incoming.seq });
    const winner = folded.incomingWins ? incoming : held;
    const loser = folded.incomingWins ? held : incoming;
    const disagrees = loser.platform !== winner.platform || loser.protocolVersion !== winner.protocolVersion || loser.offers.join("\0") !== winner.offers.join("\0");
    state.adapters.set(claim.id, {
      id: claim.id,
      platform: winner.platform,
      protocolVersion: winner.protocolVersion,
      offers: [...winner.offers],
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? "at" : "seq",
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers
    });
  }
}
function finishAdapters(state) {
  return {
    adapters: [...state.adapters.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    refused: state.refused,
    malformed: state.refused.length
  };
}
function projectAdapters(records) {
  const state = emptyAdaptersFold();
  foldAdapters(state, records);
  return finishAdapters(state);
}
function admitAdapter(state, adapterId, options) {
  const supported = [...SUPPORTED_PROTOCOLS];
  const row = state.adapters.adapters.find((entry) => entry.id === adapterId);
  if (row === void 0) return { ok: false, reason: "undeclared-adapter", platform: null, protocolVersion: null, supported, missing: [], extra: [] };
  const registered = capabilitiesOf(state, adapterId);
  const missing = row.offers.filter((name2) => !registered.includes(name2)).sort();
  const extra = registered.filter((name2) => !row.offers.includes(name2)).sort();
  if (row.platform === "") return { ok: false, reason: "empty-platform", platform: null, protocolVersion: row.protocolVersion, supported, missing, extra };
  const asked = options?.protocolVersion;
  if (asked !== void 0 && !supported.includes(asked)) {
    return { ok: false, reason: "unsupported-protocol", platform: row.platform, protocolVersion: asked, supported, missing, extra };
  }
  if (!supported.includes(row.protocolVersion)) {
    return { ok: false, reason: "unsupported-protocol", platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra };
  }
  if (missing.length > 0) return { ok: false, reason: "capability-mismatch", platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra };
  return { ok: true, reason: "ok", platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra };
}
function mcpInitialize(state, request) {
  void state;
  const supported = [...SUPPORTED_PROTOCOLS];
  const asked = typeof request?.protocolVersion === "string" && request.protocolVersion !== "" ? request.protocolVersion : null;
  if (asked === null) return { ok: true, reason: "ok", protocolVersion: SUPPORTED_PROTOCOLS[0], supported, serverInfo: MCP_SERVER_INFO };
  if (!supported.includes(asked)) return { ok: false, reason: "unsupported-protocol", protocolVersion: asked, supported, serverInfo: MCP_SERVER_INFO };
  return { ok: true, reason: "ok", protocolVersion: asked, supported, serverInfo: MCP_SERVER_INFO };
}
function mcpTools(state, now, options) {
  const livenesses = new Map(livenessOf(state, now, options).map((reading) => [reading.memberId, reading.liveness]));
  const reachable = new Set(routes(state, options.localEnd, now, { timeoutMs: options.timeoutMs }).map((row) => row.member));
  return Object.keys(state.registry.byCapability).sort().map((name2) => ({
    name: name2,
    availableFrom: (state.registry.byCapability[name2] ?? []).filter((id) => livenesses.get(id) === "healthy" && reachable.has(id)).sort()
  }));
}
function mcpCall(state, name2, now, options) {
  const declaredBy = membersWith(state, name2);
  if (declaredBy.length === 0) return { ok: false, reason: "unknown-tool", declaredBy: [], healthy: [] };
  const livenesses = new Map(livenessOf(state, now, { timeoutMs: options.timeoutMs }).map((reading) => [reading.memberId, reading.liveness]));
  const healthy = declaredBy.filter((id) => livenesses.get(id) === "healthy");
  if (healthy.length === 0) return { ok: false, reason: "no-provider", declaredBy, healthy };
  const reachable = new Set(routes(state, options.localEnd, now, { timeoutMs: options.timeoutMs }).map((row) => row.member));
  if (!healthy.some((id) => reachable.has(id))) return { ok: false, reason: "provider-silent", declaredBy, healthy };
  return { ok: true, reason: "ok", declaredBy, healthy };
}
var MCP_PROTOCOL_VERSION = "2025-06-18";
function spawnMcpServer(spec) {
  const child = spawnChild(spec.command, [...spec.args ?? []], {
    stdio: ["pipe", "pipe", "pipe"],
    ...spec.env === void 0 ? {} : { env: { ...process.env, ...spec.env } },
    ...spec.cwd === void 0 ? {} : { cwd: spec.cwd },
    windowsHide: true
  });
  return child;
}
function verdictOf(answer2) {
  return answer2.kind === "error" ? "protocol-error" : answer2.kind;
}
function createMcpClient(options) {
  const server = options?.server;
  if (server === null || typeof server?.command !== "string" || server.command === "") {
    throw new TypeError("createMcpClient: server.command must be a non-empty string");
  }
  const protocolVersion = options.protocolVersion === void 0 ? MCP_PROTOCOL_VERSION : options.protocolVersion;
  const timeoutMs = options.timeoutMs === void 0 ? 1e4 : options.timeoutMs;
  const now = options.now ?? (() => Date.now());
  const child = (options.spawn ?? spawnMcpServer)(server);
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderrStream = child.stderr ?? null;
  const waiting = /* @__PURE__ */ new Map();
  let nextId = 1;
  let sent = 0;
  let received = 0;
  let latch = null;
  let died = null;
  let closed = false;
  let finished = null;
  const stderrLines = [];
  let outBuffer = "";
  let errBuffer = "";
  const settle = (id, answer2) => {
    const entry = waiting.get(id);
    if (entry === void 0) return;
    waiting.delete(id);
    clearTimeout(entry.timer);
    entry.settle(answer2);
  };
  const settleAll = (answer2) => {
    for (const id of [...waiting.keys()]) settle(id, answer2(id));
  };
  const onLine = (line) => {
    if (line === "") return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      latch = { reason: "malformed-frame", detail: "the server wrote a line that is not JSON" };
      settleAll(() => ({ ok: false, kind: "protocol-error", detail: "the server wrote a line that is not JSON" }));
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      latch = { reason: "malformed-frame", detail: "the server wrote a line that is not a JSON-RPC message" };
      settleAll(() => ({ ok: false, kind: "protocol-error", detail: "the server wrote a line that is not a JSON-RPC message" }));
      return;
    }
    received += 1;
    const frame = parsed;
    if (typeof frame.id !== "number") {
      if (typeof frame.method === "string") return;
      latch = { reason: "malformed-frame", detail: "the server wrote a message that is neither a reply nor a notification" };
      settleAll(() => ({ ok: false, kind: "protocol-error", detail: "the server wrote a message that is neither a reply nor a notification" }));
      return;
    }
    if (frame.error !== void 0 && frame.error !== null) {
      const error = frame.error;
      const code = typeof error.code === "number" ? error.code : null;
      const detail = typeof error.message === "string" ? error.message : "the server answered with an error";
      settle(frame.id, { ok: false, kind: "error", code, detail });
      return;
    }
    if (frame.result === void 0) {
      latch = { reason: "malformed-frame", detail: "a reply carried neither result nor error" };
      settleAll(() => ({ ok: false, kind: "protocol-error", detail: "a reply carried neither result nor error" }));
      return;
    }
    settle(frame.id, { ok: true, result: frame.result });
  };
  const feed = (buffer, chunk, take) => {
    let text = buffer + chunk;
    let cut = text.indexOf("\n");
    while (cut >= 0) {
      const line = text.slice(0, cut);
      text = text.slice(cut + 1);
      take(line.endsWith("\r") ? line.slice(0, -1) : line);
      cut = text.indexOf("\n");
    }
    return text;
  };
  if (stdout !== null) {
    stdout.on("data", (chunk) => {
      outBuffer = feed(outBuffer, String(chunk), onLine);
    });
  }
  if (stderrStream !== null) {
    stderrStream.on("data", (chunk) => {
      errBuffer = feed(errBuffer, String(chunk), (line) => {
        if (line !== "") stderrLines.push(line);
      });
    });
  }
  child.on("error", (error) => {
    died = "the server process failed: " + String(error?.message ?? error);
    settleAll(() => ({ ok: false, kind: "transport-error", reason: "server-exited", detail: died === null ? "the server is gone" : died }));
  });
  const noteExit = (...args) => {
    if (died === null) died = "the server exited before answering" + (args.length === 0 ? "" : " (code " + String(args[0]) + ")");
    settleAll(() => ({ ok: false, kind: "transport-error", reason: "server-exited", detail: died === null ? "the server is gone" : died }));
  };
  child.on("exit", noteExit);
  child.on("close", noteExit);
  const writeFrame = (frame) => {
    if (stdin === null) return { ok: false, kind: "transport-error", reason: "no-stdin", detail: "the server has no standard input" };
    try {
      stdin.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
      sent += 1;
      return null;
    } catch (error) {
      return { ok: false, kind: "transport-error", reason: "write-failed", detail: "writing to the server failed: " + String(error?.message ?? error) };
    }
  };
  const request = (method, params, override) => {
    if (closed) return Promise.resolve({ ok: false, kind: "transport-error", reason: "closed", detail: "the client is closed" });
    if (latch !== null) {
      return Promise.resolve({ ok: false, kind: "transport-error", reason: latch.reason, detail: "the session is latched closed after a protocol defect: " + latch.detail });
    }
    if (died !== null) return Promise.resolve({ ok: false, kind: "transport-error", reason: "server-exited", detail: died });
    const id = nextId;
    nextId += 1;
    const limit = override === void 0 ? timeoutMs : override;
    return new Promise((done) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        done({ ok: false, kind: "timeout", detail: "no answer within " + String(limit) + "ms" });
      }, limit);
      waiting.set(id, { settle: done, timer });
      const failed = writeFrame({ id, method, params });
      if (failed !== null) settle(id, failed);
    });
  };
  const initialize = async () => {
    if (finished !== null) return finished;
    const answer2 = await request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: options.clientName ?? "dsh-link-collab", version: options.clientVersion ?? "1" }
    });
    const at = now();
    const empty = { negotiated: null, serverInfo: null, capabilities: null, at };
    if (!answer2.ok) {
      return { ...empty, verdict: verdictOf(answer2), detail: answer2.detail, ...answer2.reason === void 0 ? {} : { reason: answer2.reason }, ...answer2.kind === "error" && answer2.code !== null ? { code: answer2.code } : {} };
    }
    const result = answer2.result;
    const negotiated = typeof result?.protocolVersion === "string" && result.protocolVersion !== "" ? result.protocolVersion : null;
    const info = result?.serverInfo;
    const serverInfo = info === null || typeof info?.name !== "string" || info.name === "" ? null : { name: info.name, version: typeof info.version === "string" ? info.version : "" };
    const capabilities = result?.capabilities ?? null;
    if (negotiated === null) {
      return { ...empty, serverInfo, capabilities, verdict: "protocol-error", detail: "the initialize result named no protocolVersion" };
    }
    if (negotiated !== protocolVersion) {
      return { ...empty, serverInfo, capabilities, negotiated, verdict: "refused", detail: "the server answered " + negotiated + " while this client proposed " + protocolVersion };
    }
    const failed = writeFrame({ method: "notifications/initialized", params: {} });
    if (failed !== null) return { ...empty, serverInfo, capabilities, negotiated, verdict: verdictOf(failed), detail: failed.detail };
    finished = { verdict: "ok", negotiated, serverInfo, capabilities, at };
    return finished;
  };
  const listTools = async (listOptions) => {
    const answer2 = await request("tools/list", listOptions?.cursor === void 0 ? {} : { cursor: listOptions.cursor });
    const empty = { tools: [], nextCursor: null };
    if (!answer2.ok) {
      return { ...empty, verdict: verdictOf(answer2), detail: answer2.detail, ...answer2.reason === void 0 ? {} : { reason: answer2.reason }, ...answer2.kind === "error" && answer2.code !== null ? { code: answer2.code } : {} };
    }
    const result = answer2.result;
    if (!Array.isArray(result?.tools)) {
      return { ...empty, verdict: "protocol-error", detail: "the tools/list result carried no tools array" };
    }
    const tools = [];
    for (const row of result.tools) {
      const entry = row;
      if (typeof entry?.name !== "string" || entry.name === "") {
        return { ...empty, verdict: "protocol-error", detail: "the server listed a tool without a name" };
      }
      tools.push({
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description : null,
        inputSchema: entry.inputSchema ?? null
      });
    }
    return { verdict: "ok", tools, nextCursor: typeof result.nextCursor === "string" ? result.nextCursor : null };
  };
  const callTool = async (name2, args, callOptions) => {
    const answer2 = await request("tools/call", { name: name2, arguments: args }, callOptions?.timeoutMs);
    const empty = { content: [], isError: false };
    if (!answer2.ok) {
      if (answer2.kind === "error" && answer2.code === -32602) {
        return { ...empty, verdict: "unknown-tool", code: -32602, detail: answer2.detail };
      }
      return { ...empty, verdict: verdictOf(answer2), detail: answer2.detail, ...answer2.reason === void 0 ? {} : { reason: answer2.reason }, ...answer2.kind === "error" && answer2.code !== null ? { code: answer2.code } : {} };
    }
    const result = answer2.result;
    if (!Array.isArray(result?.content)) {
      return { ...empty, verdict: "protocol-error", detail: "the tools/call result carried no content array" };
    }
    const isError = result?.isError === true;
    return { verdict: isError ? "tool-error" : "ok", content: result.content, isError };
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    settleAll(() => ({ ok: false, kind: "transport-error", detail: "the client was closed" }));
    try {
      stdin?.end?.();
    } catch {
    }
    const gone = (limit) => new Promise((done) => {
      if (died !== null) {
        done();
        return;
      }
      const timer = setTimeout(() => {
        done();
      }, limit);
      const finish = () => {
        clearTimeout(timer);
        done();
      };
      child.on("exit", finish);
      child.on("close", finish);
    });
    if (child.pid !== null && died === null) {
      try {
        child.kill();
      } catch {
      }
      await gone(500);
      if (died === null) {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        await gone(2e3);
      }
    }
  };
  return {
    initialize,
    listTools,
    callTool,
    close,
    get pid() {
      return child.pid;
    },
    get frames() {
      return { sent, received };
    },
    get stderr() {
      return [...stderrLines];
    }
  };
}
function mcpToolRecords(adapterId, tools) {
  const names = (Array.isArray(tools) ? tools : []).map((tool) => tool?.name);
  return [capabilityRecord(adapterId, names)];
}
function mcpDispatchOutcome(verdict) {
  const name2 = verdict?.verdict;
  if (name2 === "ok") return { ok: true, value: { content: verdict.content, isError: false } };
  if (name2 === "tool-error") {
    const blocks = verdict.content;
    const first = Array.isArray(blocks) ? blocks.find((block) => block?.type === "text" && typeof block.text === "string") : void 0;
    const text = first?.text;
    return { ok: false, error: typeof text === "string" ? text : "tool-error" };
  }
  if (name2 === "unknown-tool") return { ok: false, error: "unknown-tool" };
  if (name2 === "protocol-error") return { ok: false, error: "protocol-error" };
  if (name2 === "transport-error") {
    const reason = verdict.reason;
    return { ok: false, error: typeof reason === "string" && reason !== "" ? "transport-error:" + reason : "transport-error" };
  }
  if (name2 === "timeout") return { ok: false, error: "timeout" };
  throw new TypeError("mcpDispatchOutcome: " + String(JSON.stringify(name2)) + " is not a verdict this build maps (ok | tool-error | unknown-tool | protocol-error | transport-error | timeout)");
}
function installMcpTools(into, tools, client) {
  if (into === null || typeof into?.register !== "function" || typeof into?.has !== "function") {
    throw new TypeError("installMcpTools: into must be a tool registry");
  }
  if (client === null || typeof client?.callTool !== "function") {
    throw new TypeError("installMcpTools: client must be an MCP client");
  }
  const disposers = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name2 = tool?.name;
    if (typeof name2 !== "string" || name2 === "") throw new TypeError("installMcpTools: every tool must carry a name");
    disposers.push(into.register(name2, async (args) => {
      const outcome = mcpDispatchOutcome(await client.callTool(name2, args));
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.value;
    }));
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const dispose of [...disposers].reverse()) dispose();
  };
}
function stateOf(record) {
  const payload = record.payload;
  if (payload === void 0 || typeof payload.id !== "string" || payload.id === "") return null;
  const keepOwner = !attackFlag("DSH_LINK_COLLAB_DROP_OWNER");
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  return {
    id: payload.id,
    team: teamOf(record),
    state: text(payload.state) ?? "open",
    owner: keepOwner ? text(payload.owner) : null,
    name: text(payload.name),
    role: text(payload.role)
  };
}
var DISPATCH_KIND = "task/dispatch";
var RESULT_KIND = "task/result";
function dispatchRecord(id, to, tool, args, at, options) {
  if (typeof id !== "string" || id === "") throw new TypeError("dispatchRecord: id must be a non-empty string");
  if (typeof to !== "string" || to === "") throw new TypeError("dispatchRecord: to must be a non-empty string");
  if (typeof tool !== "string" || tool === "") throw new TypeError("dispatchRecord: tool must be a non-empty string");
  const retry = options?.retryOf === void 0 ? {} : { retryOf: options.retryOf, attempt: options.attempt ?? attemptOf(id).attempt };
  return { kind: DISPATCH_KIND, subject: id, payload: { id, to, tool, args, at, ...retry } };
}
function resultRecord(id, from, outcome, at) {
  if (typeof id !== "string" || id === "") throw new TypeError("resultRecord: id must be a non-empty string");
  if (typeof from !== "string" || from === "") throw new TypeError("resultRecord: from must be a non-empty string");
  const payload = outcome.ok ? { id, from, ok: true, value: outcome.value, at } : { id, from, ok: false, error: outcome.error, at };
  return { kind: RESULT_KIND, subject: id, payload };
}
function dispatchOf(record) {
  if (record.kind !== DISPATCH_KIND) return null;
  const payload = record.payload;
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  const id = text(payload?.id) ?? text(record.subject);
  const to = text(payload?.to);
  const tool = text(payload?.tool);
  if (id === null || to === null || tool === null) return null;
  const retryOf = text(payload?.retryOf);
  const attempt = typeof payload?.attempt === "number" && Number.isInteger(payload.attempt) && payload.attempt > 0 ? payload.attempt : void 0;
  return {
    id,
    to,
    tool,
    args: payload?.args,
    at: typeof payload?.at === "number" ? payload.at : record.at,
    ...retryOf === null ? {} : { retryOf },
    ...attempt === void 0 ? {} : { attempt }
  };
}
function answerOf(record) {
  if (record.kind !== RESULT_KIND) return null;
  const payload = record.payload;
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  const id = text(payload?.id) ?? text(record.subject);
  const from = text(payload?.from) ?? text(record.actor);
  if (id === null || from === null || typeof payload?.ok !== "boolean") return null;
  const at = typeof payload.at === "number" ? payload.at : record.at;
  const outcome = payload.ok === true ? { ok: true, value: payload.value } : { ok: false, error: typeof payload.error === "string" ? payload.error : "failed" };
  return { id, from, outcome, at };
}
function emptyDispatchesFold() {
  return { entries: /* @__PURE__ */ new Map(), refusedDispatches: [], refusedResults: [], accepted: /* @__PURE__ */ new Map(), maxRetryAt: null, members: /* @__PURE__ */ new Set(), leasesSeen: -1, leasesByRoot: /* @__PURE__ */ new Map() };
}
function foldDispatches(state, records, declared, leases) {
  if (state.leasesSeen !== leases.length) {
    state.leasesSeen = leases.length;
    state.leasesByRoot = /* @__PURE__ */ new Map();
    for (const lease of leases) {
      const bucket = state.leasesByRoot.get(lease.root);
      if (bucket === void 0) state.leasesByRoot.set(lease.root, [lease]);
      else bucket.push(lease);
    }
  }
  const ordered = orderedRecords(records);
  for (const record of ordered) {
    const request = dispatchOf(record);
    if (request === null) continue;
    const writer = record.actor ?? record.writer ?? null;
    state.members.add(request.to);
    if (request.retryOf !== void 0) {
      if (state.maxRetryAt === null || request.at > state.maxRetryAt) state.maxRetryAt = request.at;
      const attemptRoot = attemptOf(request.id).root;
      const rootLeases = state.leasesByRoot.get(attemptRoot) ?? [];
      const held = retryOwner(rootLeases.filter((lease) => lease.at <= request.at), { root: attemptRoot, localEnd: writer ?? "", now: request.at });
      if (held.holder !== null && held.holder !== writer) {
        state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: "lease-mismatch" });
        continue;
      }
    }
    if (state.entries.has(request.id)) {
      state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: "duplicate-id" });
      continue;
    }
    state.entries.set(request.id, { request, seq: record.seq });
    if (!declared.byCapability[request.tool]?.includes(request.to)) {
      state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: "capability-mismatch" });
    }
  }
  const refusedIds = new Set(state.refusedDispatches.filter((row) => row.reason === "capability-mismatch").map((row) => row.id));
  for (const record of ordered) {
    const answer2 = answerOf(record);
    if (answer2 === null) continue;
    const entry = state.entries.get(answer2.id);
    if (entry === void 0) {
      state.refusedResults.push({ id: answer2.id, from: answer2.from, at: answer2.at, seq: record.seq, reason: "unknown-id" });
      continue;
    }
    if (refusedIds.has(answer2.id)) {
      state.refusedResults.push({ id: answer2.id, from: answer2.from, at: answer2.at, seq: record.seq, reason: "refused-dispatch" });
      continue;
    }
    if (answer2.from !== entry.request.to) {
      state.refusedResults.push({ id: answer2.id, from: answer2.from, at: answer2.at, seq: record.seq, reason: "wrong-writer" });
      continue;
    }
    if (state.accepted.has(answer2.id)) {
      state.refusedResults.push({ id: answer2.id, from: answer2.from, at: answer2.at, seq: record.seq, reason: "duplicate-result" });
      continue;
    }
    state.accepted.set(answer2.id, { id: answer2.id, from: answer2.from, ok: answer2.outcome.ok, ...answer2.outcome.ok ? { value: answer2.outcome.value } : { error: answer2.outcome.error }, at: answer2.at, seq: record.seq });
  }
}
function finishDispatches(state) {
  const refusedIds = new Set(state.refusedDispatches.filter((row) => row.reason === "capability-mismatch").map((row) => row.id));
  const dispatches = [...state.entries.values()].map((entry) => {
    const result = state.accepted.get(entry.request.id) ?? null;
    const status = refusedIds.has(entry.request.id) ? "refused" : result === null ? "pending" : "answered";
    return { ...entry.request, seq: entry.seq, status, result };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const results = [...state.accepted.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const pending = dispatches.filter((entry) => entry.status === "pending").map((entry) => entry.id);
  const refusedDispatches = [...state.refusedDispatches].sort((left, right) => left.seq - right.seq);
  const refusedResults = [...state.refusedResults].sort((left, right) => left.seq - right.seq);
  return {
    dispatches,
    results,
    pending,
    refusedDispatches,
    refusedResults,
    counts: {
      dispatches: dispatches.length,
      results: results.length,
      pending: pending.length,
      refusedDispatches: refusedDispatches.length,
      refusedResults: refusedResults.length
    }
  };
}
function projectDispatches(records) {
  const state = emptyDispatchesFold();
  foldDispatches(state, records, projectRegistry(records), projectRetryLeases(records));
  return finishDispatches(state);
}
function timeoutOf(raw, caller) {
  if (raw === void 0) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new TypeError(caller + ": timeoutMs must be a finite, non-negative number of milliseconds");
  }
  return raw;
}
function resolveDispatch(state, id, now, options) {
  const threshold = timeoutOf(options?.timeoutMs, "resolveDispatch");
  const entry = state.dispatches.dispatches.find((row) => row.id === id);
  if (entry === void 0) return { id, verdict: "unknown-id" };
  if (entry.status !== "pending") return { id, verdict: entry.status };
  if (threshold === null) return { id, verdict: "pending" };
  return { id, verdict: now - entry.at >= threshold ? "stale" : "pending" };
}
function expiredDispatches(state, now, options) {
  const threshold = timeoutOf(options?.timeoutMs, "expiredDispatches");
  if (threshold === null) throw new TypeError("expiredDispatches: timeoutMs is required");
  return state.dispatches.dispatches.filter((entry) => resolveDispatch(state, entry.id, now, { timeoutMs: threshold }).verdict === "stale").map((entry) => entry.id).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
function acceptResult(state, draft) {
  const entry = state.dispatches.dispatches.find((row) => row.id === draft.payload.id);
  if (entry === void 0) return { id: draft.payload.id, accepted: false, reason: "unknown-id" };
  if (entry.status === "refused") return { id: entry.id, accepted: false, reason: "refused-dispatch" };
  if (draft.payload.from !== entry.to) return { id: entry.id, accepted: false, reason: "wrong-writer" };
  if (entry.result !== null) return { id: entry.id, accepted: false, reason: "duplicate-result" };
  return { id: entry.id, accepted: true, reason: "accepted" };
}
async function appendResult(state, log, draft) {
  const verdict = acceptResult(state, draft);
  if (verdict.reason === "accepted") {
    const seq = await log.append(draft);
    return { appended: true, reason: "ok", seq };
  }
  return { appended: false, reason: verdict.reason, seq: null };
}
function isThenable(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
function createLocalTools() {
  const handlers = /* @__PURE__ */ new Map();
  return {
    register: (name2, handler) => {
      if (typeof name2 !== "string" || name2 === "") throw new TypeError("register: name must be a non-empty string");
      if (typeof handler !== "function") throw new TypeError("register: handler must be a function");
      const previous = handlers.get(name2);
      handlers.set(name2, handler);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        if (previous === void 0) handlers.delete(name2);
        else handlers.set(name2, previous);
      };
    },
    has: (name2) => handlers.has(name2),
    invoke: (name2, args) => {
      const handler = handlers.get(name2);
      if (handler === void 0) return { ok: false, error: "unknown-tool" };
      let produced;
      try {
        produced = handler(args);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (isThenable(produced)) {
        return Promise.resolve(produced).then(
          (settled) => ({ ok: true, value: settled }),
          (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
        );
      }
      return { ok: true, value: produced };
    }
  };
}
async function executeDispatches(state, options) {
  const executed = [];
  const refused = [];
  const at = options.at ?? options.now;
  for (const id of state.dispatches.pending) {
    const entry = state.dispatches.dispatches.find((row) => row.id === id);
    if (entry === void 0 || entry.to !== options.local) continue;
    const mine = attemptOf(id);
    const superseded = state.dispatches.dispatches.some((row) => {
      const other = attemptOf(row.id);
      return other.root === mine.root && other.attempt > mine.attempt;
    });
    if (superseded) {
      refused.push({ id, reason: "superseded" });
      continue;
    }
    if (!options.tools.has(entry.tool)) {
      refused.push({ id, reason: "unknown-tool" });
      continue;
    }
    const outcome = await options.tools.invoke(entry.tool, entry.args);
    const written = await appendResult(state, options.log, resultRecord(id, options.local, outcome, at));
    executed.push({ id, outcome, reason: written.reason });
  }
  return { executed, refused };
}
function attemptOf(id) {
  const match = /^(.*)#r(\d+)$/.exec(id);
  if (match === null) return { root: id, attempt: 1 };
  return { root: match[1], attempt: Number(match[2]) };
}
var RETRY_LEASE_KIND = "task/retry-lease";
function retryLeaseRecord(root, end, at, untilMs) {
  if (typeof root !== "string" || root === "") throw new TypeError("retryLeaseRecord: root must be a non-empty string");
  if (typeof end !== "string" || end === "") throw new TypeError("retryLeaseRecord: end must be a non-empty string");
  if (!Number.isInteger(untilMs) || untilMs <= 0) throw new TypeError("retryLeaseRecord: untilMs must be a positive integer");
  return { kind: RETRY_LEASE_KIND, subject: root, payload: { root, end, at, untilMs } };
}
function leaseOf(record) {
  if (record.kind !== RETRY_LEASE_KIND) return null;
  const payload = record.payload;
  const text = (value) => typeof value === "string" && value !== "" ? value : null;
  const root = text(payload?.root) ?? text(record.subject);
  const end = text(payload?.end) ?? text(record.actor);
  const untilMs = payload?.untilMs;
  if (root === null || end === null) return null;
  if (typeof untilMs !== "number" || !Number.isInteger(untilMs) || untilMs <= 0) return null;
  return { root, end, at: typeof payload?.at === "number" ? payload.at : record.at, untilMs };
}
function emptyRetryLeasesFold() {
  return { rows: [] };
}
function foldRetryLeases(state, records) {
  for (const record of records) {
    const lease = leaseOf(record);
    if (lease === null) continue;
    state.rows.push({ ...lease, seq: record.seq });
  }
}
function finishRetryLeases(state) {
  return [...state.rows].sort((left, right) => left.at - right.at || left.seq - right.seq);
}
function projectRetryLeases(records) {
  const state = emptyRetryLeasesFold();
  foldRetryLeases(state, records);
  return finishRetryLeases(state);
}
function retryOwner(leases, options) {
  const relevant = leases.filter((lease) => lease.root === options.root);
  if (relevant.length === 0) return { holder: null, mine: false, reason: "unclaimed" };
  const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs);
  if (live.length === 0) return { holder: null, mine: false, reason: "expired" };
  const ordered = [...live].sort((left, right) => (left.end < right.end ? -1 : left.end > right.end ? 1 : 0) || left.at - right.at || left.seq - right.seq);
  const holder = ordered[0].end;
  const mine = holder === options.localEnd;
  return { holder, mine, reason: mine ? "mine" : "other" };
}
function redispatchPlan(state, options) {
  const stale = expiredDispatches(state, options.now, { timeoutMs: options.timeoutMs });
  const entries = [];
  const blocked = [];
  const byId = new Map(state.dispatches.dispatches.map((row) => [row.id, row]));
  const leasesByRoot = /* @__PURE__ */ new Map();
  for (const lease of state.retryLeases) {
    const bucket = leasesByRoot.get(lease.root);
    if (bucket === void 0) leasesByRoot.set(lease.root, [lease]);
    else bucket.push(lease);
  }
  for (const id of stale) {
    const entry = byId.get(id);
    if (entry === void 0) continue;
    const { root, attempt } = attemptOf(id);
    const next = attempt + 1;
    const owner = retryOwner(leasesByRoot.get(root) ?? [], { root, localEnd: options.localEnd, now: options.now });
    if (owner.reason === "other") {
      blocked.push({ from: id, attempt: next, reason: "lease-held" });
      continue;
    }
    if (next > options.maxAttempts) {
      blocked.push({ from: id, attempt: next, reason: "attempts-exhausted" });
      continue;
    }
    const candidate = root + "#r" + String(next);
    if (state.dispatches.dispatches.some((row) => row.id === candidate)) {
      blocked.push({ from: id, attempt: next, reason: "already-attempted" });
      continue;
    }
    const reachable = assignThrough(state, options.team, entry.to, options.localEnd, options.now, { timeoutMs: options.timeoutMs });
    if (!reachable.ok) {
      blocked.push({ from: id, attempt: next, reason: reachable.reason });
      continue;
    }
    entries.push({ from: id, id: candidate, attempt: next, to: entry.to, tool: entry.tool, args: entry.args });
  }
  entries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  blocked.sort((left, right) => left.from < right.from ? -1 : left.from > right.from ? 1 : 0);
  return { entries, blocked };
}
async function appendRedispatches(state, log, options) {
  const plan = redispatchPlan(state, options);
  if (plan.entries.length === 0) return [];
  const written = [];
  let folded = state;
  const roots = [...new Set(plan.entries.map((entry) => attemptOf(entry.id).root))].sort();
  for (const root of roots) {
    const before = retryOwner(folded.retryLeases, { root, localEnd: options.localEnd, now: options.now });
    if (before.reason !== "unclaimed" && before.reason !== "expired") continue;
    written.push(await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs)));
    folded = foldStateOf(log);
  }
  folded = folded === state ? foldStateOf(log) : folded;
  const decided = redispatchPlan(folded, options);
  for (const entry of decided.entries) {
    written.push(await log.append({
      ...dispatchRecord(entry.id, entry.to, entry.tool, entry.args, options.now, { retryOf: attemptOf(entry.id).root, attempt: entry.attempt }),
      actor: options.localEnd
    }));
  }
  return written;
}
var READABLE_KINDS = [TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, MESSAGE_KIND, PEER_KIND, LOCK_KIND, SESSION_KIND, HANDOFF_KIND, TURN_KIND, HOST_KIND, ADAPTER_KIND, DISPATCH_KIND, RESULT_KIND, RETRY_LEASE_KIND, QUARANTINE_KIND, MANIFEST_KIND, MERGE_KIND];
function projectTeamState(records) {
  const state = emptyTeamFold();
  foldTeamRecords(state, records);
  return finishTeamFold(state);
}
var FOLD_DROPPED_KINDS = [];
var FOLD_ACCUMULATOR_VERSION = 1;
function emptyTeamFold() {
  return {
    format: FOLD_ACCUMULATOR_VERSION,
    through: 0,
    recordCount: 0,
    folded: 0,
    unknown: 0,
    unattributed: 0,
    tasks: /* @__PURE__ */ new Map(),
    members: /* @__PURE__ */ new Map(),
    namedTeams: /* @__PURE__ */ new Set(),
    messages: { journal: 0, inbox: 0 },
    locks: emptyLocksFold(),
    board: emptyBoardFold(),
    peers: emptyPeersFold(),
    teams: emptyTeamsFold(),
    registry: emptyRegistryFold(),
    taskDemands: emptyTaskDemandsFold(),
    liveness: emptyLivenessFold(),
    quarantine: emptyQuarantineFold(),
    sessions: emptySessionsFold(),
    hosting: emptyHostingFold(),
    manifests: emptyManifestsFold(),
    merges: emptyMergesFold(),
    adapters: emptyAdaptersFold(),
    dispatches: emptyDispatchesFold(),
    retryLeases: emptyRetryLeasesFold()
  };
}
function foldTeamRecords(state, records) {
  if (state.format !== FOLD_ACCUMULATOR_VERSION) throw new TypeError("foldTeamRecords: unknown accumulator format " + String(state.format));
  for (const record of records) {
    state.recordCount += 1;
    state.through = Math.max(state.through, record.seq);
    if (record.kind === MESSAGE_KIND) {
      const messageState = record.payload?.state;
      if (messageState === "queued" || messageState === "delivered") state.messages.journal += 1;
      else if (messageState === "accepted") state.messages.inbox += 1;
    }
    const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND ? stateOf(record) : null;
    if (!READABLE_KINDS.includes(record.kind)) state.unknown += 1;
    if (change === null) continue;
    state.folded += 1;
    if (change.team === null) state.unattributed += 1;
    else state.namedTeams.add(change.team);
    if (record.kind === TASK_KIND) {
      const id = boardKey(change.team, change.id);
      const previous = state.tasks.get(id);
      const incoming = { status: change.state, owner: change.owner, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null };
      if (previous === void 0) {
        state.tasks.set(id, { id: change.id, team: change.team, status: incoming.status, owner: incoming.owner, records: 1, at: record.seq, claim: incoming, resolvedBy: "arrival", contested: false, losers: [] });
      } else {
        const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq });
        const winner = folded.incomingWins ? incoming : previous.claim;
        const loser = folded.incomingWins ? previous.claim : incoming;
        const disagrees = loser.status !== winner.status || loser.owner !== winner.owner;
        state.tasks.set(id, {
          id: change.id,
          team: change.team,
          status: winner.status,
          owner: winner.owner,
          records: previous.records + 1,
          at: Math.max(previous.at, record.seq),
          claim: winner,
          resolvedBy: folded.byAt ? "at" : "arrival",
          contested: previous.contested || disagrees,
          losers: disagrees ? [loser, ...previous.losers] : previous.losers
        });
      }
    } else {
      const id = boardKey(change.team, change.id);
      const previous = state.members.get(id);
      const incoming = { name: change.name, state: change.state, role: change.role, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null };
      if (previous === void 0) {
        state.members.set(id, { id: change.id, team: change.team, name: incoming.name, state: incoming.state, role: incoming.role, at: record.seq, claim: incoming, resolvedBy: "arrival", contested: false, losers: [] });
      } else {
        const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq });
        const winner = folded.incomingWins ? incoming : previous.claim;
        const loser = folded.incomingWins ? previous.claim : incoming;
        const disagrees = loser.name !== winner.name || loser.state !== winner.state || loser.role !== winner.role;
        state.members.set(id, {
          id: change.id,
          team: change.team,
          name: winner.name,
          state: winner.state,
          role: winner.role,
          at: Math.max(previous.at, record.seq),
          claim: winner,
          resolvedBy: folded.byAt ? "at" : "arrival",
          contested: previous.contested || disagrees,
          losers: disagrees ? [loser, ...previous.losers] : previous.losers
        });
      }
    }
  }
  foldLocks(state.locks, records);
  foldPeers(state.peers, records);
  foldTeams(state.teams, records);
  foldRegistry(state.registry, records);
  foldTaskDemands(state.taskDemands, records);
  foldLiveness(state.liveness, records);
  foldQuarantine(state.quarantine, records);
  foldSessions(state.sessions, records);
  foldHosting(state.hosting, records);
  foldAdapters(state.adapters, records);
  foldRetryLeases(state.retryLeases, records);
  foldBoard(state.board, records);
  foldManifests(state.manifests, records);
  foldMerges(state.merges, records);
  foldDispatches(state.dispatches, records, finishRegistry(state.registry), finishRetryLeases(state.retryLeases));
}
function finishTeamFold(state) {
  const registry = finishRegistry(state.registry);
  return {
    tasks: [...state.tasks.values()],
    members: [...state.members.values()],
    through: state.through,
    counts: {
      folded: state.folded,
      unknown: state.unknown,
      tasks: state.tasks.size,
      members: state.members.size,
      teams: state.namedTeams.size,
      unattributed: state.unattributed
    },
    registry,
    liveness: finishLiveness(state.liveness),
    quarantine: finishQuarantine(state.quarantine),
    taskDemands: finishTaskDemands(state.taskDemands),
    teams: finishTeams(state.teams),
    peers: finishPeers(state.peers),
    board: finishBoard(state.board),
    locks: finishLocks(state.locks),
    sessions: finishSessions(state.sessions),
    hosting: finishHosting(state.hosting),
    adapters: finishAdapters(state.adapters),
    dispatches: finishDispatches(state.dispatches),
    retryLeases: finishRetryLeases(state.retryLeases),
    manifests: finishManifests(state.manifests, new Set(Object.keys(registry.byCapability))),
    merges: finishMerges(state.merges)
  };
}
function foldResumeSafety(state, suffix) {
  let expected = state.through;
  for (const record of suffix) {
    if (record.seq !== expected + 1) return "nonsequential-suffix";
    expected = record.seq;
    if (record.kind === RETRY_LEASE_KIND) {
      const maxRetryAt = state.dispatches.maxRetryAt;
      const lease = leaseOf(record);
      if (maxRetryAt !== null && lease !== null && lease.at <= maxRetryAt) return "lease-rewrites-folded-verdict";
      continue;
    }
    if (record.kind === CAPABILITY_KIND && state.dispatches.members.size > 0) {
      const declaration = declarationOf(record);
      if (declaration !== null && state.dispatches.members.has(declaration.id)) return "capability-rewrites-folded-verdict";
    }
  }
  return null;
}
function foldReading(state) {
  const journal = state.messages.journal;
  const inbox = state.messages.inbox;
  const source = journal > 0 && inbox > 0 ? "both" : inbox > 0 ? "inbox" : journal > 0 ? "journal" : "none";
  const scope = source === "journal" ? "both-directions" : source === "none" ? "none" : "this-end-only";
  return {
    records: state.recordCount,
    through: state.through,
    counts: {
      folded: state.folded,
      unknown: state.unknown,
      tasks: state.tasks.size,
      members: state.members.size,
      teams: state.namedTeams.size,
      unattributed: state.unattributed
    },
    teams: state.namedTeams.size,
    messages: { journal, inbox, source, scope }
  };
}
function encodeFoldAccumulator(state) {
  return v8Serialize(state).toString("base64");
}
function decodeFoldAccumulator(encoded) {
  const revived = v8Deserialize(Buffer.from(encoded, "base64"));
  if (revived === null || typeof revived !== "object" || revived.format !== FOLD_ACCUMULATOR_VERSION) {
    throw new TypeError("fold accumulator: unknown format " + String(revived?.format));
  }
  return revived;
}
function foldResumeFrame(frameJson) {
  const frame = JSON.parse(frameJson);
  if (frame === null || typeof frame.accumulator !== "string" || typeof frame.records !== "string") {
    throw new TypeError("foldResumeFrame: a frame carries { accumulator: string, records: string }");
  }
  const base = decodeFoldAccumulator(frame.accumulator);
  const records = JSON.parse(frame.records);
  if (!Array.isArray(records)) throw new TypeError("foldResumeFrame: records must be a JSON array");
  const blocked = foldResumeSafety(base, records);
  if (blocked !== null) {
    return JSON.stringify({ accumulator: null, state: null, resumed: false, reason: blocked });
  }
  foldTeamRecords(base, records);
  return JSON.stringify({ accumulator: encodeFoldAccumulator(base), state: JSON.stringify(finishTeamFold(base)), resumed: true });
}
function ledgerLineDigest(line) {
  let first = 2166136261;
  let second = 2654435769;
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second + code, 2246822519) >>> 0;
  }
  return { first, second };
}
function addLedgerDigests(left, right) {
  return { first: left.first + right.first >>> 0, second: left.second + right.second >>> 0 };
}
function subtractLedgerDigests(left, right) {
  return { first: left.first - right.first >>> 0, second: left.second - right.second >>> 0 };
}
function ledgerTextDigest(text) {
  let first = 0;
  let second = 0;
  let lineFirst = 2166136261;
  let lineSecond = 2654435769;
  let content = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      if (content) {
        first = first + lineFirst >>> 0;
        second = second + lineSecond >>> 0;
      }
      lineFirst = 2166136261;
      lineSecond = 2654435769;
      content = false;
      continue;
    }
    content = true;
    lineFirst = Math.imul(lineFirst ^ code, 16777619) >>> 0;
    lineSecond = Math.imul(lineSecond + code, 2246822519) >>> 0;
  }
  if (content) {
    first = first + lineFirst >>> 0;
    second = second + lineSecond >>> 0;
  }
  return { first, second };
}
function ledgerRecordDigest(records) {
  let digest = { first: 0, second: 0 };
  for (const record of records) digest = addLedgerDigests(digest, ledgerLineDigest(JSON.stringify(record)));
  return digest;
}
var FOLD_CHECKPOINT_FILE = "fold.checkpoint.json";
var FOLD_CHECKPOINT_STATE_FILE = "fold.checkpoint.state.json";
var FOLD_CHECKPOINT_ACC_FILE = "fold.checkpoint.acc.bin";
var FOLD_CHECKPOINT_FORMAT = "dsh-link.collab.fold-checkpoint/1";
var FOLD_CHECKPOINT_VERSION = 2;
var DEFAULT_FOLD_SETTINGS = { checkpoint: false, checkpointIntervalMs: 5e3, fastOpen: false, stampVerifyMs: 6e4, now: () => Date.now() };
var FOLD_SETTINGS_STATE = DEFAULT_FOLD_SETTINGS;
function configureFold(settings = {}) {
  if (settings.checkpoint !== void 0 && typeof settings.checkpoint !== "boolean") throw new TypeError("configureFold: checkpoint must be a boolean");
  if (settings.checkpointIntervalMs !== void 0 && (!Number.isInteger(settings.checkpointIntervalMs) || settings.checkpointIntervalMs <= 0)) {
    throw new TypeError("configureFold: checkpointIntervalMs must be a positive integer");
  }
  if (settings.fastOpen !== void 0 && typeof settings.fastOpen !== "boolean") throw new TypeError("configureFold: fastOpen must be a boolean");
  if (settings.stampVerifyMs !== void 0 && (!Number.isInteger(settings.stampVerifyMs) || settings.stampVerifyMs <= 0)) {
    throw new TypeError("configureFold: stampVerifyMs must be a positive integer");
  }
  if (settings.now !== void 0 && typeof settings.now !== "function") throw new TypeError("configureFold: now must be a function");
  FOLD_SETTINGS_STATE = { ...FOLD_SETTINGS_STATE, ...settings };
  return FOLD_SETTINGS_STATE;
}
function foldSettings() {
  return FOLD_SETTINGS_STATE;
}
var LIVE_FOLDS = /* @__PURE__ */ new WeakMap();
var foldWorkerEnabled = false;
var LIVE_LOGS = /* @__PURE__ */ new Set();
var FOLD_STATS = {
  fullFolds: 0,
  resumedBatches: 0,
  suffixRecords: 0,
  checkpointsSaved: 0,
  checkpointsLoaded: 0,
  checkpointsIgnored: 0,
  checkpointFallbacks: 0,
  /** Checkpoint refusals caused by a failed integrity proof (checksum, prefix digest, corrupt state). */
  checkpointIntegrityFailures: 0,
  /** The last checkpoint refusal reason, or null. */
  lastCheckpointReason: null,
  lastError: null,
  /** Ledger sha1 digests computed. Zero for a default composition: the checkpoint never ran (Y4). */
  digestsComputed: 0,
  /** Stamp files read (a parse of the sidecar, not of the ledger). */
  stampsRead: 0,
  /** Opens answered by the opt-in zero-read tie (fold.fastOpen). */
  stampTrusted: 0,
  /** Opens where the streamed prefix hash proved the stamp and only the suffix was parsed. */
  stampVerified: 0,
  /** Stamp writes that landed. */
  stampsWritten: 0,
  /** Stamp files that could not be believed (or writes that failed). */
  stampsIgnored: 0,
  /** The last stamp reading or write failure, or null after a verified open / successful write. */
  lastStampReason: null,
  /** The last stamp REFUSAL (kept across the rewrite a refused open performs), or null. */
  lastStampRefusal: null,
  /** Times a worker-mediated fold/checkpoint fell back to the synchronous index (R507/Y6). */
  workerFallbacks: 0,
  /** The last worker failure that caused a fallback, or null. */
  lastWorkerError: null,
  /** Times a checkpoint's state file was parsed (a cold read does this once). */
  checkpointStateReads: 0,
  /** Times a checkpoint's accumulator file was v8-decoded (deferred off the cold read, R504). */
  checkpointAccumulatorDecodes: 0
};
function checkpointFileOf(log) {
  return join2(log.directory, FOLD_CHECKPOINT_FILE);
}
function checkpointStateFileOf(log) {
  return join2(log.directory, FOLD_CHECKPOINT_STATE_FILE);
}
function checkpointAccFileOf(log) {
  return join2(log.directory, FOLD_CHECKPOINT_ACC_FILE);
}
function ledgerIdentityOf(log) {
  const file = join2(log.directory, "control.jsonl");
  try {
    const stats = statSync2(file, { bigint: true });
    return String(stats.dev) + ":" + String(stats.ino) + "@" + resolve(file);
  } catch {
    return "unavailable@" + resolve(file);
  }
}
function ledgerBytesOf(log) {
  try {
    return Number(statSync2(join2(log.directory, "control.jsonl")).size);
  } catch {
    return 0;
  }
}
function sourceRevisionOf(log) {
  return log.instance + ":" + String(log.lastSeq) + ":" + String(ledgerBytesOf(log));
}
function checkpointChecksum(document) {
  return createHash("sha256").update(document.format + STAMP_NUL + String(document.formatVersion)).update(STAMP_NUL + document.ledgerIdentity).update(STAMP_NUL + document.sourceRevision).update(STAMP_NUL + String(document.prefixEndSeq)).update(STAMP_NUL + document.droppedKinds.join(",")).update(STAMP_NUL + document.prefixDigest).update(STAMP_NUL + document.state).update(STAMP_NUL + String(document.stateBytes)).update(STAMP_NUL + document.accumulator).update(STAMP_NUL + String(document.accumulatorBytes)).digest("hex");
}
function sha256Of(value) {
  return createHash("sha256").update(value).digest("hex");
}
function ignoredCheckpoint(path, reason, seen = null) {
  return {
    path,
    outcome: "ignored",
    reason,
    formatVersion: typeof seen?.formatVersion === "number" ? seen.formatVersion : null,
    ledgerIdentity: typeof seen?.ledgerIdentity === "string" ? seen.ledgerIdentity : null,
    sourceRevision: typeof seen?.sourceRevision === "string" ? seen.sourceRevision : null,
    prefixEndSeq: typeof seen?.prefixEndSeq === "number" ? seen.prefixEndSeq : null,
    droppedKinds: Array.isArray(seen?.droppedKinds) ? seen.droppedKinds : null,
    stateBytes: typeof seen?.stateBytes === "number" ? seen.stateBytes : null,
    accumulatorBytes: typeof seen?.accumulatorBytes === "number" ? seen.accumulatorBytes : null,
    checksum: typeof seen?.checksum === "string" ? seen.checksum : null,
    createdAt: typeof seen?.createdAt === "number" ? seen.createdAt : null
  };
}
function loadedCheckpointInfo(path, document) {
  return {
    path,
    outcome: "loaded",
    reason: null,
    formatVersion: document.formatVersion,
    ledgerIdentity: document.ledgerIdentity,
    sourceRevision: document.sourceRevision,
    prefixEndSeq: document.prefixEndSeq,
    droppedKinds: document.droppedKinds,
    stateBytes: document.stateBytes,
    accumulatorBytes: document.accumulatorBytes,
    checksum: document.checksum,
    createdAt: document.createdAt
  };
}
function discardCheckpoint(directory) {
  for (const name2 of [FOLD_CHECKPOINT_FILE, FOLD_CHECKPOINT_STATE_FILE, FOLD_CHECKPOINT_ACC_FILE]) {
    try {
      rmSync(join2(directory, name2), { force: true });
    } catch {
    }
  }
}
function validateCheckpoint(log) {
  const path = checkpointFileOf(log);
  let raw;
  try {
    raw = readFileSync2(path, "utf8");
  } catch {
    return { document: null, info: ignoredCheckpoint(path, "no-checkpoint-file") };
  }
  const refuse = (reason, seen2 = null) => {
    FOLD_STATS.checkpointIntegrityFailures += 1;
    FOLD_STATS.lastCheckpointReason = reason;
    discardCheckpoint(log.directory);
    return { document: null, info: ignoredCheckpoint(path, reason, seen2) };
  };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("unreadable-json");
  }
  if (parsed === null || typeof parsed !== "object") return refuse("not-a-document");
  const seen = parsed;
  if (seen.format !== FOLD_CHECKPOINT_FORMAT) return refuse("foreign-format", seen);
  if (seen.formatVersion !== FOLD_CHECKPOINT_VERSION) return refuse("format-version", seen);
  if (!Array.isArray(seen.droppedKinds) || seen.droppedKinds.join(",") !== FOLD_DROPPED_KINDS.join(",")) return refuse("dropped-kinds-changed", seen);
  if (typeof seen.ledgerIdentity !== "string" || typeof seen.sourceRevision !== "string" || typeof seen.prefixEndSeq !== "number" || !Number.isInteger(seen.prefixEndSeq) || seen.prefixEndSeq < 0 || typeof seen.prefixDigest !== "string" || typeof seen.state !== "string" || typeof seen.checksum !== "string" || typeof seen.stateBytes !== "number" || !Number.isInteger(seen.stateBytes) || seen.stateBytes < 0 || typeof seen.accumulator !== "string" || typeof seen.accumulatorBytes !== "number" || !Number.isInteger(seen.accumulatorBytes) || seen.accumulatorBytes < 0) {
    return refuse("malformed-document", seen);
  }
  const document = seen;
  if (checkpointChecksum(document) !== document.checksum) return refuse("checksum-mismatch", seen);
  if (document.ledgerIdentity !== ledgerIdentityOf(log)) return refuse("ledger-identity-changed", seen);
  const revisionParts = document.sourceRevision.split(":");
  if (revisionParts.length !== 3 || revisionParts[0] !== log.instance) return refuse("ledger-instance-changed", seen);
  const recordedLastSeq = Number(revisionParts[1]);
  const recordedBytes = Number(revisionParts[2]);
  if (!Number.isInteger(recordedLastSeq) || !Number.isInteger(recordedBytes)) return refuse("malformed-revision", seen);
  if (recordedLastSeq > log.lastSeq || recordedBytes > ledgerBytesOf(log)) return refuse("ledger-shrank", seen);
  if (log.damage !== null) return refuse("damaged-ledger", seen);
  if (log.lastSeq !== document.prefixEndSeq) return refuse("ledger-grew", seen);
  if (log.digest !== document.prefixDigest) return refuse("prefix-checksum-mismatch", seen);
  if (document.prefixEndSeq > 0 && log.recordsMaterialised !== false) {
    const edge = log.page(document.prefixEndSeq - 1, 1);
    if (edge.length !== 1 || edge[0]?.seq !== document.prefixEndSeq) return refuse("prefix-changed", seen);
  }
  return { document, info: loadedCheckpointInfo(path, document) };
}
function readCheckpointState(log, document, parse) {
  const path = checkpointStateFileOf(log);
  let text;
  try {
    text = readFileSync2(path, "utf8");
  } catch {
    return { value: null, reason: "missing-state-file" };
  }
  if (Buffer.byteLength(text, "utf8") !== document.stateBytes) return { value: null, reason: "state-size-mismatch" };
  if (sha256Of(text) !== document.state) return { value: null, reason: "state-checksum-mismatch" };
  if (!parse) return { value: null, reason: null };
  FOLD_STATS.checkpointStateReads += 1;
  try {
    return { value: JSON.parse(text), reason: null };
  } catch (error) {
    return { value: null, reason: "corrupt-state: " + String(error?.message ?? error) };
  }
}
function readCheckpointAccumulator(log, document) {
  const path = checkpointAccFileOf(log);
  let buffer;
  try {
    buffer = readFileSync2(path);
  } catch {
    return { value: null, reason: "missing-accumulator-file" };
  }
  if (buffer.length !== document.accumulatorBytes) return { value: null, reason: "accumulator-size-mismatch" };
  if (sha256Of(buffer) !== document.accumulator) return { value: null, reason: "accumulator-checksum-mismatch" };
  if (buffer.length === 0) return { value: null, reason: "corrupt-accumulator: empty file" };
  let accumulator;
  FOLD_STATS.checkpointAccumulatorDecodes += 1;
  try {
    accumulator = decodeFoldAccumulator(buffer.toString("base64"));
  } catch (error) {
    return { value: null, reason: "corrupt-accumulator: " + String(error?.message ?? error) };
  }
  if (accumulator.recordCount !== document.prefixEndSeq || accumulator.through !== document.prefixEndSeq) {
    return { value: null, reason: "prefix-mismatch" };
  }
  return { value: accumulator, reason: null };
}
function refuseCheckpoint(log, reason) {
  FOLD_STATS.checkpointIntegrityFailures += 1;
  FOLD_STATS.lastCheckpointReason = reason;
  discardCheckpoint(log.directory);
  return ignoredCheckpoint(checkpointFileOf(log), reason);
}
function loadFoldCheckpoint(log) {
  const checked = validateCheckpoint(log);
  if (checked.document === null) return { accumulator: null, info: checked.info };
  const document = checked.document;
  const stateFile = readCheckpointState(log, document, false);
  if (stateFile.reason !== null) return { accumulator: null, info: refuseCheckpoint(log, stateFile.reason) };
  const loaded = readCheckpointAccumulator(log, document);
  if (loaded.value === null) return { accumulator: null, info: refuseCheckpoint(log, loaded.reason ?? "corrupt-accumulator") };
  FOLD_STATS.lastCheckpointReason = null;
  return { accumulator: loaded.value, info: loadedCheckpointInfo(checkpointFileOf(log), document) };
}
function resumeFoldCheckpoint(log) {
  const checked = validateCheckpoint(log);
  if (checked.document === null) return { resumed: null, info: checked.info };
  const document = checked.document;
  const loadedState = readCheckpointState(log, document, true);
  if (loadedState.value === null) return { resumed: null, info: refuseCheckpoint(log, loadedState.reason ?? "corrupt-state") };
  FOLD_STATS.lastCheckpointReason = null;
  return { resumed: { document, state: loadedState.value }, info: loadedCheckpointInfo(checkpointFileOf(log), document) };
}
function liveFoldOf(log) {
  const existing = LIVE_FOLDS.get(log);
  if (existing !== void 0) return existing;
  const created = { acc: emptyTeamFold(), through: 0, state: null, stateSeq: -1, deferred: null, checkpointReason: null, savedPrefix: -1, timer: null, lastError: null };
  LIVE_FOLDS.set(log, created);
  LIVE_LOGS.add(log);
  if (FOLD_SETTINGS_STATE.checkpoint) {
    const resumed = resumeFoldCheckpoint(log);
    if (resumed.resumed !== null) {
      created.state = resumed.resumed.state;
      created.through = resumed.resumed.document.prefixEndSeq;
      created.stateSeq = created.through;
      created.savedPrefix = created.through;
      created.acc = null;
      created.deferred = resumed.resumed.document;
      FOLD_STATS.checkpointsLoaded += 1;
    } else {
      created.checkpointReason = resumed.info.reason;
      if (resumed.info.reason !== "no-checkpoint-file") FOLD_STATS.checkpointsIgnored += 1;
    }
  }
  return created;
}
function fullFold(log, live) {
  live.acc = emptyTeamFold();
  foldTeamRecords(live.acc, log.replay());
  live.through = live.acc.through;
  live.state = finishTeamFold(live.acc);
  live.stateSeq = live.through;
  live.deferred = null;
  FOLD_STATS.fullFolds += 1;
  return live.acc;
}
function ensureCheckpointAccumulator(log, live) {
  if (live.acc !== null) return live.acc;
  const document = live.deferred;
  if (document === null) return null;
  live.deferred = null;
  const loaded = readCheckpointAccumulator(log, document);
  if (loaded.value === null) {
    live.checkpointReason = loaded.reason;
    refuseCheckpoint(log, loaded.reason ?? "corrupt-accumulator");
    return null;
  }
  if (loaded.value.through !== live.through) {
    live.checkpointReason = "prefix-mismatch";
    refuseCheckpoint(log, "prefix-mismatch");
    return null;
  }
  live.acc = loaded.value;
  return live.acc;
}
function refreshFold(log, live) {
  const lastSeq = log.lastSeq;
  if (live.state !== null && live.stateSeq === live.through && live.through === lastSeq) {
    if (live.acc !== null) return live.acc;
    const revived = ensureCheckpointAccumulator(log, live);
    if (revived !== null) return revived;
  }
  if (lastSeq < live.through) return fullFold(log, live);
  if (live.acc === null) {
    if (live.deferred !== null) ensureCheckpointAccumulator(log, live);
    if (live.acc === null) {
      live.acc = emptyTeamFold();
      live.through = 0;
      live.state = null;
      live.stateSeq = -1;
    }
  }
  const acc = live.acc;
  if (acc === null) return fullFold(log, live);
  live.through = acc.through;
  if (lastSeq === acc.through) {
    if (live.state === null) {
      live.state = finishTeamFold(acc);
      live.stateSeq = acc.through;
    }
    return acc;
  }
  const suffix = log.page(acc.through);
  if (suffix.length === 0) {
    if (live.state === null) {
      live.state = finishTeamFold(acc);
      live.stateSeq = acc.through;
    }
    return acc;
  }
  const blocked = foldResumeSafety(acc, suffix);
  if (blocked !== null) {
    FOLD_STATS.checkpointFallbacks += 1;
    return fullFold(log, live);
  }
  foldTeamRecords(acc, suffix);
  live.through = acc.through;
  FOLD_STATS.resumedBatches += 1;
  FOLD_STATS.suffixRecords += suffix.length;
  live.state = null;
  return acc;
}
function foldStateOf(log) {
  const live = liveFoldOf(log);
  if (FOLD_SETTINGS_STATE.checkpoint && live.timer === null) startCheckpointTimer(log, live);
  const cached = live.state;
  if (cached !== null && live.stateSeq === live.through && live.through === log.lastSeq) return cached;
  const acc = refreshFold(log, live);
  const state = live.state;
  if (state !== null) return state;
  live.state = finishTeamFold(acc);
  live.stateSeq = acc.through;
  live.through = acc.through;
  return live.state;
}
function foldReadingOf(log) {
  const live = liveFoldOf(log);
  if (FOLD_SETTINGS_STATE.checkpoint && live.timer === null) startCheckpointTimer(log, live);
  return foldReading(refreshFold(log, live));
}
function foldAccumulatorOf(log) {
  const live = liveFoldOf(log);
  return refreshFold(log, live);
}
function writeFoldCheckpoint(view, accumulator, now = FOLD_SETTINGS_STATE.now) {
  const path = checkpointFileOf(view);
  try {
    if (accumulator.recordCount === 0) return ignoredCheckpoint(path, "empty-ledger");
    if (view.damage !== null) return ignoredCheckpoint(path, "damaged-ledger");
    if (view.lastSeq !== accumulator.through) return ignoredCheckpoint(path, "stale-index");
    const identity = ledgerIdentityOf(view);
    if (identity.startsWith("unavailable@")) return ignoredCheckpoint(path, "no-ledger-file");
    const prefixDigest = view.digest;
    const stateText = JSON.stringify(finishTeamFold(accumulator));
    const accumulatorBuffer = Buffer.from(encodeFoldAccumulator(accumulator), "base64");
    const body = {
      format: FOLD_CHECKPOINT_FORMAT,
      formatVersion: FOLD_CHECKPOINT_VERSION,
      ledgerIdentity: identity,
      sourceRevision: sourceRevisionOf(view),
      prefixEndSeq: accumulator.through,
      droppedKinds: FOLD_DROPPED_KINDS,
      prefixDigest,
      state: sha256Of(stateText),
      stateBytes: Buffer.byteLength(stateText, "utf8"),
      accumulator: sha256Of(accumulatorBuffer),
      accumulatorBytes: accumulatorBuffer.length
    };
    const checksum = checkpointChecksum(body);
    const statePath = checkpointStateFileOf(view);
    const accPath = checkpointAccFileOf(view);
    const suffix = "." + String(process.pid) + "." + String(process.hrtime.bigint()) + ".tmp";
    const stateTemporary = statePath + suffix;
    const accTemporary = accPath + suffix;
    const manifestTemporary = path + suffix;
    try {
      writeFileSync(accTemporary, accumulatorBuffer);
      renameSync(accTemporary, accPath);
      writeFileSync(stateTemporary, stateText, "utf8");
      renameSync(stateTemporary, statePath);
      const document = { ...body, checksum, createdAt: now() };
      writeFileSync(manifestTemporary, JSON.stringify(document), "utf8");
      renameSync(manifestTemporary, path);
      FOLD_STATS.checkpointsSaved += 1;
      return {
        path,
        outcome: "saved",
        reason: null,
        formatVersion: document.formatVersion,
        ledgerIdentity: document.ledgerIdentity,
        sourceRevision: document.sourceRevision,
        prefixEndSeq: document.prefixEndSeq,
        droppedKinds: document.droppedKinds,
        stateBytes: document.stateBytes,
        accumulatorBytes: document.accumulatorBytes,
        checksum: document.checksum,
        createdAt: document.createdAt
      };
    } catch (error) {
      for (const temporary of [stateTemporary, accTemporary, manifestTemporary]) {
        try {
          rmSync(temporary, { force: true });
        } catch {
        }
      }
      throw error;
    }
  } catch (error) {
    const reason = String(error?.message ?? error);
    FOLD_STATS.lastError = reason;
    return ignoredCheckpoint(path, "write-failed: " + reason);
  }
}
function saveFoldCheckpoint(log) {
  const live = liveFoldOf(log);
  let accumulator;
  try {
    accumulator = refreshFold(log, live);
  } catch (error) {
    live.lastError = String(error?.message ?? error);
    accumulator = live.acc ?? emptyTeamFold();
  }
  const info = writeFoldCheckpoint(log, accumulator);
  if (info.outcome === "saved") {
    STAMP_WRITERS.get(log)?.();
    live.savedPrefix = accumulator.through;
    live.lastError = null;
  } else if (info.outcome === "ignored" && info.reason !== null && info.reason.startsWith("write-failed")) {
    live.lastError = info.reason;
  }
  return info;
}
function startCheckpointTimer(log, live) {
  if (live.timer !== null) return;
  const timer = setInterval(() => {
    try {
      if (live.savedPrefix === live.through && log.lastSeq === live.through) return;
      if (ACTIVE_FOLD_WORKER !== null) {
        void checkpointViaWorker(log).then(
          (info) => {
            if (info.outcome === "saved" && info.prefixEndSeq !== null) live.savedPrefix = info.prefixEndSeq;
          },
          (error) => {
            live.lastError = String(error?.message ?? error);
          }
        );
        return;
      }
      saveFoldCheckpoint(log);
    } catch (error) {
      live.lastError = String(error?.message ?? error);
    }
  }, FOLD_SETTINGS_STATE.checkpointIntervalMs);
  timer.unref?.();
  live.timer = timer;
}
function disposeFoldLog(log) {
  const live = LIVE_FOLDS.get(log);
  if (live !== void 0) {
    if (live.timer !== null) clearInterval(live.timer);
    LIVE_FOLDS.delete(log);
  }
  LIVE_LOGS.delete(log);
}
function foldDiagnostics() {
  return { logs: LIVE_LOGS.size, ...FOLD_STATS };
}
function resetFoldDiagnostics() {
  FOLD_STATS.fullFolds = 0;
  FOLD_STATS.resumedBatches = 0;
  FOLD_STATS.suffixRecords = 0;
  FOLD_STATS.checkpointsSaved = 0;
  FOLD_STATS.checkpointsLoaded = 0;
  FOLD_STATS.checkpointsIgnored = 0;
  FOLD_STATS.checkpointFallbacks = 0;
  FOLD_STATS.checkpointIntegrityFailures = 0;
  FOLD_STATS.digestsComputed = 0;
  FOLD_STATS.stampsRead = 0;
  FOLD_STATS.stampTrusted = 0;
  FOLD_STATS.stampVerified = 0;
  FOLD_STATS.stampsWritten = 0;
  FOLD_STATS.stampsIgnored = 0;
  FOLD_STATS.lastStampReason = null;
  FOLD_STATS.lastStampRefusal = null;
  FOLD_STATS.workerFallbacks = 0;
  FOLD_STATS.lastWorkerError = null;
  FOLD_STATS.checkpointStateReads = 0;
  FOLD_STATS.checkpointAccumulatorDecodes = 0;
  FOLD_STATS.lastCheckpointReason = null;
  FOLD_STATS.lastError = null;
}
function answerFoldQuery(state, query) {
  switch (query.kind) {
    case "mayExchange": {
      const peers = finishPeers(state.peers);
      return peers.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === "granted";
    }
    case "mayMerge": {
      const peers = finishPeers(state.peers);
      const granted = peers.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === "granted";
      if (!granted) return false;
      const merges = finishMerges(state.merges);
      return merges.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === "granted";
    }
    case "boardRow": {
      const board = finishBoard(state.board);
      const row = board.tasks.find((task) => task.key === query.key);
      return row === void 0 ? null : { status: row.status, owner: row.owner };
    }
    case "quarantined": {
      return finishQuarantine(state.quarantine).some((row) => row.memberId === query.member);
    }
    default:
      return null;
  }
}
var ACTIVE_FOLD_WORKER = null;
function activateFoldWorker(handle) {
  ACTIVE_FOLD_WORKER = handle;
  foldWorkerEnabled = handle !== null;
}
function activeFoldWorker() {
  return ACTIVE_FOLD_WORKER;
}
function startFoldWorker(moduleUrl) {
  const stats = { frames: 0, frameBytes: 0, completed: 0, failed: 0, lastWallMs: null, lastError: null };
  let running = true;
  const pending = /* @__PURE__ */ new Map();
  let id = 0;
  let worker;
  try {
    worker = new Worker(FOLD_WORKER_SOURCE, { eval: true, workerData: { moduleUrl: moduleUrl ?? import.meta.url } });
  } catch (error) {
    console.error("[dsh-link-collab] fold worker could not start: " + String(error?.message ?? error));
    return null;
  }
  const settle = (failed, describe) => {
    for (const [requestId, entry] of [...pending.entries()]) {
      clearTimeout(entry.timer);
      pending.delete(requestId);
      const message = describe({ ok: false, through: 0, records: 0, counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 }, teams: 0, messages: { journal: 0, inbox: 0, source: "none", scope: "none" }, checkpointPrefix: 0, answers: [], reloaded: false, reason: null });
      entry.reject(new Error(message));
    }
    if (failed) stats.failed += 1;
  };
  worker.on("message", (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const requestId = typeof parsed.id === "number" ? parsed.id : -1;
    const entry = pending.get(requestId);
    if (entry === void 0) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    const reply = parsed.reply;
    if (reply === void 0 || typeof reply !== "object") {
      stats.failed += 1;
      entry.reject(new Error("fold worker: a reply was not a reply"));
      return;
    }
    stats.completed += 1;
    entry.resolve(reply);
  });
  worker.on("error", (error) => {
    running = false;
    stats.lastError = String(error?.message ?? error);
    settle(true, () => "fold worker error: " + String(error?.message ?? error));
  });
  worker.on("exit", (code) => {
    running = false;
    if (pending.size > 0) settle(true, () => "fold worker exited (code " + String(code) + ") with requests in flight");
  });
  const handle = {
    get status() {
      return {
        enabled: true,
        running,
        frames: stats.frames,
        frameBytes: stats.frameBytes,
        completed: stats.completed,
        failed: stats.failed,
        pending: pending.size,
        lastWallMs: stats.lastWallMs,
        lastError: stats.lastError
      };
    },
    request(frameJson) {
      return new Promise((resolve2, reject) => {
        if (!running) {
          reject(new Error("fold worker is not running"));
          return;
        }
        id += 1;
        const requestId = id;
        stats.frames += 1;
        stats.frameBytes += Buffer.byteLength(frameJson, "utf8");
        const started = performance.now();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          stats.failed += 1;
          reject(new Error("fold worker: request timed out after 60 s"));
        }, 6e4);
        timer.unref?.();
        pending.set(requestId, {
          resolve: (reply) => {
            stats.lastWallMs = Math.round((performance.now() - started) * 1e3) / 1e3;
            resolve2(reply);
          },
          reject: (error) => {
            stats.lastError = String(error.message);
            reject(error);
          },
          timer,
          started
        });
        try {
          worker.postMessage(JSON.stringify({ id: requestId, frame: frameJson }));
        } catch (error) {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(new Error("fold worker: could not post the frame: " + String(error?.message ?? error)));
        }
      });
    },
    async close() {
      running = false;
      settle(false, () => "fold worker closed with requests in flight");
      await worker.terminate();
    }
  };
  console.log("[dsh-link-collab] fold worker started (module " + String(moduleUrl ?? import.meta.url) + ")");
  return handle;
}
var FOLD_WORKER_SESSIONS = /* @__PURE__ */ new Map();
function foldWorkerSessionOf(log) {
  const directory = resolve(log.directory);
  let session = FOLD_WORKER_SESSIONS.get(directory);
  if (session === void 0) {
    session = { directory, knownSeq: 0, opened: false };
    FOLD_WORKER_SESSIONS.set(directory, session);
  }
  return session;
}
function foldWorkerFrame(log, session, queries, op = "sync") {
  if (!session.opened) {
    session.opened = true;
    return JSON.stringify({ op: "open", dir: session.directory, checkpoint: FOLD_SETTINGS_STATE.checkpoint, queries });
  }
  if (op === "checkpoint") return JSON.stringify({ op: "checkpoint", dir: session.directory });
  const records = log.page(session.knownSeq);
  return JSON.stringify({ op: "sync", dir: session.directory, records: JSON.stringify(records), queries, checkpoint: FOLD_SETTINGS_STATE.checkpoint });
}
async function foldAfterQueries(log, queries = []) {
  const worker = ACTIVE_FOLD_WORKER;
  if (worker === null) {
    const accumulator = refreshFold(log, liveFoldOf(log));
    return queries.map((query) => answerFoldQuery(accumulator, query));
  }
  const session = foldWorkerSessionOf(log);
  try {
    const reply = await worker.request(foldWorkerFrame(log, session, queries));
    if (!reply.ok) throw new Error("fold worker: " + String(reply.error ?? "refused the frame"));
    session.knownSeq = reply.through;
    return reply.answers;
  } catch (error) {
    const message = String(error?.message ?? error);
    FOLD_STATS.workerFallbacks += 1;
    FOLD_STATS.lastWorkerError = message;
    FOLD_STATS.lastError = message;
    const accumulator = refreshFold(log, liveFoldOf(log));
    return queries.map((query) => answerFoldQuery(accumulator, query));
  }
}
async function checkpointViaWorker(log) {
  const worker = ACTIVE_FOLD_WORKER;
  if (worker === null) return saveFoldCheckpoint(log);
  const session = foldWorkerSessionOf(log);
  try {
    const synced = await worker.request(foldWorkerFrame(log, session, []));
    if (!synced.ok) throw new Error(String(synced.error ?? "sync refused"));
    session.knownSeq = synced.through;
    const reply = await worker.request(JSON.stringify({ op: "checkpoint", dir: session.directory }));
    if (!reply.ok) throw new Error(String(reply.error ?? "checkpoint refused"));
    const answer2 = reply;
    const info = answer2.checkpoint;
    if (info !== void 0) return info;
    return ignoredCheckpoint(checkpointFileOf(log), "worker-wrote-no-info");
  } catch (error) {
    const message = String(error?.message ?? error);
    FOLD_STATS.workerFallbacks += 1;
    FOLD_STATS.lastWorkerError = message;
    FOLD_STATS.lastError = message;
    return saveFoldCheckpoint(log);
  }
}
var TEAM_EVENT_KINDS = ["team/task", "team/member", "team/message/queued", "team/message/delivered", "agent/inbox/spliced"];
function teamEventToRecord(event) {
  const row = event;
  if (row === void 0 || typeof row.type !== "string") return null;
  const data = row.data ?? {};
  if (row.type === "team/task") {
    const task = data.task;
    if (task === void 0 || typeof task.id !== "string") return null;
    return {
      kind: TASK_KIND,
      ...typeof data.teamId === "string" ? { actor: data.teamId } : {},
      subject: task.id,
      payload: {
        id: task.id,
        state: typeof task.status === "string" ? task.status : "pending",
        // The event carries the durable SNAPSHOT (TeamTaskSnapshot.ownerId, types.ts:80); `ownerName`
        // belongs to the runtime VIEW (types.ts:94) and is never present here, so reading it recorded
        // an ownerless row and the ledger answered "nobody is doing this" for work that was
        // in_progress. Measured before this line changed: grep '"owner"' over the live control.jsonl
        // returned 0 hits across 49 rows, and the pane drew every row's owner as null. `ownerId`
        // first, with `ownerName` kept as the fallback for a producer that hands over the view.
        ...typeof task.ownerId === "string" ? { owner: task.ownerId } : typeof task.ownerName === "string" ? { owner: task.ownerName } : {},
        ...typeof task.revision === "number" ? { revision: task.revision } : {},
        ...typeof task.subject === "string" ? { title: task.subject } : {},
        // `blockedBy` is the kernel's own dependency list on the task snapshot
        // (packages/experimental/agent-team/src/types.ts:81) and the only field in the snapshot the
        // projection's graph reads by name: `projectBoard` resolves `payload.deps` into the edges,
        // the unmet list, the missing/orphan list and the cycle search (:1636-1669). Copied rather
        // than translated, like the rest of the row, and copied even when empty: one snapshot is the
        // whole task, so "this revision blocks on nothing" has to be able to clear a graph an
        // earlier revision declared. A kernel that publishes no `blockedBy` publishes no `deps`, and
        // the fold then leaves the previous declaration alone instead of reading absence as empty.
        ...Array.isArray(task.blockedBy) ? { deps: task.blockedBy.filter((dep) => typeof dep === "string" && dep !== "") } : {}
      }
    };
  }
  if (row.type === "team/member") {
    const member = data.member;
    if (member === void 0 || typeof member.id !== "string") return null;
    return {
      kind: MEMBER_KIND,
      ...typeof data.teamId === "string" ? { actor: data.teamId } : {},
      subject: member.id,
      payload: {
        id: member.id,
        state: typeof member.phase === "string" ? member.phase : "active",
        ...typeof member.name === "string" ? { name: member.name } : {},
        ...typeof member.role === "string" ? { role: member.role } : {},
        // R484-P3: a multi-level roster row carries its spawn edge. Without this pass-through the
        // ledger dropped it (measured: 2,163 / 6,476 / 21,574 rows at 10k/30k/100k), so the ledger
        // could only rebuild the tree from subagent/catalog parent edges and never knew depth.
        // Additive and conditional: a single-level (or pre-patch) row writes exactly the old payload.
        ...typeof member.spawnedBy === "string" ? { spawnedBy: member.spawnedBy } : {},
        ...typeof member.depth === "number" ? { depth: member.depth } : {}
      }
    };
  }
  if (row.type === "agent/inbox/spliced") {
    const inserted = Array.isArray(data.inserted) ? data.inserted : [];
    const relay = inserted.find((one) => {
      const source2 = one?.source;
      return source2 !== void 0 && source2.kind === "agent-message";
    });
    if (relay === void 0) return null;
    const source = relay.source;
    const id = typeof relay.id === "string" ? relay.id : null;
    if (id === null) return null;
    const senderId = typeof source.senderSessionId === "string" ? source.senderSessionId : null;
    const target = typeof data.target === "string" ? data.target : null;
    return {
      kind: "team.message",
      ...senderId === null ? {} : { actor: senderId },
      ...target === null ? {} : { subject: target },
      payload: {
        id,
        // 'accepted' rather than 'delivered': the new contract says acceptance follows the target's own
        // persistence and does not await the model (agent-team/src/types.ts:186), so claiming delivery
        // would be the bus asserting something the kernel explicitly does not promise.
        state: "accepted",
        scope: "this-end",
        ...senderId === null ? {} : { senderId },
        ...target === null ? {} : { target }
      }
    };
  }
  if (row.type === "team/message/queued" || row.type === "team/message/delivered") {
    const queued = row.type === "team/message/queued";
    const snapshot = queued ? data.message : void 0;
    const messageId = queued ? typeof snapshot?.id === "string" ? snapshot.id : null : typeof data.messageId === "string" ? data.messageId : null;
    if (messageId === null) return null;
    const senderName = queued ? snapshot?.senderName : void 0;
    const senderId = queued ? snapshot?.senderId : void 0;
    const targetId = queued ? snapshot?.targetId : data.targetId;
    return {
      kind: "team.message",
      ...typeof senderName === "string" ? { actor: senderName } : {},
      ...typeof targetId === "string" ? { subject: targetId } : {},
      payload: {
        id: messageId,
        state: queued ? "queued" : "delivered",
        ...typeof senderId === "string" ? { senderId } : {},
        ...typeof targetId === "string" ? { targetId } : {}
      }
    };
  }
  return null;
}
function recordTeamEvents(ctx, log) {
  const counts = { seen: 0, recorded: 0, ignored: 0, failed: 0 };
  const diagnostics = { subscriptionInstalled: false, hooksForSessionEvent: -1, hooksError: null, rootObtained: false, sameHooksRegistry: null, liveHooks: -1 };
  let stopped = false;
  const trace = traceEnabled();
  const diag = ctx;
  const eventsLike = diag.events;
  const off = ctx.on?.("session/event", (_session, event) => {
    if (stopped) return;
    counts.seen += 1;
    if (trace) console.log("[dsh-link-collab] DIAG event received: " + String(event?.type));
    const record = teamEventToRecord(event);
    if (record === null) {
      counts.ignored += 1;
      return;
    }
    void log.append(record).then(() => {
      counts.recorded += 1;
    }, () => {
      counts.failed += 1;
    });
  }, { global: true });
  diagnostics.subscriptionInstalled = typeof off === "function";
  try {
    diagnostics.hooksForSessionEvent = Array.isArray(eventsLike?._hooks?.["session/event"]) ? (eventsLike?._hooks?.["session/event"]).length : -1;
  } catch (error) {
    diagnostics.hooksError = String(error?.message ?? error);
  }
  try {
    const root = diag.root;
    diagnostics.rootObtained = root !== void 0 && root !== null;
    const rootHooks = diagnostics.rootObtained ? root?.events?._hooks : void 0;
    diagnostics.sameHooksRegistry = rootHooks === void 0 || eventsLike?._hooks === void 0 ? null : rootHooks === eventsLike._hooks;
  } catch (error) {
    diagnostics.sameHooksRegistry = null;
    console.log("[dsh-link-collab] root comparison failed: " + String(error?.message ?? error));
  }
  const stop = () => {
    stopped = true;
    off?.();
  };
  Object.defineProperty(diagnostics, "liveHooks", {
    enumerable: true,
    configurable: true,
    get: () => Array.isArray(eventsLike?._hooks?.["session/event"]) ? eventsLike._hooks["session/event"].length : -1
  });
  ctx.effect?.(() => stop);
  return {
    counts,
    diagnostics,
    dispose: stop
  };
}
function retryDelay(options) {
  const everyMs = Number(options?.everyMs);
  const idle = Number(options?.idle);
  const jitter = Number(options?.jitter ?? 0);
  if (!Number.isInteger(everyMs) || everyMs <= 0) throw new TypeError("retryDelay: everyMs must be a positive integer");
  if (!Number.isInteger(idle) || idle < 0) throw new TypeError("retryDelay: idle must be a non-negative integer");
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new TypeError("retryDelay: jitter must be within [0, 1]");
  const factor = options?.factor;
  const maxMs = options?.maxMs;
  let raw = everyMs;
  if (factor !== void 0) {
    if (!Number.isFinite(factor) || factor <= 1) throw new TypeError("retryDelay: factor must be finite and > 1");
    raw = everyMs * Math.pow(factor, idle);
  }
  const capped = maxMs === void 0 ? raw : Math.min(raw, Number(maxMs));
  if (jitter === 0) return Math.round(capped);
  const spread = Number(BigInt(idle) * 2654435761n % 4294967296n) / 4294967296;
  return Math.round(capped * (1 - jitter + jitter * spread));
}
var DECLARE_TOOL_NAMES = ["team_declare_capability", "team_declare_subteam", "team_heartbeat"];
var DECLARED_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;
var DeclareRefusal = class extends Error {
  /** The stable code this refusal is named by. */
  code;
  /**
   * @param code - the code, e.g. `DECLARE_PARENT_SELF`.
   * @param detail - what was refused, and what the tool takes instead.
   */
  constructor(code, detail) {
    super(code + ": " + detail);
    this.name = "DeclareRefusal";
    this.code = code;
  }
};
function describeValue(value) {
  try {
    const text = JSON.stringify(value);
    return text === void 0 ? String(value) : text;
  } catch {
    return String(value);
  }
}
function declarationInput(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new DeclareRefusal("DECLARE_INPUT", "this tool takes one object of arguments; got " + describeValue(args));
  }
  return args;
}
function requiredName(value, field, prefix = "DECLARE_", refuse = (code, detail) => new DeclareRefusal(code, detail)) {
  const code = prefix + field.toUpperCase();
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") {
    throw refuse(code + "_EMPTY", field + " is required and must not be empty; got " + describeValue(value ?? null));
  }
  if (typeof value !== "string" || !DECLARED_NAME.test(value)) {
    throw refuse(code + "_NAME", field + " " + describeValue(value) + " is not a name; use 1-64 characters from letters, digits and . _ - : @, starting with a letter or a digit");
  }
  return value;
}
function optionalName(value, field, prefix = "DECLARE_") {
  return value === void 0 || value === null ? null : requiredName(value, field, prefix);
}
function capabilityNames(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DeclareRefusal("DECLARE_CAPABILITY_LIST", "capabilities must be a non-empty array of names; got " + describeValue(value ?? null));
  }
  const names = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() === "") {
      throw new DeclareRefusal("DECLARE_CAPABILITY_EMPTY", "capabilities carries an empty name; every entry must name one capability");
    }
    if (typeof entry !== "string" || !DECLARED_NAME.test(entry)) {
      throw new DeclareRefusal("DECLARE_CAPABILITY_NAME", "capabilities carries " + describeValue(entry) + ", which is not a name; use 1-64 characters from letters, digits and . _ - : @");
    }
    names.push(entry);
  }
  return names;
}
function heartbeatInstant(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DeclareRefusal("DECLARE_HEARTBEAT_AT", "at must be a non-negative integer of milliseconds since the epoch; got " + describeValue(value));
  }
  return value;
}
function declaringTools(options) {
  const clock = options.now ?? (() => Date.now());
  return [capabilityTool(options.log), subteamTool(options.log), heartbeatTool(options.log, clock)];
}
function declaringText(value) {
  return [{ type: "text", text: JSON.stringify(value) }];
}
function capabilityTool(log) {
  return {
    name: DECLARE_TOOL_NAMES[0],
    description: "Declare what one Team member can offer, as a durable fact in the collaboration ledger. The call replaces everything the ledger holds about that member, so send the complete set every time. Declare before offering work that needs a capability: eligibility is read from these declarations, not from who is on the roster.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        member: { type: "string", description: "The member or adapter that declares, named as the rest of the ledger names it." },
        capabilities: { type: "array", items: { type: "string" }, description: "Every capability this member offers. Names are compared as written." },
        team: { type: "string", description: "The team the member belongs to. Omit when the declaration is not attributed to a team." }
      },
      required: ["member", "capabilities"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: CAPABILITY_KIND },
          member: { type: "string" },
          capabilities: { type: "array", items: { type: "string" }, description: "The set as written: sorted and deduplicated." },
          team: { type: "string" }
        },
        required: ["seq", "kind", "member", "capabilities"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = declarationInput(args);
      const member = requiredName(input.member, "member");
      const capabilities = capabilityNames(input.capabilities);
      const team = optionalName(input.team, "team");
      const record = capabilityRecord(member, capabilities);
      const seq = await log.append({ ...record, ...team === null ? {} : { actor: team } });
      return {
        seq,
        kind: record.kind,
        member,
        capabilities: record.payload.capabilities,
        ...team === null ? {} : { team }
      };
    }
  };
}
function subteamTool(log) {
  return {
    name: DECLARE_TOOL_NAMES[1],
    description: "Declare where one team sits in the team tree by naming its parent team. Omit parent for a top-level team. The tree is folded from these declarations, so a team that never declares one still reads: it simply has no parent yet.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        team: { type: "string", description: "The team being placed, named as the rest of the ledger names it." },
        parent: { type: "string", description: "The team directly above it. Omit, or pass null, for a top-level team. A team cannot be its own parent." },
        lead: { type: "string", description: "The lead of this team, when it has one." }
      },
      required: ["team"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: TEAM_KIND },
          team: { type: "string", description: "The team this declaration is about." },
          parent: { type: "string", description: "Its parent, when the declaration named one." },
          lead: { type: "string", description: "Its lead, when the declaration named one." }
        },
        required: ["seq", "kind", "team"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = declarationInput(args);
      const team = requiredName(input.team, "team");
      const parent = optionalName(input.parent, "parent");
      if (parent !== null && parent === team) {
        throw new DeclareRefusal("DECLARE_PARENT_SELF", "team " + describeValue(team) + " cannot be its own parent; name the team above it, or omit parent for a top-level team");
      }
      const lead = optionalName(input.lead, "lead");
      const record = teamRecord(team, parent, lead === null ? void 0 : lead);
      const seq = await log.append(record);
      return {
        seq,
        kind: record.kind,
        team,
        ...parent === null ? {} : { parent },
        ...lead === null ? {} : { lead }
      };
    }
  };
}
function heartbeatTool(log, clock) {
  return {
    name: DECLARE_TOOL_NAMES[2],
    description: "Say that one Team member is still alive, by appending a heartbeat to the collaboration ledger. Liveness, quarantine and recovery are decided from the latest heartbeat and an instant the reader supplies, so a member that stops beating is reported unhealthy instead of being assumed gone.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        member: { type: "string", description: "The member or adapter that is alive." },
        at: { type: "integer", description: "The instant to record, in milliseconds since the epoch. Omit to use this end's clock." },
        team: { type: "string", description: "The team the member belongs to. Omit when the heartbeat is not attributed to a team." }
      },
      required: ["member"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: HEARTBEAT_KIND },
          member: { type: "string" },
          at: { type: "integer", description: "The instant written to the record and to its payload." },
          team: { type: "string" }
        },
        required: ["seq", "kind", "member", "at"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = declarationInput(args);
      const member = requiredName(input.member, "member");
      const team = optionalName(input.team, "team");
      const at = input.at === void 0 || input.at === null ? heartbeatInstant(clock()) : heartbeatInstant(input.at);
      const record = heartbeatRecord(member, at);
      const seq = await log.append({ ...record, ...team === null ? {} : { actor: team }, at });
      return {
        seq,
        kind: record.kind,
        member,
        at,
        ...team === null ? {} : { team }
      };
    }
  };
}
var ReclaimRefusal = class extends Error {
  /** The stable code this refusal is named by. */
  code;
  /**
   * @param code - the code, e.g. `OWNER_ALIVE`.
   * @param detail - what was refused, and what the caller should do instead.
   */
  constructor(code, detail) {
    super(code + ": " + detail);
    this.name = "ReclaimRefusal";
    this.code = code;
  }
};
var RECLAIM_TOOL_NAME = "team_reclaim_task";
function reclaimTaskRecord(taskId, owner, code, carry = {}) {
  if (typeof taskId !== "string" || taskId === "") throw new TypeError("reclaimTaskRecord: taskId must be a non-empty string");
  const revision = carry.revision ?? null;
  const title = carry.title ?? null;
  return {
    kind: TASK_KIND,
    subject: taskId,
    payload: {
      id: taskId,
      state: "pending",
      ...revision === null ? {} : { revision },
      ...title === null ? {} : { title },
      reclaimed: {
        from: owner,
        rule: RECLAIM_RULE,
        code,
        ...carry.at === void 0 || carry.at === null ? {} : { at: carry.at },
        ...carry.reason === void 0 || carry.reason === null ? {} : { reason: carry.reason },
        ...carry.by === void 0 || carry.by === null ? {} : { by: carry.by }
      }
    }
  };
}
function reclaimTarget(state, task, team) {
  if (team !== null) {
    const key = boardKey(team, task);
    if (!state.board.tasks.some((row) => row.key === key)) {
      throw new ReclaimRefusal("UNKNOWN_TASK", "no task " + describeValue(task) + " is on the board under team " + describeValue(team));
    }
    return key;
  }
  const rows = state.board.tasks.filter((row) => row.id === task);
  if (rows.length === 0) throw new ReclaimRefusal("UNKNOWN_TASK", "no task " + describeValue(task) + " is on the board");
  if (rows.length > 1) {
    throw new ReclaimRefusal("AMBIGUOUS_TASK", "task " + describeValue(task) + " is on the board in " + String(rows.length) + " teams (" + rows.map((row) => describeValue(row.team ?? "(none)")).join(", ") + "); name the team this call is about");
  }
  return rows[0].key;
}
function lastTaskRow(records, team, id) {
  let revision = null;
  let title = null;
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue;
    const payload = record.payload;
    const rowId = typeof payload?.id === "string" && payload.id !== "" ? payload.id : record.subject;
    if (rowId !== id || teamOf(record) !== team) continue;
    if (typeof payload?.revision === "number" && Number.isInteger(payload.revision)) revision = payload.revision;
    if (typeof payload?.title === "string" && payload.title !== "") title = payload.title;
  }
  return { revision, title };
}
function reclaimTask(log, options) {
  const task = requiredName(options?.task, "task", "RECLAIM_");
  const team = optionalName(options?.team, "team", "RECLAIM_");
  const timeoutMs = options?.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ReclaimRefusal("TIMEOUT", "timeoutMs must be a positive integer of milliseconds; got " + describeValue(timeoutMs));
  }
  const now = options?.now;
  if (typeof now !== "number" || !Number.isFinite(now)) {
    throw new ReclaimRefusal("AT", "now must be a finite instant in milliseconds; got " + describeValue(now));
  }
  const reason = options?.reason ?? null;
  const by = options?.by ?? log.writer;
  const records = log.replay();
  const before = foldStateOf(log);
  const key = reclaimTarget(before, task, team);
  const reading = reclaimReading(before, key, now, { timeoutMs });
  if (!reading.reclaimable) throw new ReclaimRefusal(reading.code, reading.reason);
  const winner = before.tasks.find((task2) => boardKey(task2.team, task2.id) === key) ?? null;
  const claimAt = winner === null ? null : winner.claim.at;
  if (claimAt !== null && now < claimAt) {
    throw new ReclaimRefusal("STALE_AT", "the instant " + String(now) + " is older than the claim this reclaim releases (" + String(claimAt) + "), so the board would keep the older claim and the release would be invisible; pass an instant at or after it");
  }
  const previous = lastTaskRow(records, reading.team, reading.taskId);
  const written = reclaimTaskRecord(reading.taskId, reading.owner, reading.code, {
    revision: previous.revision === null ? null : previous.revision + 1,
    title: previous.title,
    reason,
    by,
    at: now
  });
  return (async () => {
    const seq = await log.append({
      ...written,
      ...reading.team === null ? {} : { actor: reading.team },
      at: now
    });
    let isolation = null;
    if (reading.owner !== null) {
      const record = quarantineRecord(reading.owner, now, { reason: reading.code, task: reading.taskId, by });
      const isolationSeq = await log.append({
        ...record,
        ...reading.team === null ? {} : { actor: reading.team },
        at: now
      });
      isolation = { seq: isolationSeq, ...record };
    }
    const answers = await foldAfterQueries(log, [
      { kind: "boardRow", key: reading.key },
      ...reading.owner === null ? [] : [{ kind: "quarantined", member: reading.owner }]
    ]);
    const row = answers[0];
    return {
      reading,
      seq,
      task: written,
      // Reported and read back: the fold is what makes an isolation a fact rather than a note, so the
      // outcome says both what was appended and whether the isolation table holds it now.
      isolation: isolation === null ? null : {
        ...isolation,
        isolated: reading.owner !== null && answers[1] === true
      },
      after: { status: row?.status ?? "unknown", owner: row?.owner ?? null }
    };
  })();
}
function reclaimReason(value) {
  if (value === void 0 || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReclaimRefusal("RECLAIM_REASON_EMPTY", "reason must be a non-empty string when it is given; got " + describeValue(value));
  }
  if (value.length > 200) {
    throw new ReclaimRefusal("RECLAIM_REASON_LONG", "reason must be at most 200 characters; got " + String(value.length));
  }
  return value;
}
function reclaimTool(options) {
  const clock = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? RECLAIM_DEFAULT_TTL_MS;
  return {
    name: RECLAIM_TOOL_NAME,
    description: "Release an in_progress Task whose owner went silent, back to pending, and isolate that owner. The rule is named: an owner that beat inside the threshold is refused by code and nothing is written. An owner that never beat, or whose last beat is at least the threshold ago, or a row with no owner recorded, is released. The release is a fact in the collaboration ledger \u2014 the kernel's own board is the Lead's to change.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", description: "The task id to release, as the board names it." },
        team: { type: "string", description: "The team the task belongs to. Omit when the id is unambiguous; the call is refused when two teams share it." },
        reason: { type: "string", description: "Why the caller is reclaiming, up to 200 characters. Recorded on the ledger row. Omit when there is nothing to say." },
        at: { type: "integer", description: "The instant to decide and stamp at, in milliseconds since the epoch. Omit to use this end's clock." }
      },
      required: ["task"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the task/state record was given." },
          kind: { type: "string", const: TASK_KIND, description: "The kind of the record written." },
          subject: { type: "string", description: "What the record is about: the task id." },
          task: { type: "string", description: "The task that was released." },
          id: { type: "string", description: "The task id, as the record carries it. The same value as task." },
          team: { type: "string", description: "The team the task was resolved to, when it has one." },
          state: { type: "string", description: "The state the task was released back to: pending." },
          code: { type: "string", description: "The rule's named answer: NEVER_BEAT, HEARTBEAT_STALE or NO_OWNER." },
          revision: { type: "integer", description: "The revision written, when the task already carried one." },
          reclaimedFrom: { type: "string", description: "The owner that was cleared and isolated, when the row named one." },
          reclaimedSeq: { type: "integer", description: "The sequence the isolation of that owner is folded from: the same row." }
        },
        required: ["seq", "kind", "subject", "task", "id", "state", "code"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = declarationInput(args);
      const task = requiredName(input.task, "task", "RECLAIM_");
      const team = optionalName(input.team, "team", "RECLAIM_");
      const reason = reclaimReason(input.reason);
      const at = input.at === void 0 || input.at === null ? heartbeatInstant(clock()) : heartbeatInstant(input.at);
      const outcome = await reclaimTask(options.log, { task, team, timeoutMs, now: at, reason });
      return {
        seq: outcome.seq,
        kind: outcome.task.kind,
        subject: outcome.task.subject,
        task: outcome.reading.taskId,
        id: outcome.reading.taskId,
        ...outcome.reading.team === null ? {} : { team: outcome.reading.team },
        state: outcome.after.status,
        code: outcome.reading.code,
        ...outcome.task.payload.revision === void 0 ? {} : { revision: outcome.task.payload.revision },
        ...outcome.reading.owner === null ? {} : { reclaimedFrom: outcome.reading.owner, reclaimedSeq: outcome.seq }
      };
    }
  };
}
function reclaimTools(options) {
  return [reclaimTool(options)];
}
var PEER_TOOL_NAMES = ["team_request_peer", "team_answer_peer"];
var PeerRefusal = class extends Error {
  /** The stable code this refusal is named by. */
  code;
  /**
   * @param code - the code, e.g. PEER_SELF.
   * @param detail - what was refused, and what the caller should send instead.
   */
  constructor(code, detail) {
    super(code + ": " + detail);
    this.name = "PeerRefusal";
    this.code = code;
  }
};
var PEER_REQUEST_MAX = 200;
function peerInput(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new PeerRefusal("PEER_INPUT", "this tool takes one object of arguments; got " + describeValue(args));
  }
  return args;
}
function peerRequest(value) {
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") {
    throw new PeerRefusal("PEER_REQUEST_EMPTY", "request is required and must not be empty; got " + describeValue(value ?? null));
  }
  if (typeof value !== "string") {
    throw new PeerRefusal("PEER_REQUEST_TEXT", "request must be a string; got " + describeValue(value));
  }
  if (value.length > PEER_REQUEST_MAX) {
    throw new PeerRefusal("PEER_REQUEST_LONG", "request must be at most " + String(PEER_REQUEST_MAX) + " characters; got " + String(value.length));
  }
  return value;
}
function peerPair(input) {
  const refuse = (code, detail) => new PeerRefusal(code, detail);
  const from = requiredName(input.from, "from", "PEER_", refuse);
  const to = requiredName(input.to, "to", "PEER_", refuse);
  if (from === to) {
    throw new PeerRefusal("PEER_SELF", "lead " + describeValue(from) + " cannot handshake with itself; name the lead at the other end, or exchange inside one team instead");
  }
  return { from, to };
}
function peerAnswerState(value) {
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") {
    throw new PeerRefusal("PEER_STATE_EMPTY", "state is required and must be granted or denied; got " + describeValue(value ?? null));
  }
  if (value !== "granted" && value !== "denied") {
    throw new PeerRefusal("PEER_STATE", "state " + describeValue(value) + " is not an answer; use granted or denied" + (value === "requested" ? " - a request is opened with " + PEER_TOOL_NAMES[0] : ""));
  }
  return value;
}
function peerRowOn(state, from, to) {
  return state.peers.pairs.find((pair) => pair.from === from && pair.to === to);
}
function peerRequestTool(log) {
  return {
    name: PEER_TOOL_NAMES[0],
    description: "Ask another Team lead to exchange with you directly (\u300ADSH LINK.md\u300Bmd:244-246). The handshake is a fact in the collaboration ledger, and the pair is ordered: this call records that from is asking to, so it grants neither side anything yet - only the answer does, and it keeps this direction. The other lead answers with " + PEER_TOOL_NAMES[1] + ".",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "The lead asking - the asking end of the ordered pair." },
        to: { type: "string", description: "The lead being asked. It cannot be the asking lead itself." },
        request: { type: "string", description: "What is being asked for, in the caller's own words, up to " + String(PEER_REQUEST_MAX) + " characters." }
      },
      required: ["from", "to", "request"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: PEER_KIND },
          subject: { type: "string", description: "The ordered pair, as the record spells it: from->to." },
          from: { type: "string" },
          to: { type: "string" },
          request: { type: "string" },
          state: { type: "string", const: "requested", description: "The state written: a request is not permission." },
          allowed: { type: "boolean", description: "Whether the fold now allows from to reach to: false for a request." },
          reversed: { type: "boolean", description: "Whether the fold allows to to reach from - the other direction, which this row says nothing about." }
        },
        required: ["seq", "kind", "subject", "from", "to", "request", "state", "allowed", "reversed"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = peerInput(args);
      const { from, to } = peerPair(input);
      const request = peerRequest(input.request);
      const before = foldStateOf(log);
      if (peerRowOn(before, from, to)?.state === "granted") {
        throw new PeerRefusal("PEER_ALREADY_GRANTED", "the ledger already holds " + from + " -> " + to + " as granted, and a request would clear it; answer that pair with " + PEER_TOOL_NAMES[1] + " (denied) to reopen it");
      }
      const record = peerRecord(from, to, request, "requested");
      const seq = await log.append({ ...record, actor: from });
      const answers = await foldAfterQueries(log, [
        { kind: "mayExchange", from, to },
        { kind: "mayExchange", from: to, to: from }
      ]);
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        request,
        state: "requested",
        allowed: answers[0] === true,
        reversed: answers[1] === true
      };
    }
  };
}
function peerAnswerTool(log) {
  return {
    name: PEER_TOOL_NAMES[1],
    description: "Answer a lead's request to exchange: grant it, or deny it. The pair keeps the direction that was asked - from is the asking lead and to is the answering lead - so a grant records that from may reach to and says nothing about to reaching from, which needs its own request and its own answer. A later denial clears an earlier grant because the higher sequence wins, not by a second mechanism.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "The lead that asked - the asking end of the ordered pair, as the request wrote it." },
        to: { type: "string", description: "The lead answering. It cannot be the asking lead itself." },
        state: { type: "string", description: "The answer: granted or denied. A request is not an answer." },
        request: { type: "string", description: "What this answer is about. Omit to carry the request the ledger already holds for the pair." }
      },
      required: ["from", "to", "state"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: PEER_KIND },
          subject: { type: "string", description: "The ordered pair, as the record spells it: from->to." },
          from: { type: "string" },
          to: { type: "string" },
          request: { type: "string", description: "The request written on the answer row." },
          state: { type: "string", description: "The state written: granted or denied." },
          allowed: { type: "boolean", description: "Whether the fold now allows from to reach to." },
          reversed: { type: "boolean", description: "Whether the fold allows to to reach from - the other direction, which this answer does not decide." }
        },
        required: ["seq", "kind", "subject", "from", "to", "request", "state", "allowed", "reversed"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = peerInput(args);
      const { from, to } = peerPair(input);
      const state = peerAnswerState(input.state);
      const before = foldStateOf(log);
      const pair = peerRowOn(before, from, to);
      if (pair === void 0) {
        throw new PeerRefusal("PEER_REQUEST_NONE", "the ledger holds no request from " + from + " to " + to + "; ask first with " + PEER_TOOL_NAMES[0] + " (the pair is ordered, and the other direction is a different pair)");
      }
      const request = input.request === void 0 || input.request === null ? pair.request : peerRequest(input.request);
      if (request === "") {
        throw new PeerRefusal("PEER_REQUEST_BLANK", "the ledger holds a " + from + " -> " + to + " row that carries no request text; name the request this answer is about");
      }
      const record = peerRecord(from, to, request, state);
      const seq = await log.append({ ...record, actor: to });
      const answers = await foldAfterQueries(log, [
        { kind: "mayExchange", from, to },
        { kind: "mayExchange", from: to, to: from }
      ]);
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        request,
        state,
        allowed: answers[0] === true,
        reversed: answers[1] === true
      };
    }
  };
}
function peerTools(options) {
  return [peerRequestTool(options.log), peerAnswerTool(options.log)];
}
var MERGE_TOOL_NAMES = ["team_request_merge", "team_answer_merge"];
function mergeInput(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new MergeRefusal("MERGE_INPUT", "this tool takes one object of arguments; got " + describeValue(args));
  }
  return args;
}
function mergeRefuse(code, detail) {
  return new MergeRefusal(code, detail);
}
function mergeMode(value) {
  if (value === void 0 || value === null) {
    throw new MergeRefusal("MERGE_MODE", "mode is required and must be join or absorb; got " + describeValue(value ?? null));
  }
  if (value !== "join" && value !== "absorb") {
    throw new MergeRefusal("MERGE_MODE", "mode " + describeValue(value) + " is not a direction; use join (this team is taken in) or absorb (this team takes the other in)");
  }
  return value;
}
function teamsLedBy(state, writer) {
  return state.teams.teams.filter((team) => team.lead === writer).map((team) => team.id);
}
function mergeRequestTool(options) {
  const log = options.log;
  const clock = options.now ?? (() => Date.now());
  return {
    name: MERGE_TOOL_NAMES[0],
    description: "Ask another Team to merge with yours \u2014 to take this team in (mode join), or to be taken in by it (mode absorb). The ask is a fact in the collaboration ledger and it changes no tree: only the answer does, and only the party being merged in writes its own parent. The two leads must already have a granted handshake, and the other team answers with " + MERGE_TOOL_NAMES[1] + ".",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        team: { type: "string", description: "The team at the other end: with join, the team that takes yours in; with absorb, the team yours takes in." },
        mode: { type: "string", description: "join (your team is taken in) or absorb (your team takes the other in)." }
      },
      required: ["team", "mode"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the ledger assigned this record." },
          kind: { type: "string", const: MERGE_KIND },
          subject: { type: "string", description: "The asking team, which is what the record is about." },
          from: { type: "string", description: "The asking team \u2014 this ledger writer's own team." },
          to: { type: "string", description: "The team being asked." },
          mode: { type: "string", description: "The direction written." },
          state: { type: "string", const: "requested", description: "The state written: a request is not a permission." },
          by: { type: "string", description: "Who asked \u2014 this ledger's writer, as the row carries it." },
          at: { type: "integer", description: "The instant written on the row." },
          mayExchange: { type: "boolean", description: "Whether the two leads may exchange, read back from the ledger." },
          mayMerge: { type: "boolean", description: "Whether the fold now allows this merge \u2014 false for a request." }
        },
        required: ["seq", "kind", "subject", "from", "to", "mode", "state", "by", "at", "mayExchange", "mayMerge"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = mergeInput(args);
      const team = requiredName(input.team, "team", "MERGE_", mergeRefuse);
      const mode = mergeMode(input.mode);
      const before = foldStateOf(log);
      const led = teamsLedBy(before, log.writer);
      if (led.length !== 1) {
        throw new MergeRefusal("MERGE_LOCAL_TEAM", led.length === 0 ? "this ledger records no team led by " + describeValue(log.writer) + ", so there is no asking team; declare it first (team/state with lead) and ask again" : "this ledger records " + String(led.length) + " teams led by " + describeValue(log.writer) + " (" + led.join(", ") + "); a request comes from one team, so name your own team as the team this ledger leads");
      }
      const from = led[0];
      if (from === team) {
        throw new MergeRefusal("MERGE_SELF", "team " + describeValue(from) + " cannot merge with itself; name the team at the other end (a team cannot be its own parent)");
      }
      if (!mayExchange(before, from, team)) {
        throw new MergeRefusal("MERGE_PEER_REQUIRED", from + " and " + team + " have no granted handshake in that direction, and a merge needs one; settle it first with the lead handshake tools (the pair is ordered: " + from + " -> " + team + " is its own question)");
      }
      const standing = before.merges.pairs.find((pair) => pair.from === from && pair.to === team);
      if (standing?.state === "granted") {
        throw new MergeRefusal("MERGE_ALREADY_GRANTED", "the ledger already holds " + from + " -> " + team + " as granted, and a request would clear it; answer that pair with " + MERGE_TOOL_NAMES[1] + " (grant false) to reopen it");
      }
      const record = mergeRecord({ from, to: team, mode, state: "requested", by: log.writer, at: clock() });
      const seq = await log.append({ ...record, actor: from });
      const answers = await foldAfterQueries(log, [
        { kind: "mayExchange", from, to: team },
        { kind: "mayMerge", from, to: team }
      ]);
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to: team,
        mode,
        state: "requested",
        by: log.writer,
        at: record.payload.at,
        mayExchange: answers[0] === true,
        mayMerge: answers[1] === true
      };
    }
  };
}
function mergeAnswerTool(options) {
  const log = options.log;
  const clock = options.now ?? (() => Date.now());
  return {
    name: MERGE_TOOL_NAMES[1],
    description: "Answer a team's request to merge: grant it, or deny it. Only the party being merged in may answer, and a grant writes exactly two rows: that team's own team/state (its parent is the team taking it in) and the merge row that names who authorized it. A denial writes one row and changes no tree, and a later denial clears an earlier grant because the higher sequence wins.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "The team that asked \u2014 the asking team of the request being answered, as the request wrote it." },
        team: { type: "string", description: "The team answering. Omit to read it from this ledger (the team its writer leads). It must be the party being merged in; naming anybody else is refused and nothing is written." },
        grant: { type: "boolean", description: "true to merge, false to deny. A request is not an answer." }
      },
      required: ["from", "grant"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          seq: { type: "integer", description: "The sequence the merge record was given." },
          kind: { type: "string", const: MERGE_KIND },
          subject: { type: "string", description: "The asking team, which is what the record is about." },
          from: { type: "string" },
          to: { type: "string" },
          mode: { type: "string", description: "The direction of the request that was answered." },
          state: { type: "string", description: "The answer written: granted or denied." },
          by: { type: "string", description: "Who answered \u2014 this ledger's writer, as the row carries it." },
          at: { type: "integer", description: "The instant written on the merge row." },
          treeSeq: { type: "integer", description: "The sequence of the team/state row written by a grant. Absent on a denial: a denial writes one row." },
          treeTeam: { type: "string", description: "The team whose parent was written, when a grant wrote one." },
          treeParent: { type: "string", description: "The parent written, when a grant wrote one." },
          mayExchange: { type: "boolean", description: "Whether the two leads may exchange, read back from the ledger." },
          mayMerge: { type: "boolean", description: "Whether the fold now allows this merge, read back from the ledger." }
        },
        required: ["seq", "kind", "subject", "from", "to", "mode", "state", "by", "at", "mayExchange", "mayMerge"]
      },
      render: (_args, value) => declaringText(value)
    },
    async execute(args) {
      const input = mergeInput(args);
      const from = requiredName(input.from, "from", "MERGE_", mergeRefuse);
      const grant = input.grant;
      if (typeof grant !== "boolean") {
        throw new MergeRefusal("MERGE_GRANT", "grant must be true or false; got " + describeValue(grant ?? null));
      }
      const named = optionalName(input.team, "team", "MERGE_");
      const before = foldStateOf(log);
      const mergedInOf = (pair) => pair.mode === "join" ? pair.from : pair.to;
      const rows = before.merges.pairs.filter((pair) => pair.from === from);
      const standing = named === null ? rows : rows.filter((pair) => mergedInOf(pair) === named);
      if (standing.length === 0) {
        throw new MergeRefusal("MERGE_REQUEST_NONE", "the ledger holds no standing merge row from " + from + (named === null ? "" : " whose party being merged in is " + describeValue(named)) + "; ask first with " + MERGE_TOOL_NAMES[0] + " (the pair is ordered, and the other direction is a different pair)");
      }
      if (standing.length > 1) {
        throw new MergeRefusal("MERGE_REQUEST_AMBIGUOUS", "the ledger holds " + String(standing.length) + " merge rows from " + from + " (" + standing.map((pair) => pair.to + "/" + pair.mode).join(", ") + "); name team as the party being merged in, so the answer names the one agreement it settles");
      }
      const request = standing[0];
      const to = request.to;
      const mode = request.mode;
      const mergedIn = mergedInOf(request);
      const parent = mode === "join" ? to : from;
      const led = teamsLedBy(before, log.writer);
      const caller = named ?? (led.length === 1 ? led[0] : null);
      if (caller === null) {
        throw new MergeRefusal("MERGE_NOT_AUTHORIZED", "this ledger records no team led by " + describeValue(log.writer) + " and the call named none, so there is no answering lead; name team (" + mergedIn + " is the party being merged in) or declare that team's lead first");
      }
      if (led.length > 0 && led.includes(caller) !== true) {
        throw new MergeRefusal("MERGE_NOT_AUTHORIZED", "this ledger records " + describeValue(log.writer) + " as the lead of " + led.join(", ") + ", and " + describeValue(caller) + " is not one of them; an agreement is written by the party being merged in, speaking for its own team");
      }
      if (caller !== mergedIn) {
        throw new MergeRefusal("MERGE_NOT_AUTHORIZED", "a merge writes the parent of " + describeValue(mergedIn) + " (the party being merged in), and " + describeValue(caller) + " is not it; only that party's own lead may answer, because two writers of one parent is two answers to one question");
      }
      if (!mayExchange(before, from, to)) {
        throw new MergeRefusal("MERGE_PEER_REQUIRED", from + " and " + to + " have no granted handshake in that direction, and a merge needs one; settle it first with the lead handshake tools (the pair is ordered: " + from + " -> " + to + " is its own question)");
      }
      const at = clock();
      let tree = null;
      if (grant) {
        const standing2 = before.teams.teams.find((team) => team.id === mergedIn);
        const declaration = teamRecord(mergedIn, parent, ...standing2?.lead === null || standing2?.lead === void 0 ? [] : [standing2.lead]);
        const treeSeq = await log.append({ ...declaration, actor: log.writer });
        tree = { seq: treeSeq, kind: declaration.kind, subject: declaration.subject, payload: declaration.payload };
      }
      const record = mergeRecord({ from, to, mode, state: grant ? "granted" : "denied", by: log.writer, at });
      const seq = await log.append({ ...record, actor: mergedIn });
      const answers = await foldAfterQueries(log, [
        { kind: "mayExchange", from, to },
        { kind: "mayMerge", from, to }
      ]);
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        mode,
        state: grant ? "granted" : "denied",
        by: log.writer,
        at,
        ...tree === null ? {} : { treeSeq: tree.seq, treeTeam: tree.subject, treeParent: parent },
        mayExchange: answers[0] === true,
        mayMerge: answers[1] === true
      };
    }
  };
}
function mergeTools(options) {
  return [mergeRequestTool(options), mergeAnswerTool(options)];
}
var CONTROL_PAGE_MAX = 1e3;
var CONTROL_PAGE_DEFAULT = 100;
function controlPage(records, options = {}) {
  const since = options.since ?? 0;
  const requested = options.limit ?? CONTROL_PAGE_DEFAULT;
  if (!Number.isInteger(since) || since < 0) throw new TypeError("controlPage: since must be a non-negative integer");
  if (!Number.isInteger(requested) || requested < 1) throw new TypeError("controlPage: limit must be a positive integer");
  const ordered = orderedRecords(records);
  const after = ordered.filter((record) => record.seq > since);
  const page = after.slice(0, Math.min(requested, CONTROL_PAGE_MAX));
  const through = page.length === 0 ? since : page[page.length - 1].seq;
  return {
    from: since,
    through,
    next: through,
    rows: page.map((record) => ({
      seq: record.seq,
      kind: record.kind,
      at: record.at,
      ...record.actor === void 0 ? {} : { actor: record.actor },
      ...record.subject === void 0 ? {} : { subject: record.subject },
      ...record.payload === void 0 ? {} : { payload: record.payload }
    })),
    // The fold stops at the page, never at the end of the ledger: folding everything would answer
    // with a state the rows above do not produce, and a cursor whose two halves disagree is worse
    // than no cursor at all.
    state: projectTeamState(ordered.filter((record) => record.seq <= through)),
    counts: { total: ordered.length, returned: page.length, more: after.length > page.length },
    damage: options.damage ?? null
  };
}
function installDeclaringTools(ctx, log, state, options = {}) {
  const inject = ctx.inject;
  if (inject === void 0) {
    state.reason = "this context cannot inject the tools service";
    return state;
  }
  state.reason = "waiting for the tools service";
  inject.call(ctx, ["tools"], (scoped) => {
    const registry = scoped.get?.("tools");
    if (registry === void 0 || typeof registry.register !== "function") {
      state.reason = "this composition mounts no tool registry";
      return;
    }
    const definitions = [
      ...declaringTools({ log }),
      // R181 lead ruling: default ON, with `config.reclaim.enabled === false` as the way out - which is
      // what this option's own JSDoc above already promised ("the way out for a deployment that does not
      // want a reclaim tool"). The first cut had it inverted (opt-in), so the shipped composition
      // registered no reclaimer and the gate's reading 8 was right to call it out.
      ...options.reclaim?.enabled !== false ? reclaimTools({
        log,
        ...options.reclaim.timeoutMs === void 0 ? {} : { timeoutMs: options.reclaim.timeoutMs },
        ...options.reclaim.now === void 0 ? {} : { now: options.reclaim.now }
      }) : [],
      // R182: the handshake producer, registered with the declaring tools and by the same rule. These two
      // names are a change to the shipped tool face, which two gates pin from their own sides - gate 107 by
      // name (ALL_TOOL_NAMES) and gate 108's reading 8 by count. The change is reported rather than smuggled:
      // docs/handoff/R182-A-peer-tools.md names the two tools and the exact widening each gate needs.
      ...peerTools({ log }),
      // R183: the merge pair, registered with the declaring tools and by the same rule. These two names
      // are a change to the shipped tool face, which gate 107 pins by name (ALL_TOOL_NAMES): reported
      // rather than smuggled - docs/handoff/R183-A-ledger.md names the two tools and the exact widening.
      ...mergeTools({ log })
    ];
    let failure = null;
    for (const definition of definitions) {
      try {
        const dispose = registry.register(definition);
        if (ctx.effect !== void 0) ctx.effect(() => dispose);
        state.names.push(definition.name);
      } catch (error) {
        failure = "registering " + definition.name + " failed: " + String(error?.message ?? error);
        console.error("[dsh-link-collab] " + failure);
      }
    }
    state.registered = state.names.length === definitions.length;
    state.reason = state.registered ? null : failure ?? "the tool registry accepted none of the declaring tools";
  });
  return state;
}
function apply(ctx, config = {}) {
  const context = ctx;
  const foldConfig = config.fold ?? {};
  if (foldConfig.checkpoint !== void 0 && typeof foldConfig.checkpoint !== "boolean") throw new TypeError("dsh-link-collab: fold.checkpoint must be a boolean");
  if (foldConfig.worker !== void 0 && typeof foldConfig.worker !== "boolean") throw new TypeError("dsh-link-collab: fold.worker must be a boolean");
  const foldCheckpointEnabled = foldConfig.checkpoint === true;
  const foldCheckpointEveryMs = foldConfig.checkpointIntervalMs === void 0 ? 5e3 : Number(foldConfig.checkpointIntervalMs);
  if (!Number.isInteger(foldCheckpointEveryMs) || foldCheckpointEveryMs <= 0) throw new TypeError("dsh-link-collab: fold.checkpointIntervalMs must be a positive integer");
  if (foldConfig.fastOpen !== void 0 && typeof foldConfig.fastOpen !== "boolean") throw new TypeError("dsh-link-collab: fold.fastOpen must be a boolean");
  const foldStampVerifyMs = foldConfig.stampVerifyMs === void 0 ? 6e4 : Number(foldConfig.stampVerifyMs);
  if (!Number.isInteger(foldStampVerifyMs) || foldStampVerifyMs <= 0) throw new TypeError("dsh-link-collab: fold.stampVerifyMs must be a positive integer");
  configureFold({ checkpoint: foldCheckpointEnabled, checkpointIntervalMs: foldCheckpointEveryMs, fastOpen: foldConfig.fastOpen === true, stampVerifyMs: foldStampVerifyMs });
  if (foldConfig.worker === true) {
    const worker = startFoldWorker();
    activateFoldWorker(worker);
    if (worker === null) console.error("[dsh-link-collab] fold.worker was requested but a worker could not start; the synchronous index stays in use");
  } else {
    activateFoldWorker(null);
  }
  const home = (() => {
    const provided = context.get?.("dshHomePath");
    if (typeof provided === "function") return String(provided("collab"));
    return join2(process.env.DSH_HOME ?? ".", "collab");
  })();
  const live = /* @__PURE__ */ new Set();
  let own;
  try {
    own = openControlLog({ dir: config.logDir === void 0 ? home : join2(home, config.logDir), reclaim: config.reclaimLock === true });
  } catch (error) {
    console.error("[dsh-link-collab] control channel unavailable under " + home + ": " + String(error?.message ?? error));
    return;
  }
  live.add(own);
  const recorder = recordTeamEvents(context, own);
  const requestedToken = typeof config.relay?.token === "string" ? config.relay.token : "";
  const relayToken = requestedToken.trim() === "" ? null : requestedToken;
  if (relayToken === null && requestedToken !== "") {
    console.error("[dsh-link-collab] relay token is whitespace only; no route bound (a token that cannot be sent is not a token)");
  }
  if (relayToken === null && requestedToken === "") {
    console.log("[dsh-link-collab] relay not bound: no relay token configured (set relay.token to accept peer batches)");
  }
  const relayPath = config.relay?.path === void 0 ? RELAY_PATH : config.relay.path;
  const relayState = { bound: false, path: relayPath, accepted: 0, refused: 0, lastCode: null };
  const endpoint = relayToken === null ? null : createRelayEndpoint({ token: relayToken, log: own, path: relayPath });
  const handleRelay = async (req, res) => {
    if (endpoint === null) {
      res.statusCode = 404;
      res.end("no route");
      return;
    }
    const outcome = await endpoint.handler(req, res);
    if (outcome.ok) relayState.accepted += 1;
    else {
      relayState.refused += 1;
      relayState.lastCode = outcome.code ?? "RELAY_REFUSED";
    }
  };
  if (relayToken !== null) {
    const inject = context.inject;
    if (inject === void 0) {
      console.error("[dsh-link-collab] relay configured but this context cannot inject webServer; no route bound");
    } else {
      inject.call(context, ["webServer"], (scoped) => {
        const server = scoped.get?.("webServer");
        if (server?.register === void 0) {
          console.error("[dsh-link-collab] relay configured but the web server offers no register(); no route bound");
          return;
        }
        context.effect?.(() => server.register({
          kind: "exact",
          path: relayPath,
          handler: (req, res) => {
            void handleRelay(req, res);
          }
        }));
        relayState.bound = true;
        console.log("[dsh-link-collab] relay route bound on " + relayPath + " (bearer token required)");
      });
    }
  }
  const relayTo = async (options) => {
    const identity = options.as ?? { writer: own.writer, instance: own.instance };
    const records = own.ownPage(options.since ?? 0).map((record) => ({
      seq: record.originSeq ?? record.seq,
      kind: record.kind,
      ...record.actor === void 0 ? {} : { actor: record.actor },
      ...record.subject === void 0 ? {} : { subject: record.subject },
      ...record.payload === void 0 ? {} : { payload: record.payload },
      ...record.at === void 0 ? {} : { at: record.at }
    }));
    const batch = { writer: identity.writer, instance: identity.instance, records };
    const push = { token: options.token, ...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs } };
    return endpoint === null ? pushBatch(options.url, push.token, batch, push.timeoutMs) : endpoint.relayTo(options.url, batch, push);
  };
  const retryConfig = config.retry ?? {};
  const retryEnabled = retryConfig.enabled === true;
  const retryTeam = retryConfig.team ?? "team-1";
  const retryLocalEnd = retryConfig.localEnd ?? "end-A";
  let retryEveryMs = null;
  let retryFactor;
  let retryMaxMs;
  let retryJitter = 0;
  let retryOptions = null;
  if (retryEnabled) {
    const everyMs = Number(retryConfig.everyMs);
    const timeoutMs = Number(retryConfig.timeoutMs);
    const maxAttempts = Number(retryConfig.maxAttempts);
    if (!Number.isInteger(everyMs) || everyMs <= 0) throw new TypeError("dsh-link-collab: retry.everyMs must be a positive integer");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("dsh-link-collab: retry.timeoutMs must be a positive integer");
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError("dsh-link-collab: retry.maxAttempts must be a positive integer");
    const schedule = retryConfig.schedule;
    if (schedule !== void 0 && schedule !== null) {
      const factor = Number(schedule.factor);
      const maxMs = Number(schedule.maxMs);
      if (schedule.factor === void 0 || !Number.isFinite(factor) || factor <= 1) throw new TypeError("dsh-link-collab: retry.schedule.factor must be finite and greater than 1");
      if (schedule.maxMs === void 0 || !Number.isInteger(maxMs) || maxMs < everyMs) throw new TypeError("dsh-link-collab: retry.schedule.maxMs must be a positive integer of at least retry.everyMs");
      retryFactor = factor;
      retryMaxMs = maxMs;
    }
    const jitter = Number(retryConfig.jitter ?? 0);
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new TypeError("dsh-link-collab: retry.jitter must be within [0, 1]");
    retryJitter = jitter;
    retryEveryMs = everyMs;
    retryOptions = { team: retryTeam, localEnd: retryLocalEnd, now: Date.now(), timeoutMs, maxAttempts };
  }
  let retryTimer = null;
  let retryIdle = 0;
  let retryNextDelay = null;
  const retryCounts = { runs: 0, written: 0, skipped: 0, failed: 0, ticks: 0, claimed: 0, lost: 0 };
  let retryInFlight = false;
  let retryLastError = null;
  let retryLastReason = null;
  const retryRun = async () => {
    if (!retryEnabled || retryOptions === null) {
      retryLastReason = "disabled";
      return { written: [], blocked: [], reason: "disabled" };
    }
    if (retryInFlight) {
      retryCounts.skipped += 1;
      retryLastReason = "in-flight";
      return { written: [], blocked: [], reason: "in-flight" };
    }
    retryInFlight = true;
    try {
      const options = { ...retryOptions, now: Date.now() };
      const plan = redispatchPlan(foldStateOf(own), options);
      const written = await appendRedispatches(foldStateOf(own), own, options);
      retryCounts.runs += 1;
      retryCounts.written += written.length;
      if (written.length > 0) {
        const after = foldStateOf(own);
        const claimed = after.retryLeases.filter((lease) => written.includes(lease.seq));
        retryCounts.claimed += claimed.length;
        for (const root of new Set(claimed.map((lease) => lease.root))) {
          if (!retryOwner(after.retryLeases, { root, localEnd: retryLocalEnd, now: Date.now() }).mine) retryCounts.lost += 1;
        }
      }
      retryIdle = written.length > 0 ? 0 : retryIdle + 1;
      retryLastError = null;
      retryLastReason = "ok";
      return { written, blocked: plan.blocked, reason: "ok" };
    } catch (error) {
      retryCounts.failed += 1;
      retryIdle += 1;
      retryLastError = String(error?.message ?? error);
      retryLastReason = "failed";
      return { written: [], blocked: [], reason: "failed" };
    } finally {
      retryInFlight = false;
    }
  };
  const currentDelay = () => retryDelay({
    everyMs: retryEveryMs,
    ...retryFactor === void 0 ? {} : { factor: retryFactor },
    ...retryMaxMs === void 0 ? {} : { maxMs: retryMaxMs },
    jitter: retryJitter,
    idle: retryIdle
  });
  const armRetry = (delayMs) => {
    const timer = setTimeout(() => {
      retryCounts.ticks += 1;
      retryTimer = null;
      retryNextDelay = null;
      void retryRun().then(() => {
        armRetry(currentDelay());
      }, () => {
        armRetry(currentDelay());
      });
    }, delayMs);
    timer.unref?.();
    retryTimer = timer;
    retryNextDelay = delayMs;
  };
  if (retryEnabled && retryEveryMs !== null) armRetry(currentDelay());
  const reclaimEnabled = config.reclaim?.enabled !== false;
  let reclaimTimeoutMs = RECLAIM_DEFAULT_TTL_MS;
  if (config.reclaim?.timeoutMs !== void 0) {
    const requested = Number(config.reclaim.timeoutMs);
    if (!Number.isInteger(requested) || requested <= 0) throw new TypeError("dsh-link-collab: reclaim.timeoutMs must be a positive integer");
    reclaimTimeoutMs = requested;
  }
  const toolsState = { registered: false, names: [], reason: null };
  installDeclaringTools(context, own, toolsState, { reclaim: { enabled: reclaimEnabled, timeoutMs: reclaimTimeoutMs } });
  const foldEngine = resolveFoldEngine(config);
  const computeShadow = foldEngine.engine === "native-shadow" ? computeShadowFor({ directory: own.directory, getService: () => context.get?.("linkCompute") }) : null;
  if (computeShadow !== null) context.effect?.(() => () => disposeComputeShadow(own.directory));
  let lastBrokerCode = null;
  let statusRouteBound = false;
  const statusCounts = { served: 0, refused: 0, lastError: null };
  const relayReading = () => ({
    bound: relayState.bound,
    path: relayState.path,
    accepted: relayState.accepted,
    refused: relayState.refused,
    lastCode: relayState.lastCode
  });
  const readStatus = () => {
    const reading = foldReadingOf(own);
    return busStatus({
      at: Date.now(),
      path: STATUS_PATH,
      log: { lastSeq: own.lastSeq, writer: own.writer, instance: own.instance, damage: own.damage },
      records: reading.records,
      teams: reading.teams,
      counts: reading.counts,
      relay: relayReading(),
      messages: reading.messages,
      recorded: recorder.counts
    });
  };
  const teamState = () => {
    const state = foldStateOf(own);
    computeShadow?.observe(state);
    return state;
  };
  const foldOf = (log) => foldStateOf(log);
  const capability = {
    open: (options) => {
      const log = openControlLog(options);
      live.add(log);
      return log;
    },
    log: own,
    // The live index: the same answer a full fold gives, at the cost of the appended records.
    state: () => teamState(),
    fold: {
      get mode() {
        return { checkpoint: foldSettings().checkpoint, worker: foldWorkerEnabled, fastOpen: foldSettings().fastOpen };
      },
      get status() {
        return foldDiagnostics();
      },
      state: () => foldStateOf(own),
      reading: () => foldReadingOf(own),
      checkpointNow: () => saveFoldCheckpoint(own),
      loadCheckpoint: () => loadFoldCheckpoint(own).info,
      reset: () => {
        disposeFoldLog(own);
      }
    },
    records: (options) => controlPage(own.replay(), { ...options, damage: own.damage }),
    tools: {
      get available() {
        return toolsState.registered;
      },
      get names() {
        return [...toolsState.names];
      },
      get reason() {
        return toolsState.reason;
      }
    },
    // The rule's own door, open whether or not the tool was asked for. A caller holding this
    // capability reclaims through exactly the function the tool calls: one implementation, so the
    // two cannot refuse differently or write different records.
    reclaim: async (options) => reclaimTask(own, {
      task: options.task,
      ...options.team === void 0 || options.team === null ? {} : { team: options.team },
      timeoutMs: reclaimTimeoutMs,
      now: options.at ?? Date.now(),
      ...options.reason === void 0 || options.reason === null ? {} : { reason: options.reason }
    }),
    // R183: our own facade, and the sentence that has to hold with it — not the kernel's service
    // broker, not an RPC provider (TODO.md:70). The two calls read the ledger the caller hands over
    // and nothing else: no file is opened, no clock is read, no socket is touched.
    broker: {
      keys: (state, now, options) => brokerKeys(state, now, options),
      call: (state, key, now, options) => {
        const result = brokerCall(state, key, now, options);
        lastBrokerCode = result.code;
        return result;
      },
      get lastCode() {
        return lastBrokerCode;
      }
    },
    relayTo,
    relay: {
      get bound() {
        return relayState.bound;
      },
      get path() {
        return relayState.path;
      },
      get accepted() {
        return relayState.accepted;
      },
      get refused() {
        return relayState.refused;
      },
      get lastCode() {
        return relayState.lastCode;
      }
    },
    status: {
      get bound() {
        return statusRouteBound;
      },
      path: STATUS_PATH,
      get served() {
        return statusCounts.served;
      },
      get refused() {
        return statusCounts.refused;
      },
      get lastError() {
        return statusCounts.lastError;
      },
      read: readStatus
    },
    // R505: the shadow's fixed diagnostics shape (empty under the default engine).
    computeShadow: {
      get diagnostics() {
        return computeShadowDiagnostics();
      }
    },
    recorded: recorder.counts,
    diagnostics: recorder.diagnostics,
    retry: {
      enabled: retryEnabled,
      get timerInstalled() {
        return retryTimer !== null;
      },
      everyMs: retryEveryMs,
      run: retryRun,
      get counts() {
        return { ...retryCounts };
      },
      /** How many passes in a row have written nothing. */
      get idle() {
        return retryIdle;
      },
      /** The delay already scheduled, or null when nothing is pending. */
      get nextDelayMs() {
        return retryNextDelay;
      },
      get lastError() {
        return retryLastError;
      },
      get lastReason() {
        return retryLastReason;
      }
    }
  };
  if (context.provide !== void 0) context.provide("linkCollab", capability);
  const statusHandler = (req, res) => {
    const answer2 = (status, text) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(text);
    };
    if (req.method !== void 0 && req.method !== "GET" && req.method !== "HEAD") {
      statusCounts.refused += 1;
      statusCounts.lastError = "method " + req.method + " is not GET";
      answer2(405, JSON.stringify({ ok: false, error: { code: "STATUS_READ_ONLY", message: "this route answers GET only" } }));
      return;
    }
    try {
      answer2(200, JSON.stringify({ ...readStatus(), computeShadow: computeShadowDiagnostics() }));
      statusCounts.served += 1;
    } catch (error) {
      const message = String(error?.message ?? error);
      statusCounts.refused += 1;
      statusCounts.lastError = message;
      answer2(500, JSON.stringify({ ok: false, error: { code: "STATUS_UNREADABLE", message } }));
    }
  };
  if (context.inject !== void 0) {
    context.inject.call(context, ["webServer"], (scoped) => {
      const server = scoped.get?.("webServer");
      if (server?.register === void 0) return;
      context.effect?.(() => server.register({ kind: "exact", path: STATUS_PATH, handler: statusHandler }));
      statusRouteBound = true;
      console.log("[dsh-link-collab] status route bound on " + STATUS_PATH);
    });
  }
  if (context.effect !== void 0) {
    const teardown = () => {
      if (process.env.DSH_LINK_COLLAB_TRACE_TEARDOWN !== void 0) {
        console.log("[dsh-link-collab] teardown" + String.fromCharCode(10) + String(new Error("teardown").stack ?? ""));
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
        retryNextDelay = null;
      }
      recorder.dispose();
      const armedWorker = activeFoldWorker();
      if (armedWorker !== null) {
        activateFoldWorker(null);
        void armedWorker.close();
      }
      if (foldSettings().checkpoint) {
        for (const log of live) {
          try {
            saveFoldCheckpoint(log);
          } catch {
          }
        }
      }
      for (const log of live) {
        disposeFoldLog(log);
        void log.close();
      }
      live.clear();
    };
    context.effect(attackFlag("DSH_LINK_COLLAB_LEGACY_EFFECT") ? teardown : () => teardown);
  }
  {
    context.effect(() => installSubagentFacts(context, own, { localTeamId: config.subagentFacts?.localTeamId ?? null }));
    console.log("[dsh-link-collab] subagent facts subscribed (parent read from the child session header)");
    context.effect(() => {
      const listener = (session, event) => {
        if (event === null || event === void 0 || event.type !== "subagent/catalog") return;
        const raw = session !== null && session !== void 0 && typeof session.id === "string" ? session.id : "";
        if (raw === "") return;
        const parent = raw.startsWith("session-") ? raw : "session-" + raw;
        void recordSubagentCatalog(own, event.data, parent).then((result) => {
          if (result.appended) {
            console.log("[dsh-link-collab] catalog fact: " + result.record.subject + " is a child of " + parent);
          }
        }).catch((error) => {
          console.log("[dsh-link-collab] catalog fact rejected: " + (error instanceof Error ? error.message : String(error)));
        });
      };
      const dispose = context.on("session/event", listener);
      console.log("[dsh-link-collab] subagent catalog subscribed (parent = the session that appended it)");
      return typeof dispose === "function" ? dispose : () => {
      };
    });
  }
  console.log("[dsh-link-collab] control channel ready under " + own.directory);
}
var index_default = { name, apply };
function readSubagentChild(info) {
  const value = info;
  const id = value === null || value === void 0 || typeof value !== "object" ? void 0 : value.id;
  if (typeof id !== "string" || id === "") {
    throw new TypeError("subagent fact: the event carries no child session id; refusing to record a nameless team instead of skipping it");
  }
  return id;
}
function subagentTeamRecord(info, parentTeamId) {
  return teamRecord(readSubagentChild(info), parentTeamId, parentTeamId === null ? void 0 : parentTeamId);
}
var factKey = (record) => JSON.stringify({ kind: record.kind, subject: record.subject, payload: record.payload });
function contestedParentOf(log, subject, incomingParent) {
  let firstDifferent = null;
  let sawDifferent = false;
  for (const existing of log.replay()) {
    if (existing.kind !== TEAM_KIND || existing.subject !== subject) continue;
    const payload = existing.payload;
    const raw = payload === void 0 ? void 0 : payload.parent;
    const knownParent = typeof raw === "string" ? raw : null;
    if (knownParent === incomingParent) return { contested: false, knownParent, incomingParent };
    if (!sawDifferent) {
      firstDifferent = knownParent;
      sawDifferent = true;
    }
  }
  return { contested: sawDifferent, knownParent: sawDifferent ? firstDifferent : null, incomingParent };
}
async function recordSubagentStart(log, info, parentTeamId) {
  const record = subagentTeamRecord(info, parentTeamId);
  const contested = contestedParentOf(log, record.subject, parentTeamId);
  const wanted = factKey(record);
  for (const existing of log.replay()) {
    if (factKey(existing) === wanted) return { appended: false, reason: "already-recorded", record, contested };
  }
  await log.append(record);
  return { appended: true, reason: "ok", record, contested };
}
function subagentCatalogRecord(info, parentTeamId) {
  const value = info;
  const childId = value === null || value === void 0 || typeof value !== "object" ? void 0 : value.childId;
  if (typeof childId !== "string" || childId === "") {
    throw new TypeError("subagent catalog fact: the event carries no childId; refusing to record a nameless team instead of skipping it");
  }
  return teamRecord(childId, parentTeamId);
}
async function recordSubagentCatalog(log, info, parentTeamId) {
  const record = subagentCatalogRecord(info, parentTeamId);
  const contested = contestedParentOf(log, record.subject, parentTeamId);
  const wanted = factKey(record);
  for (const existing of log.replay()) {
    if (factKey(existing) === wanted) return { appended: false, reason: "already-recorded", record, contested };
  }
  await log.append(record);
  return { appended: true, reason: "ok", record, contested };
}
function subagentCatalogEventRecord(event, parentTeamId) {
  if (event?.name !== "subagent/catalog") {
    throw new TypeError("subagent catalog fact: expected a subagent/catalog event, received " + String(JSON.stringify(event?.name)));
  }
  return subagentCatalogRecord(event.data, parentTeamId);
}
function installSubagentFacts(ctx, log, options) {
  if (typeof ctx?.on !== "function") {
    throw new TypeError("installSubagentFacts: the context exposes no event surface; refusing to install a subscription that would observe nothing");
  }
  const report = options.onError ?? ((error) => {
    ctx.logger?.warn?.("dsh-link-collab: subagent fact rejected: " + error.message);
    throw error;
  });
  const announce = (message) => {
    if (typeof ctx.logger?.warn === "function") {
      ctx.logger.warn(message);
      return;
    }
    console.log("[dsh-link-collab] " + message);
  };
  const parentOfChild = (childId) => {
    if (options.localTeamId !== null) return options.localTeamId;
    let parent = null;
    const readFrom = (registry) => {
      const value = registry;
      const entry = value?.get?.(childId);
      const parentSession = entry?.session?.header?.parentSession ?? entry?.header?.parentSession;
      if (typeof parentSession === "string" && parentSession !== "") parent = parentSession;
    };
    try {
      ctx.inject?.(["sessions"], (scoped) => {
        readFrom(scoped.get?.("sessions"));
      });
      if (parent === null) ctx.inject?.(["agents"], (scoped) => {
        readFrom(scoped.get?.("agents"));
      });
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)));
    }
    return parent;
  };
  const listener = (info) => {
    try {
      const shape = info;
      const keys = shape === null || typeof shape !== "object" ? String(shape) : Object.keys(shape).join(",");
      const probe = shape === null || typeof shape !== "object" ? "" : " id=" + String(shape.id) + " parentSession=" + String(shape.parentSession) + " sessionId=" + String(shape.sessionId);
      console.log("[dsh-link-collab] subagent/start event keys=" + keys + probe);
    } catch (error) {
    }
    let parentTeamId = options.localTeamId;
    try {
      parentTeamId = parentOfChild(readSubagentChild(info));
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    void recordSubagentStart(log, info, parentTeamId).then((result) => {
      if (result.contested?.contested !== true) return;
      announce("subagent fact: the same subject arrived with two parents - " + result.record.subject + " is on record under " + String(JSON.stringify(result.contested.knownParent)) + " and arrived under " + String(JSON.stringify(result.contested.incomingParent)) + "; both facts are in the ledger and the fold decides which parent holds");
    }).catch((error) => {
      report(error instanceof Error ? error : new Error(String(error)));
    });
  };
  const dispose = ctx.on("subagent/start", listener);
  return typeof dispose === "function" ? dispose : () => {
  };
}
export {
  ADAPTER_KIND,
  CAPABILITY_KIND,
  CONTROL_PAGE_MAX,
  DECLARE_TOOL_NAMES,
  DISPATCH_KIND,
  DeclareRefusal,
  FOLD_ACCUMULATOR_VERSION,
  FOLD_CHECKPOINT_ACC_FILE,
  FOLD_CHECKPOINT_FILE,
  FOLD_CHECKPOINT_FORMAT,
  FOLD_CHECKPOINT_STATE_FILE,
  FOLD_CHECKPOINT_VERSION,
  FOLD_DROPPED_KINDS,
  HANDOFF_KIND,
  HEARTBEAT_KIND,
  HOST_KIND,
  LEDGER_STAMP_FILE,
  LEDGER_STAMP_FORMAT,
  LEDGER_STAMP_VERSION,
  LOCK_KIND,
  MANIFEST_KIND,
  MANIFEST_PROTOCOLS,
  MCP_PROTOCOL_VERSION,
  MERGE_KIND,
  MERGE_TOOL_NAMES,
  MESSAGE_KIND,
  ManifestRefusal,
  MergeRefusal,
  PEER_KIND,
  PEER_REQUEST_MAX,
  PEER_TOOL_NAMES,
  PeerRefusal,
  QUARANTINE_KIND,
  RECLAIM_DEFAULT_TTL_MS,
  RECLAIM_RULE,
  RECLAIM_TOOL_NAME,
  RESULT_KIND,
  RETRY_LEASE_KIND,
  ReclaimRefusal,
  RelayError,
  SESSION_KIND,
  SUPPORTED_PROTOCOLS,
  TEAM_EVENT_KINDS,
  TEAM_KIND,
  TURN_KIND,
  acceptResult,
  activateFoldWorker,
  activeFoldWorker,
  adapterRecord,
  addLedgerDigests,
  admitAdapter,
  ancestorsOf,
  answerFoldQuery,
  appendManifest,
  appendRedispatches,
  appendResult,
  appendTurn,
  apply,
  arbitrateTeamParents,
  assignThrough,
  boardKey,
  boardTasksNamed,
  brokerCall,
  brokerKeys,
  capabilitiesOf,
  capabilityRecord,
  checkpointViaWorker,
  claimable,
  configureFold,
  contestedParentOf,
  continuations,
  controlPage,
  createLocalTools,
  createMcpClient,
  createRelayEndpoint,
  declaringTools,
  decodeFoldAccumulator,
  index_default as default,
  descendantsOf,
  dispatchRecord,
  disposeFoldLog,
  effectiveCapabilities,
  emptyTeamFold,
  encodeFoldAccumulator,
  executeDispatches,
  expiredDispatches,
  finishTeamFold,
  foldAccumulatorOf,
  foldAfterQueries,
  foldClaim,
  foldDiagnostics,
  foldReading,
  foldReadingOf,
  foldResumeFrame,
  foldResumeSafety,
  foldSettings,
  foldStateOf,
  foldTeamRecords,
  heartbeatRecord,
  hostRecord,
  inFlightReadings,
  installDeclaringTools,
  installMcpTools,
  installSubagentFacts,
  isIsolated,
  isQuarantined,
  ledgerLineDigest,
  ledgerRecordDigest,
  ledgerStampChecksum,
  ledgerTextDigest,
  livenessOf,
  loadFoldCheckpoint,
  lockHolder,
  lockRecord,
  manifestRecord,
  mayContinue,
  mayExchange,
  mayMerge,
  mayWrite,
  mcpCall,
  mcpDispatchOutcome,
  mcpInitialize,
  mcpToolRecords,
  mcpTools,
  membersWith,
  mergeRecord,
  mergeTools,
  name,
  openControlLog,
  pathOf,
  peerRecord,
  peerTools,
  pendingRequests,
  projectAdapters,
  projectBoard,
  projectDispatches,
  projectHosting,
  projectLiveness,
  projectLocks,
  projectManifests,
  projectMerges,
  projectPeers,
  projectQuarantine,
  projectRegistry,
  projectRetryLeases,
  projectSessions,
  projectTaskDemands,
  projectTeamState,
  projectTeams,
  quarantineRecord,
  readLedgerView,
  readSubagentChild,
  readySet,
  reclaimReading,
  reclaimTask,
  reclaimTaskRecord,
  reclaimTools,
  reclaimVerdict,
  reclaimable,
  recordSubagentCatalog,
  recordSubagentStart,
  recordTeamEvents,
  recoverable,
  redispatchPlan,
  resetFoldDiagnostics,
  resolveDispatch,
  resultRecord,
  retryDelay,
  retryLeaseRecord,
  retryOwner,
  rootsOf,
  routeFailures,
  routes,
  saveFoldCheckpoint,
  sessionClaim,
  sessionHandoff,
  sessionOwner,
  startFoldWorker,
  subagentCatalogEventRecord,
  subagentCatalogRecord,
  subagentTeamRecord,
  subtractLedgerDigests,
  teamEventToRecord,
  teamRecord,
  turnRecord,
  writeFoldCheckpoint
};
