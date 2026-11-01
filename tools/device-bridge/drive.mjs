/**
 * Drive a DSH-LINK bridge end from the host side.
 *
 * This script is the *host* half of the device net's proof: it speaks the wire with the
 * shipped implementation (plugins/dsh-lan-bridge/lib/core/link.js and crypto.js) rather
 * than with a second client written for the occasion. Whatever pairs here is paired by the
 * same code a real DSH host runs.
 *
 * Usage:
 *   node tools/device-bridge/drive.mjs --port 47600 --code 123456 \
 *     [--host 127.0.0.1] [--list /sdcard] [--read /sdcard/Download/note.txt] \
 *     [--refuse fs.write]
 *
 * Exit code 0 only when the handshake, every requested read and the expected refusal all
 * came back exactly as this file describes.
 */
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const core = path.resolve(here, '../../plugins/dsh-lan-bridge/lib/core')

const link = await import('file://' + path.join(core, 'link.js').replace(/\\/g, '/'))
const C = await import('file://' + path.join(core, 'crypto.js').replace(/\\/g, '/'))

function parseArgs(argv) {
  const args = { host: '127.0.0.1', port: 47600, list: '/sdcard', refuse: 'fs.write', timeoutMs: 10000 }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined) break
    if (key === '--host') args.host = value
    else if (key === '--port') args.port = Number(value)
    else if (key === '--code') args.code = value
    else if (key === '--list') args.list = value
    else if (key === '--read') args.read = value
    else if (key === '--refuse') args.refuse = value
    else if (key === '--photo') args.photo = value
    else if (key === '--timeout') args.timeoutMs = Number(value)
    else throw new Error('unknown argument ' + key)
  }
  if (!args.code) throw new Error('--code is required (the number on the device screen)')
  return args
}

/** One line of transcript, printed as it happens so a hang still shows how far it got. */
function say(tag, text) {
  console.log('[' + tag + '] ' + text)
}

function close(value, keys) {
  const out = {}
  for (const key of keys) {
    if (value && Object.prototype.hasOwnProperty.call(value, key)) out[key] = value[key]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const socket = net.connect({ host: args.host, port: args.port })
await new Promise((resolve, reject) => {
  socket.once('connect', resolve)
  socket.once('error', reject)
})
say('tcp', 'connected to ' + args.host + ':' + args.port)

const frameLink = link.FrameLink.fromSocket(socket, 'agent')
const identity = C.generateIdentity()

let session
let peer
try {
  const handshake = await link.agentHandshake(frameLink, {
    identity,
    deviceId: 'dsh-link-host-driver',
    name: 'R234 host driver',
    app: 'dsh-link-drive',
    caps: link.CAPABILITIES,
    features: link.FEATURES,
    pairCode: args.code,
    timeoutMs: args.timeoutMs,
  })
  session = handshake.session
  peer = handshake.peer
  const negotiated = handshake.negotiated
  say(
    'pair',
    'ok authMode=' + peer.authMode +
      ' protocol=v' + negotiated.protocolVersion +
      ' caps=' + negotiated.caps.join(',') +
      ' device=' + peer.deviceId +
      ' name=' + JSON.stringify(peer.name) +
      ' fingerprint=' + peer.fingerprint,
  )
} catch (error) {
  say('pair', 'FAILED ' + (error.code || '') + ' ' + (error.detail || error.message))
  socket.destroy()
  process.exit(1)
}

let failures = 0

async function step(cap, op, callArgs, report) {
  try {
    // request() resolves the session's envelope { result, payload, meta }; the operation's
    // own value is inside it, exactly as the plugin's own tools read it.
    const { result } = await session.request(cap, op, callArgs, { timeoutMs: args.timeoutMs })
    report(result)
    return result
  } catch (error) {
    failures += 1
    say(cap, 'FAILED ' + (error.code || '') + ' ' + (error.detail || error.message))
    return null
  }
}

// ---- fs.list ---------------------------------------------------------------
const listed = await step('fs.list', 'list', { path: args.list }, (result) => {
  const entries = result.entries || []
  const shown = entries.slice(0, 8).map((entry) => entry.name + (entry.type === 'dir' ? '/' : '') + ' ' + entry.size)
  say('fs.list', args.list + ' -> ' + entries.length + ' entries, truncated=' + result.truncated)
  say('fs.list', 'first: ' + shown.join('  '))
  say('fs.list', 'result: ' + JSON.stringify({
    path: result.path,
    truncated: result.truncated,
    entries: close(entries[0] || {}, ['name', 'type', 'size', 'mtimeMs']),
  }))
})
if (listed === null || !Array.isArray(listed.entries)) failures += 1

// ---- fs.read ---------------------------------------------------------------
if (args.read) {
  const read = await step('fs.read', 'read', { path: args.read }, (result) => {
    say('fs.read', result.path + ' -> offset=' + result.offset +
      ' totalLines=' + result.totalLines + ' truncated=' + result.truncated)
    const lines = String(result.content).split('\n')
    for (const line of lines.slice(0, 6)) say('fs.read', '  | ' + line)
    if (lines.length > 6) say('fs.read', '  | ... ' + (lines.length - 6) + ' more line(s)')
  })
  if (read === null || typeof read.content !== 'string') failures += 1
}

// ---- media.capture / photo: the phone as a camera ---------------------------------
// R380: the full loop. This host's wire client asks the phone for one still frame; the phone's own WebView calls
// getUserMedia, encodes a JPEG and posts it to its capture route, and what comes back here names the artifact so this
// side can read it with the fs.read it already has.
if (args.photo) {
  const photo = await step('media.capture', 'photo', { ms: 6000 }, (result) => {
    say('media.capture', 'photo -> ' + JSON.stringify(close(result, ['path', 'bytes', 'sha256', 'kind', 'size'])))
  })
  const ok = photo !== null && typeof photo.path === 'string' && photo.path !== '' && Number.isFinite(photo.bytes) === true
  if (ok !== true) failures += 1
  else {
    // Read the artifact back through the SAME wire the host uses for every file, so "it landed" is the phone's own
    // answer twice: once as a capture, once as a file this side can open.
    const back = await step('fs.read', 'read', { path: photo.path }, () => {})
    if (back === null || typeof back.path !== 'string') failures += 1
    else say('media.capture', 'read back through fs.read: ' + back.path + ' (' + String(photo.bytes) + ' bytes on the device)')
  }
}

// ---- the operation this build refuses by name ------------------------------
if (args.refuse) {
  const [cap, op] = args.refuse.split(':').length === 2
    ? args.refuse.split(':')
    : [args.refuse, args.refuse === 'fs.write' ? 'write' : 'run']
  let refusal = null
  try {
    await session.request(cap, op, { path: args.list, content: 'x' }, { timeoutMs: args.timeoutMs })
    say(args.refuse, 'UNEXPECTED SUCCESS: the bridge answered an operation it does not implement')
    failures += 1
  } catch (error) {
    refusal = { code: error.code, detail: error.detail }
    say(args.refuse, 'refused code=' + error.code + ' detail=' + JSON.stringify(error.detail))
  }
  if (refusal === null || refusal.code !== 'reserved') failures += 1
}

say('done', failures === 0 ? 'all steps as described' : failures + ' step(s) failed')
socket.destroy()
process.exit(failures === 0 ? 0 : 1)
