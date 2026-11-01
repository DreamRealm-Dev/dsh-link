// plugins/dsh-link-interconnect/src/index.ts
import { readFileSync as readFileSync10 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname, join as join9, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/dsh-link-interconnect/src/protocol/server.ts
import { randomBytes as randomBytes4 } from "node:crypto";
import { appendFileSync, existsSync as existsSync5, mkdirSync as mkdirSync5, readFileSync as readFileSync5, renameSync as renameSync5, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join5, resolve } from "node:path";

// plugins/dsh-link-interconnect/src/protocol/types.ts
var PROTOCOL_ID = "link-interconnect/1";
var CONTRACT_VERSION = "1.0.0";
var PROTOCOL_MAJOR = 1;
var PROTOCOL_MINOR = 0;
var LINK_PREFIX = "/link/v1";
var API_PREFIX = "/api/dsh-link-interconnect";
var DATA_DIR_NAME = "link-interconnect";
var ROUTES = Object.freeze({
  // software-facing, forwarded by the shell from /link/*
  contract: LINK_PREFIX + "/contract",
  handshake: LINK_PREFIX + "/handshake",
  handshakeConfirm: LINK_PREFIX + "/handshake/confirm",
  invoke: LINK_PREFIX + "/invoke",
  events: LINK_PREFIX + "/events",
  embedToken: LINK_PREFIX + "/embed/token",
  embedSession: LINK_PREFIX + "/embed/session",
  openaiPrefix: LINK_PREFIX + "/openai",
  anthropicPrefix: LINK_PREFIX + "/anthropic",
  // LINK's own declaration, so software can discover LINK by the same channel (the shell's static
  // catch-all forwards this GET to the kernel; no /link forwarding needed for it).
  wellKnown: "/.well-known/link-interconnect.json",
  // in-app (the client half polls these; all cookie-gated /api paths)
  state: API_PREFIX + "/state",
  consent: API_PREFIX + "/consent",
  adapters: API_PREFIX + "/adapters",
  audit: API_PREFIX + "/audit",
  settings: API_PREFIX + "/settings"
});
var SCOPES = Object.freeze([
  "models.provide",
  "models.proxy",
  "tools.expose",
  "embed.session",
  "consent.manage",
  "audit.read"
]);
var CAPS = Object.freeze({
  modelsProvide: "models.provide",
  toolsExpose: "tools.expose",
  sessionEmbed: "session.embed",
  modelsProxy: "models.proxy"
});
var ERROR_CODES = Object.freeze({
  unauthorized: "link/unauthorized",
  scopeMissing: "link/scope-missing",
  versionUnsupported: "link/version-unsupported",
  consentRequired: "link/consent-required",
  peerUnavailable: "link/peer-unavailable",
  rateLimited: "link/rate-limited",
  payloadTooLarge: "link/payload-too-large",
  idempotencyConflict: "link/idempotency-conflict",
  badRequest: "link/bad-request",
  notFound: "link/not-found",
  internal: "link/internal",
  methodNotAllowed: "link/method-not-allowed"
});
var LIMITS = Object.freeze({
  /** Largest request body any /link/v1 route reads, in bytes. */
  bodyBytes: 1024 * 1024,
  /** Largest event backlog / SSE replay window, in events. */
  eventBacklog: 200,
  /** Idempotency records live this long, in ms. */
  idempotencyMs: 10 * 60 * 1e3,
  /** access token lifetime, ms. */
  accessTokenMs: 15 * 60 * 1e3,
  /** refresh token lifetime, ms. */
  refreshTokenMs: 30 * 24 * 60 * 60 * 1e3,
  /** embed token lifetime, ms (aud = origin). */
  embedTokenMs: 10 * 60 * 1e3,
  /** Default requests-per-minute cap for an adapter/peer when the declaration names none. */
  rpm: 60,
  /** Default upstream timeout for one adapter request, ms. */
  timeoutMs: 15e3,
  /** Health check period and consecutive failures before unavailable. */
  healthMs: 6e4,
  healthFailures: 3
});

// plugins/dsh-link-interconnect/src/protocol/errors.ts
var STATUS_BY_CODE = Object.freeze({
  "link/unauthorized": 401,
  "link/scope-missing": 403,
  "link/version-unsupported": 400,
  "link/consent-required": 403,
  "link/peer-unavailable": 503,
  "link/rate-limited": 429,
  "link/payload-too-large": 413,
  "link/idempotency-conflict": 409,
  "link/bad-request": 400,
  "link/not-found": 404,
  "link/internal": 500,
  "link/method-not-allowed": 405
});
var LinkError = class extends Error {
  /** The stable code a caller switches on. */
  code;
  /** The HTTP status this refusal answers with. */
  status;
  /**
   * @param code - stable machine code.
   * @param message - one sentence for a human reading the log or the answer.
   * @param status - HTTP override; defaults to STATUS_BY_CODE[code].
   */
  constructor(code, message, status) {
    super(message);
    this.name = "LinkError";
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 500;
  }
};
function refuse(code, message, status) {
  return new LinkError(code, message, status);
}
function isLinkError(value) {
  return value instanceof LinkError;
}
function asLinkError(error) {
  if (isLinkError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LinkError(ERROR_CODES.internal, message);
}
function errorDocument(code, message) {
  return { ok: false, error: { code, message } };
}
function sendLinkError(res, error) {
  res.statusCode = error.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(errorDocument(error.code, error.message)));
}

// plugins/dsh-link-interconnect/src/http/io.ts
function readBody(req, limit = LIMITS.bodyBytes) {
  return new Promise((resolve3, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      reject(refuse("link/payload-too-large", "request body exceeds " + String(limit) + " bytes"));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (error, body) => {
      if (done) return;
      done = true;
      if (error !== void 0) reject(error);
      else resolve3(body);
    };
    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.byteLength;
      if (size > limit) {
        finish(refuse("link/payload-too-large", "request body exceeds " + String(limit) + " bytes"));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => finish(void 0, Buffer.concat(chunks)));
    req.on("error", (error) => finish(refuse("link/bad-request", "the request body failed: " + String(error?.message ?? error))));
    req.on("close", () => {
      if (!done) finish(refuse("link/bad-request", "the request closed before its body ended"));
    });
  });
}
async function readJson(req) {
  const body = await readBody(req);
  const text = body.toString("utf8").trim();
  if (text === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw refuse("link/bad-request", "request body is not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw refuse("link/bad-request", "request body must be a JSON object");
  }
  return parsed;
}
function sendJson(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (headers !== void 0) {
    for (const [name2, value] of Object.entries(headers)) res.setHeader(name2, value);
  }
  res.end(JSON.stringify(body));
}
function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}
function parseUrl(req) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return { path: url.pathname, query: url.searchParams };
}
function requireMethod(req, res, method) {
  const wanted = method.toUpperCase();
  const actual = String(req.method ?? "GET").toUpperCase();
  if (actual === wanted) return true;
  res.setHeader("Allow", wanted);
  sendError(res, 405, "link/method-not-allowed", "method not allowed; use " + wanted);
  return false;
}
function createHttpIo() {
  return { readJson, readBody, sendJson, sendError, parseUrl, requireMethod };
}

// plugins/dsh-link-interconnect/src/http/routes.ts
function createRouteTable(io, options = {}) {
  const wrap = (kind, method, path, handler) => ({
    kind,
    path,
    handler: async (req, res) => {
      try {
        if (method !== void 0 && !io.requireMethod(req, res, method)) return;
        await handler(req, res);
      } catch (error) {
        const linkError = asLinkError(error);
        if (options.onError !== void 0 && linkError.status >= 500) options.onError(error, req);
        if (res.headersSent === true) {
          try {
            res.end();
          } catch {
          }
          return;
        }
        sendLinkError(res, linkError);
      }
    }
  });
  return {
    exact: (method, path, handler) => wrap("exact", method, path, handler),
    prefix: (method, path, handler) => wrap("prefix", method, path, handler),
    anyExact: (path, handler) => wrap("exact", void 0, path, handler),
    anyPrefix: (path, handler) => wrap("prefix", void 0, path, handler)
  };
}

// plugins/dsh-link-interconnect/src/http/ratelimit.ts
function createRateLimiter(options = {}) {
  const rpm = Number.isFinite(options.rpm) && options.rpm > 0 ? Math.floor(options.rpm) : 60;
  const capacity = Math.max(1, Math.floor(options.capacity ?? rpm));
  const refillPerMs = rpm / 6e4;
  const now = options.now ?? (() => Date.now());
  const buckets = /* @__PURE__ */ new Map();
  const bucketFor = (key) => {
    const existing = buckets.get(key);
    if (existing !== void 0) return existing;
    const created = { tokens: capacity, at: now() };
    buckets.set(key, created);
    if (buckets.size > 512) {
      for (const [otherKey, bucket] of buckets) {
        if (otherKey !== key && bucket.tokens >= capacity) buckets.delete(otherKey);
      }
    }
    return created;
  };
  return {
    rpm,
    take(key) {
      const bucket = bucketFor(key);
      const at = now();
      const elapsed = Math.max(0, at - bucket.at);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      bucket.at = at;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterMs: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs)) };
    },
    reset(key) {
      if (key === void 0) buckets.clear();
      else buckets.delete(key);
    }
  };
}

// plugins/dsh-link-interconnect/src/identity/store.ts
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
var LINK_ID_LENGTH = 26;
var KEY_BYTES = 32;
var HEAD = "identity.json";
function toBase32(bytes) {
  let accumulator = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    accumulator = accumulator << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[accumulator >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[accumulator << 5 - bits & 31];
  return out;
}
function fromBase64Url(text) {
  if (typeof text !== "string" || text.length === 0 || text.length % 4 === 1) return null;
  if (/[^A-Za-z0-9_-]/.test(text)) return null;
  try {
    return Buffer.from(text, "base64url");
  } catch {
    return null;
  }
}
function linkIdForPublicKey(publicKey) {
  const raw = fromBase64Url(publicKey);
  if (raw === null || raw.byteLength !== KEY_BYTES) throw new Error("not a base64url Ed25519 public key");
  return toBase32(createHash("sha256").update(raw).digest()).slice(0, LINK_ID_LENGTH);
}
function isEd25519PublicKey(publicKey) {
  const raw = fromBase64Url(publicKey);
  if (raw === null || raw.byteLength !== KEY_BYTES) return false;
  try {
    createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
    return true;
  } catch {
    return false;
  }
}
function createIdentityStore(options) {
  const log2 = options.log ?? (() => {
  });
  mkdirSync(options.dir, { recursive: true });
  const file = join(options.dir, HEAD);
  const build = (publicKey2, privateKeyDer2, linkId2, _createdAt, created) => {
    const privateKey = createPrivateKey({ key: privateKeyDer2, format: "der", type: "pkcs8" });
    const identity = {
      linkId: linkId2,
      publicKey: publicKey2,
      sign(payload) {
        return signBytes(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
      },
      verify(payload, signature, peerPublicKey) {
        const rawSignature = fromBase64Url(signature);
        if (rawSignature === null || rawSignature.byteLength !== 64) return false;
        try {
          const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: peerPublicKey }, format: "jwk" });
          return verifyBytes(null, Buffer.from(payload, "utf8"), key, rawSignature);
        } catch {
          return false;
        }
      }
    };
    return { identity, file, created };
  };
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, "utf8"));
      const publicKey2 = String(stored.publicKey ?? "");
      const privateKeyDer2 = fromBase64Url(String(stored.privateKey ?? ""));
      if (isEd25519PublicKey(publicKey2) && privateKeyDer2 !== null) {
        const linkId2 = linkIdForPublicKey(publicKey2);
        if (stored.linkId !== linkId2) {
          writeFileSync(file, JSON.stringify({ version: 1, algorithm: "Ed25519", linkId: linkId2, publicKey: publicKey2, privateKey: String(stored.privateKey), createdAt: stored.createdAt ?? (/* @__PURE__ */ new Date()).toISOString() }, null, 2) + "\n");
          log2("identity linkId repaired to " + linkId2 + " (" + file + ")");
        }
        return build(publicKey2, privateKeyDer2, linkId2, stored.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(), false);
      }
      log2("identity file " + file + " is unusable; regenerating the keypair");
    } catch (error) {
      log2("identity file " + file + " is unreadable (" + String(error?.message ?? error) + "); regenerating the keypair");
    }
  }
  const pair = generateKeyPairSync("ed25519");
  const publicKey = String(pair.publicKey.export({ format: "jwk" }).x);
  const privateKeyDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const linkId = linkIdForPublicKey(publicKey);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const temp = file + "." + String(process.pid) + ".tmp";
  writeFileSync(temp, JSON.stringify({ version: 1, algorithm: "Ed25519", linkId, publicKey, privateKey: privateKeyDer.toString("base64url"), createdAt }, null, 2) + "\n");
  renameSync(temp, file);
  log2("identity " + linkId + " created (" + file + ")");
  return build(publicKey, privateKeyDer, linkId, createdAt, true);
}

