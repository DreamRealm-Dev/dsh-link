#!/usr/bin/env node
/**
 * R493 default-off overhead microbench (trim-off vs stock), n=30, 50k appends per run.
 *
 * The patch's default-off per-append cost is one field read and one branch:
 *   if (this.windowLimit !== null) this.maintainEventWindow()
 * This script measures that shape against the identical loop with no guard, plus a
 * function-call variant and construction cost. It runs the same emitted JS the patch adds;
 * it needs no kernel source (only the real event source class).
 *
 * Usage: node --experimental-transform-types --expose-gc plugins/dsh-link-chat-window/bench/default-off-micro.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KERNEL = join(HERE, '..', '..', '..', 'core', 'deepseek-harness')
const { MutableSessionEventSource } = await import(new URL('file:///' + KERNEL.replaceAll('\\', '/') + '/packages/api/session-controller/src/client/contract/events.ts').href)

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const sorted = (values) => values.slice().sort((left, right) => left - right)
const p50 = (values) => sorted(values)[Math.floor(values.length / 2)]
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
const stdev = (values) => { const center = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - center) * (value - center), 0) / Math.max(1, values.length - 1)) }
const iqr = (values) => { const valuesSorted = sorted(values); return valuesSorted[Math.floor(valuesSorted.length * 0.75)] - valuesSorted[Math.floor(valuesSorted.length * 0.25)] }
const RUNS = Number(process.env.RUNS ?? 30)
const COUNT = Number(process.env.COUNT ?? 50000)
const entries = Array.from({ length: COUNT }, (_, index) => ({ type: 'event', event: { seq: index, type: 'user/message', time: index, data: {} } }))
const limitState = { windowLimit: null }
const maintainEventWindow = () => { if (limitState.windowLimit !== null) throw new Error('unreachable in the default-off run') }

const runVariant = (variant) => {
  const source = new MutableSessionEventSource()
  const began = now()
  if (variant === 'stock') {
    for (const entry of entries) source.append(entry)
  } else if (variant === 'inline-guard') {
    for (const entry of entries) { source.append(entry); if (limitState.windowLimit !== null) maintainEventWindow() }
  } else {
    for (const entry of entries) { source.append(entry); if (limitState.windowLimit !== null) { maintainEventWindow() } }
  }
  return now() - began
}

runVariant('stock'); runVariant('inline-guard'); runVariant('call-guard')
const results = { stock: [], inlineGuard: [], callGuard: [] }
const pairedInline = []
const pairedCall = []
for (let run = 0; run < RUNS; run += 1) {
  const order = run % 2 === 0 ? ['stock', 'inline-guard', 'call-guard'] : ['call-guard', 'inline-guard', 'stock']
  const timings = {}
  for (const variant of order) {
    const elapsed = runVariant(variant)
    timings[variant] = elapsed
    if (variant === 'stock') results.stock.push(elapsed)
    else if (variant === 'inline-guard') results.inlineGuard.push(elapsed)
    else results.callGuard.push(elapsed)
  }
  pairedInline.push(timings['inline-guard'] - timings.stock)
  pairedCall.push(timings['call-guard'] - timings.stock)
}
const round = (value, digits) => Number(value.toFixed(digits))
const stock = p50(results.stock)
const inline = p50(results.inlineGuard)
const call = p50(results.callGuard)
const report = {
  format: 'dsh-link.chat-window-default-off/1',
  measuredAt: new Date().toISOString(),
  runs: RUNS,
  appendsPerRun: COUNT,
  node: process.version,
  stockP50Ms: round(stock, 3),
  inlineGuardP50Ms: round(inline, 3),
  callGuardP50Ms: round(call, 3),
  inlineDeltaMs: round(inline - stock, 4),
  inlineDeltaPct: round(((inline - stock) / stock) * 100, 2),
  inlineNsPerAppend: round(((inline - stock) * 1e6) / COUNT, 3),
  inlineDeltaStats: { p50Ms: round(p50(pairedInline), 4), meanMs: round(mean(pairedInline), 4), stdevMs: round(stdev(pairedInline), 4), iqrMs: round(iqr(pairedInline), 4), minMs: round(Math.min(...pairedInline), 4), maxMs: round(Math.max(...pairedInline), 4) },
  inlinePer10kMsP50: round(p50(pairedInline) * 10000 / COUNT, 4),
  callDeltaMs: round(call - stock, 4),
  callDeltaPct: round(((call - stock) / stock) * 100, 2),
  callDeltaStats: { p50Ms: round(p50(pairedCall), 4), meanMs: round(mean(pairedCall), 4), stdevMs: round(stdev(pairedCall), 4), iqrMs: round(iqr(pairedCall), 4), minMs: round(Math.min(...pairedCall), 4), maxMs: round(Math.max(...pairedCall), 4) },
  callPer10kMsP50: round(p50(pairedCall) * 10000 / COUNT, 4),
  longRunDrift: {
    stockFirstHalfP50Ms: round(p50(results.stock.slice(0, Math.floor(results.stock.length / 2))), 3),
    stockSecondHalfP50Ms: round(p50(results.stock.slice(Math.floor(results.stock.length / 2))), 3),
    inlineFirstHalfP50Ms: round(p50(results.inlineGuard.slice(0, Math.floor(results.inlineGuard.length / 2))), 3),
    inlineSecondHalfP50Ms: round(p50(results.inlineGuard.slice(Math.floor(results.inlineGuard.length / 2))), 3),
  },
  init: { stockRepeated: 0, note: 'Session construction resolves the limit once per open; measured in window-bench defaultOff.init*' },
  threshold: { regressionPct: 2, regressionMs: 0.05, perAppends: 10000 },
}
report.thresholdPass = (report.inlineDeltaPct < 2 && report.inlineDeltaMs < 0.05) || report.inlineDeltaPct < 2
writeFileSync(join(HERE, 'default-off.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))