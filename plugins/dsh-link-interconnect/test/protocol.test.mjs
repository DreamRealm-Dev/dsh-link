/**
 * Unit suite for the link-interconnect host modules (protocol core, identity, registries, http).
 *
 * Everything below src/index.ts is plain ESM, so the suite runs without the app and without cordis:
 *
 *   cd <workspace>\\dsh-link\core\deepseek-harness
 *   node --import tsx/esm <workspace>\\dsh-link\plugins\dsh-link-interconnect\test\protocol.test.mjs
 *
 * It covers the modules the 12-reading check script cannot reach one at a time: Ed25519 identity
 * persistence and self-healing, compact JWS claims/audience/scope/expiry/revoke persistence, peer
 * and grant stores across a reload, the consent gate (decide, timeout, dispose), the token-bucket
 * limiter, the event hub backlog, the HTTP helpers, and then the whole assembled server over the
 * plain node:http harness (contract identity, well-known, handshake, invoke, events, client routes).
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync, sign as signPayload } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { mountSubsystems, openEventStream, requestJson } from '../../../scripts/lib/interconnect-harness.mjs'
import { CONTRACT_VERSION, LINK_PREFIX, PROTOCOL_ID, ROUTES, SCOPES } from '../src/protocol/types.ts'
import { createIdentityStore, isEd25519PublicKey, linkIdForPublicKey } from '../src/identity/store.ts'
import { bearerToken, createTokenService, TOKEN_AUDIENCE } from '../src/identity/tokens.ts'
import { createPeerStore } from '../src/registry/peers.ts'
import { createGrantStore } from '../src/registry/grants.ts'
import { createConsentService } from '../src/registry/consent.ts'
import { createRateLimiter } from '../src/http/ratelimit.ts'
import { createEventHub } from '../src/protocol/events.ts'
import { createHttpIo, readBody, readJson } from '../src/http/io.ts'
import { buildContract, buildWellKnown, contractText } from '../src/protocol/contract.ts'
import { createProtocolServer } from '../src/protocol/server.ts'
import { createClientRoutes } from '../src/http/client.ts'
import { AdapterRefusal } from '../src/adapters/runtime.ts'

const tempDir = (label) => mkdtempSync(join(tmpdir(), 'link-interconnect-' + label + '-'))
const withTemp = (label, body) => async () => {
  const dir = tempDir(label)
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function fakeRequest({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    written: '',
    ended: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    write(chunk) { this.written += String(chunk) },
    end(body) { if (body !== undefined) this.written += String(body); this.ended = true },
  }
  res.on = () => {}
  return res
}

const decodeSegment = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))

test('identity: linkId is derived from the Ed25519 public key and survives a reload', withTemp('identity', async (dir) => {
  const lines = []
  const first = createIdentityStore({ dir, log: (line) => lines.push(line) })
  assert.equal(first.created, true)
  assert.match(first.identity.linkId, /^[a-z2-7]{26}$/)
  assert.equal(first.identity.linkId, linkIdForPublicKey(first.identity.publicKey))
  assert.equal(isEd25519PublicKey(first.identity.publicKey), true)
  assert.equal(isEd25519PublicKey('not-a-key'), false)
  const stored = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8'))
  assert.equal(stored.algorithm, 'Ed25519')
  assert.equal(stored.linkId, first.identity.linkId)
  assert.equal(lines.join('\n').includes(stored.privateKey), false, 'a log line carries the private key')

  const second = createIdentityStore({ dir, log: () => {} })
  assert.equal(second.created, false)
  assert.equal(second.identity.linkId, first.identity.linkId)
  assert.equal(second.identity.publicKey, first.identity.publicKey)
}))

test('identity: a signature verifies only the signed payload and only with its own key', withTemp('identity-sign', async (dir) => {
  const identity = createIdentityStore({ dir, log: () => {} }).identity
  const signature = identity.sign('challenge-value')
  assert.equal(identity.verify('challenge-value', signature, identity.publicKey), true)
  assert.equal(identity.verify('challenge-value-2', signature, identity.publicKey), false)
  const other = createIdentityStore({ dir: tempDir('identity-other'), log: () => {} }).identity
  assert.equal(identity.verify('challenge-value', signature, other.publicKey), false)
  assert.equal(identity.verify('payload', 'not-base64', identity.publicKey), false)
}))

test('identity: a corrupt identity.json is regenerated rather than crashing the plugin', withTemp('identity-corrupt', async (dir) => {
  writeFileSync(join(dir, 'identity.json'), '{ this is not json')
  const lines = []
  const store = createIdentityStore({ dir, log: (line) => lines.push(line) })
  assert.equal(store.created, true)
  assert.equal(lines.some((line) => line.startsWith('identity file') && line.includes('regenerating')), true)
}))

test('tokens: mint/verify covers audience, scope, expiry, tampering and persisted revoke', withTemp('tokens', async (dir) => {
  const identity = createIdentityStore({ dir, log: () => {} }).identity
  let clock = Date.parse('2026-01-01T00:00:00.000Z')
  const tokens = createTokenService({ dir, identity, log: () => {}, now: () => clock })
  const minted = tokens.mint({ sub: 'peer-1', aud: TOKEN_AUDIENCE, scope: ['models.provide', 'tools.expose'], ttlMs: 60000 })
  assert.equal(minted.token.split('.').length, 3)
  assert.deepEqual(decodeSegment(minted.token.split('.')[0]), { alg: 'EdDSA', typ: 'JWT' })
  const claims = decodeSegment(minted.token.split('.')[1])
  assert.equal(claims.sub, 'peer-1')
  assert.equal(claims.aud, TOKEN_AUDIENCE)
  assert.deepEqual(claims.scope, ['models.provide', 'tools.expose'])
  assert.equal(typeof claims.jti, 'string')
  assert.equal(tokens.verify(minted.token).ok, true)
  assert.equal(tokens.verify(minted.token, { aud: TOKEN_AUDIENCE, scope: 'models.provide' }).ok, true)
  assert.equal(tokens.verify(minted.token, { aud: 'other' }).code, 'link/unauthorized')
  assert.equal(tokens.verify(minted.token, { scope: 'models.proxy' }).code, 'link/scope-missing')
  const tampered = minted.token.slice(0, -2) + (minted.token.endsWith('a') ? 'bb' : 'aa')
  assert.equal(tokens.verify(tampered).ok, false)
  clock += 61000
  assert.equal(tokens.verify(minted.token).message, 'token expired')

  const revoked = tokens.mint({ sub: 'peer-2', aud: TOKEN_AUDIENCE, scope: [], ttlMs: 60000 })
  tokens.revoke(revoked.jti)
  assert.equal(tokens.isRevoked(revoked.jti), true)
  assert.equal(tokens.verify(revoked.token).message, 'token was revoked')
  const reloaded = createTokenService({ dir, identity, log: () => {}, now: () => clock })
  assert.equal(reloaded.isRevoked(revoked.jti), true, 'the jti blacklist did not persist')
  assert.equal(bearerToken({ authorization: 'Bearer abc.def.ghi' }), 'abc.def.ghi')
  assert.equal(bearerToken({ authorization: 'bearer lower' }), 'lower')
  assert.equal(bearerToken({}), undefined)
}))

test('peers: rows persist across a reload and updates keep createdAt', withTemp('peers', async (dir) => {
  const store = createPeerStore({ dir, log: () => {} })
  const at = '2026-01-01T00:00:00.000Z'
  const row = { linkId: 'peer-a', name: 'A', pub: createIdentityStore({ dir: tempDir('peers-key'), log: () => {} }).identity.publicKey, scopes: ['tools.expose'], status: 'active', transport: 'loopback', createdAt: at, updatedAt: at }
  store.upsert(row)
  store.upsert({ ...row, linkId: 'peer-b', name: 'B', scopes: [] })
  assert.equal(store.count(), 2)
  assert.deepEqual(store.list().map((peer) => peer.linkId), ['peer-a', 'peer-b'])
  const updated = store.update('peer-a', { name: 'A renamed' })
  assert.equal(updated.name, 'A renamed')
  assert.equal(updated.createdAt, at)
  const reloaded = createPeerStore({ dir, log: () => {} })
  assert.equal(reloaded.count(), 2)
  assert.equal(reloaded.get('peer-a').name, 'A renamed')
  assert.equal(reloaded.get('missing'), undefined)
  assert.equal(reloaded.remove('peer-b'), true)
  assert.equal(reloaded.remove('peer-b'), false)
  assert.equal(reloaded.count(), 1)
  assert.equal(existsSync(join(dir, 'peers.json')), true)
}))

test('grants: deny-by-default, grant, revoke and persist', withTemp('grants', async (dir) => {
  const store = createGrantStore({ dir, log: () => {} })
  assert.equal(store.has('peer-a', 'models.provide'), false)
  store.grant({ peerLinkId: 'peer-a', scopes: ['models.provide', 'tools.expose'], rpm: 30, grantedAt: '2026-01-01T00:00:00.000Z', grantedBy: 'user' })
  assert.equal(store.has('peer-a', 'models.provide'), true)
  assert.equal(store.has('peer-a', 'models.proxy'), false)
  assert.equal(store.get('peer-a').rpm, 30)
  const reloaded = createGrantStore({ dir, log: () => {} })
  assert.equal(reloaded.count(), 1)
  assert.equal(reloaded.has('peer-a', 'tools.expose'), true)
  assert.equal(reloaded.revoke('peer-a'), true)
  assert.equal(reloaded.revoke('peer-a'), false)
  assert.equal(reloaded.has('peer-a', 'models.provide'), false)
}))

test('consent: request -> pending -> decide -> resolve, timeout denies, dispose settles', async () => {
  let nextId = 0
  const gate = createConsentService({ idFactory: () => 'consent-' + String(++nextId) })
  const granted = gate.request({ peerLinkId: 'peer-a', peerName: 'A', title: 'join?', capability: 'tools.expose', scopes: ['tools.expose'], risk: 'low' })
  assert.equal(gate.pendingCount(), 1)
  const pending = gate.listPending()
  assert.equal(pending[0].id, 'consent-1')
  assert.equal(pending[0].title, 'join?')
  assert.equal(gate.decide('consent-1', 'granted'), true)
  assert.equal(await granted, 'granted')
  assert.equal(gate.decide('consent-1', 'granted'), false)
  assert.equal(gate.decidedCount(), 1)
  assert.equal(await gate.awaitDecision('consent-1', 50), 'granted')
  assert.equal(await gate.awaitDecision('unknown', 10), 'timeout')

  const timedOut = createConsentService({ defaultTimeoutMs: 25, idFactory: () => 'consent-timeout' })
  assert.equal(await timedOut.request({ peerLinkId: 'peer-b', peerName: 'B', title: 'join?', capability: 'x', scopes: [], risk: 'low' }), 'denied')
  assert.equal(timedOut.pendingCount(), 0)

  const disposed = createConsentService({ idFactory: () => 'consent-dispose' })
  const promise = disposed.request({ peerLinkId: 'peer-c', peerName: 'C', title: 'join?', capability: 'x', scopes: [], risk: 'low' })
  const waiter = disposed.awaitDecision('consent-dispose', 5000)
  disposed.dispose()
  assert.equal(disposed.pendingCount(), 0)
  assert.equal(await promise, 'denied')
  assert.equal(await waiter, 'timeout')
})

test('ratelimit: a token bucket refuses when empty and refills with the clock', () => {
  let clock = 0
  const limiter = createRateLimiter({ rpm: 2, capacity: 2, now: () => clock })
  assert.equal(limiter.take('peer-a').ok, true)
  assert.equal(limiter.take('peer-a').ok, true)
  const refused = limiter.take('peer-a')
  assert.equal(refused.ok, false)
  assert.equal(refused.retryAfterMs > 0, true)
  assert.equal(limiter.take('peer-b').ok, true, 'one key exhausted another')
  clock += 30000
  assert.equal(limiter.take('peer-a').ok, true)
  limiter.reset('peer-a')
  assert.equal(limiter.take('peer-a').ok, true)
})

test('events: the hub keeps a bounded backlog with increasing seq and notifies subscribers', () => {
  const hub = createEventHub({ backlog: 3 })
  const seen = []
  const unsubscribe = hub.subscribe((event) => seen.push(event.type))
  for (const type of ['one', 'two', 'three', 'four', 'five']) hub.publish({ type, at: '', data: { n: type } })
  assert.deepEqual(seen, ['one', 'two', 'three', 'four', 'five'])
  assert.deepEqual(hub.recent(10).map((event) => event.type), ['three', 'four', 'five'])
  const entries = hub.entries(3)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].seq < entries[2].seq, true)
  assert.equal(entries[2].seq, 5)
  assert.equal(hub.published(), 5)
  unsubscribe()
  hub.publish({ type: 'six', at: '' })
  assert.equal(seen.length, 5)
  assert.equal(entries.length, 3)
})

test('http io: bounded bodies, JSON refusal, method guard and URL parsing', async () => {
  const io = createHttpIo()
  assert.deepEqual(await readJson(fakeRequest({ body: '{"a":1}' })), { a: 1 })
  assert.deepEqual(await readJson(fakeRequest({})), {})
  await assert.rejects(readJson(fakeRequest({ body: '[1,2]' })), (error) => error.code === 'link/bad-request')
  await assert.rejects(readJson(fakeRequest({ body: 'not json' })), (error) => error.code === 'link/bad-request')
  await assert.rejects(readBody(fakeRequest({ headers: { 'content-length': '100' }, body: 'x' }), 5), (error) => error.code === 'link/payload-too-large')
  await assert.rejects(readBody(fakeRequest({ body: '0123456789' }), 5), (error) => error.code === 'link/payload-too-large')
  const wrong = fakeResponse()
  assert.equal(io.requireMethod(fakeRequest({ method: 'POST' }), wrong, 'GET'), false)
  assert.equal(wrong.statusCode, 405)
  assert.equal(wrong.headers.allow, 'GET')
  assert.equal(JSON.parse(wrong.written).error.code, 'link/method-not-allowed')
  assert.equal(io.requireMethod(fakeRequest({ method: 'get' }), fakeResponse(), 'GET'), true)
  const parsed = io.parseUrl(fakeRequest({ url: '/link/v1/events?token=abc&limit=7' }))
  assert.equal(parsed.path, '/link/v1/events')
  assert.equal(parsed.query.get('token'), 'abc')
  const sent = fakeResponse()
  io.sendJson(sent, 200, { ok: true })
  assert.equal(sent.headers['cache-control'], 'no-store')
  assert.equal(sent.headers['content-type'].startsWith('application/json'), true)
})

test('contract: the document is deterministic, names every error code and carries no instance fact', () => {
  assert.equal(contractText(), contractText())
  assert.equal(contractText(), JSON.stringify(buildContract()))
  const document = buildContract()
  assert.equal(document.protocol, PROTOCOL_ID)
  assert.equal(document.version, CONTRACT_VERSION)
  assert.deepEqual(document.scopes, [...SCOPES])
  assert.equal(document.errors.includes('link/scope-missing'), true)
  assert.equal(document.errors.length, 12)
  assert.equal(document.endpoints.some((endpoint) => endpoint.path === ROUTES.invoke && endpoint.auth === 'bearer'), true)
  const wellKnown = buildWellKnown('linkid')
  assert.equal(wellKnown.identity.linkId, 'linkid')
  assert.equal(wellKnown.endpoints.invoke, ROUTES.invoke)
  assert.deepEqual(wellKnown.capabilities.map((capability) => capability.kind), ['models.proxy', 'tools.expose', 'session.embed'])
})

test('server: contract, well-known, handshake, invoke, events and client routes over plain HTTP', withTemp('server', async (dir) => {
  const lines = []
  const server = await createProtocolServer({ home: dir, log: (line) => lines.push(line) })
  const core = server.core
  assert.equal(lines.filter((line) => line.includes('protocol server ready')).length, 0, 'createProtocolServer() called start() itself')
  await server.start()
  await server.start()
  assert.equal(lines.filter((line) => line.includes('protocol server ready')).length, 1, 'start() is not idempotent')
  assert.equal(lines.filter((line) => line.startsWith('pairing code ')).length, 1, 'the pairing code was logged more than once')

  const snapshot = () => {
    const peers = core.peers.list()
    const pending = core.consent.listPending()
    return {
      protocol: core.protocol,
      contractVersion: CONTRACT_VERSION,
      linkId: core.identity.linkId,
      at: new Date().toISOString(),
      peers,
      grants: core.grants.list(),
      pendingConsent: pending,
      bindings: [],
      adapters: [],
      audit: core.audit.list(10),
      counts: { peers: peers.length, activePeers: peers.filter((peer) => peer.status === 'active').length, bindings: 0, activeBindings: 0, pendingConsent: pending.length },
    }
  }
  const actions = {
    probeAll: async () => [{ adapterId: 'ofm', detected: false, reasonCode: 'not-installed', reason: 'adapter ofm is not installed', at: new Date().toISOString() }],
    connect: async (id) => { throw new AdapterRefusal('adapter/not-installed', 'adapter ' + JSON.stringify(id) + ' is not installed', id) },
    disconnect: async () => {},
    revokePeer: async () => ({ ok: true }),
  }
  const client = createClientRoutes({ core, snapshot, actions, log: () => {} })
  const app = await mountSubsystems([server, client])
  const origin = app.origin
  try {
    const contract = await requestJson(origin + ROUTES.contract)
    assert.equal(contract.status, 200)
    assert.equal(contract.json.protocol, PROTOCOL_ID)
    assert.equal(contract.json.version, CONTRACT_VERSION)
    const contractAgain = await requestJson(origin + ROUTES.contract)
    assert.equal(contract.text, contractAgain.text)

    const wellKnown = await requestJson(origin + ROUTES.wellKnown)
    assert.equal(wellKnown.status, 200)
    assert.equal(wellKnown.json.protocol, PROTOCOL_ID)
    assert.equal(wellKnown.json.identity.linkId, core.identity.linkId)
    const pairingCode = JSON.parse(readFileSync(join(core.dir, 'pairing.json'), 'utf8')).code
    assert.equal(wellKnown.text.includes(pairingCode), false, 'well-known carries the pairing code')

    assert.equal((await requestJson(origin + LINK_PREFIX + '/nope')).status, 404)
    const wrongVerb = await requestJson(origin + ROUTES.contract, { method: 'POST', body: {} })
    assert.equal(wrongVerb.status, 405)
    assert.equal(wrongVerb.json.error.code, 'link/method-not-allowed')
    assert.match(String(wrongVerb.headers.allow), /GET/)

    const pair = generateKeyPairSync('ed25519')
    const publicKey = String(pair.publicKey.export({ format: 'jwk' }).x)
    const clientLinkId = linkIdForPublicKey(publicKey)
    const signChallenge = (challenge) => signPayload(null, Buffer.from(challenge, 'utf8'), pair.privateKey).toString('base64url')
    const unsupported = await requestJson(origin + ROUTES.handshake, { method: 'POST', body: { protocol: 'link-interconnect/2', client: { linkId: clientLinkId, pub: publicKey }, scopes: [] } })
    assert.equal(unsupported.status, 400)
    assert.equal(unsupported.json.error.code, 'link/version-unsupported')
    const handshake = await requestJson(origin + ROUTES.handshake, { method: 'POST', body: { protocol: PROTOCOL_ID, client: { linkId: clientLinkId, pub: publicKey, platform: 'test' }, scopes: ['models.provide', 'tools.expose'] } })
    assert.equal(handshake.status, 200)
    const challenge = handshake.json.challenge
    assert.equal(typeof challenge, 'string')
    const refused = await requestJson(origin + ROUTES.handshakeConfirm, { method: 'POST', body: { challenge, signature: signChallenge(challenge), pairingCode: 'WRONG' } })
    assert.equal(refused.status, 401)
    assert.equal(refused.json.error.code, 'link/unauthorized')
    assert.equal(core.peers.count(), 0, 'a refused confirm wrote a peer')
    const confirmed = await requestJson(origin + ROUTES.handshakeConfirm, { method: 'POST', body: { challenge, signature: signChallenge(challenge), pairingCode } })
    assert.equal(confirmed.status, 200)
    assert.equal(typeof confirmed.json.accessToken, 'string')
    assert.deepEqual(confirmed.json.scopes, ['models.provide', 'tools.expose'])
    assert.equal(confirmed.json.peer.linkId, clientLinkId)
    assert.equal(core.peers.count(), 1)
    assert.equal(core.grants.has(clientLinkId, 'models.provide'), true)
    const accessToken = confirmed.json.accessToken

    const noToken = await requestJson(origin + ROUTES.invoke, { method: 'POST', body: { cap: 'link.info', op: 'identity' } })
    assert.equal(noToken.status, 401)
    assert.equal(noToken.json.error.code, 'link/unauthorized')
    const noScope = await requestJson(origin + ROUTES.invoke, { method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: { cap: 'session.embed', op: 'session' } })
    assert.equal(noScope.status, 403)
    assert.equal(noScope.json.error.code, 'link/scope-missing')
    const identityCall = await requestJson(origin + ROUTES.invoke, { method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: { cap: 'link.info', op: 'identity' } })
    assert.equal(identityCall.status, 200)
    assert.equal(identityCall.json.ok, true)
    assert.equal(identityCall.json.result.linkId, core.identity.linkId)

    const mark = lines.length
    const idempotentBody = { cap: 'link.info', op: 'ping', idempotencyKey: 'unit-key-1' }
    const ping = await requestJson(origin + ROUTES.invoke, { method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: idempotentBody })
    const replay = await requestJson(origin + ROUTES.invoke, { method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: idempotentBody })
    assert.equal(ping.status, 200)
    assert.equal(ping.text, replay.text)
    assert.equal(replay.headers['x-link-idempotent-replay'], '1')
    assert.equal(lines.slice(mark).filter((line) => line.startsWith('invoke cap=link.info op=ping')).length, 1)

    const stream = await openEventStream(origin + ROUTES.events + '?token=' + encodeURIComponent(accessToken), { maxEvents: 3, timeoutMs: 2500 })
    assert.equal(stream.status, 200)
    assert.match(String(stream.headers['content-type']), /^text\/event-stream/)
    assert.equal(stream.events.length >= 2, true)
    assert.equal(stream.events.some((frame) => frame.type === 'invoke' && typeof frame.callId === 'string'), true)

    const state = await requestJson(origin + ROUTES.state)
    assert.equal(state.status, 200)
    assert.deepEqual(Object.keys(state.json).sort(), ['adapters', 'at', 'audit', 'bindings', 'contractVersion', 'counts', 'grants', 'linkId', 'peers', 'pendingConsent', 'protocol'])
    assert.equal(state.json.linkId, core.identity.linkId)
    const stateWrongVerb = await requestJson(origin + ROUTES.state, { method: 'POST', body: {} })
    assert.equal(stateWrongVerb.status, 405)
    assert.match(String(stateWrongVerb.headers.allow), /GET/)

    const pendingDecision = core.consent.request({ peerLinkId: 'peer-test', peerName: 'Peer Test', title: 'join?', capability: 'tools.expose', scopes: ['tools.expose'], risk: 'low' })
    const pendingList = await requestJson(origin + ROUTES.consent)
    assert.equal(pendingList.status, 200)
    assert.equal(pendingList.json.pending.length, 1)
    const decided = await requestJson(origin + ROUTES.consent, { method: 'POST', body: { id: pendingList.json.pending[0].id, decision: 'granted' } })
    assert.equal(decided.status, 200)
    assert.equal(await pendingDecision, 'granted')
    assert.equal((await requestJson(origin + ROUTES.consent, { method: 'POST', body: { id: 'missing', decision: 'granted' } })).status, 404)
    assert.equal((await requestJson(origin + ROUTES.consent, { method: 'POST', body: { id: 'x', decision: 'maybe' } })).status, 400)

    const audit = await requestJson(origin + ROUTES.audit + '?limit=5')
    assert.equal(audit.status, 200)
    assert.equal(Array.isArray(audit.json.records), true)
    assert.equal(audit.json.records.length <= 5, true)

    const settings = await requestJson(origin + ROUTES.settings)
    assert.equal(settings.status, 200)
    assert.equal(settings.json.linkId, core.identity.linkId)
    assert.equal(settings.text.includes(pairingCode), false, 'settings carries the pairing code')
    const storedIdentity = JSON.parse(readFileSync(join(core.dir, 'identity.json'), 'utf8'))
    assert.equal(settings.text.includes(storedIdentity.privateKey), false, 'settings carries the private key')

    const adapters = await requestJson(origin + ROUTES.adapters)
    assert.equal(adapters.status, 200)
    assert.deepEqual(adapters.json.adapters, [])
    const probed = await requestJson(origin + ROUTES.adapters, { method: 'POST', body: { op: 'probe' } })
    assert.equal(probed.status, 200)
    assert.equal(probed.json.result[0].reasonCode, 'not-installed')
    const refusedConnect = await requestJson(origin + ROUTES.adapters, { method: 'POST', body: { op: 'connect', id: 'ofm' } })
    assert.equal(refusedConnect.status, 409)
    assert.equal(refusedConnect.json.error.code, 'adapter/not-installed')
    assert.equal(refusedConnect.json.error.details.reasonCode, 'not-installed')
    assert.equal(refusedConnect.json.error.adapterId, 'ofm')
    assert.equal((await requestJson(origin + ROUTES.adapters, { method: 'POST', body: { op: 'nope' } })).status, 400)
  } finally {
    await app.close()
    await app.close()
    await server.stop()
    await server.stop()
  }
  assert.equal(core.consent.pendingCount(), 0)
}))

test('server: dataDir override wins and LINK_PAIRING_CODE is adopted at start', async () => {
  const home = tempDir('override-home')
  const dataDir = tempDir('override-data')
  const lines = []
  const previous = process.env.LINK_PAIRING_CODE
  process.env.LINK_PAIRING_CODE = 'TEST-CODE-9'
  try {
    const server = await createProtocolServer({ home, dataDir, log: (line) => lines.push(line) })
    try {
      assert.equal(server.core.dir, resolve(dataDir))
      assert.equal(existsSync(join(dataDir, 'identity.json')), true)
      assert.equal(existsSync(join(dataDir, 'pairing.json')), true)
      assert.equal(server.pairing.source, 'env')
      assert.equal(server.pairing.code, 'TEST-CODE-9')
      assert.equal(JSON.parse(readFileSync(join(dataDir, 'pairing.json'), 'utf8')).code, 'TEST-CODE-9')
      await server.start()
      assert.equal(lines.some((line) => line.startsWith('pairing code from LINK_PAIRING_CODE')), true)
    } finally {
      await server.stop()
    }
  } finally {
    if (previous === undefined) delete process.env.LINK_PAIRING_CODE
    else process.env.LINK_PAIRING_CODE = previous
    rmSync(home, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  }
})
