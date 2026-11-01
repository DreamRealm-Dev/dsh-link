/**
 * multi-device.mjs — one agent machine, two simultaneous outbound links.
 *
 *   A (agent) --link--> B1 (bridge)
 *   A (agent) --link--> B2 (bridge)
 *
 * Proves that a second device ADDS a link instead of replacing one, that both
 * are callable at the same time, that `resolveTarget` behaves at 0, 1 and 2+
 * targets, and that `toolsAvailable` follows the LAST link — never the first.
 *
 * Every host in this process reports one `os.hostname()`, so each bridge is given
 * a distinct advertised name (as it would have on a real LAN) to make `device`
 * matching by name testable.
 *
 * Run: node test/multi-device.mjs
 */

import {
  Host,
  connectHosts,
  createReport,
  grantFor,
  targetOf,
  until,
  waitTarget,
} from './_harness.mjs'

const report = createReport('multi-device')
const { ok, eq, note, section, expectRejects, expectResolves, eventually, finish } = report

const hosts = []
const track = (host) => {
  hosts.push(host)
  return host
}

try {
  const a = track(new Host('md-a', { role: 'agent' }))
  const b1 = track(new Host('md-b1', { role: 'bridge' })).advertiseName('bridge-alpha')
  const b2 = track(new Host('md-b2', { role: 'bridge' })).advertiseName('bridge-beta')
  const solo = track(new Host('md-solo', { role: 'agent' }))
  await a.start()
  await b1.start()
  await b2.start()
  await solo.start()

  b1.put('who.txt', 'from-bridge-alpha\n')
  b1.put('shared-name.txt', 'alpha copy\n')
  b2.put('who.txt', 'from-bridge-beta\n')
  b2.put('shared-name.txt', 'beta copy\n')

  // ======================================================================
  // 1. zero targets
  // ======================================================================
  section('1. an agent with no link has no targets and no data plane')
  eq('a fresh agent lists no targets', a.service.listTargets().length, 0)
  eq('toolsAvailable is false', a.snap.toolsAvailable, false)
  await expectRejects('resolveTarget with nothing reachable explains what to do', () => Promise.resolve().then(() => a.service.resolveTarget()), /no device is reachable/i)
  await expectRejects(
    'a remote call with nothing reachable fails the same way',
    () => a.service.remoteCall('sys.info', 'info', {}),
    /no device is reachable/i,
  )
  eq('the solo agent is not listening (agent posture)', solo.snap.accepts, false)

  // ======================================================================
  // 2. exactly one target
  // ======================================================================
  section('2. with exactly one link the device argument may be omitted')
  await connectHosts({ from: a, to: b1, grant: grantFor(b1) })
  eq('one link exists', a.snap.links.length, 1)
  eq('one target exists', a.service.listTargets().length, 1)
  eq('the only target is B1', a.service.listTargets()[0].key, b1.id)
  eq('the target carries the advertised name', a.service.listTargets()[0].name, 'bridge-alpha')
  eq('resolveTarget() picks the only device', a.service.resolveTarget().key, b1.id)
  await expectResolves(
    'a call without `device` works with one target',
    () => a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }),
    /from-bridge-alpha/,
  )
  eq('toolsAvailable flips true with the first device', a.snap.toolsAvailable, true)

  // ======================================================================
  // 3. two targets
  // ======================================================================
  section('3. a second device ADDS a link instead of replacing the first')
  await connectHosts({ from: a, to: b2, grant: grantFor(b2) })
  eq('two links exist', a.snap.links.length, 2)
  eq('both links are connected', a.snap.links.filter((link) => link.state === 'connected').length, 2)
  eq('two targets exist', a.service.listTargets().length, 2)
  ok(
    'both links belong to distinct devices',
    new Set(a.snap.links.map((link) => link.deviceId)).size === 2,
    JSON.stringify(a.snap.links.map((link) => `${link.name}:${link.deviceId}`)),
  )
  ok(
    'the first link is still connected',
    a.snap.links.some((link) => link.deviceId === b1.id && link.state === 'connected'),
  )

  section('3b. both devices answer at the same time')
  const readA = await a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: b1.id })
  const readB = await a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: b2.id })
  eq('the first device answers for itself', readA.content, 'from-bridge-alpha\n')
  eq('the second device answers for itself', readB.content, 'from-bridge-beta\n')
  await a.service.remoteCall('fs.write', 'write', { path: 'written.txt', content: 'w1\n' }, { device: b1.id })
  ok('a write to the first device landed there', b1.exists('written.txt'))
  ok('and not on the second one', !b2.exists('written.txt'))
  await a.service.remoteCall('fs.write', 'write', { path: 'written.txt', content: 'w2\n' }, { device: b2.id })
  eq('the second device got its own copy', b2.read('written.txt'), 'w2\n')
  eq('and the first copy was not overwritten', b1.read('written.txt'), 'w1\n')

  const atOnce = await Promise.all([
    a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: b1.id }),
    a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: b2.id }),
    a.service.ping(b1.id),
    a.service.ping(b2.id),
    a.service.remoteCall('sys.info', 'info', {}, { device: b2.id }),
    a.service.remoteCall('fs.list', 'list', { path: '.' }, { device: b1.id }),
  ])
  eq('concurrent call 1 went to the right device', atOnce[0].content, 'from-bridge-alpha\n')
  eq('concurrent call 2 went to the right device', atOnce[1].content, 'from-bridge-beta\n')
  ok('both pings answered', typeof atOnce[2] === 'number' && typeof atOnce[3] === 'number')
  ok('the interleaved sys.info answered', typeof atOnce[4].hostname === 'string')
  ok('the interleaved list answered', Array.isArray(atOnce[5].entries))

  section('3c. resolveTarget: keys, names, substrings and the ambiguity error')
  eq('by key', a.service.resolveTarget(b2.id).key, b2.id)
  eq('by exact name', a.service.resolveTarget('bridge-beta').key, b2.id)
  eq('by case-insensitive substring', a.service.resolveTarget('ALPHA').key, b1.id)
  eq('a substring that matches the other device resolves there', a.service.resolveTarget('beta').key, b2.id)
  eq('surrounding whitespace is ignored', a.service.resolveTarget('  bridge-alpha  ').key, b1.id)
  const ambiguity = await expectRejects(
    'omitting the device with two targets is an error, not a guess',
    () => Promise.resolve().then(() => a.service.resolveTarget()),
    /several devices are reachable/i,
  )
  ok(
    'the ambiguity error lists every device it could mean',
    typeof ambiguity === 'string' && ambiguity.includes(b1.id) && ambiguity.includes(b2.id) && ambiguity.includes('bridge-alpha') && ambiguity.includes('bridge-beta'),
    ambiguity,
  )
  await expectRejects(
    'an unknown device name lists what IS reachable',
    () => Promise.resolve().then(() => a.service.resolveTarget('no-such-box')),
    /no reachable device matches.*bridge-alpha.*bridge-beta/is,
  )
  note('both bridges advertise the same os/arch by design; only key, deviceId and name distinguish them')

  // ======================================================================
  // 4. one link goes
  // ======================================================================
  section('4. dropping one link leaves the other fully working')
  await a.service.disconnect(b1.id)
  await until(() => a.snap.links.length === 1, { label: 'the first link to be dropped' })
  eq('only the second link remains', a.snap.links[0].deviceId, b2.id)
  eq('the first target is gone', targetOf(a.service, b1.id), undefined)
  eq('the second target is still there', targetOf(a.service, b2.id)?.key, b2.id)
  eq('toolsAvailable stays true while a device is left', a.snap.toolsAvailable, true)
  await expectResolves('the surviving device still answers', () => a.service.remoteCall('sys.info', 'info', {}, { device: b2.id }), /hostname/)
  await expectResolves('and a call without `device` still works', () => a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }), /from-bridge-beta/)
  eq('resolveTarget() now picks the survivor', a.service.resolveTarget().key, b2.id)
  await expectRejects(
    'a call to the dropped device fails with a readable reason',
    () => a.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: b1.id }),
    /no reachable device matches/i,
  )
  await eventually('the dropped device sees its inbound session go', () => b1.snap.sessions.length === 0)
  ok('the surviving device kept its session', b2.snap.sessions.length === 1)

  // ======================================================================
  // 5. the last link goes
  // ======================================================================
  section('5. toolsAvailability flips only when the LAST link goes')
  await a.service.disconnect(b2.id)
  await until(() => a.snap.links.length === 0, { label: 'the last link to be dropped' })
  eq('no links remain', a.snap.links.length, 0)
  eq('no targets remain', a.service.listTargets().length, 0)
  eq('toolsAvailable is false again', a.snap.toolsAvailable, false)
  await expectRejects('resolveTarget explains the empty state again', () => Promise.resolve().then(() => a.service.resolveTarget()), /no device is reachable/i)
  await eventually('the second device sees its session go too', () => b2.snap.sessions.length === 0)
  await expectRejects(
    'disconnecting an unknown device is a strict, readable error',
    () => a.service.disconnect('not-a-connected-device'),
    /not connected/i,
  )
  eq('the strict error did not drop anything else', a.snap.links.length, 0)
  await a.service.disconnect()
  ok('disconnect() with no argument is a no-op when nothing is connected', a.snap.links.length === 0)

  // Reconnect both, to prove the tool plane comes back and there is no churn.
  await connectHosts({ from: a, to: b1, grant: grantFor(b1) })
  eq('the first device reconnects (it is already paired)', a.snap.links.length, 1)
  await connectHosts({ from: a, to: b2, grant: grantFor(b2) })
  eq('the second device reconnects too', a.snap.links.length, 2)
  eq('toolsAvailable is true again', a.snap.toolsAvailable, true)

  // ======================================================================
  // 6. the compatibility aliases the older panel still reads
  // ======================================================================
  section('6. the v2 snapshot and its compatibility aliases')
  const snap = a.snap
  ok('connection is the first connected link', snap.connection !== null && snap.connection.state === 'connected')
  eq('peersConnected aliases sessions', snap.peersConnected, snap.sessions)
  eq('the dialling machine has no inbound sessions of its own', snap.sessions.length, 0)
  eq('each bridge reports the one inbound session from A', b1.snap.sessions.length + b2.snap.sessions.length, 2)
  ok(
    'a session exposes the local machine to that peer',
    b1.snap.sessions[0]?.exposes?.some((row) => row.key === b1.id),
    JSON.stringify(b1.snap.sessions[0]?.exposes),
  )
  eq('a session says where the peer connects from', b1.snap.sessions[0]?.host, '127.0.0.1')
  ok('and from which source port', Number.isInteger(b1.snap.sessions[0]?.port) && b1.snap.sessions[0].port > 0, String(b1.snap.sessions[0]?.port))
  eq('links carries per-device devices', snap.links.every((link) => Array.isArray(link.devices)), true)
  eq('targets carries the link each route uses', snap.targets.every((target) => typeof target.linkDeviceId === 'string' && target.linkDeviceId !== ''), true)
  eq('request is null when nothing is pending', snap.request, null)
  ok('relay is reported as supported, with its ceiling', snap.relay?.supported === true && snap.relay?.maxHops === 3)

  // ======================================================================
  // 7. posture: a pairing window is what opens the door on an agent machine
  // ======================================================================
  section('7. identity posture is a posture, not a capability switch (contract §1)')
  eq('an agent-posture machine does not accept connections yet', solo.snap.accepts, false)
  solo.service.openPairingWindow(true)
  await eventually('opening a pairing window on an agent machine starts the listener', () => solo.snap.accepts === true && solo.snap.port > 0)
  ok('the pairing code is a 6-digit value', /^\d{6}$/.test(solo.snap.pairing?.code ?? ''), solo.snap.pairing?.code)
  const guest = track(new Host('md-guest', { role: 'agent' }))
  await guest.start()
  guest.put('who.txt', 'from-guest\n')
  const guestLink = await connectHosts({ from: guest, to: solo, grant: grantFor(solo) })
  eq('a peer can connect to the agent machine while its window is open', guestLink.state, 'connected')
  eq('the agent machine holds that inbound session', solo.snap.sessions.length, 1)
  // Posture is not a capability switch: the SAME agent-posture machine also dials
  // out, so it holds an inbound session and an outbound link at the same time.
  await connectHosts({ from: solo, to: guest, grant: grantFor(guest) })
  eq('the agent machine also holds an outbound link', solo.snap.links.length, 1)
  ok('and can drive the guest back', (await solo.service.ping(guest.id)) >= 0, 'ping returned')
  // Joining an already-pinned peer never shows the bridge user a card, so the
  // grant is what the panel would have to set (relay-safety §7 documents what the
  // un-set inbound grant otherwise looks like).
  guest.service.setGrant(solo.id, grantFor(guest))
  solo.service.closePairingWindow('test')
  await eventually('closing the window closes the door on an agent machine', () => solo.snap.accepts === false)
  eq('the live sessions survive the door closing', solo.snap.sessions.length, 1)
  await expectResolves('and that session still works', () => solo.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: guest.id }), /from-guest/)

  // A bridge posture keeps the door open on purpose.
  b1.service.closePairingWindow('test')
  await new Promise((resolve) => setTimeout(resolve, 300))
  eq('a bridge-posture machine keeps accepting after its window closes', b1.snap.accepts, true)
} catch (error) {
  report.ok('harness completed without an unexpected throw', false, error?.stack ?? String(error))
} finally {
  for (const host of hosts) await host.stop()
  for (const host of hosts) await host.cleanup()
}

finish()
