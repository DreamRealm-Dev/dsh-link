#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it dials a shell proxy origin somebody else already started (line 25 defaults to 127.0.0.1:31761) and speaks HTTP/WebSocket to it; it never launches the shell that owns that port
/**
 * Probe the DSH Link shell proxy.
 *
 * The window loads the official DSH client from this proxy rather than from the kernel
 * directly: DSH 0.2.x gates every route behind a signed cookie that a browser cannot
 * present, so the Rust shell holds it and re-originates traffic. That makes the proxy
 * the one surface everything depends on, and this checks the four things the official
 * client needs from it:
 *
 *  1. the shell's readiness probe answers,
 *  2. the official client index comes through with its injected `__DSH_BOOT__` manifest,
 *  3. a static bundle asset comes through,
 *  4. a unary `/api` call decodes into the result slot, and a WebSocket upgrades.
 *
 * Usage:
 *   node scripts/probe-proxy.mjs [origin]
 */

import net from 'node:net'
import { argv } from 'node:process'

import { callEndpoint, report, requestJson } from './lib/http.mjs'

const DEFAULT_ORIGIN = 'http://127.0.0.1:31761'

/**
 * Perform a WebSocket upgrade over a raw socket, then hold it open across a client
 * frame.
 *
 * Node's global `WebSocket` aborts on Windows during teardown, which would make this
 * script's exit code meaningless. A plain TCP exchange proves the same thing and the
 * process exits cleanly.
 *
 * The uplink half is the point of this probe. `remote.mux` is bidirectional: the
 * official client opens Gateway streams by sending `{type:'open', streamId, endpoint,
 * payload}` uplink. A relay that treats the socket as downlink-only breaks the moment
 * the client writes, which leaves the official interface retrying its connection
 * forever while this handshake still reports success. So the probe sends one valid
 * `open` frame for the gateway-internal `$events` stream — the kernel keeps a valid
 * open alive — and waits longer than the kernel's two-second heartbeat before deciding
 * the socket survived. (A made-up `ready` frame is no good here: `ready` is a
 * *downlink* frame the kernel sends, and it hangs up on a client that sends one back.)
 *
 * @param {string} origin - proxy origin.
 * @returns {Promise<{ok: boolean, detail: string}>} the verdict.
 */
