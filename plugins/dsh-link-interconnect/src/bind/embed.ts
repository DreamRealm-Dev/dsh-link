/**
 * session.embed v2 - the origin-audienced embed token and the one self-contained document it loads.
 *
 * v1 served /embed without authentication. v2 splits the capability the way the frozen contract
 * describes it:
 *
 *   POST /link/v1/embed/token   {sessionId, mode, origin} -> {token, expiresAt, url}
 *   GET  /link/v1/embed/session?token&nonce -> the embed document, only for the origin the token
 *                                             was minted for.
 *
 * The token is a compact JWS minted by the shared token service: sub = "session:<id>",
 * aud = one explicit http(s) origin, scope = ["embed.session"], ttl = LIMITS.embedTokenMs
 * (10 minutes). The document that GET serves is built here as a string: no external request, no
 * token reflection. It refuses to run when it is not framed (window.parent === window), otherwise
 * it posts {type:'link:embed:ready', v:1, nonce} to the parent origin from the token audience.
 * The response carries a content-security-policy whose frame-ancestors is that exact origin and
 * never a wildcard, so no other document can frame it; a request from another (or no) origin is
 * refused before a byte of HTML is written.
 *
 * Reload semantics are exact: the same token answers 200 until core.tokens.revoke(jti) is called,
 * then the same request answers 401 link/unauthorized. Mint records (session id, mode, origin,
 * nonce, expiry) are persisted in <core.dir>/embed-sessions.json, so a reload after a plugin
 * restart still names the same session and mode; they carry no credential.
 *
 * Cordis-free: node built-ins, the frozen types, the shared http helpers and the token service
 * seam every subsystem consumes.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRouteTable } from '../http/routes.ts'
import { refuse } from '../protocol/errors.ts'
import { LIMITS, ROUTES } from '../protocol/types.ts'
import type { HttpIo, HttpRequest, InterconnectCore, Subsystem } from '../protocol/types.ts'

/** The one scope an embed token carries. */
export const EMBED_SCOPE = 'embed.session'

/** The document modes one embed session may name. */
export const EMBED_MODES = Object.freeze(['sidebar', 'full'] as const)

/** One of the two document modes. */
export type EmbedMode = (typeof EMBED_MODES)[number]

/** The file the mint ledger lives in, under the data directory. */
const SESSIONS_FILE = 'embed-sessions.json'
/** The mint ledger is bounded; expired records are pruned on every write anyway. */
const SESSIONS_MAX = 256
/** Session ids are opaque but printable: one URL-safe word, at most 128 characters. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,128}$/
/** A nonce is base64url; 16 bytes of randomness produce 22 characters. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/** Options createEmbedSubsystem() takes: what every subsystem is handed, plus its own log line. */
export interface EmbedSubsystemOptions {
  core: InterconnectCore
  io: HttpIo
  log(line: string): void
}

/** One mint the server remembers so a reload can state the same session and mode as facts. */
interface EmbedSessionRecord {
  /** The token id; the lookup key. */
  jti: string
  sessionId: string
  mode: EmbedMode
  /** The single origin the token is addressed to (also the CSP frame-ancestors value). */
  origin: string
  /** The nonce the document posts back to that origin. */
  nonce: string
  expiresAt: string
}

/** The mounted subsystem. */
export interface EmbedSubsystem extends Subsystem {
  /** Absolute path of the persisted mint ledger (display facts only, never a credential). */
  readonly file: string
}

/**
 * Escape one string for HTML text and double-quoted attribute values.
 * @param value - the string to place in the document.
 * @returns the escaped string.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Encode one string as a JavaScript literal that cannot terminate its script element.
 * @param value - the string to embed.
 * @returns the script-safe literal.
 */
function jsLiteral(value: string): string {
  const lineSeparator = String.fromCharCode(0x2028)
  const paragraphSeparator = String.fromCharCode(0x2029)
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll(lineSeparator, '\\u2028').replaceAll(paragraphSeparator, '\\u2029')
}

/**
 * Is this hostname a loopback literal (127.0.0.0/8, localhost, ::1)?
 * @param hostname - URL.hostname (IPv6 keeps its brackets).
 * @returns true when http is acceptable for that host.
 */
