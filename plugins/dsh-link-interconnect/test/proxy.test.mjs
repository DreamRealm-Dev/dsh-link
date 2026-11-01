#!/usr/bin/env node
/**
 * test/proxy.test.mjs - the M5 models.proxy readings.
 *
 * Real HTTP on an ephemeral loopback port, the real protocol core from src/protocol/server.ts and
 * the real proxy subsystem from src/bind/proxy.ts, with a fake upstream injected exactly where
 * index.ts injects the provider bridge. No app, no kernel, no cordis.
 *
 *   cd <workspace>\\dsh-link\core\deepseek-harness
 *   node --import tsx/esm <workspace>\\dsh-link\plugins\dsh-link-interconnect\test\proxy.test.mjs
 *
 * Readings: key mint returns lk_<43> once and only sha256(key) is persisted; the module-level
 * createProxyKey()/revokeProxyKey() address the one ledger; a valid key + whitelisted model
 * forwards 200 with the upstream body; a model outside the whitelist is 403 link/scope-missing;
 * over the key rpm is 429 link/rate-limited with Retry-After; missing/malformed/unknown/revoked
 * keys are 401 link/unauthorized; the models route renders the whitelist; the anthropic route
 * forwards; a Readable upstream body streams through; and the raw key never appears in a written
 * file, an audit record or a log line.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { mountSubsystems, requestJson } from '../../../scripts/lib/interconnect-harness.mjs'
import { ROUTES } from '../src/protocol/types.ts'
import { createProtocolServer } from '../src/protocol/server.ts'
import { createProxyKey, createProxySubsystem, listProxyKeys, revokeProxyKey } from '../src/bind/proxy.ts'

const OPENAI_CHAT = ROUTES.openaiPrefix + '/v1/chat/completions'
const OPENAI_MODELS = ROUTES.openaiPrefix + '/v1/models'
const ANTHROPIC_MESSAGES = ROUTES.anthropicPrefix + '/v1/messages'
const ANTHROPIC_MODELS = ROUTES.anthropicPrefix + '/v1/models'

/** The injected upstream stand-in: records every call, answers a recognisable JSON body. */
function createFakeUpstream() {
  const calls = []
  const answer = (provider, body) => ({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-fake-upstream': provider },
    body: { ok: true, marker: 'fake-' + provider, model: body.model },
  })
  return {
    calls,
    async openai(body, context) {
      calls.push({ provider: 'openai', body, context })
      return answer('openai', body)
    },
    async anthropic(body, context) {
      calls.push({ provider: 'anthropic', body, context })
      return answer('anthropic', body)
    },
  }
}

/** One isolated data directory with the protocol core, the proxy subsystem and a fake upstream. */
async function openPlugin(dir, logs) {
  const server = await createProtocolServer({ home: dir, dataDir: join(dir, 'data'), log: (line) => logs.push('core: ' + line) })
  const upstream = createFakeUpstream()
  const proxy = createProxySubsystem({ core: server.core, io: server.io, log: (line) => logs.push('proxy: ' + line), upstream })
  const app = await mountSubsystems([server, proxy], { log: (line) => logs.push('harness: ' + line) })
  return { server, proxy, app, upstream }
}

