/**
 * End-to-end test: two independent bridge services, real UDP discovery, real
 * TCP transport, real handshake/encryption, real filesystem and shell effects.
 *
 * Both services run in this process but talk only over the loopback network, so
 * everything under test is the production code path. The bridge user's approval
 * is simulated the way the sidebar panel does it: read `snapshot().request` and
 * answer with `decideRequest()`.
 *
 * Run: node test/e2e-twohost.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBridgeService } from '../lib/core/service.js'
import { defineBridgeTools, BRIDGE_TOOL_NAMES, BRIDGE_CONTROL_TOOL_NAMES } from '../lib/core/tools.js'
import { createLogger } from '../lib/core/log.js'

const log = createLogger('e2e')
let failures = 0
let checks = 0

function ok(name, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function expectRejects(name, thunk, matcher) {
  try {
    await thunk()
    ok(name, false, 'it resolved instead of rejecting')
  } catch (error) {
    const message = String(error?.message ?? error)
    const hit = matcher === undefined || matcher.test(message)
    ok(name, hit, `rejected with ${JSON.stringify(message)}`)
  }
}

async function until(predicate, { timeoutMs = 15_000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lan-bridge-e2e-'))
const sharedRoot = path.join(root, 'shared')
fs.mkdirSync(sharedRoot, { recursive: true })
const outsideFile = path.join(root, 'outside.txt')
fs.writeFileSync(outsideFile, 'do not read me\n', 'utf8')

const ctxStub = { get: () => undefined }

/** Approve whatever the bridge side is asking, the way the panel would. */
async function approveFromUi(bridge, grant) {
  const request = await until(() => bridge.snapshot().request, { label: 'a pending approval request' })
  return bridge.decideRequest({
    id: request.id,
    decision: 'allow',
    grant: grant ?? request.defaultGrant,
    remember: true,
  })
}

const agent = createBridgeService({ ctx: ctxStub, config: { role: 'agent', dataDir: path.join(root, 'agent'), port: 0 }, log })
const bridge = createBridgeService({ ctx: ctxStub, config: { role: 'bridge', dataDir: path.join(root, 'bridge'), port: 0 }, log })

let agentSession = null

