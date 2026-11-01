/**
 * reclaim.mjs — the tool-plane reclamation contract (contract §6).
 *
 *   data plane    | `snapshot().toolsAvailable` | bridge_status + 5 fs/shell tools
 *   control plane | `snapshot().controlTools`   | bridge_devices/connect/pair/approve/disconnect
 *
 * This file drives the PRODUCTION wiring, not a copy of it: it mounts
 * `lib/current.js` through `apply()` with a stub Cordis ctx (a tool registry, an
 * `effect`/`inject` seam and a full-access sandbox policy), then drives the real
 * service THROUGH the registered control-plane tools — which is exactly how a
 * 极简模式 / headless host drives it, because those five tools are its whole UI.
 *
 * It also proves the reclamation edge is clean for a call that is already in
 * flight when the last device goes: no hung promise, no unhandled rejection.
 *
 * Run: node test/reclaim.mjs
 */

import path from 'node:path'
import { BRIDGE_CONTROL_TOOL_NAMES, BRIDGE_TOOL_NAMES, defineBridgeTools } from '../lib/core/tools.js'
import {
  Host,
  createReport,
  grantFor,
  requestsOf,
  silentLog,
  sleepCommand,
  tempRoot,
  until,
  removeDir,
} from './_harness.mjs'

const report = createReport('reclaim')
const { ok, eq, eqJson, note, section, expectRejects, expectResolves, eventually, finish } = report

/** The contract's own rosters, spelled out here on purpose (§6). */
const CONTRACT_DATA = ['bridge_status', 'bridge_fs_list', 'bridge_fs_read', 'bridge_fs_write', 'bridge_fs_edit', 'bridge_shell']
const CONTRACT_CONTROL = ['bridge_devices', 'bridge_connect', 'bridge_pair', 'bridge_approve', 'bridge_disconnect']

const unhandled = []
process.on('unhandledRejection', (reason) => {
  unhandled.push(String(reason?.stack ?? reason))
})

const root = tempRoot('dsh-lan-reclaim-')
let callSeq = 0
const execStub = (name) => ({ name, callId: `call-${++callSeq}`, signal: undefined, agent: { session: { id: 'reclaim-session' } } })

/** A tool registry that records registration/disposal, like the host's own. */
function makeRegistry() {
  const entries = new Map()
  const events = []
  const registry = {
    register(definition) {
      const existing = entries.get(definition.name)
      if (existing !== undefined && existing.disposed !== true) {
        throw new Error(`tool ${definition.name} is already registered`)
      }
      const entry = { definition, disposed: false, disposeCount: 0, registerCount: (existing?.registerCount ?? 0) + 1 }
      entries.set(definition.name, entry)
      events.push(`register ${definition.name}`)
      return () => {
        entry.disposed = true
        entry.disposeCount += 1
        events.push(`dispose ${definition.name}`)
      }
    },
  }
  return { registry, entries, events }
}

/** The Cordis surface `lib/current.js` touches, and nothing else. */
function makeCtx(registry) {
  const effects = []
  return {
    get(key) {
      if (key === 'tools') return registry
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'danger-full-access' }) }
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    inject(_deps, cb) {
      cb(this)
      return () => {}
    },
    _effects: effects,
  }
}

const peer = new Host('reclaim-peer', { role: 'bridge' })
const { registry, entries, events } = makeRegistry()
const ctx = makeCtx(registry)
let mounted = false

