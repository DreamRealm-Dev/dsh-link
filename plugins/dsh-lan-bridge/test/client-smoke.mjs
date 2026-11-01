#!/usr/bin/env node
/**
 * Smoke test for `lib/client.js` — the browser half of the DSH LAN bridge.
 *
 * How the artifact is loaded
 * --------------------------
 * `lib/client.js` is a CLASSIC SCRIPT (not a module): at evaluation time it
 * calls `window.__ModuleLoader__.load({ id, factory })`, and the factory
 * receives `require` as a parameter. So this test:
 *
 *   1. builds `window` (with the injected `__DSH_LAN_BRIDGE_UI__` token) and a
 *      fake `__ModuleLoader__` that captures the registration,
 *   2. compiles the file with `node:vm` in a fresh context whose only injected
 *      globals are `window`, `fetch`, `setInterval`/`clearInterval` and a
 *      capturing `console` (a new VM realm supplies Object/Array/Promise/Date
 *      itself),
 *   3. calls the captured factory with a stub `require` that returns the stub
 *      React for "react" and THROWS for the optional primitives package, which
 *      proves the try/catch fallback path works.
 *
 * `node:vm` is used instead of `await import()` because the file is not an ES
 * module: importing it would depend on the enclosing package.json "type" and
 * would park the plugin in this process's module cache, whereas a fresh VM
 * context gives a hermetic global object per run.
 *
 * The stub React is a miniature renderer: `createElement` invokes function
 * components eagerly (so a render really executes the component tree) and the
 * hooks keep per-component state with real dependency comparison for
 * `useEffect`, which `flushEffects()` then runs. That is what lets the test
 * observe the 1500 ms poll interval, its cleanup, and the grant drafts.
 *
 * Zero dependencies. Run with:  node test/client-smoke.mjs
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const HERE = dirname(fileURLToPath(import.meta.url))
// SMOKE_CLIENT points the harness at another copy of the artifact; it exists so
// the suite can be negative-controlled (mutate a copy, expect FAILs).
const CLIENT_PATH = process.env.SMOKE_CLIENT
  ? resolve(process.env.SMOKE_CLIENT)
  : resolve(HERE, "..", "lib", "client.js")
const VERBOSE = process.env.SMOKE_VERBOSE === "1"

/* ------------------------------------------------------------------ *
 * Assertion harness
 * ------------------------------------------------------------------ */

let passes = 0
let failures = 0

async function check(name, fn) {
  try {
    const result = await fn()
    if (result === false) throw new Error("assertion returned false")
    passes += 1
    console.log("PASS " + name)
  } catch (err) {
    failures += 1
    const detail = err && err.message ? err.message : String(err)
    console.log("FAIL " + name + " :: " + detail)
  }
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || "value") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual))
  }
}

function ok(value, label) {
  if (!value) throw new Error(label || "expected a truthy value")
}

function deepEq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error((label || "value") + ": expected " + b + ", got " + a)
}

/* ------------------------------------------------------------------ *
 * Stub React: eager function components + per-component hook frames
 * ------------------------------------------------------------------ */

function createStubReact() {
  const frames = new Map()
  const stack = []
  const pending = []
  let depth = 0

  function currentFrame() {
    return stack.length === 0 ? null : stack[stack.length - 1]
  }

  // The hook slot for this call, or null when a component is invoked outside
  // createElement (a bare `Component(props)` call): hooks then degrade to
  // stateless values instead of throwing.
  function slotFor(kind) {
    const frame = currentFrame()
    if (frame === null) return null
    const index = frame.index
    frame.index += 1
    if (frame.slots[index] === undefined) frame.slots[index] = { kind: null }
    const slot = frame.slots[index]
    // A slot that changes hook kind between renders means the component called
    // its hooks conditionally or in a different order — the failure real React
    // reports as "rendered fewer hooks than expected".
    if (slot.kind !== null && slot.kind !== kind) {
      throw new Error("hook order changed at slot " + index + ": was " + slot.kind + ", now " + kind)
    }
    slot.kind = kind
    return slot
  }

  function useState(initial) {
    const slot = slotFor("state")
    if (slot === null) return [typeof initial === "function" ? initial() : initial, function () {}]
    if (slot.initialized !== true) {
      slot.value = typeof initial === "function" ? initial() : initial
      slot.initialized = true
    }
    return [slot.value, function (next) {
      slot.value = typeof next === "function" ? next(slot.value) : next
    }]
  }

  function useEffect(fn, deps) {
    const slot = slotFor("effect")
    if (slot === null) return undefined
    const previous = slot.deps
    const same = previous !== undefined && deps !== undefined &&
      previous.length === deps.length && deps.every((value, index) => Object.is(value, previous[index]))
    slot.deps = deps === undefined ? undefined : Array.from(deps)
    if (same) return undefined
    if (typeof slot.cleanup === "function") {
      pending.push(function () { slot.cleanup() })
    }
    pending.push(function () {
      const cleanup = fn()
      slot.cleanup = typeof cleanup === "function" ? cleanup : null
    })
    return undefined
  }

  function useMemo(fn) {
    slotFor("memo")
    return typeof fn === "function" ? fn() : undefined
  }

  function useRef(initial) {
    const slot = slotFor("ref")
    if (slot === null) return { current: initial }
    if (slot.initialized !== true) {
      slot.value = { current: initial }
      slot.initialized = true
    }
    return slot.value
  }

  function useCallback(fn) {
    slotFor("callback")
    return fn
  }

  function createElement(type, props, ...children) {
    const merged = Object.assign({}, props)
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
    if (typeof type === "function") {
      let frame = frames.get(type)
      if (frame === undefined) {
        frame = { index: 0, slots: [] }
        frames.set(type, frame)
      }
      frame.index = 0
      depth += 1
      if (depth > 64) {
        depth -= 1
        throw new Error("stub renderer recursed past 64 levels")
      }
      stack.push(frame)
      try {
        return type(merged)
      } finally {
        stack.pop()
        depth -= 1
      }
    }
    return {
      $$typeof: "stub.element",
      type: type,
      key: merged.key === undefined ? null : merged.key,
      props: merged,
    }
  }

  function flushEffects() {
    const queue = pending.splice(0, pending.length)
    for (const run of queue) run()
    return queue.length
  }

  return {
    createElement: createElement,
    useState: useState,
    useEffect: useEffect,
    useMemo: useMemo,
    useRef: useRef,
    useCallback: useCallback,
    Fragment: "Fragment",
    flushEffects: flushEffects,
  }
}

/* ------------------------------------------------------------------ *
 * Element-tree helpers (duck-typed: the tree mixes VM and host realms)
 * ------------------------------------------------------------------ */

function collectText(node, out) {
  const sink = out || []
  if (node === null || node === undefined || typeof node === "boolean") return sink
  if (typeof node === "string" || typeof node === "number") {
    sink.push(String(node))
    return sink
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, sink)
    return sink
  }
  if (typeof node === "object" && node.props !== undefined) collectText(node.props.children, sink)
  return sink
}

function textOf(node) {
  return collectText(node).join(" ")
}

function findAll(node, predicate, out) {
  const sink = out || []
  if (node === null || node === undefined || typeof node !== "object") return sink
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, sink)
    return sink
  }
  if (node.props !== undefined) {
    if (predicate(node)) sink.push(node)
    findAll(node.props.children, predicate, sink)
  }
  return sink
}

const byAction = (node, action) => findAll(node, (el) => el.props && el.props["data-bridge-action"] === action)
const byField = (node, field) => findAll(node, (el) => el.props && el.props["data-bridge-field"] === field)
const byRole = (node, role) => findAll(node, (el) => el.props && el.props["data-bridge-role"] === role)
const byDot = (node) => findAll(node, (el) => el.props && el.props["data-bridge-dot"] !== undefined)
const bySection = (node, id) => findAll(node, (el) => el.props && el.props["data-bridge-section"] === id)
const byTarget = (node, key) => findAll(node, (el) => el.props && el.props["data-bridge-target"] === key)
const byPeer = (node, id) => findAll(node, (el) => el.props && el.props["data-bridge-peer"] === id)

function click(el, label) {
  ok(el, (label || "element") + ": element not found")
  ok(typeof el.props.onClick === "function", (label || "element") + ": has no onClick (disabled?)")
  el.props.onClick()
}

/* ------------------------------------------------------------------ *
 * Host fixtures
 * ------------------------------------------------------------------ */

/**
 * The v2 host state, as `lib/core/service.js` `snapshot()` really answers it.
 *
 * The compatibility aliases (`connection`, `request`, `peersConnected`) are
 * still populated on purpose: an older panel bundle renders from them, so their
 * presence here is what keeps the "old half still draws something" promise
 * honest. Nothing in the assertions below reads them except where the alias is
 * the subject.
 */
const RELAY_SAS = "b66660"
const LINK_SAS = "171717"
const SESSION_SAS = "181818"