function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (bare === 'localhost' || bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

/**
 * Validate one explicit http(s) origin.
 *
 * The audience of an embed token is one exact origin, so the input must be exactly that: an
 * http(s) URL with no path, query, fragment or userinfo, and no wildcard. A plain-http origin is
 * accepted only for loopback hosts; every other host must be https.
 *
 * @param value - the caller-supplied origin.
 * @returns the normalized origin (scheme://host[:port]).
 * @throws LinkError link/bad-request when the value is not exactly one usable origin.
 */
export function validateEmbedOrigin(value: unknown): string {
  if (typeof value !== 'string') throw refuse('link/bad-request', 'origin must be the string form of one http(s) origin')
  const text = value.trim()
  if (text === '') throw refuse('link/bad-request', 'origin is required for an embed token')
  if (text.includes('*')) throw refuse('link/bad-request', 'origin must be one exact origin, not a pattern')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw refuse('link/bad-request', 'origin is not a parseable URL: ' + JSON.stringify(text))
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refuse('link/bad-request', 'origin must use http or https')
  if (url.username !== '' || url.password !== '') throw refuse('link/bad-request', 'origin must not carry userinfo')
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') throw refuse('link/bad-request', 'origin must not carry a path, query or fragment')
  if (url.hostname === '') throw refuse('link/bad-request', 'origin has no host')
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw refuse('link/bad-request', 'an embed origin that is not loopback must use https')
  }
  return url.origin
}

/**
 * Read one session id from a mint body.
 * @param value - the submitted value.
 * @returns the validated session id.
 * @throws LinkError link/bad-request when it is missing or not one URL-safe word.
 */
function readSessionId(value: unknown): string {
  if (typeof value !== 'string') throw refuse('link/bad-request', 'sessionId must be a string')
  const text = value.trim()
  if (!SESSION_ID_PATTERN.test(text)) throw refuse('link/bad-request', 'sessionId must be 1-128 characters of letters, digits and . _ : @ / -')
  return text
}

/**
 * Read one document mode from a mint body.
 * @param value - the submitted value.
 * @returns the validated mode.
 * @throws LinkError link/bad-request when it is not sidebar or full.
 */
function readMode(value: unknown): EmbedMode {
  if (value === 'sidebar' || value === 'full') return value
  throw refuse('link/bad-request', 'mode must be one of ' + EMBED_MODES.join(', '))
}

/**
 * Read the request Origin header as one validated origin.
 * @param req - the request facade.
 * @returns the normalized origin.
 * @throws LinkError link/unauthorized when the header is absent or unusable.
 */
function requestOrigin(req: HttpRequest): string {
  const raw = req.headers['origin']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.trim() === '') {
    throw refuse('link/unauthorized', 'the embed session request carries no Origin header; the token is addressed to one exact origin')
  }
  try {
    return validateEmbedOrigin(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw refuse('link/unauthorized', 'the embed session Origin header is not a usable origin: ' + message)
  }
}

/**
 * Build the self-contained embed document for one minted session.
 *
 * The bytes are a constant template plus escaped display facts: no external script, stylesheet,
 * image or fetch. The script either says one sentence when the document is not framed, or posts
 * the ready message and then reports what it did. The parent target origin is the token audience,
 * passed in from the verified claims, never from the request.
 *
 * @param record - the minted session facts.
 * @returns the complete HTML document.
 */
