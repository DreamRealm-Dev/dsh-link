/**
 * relay-safety.mjs — adversarial coverage of the relay plane.
 *
 * Every case drives the real services over loopback with real handshakes and
 * real grants, and checks TWO things:
 *   1. the call is refused with the documented error code, and
 *   2. nothing reached an executor — asserted on the executor's own audit trail
 *      (`createExecutor` is the only writer of a row carrying `cap`).
 *
 * Wire-level cases (a bogus op suffix, a spoofed `$relay`) are injected through
 * the SAME `Session` object the tools use, because `remoteCall` cannot express an
 * unroutable key by construction — that refusal is itself the first line of
 * defence and is asserted separately.
 *
 * Run: node test/relay-safety.mjs
 */

import fs from 'node:fs'
import { parseTargetOp } from '../lib/core/service.js'
import {
  Host,
  connectHosts,
  createReport,
  grantFor,
  nodeCommand,
  requestsOf,
  sleepCommand,
  targetOf,
  trustStoreOf,
  until,
  waitTarget,
} from './_harness.mjs'

const report = createReport('relay-safety')
const { ok, eq, note, section, expectRejects, expectResolves, eventually, finish } = report

const hosts = []
const track = (host) => {
  hosts.push(host)
  return host
}

/** How many times one machine actually executed something for one path. */
const trail = (host, target) => host.executorRows().filter((row) => row.target === target).length

/**
 * Build a chain of hosts and link it innermost-first, so every inner machine
 * already knows its own relays when the outer one attaches.
 *   labels[0] is the driver (outermost); links are labels[i] -> labels[i+1].
 */
async function buildChain({ prefix, labels, driverConfig = {}, grants = {} }) {
  const created = labels.map((label, index) =>
    track(new Host(`${prefix}-${label}`, { role: index === 0 ? 'agent' : 'bridge', config: index === 0 ? driverConfig : {} })),
  )
  const by = new Map(labels.map((label, index) => [label, created[index]]))
  for (const host of created) await host.start()
  for (let index = labels.length - 2; index >= 0; index -= 1) {
    const key = `${labels[index]}->${labels[index + 1]}`
    await connectHosts({ from: created[index], to: created[index + 1], grant: grants[key] ?? grantFor(created[index + 1]) })
  }
  return { by, list: created, get: (label) => by.get(label) }
}