function richState() {
  return {
    role: "bridge",
    discoverable: true,
    accepts: true,
    port: 7331,
    deviceId: "dev-win-0f3a91c2",
    deviceName: "DESKTOP-7K2",
    os: "win32",
    arch: "x64",
    protocolVersion: "v1",
    protocolRange: { min: 1, max: 1 },
    hostBuild: "build-under-test",
    dataDir: "C:\\Users\\<user>\\.dsh\\lan-bridge",
    listenError: null,
    peers: [{
      deviceId: "dev-mac-77aa11bb",
      name: "MacBook",
      os: "darwin",
      arch: "arm64",
      host: "192.168.1.20",
      port: 7331,
      lastSeenMs: Date.now() - 2000,
      trusted: true,
      fingerprint: "AB:CD:EF",
      role: "bridge",
      accepts: true,
      relayDevices: 1,
      connected: true,
    }, {
      deviceId: "dev-linux-9c4412",
      name: "ThinkPad",
      os: "linux",
      arch: "x64",
      host: "192.168.1.31",
      port: 7331,
      lastSeenMs: Date.now() - 3000,
      trusted: false,
      fingerprint: "11:22:33",
      role: "agent",
      accepts: false,
      relayDevices: 0,
      connected: false,
    }],
    links: [{
      deviceId: "dev-mac-77aa11bb",
      name: "MacBook",
      host: "192.168.1.20",
      port: 7331,
      state: "connected",
      protocolVersion: "v1",
      sas: LINK_SAS,
      trust: "pinned",
      sinceMs: Date.now() - 65000,
      grant: { roots: ["H:\\mod"], write: true, shell: false, relay: true, relayPeers: [], timeoutMs: 30000, maxOutputBytes: 262144 },
      relaySupported: true,
      devices: [
        { key: "dev-mac-77aa11bb", deviceId: "dev-mac-77aa11bb", name: "MacBook", os: "darwin", arch: "arm64", kind: "direct", hops: 1, path: [], grant: { roots: ["/Users/<user>"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 } },
        { key: "dev-nas-5e5e5e", deviceId: "dev-nas-5e5e5e", name: "NAS", os: "linux", arch: "x64", kind: "relay", hops: 2, path: ["dev-mac-77aa11bb"], grant: { roots: ["/srv/share"], write: false, shell: false, timeoutMs: 15000, maxOutputBytes: 262144 } },
      ],
      reconnect: { attempts: 0, wanted: true },
      error: null,
    }, {
      deviceId: "dev-linux-9c4412",
      name: "ThinkPad",
      host: "192.168.1.31",
      port: 7331,
      state: "connecting",
      protocolVersion: "v1",
      sas: "",
      trust: "unknown",
      sinceMs: null,
      grant: null,
      relaySupported: false,
      devices: [],
      reconnect: { attempts: 2, wanted: true },
      error: null,
    }],
    sessions: [{
      deviceId: "dev-mac-77aa11bb",
      name: "MacBook",
      sinceMs: Date.now() - 65000,
      sas: SESSION_SAS,
      grant: { roots: ["H:\\mod"], write: true, shell: false, relay: true, relayPeers: [], timeoutMs: 30000, maxOutputBytes: 262144 },
      exposes: [
        { key: "dev-win-0f3a91c2", deviceId: "dev-win-0f3a91c2", name: "DESKTOP-7K2", kind: "local", hops: 0, grant: { roots: ["H:\\mod"], write: true, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 } },
        { key: "dev-nas-5e5e5e", deviceId: "dev-nas-5e5e5e", name: "NAS", kind: "relay", hops: 2, grant: { roots: ["/srv/share"], write: false, shell: false, timeoutMs: 15000, maxOutputBytes: 262144 } },
      ],
    }],
    targets: [
      { key: "dev-mac-77aa11bb", deviceId: "dev-mac-77aa11bb", name: "MacBook", os: "darwin", arch: "arm64", kind: "direct", hops: 1, path: [], grant: { roots: ["/Users/<user>"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 }, linkDeviceId: "dev-mac-77aa11bb" },
      { key: "dev-nas-5e5e5e", deviceId: "dev-nas-5e5e5e", name: "NAS", os: "linux", arch: "x64", kind: "relay", hops: 2, path: ["dev-mac-77aa11bb"], grant: { roots: ["/srv/share"], write: false, shell: false, timeoutMs: 15000, maxOutputBytes: 262144 }, linkDeviceId: "dev-mac-77aa11bb" },
    ],
    toolsAvailable: true,
    relay: { supported: true, maxHops: 3, reachable: 2 },
    // Shapes below mirror lib/core/service.js: `pairing.expiresAtMs` is a
    // deadline, `requests[].sas` is the safety code, and the audit ring arrives
    // newest-first. TWO requests at once is the case the toast must handle.
    pairing: { code: "428913", attemptsLeft: 5, expiresAtMs: Date.now() + 120000, openedAtMs: Date.now() },
    requests: [{
      id: "req-1",
      deviceId: "dev-linux-9c4412",
      name: "ThinkPad",
      os: "linux",
      sas: "418302",
      requestedCaps: ["fs.read", "fs.list", "shell.exec"],
      defaultGrant: { roots: ["/home/<user>/work"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
      reason: "pairing window open",
      createdAtMs: Date.now() - 1000,
      expiresAtMs: Date.now() + 110000,
    }, {
      id: "req-2",
      deviceId: "dev-nas-5e5e5e",
      name: "NAS",
      os: "linux",
      sas: "519420",
      requestedCaps: ["fs.read"],
      defaultGrant: { roots: ["/srv/share"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
      reason: "",
      createdAtMs: Date.now() - 500,
      expiresAtMs: Date.now() + 115000,
    }],
    // ---- compatibility aliases (see the doc comment above) ------------------
    connection: {
      state: "connected",
      peerDeviceId: "dev-mac-77aa11bb",
      peerName: "MacBook",
      sinceMs: Date.now() - 65000,
      rttMs: 3,
    },
    peersConnected: [{
      deviceId: "dev-mac-77aa11bb",
      name: "MacBook",
      sinceMs: Date.now() - 65000,
      sas: SESSION_SAS,
      grant: { roots: ["H:\\mod"], write: true, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
    }],
    request: {
      id: "req-1",
      deviceId: "dev-linux-9c4412",
      name: "ThinkPad",
      os: "linux",
      sas: "418302",
      requestedCaps: ["fs.read", "fs.list", "shell.exec"],
      defaultGrant: { roots: ["/home/<user>/work"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
    },
    audit: [
      { tsMs: Date.now() - 4000, peer: "dev-linux-9c4412", action: "shell.exec", allowed: false, detail: "denied: shell not granted" },
      { tsMs: Date.now() - 5000, peer: "dev-mac-77aa11bb", action: "fs.read", allowed: true, detail: "H:\\mod\\README.md" },
    ],
  }
}

/* ------------------------------------------------------------------ *
 * Sandbox
 * ------------------------------------------------------------------ */

const source = readFileSync(CLIENT_PATH, "utf8")
const stubReact = createStubReact()

const pluginLog = []
function capture(level) {
  return function () {
    const parts = []
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i]
      parts.push(value instanceof Error ? String(value.message) : String(value))
    }
    pluginLog.push(level + ": " + parts.join(" "))
  }
}

const loaderRegistrations = []
const requests = []
const intervals = []
const clearedIntervals = []
const TOKEN = "smoke-token-abc123"
let hostState = richState()
let failNextState = false
/** Per-path HTTP failure injection, e.g. { "/api/dsh-lan-bridge": 405 }. */
let failPaths = {}

// The first responses are held until the test has finished asserting the
// "no state yet" rendering, so those assertions stay deterministic.
let gateOpen = false
const heldResponses = []

const windowObject = {
  __ModuleLoader__: { load(spec) { loaderRegistrations.push(spec) } },
  __DSH_LAN_BRIDGE_UI__: { token: TOKEN },
}

// R339: the panel now reads the NOTES ledger through the kernel own routes (same origin), so the stub answers them the
// way the kernel does - a JSON body, not the panel RPC envelope.
// What the shell says about OFM. Default: nothing on this machine; a reading can stage a presence to see the offer.
let ofmPresence = { detected: false, signal: 'no OFM signal on this machine', port: null, has_key: false, data_dir: null }

const notesLedger = {
  notes: [{ id: "n-1", text: "把构建脚本固定到 python3.12", tags: ["ops"], state: "open", author: "user", at: Date.now() - 120000, seq: 4 }],
  counts: { notes: 1, open: 1, done: 0, deleted: 0, malformed: 0 },
}

function fetchStub(url, init) {
  // R376: the panel reads the OFM presence from the shell own route. The stub answers "no OFM here", which is what this
  // machine is, and the offer therefore stays absent unless a world stages one.
  if (String(url).indexOf('/__shell/ofm') === -1 && String(url).indexOf('/__shell/ofm/join') === -1 ? false : true) {
    if (String(url).indexOf('/join') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, base_url: 'http://127.0.0.1:18902', models: 3, detail: 'joined' }) })
    }
    const presence = ofmPresence
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(presence) })
  }
  if (String(url).indexOf('/api/dsh-link-notes/state') !== -1) {
    requests.push({ url: url, init: init, body: null })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(notesLedger) })
  }
  if (String(url).indexOf('/api/dsh-link-notes/add') !== -1) {
    const added = JSON.parse(String(init && init.body))
    requests.push({ url: url, init: init, body: added })
    notesLedger.notes.unshift({ id: "n-added", text: added.text, tags: [], state: "open", author: "user", at: Date.now(), seq: 5 })
    notesLedger.counts.notes = notesLedger.counts.notes + 1
    notesLedger.counts.open = notesLedger.counts.open + 1
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, seq: 5, notes: notesLedger.notes }) })
  }
  const body = JSON.parse(String(init && init.body))
  requests.push({ url: url, init: init, body: body })
  const injected = failPaths[url]
  const failing = injected !== undefined || (body.op === "state" && failNextState)
  const payload = {
    // A real host answers a refused op with HTTP 400 and the reason in the body,
    // exactly like this.
    ok: failing !== true,
    status: injected !== undefined ? injected : (failing ? 400 : 200),
    json() {
      if (failing) {
        return Promise.resolve({ ok: false, error: injected !== undefined ? "HTTP " + injected : "bad ui token" })
      }
      return Promise.resolve({ ok: true, value: body.op === "state" ? hostState : { accepted: body.op } })
    },
  }
  if (gateOpen) return Promise.resolve(payload)
  return new Promise((done) => { heldResponses.push(() => done(payload)) })
}

function releaseFetch() {
  gateOpen = true
  const held = heldResponses.splice(0, heldResponses.length)
  for (const release of held) release()
}

const sandbox = {
  window: windowObject,
  fetch: fetchStub,
  setInterval(fn, ms) {
    const id = intervals.length + 1
    intervals.push({ id: id, fn: fn, ms: ms, cleared: false })
    return id
  },
  clearInterval(id) {
    clearedIntervals.push(id)
    for (const timer of intervals) if (timer.id === id) timer.cleared = true
  },
  setTimeout() { return 0 },
  clearTimeout() {},
  console: {
    log: capture("log"), info: capture("info"), warn: capture("warn"),
    error: capture("error"), debug: capture("debug"),
  },
}

const context = vm.createContext(sandbox)
let loadError = null
try {
  new vm.Script(source, { filename: CLIENT_PATH }).runInContext(context)
} catch (err) {
  loadError = err
}

if (loadError !== null) {
  // An artifact that cannot even be evaluated makes every later assertion
  // meaningless, so it is reported as one FAIL instead of a stack trace.
  console.log("FAIL lib/client.js evaluates in the __ModuleLoader__ sandbox :: " + loadError.message)
  console.log("")
  console.log("0 passed, 1 failed")
  process.exit(1)
}

const requireCalls = []
function stubRequire(id) {
  requireCalls.push(id)
  if (id === "react") return stubReact
  throw new Error("Cannot find module '" + id + "'")
}

const settle = () => new Promise((done) => setImmediate(done))
const settleTwice = async () => { await settle(); await settle() }

/* ------------------------------------------------------------------ *
 * Phase A — source shape, factory, registration
 * ------------------------------------------------------------------ */

await check("source is a classic __ModuleLoader__ script with no ESM syntax", () => {
  ok(source.startsWith("window.__ModuleLoader__.load({"), "file must open with the loader call")
  deepEq(source.split("\n").filter((line) => /^\s*(import|export)\b/.test(line)), [], "top-level ESM statements")
})

await check("loader received exactly one registration with id dsh-lan-bridge", () => {
  eq(loaderRegistrations.length, 1, "registration count")
  eq(loaderRegistrations[0].id, "dsh-lan-bridge", "registration id")
  eq(typeof loaderRegistrations[0].factory, "function", "factory type")
})

const plugin = loaderRegistrations[0].factory(stubRequire)

await check("factory returns exports with apply() and an inject list containing slots", () => {
  eq(typeof plugin, "object", "exports type")
  eq(typeof plugin.apply, "function", "exports.apply")
  ok(Array.isArray(plugin.inject), "exports.inject must be an array")
  ok(plugin.inject.indexOf("slots") !== -1, "inject must contain 'slots'")
  ok(plugin.inject.indexOf("locale") !== -1, "inject must contain 'locale'")
})

await check("factory required react and survived the throwing primitives package", () => {
  ok(requireCalls.indexOf("react") !== -1, "react was required")
  ok(requireCalls.indexOf("@deepseek-ai/dsh-client-ui-primitives") !== -1, "primitives were probed")
  ok(pluginLog.every((line) => line.indexOf("client half ready") === -1 || line.indexOf("absent") !== -1),
    "the fallback path must have been taken")
})

const slotRegistrations = []
const injectedSlots = []
const effectRegistrations = []
const fakeCtx = {
  slots: {
    register(options, component) {
      const disposer = function () { disposer.called = true }
      slotRegistrations.push({ options: options, component: component, disposer: disposer })
      return disposer
    },
    // The real contract: the owning slot may mount later, so a third-party
    // bundle must go through `inject`, which runs the factory and returns a
    // fiber-owned disposer.
    inject(key, callback) {
      injectedSlots.push(key)
      const expansion = callback()
      const disposer = function () {
        disposer.called = true
        if (typeof expansion === "function") expansion()
      }
      return disposer
    },
  },
  locale: { getLocale() { return { active: "zh", locales: [], revision: 1 } } },
  effect(fn, label) {
    const disposer = fn()
    effectRegistrations.push({ label: label, disposer: disposer })
    return function () { if (typeof disposer === "function") disposer() }
  },
  get() { return undefined },
}

plugin.apply(fakeCtx)

await check("apply registers the footer, the panel and the notification toast, in order", () => {
  eq(slotRegistrations.length, 3, "slots.register call count")
  eq(injectedSlots.length, 3, "slots.inject call count")
  eq(injectedSlots[0], "sidebar.footer.action", "first injected slot key")
  eq(injectedSlots[1], "shell.overlay", "second injected slot key")
  eq(injectedSlots[2], "shell.overlay", "third injected slot key (the toast shares the overlay)")
  eq(slotRegistrations[0].options.name, "sidebar.footer.action", "first slot name")
  eq(slotRegistrations[0].options.id, "dsh-lan-bridge", "footer slot id")
  eq(slotRegistrations[0].options.order, 0.5, "footer slot order")
  eq(slotRegistrations[0].options.locale, "dsh-lan-bridge", "footer slot locale namespace")
  eq(slotRegistrations[1].options.name, "shell.overlay", "second slot name")
  eq(slotRegistrations[1].options.id, "dsh-lan-bridge-panel", "overlay slot id")
  eq(slotRegistrations[1].options.order, 50, "overlay slot order")
  eq(slotRegistrations[2].options.id, "dsh-lan-bridge-toast", "toast slot id")
  eq(slotRegistrations[2].options.order, 60, "toast renders above the panel")
  eq(effectRegistrations.length, 5, "ctx.effect call count (three slots + dispose hook + the panel contribution)")
  ok(effectRegistrations.every((entry) => typeof entry.label === "string" && entry.label.length > 0),
    "every ctx.effect call carries a label")
})