export function buildEmbedDocument(record: EmbedSessionRecord): string {
  const facts = 'Session ' + escapeHtml(record.sessionId) + ' - mode ' + escapeHtml(record.mode)
  return [
    '<!doctype html>',
    '<html lang="en" data-link-embed="v2" data-session-id="' + escapeHtml(record.sessionId) + '" data-mode="' + escapeHtml(record.mode) + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="link:embed" content="v2">',
    '<meta name="link:embed:session" content="' + escapeHtml(record.sessionId) + '">',
    '<meta name="link:embed:mode" content="' + escapeHtml(record.mode) + '">',
    '<title>LINK session</title>',
    '<style>',
    ':root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }',
    'body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }',
    'code { font-family: ui-monospace, monospace; }',
    '.status { margin-top: 8px; opacity: .8; }',
    '</style>',
    '</head>',
    '<body data-link-embed="v2" data-session-id="' + escapeHtml(record.sessionId) + '" data-mode="' + escapeHtml(record.mode) + '">',
    '<main>',
    '<h1>LINK session</h1>',
    '<p id="link-embed-facts">' + facts + '</p>',
    '<p id="link-embed-status" class="status">Waiting for the parent window to acknowledge this embed.</p>',
    '</main>',
    '<script>',
    '(function () {',
    "  'use strict';",
    '  var nonce = ' + jsLiteral(record.nonce) + ';',
    '  var parentOrigin = ' + jsLiteral(record.origin) + ';',
    '  var sessionId = ' + jsLiteral(record.sessionId) + ';',
    '  var mode = ' + jsLiteral(record.mode) + ';',
    '  function setStatus(text) {',
    "    var element = document.getElementById('link-embed-status');",
    '    if (element !== null) element.textContent = text;',
    '  }',
    '  if (window.parent === window) {',
    "    setStatus('This document only runs inside a LINK frame: it is not framed, so it does not connect to the parent and refuses to start.');",
    '    return;',
    '  }',
    '  try {',
    "    window.parent.postMessage({ type: 'link:embed:ready', v: 1, nonce: nonce, sessionId: sessionId, mode: mode }, parentOrigin);",
    "    setStatus('LINK embed ready: posted link:embed:ready to ' + parentOrigin + '.');",
    '  } catch (error) {',
    "    setStatus('LINK embed could not post to ' + parentOrigin + ': ' + String(error && error.message !== undefined ? error.message : error));",
    '  }',
    '}());',
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * The content-security-policy of an embed response.
 * @param origin - the one origin allowed to frame the document (the token audience).
 * @returns the policy header value.
 */
function embedCsp(origin: string): string {
  return "frame-ancestors " + origin + "; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"
}

/**
 * Load the persisted mint ledger, dropping records that already expired.
 * @param file - absolute path of embed-sessions.json.
 * @param log - one log line sink.
 * @returns the ledger keyed by jti.
 */
function loadSessions(file: string, log: (line: string) => void): Map<string, EmbedSessionRecord> {
  const sessions = new Map<string, EmbedSessionRecord>()
  if (!existsSync(file)) return sessions
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: unknown }
    if (!Array.isArray(stored.sessions)) return sessions
    const now = Date.now()
    for (const entry of stored.sessions as Partial<EmbedSessionRecord>[]) {
      if (typeof entry?.jti !== 'string' || typeof entry?.sessionId !== 'string' || typeof entry?.origin !== 'string') continue
      if (entry.mode !== 'sidebar' && entry.mode !== 'full') continue
      if (typeof entry.nonce !== 'string' || typeof entry.expiresAt !== 'string') continue
      if (!(Date.parse(entry.expiresAt) > now)) continue
      sessions.set(entry.jti, { jti: entry.jti, sessionId: entry.sessionId, mode: entry.mode, origin: entry.origin, nonce: entry.nonce, expiresAt: entry.expiresAt })
    }
    log('embed mint ledger restored: ' + String(sessions.size) + ' live session(s)')
  } catch (error) {
    log('embed mint ledger is unreadable (' + String(error instanceof Error ? error.message : String(error)) + '); starting empty')
  }
  return sessions
}

/**
 * Persist the mint ledger atomically, newest expiry last and expired records dropped.
 * @param file - absolute path of embed-sessions.json.
 * @param sessions - the live ledger.
 */
function persistSessions(file: string, sessions: Map<string, EmbedSessionRecord>): void {
  const now = Date.now()
  const live = [...sessions.values()].filter((record) => Date.parse(record.expiresAt) > now)
  live.sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
  const bounded = live.length > SESSIONS_MAX ? live.slice(live.length - SESSIONS_MAX) : live
  sessions.clear()
  for (const record of bounded) sessions.set(record.jti, record)
  const temp = file + '.' + String(process.pid) + '.tmp'
  writeFileSync(temp, JSON.stringify({ version: 1, sessions: bounded }, null, 2) + '\n')
  renameSync(temp, file)
}

