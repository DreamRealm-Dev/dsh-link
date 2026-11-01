#!/usr/bin/env node
/**
 * The relay across a real boundary: HTTP, the kernel's own web server, and a bearer token.
 *
 * The in-process gate proves the merge rules. It cannot prove that a peer can reach them: a
 * route that never binds, a token that is not checked, or a body that arrives as a string all
 * look healthy from inside. So this gate runs two experiments:
 *
 *   A  the endpoint itself      a real HTTP server drives the route the plugin registered, and
 *                               the refusals are counted as carefully as the acceptances
 *   B  a real kernel            the throwaway composition binds the route from row config, the
 *                               gate posts a batch to the running kernel, and the kernel's own
 *                               fold and ledger are graded afterwards
 *
 * Run:  node scripts/verify-collab-relay-http.mjs
 * Exit: 0 every check held; 1 a check failed; 2 the plugin or the probe is missing.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { Agent, createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
if (!existsSync(ENTRY)) {
  console.error('the plugin is not built: ' + ENTRY)
  process.exit(2)
}
const { apply } = await import('file:///' + ENTRY.replaceAll('\\', '/'))

const selfAttack = process.argv.includes('--self-attack')
const TOKEN = 'gate-token-' + Date.now().toString(36)
// The attack hands the kernel a different secret than the one this gate sends. If the route does not
// check the token, the authorised post still lands and the acceptance checks stay green — which is
// exactly the failure this gate exists to catch, so it must be its own failure when it cannot.
const KERNEL_TOKEN = selfAttack ? TOKEN + '-not-the-same' : TOKEN
const PATH = '/api/dsh-link-collab/relay'
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))

// ---------------------------------------------------------------- A: the endpoint, over HTTP
{
  const dir = mkdtempSync(join(tmpdir(), 'relay-http-'))
  let capability = null
  // R212: a real webServer holds a TABLE of routes, and this plugin legitimately registers two now (the relay
  // and, since R207, the status route). The stub used to keep ONE slot, so the second registration silently
  // replaced the first and every relay request 404'd - the product was fine, the fixture was a single-slot
  // pretend-server. It keeps a table by path, exactly like the thing it stands in for.
  const routes = new Map()
  const stub = { register: (value) => { routes.set(value.path, value); return () => { routes.delete(value.path) } } }
  const routeOf = (path) => routes.get(path) ?? null
  let route = null
  apply({
    get: (name) => (name === 'dshHomePath' ? () => dir : undefined),
    provide: (name, value) => { if (name === 'linkCollab') capability = value },
    effect: (work) => { work() },
    inject: (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) }),
  }, { relay: { token: TOKEN, path: PATH } })

  route = routeOf(PATH)
  if (route === null) {
    record('A the plugin registers a route when a token is configured', false, 'no route was registered for ' + PATH + ' (registered: ' + JSON.stringify([...routes.keys()]) + ')')
  } else {
    const server = createServer((req, res) => {
      if (req.url === route.path) { void route.handler(req, res); return }
      res.statusCode = 404
      res.end('no route')
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const url = 'http://127.0.0.1:' + String(server.address().port) + PATH
    const post = async (body, token) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: 'Bearer ' + token }) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const row = (seq, id, state) => ({ seq, kind: 'task/state', actor: 'team-A', payload: { id, state } })
    const batch = (writer, instance, records) => ({ writer, instance, records })

    const anonymous = await post(batch('peer-a', 'peer-1', [row(1, 't1', 'open')]))
    const wrongToken = await post(batch('peer-a', 'peer-1', [row(1, 't1', 'open')]), 'not-the-token')
    record('A a relay without the token is refused',
      anonymous.status === 401 && wrongToken.status === 401
      && anonymous.body?.code === 'UNAUTHORIZED' && wrongToken.body?.code === 'UNAUTHORIZED',
      'anonymous=' + String(anonymous.status) + '/' + String(anonymous.body?.code)
      + ' wrongToken=' + String(wrongToken.status) + '/' + String(wrongToken.body?.code))

    const shapeless = await post({ writer: 'peer-a', instance: 'peer-1' }, TOKEN)
    const notJson = await post('{ not json', TOKEN)
    record('A a body that is not a batch is refused, not applied',
      shapeless.status === 400 && notJson.status === 400
      && shapeless.body?.code === 'RELAY_MALFORMED' && notJson.body?.code === 'RELAY_MALFORMED',
      'noRecords=' + String(shapeless.body?.code) + ' notJson=' + String(notJson.body?.code))

    const good = await post(batch('peer-a', 'peer-1', [row(1, 't1', 'pending'), row(2, 't1', 'in_progress')]), TOKEN)
    const again = await post(batch('peer-a', 'peer-1', [row(1, 't1', 'pending'), row(2, 't1', 'in_progress')]), TOKEN)
    const folded = capability.state().tasks.map((task) => task.team + '/' + task.id + '/' + task.status)
    record('A an authorised batch lands once and folds',
      good.status === 200 && good.body?.appended === 2 && again.body?.appended === 0
      && JSON.stringify(folded) === JSON.stringify(['team-A/t1/in_progress']),
      'appended=' + String(good.body?.appended) + ' reAppended=' + String(again.body?.appended)
      + ' fold=' + JSON.stringify(folded))

    const asPeer = await capability.relayTo({ url, token: TOKEN, as: { writer: 'peer-b', instance: 'peer-2' } })
    const asSelf = await capability.relayTo({ url, token: TOKEN })
    record('A the client pushes under its own identity and is refused when it claims this log',
      asPeer.ok === true && asSelf.ok === false && asSelf.code === 'RELAY_IMPERSONATION',
      'asPeer=' + JSON.stringify(asPeer) + ' asSelf=' + JSON.stringify(asSelf))

    // The scheme is case-insensitive (RFC 7235) and so is the media type, and a refusal must not
    // take the caller's connection with it: an oversized batch answered by destroying the socket
    // made the peer's NEXT batch vanish as a reset that no counter saw.
    const headers = (extra) => ({ 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...extra })
    const lowercase = await fetch(url, { method: 'POST', headers: headers({ authorization: 'bearer ' + TOKEN }), body: JSON.stringify(batch('peer-c', 'peer-3', [row(1, 't3', 'open')])) })
    const oddCase = await fetch(url, { method: 'POST', headers: { 'content-type': 'Application/JSON', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(batch('peer-d', 'peer-4', [row(1, 't4', 'open')])) })
    const unauthGet = await fetch(url, { method: 'GET', headers: {} })
    record('A the scheme and media type are case-insensitive, and auth precedes dispatch',
      lowercase.status === 200 && oddCase.status === 200 && unauthGet.status === 401,
      'bearer=' + String(lowercase.status) + ' Application/JSON=' + String(oddCase.status) + ' unauthGET=' + String(unauthGet.status))

    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    const call = (body, extra) => new Promise((done) => {
      const request = httpRequest({ host: '127.0.0.1', port: server.address().port, path: PATH, method: 'POST', agent, headers: headers(extra ?? {}) }, (response) => {
        let text = ''
        response.on('data', (chunk) => { text += chunk })
        response.on('end', () => {
          let parsed = null
          try { parsed = JSON.parse(text) } catch { parsed = null }
          done({ status: response.statusCode, body: parsed })
        })
      })
      request.on('error', (error) => done({ status: 0, error: String(error.code ?? error.message) }))
      request.end(body)
    })
    const oversized = await call('x'.repeat(4 * 1024 * 1024 + 1))
    const afterOversized = await call(JSON.stringify(batch('peer-e', 'peer-5', [row(1, 't5', 'open')])))
    agent.destroy()
    record('A a refused oversized batch does not eat the request that follows it',
      oversized.status === 413 && afterOversized.status === 200 && afterOversized.body?.appended === 1,
      'oversized=' + String(oversized.status) + ' next=' + String(afterOversized.status) + '/' + JSON.stringify(afterOversized.body) + ' error=' + String(afterOversized.error ?? 'none'))

    await new Promise((done) => server.close(done))
  }
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- A2: a token nobody can send
{
  const dir = mkdtempSync(join(tmpdir(), 'relay-token-'))
  const routes = new Map()
  const stub = { register: (value) => { routes.set(value.path, value); return () => { routes.delete(value.path) } } }
  apply({
    get: (name) => (name === 'dshHomePath' ? () => dir : undefined),
    provide: () => undefined,
    effect: (work) => { work() },
    inject: (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) }),
  }, { relay: { token: '   ' } })
  const relayBound = routes.has(PATH)
  record('A a whitespace-only token binds no relay route', relayBound === false,
    relayBound === false ? 'no relay route registered (registered: ' + JSON.stringify([...routes.keys()]) + ')' : 'a relay route was registered for a token no client can present')
  rmSync(dir, { recursive: true, force: true })
}
// ---------------------------------------------------------------- B: a real kernel, reachable
{
  const root = mkdtempSync(join(PROJECT, '.tmp', 'relay-http-kernel-'))
  const note = join(root, 'kernel-lines.txt')
  const surface = join(root, 'surface.json')
  writeFileSync(note, '', 'utf8')
  const child = spawn('node', ['scripts/probe-kernel-surface.mjs', '--out', surface, '--timeout', '240000'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      NO_COLOR: '1',
      DSH_LINK_PROBE_NOTE: note,
      DSH_LINK_PROBE_RELAY_TOKEN: KERNEL_TOKEN,
      DSH_LINK_PROBE_RELAY_PATH: PATH,
      // The probe dumps on a timer; the gate needs time to reach the route before that happens.
      DSH_LINK_PROBE_DELAY_MS: '20000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = () => (existsSync(note) ? readFileSync(note, 'utf8') : '')
  const portOf = () => {
    const match = /dsh web: http:\/\/127\.0\.0\.1:(\d+)\//.exec(lines())
    return match === null ? null : Number(match[1])
  }
  const deadline = Date.now() + 120000
  let port = null
  while (Date.now() < deadline) {
    if (lines().includes('relay route bound on ' + PATH)) {
      port = portOf()
      if (port !== null) break
    }
    await wait(250)
  }
  if (port === null) {
    record('B the kernel binds the relay route from row config', false, 'no bound route and web URL within 120s')
  } else {
    record('B the kernel binds the relay route from row config', true, 'route bound on port ' + String(port))
    const url = 'http://127.0.0.1:' + String(port) + PATH
    const post = async (body, token) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: 'Bearer ' + token }) },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const batch = {
      writer: 'peer-kernel',
      instance: 'peer-kernel-1',
      records: [
        { seq: 1, kind: 'task/state', actor: 'team-K', payload: { id: 'k1', state: 'pending' } },
        { seq: 2, kind: 'task/state', actor: 'team-K', payload: { id: 'k1', state: 'completed', owner: 'kim' } },
      ],
    }
    const refused = await post(batch, 'wrong')
    const accepted = await post(batch, TOKEN)
    record('B the running kernel accepts an authorised batch and refuses an unauthorised one',
      refused.status === 401 && accepted.status === 200 && accepted.body?.appended === 2,
      'refused=' + String(refused.status) + ' accepted=' + String(accepted.status) + ' appended=' + String(accepted.body?.appended))
    const dumpDeadline = Date.now() + 90000
    while (Date.now() < dumpDeadline && !existsSync(surface)) await wait(250)
    if (!existsSync(surface)) {
      record('B the kernel reports the relay it served', false, 'the probe wrote no surface document')
    } else {
      const document = JSON.parse(readFileSync(surface, 'utf8'))
      const relay = document.relay ?? null
      const counts = document.relayCounts ?? null
      record('B the kernel reports the relay it served',
        relay?.bound === true && relay?.accepted === 1 && relay?.refused === 1
        && document.relayRecords === 2 && counts?.tasks === 1
        && document.relayWriters.includes('peer-kernel/peer-kernel-1'),
        'relay=' + JSON.stringify(relay) + ' records=' + String(document.relayRecords)
        + ' counts=' + JSON.stringify(counts) + ' writers=' + JSON.stringify(document.relayWriters))
    }
  }
  child.kill()
  await wait(500)
  rmSync(root, { recursive: true, force: true })
}
const failed = results.filter((row) => !row.ok)
const EXPECTED_UNDER_ATTACK = ['B the running kernel accepts an authorised batch and refuses an unauthorised one',
  'B the kernel reports the relay it served']
console.log('')
if (selfAttack) {
  const flipped = failed.map((row) => row.name)
  const localised = flipped.length === EXPECTED_UNDER_ATTACK.length
    && EXPECTED_UNDER_ATTACK.every((name) => flipped.includes(name))
  console.log('with a mismatched relay token: flipped=' + JSON.stringify(flipped))
  if (localised) {
    console.log('the token is enforced at the route: this gate can fail')
    process.exit(0)
  }
  console.log('a mismatched token changed nothing the gate noticed — it cannot tell what it measures')
  process.exit(1)
}
console.log(results.length + ' checks, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)