await check("both registrations returned disposers reachable from ctx.effect", () => {
  eq(typeof slotRegistrations[0].disposer, "function", "footer disposer")
  eq(typeof slotRegistrations[1].disposer, "function", "panel disposer")
  eq(typeof effectRegistrations[0].disposer, "function", "footer effect disposer")
  eq(typeof effectRegistrations[1].disposer, "function", "panel effect disposer")
})

const Footer = slotRegistrations[0].component
const Panel = slotRegistrations[1].component
const TOAST = slotRegistrations[2].component
const renderEl = (Component, props) => stubReact.createElement(Component, props)

await check("footer and panel are component functions", () => {
  eq(typeof Footer, "function", "footer component type")
  eq(typeof Panel, "function", "panel component type")
})

await check("footer renders in both rail and wide modes without throwing", () => {
  eq(typeof Footer({ wide: true }), "object", "direct wide call")
  eq(typeof Footer({ wide: false }), "object", "direct rail call")
  const wide = renderEl(Footer, { wide: true })
  const rail = renderEl(Footer, { wide: false })
  eq(typeof wide, "object", "wide render")
  eq(typeof rail, "object", "rail render")
  ok(textOf(wide).indexOf("Agent") !== -1, "wide footer shows the role label")
  ok(textOf(wide).indexOf("未连接") !== -1, "wide footer shows the idle state label")
  eq(textOf(rail).trim(), "", "the 56px rail is icon-only")
  eq(wide.props["data-bridge-footer"], "idle", "grey dot before any state is known")
})

await check("panel renders a hidden shell while closed", () => {
  const closed = renderEl(Panel, {})
  eq(typeof closed, "object", "panel render")
  eq(closed.props["data-bridge-panel"], "closed", "closed marker")
  eq(closed.props.style.display, "none", "closed panel is hidden")
})

const footerTree = renderEl(Footer, { wide: true })
click(findAll(footerTree, (el) => typeof el.props.onClick === "function")[0], "footer toggle")

await check("the footer click opens the panel", () => {
  const open = renderEl(Panel, {})
  eq(open.props["data-bridge-panel"], "open", "open marker")
  ok(textOf(open).indexOf("局域网桥接") !== -1, "panel shows its title")
})

stubReact.flushEffects()

await check("the open panel adds a 1500 ms poll beside the toast's background poll", () => {
  // Two pollers on purpose: the panel's fast one while it is open, and the
  // notification toast's slower one that must keep running with the panel shut.
  const panelTimers = intervals.filter((i) => i.ms === 1500)
  const backgroundTimers = intervals.filter((i) => i.ms === 3000)
  eq(panelTimers.length, 1, "open-panel poll count")
  eq(backgroundTimers.length, 1, "background (toast) poll count")
  eq(typeof panelTimers[0].fn, "function", "poll callback")
})

releaseFetch()
await settleTwice()

await check("polls POST { op: 'state' } to a relative path with the injected token header", () => {
  ok(requests.length >= 1, "at least one request")
  const first = requests[0]
  // The harness descriptor declares no carrier, so the fenced path comes first:
  // it is the only carrier that needs no secret, which is what makes the panel
  // work on a build whose index never carried our injected global.
  eq(first.url, "/api/dsh-lan-bridge", "request URL must be the relative fenced path")
  eq(first.init.method, "POST", "method")
  eq(first.init.headers["content-type"], "application/json", "content type")
  eq(first.init.headers["X-DSH-Bridge-UI"], TOKEN, "the injected token is still sent when present")
  deepEq(first.body, { op: "state", args: {} }, "state request body")
})

/* ------------------------------------------------------------------ *
 * Phase B — rendering with a real stubbed state
 * ------------------------------------------------------------------ */

const tree = renderEl(Panel, {})

await check("footer reports the connected peer once state has arrived", () => {
  const footer = renderEl(Footer, { wide: true })
  eq(footer.props["data-bridge-footer"], "connected", "green dot")
  ok(textOf(footer).indexOf("已连接") !== -1, "footer status text")
  ok(textOf(footer).indexOf("MacBook") !== -1, "footer names the peer")
  eq(textOf(renderEl(Footer, { wide: false })).trim(), "", "rail stays icon-only")
})

await check("panel renders the whole state without throwing", () => {
  eq(tree.props["data-bridge-panel"], "open", "panel is open")
  const text = textOf(tree)
  ok(text.indexOf("Agent 侧") !== -1, "the identity control still names the Agent side")
  ok(text.indexOf("桥接侧") !== -1, "the identity control still names the bridge side")
  ok(text.indexOf("MacBook") !== -1, "peer row")
  ok(text.indexOf("192.168.1.20:7331") !== -1, "peer address")
  ok(text.indexOf("428913") !== -1, "pairing code shown large")
  ok(text.indexOf("ThinkPad") !== -1, "peer row for the second device")
  ok(text.indexOf("dev-win-0f3a91c2") !== -1, "local device id")
  ok(text.indexOf("7331") !== -1, "local port")
  ok(text.indexOf("v1") !== -1, "protocol version")
  // Both builds are printed so a stale bundle can be spotted instead of guessed.
  ok(text.indexOf("客户端 ") !== -1, "the client build marker is rendered")
  ok(text.indexOf("build-under-test") !== -1, "the host build marker is rendered")
  ok(text.indexOf("fs.read") !== -1, "audit row")
  ok(text.indexOf("有效期") !== -1, "pairing deadline (expiresAtMs) is rendered")
  ok(text.indexOf(LINK_SAS) !== -1, "the per-link safety code is rendered")
  ok(text.indexOf("可调用的设备") !== -1, "the callable-device list is rendered")
  ok(text.indexOf("denied: shell not granted") < text.indexOf("H:\\mod\\README.md"),
    "the audit list keeps the host's newest-first order")
  eq(byDot(tree)[0].props["data-bridge-dot"], "connected", "dot state")
  ok(tree.props.style.position === "fixed" && tree.props.style.left === "12px" && tree.props.style.bottom === "52px",
    "panel is anchored above the sidebar foot")
  eq(tree.props.style.pointerEvents, "auto", "shell.overlay entry must opt into pointer events")
})

await check("the panel renders the frozen section ids, and both device lists as lists", () => {
  // The DOM contract this round: one stable id per section, plus the marker the
  // tests and any future deep link can select on.
  const ids = [
    "dsh-lan-bridge-identity",
    "dsh-lan-bridge-pairing",
    "dsh-lan-bridge-links",
    "dsh-lan-bridge-sessions",
    "dsh-lan-bridge-targets",
    "dsh-lan-bridge-peers",
    "dsh-lan-bridge-audit",
    "dsh-lan-bridge-device",
  ]
  for (const id of ids) {
    const found = bySection(tree, id)
    eq(found.length, 1, id + " section count")
    eq(found[0].props.id, id, id + " element id")
  }
  // Two links and one session must render as MULTIPLE rows, not one card.
  const links = findAll(tree, (el) => el.props && el.props["data-bridge-link"] !== undefined)
  eq(links.length, 2, "one row per link")
  deepEq(links.map((el) => el.props["data-bridge-link"]), ["dev-mac-77aa11bb", "dev-linux-9c4412"], "link row ids")
  eq(links[1].props["data-bridge-link-state"], "connecting", "the second link reports its own state")
  const sessions = findAll(tree, (el) => el.props && el.props["data-bridge-session"] !== undefined)
  eq(sessions.length, 1, "one row per session")
  eq(sessions[0].props["data-bridge-session"], "dev-mac-77aa11bb", "session row id")
  ok(textOf(bySection(tree, "dsh-lan-bridge-links")[0]).indexOf("本机驱动") !== -1, "the link list is labelled by direction")
  ok(textOf(bySection(tree, "dsh-lan-bridge-sessions")[0]).indexOf("驱动本机") !== -1, "the session list is labelled by direction")
})


await check("the device network board merges every row that names a device, and picking one opens its card", () => {
  // R314: the board is a FOLD of the same snapshot the lists read, so the reading is about two things at once: one
  // node per DEVICE (not per row - the fixture names dev-mac-77aa11bb as both a link and a session), and a card that
  // belongs to the node a person picked.
  const net = bySection(tree, "dsh-lan-bridge-net")[0]
  ok(net !== undefined, "the board is the panel's own section")
  eq(net.props.id, "dsh-lan-bridge-net", "board element id")
  const self = findAll(tree, (el) => el.props && el.props["data-bridge-net-self"] !== undefined)
  eq(self.length, 1, "this machine is drawn exactly once")
  const nodes = findAll(tree, (el) => el.props && el.props["data-bridge-net-node"] !== undefined)
  ok(nodes.length >= 3, "a node per device the rows name, not one per row (" + String(nodes.length) + ")")
  const ids = nodes.map((el) => el.props["data-bridge-net-node"])
  eq(ids.filter((id) => id === "dev-mac-77aa11bb").length, 1, "two rows naming one device draw ONE node")
  ok(ids.indexOf("dev-linux-9c4412") !== -1, "the second linked device is a node")
  ok(ids.indexOf("dev-nas-5e5e5e") !== -1, "the relayed target is a node")
  ok(nodes.every((el) => el.props["data-bridge-net-state"] !== undefined), "every node states its direction")
  const boardText = textOf(net)
  ok(boardText.indexOf("设备网") !== -1, "the board is titled")
  ok(boardText.indexOf("台设备") !== -1, "the board states how many devices it drew")
  click(nodes.filter((el) => el.props["data-bridge-net-node"] === "dev-nas-5e5e5e")[0], "relay node")
  const after = renderEl(Panel, {})
  const detail = findAll(after, (el) => el.props && el.props["data-bridge-net-detail"] !== undefined)
  eq(detail.length, 1, "picking a node opens exactly one card")
  eq(detail[0].props["data-bridge-net-detail"], "dev-nas-5e5e5e", "the card belongs to the picked device")
  ok(textOf(detail[0]).indexOf("dev-nas-5e5e5e") !== -1, "the card carries the full device id")
})

await check("a relayed target carries an unmissable 中转 badge naming the machine it goes through", () => {
  const nasRow = byTarget(tree, "dev-nas-5e5e5e")[0]
  ok(nasRow, "the relayed target has a row")
  eq(nasRow.props["data-bridge-target-kind"], "relay", "the row says it is relayed")
  const nasText = textOf(nasRow)
  ok(nasText.indexOf("中转") !== -1, "the 中转 badge is rendered")
  ok(nasText.indexOf("MacBook") !== -1, "the badge names the machine the call goes through (path[0])")
  ok(nasText.indexOf("2 跳") !== -1, "the hop count is stated")
  // The effective grant is the intersection of both hops, so the far side's
  // narrower limits (15 s / read-only) are what the row must show.
  ok(nasText.indexOf("生效授权") !== -1, "the effective grant is labelled as such")
  ok(nasText.indexOf("只读") !== -1, "the effective grant shows the narrower side")
  ok(nasText.indexOf("根目录 1") !== -1, "the far side's roots are the effective roots")

  // And the badge must be visually distinct: the warn token, not the shared chip.
  const badge = findAll(nasRow, (el) => el.props && el.props["data-bridge-chip"] === "relay")[0]
  ok(badge, "the relay badge is marked as such")
  ok(String(badge.props.style.color).indexOf("--dsw-alias-state-warn-primary") !== -1,
    "the relay badge asks for DSH's warn token")
  ok(String(badge.props.style.color).indexOf("--dsw-specific-bubble") === -1, "it is not just the muted chip fill")

  const direct = byTarget(tree, "dev-mac-77aa11bb")[0]
  eq(direct.props["data-bridge-target-kind"], "direct", "the direct target is not marked as relayed")
  eq(findAll(direct, (el) => el.props && el.props["data-bridge-chip"] === "relay").length, 0,
    "no relay badge on a directly reachable device")
})

await check("a peer that is not accepting is greyed out, disabled, and says why", () => {
  const refusing = byPeer(tree, "dev-linux-9c4412")[0]
  ok(refusing, "the refusing peer has a row")
  eq(refusing.props["data-bridge-accepts"], "0", "accepts=false is carried onto the row")
  eq(refusing.props.style.opacity, 0.55, "the row is greyed out")
  const why = byField(refusing, "peer-refusal")[0]
  ok(why, "the refusal reason is rendered")
  ok(textOf(why).indexOf("Agent 侧 · 未开启配对窗口") !== -1, "the reason names the role and the missing window")
  const connect = byAction(refusing, "connect")[0]
  ok(connect, "the connect control still exists (so the user can read why)")
  eq(connect.props.disabled, true, "but it is disabled")
  eq(connect.props.onClick, undefined, "and it cannot fire")

  const accepting = byPeer(tree, "dev-mac-77aa11bb")[0]
  eq(accepting.props["data-bridge-accepts"], "1", "an accepting peer is marked connectable")
  eq(byAction(accepting, "connect")[0].props.disabled, false, "its connect control works")
  eq(byPeer(tree, "dev-mac-77aa11bb")[0].props["data-bridge-trusted"], "1", "trusted state is reported")
  eq(byPeer(tree, "dev-linux-9c4412")[0].props["data-bridge-trusted"], "0", "untrusted state is reported")
})

