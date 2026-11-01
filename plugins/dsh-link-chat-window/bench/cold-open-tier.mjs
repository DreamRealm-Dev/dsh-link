#!/usr/bin/env node
/**
 * R493 cold-open tier: the client-side install cost of one opening history page, before and after
 * the R501 window policy. It exists to draw the benefit boundary Lead asked for in R500:
 * R501 fixes the live tail / old-page eviction; it does NOT fix the server's cold open (one cold
 * page hydrates the whole JSONL log: R500 measured 100k events 0.38-0.55 s, 1M 3.26-3.61 s /
 * RSS +460-726 MB; a same-revision second page 3.1-5.1 ms, invalidated by the next append).
 *
 * What is measured here is only the client half: the real ConversationNodeAssembler window
 * replacement on a page of N events, with and without the opening second truncation. The server
 * hydrate cost is not reproducible in-process from the client package and is cited from R500.
 *
 * Usage: node --experimental-transform-types --expose-gc plugins/dsh-link-chat-window/bench/cold-open-tier.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const KERNEL = join(HERE, '..', '..', '..', 'core', 'deepseek-harness')
const kernelUrl = (relative) => new URL('file:///' + KERNEL.replaceAll('\\', '/') + '/' + relative).href
const pluginUrl = (relative) => new URL('file:///' + PLUGIN.replaceAll('\\', '/') + '/' + relative).href
globalThis.window = globalThis
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }
globalThis.window.__ModuleLoader__ = { load() {} }

const { MutableSessionEventSource } = await import(kernelUrl('packages/api/session-controller/src/client/contract/events.ts'))
const { ConversationNodeAssembler } = await import(kernelUrl('packages/client/ui-conversation/src/client/conversation/assembler.ts'))
const { TailWindow } = await import(pluginUrl('src/tail-window.ts'))
const { TailWindowPolicy } = await import(pluginUrl('src/policy.ts'))
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const p50 = (values) => values.slice().sort((left, right) => left - right)[Math.floor(values.length / 2)]
const round = (value, digits) => Number(value.toFixed(digits))

const entry = (seq) => ({ type: 'event', event: { seq, type: seq % 40 === 0 ? 'user/message' : seq % 13 === 0 ? 'step/start' : seq % 13 === 1 ? 'step/end' : 'assistant/message', time: 1760000000000 + seq, data: seq % 40 === 0 ? { content: [], source: { kind: 'user' } } : seq % 13 === 0 ? { turn: Math.floor(seq / 300) + 1, step: (seq % 300) + 1 } : seq % 13 === 1 ? { turn: Math.floor(seq / 300) + 1, step: Math.floor((seq % 300) / 2) + 1 } : { turn: Math.floor(seq / 300) + 1, step: Math.floor((seq % 300) / 2) + 1, attemptId: 'a' + String(seq), text: 'x'.repeat(120) } } })
const definitions = {
  entries: () => [
    { kind: 'step', target: 'chat', match(event) { return event.type === 'step/start' ? { id: 's' + String(event.data.turn) + ':' + String(event.data.step), role: 'start' } : event.type === 'step/end' ? { id: 's' + String(event.data.turn) + ':' + String(event.data.step), role: 'update' } : null }, start() { return { n: 1 } }, update(state) { return state }, buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'step' } } },
    { kind: 'user', target: 'chat', match(event) { return event.type === 'user/message' ? { id: 'u' + String(event.seq), role: 'start' } : null }, start() { return { n: 1 } }, update(state) { return state }, buildViewNode(context) { return context.start === undefined ? null : { key: context.key, target: 'chat', anchorSeq: context.start.event.seq, kind: 'user' } } },
  ],
  fallbackEntry: () => undefined,
}
const views = { entries: () => [{ target: 'chat', create: () => { let rows = new Map(); return { empty: 0, replace(input) { rows = new Map(input.nodes.map((node) => [node.key, node])); return rows.size }, apply(input) { for (const node of input.upserts) rows.set(node.key, node); return rows.size }, publish() {} } } }] }

function installCost(page, cap) {
  const source = new MutableSessionEventSource()
  const assembler = new ConversationNodeAssembler(definitions, views)
  assembler.activateTarget('chat')
  const feed = (() => {
    let revision = -1
    let flushes = 0
    const dispatch = () => {
      const window = source.getSnapshot()
      if (window.revision === revision) return
      if (window.revision !== revision + 1 || window.change.kind === 'replace') { revision = window.revision; assembler.replaceWindow(window.entries, window.hasMore); assembler.flush(); flushes += 1; return }
      revision = window.revision
      const change = window.change
      if (change.kind === 'append') { for (const item of change.entries) assembler.append(item); assembler.flush() }
    }
    const stop = source.subscribe(dispatch)
    return { stop }
  })()
  const windowed = cap === null ? null : new TailWindow(source, new TailWindowPolicy({ windowEvents: cap, slackEvents: 125 }))
  const began = now()
  source.replace(page, true)
  if (windowed !== null) windowed.install(page, true)
  assembler.flush()
  const ms = now() - began
  feed.stop()
  const inputs = Object.getOwnPropertyDescriptor(assembler, 'inputs')
  return { ms, assemblerInputs: inputs === undefined || inputs.value === undefined ? null : inputs.value.size, windowEntries: windowed === null ? page.length : windowed.length }
}

const sizes = [162, 1624, 3251]
const runs = 10
const tiers = []
for (const size of sizes) {
  const page = Array.from({ length: size }, (_, index) => entry(index))
  installCost(page, null)
  installCost(page, 500)
  const baseline = []
  const windowed = []
  for (let run = 0; run < runs; run += 1) {
    baseline.push(installCost(page, null).ms)
    windowed.push(installCost(page, 500).ms)
  }
  const baselineP50 = p50(baseline)
  const windowedP50 = p50(windowed)
  tiers.push({ pageEvents: size, runs, baselineP50Ms: round(baselineP50, 3), windowedP50Ms: round(windowedP50, 3), deltaMs: round(windowedP50 - baselineP50, 3), note: 'client-side install only; the server cold hydrate is outside this process' })
}
const report = {
  format: 'dsh-link.chat-window-cold-open/1',
  measuredAt: new Date().toISOString(),
  node: process.version,
  clientInstall: tiers,
  serverSeamReference: {
    source: 'R500 (physical-laziness gap)',
    coldPage100k: { wallMs: [380, 550], preparedSeedEvents: 100003, returnedPageEvents: [1621, 1624], returnedBytes: [398 * 1024, 401 * 1024] },
    coldPage1m: { wallMs: [3260, 3610], rssDeltaMb: [460, 726] },
    sameRevisionSecondPageMs: [3.1, 5.1],
    invalidatedBy: 'revision change after append',
    realClientOpeningTurnWindow: { events: 162, bytes: 39.5 * 1024, turnWindow: { minMessages: 50, minTurns: 2 } },
    heavyPage: { bytes: 949 * 1024 },
    clientPatchFixesColdOpen: false,
    seamBenefitCeiling: [337, 361],
  },
  verdict: 'R501 changes only the client live tail and old-page eviction. The cold-open term is unchanged in both columns above and stays a server/seam (R494/R500) concern.',
}
writeFileSync(join(HERE, 'cold-open.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
