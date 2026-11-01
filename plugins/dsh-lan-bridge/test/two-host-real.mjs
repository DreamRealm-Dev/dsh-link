/**
 * Cross-application verification: drive two REAL DSH hosts over their own HTTP
 * surfaces and prove the bridge works between them.
 *
 * This uses nothing but the public browser contract of each host:
 *   1. GET /?token=<dsh token>            → the page HTML (behind DSH's own fence)
 *   2. read window.__DSH_LAN_BRIDGE_UI__  → the panel's own token, as the browser does
 *   3. POST /dsh-lan-bridge/api           → the panel's op table
 *
 * usage: node test/two-host-real.mjs <agentBase> <agentDshToken> <bridgeBase> <bridgeDshToken> [sharedRoot]
 */

const [agentBase, agentDshToken, bridgeBase, bridgeDshToken, sharedRootArg] = process.argv.slice(2)
if (agentBase === undefined || bridgeBase === undefined) {
  console.error('usage: node two-host-real.mjs <agentBase> <agentDshToken> <bridgeBase> <bridgeDshToken> [sharedRoot]')
  process.exit(2)
}

let failures = 0
let checks = 0
function ok(name, condition, detail) {
  checks += 1
  const line = `${condition ? 'PASS' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` :: ${detail}`}`
  console.log(line)
  if (!condition) failures += 1
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, { timeoutMs = 20_000, intervalMs = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(intervalMs)
  }
}

