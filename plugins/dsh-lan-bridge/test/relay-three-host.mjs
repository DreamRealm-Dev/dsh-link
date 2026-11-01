/**
 * relay-three-host.mjs — the headline multi-device case: A drives C through B.
 *
 * Three real bridge services in one process, talking only over loopback TCP:
 * real identities, real trust stores, real SPAKE2 pairing, real per-peer grants.
 *
 *   A (agent) --link--> B (bridge) --link--> C (bridge)
 *
 * Proves, on the real wire path:
 *   - A can call C's tools through B, and the effects land on C;
 *   - the grant A sees for C is the INTERSECTION of A's grant on B and B's grant
 *     on C (capabilities conjoined, numbers minimised, roots from the far side);
 *   - a read-only hop anywhere in the chain refuses the write;
 *   - A's access to B's own files is never narrowed by B's grant on C;
 *   - every hop answers `sys.info/devices`, which is how the chain is composed.
 *
 * Run: node test/relay-three-host.mjs
 */

import fs from 'node:fs'
import { parseTargetOp, targetOp } from '../lib/core/service.js'
import {
  Host,
  connectHosts,
  createReport,
  grantFor,
  nodeCommand,
  removeDir,
  sleepCommand,
  targetOf,
  tempRoot,
  until,
  waitTarget,
} from './_harness.mjs'

const report = createReport('relay-three-host')
const { ok, eq, note, section, expectRejects, expectResolves, finish } = report

const root = tempRoot('dsh-lan-relay3-')
const hosts = []
/** Probe until truthy, but never throw: used for "does this happen at all". */
async function soft(predicate, timeoutMs = 2500) {
  try {
    return await until(predicate, { timeoutMs, intervalMs: 100, label: 'probe' })
  } catch {
    return false
  }
}

