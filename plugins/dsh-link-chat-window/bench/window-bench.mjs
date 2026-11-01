#!/usr/bin/env node
/**
 * R493 B2 benchmark: the paged Chat event window against the real kernel client classes.
 *
 * Real here: MutableSessionEventSource and ConversationNodeAssembler imported from the kernel
 * checkout (the same classes the shell runs; only browser globals are shimmed), and the trim
 * payload is this package's src/policy.ts + src/tail-window.ts - exactly what the proposed kernel
 * patch docs/kernel-patches/R501-draft.patch calls. The subscriber models the Conversation binding
 * accept path: replace -> replaceWindow, prepend -> prepend, append -> append, settle -> settleAssistant.
 *
 * Modelled (labelled): no browser runs here. DOM elements derive from the real assembler node
 * count with bench/live-calibration.json (CDP-measured 30.0 chat elements per chat node, 843 shell
 * chrome elements). Memory is process heapUsed/rss after gc: window entries + assembler contexts +
 * node objects, no real DOM.
 *
 * Aligned with R495 section 5.2 (10k per-publish full-window materialization 1196.9 ms vs 500 ring
 * 4.7 ms) and R487 section 2.8; the bench reproduces that counterfactual with the real window class.
 *
 * Usage: node --experimental-transform-types --expose-gc plugins/dsh-link-chat-window/bench/window-bench.mjs [--quick] [--sizes=...]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const KERNEL = join(HERE, '..', '..', '..', 'core', 'deepseek-harness')
const kernelUrl = (relative) => new URL('file:///' + KERNEL.replaceAll('\\', '/') + '/' + relative).href
const pluginUrl = (relative) => new URL('file:///' + PLUGIN.replaceAll('\\', '/') + '/' + relative).href

// Browser globals the kernel client module graph touches at import time; the bench never renders.
globalThis.window = globalThis
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
  fonts: { addEventListener() {}, removeEventListener() {} },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} } },
}
globalThis.window.__ModuleLoader__ = { load() {} }

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.findIndex((argument) => argument === name || argument.startsWith(name + '='))
  if (index < 0) return fallback
  const argument = args[index]
  if (argument.includes('=')) return argument.slice(argument.indexOf('=') + 1)
  const next = args[index + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}
const SIZES = args.includes('--quick') ? [10000] : String(flag('--sizes', '10000,50000,100000')).split(',').map((value) => Number(value.trim())).filter(Number.isFinite)
const CALIBRATION = JSON.parse(readFileSync(join(HERE, 'live-calibration.json'), 'utf8'))
const SHELL_CHROME_ELEMENTS = CALIBRATION.dom.shellChromeElements
const ELEMENTS_PER_NODE = CALIBRATION.dom.elementsPerChatNode
const BYTES_PER_EVENT = CALIBRATION.window.bytesPerEvent
const RENDER_MS_PER_NODE = CALIBRATION.render.msPerNode
const RUNS_OVERHEAD = 20
const PAGE_EVENTS = CALIBRATION.window.openingPageEvents

const { MutableSessionEventSource } = await import(kernelUrl('packages/api/session-controller/src/client/contract/events.ts'))
const { ConversationNodeAssembler } = await import(kernelUrl('packages/client/ui-conversation/src/client/conversation/assembler.ts'))
const { TailWindow } = await import(pluginUrl('src/tail-window.ts'))
const { TailWindowPolicy, takeWindowTail, readWindowTree } = await import(pluginUrl('src/policy.ts'))

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const round = (value, digits) => Number(value.toFixed(digits))
const jsonOf = (entries) => JSON.stringify(entries)
const p50 = (values) => values.slice().sort((left, right) => left - right)[Math.floor(values.length / 2)]

/* ---------------------------------------------------------------- synthetic conversation */

