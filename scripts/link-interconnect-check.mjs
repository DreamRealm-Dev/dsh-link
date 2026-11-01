#!/usr/bin/env node
/**
 * M1 acceptance for link-interconnect/1 - 12 readings.
 *
 *   node scripts/link-interconnect-check.mjs --standalone
 *   node scripts/link-interconnect-check.mjs --live [--url http://127.0.0.1:31761]
 *        [--pairing-code CODE] [--home <kernel-home>]
 *
 * --standalone builds the real protocol server and the real client routes in this process, mounts
 * them on a plain node:http server through scripts/lib/interconnect-harness.mjs (no cordis, no
 * app, no kernel: host modules are plain ESM), and runs every reading against that origin.
 *
 * --live runs the same readings against a running DSH-LINK. The pairing code is read from
 * --pairing-code, then LINK_PAIRING_CODE, then <home>/link-interconnect/pairing.json under
 * --home / DSH_HOME / the default kernel home. Without a code readings 7-12 fail with a named
 * reason (they need one granted peer) - readings 1-6 and 8 are still real.
 *
 * Exit 0 all 12 held | 1 a reading failed.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mountSubsystems, openEventStream, requestJson } from './lib/interconnect-harness.mjs'
import { CONTRACT_VERSION, LINK_PREFIX, PROTOCOL_ID, ROUTES } from '../plugins/dsh-link-interconnect/src/protocol/types.ts'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(PROJECT, 'plugins', 'dsh-link-interconnect')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const LIVE = has('--live')
const ORIGIN = flag('--url', 'http://127.0.0.1:31761').replace(/\/$/, '')
const DEFAULT_HOME = join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home')

const results = []
const need = (condition, message) => { if (!condition) throw new Error(message) }
const label12 = (n) => String(n).padStart(2, '0') + '/12'

async function reading(n, label, fn) {
  try {
    const detail = await fn()
    results.push({ n, ok: true, label })
    console.log('ok   ' + label12(n) + ' ' + label + (detail === undefined || detail === '' ? '' : '  [' + detail + ']'))
  } catch (error) {
    results.push({ n, ok: false, label })
    console.log('FAIL ' + label12(n) + ' ' + label + '  [' + String(error instanceof Error ? error.message : error) + ']')
  }
  return results[results.length - 1].ok
}

function newClient() {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = String(pair.publicKey.export({ format: 'jwk' }).x)
  return {
    publicKey,
    linkId: undefined,
    sign(challenge) { return sign(null, Buffer.from(challenge, 'utf8'), pair.privateKey).toString('base64url') },
  }
}

async function resolveClientId(identityModule, client) {
  const linkId = identityModule.linkIdForPublicKey(client.publicKey)
  need(typeof linkId === 'string' && linkId.length === 26, 'derived client linkId is not 26 chars')
  return linkId
}

async function runReadings(origin, context) {
  const { client, identityModule, pairingCode, log, badConfirmPeers } = context
  let challenge = ''
  let accessToken = ''
  const base = origin

  await reading(1, 'GET contract answers protocol + contract version', async () => {
    const reply = await requestJson(base + ROUTES.contract)
    need(reply.status === 200, 'status ' + reply.status)
    need(reply.json !== null && typeof reply.json === 'object', 'body is not JSON')
    need(reply.json.protocol === PROTOCOL_ID, 'protocol is ' + String(reply.json.protocol))
    need(reply.json.version === CONTRACT_VERSION, 'contract version is ' + String(reply.json.version))
    need(Array.isArray(reply.json.endpoints) && reply.json.endpoints.length > 0, 'contract carries no endpoints')
    return reply.json.protocol + ' ' + reply.json.version + ' endpoints=' + reply.json.endpoints.length
  })

  await reading(2, 'two contract GETs are byte-identical', async () => {
    const first = await requestJson(base + ROUTES.contract)
    const second = await requestJson(base + ROUTES.contract)
    need(first.status === 200 && second.status === 200, 'status ' + first.status + '/' + second.status)
    need(first.text === second.text, 'contract bytes differ between two reads')
    const digest = createHash('sha256').update(first.text).digest('hex').slice(0, 16)
    return 'bytes=' + first.text.length + ' sha256=' + digest
  })

  await reading(3, 'unknown path -> 404 link/not-found in the refusal envelope', async () => {
    const reply = await requestJson(base + LINK_PREFIX + '/check-does-not-exist')
    need(reply.status === 404, 'status ' + reply.status)
    need(reply.json?.ok === false, 'ok is not false')
    need(reply.json?.error?.code === 'link/not-found', 'code is ' + String(reply.json?.error?.code))
    need(typeof reply.json?.error?.message === 'string' && reply.json.error.message !== '', 'message is not a sentence')
    return '404 ' + reply.json.error.code
  })

  await reading(4, 'wrong method -> 405 link/method-not-allowed with Allow', async () => {
    const reply = await requestJson(base + ROUTES.contract, { method: 'POST', body: {} })
    need(reply.status === 405, 'status ' + reply.status)
    need(reply.json?.error?.code === 'link/method-not-allowed', 'code is ' + String(reply.json?.error?.code))
    need(String(reply.headers.allow ?? '').toUpperCase().includes('GET'), 'Allow header is ' + String(reply.headers.allow))
    return '405 ' + reply.json.error.code + ' Allow=' + reply.headers.allow
  })

  await reading(5, 'POST handshake -> {challenge, expiresIn}', async () => {
    client.linkId = await resolveClientId(identityModule, client)
    const reply = await requestJson(base + ROUTES.handshake, {
      method: 'POST',
      body: {
        protocol: PROTOCOL_ID,
        client: { linkId: client.linkId, pub: client.publicKey, platform: 'check', name: 'M1 Check Client' },
        scopes: ['models.provide', 'tools.expose', 'not-a-known-scope'],
      },
    })
    need(reply.status === 200, 'status ' + reply.status + ' ' + reply.text.slice(0, 120))
    challenge = reply.json?.challenge
    need(typeof challenge === 'string' && challenge.length >= 16, 'challenge is not a nonce')
    need(typeof reply.json?.expiresIn === 'number' && reply.json.expiresIn > 0, 'expiresIn is not positive')
    return 'challenge=' + challenge.slice(0, 8) + '... expiresIn=' + reply.json.expiresIn + 's'
  })

  await reading(6, 'confirm with a wrong pairingCode -> 401 link/unauthorized', async () => {
    need(challenge !== '', 'no challenge from reading 5')
    const reply = await requestJson(base + ROUTES.handshakeConfirm, {
      method: 'POST',
      body: { challenge, signature: client.sign(challenge), pairingCode: 'WRONG-CODE-0000' },
    })
    need(reply.status === 401, 'status ' + reply.status)
    need(reply.json?.error?.code === 'link/unauthorized', 'code is ' + String(reply.json?.error?.code))
    if (badConfirmPeers !== undefined) need(badConfirmPeers() === 0, 'a refused confirm still wrote a peer row')
    return '401 ' + reply.json.error.code
  })

  await reading(7, 'confirm with the right code -> accessToken, refreshToken, scopes, peer', async () => {
    need(challenge !== '', 'no challenge from reading 5')
    const code = pairingCode()
    need(typeof code === 'string' && code !== '', 'no pairing code available')
    const reply = await requestJson(base + ROUTES.handshakeConfirm, {
      method: 'POST',
      body: { challenge, signature: client.sign(challenge), pairingCode: code },
    })
    need(reply.status === 200, 'status ' + reply.status + ' ' + reply.text.slice(0, 200))
    accessToken = reply.json?.accessToken
    need(typeof accessToken === 'string' && accessToken.split('.').length === 3, 'accessToken is not a compact JWS')
    need(typeof reply.json?.refreshToken === 'string' && reply.json.refreshToken.split('.').length === 3, 'refreshToken is not a compact JWS')
    need(Array.isArray(reply.json?.scopes), 'scopes is not an array')
    need(reply.json.scopes.slice().sort().join(',') === 'models.provide,tools.expose', 'granted scopes are ' + reply.json.scopes.join(','))
    need(typeof reply.json?.peer?.linkId === 'string' && reply.json.peer.linkId === client.linkId, 'peer.linkId does not match the client key')
    need(typeof reply.json?.peer?.name === 'string' && reply.json.peer.name !== '', 'peer.name is empty')
    const contract = await requestJson(base + ROUTES.contract)
    need(contract.text.includes(code) === false, 'the pairing code leaked into the contract')
    if (log !== undefined) {
      const pairingLines = log().filter((line) => line.startsWith('pairing code '))
      need(pairingLines.length === 1, 'pairing log lines=' + String(pairingLines.length) + ' (want exactly 1)')
    }
    return 'tokens minted; scopes=' + reply.json.scopes.join(',') + '; peer=' + reply.json.peer.name + '; code never in contract'
  })

  await reading(8, 'invoke without a token -> 401 link/unauthorized', async () => {
    const reply = await requestJson(base + ROUTES.invoke, { method: 'POST', body: { cap: 'link.info', op: 'identity' } })
    need(reply.status === 401, 'status ' + reply.status)
    need(reply.json?.error?.code === 'link/unauthorized', 'code is ' + String(reply.json?.error?.code))
    return '401 ' + reply.json.error.code
  })

  await reading(9, 'invoke with a token lacking the scope -> 403 link/scope-missing', async () => {
    need(accessToken !== '', 'no access token from reading 7')
    const reply = await requestJson(base + ROUTES.invoke, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken },
      body: { cap: 'session.embed', op: 'session' },
    })
    need(reply.status === 403, 'status ' + reply.status)
    need(reply.json?.error?.code === 'link/scope-missing', 'code is ' + String(reply.json?.error?.code))
    return '403 ' + reply.json.error.code
  })

  await reading(10, 'invoke with the scope -> {ok:true,result} for link.info/identity', async () => {
    need(accessToken !== '', 'no access token from reading 7')
    const reply = await requestJson(base + ROUTES.invoke, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken },
      body: { cap: 'link.info', op: 'identity' },
    })
    need(reply.status === 200, 'status ' + reply.status)
    need(reply.json?.ok === true, 'ok is not true')
    need(reply.json?.result !== undefined, 'result is missing')
    need(reply.json.result.protocol === PROTOCOL_ID, 'result.protocol is ' + String(reply.json.result.protocol))
    need(typeof reply.json.result.linkId === 'string' && reply.json.result.linkId.length === 26, 'result.linkId is not 26 chars')
    if (context.core !== undefined) need(reply.json.result.linkId === context.core.identity.linkId, 'result.linkId is not this instance')
    return 'ok:true result.linkId=' + reply.json.result.linkId
  })

  await reading(11, 'same idempotencyKey twice -> identical first result, handler ran once', async () => {
    need(accessToken !== '', 'no access token from reading 7')
    const logMark = log === undefined ? 0 : log().length
    const request = {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken },
      body: { cap: 'link.info', op: 'ping', idempotencyKey: 'check-idempotency-' + String(Date.now()) },
    }
    const first = await requestJson(base + ROUTES.invoke, request)
    const second = await requestJson(base + ROUTES.invoke, request)
    need(first.status === 200 && second.status === 200, 'status ' + first.status + '/' + second.status)
    need(first.json?.ok === true, 'first invoke did not answer ok:true')
    need(first.text === second.text, 'replayed answer is not byte-identical')
    need(second.headers['x-link-idempotent-replay'] === '1', 'second answer carries no x-link-idempotent-replay header')
    need(second.json.result.at === first.json.result.at, 'the handler result changed on replay')
    let executed = 'n/a (live)'
    if (log !== undefined) {
      const lines = log().slice(logMark)
      executed = String(lines.filter((line) => line.startsWith('invoke cap=link.info op=ping')).length)
      need(executed === '1', 'handler executed ' + executed + ' times for one idempotencyKey (want 1)')
      const replays = lines.filter((line) => line.startsWith('invoke-replay')).length
      need(replays === 1, 'replay log lines=' + String(replays) + ' (want 1)')
      executed = 'executed=1 replay=1'
    }
    return 'same bytes; ' + executed
  })

  await reading(12, 'GET events?token= -> text/event-stream with backlog replay', async () => {
    need(accessToken !== '', 'no access token from reading 7')
    // Collect enough frames that a backlog with unrelated boot events (an adapter probe round and a
    // restored binding publish three before this run starts) cannot hide the invoke frames under a
    // fixed small cap. The product guarantee is "the backlog replays", not "the first three frames".
    const stream = await openEventStream(base + ROUTES.events + '?token=' + encodeURIComponent(accessToken), { maxEvents: 200, timeoutMs: 2500 })
    need(stream.status === 200, 'status ' + stream.status)
    need(String(stream.headers['content-type'] ?? '').startsWith('text/event-stream'), 'content-type is ' + String(stream.headers['content-type']))
    need(stream.events.length >= 1, 'no backlog frames replayed')
    const invokes = stream.events.filter((frame) => frame.type === 'invoke')
    need(invokes.length >= 1, 'backlog carries no invoke frame: ' + JSON.stringify(stream.events.map((frame) => frame.type)))
    need(invokes.every((frame) => typeof frame.callId === 'string' && frame.callId.startsWith('call_')), 'invoke frame has no callId')
    need(invokes.every((frame) => Number.isInteger(frame.seq) && frame.seq > 0), 'invoke frame has no seq')
    return 'text/event-stream; backlog=' + stream.events.length + ' invokeFrames=' + invokes.length + ' seq=' + invokes[0].seq
  })

  if (context.clientRoutes !== undefined) {
    const state = await requestJson(base + ROUTES.state)
    const audit = await requestJson(base + ROUTES.audit + '?limit=5')
    const wrong = await requestJson(base + ROUTES.state, { method: 'POST', body: {} })
    console.log('info client routes: GET state ' + state.status + ' peers=' + String(state.json?.counts?.peers) + ', GET audit ' + audit.status + ' records=' + String(audit.json?.records?.length) + ', POST state -> ' + wrong.status + ' ' + String(wrong.json?.error?.code))
  }
}

async function resolvePairingCode() {
  const explicit = flag('--pairing-code', process.env.LINK_PAIRING_CODE ?? '')
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') return { code: String(explicit).trim(), source: 'flag/env' }
  const homes = [flag('--home', ''), process.env.DSH_HOME ?? '', DEFAULT_HOME].filter((home) => home !== '')
  for (const home of homes) {
    const file = join(String(home), 'link-interconnect', 'pairing.json')
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed?.code === 'string' && parsed.code.trim() !== '') return { code: parsed.code.trim(), source: file }
    } catch {
      continue
    }
  }
  return { code: '', source: '' }
}

async function runLive() {
  const client = newClient()
  const pairing = await resolvePairingCode()
  console.log('live origin: ' + ORIGIN + ' | pairing code: ' + (pairing.code === '' ? 'UNAVAILABLE (pass --pairing-code or --home)' : 'from ' + pairing.source))
  const identityModule = await import(pathToFileURL(join(PLUGIN, 'src/identity/store.ts')).href)
  if (pairing.code === '') {
    await reading(7, 'confirm with the right code -> accessToken, refreshToken, scopes, peer', async () => {
      throw new Error('pairing code unavailable; pass --pairing-code <code> or --home <kernel-home> (app started with LINK_PAIRING_CODE?)')
    })
  }
  await runReadings(ORIGIN, {
    client,
    identityModule,
    pairingCode: () => pairing.code,
    log: undefined,
    core: undefined,
  })
}

async function runStandalone() {
  const home = mkdtempSync(join(tmpdir(), 'link-interconnect-check-'))
  const lines = []
  let app = null
  let server = null
  try {
    const serverModule = await import(pathToFileURL(join(PLUGIN, 'src/protocol/server.ts')).href)
    const clientModule = await import(pathToFileURL(join(PLUGIN, 'src/http/client.ts')).href)
    const identityModule = await import(pathToFileURL(join(PLUGIN, 'src/identity/store.ts')).href)
    server = await serverModule.createProtocolServer({ home, log: (line) => lines.push(line) })
    const core = server.core
    const snapshot = () => ({
      protocol: core.protocol,
      contractVersion: CONTRACT_VERSION,
      linkId: core.identity.linkId,
      at: new Date().toISOString(),
      peers: core.peers.list(),
      grants: core.grants.list(),
      pendingConsent: core.consent.listPending(),
      bindings: [],
      adapters: [],
      audit: core.audit.list(50),
      counts: {
        peers: core.peers.list().length,
        activePeers: core.peers.list().filter((peer) => peer.status === 'active').length,
        bindings: 0,
        activeBindings: 0,
        pendingConsent: core.consent.listPending().length,
      },
    })
    const clientRoutes = clientModule.createClientRoutes({ core, snapshot, log: () => {} })
    app = await mountSubsystems([server, clientRoutes])
    console.log('standalone home: ' + home + ' | origin: ' + app.origin + ' | linkId: ' + core.identity.linkId)
    const client = newClient()
    await runReadings(app.origin, {
      client,
      identityModule,
      core,
      clientRoutes,
      log: () => lines,
      pairingCode: () => {
        const file = join(core.dir, 'pairing.json')
        need(existsSync(file), 'pairing.json is missing')
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        need(typeof parsed?.code === 'string' && parsed.code !== '', 'pairing.json carries no code')
        return parsed.code
      },
      badConfirmPeers: () => core.peers.count(),
    })
  } finally {
    if (app !== null) await app.close()
    rmSync(home, { recursive: true, force: true })
  }
}

try {
  if (LIVE) await runLive()
  else await runStandalone()
} catch (error) {
  console.log('FAIL setup: ' + String(error instanceof Error ? (error.stack ?? error.message) : error))
}

const held = results.filter((result) => result.ok).length
const failed = results.length - held
console.log('---')
if (LIVE) {
  console.log('M1 link-interconnect check (live ' + ORIGIN + '): ' + held + '/12 held, ' + failed + ' failed')
} else {
  console.log('M1 link-interconnect check (standalone): ' + held + '/12 held, ' + failed + ' failed')
  console.log('required sub-readings: no-token 401 link/unauthorized [reading 8]; missing-scope 403 link/scope-missing [reading 9]')
}
process.exitCode = held === 12 ? 0 : 1