try {
  // ---- topology ------------------------------------------------------------
  const c = new Host('c', { role: 'bridge' })
  const b = new Host('b', { role: 'bridge' })
  const a = new Host('a', { role: 'agent' })
  hosts.push(a, b, c)
  await c.start()
  await b.start()
  await a.start()

  // The same file name on both machines, with different content: the content a
  // caller gets back is the honest proof of WHICH machine served the read.
  c.put('c-only.txt', 'content-from-C\n')
  b.put('c-only.txt', 'content-from-B\n')
  b.put('b-only.txt', 'content-from-B\n')

  const grantOnC = grantFor(c, { timeoutMs: 8000, maxOutputBytes: 120_000 })
  const grantOnB = grantFor(b, { timeoutMs: 20_000, maxOutputBytes: 300_000 })

  // Inner link first, so B already knows C when A attaches.
  await connectHosts({ from: b, to: c, grant: grantOnC })
  await connectHosts({ from: a, to: b, grant: grantOnB })

  section('1. the chain is composed from sys.info/devices')
  eq('B holds exactly one outbound link, to C', b.snap.links.length, 1)
  eq('that link is to C', b.snap.links[0]?.deviceId, c.id)
  eq('A holds exactly one outbound link, to B', a.snap.links.length, 1)
  eq('A\'s link is to B', a.snap.links[0]?.deviceId, b.id)

  const targetC = targetOf(a.service, c.id)
  const targetB = targetOf(a.service, b.id)
  ok('A reaches two targets: B and C', a.service.listTargets().length === 2, `targets=${a.service.listTargets().length}`)
  eq('A sees B as a direct target', targetB?.kind, 'direct')
  eq('A sees C as a relayed target', targetC?.kind, 'relay')
  eq('C is two hops from A', targetC?.hops, 2)
  eq('A reaches C through B\'s link', targetC?.linkDeviceId, b.id)
  eq('A reports a hop ceiling of 3', a.snap.relay.maxHops, 3)
  eq('B sees C as a direct target', targetOf(b.service, c.id)?.kind, 'direct')
  eq('the pure helpers round-trip the wire convention', parseTargetOp(targetOp('read', 'k')).key, 'k')
  eq('an unsuffixed op has no key', parseTargetOp('read').key, undefined)

  section('2. A really calls C\'s tools through B')
  const bTrailBefore = b.executorRows().filter((row) => row.target === 'c-only.txt').length
  const cTrailBefore = c.executorRows().filter((row) => row.target === 'c-only.txt').length
  const readViaC = await a.service.remoteCall('fs.read', 'read', { path: 'c-only.txt' }, { device: c.id })
  eq('a relayed fs.read returns C\'s bytes, not B\'s', readViaC.content, 'content-from-C\n')
  eq(
    'the relayed read never reached B\'s executor',
    b.executorRows().filter((row) => row.target === 'c-only.txt').length,
    bTrailBefore,
  )
  eq(
    'C\'s executor ran it exactly once',
    c.executorRows().filter((row) => row.target === 'c-only.txt').length,
    cTrailBefore + 1,
  )
  const readViaB = await a.service.remoteCall('fs.read', 'read', { path: 'c-only.txt' }, { device: b.id })
  eq('the same path on the direct target returns B\'s bytes', readViaB.content, 'content-from-B\n')
  eq(
    'the direct read did reach B\'s executor',
    b.executorRows().filter((row) => row.target === 'c-only.txt').length,
    bTrailBefore + 1,
  )

  const wrote = await a.service.remoteCall('fs.write', 'write', { path: 'written-by-A-on-C.txt', content: 'relay\n' }, { device: c.id })
  eq('a relayed fs.write reports the byte count', wrote.bytes, Buffer.byteLength('relay\n'))
  ok('the relayed write landed on C', c.exists('written-by-A-on-C.txt'))
  ok('and did not appear on B', !b.exists('written-by-A-on-C.txt'))

  const listed = await a.service.remoteCall('fs.list', 'list', { path: '.' }, { device: c.id })
  ok(
    'a relayed fs.list sees C\'s directory',
    Array.isArray(listed.entries) && listed.entries.some((e) => e.name === 'c-only.txt') && listed.entries.some((e) => e.name === 'written-by-A-on-C.txt'),
    JSON.stringify(listed.entries?.map((e) => e.name)),
  )
  const info = await a.service.remoteCall('sys.info', 'info', {}, { device: c.id })
  ok('a relayed sys.info answers', typeof info.hostname === 'string' && info.hostname.length > 0)

  // Executor trails: the relayed write must have run on C's executor only.
  ok(
    'C\'s executor ran the relayed write',
    c.executorRows().some((row) => row.cap === 'fs.write' && row.target === 'written-by-A-on-C.txt' && row.allowed === true),
  )
  eq(
    'B\'s executor never ran the C-only write',
    b.executorRows().filter((row) => row.target === 'written-by-A-on-C.txt').length,
    0,
  )

  c.put('c-shell-probe.js', "console.log('C-RELAY-MARKER')\n")
  const shell = await a.service.remoteCall('shell.exec', 'exec', { command: nodeCommand('c-shell-probe.js') }, { device: c.id })
  eq('a relayed shell.exec exits 0', shell.exitCode, 0)
  ok(
    'the relayed shell ran with C\'s working directory (its own script file resolved)',
    /C-RELAY-MARKER/.test(shell.stdout ?? ''),
    JSON.stringify({ stdout: shell.stdout, stderr: shell.stderr, cwd: shell.cwd }),
  )

  const parallel = await Promise.all([
    a.service.remoteCall('fs.read', 'read', { path: 'c-only.txt' }, { device: c.id }),
    a.service.remoteCall('fs.list', 'list', { path: '.' }, { device: c.id }),
    a.service.remoteCall('sys.info', 'info', {}, { device: c.id }),
  ])
  ok('three relayed calls in flight at once all settle', parallel[0].content === 'content-from-C\n' && Array.isArray(parallel[1].entries) && typeof parallel[2].hostname === 'string')

  section('3. the effective grant A sees for C is the intersection')
  const effective = targetOf(a.service, c.id).grant
  eq('timeoutMs is the smaller of the two hops', effective.timeoutMs, 8000)
  eq('maxOutputBytes is the smaller of the two hops', effective.maxOutputBytes, 120_000)
  eq('write is conjoined (both hops allow)', effective.write, true)
  eq('shell is conjoined (both hops allow)', effective.shell, true)
  eq('roots come from the far side', effective.roots[0], c.shareReal)
  eq('cwdRoot comes from the far side', effective.cwdRoot, c.shareReal)
  ok('the near side\'s roots are not offered as the far side\'s roots', !effective.roots.includes(b.shareReal))
  eq('A\'s own grant on B is untouched by B\'s grant on C', targetOf(a.service, b.id).grant.timeoutMs, 20_000)

  const intersect = a.service._internals.intersectGrants
  const probe = intersect(
    { roots: [b.shareReal], cwdRoot: b.shareReal, write: true, shell: false, createDirs: true, timeoutMs: 30_000, maxOutputBytes: 400_000 },
    { roots: [c.shareReal], cwdRoot: c.shareReal, write: true, shell: true, createDirs: false, timeoutMs: 60_000, maxOutputBytes: 100_000 },
  )
  eq('intersectGrants: write is AND', probe.write, true)
  eq('intersectGrants: shell is AND', probe.shell, false)
  eq('intersectGrants: createDirs is AND', probe.createDirs, false)
  eq('intersectGrants: timeoutMs is the minimum', probe.timeoutMs, 30_000)
  eq('intersectGrants: maxOutputBytes is the minimum', probe.maxOutputBytes, 100_000)
  eq('intersectGrants: roots come from the far side', probe.roots[0], c.shareReal)

  section('4. a read-only OUTER hop refuses the write, on both routes')
  b.service.setGrant(a.id, { ...grantOnB, write: false, shell: false })
  const downgraded = await waitTarget(a.service, c.id, (target) => target.grant.write === false, {
    label: 'A to see the outer grant downgrade for C',
  })
  eq('the downgrade reached A', downgraded.grant.write, false)
  await expectRejects(
    'a write to C is refused when A only has read-only on B',
    () => a.service.remoteCall('fs.write', 'write', { path: 'refused.txt', content: 'x' }, { device: c.id }),
    /read-only|not-granted|not permitted/i,
  )
  await expectRejects(
    'a write to B\'s own files is refused by the same downgrade',
    () => a.service.remoteCall('fs.write', 'write', { path: 'refused.txt', content: 'x' }, { device: b.id }),
    /read-only|not-granted|not permitted/i,
  )
  ok('nothing was written on C', !c.exists('refused.txt'))
  ok('nothing was written on B', !b.exists('refused.txt'))
  const stillReads = await a.service.remoteCall('fs.read', 'read', { path: 'c-only.txt' }, { device: c.id })
  eq('reads still pass through the read-only hop', stillReads.content, 'content-from-C\n')

  b.service.setGrant(a.id, grantOnB)
  await waitTarget(a.service, c.id, (target) => target.grant.write === true, { label: 'A to see write restored for C' })

  section('5. a read-only FAR hop refuses the write too')
  c.service.setGrant(b.id, { ...grantOnC, write: false })
  const autoUpdated = await soft(() => targetOf(a.service, c.id)?.grant?.write === false)
  note(
    autoUpdated
      ? 'A learned about the far-side downgrade without any extra action'
      : 'A did NOT learn about the far-side downgrade by itself; the panel action of re-saving the outer grant is what pushes a fresh target list',
  )
  // A re-save of A's grant on B is the real panel action that pushes a fresh
  // target list to A; the tool plane must then see the intersection.
  b.service.setGrant(a.id, grantOnB)
  const seenReadOnly = await waitTarget(a.service, c.id, (target) => target.grant.write === false, {
    label: 'A to see the far-side downgrade after a target-list push',
  })
  eq('the intersection reports write false once the far hop is read-only', seenReadOnly.grant.write, false)
  await expectRejects(
    'a write to C is refused when B only has read-only on C',
    () => a.service.remoteCall('fs.write', 'write', { path: 'refused-far.txt', content: 'x' }, { device: c.id }),
    /read-only|not-granted|not permitted/i,
  )
  const craftedBefore = c.executorRows().filter((row) => row.target === 'refused-far.txt').length
  await expectRejects(
    'a crafted write@C that skips A\'s local pre-check is refused by B\'s authorizer',
    () => a.sessionTo(b.id).request('fs.write', `write@${c.id}`, { path: 'refused-far.txt', content: 'x' }, { timeoutMs: 8000 }),
    /not-granted|read-only/i,
  )
  eq('the crafted write reached no executor on C', c.executorRows().filter((row) => row.target === 'refused-far.txt').length, craftedBefore)
  ok('nothing was written on C', !c.exists('refused-far.txt'))

  const localWrite = await a.service.remoteCall('fs.write', 'write', { path: 'b-local.txt', content: 'b-local\n' }, { device: b.id })
  eq('A can still write to B\'s own target while C is read-only for B', localWrite.bytes, Buffer.byteLength('b-local\n'))
  ok('that write landed on B', b.exists('b-local.txt'))
  ok('and not on C', !c.exists('b-local.txt'))

  c.service.setGrant(b.id, grantOnC)
  b.service.setGrant(a.id, grantOnB)
  await waitTarget(a.service, c.id, (target) => target.grant.write === true, { label: 'write to be restored through both hops' })

  section('6. limits are minimised in both directions')
  eq('far-side smaller: A sees 8000 ms', targetOf(a.service, c.id).grant.timeoutMs, 8000)
  eq('far-side smaller: A sees 120000 bytes', targetOf(a.service, c.id).grant.maxOutputBytes, 120_000)

  // Widen ONLY the far-side numbers (no flag changes): the near side's
  // 20000/300000 must become the minimum, and the caller must learn that WITHOUT
  // anyone re-saving its own grant (the old deviceSignature ignored the numbers).
  const widenStartedAt = Date.now()
  c.service.setGrant(b.id, { ...grantOnC, timeoutMs: 45_000, maxOutputBytes: 500_000 })
  await waitTarget(a.service, c.id, (target) => target.grant.timeoutMs === 20_000 && target.grant.maxOutputBytes === 300_000, {
    label: 'A to see the re-minimised limits without an explicit re-grant',
    timeoutMs: 15_000,
  })
  const widenPushMs = Date.now() - widenStartedAt
  ok('a limits-only far-side change reaches the caller well inside the 30 s backstop', widenPushMs < 15_000, `${widenPushMs} ms`)
  note(`limits-only push reached the caller in ${widenPushMs} ms`)
  eq('near-side smaller: A sees 20000 ms', targetOf(a.service, c.id).grant.timeoutMs, 20_000)
  eq('near-side smaller: A sees 300000 bytes', targetOf(a.service, c.id).grant.maxOutputBytes, 300_000)
  eq('B itself sees the far grant it holds', targetOf(b.service, c.id).grant.timeoutMs, 45_000)

  // Narrow ONLY the far side to 5 s, then prove the caller's NEXT call really uses
  // it: an 8 s command must be cut off near 5 s instead of running to completion
  // under the caller's own 20 s.
  const narrowStartedAt = Date.now()
  c.service.setGrant(b.id, { ...grantOnC, timeoutMs: 5000 })
  await waitTarget(a.service, c.id, (target) => target.grant.timeoutMs === 5000, {
    label: 'A to see the narrowed far-side limit without an explicit re-grant',
    timeoutMs: 15_000,
  })
  const narrowPushMs = Date.now() - narrowStartedAt
  note(`narrowed-limit push reached the caller in ${narrowPushMs} ms`)
  const callStartedAt = Date.now()
  const narrowMessage = await expectRejects(
    'the next call really uses the narrowed far-side limit',
    () => a.service.remoteCall('shell.exec', 'exec', { command: sleepCommand(8000) }, { device: c.id }),
    /request_timeout|timeout|closed/i,
  )
  const callMs = Date.now() - callStartedAt
  note(`the 8 s command was cut off after ${callMs} ms: ${JSON.stringify(narrowMessage)}`)
  ok('it was cut off near 5 s, not at the 20 s the caller had on its own', callMs > 3000 && callMs < 7500, `${callMs} ms`)

  c.service.setGrant(b.id, grantOnC)
  await waitTarget(a.service, c.id, (target) => target.grant.timeoutMs === 8000 && target.grant.maxOutputBytes === 120_000, {
    label: 'the far-side minimum to come back on its own',
    timeoutMs: 15_000,
  })
  eq('and back to the far-side minimum', targetOf(a.service, c.id).grant.maxOutputBytes, 120_000)

  section('7. the snapshot surface the panel reads')
  const sessionOnB = b.snap.sessions.find((session) => session.deviceId === a.id)
  ok('B reports the inbound session from A', sessionOnB !== undefined)
  const exposedC = sessionOnB?.exposes?.find((row) => row.deviceId === c.id)
  eq('B exposes C to A as a relayed target', exposedC?.kind, 'relay')
  eq('B exposes C to A with the intersected timeout', exposedC?.grant?.timeoutMs, 8000)
  eq('B exposes C to A with the intersected bytes', exposedC?.grant?.maxOutputBytes, 120_000)
  ok(
    'the exposed relay row carries the route it takes',
    Array.isArray(exposedC?.path) && exposedC.path.length > 0,
    JSON.stringify(exposedC?.path),
  )
  eq('the inbound session row says where the peer connects from', sessionOnB?.host, '127.0.0.1')
  ok('and from which source port', Number.isInteger(sessionOnB?.port) && sessionOnB.port > 0, String(sessionOnB?.port))
  const devicesOnA = a.snap.links[0]?.devices?.find((row) => row.key === c.id)
  eq('A\'s link record lists C', devicesOnA?.kind, 'relay')
  eq('A can drive something', a.snap.toolsAvailable, true)
  await expectRejects(
    'omitting `device` with two targets is a readable ambiguity error',
    async () => a.service.resolveTarget(),
    /several devices are reachable/i,
  )

  section('7b. the panel\'s connection self-test through the relay')
  const markerName = '.dsh-lan-bridge-selftest.txt'
  const selfTest = await a.service.selfTest({ device: c.id })
  eq('the relayed self-test reports ok', selfTest.ok, true)
  eq('its write/read round trip succeeded', selfTest.roundTripOk, true)
  ok(
    'every step of the relayed self-test succeeded',
    Array.isArray(selfTest.steps) && selfTest.steps.length > 0 && selfTest.steps.every((step) => step.ok === true),
    JSON.stringify(selfTest.steps.map((step) => [step.name, step.ok, step.error])),
  )
  ok('it measured a real round-trip time', typeof selfTest.rttMs === 'number' && selfTest.rttMs >= 0, String(selfTest.rttMs))
  ok('its marker landed inside C\'s granted root', c.exists(markerName))
  // The marker is deliberately LEFT at a fixed, self-identifying path (there is no
  // delete capability in the contract), so the property worth pinning is that it
  // is overwritten in place and never accumulates.
  ok(
    'the marker is self-identifying',
    /dsh-lan-bridge/.test(c.read(markerName)) && /自检/.test(c.read(markerName)),
    JSON.stringify(c.read(markerName).slice(0, 160)),
  )
  const secondRun = await a.service.selfTest({ device: c.id })
  eq('a second self-test over the existing marker also reports ok', secondRun.ok, true)
  eq('and its round trip also succeeded', secondRun.roundTripOk, true)
  eq(
    'the marker was overwritten in place, not duplicated',
    fs.readdirSync(c.share).filter((name) => name === markerName).length,
    1,
  )

  section('8. C going away degrades only the C route')
  await b.service.disconnect(c.id)
  await until(() => targetOf(b.service, c.id) === undefined, { label: 'B to drop C' })
  await expectRejects(
    'a call to the departed relay target fails with a readable reason',
    () => a.service.remoteCall('fs.read', 'read', { path: 'c-only.txt' }, { device: c.id }),
    /unknown-device|peer-offline|not reachable|does not expose/i,
  )
  const afterLoss = await a.service.remoteCall('fs.read', 'read', { path: 'b-only.txt' }, { device: b.id })
  eq('the direct route to B is untouched', afterLoss.content, 'content-from-B\n')

  // ---- extra probe: a target that appears AFTER the link was established ---
  section('9. probe: a relay target that connects later')
  const c2 = new Host('c2', { role: 'bridge' })
  const b2 = new Host('b2', { role: 'bridge' })
  const a2 = new Host('a2', { role: 'agent' })
  hosts.push(a2, b2, c2)
  await c2.start()
  await b2.start()
  await a2.start()
  c2.put('late.txt', 'late-target\n')
  await connectHosts({ from: a2, to: b2, grant: grantFor(b2, { relay: true }) })
  await connectHosts({ from: b2, to: c2, grant: grantFor(c2) })
  const sawItAlone = await soft(() => targetOf(a2.service, c2.id) !== undefined)
  note(sawItAlone ? 'A2 discovered the late target by itself' : 'A2 did not discover the late target without a refresh')
  const record = a2.linkRecord(b2.id)
  await a2.service.refreshDevices(record)
  const afterRefresh = await soft(() => targetOf(a2.service, c2.id) !== undefined, 4000)
  ok('after the documented refreshDevices(linkRecord) A2 lists the late target', afterRefresh === true)
  if (afterRefresh === true) {
    await expectResolves(
      'a late-appearing relay target is callable (no stale `unsupported`)',
      () => a2.service.remoteCall('fs.read', 'read', { path: 'late.txt' }, { device: c2.id }),
      /late-target/,
    )
  }
} catch (error) {
  report.ok('harness completed without an unexpected throw', false, error?.stack ?? String(error))
} finally {
  for (const host of hosts) await host.stop()
  for (const host of hosts) await host.cleanup()
  removeDir(root)
}

finish()