/** Chat-granularity definitions: one context per turn, step, assistant message, tool call, user message. */
const DEFINITIONS = [
  {
    kind: 'turn', target: 'chat',
    match(event) {
      if (event.type === 'turn/start') return { id: 't' + String(event.data.turn), role: 'start' }
      if (event.type === 'turn/end') return { id: 't' + String(event.data.turn), role: 'update' }
      return null
    },
    start() { return { n: 1 } },
    update(state) { return state },
    buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'turn' } },
  },
  {
    kind: 'step', target: 'chat',
    match(event) {
      if (event.type === 'step/start') return { id: 's' + String(event.data.turn) + ':' + String(event.data.step), role: 'start' }
      if (event.type === 'step/end') return { id: 's' + String(event.data.turn) + ':' + String(event.data.step), role: 'update' }
      return null
    },
    start() { return { n: 1 } },
    update(state) { return state },
    buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'step' } },
  },
  {
    kind: 'assistant', target: 'chat',
    match(event) { return event.type === 'assistant/message' ? { id: 'a' + String(event.data.turn) + ':' + String(event.data.step), role: 'start' } : null },
    start() { return { n: 1 } },
    update(state) { return state },
    buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'assistant' } },
  },
  {
    kind: 'tool', target: 'chat',
    match(event) {
      if (event.type === 'tool/call') return { id: 'c' + String(event.data.callId), role: 'start' }
      if (event.type === 'tool/result') return { id: 'c' + String(event.data.callId), role: 'update' }
      return null
    },
    start() { return { n: 1 } },
    update(state) { return state },
    buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'tool' } },
  },
  {
    kind: 'user', target: 'chat',
    match(event) { return event.type === 'user/message' ? { id: 'u' + String(event.seq), role: 'start' } : null },
    start() { return { n: 1 } },
    update(state) { return state },
    buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'user' } },
  },
]
const EVENT_DEFINITIONS = { entries: () => DEFINITIONS, fallbackEntry: () => undefined }

function createViewBuilder() {
  let rows = new Map()
  return {
    empty: 0,
    replace(input) { rows = new Map(input.nodes.map((node) => [node.key, node])); return rows.size },
    apply(input) { for (const node of input.upserts) rows.set(node.key, node); return rows.size },
    publish() {},
  }
}
const VIEW_DEFINITIONS = { entries: () => [{ target: 'chat', create: createViewBuilder }] }

/* ---------------------------------------------------------------- workload */

/** The live page-audit type mix (bench/live-calibration.json), 100 events per block. */
const TYPE_PATTERN = [
  ...Array(13).fill('tool/ptc-dispatch-start'),
  ...Array(13).fill('tool/ptc-dispatch'),
  ...Array(10).fill('agent/inbox/spliced'),
  ...Array(9).fill('step/start'),
  ...Array(9).fill('step/end'),
  ...Array(9).fill('assistant/message'),
  ...Array(8).fill('tool/call'),
  ...Array(8).fill('tool/result'),
  ...Array(6).fill('user/message'),
  ...Array(6).fill('job/registered'),
  ...Array(6).fill('job/settled'),
  'turn/start',
  'system/message',
]