// plugins/dsh-link-interconnect/src/identity/tokens.ts
import { randomBytes } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var TOKEN_AUDIENCE = "dsh-link";
var REVOKED_FILE = "revoked-tokens.json";
var HEADER = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" }), "utf8").toString("base64url");
function bearerToken(headers) {
  const raw = headers["authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return void 0;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match === null ? void 0 : match[1];
}
function createTokenService(options) {
  const log2 = options.log ?? (() => {
  });
  const now = options.now ?? (() => Date.now());
  mkdirSync2(options.dir, { recursive: true });
  const file = join2(options.dir, REVOKED_FILE);
  const revoked = /* @__PURE__ */ new Map();
  if (existsSync2(file)) {
    try {
      const stored = JSON.parse(readFileSync2(file, "utf8"));
      for (const entry of Array.isArray(stored.revoked) ? stored.revoked : []) {
        if (typeof entry?.jti === "string" && Number.isFinite(entry?.exp)) revoked.set(entry.jti, entry.exp);
      }
    } catch (error) {
      log2("revoked-token list is unreadable (" + String(error instanceof Error ? error.message : String(error)) + "); starting empty");
    }
  }
  const prune = () => {
    const at = now();
    for (const [jti, exp] of revoked) if (exp <= at) revoked.delete(jti);
  };
  const persist = () => {
    prune();
    const temp = file + "." + String(process.pid) + ".tmp";
    writeFileSync2(temp, JSON.stringify({ version: 1, revoked: [...revoked].map(([jti, exp]) => ({ jti, exp })) }, null, 2) + "\n");
    renameSync2(temp, file);
  };
  return {
    file,
    mint(claims) {
      const at = now();
      const iat = Math.floor(at / 1e3);
      const exp = Math.floor((at + claims.ttlMs) / 1e3);
      const jti = "jti_" + randomBytes(12).toString("base64url");
      const payload = { sub: claims.sub, aud: claims.aud, scope: [...claims.scope], iat, exp, jti };
      const body = HEADER + "." + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      return { token: body + "." + options.identity.sign(body), jti, expiresAt: new Date(at + claims.ttlMs).toISOString() };
    },
    verify(token, verifyOptions) {
      const parts = typeof token === "string" ? token.split(".") : [];
      if (parts.length !== 3 || parts.some((part) => part === "")) {
        return { ok: false, code: "link/unauthorized", message: "token is not a compact JWS" };
      }
      let header;
      let claims;
      try {
        header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      } catch {
        return { ok: false, code: "link/unauthorized", message: "token header or claims are not base64url JSON" };
      }
      if (header.alg !== "EdDSA" || header.typ !== "JWT") {
        return { ok: false, code: "link/unauthorized", message: "token is not an EdDSA JWT" };
      }
      if (!options.identity.verify(parts[0] + "." + parts[1], parts[2], options.identity.publicKey)) {
        return { ok: false, code: "link/unauthorized", message: "token signature rejected" };
      }
      if (typeof claims.sub !== "string" || typeof claims.aud !== "string" || typeof claims.jti !== "string" || !Array.isArray(claims.scope) || !Number.isFinite(claims.exp)) {
        return { ok: false, code: "link/unauthorized", message: "token claims are incomplete" };
      }
      if (claims.exp <= Math.floor(now() / 1e3)) {
        return { ok: false, code: "link/unauthorized", message: "token expired" };
      }
      if (revoked.has(claims.jti)) {
        return { ok: false, code: "link/unauthorized", message: "token was revoked" };
      }
      if (verifyOptions?.aud !== void 0 && claims.aud !== verifyOptions.aud) {
        return { ok: false, code: "link/unauthorized", message: "token audience is not " + verifyOptions.aud };
      }
      if (verifyOptions?.scope !== void 0 && !claims.scope.includes(verifyOptions.scope)) {
        return { ok: false, code: "link/scope-missing", message: "token lacks scope " + verifyOptions.scope };
      }
      return { ok: true, claims };
    },
    revoke(jti) {
      revoked.set(jti, now() + LIMITS.refreshTokenMs);
      persist();
      log2("token jti revoked (" + String(revoked.size) + " blacklisted)");
    },
    isRevoked(jti) {
      return revoked.has(jti);
    }
  };
}

// plugins/dsh-link-interconnect/src/registry/peers.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, renameSync as renameSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var HEAD2 = "peers.json";
var clone = (record) => ({ ...record, scopes: [...record.scopes] });
function createPeerStore(options) {
  const log2 = options.log ?? (() => {
  });
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const nowIso2 = () => now().toISOString();
  mkdirSync3(options.dir, { recursive: true });
  const file = join3(options.dir, HEAD2);
  const records = /* @__PURE__ */ new Map();
  if (existsSync3(file)) {
    try {
      const stored = JSON.parse(readFileSync3(file, "utf8"));
      for (const record of Array.isArray(stored.peers) ? stored.peers : []) {
        if (typeof record?.linkId === "string" && typeof record?.pub === "string") records.set(record.linkId, clone(record));
      }
    } catch (error) {
      log2("peers.json is unreadable (" + String(error instanceof Error ? error.message : String(error)) + "); starting empty");
    }
  }
  const persist = () => {
    const temp = file + "." + String(process.pid) + ".tmp";
    writeFileSync3(temp, JSON.stringify({ version: 1, peers: [...records.values()] }, null, 2) + "\n");
    renameSync3(temp, file);
  };
  return {
    file,
    count() {
      return records.size;
    },
    get(linkId) {
      const record = records.get(linkId);
      return record === void 0 ? void 0 : clone(record);
    },
    list() {
      return [...records.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.linkId.localeCompare(b.linkId));
    },
    upsert(record) {
      const existing = records.get(record.linkId);
      const merged = {
        ...record,
        scopes: [...record.scopes],
        createdAt: existing?.createdAt ?? record.createdAt ?? nowIso2(),
        updatedAt: nowIso2()
      };
      records.set(merged.linkId, merged);
      persist();
      return clone(merged);
    },
    update(linkId, patch) {
      const existing = records.get(linkId);
      if (existing === void 0) return void 0;
      const merged = {
        ...existing,
        ...patch,
        linkId: existing.linkId,
        createdAt: existing.createdAt,
        scopes: patch.scopes === void 0 ? existing.scopes : [...patch.scopes],
        updatedAt: nowIso2()
      };
      records.set(linkId, merged);
      persist();
      return clone(merged);
    },
    remove(linkId) {
      const removed = records.delete(linkId);
      if (removed) persist();
      return removed;
    }
  };
}

// plugins/dsh-link-interconnect/src/registry/grants.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync4, renameSync as renameSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
var HEAD3 = "grants.json";
var clone2 = (grant) => ({ ...grant, scopes: [...grant.scopes] });
function createGrantStore(options) {
  const log2 = options.log ?? (() => {
  });
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  mkdirSync4(options.dir, { recursive: true });
  const file = join4(options.dir, HEAD3);
  const grants = /* @__PURE__ */ new Map();
  if (existsSync4(file)) {
    try {
      const stored = JSON.parse(readFileSync4(file, "utf8"));
      for (const grant of Array.isArray(stored.grants) ? stored.grants : []) {
        if (typeof grant?.peerLinkId === "string" && Array.isArray(grant?.scopes)) grants.set(grant.peerLinkId, clone2(grant));
      }
    } catch (error) {
      log2("grants.json is unreadable (" + String(error instanceof Error ? error.message : String(error)) + "); starting empty");
    }
  }
  const persist = () => {
    const temp = file + "." + String(process.pid) + ".tmp";
    writeFileSync4(temp, JSON.stringify({ version: 1, grants: [...grants.values()] }, null, 2) + "\n");
    renameSync4(temp, file);
  };
  return {
    file,
    count() {
      return grants.size;
    },
    get(peerLinkId) {
      const grant = grants.get(peerLinkId);
      return grant === void 0 ? void 0 : clone2(grant);
    },
    list() {
      return [...grants.values()].map(clone2).sort((a, b) => a.grantedAt.localeCompare(b.grantedAt) || a.peerLinkId.localeCompare(b.peerLinkId));
    },
    grant(grant) {
      const merged = { ...grant, scopes: [...new Set(grant.scopes)], grantedAt: grant.grantedAt || now().toISOString(), grantedBy: grant.grantedBy ?? "user" };
      grants.set(merged.peerLinkId, merged);
      persist();
      return clone2(merged);
    },
    revoke(peerLinkId) {
      const removed = grants.delete(peerLinkId);
      if (removed) persist();
      return removed;
    },
    has(peerLinkId, scope) {
      const grant = grants.get(peerLinkId);
      return grant !== void 0 && grant.scopes.includes(scope);
    }
  };
}

// plugins/dsh-link-interconnect/src/registry/consent.ts
import { randomUUID } from "node:crypto";
var cloneRequest = (request) => ({
  ...request,
  scopes: [...request.scopes],
  detail: request.detail === void 0 ? void 0 : { ...request.detail }
});
function createConsentService(options = {}) {
  const log2 = options.log ?? (() => {
  });
  const now = options.now ?? (() => Date.now());
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 12e4;
  const idFactory = options.idFactory ?? (() => "consent_" + randomUUID());
  const pending = /* @__PURE__ */ new Map();
  const decided = /* @__PURE__ */ new Map();
  const settle = (id, decision, reason) => {
    const entry = pending.get(id);
    if (entry === void 0) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    decided.set(id, decision);
    if (decided.size > 100) {
      const oldest = decided.keys().next();
      if (!oldest.done) decided.delete(oldest.value);
    }
    for (const waiter of entry.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(decision);
    }
    entry.resolve(decision);
    options.events?.publish({ type: "consent/decide", at: new Date(now()).toISOString(), data: { id, decision, reason, peerLinkId: entry.request.peerLinkId } });
    log2("consent " + decision + " id=" + id + " peer=" + entry.request.peerLinkId + " (" + reason + ")");
  };
  return {
    request(input) {
      const id = idFactory();
      const request = {
        ...input,
        id,
        scopes: [...input.scopes],
        detail: input.detail === void 0 ? void 0 : { ...input.detail },
        createdAt: new Date(now()).toISOString()
      };
      let resolveRequest = () => {
      };
      const promise = new Promise((resolve3) => {
        resolveRequest = resolve3;
      });
      const timer = setTimeout(() => settle(id, "denied", "timeout"), defaultTimeoutMs);
      pending.set(id, { request, resolve: resolveRequest, waiters: [], timer });
      options.events?.publish({ type: "consent/request", at: request.createdAt, data: { id, peerLinkId: request.peerLinkId, title: request.title, capability: request.capability, scopes: request.scopes, risk: request.risk } });
      log2("consent pending id=" + id + " peer=" + request.peerLinkId + " scopes=" + request.scopes.join(","));
      return promise;
    },
    listPending() {
      return [...pending.values()].map((entry) => cloneRequest(entry.request)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    decide(id, decision) {
      if (decision !== "granted" && decision !== "denied") return false;
      if (!pending.has(id)) return false;
      settle(id, decision, "decision");
      return true;
    },
    awaitDecision(id, timeoutMs = 3e4) {
      const known = decided.get(id);
      if (known !== void 0) return Promise.resolve(known);
      const entry = pending.get(id);
      if (entry === void 0) return Promise.resolve("timeout");
      return new Promise((resolve3) => {
        const timer = setTimeout(() => {
          entry.waiters = entry.waiters.filter((waiter) => waiter.timer !== timer);
          resolve3("timeout");
        }, timeoutMs);
        entry.waiters.push({ resolve: resolve3, timer });
      });
    },
    pendingCount() {
      return pending.size;
    },
    decidedCount() {
      return decided.size;
    },
    dispose() {
      for (const entry of [...pending.values()]) {
        clearTimeout(entry.timer);
        for (const waiter of entry.waiters) {
          clearTimeout(waiter.timer);
          waiter.resolve("timeout");
        }
        entry.resolve("denied");
      }
      pending.clear();
    }
  };
}

// plugins/dsh-link-interconnect/src/protocol/contract.ts
function buildContract() {
  return {
    protocol: PROTOCOL_ID,
    version: CONTRACT_VERSION,
    major: PROTOCOL_MAJOR,
    minor: PROTOCOL_MINOR,
    endpoints: [
      { method: "GET", path: ROUTES.contract, auth: "none", summary: "this document" },
      { method: "GET", path: ROUTES.wellKnown, auth: "none", summary: "LINK's own declaration" },
      { method: "POST", path: ROUTES.handshake, auth: "none", summary: "ask for a pairing challenge" },
      { method: "POST", path: ROUTES.handshakeConfirm, auth: "none", summary: "prove the challenge with the pairing code" },
      { method: "POST", path: ROUTES.invoke, auth: "bearer", summary: "one capability call, idempotent" },
      { method: "GET", path: ROUTES.events, auth: "bearer", summary: "SSE call progress with backlog replay" },
      { method: "POST", path: ROUTES.embedToken, auth: "bearer", summary: "short-lived embed token (aud = origin)" },
      { method: "GET", path: ROUTES.embedSession, auth: "bearer", summary: "embed session document" },
      { method: "GET", path: ROUTES.openaiPrefix + "/*", auth: "bearer", summary: "proxied OpenAI-compatible model calls" },
      { method: "GET", path: ROUTES.anthropicPrefix + "/*", auth: "bearer", summary: "proxied Anthropic-compatible model calls" }
    ],
    caps: [
      { kind: CAPS.modelsProvide, version: 1, direction: "software-to-link", scopes: [CAPS.modelsProvide], summary: "software offers an OpenAI-compatible model surface" },
      { kind: CAPS.toolsExpose, version: 1, direction: "software-to-link", scopes: [CAPS.toolsExpose], summary: "software offers tools LINK registers" },
      { kind: CAPS.sessionEmbed, version: 1, direction: "link-to-software", scopes: ["embed.session"], summary: "software embeds a LINK session window" },
      { kind: CAPS.modelsProxy, version: 1, direction: "link-to-software", scopes: [CAPS.modelsProxy], summary: "software calls LINK model proxies with a bearer key" }
    ],
    scopes: [...SCOPES],
    errors: Object.values(ERROR_CODES),
    limits: { ...LIMITS },
    csp: {
      frameAncestors: "'self' {origin}",
      connectSrc: "'self' {origin}",
      scriptSrc: "'self'",
      styleSrc: "'self' 'unsafe-inline'",
      imgSrc: "'self' data: {origin}"
    }
  };
}
var CONTRACT_TEXT = JSON.stringify(buildContract());
function buildWellKnown(linkId) {
  return {
    protocol: PROTOCOL_ID,
    identity: { linkId, name: "DSH-LINK", vendor: "deepseek" },
    endpoints: { invoke: ROUTES.invoke, events: ROUTES.events },
    capabilities: [
      { kind: CAPS.modelsProxy, version: 1, auth: "bearer", scopes: [CAPS.modelsProxy] },
      { kind: CAPS.toolsExpose, version: 1, auth: "bearer", scopes: [CAPS.toolsExpose] },
      { kind: CAPS.sessionEmbed, version: 1, auth: "bearer", scopes: ["embed.session"] }
    ],
    limits: { rpm: LIMITS.rpm, bodyBytes: LIMITS.bodyBytes }
  };
}
function createContractRoutes(table, io, identity, log2) {
  return [
    table.exact("GET", ROUTES.contract, (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(CONTRACT_TEXT);
      log2("contract read");
    }),
    table.exact("GET", ROUTES.wellKnown, (_req, res) => {
      io.sendJson(res, 200, buildWellKnown(identity.linkId));
    })
  ];
}

// plugins/dsh-link-interconnect/src/protocol/handshake.ts
import { createHash as createHash2, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
var CHALLENGE_TTL_MS = 12e4;
var MAX_PENDING = 64;
function samePairingCode(left, right) {
  const a = createHash2("sha256").update(left.trim().toUpperCase()).digest();
  const b = createHash2("sha256").update(right.trim().toUpperCase()).digest();
  return timingSafeEqual(a, b);
}
function protocolMajorOf(protocol) {
  if (typeof protocol !== "string") return void 0;
  const match = /^([a-z][a-z0-9-]*)\/(\d+)(?:\.\d+)?$/.exec(protocol.trim());
  if (match === null || match[1] !== "link-interconnect") return void 0;
  return Number(match[2]);
}
function assertProtocol(protocol, log2) {
  if (protocol === void 0) throw refuse("link/bad-request", "protocol is required");
  const major = protocolMajorOf(protocol);
  if (major === void 0) throw refuse("link/version-unsupported", "protocol must be link-interconnect/" + String(PROTOCOL_MAJOR));
  if (major !== PROTOCOL_MAJOR) throw refuse("link/version-unsupported", "protocol major " + String(major) + " is not supported; this build speaks link-interconnect/" + String(PROTOCOL_MAJOR));
  log2("handshake protocol " + String(protocol));
}
function displayString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, 80);
  return trimmed === "" ? fallback : trimmed;
}
function createHandshakeRoutes(options) {
  const now = options.now ?? (() => Date.now());
  const limiter = options.limiter ?? createRateLimiter({ rpm: LIMITS.rpm });
  const pending = /* @__PURE__ */ new Map();
  const takeToken = (req, res, bucket) => {
    const remote = typeof req.socket?.remoteAddress === "string" ? req.socket.remoteAddress : "loopback";
    const decision = limiter.take(bucket + ":" + remote);
    if (decision.ok) return;
    const retryAfterMs = decision.retryAfterMs ?? 1e3;
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1e3))));
    throw refuse("link/rate-limited", "too many handshake requests; retry in " + String(retryAfterMs) + "ms");
  };
  const handshake = options.table.exact("POST", ROUTES.handshake, async (req, res) => {
    takeToken(req, res, "handshake");
    const body = await options.io.readJson(req);
    assertProtocol(body.protocol, options.log);
    const client = body.client;
    if (client === null || typeof client !== "object" || Array.isArray(client)) {
      throw refuse("link/bad-request", "client {linkId,pub,platform} is required");
    }
    const pub = typeof client.pub === "string" ? client.pub : "";
    if (!isEd25519PublicKey(pub)) throw refuse("link/bad-request", "client.pub is not a base64url raw Ed25519 public key");
    const linkId = linkIdForPublicKey(pub);
    if (client.linkId !== void 0 && client.linkId !== linkId) {
      throw refuse("link/bad-request", "client.linkId does not match client.pub");
    }
    const requested = Array.isArray(body.scopes) ? [...new Set(body.scopes.filter((scope) => typeof scope === "string").filter((scope) => SCOPES.includes(scope)))] : [];
    const at = now();
    for (const [candidate, entry] of pending) {
      if (entry.expiresAt <= at) pending.delete(candidate);
    }
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next();
      if (!oldest.done) pending.delete(oldest.value);
    }
    const challenge = randomBytes2(24).toString("base64url");
    pending.set(challenge, {
      linkId,
      pub,
      scopes: requested,
      name: displayString(client.name) ?? "peer-" + linkId.slice(0, 8),
      platform: displayString(client.platform),
      vendor: displayString(client.vendor),
      expiresAt: at + CHALLENGE_TTL_MS
    });
    options.log("handshake challenge issued peer=" + linkId + " scopes=" + String(requested.length));
    options.io.sendJson(res, 200, { challenge, expiresIn: Math.floor(CHALLENGE_TTL_MS / 1e3) });
  });
  const confirm = options.table.exact("POST", ROUTES.handshakeConfirm, async (req, res) => {
    takeToken(req, res, "handshake-confirm");
    const body = await options.io.readJson(req);
    const signature = typeof body.signature === "string" ? body.signature : "";
    const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode : "";
    if (signature === "") throw refuse("link/bad-request", "signature is required");
    if (pairingCode === "") throw refuse("link/bad-request", "pairingCode is required");
    if (!samePairingCode(pairingCode, options.pairingCode())) {
      options.audit.record({ kind: "handshake", ok: false, code: "link/unauthorized", detail: "pairing-code" });
      options.log("handshake refused: pairing code");
      throw refuse("link/unauthorized", "pairing code rejected");
    }
    const at = now();
    let found;
    if (typeof body.challenge === "string") {
      const entry = pending.get(body.challenge);
      if (entry !== void 0) found = { challenge: body.challenge, entry };
    } else {
      for (const [challenge, entry] of pending) {
        if (entry.expiresAt <= at) continue;
        if (options.identity.verify(challenge, signature, entry.pub)) {
          found = { challenge, entry };
          break;
        }
      }
    }
    if (found === void 0) {
      options.audit.record({ kind: "handshake", ok: false, code: "link/unauthorized", detail: "no-pending-challenge" });
      throw refuse("link/unauthorized", "no pending challenge matches the signature; run handshake again");
    }
    if (found.entry.expiresAt <= at) {
      pending.delete(found.challenge);
      throw refuse("link/unauthorized", "challenge expired; run handshake again");
    }
    if (!options.identity.verify(found.challenge, signature, found.entry.pub)) {
      options.audit.record({ kind: "handshake", ok: false, code: "link/unauthorized", detail: "bad-signature" });
      throw refuse("link/unauthorized", "challenge signature rejected");
    }
    pending.delete(found.challenge);
    const scopes = found.entry.scopes.filter((scope) => SCOPES.includes(scope));
    const atIso = new Date(at).toISOString();
    const existing = options.peers.get(found.entry.linkId);
    const peer = options.peers.upsert({
      linkId: found.entry.linkId,
      name: found.entry.name,
      vendor: found.entry.vendor,
      platform: found.entry.platform,
      pub: found.entry.pub,
      scopes,
      status: "active",
      transport: "loopback",
      createdAt: existing?.createdAt ?? atIso,
      updatedAt: atIso,
      lastSeenAt: atIso
    });
    options.grants.grant({ peerLinkId: peer.linkId, scopes, grantedAt: atIso, grantedBy: "user" });
    const access = options.tokens.mint({ sub: peer.linkId, aud: TOKEN_AUDIENCE, scope: scopes, ttlMs: LIMITS.accessTokenMs });
    const refresh = options.tokens.mint({ sub: peer.linkId, aud: TOKEN_AUDIENCE, scope: scopes, ttlMs: LIMITS.refreshTokenMs });
    options.events.publish({ type: "handshake/confirmed", at: atIso, data: { linkId: peer.linkId, name: peer.name, scopes } });
    options.audit.record({ kind: "handshake", peer: peer.linkId, ok: true });
    options.log("handshake confirmed peer=" + peer.linkId + " name=" + peer.name + " scopes=" + scopes.join(","));
    options.io.sendJson(res, 200, {
      accessToken: access.token,
      refreshToken: refresh.token,
      scopes,
      expiresAt: access.expiresAt,
      peer: { linkId: peer.linkId, name: peer.name }
    });
  });
  return [handshake, confirm];
}

// plugins/dsh-link-interconnect/src/protocol/invoke.ts
import { randomBytes as randomBytes3 } from "node:crypto";
var CAP_SCOPES = Object.freeze({
  "link.info": [],
  "models.provide": ["models.provide"],
  "tools.expose": ["tools.expose"],
  "session.embed": ["embed.session"],
  "models.proxy": ["models.proxy"],
  "consent.manage": ["consent.manage"],
  "audit.read": ["audit.read"]
});
function requiredScopesFor(cap) {
  return [...CAP_SCOPES[cap] ?? []];
}
function createCapabilityRegistry() {
  const handlers = /* @__PURE__ */ new Map();
  const key = (cap, op) => cap + "\0" + op;
  return {
    register(cap, op, handler) {
      handlers.set(key(cap, op), handler);
    },
    get(cap, op) {
      return handlers.get(key(cap, op));
    },
    scopes(cap) {
      return requiredScopesFor(cap);
    },
    operations() {
      return [...handlers.keys()].map((entry) => entry.replace("\0", "/"));
    }
  };
}
function registerBuiltinCapabilities(registry, identity) {
  registry.register("link.info", "identity", () => ({
    protocol: PROTOCOL_ID,
    linkId: identity.linkId,
    publicKey: identity.publicKey,
    contractVersion: CONTRACT_VERSION,
    protocolMajor: PROTOCOL_MAJOR
  }));
  registry.register("link.info", "contract", () => buildContract());
  registry.register("link.info", "ping", () => ({ protocol: PROTOCOL_ID, at: (/* @__PURE__ */ new Date()).toISOString() }));
  return registry;
}
function createInvokeRoutes(options) {
  const now = options.now ?? (() => Date.now());
  const limiter = options.limiter ?? createRateLimiter({ rpm: LIMITS.rpm });
  const idempotencyMs = options.idempotencyMs ?? LIMITS.idempotencyMs;
  const answers = /* @__PURE__ */ new Map();
  const sendText = (res, status, text) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(text);
  };
  const route = options.table.exact("POST", ROUTES.invoke, async (req, res) => {
    const body = await options.io.readJson(req);
    const token = bearerToken(req.headers);
    if (token === void 0 || token === "") throw refuse("link/unauthorized", "a bearer token is required");
    const verdict = options.tokens.verify(token, { aud: TOKEN_AUDIENCE });
    if (!verdict.ok) throw refuse(verdict.code, verdict.message);
    const claims = verdict.claims;
    const peer = claims.sub;
    const decision = limiter.take("invoke:" + peer);
    if (!decision.ok) {
      const retryAfterMs = decision.retryAfterMs ?? 1e3;
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1e3))));
      throw refuse("link/rate-limited", "too many invokes; retry in " + String(retryAfterMs) + "ms");
    }
    const cap = typeof body.cap === "string" ? body.cap : "";
    const op = typeof body.op === "string" ? body.op : "";
    if (cap === "" || op === "") throw refuse("link/bad-request", "cap and op are required");
    const required = requiredScopesFor(cap);
    for (const scope of required) {
      if (!claims.scope.includes(scope)) throw refuse("link/scope-missing", "capability " + cap + " requires scope " + scope);
    }
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey !== "" ? body.idempotencyKey : void 0;
    const mapKey = idempotencyKey === void 0 ? void 0 : peer + "\0" + idempotencyKey;
    if (mapKey !== void 0) {
      const existing = answers.get(mapKey);
      if (existing !== void 0) {
        if (now() - existing.at >= idempotencyMs) {
          answers.delete(mapKey);
        } else if (existing.cap !== cap || existing.op !== op) {
          throw refuse("link/idempotency-conflict", "idempotencyKey " + String(idempotencyKey) + " was first used for " + existing.cap + "/" + existing.op);
        } else {
          res.setHeader("x-link-idempotent-replay", "1");
          options.log("invoke-replay cap=" + cap + " op=" + op + " peer=" + peer);
          sendText(res, 200, existing.body);
          return;
        }
      }
    }
    const handler = options.capabilities.get(cap, op);
    if (handler === void 0) throw refuse("link/not-found", "unknown capability " + cap + "/" + op);
    const at = new Date(now()).toISOString();
    const startedAt = now();
    const callId = "call_" + randomBytes3(8).toString("base64url");
    const args = body.args === null || typeof body.args !== "object" || Array.isArray(body.args) ? {} : body.args;
    let result;
    try {
      result = await handler({ args, peer, claims });
    } catch (error) {
      const failure = asLinkError(error);
      options.audit.record({ kind: "invoke", peer, cap, op, ok: false, code: failure.code, ms: Math.max(0, now() - startedAt) });
      options.events.publish({ type: "invoke", at, data: { callId, cap, op, ok: false, code: failure.code } });
      options.log("invoke cap=" + cap + " op=" + op + " peer=" + peer + " ok=false code=" + failure.code);
      throw failure;
    }
    const text = JSON.stringify({ ok: true, result });
    if (mapKey !== void 0) answers.set(mapKey, { at: now(), cap, op, body: text });
    const ms = Math.max(0, now() - startedAt);
    options.audit.record({ kind: "invoke", peer, cap, op, ok: true, ms });
    options.events.publish({ type: "invoke", at, data: { callId, cap, op, ok: true, ms } });
    options.log("invoke cap=" + cap + " op=" + op + " peer=" + peer + " ok=true ms=" + String(ms));
    sendText(res, 200, text);
  });
  return [route];
}

