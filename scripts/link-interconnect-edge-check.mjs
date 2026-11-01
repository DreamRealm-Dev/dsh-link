#!/usr/bin/env node
/**
 * M4 + M5 acceptance for link-interconnect/1 - 16 readings over real HTTP.
 *
 *   cd <workspace>\\dsh-link\core\deepseek-harness
 *   node --import tsx/esm <workspace>\\dsh-link\scripts\link-interconnect-edge-check.mjs
 *
 * The script builds the real protocol core, the real README-session.embed v2 subsystem and the real
 * models.proxy subsystem in this process, mounts them on a plain node:http server through
 * scripts/lib/interconnect-harness.mjs (no cordis, no app, no kernel) and measures both milestone
 * matrices end to end:
 *
 *   M4: mint {token, expiresAt, url}; validation of mode/sessionId/origin; 401 for a missing
 *       token, a missing Origin and a foreign Origin; the served document is framed-only, posts
 *       {type:'link:embed:ready', v:1, nonce} to the token audience, states sessionId + mode as
 *       document facts, and is self-contained; CSP frame-ancestors is the exact audience, never a
 *       wildcard; revoking the jti turns the same token into 401 on reload.
 *   M5: valid key + whitelisted model -> 200 with the upstream body; model outside the whitelist
 *       -> 403 link/scope-missing; over rpm -> 429 link/rate-limited; missing/unknown/revoked key
 *       -> 401 link/unauthorized; the raw key appears in no written file, audit record or log.
 *
 * Exit 0 all 16 held | 1 a reading failed.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountSubsystems, requestJson } from './lib/interconnect-harness.mjs'
import { LIMITS, ROUTES } from '../plugins/dsh-link-interconnect/src/protocol/types.ts'
import { createProtocolServer } from '../plugins/dsh-link-interconnect/src/protocol/server.ts'
import { createEmbedSubsystem } from '../plugins/dsh-link-interconnect/src/bind/embed.ts'
import { createProxySubsystem } from '../plugins/dsh-link-interconnect/src/bind/proxy.ts'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(PROJECT, 'plugins', 'dsh-link-interconnect')
const READINGS = 16
const ORIGIN = 'http://127.0.0.1:45999'
const FOREIGN = 'http://127.0.0.1:45998'
const OPENAI_CHAT = ROUTES.openaiPrefix + '/v1/chat/completions'
const OPENAI_MODELS = ROUTES.openaiPrefix + '/v1/models'

const results = []
const need = (condition, message) => { if (!condition) throw new Error(message) }
const tag = (n) => String(n).padStart(2, '0') + '/' + String(READINGS)
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))

async function reading(n, label, fn) {
  try {
    const detail = await fn()
    results.push({ ok: true })
    console.log('ok   ' + tag(n) + ' ' + label + (detail === undefined || detail === '' ? '' : '  [' + detail + ']'))
  } catch (error) {
    results.push({ ok: false })
    console.log('FAIL ' + tag(n) + ' ' + label + '  [' + String(error instanceof Error ? error.message : error) + ']')
  }
}

/** The injected upstream stand-in: records calls and answers a recognisable JSON body. */
function createFakeUpstream() {
  const calls = []
  const answer = (provider, body) => ({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-fake-upstream': provider },
    body: { ok: true, marker: 'fake-' + provider, model: body.model },
  })
  return {
    calls,
    async openai(body, context) { calls.push({ provider: 'openai', body, context }); return answer('openai', body) },
    async anthropic(body, context) { calls.push({ provider: 'anthropic', body, context }); return answer('anthropic', body) },
  }
}

/** Every file under one directory, recursively. */
function walkFiles(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(path))
    else out.push(path)
  }
  return out
}

const post = (base, path, key, body) => requestJson(base + path, { method: 'POST', headers: key === undefined ? {} : { authorization: 'Bearer ' + key }, body })
const load = (base, path, origin) => requestJson(base + path, { headers: origin === undefined ? {} : { origin } })
const mint = (base, body) => requestJson(base + ROUTES.embedToken, { method: 'POST', body })

const dir = mkdtempSync(join(tmpdir(), 'link-interconnect-edge-'))
const logs = []
const note = (line) => logs.push(String(line))
let app = null
let server = null