/** Deterministic durable event log with a legal conversation ordering. */
function generateEvents(count) {
  const events = []
  let turn = 0
  let step = 0
  let openTurn = false
  let openStep = false
  const pendingTools = []
  let toolSerial = 0
  const push = (type, data) => {
    const seq = events.length
    events.push({ type: 'event', event: { seq, type, time: 1760000000000 + seq, data } })
  }
  const openStepNow = () => {
    if (!openTurn) { turn += 1; openTurn = true }
    openStep = true
    step += 1
    push('step/start', { turn, step })
  }
  for (let index = 0; events.length < count; index += 1) {
    let type = TYPE_PATTERN[index % TYPE_PATTERN.length]
    if (type === 'step/end' && !openStep) type = 'step/start'
    if (type === 'tool/result' && pendingTools.length === 0) type = 'tool/call'
    if (type === 'turn/start' && openTurn) type = 'system/message'
    if (type === 'assistant/message' && !openStep) type = 'step/start'
    switch (type) {
      case 'turn/start':
        turn += 1; step = 0; openTurn = true; openStep = false
        push('turn/start', { turn })
        break
      case 'step/start':
        if (openStep) push('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [] })
        else openStepNow()
        break
      case 'step/end':
        openStep = false
        push('step/end', { turn, step })
        break
      case 'assistant/message':
        push('assistant/message', { turn, step, attemptId: 'attempt-' + String(index), text: 'x'.repeat(120) })
        break
      case 'tool/call': {
        toolSerial += 1
        const callId = 'call-' + String(toolSerial)
        pendingTools.push(callId)
        push('tool/call', { callId, name: 'send_message', args: { to: 'peer', body: 'y'.repeat(24) } })
        break
      }
      case 'tool/result': {
        const callId = pendingTools.pop()
        push('tool/result', { callId, ok: true, value: 'z'.repeat(80) })
        break
      }
      case 'user/message':
        push('user/message', { content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
        break
      case 'turn/end':
        openTurn = false
        push('turn/end', { turn, reason: { kind: 'completed' } })
        break
      default:
        push(type, {})
        break
    }
  }
  return events.slice(0, count)
}

function transientEntry(attemptId, seq, turn, step, ordinal) {
  return { type: 'transient', event: { type: 'assistant/live-chunk', seq: seq + ordinal * 0.001, time: 1760000000000, data: { attemptId, turn, step, chunk: { text: 'chunk' } } } }
}

/* ---------------------------------------------------------------- feed / scenarios */

function heapSnapshot() {
  if (typeof globalThis.gc !== 'function') return null
  globalThis.gc()
  const usage = process.memoryUsage()
  return { heapUsedMb: round(usage.heapUsed / 1048576, 1), rssMb: round(usage.rss / 1048576, 1) }
}

function createAssembler() {
  const assembler = new ConversationNodeAssembler(EVENT_DEFINITIONS, VIEW_DEFINITIONS)
  assembler.activateTarget('chat')
  return assembler
}

/** The Conversation binding accept dispatch over a source, feeding the real assembler. */
function createFeed(source, assembler) {
  let revision = -1
  let flushes = 0
  let assembleMs = 0
  let flushMs = 0
  const dispatch = () => {
    const window = source.getSnapshot()
    if (window.revision === revision) return
    if (window.revision !== revision + 1 || window.change.kind === 'replace') {
      revision = window.revision
      const beganAssemble = now()
      const publication = assembler.replaceWindow(window.entries, window.hasMore)
      assembleMs += now() - beganAssemble
      if (publication !== 'none') {
        const beganFlush = now()
        assembler.flush()
        flushMs += now() - beganFlush
        flushes += 1
      }
      return
    }
    revision = window.revision
    const change = window.change
    if (change.kind === 'prepend') {
      const beganAssemble = now()
      const publication = assembler.prepend(change.entries, window.hasMore)
      assembleMs += now() - beganAssemble
      if (publication !== 'none') {
        const beganFlush = now()
        assembler.flush()
        flushMs += now() - beganFlush
        flushes += 1
      }
      return
    }
    if (change.kind === 'append') {
      let publication = 'none'
      const beganAssemble = now()
      for (const entry of change.entries) publication = assembler.append(entry) === 'none' ? publication : 'immediate'
      assembleMs += now() - beganAssemble
      if (publication !== 'none') {
        const beganFlush = now()
        assembler.flush()
        flushMs += now() - beganFlush
        flushes += 1
      }
      return
    }
    if (change.kind === 'settle-assistant') {
      const beganAssemble = now()
      const publication = assembler.settleAssistant(change.attemptId, change.entry)
      assembleMs += now() - beganAssemble
      if (publication !== 'none') {
        const beganFlush = now()
        assembler.flush()
        flushMs += now() - beganFlush
        flushes += 1
      }
    }
  }
  const unsubscribe = source.subscribe(dispatch)
  return {
    install(entries, hasMore) { source.replace(entries, hasMore) },
    appendEntry(entry) { source.append(entry) },
    settleAssistant(attemptId, entry) { source.settleAssistant(attemptId, entry) },
    prepend(entries, hasMore) { source.prepend(entries, hasMore) },
    dispose() { unsubscribe() },
    reset() { assembleMs = 0; flushMs = 0; flushes = 0 },
    get flushes() { return flushes },
    get assembleMs() { return assembleMs },
    get flushMs() { return flushMs },
  }
}

function assemblerCounts(assembler) {
  const inputs = Object.getOwnPropertyDescriptor(assembler, 'inputs')
  const contexts = Object.getOwnPropertyDescriptor(assembler, 'contexts')
  const nodes = assembler.snapshot('chat')
  return {
    inputs: inputs === undefined || inputs.value === undefined ? null : inputs.value.size,
    contexts: contexts === undefined || contexts.value === undefined ? null : contexts.value.size,
    nodes: typeof nodes === 'number' ? nodes : null,
  }
}

function modelDom(nodes) {
  const chat = Math.round((nodes ?? 0) * ELEMENTS_PER_NODE)
  return { shellChrome: SHELL_CHROME_ELEMENTS, chat, total: SHELL_CHROME_ELEMENTS + chat }
}

function windowTreeEntries(source) {
  const tree = readWindowTree(source)
  return tree === null ? [] : takeWindowTail(tree, tree.length)
}

/** Replay one durable log through the real classes; cap null = today's stock (unbounded) behavior. */
function replay(events, options) {
  const openingEnd = Math.min(PAGE_EVENTS, events.length)
  const opening = events.slice(0, openingEnd)
  const live = events.slice(openingEnd)
  const source = new MutableSessionEventSource()
  const assembler = createAssembler()
  const feed = createFeed(source, assembler)
  const windowed = options.cap === null ? null : new TailWindow(source, new TailWindowPolicy({ windowEvents: options.cap, slackEvents: options.slack }))
  let trims = 0
  let trimDropped = 0
  let appended = 0
  const appendViaPolicy = (entry) => {
    if (windowed === null) { feed.appendEntry(entry); return }
    const decision = windowed.appendLive(entry, false)
    if (decision === null) return
    trims += 1
    trimDropped += decision.dropped
  }
  const beginning = now()
  feed.install(opening, true)
  if (windowed !== null) { windowed.install(opening, true); trims += windowed.trims; trimDropped += Math.max(0, openingEnd - windowed.length) }
  const afterOpen = { counts: assemblerCounts(assembler), windowEntries: windowed === null ? openingEnd : windowed.length }
  const openingMs = round(now() - beginning, 2)
  const openingTailExact = windowed === null ? null : jsonOf(windowTreeEntries(source)) === jsonOf(opening.slice(-windowed.length))
  feed.reset()
  let settlementMs = 0
  for (const entry of live) {
    if (entry.event.type === 'assistant/message') {
      const beganSettle = now()
      appendViaPolicy(transientEntry(entry.event.data.attemptId, entry.event.seq, entry.event.data.turn, entry.event.data.step, 1))
      appendViaPolicy(transientEntry(entry.event.data.attemptId, entry.event.seq, entry.event.data.turn, entry.event.data.step, 2))
      appended += 2
      feed.settleAssistant(entry.event.data.attemptId, { type: 'event', event: entry.event })
      appended += 1
      settlementMs += now() - beganSettle
    } else {
      appendViaPolicy(entry)
      appended += 1
    }
  }
  const dispatch = { assembleMs: round(feed.assembleMs, 2), flushMs: round(feed.flushMs, 2), flushes: feed.flushes }
  feed.dispose()
  assembler.flush()
  const replayMs = now() - beginning
  const counts = assemblerCounts(assembler)
  const inWindow = windowTreeEntries(source)
  const windowEntries = inWindow.length
  const memory = heapSnapshot()
  const dom = modelDom(counts.nodes)
  let pageInMs = null
  let pageInEntries = 0
  let afterEvictionEntries = null
  if (windowed !== null && typeof windowed.baseSeq === 'number') {
    const base = windowed.baseSeq
    const page = events.slice(Math.max(0, base - 3251), base)
    if (page.length > 0 && page[page.length - 1].event.seq === base - 1) {
      const beganPage = now()
      windowed.pageIn(page, true)
      pageInMs = round(now() - beganPage, 2)
      pageInEntries = page.length
      for (let index = 0; index < options.slack + 2; index += 1) appendViaPolicy(events[events.length - 1])
      afterEvictionEntries = windowed.length
    }
  }
  return {
    mode: options.cap === null ? 'baseline' : 'windowed',
    events: events.length,
    replayMs: round(replayMs, 2),
    openingMs,
    dispatch,
    opening: { events: openingEnd, windowEntries: afterOpen.windowEntries, nodes: afterOpen.counts.nodes, openingTailExact },
    trims,
    trimDropped,
    settlementMs: round(settlementMs, 2),
    appended,
    windowEntries,
    windowBytes: Math.round(windowEntries * BYTES_PER_EVENT),
    counts,
    dom,
    heap: memory,
    pageIn: pageInMs === null ? null : { entries: pageInEntries, ms: pageInMs, afterEvictionEntries },
  }
}

/** R495 section 5.2 counterfactual on the real window class: append + read entries every publication. */
function perPublishMaterializeCounterfactual(count) {
  const makeEntry = (seq) => ({ type: 'event', event: { seq, type: 'user/message', time: seq, data: { content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } } } })
  const window = new MutableSessionEventSource()
  const begun = now()
  for (let index = 0; index < count; index += 1) { window.append(makeEntry(index)); window.getSnapshot().entries.length }
  const unbounded = now() - begun
  const ring = []
  const ringBegun = now()
  for (let index = 0; index < count; index += 1) { ring.push(makeEntry(index)); if (ring.length > 500) ring.shift(); ring.slice() }
  const capped = now() - ringBegun
  return { n: count, perPublishMaterializeMs: round(unbounded, 1), ring500Ms: round(capped, 3), ratio: round(unbounded / Math.max(capped, 0.001), 1) }
}

/** Mirrors the patch's optional global policy resolution; absent/malformed => null (stock). */
function resolveLimitPolicy(globalValue) {
  if (globalValue === undefined || globalValue === null || typeof globalValue !== 'object') return null
  const maxEvents = globalValue.maxEvents
  const slackEvents = globalValue.slackEvents
  if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) return null
  if (!Number.isSafeInteger(slackEvents) || slackEvents < 0) return null
  return { maxEvents, slackEvents, trimOpeningPage: globalValue.trimOpeningPage !== false }
}

/**
 * The patch's default-off cost, measured the way the requirement is stated: a microbench in this
 * bundle, trim-off vs baseline, n=20, on the realistic per-append path (source append + the
 * Conversation subscriber + the real assembler), plus bare-append and initialization as
 * lower-bound references.
 *
 * The patch shape measured: appendLive does the stock append, then one guard read
 * (if (limit !== null) maintainWindow()). With no policy configured the branch body never runs,
 * so the delta is one property read + branch per append.
 */
function defaultOffOverhead() {
  const entries = generateEvents(10000).map((entry, index) => ({ type: 'event', event: { seq: index, type: 'user/message', time: index, data: { content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } } } }))
  const stockRuns = []
  const guardedRuns = []
  const pairedDeltas = []
  const limitState = { limit: null }
  const replayOnce = (guarded) => {
    const source = new MutableSessionEventSource()
    const assembler = createAssembler()
    const feed = createFeed(source, assembler)
    const began = now()
    for (const entry of entries) {
      feed.appendEntry(entry)
      if (guarded && limitState.limit !== null) continue
    }
    const elapsed = now() - began
    feed.dispose()
    return elapsed
  }
  replayOnce(false); replayOnce(true) // warmup
  for (let run = 0; run < RUNS_OVERHEAD; run += 1) {
    const stockFirst = run % 2 === 0
    const stockTime = stockFirst ? replayOnce(false) : undefined
    const guardedTime = replayOnce(true)
    const laterStock = stockFirst ? undefined : replayOnce(false)
    const stock = stockFirst ? stockTime : laterStock
    stockRuns.push(stock)
    guardedRuns.push(guardedTime)
    pairedDeltas.push(guardedTime - stock)
  }
  // Bare-append lower bound (no subscriber, no assembler) for context.
  const bareStock = []
  const bareGuarded = []
  const bareEntries = entries
  for (let run = 0; run < RUNS_OVERHEAD; run += 1) {
    let source = new MutableSessionEventSource()
    let began = now()
    for (const entry of bareEntries) source.append(entry)
    bareStock.push(now() - began)
    source = new MutableSessionEventSource()
    began = now()
    for (const entry of bareEntries) { source.append(entry); if (limitState.limit !== null) continue }
    bareGuarded.push(now() - began)
  }
  const initStock = []
  const initGuarded = []
  for (let run = 0; run < RUNS_OVERHEAD; run += 1) {
    let began = now()
    new MutableSessionEventSource()
    initStock.push(now() - began)
    began = now()
    resolveLimitPolicy(undefined)
    new TailWindow(new MutableSessionEventSource(), new TailWindowPolicy({ windowEvents: 500, slackEvents: 125 }))
    initGuarded.push(now() - began)
  }
  const stockP50 = p50(stockRuns)
  const guardedP50 = p50(guardedRuns)
  return {
    runs: RUNS_OVERHEAD,
    appendsPerRun: entries.length,
    path: 'source append + Conversation subscriber + real assembler',
    stockP50Ms: round(stockP50, 3),
    guardedP50Ms: round(guardedP50, 3),
    pairedDeltaP50Ms: round(p50(pairedDeltas), 4),
    regressionMs: round(guardedP50 - stockP50, 4),
    regressionPct: round(((guardedP50 - stockP50) / stockP50) * 100, 2),
    bareAppend: {
      stockP50Ms: round(p50(bareStock), 3),
      guardedP50Ms: round(p50(bareGuarded), 3),
      regressionMs: round(p50(bareGuarded) - p50(bareStock), 4),
      regressionPct: round(((p50(bareGuarded) - p50(bareStock)) / p50(bareStock)) * 100, 2),
    },
    initStockP50Ms: round(p50(initStock), 5),
    initGuardedP50Ms: round(p50(initGuarded), 5),
  }
}