// plugins/dsh-link-interconnect/src/protocol/events.ts
function createEventHub(options = {}) {
  const backlog = Math.max(1, Math.floor(options.backlog ?? LIMITS.eventBacklog));
  const now = options.now ?? (() => Date.now());
  const entries = [];
  const listeners = /* @__PURE__ */ new Set();
  let seq = 0;
  let total = 0;
  const copy = (event) => ({ type: event.type, at: event.at, data: event.data === void 0 ? void 0 : { ...event.data } });
  return {
    publish(event) {
      const stored = { type: String(event.type), at: event.at || new Date(now()).toISOString(), data: event.data === void 0 ? void 0 : { ...event.data } };
      seq += 1;
      total += 1;
      entries.push({ seq, event: stored });
      while (entries.length > backlog) entries.shift();
      for (const listener of listeners) {
        try {
          listener(copy(stored));
        } catch {
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recent(limit = 20) {
      const count = Math.max(1, Math.floor(limit));
      return entries.slice(-count).map((entry) => copy(entry.event));
    },
    entries(limit = backlog) {
      const count = Math.max(1, Math.floor(limit));
      return entries.slice(-count).map((entry) => ({ seq: entry.seq, event: copy(entry.event) }));
    },
    published() {
      return total;
    }
  };
}
function createEventsRoutes(table, io, tokens, events, _log) {
  const streams = /* @__PURE__ */ new Set();
  const frame = (entry) => {
    const callId = typeof entry.event.data?.callId === "string" ? entry.event.data.callId : null;
    return "data: " + JSON.stringify({ callId, seq: entry.seq, done: true, type: entry.event.type, at: entry.event.at, data: entry.event.data ?? null }) + "\n\n";
  };
  const closeStream = (stream) => {
    if (!streams.delete(stream)) return;
    clearInterval(stream.timer);
    stream.unsubscribe();
    try {
      stream.res.end();
    } catch {
    }
  };
  const route = table.exact("GET", ROUTES.events, (req, res) => {
    const { query } = io.parseUrl(req);
    const token = query.get("token") ?? bearerToken(req.headers);
    if (token === null || token === "") throw refuse("link/unauthorized", "the events stream requires a bearer token");
    const verdict = tokens.verify(token, { aud: TOKEN_AUDIENCE });
    if (!verdict.ok) throw refuse(verdict.code, verdict.message);
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.write(": " + PROTOCOL_ID + " events " + CONTRACT_VERSION + "\n\n");
    for (const entry of events.entries(LIMITS.eventBacklog)) res.write(frame(entry));
    const stream = {
      res,
      timer: setInterval(() => {
        try {
          res.write(": keep-alive\n\n");
        } catch {
          closeStream(stream);
        }
      }, 15e3),
      unsubscribe: () => {
      }
    };
    stream.timer.unref?.();
    stream.unsubscribe = events.subscribe((event) => {
      const newest = events.entries(1)[0];
      const seq = newest === void 0 ? 0 : newest.seq;
      const callId = typeof event.data?.callId === "string" ? event.data.callId : null;
      try {
        res.write("data: " + JSON.stringify({ callId, seq, done: true, type: event.type, at: event.at, data: event.data ?? null }) + "\n\n");
      } catch {
        closeStream(stream);
      }
    });
    streams.add(stream);
    res.on?.("close", () => closeStream(stream));
  });
  return {
    routes: [route],
    stop() {
      for (const stream of [...streams]) closeStream(stream);
    }
  };
}

// plugins/dsh-link-interconnect/src/protocol/server.ts
var AUDIT_FILE = "audit.jsonl";
var AUDIT_MEMORY = 500;
var PAIRING_FILE = "pairing.json";
var PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var PAIRING_LENGTH = 8;
function createAuditSink(options) {
  mkdirSync5(options.dir, { recursive: true });
  const file = join5(options.dir, AUDIT_FILE);
  const limit = Math.max(1, Math.floor(options.limit ?? AUDIT_MEMORY));
  const records = [];
  if (existsSync5(file)) {
    for (const line of readFileSync5(file, "utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.at === "string" && typeof parsed?.kind === "string") records.push(parsed);
      } catch {
      }
    }
    if (records.length > limit) records.splice(0, records.length - limit);
  }
  return {
    file,
    record(record) {
      const stored = { ...record, at: (/* @__PURE__ */ new Date()).toISOString() };
      records.push(stored);
      if (records.length > limit) records.splice(0, records.length - limit);
      try {
        appendFileSync(file, JSON.stringify(stored) + "\n");
      } catch {
      }
    },
    list(count = 100) {
      return records.slice(-Math.max(1, Math.floor(count))).map((record) => ({ ...record }));
    }
  };
}
function createPairingCode(options) {
  mkdirSync5(options.dir, { recursive: true });
  const log2 = options.log ?? (() => {
  });
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const file = join5(options.dir, PAIRING_FILE);
  const override = String((options.env ?? process.env).LINK_PAIRING_CODE ?? "").trim();
  let code = override;
  let source = "env";
  if (code === "") {
    source = "generated";
    let generated = "";
    while (generated.length < PAIRING_LENGTH) {
      for (const byte of randomBytes4(PAIRING_LENGTH * 2)) {
        if (generated.length >= PAIRING_LENGTH) break;
        const index = byte % PAIRING_ALPHABET.length;
        if (index < PAIRING_ALPHABET.length) generated += PAIRING_ALPHABET[index];
      }
    }
    code = generated;
  }
  const createdAt = now().toISOString();
  const temp = file + "." + String(process.pid) + ".tmp";
  writeFileSync5(temp, JSON.stringify({ version: 1, code, source, createdAt }, null, 2) + "\n");
  renameSync5(temp, file);
  log2("pairing code " + (source === "env" ? "from LINK_PAIRING_CODE" : "generated") + " - read it at " + file);
  return { code, file, source, createdAt };
}
async function createProtocolServer(options) {
  const home = resolve(options.home);
  const dir = options.dataDir !== void 0 && options.dataDir !== "" ? resolve(options.dataDir) : join5(home, DATA_DIR_NAME);
  mkdirSync5(dir, { recursive: true });
  const log2 = options.log;
  const identityStore = createIdentityStore({ dir, log: log2 });
  const identity = identityStore.identity;
  const tokens = createTokenService({ dir, identity, log: log2 });
  const peers = createPeerStore({ dir, log: log2 });
  const grants = createGrantStore({ dir, log: log2 });
  const events = createEventHub({ backlog: LIMITS.eventBacklog });
  const audit = createAuditSink({ dir });
  const consent = createConsentService({ events, log: log2 });
  const pairing = createPairingCode({ dir, log: log2 });
  const io = createHttpIo();
  const table = createRouteTable(io, {
    onError(error) {
      log2("route failed: " + String(error instanceof Error ? error.message : error));
    }
  });
  const capabilities = registerBuiltinCapabilities(createCapabilityRegistry(), identity);
  const contractRoutes = createContractRoutes(table, io, identity, log2);
  const handshakeRoutes = createHandshakeRoutes({
    table,
    io,
    identity,
    tokens,
    peers,
    grants,
    audit,
    events,
    pairingCode: () => pairing.code,
    log: log2,
    limiter: createRateLimiter({ rpm: LIMITS.rpm })
  });
  const invokeRoutes = createInvokeRoutes({
    table,
    io,
    tokens,
    capabilities,
    audit,
    events,
    log: log2,
    limiter: createRateLimiter({ rpm: LIMITS.rpm })
  });
  const eventsRoutes = createEventsRoutes(table, io, tokens, events, log2);
  const notFound = table.anyPrefix(LINK_PREFIX, (req, res) => {
    const { path } = io.parseUrl(req);
    io.sendError(res, 404, "link/not-found", "no link-interconnect route " + path);
  });
  const routes = [...contractRoutes, ...handshakeRoutes, ...invokeRoutes, ...eventsRoutes.routes, notFound];
  const core = { protocol: PROTOCOL_ID, dir, identity, tokens, peers, grants, consent, events, audit, log: log2 };
  let started = false;
  const server = {
    core,
    io,
    capabilities,
    pairing,
    routes() {
      return routes.slice();
    },
    async start() {
      if (started) return;
      started = true;
      log2("protocol server ready linkId=" + identity.linkId + " dir=" + dir);
    },
    async stop() {
      eventsRoutes.stop();
      consent.dispose();
      started = false;
    }
  };
  return server;
}

// plugins/dsh-link-interconnect/src/adapters/runtime.ts
import { createHash as createHash3 } from "node:crypto";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync7, renameSync as renameSync6, writeFileSync as writeFileSync6 } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join6 } from "node:path";

// plugins/dsh-link-interconnect/src/adapters/probe.ts
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "node:fs";
import { homedir } from "node:os";
function expandTemplate(template, vars = {}, env = process.env, home = homedir()) {
  let text = template;
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) text = home + text.slice(1);
  let unresolved = false;
  const withEnv = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, bare) => {
    const name2 = String(braced ?? bare);
    const value = env[name2];
    if (value === void 0 || value === "") {
      unresolved = true;
      return "";
    }
    return value;
  });
  if (unresolved) return void 0;
  return withEnv.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name2) => vars[name2] === void 0 ? match : vars[name2]);
}
function readDotPath(value, path) {
  let cursor = value;
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return void 0;
    cursor = cursor[key];
  }
  return cursor;
}
function readFileProbes(declaration, environment) {
  const env = environment.env ?? process.env;
  const home = environment.home ?? homedir();
  const probes = declaration.match?.files ?? [];
  const resolved = { vars: {}, sawFile: false, unresolved: [] };
  for (const probe of probes) {
    const path = expandTemplate(probe.path, resolved.vars, env, home);
    if (path === void 0) {
      resolved.unresolved.push(probe.path);
      continue;
    }
    if (!existsSync6(path)) continue;
    resolved.sawFile = true;
    let raw;
    try {
      raw = readFileSync6(path, "utf8");
    } catch {
      resolved.fileProblem = resolved.fileProblem ?? probe.path + " exists but can not be read";
      continue;
    }
    if (probe.jsonPath === void 0) {
      resolved.vars[probe.as] = raw.trim();
      break;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      resolved.fileProblem = resolved.fileProblem ?? probe.path + " is not JSON, so " + probe.jsonPath + " can not be read";
      continue;
    }
    const found = readDotPath(parsed, probe.jsonPath);
    if (found === void 0 || found === null) {
      resolved.fileProblem = resolved.fileProblem ?? probe.path + " has no " + probe.jsonPath + " field";
      continue;
    }
    if (typeof found === "object") {
      resolved.fileProblem = resolved.fileProblem ?? probe.path + "." + probe.jsonPath + " is an object, not a scalar";
      continue;
    }
    resolved.vars[probe.as] = String(found);
    break;
  }
  return resolved;
}
async function fetchIdentity(identity, vars, environment) {
  const env = environment.env ?? process.env;
  const home = environment.home ?? homedir();
  const url = expandTemplate(identity.url, vars, env, home);
  if (url === void 0) {
    return { ok: false, reasonCode: "probe-failed", message: "the declared identity URL " + identity.url + " needs an environment variable this machine does not set" };
  }
  const fetchImpl = environment.fetch ?? fetch;
  const timeoutMs = environment.timeoutMs ?? 4e3;
  const method = identity.method === "HEAD" ? "HEAD" : "GET";
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: "error",
      headers: { accept: "application/json, text/plain;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const cause = error?.cause;
    const code = cause?.code ?? error?.code ?? "";
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reasonCode: "not-running", message: method + " " + url + " answered nothing: " + (code !== "" ? code : detail.slice(0, 160)) };
  }
  const expected = identity.expectStatus ?? 200;
  if (response.status !== expected) {
    return { ok: false, reasonCode: "foreign-service", message: method + " " + url + " answered HTTP " + response.status + " (expected " + expected + "): the service there is not the declared one" };
  }
  if (identity.contains === void 0 && identity.jsonPath === void 0) return { ok: true };
  const text = method === "HEAD" ? "" : (await response.text()).slice(0, 65536);
  if (identity.contains !== void 0 && !text.includes(identity.contains)) {
    return { ok: false, reasonCode: "foreign-service", message: "something answered on that port, but its response does not contain " + JSON.stringify(identity.contains) + ": it is a foreign service" };
  }
  if (identity.jsonPath !== void 0) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reasonCode: "foreign-service", message: "the identity response at " + url + " is not JSON, so it can not be the declared service" };
    }
    const found = readDotPath(parsed, identity.jsonPath);
    if (identity.equals !== void 0 && String(found) !== identity.equals) {
      return { ok: false, reasonCode: "foreign-service", message: "the identity response carries " + identity.jsonPath + "=" + JSON.stringify(String(found)) + ", expected " + JSON.stringify(identity.equals) };
    }
    if (identity.equals === void 0 && found === void 0) {
      return { ok: false, reasonCode: "foreign-service", message: "the identity response has no " + identity.jsonPath + " field" };
    }
  }
  return { ok: true };
}
async function probeDeclaration(declaration, environment = {}) {
  const at = (environment.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  const env = environment.env ?? process.env;
  const home = environment.home ?? homedir();
  const probes = readFileProbes(declaration, environment);
  const envNames = declaration.match?.env ?? [];
  const envSignals = envNames.filter((name2) => (env[name2] ?? "").trim() !== "");
  const files = (declaration.match?.files ?? []).map((probe) => probe.path);
  const refuse2 = (reasonCode, reason) => ({ adapterId: declaration.id, detected: false, reasonCode, reason, at });
  const unresolvedNote = probes.unresolved.length > 0 ? " (" + probes.unresolved.join(", ") + " needs an environment variable that is not set)" : "";
  const envNote = envNames.length > 0 ? " and none of " + JSON.stringify(envNames) + " is set" : "";
  const identity = declaration.match?.identity;
  if (identity === void 0) {
    if (probes.fileProblem !== void 0 && !probes.sawFile) return refuse2("probe-failed", probes.fileProblem);
    if (!probes.sawFile && envSignals.length === 0) {
      return refuse2("not-installed", declaration.name + " is not installed: " + (files.length > 0 ? files.join(", ") + " does not exist" : "the declaration names no installation file") + envNote + unresolvedNote);
    }
    const baseUrl2 = expandTemplate(declaration.connect.baseUrl, probes.vars, env, home);
    return { adapterId: declaration.id, detected: true, baseUrl: baseUrl2, detail: { ...probes.vars }, at };
  }
  if (probes.vars.port === void 0) {
    if (probes.fileProblem !== void 0) return refuse2("probe-failed", probes.fileProblem);
    if (!probes.sawFile && envSignals.length === 0) {
      return refuse2("not-installed", declaration.name + " is not installed: " + (files.length > 0 ? files.join(", ") + " does not exist" : "the declaration names no installation file") + envNote + unresolvedNote);
    }
    return refuse2("not-running", declaration.name + " is installed but not serving: " + (files[0] ?? "the lock file") + " names no port" + unresolvedNote);
  }
  const identityOutcome = await fetchIdentity(identity, probes.vars, environment);
  if (!identityOutcome.ok) return refuse2(identityOutcome.reasonCode, identityOutcome.message);
  const baseUrl = expandTemplate(declaration.connect.baseUrl, probes.vars, env, home);
  return { adapterId: declaration.id, detected: true, baseUrl, detail: { ...probes.vars }, at };
}

// plugins/dsh-link-interconnect/src/adapters/runtime.ts
var ADAPTER_EVENTS = Object.freeze({
  /** Published on every binding change (bind, unbind, status, restore). */
  bindings: "interconnect/bindings",
  /** Published after every probe round. */
  adapters: "interconnect/adapters"
});
var STATE_FILE = "adapters.json";
var ADAPTER_REFUSALS = Object.freeze({
  unknown: "adapter/unknown",
  invalidDeclaration: "adapter/invalid-declaration",
  consentDenied: "adapter/consent-denied",
  credentialMissing: "adapter/credential-missing",
  verifyFailed: "adapter/verify-failed",
  bindFailed: "adapter/bind-failed",
  persistFailed: "adapter/persist-failed",
  notBound: "adapter/not-bound",
  alreadyBound: "adapter/already-bound",
  stopped: "adapter/stopped",
  externalInvalid: "adapter/external-invalid",
  externalConflict: "adapter/external-conflict",
  externalUnknown: "adapter/external-unknown"
});
var AdapterRefusal = class extends Error {
  /** Stable machine code, e.g. adapter/not-running. */
  code;
  /** The declaration id the attempt was for, when known. */
  adapterId;
  /**
   * @param code - stable machine code.
   * @param message - the sentence the pane prints.
   * @param adapterId - the declaration id the attempt was for.
   */
  constructor(code, message, adapterId) {
    super(message);
    this.name = "AdapterRefusal";
    this.code = code;
    this.adapterId = adapterId;
  }
};
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function adapterRefusalBody(error) {
  if (error instanceof AdapterRefusal) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...error.adapterId === void 0 ? {} : { adapterId: error.adapterId }
      }
    };
  }
  return { ok: false, error: { code: "adapter/internal", message: describeError(error) } };
}
function capabilityOf(declaration, kind) {
  return declaration.capabilities.find((capability) => capability.kind === kind);
}
function providerIdOf(declaration) {
  const capability = capabilityOf(declaration, CAPS.modelsProvide);
  if (capability === void 0) return void 0;
  return capability.as?.providerId ?? declaration.id;
}
function toolNamesOf(declaration) {
  const capability = capabilityOf(declaration, CAPS.toolsExpose);
  if (capability === void 0 || !Array.isArray(capability.tools)) return void 0;
  return capability.tools.map((tool) => tool.name);
}
function limitsOf(declaration) {
  return {
    rpm: declaration.limits?.rpm ?? LIMITS.rpm,
    timeoutMs: declaration.limits?.timeoutMs ?? LIMITS.timeoutMs
  };
}
function declarationVersion(declaration) {
  const content = JSON.stringify({
    id: declaration.id,
    name: declaration.name,
    vendor: declaration.vendor,
    match: declaration.match,
    connect: declaration.connect,
    capabilities: declaration.capabilities,
    consent: declaration.consent,
    limits: declaration.limits
  });
  return createHash3("sha256").update(content).digest("hex").slice(0, 16);
}
function receiptProblem(receipt, adapterId, declaration) {
  if (receipt === void 0 || receipt === null || typeof receipt !== "object") return "the binding file carries no consent receipt; connect again";
  if (typeof receipt.revokedAt === "string" && receipt.revokedAt !== "") return "the recorded grant was revoked at " + receipt.revokedAt + "; connect again";
  if (typeof receipt.adapterId !== "string" || receipt.adapterId !== adapterId) return "the consent receipt names adapter " + JSON.stringify(receipt.adapterId) + "; connect again";
  if (typeof receipt.declarationId !== "string" || receipt.declarationId !== declaration.id) return "the consent receipt was granted for declaration " + JSON.stringify(receipt.declarationId) + "; connect again";
  if (!Array.isArray(receipt.scopes) || !receipt.scopes.every((scope) => typeof scope === "string")) return "the consent receipt carries no granted scopes; connect again";
  const missing = declaration.consent.scopes.filter((scope) => !receipt.scopes.includes(scope));
  if (missing.length > 0) return "the recorded grant does not cover " + JSON.stringify(missing) + " (granted " + JSON.stringify(receipt.scopes) + "); connect again";
  if (typeof receipt.consentGrantedAt !== "string" || receipt.consentGrantedAt === "") return "the consent receipt carries no grant time; connect again";
  const currentVersion = declarationVersion(declaration);
  if (typeof receipt.declarationVersion !== "string" || receipt.declarationVersion !== currentVersion) {
    return "the declaration changed after the person granted access (receipt " + String(receipt.declarationVersion) + ", current " + currentVersion + "); connect again";
  }
  return void 0;
}
function externalDeclaration(input) {
  return {
    id: input.adapterId,
    name: input.adapterId,
    match: {},
    connect: { baseUrl: input.baseUrl },
    capabilities: input.caps.map((kind) => ({
      kind,
      version: 1,
      ...kind === CAPS.modelsProvide ? { from: "openai", ...input.providerId === void 0 ? {} : { as: { providerId: input.providerId } } } : {}
    })),
    consent: { title: "peer binding " + input.peerLinkId, scopes: [...input.caps] }
  };
}
function externalText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): " + field + " must be a non-empty string");
  }
  return value.trim();
}
function externalBaseUrl(value) {
  const text = externalText(value, "baseUrl");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): baseUrl must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): baseUrl must be an absolute http(s) URL");
  }
  return text.replace(/\/+$/, "");
}
function externalCredentialSource(input) {
  if (input.credential !== void 0) {
    if (typeof input.credential !== "function") throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): credential must be a function");
    return () => {
      const value = input.credential();
      return typeof value === "string" && value !== "" ? value : void 0;
    };
  }
  if (input.apiKey === void 0) return void 0;
  if (typeof input.apiKey !== "string" || input.apiKey === "") throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): apiKey must be a non-empty string");
  const apiKey = input.apiKey;
  return () => apiKey;
}
function validateDeclaration(id, parsed) {
  if (parsed === null || typeof parsed !== "object") throw new Error("adapter.json is not a JSON object");
  const declaration = parsed;
  if (declaration.id !== id) throw new Error("adapter.json declares id " + JSON.stringify(declaration.id) + " but lives in adapters/" + id + "/");
  if (typeof declaration.name !== "string" || declaration.name === "") throw new Error("name must be a non-empty string");
  if (declaration.match === null || typeof declaration.match !== "object") throw new Error("match must be an object");
  if (declaration.connect === null || typeof declaration.connect !== "object") throw new Error("connect must be an object");
  if (typeof declaration.connect.baseUrl !== "string" || declaration.connect.baseUrl === "") throw new Error("connect.baseUrl must be a non-empty string");
  if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) throw new Error("capabilities must be a non-empty array");
  if (declaration.consent === null || typeof declaration.consent !== "object") throw new Error("consent must be an object");
  if (typeof declaration.consent.title !== "string" || declaration.consent.title === "") throw new Error("consent.title must be a non-empty string");
  if (!Array.isArray(declaration.consent.scopes) || declaration.consent.scopes.length === 0) throw new Error("consent.scopes must be a non-empty array");
  for (const capability of declaration.capabilities) {
    if (capability === null || typeof capability !== "object") throw new Error("each capability must be an object");
    if (typeof capability.kind !== "string" || capability.kind === "") throw new Error("each capability needs a non-empty kind");
    if (!Number.isInteger(capability.version) || capability.version < 1) throw new Error("capability " + capability.kind + " needs an integer version >= 1");
    if (capability.kind === CAPS.modelsProvide && capability.as !== void 0 && typeof capability.as.providerId !== "string") {
      throw new Error("models.provide as.providerId must be a string when present");
    }
    if (capability.kind === CAPS.toolsExpose) {
      if (!Array.isArray(capability.tools) || capability.tools.length === 0) throw new Error("tools.expose must declare at least one tool");
      for (const tool of capability.tools) {
        if (tool === null || typeof tool !== "object") throw new Error("each declared tool must be an object");
        if (typeof tool.name !== "string" || tool.name === "") throw new Error("each declared tool needs a non-empty name");
        if (typeof tool.description !== "string") throw new Error("tool " + tool.name + " needs a description string");
        if (tool.parameters === null || typeof tool.parameters !== "object") throw new Error("tool " + tool.name + " needs a parameters JSON schema object");
      }
    }
  }
  return declaration;
}
async function createAdapterRuntime(options) {
  const { core, adaptersDir, log: log2 } = options;
  const probeEnvironment = {};
  const declarations = /* @__PURE__ */ new Map();
  const declarationOrder = [];
  const declarationErrors = /* @__PURE__ */ new Map();
  const probes = /* @__PURE__ */ new Map();
  const live = /* @__PURE__ */ new Map();
  const binders = [];
  const inFlight = /* @__PURE__ */ new Map();
  const stateFile = join6(core.dir, STATE_FILE);
  let persistCounter = 0;
  let timer;
  let stopped = false;
  function audit(record) {
    try {
      core.audit.record({ ...record, ...record.detail === void 0 ? {} : { detail: record.detail.slice(0, 240) } });
    } catch (error) {
      log2("adapter audit record could not be appended: " + describeError(error));
    }
  }
  function cloneBinding(state) {
    return {
      ...state,
      caps: [...state.caps],
      ...state.toolNames === void 0 ? {} : { toolNames: [...state.toolNames] }
    };
  }
  function bindings() {
    return [...live.values()].map((record) => cloneBinding(record.state));
  }
  function adapters() {
    return declarationOrder.map((id) => {
      const declaration = declarations.get(id);
      const reading = probes.get(id);
      const record = live.get(id);
      const row = {
        id,
        name: declaration?.name ?? id,
        detected: reading?.detected ?? false,
        ...declaration?.vendor === void 0 ? {} : { vendor: declaration.vendor },
        ...reading?.reasonCode === void 0 ? {} : { reasonCode: reading.reasonCode },
        ...reading?.reason === void 0 ? {} : { reason: reading.reason },
        ...record === void 0 ? {} : { binding: cloneBinding(record.state) }
      };
      return row;
    });
  }
  function publishBindings() {
    const event = { type: ADAPTER_EVENTS.bindings, at: nowIso(), data: { bindings: bindings() } };
    try {
      core.events.publish(event);
    } catch (error) {
      log2("adapter runtime could not publish " + ADAPTER_EVENTS.bindings + ": " + describeError(error));
    }
  }
  function publishAdapters() {
    const event = { type: ADAPTER_EVENTS.adapters, at: nowIso(), data: { adapters: adapters() } };
    try {
      core.events.publish(event);
    } catch (error) {
      log2("adapter runtime could not publish " + ADAPTER_EVENTS.adapters + ": " + describeError(error));
    }
  }
  function activationFor(record) {
    return {
      adapterId: record.state.adapterId,
      declaration: record.declaration,
      binding: cloneBinding(record.state),
      baseUrl: record.baseUrl,
      credential: () => record.credential ?? record.credentialSource?.(),
      limits: { ...record.limits }
    };
  }
  function releaseBinding(record) {
    const activation = activationFor(record);
    for (const binder of [...binders].reverse()) {
      if (!record.activeBinderNames.delete(binder.name)) continue;
      try {
        binder.deactivate(activation);
      } catch (error) {
        log2("capability binder " + binder.name + " failed to release adapter " + record.state.adapterId + ": " + describeError(error));
      }
    }
  }
  function readCredential(declaration) {
    const credential = declaration.connect?.credential;
    if (credential === void 0 || credential.kind === "none") return void 0;
    if (credential.kind === "env") {
      const value = process.env[credential.name];
      return value !== void 0 && value.trim() !== "" ? value.trim() : void 0;
    }
    const path = expandTemplate(credential.path, {}, process.env, homedir2());
    if (path === void 0) return void 0;
    let raw;
    try {
      raw = readFileSync7(path, "utf8");
    } catch {
      return void 0;
    }
    try {
      const parsed = JSON.parse(raw);
      const value = readDotPath(parsed, credential.jsonPath);
      return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
    } catch {
      return void 0;
    }
  }
  function credentialLocation(declaration) {
    const credential = declaration.connect?.credential;
    if (credential === void 0 || credential.kind === "none") return "none";
    if (credential.kind === "env") return "the environment variable " + credential.name;
    return credential.path;
  }
  async function verifyDeclaration(declaration, baseUrl, credential) {
    const steps = declaration.connect?.verify ?? [];
    const limits = limitsOf(declaration);
    if (steps.length === 0) {
      log2("adapter " + declaration.id + ": the declaration names no connect.verify step; the binding rests on the identity probe only");
      return;
    }
    for (const step of steps) {
      const path = step.path.startsWith("/") ? step.path : "/" + step.path;
      const url = baseUrl + path;
      const headers = { accept: "application/json, text/plain;q=0.9" };
      if (step.auth === "bearer" && credential !== void 0) headers.authorization = "Bearer " + credential;
      let response;
      try {
        response = await fetch(url, { method: step.method, headers, redirect: "error", signal: AbortSignal.timeout(limits.timeoutMs) });
      } catch (error) {
        throw new AdapterRefusal(ADAPTER_REFUSALS.verifyFailed, declaration.name + ": " + step.method + " " + path + " could not be reached: " + describeError(error).slice(0, 160), declaration.id);
      }
      const expected = step.expectStatus ?? 200;
      if (response.status !== expected) {
        const credentialNote = step.auth === "bearer" ? " (the credential the person allowed was not accepted)" : "";
        throw new AdapterRefusal(ADAPTER_REFUSALS.verifyFailed, declaration.name + ": " + step.method + " " + path + " answered HTTP " + response.status + ", expected " + expected + credentialNote, declaration.id);
      }
    }
  }
  async function loadDeclarations() {
    let entries;
    try {
      entries = await readdir(adaptersDir, { withFileTypes: true });
    } catch (error) {
      log2("adapter declarations directory " + adaptersDir + " can not be read: " + describeError(error));
      return;
    }
    for (const entry of entries.slice().sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      declarationOrder.push(id);
      try {
        const raw = await readFile(join6(adaptersDir, id, "adapter.json"), "utf8");
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error("adapter.json is not JSON: " + describeError(error));
        }
        declarations.set(id, validateDeclaration(id, parsed));
      } catch (error) {
        declarationErrors.set(id, "adapters/" + id + "/adapter.json: " + describeError(error));
      }
    }
  }
  async function probeAll() {
    const readings = [];
    for (const id of declarationOrder) {
      const declaration = declarations.get(id);
      if (declaration === void 0) {
        const reading2 = { adapterId: id, detected: false, reasonCode: "probe-failed", reason: declarationErrors.get(id) ?? "the declaration could not be loaded", at: nowIso() };
        probes.set(id, reading2);
        readings.push(reading2);
        continue;
      }
      const startedAt = Date.now();
      let reading;
      try {
        reading = await probeDeclaration(declaration, probeEnvironment);
      } catch (error) {
        reading = { adapterId: id, detected: false, reasonCode: "probe-failed", reason: "the probe failed: " + describeError(error), at: nowIso() };
      }
      probes.set(id, reading);
      readings.push(reading);
      audit({ kind: "probe", adapter: id, ok: reading.detected, code: reading.detected ? "detected" : "adapter/" + String(reading.reasonCode), ms: Date.now() - startedAt, ...reading.reason === void 0 ? {} : { detail: reading.reason } });
    }
    publishAdapters();
    return readings;
  }
  function probe(adapterId) {
    return probes.get(adapterId);
  }
  async function connectNow(adapterId, connectOptions = {}) {
    if (stopped) throw new AdapterRefusal(ADAPTER_REFUSALS.stopped, "the adapter runtime was stopped; no binding can be made", adapterId);
    const declaration = declarations.get(adapterId);
    if (declaration === void 0) {
      const problem = declarationErrors.get(adapterId);
      if (problem !== void 0) throw new AdapterRefusal(ADAPTER_REFUSALS.invalidDeclaration, problem, adapterId);
      throw new AdapterRefusal(ADAPTER_REFUSALS.unknown, "there is no adapter declaration for " + JSON.stringify(adapterId) + " under " + adaptersDir, adapterId);
    }
    const existing = live.get(adapterId);
    if (existing !== void 0) {
      if (existing.state.status === "active") throw new AdapterRefusal(ADAPTER_REFUSALS.alreadyBound, "adapter " + JSON.stringify(adapterId) + " is already bound; disconnect it before connecting again", adapterId);
      await disconnect(adapterId);
    }
    const startedAt = Date.now();
    const reading = await probeDeclaration(declaration, probeEnvironment);
    probes.set(adapterId, reading);
    publishAdapters();
    audit({ kind: "probe", adapter: adapterId, ok: reading.detected, code: reading.detected ? "detected" : "adapter/" + String(reading.reasonCode), ms: Date.now() - startedAt, ...reading.reason === void 0 ? {} : { detail: reading.reason } });
    if (!reading.detected) {
      throw new AdapterRefusal("adapter/" + String(reading.reasonCode ?? "probe-failed"), reading.reason ?? "adapter " + JSON.stringify(adapterId) + " was not detected", adapterId);
    }
    const detectedBaseUrl = reading.baseUrl ?? expandTemplate(declaration.connect.baseUrl, reading.detail ?? {}, process.env, homedir2()) ?? declaration.connect.baseUrl;
    const baseUrl = detectedBaseUrl.replace(/\/+$/, "");
    const firstCapability = declaration.capabilities[0];
    const consentInput = {
      peerLinkId: "adapter:" + adapterId,
      peerName: declaration.name,
      title: declaration.consent.title,
      capability: firstCapability.kind,
      scopes: [...declaration.consent.scopes],
      detail: {
        adapter: adapterId,
        ...declaration.vendor === void 0 ? {} : { vendor: declaration.vendor },
        baseUrl
      },
      risk: "low"
    };
    connectOptions.onConsent?.({ ...consentInput, id: "adapter:" + adapterId, createdAt: nowIso() });
    const decision = await core.consent.request(consentInput);
    audit({ kind: "consent", adapter: adapterId, cap: firstCapability.kind, ok: decision === "granted", code: decision === "granted" ? "granted" : ADAPTER_REFUSALS.consentDenied, ms: Date.now() - startedAt });
    if (decision !== "granted") {
      throw new AdapterRefusal(ADAPTER_REFUSALS.consentDenied, "the person did not grant " + declaration.name + " access (" + decision + "); nothing was bound", adapterId);
    }
    const receipt = {
      adapterId,
      scopes: [...declaration.consent.scopes],
      consentGrantedAt: nowIso(),
      declarationId: declaration.id,
      declarationVersion: declarationVersion(declaration)
    };
    const declaredCredential = declaration.connect?.credential;
    const credential = readCredential(declaration);
    if (declaredCredential !== void 0 && declaredCredential.kind !== "none" && credential === void 0) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.credentialMissing, declaration.name + " declares its credential at " + credentialLocation(declaration) + " but nothing usable was found there (read only after consent); nothing was bound", adapterId);
    }
    await verifyDeclaration(declaration, baseUrl, credential);
    const boundAt = nowIso();
    const state = {
      id: adapterId,
      adapterId,
      caps: declaration.capabilities.map((capability) => capability.kind),
      status: "active",
      boundAt,
      updatedAt: boundAt,
      failures: 0,
      ...providerIdOf(declaration) === void 0 ? {} : { providerId: providerIdOf(declaration) },
      ...toolNamesOf(declaration) === void 0 ? {} : { toolNames: toolNamesOf(declaration) },
      baseUrl
    };
    const record = { state, declaration, baseUrl, limits: limitsOf(declaration), credential, receipt, activeBinderNames: /* @__PURE__ */ new Set() };
    const activation = activationFor(record);
    const activated = [];
    try {
      for (const binder of binders) {
        if (!binder.caps.some((capability) => state.caps.includes(capability))) continue;
        binder.activate(activation);
        activated.push(binder);
        record.activeBinderNames.add(binder.name);
      }
    } catch (error) {
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation);
        } catch (releaseError) {
          log2("capability binder " + binder.name + " failed to roll back adapter " + adapterId + ": " + describeError(releaseError));
        }
      }
      audit({ kind: "bind", adapter: adapterId, ok: false, code: ADAPTER_REFUSALS.bindFailed, ms: Date.now() - startedAt, detail: describeError(error) });
      throw new AdapterRefusal(ADAPTER_REFUSALS.bindFailed, "binding the capabilities of " + declaration.name + " failed: " + describeError(error), adapterId);
    }
    live.set(adapterId, record);
    try {
      await persist();
    } catch (error) {
      live.delete(adapterId);
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation);
        } catch {
        }
      }
      record.credential = void 0;
      throw new AdapterRefusal(ADAPTER_REFUSALS.persistFailed, "the binding of " + declaration.name + " could not be written to " + stateFile + ": " + describeError(error), adapterId);
    }
    audit({ kind: "bind", adapter: adapterId, cap: state.caps.join(","), ok: true, ms: Date.now() - startedAt, detail: baseUrl });
    publishBindings();
    publishAdapters();
    log2("adapter " + adapterId + " bound: " + state.caps.join(", ") + " at " + baseUrl);
    return cloneBinding(record.state);
  }
  async function connect(adapterId, connectOptions) {
    const running = inFlight.get(adapterId);
    if (running !== void 0) return running;
    const attempt = connectNow(adapterId, connectOptions ?? {});
    inFlight.set(adapterId, attempt);
    try {
      return await attempt;
    } catch (error) {
      audit({ kind: "error", adapter: adapterId, ok: false, ...error instanceof AdapterRefusal ? { code: error.code } : {}, detail: describeError(error) });
      throw error;
    } finally {
      inFlight.delete(adapterId);
    }
  }
  async function disconnect(adapterId) {
    const record = live.get(adapterId);
    if (record === void 0) throw new AdapterRefusal(ADAPTER_REFUSALS.notBound, "adapter " + JSON.stringify(adapterId) + " has no binding to remove", adapterId);
    if (record.externalPeerLinkId !== void 0) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalUnknown, JSON.stringify(adapterId) + " is a peer binding; release it with releaseExternalBinding(id)", adapterId);
    }
    releaseBinding(record);
    record.credential = void 0;
    live.delete(adapterId);
    await persist();
    audit({ kind: "unbind", adapter: adapterId, ok: true });
    publishBindings();
    publishAdapters();
    log2("adapter " + adapterId + " disconnected");
  }
  function registerExternalBinding(input) {
    if (stopped) throw new AdapterRefusal(ADAPTER_REFUSALS.stopped, "the adapter runtime was stopped; no binding can be made");
    if (input === null || typeof input !== "object") throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding() needs one object argument");
    const id = externalText(input.id, "id");
    const adapterId = externalText(input.adapterId, "adapterId");
    const peerLinkId = externalText(input.peerLinkId, "peerLinkId");
    const baseUrl = externalBaseUrl(input.baseUrl);
    const caps = [];
    for (const raw of Array.isArray(input.caps) ? input.caps : []) {
      if (typeof raw === "string" && raw.trim() !== "" && !caps.includes(raw.trim())) caps.push(raw.trim());
    }
    if (caps.length === 0) throw new AdapterRefusal(ADAPTER_REFUSALS.externalInvalid, "registerExternalBinding(): caps must name at least one capability", id);
    const existing = live.get(id);
    if (existing !== void 0) {
      if (existing.externalPeerLinkId === void 0) throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, "a declarative binding already holds the id " + JSON.stringify(id), id);
      if (existing.state.status === "active") throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, "the peer binding " + JSON.stringify(id) + " is already active; release it first", id);
      releaseExternalBinding(id);
    }
    for (const record2 of live.values()) {
      if (record2.state.adapterId !== adapterId) continue;
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalConflict, "adapter id " + JSON.stringify(adapterId) + " is already bound as " + JSON.stringify(record2.state.id), id);
    }
    const providerId = input.providerId === void 0 ? void 0 : externalText(input.providerId, "providerId");
    const credentialSource = externalCredentialSource(input);
    const declaration = externalDeclaration({ adapterId, peerLinkId, caps, baseUrl, ...providerId === void 0 ? {} : { providerId } });
    const boundAt = nowIso();
    const state = {
      id,
      adapterId,
      peerLinkId,
      caps: [...caps],
      status: "active",
      boundAt,
      updatedAt: boundAt,
      failures: 0,
      ...providerId === void 0 ? {} : { providerId },
      baseUrl
    };
    const record = {
      state,
      declaration,
      baseUrl,
      limits: limitsOf(declaration),
      ...credentialSource === void 0 ? {} : { credentialSource },
      externalPeerLinkId: peerLinkId,
      activeBinderNames: /* @__PURE__ */ new Set()
    };
    const activation = activationFor(record);
    const activated = [];
    try {
      for (const binder of binders) {
        if (!binder.caps.some((capability) => caps.includes(capability))) continue;
        binder.activate(activation);
        activated.push(binder);
        record.activeBinderNames.add(binder.name);
      }
    } catch (error) {
      for (const binder of activated.slice().reverse()) {
        try {
          binder.deactivate(activation);
        } catch (releaseError) {
          log2("capability binder " + binder.name + " failed to roll back peer binding " + id + ": " + describeError(releaseError));
        }
      }
      throw new AdapterRefusal(ADAPTER_REFUSALS.bindFailed, "binding the capabilities of peer " + peerLinkId + " failed: " + describeError(error), id);
    }
    live.set(id, record);
    try {
      persistSync();
    } catch (error) {
      live.delete(id);
      releaseBinding(record);
      record.credential = void 0;
      throw new AdapterRefusal(ADAPTER_REFUSALS.persistFailed, "the peer binding " + JSON.stringify(id) + " could not be written to " + stateFile + ": " + describeError(error), id);
    }
    audit({ kind: "bind", peer: peerLinkId, adapter: adapterId, cap: caps.join(","), ok: true, detail: baseUrl });
    publishBindings();
    publishAdapters();
    log2("peer binding " + id + " registered: " + caps.join(", ") + " from " + peerLinkId + " at " + baseUrl);
    return cloneBinding(record.state);
  }
  function releaseExternalBinding(id) {
    const record = live.get(id);
    if (record === void 0 || record.externalPeerLinkId === void 0) {
      throw new AdapterRefusal(ADAPTER_REFUSALS.externalUnknown, "there is no external binding " + JSON.stringify(id) + " to release", id);
    }
    releaseBinding(record);
    record.credential = void 0;
    live.delete(id);
    try {
      persistSync();
    } catch (error) {
      log2("peer binding " + id + " was released but adapters.json could not be rewritten: " + describeError(error));
    }
    audit({ kind: "unbind", peer: record.externalPeerLinkId, adapter: record.state.adapterId, ok: true });
    publishBindings();
    publishAdapters();
    log2("peer binding " + id + " released");
  }
  function markUnavailable(record, reason) {
    releaseBinding(record);
    record.state = { ...record.state, status: "unavailable", updatedAt: nowIso() };
    audit({ kind: "error", adapter: record.state.adapterId, ok: false, code: "adapter/peer-unavailable", detail: reason });
    publishBindings();
    publishAdapters();
    log2("adapter " + record.state.adapterId + " marked unavailable after " + String(record.state.failures) + " failed health checks: " + reason);
  }
  async function healthCheckOnce() {
    for (const record of [...live.values()]) {
      if (record.state.status !== "active") continue;
      if (record.externalPeerLinkId !== void 0) continue;
      const checkedAt = nowIso();
      let failure;
      try {
        await verifyDeclaration(record.declaration, record.baseUrl, record.credential);
      } catch (error) {
        failure = describeError(error);
      }
      const failures = failure === void 0 ? 0 : record.state.failures + 1;
      record.state = { ...record.state, updatedAt: checkedAt, lastCheckAt: checkedAt, failures };
      if (failure === void 0) continue;
      audit({ kind: "probe", adapter: record.state.adapterId, ok: false, code: "adapter/health", detail: failure });
      if (failures >= LIMITS.healthFailures) markUnavailable(record, failure);
    }
    publishBindings();
  }
  function bindingDocument() {
    return {
      version: 2,
      bindings: [...live.values()].map((record) => ({
        ...record.externalPeerLinkId === void 0 ? {} : { external: true, id: record.state.id, peerLinkId: record.externalPeerLinkId },
        adapterId: record.state.adapterId,
        caps: [...record.state.caps],
        ...record.state.providerId === void 0 ? {} : { providerId: record.state.providerId },
        ...record.state.toolNames === void 0 ? {} : { toolNames: [...record.state.toolNames] },
        baseUrl: record.baseUrl,
        boundAt: record.state.boundAt,
        ...record.receipt === void 0 ? {} : {
          receipt: {
            adapterId: record.receipt.adapterId,
            scopes: [...record.receipt.scopes],
            consentGrantedAt: record.receipt.consentGrantedAt,
            declarationId: record.receipt.declarationId,
            declarationVersion: record.receipt.declarationVersion,
            ...record.receipt.revokedAt === void 0 ? {} : { revokedAt: record.receipt.revokedAt }
          }
        }
      }))
    };
  }
  function assertCredentialFree(text) {
    for (const record of live.values()) {
      let secret = record.credential;
      if ((secret === void 0 || secret === "") && record.credentialSource !== void 0) {
        try {
          secret = record.credentialSource();
        } catch {
          secret = void 0;
        }
      }
      if (secret !== void 0 && secret !== "" && text.includes(secret)) {
        throw new Error("refusing to persist adapters.json: it would carry a credential");
      }
    }
  }
  async function persist() {
    await mkdir(core.dir, { recursive: true });
    const text = JSON.stringify(bindingDocument(), null, 2) + "\n";
    assertCredentialFree(text);
    persistCounter += 1;
    const temporary = stateFile + "." + String(process.pid) + "." + String(persistCounter) + ".tmp";
    await writeFile(temporary, text, "utf8");
    await rename(temporary, stateFile);
  }
  function persistSync() {
    mkdirSync6(core.dir, { recursive: true });
    const text = JSON.stringify(bindingDocument(), null, 2) + "\n";
    assertCredentialFree(text);
    persistCounter += 1;
    const temporary = stateFile + "." + String(process.pid) + "." + String(persistCounter) + ".tmp";
    writeFileSync6(temporary, text, "utf8");
    renameSync6(temporary, stateFile);
  }
  async function restoreBindings() {
    let text;
    try {
      text = await readFile(stateFile, "utf8");
    } catch {
      return;
    }
    let document;
    try {
      document = JSON.parse(text);
    } catch (error) {
      log2("ignoring " + stateFile + ": it is not JSON (" + describeError(error) + ")");
      return;
    }
    if (document === null || typeof document !== "object" || !Array.isArray(document.bindings)) {
      log2("ignoring " + stateFile + ": it is not a binding document");
      return;
    }
    const version = document.version;
    if (version !== 1 && version !== 2) {
      log2("ignoring " + stateFile + ": unsupported version " + JSON.stringify(version));
      return;
    }
    const capsOf = (persisted, declaration) => {
      if (Array.isArray(persisted.caps) && persisted.caps.length > 0) return [...persisted.caps];
      return declaration.capabilities.map((capability) => capability.kind);
    };
    const keepRejoin = (persisted, declaration, reason) => {
      const baseUrl = (typeof persisted.baseUrl === "string" && persisted.baseUrl !== "" ? persisted.baseUrl : declaration.connect.baseUrl).replace(/\/+$/, "");
      const boundAt = typeof persisted.boundAt === "string" ? persisted.boundAt : nowIso();
      live.set(persisted.adapterId, {
        state: {
          id: persisted.adapterId,
          adapterId: persisted.adapterId,
          caps: capsOf(persisted, declaration),
          status: "rejoin-required",
          boundAt,
          updatedAt: nowIso(),
          lastCheckAt: nowIso(),
          failures: 0,
          ...persisted.providerId === void 0 ? {} : { providerId: persisted.providerId },
          ...persisted.toolNames === void 0 ? {} : { toolNames: [...persisted.toolNames] },
          baseUrl
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        receipt: { adapterId: persisted.adapterId, scopes: [], consentGrantedAt: "", declarationId: declaration.id, declarationVersion: "" },
        activeBinderNames: /* @__PURE__ */ new Set()
      });
      audit({ kind: "bind", adapter: persisted.adapterId, ok: false, code: "rejoin-required", detail: reason });
      log2("adapter " + persisted.adapterId + " needs to be connected again: " + reason);
    };
    const restoreExternalBinding = (persisted) => {
      const id = typeof persisted.id === "string" && persisted.id !== "" ? persisted.id : persisted.adapterId;
      const peerLinkId = typeof persisted.peerLinkId === "string" ? persisted.peerLinkId : "";
      const caps = Array.isArray(persisted.caps) ? persisted.caps.filter((cap) => typeof cap === "string" && cap !== "") : [];
      if (peerLinkId === "" || caps.length === 0) {
        log2("dropping the persisted peer binding " + id + ": the record is incomplete");
        return;
      }
      let covered = true;
      try {
        covered = caps.every((cap) => core.grants.has(peerLinkId, cap));
      } catch {
        covered = false;
      }
      if (!covered) {
        audit({ kind: "revoke", peer: peerLinkId, adapter: persisted.adapterId, ok: false, code: "peer-binding-revoked", detail: "the persisted peer binding " + id + " was not restored: the grant no longer covers " + caps.join(",") });
        log2("dropping the persisted peer binding " + id + ": the grant for " + peerLinkId + " no longer covers " + caps.join(", "));
        return;
      }
      const baseUrl = (typeof persisted.baseUrl === "string" ? persisted.baseUrl : "").replace(/\/+$/, "");
      const declaration = externalDeclaration({ adapterId: persisted.adapterId, peerLinkId, caps, baseUrl, ...persisted.providerId === void 0 ? {} : { providerId: persisted.providerId } });
      const boundAt = typeof persisted.boundAt === "string" ? persisted.boundAt : nowIso();
      live.set(id, {
        state: {
          id,
          adapterId: persisted.adapterId,
          peerLinkId,
          caps: [...caps],
          status: "rejoin-required",
          boundAt,
          updatedAt: nowIso(),
          lastCheckAt: nowIso(),
          failures: 0,
          ...persisted.providerId === void 0 ? {} : { providerId: persisted.providerId },
          ...persisted.toolNames === void 0 ? {} : { toolNames: [...persisted.toolNames] },
          baseUrl
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        externalPeerLinkId: peerLinkId,
        activeBinderNames: /* @__PURE__ */ new Set()
      });
      audit({ kind: "bind", peer: peerLinkId, adapter: persisted.adapterId, ok: false, code: "rejoin-required", detail: "peer binding restored rejoin-required: the peer session token is not persisted; the ingress re-establishes it (the grant is on record)" });
      log2("peer binding " + id + " restored rejoin-required: awaiting the ingress to re-establish the peer session (no new consent card; the grant is on record)");
    };
    for (const persisted of document.bindings) {
      if (persisted === null || typeof persisted !== "object" || typeof persisted.adapterId !== "string") continue;
      if (persisted.external === true) {
        restoreExternalBinding(persisted);
        continue;
      }
      const declaration = declarations.get(persisted.adapterId);
      if (declaration === void 0) {
        log2("dropping the persisted binding of " + persisted.adapterId + ": its declaration is gone");
        continue;
      }
      if (version === 1) {
        keepRejoin(persisted, declaration, "the persisted binding predates consent receipts (adapters.json version 1); connect again");
        continue;
      }
      const problem = receiptProblem(persisted.receipt, persisted.adapterId, declaration);
      if (problem !== void 0) {
        keepRejoin(persisted, declaration, problem);
        continue;
      }
      const receipt = persisted.receipt;
      const reading = await probeDeclaration(declaration, probeEnvironment);
      probes.set(persisted.adapterId, reading);
      const declaredCredential = declaration.connect?.credential;
      const credential = reading.detected ? readCredential(declaration) : void 0;
      let failure;
      if (!reading.detected) {
        failure = reading.reason ?? "adapter/" + String(reading.reasonCode);
      } else if (declaredCredential !== void 0 && declaredCredential.kind !== "none" && credential === void 0) {
        failure = "the credential the person allowed is no longer readable at " + credentialLocation(declaration);
      } else {
        const baseUrl2 = (reading.baseUrl ?? persisted.baseUrl ?? declaration.connect.baseUrl).replace(/\/+$/, "");
        try {
          await verifyDeclaration(declaration, baseUrl2, credential);
        } catch (error) {
          failure = describeError(error);
        }
      }
      if (failure !== void 0) {
        keepRejoin(persisted, declaration, failure);
        continue;
      }
      const baseUrl = (reading.baseUrl ?? (typeof persisted.baseUrl === "string" ? persisted.baseUrl : declaration.connect.baseUrl)).replace(/\/+$/, "");
      const boundAt = typeof persisted.boundAt === "string" ? persisted.boundAt : nowIso();
      live.set(persisted.adapterId, {
        state: {
          id: persisted.adapterId,
          adapterId: persisted.adapterId,
          caps: capsOf(persisted, declaration),
          status: "active",
          boundAt,
          updatedAt: nowIso(),
          failures: 0,
          ...persisted.providerId === void 0 ? {} : { providerId: persisted.providerId },
          ...persisted.toolNames === void 0 ? {} : { toolNames: [...persisted.toolNames] },
          baseUrl
        },
        declaration,
        baseUrl,
        limits: limitsOf(declaration),
        ...credential === void 0 ? {} : { credential },
        receipt,
        activeBinderNames: /* @__PURE__ */ new Set()
      });
      audit({ kind: "bind", adapter: persisted.adapterId, ok: true, code: "restored-active", detail: baseUrl });
      log2("adapter " + persisted.adapterId + " restored active from " + stateFile);
    }
    await persist().catch((error) => log2("adapters.json could not be rewritten after restore: " + describeError(error)));
    publishAdapters();
    publishBindings();
  }
  function addBinder(binder) {
    binders.push(binder);
    for (const record of [...live.values()]) {
      if (record.state.status !== "active") continue;
      if (!binder.caps.some((capability) => record.state.caps.includes(capability))) continue;
      try {
        binder.activate(activationFor(record));
        record.activeBinderNames.add(binder.name);
      } catch (error) {
        markUnavailable(record, "capability binder " + binder.name + " failed for adapter " + record.state.adapterId + ": " + describeError(error));
      }
    }
    return () => {
      const at = binders.indexOf(binder);
      if (at === -1) return;
      binders.splice(at, 1);
      for (const record of [...live.values()]) {
        if (!record.activeBinderNames.delete(binder.name)) continue;
        try {
          binder.deactivate(activationFor(record));
        } catch (error) {
          log2("capability binder " + binder.name + " failed to release adapter " + record.state.adapterId + ": " + describeError(error));
        }
      }
    };
  }
  function start() {
    if (stopped || timer !== void 0) return;
    timer = setInterval(() => {
      void healthCheckOnce().catch((error) => log2("adapter health sweep failed: " + describeError(error)));
    }, LIMITS.healthMs);
    if (typeof timer.unref === "function") timer.unref();
  }
  function stop() {
    if (timer !== void 0) clearInterval(timer);
    timer = void 0;
    stopped = true;
    for (const record of [...live.values()]) releaseBinding(record);
    binders.length = 0;
  }
  await loadDeclarations();
  await probeAll();
  await restoreBindings();
  return {
    probeAll,
    probe,
    connect,
    disconnect,
    bindings,
    adapters,
    routes: () => [],
    start,
    stop,
    addBinder,
    healthCheckOnce,
    declaration: (adapterId) => declarations.get(adapterId),
    registerExternalBinding,
    releaseExternalBinding
  };
}

// plugins/dsh-link-interconnect/src/http/client.ts
var methodOf = (req) => String(req.method ?? "GET").toUpperCase();
function createClientRoutes(options) {
  const core = options.core;
  const log2 = options.log ?? core.log;
  const io = createHttpIo();
  const table = createRouteTable(io, {
    onError(error) {
      log2("client route failed: " + String(error instanceof Error ? error.message : error));
    }
  });
  const requireActions = () => {
    if (options.actions === void 0) throw refuse("link/peer-unavailable", "adapter actions are not wired yet");
    return options.actions;
  };
  const verbRoutes = (path, handlers) => table.anyExact(path, async (req, res) => {
    const handler = handlers[methodOf(req)];
    if (handler !== void 0) {
      await handler(req, res);
      return;
    }
    const methods = Object.keys(handlers);
    res.setHeader("Allow", methods.join(", "));
    io.sendError(res, 405, "link/method-not-allowed", "method not allowed; use " + methods.join(" or "));
  });
  const answerActionFailure = (error, res) => {
    if (isLinkError(error)) return false;
    const body = adapterRefusalBody(error);
    if (body.error.code === "adapter/internal") return false;
    const reasonFromError = error?.reasonCode;
    const reasonCode = typeof reasonFromError === "string" ? reasonFromError : body.error.code.includes("/") ? body.error.code.split("/")[1] : null;
    io.sendJson(res, 409, { ok: false, error: { ...body.error, ...reasonCode === null ? {} : { details: { reasonCode } } } });
    return true;
  };
  const routes = [
    table.exact("GET", ROUTES.state, (_req, res) => {
      io.sendJson(res, 200, options.snapshot());
    }),
    verbRoutes(ROUTES.consent, {
      GET: (_req, res) => {
        io.sendJson(res, 200, { ok: true, pending: core.consent.listPending() });
      },
      POST: async (req, res) => {
        const body = await io.readJson(req);
        const id = typeof body.id === "string" ? body.id : "";
        const decision = body.decision;
        if (id === "") throw refuse("link/bad-request", "id is required");
        if (decision !== "granted" && decision !== "denied") throw refuse("link/bad-request", "decision must be granted or denied");
        if (!core.consent.decide(id, decision)) throw refuse("link/not-found", "unknown consent request " + id);
        io.sendJson(res, 200, { ok: true });
      }
    }),
    table.exact("GET", ROUTES.audit, (_req, res) => {
      const { query } = io.parseUrl(_req);
      const asked = Number(query.get("limit") ?? "100");
      const limit = Number.isFinite(asked) ? Math.min(500, Math.max(1, Math.floor(asked))) : 100;
      io.sendJson(res, 200, { ok: true, records: core.audit.list(limit) });
    }),
    verbRoutes(ROUTES.adapters, {
      GET: (_req, res) => {
        io.sendJson(res, 200, { ok: true, adapters: options.snapshot().adapters });
      },
      POST: async (req, res) => {
        const body = await io.readJson(req);
        const op = typeof body.op === "string" ? body.op : "";
        const id = typeof body.id === "string" ? body.id : "";
        const actions = requireActions();
        try {
          if (op === "probe") {
            io.sendJson(res, 200, { ok: true, result: await actions.probeAll() });
            return;
          }
          if (op === "connect" || op === "disconnect" || op === "revoke-peer") {
            if (id === "") throw refuse("link/bad-request", "id is required for op " + op);
            if (op === "connect") {
              io.sendJson(res, 200, { ok: true, result: await actions.connect(id) });
              return;
            }
            if (op === "disconnect") {
              await actions.disconnect(id);
              io.sendJson(res, 200, { ok: true, result: { disconnected: true } });
              return;
            }
            io.sendJson(res, 200, { ok: true, result: await actions.revokePeer(id) });
            return;
          }
          throw refuse("link/bad-request", "unknown adapters op " + JSON.stringify(op) + "; use probe, connect, disconnect or revoke-peer");
        } catch (error) {
          if (answerActionFailure(error, res)) return;
          throw error;
        }
      }
    }),
    table.exact("GET", ROUTES.settings, (_req, res) => {
      io.sendJson(res, 200, {
        ok: true,
        linkId: core.identity.linkId,
        protocol: PROTOCOL_ID,
        contractVersion: CONTRACT_VERSION,
        dir: core.dir,
        pairingFile: core.dir + "/pairing.json",
        scopes: [...SCOPES],
        limits: { ...LIMITS },
        routes: ROUTES
      });
    })
  ];
  return {
    routes() {
      return routes.slice();
    },
    async start() {
      log2("client routes ready (" + String(routes.length) + ")");
    }
  };
}

// plugins/dsh-link-interconnect/src/bind/peer.ts
function describeError2(error) {
  return error instanceof Error ? error.message : String(error);
}
var MODEL_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
function peerToolName(declared, taken) {
  const cleaned = String(declared).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  const base = cleaned === "" ? "peer_tool" : /^[A-Za-z0-9]/.test(cleaned) ? cleaned : "t_" + cleaned;
  if (taken === void 0) return base;
  let name2 = base;
  let suffix = 2;
  while (taken.has(name2)) {
    const room = 64 - String(suffix).length - 1;
    name2 = base.slice(0, room) + "_" + String(suffix);
    suffix += 1;
  }
  taken.add(name2);
  return name2;
}
function renderValue(value) {
  if (typeof value === "string") return value;
  const text = JSON.stringify(value, null, 2);
  return text === void 0 ? String(value) : text;
}
function peerInvokeUrl(target) {
  const path = target.invokePath === void 0 || target.invokePath === "" ? ROUTES.invoke : target.invokePath;
  const absolute = path.startsWith("/") ? path : "/" + path;
  return target.origin.replace(/\/+$/, "") + absolute;
}
function peerInvokeBody(tool, args) {
  const call = tool.call ?? { cap: CAPS.toolsExpose, op: tool.name };
  return { cap: call.cap, op: call.op, args: args === void 0 ? {} : args };
}
function peerInvokeRequest(target, tool, args) {
  return {
    url: peerInvokeUrl(target),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: "Bearer " + target.token
    },
    body: JSON.stringify(peerInvokeBody(tool, args))
  };
}
async function invokePeerTool(target, tool, args, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = target.timeoutMs !== void 0 && target.timeoutMs > 0 ? target.timeoutMs : LIMITS.timeoutMs;
  const request = peerInvokeRequest(target, tool, args);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("the peer request exceeded " + String(timeoutMs) + " ms")), timeoutMs);
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: "error"
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    throw new Error("link/peer-unavailable: " + request.url + " did not answer (" + describeError2(error) + ")");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
  let text;
  try {
    text = await response.text();
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    throw new Error("link/peer-unavailable: the answer from " + request.url + " was unreadable (" + describeError2(error) + ")");
  }
  let envelope;
  if (text.trim() !== "") {
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) envelope = parsed;
    } catch {
      envelope = void 0;
    }
  }
  if (envelope !== void 0 && envelope.ok === false) {
    const code = typeof envelope.error?.code === "string" && envelope.error.code !== "" ? envelope.error.code : "link/internal";
    const message = typeof envelope.error?.message === "string" && envelope.error.message !== "" ? envelope.error.message : "the peer refused the call";
    throw new Error(code + ": " + message);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("link/peer-unavailable: the peer answered HTTP " + String(response.status) + " for " + JSON.stringify(tool.name));
  }
  if (envelope === void 0 || envelope.ok !== true) {
    throw new Error("link/internal: the peer answered no protocol envelope for " + JSON.stringify(tool.name));
  }
  return envelope.result === void 0 ? null : envelope.result;
}
function createPeerToolHandler(target, tool, options = {}) {
  return async (args, exec) => invokePeerTool(target, tool, args, { fetch: options.fetch, signal: exec?.signal });
}
function createPeerToolDefinition(target, tool, options = {}) {
  const parameters = tool.parameters !== null && typeof tool.parameters === "object" && !Array.isArray(tool.parameters) ? tool.parameters : { type: "object", properties: {} };
  const publicName = peerToolName(tool.name);
  const declaredNote = MODEL_TOOL_NAME.test(tool.name) ? "" : " (peer tool " + tool.name + ")";
  return {
    name: publicName,
    description: (typeof tool.description === "string" ? tool.description : "") + declaredNote,
    parameters,
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: renderValue(value) }]
    },
    execute: createPeerToolHandler(target, tool, options)
  };
}
function registerPeerTools(options) {
  const log2 = options.log ?? (() => {
  });
  const disposers = [];
  const taken = /* @__PURE__ */ new Set();
  try {
    for (const tool of options.declarations) {
      const definition = createPeerToolDefinition(options.target, tool, { fetch: options.fetch });
      definition.name = peerToolName(tool.name, taken);
      disposers.push(options.host.register(definition));
    }
  } catch (error) {
    for (const dispose of disposers.slice().reverse()) {
      try {
        dispose();
      } catch {
      }
    }
    throw error;
  }
  log2("tools registered from peer " + options.target.peerLinkId + ": " + options.declarations.map((tool) => tool.name).join(", "));
  return () => {
    for (const dispose of disposers.slice().reverse()) {
      try {
        dispose();
      } catch (error) {
        log2("releasing a tool of peer " + options.target.peerLinkId + " failed: " + describeError2(error));
      }
    }
  };
}