await check("the identity control offers exactly two roles and reports accepts", () => {
  const cells = byRole(tree, "agent").concat(byRole(tree, "bridge"), byRole(tree, "both"))
  eq(cells.length, 2, "exactly two role cells (双侧 is gone)")
  deepEq(cells.map((el) => el.props["data-bridge-role"]), ["agent", "bridge"], "the two postures")
  eq(byRole(tree, "both").length, 0, "no 双侧 option")
  const identity = bySection(tree, "dsh-lan-bridge-identity")[0]
  const accepts = byField(identity, "accepts")[0]
  ok(accepts, "the accepts state is rendered")
  ok(textOf(accepts).indexOf("正在监听") !== -1, "accepts=true reads as listening")
  // `accepts` (listening) and `discoverable` (announcing) are two SEPARATE
  // facts, each with its own line — neither may be inferred from the other.
  const discover = byField(identity, "discoverable")[0]
  ok(discover, "the discoverable state has its own line")
  ok(textOf(discover).indexOf("正在广播本机") !== -1, "discoverable=true reads as announcing")
  ok(textOf(accepts).indexOf("广播") === -1, "the accepts line says nothing about announcing")
  ok(textOf(discover).indexOf("监听") === -1, "the discoverable line says nothing about listening")
  const role = byField(identity, "role")[0]
  ok(role, "the role group carries a field marker")
})

await check("accepts and discoverable are independent: not announcing but still reachable", async () => {
  // The contract's own example: discoverable:false / accepts:true — a machine
  // reachable at a handed-out address that simply is not advertising itself.
  hostState = Object.assign(richState(), { discoverable: false, accepts: true })
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const panel = renderEl(boot.components[1], {})
  const identity = bySection(panel, "dsh-lan-bridge-identity")[0]
  const acceptsText = textOf(byField(identity, "accepts")[0])
  const discoverText = textOf(byField(identity, "discoverable")[0])
  ok(acceptsText.indexOf("正在监听") !== -1, "it is listening")
  ok(discoverText.indexOf("未广播本机") !== -1, "and it is not announcing")
  ok(discoverText.indexOf("仍可连接") !== -1, "the discoverable line says a known address still connects")
  eq(byField(identity, "accepts")[0] === undefined, false, "accepts is still rendered")
  // The footer must not call this machine "not accepting" — it IS accepting.
  const footer = textOf(renderEl(boot.components[0], { wide: true }))
  ok(footer.indexOf("不接收连接") === -1, "the footer does not misreport an accepting machine")
})

await check("the relay capability is stated from relay.supported, and absence states nothing", () => {
  const targets = bySection(tree, "dsh-lan-bridge-targets")[0]
  const header = textOf(targets)
  ok(header.indexOf("中转 支持") !== -1, "relay.supported:true is rendered as a capability")
  ok(header.indexOf("上限 3 跳") !== -1, "maxHops is rendered")
  ok(header.indexOf("可达 2") !== -1, "reachable is rendered")
})

await check("a host that omits relay.supported makes no capability claim", async () => {
  hostState = Object.assign(richState(), { relay: { maxHops: 3, reachable: 2 } })
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const targets = textOf(bySection(renderEl(boot.components[1], {}), "dsh-lan-bridge-targets")[0])
  ok(targets.indexOf("中转 支持") === -1, "no 'supported' claim is invented")
  ok(targets.indexOf("中转 不支持") === -1, "and no 'unsupported' claim either")
  ok(targets.indexOf("上限 3 跳") !== -1, "the facts it does report are still shown")
})

await check("tool availability is stated, not left to be inferred", () => {
  const device = bySection(tree, "dsh-lan-bridge-device")[0]
  const tools = byField(device, "tools")[0]
  ok(tools, "the tool state is rendered")
  ok(textOf(tools).indexOf("已解锁") !== -1, "toolsAvailable:true reads as unlocked")
  // And on a host that does not report it, nothing is claimed.
  ok(textOf(device).indexOf("数据面工具未注册") === -1, "no contradictory claim")
})

/* ------------------------------------------------------------------ *
 * Phase C — every frozen op has a working call site
 * ------------------------------------------------------------------ */

function expectOp(op, args, label) {
  ok(requests.length > 0, (label || op) + ": no request was sent")
  const last = requests[requests.length - 1]
  eq(last.body.op, op, (label || op) + ": op")
  if (args !== undefined) deepEq(last.body.args, args, (label || op) + ": args")
}

await check("role switch sends role.set", async () => {
  const before = requests.length
  click(byRole(tree, "bridge")[0], "role=bridge")
  eq(requests.length, before + 1, "exactly one request")
  expectOp("role.set", { role: "bridge" })
  await settleTwice()
})



await check("a device card says WHAT the device offers and can really self-test the link (R321)", async () => {
  // A number a person cannot act on is a dashboard. The card under a device now names the targets the device exposes
  // (direct and relayed, with hop counts) and carries the one action that PROVES the link: link.selftest, which the
  // host performs end to end (write + read a marker file, run one shell) instead of drawing a green dot.
  hostState = richState()
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const tree = renderEl(boot.components[1], {})
  const mac = findAll(tree, (el) => el.props && el.props["data-bridge-net-node"] === "dev-mac-77aa11bb")[0]
  ok(mac !== undefined, "the MacBook node is on the board")
  click(mac, "device node")
  const after = renderEl(boot.components[1], {})
  const detail = findAll(after, (el) => el.props && el.props["data-bridge-net-detail"] !== undefined)[0]
  ok(detail !== undefined, "the card opened for the picked device: " + textOf(after).slice(0, 200))
  const callables = findAll(after, (el) => el.props && el.props["data-bridge-net-callables"] !== undefined)[0]
  ok(callables !== undefined, "the card lists what the device offers: " + textOf(detail === undefined ? after : detail).slice(0, 240))
  const text = textOf(callables)
  ok(text.indexOf("MacBook") !== -1, "the direct target is named: " + text.slice(0, 140))
  ok(text.indexOf("NAS") !== -1, "the relayed target is named too")
  ok(text.indexOf("2") !== -1, "and the relay hop count is stated")
  const selftest = byAction(after, "net-selftest")[0]
  ok(selftest !== undefined, "the card carries a REAL self-test action, not only a number")
  // R325: and the read the phone actually implements, as its own action.
  const listAction = byAction(after, "net-list")[0]
  ok(listAction !== undefined, "and a list-a-directory action next to it")
  // R333: and the action that turns the device INTO an input - the phone records, the host reads the artifact.
  const captureAction = byAction(after, "net-capture")[0]
  ok(captureAction !== undefined, "and a record-audio action, which is the phone being a microphone")
  eq(captureAction.props.disabled, false, "which is pressable while the panel is idle")
  eq(listAction.props.disabled, false, "which is pressable while the panel is idle")
})
await check("a MANUAL attempt that is waiting for its code keeps 提交配对码 usable (R320c)", async () => {
  // The flow this locks: type host:port, press 连接, learn a code is needed, type the code, press 提交配对码. Before
  // R320c the panel disabled that button unless snapshot.links held a non-connected link - and a manual attempt that
  // only lacked the code never lands there - so the second half of the flow could not be pressed at all. Measured
  // against the real phone: the button reported "submit-disabled" while the phone sat waiting for its code.
  hostState = Object.assign(richState(), { links: [], awaitingCode: { host: "127.0.0.1", port: 47600 } })
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const waiting = renderEl(boot.components[1], {})
  const submit = byAction(waiting, "pair-submit")[0]
  ok(submit !== undefined, "the submit button is on screen")
  eq(submit.props.disabled, false, "and it is ENABLED with no pending link, because a manual attempt is waiting")
  const hint = textOf(bySection(waiting, "dsh-lan-bridge-pairing")[0])
  ok(hint.indexOf("127.0.0.1:47600") !== -1, "the hint names the address the code goes to: " + hint.slice(0, 120))
  // The control: with neither a pending link nor a remembered target the button must stay disabled, or the panel
  // would offer a control that cannot succeed.
  hostState = Object.assign(richState(), { links: [], awaitingCode: null })
  const boot2 = bootPlugin()
  const timer2 = openPanel(boot2)
  timer2.fn()
  await settleTwice()
  const idle = renderEl(boot2.components[1], {})
  eq(byAction(idle, "pair-submit")[0].props.disabled, true, "and it stays disabled when nothing is in flight")
})
await check("rescan sends discover.probe", async () => {
  click(byAction(tree, "probe")[0], "probe")
  expectOp("discover.probe", {})
  await settleTwice()
})

await check("device row connect sends connect { deviceId }", async () => {
  click(byAction(tree, "connect")[0], "connect")
  expectOp("connect", { deviceId: "dev-mac-77aa11bb" })
  await settleTwice()
})

await check("manual address validation rejects a bad value without sending anything", async () => {
  const before = requests.length
  byField(tree, "manual-address")[0].props.onChange({ target: { value: "not-an-address" } })
  const fresh = renderEl(Panel, {})
  click(byAction(fresh, "manual-connect")[0], "manual connect")
  eq(requests.length, before, "no request for an invalid address")
  ok(textOf(renderEl(Panel, {})).indexOf("host:port 形式") !== -1, "validation message is rendered")
  await settleTwice()
})

await check("manual address sends connect { host, port }", async () => {
  const field = byField(renderEl(Panel, {}), "manual-address")[0]
  field.props.onChange({ target: { value: "127.0.0.1:7331" } })
  click(byAction(renderEl(Panel, {}), "manual-connect")[0], "manual connect")
  expectOp("connect", { host: "127.0.0.1", port: 7331 })
  await settleTwice()
})

await check("session disconnect sends peers.disconnect { deviceId }", async () => {
  // The session list owns the inbound direction, so its 断开 maps to
  // `peers.disconnect`; the link list's 断开 is the outbound `disconnect`.
  click(byAction(tree, "session-disconnect")[0], "session disconnect")
  expectOp("peers.disconnect", { deviceId: "dev-mac-77aa11bb" })
  await settleTwice()
})

await check("a link's 断开 sends disconnect { deviceId } for that one device", async () => {
  click(byAction(tree, "link-disconnect")[0], "link disconnect")
  expectOp("disconnect", { deviceId: "dev-mac-77aa11bb" })
  await settleTwice()
})

await check("全部断开 sends disconnect with no deviceId (every link)", async () => {
  click(byAction(tree, "disconnect-all")[0], "disconnect all")
  expectOp("disconnect", {})
  await settleTwice()
})

await check("submitting a 6-digit code sends pair.submit", async () => {
  const field = byField(renderEl(Panel, {}), "pair-code")[0]
  field.props.onChange({ target: { value: "4289 13x" } })
  const fresh = renderEl(Panel, {})
  eq(byField(fresh, "pair-code")[0].props.value, "428913", "input keeps six digits only")
  click(byAction(fresh, "pair-submit")[0], "pair submit")
  expectOp("pair.submit", { code: "428913" })
  await settleTwice()
})

await check("discoverable toggle sends discover.set", async () => {
  click(byAction(tree, "toggle-discover")[0], "toggle discoverable")
  expectOp("discover.set", { enabled: false })
  await settleTwice()
})

await check("the toast's 同意 sends approve with the request's default grant", async () => {
  // The per-request grant editor now lives in the toast, which owns the
  // decision; the panel only edits per-DEVICE grants (links and sessions).
  const toast = renderEl(TOAST, {})
  ok(textOf(toast).indexOf("将授予 ") !== -1, "the grant is stated before the decision")
  click(byAction(toast, "toast-allow")[0], "allow")
  const last = requests[requests.length - 1]
  eq(last.body.op, "approve", "同意 approves from the toast")
  eq(last.body.args.id, "req-1", "the request id is carried")
  eq(last.body.args.decision, "allow", "decision")
  eq(last.body.args.remember, true, "remembered by default")
  deepEq(last.body.args.grant, {
    roots: ["/home/<user>/work"],
    write: false,
    shell: false,
    relay: true,
    relayPeers: [],
    timeoutMs: 30000,
    maxOutputBytes: 262144,
  }, "the request's defaultGrant is used untouched")
  await settleTwice()
})

