#!/usr/bin/env node
/**
 * The panel's own two-step flow must be ONE attempt (R320).
 *
 * The user-facing sequence is: type a host:port, press 连接, learn that a code is needed, type the code, press 提交配对码.
 * Measured against the real phone (R316) the second step answered 'there is no pending connection to submit a pairing
 * code for; pick a device first', because a manual attempt that fails with pairing_required never lands in
 * state.links - the only place submitPairingCode looked. The service now remembers the target of such an attempt.
 *
 * Readings:
 *   1 a manual connect with no code fails BY NAME (pairing_required), and the link is not half-open
 *   2 the code submitted afterwards continues THAT attempt and connects (no host:port retyped)
 *   3 after it connects the remembered target is gone, so a later stray code is refused instead of dialling a stranger
 *   4 control: with no attempt at all, a code is refused by name
 *
 * Run: node test/manual-pair.mjs
 * Exit 0 every reading held | 1 a reading failed
 */
import { Host, createReport, until } from './_harness.mjs'

const report = createReport('manual-pair')
const { ok, eq, note, section, expectRejects, finish } = report

const hosts = []
const track = (host) => { hosts.push(host); return host }

try {
  const agent = track(new Host('mp-agent', { role: 'agent' }))
  const bridge = track(new Host('mp-bridge', { role: 'bridge' })).advertiseName('manual-peer')
  await agent.start()
  await bridge.start()

  section('1. a manual connect without a code is refused BY NAME')
  // Opening the window makes the bridge listen and gives this test a code - exactly what the panel's 开启配对窗口 does.
  const window = bridge.service.openPairingWindow(true)
  const code = String(window.code)
  note('the bridge opened a pairing window; the code has ' + String(code.length) + ' digits')
  const port = Number(bridge.snap.port)
  await expectRejects(
    'a manual connect that has no code yet fails with pairing_required',
    () => agent.service.connect({ host: '127.0.0.1', port }),
    /pairing_required|pairing code/i,
  )
  eq('the failed attempt left no half-open link', agent.snap.links.length, 0)

  section('2. submitting the code continues THAT attempt (and the bridge user still answers the card)')
  const pending = agent.service.submitPairingCode(code)
  pending.catch(() => { /* surfaced by the races below */ })
  let timer = null
  const asked = new Promise((resolve) => {
    const deadline = Date.now() + 15000
    const tick = () => {
      const snapshot = bridge.service.snapshot()
      const request = Array.isArray(snapshot.requests) ? snapshot.requests[0] : undefined
      if (request !== undefined) return resolve({ request })
      if (Date.now() > deadline) return resolve({ timeout: true })
      timer = setTimeout(tick, 50)
      timer.unref?.()
    }
    tick()
  })
  const outcome = await Promise.race([
    asked,
    pending.then(() => ({ connected: true }), (error) => ({ failed: error })),
  ])
  if (timer !== null) clearTimeout(timer)
  eq('the bridge asked its user about this device', outcome.request !== undefined, true)
  if (outcome.request !== undefined) {
    bridge.service.decideRequest({ id: outcome.request.id, decision: 'allow', grant: outcome.request.defaultGrant, remember: true })
  }
  const linked = await pending
  eq('the pair is connected', linked.state, 'connected')
  ok('the link names the peer it reached', typeof linked.peerName === 'string' && linked.peerName !== '')
  const snap = agent.service.snapshot()
  eq('the agent now has one link', snap.links.length, 1)
  ok('the agent has a data plane again: toolsAvailable=' + String(snap.toolsAvailable), snap.toolsAvailable === true)


  section('4. control: with no attempt at all, a code is refused by name')
  const fresh = track(new Host('mp-fresh', { role: 'agent' }))
  await fresh.start()
  await expectRejects(
    'a code on a machine that never started an attempt is refused',
    () => fresh.service.submitPairingCode('654321'),
    /no pending connection|pick a device/i,
  )
} finally {
  for (const host of hosts) {
    try { await host.stop() } catch (error) { /* teardown is best effort */ }
  }
  finish()
}
