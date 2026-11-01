// plugins/dsh-link-markdown/src/index.ts
import { isAbsolute } from "node:path";

// plugins/dsh-link-markdown/src/client/claim.ts
var MARKDOWN_TAB_ID = "dsh-link-markdown";
var MARKDOWN_KIND = "markdown";
var MARKDOWN_PATTERNS = Object.freeze(["*.md", "*.markdown"]);
var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
var MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;
var REFUSAL_DISPOSITIONS = Object.freeze({
  notFileAddress: "not-a-dsh-resource-file-address",
  malformed: "malformed-file-address",
  unknownScope: "unknown-file-address-scope",
  absoluteScope: "absolute-scope-carries-no-session",
  notMarkdown: "not-a-markdown-extension"
});
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return void 0;
  }
}
function fileTargetOf(address) {
  if (typeof address !== "string" || !address.startsWith(FILE_ADDRESS_PREFIX)) {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.notFileAddress, detail: `not a dsh-resource://file/ address: ${String(address)}` };
  }
  const end = address.search(/[?#]/);
  const segments = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? void 0 : end).split("/");
  const scope = segments.shift();
  if (scope === "session") {
    const id = segments.shift();
    if (id === void 0 || id === "" || segments.length === 0) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `session address without an id or a path: ${address}` };
    }
    const sessionId = decodeSegment(id);
    const decoded = segments.map(decodeSegment);
    if (sessionId === void 0 || decoded.some((segment) => segment === void 0)) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `address segment is not validly encoded: ${address}` };
    }
    return { ok: true, scope: "session", sessionId, path: decoded.join("/") };
  }
  if (scope === "absolute") {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.absoluteScope, detail: `an absolute file address carries no Session to read through: ${address}` };
  }
  return { ok: false, reason: REFUSAL_DISPOSITIONS.unknownScope, detail: `unknown file address scope "${String(scope)}": ${address}` };
}
function isMarkdownAddress(address) {
  const target = fileTargetOf(address);
  if (target.ok !== true) return false;
  const end = target.path.search(/[?#]/);
  return MARKDOWN_EXTENSION.test(end === -1 ? target.path : target.path.slice(0, end));
}
function basenameOf(address) {
  const target = fileTargetOf(address);
  const path = target.ok === true ? target.path : typeof address === "string" ? address : "";
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");
  return segments.length === 0 ? "" : segments[segments.length - 1];
}
function titleFor(address) {
  const name2 = basenameOf(address);
  return name2 === "" ? address : name2;
}

// plugins/dsh-link-markdown/src/index.ts
var name = "link-markdown";
function apply(ctx) {
  const policyFor = (sessionId) => {
    const policies = ctx.get?.("sandboxPolicy");
    if (policies === void 0 || policies === null) return { policy: void 0, boundary: { mode: null, workspaceRoot: null, session: false } };
    const sessions = ctx.get?.("sessions");
    const session = sessionId === null || sessions === void 0 || sessions === null ? void 0 : sessions.get(sessionId);
    const policy = session === void 0 ? policies.resolve({}) : policies.resolve({ session });
    return { policy, boundary: { mode: policy.mode ?? null, workspaceRoot: policy.workspaceRoot ?? null, session: session !== void 0 } };
  };
  const fs = {
    stat: async (path) => {
      const service = ctx.get?.("fs");
      if (service === void 0 || service === null) return null;
      const info = await service.stat(await service.resolve(path));
      if (info === void 0 || info === null) return null;
      return { version: String(info.version), isFile: info.type === "file", size: info.size };
    },
    write: async (path, text, expected, sessionId) => {
      const service = ctx.get?.("fs");
      if (service === void 0 || service === null) throw new Error("the fs service is not mounted");
      const target = await service.resolve(path);
      const intent = expected === null ? void 0 : { kind: "replaceIfVersion", version: expected };
      const { policy, boundary } = policyFor(sessionId);
      try {
        const outcome = await service.writeText(target, text, intent, void 0, policy);
        return { version: String(outcome.version) };
      } catch (error) {
        if (error !== null && typeof error === "object") error.boundary = boundary;
        throw error;
      }
    }
  };
  const route = { kind: "exact", path: WRITE_ROUTE_PATH, handler: createWriteHandler({ fs }) };
  const bind = () => {
    const server = ctx.get?.("webServer");
    if (server === null || server === void 0 || typeof server.register !== "function") return;
    try {
      const dispose = server.register(route);
      if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-link-markdown: save route");
      console.log("[link-markdown] save route bound on " + WRITE_ROUTE_PATH + " (POST, one file, optimistic version)");
    } catch (error) {
      console.error("[link-markdown] could not bind the save route: " + (error instanceof Error ? error.message : String(error)));
    }
  };
  bind();
  if (typeof ctx.inject === "function") ctx.inject(["webServer"], bind);
}
var WRITE_ROUTE_PATH = "/api/dsh-link-markdown/write";
var MAX_BYTES = 2 * 1024 * 1024;
function versionOf(stat) {
  return stat === null || stat === void 0 ? null : String(stat.version);
}
function createWriteHandler(options) {
  const fs = options.fs;
  return async function handler(req, res) {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "the editor save route is POST only" });
      return;
    }
    let body = null;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      sendJson(res, 400, { ok: false, code: "BAD_JSON", error: String(error && error.message ? error.message : error) });
      return;
    }
    const path = body && typeof body.path === "string" ? body.path : "";
    const text = body && typeof body.text === "string" ? body.text : null;
    const expected = body && typeof body.expectedVersion === "string" ? body.expectedVersion : null;
    const sessionId = body && typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : null;
    if (path === "" || isAbsolute(path) === false) {
      sendJson(res, 400, { ok: false, code: "BAD_PATH", error: "path must be an absolute file path" });
      return;
    }
    if (text === null) {
      sendJson(res, 400, { ok: false, code: "BAD_TEXT", error: "text must be a string" });
      return;
    }
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      sendJson(res, 413, { ok: false, code: "TOO_LARGE", error: "the document is over " + String(MAX_BYTES) + " bytes" });
      return;
    }
    let before = null;
    try {
      before = await fs.stat(path);
    } catch (error) {
      before = null;
    }
    if (before === null || before === void 0) {
      sendJson(res, 404, { ok: false, code: "NO_FILE", error: "the editor only saves files that already exist" });
      return;
    }
    if (before.isFile !== true) {
      sendJson(res, 400, { ok: false, code: "NOT_A_FILE", error: "the target is not a regular file" });
      return;
    }
    const current = versionOf(before);
    if (expected !== null && expected !== current) {
      sendJson(res, 409, { ok: false, code: "STALE", version: current, error: "the file changed since it was read" });
      return;
    }
    let written = null;
    try {
      written = await fs.write(path, text, expected, sessionId);
    } catch (error) {
      const code = error !== null && typeof error === "object" && typeof error.code === "string" ? error.code : "";
      const detail = String(error && error.message ? error.message : error);
      if (code === "FS_STALE_VERSION") {
        sendJson(res, 409, { ok: false, code: "STALE", version: null, error: detail });
        return;
      }
      if (code === "FS_NOT_OBSERVED") {
        sendJson(res, 404, { ok: false, code: "NO_FILE", error: detail });
        return;
      }
      const boundary = error !== null && typeof error === "object" && error.boundary !== void 0 ? error.boundary : null;
      sendJson(res, 500, { ok: false, code: "WRITE_FAILED", error: detail, boundary });
      return;
    }
    sendJson(res, 200, { ok: true, version: written === null ? null : written.version, bytes: Buffer.byteLength(text, "utf8") });
  };
}
function readBody(req) {
  return new Promise(function(resolve, reject) {
    const chunks = [];
    let total = 0;
    req.on("data", function(chunk) {
      total += chunk.length;
      if (total > MAX_BYTES + 8192) {
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function() {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
export {
  MARKDOWN_KIND,
  MARKDOWN_PATTERNS,
  MARKDOWN_TAB_ID,
  MAX_BYTES,
  REFUSAL_DISPOSITIONS,
  WRITE_ROUTE_PATH,
  apply,
  basenameOf,
  createWriteHandler,
  fileTargetOf,
  isMarkdownAddress,
  name,
  titleFor,
  versionOf
};
