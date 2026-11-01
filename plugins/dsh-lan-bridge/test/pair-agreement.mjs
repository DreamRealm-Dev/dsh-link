#!/usr/bin/env node
/**
 * The two ends of a pairing must agree on the SAME bytes (R318).
 *
 * This is the defect it locks, measured against the real product: the desktop bridge advertises the capability list
 * [sys.info, fs.list, fs.read, fs.write, fs.edit, shell.exec] and the host driver advertises [fs.read, fs.write,
 * fs.list, shell.exec, sys.info, process.spawn]. `negotiate()` intersects them, and before this fix it stayed in the
 * CALLER's order - so the two ends hashed two different transcripts, the PAKE succeeded (it covers only code, context
 * and the device ids) and the session finish then failed with "agent confirmation tag mismatch". Pairing to a phone
 * worked and pairing to the desktop did not, which is exactly what a same-machine disagreement looks like.
 *
 * Readings:
 *   1 negotiate() from either end answers the same caps ARRAY (order included) and the same feature keys
 *   2 a real loopback handshake between two ends with DIFFERENT local cap lists pairs, and both ends hold the same
 *     negotiated caps
 *   3 the control: the same handshake with a wrong code still fails, so reading 2 is a measurement and not a bypass
 *
 * Usage: node test/pair-agreement.mjs
 * Exit 0 every reading held | 1 a reading failed
 */
import net from 'node:net'
import * as link from '../lib/core/link.js'
import * as C from '../lib/core/crypto.js'
import { BRIDGE_CAPABILITIES, FEATURES as SERVICE_FEATURES, PROTO } from '../lib/core/service.js'

let failures = 0
let checks = 0
function record(name, ok, detail) {
  checks += 1
  if (ok !== true) failures += 1
  console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + (detail === undefined ? '' : '  |  ' + detail))
}

const AGENT = { proto: PROTO, caps: link.CAPABILITIES, features: link.FEATURES }
const BRIDGE = { proto: PROTO, caps: BRIDGE_CAPABILITIES, features: SERVICE_FEATURES }

/**
 * One pairing over loopback; answers what each end negotiated, or the error that stopped it.
 *
 * Both ends are awaited before the answer is returned: the first version resolved from the bridge's callback alone and
 * read the agent's half before it had settled, which is how a passing handshake reported "both ends negotiated null".
 */
async function pairOnce(code, offerCode) {
  const identityA = C.generateIdentity()
  const identityB = C.generateIdentity()
  const out = { agent: null, bridge: null, agentError: null, bridgeError: null }
  let releaseBridge
  const bridgeDone = new Promise((resolve) => { releaseBridge = resolve })
  const server = net.createServer(async (socket) => {
    const frame = link.FrameLink.fromSocket(socket, 'bridge')
    try {
      const handshake = await link.bridgeHandshake(frame, {
        identity: identityB, deviceId: 'bridge-dev', name: 'bridge', app: 'dsh-lan-bridge/1',
        caps: BRIDGE.caps, features: BRIDGE.features, proto: BRIDGE.proto,
        pairing: { code, context: 'dsh-lan-bridge', pairId: 'pid-1' },
        requireUserConfirm: false, confirmPeer: async () => true,
        timeoutMs: 8000,
      })
      out.bridge = handshake.negotiated
    } catch (error) {
      out.bridgeError = String(error.code) + ' ' + String(error.message)
    }
    server.close()
    releaseBridge()
  })
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await listening
  const port = server.address().port
  const socket = net.connect({ host: '127.0.0.1', port })
  await new Promise((done) => socket.once('connect', done))
  const frame = link.FrameLink.fromSocket(socket, 'agent')
  try {
    const handshake = await link.agentHandshake(frame, {
      identity: identityA, deviceId: 'agent-dev', name: 'agent', app: 'dsh-lan-bridge/1',
      caps: AGENT.caps, features: AGENT.features, proto: AGENT.proto,
      pairCode: offerCode, timeoutMs: 8000, requireUserConfirm: false, confirmPeer: async () => true,
    })
    out.agent = handshake.negotiated
  } catch (error) {
    out.agentError = String(error.code) + ' ' + String(error.message)
  }
  socket.destroy()
  await bridgeDone
  return out
}

// The rule: the agent follows the BRIDGE's advertised order, the bridge keeps its own, so both hash the same array.
// (Sorting instead is what broke driver <-> phone: the Rust bridge end keeps its own order and does not sort.)
const fromAgent = link.negotiate(AGENT, BRIDGE, { order: 'remote' })
const fromBridge = link.negotiate(BRIDGE, AGENT)
record('1 the two ends build the SAME caps array: the agent follows the bridge\'s order, the bridge its own',
  JSON.stringify(fromAgent.caps) === JSON.stringify(fromBridge.caps) && fromAgent.caps.length === 5,
  'agent-side ' + JSON.stringify(fromAgent.caps) + ' / bridge-side ' + JSON.stringify(fromBridge.caps))

const CODE = '404643'
const good = await pairOnce(CODE, CODE)
record('2 a loopback handshake pairs when the two ends advertise different lists',
  good.agentError === null && good.bridgeError === null
    && JSON.stringify(good.agent) === JSON.stringify(good.bridge),
  good.agentError !== null || good.bridgeError !== null
    ? 'agent=' + String(good.agentError) + ' bridge=' + String(good.bridgeError)
    : 'both ends negotiated ' + JSON.stringify(good.agent))

const bad = await pairOnce(CODE, '000000')
record('3 control: a wrong code still fails', bad.agentError !== null || bad.bridgeError !== null,
  'agent=' + String(bad.agentError) + ' bridge=' + String(bad.bridgeError))

console.log('')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed')
process.exit(failures === 0 ? 0 : 1)