// plugins/dsh-link-interconnect/src/adapters/ingress.ts
var PEERS_ROUTE = API_PREFIX + "/peers";
var WELL_KNOWN_PATH = "/.well-known/link-interconnect.json";
var MANIFEST_TIMEOUT_MS = 8e3;
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function normalizeAllowlistEntry(entry) {
  const text = String(entry ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return text === "" ? void 0 : text;
}
function allowlisted(host, port, allowlist) {
  const name2 = host.toLowerCase();
  const authority = port === "" ? name2 : name2 + ":" + port;
  return allowlist.some((entry) => entry === name2 || entry === authority || port === "" && entry === name2 + ":80" || port === "" && entry === name2 + ":443");
}
function describeError3(error) {
  return error instanceof Error ? error.message : String(error);
}
function peerOriginOf(raw, allowlist = []) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? "").trim());
  } catch (error) {
    throw refuse(ERROR_CODES.badRequest, "peer url is not an absolute URL: " + String(raw ?? ""));
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw refuse(ERROR_CODES.badRequest, "peer url must be http(s)");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw refuse(ERROR_CODES.badRequest, "peer url carries a path; give its origin only");
  }
  const host = parsed.hostname;
  const port = parsed.port;
  if (!LOOPBACK_HOSTS.has(host) && allowlisted(host, port, allowlist) === false) {
    throw refuse(ERROR_CODES.badRequest, "peer " + (port === "" ? host : host + ":" + port) + " is not loopback and is not named by the LAN allowlist (link-interconnect/lan-allowlist.json or LINK_PEER_ALLOWLIST)");
  }
  return parsed.origin;
}
async function fetchPeerManifest(origin, log2) {
  let answer;
  try {
    answer = await fetch(origin + WELL_KNOWN_PATH, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + " did not answer " + WELL_KNOWN_PATH + " (" + describeError3(error) + ")");
  }
  if (answer.status !== 200) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + WELL_KNOWN_PATH + " answered HTTP " + String(answer.status));
  }
  let parsed;
  try {
    parsed = await answer.json();
  } catch (error) {
    throw refuse(ERROR_CODES.peerUnavailable, origin + " answered no JSON declaration");
  }
  const manifest = parsed;
  assertPeerManifest(manifest, origin, log2);
  return manifest;
}
function assertPeerManifest(manifest, origin, log2) {
  if (manifest === null || typeof manifest !== "object") throw refuse(ERROR_CODES.badRequest, origin + " served no declaration object");
  const protocol = typeof manifest.protocol === "string" ? manifest.protocol : "";
  const parts = protocol.split("/");
  const major = parts.length === 2 && /^[0-9]+$/.test(parts[1]) ? Number(parts[1]) : Number.NaN;
  if (parts[0] !== "link-interconnect" || Number.isNaN(major)) {
    throw refuse(ERROR_CODES.versionUnsupported, origin + " declares protocol " + JSON.stringify(protocol));
  }
  if (major !== PROTOCOL_MAJOR) {
    throw refuse(ERROR_CODES.versionUnsupported, origin + " speaks link-interconnect/" + String(major) + ", this build speaks " + PROTOCOL_ID);
  }
  const identity = manifest.identity;
  if (identity === null || typeof identity !== "object" || typeof identity.linkId !== "string" || identity.linkId.trim() === "" || typeof identity.name !== "string" || identity.name.trim() === "") {
    throw refuse(ERROR_CODES.badRequest, origin + " declaration names no identity.linkId/identity.name");
  }
  const invoke = manifest.endpoints === null || typeof manifest.endpoints !== "object" ? void 0 : manifest.endpoints.invoke;
  if (typeof invoke !== "string" || invoke.trim() === "" || !invoke.trim().startsWith("/")) {
    throw refuse(ERROR_CODES.badRequest, origin + " declaration names no absolute endpoints.invoke path");
  }
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const known = declared.filter((cap) => cap !== null && typeof cap === "object" && DECLARED_KINDS.has(String(cap.kind)));
  if (known.length === 0) throw refuse(ERROR_CODES.badRequest, origin + " declares no known capability");
  for (const cap of declared) {
    const kind = cap !== null && typeof cap === "object" ? String(cap.kind) : "";
    if (DECLARED_KINDS.has(kind) === false) log2("peer " + identity.linkId + " declares unknown capability " + JSON.stringify(kind) + "; ignored");
  }
}
var DECLARED_KINDS = /* @__PURE__ */ new Set([CAPS.modelsProvide, CAPS.toolsExpose]);
function peerScopesOf(manifest) {
  const scopes = /* @__PURE__ */ new Set();
  for (const cap of manifest.capabilities) {
    if (DECLARED_KINDS.has(String(cap.kind)) === false) continue;
    const named = Array.isArray(cap.scopes) ? cap.scopes : [];
    for (const scope of named) {
      if (SCOPES.includes(String(scope))) scopes.add(String(scope));
    }
    scopes.add(String(cap.kind));
  }
  return [...scopes].filter((scope) => SCOPES.includes(scope));
}
function peerToolsOf(manifest) {
  const tools = [];
  for (const cap of manifest.capabilities) {
    if (String(cap.kind) !== CAPS.toolsExpose) continue;
    const declared = Array.isArray(cap.tools) ? cap.tools : [];
    for (const tool of declared) {
      if (tool !== null && typeof tool === "object" && typeof tool.name === "string" && tool.name.trim() !== "") tools.push(tool);
    }
  }
  return tools;
}
function peerModelsDeclared(manifest) {
  return manifest.capabilities.some((cap) => cap !== null && typeof cap === "object" && String(cap.kind) === CAPS.modelsProvide);
}
function providerIdOf2(linkId) {
  return String(linkId).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 48) || "peer";
}
function createPeerIngress(options) {
  const { core, io, hosts, runtime } = options;
  const log2 = options.log;
  const allowlist = (options.peerAllowlist ?? []).map((entry) => normalizeAllowlistEntry(entry)).filter((entry) => entry !== void 0);
  const sessions = /* @__PURE__ */ new Map();
  const table = createRouteTable(io, { onError: (error) => log2("peer route failed: " + describeError3(error)) });
  const rowOf = (session) => {
    const record = core.peers.get(session.linkId);
    return {
      linkId: session.linkId,
      name: session.name,
      vendor: record?.vendor,
      origin: session.origin,
      scopes: [...record?.scopes ?? []],
      tools: [...session.tools],
      providerId: session.providerId,
      status: record?.status ?? "unknown"
    };
  };
  const modelsOf = async (providerId) => {
    const llm = hosts.llm?.();
    if (llm === void 0 || llm === null || typeof llm.listModels !== "function") return [];
    try {
      const rows = await llm.listModels(providerId);
      const ids = (Array.isArray(rows) ? rows : []).map((row) => String(row?.id ?? "")).filter((id) => id !== "");
      return ids;
    } catch (error) {
      log2("listing models of " + providerId + " failed: " + describeError3(error));
      return [];
    }
  };
  const list = () => [...sessions.values()].map(rowOf);
  const releaseSession = (session) => {
    if (session.disposeTools !== void 0) {
      try {
        session.disposeTools();
      } catch (error) {
        log2("releasing tools of peer " + session.linkId + " failed: " + describeError3(error));
      }
      session.disposeTools = void 0;
    }
    if (session.bindingId !== void 0) {
      try {
        runtime.releaseExternalBinding(session.bindingId);
      } catch (error) {
        log2("releasing the model binding of peer " + session.linkId + " failed: " + describeError3(error));
      }
      session.bindingId = void 0;
    }
  };
  const addPeer = async (input) => {
    const origin = peerOriginOf(input.url, allowlist);
    const manifest = await fetchPeerManifest(origin, log2);
    const linkId = manifest.identity.linkId.trim();
    const name2 = manifest.identity.name.trim();
    if (sessions.has(linkId)) throw refuse(ERROR_CODES.badRequest, "peer " + linkId + " is already added; remove it first");
    const scopes = peerScopesOf(manifest);
    const tools = peerToolsOf(manifest);
    const models = peerModelsDeclared(manifest);
    const kinds = [tools.length > 0 ? CAPS.toolsExpose : void 0, models ? CAPS.modelsProvide : void 0].filter((kind) => kind !== void 0);
    const decision = await core.consent.request({
      peerLinkId: linkId,
      peerName: name2,
      title: "\u63A5\u5165 " + name2 + " \u7684" + (tools.length > 0 ? "\u5DE5\u5177" : "") + (tools.length > 0 && models ? "\u4E0E" : "") + (models ? "\u6A21\u578B" : ""),
      capability: kinds.join("+"),
      scopes,
      detail: {
        origin,
        tools: tools.length > 0 ? tools.map((tool) => tool.name).join(", ") : "\u65E0",
        models: models ? "OpenAI \u517C\u5BB9\u6A21\u578B\u901A\u9053" : "\u65E0"
      },
      risk: tools.length > 0 ? "medium" : "low"
    });
    core.audit.record({ kind: "consent", peer: linkId, cap: kinds.join("+"), ok: decision === "granted", detail: "peer at " + origin });
    if (decision !== "granted") throw refuse(ERROR_CODES.consentRequired, "the person denied access to " + name2);
    const minted = core.tokens.mint({ sub: linkId, aud: origin, scope: scopes, ttlMs: LIMITS.accessTokenMs });
    const session = { linkId, name: name2, origin, token: minted.token, tools: tools.map((tool) => tool.name) };
    sessions.set(linkId, session);
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      core.peers.upsert({
        linkId,
        name: name2,
        vendor: typeof manifest.identity.vendor === "string" ? manifest.identity.vendor : void 0,
        platform: "software",
        pub: "manifest-only",
        scopes,
        status: "active",
        transport: "loopback",
        baseUrl: origin,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now
      });
      core.grants.grant({ peerLinkId: linkId, scopes, rpm: manifest.limits?.rpm ?? LIMITS.rpm, grantedAt: now, grantedBy: "user" });
      if (tools.length > 0) {
        const toolHost = hosts.tools?.();
        if (toolHost === void 0 || toolHost === null || typeof toolHost.register !== "function") {
          throw refuse(ERROR_CODES.internal, "the kernel tool registry is not mounted; cannot bind " + name2 + " tools");
        }
        session.disposeTools = registerPeerTools({
          host: toolHost,
          target: { peerLinkId: linkId, origin, invokePath: manifest.endpoints.invoke, token: minted.token, timeoutMs: LIMITS.timeoutMs },
          declarations: tools,
          log: log2
        });
        core.audit.record({ kind: "bind", peer: linkId, cap: CAPS.toolsExpose, ok: true, detail: tools.map((tool) => tool.name).join(", ") });
      }
      if (models) {
        const binding = runtime.registerExternalBinding({
          id: "peer:" + linkId,
          adapterId: "peer:" + linkId,
          peerLinkId: linkId,
          caps: [CAPS.modelsProvide],
          baseUrl: origin,
          providerId: providerIdOf2(linkId),
          apiKey: minted.token
        });
        session.bindingId = binding.id;
        session.providerId = binding.providerId ?? providerIdOf2(linkId);
        core.audit.record({ kind: "bind", peer: linkId, cap: CAPS.modelsProvide, ok: true, detail: session.providerId });
      }
      core.events.publish({ type: "interconnect/peers", at: now, data: { linkId, tools: session.tools, providerId: session.providerId ?? null } });
      log2("peer " + linkId + " (" + name2 + ") bound at " + origin + ": " + String(session.tools.length) + " tool(s)" + (models ? ", 1 model channel" : ""));
      return rowOf(session);
    } catch (error) {
      releaseSession(session);
      sessions.delete(linkId);
      try {
        core.grants.revoke(linkId);
        core.peers.remove(linkId);
      } catch (cleanupError) {
        log2("rolling back peer " + linkId + " failed: " + describeError3(cleanupError));
      }
      core.audit.record({ kind: "error", peer: linkId, ok: false, code: error instanceof Error && "code" in error ? String(error.code) : ERROR_CODES.internal, detail: describeError3(error).slice(0, 200) });
      throw error;
    }
  };
  const removePeer = (linkId) => {
    const session = sessions.get(String(linkId));
    if (session === void 0) return { removed: false };
    releaseSession(session);
    sessions.delete(session.linkId);
    core.grants.revoke(session.linkId);
    core.peers.remove(session.linkId);
    core.audit.record({ kind: "revoke", peer: session.linkId, ok: true, detail: "peer removed from " + session.origin });
    core.events.publish({ type: "interconnect/peers", at: (/* @__PURE__ */ new Date()).toISOString(), data: { linkId: session.linkId, removed: true } });
    log2("peer " + session.linkId + " removed");
    return { removed: true };
  };
  const route = table.anyExact(PEERS_ROUTE, async (req, res) => {
    if (req.method === "GET") {
      const rows = [];
      for (const session of sessions.values()) {
        const row = rowOf(session);
        if (row.providerId !== void 0) row.models = await modelsOf(row.providerId);
        rows.push(row);
      }
      io.sendJson(res, 200, { ok: true, result: rows });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      io.sendError(res, 405, ERROR_CODES.methodNotAllowed, "peers are read with GET and written with POST");
      return;
    }
    const body = await io.readJson(req);
    const op = String(body.op ?? "add");
    if (op === "add") {
      io.sendJson(res, 200, { ok: true, result: await addPeer({ url: String(body.url ?? "") }) });
      return;
    }
    if (op === "remove") {
      io.sendJson(res, 200, { ok: true, result: removePeer(String(body.id ?? "")) });
      return;
    }
    io.sendError(res, 400, ERROR_CODES.badRequest, "unknown peers op " + op);
  });
  return {
    routes: () => [route],
    start() {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const record of core.peers.list()) {
        if (record.status !== "active") continue;
        core.peers.update(record.linkId, { status: "rejoin-required" });
        core.audit.record({ kind: "error", peer: record.linkId, ok: false, code: "link/consent-required", detail: "peer session token is memory-only; re-add after restart" });
        log2("peer " + record.linkId + " restored as rejoin-required (its bearer token is memory-only)");
        void now;
      }
    },
    stop() {
      for (const session of [...sessions.values()]) releaseSession(session);
      sessions.clear();
    },
    list,
    addPeer,
    removePeer
  };
}