/**
 * Isolated default-off branch cost: the patch adds one window-limit read and branch after the
 * stock append. This measures exactly that against the same loop with no guard, heavily repeated
 * (50 runs x 10k), so machine noise can be separated from the guard.
 */
function isolatedGuardOverhead() {
  const entries = Array.from({ length: 10000 }, (_, index) => ({ type: 'event', event: { seq: index, type: 'user/message', time: index, data: {} } }))
  const state = { limit: null }
  const stock = []
  const guarded = []
  const run = (withGuard) => {
    const source = new MutableSessionEventSource()
    const began = now()
    for (const entry of entries) {
      source.append(entry)
      if (withGuard && state.limit !== null) continue
    }
    return now() - began
  }
  run(false); run(true)
  for (let index = 0; index < 50; index += 1) {
    const stockFirst = index % 2 === 0
    const first = run(false)
    const second = run(true)
    stock.push(stockFirst ? first : run(false))
    guarded.push(second)
  }
  const stockP50 = p50(stock)
  const guardedP50 = p50(guarded)
  return {
    runs: 50,
    appendsPerRun: entries.length,
    stockP50Ms: round(stockP50, 3),
    guardedP50Ms: round(guardedP50, 3),
    regressionMs: round(guardedP50 - stockP50, 4),
    regressionPct: round(((guardedP50 - stockP50) / stockP50) * 100, 3),
  }
}