await check("deny sends approve with decision 'deny'", async () => {
  const fresh = renderEl(TOAST, {})
  click(byAction(fresh, "toast-deny")[0], "deny")
  const last = requests[requests.length - 1]
  eq(last.body.op, "approve", "deny goes through approve")
  eq(last.body.args.id, "req-1", "the request id is carried")
  eq(last.body.args.decision, "deny", "decision")
  await settleTwice()
})

await check("a link's grant editor saves through grant.set with the relay fields", async () => {
  const fresh = renderEl(Panel, {})
  click(byAction(fresh, "link-edit")[0], "open the MacBook link's grant editor")
  const editing = renderEl(Panel, {})
  const linkRoots = bySection(editing, "dsh-lan-bridge-links")[0]
  ok(byField(linkRoots, "roots")[0], "the link grant editor opened")
  byField(linkRoots, "roots")[0].props.onChange({ target: { value: "D:\\shared" } })
  byField(renderEl(Panel, {}), "relay")[0].props.onChange({ target: { checked: false } })
  click(byAction(renderEl(Panel, {}), "link-save")[0], "save grant")
  expectOp("grant.set", {
    deviceId: "dev-mac-77aa11bb",
    grant: {
      roots: ["D:\\shared"], write: true, shell: false,
      relay: false, relayPeers: [], timeoutMs: 30000, maxOutputBytes: 262144,
    },
  })
  await settleTwice()
})

await check("a session's grant editor saves through grant.set, and revoke/disconnect send their ops", async () => {
  const fresh = renderEl(Panel, {})
  click(byAction(fresh, "session-edit")[0], "open the session's grant editor")
  const editing = renderEl(Panel, {})
  const sessionBlock = bySection(editing, "dsh-lan-bridge-sessions")[0]
  ok(byField(sessionBlock, "roots")[0], "the session grant editor opened")
  byField(sessionBlock, "roots")[0].props.onChange({ target: { value: "E:\\inbound" } })
  // Re-read the tree: every control's handler closes over the draft as it was
  // rendered, so the shell checkbox must come from the render AFTER the roots
  // edit or its patch would rebase onto the pre-edit draft.
  const afterRoots = bySection(renderEl(Panel, {}), "dsh-lan-bridge-sessions")[0]
  const shells = byField(afterRoots, "shell")
  shells[0].props.onChange({ target: { checked: true } })
  click(byAction(renderEl(Panel, {}), "session-save")[0], "save the session grant")
  expectOp("grant.set", {
    deviceId: "dev-mac-77aa11bb",
    grant: {
      roots: ["E:\\inbound"], write: true, shell: true,
      relay: true, relayPeers: [], timeoutMs: 30000, maxOutputBytes: 262144,
    },
  })
  await settleTwice()

  // Collapse the editor first: while it is open, 撤销授权 / 断开 are replaced by
  // 保存 / 取消 (a save in flight must not race a revoke).
  click(byAction(renderEl(Panel, {}), "session-edit")[0], "collapse the session editor")
  click(byAction(renderEl(Panel, {}), "session-revoke")[0], "revoke")
  expectOp("grant.revoke", { deviceId: "dev-mac-77aa11bb" })
  await settleTwice()
  click(byAction(renderEl(Panel, {}), "session-disconnect")[0], "peer disconnect")
  expectOp("peers.disconnect", { deviceId: "dev-mac-77aa11bb" })
  await settleTwice()
})

await check("audit refresh sends audit.tail and adopts the returned rows", async () => {
  click(byAction(tree, "audit-refresh")[0], "audit refresh")
  expectOp("audit.tail", { limit: 20 })
  await settleTwice()
  ok(textOf(renderEl(Panel, {})).indexOf("暂无审计记录") !== -1, "the returned (empty) tail replaced the snapshot rows")
})

/* ------------------------------------------------------------------ *
 * Phase D — dot transitions, error path, polling teardown
 * ------------------------------------------------------------------ */

await check("the dot turns amber while connecting and red when a link reports an error", async () => {
  // The multi-device surface: state comes from `links[]`, and one failing link
  // must colour the footer red even while another one is happily connected.
  hostState = Object.assign(richState(), {
    links: [{ deviceId: "dev-mac-77aa11bb", name: "MacBook", state: "connecting", sinceMs: null, error: null }],
  })
  intervals[0].fn()
  await settleTwice()
  eq(renderEl(Footer, { wide: true }).props["data-bridge-footer"], "busy", "connecting dot")
  hostState = Object.assign(richState(), {
    links: [
      { deviceId: "dev-mac-77aa11bb", name: "MacBook", state: "connected", sinceMs: Date.now() - 1000, error: null },
      { deviceId: "dev-linux-9c4412", name: "ThinkPad", state: "error", sinceMs: null, error: "handshake failed" },
    ],
  })
  intervals[0].fn()
  await settleTwice()
  eq(renderEl(Footer, { wide: true }).props["data-bridge-footer"], "error", "error dot")
  ok(textOf(renderEl(Panel, {})).indexOf("handshake failed") !== -1, "the failing link's own error is shown in its row")
})

await check("a refused op (HTTP 400 with an error body) surfaces the host message", async () => {
  failNextState = true
  intervals[0].fn()
  await settleTwice()
  failNextState = false
  ok(textOf(renderEl(Panel, {})).indexOf("bad ui token") !== -1, "the body error text wins over the bare status")
})

await check("a listen failure reported by the host is surfaced in the device card", async () => {
  hostState = Object.assign(richState(), { listenError: "EADDRINUSE: address already in use 0.0.0.0:7331" })
  intervals[0].fn()
  await settleTwice()
  const text = textOf(renderEl(Panel, {}))
  ok(text.indexOf("监听失败") !== -1, "the failure is labelled")
  ok(text.indexOf("EADDRINUSE") !== -1, "the reason is shown")
})

await check("panel survives a hostile state payload without throwing", async () => {
  hostState = {
    role: "nonsense",
    discoverable: "yes",
    port: null,
    deviceId: 42,
    peers: [null, "x", { deviceId: null, name: 7, os: {}, arch: [], lastSeenMs: -1 }, {}],
    connection: { state: "weird", peerName: null, rttMs: "abc", sinceMs: 0, error: 123 },
    links: [null, "x", { deviceId: null, name: 7, state: 9, sinceMs: {}, devices: [null, 4], grant: "nope", reconnect: 3 }],
    sessions: [null, { deviceId: 0, name: false, sinceMs: "soon", grant: "nope", exposes: [null, 1] }],
    targets: [null, "x", { key: null, name: [], kind: "relay", hops: "many", path: [null, 2], grant: null }],
    relay: "not-an-object",
    requests: [null, "x", { id: null, name: [], deviceId: {}, sas: 17, defaultGrant: null, expiresAtMs: {} }],
    pairing: { code: null, role: 5, attemptsLeft: "x", expiresInMs: {} },
    request: { id: null, name: [], deviceId: {}, requestedCaps: [1, null, "fs.read"], defaultGrant: null },
    peersConnected: [null, { deviceId: 0, name: false, sinceMs: "soon", grant: "nope" }],
    audit: "not-an-array",
  }
  intervals[0].fn()
  await settleTwice()
  const agentOnly = renderEl(Panel, {})
  eq(agentOnly.props["data-bridge-panel"], "open", "panel still renders")
  ok(textOf(agentOnly).length > 0, "panel produced text")
  // The unroutable role plus a false `accepts` must produce the pairing-window
  // affordance rather than an empty section.
  ok(textOf(agentOnly).indexOf("开启配对窗口") !== -1, "a machine that accepts nothing offers the window")
  hostState = Object.assign(hostState, { role: "bridge", accepts: true })
  intervals[0].fn()
  await settleTwice()
  const both = renderEl(Panel, {})
  eq(both.props["data-bridge-panel"], "open", "panel still renders with the bridge posture")
  ok(textOf(both).indexOf("桥接侧") !== -1, "the identity control rendered")
  ok(textOf(both).indexOf("正在监听") !== -1, "accepts=true is reported")
})

await check("closing the panel clears its own poll but keeps the background one alive", async () => {
  click(byAction(renderEl(Panel, {}), "close")[0], "close")
  eq(renderEl(Panel, {}).props["data-bridge-panel"], "closed", "panel closed")
  stubReact.flushEffects()
  const panelTimer = intervals.filter((i) => i.ms === 1500)[0]
  const backgroundTimer = intervals.filter((i) => i.ms === 3000)[0]
  eq(panelTimer.cleared, true, "the panel's own interval was cleared")
  ok(clearedIntervals.indexOf(panelTimer.id) !== -1, "clearInterval received the panel timer id")
  eq(backgroundTimer.cleared, false, "the toast's background interval keeps running (a request must still find the user)")
  const before = requests.length
  panelTimer.fn()
  eq(requests.length, before, "a stopped panel poll sends nothing")
})

await check("disposing the context closes the panel and releases both slots", () => {
  effectRegistrations[2].disposer()
  eq(renderEl(Panel, {}).props["data-bridge-panel"], "closed", "panel closed on dispose")
  effectRegistrations[0].disposer()
  effectRegistrations[1].disposer()
  eq(slotRegistrations[0].disposer.called, true, "footer slot released")
  eq(slotRegistrations[1].disposer.called, true, "panel slot released")
})

await check("an en* locale switches every label to English", () => {
  // A second factory call is a fresh module instance with its own store, so
  // this cannot disturb the Chinese instance exercised above.
  const pluginEn = loaderRegistrations[0].factory(stubRequire)
  const components = []
  const ctxEn = {
    slots: {
      register(options, component) { components.push(component); return function () {} },
      inject(key, callback) { return callback() },
    },
    locale: { getLocale() { return { active: "en-US", locales: [], revision: 1 } } },
    effect(fn) { fn(); return function () {} },
  }
  pluginEn.apply(ctxEn)
  const footerEn = renderEl(components[0], { wide: true })
  ok(textOf(footerEn).indexOf("Agent") !== -1, "role label")
  ok(textOf(footerEn).indexOf("not connected") !== -1, "state label is English")
  click(findAll(footerEn, (el) => typeof el.props.onClick === "function")[0], "english footer toggle")
  const panelEn = renderEl(components[1], {})
  const text = textOf(panelEn)
  ok(text.indexOf("LAN bridge") !== -1, "panel title is English")
  ok(text.indexOf("No devices found") !== -1, "empty state is English")
  ok(text.indexOf("未连接") === -1 && text.indexOf("局域网桥接") === -1, "no Chinese leaked through")
})

/* ------------------------------------------------------------------ *
 * Phase E — carrier selection and the token audit
 *
 * The three cases below were added with the DSH-native restyle. They pin the
 * two things a restyle must not break — which carrier a poll uses, and the fact
 * that a failed probe is invisible to the user — plus the rule that every
 * colour in a rendered style object is a real `--dsw-*` theme token.
 * ------------------------------------------------------------------ */

// Every string value of every rendered style object in a tree.
function styleStrings(node, out) {
  const sink = out || []
  const elements = findAll(node, (el) => el.props && el.props.style !== undefined)
  for (const el of elements) {
    const style = el.props.style
    if (style === null || typeof style !== "object") continue
    for (const key of Object.keys(style)) {
      const value = style[key]
      if (typeof value === "string") sink.push(value)
    }
  }
  return sink
}

// Boot one more instance of the plugin with its own module scope (and therefore
// its own store and its own sticky carrier choice) and a recording context.
function bootPlugin(options) {
  const opts = options || {}
  const components = []
  const connectionCalls = []
  const connection = typeof opts.connection === "function" ? opts.connection(connectionCalls) : undefined
  const ctx = {
    slots: {
      register(slotOptions, component) { components.push(component); return function () {} },
      inject(key, callback) { return callback() },
    },
    locale: { getLocale() { return { active: "zh", locales: [], revision: 1 } } },
    effect(fn) { const disposer = fn(); return function () { if (typeof disposer === "function") disposer() } },
    get(name) { return name === "connection" ? connection : undefined },
    connection: connection,
  }
  const instance = loaderRegistrations[0].factory(stubRequire)
  instance.apply(ctx)
  return { components: components, connectionCalls: connectionCalls, ctx: ctx, connection: connection }
}

function openPanel(boot) {
  const footer = renderEl(boot.components[0], { wide: true })
  click(findAll(footer, (el) => typeof el.props.onClick === "function")[0], "footer toggle")
  renderEl(boot.components[1], {})
  stubReact.flushEffects()
  return intervals[intervals.length - 1]
}

function rejectingConnection(calls) {
  return {
    rpc: {
      call(channel, op) {
        calls.push({ channel: channel, op: op })
        const err = new Error("HTTP 405: POST /dsh-lan-bridge is not bound on this host")
        err.status = 405
        return Promise.reject(err)
      },
    },
  }
}

