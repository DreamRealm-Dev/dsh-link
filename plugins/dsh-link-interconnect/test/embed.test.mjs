#!/usr/bin/env node
/**
 * test/embed.test.mjs - the M4 session.embed v2 readings.
 *
 * Everything is exercised over real HTTP on an ephemeral loopback port: the real protocol core
 * (identity, token service, audit sink) from src/protocol/server.ts mounted next to the real
 * embed subsystem from src/bind/embed.ts through scripts/lib/interconnect-harness.mjs. No app, no
 * kernel, no cordis: the host modules are plain ESM.
 *
 *   cd <workspace>\\dsh-link\core\deepseek-harness
 *   node --import tsx/esm <workspace>\\dsh-link\plugins\dsh-link-interconnect\test\embed.test.mjs
 *
 * Readings: mint validation (mode/sessionId/origin, loopback http vs https, no wildcard), the
 * minted token claims (sub/aud/scope/ttl), 401 for missing token, missing Origin, a foreign Origin
 * and a tampered signature, the served document's framed-only script and audienced CSP, the nonce
 * handshake bytes, revocation -> the same token 401 on reload, and mint survival across a restart.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mountSubsystems, requestJson } from '../../../scripts/lib/interconnect-harness.mjs'
import { LIMITS, ROUTES } from '../src/protocol/types.ts'
import { createProtocolServer } from '../src/protocol/server.ts'
import { createEmbedSubsystem, EMBED_SCOPE } from '../src/bind/embed.ts'

const ORIGIN = 'http://127.0.0.1:45678'
const OTHER_ORIGIN = 'http://127.0.0.1:45679'

/** Decode one JWS claims segment. */
function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

/** One isolated data directory plus the protocol core and embed subsystem mounted together. */
async function openPlugin(dir, logs) {
  const server = await createProtocolServer({ home: dir, dataDir: join(dir, 'data'), log: (line) => logs.push('core: ' + line) })
  const embed = createEmbedSubsystem({ core: server.core, io: server.io, log: (line) => logs.push('embed: ' + line) })
  const app = await mountSubsystems([server, embed], { log: (line) => logs.push('harness: ' + line) })
  return { server, embed, app, origin: app.origin }
}

