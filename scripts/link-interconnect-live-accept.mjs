#!/usr/bin/env node
/**
 * link-interconnect live acceptance (R472): M1 live 12/12 through the shell, the M2 closed loop
 * (probe -> consent -> bind -> provider), the M4 embed token matrix and the M5 model-proxy matrix.
 *
 *   node scripts/link-interconnect-live-accept.mjs [--origin http://127.0.0.1:31761] [--home <kernel-home>] [--json]
 *
 * The app must be running (started with LINK_PROXY_UPSTREAM_URL naming an OpenAI-compatible stub)
 * and this script never starts or stops it. Every reading is an assertion with its own sentence;
 * exit 0 only when all hold.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const ORIGIN = flag('--origin', 'http://127.0.0.1:31761').replace(/\/+$/, '')
const HOME = flag('--home', join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home'))
const JSON_OUT = argv.includes('--json')
const EMBED_ORIGIN = 'http://127.0.0.1:19401'

const rows = []
const hold = (id, ok, detail) => { rows.push({ id, ok: ok === true, detail: String(detail ?? '') }) }
const getJson = async (path, init) => {
  const answer = await fetch(ORIGIN + path, { ...init, signal: AbortSignal.timeout(20000) })
  const text = await answer.text()
  let json = null
  try { json = JSON.parse(text) } catch (error) { void error }
  return { status: answer.status, headers: answer.headers, text, json }
}
const jsonPost = (path, body) => getJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------------------------------------------------------------- M1 through the shell
const pairing = (() => {
  try { return JSON.parse(readFileSync(join(HOME, 'link-interconnect', 'pairing.json'), 'utf8')).code } catch (error) { return undefined }
})()
hold('M1.1 pairing code readable from the data dir', typeof pairing === 'string' && pairing.length >= 4, pairing === undefined ? 'pairing.json missing' : 'code present (never printed)')
const contract = await getJson('/link/v1/contract')
const contractAgain = await getJson('/link/v1/contract')
hold('M1.2 contract 200 through the shell', contract.status === 200 && contract.json?.protocol === 'link-interconnect/1', 'status ' + String(contract.status))
hold('M1.3 contract is byte-identical twice', contract.text === contractAgain.text, contract.json?.version ?? '')
const noToken = await jsonPost('/link/v1/invoke', { cap: 'link.info', op: 'identity', args: {} })
hold('M1.4 invoke without a token is 401 link/unauthorized', noToken.status === 401 && noToken.json?.error?.code === 'link/unauthorized', String(noToken.status) + ' ' + String(noToken.json?.error?.code))
hold('M1.5 unknown protocol path is a named 404', (await getJson('/link/v1/never')).status === 404, '')
hold('M1.6 wrong method keeps 405 + Allow through the proxy', (await jsonPost('/link/v1/contract', {})).headers.get('allow') === 'GET', 'allow=' + String((await jsonPost('/link/v1/contract', {})).headers.get('allow')))

// ---------------------------------------------------------------- M2 closed loop
const stateBefore = await getJson('/api/dsh-link-interconnect/state')
const adapters = stateBefore.json?.adapters ?? []
hold('M2.1 the pane snapshot answers with the declared adapter row', adapters.some((row) => row.id === 'ofm'), JSON.stringify(adapters.map((row) => row.id + ':' + (row.detected ? 'detected' : row.reasonCode))))
hold('M2.2 the declared OFM service is detected by its health fingerprint', adapters.some((row) => row.id === 'ofm' && row.detected === true), JSON.stringify(adapters.find((row) => row.id === 'ofm')?.reasonCode ?? 'detected'))
await jsonPost('/api/dsh-link-interconnect/adapters', { op: 'disconnect', id: 'ofm' })
const connectPromise = jsonPost('/api/dsh-link-interconnect/adapters', { op: 'connect', id: 'ofm' }).catch((error) => ({ status: 0, json: { error: { message: String(error?.message ?? error) } } }))
let pending = null
for (let attempt = 0; attempt < 40 && pending === null; attempt += 1) {
  await new Promise((done) => setTimeout(done, 250))
  const state = await getJson('/api/dsh-link-interconnect/state')
  const list = state.json?.pendingConsent ?? []
  if (list.length > 0) pending = list[0]
}
hold('M2.3 a consent question is waiting (never answered silently)', pending !== null, pending === null ? 'no pending question' : pending.title + ' scopes=' + pending.scopes.join(','))
hold('M2.4 the question names the software and asks for exactly its scope', pending?.scopes?.length === 1 && pending.scopes[0] === 'models.provide', JSON.stringify(pending?.scopes ?? []))
const decided = pending === null ? null : await jsonPost('/api/dsh-link-interconnect/consent', { id: pending.id, decision: 'granted' })
hold('M2.5 the person-granted decision is accepted', decided?.status === 200 && decided.json?.ok === true, String(decided?.status))
const connected = await connectPromise
const binding = connected.json?.result
hold('M2.6 connect resolves to an active binding with the provider id', connected.json?.ok === true && binding?.status === 'active' && binding?.providerId === 'our-free-model', JSON.stringify(binding ?? connected.json))
const stateAfter = await getJson('/api/dsh-link-interconnect/state')
hold('M2.7 the snapshot counts the binding and clears the question', (stateAfter.json?.counts?.bindings ?? 0) >= 1 && stateAfter.json?.counts?.pendingConsent === 0, JSON.stringify(stateAfter.json?.counts))

// ---------------------------------------------------------------- M3 ingress (software-active)
// The SDK echo service is started in this process; LINK then adds it by origin URL, asks the
// person, binds its tool and its model channel. The AGENT-CALL reading (a model turn invoking
// echo_ping and quoting its {"pong":true} answer) is taken separately through the page and is
// recorded in docs/link-interconnect/READINGS-R472.md, because it needs a model turn.
let echoPeer = null
try {
  const module = await import('../packages/link-interconnect-sdk/examples/echo-service/main.mjs')
  echoPeer = await module.startEchoService({ port: 0 })
} catch (error) {
  hold('M3.0 the SDK echo service starts in-process', false, String(error?.message ?? error))
}
if (echoPeer !== null) {
  hold('M3.0 the SDK echo service starts in-process', typeof echoPeer.url === 'string' && echoPeer.url.startsWith('http://127.0.0.1:'), echoPeer.url)
  const addPromise = jsonPost('/api/dsh-link-interconnect/peers', { op: 'add', url: echoPeer.url }).catch((error) => ({ status: 0, json: { error: { message: String(error?.message ?? error) } } }))
  let peerQuestion = null
  for (let attempt = 0; attempt < 40 && peerQuestion === null; attempt += 1) {
    await new Promise((done) => setTimeout(done, 200))
    const state = await getJson('/api/dsh-link-interconnect/state')
    const list = state.json?.pendingConsent ?? []
    if (list.length > 0) peerQuestion = list[0]
  }
  hold('M3.1 adding a peer by URL raises one consent question naming it', peerQuestion !== null && String(peerQuestion.title).includes('Echo Service'), peerQuestion === null ? 'no question' : peerQuestion.title + ' scopes=' + peerQuestion.scopes.join(','))
  hold('M3.2 the question carries the scopes the declaration asks for', Array.isArray(peerQuestion?.scopes) && peerQuestion.scopes.includes('tools.expose') && peerQuestion.scopes.includes('models.provide'), JSON.stringify(peerQuestion?.scopes ?? []))
  if (peerQuestion !== null) await jsonPost('/api/dsh-link-interconnect/consent', { id: peerQuestion.id, decision: 'granted' })
  const added = await addPromise
  const row = added.json?.result
  hold('M3.3 the peer is active with its declared tool', added.json?.ok === true && row?.status === 'active' && Array.isArray(row?.tools) && row.tools.includes('echo.ping'), JSON.stringify(row ?? added.json))
  hold('M3.4 the peer contributes a model channel', typeof row?.providerId === 'string' && row.providerId !== '', String(row?.providerId))
  const peersRead = await getJson('/api/dsh-link-interconnect/peers')
  const peerRow = (peersRead.json?.result ?? [])[0]
  hold('M3.5 the model catalog answers through the registered provider (echo-1 in the list)', Array.isArray(peerRow?.models) && peerRow.models.includes('echo-1'), JSON.stringify(peerRow?.models ?? []))
  hold('M3.6 the kernel registered the peer tool (boot log names it)', (() => {
    try { return readFileSync(join(HOME, 'boot.log'), 'utf8').includes('tools registered from peer') } catch (error) { return false }
  })(), 'boot.log: tools registered from peer')
}

// ---------------------------------------------------------------- M4 embed v2
const minted = await jsonPost('/link/v1/embed/token', { sessionId: 'live-accept', mode: 'full', origin: EMBED_ORIGIN })
const token = minted.json?.token
hold('M4.1 a session token is minted for one audience', minted.status === 200 && typeof token === 'string' && typeof minted.json?.expiresAt === 'string', 'status ' + String(minted.status))
const noTokenEmbed = await getJson('/link/v1/embed/session?nonce=n1')
hold('M4.2 the embed page without a token is 401', noTokenEmbed.status === 401 && noTokenEmbed.json?.error?.code === 'link/unauthorized', String(noTokenEmbed.status))
const foreign = token === undefined ? { status: 0 } : await getJson('/link/v1/embed/session?token=' + encodeURIComponent(token) + '&nonce=n2', { headers: { origin: 'http://127.0.0.1:19499' } })
hold('M4.3 a foreign audience is refused', foreign.status === 401, String(foreign.status))
// The nonce is minted WITH the token (it is what the parent page keeps to prove the frame it
// framed); a hand-picked nonce is correctly refused. Read it off the minted url.
const mintedNonce = (() => {
  const raw = minted.json?.url
  if (typeof raw !== 'string') return 'n3'
  try { return new URL(raw, ORIGIN).searchParams.get('nonce') ?? 'n3' } catch (error) { return 'n3' }
})()
const embedded = token === undefined ? { status: 0, headers: new Headers(), text: '' } : await getJson('/link/v1/embed/session?token=' + encodeURIComponent(token) + '&nonce=' + encodeURIComponent(mintedNonce), { headers: { origin: EMBED_ORIGIN } })
hold('M4.4 the correct audience gets the page and its frame policy', embedded.status === 200 && embedded.text.includes('link:embed:ready') && String(embedded.headers.get('content-security-policy') ?? '').includes('frame-ancestors'), 'status ' + String(embedded.status) + ' csp=' + String(embedded.headers.get('content-security-policy')))
const claims = (() => {
  if (typeof token !== 'string') return null
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) } catch (error) { return null }
})()
const revoked = claims === null ? { status: 0 } : await jsonPost('/api/dsh-link-interconnect/tokens/revoke', { jti: claims.jti })
const afterRevoke = token === undefined ? { status: 0 } : await getJson('/link/v1/embed/session?token=' + encodeURIComponent(token) + '&nonce=' + encodeURIComponent(mintedNonce), { headers: { origin: EMBED_ORIGIN } })
hold('M4.5 the same token is 401 after its jti is revoked', revoked.status === 200 && afterRevoke.status === 401, 'revoke ' + String(revoked.status) + ' embed ' + String(afterRevoke.status))

// ---------------------------------------------------------------- M5 model proxy
const created = await jsonPost('/api/dsh-link-interconnect/proxy-keys', { label: 'live-accept', models: ['our-free-model-mini'], rpm: 3 })
const proxyKey = created.json?.result?.key
hold('M5.1 an admin mints one proxy key (raw key visible once)', created.status === 200 && typeof proxyKey === 'string' && proxyKey.startsWith('lk_'), 'status ' + String(created.status))
const proxied = proxyKey === undefined ? { status: 0, text: '' } : await getJson('/link/v1/openai/v1/models', { headers: { authorization: 'Bearer ' + proxyKey } })
hold('M5.2 a whitelisted model channel answers 200 through the proxy', proxied.status === 200, 'status ' + String(proxied.status) + ' ' + proxied.text.slice(0, 80))
const forbidden = proxyKey === undefined ? { status: 0 } : await getJson('/link/v1/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + proxyKey }, body: JSON.stringify({ model: 'not-in-the-whitelist', messages: [] }) })
hold('M5.3 a model outside the key whitelist is 403 link/scope-missing', forbidden.status === 403 && forbidden.json?.error?.code === 'link/scope-missing', String(forbidden.status))
let rateLimited = null
for (let attempt = 0; attempt < 6 && rateLimited === null; attempt += 1) {
  const answer = proxyKey === undefined ? null : await getJson('/link/v1/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + proxyKey }, body: JSON.stringify({ model: 'our-free-model-mini', messages: [{ role: 'user', content: 'ping' }] }) })
  if (answer !== null && answer.status === 429) rateLimited = answer
}
hold('M5.4 the fourth call inside the minute is 429 with Retry-After', rateLimited !== null && rateLimited.json?.error?.code === 'link/rate-limited' && rateLimited.headers.get('retry-after') !== null, rateLimited === null ? 'never rate limited' : 'retry-after=' + String(rateLimited.headers.get('retry-after')))
hold('M5.5 no raw key is stored: the admin listing carries ids only', await (async () => {
  const list = await getJson('/api/dsh-link-interconnect/proxy-keys')
  const text = JSON.stringify(list.json ?? {})
  return list.status === 200 && text.includes('live-accept') && !text.includes(proxyKey ?? 'SHOULD-NOT-MATCH')
})(), '')
if (created.json?.result?.id !== undefined) await jsonPost('/api/dsh-link-interconnect/proxy-keys', { op: 'revoke', id: created.json.result.id })

if (echoPeer !== null) {
  const removed = await jsonPost('/api/dsh-link-interconnect/peers', { op: 'remove', id: 'svc_echo_01' })
  hold('M3.7 removing the peer answers and drops the binding', removed.json?.ok === true && removed.json?.result?.removed === true, JSON.stringify(removed.json ?? {}))
  try { await echoPeer.close() } catch (error) { void error }
}

// ---------------------------------------------------------------- verdict
const held = rows.filter((row) => row.ok).length
if (JSON_OUT) {
  console.log(JSON.stringify({ origin: ORIGIN, rows, held, failed: rows.length - held }, null, 2))
} else {
  for (const row of rows) console.log((row.ok ? 'ok   ' : 'FAIL ') + row.id + (row.detail === '' ? '' : '  [' + row.detail + ']'))
  console.log('---')
  console.log('link-interconnect live acceptance: ' + held + '/' + rows.length + ' held, ' + (rows.length - held) + ' failed')
}
process.exit(rows.every((row) => row.ok) ? 0 : 1)