try {
  await agent.start()
  await bridge.start()
  ok('both services start', true)
  ok('agent role opens no inbound listener', agent.snapshot().listenError === null)

  // --- discovery -------------------------------------------------------------
  const seen = await until(async () => {
    const peers = (await agent.probe()).peers
    return peers.find((p) => p.deviceId === bridge.snapshot().deviceId)
  }, { label: 'the agent to discover the bridge' })
  eq('agent discovers the bridge over UDP multicast', seen.name, bridge.snapshot().deviceName)
  ok('the discovered peer advertises a TCP port', typeof seen.port === 'number' && seen.port > 0, `port=${seen.port}`)

  // --- an untrusted peer cannot connect ------------------------------------
  // The bridge opens a pairing window at start-up, so an untrusted peer is now
  // refused for lack of a CODE rather than for lack of a window. Either way it
  // must not get in, and the reason must be one the user can act on.
  await expectRejects(
    'an untrusted peer with no pairing code is refused',
    () => agent.connect({ deviceId: bridge.snapshot().deviceId }),
    /配对窗口|pairing_closed|auth_mode_unsupported|pairing_required|pairing code/i,
  )

  // --- pairing --------------------------------------------------------------
  const pairing = bridge.openPairingWindow(true)
  ok('the bridge opens a pairing window with a 6-digit code', /^\d{6}$/.test(pairing.code), pairing.code)

  const connectPromise = agent.connect({ deviceId: bridge.snapshot().deviceId, code: pairing.code })
  const decision = await approveFromUi(bridge, {
    roots: [sharedRoot],
    cwdRoot: sharedRoot,
    write: true,
    shell: true,
    createDirs: true,
    timeoutMs: 30_000,
    maxOutputBytes: 256 * 1024,
  })
  eq('the bridge user approves the request', decision.decided, 'allow')
  const connection = await connectPromise
  eq('the agent reports a connected session', connection.state, 'connected')
  ok('both machines derive the same 6-digit safety code', /^\d{6}$/.test(connection.sas), connection.sas)
  eq(
    'the bridge computes the same safety code for that peer',
    bridge.snapshot().peersConnected[0]?.sas,
    connection.sas,
  )

  const agentSnapshot = agent.snapshot()
  ok('the agent received the grant table', agentSnapshot.connection !== null)
  const grant = agent.connectionSnapshot().grant
  eq('the grant carries the granted root', grant.roots[0].toLowerCase(), fs.realpathSync.native(sharedRoot).toLowerCase())
  eq('write is granted', grant.write, true)
  eq('shell is granted', grant.shell, true)

  // --- the v2 snapshot surface ---------------------------------------------
  // `connection` is the compatibility alias; the multi-device surface is what the
  // panel and the tools read now (contract §4).
  eq('one outbound link is reported', agentSnapshot.links.length, 1)
  eq('that link is connected', agentSnapshot.links[0].state, 'connected')
  eq('the link is to the bridge', agentSnapshot.links[0].deviceId, bridge.snapshot().deviceId)
  eq('one target is reachable', agentSnapshot.targets.length, 1)
  eq('the target is the bridge itself, directly', agentSnapshot.targets[0].kind, 'direct')
  eq('toolsAvailable follows the target list', agentSnapshot.toolsAvailable, true)
  eq('an agent holds no inbound sessions of its own', agentSnapshot.sessions.length, 0)
  eq('peersConnected aliases sessions', agentSnapshot.peersConnected, agentSnapshot.sessions)
  ok('relay is reported as supported, with its ceiling', agentSnapshot.relay?.supported === true && agentSnapshot.relay?.maxHops === 3)
  eq('the bridge reports the inbound session from the agent', bridge.snapshot().sessions.length, 1)
  ok(
    'that session exposes the bridge itself to the agent',
    bridge.snapshot().sessions[0]?.exposes?.some((row) => row.key === bridge.snapshot().deviceId),
  )

  // --- remote filesystem ----------------------------------------------------
  const written = await agent.remoteCall('fs.write', 'write', { path: 'hello.txt', content: 'alpha\nbeta\ngamma\n' })
  eq('bridge_fs_write reports the byte count', written.bytes, Buffer.byteLength('alpha\nbeta\ngamma\n'))
  ok('the file really exists on the bridge machine', fs.existsSync(path.join(sharedRoot, 'hello.txt')))

  const read = await agent.remoteCall('fs.read', 'read', { path: 'hello.txt' })
  eq('bridge_fs_read returns the content', read.content, 'alpha\nbeta\ngamma\n')
  eq('bridge_fs_read counts the lines', read.totalLines, 3)

  const edited = await agent.remoteCall('fs.edit', 'edit', {
    path: 'hello.txt',
    oldString: 'beta',
    newString: 'BETA',
    replaceAll: false,
  })
  eq('bridge_fs_edit replaces one occurrence', edited.replaced, 1)
  eq('the edit landed on disk', fs.readFileSync(path.join(sharedRoot, 'hello.txt'), 'utf8'), 'alpha\nBETA\ngamma\n')

  const listed = await agent.remoteCall('fs.list', 'list', { path: '.' })
  ok('bridge_fs_list sees the created file', listed.entries.some((e) => e.name === 'hello.txt'))

  const info = await agent.remoteCall('sys.info', 'info', {})
  ok('sys.info answers with the bridge host', typeof info.hostname === 'string' && info.hostname.length > 0)

  // --- remote shell ---------------------------------------------------------
  const shell = await agent.remoteCall('shell.exec', 'exec', { command: 'echo bridge-e2e-marker' })
  eq('remote shell exits 0', shell.exitCode, 0)
  ok('remote shell returns the expected stdout', /bridge-e2e-marker/.test(shell.stdout ?? ''), JSON.stringify(shell.stdout))

  const failing = await agent.remoteCall('shell.exec', 'exec', { command: 'exit 7' })
  eq('a non-zero exit is a normal result, not an exception', failing.exitCode, 7)

  // --- confinement ----------------------------------------------------------
  await expectRejects(
    'a traversal path is refused by the bridge',
    () => agent.remoteCall('fs.read', 'read', { path: '../outside.txt' }),
    /path-denied/i,
  )
  await expectRejects(
    'an absolute path outside the granted root is refused',
    () => agent.remoteCall('fs.read', 'read', { path: outsideFile }),
    /path-denied/i,
  )
  await expectRejects(
    'an unknown capability is refused',
    () => agent.remoteCall('fs.read', 'erase', { path: 'hello.txt' }),
    /unsupported|not-granted/i,
  )

  // --- permission inheritance on the AGENT side ----------------------------
  const tools = defineBridgeTools({ ctx: {}, getService: () => agent })
  const byName = new Map(tools.map((t) => [t.name, t]))
  const dataPlane = defineBridgeTools({ ctx: {}, getService: () => agent, controlOnly: false }).map((t) => t.name)
  const controlPlane = defineBridgeTools({ ctx: {}, getService: () => agent, controlOnly: true }).map((t) => t.name)
  eq('the data plane is the six contract tools', dataPlane.join(','), BRIDGE_TOOL_NAMES.join(','))
  eq('the control plane is the five contract tools', controlPlane.join(','), BRIDGE_CONTROL_TOOL_NAMES.join(','))
  eq('the plain call defines the data plane', byName.size, dataPlane.length)
  ok('and none of the control-plane tools leak into it', controlPlane.every((name) => !byName.has(name)))

  const mkExec = (sandboxMode, approval) => ({
    name: 'bridge_fs_read',
    callId: 'call-1',
    signal: undefined,
    agent: { session: { id: 'session-1' } },
    __ctx: { sandboxMode, approval },
  })

  // Full-access session: the tool runs with no approval round-trip.
  const gatedCtx = {
    get: (key) => {
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'danger-full-access' }) }
      if (key === 'approval') return { request: async () => 'rejected' }
      return undefined
    },
  }
  const fullTools = defineBridgeTools({ ctx: gatedCtx, getService: () => agent })
  const fullRead = await fullTools.find((t) => t.name === 'bridge_fs_read').execute(
    { path: 'hello.txt' },
    mkExec('danger-full-access'),
  )
  eq('with full access the tool runs without asking', fullRead.content, 'alpha\nBETA\ngamma\n')

  // Restricted session + ask policy that rejects: the tool must refuse.
  const askRejectCtx = {
    get: (key) => {
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (key === 'approval') return { request: async () => 'rejected' }
      return undefined
    },
  }
  const restricted = defineBridgeTools({ ctx: askRejectCtx, getService: () => agent })
  await expectRejects(
    'a restricted session that rejects the prompt cannot read the peer',
    () => restricted.find((t) => t.name === 'bridge_fs_read').execute({ path: 'hello.txt' }, mkExec('workspace-write')),
    /not approved|rejected/i,
  )

  // Restricted session + ask policy that allows once.
  const askAllowCtx = {
    get: (key) => {
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (key === 'approval') return { request: async () => 'allowed-once' }
      return undefined
    },
  }
  const allowed = defineBridgeTools({ ctx: askAllowCtx, getService: () => agent })
  const allowedRead = await allowed.find((t) => t.name === 'bridge_fs_read').execute({ path: 'hello.txt' }, mkExec('workspace-write'))
  eq('a restricted session that approves once can read the peer', allowedRead.content, 'alpha\nBETA\ngamma\n')

  // Restricted session with NO approval seam composed: fail closed with advice.
  const noApprovalCtx = { get: (key) => (key === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined) }
  const noApproval = defineBridgeTools({ ctx: noApprovalCtx, getService: () => agent })
  await expectRejects(
    'a restricted session without an approval seam fails closed',
    () => noApproval.find((t) => t.name === 'bridge_shell').execute({ command: 'echo x' }, mkExec('workspace-write')),
    /full-access|approval/i,
  )

  // --- grant downgrade -----------------------------------------------------
  bridge.setGrant(bridge.snapshot().peersConnected[0].deviceId, {
    roots: [sharedRoot],
    cwdRoot: sharedRoot,
    write: false,
    shell: false,
    timeoutMs: 30_000,
    maxOutputBytes: 65536,
  })
  await until(async () => (await agent.remoteCall('sys.info', 'grant', {})).grant.write === false, {
    label: 'the downgraded grant to arrive',
  })
  await expectRejects(
    'read-only access refuses a write with a readable reason',
    () => agent.remoteCall('fs.write', 'write', { path: 'nope.txt', content: 'x' }),
    /read-only|not-granted/i,
  )
  await expectRejects(
    'a grant without shell refuses shell execution',
    () => agent.remoteCall('shell.exec', 'exec', { command: 'echo nope' }),
    /Shell access|shell-denied|not-granted/i,
  )

  // --- disconnect and reclaim ----------------------------------------------
  // `disconnect(deviceId?)` is strict on purpose: a non-empty string is a DEVICE
  // ID, so a bogus one must be an error rather than a silent "drop everything".
  const peerDeviceId = bridge.snapshot().deviceId
  await expectRejects(
    'disconnecting a device that is not connected is refused, not silently widened',
    () => agent.disconnect('not-a-real-device'),
    /not connected/i,
  )
  eq('the strict refusal left the live link alone', agent.snapshot().links.length, 1)
  await agent.disconnect()
  eq('the agent connection is closed', agent.connectionSnapshot(), null)
  eq('no link remains', agent.snapshot().links.length, 0)
  eq('toolsAvailable goes false with the last device', agent.snapshot().toolsAvailable, false)
  await expectRejects(
    'a tool call after disconnect fails with a readable state error',
    () => restricted.find((t) => t.name === 'bridge_shell').execute({ command: 'echo x' }, mkExec('workspace-write')),
    /not approved|rejected|full-access|approval/i,
  )
  const auditRows = bridge.auditTail(200).rows
  ok('the bridge audited the session', auditRows.some((r) => r.action === 'session.open'))
  ok('the bridge audited at least one denial', auditRows.some((r) => r.allowed === false))
  ok('the bridge audited remote reads', auditRows.some((r) => r.action === 'fs.read/read' && r.allowed === true))

  // --- reconnect: a trusted peer needs no pairing code ---------------------
  const again = await agent.connect({ deviceId: peerDeviceId })
  eq('a previously approved peer reconnects without a code', again.state, 'connected')
  const readAgain = await agent.remoteCall('fs.read', 'read', { path: 'hello.txt' })
  eq('the reconnected session works', readAgain.content, 'alpha\nBETA\ngamma\n')
  await agent.disconnect()
} catch (error) {
  failures += 1
  console.log(`FAIL harness error :: ${error?.stack ?? error}`)
} finally {
  try {
    await agent.stop()
    await bridge.stop()
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${checks - failures} passed, ${failures} failed`)
if (failures > 0) process.exitCode = 1