// plugins/dsh-link-interconnect/src/bind/embed.ts
import { randomBytes as randomBytes5 } from "node:crypto";
import { existsSync as existsSync7, mkdirSync as mkdirSync7, readFileSync as readFileSync8, renameSync as renameSync7, writeFileSync as writeFileSync7 } from "node:fs";
import { join as join7 } from "node:path";
var EMBED_SCOPE = "embed.session";
var EMBED_MODES = Object.freeze(["sidebar", "full"]);
var SESSIONS_FILE = "embed-sessions.json";
var SESSIONS_MAX = 256;
var SESSION_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,128}$/;
var NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function jsLiteral(value) {
  const lineSeparator = String.fromCharCode(8232);
  const paragraphSeparator = String.fromCharCode(8233);
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(lineSeparator, "\\u2028").replaceAll(paragraphSeparator, "\\u2029");
}
function isLoopbackHostname(hostname) {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (bare === "localhost" || bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}
function validateEmbedOrigin(value) {
  if (typeof value !== "string") throw refuse("link/bad-request", "origin must be the string form of one http(s) origin");
  const text = value.trim();
  if (text === "") throw refuse("link/bad-request", "origin is required for an embed token");
  if (text.includes("*")) throw refuse("link/bad-request", "origin must be one exact origin, not a pattern");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw refuse("link/bad-request", "origin is not a parseable URL: " + JSON.stringify(text));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw refuse("link/bad-request", "origin must use http or https");
  if (url.username !== "" || url.password !== "") throw refuse("link/bad-request", "origin must not carry userinfo");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") throw refuse("link/bad-request", "origin must not carry a path, query or fragment");
  if (url.hostname === "") throw refuse("link/bad-request", "origin has no host");
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw refuse("link/bad-request", "an embed origin that is not loopback must use https");
  }
  return url.origin;
}
function readSessionId(value) {
  if (typeof value !== "string") throw refuse("link/bad-request", "sessionId must be a string");
  const text = value.trim();
  if (!SESSION_ID_PATTERN.test(text)) throw refuse("link/bad-request", "sessionId must be 1-128 characters of letters, digits and . _ : @ / -");
  return text;
}
function readMode(value) {
  if (value === "sidebar" || value === "full") return value;
  throw refuse("link/bad-request", "mode must be one of " + EMBED_MODES.join(", "));
}
function requestOrigin(req) {
  const raw = req.headers["origin"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    throw refuse("link/unauthorized", "the embed session request carries no Origin header; the token is addressed to one exact origin");
  }
  try {
    return validateEmbedOrigin(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw refuse("link/unauthorized", "the embed session Origin header is not a usable origin: " + message);
  }
}
function buildEmbedDocument(record) {
  const facts = "Session " + escapeHtml(record.sessionId) + " - mode " + escapeHtml(record.mode);
  return [
    "<!doctype html>",
    '<html lang="en" data-link-embed="v2" data-session-id="' + escapeHtml(record.sessionId) + '" data-mode="' + escapeHtml(record.mode) + '">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="link:embed" content="v2">',
    '<meta name="link:embed:session" content="' + escapeHtml(record.sessionId) + '">',
    '<meta name="link:embed:mode" content="' + escapeHtml(record.mode) + '">',
    "<title>LINK session</title>",
    "<style>",
    ":root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }",
    "body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }",
    "code { font-family: ui-monospace, monospace; }",
    ".status { margin-top: 8px; opacity: .8; }",
    "</style>",
    "</head>",
    '<body data-link-embed="v2" data-session-id="' + escapeHtml(record.sessionId) + '" data-mode="' + escapeHtml(record.mode) + '">',
    "<main>",
    "<h1>LINK session</h1>",
    '<p id="link-embed-facts">' + facts + "</p>",
    '<p id="link-embed-status" class="status">Waiting for the parent window to acknowledge this embed.</p>',
    "</main>",
    "<script>",
    "(function () {",
    "  'use strict';",
    "  var nonce = " + jsLiteral(record.nonce) + ";",
    "  var parentOrigin = " + jsLiteral(record.origin) + ";",
    "  var sessionId = " + jsLiteral(record.sessionId) + ";",
    "  var mode = " + jsLiteral(record.mode) + ";",
    "  function setStatus(text) {",
    "    var element = document.getElementById('link-embed-status');",
    "    if (element !== null) element.textContent = text;",
    "  }",
    "  if (window.parent === window) {",
    "    setStatus('This document only runs inside a LINK frame: it is not framed, so it does not connect to the parent and refuses to start.');",
    "    return;",
    "  }",
    "  try {",
    "    window.parent.postMessage({ type: 'link:embed:ready', v: 1, nonce: nonce, sessionId: sessionId, mode: mode }, parentOrigin);",
    "    setStatus('LINK embed ready: posted link:embed:ready to ' + parentOrigin + '.');",
    "  } catch (error) {",
    "    setStatus('LINK embed could not post to ' + parentOrigin + ': ' + String(error && error.message !== undefined ? error.message : error));",
    "  }",
    "}());",
    "</script>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}
function embedCsp(origin) {
  return "frame-ancestors " + origin + "; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'";
}
function loadSessions(file, log2) {
  const sessions = /* @__PURE__ */ new Map();
  if (!existsSync7(file)) return sessions;
  try {
    const stored = JSON.parse(readFileSync8(file, "utf8"));
    if (!Array.isArray(stored.sessions)) return sessions;
    const now = Date.now();
    for (const entry of stored.sessions) {
      if (typeof entry?.jti !== "string" || typeof entry?.sessionId !== "string" || typeof entry?.origin !== "string") continue;
      if (entry.mode !== "sidebar" && entry.mode !== "full") continue;
      if (typeof entry.nonce !== "string" || typeof entry.expiresAt !== "string") continue;
      if (!(Date.parse(entry.expiresAt) > now)) continue;
      sessions.set(entry.jti, { jti: entry.jti, sessionId: entry.sessionId, mode: entry.mode, origin: entry.origin, nonce: entry.nonce, expiresAt: entry.expiresAt });
    }
    log2("embed mint ledger restored: " + String(sessions.size) + " live session(s)");
  } catch (error) {
    log2("embed mint ledger is unreadable (" + String(error instanceof Error ? error.message : String(error)) + "); starting empty");
  }
  return sessions;
}
function persistSessions(file, sessions) {
  const now = Date.now();
  const live = [...sessions.values()].filter((record) => Date.parse(record.expiresAt) > now);
  live.sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt));
  const bounded = live.length > SESSIONS_MAX ? live.slice(live.length - SESSIONS_MAX) : live;
  sessions.clear();
  for (const record of bounded) sessions.set(record.jti, record);
  const temp = file + "." + String(process.pid) + ".tmp";
  writeFileSync7(temp, JSON.stringify({ version: 1, sessions: bounded }, null, 2) + "\n");
  renameSync7(temp, file);
}
function createEmbedSubsystem(options) {
  const { core, io, log: log2 } = options;
  mkdirSync7(core.dir, { recursive: true });
  const file = join7(core.dir, SESSIONS_FILE);
  const sessions = loadSessions(file, log2);
  const table = createRouteTable(io);
  const mintRoute = table.exact("POST", ROUTES.embedToken, async (req, res) => {
    const body = await io.readJson(req);
    const sessionId = readSessionId(body.sessionId);
    const mode = readMode(body.mode);
    const origin = validateEmbedOrigin(body.origin);
    const minted = core.tokens.mint({ sub: "session:" + sessionId, aud: origin, scope: [EMBED_SCOPE], ttlMs: LIMITS.embedTokenMs });
    const nonce = randomBytes5(16).toString("base64url");
    sessions.set(minted.jti, { jti: minted.jti, sessionId, mode, origin, nonce, expiresAt: minted.expiresAt });
    persistSessions(file, sessions);
    const url = ROUTES.embedSession + "?token=" + encodeURIComponent(minted.token) + "&nonce=" + encodeURIComponent(nonce);
    io.sendJson(res, 200, { token: minted.token, expiresAt: minted.expiresAt, url });
    log2("embed token minted session=" + sessionId + " mode=" + mode + " aud=" + origin + " ttlMs=" + String(LIMITS.embedTokenMs));
  });
  const sessionRoute = table.exact("GET", ROUTES.embedSession, async (req, res) => {
    const { query } = io.parseUrl(req);
    const token = (query.get("token") ?? "").trim();
    if (token === "") throw refuse("link/unauthorized", "an embed session request needs its token query parameter");
    const origin = requestOrigin(req);
    const verdict = core.tokens.verify(token, { aud: origin, scope: EMBED_SCOPE });
    if (!verdict.ok) throw refuse("link/unauthorized", "embed token rejected: " + verdict.message);
    const claims = verdict.claims;
    let record = sessions.get(claims.jti);
    if (record === void 0) {
      if (!claims.sub.startsWith("session:")) throw refuse("link/unauthorized", "embed token subject does not name a session");
      const sessionId = claims.sub.slice("session:".length);
      if (!SESSION_ID_PATTERN.test(sessionId)) throw refuse("link/unauthorized", "embed token subject is not a session id");
      const nonce = (query.get("nonce") ?? "").trim();
      if (!NONCE_PATTERN.test(nonce)) throw refuse("link/unauthorized", "embed session nonce is missing or malformed");
      record = { jti: claims.jti, sessionId, mode: "full", origin: claims.aud, nonce, expiresAt: new Date(claims.exp * 1e3).toISOString() };
    } else {
      const nonce = (query.get("nonce") ?? "").trim();
      if (nonce !== record.nonce) throw refuse("link/unauthorized", "embed session nonce does not match the minted token");
    }
    const document = buildEmbedDocument(record);
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", embedCsp(record.origin));
    res.end(document);
    log2("embed session served session=" + record.sessionId + " mode=" + record.mode + " aud=" + record.origin);
  });
  let started = false;
  return {
    file,
    routes() {
      return [mintRoute, sessionRoute];
    },
    async start() {
      if (started) return;
      started = true;
      log2("embed v2 ready (sessions=" + String(sessions.size) + ")");
    },
    async stop() {
      started = false;
    }
  };
}

// plugins/dsh-link-interconnect/src/bind/proxy.ts
import { createHash as createHash4, randomBytes as randomBytes6 } from "node:crypto";
import { existsSync as existsSync8, mkdirSync as mkdirSync8, readFileSync as readFileSync9, renameSync as renameSync8, writeFileSync as writeFileSync8 } from "node:fs";
import { join as join8 } from "node:path";
var KEYS_FILE = "proxy-keys.json";
var KEY_PREFIX = "lk_";
var KEY_PATTERN = /^lk_[A-Za-z0-9_-]{32,}$/;
var KEY_BYTES2 = 32;
var LABEL_MAX = 120;
var MODEL_MAX = 200;
var MODELS_MAX = 64;
var RPM_MAX = 6e4;
var activeStore;
function sha256(key) {
  return createHash4("sha256").update(key, "utf8").digest("hex");
}
function viewOf(record) {
  const view = { id: record.id, label: record.label, models: [...record.models], rpm: record.rpm, createdAt: record.createdAt };
  if (record.revokedAt !== void 0) view.revokedAt = record.revokedAt;
  return view;
}
function readKeyInput(input) {
  if (input === null || typeof input !== "object") throw new TypeError("createProxyKey needs {label, models, rpm?}");
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label === "" || label.length > LABEL_MAX) throw new TypeError("proxy key label must be 1-" + String(LABEL_MAX) + " characters");
  if (!Array.isArray(input.models) || input.models.length === 0) throw new TypeError("proxy key models must be a non-empty array of model ids");
  if (input.models.length > MODELS_MAX) throw new TypeError("proxy key models holds at most " + String(MODELS_MAX) + " ids");
  const models = [];
  for (const value of input.models) {
    const model = typeof value === "string" ? value.trim() : "";
    if (model === "" || model.length > MODEL_MAX) throw new TypeError("proxy key model ids must be 1-" + String(MODEL_MAX) + " characters");
    if (!models.includes(model)) models.push(model);
  }
  if (models.length === 0) throw new TypeError("proxy key models must name at least one model id");
  const rpm = input.rpm === void 0 ? LIMITS.rpm : Math.floor(input.rpm);
  if (!Number.isFinite(rpm) || rpm <= 0 || rpm > RPM_MAX) throw new TypeError("proxy key rpm must be an integer between 1 and " + String(RPM_MAX));
  return { label, models, rpm };
}
function loadKeys(file, log2) {
  if (!existsSync8(file)) return [];
  try {
    const stored = JSON.parse(readFileSync9(file, "utf8"));
    if (!Array.isArray(stored.keys)) return [];
    const records = [];
    for (const entry of stored.keys) {
      if (typeof entry?.id !== "string" || typeof entry?.keySha256 !== "string") continue;
      if (!/^[a-f0-9]{64}$/.test(entry.keySha256)) continue;
      if (typeof entry.label !== "string" || !Array.isArray(entry.models) || !entry.models.every((model) => typeof model === "string")) continue;
      if (!Number.isFinite(entry.rpm) || typeof entry.createdAt !== "string") continue;
      const record = { id: entry.id, label: entry.label, models: [...entry.models], rpm: entry.rpm, createdAt: entry.createdAt, keySha256: entry.keySha256 };
      if (typeof entry.revokedAt === "string") record.revokedAt = entry.revokedAt;
      records.push(record);
    }
    log2("proxy key ledger restored: " + String(records.length) + " key(s)");
    return records;
  } catch (error) {
    log2("proxy key ledger is unreadable (" + String(error instanceof Error ? error.message : String(error)) + "); starting empty");
    return [];
  }
}
function createProxyKeyStore(options) {
  mkdirSync8(options.dir, { recursive: true });
  const log2 = options.log ?? (() => {
  });
  const audit = options.audit;
  const file = join8(options.dir, KEYS_FILE);
  const records = loadKeys(file, log2);
  const byId = /* @__PURE__ */ new Map();
  const byHash = /* @__PURE__ */ new Map();
  const index = (record) => {
    byId.set(record.id, record);
    byHash.set(record.keySha256, record);
  };
  for (const record of records) index(record);
  const persist = () => {
    const temp = file + "." + String(process.pid) + ".tmp";
    writeFileSync8(temp, JSON.stringify({ version: 1, keys: records }, null, 2) + "\n", { encoding: "utf8", mode: 384 });
    renameSync8(temp, file);
  };
  const note = (record) => {
    if (audit === void 0) return;
    audit.record(record);
  };
  return {
    file,
    create(input) {
      const normalized = readKeyInput(input);
      const id = "pk_" + randomBytes6(9).toString("base64url");
      const key = KEY_PREFIX + randomBytes6(KEY_BYTES2).toString("base64url");
      const record = {
        id,
        label: normalized.label,
        models: normalized.models,
        rpm: normalized.rpm,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        keySha256: sha256(key)
      };
      records.push(record);
      index(record);
      persist();
      log2("proxy key created id=" + id + " label=" + JSON.stringify(record.label) + " models=" + String(record.models.length) + " rpm=" + String(record.rpm));
      note({ kind: "bind", cap: CAPS.modelsProxy, op: "proxy.key.create", ok: true, detail: "proxy key " + id });
      return { id, key };
    },
    revoke(id) {
      const record = byId.get(id);
      if (record === void 0) return false;
      if (record.revokedAt === void 0) {
        record.revokedAt = (/* @__PURE__ */ new Date()).toISOString();
        persist();
        log2("proxy key revoked id=" + id);
        note({ kind: "revoke", cap: CAPS.modelsProxy, op: "proxy.key.revoke", ok: true, detail: "proxy key " + id });
      }
      return true;
    },
    list() {
      return records.map((record) => viewOf(record));
    },
    resolve(presented) {
      if (typeof presented !== "string" || !KEY_PATTERN.test(presented)) return void 0;
      const record = byHash.get(sha256(presented));
      if (record === void 0) return void 0;
      return { record: viewOf(record), revoked: record.revokedAt !== void 0 };
    }
  };
}
function readModel(body) {
  const value = body.model;
  if (typeof value !== "string" || value.trim() === "") throw refuse("link/bad-request", "the proxy request body needs a non-empty model field");
  return value.trim();
}
function sendAnswer(res, answer) {
  if (answer === null || typeof answer !== "object") throw refuse("link/internal", "the upstream answered no result object");
  const status = answer.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
    throw refuse("link/internal", "the upstream answered an invalid status " + JSON.stringify(status));
  }
  res.statusCode = status;
  let contentType = "";
  for (const [name2, value] of Object.entries(answer.headers ?? {})) {
    const lower = name2.toLowerCase();
    if (lower === "content-type") contentType = String(value);
    if (lower === "content-type" || lower.startsWith("x-") || lower === "retry-after" || lower === "content-disposition") {
      res.setHeader(lower, String(value));
    }
  }
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  const body = answer.body;
  if (body !== null && typeof body === "object" && typeof body.pipe === "function") {
    ;
    body.pipe(res);
    return;
  }
  if (body === void 0 || body === null) {
    res.end();
    return;
  }
  if (contentType === "") res.setHeader("content-type", typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8");
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}
function createProxySubsystem(options) {
  const { core, io, log: log2, upstream } = options;
  const store = createProxyKeyStore({ dir: core.dir, log: log2, audit: core.audit });
  activeStore = store;
  const table = createRouteTable(io);
  const limiters = /* @__PURE__ */ new Map();
  const authenticate = (headers) => {
    const presented = bearerToken(headers);
    if (presented === void 0) throw refuse("link/unauthorized", "this proxy route needs Authorization: Bearer lk_<key>");
    if (!KEY_PATTERN.test(presented)) throw refuse("link/unauthorized", "the presented proxy key is not a lk_ key");
    const found = store.resolve(presented);
    if (found === void 0) throw refuse("link/unauthorized", "the proxy key is unknown");
    if (found.revoked) throw refuse("link/unauthorized", "the proxy key was revoked");
    return found.record;
  };
  const enforceRate = (record, res) => {
    let limiter = limiters.get(record.id);
    if (limiter === void 0) {
      limiter = createRateLimiter({ rpm: record.rpm });
      limiters.set(record.id, limiter);
    }
    const decision = limiter.take("model");
    if (decision.ok) return;
    const seconds = Math.max(1, Math.ceil((decision.retryAfterMs ?? 1e3) / 1e3));
    res.setHeader("retry-after", String(seconds));
    throw refuse("link/rate-limited", "proxy key " + record.id + " is over its " + String(record.rpm) + " requests per minute; retry after " + String(seconds) + "s");
  };
  const auditAttempt = (op, ok, code, ms, keyId) => {
    const record = { kind: ok ? "invoke" : "error", cap: CAPS.modelsProxy, op, ok, ms };
    if (code !== void 0) record.code = code;
    if (keyId !== void 0) record.peer = "proxy-key:" + keyId;
    core.audit.record(record);
  };
  const callUpstream = async (kind, body, context) => {
    const call = kind === "openai" ? upstream.openai : upstream.anthropic;
    if (typeof call !== "function") throw refuse("link/peer-unavailable", "no upstream is wired for the " + kind + " proxy surface");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("the upstream call exceeded " + String(LIMITS.timeoutMs) + " ms")), LIMITS.timeoutMs);
    try {
      return await call.call(upstream, body, { model: context.model, key: context.key, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "LinkError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw refuse("link/peer-unavailable", "the upstream " + kind + " call failed: " + message);
    } finally {
      clearTimeout(timer);
    }
  };
  const forward = async (kind, op, req, res) => {
    const started2 = Date.now();
    let keyId;
    try {
      const record = authenticate(req.headers);
      keyId = record.id;
      const body = await io.readJson(req);
      const model = readModel(body);
      if (!record.models.includes(model)) {
        throw refuse("link/scope-missing", "model " + JSON.stringify(model) + " is not in this proxy key model list");
      }
      enforceRate(record, res);
      const answer = await callUpstream(kind, body, { model, key: record.id });
      sendAnswer(res, answer);
      auditAttempt(op, true, void 0, Date.now() - started2, keyId);
      log2("proxy " + op + " key=" + record.id + " -> " + String(answer.status) + " (" + String(Date.now() - started2) + " ms)");
    } catch (error) {
      const refusal = asLinkError(error);
      auditAttempt(op, false, refusal.code, Date.now() - started2, keyId);
      log2("proxy " + op + " key=" + (keyId ?? "none") + " -> " + String(refusal.status) + " " + refusal.code + " (" + String(Date.now() - started2) + " ms)");
      throw refusal;
    }
  };
  const listModels = async (op, req, res) => {
    const started2 = Date.now();
    let keyId;
    try {
      const record = authenticate(req.headers);
      keyId = record.id;
      let answer;
      if (typeof upstream.listModels === "function") {
        try {
          answer = await upstream.listModels({ key: record.id });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw refuse("link/peer-unavailable", "the upstream model list failed: " + message);
        }
      } else {
        answer = {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { object: "list", data: record.models.map((model) => ({ id: model, object: "model", created: 0, owned_by: "dsh-link" })) }
        };
      }
      sendAnswer(res, answer);
      auditAttempt(op, true, void 0, Date.now() - started2, keyId);
      log2("proxy " + op + " key=" + record.id + " -> " + String(answer.status) + " (" + String(Date.now() - started2) + " ms)");
    } catch (error) {
      const refusal = asLinkError(error);
      auditAttempt(op, false, refusal.code, Date.now() - started2, keyId);
      log2("proxy " + op + " key=" + (keyId ?? "none") + " -> " + String(refusal.status) + " " + refusal.code + " (" + String(Date.now() - started2) + " ms)");
      throw refusal;
    }
  };
  const routes = [
    table.exact("POST", ROUTES.openaiPrefix + "/v1/chat/completions", (req, res) => forward("openai", "openai/chat.completions", req, res)),
    table.exact("GET", ROUTES.openaiPrefix + "/v1/models", (req, res) => listModels("openai/models", req, res)),
    table.exact("POST", ROUTES.anthropicPrefix + "/v1/messages", (req, res) => forward("anthropic", "anthropic/messages", req, res)),
    table.exact("GET", ROUTES.anthropicPrefix + "/v1/models", (req, res) => listModels("anthropic/models", req, res))
  ];
  let started = false;
  return {
    keys: store,
    createKey: (input) => store.create(input),
    revokeKey: (id) => store.revoke(id),
    listKeys: () => store.list(),
    routes() {
      return routes.slice();
    },
    async start() {
      if (started) return;
      started = true;
      log2("models.proxy ready (keys=" + String(store.list().length) + ")");
    },
    async stop() {
      started = false;
      limiters.clear();
    }
  };
}