/** Mount everything in a fresh temp dir, run one body, then close and delete it. */
async function withProxy(label, body) {
  const dir = mkdtempSync(join(tmpdir(), 'link-interconnect-proxy-' + label + '-'))
  const logs = []
  const first = await openPlugin(dir, logs)
  try {
    await body({ ...first, logs, dir })
  } finally {
    await first.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** POST one proxy route with an optional bearer key. */
function post(app, path, key, body) {
  const headers = key === undefined ? {} : { authorization: 'Bearer ' + key }
  return requestJson(app.origin + path, { method: 'POST', headers, body })
}

/** GET one proxy route with an optional bearer key. */
function get(app, path, key) {
  const headers = key === undefined ? {} : { authorization: 'Bearer ' + key }
  return requestJson(app.origin + path, { headers })
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

test('proxy: a key is returned once and only its sha256 is persisted', async () => {
  await withProxy('keys', async ({ proxy, dir }) => {
    const created = proxy.createKey({ label: 'matrix', models: ['model-a', 'model-b'], rpm: 3 })
    assert.match(created.id, /^pk_[A-Za-z0-9_-]+$/)
    assert.match(created.key, /^lk_[A-Za-z0-9_-]{43}$/)

    const file = join(dir, 'data', 'proxy-keys.json')
    const raw = readFileSync(file, 'utf8')
    const stored = JSON.parse(raw)
    assert.equal(stored.version, 1)
    assert.equal(stored.keys.length, 1)
    const record = stored.keys[0]
    assert.equal(record.id, created.id)
    assert.equal(record.label, 'matrix')
    assert.deepEqual(record.models, ['model-a', 'model-b'])
    assert.equal(record.rpm, 3)
    assert.equal(new Date(record.createdAt).getTime() > 0, true)
    assert.equal(record.keySha256, createHash('sha256').update(created.key).digest('hex'))
    assert.equal('key' in record, false, 'the ledger stores a raw key field')
    assert.equal(raw.includes(created.key), false, 'the ledger file contains the raw key')

    const listed = proxy.listKeys()
    assert.equal(listed.length, 1)
    assert.equal('keySha256' in listed[0], false, 'list() exposes the hash')
    assert.equal('key' in listed[0], false, 'list() exposes the raw key')

    assert.throws(() => proxy.createKey({ label: 'empty', models: [] }), TypeError)
    assert.throws(() => proxy.createKey({ label: '', models: ['model-a'] }), TypeError)
    assert.throws(() => proxy.createKey({ label: 'bad rpm', models: ['model-a'], rpm: 0 }), TypeError)
  })
})

test('proxy: the module createProxyKey()/revokeProxyKey()/listProxyKeys() address the one ledger', async () => {
  await withProxy('module-exports', async ({ app, proxy, dir }) => {
    const created = createProxyKey({ label: 'module', models: ['model-a'] })
    assert.match(created.key, /^lk_/)
    assert.equal(listProxyKeys().some((key) => key.id === created.id), true)

    const reply = await post(app, OPENAI_CHAT, created.key, { model: 'model-a', messages: [] })
    assert.equal(reply.status, 200, reply.text)

    assert.equal(revokeProxyKey(created.id), true)
    assert.equal(revokeProxyKey(created.id), true, 'revoke is idempotent')
    assert.equal(revokeProxyKey('pk_does-not-exist'), false)
    const after = await post(app, OPENAI_CHAT, created.key, { model: 'model-a', messages: [] })
    assert.equal(after.status, 401)
    assert.equal(after.json.error.code, 'link/unauthorized')
    assert.equal(readFileSync(join(dir, 'data', 'proxy-keys.json'), 'utf8').includes(created.key), false)
    assert.equal(proxy.listKeys().length, 1)
  })
})

test('proxy: a valid key with a whitelisted model forwards 200 and the upstream body', async () => {
  await withProxy('forward', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'forward', models: ['model-a'], rpm: 10 })
    const requestBody = { model: 'model-a', messages: [{ role: 'user', content: 'hi' }], stream: false }
    const reply = await post(app, OPENAI_CHAT, created.key, requestBody)

    assert.equal(reply.status, 200, reply.text)
    assert.equal(reply.headers['x-fake-upstream'], 'openai')
    assert.equal(reply.json.ok, true)
    assert.equal(reply.json.marker, 'fake-openai')
    assert.equal(reply.json.model, 'model-a')

    assert.equal(upstream.calls.length, 1)
    const call = upstream.calls[0]
    assert.equal(call.provider, 'openai')
    assert.deepEqual(call.body, requestBody)
    assert.equal(call.context.key, created.id, 'the upstream sees the key id, not the raw key')
    assert.equal(typeof call.context.signal, 'object')
    assert.equal(JSON.stringify(call.context).includes(created.key), false, 'the raw key reached the upstream context')
  })
})

