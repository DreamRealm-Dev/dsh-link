#!/usr/bin/env node
/**
 * link-interconnect LAN check (M6): the allowlist path, measured with a REAL second process.
 *
 *   node scripts/link-interconnect-lan-check.mjs --prepare   # write the allowlist for this machine's LAN IP
 *   (restart DSH-LINK so the plugin applies it)
 *   node scripts/link-interconnect-lan-check.mjs --run       # spawn the echo peer bound to 0.0.0.0 and drive it
 *
 * --run starts packages/link-interconnect-sdk/examples/echo-service/main.mjs as a child process on
 * 0.0.0.0, reaches it at this machine's LAN address (not loopback), adds it by URL, asks, binds, reads
 * the provider catalog and removes it. The app must already have been restarted with the allowlist.
 * Exit 0 only when every reading held.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const ECHO = join(PROJECT, 'packages', 'link-interconnect-sdk', 'examples', 'echo-service', 'main.mjs')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const ORIGIN = flag('--origin', 'http://127.0.0.1:31761').replace(/\/+$/, '')
const HOME = flag('--home', join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home'))
const DATA = join(HOME, 'link-interconnect')
const ALLOWLIST = join(DATA, 'lan-allowlist.json')
const PORT = Number(flag('--port', '19610'))
const PREPARE = argv.includes('--prepare')

/** The first non-loopback IPv4 this machine has, or undefined. */
function lanAddress() {
  const wanted = flag('--lan-ip', undefined)
  if (wanted !== undefined) return wanted
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && entry.internal === false && entry.address.startsWith('169.254.') === false) return entry.address
    }
  }
  return undefined
}

const rows = []
const hold = (id, ok, detail) => rows.push({ id, ok: ok === true, detail: String(detail ?? '') })
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const getJson = async (url, init) => {
  const answer = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  const text = await answer.text()
  let json = null
  try { json = JSON.parse(text) } catch (error) { void error }
  return { status: answer.status, text, json }
}
const peersOp = (body) => getJson(ORIGIN + '/api/dsh-link-interconnect/peers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const state = async () => (await getJson(ORIGIN + '/api/dsh-link-interconnect/state')).json ?? {}

const lan = lanAddress()
if (lan === undefined) {
  console.error('lan-check: no non-loopback IPv4 interface found; pass --lan-ip <address>')
  process.exit(2)
}

if (PREPARE) {
  mkdirSync(DATA, { recursive: true })
  const current = (() => { try { return JSON.parse(readFileSync(ALLOWLIST, 'utf8')).hosts ?? [] } catch (error) { return [] } })()
  const hosts = [...new Set([...current, lan])]
  writeFileSync(ALLOWLIST, JSON.stringify({ version: 1, hosts }, null, 2) + '\n')
  console.log('lan-check: ' + ALLOWLIST + ' now names ' + JSON.stringify(hosts))
  console.log('lan-check: restart DSH-LINK, then run: node scripts/link-interconnect-lan-check.mjs --run')
  process.exit(0)
}

// ------------------------------------------------------------------ run
let child = null
try {
  const allowed = (() => { try { return (JSON.parse(readFileSync(ALLOWLIST, 'utf8')).hosts ?? []).map((host) => String(host)) } catch (error) { return [] } })()
  hold('M6.1 the LAN allowlist names this machine LAN address', allowed.includes(lan), ALLOWLIST + ' hosts=' + JSON.stringify(allowed))
  const peerUrl = 'http://' + lan + ':' + String(PORT)
  child = spawn(process.execPath, [ECHO], {
    env: Object.assign({}, process.env, { PORT: String(PORT), LINK_ECHO_HOST: '0.0.0.0' }),
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  })
  let reachable = null
  for (let attempt = 0; attempt < 40 && reachable === null; attempt += 1) {
    await sleep(250)
    try {
      const answer = await getJson(peerUrl + '/.well-known/link-interconnect.json')
      if (answer.status === 200) reachable = answer.json
    } catch (error) { void error }
  }
  hold('M6.2 a second process serves its declaration over the LAN address', reachable !== null && reachable.protocol === 'link-interconnect/1' && Array.isArray(reachable.capabilities), peerUrl + ' protocol=' + String(reachable?.protocol ?? 'none'))

  const foreign = await peersOp({ op: 'add', url: 'http://192.0.2.10:1' })
  hold('M6.3 a host outside the allowlist is refused by name', foreign.status === 400 && foreign.json?.error?.code === 'link/bad-request' && String(foreign.json.error.message).toLowerCase().includes('allowlist'), String(foreign.status) + ' ' + String(foreign.json?.error?.code) + ' ' + String(foreign.json?.error?.message ?? '').slice(0, 100))

  const addPromise = peersOp({ op: 'add', url: peerUrl }).catch((error) => ({ status: 0, json: { error: { message: String(error?.message ?? error) } } }))
  let question = null
  for (let attempt = 0; attempt < 60 && question === null; attempt += 1) {
    await sleep(200)
    const current = await state()
    const list = current.pendingConsent ?? []
    if (list.length > 0) question = list[0]
  }
  hold('M6.4 adding the LAN peer raises one consent question naming it', question !== null && String(question.title).includes('Echo Service'), question === null ? 'no question' : question.title)
  if (question !== null) await getJson(ORIGIN + '/api/dsh-link-interconnect/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: question.id, decision: 'granted' }) })
  const added = await addPromise
  const row = added.json?.result
  hold('M6.5 the LAN peer binds (tools + model channel)', added.json?.ok === true && row?.status === 'active' && Array.isArray(row?.tools) && row.tools.includes('echo.ping') && typeof row?.providerId === 'string', JSON.stringify(row ?? added.json))
  const peers = await getJson(ORIGIN + '/api/dsh-link-interconnect/peers')
  const lanRow = (peers.json?.result ?? []).find((entry) => entry.linkId === row?.linkId)
  hold('M6.6 its model catalog answers through the kernel provider', Array.isArray(lanRow?.models) && lanRow.models.includes('echo-1'), JSON.stringify(lanRow?.models ?? []))
  const bootLog = (() => { try { return readFileSync(join(HOME, 'boot.log'), 'utf8') } catch (error) { return '' } })()
  hold('M6.7 the kernel registered its tool and provider', bootLog.includes('tools registered from peer') && bootLog.includes('model provider'), 'boot.log')
  const removed = await peersOp({ op: 'remove', id: row?.linkId ?? '' })
  hold('M6.8 removing the LAN peer releases it', removed.json?.ok === true && removed.json?.result?.removed === true, JSON.stringify(removed.json ?? {}))
} finally {
  // Wait for the child to be reaped before the process exits: killing it and leaving the handle
  // open races Node's own teardown on Windows (measured: libuv async assertion after the last row).
  if (child !== null) {
    const exited = new Promise((done) => { child.once('exit', done); setTimeout(done, 1500) })
    try { child.kill() } catch (error) { void error }
    await exited
  }
}

const held = rows.filter((row) => row.ok).length
for (const row of rows) console.log((row.ok ? 'ok   ' : 'FAIL ') + row.id + (row.detail === '' ? '' : '  [' + row.detail + ']'))
console.log('---')
console.log('M6 LAN check: ' + held + '/' + rows.length + ' held, ' + (rows.length - held) + ' failed')
// exitCode, not process.exit(): the child's handle is still closing on Windows, and forcing the
// process out mid-teardown trips a libuv assertion (measured: async.c line 94, 0xC0000409). That
// would turn a green run into a non-zero exit even though every row held.
process.exitCode = rows.every((row) => row.ok) ? 0 : 1
