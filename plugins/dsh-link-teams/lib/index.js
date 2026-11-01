// plugins/dsh-link-teams/src/index.ts
import { createHash } from "node:crypto";

// plugins/dsh-link-teams/src/world.ts
var FIXTURE_ID = /^(?:gate-|g\d+-witness-|r1\d\d-|r2\d\d-)/i;
function isFixtureId(value) {
  return typeof value === "string" && FIXTURE_ID.test(value);
}
function record(value) {
  return value !== null && typeof value === "object" ? value : {};
}
function text(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function teamNode(id, declared, activity, withheldParent) {
  const node = declared ?? {};
  return {
    id,
    // A parent that was withheld from the world is not published: naming it would put a fixture id back
    // into the answer. The node is reported as an orphan instead (see `orphans` below).
    parent: withheldParent ? null : text(node.parent),
    lead: text(node.lead),
    seq: typeof node.seq === "number" ? node.seq : null,
    contested: node.contested === true,
    losers: Array.isArray(node.losers) ? node.losers : [],
    /** Whether a `team/state` row declares this team. */
    declared: declared !== void 0,
    /** Whether a task or member row names this team (the only view of a team that never declared itself). */
    observed: activity !== void 0,
    /** How many task rows name this team. */
    tasks: activity === void 0 ? 0 : activity.tasks,
    /** How many member rows name this team. */
    members: activity === void 0 ? 0 : activity.members
  };
}
function composeWorld(state) {
  const fold = record(state);
  const tree = record(fold.teams);
  const declaredNodes = Array.isArray(tree.teams) ? tree.teams : [];
  const tasks = Array.isArray(fold.tasks) ? fold.tasks : [];
  const members = Array.isArray(fold.members) ? fold.members : [];
  const declared = /* @__PURE__ */ new Map();
  for (const node of declaredNodes) {
    const id = record(node).id;
    if (typeof id === "string" && id !== "") declared.set(id, node);
  }
  const activity = /* @__PURE__ */ new Map();
  const touch = (team, field) => {
    if (typeof team !== "string" || team === "") return;
    const row2 = activity.get(team) ?? { tasks: 0, members: 0 };
    row2[field] += 1;
    activity.set(team, row2);
  };
  for (const task of tasks) touch(record(task).team, "tasks");
  for (const member of members) touch(record(member).team, "members");
  const ids = [.../* @__PURE__ */ new Set([...declared.keys(), ...activity.keys()])].sort();
  const withheldIds = new Set(ids.filter(isFixtureId));
  const served = ids.filter((id) => withheldIds.has(id) === false);
  const nodes = served.map((id) => {
    const node = declared.get(id);
    const parent = text(record(node).parent);
    return teamNode(id, node, activity.get(id), parent !== null && withheldIds.has(parent));
  });
  const byId = new Set(nodes.map((node) => node.id));
  const children = {};
  const roots = [];
  const orphans = [];
  for (const node of nodes) {
    if (node.parent !== null) {
      if (byId.has(node.parent)) {
        children[node.parent] = [...children[node.parent] ?? [], node.id];
        continue;
      }
      orphans.push(node.id);
      roots.push(node.id);
      continue;
    }
    const declaredParent = text(record(declared.get(node.id)).parent);
    if (declaredParent !== null && byId.has(declaredParent) === false) orphans.push(node.id);
    roots.push(node.id);
  }
  for (const key of Object.keys(children)) children[key].sort();
  const cycles = (Array.isArray(tree.cycles) ? tree.cycles : []).filter((cycle) => {
    const one = record(cycle);
    const loop = Array.isArray(one.loop) ? one.loop : [];
    const edge = Array.isArray(one.edge) ? one.edge : [];
    return [...loop, ...edge].every((id) => typeof id !== "string" || byId.has(id) && withheldIds.has(id) === false);
  });
  const counts = record(fold.counts);
  return {
    teams: {
      teams: nodes,
      children,
      roots,
      orphans,
      cycles,
      declared: declared.size,
      named: typeof counts.teams === "number" ? counts.teams : activity.size,
      observed: nodes.filter((node) => node.observed).length,
      withheld: withheldIds.size
    },
    counts: { ...counts, teams: nodes.length }
  };
}
function fixtureCensus(state, records) {
  const fold = record(state);
  const tasks = Array.isArray(fold.tasks) ? fold.tasks : [];
  const members = Array.isArray(fold.members) ? fold.members : [];
  const stream = Array.isArray(records) ? records : [];
  const isFixtureRow = (row2) => {
    const one = record(row2);
    const payload = record(one.payload);
    return [one.actor, one.subject, one.id, one.team, one.name, payload.id, payload.name, payload.senderId, payload.targetId].some(isFixtureId);
  };
  return {
    tasks: tasks.filter(isFixtureRow).length,
    members: members.filter(isFixtureRow).length,
    records: stream.filter(isFixtureRow).length
  };
}

// plugins/dsh-link-teams/src/index.ts
var name = "dsh-link-teams";
var inject = [];
var DEFAULT_PATH = "/api/dsh-link-teams/state";
var TITLE_PATH = "/api/dsh-link-teams/session-title";
var DEFAULT_STREAM_LIMIT = 40;
function sendJson(res, status, body, etag = null) {
  const text2 = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (typeof etag === "string") res.setHeader("etag", etag);
  res.end(text2);
}
function fixtureFieldOf(record2) {
  const payload = record2 !== null && typeof record2 === "object" ? record2.payload : null;
  const fields = payload !== null && typeof payload === "object" ? payload : {};
  const candidates = [
    ["actor", record2?.actor],
    ["subject", record2?.subject],
    ["payload.id", fields.id],
    ["payload.name", fields.name],
    ["payload.senderId", fields.senderId],
    ["payload.targetId", fields.targetId]
  ];
  const named = candidates.find(([, value]) => isFixtureId(value));
  return named === void 0 ? null : named[0];
}
function row(record2) {
  const payload = record2 !== null && typeof record2 === "object" ? record2.payload : null;
  const fields = payload !== null && typeof payload === "object" ? payload : {};
  const fixture = fixtureFieldOf(record2);
  return {
    seq: record2?.seq ?? null,
    kind: record2?.kind ?? null,
    actor: record2?.actor ?? null,
    subject: record2?.subject ?? null,
    at: record2?.at ?? null,
    id: fields.id ?? null,
    state: fields.state ?? null,
    title: fields.title ?? null,
    name: fields.name ?? null,
    senderId: fields.senderId ?? null,
    targetId: fields.targetId ?? null,
    // R196: the row is served (the ledger holds it) and it says whether the name it carries belongs to
    // a test world. Hiding the row would lie about the file; drawing it like live work would lie about
    // the world. This flag is the third option. R377 adds WHICH field named it.
    fixture: fixture !== null,
    fixtureBy: fixture
  };
}
function apply(ctx, config = {}) {
  const settings = config ?? {};
  const path = typeof settings.path === "string" && settings.path.startsWith("/") ? settings.path : DEFAULT_PATH;
  const streamLimit = Number.isInteger(settings.streamLimit) && settings.streamLimit > 0 ? settings.streamLimit : DEFAULT_STREAM_LIMIT;
  const disposers = [];
  let served = 0;
  let refused = 0;
  let lastError = null;
  function snapshot(options = {}) {
    const collab = ctx.get("linkCollab");
    if (collab === void 0 || collab === null) {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: "NO_CAPABILITY",
            message: "the linkCollab capability is not mounted in this profile, so there is no ledger to read"
          }
        }
      };
    }
    if (typeof collab.state !== "function") {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: "NO_STATE_READER",
            message: "linkCollab is mounted but publishes no state() reader; this surface refuses to guess a shape"
          }
        }
      };
    }
    const log = collab.log;
    if (log === void 0 || log === null || typeof log.replay !== "function") {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: "NO_CONTROL_LOG",
            message: "linkCollab publishes no control log handle, so the stream cannot be read"
          }
        }
      };
    }
    const state = collab.state();
    const records = log.replay();
    const world = composeWorld(state);
    const from = Math.max(0, records.length - streamLimit);
    const body = {
      ok: true,
      at: Date.now(),
      path,
      ledger: {
        directory: typeof log.directory === "string" ? log.directory : null,
        writer: log.writer ?? null,
        instance: log.instance ?? null,
        lastSeq: typeof log.lastSeq === "number" ? log.lastSeq : null,
        records: records.length,
        damage: log.damage ?? null
      },
      // The world's counts: `teams` is the number of nodes in the tree served below, never a second
      // notion of "how many teams" (`src/world.ts`).
      counts: world.counts,
      through: state.through ?? null,
      teams: world.teams,
      // The ledger view: the rows the fold holds, each flagged when it carries a fixture name.
      // R344 (perf, measured in RESEARCH-RUST-PERF): every task/member row carried its FULL `losers` history, so the
      // served document grew with the number of write CONFLICTS rather than with the number of entities - 5.12 MB and
      // 41.6 ms of JSON per 2 s poll at L=128k in the research bench. The pane reads `losers` only off the team TREE
      // nodes (world.ts:88), never off these flat rows, so the rows now carry the COUNT and the history stays in the
      // ledger where a diagnosis would look for it.
      // R377: the flag and the FIELD that raised it travel together here too, for the same reason as in `row`.
      tasks: Array.isArray(state.tasks) ? state.tasks.map((task) => {
        const { losers, ...rest } = task ?? {};
        const by = isFixtureId(task?.team) ? "team" : isFixtureId(task?.id) ? "id" : null;
        return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by };
      }) : [],
      members: Array.isArray(state.members) ? state.members.map((member) => {
        const { losers, ...rest } = member ?? {};
        const by = isFixtureId(member?.team) ? "team" : isFixtureId(member?.id) ? "id" : null;
        return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by };
      }) : [],
      registry: state.registry ?? null,
      liveness: state.liveness ?? null,
      peers: state.peers ?? null,
      board: state.board ?? null,
      // R181: the isolation facts the reclaimer writes (member/quarantine rows). They were folded but
      // never served, so a reader of this route could watch a task be taken away from a silent owner and
      // still not learn that the owner was set aside - the fault-isolation half of the round was
      // invisible. Optional like every other fold field: a ledger with no isolation yields null, never a
      // missing key, so a pane can tell "nobody is quarantined" from "this build does not say".
      quarantine: state.quarantine ?? null,
      // How many rows on this answer carry a fixture name. Counts, never ids: the ids are withheld from
      // the world (see `teams.withheld`) and the ledger view is not allowed to reintroduce them as names.
      // R344: the census describes what is ON SCREEN (this page of the stream), not the whole ledger - the pane line
      // says "N fixture rows are on screen", and scanning every record on every 2 s poll was the other half of the cost.
      fixtures: fixtureCensus(state, records.slice(from)),
      stream: records.slice(from).map(row),
      served: served + 1
    };
    if (options.view === "structure") {
      return {
        status: 200,
        body: {
          ok: true,
          at: body.at,
          through: body.through,
          counts: body.counts,
          teams: body.teams,
          members: body.members
        }
      };
    }
    return { status: 200, body };
  }
  async function handler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        refused += 1;
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "dsh-link-teams state is read-only: GET is the only verb, and " + String(req.method) + " was refused"
          }
        });
        return;
      }
      const url = new URL(String(req.url ?? ""), "http://127.0.0.1");
      const answer = snapshot({ view: url.searchParams.get("view") === "structure" ? "structure" : "full" });
      if (answer.status === 200) served += 1;
      else refused += 1;
      const text2 = JSON.stringify(answer.body);
      const stable = JSON.stringify({ ...answer.body, at: 0, served: 0 });
      const etag = '"' + createHash("sha1").update(stable).digest("hex") + '"';
      if (req.method === "GET" && String(req.headers?.["if-none-match"] ?? "") === etag) {
        res.statusCode = 304;
        res.setHeader("etag", etag);
        res.setHeader("cache-control", "no-store");
        res.end();
        return;
      }
      sendJson(res, answer.status, answer.body, etag);
    } catch (error) {
      refused += 1;
      lastError = String(error?.message ?? error);
      sendJson(res, 500, { ok: false, error: { code: "SNAPSHOT_FAILED", message: lastError } });
    }
  }
  function kernelHome() {
    try {
      const collab = ctx.get("linkCollab");
      const directory = collab?.log?.directory;
      if (typeof directory !== "string" || directory === "") return null;
      return directory.replace(/[\\/]collab[\\/]?$/, "");
    } catch (error) {
      return null;
    }
  }
  async function titleHandler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "session-title is read-only" } });
        return;
      }
      const url = new URL(String(req.url ?? ""), "http://127.0.0.1");
      const many = url.searchParams.get("ids");
      if (typeof many === "string" && many !== "") {
        const wanted = many.split(",").map((part) => part.trim()).filter((part) => /^(session-)?[0-9a-f-]{36}$/i.test(part)).slice(0, 60);
        const home2 = kernelHome();
        if (home2 === null) {
          sendJson(res, 503, { ok: false, error: { code: "NO_HOME", message: "the control log names no home directory" } });
          return;
        }
        const { readFile: readFile2 } = await import("node:fs/promises");
        const { join: join2 } = await import("node:path");
        const titles = {};
        for (const part of wanted) {
          const id2 = /^session-/i.test(part) ? part : "session-" + part;
          try {
            const text3 = await readFile2(join2(home2, "storages", "session_projcache", "sessions", id2 + ".json"), "utf8");
            const value = JSON.parse(text3)?.record?.rows?.title?.val;
            titles[id2] = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "";
          } catch (error) {
            titles[id2] = "";
          }
        }
        sendJson(res, 200, { ok: true, titles });
        return;
      }
      const raw = url.searchParams.get("id") ?? "";
      const id = /^session-[0-9a-f-]{36}$/i.test(raw) ? raw : /^[0-9a-f-]{36}$/i.test(raw) ? "session-" + raw : "";
      if (id === "") {
        sendJson(res, 400, { ok: false, error: { code: "BAD_ID", message: "id must be a session id" } });
        return;
      }
      const home = kernelHome();
      if (home === null) {
        sendJson(res, 503, { ok: false, error: { code: "NO_HOME", message: "the control log names no home directory" } });
        return;
      }
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let text2 = null;
      try {
        text2 = await readFile(join(home, "storages", "session_projcache", "sessions", id + ".json"), "utf8");
      } catch (error) {
        sendJson(res, 404, { ok: false, error: { code: "NO_SESSION", message: "no projection cache for " + id } });
        return;
      }
      let title = "";
      try {
        const doc = JSON.parse(text2);
        const value = doc?.record?.rows?.title?.val;
        title = typeof value === "string" ? value : "";
      } catch (error) {
        title = "";
      }
      sendJson(res, 200, { ok: true, id, title: title.replace(/\s+/g, " ").trim().slice(0, 60) });
    } catch (error) {
      lastError = String(error?.message ?? error);
      sendJson(res, 500, { ok: false, error: { code: "TITLE_FAILED", message: lastError } });
    }
  }
  const route = { kind: "exact", path, handler };
  const titleRoute = { kind: "exact", path: TITLE_PATH, handler: titleHandler };
  let bound = false;
  function registerRoute() {
    if (bound) return;
    const server = ctx.get("webServer");
    if (server === void 0 || server === null || typeof server.register !== "function") return;
    try {
      disposers.push(server.register(route));
      disposers.push(server.register(titleRoute));
      bound = true;
      console.log("[dsh-link-teams] state route bound on " + path + " (GET, read-only)");
      console.log("[dsh-link-teams] session-title route bound on " + TITLE_PATH + " (GET, read-only)");
    } catch (error) {
      console.error("[dsh-link-teams] could not bind the state route: " + String(error?.message ?? error));
    }
  }
  registerRoute();
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], () => registerRoute());
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
      "dsh-link-teams: state route"
    );
  }
  console.log("[dsh-link-teams] ready \u2014 read-only team surface, ledger via linkCollab" + (bound ? "" : " (route pending webServer)"));
}
var index_default = { name, inject, apply };
export {
  apply,
  index_default as default,
  inject,
  name
};