test('proxy: a model outside the key whitelist is 403 link/scope-missing and never reaches upstream', async () => {
  await withProxy('whitelist', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'whitelist', models: ['model-a'], rpm: 10 })
    const reply = await post(app, OPENAI_CHAT, created.key, { model: 'model-b', messages: [] })
    assert.equal(reply.status, 403, reply.text)
    assert.equal(reply.json.error.code, 'link/scope-missing')
    assert.equal(upstream.calls.length, 0, 'a refused model still reached the upstream')
  })
})

test('proxy: requests over the key rpm are 429 link/rate-limited with Retry-After', async () => {
  await withProxy('rate', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'rate', models: ['model-a'], rpm: 2 })
    const first = await post(app, OPENAI_CHAT, created.key, { model: 'model-a' })
    const second = await post(app, OPENAI_CHAT, created.key, { model: 'model-a' })
    assert.equal(first.status, 200, first.text)
    assert.equal(second.status, 200, second.text)

    const refused = await post(app, OPENAI_CHAT, created.key, { model: 'model-a' })
    assert.equal(refused.status, 429, refused.text)
    assert.equal(refused.json.error.code, 'link/rate-limited')
    assert.equal(Number(refused.headers['retry-after']) >= 1, true, 'Retry-After is ' + String(refused.headers['retry-after']))
    assert.equal(upstream.calls.length, 2, 'the rate-limited call still reached the upstream')
  })
})

test('proxy: missing, malformed, unknown and revoked keys are 401 link/unauthorized', async () => {
  await withProxy('auth', async ({ app, proxy, upstream }) => {
    const checks = []

    checks.push(['no Authorization header', await post(app, OPENAI_CHAT, undefined, { model: 'model-a' })])
    checks.push(['a non-bearer scheme', await requestJson(app.origin + OPENAI_CHAT, { method: 'POST', headers: { authorization: 'Basic abc' }, body: { model: 'model-a' } })])
    checks.push(['a malformed key', await post(app, OPENAI_CHAT, 'lk_short', { model: 'model-a' })])
    checks.push(['an unknown key', await post(app, OPENAI_CHAT, 'lk_' + 'x'.repeat(43), { model: 'model-a' })])

    const revoked = proxy.createKey({ label: 'revoked', models: ['model-a'] })
    assert.equal(proxy.revokeKey(revoked.id), true)
    checks.push(['a revoked key', await post(app, OPENAI_CHAT, revoked.key, { model: 'model-a' })])

    for (const [label, reply] of checks) {
      assert.equal(reply.status, 401, label + ' -> ' + reply.text)
      assert.equal(reply.json.error.code, 'link/unauthorized', label)
    }
    assert.equal(upstream.calls.length, 0, 'a refused key still reached the upstream')
  })
})

test('proxy: a body without a model is 400 link/bad-request', async () => {
  await withProxy('bad-body', async ({ app, proxy }) => {
    const created = proxy.createKey({ label: 'bad-body', models: ['model-a'] })
    const reply = await post(app, OPENAI_CHAT, created.key, { messages: [] })
    assert.equal(reply.status, 400, reply.text)
    assert.equal(reply.json.error.code, 'link/bad-request')
  })
})

test('proxy: the models route renders the key whitelist, or forwards upstream.listModels', async () => {
  await withProxy('models', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'models', models: ['model-a', 'model-b'] })
    const rendered = await get(app, OPENAI_MODELS, created.key)
    assert.equal(rendered.status, 200, rendered.text)
    assert.equal(rendered.json.object, 'list')
    assert.deepEqual(rendered.json.data.map((entry) => entry.id), ['model-a', 'model-b'])

    const anthropicRendered = await get(app, ANTHROPIC_MODELS, created.key)
    assert.equal(anthropicRendered.status, 200)
    assert.deepEqual(anthropicRendered.json.data.map((entry) => entry.id), ['model-a', 'model-b'])

    let seen = null
    upstream.listModels = async (context) => {
      seen = context
      return { status: 200, headers: { 'content-type': 'application/json' }, body: { object: 'list', data: [{ id: 'upstream-model' }] } }
    }
    const forwarded = await get(app, OPENAI_MODELS, created.key)
    assert.equal(forwarded.status, 200, forwarded.text)
    assert.deepEqual(forwarded.json.data.map((entry) => entry.id), ['upstream-model'])
    assert.equal(seen.key, created.id)
  })
})