try {
  // ======================================================================
  // 1. the declared plane split
  // ======================================================================
  section('1. the two planes and their rosters (contract §6)')
  const dataTools = defineBridgeTools({ ctx: {}, getService: () => null, controlOnly: false })
  const controlTools = defineBridgeTools({ ctx: {}, getService: () => null, controlOnly: true })
  eqJson('the data plane is exactly the six contract tools', dataTools.map((tool) => tool.name), CONTRACT_DATA)
  eqJson('the control plane is exactly the five contract tools', controlTools.map((tool) => tool.name), CONTRACT_CONTROL)
  eqJson('the exported data roster matches', [...BRIDGE_TOOL_NAMES], CONTRACT_DATA)
  eqJson('the exported control roster matches', [...BRIDGE_CONTROL_TOOL_NAMES], CONTRACT_CONTROL)
  eq(
    'no tool is in both planes',
    CONTRACT_DATA.filter((name) => CONTRACT_CONTROL.includes(name)).length,
    0,
  )
  ok(
    'every data-plane tool takes an optional `device` string',
    dataTools.every((tool) => tool.parameters?.properties?.device?.type === 'string'),
    JSON.stringify(dataTools.map((tool) => `${tool.name}:${tool.parameters?.properties?.device?.type}`)),
  )
  ok(
    'every control-plane tool is callable without a device',
    controlTools.every((tool) => typeof tool.execute === 'function'),
  )

  // ======================================================================
  // 2. mount the production host half
  // ======================================================================
  section('2. the production host half, mounted with a stub registry')
  const { apply } = await import('../lib/current.js')
  mounted = true
  await peer.start()
  peer.put('peer-file.txt', 'hello-from-peer\n')
  const peerCode = peer.service.openPairingWindow(true).code
  apply(ctx, { role: 'agent', dataDir: path.join(root, 'sut'), port: 0, controlTools: 'always' })

  await eventually(
    'the control plane registers on a pristine agent machine in `always` mode',
    () => CONTRACT_CONTROL.every((name) => entries.has(name) && entries.get(name).disposed === false),
    { timeoutMs: 10_000 },
  )
  eq('the control plane registered all five tools', CONTRACT_CONTROL.filter((name) => entries.has(name)).length, 5)
  eq('no data-plane tool is registered with zero devices', CONTRACT_DATA.filter((name) => entries.has(name)).length, 0)

  const devicesBefore = await entries.get('bridge_devices').definition.execute({}, execStub('bridge_devices'))
  eq('bridge_devices answers with zero devices', devicesBefore.targets.length, 0)
  ok('and reports this machine\'s own identity', typeof devicesBefore.device?.deviceId === 'string' && devicesBefore.device.deviceId.length > 0)
  await expectRejects(
    'a data-plane tool body refuses with a readable reason when nothing is reachable',
    () => {
      const emptyService = { snapshot: () => ({ toolsAvailable: false, targets: [] }), listTargets: () => [] }
      const tool = defineBridgeTools({ ctx, getService: () => emptyService, controlOnly: false }).find(
        (candidate) => candidate.name === 'bridge_fs_read',
      )
      return tool.execute({ path: 'x.txt' }, execStub('bridge_fs_read'))
    },
    /no device is reachable/i,
  )

  // ======================================================================
  // 3. a device appears: the data plane registers
  // ======================================================================
  section('3. one device: the data plane registers and really works')
  const connectCall = entries.get('bridge_connect').definition.execute(
    { host: '127.0.0.1', port: peer.port, code: peerCode },
    execStub('bridge_connect'),
  )
  const request = await until(() => requestsOf(peer.service.snapshot())[0], { label: 'the peer to ask its user', timeoutMs: 15_000 })
  peer.service.decideRequest({ id: request.id, decision: 'allow', grant: grantFor(peer), remember: true })
  const connected = await connectCall
  ok('bridge_connect reports a connected link', connected.connected === true, JSON.stringify(connected).slice(0, 200))
  eq('the link is to the peer', connected.deviceId, peer.id)

  await eventually(
    'the data plane registers once a device is reachable',
    () => CONTRACT_DATA.every((name) => entries.has(name) && entries.get(name).disposed === false),
    { timeoutMs: 10_000 },
  )
  eq('exactly eleven tools are registered (6 data + 5 control)', entries.size, 11)
  const read = await entries.get('bridge_fs_read').definition.execute({ path: 'peer-file.txt' }, execStub('bridge_fs_read'))
  eq('the registered data-plane tool really reads the peer', read.content, 'hello-from-peer\n')
  const listed = await entries.get('bridge_fs_list').definition.execute({ path: '.' }, execStub('bridge_fs_list'))
  ok('the registered list tool answers', Array.isArray(listed.entries) && listed.entries.some((entry) => entry.name === 'peer-file.txt'))

  // ======================================================================
  // 4. no churn on an unrelated change
  // ======================================================================
  section('4. a grant refresh and a second device cause no re-registration')
  const eventsBefore = events.length
  const sutId = peer.snap.sessions[0]?.deviceId
  ok('the peer knows which device the host half is', typeof sutId === 'string' && sutId.length > 0)
  peer.service.setGrant(sutId, { ...grantFor(peer), timeoutMs: 15_000, maxOutputBytes: 120_000 })
  await until(() => (peer.snap.sessions[0]?.grant?.timeoutMs ?? 0) === 15_000, { label: 'the refreshed grant' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  eq('a grant refresh produced no register/dispose events', events.length, eventsBefore)
  eq('and the same six data-plane registrations are still live', CONTRACT_DATA.filter((name) => entries.get(name)?.disposed === false).length, 6)

  // ======================================================================
  // 4b. a bounce inside the grace period must cost NOTHING
  // ======================================================================
  section('4b. a link that drops and returns inside the grace period changes no catalog')
  {
    const bounceRegisters = CONTRACT_DATA.map((name) => entries.get(name).registerCount)
    await entries.get('bridge_disconnect').definition.execute({}, execStub('bridge_disconnect'))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    ok(
      'nothing is reclaimed inside the grace period',
      CONTRACT_DATA.every((name) => entries.get(name).disposeCount === 0),
      JSON.stringify(CONTRACT_DATA.map((name) => `${name}:${entries.get(name).disposeCount}`)),
    )
    const back = await entries.get('bridge_connect').definition.execute(
      { host: '127.0.0.1', port: peer.port, code: peerCode },
      execStub('bridge_connect'),
    )
    eq('the link comes back inside the grace period', back.connected, true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    ok(
      'the returning link caused no re-registration',
      CONTRACT_DATA.every((name, index) => entries.get(name).registerCount === bounceRegisters[index]),
      JSON.stringify(CONTRACT_DATA.map((name) => `${name}:${entries.get(name).registerCount}`)),
    )
    ok(
      'and no disposal either',
      CONTRACT_DATA.every((name) => entries.get(name).disposeCount === 0),
      JSON.stringify(CONTRACT_DATA.map((name) => `${name}:${entries.get(name).disposeCount}`)),
    )
  }

  // ======================================================================
  // 5. the last device goes while a call is in flight
  // ======================================================================
  section('5. reclaiming the data plane mid-await')
  let inflight = null
  const inflightCall = entries.get('bridge_shell')
    .definition.execute({ command: sleepCommand(4000), timeoutMs: 30_000 }, execStub('bridge_shell'))
    .then(
      (value) => {
        inflight = { ok: true, detail: JSON.stringify(value).slice(0, 160) }
      },
      (error) => {
        inflight = { ok: false, detail: String(error?.message ?? error) }
      },
    )
  await new Promise((resolve) => setTimeout(resolve, 400))
  const dropped = await entries.get('bridge_disconnect').definition.execute({}, execStub('bridge_disconnect'))
  eq('bridge_disconnect with no deviceId drops every link', dropped.scope, 'all-links')

  // Reclamation is deliberately DELAYED (lib/current.js: RECLAIM_GRACE_MS). A tool
  // catalog change makes DSH start a new request series
  // (`agent-loop`: `startsSeries: … || this.toolsChanged(assembly.tools)`), so
  // reclaiming the instant the last device disappears made a FLAPPING link churn
  // the request cache on every bounce. The tools now go away only after the last
  // device has been gone for the whole grace period, and a device that comes back
  // inside it cancels the reclaim entirely.
  //
  // The wait below therefore has to outlast the grace. The assertion it replaces
  // ("reclaimed immediately") was encoding the behaviour the grace exists to fix.
  await eventually(
    'the data plane is reclaimed once the last device has been gone for the grace period',
    () => CONTRACT_DATA.every((name) => entries.get(name)?.disposed === true),
    { timeoutMs: 30_000 },
  )
  ok(
    'every data-plane disposer ran exactly once',
    CONTRACT_DATA.every((name) => entries.get(name).disposeCount === 1),
    JSON.stringify(CONTRACT_DATA.map((name) => `${name}:${entries.get(name).disposeCount}`)),
  )
  ok(
    'the control plane was never disposed',
    CONTRACT_CONTROL.every((name) => entries.get(name).disposeCount === 0),
    JSON.stringify(CONTRACT_CONTROL.map((name) => `${name}:${entries.get(name).disposeCount}`)),
  )
  const settled = await until(() => inflight, { label: 'the in-flight shell call to settle', timeoutMs: 12_000 }).catch(() => null)
  if (settled === null) {
    ok('the in-flight call settles instead of hanging', false, 'still pending after 12 s')
  } else {
    await inflightCall
    ok('the in-flight call fails cleanly once its link is gone', inflight.ok === false, JSON.stringify(inflight))
    note(`in-flight failure after the reclaim: ${inflight.detail}`)
  }
  const stillThere = await entries.get('bridge_devices').definition.execute({}, execStub('bridge_devices'))
  eq('bridge_devices still answers with the data plane gone', stillThere.targets.length, 0)
  ok('and reports no link left', stillThere.links.length === 0, JSON.stringify(stillThere.links.map((link) => link.deviceId)))

  // ======================================================================
  // 6. it comes back, and the fiber teardown reclaims everything
  // ======================================================================
  section('6. reconnecting re-registers, and the fiber teardown reclaims all')
  const reconnect = await entries.get('bridge_connect').definition.execute(
    { host: '127.0.0.1', port: peer.port, code: peerCode },
    execStub('bridge_connect'),
  )
  eq('a re-connect to an already-paired peer works without a card', reconnect.connected, true)
  await eventually('the data plane comes back', () => CONTRACT_DATA.every((name) => entries.get(name)?.disposed === false), { timeoutMs: 10_000 })
  eq('eleven tools are registered again', entries.size, 11)
  eq('the data-plane tools were re-registered exactly once', CONTRACT_DATA.every((name) => entries.get(name).registerCount === 2), true)
  await expectResolves(
    'the re-registered tool works',
    () => entries.get('bridge_fs_read').definition.execute({ path: 'peer-file.txt' }, execStub('bridge_fs_read')),
    /hello-from-peer/,
  )

  ctx._effects[0]?.()
  await new Promise((resolve) => setTimeout(resolve, 200))
  eq('tearing the plugin fiber down disposes every tool', [...CONTRACT_DATA, ...CONTRACT_CONTROL].every((name) => entries.get(name).disposed === true), true)
  eq('no unhandled rejection was produced anywhere in this file', unhandled.length, 0, JSON.stringify(unhandled))
} catch (error) {
  report.ok('harness completed without an unexpected throw', false, error?.stack ?? String(error))
} finally {
  try {
    if (mounted) ctx._effects[0]?.()
  } catch {
    /* best effort */
  }
  await peer.stop()
  await peer.cleanup()
  removeDir(root)
}

void silentLog
finish()