function upgradeProbe(origin) {
  const { port, hostname } = new URL(origin)
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port: Number(port) })
    let raw = ''
    let upgraded = false
    let settled = false
    // Post-handshake bytes, parsed as WebSocket frames (the relay is the server
    // side, so frames are unmasked).
    let frames = Buffer.alloc(0)

    const settle = (ok, detail) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve({ ok, detail })
    }
    const timer = setTimeout(
      () => settle(upgraded, upgraded ? 'socket still open after a client frame' : 'no handshake within 15s'),
      6_000,
    )

    socket.on('connect', () => {
      // A handshake needs a request line and the mandatory headers only; the proxy
      // attaches the kernel's cookie itself, so no credential is sent from here.
      socket.write(
        [
          'GET /api/remote.mux HTTP/1.1',
          `Host: ${hostname}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: ZGNoLWxpbmstd2Vic29ja2V0',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      )
    })

    socket.on('data', (chunk) => {
      if (upgraded) {
        frames = Buffer.concat([frames, chunk])
        // Parse frame headers to find a Close (opcode 0x8). A byte scan would
        // false-positive on payload bytes, and a naive scan used to sit on a
        // variable that was never reassigned — the check could not fail, which is
        // exactly how a relay regression would sail through it.
        for (;;) {
          if (frames.length < 2) return
          const opcode = frames[0] & 0x0f
          let length = frames[1] & 0x7f
          let offset = 2
          if (length === 126) {
            if (frames.length < 4) return
            length = frames.readUInt16BE(2)
            offset = 4
          } else if (length === 127) {
            if (frames.length < 10) return
            length = Number(frames.readBigUInt64BE(2))
            offset = 10
          }
          if (frames.length < offset + length) return
          if (opcode === 0x8) {
            settle(false, 'the relay closed the socket after a client frame')
            return
          }
          frames = frames.subarray(offset + length)
        }
      }
      raw += chunk
      if (!raw.includes('\r\n\r\n')) return
      const status = raw.split(' ', 2)[1] ?? ''
      if (status !== '101') {
        settle(false, `expected 101, got HTTP ${status}: ${raw.split('\r\n')[0]}`)
        return
      }
      upgraded = true
      frames = chunk.subarray(chunk.indexOf('\r\n\r\n') + 4)
      socket.write(maskedTextFrame(
        '{"type":"open","streamId":"probe-uplink","endpoint":"$events","payload":{"args":{}}}',
      ))
    })
    // A relay that hangs up without a close frame must not read as a pass: the
    // timer would otherwise settle "still open" on a socket that already died.
    socket.on('close', () => {
      if (upgraded) settle(false, 'the relay hung up the socket (no close event tolerated)')
    })
    socket.on('error', (error) => settle(false, error.message))
  })
}

/**
 * Build one masked client text frame.
 *
 * RFC 6455 requires client-to-server frames to be masked, and a relay that forwards
 * them unmasked would be rejected by the peer — so the mask is part of what is under
 * test, not decoration.
 *
 * @param {string} text - the frame payload.
 * @returns {Buffer} the encoded frame.
 */
function maskedTextFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const header = Buffer.from([0x81, 0x80 | payload.byteLength])
  const masked = Buffer.from(payload)
  for (let index = 0; index < masked.byteLength; index += 1) {
    masked[index] ^= mask[index % 4]
  }
  return Buffer.concat([header, mask, masked])
}

const origin = argv[2] ?? DEFAULT_ORIGIN
let failures = 0

function count(ok) {
  if (!ok) failures += 1
}

// 1. Session probe: the shell's own view of whether it holds credentials.
try {
  const response = await requestJson(`${origin}/__shell/session`, { method: 'GET' })
  const body = JSON.parse(response.text)
  count(
    report(
      'shell session probe',
      response.status === 200 && body.ready === true,
      `HTTP ${response.status} ${response.text.slice(0, 120)}`,
    ),
  )
} catch (error) {
  count(report('shell session probe', false, error.message))
}

// 2. The official client index, with the manifest the host injects into it.
//
// This is the load-bearing check for the whole design: the client has no bundle to boot
// from without `__DSH_BOOT__`, so if the proxy rewrote the HTML the window would come up
// blank while every other check still passed.
let entryAsset = null
try {
  const response = await requestJson(`${origin}/`, {
    method: 'GET',
    accept: 'text/html,application/xhtml+xml,*/*',
  })
  const hasManifest = response.text.includes('__DSH_BOOT__')
  count(
    report(
      'official client index',
      response.status === 200 && hasManifest,
      `HTTP ${response.status}, __DSH_BOOT__ ${hasManifest ? 'present' : 'ABSENT'}`,
    ),
  )
  entryAsset = response.text.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1] ?? null
} catch (error) {
  count(report('official client index', false, error.message))
}

// 3. Real bundles, fetched the way the page references them (relatively): the entry
// script and the client-module bundle the boot manifest preloads.
//
// The second one is not redundant with the first. A client bundle is addressed as
// `plugins/??@deepseek-ai/dsh-client-<name>/client.js&rev=<hash>` — `??` is part of the
// path, not a query. A proxy that folds path and query together turns it into `%3F%3F`
// and every plugin 404s while the page itself still loads and every other check passes.
const bundles = []
if (entryAsset) bundles.push(entryAsset)
try {
  const response = await requestJson(`${origin}/`, {
    method: 'GET',
    accept: 'text/html,application/xhtml+xml,*/*',
  })
  const moduleBundle = response.text.match(/<script src="(plugins\/[^"]+)"/)?.[1]
  if (moduleBundle) bundles.push(moduleBundle.replaceAll('&amp;', '&'))
} catch {
  // The index was already checked above; this only adds coverage.
}

for (const bundle of bundles) {
  try {
    const response = await requestJson(`${origin}/${bundle}`, {
      method: 'GET',
      accept: '*/*',
    })
    count(
      report(
        `bundle ${bundle.slice(0, 60)}`,
        response.status === 200 && response.text.length > 200,
        `HTTP ${response.status}, ${response.text.length} bytes`,
      ),
    )
  } catch (error) {
    count(report(`bundle ${bundle.slice(0, 60)}`, false, error.message))
  }
}
if (bundles.length === 0) {
  count(report('bundle discovery', false, 'no bundles referenced by the index'))
}

// 4. Unary RPC: a real endpoint whose reply must decode into the result slot.
try {
  const presets = await callEndpoint(origin, 'agentPresets/list', {})
  const ids = (presets?.presets ?? []).map((preset) => preset.id)
  count(
    report(
      'unary RPC agentPresets/list',
      ids.length > 0,
      `${ids.length} preset(s): ${ids.join(', ')}`,
    ),
  )
} catch (error) {
  count(report('unary RPC agentPresets/list', false, error.message))
}

// 5. WebSocket: the upgrade, and whether the uplink survives it.
const upgrade = await upgradeProbe(origin)
count(report('websocket /api/remote.mux uplink', upgrade.ok, upgrade.detail))

process.stdout.write(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`)
process.exit(failures === 0 ? 0 : 1)