test('proxy: the anthropic route forwards through upstream.anthropic', async () => {
  await withProxy('anthropic', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'anthropic', models: ['claude-test'] })
    const reply = await post(app, ANTHROPIC_MESSAGES, created.key, { model: 'claude-test', max_tokens: 8, messages: [] })
    assert.equal(reply.status, 200, reply.text)
    assert.equal(reply.json.marker, 'fake-anthropic')
    assert.equal(upstream.calls.length, 1)
    assert.equal(upstream.calls[0].provider, 'anthropic')
    assert.equal(upstream.calls[0].context.key, created.id)
  })
})

test('proxy: a Readable upstream body is streamed through unchanged', async () => {
  await withProxy('stream', async ({ app, proxy, upstream }) => {
    const created = proxy.createKey({ label: 'stream', models: ['model-a'] })
    upstream.openai = async () => ({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Readable.from(['data: {"delta":"hi"}\n\n', 'data: [DONE]\n\n']),
    })
    const reply = await post(app, OPENAI_CHAT, created.key, { model: 'model-a', stream: true })
    assert.equal(reply.status, 200)
    assert.match(String(reply.headers['content-type']), /^text\/event-stream/)
    assert.equal(reply.text.includes('data: {"delta":"hi"}'), true, reply.text)
    assert.equal(reply.text.includes('data: [DONE]'), true)
  })
})

test('proxy: the raw key never appears in a written file, an audit record or a log line', async () => {
  await withProxy('secrets', async ({ app, proxy, server, dir, logs, upstream }) => {
    const created = proxy.createKey({ label: 'secrets', models: ['model-a'], rpm: 1 })
    await post(app, OPENAI_CHAT, created.key, { model: 'model-a' })
    await post(app, OPENAI_CHAT, created.key, { model: 'model-b' })
    await post(app, OPENAI_CHAT, created.key, { model: 'model-a' })
    await post(app, OPENAI_CHAT, undefined, { model: 'model-a' })
    await get(app, OPENAI_MODELS, created.key)
    assert.equal(upstream.calls.length, 1)

    for (const file of walkFiles(join(dir, 'data'))) {
      const text = readFileSync(file, 'utf8')
      assert.equal(text.includes(created.key), false, 'the raw key is in ' + file)
    }
    const auditText = JSON.stringify(server.core.audit.list(500))
    assert.equal(auditText.includes(created.key), false, 'the raw key is in the audit ledger')
    assert.equal(auditText.includes(created.id), true, 'the audit ledger never names the key id')
    const logText = logs.join('\n')
    assert.equal(logText.includes(created.key), false, 'the raw key is in the plugin log')
    assert.equal(logText.includes('Bearer'), false, 'an Authorization header reached the plugin log')
  })
})

test('proxy: a key survives a restart and keeps authenticating', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'link-interconnect-proxy-restart-'))
  const logs = []
  const first = await openPlugin(dir, logs)
  try {
    const created = first.proxy.createKey({ label: 'restart', models: ['model-a'] })
    const before = await post(first.app, OPENAI_CHAT, created.key, { model: 'model-a' })
    assert.equal(before.status, 200)
    await first.app.close()

    const second = await openPlugin(dir, logs)
    try {
      const after = await post(second.app, OPENAI_CHAT, created.key, { model: 'model-a' })
      assert.equal(after.status, 200, after.text)
      assert.equal(second.proxy.listKeys().length, 1)
      assert.equal(logs.some((line) => line.includes('proxy key ledger restored: 1 key(s)')), true, logs.join(' | '))
    } finally {
      await second.app.close()
    }
  } finally {
    await first.app.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