try {
  // ======================================================================
  // 1. a genuine A -> B -> A cycle refuses itself
  // ======================================================================
  section('1. a real A -> B -> A cycle is refused with relay-loop')
  const loopA = track(new Host('loop-a', { role: 'bridge' }))
  const loopB = track(new Host('loop-b', { role: 'bridge' }))
  await loopA.start()
  await loopB.start()
  loopA.put('loop.txt', 'loop file on A\n')
  loopB.put('loop.txt', 'loop file on B\n')
  // Two real links, one in each direction: B can now relay back to A, so A sees
  // its OWN device id in its target list.
  await connectHosts({ from: loopA, to: loopB, grant: grantFor(loopB) })
  await connectHosts({ from: loopB, to: loopA, grant: grantFor(loopA) })
  // The second link joins two already-pinned peers: it never shows the bridge
  // user a card, so its grant is set explicitly here (the panel does the same).
  loopA.service.setGrant(loopB.id, grantFor(loopA))

  const sawSelf = await eventually('A sees its own device id in the target list through B', () => targetOf(loopA.service, loopA.id) !== undefined)
  if (sawSelf) eq('its own device is offered as a relayed target', targetOf(loopA.service, loopA.id)?.kind, 'relay')
  const aBefore = trail(loopA, 'loop.txt')
  const bBefore = trail(loopB, 'loop.txt')
  const loopMessage = await expectRejects(
    'calling A\'s own device id through B is refused',
    () => loopA.service.remoteCall('fs.read', 'read', { path: 'loop.txt' }, { device: loopA.id }),
    /relay-loop/i,
  )
  note(`loop refusal message: ${JSON.stringify(loopMessage)}`)
  eq('the caller never executed the looped read', trail(loopA, 'loop.txt'), aBefore)
  eq('the middle machine never executed the looped read', trail(loopB, 'loop.txt'), bBefore)
  await expectResolves(
    'the direct route to B still works right after the loop was refused',
    () => loopA.service.remoteCall('fs.read', 'read', { path: 'loop.txt' }, { device: loopB.id }),
    /loop file on B/,
  )

  // ======================================================================
  // 1b. a genuine three-machine cycle
  // ======================================================================
  section('1b. a real A -> B -> C -> A cycle is refused at the machine that closes it')
  const cycA = track(new Host('cyc-a', { role: 'bridge' }))
  const cycB = track(new Host('cyc-b', { role: 'bridge' }))
  const cycC = track(new Host('cyc-c', { role: 'bridge' }))
  await cycA.start()
  await cycB.start()
  await cycC.start()
  cycA.put('cycle.txt', 'cycle file on A\n')
  await connectHosts({ from: cycA, to: cycB, grant: grantFor(cycB) })
  await connectHosts({ from: cycB, to: cycC, grant: grantFor(cycC) })
  await connectHosts({ from: cycC, to: cycA, grant: grantFor(cycA) })
  // The third link joins two already-pinned peers, so set the grant the panel would.
  cycA.service.setGrant(cycC.id, grantFor(cycA))
  const sawSelfAgain = await eventually('A sees itself reachable around the cycle', () => targetOf(cycA.service, cycA.id) !== undefined, {
    timeoutMs: 10_000,
  })
  if (sawSelfAgain) eq('the cycle target is relayed', targetOf(cycA.service, cycA.id)?.kind, 'relay')
  const cycleBefore = { a: trail(cycA, 'cycle.txt'), b: trail(cycB, 'cycle.txt'), c: trail(cycC, 'cycle.txt') }
  const cycleMessage = await expectRejects(
    'the cycle closes with relay-loop',
    () => cycA.service.remoteCall('fs.read', 'read', { path: 'cycle.txt' }, { device: cycA.id }),
    /relay-loop/i,
  )
  note(`three-machine cycle refusal: ${JSON.stringify(cycleMessage)}`)
  eq('nothing executed on A', trail(cycA, 'cycle.txt'), cycleBefore.a)
  eq('nothing executed on B', trail(cycB, 'cycle.txt'), cycleBefore.b)
  eq('nothing executed on C', trail(cycC, 'cycle.txt'), cycleBefore.c)

  // ======================================================================
  // 2. hop ceiling: A -> B -> C -> D against maxHops 3
  // ======================================================================
  section('2. a chain longer than maxHops is refused with relay-limit')
  const three = await buildChain({ prefix: 'hop3', labels: ['a', 'b', 'c', 'd'] })
  const [ha, hb, hc, hd] = ['a', 'b', 'c', 'd'].map((label) => three.get(label))
  hd.put('d.txt', 'deep file\n')
  const targetD = targetOf(ha.service, hd.id)
  eq('A reaches D as a relayed target', targetD?.kind, 'relay')
  const targetC = targetOf(ha.service, hc.id)
  eq('a device two links away reports 2 hops', targetC?.hops, 2)
  eq('a device three links away reports 3 hops', targetD?.hops, 3)
  ok('the hop count grows with the chain instead of flattening', (targetD?.hops ?? 0) > (targetC?.hops ?? 0))
  eq('the middle device is one hop from its own peer', targetOf(hb.service, hc.id)?.hops, 1)
  const before2 = { b: trail(hb, 'd.txt'), c: trail(hc, 'd.txt'), d: trail(hd, 'd.txt') }
  const limitMessage = await expectRejects(
    'a 4-machine chain is refused at the last hop',
    () => ha.service.remoteCall('fs.read', 'read', { path: 'd.txt' }, { device: hd.id }),
    /relay-limit/i,
  )
  note(`hop-limit refusal message: ${JSON.stringify(limitMessage)}`)
  eq('D never executed the over-long read', trail(hd, 'd.txt'), before2.d)
  eq('C never executed it either', trail(hc, 'd.txt'), before2.c)
  eq('B never executed it either', trail(hb, 'd.txt'), before2.b)

  section('2e. a far-side limits change propagates through two relay hops')
  const farLimitBefore = targetOf(ha.service, hd.id)?.grant?.timeoutMs
  note(`A's effective timeout for D before the change: ${farLimitBefore} ms`)
  hd.service.setGrant(hc.id, { ...grantFor(hd), timeoutMs: 7000 })
  await waitTarget(ha.service, hd.id, (target) => target.grant.timeoutMs === 7000, {
    label: 'A to see the far-side limit change through B and C',
    timeoutMs: 15_000,
  })
  eq('the caller two relay hops away sees the new far-side minimum', targetOf(ha.service, hd.id).grant.timeoutMs, 7000)
  eq('and the intermediate machine sees it too', targetOf(hb.service, hd.id)?.grant?.timeoutMs, 7000)

  section('2b. the same chain succeeds when the caller raises its own ceiling')
  const four = await buildChain({ prefix: 'hop4', labels: ['a', 'b', 'c', 'd'], driverConfig: { maxHops: 4 } })
  const fa = four.get('a')
  const fd = four.get('d')
  fd.put('d.txt', 'deep file\n')
  eq('the raised ceiling is reported', fa.snap.relay.maxHops, 4)
  await expectResolves(
    'A reaches D across three hops with maxHops 4',
    () => fa.service.remoteCall('fs.read', 'read', { path: 'd.txt' }, { device: fd.id }),
    /deep file/,
  )
  eq('D executed exactly that one read', trail(fd, 'd.txt'), 1)
  note(
    'BOUNDARY: with the default maxHops=3 the deepest chain that completes is A->B->C (3 machines, 2 relay hops); ' +
      'A->B->C->D needs maxHops=4. The ceiling counts MACHINES (`path.length + 1`), while service.js describes ' +
      '"A->B->C->D is three hops" — the frozen formula and the code agree, the naming does not.',
  )

  section('2d. the hop count keeps growing, and the ceiling is a machine count')
  const five = await buildChain({ prefix: 'hop5', labels: ['a', 'b', 'c', 'd', 'e'], driverConfig: { maxHops: 5 } })
  const ga = five.get('a')
  const ge = five.get('e')
  ge.put('e.txt', 'five deep\n')
  eq('a device four links away reports 4 hops', targetOf(ga.service, ge.id)?.hops, 4)
  await expectResolves(
    'a 4-link chain completes once the caller raises the ceiling to 5 machines',
    () => ga.service.remoteCall('fs.read', 'read', { path: 'e.txt' }, { device: ge.id }),
    /five deep/,
  )
  eq('and the far end executed exactly one read', trail(ge, 'e.txt'), 1)

  section('2c. a direct route beats a relayed route for the same device')
  const tieC = track(new Host('tie-c', { role: 'bridge' }))
  const tieB = track(new Host('tie-b', { role: 'bridge' }))
  const tieA = track(new Host('tie-a', { role: 'agent' }))
  await tieC.start()
  await tieB.start()
  await tieA.start()
  tieC.put('tie.txt', 'from-tie-c\n')
  // A reaches C through B first, so the relayed route is the only one on offer.
  await connectHosts({ from: tieB, to: tieC, grant: grantFor(tieC) })
  await connectHosts({ from: tieA, to: tieB, grant: grantFor(tieB) })
  eq('C is first reachable as a relayed target', targetOf(tieA.service, tieC.id)?.kind, 'relay')
  // Now the direct link appears: the relayed route must lose the tie.
  await connectHosts({ from: tieA, to: tieC, grant: grantFor(tieC) })
  const directRoute = targetOf(tieA.service, tieC.id)
  eq('the direct route wins the tie', directRoute?.kind, 'direct')
  eq('and it is the direct link that carries it', directRoute?.linkDeviceId, tieC.id)
  eq('a direct peer is one hop', directRoute?.hops, 1)
  eq('both routes still exist as links', tieA.snap.links.length, 2)
  const tieTrailBefore = trail(tieB, 'tie.txt')
  await expectResolves(
    'the call really goes over the direct route, not through the relay',
    () => tieA.service.remoteCall('fs.read', 'read', { path: 'tie.txt' }, { device: tieC.id }),
    /from-tie-c/,
  )
  eq('the intermediate machine executed nothing', trail(tieB, 'tie.txt'), tieTrailBefore)
  eq('the target itself executed exactly one read', trail(tieC, 'tie.txt'), 1)

  // ======================================================================
  // 3. spoofed op suffixes
  // ======================================================================
  section('3. unknown and self-referential op suffixes are refused')
  hb.put('b.txt', 'from-b\n')
  const bogus = 'ffffffffffffffffffffffffffffffff'
  const before3 = { b: hb.executorRows().length, c: hc.executorRows().length }
  await expectRejects(
    'read@<bogus> is refused with unknown-device',
    () => ha.sessionTo(hb.id).request('fs.read', `read@${bogus}`, { path: 'b.txt' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  await expectRejects(
    'read@<the receiving machine\'s own id> is refused',
    () => ha.sessionTo(hb.id).request('fs.read', `read@${hb.id}`, { path: 'b.txt' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  await expectRejects(
    'read@<the caller\'s own id> is refused by the next hop',
    () => ha.sessionTo(hb.id).request('fs.read', `read@${ha.id}`, { path: 'b.txt' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  await expectRejects(
    'a write@<bogus> is refused before any path check',
    () => ha.sessionTo(hb.id).request('fs.write', `write@${bogus}`, { path: 'x.txt', content: 'x' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  eq('B executed nothing for those suffixes', hb.executorRows().length, before3.b)
  eq('C executed nothing for those suffixes', hc.executorRows().length, before3.c)
  await expectRejects(
    'a bogus base op with a real target suffix is refused, not guessed at',
    () => ha.sessionTo(hb.id).request('fs.read', `bogus@${hc.id}`, { path: 'c.txt' }, { timeoutMs: 8000 }),
    /unsupported/i,
  )
  eq('and it reached no executor', hb.executorRows().length, before3.b)
  await expectRejects(
    'an empty suffix (`read@`) is refused rather than silently treated as a local call',
    () => ha.sessionTo(hb.id).request('fs.read', 'read@', { path: 'b.txt' }, { timeoutMs: 8000 }),
    /unsupported|unknown-device/i,
  )
  eq('and that reached no executor either', hb.executorRows().length, before3.b)
  eq('while the helpers normalise an empty key to "no suffix"', parseTargetOp('read@').key, undefined)
  await expectResolves(
    'an unsuffixed op from the same session still works',
    () => ha.sessionTo(hb.id).request('fs.read', 'read', { path: 'b.txt' }, { timeoutMs: 8000 }),
    /from-b/,
  )

  // ======================================================================
  // 4. relayPeers and relay:false gate the advertised target list
  // ======================================================================
  section('4. relayPeers and relay:false are enforced, not merely advertised')
  const grantOfAOnB = targetOf(ha.service, hb.id).grant
  ok('the driver holds write on B for these negative controls', grantOfAOnB?.write === true)

  hb.service.setGrant(ha.id, { ...grantOfAOnB, relayPeers: [hc.id] })
  await eventually('D disappears from the driver\'s target list once it is outside relayPeers', () => targetOf(ha.service, hd.id) === undefined)
  ok('the named device in relayPeers stays reachable', targetOf(ha.service, hc.id) !== undefined)
  hc.put('c.txt', 'from-c\n')
  await expectResolves(
    'a read addressed to the allow-listed device keeps working',
    () => ha.service.remoteCall('fs.read', 'read', { path: 'c.txt' }, { device: hc.id }),
    /from-c/,
  )
  await expectResolves(
    'the allow-listed device answers a relayed sys.info',
    () => ha.service.remoteCall('sys.info', 'info', {}, { device: hc.id }),
    /hostname/,
  )
  const before4 = trail(hd, 'd.txt')
  await expectRejects(
    'a crafted read@D is refused once D is outside relayPeers',
    () => ha.sessionTo(hb.id).request('fs.read', `read@${hd.id}`, { path: 'd.txt' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  eq('D still executed nothing', trail(hd, 'd.txt'), before4)

  hb.service.setGrant(ha.id, { ...grantOfAOnB, relayPeers: ['no-such-device'] })
  await eventually('a relayPeers allow-list that names nobody removes every relayed target', () => targetOf(ha.service, hc.id) === undefined)
  await expectResolves(
    'the local target of B is still offered (relayPeers filters relays only)',
    () => ha.service.remoteCall('fs.read', 'read', { path: 'b.txt' }, { device: hb.id }),
    /from-b/,
  )

  hb.service.setGrant(ha.id, { ...grantOfAOnB, relay: false })
  await eventually('relay:false removes every relayed target from the driver', () => targetOf(ha.service, hc.id) === undefined)
  await expectRejects(
    'a crafted read@C is refused while relay is false',
    () => ha.sessionTo(hb.id).request('fs.read', `read@${hc.id}`, { path: 'd.txt' }, { timeoutMs: 8000 }),
    /unknown-device/i,
  )
  await expectResolves(
    'the direct route to B itself is unaffected by relay:false',
    () => ha.service.remoteCall('sys.info', 'info', {}, { device: hb.id }),
    /hostname/,
  )
  hb.service.setGrant(ha.id, grantOfAOnB)
  await waitTarget(ha.service, hc.id, () => true, { label: 'the relayed targets to come back' })
  ok('relaying comes back when the grant says so', targetOf(ha.service, hc.id) !== undefined)

  // ======================================================================
  // 5. spoofed $relay provenance
  // ======================================================================
  section('5. spoofed $relay paths')
  // (a) claim a hop that has not been visited: the machine named in the path is
  //     the one that notices — it refuses when the request finally reaches it.
  const before5a = trail(hc, 'd.txt')
  await expectRejects(
    'a path claiming the target already handled the call is refused',
    () =>
      ha.sessionTo(hb.id).request(
        'fs.read',
        `read@${hc.id}`,
        { path: 'd.txt', $relay: { path: [hc.id], maxHops: 3 } },
        { timeoutMs: 8000 },
      ),
    /relay-loop/i,
  )
  eq('C never executed the claimed-hop read', trail(hc, 'd.txt'), before5a)

  // (b) a caller-supplied ceiling below reality: the hop ceiling still binds.
  await expectRejects(
    'a caller-supplied maxHops of 1 is refused at the next hop',
    () =>
      ha.sessionTo(hb.id).request(
        'fs.read',
        `read@${hc.id}`,
        { path: 'd.txt', $relay: { path: [ha.id], maxHops: 1 } },
        { timeoutMs: 8000 },
      ),
    /relay-limit/i,
  )

  // (c) a caller that omits its OWN hop while the call loops back to it.
  const before5c = { a: trail(loopA, 'loop.txt'), b: trail(loopB, 'loop.txt') }
  let omitted
  try {
    const result = await loopA.sessionTo(loopB.id).request(
      'fs.read',
      `read@${loopA.id}`,
      { path: 'loop.txt', $relay: { path: [], maxHops: 3 } },
      { timeoutMs: 8000 },
    )
    omitted = { outcome: 'resolved', detail: JSON.stringify(result.result).slice(0, 160) }
  } catch (error) {
    omitted = { outcome: 'rejected', detail: `${error?.code ?? '?'}: ${error?.message ?? error}` }
  }
  note(`omitted-hop spoof: ${JSON.stringify(omitted)}`)
  // Contract §5b: `$relay.path` is provenance, NOT authentication. The security
  // property is therefore not "refused" but these three measured bounds.
  ok('BOUND 1 (no amplification): the caller executed at most once', trail(loopA, 'loop.txt') - before5c.a <= 1, JSON.stringify(omitted))
  eq('BOUND 1 (no amplification): the intermediate machine executed nothing', trail(loopB, 'loop.txt') - before5c.b, 0)
  ok(
    'BOUND 2 (no chain extension): the lying path still terminates',
    omitted.outcome === 'rejected' ? /relay-loop|relay-limit|unknown-device|peer-offline/i.test(omitted.detail) : omitted.detail.includes('loop file'),
    JSON.stringify(omitted),
  )
  await expectRejects(
    'BOUND 2 (no chain extension): a lying path cannot raise the ceiling — maxHops 1 is still refused at the first hop',
    () =>
      loopA.sessionTo(loopB.id).request(
        'fs.read',
        `read@${loopA.id}`,
        { path: 'loop.txt', $relay: { path: [], maxHops: 1 } },
        { timeoutMs: 8000 },
      ),
    /relay-limit/i,
  )

  // (e) BOUND 3 (no permission widening): the far hop re-resolves the target
  //     against its own grant and recomputes the intersection, so a spoofed short
  //     path cannot turn a read-only far hop into one that accepts a write.
  hc.service.setGrant(hb.id, { ...grantFor(hc), write: false })
  await waitTarget(hb.service, hc.id, (target) => target.grant.write === false, { label: 'B to see the read-only far grant' })
  const spoofWriteBefore = hc.executorRows().filter((row) => row.target === 'spoof-write.txt').length
  await expectRejects(
    'BOUND 3 (no widening): a spoofed empty path cannot make a read-only far hop accept a write',
    () =>
      ha.sessionTo(hb.id).request(
        'fs.write',
        `write@${hc.id}`,
        { path: 'spoof-write.txt', content: 'x', $relay: { path: [], maxHops: 3 } },
        { timeoutMs: 8000 },
      ),
    /not-granted|read-only/i,
  )
  eq('nothing was written on C', hc.exists('spoof-write.txt'), false)
  eq('and no executor ran for it on C', hc.executorRows().filter((row) => row.target === 'spoof-write.txt').length, spoofWriteBefore)
  hc.service.setGrant(hb.id, grantFor(hc))
  await waitTarget(hb.service, hc.id, (target) => target.grant.write === true, { label: 'the far grant to come back' })

  // (d) junk provenance must not crash a call.
  await expectResolves(
    'a non-object $relay is ignored, not fatal',
    () => ha.sessionTo(hb.id).request('fs.read', 'read', { path: 'b.txt', $relay: 'not-an-object' }, { timeoutMs: 8000 }),
    /from-b/,
  )
  await expectResolves(
    'an empty $relay object is ignored, not fatal',
    () => ha.sessionTo(hb.id).request('fs.read', 'read', { path: 'b.txt', $relay: {} }, { timeoutMs: 8000 }),
    /from-b/,
  )
  await expectResolves(
    'a $relay path full of non-strings is filtered, not fatal',
    () => ha.sessionTo(hb.id).request('fs.read', 'read', { path: 'b.txt', $relay: { path: [1, null, {}], maxHops: 3 } }, { timeoutMs: 8000 }),
    /from-b/,
  )

  // ======================================================================
  // 6. concurrency
  // ======================================================================
  section('6. concurrency: two peers, one bridge, one mid-flight disconnect')
  const p1 = track(new Host('peer-1', { role: 'agent' }))
  const p2 = track(new Host('peer-2', { role: 'agent' }))
  const hub = track(new Host('peer-hub', { role: 'bridge' }))
  const far = track(new Host('peer-far', { role: 'bridge' }))
  await p1.start()
  await p2.start()
  await hub.start()
  await far.start()
  p1.put('who.txt', 'peer-1\n')
  p2.put('who.txt', 'peer-2\n')
  far.put('who.txt', 'far\n')
  await connectHosts({ from: hub, to: far, grant: grantFor(far) })
  await connectHosts({ from: p1, to: hub, grant: grantFor(p1) })
  await connectHosts({ from: p2, to: hub, grant: grantFor(p2) })
  eq('the bridge holds two inbound sessions at once', hub.snap.sessions.length, 2)
  eq('both peers have their own session', hub.snap.sessions.filter((s) => s.deviceId === p1.id || s.deviceId === p2.id).length, 2)
  eq('the first peer keeps its own root', hub.snap.sessions.find((s) => s.deviceId === p1.id)?.grant?.roots?.[0], p1.shareReal)
  eq('and the second one keeps its own', hub.snap.sessions.find((s) => s.deviceId === p2.id)?.grant?.roots?.[0], p2.shareReal)

  await expectResolves(
    'p1 reads its own machine-local file through the hub',
    () => p1.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: hub.id }),
    /peer-1/,
  )
  await expectRejects(
    'p1 cannot reach p2\'s root through the same hub',
    () => p1.service.remoteCall('fs.read', 'read', { path: `${p2.shareReal}/who.txt` }, { device: hub.id }),
    /path-denied|not-granted|outside/i,
  )

  const atOnce = await Promise.all([
    p1.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: hub.id }),
    p2.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: hub.id }),
    p1.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: far.id }),
    p2.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: far.id }),
    p1.service.remoteCall('sys.info', 'info', {}, { device: far.id }),
  ])
  eq('two peers calling the same bridge at once each get their own answer (p1)', atOnce[0].content, 'peer-1\n')
  eq('two peers calling the same bridge at once each get their own answer (p2)', atOnce[1].content, 'peer-2\n')
  eq('two peers relaying to the same far device at once agree', `${atOnce[2].content}${atOnce[3].content}`, 'far\nfar\n')
  ok('a relayed sys.info interleaved with them still answers', typeof atOnce[4].hostname === 'string')

  const inflight = p1.service.remoteCall('shell.exec', 'exec', { command: sleepCommand(4000) }, { device: far.id, timeoutMs: 30_000 })
  inflight.catch(() => {
    /* asserted below; this only keeps Node from reporting an unhandled rejection */
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const startedAt = Date.now()
  await hub.service.disconnect(far.id)
  let inflightOutcome
  try {
    const value = await inflight
    inflightOutcome = `resolved: ${JSON.stringify(value).slice(0, 120)}`
  } catch (error) {
    inflightOutcome = `rejected: ${error?.message ?? error}`
  }
  const settledMs = Date.now() - startedAt
  note(`in-flight relayed call after the link dropped: ${inflightOutcome} (settled in ${settledMs} ms)`)
  ok('an in-flight relayed call settles after the link drops', settledMs < 10_000, `took ${settledMs} ms`)
  ok(
    'it settles with a readable reason rather than hanging',
    /rejected: .*(closed|peer|reachable|offline|timeout|unknown|not-granted)/i.test(inflightOutcome),
    inflightOutcome,
  )
  await expectResolves(
    'the other peer is unaffected by the dropped far link',
    () => p2.service.remoteCall('fs.read', 'read', { path: 'who.txt' }, { device: hub.id }),
    /peer-2/,
  )

  // ======================================================================
  // 7. what an inbound session gets when the peer is only pinned outbound
  // ======================================================================
  section('7. an inbound session from a machine this one only dialled out to fails closed')
  const x = track(new Host('pin-x', { role: 'bridge' }))
  const y = track(new Host('pin-y', { role: 'bridge' }))
  await x.start()
  await y.start()
  x.put('x-only.txt', 'from-x\n')
  await connectHosts({ from: x, to: y, grant: grantFor(y) })
  ok('X pinned Y by dialling out to it', trustStoreOf(x.service).getPeer(y.id)?.trusted === true, JSON.stringify(trustStoreOf(x.service).getPeer(y.id)))
  // Y now dials back into X. X's bridge side finds Y already pinned, so the
  // handshake takes the `trusted` path and never runs the approval gate — which
  // is exactly why the session must come up unable to touch anything.
  await connectHosts({ from: y, to: x, grant: grantFor(x) })
  const inboundOnX = x.snap.sessions.find((session) => session.deviceId === y.id)
  const inboundSince = inboundOnX?.sinceMs
  const linkSince = y.snap.links[0]?.sinceMs
  ok('X holds an inbound session from Y', inboundOnX !== undefined)
  note(`un-approved inbound grant on X for Y: ${JSON.stringify(inboundOnX?.grant)}`)
  eq('the un-approved inbound grant has no root at all', inboundOnX?.grant?.roots?.length, 0)
  eq('...and is read-only', inboundOnX?.grant?.write, false)
  eq('...and has no shell', inboundOnX?.grant?.shell, false)
  eq('...and cannot relay', inboundOnX?.grant?.relay, false)
  ok(
    'the empty grant is NOT the write-enabled workspace default the old code handed out',
    inboundOnX?.grant?.roots?.[0] !== fs.realpathSync.native(process.cwd()),
    JSON.stringify(inboundOnX?.grant),
  )
  const pending = await until(() => requestsOf(x.snap).find((row) => row.deviceId === y.id), {
    label: 'X to raise an out-of-band grant request for Y',
    timeoutMs: 10_000,
  })
  eq('the request says why it is being asked', pending.reason, 'inbound-without-grant')
  await expectRejects(
    'Y cannot read anything on X before X\'s user allows it',
    () => y.service.remoteCall('fs.read', 'read', { path: 'package.json' }, { device: x.id }),
    /not-granted|no directory root/i,
  )
  await expectRejects(
    'Y cannot write on X either',
    () => y.service.remoteCall('fs.write', 'write', { path: 'intruder.txt', content: 'x' }, { device: x.id }),
    /read-only|not-granted|no directory root/i,
  )
  ok('nothing was written on X', !x.exists('intruder.txt'))
  await expectRejects(
    'Y cannot open a shell on X either',
    () => y.service.remoteCall('shell.exec', 'exec', { command: 'echo intruder' }, { device: x.id }),
    /shell|not-granted/i,
  )
  const unapprovedInfo = await expectResolves(
    'an un-approved peer can still answer sys.info (that is what the empty grant is for)',
    () => y.service.remoteCall('sys.info', 'info', {}, { device: x.id }),
    /hostname/,
  )
  note(`sys.info visible to an un-approved peer: ${JSON.stringify(unapprovedInfo)}`)

  // The local user allows it: the LIVE session must start working with no reconnect.
  const decided = x.service.decideRequest({ id: pending.id, decision: 'allow', grant: grantFor(x), remember: true })
  eq('the decision is recorded', decided.decided, 'allow')
  await waitTarget(y.service, x.id, (target) => target.grant.write === true, {
    label: 'Y to see the allowed grant on the still-open session',
  })
  await expectResolves(
    'Y can read X immediately after the allow, with no reconnect',
    () => y.service.remoteCall('fs.read', 'read', { path: 'x-only.txt' }, { device: x.id }),
    /from-x/,
  )
  await expectResolves(
    'and can write on X within the granted root',
    () => y.service.remoteCall('fs.write', 'write', { path: 'allowed.txt', content: 'allowed\n' }, { device: x.id }),
    /bytes/,
  )
  ok('the write landed on X', x.exists('allowed.txt'))
  eq('the live session was refreshed, not replaced', x.snap.sessions.find((session) => session.deviceId === y.id)?.sinceMs, inboundSince)
  eq('and the caller kept the same link', y.snap.links[0]?.sinceMs, linkSince)
  eq('X reports the allowed grant on the live session', x.snap.sessions[0]?.grant?.write, true)

  // ======================================================================
  // 7b. the deny path is just as powerless
  // ======================================================================
  section('7b. denying the out-of-band request leaves that session powerless')
  const x2 = track(new Host('pin-x2', { role: 'bridge' }))
  const y2 = track(new Host('pin-y2', { role: 'bridge' }))
  await x2.start()
  await y2.start()
  x2.put('x2-only.txt', 'from-x2\n')
  await connectHosts({ from: x2, to: y2, grant: grantFor(y2) })
  await connectHosts({ from: y2, to: x2, grant: grantFor(x2) })
  const pending2 = await until(() => requestsOf(x2.snap).find((row) => row.deviceId === y2.id), {
    label: 'X2 to raise the out-of-band request',
    timeoutMs: 10_000,
  })
  const denied = x2.service.decideRequest({ id: pending2.id, decision: 'deny' })
  eq('the deny is recorded', denied.decided, 'deny')
  await eventually('the denied request is cleared from the panel', () => requestsOf(x2.snap).every((row) => row.id !== pending2.id))
  eq('a deny does not evict the session', x2.snap.sessions.length, 1)
  eq('and the session still has no root', x2.snap.sessions[0]?.grant?.roots?.length, 0)
  eq('nor any write', x2.snap.sessions[0]?.grant?.write, false)
  await expectRejects(
    'Y2 still cannot read anything on X2 after the deny',
    () => y2.service.remoteCall('fs.read', 'read', { path: 'x2-only.txt' }, { device: x2.id }),
    /not-granted|no directory root/i,
  )

  // ======================================================================
  // 8. the timeout is narrowed at every hop
  // ======================================================================
  section('8. a narrowed timeout is honoured at the narrowest hop')
  const lateMarker = 'late-marker.txt'
  const treeParentMarker = 'tree-parent.txt'
  const grandchildMarker = 'grandchild.txt'
  // Two commands, both given far longer work than the 2 s deadline:
  //   (a) the work happens INSIDE the shell process (a PowerShell built-in pair);
  //   (b) the work happens in a real child process, and that child spawns a
  //       detached grandchild — i.e. the common case (node/python/git/npm).
  // The abort has to kill the whole tree for (b) too.
  const plainCommand =
    process.platform === 'win32'
      ? `Start-Sleep -Milliseconds 6000; Set-Content -Path ${lateMarker} -Value done`
      : `sleep 6; echo done > ${lateMarker}`
  const treeProbe = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync('grandchild.txt', 'x'), 4000)\"], { detached: true, stdio: 'ignore' }).unref()",
    "setTimeout(() => fs.writeFileSync('tree-parent.txt', 'done'), 6000)",
    "setTimeout(() => {}, 9000)",
  ].join('\n')
  hc.put('tree-probe.js', treeProbe)
  const treeCommand = nodeCommand('tree-probe.js')

  const hcBefore = hc.executorRows().filter((row) => row.cap === 'shell.exec').length
  const handlerBefore = hc.auditRows().filter((row) => row.action === 'shell.exec/exec').length
  hb.service.setGrant(ha.id, { ...grantOfAOnB, timeoutMs: 2000 })
  await waitTarget(ha.service, hc.id, (target) => target.grant.timeoutMs === 2000, { label: 'A to see the narrowed limit for C' })

  const narrowStartedAt = Date.now()
  const outcomes = await Promise.all([
    ha.service.remoteCall('shell.exec', 'exec', { command: plainCommand }, { device: hc.id }).then(
      () => 'resolved',
      (error) => `rejected: ${error?.message ?? error}`,
    ),
    ha.service.remoteCall('shell.exec', 'exec', { command: treeCommand }, { device: hc.id }).then(
      () => 'resolved',
      (error) => `rejected: ${error?.message ?? error}`,
    ),
  ])
  const elapsed = Date.now() - narrowStartedAt
  note(`narrowed-timeout outcomes after ${elapsed} ms: ${JSON.stringify(outcomes)}`)
  ok(
    'both relayed shell.exec calls are cut off at the narrowest hop, not at the far machine\'s default',
    outcomes.every((outcome) => /^rejected: .*(request_timeout|timeout|closed)/i.test(outcome)),
    JSON.stringify(outcomes),
  )
  ok('the caller gave up at the narrowed timeout', elapsed < 5000, `took ${elapsed} ms`)

  // Wait past both commands' own sleeps: the side effects they would have produced
  // must never appear, because the far executor is bounded by the caller's own
  // deadline and aborted when the caller gives up.
  await new Promise((resolve) => setTimeout(resolve, 9000))
  ok(
    'the abandoned in-shell command produced no side effect on the far machine',
    !hc.exists(lateMarker),
    `the marker file exists on C: ${lateMarker}`,
  )
  ok(
    'the abandoned child-process command produced no side effect either',
    !hc.exists(treeParentMarker),
    `the child process outlived the abort and wrote ${treeParentMarker}`,
  )
  ok(
    'and its detached grandchild was killed with it (the whole tree, not just the shell)',
    !hc.exists(grandchildMarker),
    `the grandchild outlived the abort and wrote ${grandchildMarker}`,
  )
  const handlerRows = hc.auditRows().filter((row) => row.action === 'shell.exec/exec')
  const newRows = handlerRows.slice(0, Math.max(0, handlerRows.length - handlerBefore))
  note(`far-side handler rows for the abandoned calls: ${JSON.stringify(newRows.map((row) => [row.allowed, row.detail, row.ms]))}`)
  eq(
    'the far side recorded no SUCCESSFUL completion for the calls the caller saw fail',
    newRows.filter((row) => /^exit\s+0\b/i.test(String(row.detail ?? ''))).length,
    0,
  )
  ok(
    'the far executor did run both ops (bounded and aborted, not silently dropped)',
    hc.executorRows().filter((row) => row.cap === 'shell.exec').length >= hcBefore + 2,
  )
} catch (error) {
  report.ok('harness completed without an unexpected throw', false, error?.stack ?? String(error))
} finally {
  for (const host of hosts) await host.stop()
  for (const host of hosts) await host.cleanup()
}

finish()