/* ---------------------------------------------------------------- invariants */

function contiguous(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].event.seq !== entries[index - 1].event.seq + 1) return false
  }
  return true
}

function checkInvariants(size) {
  const events = generateEvents(size)
  const cap = 500
  const slack = 125
  const opening = events.slice(0, Math.min(PAGE_EVENTS, events.length))
  const live = events.slice(opening.length)
  const source = new MutableSessionEventSource()
  const assembler = createAssembler()
  const feed = createFeed(source, assembler)
  const windowed = new TailWindow(source, new TailWindowPolicy({ windowEvents: cap, slackEvents: slack }))
  const failures = []
  let checks = 0
  const expect = (id, ok, detail) => { checks += 1; if (!ok) failures.push({ id, detail }) }
  expect('I1-absent-policy-is-off', resolveLimitPolicy(undefined) === null, 'absent global resolves to null (stock)')
  expect('I1-invalid-policy-is-off', resolveLimitPolicy({ maxEvents: -1 }) === null && resolveLimitPolicy({ maxEvents: 10, slackEvents: -1 }) === null, 'malformed policy falls back to off')
  feed.install(opening, true)
  windowed.install(opening, true)
  expect('I2-opening-tail-exact', jsonOf(windowTreeEntries(source)) === jsonOf(opening.slice(-windowed.length)), 'opening trim keeps the exact tail')
  expect('I3-opening-baseSeq', windowed.baseSeq === opening[opening.length - windowed.length].event.seq, 'baseSeq = first retained seq after opening trim')
  expect('I3-opening-hasMore', windowed.hasMore === true, 'hasMore stays true after a prefix trim')
  const foldPolicy = windowed.windowPolicy
  foldPolicy.setFold('turn-a', true)
  foldPolicy.setFold('turn-b', false)
  foldPolicy.setFold('turn-c', true)
  const foldDropped = foldPolicy.retainFolds(['turn-a', 'turn-c'])
  expect('I6-folds-retained', foldPolicy.foldOf('turn-a') === true && foldPolicy.foldOf('turn-c') === true && foldPolicy.foldOf('turn-b') === undefined && foldDropped === 1, 'retainFolds keeps retained keys and drops the rest')
  let trims = 0
  for (const entry of live) {
    if (entry.event.type === 'assistant/message') {
      feed.appendEntry(transientEntry(entry.event.data.attemptId, entry.event.seq, entry.event.data.turn, entry.event.data.step, 1))
      feed.settleAssistant(entry.event.data.attemptId, { type: 'event', event: entry.event })
      continue
    }
    const before = windowTreeEntries(source)
    const decision = windowed.appendLive(entry, false)
    if (decision === null) continue
    trims += 1
    const after = windowTreeEntries(source)
    const expectedTail = [...before, entry].slice(-cap)
    expect('I2-trim-tail-exact@' + String(trims), jsonOf(after) === jsonOf(expectedTail), 'trim retained the exact last cap entries (append included)')
    expect('I4-contiguous@' + String(trims), contiguous(after), 'retained window stays seq-contiguous')
    expect('I3-trim-baseSeq@' + String(trims), windowed.baseSeq === after[0].event.seq, 'baseSeq = first retained seq after trim')
    expect('I3-trim-hasMore@' + String(trims), windowed.hasMore === true, 'hasMore true after trim')
    expect('I5-prefix-only@' + String(trims), expectedTail[0].event.seq === after[0].event.seq && after[after.length - 1].event.seq === entry.event.seq, 'only a prefix is dropped, tail seq preserved')
    if (trims >= 3) break
  }
  expect('I5-trims-happened', trims >= 1, String(trims) + ' trims observed')
  expect('I7-final-window-bounded', windowed.length <= cap + slack, 'window length ' + String(windowed.length) + ' <= ' + String(cap + slack))
  const base = windowed.baseSeq
  const page = events.slice(Math.max(0, base - 800), base)
  windowed.pageIn(page, true)
  const afterPageIn = windowTreeEntries(source)
  expect('I4-pagein-contiguous', contiguous(afterPageIn), 'page-in joins the retained window contiguously')
  expect('I4-pagein-length', afterPageIn.length >= page.length, 'page-in prepended ' + String(page.length) + ' entries')
  let fillerSeq = events.length
  for (let index = 0; index < slack + 2; index += 1) {
    fillerSeq += 1
    windowed.appendLive({ type: 'event', event: { seq: fillerSeq, type: 'system/message', time: fillerSeq, data: {} } }, false)
  }
  expect('I8-old-page-evicted', windowed.length <= cap + slack, 'window bounded again after old-page appends')
  expect('I5-no-duplicate-seq', new Set(windowTreeEntries(source).map((entry) => entry.event.seq)).size === windowed.length, 'retained seqs unique')
  feed.dispose()
  return { size, checks, failures, trims, windowEntries: windowed.length, pages: 1 }
}

