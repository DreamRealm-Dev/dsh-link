// plugins/dsh-link-upgrade/src/index.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, mkdirSync, readdirSync as readdirSync2, readFileSync as readFileSync2, renameSync, rmSync, statSync as statSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join as join2 } from "node:path";

// compat/kernel-range.ts
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var UNSUPPORTED_TOKENS = [">", "<", "="];
function parseRange(text) {
  const comparators = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === " " || char === "	") {
      at += 1;
      continue;
    }
    if (text.startsWith("||", at)) {
      at += 2;
      continue;
    }
    if (UNSUPPORTED_TOKENS.includes(char)) {
      return { ok: false, reason: "unsupported-syntax", index: at, token: char };
    }
    let end = at;
    while (end < text.length && text[end] !== " " && text[end] !== "	" && !text.startsWith("||", end)) end += 1;
    const raw = text.slice(at, end);
    const parsed = parseComparator(raw, at);
    if (parsed.ok === false) return parsed;
    comparators.push(parsed.comparator);
    at = end;
  }
  return { ok: true, comparators };
}
function parseComparator(raw, offset) {
  const bad = UNSUPPORTED_TOKENS.find((token) => raw.includes(token));
  if (bad !== void 0) return { ok: false, reason: "unsupported-syntax", index: offset + raw.indexOf(bad), token: bad };
  let op = "exact";
  let body = raw;
  if (body.startsWith("^")) {
    op = "caret";
    body = body.slice(1);
  } else if (body.startsWith("~")) {
    op = "tilde";
    body = body.slice(1);
  }
  if (body === "*" || body === "") {
    return { ok: true, comparator: { op: "any", parts: [], prerelease: null, raw } };
  }
  const [core, ...rest] = body.split("-");
  const prerelease = rest.length > 0 ? rest.join("-") : null;
  const pieces = core.split(".");
  const parts = [];
  for (const piece of pieces) {
    if (piece === "x" || piece === "X" || piece === "*") break;
    const value = Number(piece);
    if (!Number.isInteger(value) || value < 0 || piece === "") return { ok: true, comparator: { op: "partial", parts, prerelease, raw } };
    parts.push(value);
  }
  if (op === "exact" && parts.length < 3) op = "partial";
  return { ok: true, comparator: { op, parts, prerelease, raw } };
}
function splitVersion(version) {
  const [core, ...rest] = version.split("-");
  const parts = core.split(".").map((piece) => Number(piece)).filter((value) => Number.isInteger(value));
  return { parts, prerelease: rest.length > 0 ? rest.join("-") : null };
}
function comparePrerelease(left, right) {
  const a = left.split(".");
  const b = right.split(".");
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const x = a[at];
    const y = b[at];
    if (x === void 0) return -1;
    if (y === void 0) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function coreCompare(left, right) {
  for (let at = 0; at < 3; at += 1) {
    const a = left[at] ?? 0;
    const b = right[at] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
function versionCompare(left, right) {
  const core = coreCompare(left.parts, right.parts);
  if (core !== 0) return core;
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}
function caretUpper(parts) {
  const first = parts.findIndex((value) => value !== 0);
  if (first === -1) return { parts: [0, 0, (parts[2] ?? 0) + 1], prerelease: null };
  const upper = parts.slice(0, first + 1);
  upper[first] = (upper[first] ?? 0) + 1;
  return { parts: upper, prerelease: null };
}
function tildeUpper(parts) {
  if (parts.length >= 2) return { parts: [parts[0] ?? 0, (parts[1] ?? 0) + 1], prerelease: null };
  return { parts: [(parts[0] ?? 0) + 1], prerelease: null };
}
function comparatorAccepts(comparator, version) {
  if (comparator.op === "any") return true;
  if (comparator.op === "partial") {
    for (let at = 0; at < comparator.parts.length; at += 1) {
      if ((version.parts[at] ?? 0) !== comparator.parts[at]) return false;
    }
    if (comparator.prerelease !== null) {
      return version.prerelease !== null && comparePrerelease(version.prerelease, comparator.prerelease) >= 0;
    }
    return true;
  }
  const lower = { parts: comparator.parts, prerelease: comparator.prerelease };
  const aboveLower = versionCompare(version, lower);
  if (aboveLower < 0) return false;
  if (comparator.op === "exact") {
    return comparator.prerelease === null ? version.prerelease === null : aboveLower > 0 || version.prerelease !== null;
  }
  const upper = comparator.op === "tilde" ? tildeUpper(comparator.parts) : caretUpper(comparator.parts);
  return coreCompare(version.parts, upper.parts) < 0;
}
function satisfiesRange(range, version) {
  const parsed = parseRange(range);
  if (parsed.ok === false) return false;
  const tolerant = range.includes("-") === false;
  const split = splitVersion(version);
  const tested = tolerant && split.prerelease !== null ? { parts: split.parts, prerelease: null } : split;
  const groups = parseGroups(range);
  return groups.some((group) => group.every((comparator) => comparatorAccepts(comparator, tested)));
}
function parseGroups(range) {
  const groups = [[]];
  let at = 0;
  while (at < range.length) {
    const char = range[at];
    if (char === " " || char === "	") {
      at += 1;
      continue;
    }
    if (range.startsWith("||", at)) {
      groups.push([]);
      at += 2;
      continue;
    }
    let end = at;
    while (end < range.length && range[end] !== " " && range[end] !== "	" && !range.startsWith("||", end)) end += 1;
    const raw = range.slice(at, end);
    const parsed = parseComparator(raw, at);
    if (parsed.ok) groups[groups.length - 1].push(parsed.comparator);
    at = end;
  }
  return groups.filter((group) => group.length > 0);
}
function verdictForRange(range, version) {
  if (parseRange(range).ok === false) return "unsupported-syntax";
  return satisfiesRange(range, version) ? "satisfied" : "mismatch";
}
function installedClosureVersions(dir) {
  const found = [];
  const walk = (path, depth) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    if (entries.includes("package.json")) {
      try {
        const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
        if (typeof manifest.name === "string" && typeof manifest.version === "string") {
          found.push({ name: manifest.name, version: manifest.version });
        }
      } catch {
      }
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const child = join(path, entry);
      try {
        if (statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
      }
    }
  };
  walk(dir, 0);
  return found;
}
function kernelVersionFromClosure(closure, name = "@deepseek-ai/dsh") {
  const row = closure.find((entry) => entry.name === name);
  return row === void 0 ? null : row.version;
}
function declaredRange(manifest) {
  const requires = manifest.requires ?? {};
  if (typeof requires.dsh === "string") return { range: requires.dsh, source: "requires.dsh" };
  const engines = manifest.engines ?? {};
  if (typeof engines.dsh === "string") return { range: engines.dsh, source: "engines.dsh" };
  const peers = manifest.peerDependencies ?? {};
  if (typeof peers["@deepseek-ai/dsh"] === "string") return { range: peers["@deepseek-ai/dsh"], source: "peerDependencies[@deepseek-ai/dsh]" };
  return { range: null, source: null };
}
function scanPluginRanges(pluginsDir, kernelVersion) {
  let entries = [];
  try {
    entries = readdirSync(pluginsDir);
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries.sort()) {
    const dir = join(pluginsDir, entry);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const name = typeof manifest.name === "string" ? manifest.name : entry;
    const declared = declaredRange(manifest);
    if (declared.range === null) {
      rows.push({ plugin: name, range: null, source: null, verdict: "no-range" });
      continue;
    }
    const verdict = kernelVersion === null ? "unknown-kernel" : verdictForRange(declared.range, kernelVersion);
    rows.push({ plugin: name, range: declared.range, source: declared.source, verdict });
  }
  return rows;
}
var KERNEL_PACKAGE_NAMES = ["@deepseek-ai/dsh-root", "@deepseek-ai/dsh"];
function resolveKernelVersion(options) {
  const tried = [];
  const isKernelName = (name) => typeof name === "string" && KERNEL_PACKAGE_NAMES.includes(name);
  if (options.closureDir === void 0) {
    tried.push({ source: "closure", ok: false, detail: "no closureDir was given" });
  } else {
    const rows = installedClosureVersions(options.closureDir);
    const hit = rows.find((row) => isKernelName(row.name));
    if (hit !== void 0) {
      tried.push({ source: "closure", ok: true, detail: options.closureDir + " declares " + hit.name + "@" + hit.version });
      return { version: hit.version, source: "closure:" + hit.name, tried };
    }
    tried.push({
      source: "closure",
      ok: false,
      detail: options.closureDir + " listed " + rows.length + " manifest(s), none named " + KERNEL_PACKAGE_NAMES.join(" or ") + (rows.length === 0 ? " (a closure with nothing readable in it resolves to nothing)" : "")
    });
  }
  if (options.kernelRoot === void 0) {
    tried.push({ source: "checkout", ok: false, detail: "no kernelRoot was given" });
  } else {
    const manifest = join(options.kernelRoot, "package.json");
    if (!existsSync(manifest)) {
      tried.push({ source: "checkout", ok: false, detail: manifest + " is not there" });
    } else {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        if (isKernelName(parsed.name) && typeof parsed.version === "string") {
          tried.push({ source: "checkout", ok: true, detail: manifest + " declares " + String(parsed.name) + "@" + parsed.version });
          return { version: parsed.version, source: "checkout", tried };
        }
        tried.push({ source: "checkout", ok: false, detail: manifest + " declares " + String(parsed.name) + ", which is not a kernel package name" });
      } catch (error) {
        tried.push({ source: "checkout", ok: false, detail: manifest + " is not JSON: " + String(error.message) });
      }
    }
  }
  if (options.lockFile === void 0) {
    tried.push({ source: "lock", ok: false, detail: "no lockFile was given" });
  } else if (!existsSync(options.lockFile)) {
    tried.push({ source: "lock", ok: false, detail: options.lockFile + " is not there" });
  } else {
    try {
      const parsed = JSON.parse(readFileSync(options.lockFile, "utf8"));
      if (isKernelName(parsed.packageName) && typeof parsed.packageVersion === "string") {
        tried.push({ source: "lock", ok: true, detail: options.lockFile + " declares " + String(parsed.packageName) + "@" + parsed.packageVersion });
        return { version: parsed.packageVersion, source: "lock", tried };
      }
      tried.push({ source: "lock", ok: false, detail: options.lockFile + " names " + String(parsed.packageName) + ", which is not a kernel package name" });
    } catch (error) {
      tried.push({ source: "lock", ok: false, detail: options.lockFile + " is not JSON: " + String(error.message) });
    }
  }
  return { version: null, source: null, tried };
}

// plugins/dsh-link-upgrade/src/index.ts
var MIGRATIONS_FORMAT = "dsh-link.migrations/1";
var VERSION_FILE = "version.json";
var CONFIG_DIR = "config";
var PLUGINS_FILE = "plugins.json";
var LEDGER_DIR = "ledger";
var LAYOUT_PATHS = [VERSION_FILE, CONFIG_DIR, PLUGINS_FILE, LEDGER_DIR];
var layoutOwned = (relativePath) => LAYOUT_PATHS.some((owned) => relativePath === owned || relativePath.startsWith(owned + "/"));
function readJsonFile(path) {
  const text = readFileSync2(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError("unreadable JSON at " + path + ": " + String(error?.message ?? error));
  }
}
function entriesOf(path) {
  if (!existsSync2(path) || !statSync2(path).isDirectory()) return [];
  return readdirSync2(path).sort();
}
function flattenInto(prefix, value, out) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      out[prefix] = {};
      return;
    }
    for (const [key, nested] of entries) flattenInto(prefix === "" ? key : prefix + "." + key, nested, out);
    return;
  }
  out[prefix] = value;
}
function configFiles(root, prefix = CONFIG_DIR) {
  const out = [];
  for (const name of entriesOf(join2(root, prefix))) {
    const relativePath = prefix + "/" + name;
    if (statSync2(join2(root, relativePath)).isDirectory()) out.push(...configFiles(root, relativePath));
    else if (name.endsWith(".json")) out.push(relativePath);
  }
  return out.sort();
}
function configPrefix(relativePath) {
  const inside = relativePath.slice(CONFIG_DIR.length + 1);
  const withoutExtension = inside.endsWith(".json") ? inside.slice(0, -".json".length) : inside;
  return withoutExtension.split("/").join(".");
}
function readState(root) {
  const versionPath = join2(root, VERSION_FILE);
  if (!existsSync2(versionPath)) throw new TypeError("readState: no " + VERSION_FILE + " under " + root + "; a state without a version is not migrated");
  const version = readJsonFile(versionPath);
  const link = version === null || typeof version.link !== "string" || version.link === "" ? null : version.link;
  const layout = version === null || typeof version.layout !== "number" || !Number.isInteger(version.layout) || version.layout < 1 ? null : version.layout;
  if (link === null) throw new TypeError("readState: " + VERSION_FILE + " carries no usable link version");
  if (layout === null) throw new TypeError("readState: " + VERSION_FILE + " carries no usable layout version (an integer >= 1)");
  const config = {};
  for (const relativePath of configFiles(root)) {
    const parsed = readJsonFile(join2(root, relativePath));
    flattenInto(configPrefix(relativePath), parsed, config);
  }
  const pluginsPath = join2(root, PLUGINS_FILE);
  let plugins = [];
  if (existsSync2(pluginsPath)) {
    const parsed = readJsonFile(pluginsPath);
    if (parsed === null || !Array.isArray(parsed.plugins)) throw new TypeError("readState: " + PLUGINS_FILE + " carries no plugins array");
    plugins = [...new Set(parsed.plugins.filter((name) => typeof name === "string" && name !== ""))].sort();
  }
  const ledger = [];
  const walk = (prefix) => {
    for (const name of entriesOf(join2(root, prefix))) {
      const relativePath = prefix + "/" + name;
      if (statSync2(join2(root, relativePath)).isDirectory()) walk(relativePath);
      else ledger.push(relativePath);
    }
  };
  walk(LEDGER_DIR);
  return { root, link, layout, config, plugins, ledger: ledger.sort() };
}
function hashTree(root) {
  const out = {};
  const walk = (prefix) => {
    for (const name of entriesOf(join2(root, prefix))) {
      const relativePath = (prefix === "" ? "" : prefix + "/") + name;
      const full = join2(root, relativePath);
      if (statSync2(full).isDirectory()) {
        out[relativePath + "/"] = "dir";
        walk(relativePath);
      } else {
        out[relativePath] = createHash("sha256").update(readFileSync2(full)).digest("hex");
      }
    }
  };
  walk("");
  const sorted = {};
  for (const key of Object.keys(out).sort()) sorted[key] = out[key];
  return sorted;
}
function preservedPaths(root) {
  const out = [];
  const walk = (prefix) => {
    for (const name of entriesOf(join2(root, prefix))) {
      const relativePath = (prefix === "" ? "" : prefix + "/") + name;
      if (statSync2(join2(root, relativePath)).isDirectory()) {
        out.push(relativePath);
        walk(relativePath);
      } else out.push(relativePath);
    }
  };
  walk("");
  return out.filter((path) => !layoutOwned(path)).sort();
}
function ledgerHashes(root, files) {
  const out = {};
  for (const relativePath of files) {
    const full = join2(root, relativePath);
    out[relativePath] = existsSync2(full) ? createHash("sha256").update(readFileSync2(full)).digest("hex") : "missing";
  }
  return out;
}
function planMigrations(manifest, state) {
  const refuse = (reason, unknown2, detail) => ({ ok: false, reason, from: state.layout, to: manifest === null || typeof manifest !== "object" ? state.layout : manifest.current, steps: [], unknown: unknown2, detail });
  if (manifest === null || typeof manifest !== "object") return refuse("bad-manifest", [], "the manifest is not an object");
  if (manifest.format !== MIGRATIONS_FORMAT) return refuse("bad-manifest", [], "unknown manifest format " + JSON.stringify(manifest.format ?? null) + "; this engine reads " + MIGRATIONS_FORMAT);
  if (typeof manifest.current !== "number" || !Number.isInteger(manifest.current) || manifest.current < 1) return refuse("bad-manifest", [], "current is " + JSON.stringify(manifest.current ?? null) + ", not a layout version (an integer >= 1)");
  if (!Array.isArray(manifest.steps)) return refuse("bad-manifest", [], "steps is not an array");
  if (state.layout > manifest.current) return refuse("newer-state", [], "state layout " + String(state.layout) + " is newer than the manifest version " + String(manifest.current));
  if (state.layout === manifest.current) return { ok: true, reason: "already-current", from: state.layout, to: manifest.current, steps: [], unknown: [], detail: null };
  const steps = manifest.steps.map((step) => ({ from: step.from, to: step.to, actions: Array.isArray(step.actions) ? step.actions : [] }));
  const unknown = [];
  steps.forEach((step, index) => {
    for (const action of step.actions) {
      const kind = action !== null && typeof action === "object" ? action.kind : void 0;
      if (kind !== "add-config" && kind !== "set-config" && kind !== "ensure-plugin" && kind !== "note") {
        unknown.push({ step: index, kind: typeof kind === "string" ? kind : JSON.stringify(kind ?? null) });
      }
    }
  });
  const chain = [];
  let at = state.layout;
  for (let guard = 0; at !== manifest.current; guard += 1) {
    if (guard > manifest.steps.length + 1) return refuse("no-path", unknown, "the steps loop without reaching " + String(manifest.current));
    const next = steps.find((step) => step.from === at);
    if (next === void 0 || next.to <= at) return refuse("no-path", unknown, "no step leads from layout " + String(at) + " towards " + String(manifest.current));
    chain.push(next);
    at = next.to;
  }
  if (unknown.length > 0) return refuse("unknown-action", unknown, "unknown action kind(s): " + unknown.map((entry) => entry.kind).join(", "));
  return { ok: true, reason: "ok", from: state.layout, to: manifest.current, steps: chain, unknown: [], detail: null };
}
function setAtPath(document, segments, value) {
  let cursor = document;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = cursor[segment];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of entriesOf(from)) {
    const source = join2(from, name);
    const target = join2(to, name);
    if (statSync2(source).isDirectory()) copyTree(source, target);
    else writeFileSync2(target, readFileSync2(source));
  }
}
function isTransientRename(error) {
  const code = error?.code;
  if (code === "EPERM" || code === "EIO") return true;
  const message = String(error?.message ?? "");
  return message.includes("EPERM") || message.includes("(1175)");
}
function renameWithRetry(from, to) {
  try {
    renameSync(from, to);
    return 0;
  } catch (error) {
    if (!isTransientRename(error)) throw error;
    renameSync(from, to);
    return 1;
  }
}
function applyMigration(root, manifest, options = {}) {
  const before = readState(root);
  const plan = planMigrations(manifest, before);
  const preserved = preservedPaths(root);
  const beforeTree = hashTree(root);
  const beforeLedger = ledgerHashes(root, before.ledger);
  const refused = () => ({
    ok: false,
    reason: plan.reason,
    from: plan.from,
    to: plan.to,
    applied: [],
    changed: [],
    added: [],
    preserved,
    ledgerUnchanged: true,
    rootUnchanged: JSON.stringify(beforeTree) === JSON.stringify(hashTree(root)),
    notes: []
  });
  if (!plan.ok) return refused();
  if (plan.reason === "already-current") {
    return { ok: true, reason: "already-current", from: plan.from, to: plan.to, applied: [], changed: [], added: [], preserved, ledgerUnchanged: true, rootUnchanged: true, notes: [] };
  }
  if (options.enforceKernelRange === true) {
    const range = options.kernelRange;
    if (range === void 0 || typeof range.pluginsDir !== "string" || range.pluginsDir === "") {
      throw new TypeError("applyMigration: enforceKernelRange is on but kernelRange.pluginsDir is missing: give the plugin directory to check, or turn the flag off");
    }
    assertRangesSatisfied(range.pluginsDir, { closureDir: range.closureDir, kernelRoot: range.kernelRoot, lockFile: range.lockFile });
  }
  const staging = join2(dirname(root), "." + basename(root) + ".staging-" + randomUUID());
  const backup = join2(dirname(root), "." + basename(root) + ".backup-" + randomUUID());
  let committed = false;
  try {
    copyTree(root, staging);
    const config = { ...before.config };
    const documents = /* @__PURE__ */ new Map();
    const documentFor = (prefix) => {
      const held = documents.get(prefix);
      if (held !== void 0) return held;
      const path = join2(staging, CONFIG_DIR, prefix.split(".").join("/") + ".json");
      const loaded = existsSync2(path) ? readJsonFile(path) : {};
      const document = loaded !== null && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
      documents.set(prefix, document);
      return document;
    };
    const changed = [];
    const added = [];
    const applied = [];
    const notes = [];
    let plugins = [...before.plugins];
    for (const step of plan.steps) {
      for (const action of step.actions) {
        if (action.kind === "note") {
          notes.push(action.text);
          continue;
        }
        if (action.kind === "ensure-plugin") {
          if (!plugins.includes(action.name)) plugins = [...plugins, action.name].sort();
          continue;
        }
        const segments = action.key.split(".");
        const prefix = segments[0];
        const existed = Object.prototype.hasOwnProperty.call(config, action.key);
        if (action.kind === "add-config") {
          if (existed) continue;
          added.push(action.key);
        } else {
          if (!existed) added.push(action.key);
          else if (JSON.stringify(config[action.key]) !== JSON.stringify(action.value)) {
            changed.push({ key: action.key, before: config[action.key], after: action.value });
          }
        }
        setAtPath(documentFor(prefix), segments.slice(1), action.value);
        config[action.key] = action.value;
      }
      applied.push(String(step.from) + "->" + String(step.to));
    }
    for (const [prefix, document] of documents) {
      mkdirSync(join2(staging, CONFIG_DIR), { recursive: true });
      writeFileSync2(join2(staging, CONFIG_DIR, prefix.split(".").join("/") + ".json"), JSON.stringify(document, null, 2) + "\n");
    }
    const pluginsChanged = JSON.stringify(plugins) !== JSON.stringify(before.plugins);
    if (pluginsChanged) changed.push({ key: PLUGINS_FILE, before: [...before.plugins], after: [...plugins] });
    writeFileSync2(join2(staging, PLUGINS_FILE), JSON.stringify({ plugins }, null, 2) + "\n");
    const version = readJsonFile(join2(staging, VERSION_FILE));
    writeFileSync2(join2(staging, VERSION_FILE), JSON.stringify({ ...version, layout: plan.to }, null, 2) + "\n");
    options.beforeCommit?.();
    const staged = readState(staging);
    const afterLedger = ledgerHashes(staging, staged.ledger);
    const ledgerUnchanged = JSON.stringify(beforeLedger) === JSON.stringify(afterLedger);
    const pluginsKept = before.plugins.every((name) => staged.plugins.includes(name));
    const keysKept = Object.keys(before.config).every((key) => Object.prototype.hasOwnProperty.call(staged.config, key));
    const report = {
      ok: ledgerUnchanged && pluginsKept && keysKept,
      reason: "ok",
      from: plan.from,
      to: plan.to,
      applied,
      changed: [...changed].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
      added: [...added].sort(),
      preserved,
      ledgerUnchanged,
      rootUnchanged: options.dryRun === true,
      notes
    };
    if (!ledgerUnchanged) throw new Error("applyMigration: the staging copy lost ledger bytes");
    if (!pluginsKept) throw new Error("applyMigration: the staging copy dropped a plugin");
    if (!keysKept) throw new Error("applyMigration: the staging copy dropped a configuration key");
    if (options.dryRun === true) return report;
    let renameRetries = 0;
    renameRetries += renameWithRetry(root, backup);
    try {
      renameRetries += renameWithRetry(staging, root);
      committed = true;
    } catch (error) {
      renameWithRetry(backup, root);
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
    return {
      ...report,
      notes: renameRetries === 0 ? notes : [...notes, "retried:rename:" + String(renameRetries)],
      rootUnchanged: JSON.stringify(beforeTree) === JSON.stringify(hashTree(root))
    };
  } finally {
    if (!committed) rmSync(staging, { recursive: true, force: true });
    if (committed && existsSync2(backup)) rmSync(backup, { recursive: true, force: true });
  }
}
function installedRangeRows(pluginsDir, options = {}) {
  const kernel = resolveRangeKernel(join2(pluginsDir, "node_modules"), options);
  return scanPluginRanges(pluginsDir, kernel.version);
}
function resolveRangeKernel(closureDir, options) {
  const fromClosure = resolveKernelVersion({ closureDir });
  if (fromClosure.version !== null) return { version: fromClosure.version, source: fromClosure.source };
  const later = resolveKernelVersion({ closureDir, kernelRoot: options.kernelRoot, lockFile: options.lockFile });
  return { version: later.version, source: later.source };
}
function kernelVersionReportAt(options) {
  return resolveKernelVersion(options);
}
function kernelVersionAtFromClosure(closureDir) {
  return kernelVersionFromClosure(installedClosureVersions(closureDir));
}
function kernelVersionAt(closureDir) {
  return kernelVersionAtFromClosure(closureDir);
}
function markRangeVerdicts(registryFile, pluginsDir, closureDir, options = {}) {
  if (!existsSync2(registryFile)) throw new TypeError("markRangeVerdicts: no registry at " + registryFile);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync2(registryFile, "utf8"));
  } catch (error) {
    throw new TypeError("markRangeVerdicts: registry is not JSON: " + String(error.message));
  }
  const registry = parsed;
  if (registry === null || typeof registry !== "object" || !Array.isArray(registry.plugins)) {
    throw new TypeError("markRangeVerdicts: registry has no plugins array at " + registryFile);
  }
  const kernel = resolveRangeKernel(closureDir, options);
  const kernelVersion = kernel.version;
  const rows = scanPluginRanges(pluginsDir, kernelVersion);
  const declaredNames = /* @__PURE__ */ new Map();
  for (const entry of readdirSync2(pluginsDir).sort()) {
    let declaredManifest = null;
    try {
      declaredManifest = JSON.parse(readFileSync2(join2(pluginsDir, entry, "package.json"), "utf8"));
    } catch {
    }
    if (declaredManifest !== null) {
      const declared = typeof declaredManifest.name === "string" ? declaredManifest.name : entry;
      declaredNames.set(declared, [...declaredNames.get(declared) ?? [], entry]);
    }
  }
  const verdicts = {};
  for (const name of [...registry.plugins].sort()) {
    let row;
    let reason = null;
    const ownManifest = join2(pluginsDir, name, "package.json");
    if (existsSync2(ownManifest)) {
      let ownDocument = null;
      try {
        ownDocument = JSON.parse(readFileSync2(ownManifest, "utf8"));
      } catch (error) {
        reason = "unscannable: package.json under " + ownManifest + " is not JSON: " + String(error.message);
      }
      if (ownDocument !== null) {
        const declared = declaredRange(ownDocument);
        const verdict = declared.range === null ? "no-range" : kernelVersion === null ? "unknown-kernel" : verdictForRange(declared.range, kernelVersion);
        row = { plugin: typeof ownDocument.name === "string" ? ownDocument.name : name, range: declared.range, source: declared.source, verdict };
      }
    }
    if (row === void 0 && reason === null) {
      const sameName = rows.filter((candidate) => candidate.plugin === name);
      const dirs = declaredNames.get(name) ?? [];
      if (sameName.length === 1) row = sameName[0];
      else if (sameName.length > 1 || dirs.length > 1) {
        reason = "ambiguous: " + Math.max(sameName.length, dirs.length) + " directories declare " + name + " (" + dirs.join(", ") + ")";
      } else {
        reason = "unscannable: no package.json under " + join2(pluginsDir, name);
      }
    }
    if (row === void 0) {
      verdicts[name] = { incompatible: true, reason: reason ?? "unscannable" };
      continue;
    }
    const incompatible = row.verdict !== "satisfied";
    verdicts[name] = {
      incompatible,
      reason: incompatible ? row.verdict === "unscannable" ? "unscannable: no package.json under " + join2(pluginsDir, name) : row.verdict + ": range " + String(row.range) + " from " + String(row.source) + " against kernel " + String(kernelVersion) + " (from " + String(kernel.source) + ")" : null
    };
  }
  const document = { ...registry, plugins: [...registry.plugins], verdicts };
  writeFileSync2(registryFile, JSON.stringify(document, null, 1).replace(/\r\n/g, "\n") + "\n", "utf8");
  return document;
}
function assertRangesSatisfied(pluginsDir, options = {}) {
  const rows = installedRangeRows(pluginsDir, options);
  const bad = rows.filter((row) => row.verdict !== "satisfied");
  if (bad.length === 0) return rows;
  const named = bad.map((row) => row.plugin + " [range " + String(row.range) + " from " + String(row.source) + "] -> " + row.verdict);
  throw new RangeError("assertRangesSatisfied: " + String(bad.length) + " of " + String(rows.length) + " plugin(s) do not satisfy the installed kernel range: " + named.join("; "));
}
var PENDING_DIR = ".ops";
var PENDING_FILE = "pending.json";
var LOCK_EXIT_CODE = 75;
function isLockFailure(error) {
  const code = error?.code;
  if (code === "EPERM" || code === "EBUSY") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.indexOf("(1175)") !== -1;
}
var pendingFilePath = (root) => join2(root, PENDING_DIR, PENDING_FILE);
var pendingText = (ops) => {
  const sorted = [...ops].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return JSON.stringify(sorted, null, 1).replace(/\r\n/g, "\n") + "\n";
};
function queuePendingOp(root, op) {
  const held = readPendingOps(root);
  if (held.some((row) => row.key === op.key)) return { queued: false, count: held.length };
  const next = [...held, op];
  mkdirSync(join2(root, PENDING_DIR), { recursive: true });
  writeFileSync2(pendingFilePath(root), pendingText(next), "utf8");
  return { queued: true, count: next.length };
}
function readPendingOps(root) {
  const path = pendingFilePath(root);
  if (!existsSync2(path)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync2(path, "utf8"));
  } catch (error) {
    throw new TypeError("readPendingOps: " + path + " is not JSON: " + String(error?.message ?? error));
  }
  if (!Array.isArray(parsed)) throw new TypeError("readPendingOps: " + path + " does not hold an array of pending operations");
  return parsed;
}
function resumePendingOps(root, apply) {
  const held = readPendingOps(root);
  const resumed = [];
  const failed = [];
  let attempted = 0;
  for (const op of held) {
    attempted += 1;
    try {
      apply(op);
      resumed.push(op.key);
    } catch (error) {
      failed.push({ key: op.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const left = held.filter((op) => !resumed.includes(op.key));
  if (attempted > 0) writeFileSync2(pendingFilePath(root), pendingText(left), "utf8");
  return { attempted, resumed, failed, remaining: left.length };
}
function startup(root, options = {}) {
  if (options.enforceKernelRange === true) {
    const range2 = options.kernelRange;
    if (range2 === void 0 || typeof range2.pluginsDir !== "string" || range2.pluginsDir === "") {
      throw new TypeError("startup: enforceKernelRange is on but kernelRange.pluginsDir is missing: give the plugin directory to check, or turn the flag off");
    }
    assertRangesSatisfied(range2.pluginsDir, { closureDir: range2.closureDir, kernelRoot: range2.kernelRoot, lockFile: range2.lockFile });
  }
  const range = options.kernelRange;
  const kernel = range === void 0 ? null : kernelVersionReportAt({ closureDir: range.closureDir, kernelRoot: range.kernelRoot, lockFile: range.lockFile });
  const held = readPendingOps(root);
  const applyOp = options.applyOp;
  if (held.length > 0 && typeof applyOp !== "function") {
    throw new TypeError("startup: " + String(held.length) + " pending operation(s) at " + pendingFilePath(root) + " but options.applyOp is not a function: supply one to resume them, or empty the queue knowingly");
  }
  if (typeof applyOp !== "function") {
    return { kernel, pending: { attempted: 0, resumed: [], failed: [], remaining: held.length } };
  }
  return { kernel, pending: resumePendingOps(root, applyOp) };
}
export {
  CONFIG_DIR,
  LEDGER_DIR,
  LOCK_EXIT_CODE,
  MIGRATIONS_FORMAT,
  PENDING_DIR,
  PENDING_FILE,
  PLUGINS_FILE,
  VERSION_FILE,
  applyMigration,
  assertRangesSatisfied,
  hashTree,
  installedRangeRows,
  isLockFailure,
  kernelVersionAt,
  kernelVersionReportAt,
  markRangeVerdicts,
  planMigrations,
  preservedPaths,
  queuePendingOp,
  readPendingOps,
  readState,
  resumePendingOps,
  startup
};