/**
 * Build the session.embed v2 subsystem: the mint route and the one document route.
 *
 * Both routes are exact paths; the protocol server's /link/v1 catch-all stays the fallback for
 * everything else. The factory is synchronous - the mint ledger is small and read once.
 *
 * @param options - the shared core and http helpers, plus the plugin log.
 * @returns the subsystem whose routes() index.ts registers.
 */
export function createEmbedSubsystem(options: EmbedSubsystemOptions): EmbedSubsystem {
  const { core, io, log } = options
  mkdirSync(core.dir, { recursive: true })
  const file = join(core.dir, SESSIONS_FILE)
  const sessions = loadSessions(file, log)
  const table = createRouteTable(io)

  const mintRoute = table.exact('POST', ROUTES.embedToken, async (req, res) => {
    const body = await io.readJson(req)
    const sessionId = readSessionId(body.sessionId)
    const mode = readMode(body.mode)
    const origin = validateEmbedOrigin(body.origin)
    const minted = core.tokens.mint({ sub: 'session:' + sessionId, aud: origin, scope: [EMBED_SCOPE], ttlMs: LIMITS.embedTokenMs })
    const nonce = randomBytes(16).toString('base64url')
    sessions.set(minted.jti, { jti: minted.jti, sessionId, mode, origin, nonce, expiresAt: minted.expiresAt })
    persistSessions(file, sessions)
    const url = ROUTES.embedSession + '?token=' + encodeURIComponent(minted.token) + '&nonce=' + encodeURIComponent(nonce)
    io.sendJson(res, 200, { token: minted.token, expiresAt: minted.expiresAt, url })
    log('embed token minted session=' + sessionId + ' mode=' + mode + ' aud=' + origin + ' ttlMs=' + String(LIMITS.embedTokenMs))
  })

  const sessionRoute = table.exact('GET', ROUTES.embedSession, async (req, res) => {
    const { query } = io.parseUrl(req)
    const token = (query.get('token') ?? '').trim()
    if (token === '') throw refuse('link/unauthorized', 'an embed session request needs its token query parameter')
    const origin = requestOrigin(req)
    const verdict = core.tokens.verify(token, { aud: origin, scope: EMBED_SCOPE })
    if (!verdict.ok) throw refuse('link/unauthorized', 'embed token rejected: ' + verdict.message)
    const claims = verdict.claims
    let record = sessions.get(claims.jti)
    if (record === undefined) {
      // A restart can lose the ledger file; the token still proves the session subject and audience,
      // so serve the document with the one fact the token cannot carry: the original mode.
      if (!claims.sub.startsWith('session:')) throw refuse('link/unauthorized', 'embed token subject does not name a session')
      const sessionId = claims.sub.slice('session:'.length)
      if (!SESSION_ID_PATTERN.test(sessionId)) throw refuse('link/unauthorized', 'embed token subject is not a session id')
      const nonce = (query.get('nonce') ?? '').trim()
      if (!NONCE_PATTERN.test(nonce)) throw refuse('link/unauthorized', 'embed session nonce is missing or malformed')
      record = { jti: claims.jti, sessionId, mode: 'full', origin: claims.aud, nonce, expiresAt: new Date(claims.exp * 1000).toISOString() }
    } else {
      const nonce = (query.get('nonce') ?? '').trim()
      if (nonce !== record.nonce) throw refuse('link/unauthorized', 'embed session nonce does not match the minted token')
    }
    const document = buildEmbedDocument(record)
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('content-security-policy', embedCsp(record.origin))
    res.end(document)
    log('embed session served session=' + record.sessionId + ' mode=' + record.mode + ' aud=' + record.origin)
  })

  let started = false
  return {
    file,
    routes() {
      return [mintRoute, sessionRoute]
    },
    async start() {
      if (started) return
      started = true
      log('embed v2 ready (sessions=' + String(sessions.size) + ')')
    },
    async stop() {
      started = false
    },
  }
}

export default { createEmbedSubsystem, validateEmbedOrigin, buildEmbedDocument, EMBED_SCOPE, EMBED_MODES }
