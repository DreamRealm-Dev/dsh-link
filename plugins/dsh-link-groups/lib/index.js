// plugins/dsh-link-groups/src/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import { scopeOf } from "@deepseek-ai/dsh-scope";
var name = "dsh-link-groups";
var inject = ["tools", "systemPrompt"];
var CATALOG_TOOL = "tool_groups";
var DECLARE_TOOL = "tool_groups_declare";
var REFUSALS = Object.freeze({
  /** The argument object, or one of its list fields, has the wrong type. */
  INPUT: "GROUPS_INPUT",
  /** A group id is not in the catalog; the known ids travel back with the refusal. */
  UNKNOWN: "GROUPS_UNKNOWN",
  /** The same id appears in both `open` and `close`. */
  DUP: "GROUPS_DUP",
  /** A group configured `state: 'off'` was declared open without an approval. */
  OFF: "GROUPS_OFF",
  /** An `auto.when: 'after'` group whose dependency is not open. */
  DEPENDENCY: "GROUPS_DEPENDENCY",
  /** A group whose declared tool names reach no layer its agent can call. */
  NO_TOOLS: "GROUPS_NO_TOOLS",
  /** No agent scope is reachable, so no restriction could be applied. */
  CHANNEL: "GROUPS_CHANNEL",
  /** The catalog tool takes no arguments. */
  CATALOG: "GROUPS_CATALOG",
  /** An activation tool would collide with a tool already resolving for that agent. */
  COLLISION: "GROUPS_COLLISION"
});
var EFFECTIVE = "next-step";
var SERVICE = "linkGroups";
var SEAM_REFUSALS = Object.freeze({
  /** The definition is not `{ id, title, members, autoWhen? }` with usable values. */
  INPUT: "LINK_GROUPS_INPUT",
  /** The id already belongs to a config group or to another contributed group. */
  DUPLICATE: "LINK_GROUPS_DUPLICATE_GROUP"
});
var STATES = ["on", "off", "auto"];
var WHEN = ["declare", "device", "after"];
function resolveConfig(config) {
  const source = config === void 0 || config === null ? {} : config;
  const rawGroups = source.groups === void 0 || source.groups === null ? [] : source.groups;
  if (!Array.isArray(rawGroups)) throw new TypeError("dsh-link-groups: config.groups must be an array of group entries");
  const groups = rawGroups.map((entry, index) => resolveGroup(entry, index));
  const ids = /* @__PURE__ */ new Set();
  for (const group of groups) {
    if (ids.has(group.id)) throw new TypeError('dsh-link-groups: duplicate group id "' + group.id + '"');
    ids.add(group.id);
  }
  return {
    groups,
    catalogPreamble: typeof source.catalogPreamble === "string" && source.catalogPreamble.length > 0 ? source.catalogPreamble : "Tools are organised in groups. A closed group costs nothing: call " + CATALOG_TOOL + " to read the directory, then " + DECLARE_TOOL + " to open or close several groups in one call.",
    deferredNotice: source.deferredNotice !== false,
    logProviderWarnings: source.logProviderWarnings !== false
  };
}
function resolveGroup(entry, index) {
  const where = "config.groups[" + String(index) + "]";
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("dsh-link-groups: " + where + " must be an object");
  const id = entry.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) {
    throw new TypeError("dsh-link-groups: " + where + ".id must be a non-empty lower-case identifier (letters, digits, dot, dash, underscore)");
  }
  const tools = entry.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.some((tool) => typeof tool !== "string" || tool.length === 0)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" needs a non-empty `tools` array of tool names; the membership is written down because no package manifest carries a tool list');
  }
  const state = entry.state === void 0 ? "off" : entry.state;
  if (typeof state !== "string" || !STATES.includes(state)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" state must be one of ' + STATES.join("|"));
  }
  return {
    id,
    title: typeof entry.title === "string" && entry.title.length > 0 ? entry.title : id,
    summary: typeof entry.summary === "string" ? entry.summary : "",
    tools: [...tools],
    provider: typeof entry.provider === "string" && entry.provider.length > 0 ? entry.provider : void 0,
    state,
    auto: resolveAuto(entry.auto, id),
    userDisabled: entry.userDisabled === true,
    relockable: entry.relockable === true
  };
}
function resolveAuto(input, id) {
  if (input === void 0 || input === null) return void 0;
  if (typeof input !== "object" || Array.isArray(input)) throw new TypeError('dsh-link-groups: group "' + id + '" auto must be an object');
  const when = input.when;
  if (typeof when !== "string" || !WHEN.includes(when)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" auto.when must be one of ' + WHEN.join("|"));
  }
  const condition = when;
  if (condition !== "after") return { when: condition };
  if (typeof input.after !== "string" || input.after.length === 0) {
    throw new TypeError('dsh-link-groups: group "' + id + '" auto.when "after" needs auto.after naming the group it depends on');
  }
  if (input.after === id) throw new TypeError('dsh-link-groups: group "' + id + '" cannot depend on itself');
  return { when: "after", after: input.after };
}
function initialOpen(group) {
  return group.state === "on";
}
function initialState(config) {
  const open = {};
  for (const group of config.groups) open[group.id] = initialOpen(group);
  return { open, slides: [] };
}
function toolInstalled(toolName, baseline, globalNames) {
  return baseline.has(toolName) || globalNames.has(toolName);
}
function installationFor(group, visible, restrictable) {
  const resolvedTools = [];
  const missing = [];
  for (const toolName of group.tools) {
    if (toolInstalled(toolName, visible, restrictable)) resolvedTools.push(toolName);
    else missing.push(toolName);
  }
  return { resolved: resolvedTools, missing, unrestrictable: [] };
}
function blockedReason(group, state, installation, known) {
  if (installation.unrestrictable.length > 0) {
    return {
      code: REFUSALS.NO_TOOLS,
      reason: "registered on the agent own layer, which a restriction cannot filter: " + installation.unrestrictable.join(", ")
    };
  }
  if (installation.missing.length > 0) {
    return {
      code: REFUSALS.NO_TOOLS,
      reason: "declared tool" + (installation.missing.length > 1 ? "s" : "") + " registered on no layer this agent can call: " + installation.missing.join(", ")
    };
  }
  const auto = group.auto;
  if (auto !== void 0 && auto.when === "after") {
    const dependency = auto.after;
    if (!known.has(dependency)) return { code: REFUSALS.DEPENDENCY, reason: "the group it depends on is not in the catalog: " + dependency };
    if (state.open[dependency] !== true) return { code: REFUSALS.DEPENDENCY, reason: 'depends on group "' + dependency + '", which is not open' };
  }
  return void 0;
}
function needsApproval(group) {
  return group.userDisabled || group.state === "off";
}
function approvalNeeded(ids, config) {
  const wanted = new Set(ids);
  return config.groups.filter((group) => wanted.has(group.id) && needsApproval(group)).map((group) => group.id);
}
function projectCatalog(config, state, installations) {
  const known = new Set(config.groups.map((group) => group.id));
  const rows = config.groups.map((group) => {
    const installation = installations[group.id];
    const blocked = blockedReason(group, state, installation, known);
    const open = state.open[group.id] === true;
    return {
      id: group.id,
      title: group.title,
      summary: group.summary,
      state: group.state,
      open,
      tools: [...installation.resolved],
      openable: blocked === void 0 && open !== true,
      needsApproval: needsApproval(group),
      relockable: group.relockable,
      broken: installation.unrestrictable.length > 0 || installation.missing.length > 0,
      ...blocked === void 0 ? {} : { reason: blocked.code + ": " + blocked.reason },
      ...group.auto === void 0 ? {} : autoLabel(group.auto),
      ...group.provider === void 0 ? {} : { provider: group.provider }
    };
  });
  return { rows, openCount: rows.filter((row) => row.open).length };
}
function autoLabel(auto) {
  return auto.when === "after" ? { auto: "after " + String(auto.after) } : { auto: auto.when };
}
function foldSurface(events) {
  const headers = [];
  const additions = [];
  for (const raw of events) {
    if (raw === null || typeof raw !== "object") continue;
    const event = raw;
    if (event.type === "request/header") {
      const data = event.data === null || typeof event.data !== "object" ? {} : event.data;
      const header = data.header === null || typeof data.header !== "object" ? {} : data.header;
      const tools = Array.isArray(header.tools) ? header.tools : [];
      headers.push({
        reason: String(data.reason === void 0 ? "" : data.reason),
        startsSeries: data.startsSeries === true,
        names: tools.map((tool) => String(tool === null || typeof tool !== "object" ? "" : tool.name))
      });
    } else if (event.type === "developer/message") {
      const data = event.data === null || typeof event.data !== "object" ? {} : event.data;
      const message = data.message === null || typeof data.message !== "object" ? {} : data.message;
      const content = Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        if (block === null || typeof block !== "object") continue;
        const addition = block;
        if (addition.type === "tool-addition") additions.push(String(addition.toolName));
      }
    }
  }
  return { headers, additions };
}
function measureCost(schemas, header, changeCount) {
  return {
    entries: schemas.length,
    bytes: Buffer.byteLength(JSON.stringify(schemas), "utf8"),
    startsSeries: header !== void 0 && header.startsSeries === true,
    ...header === void 0 ? {} : { headerReason: header.reason },
    headerChanges: changeCount
  };
}
function textContent(text) {
  return [{ type: "text", text }];
}
function textOutput() {
  return {
    schema: { type: "string" },
    render: (_args, value) => textContent(typeof value === "string" ? value : JSON.stringify(value))
  };
}
function renderRow(row) {
  const parts = ["- " + row.id];
  parts.push(row.open ? "OPEN" : "closed");
  parts.push("state=" + row.state);
  if (row.auto !== void 0) parts.push("auto=" + row.auto);
  parts.push("tools(" + String(row.tools.length) + "): " + (row.tools.length === 0 ? "(none)" : row.tools.join(", ")));
  if (row.provider !== void 0) parts.push("provider=" + row.provider);
  if (row.needsApproval) parts.push("USER-DISABLED: opening needs approval");
  if (row.relockable) parts.push("relockable");
  if (row.reason !== void 0) parts.push("blocked: " + row.reason);
  else if (!row.open) parts.push("openable now");
  if (row.summary.length > 0) parts.push(row.summary);
  return parts.join(" \xB7 ");
}
function renderCatalog(config, catalog) {
  const lines = [config.catalogPreamble, ""];
  lines.push("Groups (" + String(catalog.rows.length) + " total, " + String(catalog.openCount) + " open):");
  for (const row of catalog.rows) lines.push(renderRow(row));
  const openable = catalog.rows.filter((row) => row.openable === true);
  if (openable.length > 0) {
    lines.push("");
    lines.push("Openable in one call: " + openable.map((row) => row.id).join(", "));
    lines.push("Call " + DECLARE_TOOL + " with open: [...] \u2014 one call opens every group you name, and the change lands on your next step, never on this one.");
  }
  if (config.deferredNotice) {
    lines.push("");
    lines.push("The directory describes THIS session surface. Group state is process-local: after a restart or resume the groups fall back to their configured state and must be declared again.");
  }
  return lines.join("\n");
}
function renderDeclaration(result) {
  const lines = [];
  for (const entry of result.applied) {
    const cost = entry.cost;
    const direction = entry.to === "open" ? "opened" : "closed";
    lines.push("- " + direction + " " + entry.id + " (effective: " + entry.effective + ") \xB7 surface now " + String(cost.entries) + " tools / " + String(cost.bytes) + " bytes \xB7 next request/header.startsSeries=" + String(cost.startsSeries));
  }
  for (const entry of result.pendingApproval) lines.push("- not applied " + entry.id + ": " + entry.reason);
  for (const entry of result.refused) lines.push("- refused " + entry.id + " [" + entry.code + "] " + entry.reason);
  if (lines.length === 0) lines.push("- nothing changed");
  if (result.known.length > 0) lines.push("Known group ids (configuration order): " + result.known.join(", "));
  return lines.join("\n");
}
function callDisposer(dispose) {
  try {
    dispose();
  } catch (_error) {
  }
}
function namedIds(open, close) {
  const seen = /* @__PURE__ */ new Set();
  const ids = [];
  for (const id of [...open, ...close]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
function validateDeclare(args, config, state, installations) {
  const knownList = config.groups.map((group) => group.id);
  const known = new Set(knownList);
  const refuse = (id, code, reason) => ({ id, code, reason });
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse("", REFUSALS.INPUT, "arguments must be an object with optional open/close string arrays")] };
  }
  const source = args;
  const rawOpen = source.open === void 0 || source.open === null ? [] : source.open;
  const rawClose = source.close === void 0 || source.close === null ? [] : source.close;
  if (!Array.isArray(rawOpen) || rawOpen.some((id) => typeof id !== "string") || !Array.isArray(rawClose) || rawClose.some((id) => typeof id !== "string")) {
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse("", REFUSALS.INPUT, "open and close must be arrays of group id strings")] };
  }
  const named = namedIds(rawOpen, rawClose);
  if (named.length === 0) {
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse("", REFUSALS.INPUT, "nothing to do: name at least one group in open or close")] };
  }
  const refused = [];
  const wanted = /* @__PURE__ */ new Set();
  const wantedClose = /* @__PURE__ */ new Set();
  for (const id of named) {
    if (!known.has(id)) {
      refused.push(refuse(id, REFUSALS.UNKNOWN, "unknown group id; known ids: " + (knownList.join(", ") || "(none)")));
      continue;
    }
    const inOpen = rawOpen.includes(id);
    const inClose = rawClose.includes(id);
    if (inOpen && inClose) {
      refused.push(refuse(id, REFUSALS.DUP, "named in both open and close"));
      continue;
    }
    const group = config.groups.find((candidate) => candidate.id === id);
    if (inOpen) {
      if (state.open[id] === true) {
        refused.push(refuse(id, REFUSALS.INPUT, "already open"));
        continue;
      }
      const blocked = blockedReason(group, state, installations[id], known);
      if (blocked !== void 0) {
        refused.push(refuse(id, blocked.code, blocked.reason));
        continue;
      }
      wanted.add(id);
      continue;
    }
    if (state.open[id] !== true) {
      refused.push(refuse(id, REFUSALS.INPUT, "already closed"));
      continue;
    }
    if (group.relockable !== true) {
      refused.push(refuse(id, REFUSALS.INPUT, "not relockable: it stays open for the rest of the session so published tool names keep their positions"));
      continue;
    }
    wantedClose.add(id);
  }
  return { ok: true, known: knownList, open: [...wanted], close: [...wantedClose], refused };
}
function resolveDefinition(definition) {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ": registerGroup(definition) needs an object { id, title, members, autoWhen? }");
  }
  const source = definition;
  const id = source.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ": registerGroup(definition).id must be a non-empty lower-case identifier (letters, digits, dot, dash, underscore), the same rule config.groups follows");
  }
  const members = source.members;
  if (!Array.isArray(members) || members.length === 0 || members.some((member) => typeof member !== "string" || member.length === 0)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" needs a non-empty `members` array of tool names; the membership is written down because no package manifest carries a tool list');
  }
  return {
    id,
    title: typeof source.title === "string" && source.title.length > 0 ? source.title : id,
    summary: "",
    tools: [...members],
    provider: void 0,
    state: "auto",
    auto: resolveDefinitionAuto(source.autoWhen, id),
    userDisabled: false,
    relockable: false
  };
}
function resolveDefinitionAuto(input, id) {
  if (input === void 0 || input === null) return { when: "declare" };
  const value = typeof input === "string" ? { when: input } : input;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen must be one of ' + WHEN.join("|") + " or an object { when, after }");
  }
  const source = value;
  const when = source.when;
  if (typeof when !== "string" || !WHEN.includes(when)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen must be one of ' + WHEN.join("|"));
  }
  const condition = when;
  if (condition !== "after") return { when: condition };
  if (typeof source.after !== "string" || source.after.length === 0) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen "after" needs autoWhen.after naming the group it depends on');
  }
  if (source.after === id) throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" cannot depend on itself');
  return { when: "after", after: source.after };
}
function definitionRow(group, origin) {
  return {
    id: group.id,
    title: group.title,
    origin,
    state: group.state,
    members: [...group.tools],
    autoWhen: group.auto === void 0 ? void 0 : { ...group.auto }
  };
}
function createSeam(resolved, installed) {
  const contributed = /* @__PURE__ */ new Map();
  const merged = { ...resolved, groups: [...resolved.groups] };
  const groups = () => [
    ...resolved.groups.map((group) => definitionRow(group, "config")),
    ...[...contributed.values()].map((group) => definitionRow(group, "contributed"))
  ];
  const registerGroup = (definition) => {
    const group = resolveDefinition(definition);
    const home = resolved.groups.some((candidate) => candidate.id === group.id) ? "config" : contributed.has(group.id) ? "contributed" : void 0;
    if (home !== void 0) {
      throw new Error(SEAM_REFUSALS.DUPLICATE + ': group id "' + group.id + '" already belongs to a ' + home + " group; ids are unique across the config row and every contributed group, and a silent merge is refused rather than performed");
    }
    contributed.set(group.id, group);
    merged.groups.push(group);
    const admitted = [];
    try {
      for (const record of installed.values()) {
        record.admit(group);
        admitted.push(record);
      }
    } catch (error) {
      for (const record of admitted) record.retract(group.id);
      merged.groups.splice(merged.groups.indexOf(group), 1);
      contributed.delete(group.id);
      throw error;
    }
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      contributed.delete(group.id);
      const at = merged.groups.indexOf(group);
      if (at !== -1) merged.groups.splice(at, 1);
      for (const record of installed.values()) record.retract(group.id);
    };
  };
  return { merged, groups, registerGroup };
}
function installAgent(ctx, agent, resolved) {
  const scope = agent.ctx;
  const scopeKey = scopeOf(scope);
  if (scopeKey === void 0) {
    return { code: REFUSALS.CHANNEL, reason: "tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent" };
  }
  const activate = scope.tools;
  if (activate === void 0 || typeof activate.register !== "function") {
    return { code: REFUSALS.CHANNEL, reason: "the agent scope resolves no tool registry, so no activation tool could be registered on it" };
  }
  const globalNames = new Set(ctx.tools.schemas().map((tool) => tool.name));
  const baseline = /* @__PURE__ */ new Set([...globalNames, ...activate.schemas(scopeKey).map((tool) => tool.name)]);
  const state = initialState(resolved);
  const restrictions = /* @__PURE__ */ new Map();
  const installations = {};
  for (const group of resolved.groups) installations[group.id] = installationFor(group, baseline, globalNames);
  const disposers = [];
  const record = { scopeKey, scope, resolveState: state, installations, restrictions, disposers, ready: false };
  const disposed = { value: false };
  const lift = (id) => {
    const dispose = restrictions.get(id);
    if (dispose === void 0) return;
    restrictions.delete(id);
    callDisposer(dispose);
  };
  const mask = (id) => {
    if (restrictions.has(id)) return;
    const wanted = installations[id].resolved;
    if (wanted.length === 0) return;
    try {
      restrictions.set(id, activate.restrict({ deny: wanted }));
    } catch (error) {
      restrictions.delete(id);
      if (disposed.value) return;
      throw error;
    }
  };
  const sync = (id) => {
    if (state.open[id] === true) lift(id);
    else mask(id);
  };
  const visible = () => activate.schemas(scopeKey);
  const nextHeader = () => {
    const session = agent.session;
    if (session === void 0 || typeof session.eventAt !== "function") return void 0;
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      const event = session.eventAt(seq);
      if (event !== void 0 && event.type === "request/header") return event.data;
    }
    return void 0;
  };
  const headerChanges = () => {
    const session = agent.session;
    if (session === void 0 || typeof session.eventAt !== "function") return 0;
    let count = 0;
    for (let seq = 0; seq < session.seq; seq += 1) {
      const event = session.eventAt(seq);
      if (event === void 0 || event.type !== "request/header") continue;
      const data = event.data === null || typeof event.data !== "object" ? {} : event.data;
      if (data.reason === "change") count += 1;
    }
    return count;
  };
  const cost = () => measureCost(visible(), nextHeader(), headerChanges());
  const declare = async (args, approved) => {
    const validation = validateDeclare(args, resolved, state, installations);
    const result = { applied: [], refused: [...validation.refused], pendingApproval: [], known: validation.known };
    if (!validation.ok) return result;
    const gated = approvalNeeded(validation.open, resolved);
    const plain = validation.open.filter((id) => !gated.includes(id));
    const openable = approved === true ? [...plain, ...gated] : plain;
    if (approved !== true) {
      for (const id of gated) {
        result.pendingApproval.push({ id, reason: "the user turned this group off, so it opens only after an approval; nothing changed" });
      }
    }
    for (const id of openable) {
      state.open[id] = true;
      sync(id);
    }
    if (openable.length > 0) {
      const slide = cost();
      for (const id of openable) {
        state.slides.push({ id, to: "open", source: "declare", cost: slide });
        result.applied.push({ id, to: "open", effective: EFFECTIVE, cost: slide });
      }
    }
    for (const id of validation.close) {
      state.open[id] = false;
      sync(id);
      const slide = cost();
      state.slides.push({ id, to: "closed", source: "declare", cost: slide });
      result.applied.push({ id, to: "closed", effective: EFFECTIVE, cost: slide });
    }
    return result;
  };
  const catalogTool = defineTool({
    name: CATALOG_TOOL,
    description: "List the tool groups of this session: each group id, whether it is open, its configured state, the tool names it would add, and \u2014 when it cannot be opened \u2014 the reason. Use it before declaring a group you have not seen and whenever you are unsure which of your tools are present. It takes no arguments and changes nothing.",
    parameters: {},
    output: textOutput(),
    // The registry awaits execute(), so an async body is runtime-equivalent to the sync one this
    // replaces (see docs/handoff/R498-strict-migration.md, artifact note).
    execute: async (args) => {
      if (args !== void 0 && args !== null && typeof args === "object" && Object.keys(args).length > 0) {
        throw new Error(REFUSALS.CATALOG + ": " + CATALOG_TOOL + " takes no arguments; it only reports the directory");
      }
      return renderCatalog(resolved, projectCatalog(resolved, state, installations));
    }
  });
  const declareTool = defineTool({
    name: DECLARE_TOOL,
    description: "Open or close one or more tool groups in a single call. Opening a group makes its tools available from your NEXT step onward \u2014 never in the step that declares them \u2014 so name everything you need in one call instead of one group at a time. A group the user explicitly disabled asks for approval first. Pass open: [ids] to open, close: [ids] to re-close a relockable group, and why: a short reason. Returns what was applied, what was refused and why, and the measured cost of the change.",
    parameters: {
      open: { type: "array", items: { type: "string" }, description: "Group ids to open." },
      close: { type: "array", items: { type: "string" }, description: "Group ids to close again; a group configured relockable false refuses." },
      why: { type: "string", description: "Optional one-line reason, recorded for the reader and passed to an approval prompt." }
    },
    output: textOutput(),
    execute: async (args, exec) => {
      const approved = takeApproval(exec.agent, String(exec.callId));
      return renderDeclaration(await declare(args === void 0 ? {} : args, approved));
    }
  });
  for (const tool of [catalogTool, declareTool]) {
    if (activate.get(tool.name, scopeKey) !== void 0) {
      return { code: REFUSALS.COLLISION, reason: 'tool "' + tool.name + '" already resolves for this agent, so the activation tool could not be registered on its own layer' };
    }
  }
  for (const group of resolved.groups) {
    if (state.open[group.id] === true) lift(group.id);
    else mask(group.id);
  }
  record.disposers.push(activate.register(catalogTool));
  record.disposers.push(activate.register(declareTool));
  record.sync = sync;
  record.cost = cost;
  record.admit = (group) => {
    const restrictable = new Set(ctx.tools.schemas().map((tool) => tool.name));
    const visibleNow = /* @__PURE__ */ new Set([...restrictable, ...activate.schemas(scopeKey).map((tool) => tool.name)]);
    installations[group.id] = installationFor(group, visibleNow, restrictable);
    state.open[group.id] = initialOpen(group);
    try {
      sync(group.id);
    } catch (_error) {
      installations[group.id] = { resolved: [], missing: [], unrestrictable: [...installations[group.id].resolved] };
    }
  };
  record.retract = (id) => {
    lift(id);
    delete state.open[id];
    delete installations[id];
  };
  record.dispose = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const id of [...restrictions.keys()]) lift(id);
    for (const dispose of record.disposers.reverse()) callDisposer(dispose);
    record.disposers.length = 0;
    install.ready = false;
  };
  record.ready = true;
  return record;
}
function mountAgent(ctx, agent, config) {
  return installAgent(ctx, agent, config);
}
var autoOpenRecords = /* @__PURE__ */ new WeakMap();
var recordsByAgent = /* @__PURE__ */ new WeakMap();
var pendingOpens = /* @__PURE__ */ new WeakMap();
function autoOpenRecordFor(ctx, agent) {
  if (agent !== void 0) {
    const byAgent = recordsByAgent.get(agent);
    if (byAgent !== void 0) return byAgent;
  }
  let cursor = ctx;
  const seen = /* @__PURE__ */ new Set();
  while (cursor !== void 0 && !seen.has(cursor)) {
    seen.add(cursor);
    const record = autoOpenRecords.get(cursor);
    if (record !== void 0) return record;
    cursor = cursor.fiber.parent;
  }
  return void 0;
}
function requestAutoOpen(ctx, agent, id, why) {
  const record = autoOpenRecordFor(ctx, agent);
  if (record === void 0) return { applied: false, code: REFUSALS.CHANNEL, reason: "this plugin is not applied on that context, so no group state exists" };
  const install2 = record.installed.get(agent);
  if (install2 === void 0) {
    const queued = pendingOpens.get(agent) ?? [];
    queued.push({ id, why });
    pendingOpens.set(agent, queued);
    return { applied: false, code: REFUSALS.CHANNEL, reason: "that agent has no group installation yet; the condition was queued and replays when it appears" };
  }
  const group = record.config.groups.find((candidate) => candidate.id === id);
  if (group === void 0) {
    return { applied: false, code: REFUSALS.UNKNOWN, reason: "unknown group id; known ids: " + record.config.groups.map((candidate) => candidate.id).join(", ") };
  }
  const state = install2.resolveState;
  if (state.open[id] === true) return { applied: false, code: REFUSALS.INPUT, reason: "already open" };
  if (group.userDisabled) return { applied: false, code: REFUSALS.OFF, reason: "the user turned this group off; only an explicit declaration with approval may open it" };
  const known = new Set(record.config.groups.map((candidate) => candidate.id));
  const blocked = blockedReason(group, state, install2.installations[id], known);
  if (blocked !== void 0) return { applied: false, code: blocked.code, reason: blocked.reason };
  state.open[id] = true;
  install2.sync(id);
  const slide = install2.cost();
  state.slides.push({ id, to: "open", source: why === void 0 ? "auto" : String(why), cost: slide });
  return { applied: true, id, to: "open", effective: EFFECTIVE, cost: slide };
}
var approvals = /* @__PURE__ */ new WeakMap();
function takeApproval(agent, callId) {
  const granted = approvals.get(agent);
  if (granted === void 0 || !granted.has(callId)) return false;
  granted.delete(callId);
  if (granted.size === 0) approvals.delete(agent);
  return true;
}
function isRefusal(outcome) {
  return outcome.code !== void 0;
}
function apply(ctx, rawConfig = {}) {
  const resolved = resolveConfig(rawConfig);
  const installed = /* @__PURE__ */ new Map();
  const seam = createSeam(resolved, installed);
  const merged = seam.merged;
  if (resolved.logProviderWarnings) {
    for (const group of resolved.groups) {
      if (group.provider === void 0) continue;
      if (group.tools.some((toolName) => toolName.startsWith(String(group.provider)))) continue;
      ctx.logger?.warn?.('dsh-link-groups: group "' + group.id + '" declares provider "' + group.provider + '" but none of its tools start with it (' + group.tools.join(", ") + "); `provider` is a cross-check only and `tools` stays authoritative");
    }
  }
  console.log("[link-groups] ready \u2014 " + String(resolved.groups.length) + " group(s) configured");
  if (typeof ctx.provide === "function" && ctx.get(SERVICE) === void 0) {
    try {
      ctx.provide(SERVICE, { registerGroup: seam.registerGroup, groups: seam.groups });
    } catch (error) {
      ctx.logger?.warn?.('dsh-link-groups: the service "' + SERVICE + '" could not be provided [LINK_GROUPS_SERVICE_TAKEN] ' + (error instanceof Error ? error.message : String(error)) + "; groups registered through this instance reach no agent");
    }
  } else {
    ctx.logger?.warn?.('dsh-link-groups: the service "' + SERVICE + '" is already provided by another page [LINK_GROUPS_SERVICE_TAKEN]; this instance still installs the groups from its own row, but contributed groups reach agents only through the owning instance');
  }
  autoOpenRecords.set(ctx, { config: merged, installed });
  const maybeInstall = () => {
    const agents = ctx.get("agents");
    const live = agents === void 0 ? [] : [...agents.list()];
    for (const agent of live) {
      if (installed.has(agent)) continue;
      const record = installAgent(ctx, agent, merged);
      if (isRefusal(record)) {
        ctx.logger?.warn?.("dsh-link-groups: agent " + String(agent.id) + " not installed [" + record.code + "] " + record.reason);
        continue;
      }
      record.effectDispose = record.scope.effect(() => () => record.dispose(), "dsh-link-groups.agentScope()");
      recordsByAgent.set(agent, { config: merged, installed });
      installed.set(agent, record);
      for (const queued of pendingOpens.get(agent) ?? []) requestAutoOpen(ctx, agent, queued.id, queued.why);
      pendingOpens.delete(agent);
    }
    for (const [agent, record] of [...installed]) {
      if (live.includes(agent)) continue;
      installed.delete(agent);
      recordsByAgent.delete(agent);
      record.dispose();
    }
  };
  maybeInstall();
  ctx.on("agent/created", () => maybeInstall());
  ctx.on("agent/disposed", () => maybeInstall());
  ctx.effect(() => () => {
    for (const record of installed.values()) record.dispose();
    installed.clear();
    autoOpenRecords.delete(ctx);
  }, "dsh-link-groups.installations()");
  ctx.on("tools/pre-execute", async (exec, next) => {
    if (exec.name !== DECLARE_TOOL || exec.agent === void 0) return next();
    const record = installed.get(exec.agent);
    if (record === void 0) return next();
    const validation = validateDeclare(exec.arguments, merged, record.resolveState, record.installations);
    if (!validation.ok) return next();
    const gated = approvalNeeded(validation.open, merged);
    if (gated.length === 0) return next();
    const off = gated.filter((id2) => merged.groups.find((group) => group.id === id2).state === "off" && !merged.groups.find((group) => group.id === id2).userDisabled);
    if (off.length > 0) {
      return { kind: "deny", reason: REFUSALS.OFF + ": the user turned this group off, so a declaration cannot open it: " + off.join(", ") };
    }
    const id = String(exec.callId);
    const granted = approvals.get(exec.agent);
    if (granted === void 0) approvals.set(exec.agent, /* @__PURE__ */ new Set([id]));
    else granted.add(id);
    const why = exec.arguments !== null && typeof exec.arguments === "object" && typeof exec.arguments.why === "string" ? String(exec.arguments.why) : "";
    const extra = why.length > 0 ? " (" + why + ")" : "";
    return {
      kind: "ask",
      reason: "opening user-disabled tool group" + (gated.length > 1 ? "s" : "") + " " + gated.join(", ") + extra + " \u2014 the user turned them off, so they are never opened silently. Without an available answer this declaration changes nothing.",
      displayReason: { en: "Open tool group: " + gated.join(", ") }
    };
  });
}
export {
  CATALOG_TOOL,
  DECLARE_TOOL,
  EFFECTIVE,
  REFUSALS,
  SEAM_REFUSALS,
  SERVICE,
  apply,
  approvalNeeded,
  blockedReason,
  createSeam,
  definitionRow,
  foldSurface,
  initialOpen,
  initialState,
  inject,
  measureCost,
  mountAgent,
  name,
  needsApproval,
  projectCatalog,
  renderCatalog,
  renderDeclaration,
  requestAutoOpen,
  resolveConfig,
  resolveDefinition,
  toolInstalled,
  validateDeclare
};