// plugins/dsh-link-interconnect/src/bind/models.ts
function runtimeInternals(runtime) {
  const candidate = runtime;
  if (typeof candidate.addBinder !== "function") {
    throw new Error("bindModels() needs the runtime returned by createAdapterRuntime(): the addBinder seam is missing");
  }
  return candidate;
}
function textOf(content) {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (block !== null && block.type === "text" && typeof block.text === "string") text += block.text;
  }
  return text;
}
function toOpenAiMessages(options) {
  const messages = [];
  if (typeof options.system === "string" && options.system !== "") messages.push({ role: "system", content: options.system });
  for (const message of options.messages ?? []) {
    if (message === null || typeof message !== "object") continue;
    const text = textOf(message.content);
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: text });
        break;
      case "user":
        messages.push({ role: "user", content: text });
        break;
      case "assistant": {
        const toolCalls = [];
        for (const block of message.content ?? []) {
          if (block !== null && block.type === "tool-call" && typeof block.id === "string" && typeof block.name === "string") {
            toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: typeof block.arguments === "string" ? block.arguments : "{}" } });
          }
        }
        if (toolCalls.length > 0) messages.push({ role: "assistant", content: text === "" ? null : text, tool_calls: toolCalls });
        else if (text !== "") messages.push({ role: "assistant", content: text });
        break;
      }
      case "tool":
        messages.push({ role: "tool", tool_call_id: message.toolCallId ?? "", content: text === "" ? message.isError === true ? "the tool failed" : "" : text });
        break;
      default:
        break;
    }
  }
  return messages;
}
function parseSseLine(line) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(":") || !trimmed.startsWith("data:")) return void 0;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (; ; ) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      for (; ; ) {
        const boundary = buffer.indexOf("\n");
        if (boundary === -1) break;
        const line = buffer.slice(0, boundary).replace(/\r$/, "");
        buffer = buffer.slice(boundary + 1);
        const event = parseSseLine(line);
        if (event === "done") return;
        if (event !== void 0) yield event;
      }
    }
    const tail = (buffer + decoder.decode()).trim();
    if (tail !== "") {
      const event = parseSseLine(tail);
      if (event !== void 0 && event !== "done") yield event;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
function mapUsage(usage) {
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return void 0;
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens);
  const total = Number(usage?.total_tokens);
  return {
    inputTokens: Number.isFinite(cached) && cached > 0 ? Math.max(0, prompt - cached) : prompt,
    outputTokens: completion,
    ...Number.isFinite(total) ? { totalTokens: total } : {},
    ...Number.isFinite(cached) && cached > 0 ? { cacheReadTokens: cached } : {}
  };
}
function mapFinishReason(reason) {
  if (reason === "tool_calls" || reason === "function_call") return { kind: "tool-calls" };
  if (reason === "length") return { kind: "max-tokens" };
  if (reason === "content_filter") return { kind: "stop" };
  return { kind: "stop" };
}
function buildOpenAiCompatibleAdapter(config) {
  const { label, baseUrl, timeoutMs, credential, catalog } = config;
  async function request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("the adapter request exceeded " + String(timeoutMs) + " ms")), timeoutMs);
    try {
      return await fetch(baseUrl + path, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  async function* streamChat(options) {
    const bearer = credential();
    const body = { model: options.model, messages: toOpenAiMessages(options), stream: true };
    if (options.tools !== void 0 && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    }
    if (typeof options.temperature === "number") body.temperature = options.temperature;
    if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("the model request exceeded " + String(timeoutMs) + " ms")), timeoutMs);
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(baseUrl + "/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer " + bearer, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(label + ": POST /v1/chat/completions answered HTTP " + String(response.status));
      if (response.body === null) throw new Error(label + ": POST /v1/chat/completions answered no body");
      let nextIndex = 0;
      let textIndex = -1;
      let text = "";
      const toolBlocks = /* @__PURE__ */ new Map();
      let finishReason;
      for await (const event of sseEvents(response.body)) {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error("the model request was aborted");
        if (event.usage !== void 0) {
          const usage = mapUsage(event.usage);
          if (usage !== void 0) yield { type: "usage", usage };
        }
        const choice = Array.isArray(event.choices) ? event.choices[0] : void 0;
        if (choice === void 0 || choice === null) continue;
        if (typeof choice.finish_reason === "string" && choice.finish_reason !== "") finishReason = choice.finish_reason;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content !== "") {
          if (textIndex < 0) {
            textIndex = nextIndex;
            nextIndex += 1;
            yield { type: "block-start", index: textIndex, blockType: "text" };
          }
          text += delta.content;
          yield { type: "text-delta", index: textIndex, text: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            const key = typeof call?.index === "number" ? call.index : toolBlocks.size;
            const name2 = typeof call?.function?.name === "string" ? call.function.name : void 0;
            let block = toolBlocks.get(key);
            if (block === void 0) {
              block = { index: nextIndex, id: typeof call?.id === "string" && call.id !== "" ? call.id : "tool-call-" + String(key), name: "", arguments: "" };
              nextIndex += 1;
              toolBlocks.set(key, block);
              yield { type: "block-start", index: block.index, blockType: "tool-call" };
            }
            if (name2 !== void 0 && block.name === "") block.name = name2;
            const argumentsDelta = typeof call?.function?.arguments === "string" ? call.function.arguments : "";
            block.arguments += argumentsDelta;
            yield { type: "tool-call-delta", index: block.index, id: block.id, ...name2 === void 0 ? {} : { name: name2 }, argumentsDelta };
          }
        }
      }
      if (textIndex >= 0) yield { type: "block-end", index: textIndex, block: { type: "text", text } };
      for (const block of toolBlocks.values()) {
        yield { type: "block-end", index: block.index, block: { type: "tool-call", id: block.id, name: block.name, arguments: block.arguments } };
      }
      yield { type: "finish", reason: mapFinishReason(finishReason) };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
  return {
    providerInfo(provider) {
      return { id: provider, name: label };
    },
    providerRetryPolicy() {
      return void 0;
    },
    imageRequestPricing() {
      return void 0;
    },
    imageRequestTarget(_provider, _model, image) {
      return { width: image?.width, height: image?.height, maxBytes: image?.bytes };
    },
    async listModels(provider) {
      if (catalog !== void 0) return catalog.map((row) => ({ provider, id: row.id, name: row.name }));
      const response = await request("/v1/models", { method: "GET", headers: { authorization: "Bearer " + credential(), accept: "application/json" }, redirect: "error" });
      if (!response.ok) throw new Error(label + ": GET /v1/models answered HTTP " + String(response.status));
      const document = await response.json().catch(() => void 0);
      const rows = Array.isArray(document?.data) ? document.data : [];
      return rows.filter((row) => row !== null && typeof row === "object" && typeof row.id === "string" && row.id !== "").map((row) => ({ provider, id: row.id, name: typeof row.name === "string" && row.name !== "" ? row.name : row.id }));
    },
    async resolveModel(provider, model) {
      if (catalog !== void 0) {
        const row = catalog.find((entry) => entry.id === model);
        return { provider, id: model, name: row === void 0 ? model : row.name };
      }
      return { provider, id: model, name: model };
    },
    async prepareCall(provider, model) {
      return { model: { provider, id: model, name: model }, stream: (options) => streamChat(options) };
    },
    stream(options) {
      return streamChat(options);
    }
  };
}
function createModelAdapter(activation, providerId) {
  const capability = activation.declaration.capabilities.find((entry) => entry.kind === "models.provide");
  return buildOpenAiCompatibleAdapter({
    providerId,
    label: capability?.as?.label ?? activation.declaration.name,
    baseUrl: activation.baseUrl.replace(/\/+$/, ""),
    timeoutMs: activation.limits.timeoutMs > 0 ? activation.limits.timeoutMs : LIMITS.timeoutMs,
    credential: () => {
      const credential = activation.credential();
      if (credential === void 0) throw new Error("provider " + JSON.stringify(providerId) + ": the adapter credential is no longer available; disconnect and connect again");
      return credential;
    }
  });
}
function bindModels(options) {
  const { core, runtime, hosts, log: log2 } = options;
  const seam = runtimeInternals(runtime);
  const registrations = /* @__PURE__ */ new Map();
  const deferred = /* @__PURE__ */ new Map();
  function start(activation) {
    const adapterId = activation.adapterId;
    if (registrations.has(adapterId)) return;
    const llm = hosts.llm?.();
    if (llm === void 0 || llm === null) {
      deferred.set(adapterId, activation);
      log2("model provider for adapter " + adapterId + " is deferred: the llm service is not mounted yet");
      return;
    }
    const providerId = activation.binding.providerId ?? activation.declaration.id;
    if (activation.binding.peerLinkId !== void 0 && activation.credential() === void 0) {
      log2("peer model binding " + activation.binding.id + " carries no bearer credential in the runtime; bindModels leaves provider " + providerId + " to the ingress");
      return;
    }
    const handle = llm.registerAdapter([providerId], createModelAdapter(activation, providerId));
    deferred.delete(adapterId);
    registrations.set(adapterId, {
      binding: activation.binding,
      dispose() {
        try {
          handle();
        } catch (error) {
          log2("releasing the model provider " + providerId + " failed: " + (error instanceof Error ? error.message : String(error)));
        }
      }
    });
    log2("model provider " + providerId + " registered from adapter " + adapterId);
  }
  function stop(activation) {
    deferred.delete(activation.adapterId);
    const registration = registrations.get(activation.adapterId);
    if (registration === void 0) return;
    registrations.delete(activation.adapterId);
    registration.dispose();
  }
  function reconcile(event) {
    const published = Array.isArray(event.data?.bindings) ? event.data.bindings : [];
    const active = /* @__PURE__ */ new Map();
    for (const binding of published) {
      if (binding === null || typeof binding !== "object") continue;
      if (binding.status !== "active") continue;
      if (!Array.isArray(binding.caps) || !binding.caps.includes("models.provide")) continue;
      active.set(binding.adapterId, binding);
    }
    for (const [adapterId, registration] of [...registrations]) {
      if (active.has(adapterId)) continue;
      registrations.delete(adapterId);
      registration.dispose();
      log2("model provider for adapter " + adapterId + " released: the binding is no longer active");
    }
    for (const [adapterId, activation] of [...deferred]) {
      if (!active.has(adapterId)) {
        deferred.delete(adapterId);
        continue;
      }
      try {
        start(activation);
      } catch (error) {
        log2("deferred model registration for adapter " + adapterId + " failed: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  const binder = {
    name: "models",
    caps: ["models.provide"],
    activate: (activation) => start(activation),
    deactivate: (activation) => stop(activation)
  };
  const disposeSeam = seam.addBinder(binder);
  const unsubscribe = core.events.subscribe((event) => {
    if (event === null || typeof event !== "object") return;
    if (event.type !== ADAPTER_EVENTS.bindings) return;
    reconcile(event);
  });
  return () => {
    try {
      unsubscribe();
    } catch {
    }
    disposeSeam();
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
    deferred.clear();
  };
}

// plugins/dsh-link-interconnect/src/bind/tools.ts
function runtimeInternals2(runtime) {
  const candidate = runtime;
  if (typeof candidate.addBinder !== "function") {
    throw new Error("bindTools() needs the runtime returned by createAdapterRuntime(): the addBinder seam is missing");
  }
  return candidate;
}
function renderValue2(value) {
  if (typeof value === "string") return value;
  const text = JSON.stringify(value, null, 2);
  return text === void 0 ? String(value) : text;
}
async function readJsonBody(response) {
  const text = await response.text();
  if (text.trim() === "") return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function createToolDefinition(activation, tool) {
  const baseUrl = activation.baseUrl.replace(/\/+$/, "");
  const timeoutMs = activation.limits.timeoutMs > 0 ? activation.limits.timeoutMs : LIMITS.timeoutMs;
  const parameters = tool.parameters !== null && typeof tool.parameters === "object" ? tool.parameters : { type: "object", additionalProperties: true };
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: renderValue2(value) }]
    },
    async execute(args, exec) {
      const credential = activation.credential();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("the peer request exceeded " + String(timeoutMs) + " ms")), timeoutMs);
      const onAbort = () => controller.abort(exec?.signal?.reason);
      exec?.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const headers = { "content-type": "application/json", accept: "application/json" };
        if (credential !== void 0) headers.authorization = "Bearer " + credential;
        const call = tool.call ?? { cap: CAPS.toolsExpose, op: tool.name };
        const response = await fetch(baseUrl + "/link/v1/invoke", {
          method: "POST",
          headers,
          body: JSON.stringify({ cap: call.cap, op: call.op, args }),
          signal: controller.signal
        });
        const body = await readJsonBody(response);
        if (!response.ok) throw new Error("the peer answered HTTP " + String(response.status) + " for tool " + JSON.stringify(tool.name));
        const envelope = body !== null && typeof body === "object" ? body : void 0;
        if (envelope === void 0) throw new Error("the peer answered a non-JSON body for tool " + JSON.stringify(tool.name));
        if (envelope.ok === false) {
          const code = typeof envelope.error?.code === "string" ? envelope.error.code : "link/internal";
          const message = typeof envelope.error?.message === "string" ? envelope.error.message : "the peer refused the call";
          throw new Error(code + ": " + message);
        }
        return envelope.result === void 0 ? null : envelope.result;
      } finally {
        clearTimeout(timer);
        exec?.signal?.removeEventListener("abort", onAbort);
      }
    }
  };
}
function bindTools(options) {
  const { core, runtime, hosts, log: log2 } = options;
  const seam = runtimeInternals2(runtime);
  const registrations = /* @__PURE__ */ new Map();
  const deferred = /* @__PURE__ */ new Map();
  function start(activation) {
    const adapterId = activation.adapterId;
    if (registrations.has(adapterId)) return;
    const capability = activation.declaration.capabilities.find((entry) => entry.kind === CAPS.toolsExpose);
    const declared = capability !== void 0 && Array.isArray(capability.tools) ? capability.tools : [];
    if (declared.length === 0) return;
    const toolsHost = hosts.tools?.();
    if (toolsHost === void 0 || toolsHost === null) {
      deferred.set(adapterId, activation);
      log2("tool registrations for adapter " + adapterId + " are deferred: the tools service is not mounted yet");
      return;
    }
    const disposers = [];
    try {
      for (const tool of declared) {
        disposers.push(toolsHost.register(createToolDefinition(activation, tool)));
      }
    } catch (error) {
      for (const dispose of disposers.slice().reverse()) {
        try {
          dispose();
        } catch {
        }
      }
      throw error;
    }
    deferred.delete(adapterId);
    registrations.set(adapterId, {
      toolNames: declared.map((tool) => tool.name),
      dispose() {
        for (const dispose of disposers.slice().reverse()) {
          try {
            dispose();
          } catch (error) {
            log2("releasing a tool of adapter " + adapterId + " failed: " + (error instanceof Error ? error.message : String(error)));
          }
        }
      }
    });
    log2("tools registered from adapter " + adapterId + ": " + declared.map((tool) => tool.name).join(", "));
  }
  function stop(activation) {
    deferred.delete(activation.adapterId);
    const registration = registrations.get(activation.adapterId);
    if (registration === void 0) return;
    registrations.delete(activation.adapterId);
    registration.dispose();
  }
  function reconcile(event) {
    const published = Array.isArray(event.data?.bindings) ? event.data.bindings : [];
    const active = /* @__PURE__ */ new Map();
    for (const binding of published) {
      if (binding === null || typeof binding !== "object") continue;
      if (binding.status !== "active") continue;
      if (!Array.isArray(binding.caps) || !binding.caps.includes(CAPS.toolsExpose)) continue;
      active.set(binding.adapterId, binding);
    }
    for (const [adapterId, registration] of [...registrations]) {
      if (active.has(adapterId)) continue;
      registrations.delete(adapterId);
      registration.dispose();
      log2("tools for adapter " + adapterId + " released: the binding is no longer active");
    }
    for (const [adapterId, activation] of [...deferred]) {
      if (!active.has(adapterId)) {
        deferred.delete(adapterId);
        continue;
      }
      try {
        start(activation);
      } catch (error) {
        log2("deferred tool registration for adapter " + adapterId + " failed: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  const binder = {
    name: "tools",
    caps: [CAPS.toolsExpose],
    activate: (activation) => start(activation),
    deactivate: (activation) => stop(activation)
  };
  const disposeSeam = seam.addBinder(binder);
  const unsubscribe = core.events.subscribe((event) => {
    if (event === null || typeof event !== "object") return;
    if (event.type !== ADAPTER_EVENTS.bindings) return;
    reconcile(event);
  });
  return () => {
    try {
      unsubscribe();
    } catch {
    }
    disposeSeam();
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
    deferred.clear();
  };
}

// plugins/dsh-link-interconnect/src/index.ts
var name = "dsh-link-interconnect";
var inject = [];
var PLUGIN_ROOT = resolve2(dirname(fileURLToPath(import.meta.url)), "..");
var PLUGIN_ADAPTERS = join9(PLUGIN_ROOT, "adapters");
function kernelHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return resolve2(fromEnv);
  return join9(homedir3(), ".dsh");
}
function dataDirOf(config) {
  if (typeof config?.dataDir === "string" && config.dataDir.trim() !== "") return resolve2(config.dataDir);
  return join9(kernelHome(), DATA_DIR_NAME);
}
function loadPeerAllowlist(dataDir) {
  const entries = [];
  const fromEnv = (process.env.LINK_PEER_ALLOWLIST ?? "").trim();
  if (fromEnv !== "") entries.push(...fromEnv.split(","));
  try {
    const file = join9(dataDir, "lan-allowlist.json");
    const parsed = JSON.parse(readFileSync10(file, "utf8"));
    if (Array.isArray(parsed.hosts)) entries.push(...parsed.hosts.filter((host) => typeof host === "string"));
  } catch (error) {
    const code = error?.code;
    if (code !== "ENOENT") log("lan-allowlist.json is unreadable (" + String(error?.message ?? error) + "); loopback only");
  }
  return entries;
}
function envUpstream(log2) {
  const baseUrl = (process.env.LINK_PROXY_UPSTREAM_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.LINK_PROXY_UPSTREAM_KEY ?? "").trim();
  if (baseUrl === "") {
    log2("models.proxy has no upstream (LINK_PROXY_UPSTREAM_URL is unset): proxy calls answer 503 link/peer-unavailable");
    return {};
  }
  log2("models.proxy upstream channel: " + baseUrl);
  const call = async (path, method, body, signal) => {
    try {
      const headers = { "content-type": "application/json", accept: "application/json" };
      if (apiKey !== "") headers.authorization = "Bearer " + apiKey;
      const answer = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal
      });
      const forwarded = {};
      for (const name2 of ["content-type", "retry-after"]) {
        const value = answer.headers.get(name2);
        if (value !== null) forwarded[name2] = value;
      }
      const text = await answer.text();
      return { status: answer.status, headers: forwarded, body: text };
    } catch (error) {
      return {
        status: 502,
        body: { error: { code: "link/peer-unavailable", message: "upstream channel unreachable: " + String(error?.message ?? error) } }
      };
    }
  };
  return {
    openai: (body, context) => call("/v1/chat/completions", "POST", body, context.signal),
    anthropic: (body, context) => call("/v1/messages", "POST", body, context.signal),
    listModels: (context) => call("/v1/models", "GET", void 0, context.signal)
  };
}
function serviceOf(ctx, service) {
  try {
    return typeof ctx?.get === "function" ? ctx.get(service) : void 0;
  } catch (error) {
    return void 0;
  }
}
function release(dispose) {
  if (typeof dispose !== "function") return;
  try {
    const answer = dispose();
    if (answer !== null && typeof answer === "object" && typeof answer.then === "function") {
      void answer.catch(() => {
      });
    }
  } catch (error) {
  }
}
async function apply(ctx, config) {
  const log2 = (line) => console.log("[dsh-link-interconnect] " + line);
  const home = kernelHome();
  const dataDir = dataDirOf(config);
  const disposers = [];
  const subsystems = [];
  let bound = false;
  const protocol = await createProtocolServer({ home, dataDir, log: log2 });
  const { core } = protocol;
  subsystems.push(protocol);
  const hosts = {
    llm: () => serviceOf(ctx, "llm"),
    tools: () => serviceOf(ctx, "tools")
  };
  const runtime = await createAdapterRuntime({ core, adaptersDir: PLUGIN_ADAPTERS, hosts, log: log2 });
  subsystems.push(runtime);
  const snapshot = () => {
    const peers = core.peers.list();
    const grants = core.grants.list();
    const pendingConsent = core.consent.listPending();
    const bindings = runtime.bindings();
    const adapters = runtime.adapters();
    return {
      protocol: PROTOCOL_ID,
      contractVersion: CONTRACT_VERSION,
      linkId: core.identity.linkId,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      peers,
      grants,
      pendingConsent,
      bindings,
      adapters,
      audit: core.audit.list(20),
      counts: {
        peers: peers.length,
        activePeers: peers.filter((peer) => peer.status === "active").length,
        bindings: bindings.length,
        activeBindings: bindings.filter((binding) => binding.status === "active").length,
        pendingConsent: pendingConsent.length
      }
    };
  };
  const actions = {
    probeAll: () => runtime.probeAll(),
    connect: (id) => runtime.connect(id),
    disconnect: (id) => runtime.disconnect(id),
    revokePeer: async (id) => {
      const ok = core.grants.revoke(id);
      if (ok) core.peers.update(id, { status: "revoked" });
      core.events.publish({ type: "interconnect/peers", at: (/* @__PURE__ */ new Date()).toISOString() });
      core.audit.record({ kind: "revoke", peer: id, ok });
      return { ok };
    }
  };
  const clientRoutes = createClientRoutes({ core, snapshot, actions, log: log2 });
  subsystems.push(clientRoutes);
  disposers.push(bindModels({ core, runtime, hosts, log: log2 }));
  disposers.push(bindTools({ core, runtime, hosts, log: log2 }));
  const peerAllowlist = loadPeerAllowlist(dataDir);
  subsystems.push(createPeerIngress({ core, io: protocol.io, hosts, runtime, peerAllowlist, log: log2 }));
  log2("peer discovery policy: loopback always; LAN allowlist " + (peerAllowlist.length === 0 ? "empty (loopback only)" : peerAllowlist.length + " entr(y/ies)"));
  subsystems.push(createEmbedSubsystem({ core, io: protocol.io, log: log2 }));
  const proxy = createProxySubsystem({ core, io: protocol.io, log: log2, upstream: envUpstream(log2) });
  subsystems.push(proxy);
  const proxyKeyRoute = {
    kind: "exact",
    path: API_PREFIX + "/proxy-keys",
    handler: async (req, res) => {
      const io = protocol.io;
      try {
        if (req.method === "GET") {
          io.sendJson(res, 200, { ok: true, result: proxy.listKeys() });
          return;
        }
        if (req.method !== "POST") {
          res.setHeader("allow", "GET, POST");
          io.sendError(res, 405, ERROR_CODES.methodNotAllowed, "proxy keys are read with GET and written with POST");
          return;
        }
        const body = await io.readJson(req);
        const op = String(body.op ?? "create");
        if (op === "create") {
          const models = Array.isArray(body.models) ? body.models.map((model) => String(model)) : [];
          const created = proxy.createKey({
            label: String(body.label ?? "peer"),
            models: models.length === 0 ? ["*"] : models,
            rpm: typeof body.rpm === "number" ? body.rpm : void 0
          });
          core.audit.record({ kind: "consent", cap: "models.proxy", op: "proxy-key-create", ok: true, detail: created.id });
          io.sendJson(res, 200, { ok: true, result: created });
          return;
        }
        if (op === "revoke") {
          const revoked = proxy.revokeKey(String(body.id ?? ""));
          core.audit.record({ kind: "revoke", cap: "models.proxy", op: "proxy-key-revoke", ok: revoked, detail: String(body.id ?? "") });
          io.sendJson(res, 200, { ok: true, result: { revoked } });
          return;
        }
        io.sendError(res, 400, ERROR_CODES.badRequest, "unknown proxy-key op " + op);
      } catch (error) {
        io.sendError(res, 500, ERROR_CODES.internal, String(error?.message ?? error));
      }
    }
  };
  const tokenRevokeRoute = {
    kind: "exact",
    path: API_PREFIX + "/tokens/revoke",
    handler: async (req, res) => {
      const io = protocol.io;
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        io.sendError(res, 405, ERROR_CODES.methodNotAllowed, "token revocation is POST");
        return;
      }
      try {
        const body = await io.readJson(req);
        const jti = String(body.jti ?? "");
        if (jti === "") {
          io.sendError(res, 400, ERROR_CODES.badRequest, "body.jti is required");
          return;
        }
        core.tokens.revoke(jti);
        core.audit.record({ kind: "revoke", ok: true, op: "token-revoke", detail: jti });
        io.sendJson(res, 200, { ok: true, result: { revoked: jti } });
      } catch (error) {
        io.sendError(res, 500, ERROR_CODES.internal, String(error?.message ?? error));
      }
    }
  };
  subsystems.push({ routes: () => [proxyKeyRoute, tokenRevokeRoute] });
  for (const subsystem of subsystems) {
    if (typeof subsystem.start === "function") await subsystem.start();
  }
  const mount = () => {
    if (bound) return;
    const webServer = serviceOf(ctx, "webServer");
    if (webServer === void 0 || webServer === null || typeof webServer.register !== "function") return;
    let routes = 0;
    for (const subsystem of subsystems) {
      for (const route of subsystem.routes()) {
        try {
          const dispose = webServer.register(route);
          disposers.push(() => release(dispose));
          routes += 1;
        } catch (error) {
          log2("route " + route.path + " was not bound: " + String(error?.message ?? error));
        }
      }
    }
    bound = true;
    log2(PROTOCOL_ID + " ready - identity " + core.identity.linkId + ", " + String(routes) + " route(s), " + String(runtime.bindings().length) + " binding(s)");
  };
  mount();
  if (typeof ctx.inject === "function") ctx.inject(["webServer"], () => mount());
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      for (const subsystem of subsystems.slice().reverse()) release(subsystem.stop);
      for (const dispose of disposers.splice(0).reverse()) release(dispose);
    }, "dsh-link-interconnect: protocol core, adapter runtime and capability bindings");
  }
  log2("v" + CONTRACT_VERSION + " data=" + dataDir + " adapters=" + PLUGIN_ADAPTERS);
}
var index_default = { name, inject, apply };
export {
  apply,
  index_default as default,
  inject,
  name
};
