/**
 * Shared harness for the multi-device / relay / reclamation tests.
 *
 * Everything here drives the REAL host: real identity files, real trust stores,
 * real SPAKE2 pairing, real TCP over loopback, real filesystem and shell effects
 * on the peer. Nothing is mocked. Every port is 0 (ephemeral) and every data
 * directory is a fresh temp dir, so a run can never touch the user's real
 * `$DSH_HOME` or collide with a running DSH.
 *
 * Run the tests, not this file:
 *   node test/relay-three-host.mjs
 *   node test/relay-safety.mjs
 *   node test/multi-device.mjs
 *   node test/reclaim.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBridgeService } from '../lib/core/service.js'

/** The host logs to the console by default; these tests keep their stdout clean. */
export const silentLog = {
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLog
  },
}

/**
 * PASS/FAIL reporter with a hard watchdog.
 *
 * The watchdog is what turns "a promise never settled" into a visible CI
 * failure instead of a job that hangs until the runner gives up.
 */
export function createReport(title, { watchdogMs = 300_000 } = {}) {
  let checks = 0
  let failures = 0
  const watchdog = setTimeout(() => {
    console.error(`FAIL watchdog :: ${title} did not finish within ${Math.round(watchdogMs / 1000)} s`)
    process.exit(1)
  }, watchdogMs)

  function ok(name, condition, detail) {
    checks += 1
    if (condition === true) {
      console.log(`PASS ${name}`)
    } else {
      failures += 1
      console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
    }
    return condition === true
  }

  function eq(name, actual, expected) {
    const show = (v) => JSON.stringify(v)
    return ok(name, actual === expected, `expected ${show(expected)}, got ${show(actual)}`)
  }

  /** Structural equality for arrays/objects. */
  function eqJson(name, actual, expected) {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    return ok(name, a === b, `expected ${b}, got ${a}`)
  }

  /** Informational line: recorded, never counted, used to report raw evidence. */
  function note(text) {
    console.log(`NOTE ${text}`)
  }

  function section(text) {
    console.log(`\n-- ${text}`)
  }

  /** Run a thunk and require a rejection; returns the raw error message. */
  async function expectRejects(name, thunk, matcher) {
    try {
      const value = await thunk()
      ok(name, false, `it resolved instead of rejecting: ${JSON.stringify(value)?.slice(0, 200)}`)
      return null
    } catch (error) {
      const message = String(error?.message ?? error)
      const hit = matcher === undefined || matcher.test(message)
      ok(name, hit, `rejected with ${JSON.stringify(message)}`)
      return message
    }
  }

  /** Run a thunk and require it to RESOLVE, then optionally match the value. */
  async function expectResolves(name, thunk, matcher) {
    try {
      const value = await thunk()
      const text = JSON.stringify(value) ?? String(value)
      const hit = matcher === undefined || matcher.test(text)
      ok(name, hit, `resolved with ${text.slice(0, 300)}`)
      return value
    } catch (error) {
      ok(name, false, `rejected with ${JSON.stringify(String(error?.message ?? error))}`)
      return undefined
    }
  }

  /** PASS as soon as `predicate()` is truthy; FAIL with the timeout detail. */
  async function eventually(name, predicate, { timeoutMs = 8000, label } = {}) {
    try {
      await until(predicate, { timeoutMs, label: label ?? name })
      ok(name, true)
      return true
    } catch (error) {
      ok(name, false, error?.message ?? String(error))
      return false
    }
  }

  function finish() {
    clearTimeout(watchdog)
    console.log(`\n${checks - failures} passed, ${failures} failed`)
    if (failures > 0) process.exitCode = 1
    return failures
  }

  return {
    ok,
    eq,
    eqJson,
    note,
    section,
    expectRejects,
    expectResolves,
    eventually,
    finish,
    get checks() { return checks },
    get failures() { return failures },
  }
}