try {
  server = await createProtocolServer({ home: dir, dataDir: join(dir, 'data'), log: note })
  const embed = createEmbedSubsystem({ core: server.core, io: server.io, log: note })
  const upstream = createFakeUpstream()
  const proxy = createProxySubsystem({ core: server.core, io: server.io, log: note, upstream })
  app = await mountSubsystems([server, embed, proxy], { log: note })
  const base = app.origin
  const core = server.core

  /** The one embed token/url every M4 reading after the mint reuses. */
  const minted = await mint(base, { sessionId: 'edge-session', mode: 'sidebar', origin: ORIGIN })
  const token = minted.json.token
  const url = minted.json.url
  const nonce = new URL('http://x' + url).searchParams.get('nonce')
  const claims = claimsOf(token)
  /** The one proxy key the M5 readings reuse, minted through the exported admin surface. */
  const editableKey = proxy.createKey({ label: 'edge', models: ['model-a'], rpm: 4 })

  await reading(1, 'both host modules are cordis-free (no @deepseek-ai import)', async () => {
    for (const rel of ['src/bind/embed.ts', 'src/bind/proxy.ts']) {
      const text = readFileSync(join(PLUGIN, rel), 'utf8')
      need(/from\s+['"]@deepseek-ai\//.test(text) === false, rel + ' imports @deepseek-ai/*')
      need(/from\s+['"]react/.test(text) === false, rel + ' imports react')
    }
    return 'embed.ts + proxy.ts'
  })

  await reading(2, 'POST embed/token -> 200 {token, expiresAt, url}', async () => {
    need(minted.status === 200, 'status ' + minted.status + ' ' + minted.text.slice(0, 160))
    need(typeof token === 'string' && token.split('.').length === 3, 'token is not a compact JWS')
    need(typeof minted.json.expiresAt === 'string' && Date.parse(minted.json.expiresAt) > Date.now(), 'expiresAt is not in the future')
    need(typeof url === 'string' && url.startsWith(ROUTES.embedSession + '?token='), 'url is ' + String(url))
    need(/[?&]nonce=[A-Za-z0-9_-]{16,}/.test(url), 'url carries no nonce')
    need(claims.sub === 'session:edge-session' && claims.aud === ORIGIN, 'claims sub/aud are ' + claims.sub + '/' + claims.aud)
    need(Array.isArray(claims.scope) && claims.scope.join(',') === 'embed.session', 'scope is ' + String(claims.scope))
    need(claims.exp - claims.iat === LIMITS.embedTokenMs / 1000, 'ttl is ' + String(claims.exp - claims.iat) + 's')
    return 'aud=' + claims.aud + ' ttl=' + String(claims.exp - claims.iat) + 's nonce=' + nonce.length + 'ch'
  })

  await reading(3, 'POST embed/token validates mode, sessionId and one explicit origin', async () => {
    for (const [label, patch] of [
      ['bad mode', { mode: 'popup' }],
      ['wildcard origin', { origin: '*' }],
      ['non-loopback http origin', { origin: 'http://example.com' }],
      ['origin with a path', { origin: ORIGIN + '/app' }],
      ['missing sessionId', { sessionId: undefined }],
    ]) {
      const body = { sessionId: 'edge-validation', mode: 'full', origin: ORIGIN, ...patch }
      if (patch.sessionId === undefined) delete body.sessionId
      const reply = await mint(base, body)
      need(reply.status === 400, label + ' -> ' + reply.status + ' ' + reply.text.slice(0, 120))
      need(reply.json?.error?.code === 'link/bad-request', label + ' code is ' + String(reply.json?.error?.code))
    }
    const https = await mint(base, { sessionId: 'edge-validation', mode: 'full', origin: 'https://example.com' })
    need(https.status === 200, 'a non-loopback https origin was refused: ' + https.status)
    return '5 refusals + https accepted'
  })

  await reading(4, 'GET embed/session without a token -> 401 link/unauthorized', async () => {
    const reply = await requestJson(base + ROUTES.embedSession)
    need(reply.status === 401, 'status ' + reply.status)
    need(reply.json?.error?.code === 'link/unauthorized', 'code is ' + String(reply.json?.error?.code))
    return '401 ' + reply.json.error.code
  })

  await reading(5, 'GET embed/session without the Origin / from another Origin -> 401', async () => {
    const noOrigin = await load(base, url)
    need(noOrigin.status === 401, 'no Origin -> ' + noOrigin.status)
    need(noOrigin.json?.error?.code === 'link/unauthorized', 'no Origin code is ' + String(noOrigin.json?.error?.code))
    need(noOrigin.text.includes('<html') === false, 'a refused load still served a document')
    const foreign = await load(base, url, FOREIGN)
    need(foreign.status === 401, 'foreign Origin -> ' + foreign.status)
    need(foreign.json?.error?.code === 'link/unauthorized', 'foreign code is ' + String(foreign.json?.error?.code))
    return 'absent 401 + foreign 401'
  })

  await reading(6, 'GET embed/session with the minted token -> 200 framed-only document', async () => {
    const reply = await load(base, url, ORIGIN)
    need(reply.status === 200, 'status ' + reply.status + ' ' + reply.text.slice(0, 160))
    need(/^text\/html/.test(String(reply.headers['content-type'])), 'content-type is ' + String(reply.headers['content-type']))
    const guardAt = reply.text.indexOf('window.parent === window')
    const postAt = reply.text.indexOf('link:embed:ready')
    need(guardAt !== -1 && postAt !== -1 && guardAt < postAt, 'the unframed guard does not run before the post')
    need(reply.text.includes('data-session-id="edge-session"'), 'sessionId is not a document fact')
    need(reply.text.includes('data-mode="sidebar"'), 'mode is not a document fact')
    need(reply.text.includes('var nonce = ' + JSON.stringify(nonce) + ';'), 'the nonce is not in the document')
    need(reply.text.includes('var parentOrigin = ' + JSON.stringify(ORIGIN) + ';'), 'the parent origin is not the token audience')
    need(reply.text.includes(reply.json?.token ?? token) === false, 'the token is reflected into the document')
    return '200 text/html guard->post nonce=' + nonce.length + 'ch'
  })

  await reading(7, 'frame policy: CSP frame-ancestors is the exact audience, no wildcard, no allow-all', async () => {
    const reply = await load(base, url, ORIGIN)
    const csp = String(reply.headers['content-security-policy'] ?? '')
    need(csp.startsWith('frame-ancestors ' + ORIGIN + ';'), 'CSP is ' + csp)
    need(csp.includes('*') === false, 'the CSP contains a wildcard')
    need(csp.includes("default-src 'none'"), 'the CSP has no default-src none')
    const frameOptions = String(reply.headers['x-frame-options'] ?? '')
    need(frameOptions.toUpperCase().includes('ALLOWALL') === false, 'X-Frame-Options allows every frame')
    return 'frame-ancestors ' + ORIGIN
  })

  await reading(8, 'the document is self-contained: no external request', async () => {
    const reply = await load(base, url, ORIGIN)
    need(/<script[^>]+src=/i.test(reply.text) === false, 'external script tag')
    need(/<link[^>]+href=/i.test(reply.text) === false, 'external stylesheet tag')
    need(/<img[^>]+src="https?:/i.test(reply.text) === false, 'external image')
    need(reply.text.includes('fetch(') === false, 'document fetches')
    need(reply.text.includes('XMLHttpRequest') === false, 'document uses XHR')
    return 'bytes=' + reply.text.length
  })

  await reading(9, 'revoking the jti -> the same token answers 401 on reload', async () => {
    const before = await load(base, url, ORIGIN)
    need(before.status === 200, 'before revoke -> ' + before.status)
    core.tokens.revoke(claims.jti)
    const after = await load(base, url, ORIGIN)
    need(after.status === 401, 'after revoke -> ' + after.status)
    need(after.json?.error?.code === 'link/unauthorized', 'after revoke code is ' + String(after.json?.error?.code))
    need(after.text.includes('<html') === false, 'the revoked reload still served a document')
    return '200 -> revoke -> 401'
  })

  await reading(10, 'proxy: valid key + whitelisted model -> 200 with the upstream body forwarded', async () => {
    const reply = await post(base, OPENAI_CHAT, editableKey.key, { model: 'model-a', messages: [{ role: 'user', content: 'hi' }] })
    need(reply.status === 200, 'status ' + reply.status + ' ' + reply.text.slice(0, 160))
    need(reply.json?.ok === true && reply.json?.marker === 'fake-openai', 'body is ' + reply.text.slice(0, 160))
    need(reply.headers['x-fake-upstream'] === 'openai', 'the upstream headers did not pass through')
    const call = upstream.calls[upstream.calls.length - 1]
    need(call !== undefined && call.context.key === editableKey.id, 'the upstream context does not name the key id')
    need(JSON.stringify(call.context).includes(editableKey.key) === false, 'the raw key reached the upstream context')
    return '200 fake-openai model=model-a key=' + editableKey.id
  })

  await reading(11, 'proxy: a model outside the key whitelist -> 403 link/scope-missing', async () => {
    const callsBefore = upstream.calls.length
    const reply = await post(base, OPENAI_CHAT, editableKey.key, { model: 'model-b', messages: [] })
    need(reply.status === 403, 'status ' + reply.status + ' ' + reply.text.slice(0, 160))
    need(reply.json?.error?.code === 'link/scope-missing', 'code is ' + String(reply.json?.error?.code))
    need(upstream.calls.length === callsBefore, 'a refused model still reached the upstream')
    return '403 ' + reply.json.error.code
  })

  await reading(12, 'proxy: over the key rpm -> 429 link/rate-limited with Retry-After', async () => {
    const rateKey = proxy.createKey({ label: 'edge-rate', models: ['model-a'], rpm: 2 })
    const first = await post(base, OPENAI_CHAT, rateKey.key, { model: 'model-a' })
    const second = await post(base, OPENAI_CHAT, rateKey.key, { model: 'model-a' })
    need(first.status === 200 && second.status === 200, 'first two calls -> ' + first.status + '/' + second.status)
    const refused = await post(base, OPENAI_CHAT, rateKey.key, { model: 'model-a' })
    need(refused.status === 429, 'third call -> ' + refused.status + ' ' + refused.text.slice(0, 160))
    need(refused.json?.error?.code === 'link/rate-limited', 'code is ' + String(refused.json?.error?.code))
    const retryAfter = Number(refused.headers['retry-after'])
    need(Number.isFinite(retryAfter) && retryAfter >= 1, 'Retry-After is ' + String(refused.headers['retry-after']))
    return '429 ' + refused.json.error.code + ' Retry-After=' + String(retryAfter) + 's'
  })

  await reading(13, 'proxy: missing / unknown / revoked key -> 401 link/unauthorized', async () => {
    const cases = [
      ['missing', await post(base, OPENAI_CHAT, undefined, { model: 'model-a' })],
      ['unknown', await post(base, OPENAI_CHAT, 'lk_' + 'x'.repeat(43), { model: 'model-a' })],
    ]
    const revoked = proxy.createKey({ label: 'edge-revoked', models: ['model-a'] })
    need(proxy.revokeKey(revoked.id) === true, 'revokeKey did not answer true')
    cases.push(['revoked', await post(base, OPENAI_CHAT, revoked.key, { model: 'model-a' })])
    for (const [label, reply] of cases) {
      need(reply.status === 401, label + ' -> ' + reply.status + ' ' + reply.text.slice(0, 120))
      need(reply.json?.error?.code === 'link/unauthorized', label + ' code is ' + String(reply.json?.error?.code))
    }
    return cases.map(([label]) => label + ' 401').join(' + ')
  })

  await reading(14, 'proxy: GET models renders the key whitelist', async () => {
    const reply = await requestJson(base + OPENAI_MODELS, { headers: { authorization: 'Bearer ' + editableKey.key } })
    need(reply.status === 200, 'status ' + reply.status + ' ' + reply.text.slice(0, 160))
    need(reply.json?.object === 'list', 'object is ' + String(reply.json?.object))
    need(JSON.stringify(reply.json?.data?.map((entry) => entry.id)) === JSON.stringify(['model-a']), 'data is ' + JSON.stringify(reply.json?.data))
    return '200 list [' + reply.json.data.map((entry) => entry.id).join(',') + ']'
  })

  await reading(15, 'proxy: the ledger persists sha256(key) only, never the key', async () => {
    const raw = readFileSync(join(dir, 'data', 'proxy-keys.json'), 'utf8')
    const stored = JSON.parse(raw)
    need(Array.isArray(stored.keys) && stored.keys.length >= 1, 'ledger holds no keys')
    const record = stored.keys.find((entry) => entry.id === editableKey.id)
    need(record !== undefined, 'the minted key is not in the ledger')
    need(record.keySha256 === createHash('sha256').update(editableKey.key).digest('hex'), 'keySha256 does not match sha256(key)')
    need('key' in record === false && raw.includes(editableKey.key) === false, 'the ledger holds the raw key')
    return 'sha256 matches; raw key absent'
  })

  await reading(16, 'secret hygiene: raw key absent from files, audit and log; token absent from log', async () => {
    for (const file of walkFiles(join(dir, 'data'))) {
      need(readFileSync(file, 'utf8').includes(editableKey.key) === false, 'the raw key is in ' + file)
    }
    const auditText = JSON.stringify(core.audit.list(500))
    need(auditText.includes(editableKey.key) === false, 'the raw key is in the audit ledger')
    need(auditText.includes(editableKey.id) === true, 'the audit ledger never names the key id')
    const logText = logs.join('\n')
    need(logText.includes(editableKey.key) === false, 'the raw key is in the plugin log')
    need(logText.includes('Bearer') === false, 'an Authorization header reached the plugin log')
    need(logText.includes(token) === false, 'the embed token is in the plugin log')
    return 'files=' + String(walkFiles(join(dir, 'data')).length) + ' audit=' + String(core.audit.list(500).length) + ' loglines=' + String(logs.length)
  })
} finally {
  if (app !== null) await app.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}

const held = results.filter((result) => result.ok).length
const failed = results.length - held
console.log('---')
console.log('M4 embed v2 + M5 models.proxy edge check (standalone): ' + String(held) + '/' + String(READINGS) + ' held, ' + String(failed) + ' failed')
process.exit(failed === 0 ? 0 : 1)