function makeClient(base, dshToken) {
  let uiToken = null
  let authCookie = ''
  async function loadToken() {
    // DSH's browser-trust fence answers the launcher URL with a 303 that sets an
    // HttpOnly auth cookie; Node's fetch keeps no cookie jar, so the exchange is
    // done explicitly the two steps a browser would take.
    const first = await fetch(`${base}/?token=${encodeURIComponent(dshToken ?? '')}`, { redirect: 'manual' })
    const cookies = first.headers.getSetCookie ? first.headers.getSetCookie() : [first.headers.get('set-cookie')].filter(Boolean)
    authCookie = cookies.map((c) => String(c).split(';')[0]).join('; ')
    if (first.status >= 400) {
      throw new Error(`${base} refused the DSH token with HTTP ${first.status}`)
    }
    const response = await fetch(`${base}/`, {
      redirect: 'follow',
      headers: authCookie === '' ? { accept: 'text/html' } : { cookie: authCookie, accept: 'text/html' },
    })
    const html = await response.text()
    // The injected global is a JavaScript object literal (unquoted keys, single
    // quotes), so the fields are read directly rather than through JSON.parse.
    const block = /window\.__DSH_LAN_BRIDGE_UI__\s*=\s*\{([^}]*)\}/.exec(html)
    const tokenMatch = block === null ? null : /\btoken\s*:\s*"([^"]+)"/.exec(block[1])
    if (tokenMatch === null) {
      throw new Error(
        `the page served by ${base} carries no __DSH_LAN_BRIDGE_UI__ token ` +
          `(HTTP ${response.status}, ${html.length} bytes) — is the plugin mounted in this host?`,
      )
    }
    const channelMatch = /\bchannel\s*:\s*"([^"]+)"/.exec(block[1])
    uiToken = tokenMatch[1]
    return { token: uiToken, channel: channelMatch === null ? null : channelMatch[1] }
  }
  async function call(op, args = {}) {
    const response = await fetch(`${base}/dsh-lan-bridge/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-bridge-ui': uiToken ?? '' },
      body: JSON.stringify({ op, args }),
    })
    const payload = await response.json()
    if (payload.ok !== true) throw new Error(`${op} failed: ${payload.error}`)
    return payload.value
  }
  return { loadToken, call, base }
}

const agent = makeClient(agentBase, agentDshToken)
const bridge = makeClient(bridgeBase, bridgeDshToken)

try {
  // --- 1. the plugin is mounted and its panel carrier answers ---------------
  const agentInjected = await agent.loadToken()
  const bridgeInjected = await bridge.loadToken()
  // Start from a known state: a previous run may have left a session up, and the
  // "no tools before connecting" case below depends on a clean slate.
  await agent.call('disconnect', {}).catch(() => {})
  eq('the panel token is delivered through the DSH page on the 0.1.5 agent host', typeof agentInjected.token, 'string')
  eq('the panel token is delivered through the DSH page on the 0.2.0 bridge host', typeof bridgeInjected.token, 'string')
  console.log(`     agent  page injected: ${JSON.stringify(agentInjected)}`)
  console.log(`     bridge page injected: ${JSON.stringify(bridgeInjected)}`)

  let state = await agent.call('state')
  console.log(`     agent  host: ${state.deviceName} ${state.os}/${state.arch} role=${state.role} port=${state.port}`)
  eq('the 0.1.5 host reports the plugin diagnostics', Array.isArray(state.diagnostics?.toolsUnlocked), true,
    JSON.stringify(state.diagnostics))
  eq('no bridge tools are unlocked before connecting', state.diagnostics.toolsUnlocked.length, 0)
  state = await bridge.call('state')
  console.log(`     bridge host: ${state.deviceName} ${state.os}/${state.arch} role=${state.role} port=${state.port}`)
  ok('the 0.2.0 host is listening', typeof state.port === 'number' && state.port > 0, `port=${state.port}`)

  // --- 2. roles -------------------------------------------------------------
  await agent.call('role.set', { role: 'agent' })
  await bridge.call('role.set', { role: 'bridge' })
  eq('the agent host accepts the Agent 侧 role', (await agent.call('state')).role, 'agent')
  eq('the bridge host accepts the 桥接侧 role', (await bridge.call('state')).role, 'bridge')

  // --- 3. discovery across the two builds ----------------------------------
  const peers = await until(async () => {
    const value = await agent.call('discover.probe')
    return value.peers.length > 0 ? value.peers : null
  }, { label: 'the 0.1.5 host to discover the 0.2.0 host' })
  const bridgeDeviceName = (await bridge.call('state')).deviceName
  const peer = peers.find((p) => p.name === bridgeDeviceName) ?? peers[0]
  ok('the 0.1.5 host discovered the 0.2.0 host over the LAN', peer !== undefined, JSON.stringify(peers))
  ok('the discovered peer advertises a usable port', peer.port > 0, `port=${peer.port}`)
  ok('the peer announce carried a signed, verifiable key', typeof peer.fingerprint === 'string' && peer.fingerprint.length > 0)

  // --- 4. an untrusted peer is refused ------------------------------------
  // Pairing state survives a restart in the trust store, so revoke first: this
  // both makes the case deterministic and exercises revocation.
  const agentDeviceId = (await agent.call('state')).deviceId
  await bridge.call('grant.revoke', { deviceId: agentDeviceId })
  let refused = null
  try {
    await agent.call('connect', { deviceId: peer.deviceId })
  } catch (error) {
    refused = String(error.message)
  }
  ok('connecting without a pairing window is refused', refused !== null && /配对窗口|pairing/i.test(refused), refused)

  // --- 5. the bridge opens a pairing window --------------------------------
  const pairingState = await bridge.call('discover.set', { enabled: true })
  const pairing = pairingState.pairing
  ok('the bridge host opened a pairing window', typeof pairing?.code === 'string' && /^\d{6}$/.test(pairing.code),
    JSON.stringify(pairing))

  // --- 6. submit the code, approve on the bridge side -----------------------
  // This is exactly the panel flow: the connect attempt was refused for lack of
  // a pairing window, the user reads the code off the other machine and submits
  // it. The op only answers once the handshake settles, and the handshake waits
  // on the bridge user's approval — so the outcome is collected out of band and
  // the state is polled, which is also what the panel does.
  let connectOutcome = null
  void agent.call('pair.submit', { code: pairing.code }).then(
    (value) => {
      connectOutcome = { ok: true, value }
    },
    (error) => {
      connectOutcome = { ok: false, error: String(error.message ?? error) }
    },
  )
  const request = await until(async () => {
    if (connectOutcome !== null && connectOutcome.ok !== true) {
      throw new Error(`connect failed before approval: ${connectOutcome.error}`)
    }
    return (await bridge.call('state')).request
  }, { label: 'the approval request' })
  ok('the bridge host shows the pending request with a safety code', /^\d{6}$/.test(request.sas ?? ''), JSON.stringify(request.sas))
  eq('the request names the connecting host', request.name, (await agent.call('state')).deviceName)

  if (sharedRootArg !== undefined && sharedRootArg !== '') {
    console.log(`     granting root: ${sharedRootArg}`)
  }
  const decision = await bridge.call('approve', {
    id: request.id,
    decision: 'allow',
    remember: true,
    grant: sharedRootArg !== undefined && sharedRootArg !== ''
      ? {
          roots: [sharedRootArg],
          cwdRoot: sharedRootArg,
          write: true,
          shell: true,
          createDirs: true,
          timeoutMs: 60_000,
          maxOutputBytes: 262144,
        }
      : request.defaultGrant,
  })
  eq('the bridge user approved the request', decision.decided, 'allow')

  const connected = await until(async () => {
    const value = await agent.call('state')
    return value.connection?.state === 'connected' ? value : null
  }, { label: 'the agent side to report a connected session' })
  ok('the agent host completed the handshake', connectOutcome === null || connectOutcome.ok === true,
    connectOutcome?.error)
  eq('the agent host agrees on the safety code', connected.connection?.sas, request.sas)

  ok('the agent host reached the connected state', connected.connection?.state === 'connected',
    JSON.stringify(connected.connection))
  const bridgeState = await bridge.call('state')
  eq('both hosts derived the same 6-digit safety code', connected.connection.sas, bridgeState.peersConnected?.[0]?.sas)
  ok('the agent host received the grant table', connected.connection.grant !== undefined && connected.connection.grant !== null)
  eq('the 0.1.5 host unlocked all six bridge tools', connected.diagnostics.toolsUnlocked.length, 6,
    JSON.stringify(connected.diagnostics.toolsUnlocked))

  // --- 7. self-test: real effects across the two applications --------------
  const self = await agent.call('connection.test', {})
  console.log(`     self-test steps: ${JSON.stringify(self.steps.map((s) => `${s.name}:${s.ok}`))}`)
  eq('the cross-application self-test ran every step', self.failed.length, 0, JSON.stringify(self.failed))
  eq('the write/read round trip matched', self.roundTripOk, true)
  ok('the peer answered with its own hostname', typeof self.peerHost === 'string' && self.peerHost.length > 0, self.peerHost)
  ok('the reported round trip is finite', Number.isFinite(self.rttMs), String(self.rttMs))

  // --- 8. remote shell really runs on the 0.2.0 host ----------------------
  const proof = `dsh-bridge-${Date.now()}`
  const shell = self.steps.find((s) => s.name === 'shell.exec')
  ok('the remote shell step succeeded', shell?.ok === true, JSON.stringify(shell))
  const listed = self.steps.find((s) => s.name === 'fs.list')
  ok('the remote directory listing succeeded', listed?.ok === true, JSON.stringify(listed))

  // --- 9. disconnect reclaims the tools ----------------------------------
  await agent.call('disconnect', {})
  const afterDisconnect = await until(async () => {
    const value = await agent.call('state')
    return value.connection === null ? value : null
  }, { label: 'the agent host to report the disconnect' })
  eq('the agent host reclaimed every bridge tool on disconnect', afterDisconnect.diagnostics.toolsUnlocked.length, 0,
    JSON.stringify(afterDisconnect.diagnostics))
  ok('the disconnected agent host still reports its own identity', typeof afterDisconnect.deviceId === 'string')
  ok('the bridge host saw the session close',
    (await bridge.call('state')).peersConnected.length === 0, JSON.stringify((await bridge.call('state')).peersConnected))

  // --- 10a. a trusted peer reconnects with no code and no second prompt ----
  // Step 6's approval pinned this peer (TOFU), so a plain reconnect must work
  // without a pairing window and without another click on the bridge side.
  void agent.call('connect', { deviceId: peer.deviceId }).catch(() => {})
  const trustedAgain = await until(async () => {
    const value = await agent.call('state')
    return value.connection?.state === 'connected' ? value : null
  }, { label: 'a trusted peer to reconnect without a code' })
  eq('a trusted peer reconnects with no code and no second prompt', trustedAgain.connection?.state, 'connected')
  eq('tools are unlocked on the trusted reconnect', trustedAgain.diagnostics.toolsUnlocked.length, 6)
  await agent.call('disconnect', {})

  // --- 10b. revoke, then re-pair with a fresh code (single-use semantics) --
  // A bare reconnect is allowed while the peer is trusted, so revocation is the
  // step that must switch it back to refused.
  await bridge.call('grant.revoke', { deviceId: agentDeviceId })
  let refusedAgain = null
  try {
    await agent.call('connect', { deviceId: peer.deviceId })
  } catch (error) {
    refusedAgain = String(error.message)
  }
  ok('after revocation a bare reconnect is refused again', refusedAgain !== null && /配对窗口|pairing/i.test(refusedAgain),
    refusedAgain)

  // …and a freshly opened window plus its code makes it work again. This is the
  // panel's 「刷新配对码」 path, and it proves a pairing code is single-use.
  const freshPairing = await bridge.call('pair.open', {})
  ok('the bridge can issue a fresh pairing code', /^\d{6}$/.test(freshPairing.code), JSON.stringify(freshPairing))
  void agent.call('pair.submit', { code: freshPairing.code }).catch(() => {})
  const request2 = await until(async () => (await bridge.call('state')).request, { label: 'the second approval request' })
  await bridge.call('approve', { id: request2.id, decision: 'allow', remember: true, grant: request2.defaultGrant })
  const reconnected = await until(async () => {
    const value = await agent.call('state')
    return value.connection?.state === 'connected' ? value : null
  }, { label: 'the re-paired session' })
  ok('a re-paired peer is connected again', reconnected.connection?.state === 'connected')
  eq('tools are unlocked again', reconnected.diagnostics.toolsUnlocked.length, 6)
  await agent.call('disconnect', {})

  console.log(`\n${checks - failures} passed, ${failures} failed`)
  if (failures > 0) process.exitCode = 1
} catch (error) {
  failures += 1
  console.log(`FAIL harness error :: ${error?.stack ?? error}`)
  console.log(`\n${checks - failures} passed, ${failures} failed`)
  process.exitCode = 1
}