/** Mount everything in a fresh temp dir, run one body, then close and delete it. */
async function withEmbed(label, body) {
  const dir = mkdtempSync(join(tmpdir(), 'link-interconnect-embed-' + label + '-'))
  const logs = []
  const first = await openPlugin(dir, logs)
  try {
    await body({ ...first, logs, dir })
  } finally {
    await first.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** POST /link/v1/embed/token. */
function mint(app, body) {
  return requestJson(app.origin + ROUTES.embedToken, { method: 'POST', body })
}

/** GET one embed session URL (path + query) with an optional Origin header. */
function load(app, path, origin) {
  const headers = origin === undefined ? {} : { origin }
  return requestJson(app.origin + path, { headers })
}

test('embed: mint validates mode, sessionId and one explicit http(s) origin', async () => {
  await withEmbed('validate', async ({ app }) => {
    const valid = { sessionId: 'session-1', mode: 'sidebar', origin: ORIGIN }

    const held = await mint(app, valid)
    assert.equal(held.status, 200, held.text)
    assert.equal(typeof held.json.token, 'string')
    assert.equal(held.json.token.split('.').length, 3)
    assert.equal(new Date(held.json.expiresAt).getTime() > Date.now(), true)
    assert.equal(held.json.url.startsWith(ROUTES.embedSession + '?token='), true)
    assert.match(held.json.url, /[?&]nonce=[A-Za-z0-9_-]{16,}/)
    assert.deepEqual(Object.keys(held.json).sort(), ['expiresAt', 'token', 'url'])

    for (const [label, patch] of [
      ['a bad mode', { mode: 'popup' }],
      ['a missing mode', { mode: undefined }],
      ['a missing origin', { origin: undefined }],
      ['a wildcard origin', { origin: '*' }],
      ['an origin with a path', { origin: ORIGIN + '/app' }],
      ['an origin with a query', { origin: ORIGIN + '?x=1' }],
      ['a file origin', { origin: 'file:///tmp/embed.html' }],
      ['a non-loopback http origin', { origin: 'http://example.com' }],
      ['a userinfo origin', { origin: 'http://user:pass@127.0.0.1:45678' }],
      ['a missing sessionId', { sessionId: undefined }],
      ['a sessionId with a line break', { sessionId: 'session\n1' }],
    ]) {
      const body = { ...valid, ...patch }
      if (patch.mode === undefined) delete body.mode
      if (patch.origin === undefined) delete body.origin
      if (patch.sessionId === undefined) delete body.sessionId
      const reply = await mint(app, body)
      assert.equal(reply.status, 400, label + ' -> ' + reply.text)
      assert.equal(reply.json.error.code, 'link/bad-request', label)
    }

    const https = await mint(app, { ...valid, origin: 'https://example.com' })
    assert.equal(https.status, 200, 'a non-loopback https origin is usable: ' + https.text)

    const full = await mint(app, { ...valid, mode: 'full' })
    assert.equal(full.status, 200)

    const wrongMethod = await requestJson(app.origin + ROUTES.embedToken)
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.json.error.code, 'link/method-not-allowed')
  })
})

test('embed: the minted token is session-addressed, origin-audienced and 10 minutes long', async () => {
  await withEmbed('claims', async ({ app }) => {
    const before = Date.now()
    const reply = await mint(app, { sessionId: 'session-claims', mode: 'full', origin: ORIGIN })
    assert.equal(reply.status, 200)
    const claims = claimsOf(reply.json.token)
    assert.equal(claims.sub, 'session:session-claims')
    assert.equal(claims.aud, ORIGIN)
    assert.deepEqual(claims.scope, [EMBED_SCOPE])
    assert.equal(claims.exp - claims.iat, LIMITS.embedTokenMs / 1000)
    assert.equal(typeof claims.jti, 'string')
    const expiresAt = Date.parse(reply.json.expiresAt)
    assert.equal(expiresAt >= before + LIMITS.embedTokenMs - 2000, true)
    assert.equal(expiresAt <= Date.now() + LIMITS.embedTokenMs + 2000, true)
    // The origin is normalized: no trailing slash in the audience, even if the caller supplied one.
    const withSlash = await mint(app, { sessionId: 'session-claims', mode: 'sidebar', origin: ORIGIN + '/' })
    assert.equal(claimsOf(withSlash.json.token).aud, ORIGIN)
    assert.notEqual(claimsOf(withSlash.json.token).jti, claims.jti)
  })
})

test('embed: the session route refuses a missing token, a missing Origin or a foreign Origin', async () => {
  await withEmbed('auth', async ({ app }) => {
    const reply = await mint(app, { sessionId: 'session-auth', mode: 'sidebar', origin: ORIGIN })
    const url = reply.json.url
    const token = reply.json.token

    const noToken = await requestJson(app.origin + ROUTES.embedSession)
    assert.equal(noToken.status, 401)
    assert.equal(noToken.json.error.code, 'link/unauthorized')

    const noOrigin = await load(app, url)
    assert.equal(noOrigin.status, 401, noOrigin.text)
    assert.equal(noOrigin.json.error.code, 'link/unauthorized')
    assert.equal(noOrigin.text.includes('<html'), false, 'a refused load still served a document')

    const foreign = await load(app, url, OTHER_ORIGIN)
    assert.equal(foreign.status, 401, foreign.text)
    assert.equal(foreign.json.error.code, 'link/unauthorized')
    assert.equal(foreign.text.includes('<html'), false)

    const nullOrigin = await load(app, url, 'null')
    assert.equal(nullOrigin.status, 401)

    // Tamper the header segment: one changed character must invalidate the JWS (the signature's
    // last base64url character only carries padding bits, so flipping it would decode unchanged).
    const flipped = (token[10] === 'A' ? 'B' : 'A')
    const tamperedToken = token.slice(0, 10) + flipped + token.slice(11)
    const tampered = await load(app, url.replace(token, tamperedToken), ORIGIN)
    assert.equal(tampered.status, 401, 'a tampered token is not accepted')

    const right = await load(app, url, ORIGIN)
    assert.equal(right.status, 200, right.text)
  })
})

test('embed: the served document runs only in a frame, posts the nonce to its audience, and states the session facts', async () => {
  await withEmbed('document', async ({ app }) => {
    const reply = await mint(app, { sessionId: 'session-doc', mode: 'sidebar', origin: ORIGIN })
    const nonce = new URL('http://x' + reply.json.url).searchParams.get('nonce')
    const html = await load(app, reply.json.url, ORIGIN)

    assert.equal(html.status, 200)
    assert.match(String(html.headers['content-type']), /^text\/html/)
    assert.equal(html.headers['cache-control'], 'no-store')
    assert.equal(html.headers['x-content-type-options'], 'nosniff')
    const csp = String(html.headers['content-security-policy'] ?? '')
    assert.equal(csp.startsWith('frame-ancestors ' + ORIGIN + ';'), true, 'CSP is ' + csp)
    assert.equal(csp.includes('*'), false, 'the CSP frame policy contains a wildcard')
    assert.equal(csp.includes("default-src 'none'"), true)
    const frameOptions = String(html.headers['x-frame-options'] ?? '')
    assert.equal(frameOptions.toUpperCase().includes('ALLOWALL'), false)

    // (a) unframed documents refuse to run: the parent===window guard returns before the post.
    const guardAt = html.text.indexOf('window.parent === window')
    const postAt = html.text.indexOf('link:embed:ready')
    assert.notEqual(guardAt, -1, 'no unframed guard')
    assert.notEqual(postAt, -1, 'no ready post')
    assert.equal(guardAt < postAt, true, 'the unframed guard runs after the post')
    assert.equal(html.text.includes('refuses to start'), true)

    // (b) the ready message names the nonce and targets the token audience only.
    assert.equal(html.text.includes('var nonce = ' + JSON.stringify(nonce) + ';'), true)
    assert.equal(html.text.includes('var parentOrigin = ' + JSON.stringify(ORIGIN) + ';'), true)
    assert.equal(html.text.includes("type: 'link:embed:ready', v: 1, nonce: nonce"), true)
    assert.equal(html.text.includes(', parentOrigin);'), true)

    // (c) session id and mode are document-level facts: data attributes, metas and visible text.
    assert.equal(html.text.includes('data-link-embed="v2"'), true)
    assert.equal(html.text.includes('data-session-id="session-doc"'), true)
    assert.equal(html.text.includes('data-mode="sidebar"'), true)
    assert.equal(html.text.includes('<meta name="link:embed:session" content="session-doc">'), true)
    assert.equal(html.text.includes('Session session-doc - mode sidebar'), true)

    // Self-contained: no external request of any kind, and the token is not reflected into the bytes.
    assert.equal(/<script[^>]+src=/i.test(html.text), false, 'an external script is referenced')
    assert.equal(/<link[^>]+href=/i.test(html.text), false, 'an external stylesheet is referenced')
    assert.equal(/<img[^>]+src="https?:/i.test(html.text), false, 'an external image is referenced')
    assert.equal(html.text.includes('fetch('), false, 'the document fetches')
    assert.equal(html.text.includes('XMLHttpRequest'), false, 'the document uses XHR')
    assert.equal(html.text.includes(reply.json.token), false, 'the token was reflected into the document')
  })
})

test('embed: a nonce that was not minted with the token is refused', async () => {
  await withEmbed('nonce', async ({ app }) => {
    const reply = await mint(app, { sessionId: 'session-nonce', mode: 'full', origin: ORIGIN })
    const parsed = new URL('http://x' + reply.json.url)
    const token = parsed.searchParams.get('token')
    const nonce = parsed.searchParams.get('nonce')

    const missing = await load(app, ROUTES.embedSession + '?token=' + encodeURIComponent(token), ORIGIN)
    assert.equal(missing.status, 401)

    const swapped = await load(app, ROUTES.embedSession + '?token=' + encodeURIComponent(token) + '&nonce=' + 'A'.repeat(nonce.length), ORIGIN)
    assert.equal(swapped.status, 401, swapped.text)
    assert.equal(swapped.json.error.code, 'link/unauthorized')
  })
})

test('embed: revoking the jti turns the same token into 401 on reload', async () => {
  await withEmbed('revoke', async ({ app, server }) => {
    const reply = await mint(app, { sessionId: 'session-revoke', mode: 'sidebar', origin: ORIGIN })
    const claims = claimsOf(reply.json.token)
    const before = await load(app, reply.json.url, ORIGIN)
    assert.equal(before.status, 200)

    server.core.tokens.revoke(claims.jti)
    const after = await load(app, reply.json.url, ORIGIN)
    assert.equal(after.status, 401, after.text)
    assert.equal(after.json.error.code, 'link/unauthorized')
    assert.equal(after.text.includes('<html'), false)
  })
})

test('embed: a mint survives a restart with the same session, mode and nonce', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'link-interconnect-embed-restart-'))
  const logs = []
  const first = await openPlugin(dir, logs)
  try {
    const reply = await mint(first.app, { sessionId: 'session-restart', mode: 'sidebar', origin: ORIGIN })
    const before = await load(first.app, reply.json.url, ORIGIN)
    assert.equal(before.status, 200)
    await first.app.close()

    const second = await openPlugin(dir, logs)
    try {
      const after = await load(second.app, reply.json.url, ORIGIN)
      assert.equal(after.status, 200, after.text)
      assert.equal(after.text.includes('data-mode="sidebar"'), true)
      assert.equal(after.text.includes('data-session-id="session-restart"'), true)
      assert.equal(logs.some((line) => line.includes('mint ledger restored: 1 live session(s)')), true, logs.join(' | '))
    } finally {
      await second.app.close()
    }
  } finally {
    await first.app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})

test('embed: the raw embed token never reaches a log line', async () => {
  await withEmbed('no-token-log', async ({ app, logs }) => {
    const reply = await mint(app, { sessionId: 'session-log', mode: 'full', origin: ORIGIN })
    await load(app, reply.json.url, ORIGIN)
    const all = logs.join('\n')
    assert.equal(all.includes(reply.json.token), false, 'a log line carries the embed token')
  })
})