await check("a declared 'route' carrier polls through fetch and never touches ctx.connection.rpc", async () => {
  const savedDescriptor = windowObject.__DSH_LAN_BRIDGE_UI__
  windowObject.__DSH_LAN_BRIDGE_UI__ = { token: TOKEN, carrier: "route" }
  hostState = richState()
  try {
    const boot = bootPlugin({ connection: rejectingConnection })
    // The seed poll in apply() runs before any render: it must already be a
    // route request, so the probe must not have happened once.
    eq(boot.connectionCalls.length, 0, "connection.rpc calls during the seed poll")
    const before = requests.length
    const timer = openPanel(boot)
    timer.fn()
    await settleTwice()
    const sent = requests.slice(before)
    ok(sent.length >= 1, "the open panel polled at all")
    // R339: the panel now talks to TWO same-origin routes - its own op route and the notes ledger - and the point of this
    // reading is that it never falls back to ctx.connection.rpc. So the poll check is scoped to the panel route, and the
    // notes read is asserted separately instead of being lumped in.
    const polls = sent.filter((r) => String(r.url).indexOf("/dsh-lan-bridge/api") !== -1)
    const noteReads = sent.filter((r) => String(r.url).indexOf("/api/dsh-link-notes/state") !== -1)
    ok(polls.length >= 1, "the open panel polled its own route")
    ok(polls.every((r) => r.body !== null && r.body.op === "state"), "every poll to the panel route asked for state")
    ok(noteReads.length >= 1, "and it read the notes ledger once through the kernel own route")
    ok(sent.every((r) => String(r.url).indexOf("/dsh-lan-bridge/api") !== -1 || String(r.url).indexOf("/api/dsh-link-notes/") !== -1),
      "nothing went anywhere except those two same-origin routes")
    eq(polls[0].init.headers["X-DSH-Bridge-UI"], TOKEN, "the route poll carries the injected token (the notes read goes first and needs none)")
    eq(boot.connectionCalls.length, 0, "ctx.connection.rpc was never called")
    eq(renderEl(boot.components[0], { wide: true }).props["data-bridge-footer"], "connected", "the route answered")
  } finally {
    windowObject.__DSH_LAN_BRIDGE_UI__ = savedDescriptor
  }
})

await check("with the host silent about the carrier, the FENCED route is tried first and needs no token", async () => {
  // This is the Mac case: a desktop build served an index with no injected
  // global at all. The fenced path must be the one that answers, because it is
  // authenticated by DSH's own fence rather than by a secret we must deliver.
  const savedDescriptor = windowObject.__DSH_LAN_BRIDGE_UI__
  delete windowObject.__DSH_LAN_BRIDGE_UI__
  hostState = richState()
  try {
    const boot = bootPlugin({ connection: rejectingConnection })
    await settleTwice()
    ok(requests.length >= 1, "a poll was sent")
    eq(requests[0].url, "/api/dsh-lan-bridge", "the fenced path is tried first when the host is silent")
    eq(boot.connectionCalls.length, 0, "ctx.connection.rpc is not probed before the fenced route")
    const timer = openPanel(boot)
    timer.fn()
    await settleTwice()
    eq(renderEl(boot.components[0], { wide: true }).props["data-bridge-footer"], "connected", "the fence answered")
    const panel = textOf(renderEl(boot.components[1], {}))
    ok(panel.indexOf("MacBook") !== -1, "the panel shows the state the fenced route delivered")
    ok(panel.indexOf("token") === -1, "no token complaint anywhere in the panel")
  } finally {
    windowObject.__DSH_LAN_BRIDGE_UI__ = savedDescriptor
  }
})

await check("when the first carrier fails, the chain falls through and the panel never sees the failure", async () => {
  // Fail the fenced carrier with the exact status a static fallback answers and
  // prove the chain moves to the token route instead of surfacing a transport error.
  const savedDescriptor = windowObject.__DSH_LAN_BRIDGE_UI__
  windowObject.__DSH_LAN_BRIDGE_UI__ = { token: TOKEN, carrier: "route" }
  hostState = richState()
  failPaths = { "/api/dsh-lan-bridge": 405 }
  try {
    const boot = bootPlugin({ connection: rejectingConnection })
    const timer = openPanel(boot)
    timer.fn()
    await settleTwice()
    const sent = requests.map((r) => r.url)
    ok(sent.some((u) => u === "/api/dsh-lan-bridge"), "the declared route was not the only carrier tried")
    const panel = textOf(renderEl(boot.components[1], {}))
    ok(panel.indexOf("405") === -1, "the transport status never reached the panel")
    ok(panel.indexOf("无法连接") === -1, "no transport error banner was surfaced")
    eq(renderEl(boot.components[0], { wide: true }).props["data-bridge-footer"], "connected",
      "a later carrier still delivered state")
    ok(panel.indexOf("MacBook") !== -1, "the panel is showing the state a fallback carrier delivered")
  } finally {
    failPaths = {}
    windowObject.__DSH_LAN_BRIDGE_UI__ = savedDescriptor
  }
})

await check("every rendered style uses an approved --dsw-* token and no --dsh-* name", async () => {
  // The alias palette this panel is specified against, plus the interaction
  // tokens the shipped DSH chrome itself uses for the same states.
  const approved = [
    "--dsw-alias-bg-base", "--dsw-alias-bg-layer-1", "--dsw-alias-bg-layer-2",
    "--dsw-alias-bg-overlay", "--dsw-alias-border-l1", "--dsw-alias-border-l2",
    "--dsw-alias-brand-primary", "--dsw-alias-label-primary", "--dsw-alias-label-secondary",
    "--dsw-alias-state-error-primary", "--dsw-alias-state-success-primary",
    "--dsw-alias-state-warn-primary", "--dsw-specific-sidebar-fill",
    "--dsw-alias-interactive-bg-hover", "--dsw-alias-interactive-bg-active",
    "--dsw-alias-button-primary-hover", "--dsw-alias-label-primary-foreground",
    // Real surface tokens: DSH's floating menus use `--dsw-specific-menu`, inputs
    // use `--dsw-specific-input-major`, chips use `--dsw-specific-bubble`.
    // `--dsw-alias-bg-overlay` above is a SCRIM (dark #61666b) and must never be
    // used as a panel background — doing so is what made dark mode look washed out.
    "--dsw-specific-menu", "--dsw-specific-input-major", "--dsw-specific-bubble",
  ]
  hostState = richState()
  const boot = bootPlugin({ connection: rejectingConnection })
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  // Also render the error banner, which is the one surface built from the
  // shared error style object rather than from a card.
  byField(renderEl(boot.components[1], {}), "manual-address")[0].props.onChange({ target: { value: "not-an-address" } })
  click(byAction(renderEl(boot.components[1], {}), "manual-connect")[0], "manual connect")

  const trees = [
    renderEl(boot.components[0], { wide: true }),
    renderEl(boot.components[0], { wide: false }),
    renderEl(boot.components[1], {}),
  ]
  const strings = []
  for (const tree of trees) styleStrings(tree, strings)
  ok(strings.length > 20, "the audit saw the rendered style objects (" + strings.length + " values)")

  const legacy = strings.filter((value) => value.indexOf("--dsh-") !== -1)
  deepEq(legacy, [], "invented --dsh-* token names in rendered styles")

  const names = new Set()
  for (const value of strings) {
    const found = value.match(/--[a-z0-9-]+/g)
    if (found === null) continue
    for (const name of found) names.add(name)
  }
  const unknown = Array.from(names).filter((name) => approved.indexOf(name) === -1)
  deepEq(unknown, [], "style values using a token outside the approved --dsw-* set")
  ok(Array.from(names).some((name) => name.indexOf("--dsw-") === 0), "real --dsw-* tokens are actually in use")
})

/* ------------------------------------------------------------------ *
 * Regression: the bridge side must be able to GET a pairing code
 * ------------------------------------------------------------------ */

await check("with no pairing window open the bridge side is offered 开启配对窗口, and it calls pair.open", async () => {
  // A fresh start opens no window, and a code is single-use — so hiding the
  // whole section without a code would make a first connection impossible.
  hostState = Object.assign(richState(), { pairing: null, role: "bridge" })
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const panel = renderEl(boot.components[1], {})
  ok(textOf(panel).indexOf("开启配对窗口") !== -1, "the open-window affordance is rendered without a code")
  click(byAction(panel, "pair-open")[0], "open pairing window")
  expectOp("pair.open", {})
  await settleTwice()
})

await check("with a code present the bridge side can issue a NEW one, and the agent side sees neither", async () => {
  hostState = Object.assign(richState(), { role: "bridge" })
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const panel = renderEl(boot.components[1], {})
  ok(textOf(panel).indexOf("刷新配对码") !== -1, "refresh affordance with an existing code")
  click(byAction(panel, "pair-open")[0], "new pairing code")
  expectOp("pair.open", {})
  await settleTwice()

  hostState = Object.assign(richState(), { pairing: null, role: "agent", accepts: false })
  const agentBoot = bootPlugin()
  const agentTimer = openPanel(agentBoot)
  agentTimer.fn()
  await settleTwice()
  const agentPanel = renderEl(agentBoot.components[1], {})
  // An Agent-side machine that is NOT accepting is exactly the case the panel
  // must explain, and opening a window is what makes it connectable — so the
  // identity section carries the affordance and the pairing section does not
  // repeat the same wording.
  const agentText = textOf(agentPanel)
  ok(agentText.indexOf("不接收连接") !== -1, "the refuses-everything state is stated")
  ok(agentText.indexOf("Agent 侧默认不监听") !== -1, "and it says why")
  ok(agentText.indexOf("不影响能否连上") !== -1, "and it no longer claims discoverable gates reachability")
  eq(byAction(agentPanel, "open-pairing-window").length, 1, "exactly one 开启配对窗口 affordance")
  eq(byAction(agentPanel, "pair-open").length, 1, "the pairing section still offers its own code control")
  eq(byAction(agentPanel, "pair-open")[0].props.children, "开启配对窗口", "the code control keeps the wording the state calls for")
  const identity = bySection(agentPanel, "dsh-lan-bridge-identity")[0]
  eq(byAction(identity, "open-pairing-window").length, 1, "the affordance lives in the identity section")
  eq(byAction(identity, "open-pairing-window")[0].props.disabled, false, "and it is usable")
  // Clicking it is what makes an Agent-side machine connectable, so it must
  // really issue the op — not merely be rendered.
  click(byAction(identity, "open-pairing-window")[0], "open a pairing window from the identity section")
  expectOp("pair.open", {})
  await settleTwice()
})

/* ------------------------------------------------------------------ *
 * Regressions: relative time phrasing, and dark-mode fallbacks
 * ------------------------------------------------------------------ */

await check("a peer's age reads 刚刚 or N 分钟前, never 刚刚前 / 'just now ago'", async () => {
  hostState = richState()
  const base = richState().peers[0]
  hostState.peers = [
    Object.assign({}, base, { deviceId: "dev-fresh", name: "Fresh", lastSeenMs: Date.now() - 200 }),
    Object.assign({}, base, { deviceId: "dev-old", name: "Old", lastSeenMs: Date.now() - 5 * 60 * 1000 }),
  ]
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const text = textOf(renderEl(boot.components[1], {}))
  // 刚刚 already means "just now": the 前 suffix belongs to the numbered forms.
  ok(text.indexOf("刚刚前") === -1, "刚刚 must not be followed by 前")
  ok(text.indexOf("ago ago") === -1, "just now must not be followed by ago")
  ok(text.indexOf("最后发现 刚刚") !== -1, "a peer seen a moment ago reads 刚刚")
  ok(text.indexOf("5 分钟前") !== -1, "an older peer reads N 分钟前")
})

await check("a dark colour scheme switches the fallbacks instead of painting a white panel", async () => {
  const saved = sandbox.matchMedia
  sandbox.matchMedia = function () { return { matches: true } }
  try {
    hostState = richState()
    const boot = bootPlugin()
    // The panel must be OPEN: the closed shell renders a single `display:none`,
    // which is what "one style string" above was.
    const timer = openPanel(boot)
    timer.fn()
    await settleTwice()
    const strings = []
    styleStrings(renderEl(boot.components[1], {}), strings)
    const joined = strings.join(" ")
    ok(joined.indexOf("--dsw-specific-menu") !== -1, "DSH's menu token is asked for first")
    ok(joined.indexOf("#353638") !== -1, "the dark menu surface fallback reaches the panel")
    ok(joined.indexOf("--dsw-alias-bg-overlay") === -1, "the scrim token is not used as a surface")
    ok(joined.indexOf("#f9fafb") !== -1, "the dark text fallback is in use too")
  } finally {
    if (saved === undefined) delete sandbox.matchMedia
    else sandbox.matchMedia = saved
  }
})

