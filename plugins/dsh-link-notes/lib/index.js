// plugins/dsh-link-notes/src/index.ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { foldClaim, openControlLog } from "../../dsh-link-collab/lib/index.js";
var name = "dsh-link-notes";
var inject = ["tools", "systemPrompt"];
var NOTE_KIND = "note/state";
var OPEN = "open";
var DELETED = "deleted";
var REFUSALS = Object.freeze({
  /** The arguments are not usable: a missing, empty, unknown or wrongly typed field. */
  INPUT: "NOTES_INPUT",
  /** One note body is longer than maxChars code points. */
  TOO_LONG: "NOTES_TOO_LONG",
  /** The ledger already holds maxNotes live notes. */
  FULL: "NOTES_FULL"
});
var DEFAULT_MAX_NOTES = 200;
var DEFAULT_MAX_CHARS = 100;
var SECTION_NAME = "notes:ledger";
var SECTION_ORDER = 700;
var LIST_TOOL = "notes_list";
var ADD_TOOL = "notes_add";
var NOTES_ROUTE_PATH = "/api/dsh-link-notes/state";
var NOTES_ADD_ROUTE_PATH = "/api/dsh-link-notes/add";
var ROUTE_AUTHOR = "user";
var METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
function noteRecord(id, text, tags, state, author) {
  if (typeof id !== "string" || id === "") throw new TypeError("noteRecord: id must be a non-empty string");
  if (typeof text !== "string") throw new TypeError("noteRecord: text must be a string");
  if (typeof state !== "string" || state === "") throw new TypeError("noteRecord: state must be a non-empty string");
  if (typeof author !== "string" || author === "") throw new TypeError("noteRecord: author must be a non-empty string");
  return { kind: NOTE_KIND, subject: id, payload: { id, text, tags: normaliseTags(tags), state, author } };
}
function normaliseTags(tags) {
  if (!Array.isArray(tags)) return [];
  const usable = tags.filter((tag) => typeof tag === "string" && tag !== "");
  return [...new Set(usable)].sort();
}
var byAtThenSeq = (left, right) => left.at === right.at ? left.seq - right.seq : left.at - right.at;
function projectNotes(records) {
  const notes = /* @__PURE__ */ new Map();
  let malformed = 0;
  for (const record of [...records].sort((left, right) => left.seq - right.seq)) {
    if (record.kind !== NOTE_KIND) continue;
    const payload = record.payload;
    const id = typeof payload?.id === "string" && payload.id !== "" ? payload.id : typeof record.subject === "string" && record.subject !== "" ? record.subject : null;
    if (id === null || typeof payload?.text !== "string") {
      malformed += 1;
      continue;
    }
    const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0;
    const incoming = {
      text: payload.text,
      tags: normaliseTags(payload?.tags),
      state: typeof payload?.state === "string" && payload.state !== "" ? payload.state : OPEN,
      author: typeof payload?.author === "string" && payload.author !== "" ? payload.author : "",
      at,
      seq: record.seq,
      writer: record.actor ?? null
    };
    const previous = notes.get(id);
    if (previous === void 0) {
      notes.set(id, { id, text: incoming.text, tags: incoming.tags, state: incoming.state, author: incoming.author, at: incoming.at, seq: incoming.seq, resolvedBy: "seq", contested: false, losers: [] });
      continue;
    }
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: incoming.at, seq: incoming.seq });
    const winner = folded.incomingWins ? incoming : { text: previous.text, tags: previous.tags, state: previous.state, author: previous.author, at: previous.at, seq: previous.seq, writer: null };
    const loser = folded.incomingWins ? { text: previous.text, tags: previous.tags, state: previous.state, author: previous.author, at: previous.at, seq: previous.seq, writer: null } : incoming;
    const disagrees = loser.text !== winner.text || loser.state !== winner.state || loser.author !== winner.author || loser.tags.join("\0") !== winner.tags.join("\0");
    notes.set(id, {
      id,
      text: winner.text,
      tags: winner.tags,
      state: winner.state,
      author: winner.author,
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? "at" : "seq",
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers
    });
  }
  const ordered = [...notes.values()].sort(byAtThenSeq);
  const byTag = {};
  for (const note of ordered) {
    if (note.state === DELETED) continue;
    for (const tag of note.tags) (byTag[tag] ??= []).push(note.id);
  }
  return {
    notes: ordered,
    byTag,
    counts: {
      notes: ordered.length,
      open: ordered.filter((note) => note.state === OPEN).length,
      done: ordered.filter((note) => note.state !== OPEN && note.state !== DELETED).length,
      deleted: ordered.filter((note) => note.state === DELETED).length,
      malformed
    }
  };
}
function openNotes(state) {
  return state.notes.filter((note) => note.state === OPEN);
}
function notesWithTag(state, tag) {
  const ids = new Set(state.byTag[tag] ?? []);
  return state.notes.filter((note) => ids.has(note.id));
}
function searchNotes(state, text) {
  const needle = typeof text === "string" ? text.toLowerCase() : "";
  return state.notes.filter((note) => note.state !== DELETED && note.text.toLowerCase().includes(needle));
}
function liveNotes(state) {
  const rows = Array.isArray(state?.notes) ? state.notes : [];
  return rows.filter((note) => note !== null && typeof note === "object" && note.state !== DELETED);
}
var SECTION_HEADING = "Notes ledger \u2014 live notes, oldest first:";
var elidedLine = (count) => "\u2026 (+" + String(count) + " older note(s) elided)";
var rowText = (note, maxChars, suffix) => clipCodePoints(typeof note.text === "string" ? note.text : "", maxChars) + suffix;
function limitOr(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
function clipCodePoints(text, maxChars) {
  const points = Array.from(text);
  if (points.length <= maxChars) return text;
  return points.slice(0, maxChars - 1).join("") + "\u2026";
}
function renderNotesSection(state, limits) {
  const maxNotes = limitOr(limits?.maxNotes, DEFAULT_MAX_NOTES);
  const maxChars = limitOr(limits?.maxChars, DEFAULT_MAX_CHARS);
  const live = liveNotes(state);
  if (live.length === 0) return "";
  const elided = live.length - Math.min(live.length, maxNotes);
  const lines = [SECTION_HEADING];
  if (elided > 0) lines.push(elidedLine(elided));
  for (const note of live.slice(elided)) lines.push("- " + rowText(note, maxChars, ""));
  return lines.join("\n");
}
function renderNotesDirectory(state) {
  const live = liveNotes(state);
  const counts = state?.counts;
  const deleted = typeof counts?.deleted === "number" ? counts.deleted : 0;
  const malformed = typeof counts?.malformed === "number" ? counts.malformed : 0;
  const head = "Notes ledger: " + String(live.length) + " live note(s), " + String(deleted) + " deleted" + (malformed > 0 ? ", " + String(malformed) + " unreadable record(s)" : "") + ".";
  const rows = live.map((note) => {
    const by = typeof note.author === "string" && note.author !== "" ? " \u2014 by " + note.author : "";
    const tags = Array.isArray(note.tags) && note.tags.length > 0 ? " \u2014 tags: " + note.tags.join(", ") : "";
    return "- " + String(note.id) + " [" + String(note.state) + "] " + rowText(note, Number.MAX_SAFE_INTEGER, by + tags);
  });
  return [head, ...rows].join("\n");
}
function openNotesStore(dir, options) {
  if (typeof dir !== "string" || dir === "") throw new TypeError("openNotesStore: dir must be a non-empty string");
  const log = openControlLog({ dir: join(dir, "notes"), writer: options?.writer ?? "notes" });
  return { dir, log, close: () => log.close() };
}
function readStore(store) {
  return projectNotes(store.log.replay());
}
async function appendNote(store, input, limits) {
  if (typeof input?.text !== "string") throw new TypeError("appendNote: text must be a string");
  if (typeof input?.author !== "string" || input.author === "") throw new TypeError("appendNote: author must be a non-empty string");
  const maxNotes = limitOr(limits?.maxNotes, DEFAULT_MAX_NOTES);
  const maxChars = limitOr(limits?.maxChars, DEFAULT_MAX_CHARS);
  const length = Array.from(input.text).length;
  if (length > maxChars) {
    throw new Error(REFUSALS.TOO_LONG + ": a note body may have at most " + String(maxChars) + " characters and this one has " + String(length) + "; shorten it and append again");
  }
  const held = liveNotes(readStore(store)).length;
  if (held >= maxNotes) {
    throw new Error(REFUSALS.FULL + ": this ledger already holds " + String(held) + " live note(s) and the limit is " + String(maxNotes) + "; nothing was appended");
  }
  const id = input.id === void 0 ? "n-" + randomUUID() : input.id;
  const seq = await store.log.append(noteRecord(id, input.text, input.tags ?? [], OPEN, input.author));
  return { id, seq };
}
async function setNoteState(store, id, state) {
  const note = readStore(store).notes.find((row) => row.id === id);
  if (note === void 0) throw new Error("setNoteState: no note " + JSON.stringify(id) + " in this store");
  const seq = await store.log.append(noteRecord(id, note.text, [...note.tags], state, note.author));
  return { seq };
}
function notesOf(store) {
  return readStore(store);
}
var textBlocks = (text) => [{ type: "text", text }];
var TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => textBlocks(typeof value === "string" ? value : JSON.stringify(value))
};
var TOOL_NAMES = [LIST_TOOL, ADD_TOOL];
function refuseUnknownArguments(tool, args, allowed) {
  if (args === null || typeof args !== "object") return;
  for (const key of Object.keys(args)) {
    if (allowed.includes(key)) continue;
    throw new Error(REFUSALS.INPUT + ": " + tool + " takes " + (allowed.length === 0 ? "no arguments" : allowed.join(", ")) + ', and "' + key + '" is not one of them');
  }
}
function listTool(store) {
  return defineTool({
    name: LIST_TOOL,
    description: "List the notes in the shared ledger: for every note that is not deleted, its id, its state, its body, who wrote it and its tags. Read-only \u2014 it changes nothing, asks nobody, and takes no arguments.",
    parameters: {},
    output: TEXT_OUTPUT,
    execute: (args) => {
      refuseUnknownArguments(LIST_TOOL, args, []);
      return renderNotesDirectory(notesOf(store));
    }
  });
}
var WRITE_FIELDS = Object.freeze(["text", "tags", "author"]);
var AGENT_AUTHOR = "agent";
async function writeOneNote(store, raw, caller, limits) {
  refuseUnknownArguments(caller.who, raw, WRITE_FIELDS);
  const args = raw ?? null;
  const text = args === null ? void 0 : args.text;
  if (typeof text !== "string" || text === "") {
    throw new Error(REFUSALS.INPUT + ": " + caller.who + " needs text: a non-empty string");
  }
  const tags = args.tags;
  if (tags !== void 0 && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) {
    throw new Error(REFUSALS.INPUT + ": tags must be an array of strings when given");
  }
  const author = typeof args.author === "string" && args.author !== "" ? args.author : caller.author;
  const appended = await appendNote(store, { text, tags, author }, limits);
  const state = notesOf(store);
  return { id: appended.id, seq: appended.seq, author, live: liveNotes(state).length, state };
}
function addTool(store, limits) {
  return defineTool({
    name: ADD_TOOL,
    description: "Add one note to the shared ledger, so that it is on disk and in the system prompt from the next step onward. Every call is put to the user for approval first, and a call that cannot be asked is refused and writes nothing. A note body may have at most " + String(limits.maxChars) + " characters, and the ledger admits at most " + String(limits.maxNotes) + " live notes.",
    parameters: {
      text: { type: "string", required: true, description: "The note body: what to remember. At most " + String(limits.maxChars) + " characters." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags. Stored sorted and deduplicated, so one set has one spelling." },
      author: { type: "string", description: 'Who is adding the note. Defaults to "agent".' }
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const written = await writeOneNote(store, args, { who: ADD_TOOL, author: AGENT_AUTHOR }, limits);
      return "added note " + written.id + " (seq " + String(written.seq) + ", author " + written.author + "). The ledger holds " + String(written.live) + " live note(s); the " + SECTION_NAME + " section is now " + String(renderNotesSection(written.state, limits).length) + " character(s), so the next request carries it and the prompt head is written once.";
    }
  });
}
function installTools(ctx, store, limits) {
  const inject2 = ctx.inject;
  if (inject2 === void 0) {
    console.error("[link-notes] this context cannot inject the tools service, so " + TOOL_NAMES.join(" and ") + " are not registered");
    return;
  }
  inject2.call(ctx, ["tools"], (scoped) => {
    const registry = scoped.get?.("tools");
    if (registry === void 0 || typeof registry.register !== "function") {
      console.error("[link-notes] this composition mounts no tool registry, so " + TOOL_NAMES.join(" and ") + " are not registered");
      return;
    }
    for (const definition of [listTool(store), addTool(store, limits)]) {
      const dispose = registry.register(definition);
      ctx.effect(() => dispose);
    }
  });
  ctx.on("tools/pre-execute", (exec, next) => {
    if (exec.name !== ADD_TOOL) return next();
    return { kind: "ask" };
  });
}
var Config = z.object({
  dir: z.string().default(""),
  maxNotes: z.number().default(DEFAULT_MAX_NOTES),
  maxChars: z.number().default(DEFAULT_MAX_CHARS)
});
function ledgerDir(ctx) {
  const provided = ctx.get?.("dshHomePath");
  if (typeof provided === "function") return String(provided("link-notes"));
  return join(process.env.DSH_HOME ?? ".", "link-notes");
}
function configuredLimit(value, fallback, field) {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError("dsh-link-notes: " + field + " must be a positive integer when set (got " + JSON.stringify(value) + ")");
  }
  return value;
}
var MAX_BODY_BYTES = 64 * 1024;
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}
function methodNotAllowed(req, res, noun, allowed) {
  if (typeof req.resume === "function") req.resume();
  res.setHeader("allow", allowed);
  sendJson(res, 405, {
    ok: false,
    error: {
      code: METHOD_NOT_ALLOWED,
      message: noun + " takes " + allowed + " and nothing else, so " + String(req.method) + " was refused"
    }
  });
}
function readBody(req) {
  return new Promise((done) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (error) => {
      done({ problem: "the request body could not be read (" + (error instanceof Error ? error.message : String(error)) + ")" });
    });
    req.on("end", () => {
      if (overflow) done({ problem: "the request body is larger than " + String(MAX_BODY_BYTES) + " bytes" });
      else done({ text: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
var NAMED_REFUSALS = Object.freeze([REFUSALS.INPUT, REFUSALS.TOO_LONG, REFUSALS.FULL]);
var REFUSAL_STATUS = Object.freeze({
  [REFUSALS.INPUT]: 400,
  [REFUSALS.TOO_LONG]: 400,
  [REFUSALS.FULL]: 409
});
function refusalAnswer(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = NAMED_REFUSALS.find((name2) => message.startsWith(name2 + ":")) ?? null;
  return {
    status: code === null ? 500 : REFUSAL_STATUS[code] ?? 500,
    body: { ok: false, error: { code, message } }
  };
}
function installRoutes(ctx, store, limits) {
  const disposers = [];
  let bound = false;
  function stateBody() {
    const state = notesOf(store);
    const live = liveNotes(state);
    return {
      ok: true,
      path: NOTES_ROUTE_PATH,
      readOnly: true,
      // The row's own resolved thresholds, handed in: the same object appendNote refuses with and the
      // section renders with, so no reader can see a limit no writer is held to.
      limits: { maxNotes: limits.maxNotes, maxChars: limits.maxChars },
      // The fold's own counts. "live" is the number the write route answers with, so one question has
      // one number in both answers.
      counts: {
        live: live.length,
        deleted: state.counts.deleted,
        notes: state.counts.notes,
        open: state.counts.open,
        done: state.counts.done,
        malformed: state.counts.malformed
      },
      // The live notes in ledger order. A tombstone is counted above and not listed here: it is a note
      // that was deleted, not a note, and the panel draws what is listed.
      notes: live.map((note) => ({ id: note.id, text: note.text, tags: [...note.tags], state: note.state, author: note.author, at: note.at, seq: note.seq }))
    };
  }
  async function stateHandler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(req, res, "dsh-link-notes state", "GET");
        return;
      }
      sendJson(res, 200, stateBody());
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: { code: "SNAPSHOT_FAILED", message: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  async function addHandler(req, res) {
    if (req.method !== "POST") {
      methodNotAllowed(req, res, "dsh-link-notes add", "POST");
      return;
    }
    const body = await readBody(req);
    if ("problem" in body) {
      const answer = refusalAnswer(new Error(REFUSALS.INPUT + ": " + body.problem));
      sendJson(res, answer.status, answer.body);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch (error) {
      const answer = refusalAnswer(new Error(REFUSALS.INPUT + ": the request body is not JSON (" + (error instanceof Error ? error.message : String(error)) + '); send {"text": "..."}'));
      sendJson(res, answer.status, answer.body);
      return;
    }
    try {
      const written = await writeOneNote(store, parsed, { who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }, limits);
      sendJson(res, 200, { ok: true, seq: written.seq, notes: written.live });
    } catch (error) {
      const answer = refusalAnswer(error);
      sendJson(res, answer.status, answer.body);
    }
  }
  const routes = [
    { kind: "exact", path: NOTES_ROUTE_PATH, handler: stateHandler },
    { kind: "exact", path: NOTES_ADD_ROUTE_PATH, handler: addHandler }
  ];
  function registerRoutes() {
    if (bound) return;
    const server = ctx.get?.("webServer");
    if (server === null || server === void 0 || typeof server.register !== "function") return;
    try {
      for (const route of routes) disposers.push(server.register(route));
      bound = true;
      console.log("[link-notes] state route bound on " + NOTES_ROUTE_PATH + " (GET, read-only: the fold, the tombstones and the two thresholds)");
      console.log("[link-notes] add route bound on " + NOTES_ADD_ROUTE_PATH + ' (POST, one note per call, author defaults to "' + ROUTE_AUTHOR + '"; the notes_add tool is NOT this path)');
    } catch (error) {
      console.error("[link-notes] could not bind the notes routes: " + (error instanceof Error ? error.message : String(error)));
    }
  }
  registerRoutes();
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], () => registerRoutes());
  }
  if (typeof ctx.effect === "function") {
    ctx.effect(
      () => () => {
        bound = false;
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
          }
        }
      },
      "dsh-link-notes: routes"
    );
  }
}
function apply(ctx, config = { dir: "" }) {
  const dir = config.dir === "" || config.dir === void 0 ? ledgerDir(ctx) : config.dir;
  const limits = {
    maxNotes: configuredLimit(config.maxNotes, DEFAULT_MAX_NOTES, "maxNotes"),
    maxChars: configuredLimit(config.maxChars, DEFAULT_MAX_CHARS, "maxChars")
  };
  const store = openNotesStore(dir, { writer: "host" });
  ctx.provide("linkNotes", store);
  ctx.effect(() => () => store.close());
  const prompt = ctx.systemPrompt;
  if (prompt === void 0 || typeof prompt.section !== "function") {
    throw new Error("dsh-link-notes: this composition mounts no systemPrompt service, so the " + SECTION_NAME + " section cannot be registered");
  }
  prompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    interpolate: false,
    text: () => renderNotesSection(notesOf(store), limits)
  });
  installTools(ctx, store, limits);
  installRoutes(ctx, store, limits);
  console.log("[link-notes] ready \u2014 " + String(openNotes(notesOf(store)).length) + " open note(s) at " + dir + "; section " + SECTION_NAME + " order " + String(SECTION_ORDER) + "; limits " + String(limits.maxNotes) + " live note(s), " + String(limits.maxChars) + " character(s) each");
}
export {
  ADD_TOOL,
  Config,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_NOTES,
  DELETED,
  LIST_TOOL,
  METHOD_NOT_ALLOWED,
  NOTES_ADD_ROUTE_PATH,
  NOTES_ROUTE_PATH,
  NOTE_KIND,
  OPEN,
  REFUSALS,
  ROUTE_AUTHOR,
  SECTION_NAME,
  SECTION_ORDER,
  appendNote,
  apply,
  inject,
  liveNotes,
  name,
  noteRecord,
  notesOf,
  notesWithTag,
  openNotes,
  openNotesStore,
  projectNotes,
  renderNotesDirectory,
  renderNotesSection,
  searchNotes,
  setNoteState
};