/* ---------------------------------------------------------------- main */

const report = {
  format: 'dsh-link.chat-window-bench/1',
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, gc: typeof globalThis.gc === 'function' },
  command: 'node --experimental-transform-types --expose-gc plugins/dsh-link-chat-window/bench/window-bench.mjs',
  calibration: CALIBRATION,
  sizes: SIZES,
  results: [],
  invariants: [],
  counterfactual: null,
  counterfactual50k: null,
  defaultOff: null,
  defaultOffIsolated: null,
}

for (const size of SIZES) {
  const events = generateEvents(size)
  const baseline = replay(events, { cap: null, slack: 0 })
  const windowed = replay(events, { cap: 500, slack: 125 })
  const nodesRatio = (baseline.counts.nodes ?? 0) / Math.max(windowed.counts.nodes ?? 1, 1)
  const domRatio = baseline.dom.total / Math.max(windowed.dom.total, 1)
  const heapRatio = baseline.heap === null || windowed.heap === null ? null : round(baseline.heap.heapUsedMb / Math.max(windowed.heap.heapUsedMb, 0.1), 1)
  report.results.push({ size, baseline, windowed, ratios: { windowEntries: round(baseline.windowEntries / Math.max(windowed.windowEntries, 1), 1), nodes: round(nodesRatio, 1), dom: round(domRatio, 1), heap: heapRatio, settlement: round(baseline.settlementMs / Math.max(windowed.settlementMs, 0.01), 1), windowBytes: round(baseline.windowBytes / Math.max(windowed.windowBytes, 1), 1) } })
  report.invariants.push(checkInvariants(size))
  const entriesRatio = round(baseline.windowEntries / Math.max(windowed.windowEntries, 1), 1)
  console.log('[' + String(size) + '] baseline window=' + String(baseline.windowEntries) + ' nodes=' + String(baseline.counts.nodes) + ' replay=' + String(baseline.replayMs) + 'ms settle=' + String(baseline.settlementMs) + 'ms | windowed window=' + String(windowed.windowEntries) + ' nodes=' + String(windowed.counts.nodes) + ' replay=' + String(windowed.replayMs) + 'ms settle=' + String(windowed.settlementMs) + 'ms | ratio entries=' + String(entriesRatio) + ' nodes=' + String(round(nodesRatio, 1)) + ' dom=' + String(round(domRatio, 1)) + ' heap=' + String(heapRatio))
}

report.counterfactual = perPublishMaterializeCounterfactual(10000)
report.counterfactual50k = perPublishMaterializeCounterfactual(50000)
report.defaultOff = defaultOffOverhead()
report.defaultOffIsolated = isolatedGuardOverhead()
console.log('counterfactual 10k:', JSON.stringify(report.counterfactual))
console.log('counterfactual 50k:', JSON.stringify(report.counterfactual50k))
console.log('default-off overhead:', JSON.stringify(report.defaultOff))
console.log('default-off isolated:', JSON.stringify(report.defaultOffIsolated))
for (const invariant of report.invariants) console.log('invariants n=' + String(invariant.size) + ': ' + (invariant.failures.length === 0 ? 'PASS ' + String(invariant.checks) + ' checks' : 'FAIL ' + JSON.stringify(invariant.failures)))
writeFileSync(join(HERE, 'results.json'), JSON.stringify(report, null, 2) + '\n')
console.log('wrote bench/results.json')