/* ------------------------------------------------------------------ *
 * New panel against an OLD host
 *
 * `lib/client.js` is served from disk on every page load while the running
 * host keeps the code it booted with, so this mismatch is the EXPECTED state
 * during development. The panel must say so plainly and keep the legacy view
 * alive instead of rendering an empty, half-dead panel.
 * ------------------------------------------------------------------ */

/** Exactly what the pre-multi-device host answered: no v2 keys at all. */
function legacyHostState() {
  const rich = richState()
  return {
    role: "agent",
    discoverable: true,
    port: 7331,
    deviceId: "dev-win-0f3a91c2",
    deviceName: "DESKTOP-7K2",
    os: "win32",
    arch: "x64",
    protocolVersion: "v1",
    hostBuild: "old-host-build",
    peers: rich.peers,
    pairing: rich.pairing,
    audit: rich.audit,
    connection: {
      state: "connected",
      peerDeviceId: "dev-mac-77aa11bb",
      peerName: "MacBook",
      sinceMs: Date.now() - 65000,
      rttMs: 3,
    },
    peersConnected: [{
      deviceId: "dev-mac-77aa11bb",
      name: "MacBook",
      sinceMs: Date.now() - 65000,
      grant: { roots: ["H:\\mod"], write: true, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
    }],
    request: {
      id: "req-old",
      deviceId: "dev-linux-9c4412",
      name: "ThinkPad",
      os: "linux",
      sas: "418302",
      requestedCaps: ["fs.read"],
      defaultGrant: { roots: ["/home/<user>/work"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
    },
    // Deliberately absent: links, sessions, targets, requests, toolsAvailable, relay.
  }
}

await check("an old host is named out loud, not rendered as an empty panel", async () => {
  hostState = legacyHostState()
  const boot = bootPlugin()
  const timer = openPanel(boot)
  timer.fn()
  await settleTwice()
  const panel = renderEl(boot.components[1], {})
  eq(panel.props["data-bridge-panel"], "open", "the panel still renders (no throw, no error card)")
  const notice = byField(panel, "host-mismatch")[0]
  ok(notice, "the host mismatch is stated")
  const noticeText = textOf(notice)
  ok(noticeText.indexOf("主机侧是旧版本") !== -1, "it says the host is older")
  ok(noticeText.indexOf("退出 DSH 再打开") !== -1, "it names the one useful action")
  ok(noticeText.indexOf("退出 App 再打开") !== -1, "in the words the user asked for")
  ok(noticeText.indexOf("从磁盘读取") !== -1, "and it explains why the two can disagree")
  // The legacy connection is still visible and usable.
  const legacy = findAll(panel, (el) => el.props && el.props["data-bridge-legacy"] === "connection")[0]
  ok(legacy, "the old single connection is still shown")
  ok(textOf(legacy).indexOf("MacBook") !== -1, "with its peer name")
  eq(byAction(legacy, "disconnect").length, 1, "and a working disconnect")
  // The legacy inbound list keeps grant editing alive.
  eq(findAll(panel, (el) => el.props && el.props["data-bridge-legacy"] === "session").length, 1, "the old peersConnected list is shown")
  ok(byAction(panel, "session-edit").length === 1, "with its grant editor affordance")
  // No v2 list is rendered empty-and-unexplained.
  eq(byTarget(panel, "dev-mac-77aa11bb").length, 0, "no invented v2 target rows")
  ok(textOf(panel).indexOf("可调用的设备") === -1, "the v2-only sections are omitted, not shown empty")
  // The footer still reports the connection it really has.
  const footer = renderEl(boot.components[0], { wide: true })
  eq(footer.props["data-bridge-footer"], "connected", "the footer dot is green for the legacy connection")
  ok(textOf(footer).indexOf("MacBook") !== -1, "and it names the legacy peer")
  ok(textOf(footer).indexOf("不接收连接") === -1, "a missing accepts field is NOT reported as a refusal")
  // An absent field is not a false one.
  const acceptsLine = textOf(byField(panel, "accepts")[0])
  ok(acceptsLine.indexOf("未报告") !== -1, "the panel says it cannot tell, instead of claiming a refusal")
})

await check("the toast still offers 同意 against an old host's single `request` alias", async () => {
  hostState = legacyHostState()
  const boot = bootPlugin()
  // Never open the panel: the approval must reach the user on its own.
  const timer = intervals.filter((i) => i.ms === 3000).pop()
  if (timer) timer.fn()
  await settleTwice()
  const toast = renderEl(boot.components[2], {})
  ok(toast, "the toast appears for the legacy request")
  eq(toast.props["data-bridge-toast"], "request", "it is an approval, not a connection notice")
  eq(toast.props["data-bridge-toast-count"], "1", "the single legacy request is listed once")
  const text = textOf(toast)
  ok(text.indexOf("ThinkPad") !== -1, "it names the device")
  ok(text.indexOf("418302") !== -1, "it shows the safety code")
  click(byAction(toast, "toast-allow")[0], "allow from the toast against an old host")
  const last = requests[requests.length - 1]
  eq(last.body.op, "approve", "the approval op is still sent")
  eq(last.body.args.id, "req-old", "with the legacy request id")
  await settleTwice()
})

/* ------------------------------------------------------------------ *
 * The notification toast
 * ------------------------------------------------------------------ */

await check("edited grant then approve sends the edited grant from the toast's default", async () => {
  // The shared store still holds the hostile payload from the previous phase,
  // and the panel is closed, so nudge the background poll to pick up the
  // current fixture before the toast is read.
  hostState = richState()
  const background = intervals.filter((i) => i.ms === 3000).pop()
  if (background) background.fn()
  await settleTwice()
  // There is no approval card inside the panel any more: the toast owns the
  // decision (with MORE THAN ONE pending request), so the smoke test reads the
  // pending requests from the toast and approves through it.
  const toast = renderEl(TOAST, {})
  eq(toast.props["data-bridge-toast"], "request", "the toast is showing requests")
  eq(toast.props["data-bridge-toast-count"], "2", "both pending requests are listed at once")
  const rowIds = findAll(toast, (el) => el.props && el.props["data-bridge-request"] !== undefined)
  deepEq(rowIds.map((el) => el.props["data-bridge-request"]), ["req-1", "req-2"], "one block per request")
  const text = textOf(toast)
  ok(text.indexOf("ThinkPad") !== -1 && text.indexOf("NAS") !== -1, "both device names are shown")
  ok(text.indexOf("418302") !== -1 && text.indexOf("519420") !== -1, "both safety codes are shown")
  eq(byAction(toast, "toast-allow").length, 2, "one 同意 per request")
  eq(byAction(toast, "toast-deny").length, 2, "one 拒绝 per request")
  ok(text.indexOf("将授予 ") !== -1, "the grant that would be used is stated before deciding")

  // 同意 with no adjustment sends the request's own defaultGrant, untouched.
  click(byAction(toast, "toast-allow")[0], "toast allow")
  const last = requests[requests.length - 1]
  eq(last.body.op, "approve", "同意 approves straight from the toast")
  eq(last.body.args.id, "req-1", "the FIRST request's id")
  eq(last.body.args.decision, "allow", "decision")
  eq(last.body.args.remember, true, "remembered by default")
  deepEq(last.body.args.grant, {
    roots: ["/home/<user>/work"], write: false, shell: false,
    relay: true, relayPeers: [], timeoutMs: 30000, maxOutputBytes: 262144,
  }, "it uses that request's default grant")
  await settleTwice()

  // The grant can still be adjusted per request before approving.
  click(byAction(renderEl(TOAST, {}), "toast-grant")[0], "open the first request's grant editor")
  const open = renderEl(TOAST, {})
  const first = findAll(open, (el) => el.props && el.props["data-bridge-request"] === "req-1")[0]
  ok(byField(first, "roots")[0], "the inline grant editor opened on that request only")
  byField(first, "roots")[0].props.onChange({ target: { value: "/home/<user>/work\n/srv/tmp" } })
  // Re-read the tree between patches: a control's handler closes over the draft
  // as it was rendered, so patching two controls from one stale render would
  // have the second one rebase onto the pre-edit draft.
  const afterRoots = findAll(renderEl(TOAST, {}), (el) => el.props && el.props["data-bridge-request"] === "req-1")[0]
  byField(afterRoots, "shell")[0].props.onChange({ target: { checked: true } })
  byField(renderEl(TOAST, {}), "relayPeers")[0].props.onChange({ target: { value: "dev-nas-5e5e5e\n\ndev-mac-77aa11bb\n" } })
  click(byAction(renderEl(TOAST, {}), "toast-allow")[0], "allow with the edited grant")
  const edited = requests[requests.length - 1]
  eq(edited.body.args.id, "req-1", "still the first request")
  deepEq(edited.body.args.grant, {
    roots: ["/home/<user>/work", "/srv/tmp"], write: false, shell: true,
    relay: true, relayPeers: ["dev-nas-5e5e5e", "dev-mac-77aa11bb"],
    timeoutMs: 30000, maxOutputBytes: 262144,
  }, "the edited grant is sent")
  await settleTwice()

  // The second request keeps its own id, grant and safety code.
  click(byAction(renderEl(TOAST, {}), "toast-deny")[1], "toast deny for the second request")
  const denied = requests[requests.length - 1]
  eq(denied.body.args.id, "req-2", "the SECOND request's id")
  eq(denied.body.args.decision, "deny", "decision")
  await settleTwice()
})

await check("the × dismiss hides the whole card, and a later request still arrives", async () => {
  hostState = richState()
  const boot = bootPlugin()
  const timer = intervals.filter((i) => i.ms === 3000).pop()
  if (timer) timer.fn()
  await settleTwice()
  const toast = renderEl(boot.components[2], {})
  eq(toast.props["data-bridge-toast"], "request", "requests are showing")
  click(byAction(toast, "toast-close")[0], "dismiss")
  eq(renderEl(boot.components[2], {}), null, "the dismissed card is gone")
  // A request that arrives AFTER the dismissal is a new event and must announce
  // itself: the dismissed set is keyed by request id, not by "requests exist".
  hostState.requests = [{
    id: "req-3",
    deviceId: "dev-linux-9c4412",
    name: "ThinkPad",
    os: "linux",
    sas: "418302",
    requestedCaps: ["fs.read"],
    defaultGrant: { roots: ["/home/<user>/work"], write: false, shell: false, timeoutMs: 30000, maxOutputBytes: 262144 },
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60000,
  }]
  hostState.request = hostState.requests[0]
  const later = intervals.filter((i) => i.ms === 3000).pop()
  if (later) later.fn()
  await settleTwice()
  const again = renderEl(boot.components[2], {})
  ok(again, "a new request announces itself after a dismissal")
  eq(again.props["data-bridge-toast-count"], "1", "only the new one is pending")
})

await check("the toast stays silent when there is nothing to say", async () => {
  hostState = richState()
  hostState.requests = []
  hostState.request = null
  hostState.connection = null
  hostState.links = []
  const boot = bootPlugin()
  const timer = intervals.filter((i) => i.ms === 3000).pop()
  if (timer) timer.fn()
  await settleTwice()
  eq(renderEl(boot.components[2], {}), null, "no toast without a request or a fresh connection")
})

/* ------------------------------------------------------------------ *
 * Phase G — the panel contribution (R192)
 *
 * The LINK panel publishes a client-face service (`linkPanel`) whose
 * `declare(definition)` registers one item and returns its disposer. This
 * half contributes ONE `status` item — its own connection reading — and it
 * must do so fail-closed: a page with no such service keeps every other
 * registration the half made.
 *
 * These readings drive the BUILT bundle's own apply() on a recording ctx, so
 * what is measured is the artifact the browser runs, not a copy of its source
 * rewritten here.
 *
 * The channel runs in both directions, and G8 measures the provider's half of it:
 * the item's text is a thunk, but the panel takes a projection only when it is
 * asked to, so the provider's own store notification must be passed on through the
 * seam's named refresh path — once per store change, and not at all once the item's
 * disposer has run.
 * ------------------------------------------------------------------ */

/** Where the artifact records what its contribution did (its own marker, not the panel's). */
const CONTRIBUTION_MARKER = "__dshLanBridgePanel"
const CONTRIBUTION_NS = "dsh-lan-bridge"
const CONTRIBUTION_LABEL = "dsh-lan-bridge: panel contribution"
const TITLE_KEY = "panel.item.title"

/**
 * A locale seat shaped like the kernel's own service: register() keeps the
 * dictionaries, bind() answers from them for the active language. `decorate`
 * marks every answer, so a reading can tell a value that went THROUGH the
 * service from one that came from the bundle's own fallback dictionary.
 */
function recordingLocale(active, calls, decorate) {
  const dicts = {}
  const bound = new Map()
  const wanted = String(active).toLowerCase().indexOf("en") === 0 ? "en" : "zh"
  return {
    getLocale() { return { active: active, locales: [], revision: 1 } },
    register(ns, table) {
      dicts[ns] = table
      calls.push({ call: "register", ns: ns, table: table, locales: Object.keys(table).sort(), zh: Object.keys(table.zh).sort(), en: Object.keys(table.en).sort() })
      return function () {}
    },
    bind(ns) {
      calls.push({ call: "bind", ns: ns })
      if (!bound.has(ns)) {
        bound.set(ns, function (key, params) {
          const table = dicts[ns]
          const dictionary = table && table[wanted] ? table[wanted] : {}
          const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
          const answered = decorate === true ? "[svc]" + template : template
          if (params === undefined || params === null) return answered
          return answered.replace(/\{(\w+)\}/g, (all, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : all)
        })
      }
      return bound.get(ns)
    },
  }
}

/**
 * A recording seam: it keeps every declaration, hands back a marked disposer, and
 * counts the refreshes it is told about.
 *
 * `notifyCalls` is the reading the provider's half of the live-reading rule needs:
 * the seam is told a projection is due exactly when the provider's own store moved,
 * and not on a cadence of the provider's own invention. The COUNT is the whole
 * instrument - nothing here re-projects, so a count that moves is a call that
 * happened.
 */
function recordingSeam() {
  const declarations = []
  const disposers = []
  const notifyCalls = []
  return {
    declarations: declarations,
    disposers: disposers,
    notifyCalls: notifyCalls,
    service: {
      declare(definition) {
        declarations.push(definition)
        const disposer = function () { disposer.called = true }
        disposers.push(disposer)
        return disposer
      },
      notify() { notifyCalls.push(notifyCalls.length + 1) },
    },
  }
}

/**
 * Boot one more instance of the built bundle (its own module scope, its own
 * store) with a ctx built for these readings: an optional seam, a locale seat,
 * and the three slot seats the rest of the half needs.
 */
function bootContribution(options) {
  const opts = options || {}
  const seam = opts.withPanel === false ? null : recordingSeam()
  const localeCalls = []
  const locale = opts.locale === undefined
    ? recordingLocale(opts.active === undefined ? "zh" : opts.active, localeCalls, opts.decorate === true)
    : opts.locale
  const components = []
  const effects = []
  const ctx = {
    slots: {
      register(slotOptions, component) { components.push(component); return function () {} },
      inject(key, callback) { return callback() },
    },
    locale: locale,
    effect(fn, label) {
      const disposer = fn()
      effects.push({ label: label, disposer: disposer })
      return function () { if (typeof disposer === "function") disposer() }
    },
  }
  if (opts.withoutCtxGet !== true) {
    ctx.get = function (name) {
      if (name === "linkPanel") return seam === null ? undefined : seam.service
      return undefined
    }
  }
  const instance = loaderRegistrations[0].factory(stubRequire)
  let thrown = null
  try {
    instance.apply(ctx)
  } catch (err) {
    thrown = err
  }
  return { components: components, effects: effects, localeCalls: localeCalls, seam: seam, ctx: ctx, instance: instance, thrown: thrown }
}

/** Every key the artifact reads through its own t(...), read from its bytes. */
function keysReadThroughT(text) {
  const keys = new Set()
  for (const match of text.matchAll(/\bt\(\s*"([^"\n]+)"/g)) keys.add(match[1])
  return Array.from(keys).sort()
}

await check("G1 the artifact injects the panel seam and the locale service", () => {
  const boot = bootContribution({ active: "zh" })
  const inject = boot.instance.inject
  ok(Array.isArray(inject), "exports.inject must be an array")
  ok(inject.indexOf("linkPanel") !== -1, "inject must name the panel contribution seam")
  ok(inject.indexOf("locale") !== -1, "inject must still name the locale service")
})

await check("G2 the dictionary goes through the kernel locale service, in both languages", async () => {
  hostState = richState()
  const zh = bootContribution({ active: "zh", decorate: true })
  const en = bootContribution({ active: "en-US", decorate: true })
  await settleTwice()
  for (const entry of [["zh", zh], ["en", en]]) {
    const label = entry[0]
    const boot = entry[1]
    const registered = boot.localeCalls.filter((call) => call.call === "register")
    eq(registered.length, 1, label + ": register call count")
    eq(registered[0].ns, CONTRIBUTION_NS, label + ": the namespace is this package's own")
    deepEq(registered[0].zh, registered[0].en, label + ": zh and en carry the same key set")
    ok(registered[0].zh.length > 0, label + ": the dictionary is not empty")
    const bound = boot.localeCalls.filter((call) => call.call === "bind")
    eq(bound.length, 1, label + ": bind call count")
    eq(bound[0].ns, CONTRIBUTION_NS, label + ": the namespace bound for t()")
  }
  const zhItem = zh.seam.declarations[0]
  const enItem = en.seam.declarations[0]
  eq(zhItem.title(), "[svc]" + zh.localeCalls[0].table.zh[TITLE_KEY], "zh: the title is the dictionary's value, read through the service")
  eq(enItem.title(), "[svc]" + en.localeCalls[0].table.en[TITLE_KEY], "en: the same key answers in the other language")
  ok(zh.localeCalls[0].table.zh[TITLE_KEY] !== en.localeCalls[0].table.en[TITLE_KEY], "the two languages really differ")
  ok(zhItem.title().indexOf(TITLE_KEY) === -1, "an answered key never arrives as the key itself")
})

await check("G3 the declared item is one `status` item carrying the package's own reading", async () => {
  hostState = richState()
  const boot = bootContribution({ active: "zh" })
  await settleTwice()
  eq(boot.seam.declarations.length, 1, "declare call count")
  const item = boot.seam.declarations[0]
  eq(item.id, "dsh-lan-bridge:connection", "the item id")
  eq(item.kind, "status", "the kind (the panel's closed set)")
  eq(item.source, "dsh-lan-bridge", "the source names this package")
  ok(Number.isFinite(item.order), "order must be a finite number")
  eq(typeof item.title, "function", "title is a thunk: copy is read again, never frozen")
  eq(typeof item.body, "function", "body is a thunk: the reading is live")
  const title = item.title()
  const body = item.body()
  ok(typeof title === "string" && title.length > 0, "the title is a non-empty string")
  ok(typeof body === "string" && body.length > 0, "the body is a non-empty string")
  const footer = textOf(renderEl(boot.components[0], { wide: true }))
  ok(footer.indexOf(body) !== -1, "the body IS the line this package's own footer draws: " + JSON.stringify(body) + " in " + JSON.stringify(footer))
  ok(body.indexOf("MacBook") !== -1, "the reading names the connected peer the state carries, never an invented number")
})

await check("G4 with no panel service the half does not throw, says so, and keeps its slots", () => {
  const boot = bootContribution({ withPanel: false, active: "zh" })
  eq(boot.thrown, null, "apply must not throw without the seam")
  eq(boot.components.length, 3, "the three slot registrations still happened")
  const marker = sandbox[CONTRIBUTION_MARKER]
  ok(marker !== null && typeof marker === "object", "the package's own marker records the attempt, got " + JSON.stringify(marker))
  eq(marker.declared, false, "nothing was declared")
  ok(String(marker.failed).indexOf("linkPanel-unavailable") === 0, "the failure is named in the marker: " + JSON.stringify(marker.failed))
  // A ctx with no strict service read at all is the same case, not a second failure mode.
  const bare = bootContribution({ withPanel: false, withoutCtxGet: true, active: "zh" })
  eq(bare.thrown, null, "apply must not throw without ctx.get either")
  eq(sandbox[CONTRIBUTION_MARKER].declared, false, "still nothing declared")
})

await check("G5 the dictionary is exactly the key set the artifact reads through t()", () => {
  const boot = bootContribution({ active: "zh" })
  const table = boot.localeCalls[0].table
  const read = keysReadThroughT(source)
  ok(read.length > 0, "the artifact must read its own copy through t()")
  deepEq(Object.keys(table.zh).sort(), read, "the registered zh key set is the set t() reads")
  deepEq(Object.keys(table.en).sort(), read, "the registered en key set is the same set")
})

await check("G6 the contribution leaves with its effect disposer", () => {
  const boot = bootContribution({ active: "zh" })
  eq(boot.seam.declarations.length, 1, "one declaration to release")
  const bound = boot.effects.filter((effect) => effect.label === CONTRIBUTION_LABEL)
  eq(bound.length, 1, "the contribution is bound through ctx.effect under its own label")
  eq(typeof bound[0].disposer, "function", "the effect returned a disposer")
  bound[0].disposer()
  eq(boot.seam.disposers[0].called, true, "the seam's disposer really ran")
})

await check("G7 with no locale service the same dictionary still answers, never the raw key", () => {
  const zh = bootContribution({ active: "zh", locale: { getLocale() { return { active: "zh", locales: [], revision: 1 } } } })
  eq(zh.localeCalls.length, 0, "no service to register with or bind to")
  const zhTitle = zh.seam.declarations[0].title()
  ok(zhTitle.length > 0 && zhTitle.indexOf(TITLE_KEY) === -1, "the title is a word, not the key: " + JSON.stringify(zhTitle))
  const en = bootContribution({ active: "en-US", locale: { getLocale() { return { active: "en-US", locales: [], revision: 1 } } } })
  ok(en.seam.declarations[0].title() !== zhTitle, "the other language answers differently")
})

await check("G8 a store change is announced through the seam once, and its disposer ends that", async () => {
  hostState = richState()
  const boot = bootContribution({ active: "zh" })
  // apply() seeds the store with one read. That landing IS the first store change, and it
  // must already have been announced: the panel takes a projection when it is told to, so a
  // reading nobody announces is a row the panel never redraws.
  await settleTwice()
  eq(boot.seam.notifyCalls.length, 1, "the read that landed in the store during apply() reached the seam as exactly one notify")

  // A store change this half makes itself: opening the panel flips the shared store. One
  // change, one notification, and no second item invented for it.
  const footer = renderEl(boot.components[0], { wide: true })
  click(findAll(footer, (el) => typeof el.props.onClick === "function")[0], "footer toggle")
  eq(boot.seam.notifyCalls.length, 2, "one store change is exactly one notify")
  eq(boot.seam.declarations.length, 1, "the item is not re-declared to make the row move")

  // A reading that MOVES: the panel's own poll lands an error in the store, so the text the
  // item carries is now a different one. The seam hears about it in the same step, and the
  // thunk the panel would project already answers the reading the store holds.
  const opened = renderEl(boot.components[1], {})
  eq(opened.props["data-bridge-panel"], "open", "the panel is open for this reading")
  stubReact.flushEffects()
  await settleTwice()
  const settled = boot.seam.notifyCalls.length
  const timer = intervals.filter((entry) => entry.ms === 1500).pop()
  ok(timer, "the open panel's own poll is registered")
  failNextState = true
  timer.fn()
  await settleTwice()
  failNextState = false
  eq(boot.seam.notifyCalls.length, settled + 1, "the poll landing in the store is exactly one notify")
  const moved = String(boot.seam.declarations[0].body())
  ok(moved.indexOf("bad ui token") !== -1,
    "the item's thunk answers what the store holds NOW, so the announced projection is the moved reading: " + JSON.stringify(moved))

  // The same disposer that takes the item out stops the refresh. A listener left behind is
  // exactly how a removed item keeps waking a panel it is no longer drawn in.
  const bound = boot.effects.filter((effect) => effect.label === CONTRIBUTION_LABEL)
  eq(bound.length, 1, "the contribution is bound through ctx.effect under its own label")
  const afterRelease = boot.seam.notifyCalls.length
  bound[0].disposer()
  eq(boot.seam.disposers[0].called, true, "the seam's own disposer really ran")
  const again = renderEl(boot.components[0], { wide: true })
  click(findAll(again, (el) => typeof el.props.onClick === "function")[0], "footer toggle, after the disposer")
  eq(boot.seam.notifyCalls.length, afterRelease, "after the disposer a store change no longer reaches the seam")
})

if (VERBOSE && pluginLog.length > 0) {
  console.log("--- plugin log ---")
  for (const line of pluginLog) console.log(line)
}

console.log("")
console.log(passes + " passed, " + failures + " failed")
process.exitCode = failures === 0 ? 0 : 1