/** Poll until `predicate()` is truthy, or throw the labelled timeout. */
export async function until(predicate, { timeoutMs = 20_000, intervalMs = 50, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    last = await predicate()
    if (last) return last
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** One real bridge service with its own identity, trust store and temp dirs. */
export class Host {
  constructor(label, { role = 'bridge', config = {} } = {}) {
    this.label = label
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-lan-${label}-`))
    this.share = path.join(this.root, 'share')
    fs.mkdirSync(this.share, { recursive: true })
    this.shareReal = fs.realpathSync.native(this.share)
    this.service = createBridgeService({
      ctx: { get: () => undefined },
      config: { role, dataDir: path.join(this.root, 'data'), port: 0, ...config },
      log: silentLog,
    })
  }

  async start() {
    await this.service.start()
    return this
  }

  get snap() {
    return this.service.snapshot()
  }

  get id() {
    return this.snap.deviceId
  }

  get name() {
    return this.snap.deviceName
  }

  get port() {
    return this.snap.port
  }

  /** Write a file into this machine's shared root (the host side, not the peer). */
  put(name, content) {
    const target = path.join(this.share, name)
    fs.writeFileSync(target, content, 'utf8')
    return target
  }

  /**
   * Give this machine a distinct advertised name.
   *
   * Every Host here shares ONE `os.hostname()`, which is an artifact of running
   * three "machines" in one process; on a real LAN the names differ. Setting the
   * name is what makes `device` matching testable at all.
   */
  advertiseName(name) {
    this.service._internals.state.deviceName = name
    return this
  }

  read(name) {
    return fs.readFileSync(path.join(this.share, name), 'utf8')
  }

  exists(name) {
    return fs.existsSync(path.join(this.share, name))
  }

  /** The live Session object of one outbound link, as the tools use it. */
  sessionTo(peerDeviceId) {
    const link = this.service._internals.state.links.get(peerDeviceId)
    if (link === undefined || link.session === undefined) {
      throw new Error(`${this.label} has no live link to ${peerDeviceId}`)
    }
    return link.session
  }

  /** The internal link record, needed by the public `refreshDevices(linkRecord)`. */
  linkRecord(peerDeviceId) {
    return this.service._internals.state.links.get(peerDeviceId)
  }

  /** Every audit row this machine recorded (the ring holds the last 300). */
  auditRows() {
    return this.service.auditTail(300).rows
  }

  /** Executor-level audit rows: only `createExecutor` writes a `cap` field. */
  executorRows() {
    return this.auditRows().filter((row) => typeof row.cap === 'string')
  }

  async stop() {
    try {
      await this.service.stop()
    } catch {
      /* best effort */
    }
  }

  async cleanup() {
    // A shell command that outlived its caller (see relay-safety §8) still holds
    // this directory as its cwd, and Windows refuses to remove a live cwd. Retry
    // for a few seconds so one orphan does not leave a temp dir behind.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        fs.rmSync(this.root, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }
}

/** The trust store of a service, whether it is exposed as a value or a method. */
export function trustStoreOf(service) {
  return typeof service.trustStore === 'function' ? service.trustStore() : service.trustStore
}

/** Pending approval requests, tolerating the v1 alias during the transition. */
export function requestsOf(snapshot) {
  if (Array.isArray(snapshot?.requests)) return snapshot.requests
  return snapshot?.request === null || snapshot?.request === undefined ? [] : [snapshot.request]
}

/** This machine's own target row for one key, or undefined when unreachable. */
export function targetOf(service, key) {
  return service.listTargets().find((target) => target.key === key)
}

/** Wait for a target's row to satisfy `predicate`, and return that row. */
export async function waitTarget(service, key, predicate, { label = `target ${key}`, timeoutMs = 20_000 } = {}) {
  return until(
    () => {
      const target = targetOf(service, key)
      return target !== undefined && predicate(target) === true ? target : undefined
    },
    { label, timeoutMs },
  )
}

/**
 * Connect `from` to `to` over loopback with the real handshake and the real
 * approval path: `to` opens a pairing window, `from` submits the code, and the
 * bridge-side "user" answers through `decideRequest`. A peer that is already
 * pinned takes the `trusted` handshake instead and is never shown to the user,
 * so this settles on whichever of the two actually happens.
 */
export async function connectHosts({ from, to, grant, remember = true, decide = 'allow', timeoutMs = 30_000 }) {
  // §1: opening a pairing window is what makes a non-bridge posture listen, and
  // the listener starts asynchronously, so wait for a real bound port. The panel
  // forces a fresh window on every 开启配对窗口, so each pairing gets a new code.
  const code = to.service.openPairingWindow(true).code
  await until(() => to.snap.accepts === true && to.port > 0, {
    label: `${to.label} to accept inbound connections (accepts=${to.snap.accepts}, port=${to.port})`,
    timeoutMs: 10_000,
  })
  const port = to.port
  if (typeof port !== 'number' || port <= 0) throw new Error(`${to.label} is not listening (port ${port})`)
  const pending = from.service.connect({ host: '127.0.0.1', port, code })
  pending.catch(() => {
    /* surfaced by the await below; this only prevents an unhandled rejection */
  })
  let timer = null
  const asked = new Promise((resolve) => {
    const deadline = Date.now() + 15_000
    const tick = () => {
      const request = requestsOf(to.service.snapshot())[0]
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
  if (outcome.request !== undefined) {
    to.service.decideRequest({
      id: outcome.request.id,
      decision: decide,
      grant: grant ?? outcome.request.defaultGrant,
      remember,
    })
  }
  const record = await pending
  await until(() => to.service.snapshot().sessions.some((session) => session.deviceId === from.id), {
    label: `${to.label} to register the inbound session of ${from.label}`,
    timeoutMs,
  })
  return record
}

/** A grant shaped like the ones the panel sends, rooted in `host.share`. */
export function grantFor(host, extra = {}) {
  return {
    roots: [host.shareReal],
    cwdRoot: host.shareReal,
    write: true,
    shell: true,
    createDirs: true,
    relay: true,
    relayPeers: [],
    timeoutMs: 20_000,
    maxOutputBytes: 200_000,
    ...extra,
  }
}

/** Run a JS file with this very Node binary, portable across pwsh and /bin/sh. */
export function nodeCommand(scriptFile) {
  const quoted = `"${process.execPath}"`
  return process.platform === 'win32' ? `& ${quoted} ${scriptFile}` : `${quoted} ${scriptFile}`
}

/** A shell command that sleeps, for in-flight-disconnect tests. */
export function sleepCommand(ms) {
  return process.platform === 'win32' ? `Start-Sleep -Milliseconds ${ms}` : `sleep ${(ms / 1000).toFixed(1)}`
}

/** Shared temp root for one test file. */
export function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
