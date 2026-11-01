#!/usr/bin/env node
/**
 * R501 default-off paired microbench on the LIVE page, real client bundle:
 *   shape 'source+subscriber+assembler': appending to the real Session event source runs the real
 *   Conversation binding subscriber -> ConversationNodeAssembler per append, exactly the patched
 *   path. The guarded arm adds the patch's one guard (windowLimit read + branch) after each append.
 *
 * n>=24 interleaved pairs, 2000 appends per arm; the window is restored between arms so both see
 * the same state. Statistical report: p50/mean/stdev/IQR of the paired delta.
 *
 *   node plugins/dsh-link-chat-window/tools/gate-microbench.mjs [--port=9222] [--runs=24] [--appends=2000]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER_SRC = readFileSync(join(HERE, 'probes', '24-helpers.js'), 'utf8')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find(argument => argument === name || argument.startsWith(name + '='))
  if (hit === undefined) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : args[args.indexOf(hit) + 1]
}
const port = Number(flag('--port', '9222'))
const RUNS = Number(flag('--runs', '24'))
const APPENDS = Number(flag('--appends', '2000'))
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const cdp = await connect({ port })
const evaluate = async (expression) => cdp.evaluate(expression)
const waitFor = async (expression, timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(expression) === true) return true } catch (error) { /* navigating */ }
    await sleep(250)
  }
  return false
}
const result = { format: 'dsh-link.chat-window-live-microbench/1', runs: RUNS, appendsPerArm: APPENDS, recordedAt: new Date().toISOString() }
try {
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.call('Page.reload', { ignoreCache: false })
  await sleep(1200)
  await waitFor('document.readyState === \'complete\' && !!globalThis.__dshSessionNav && (document.querySelector(\'#root\')?.childElementCount ?? 0) > 0', 40000)
  await evaluate(HELPER_SRC)
  // Make sure a session with an open event window is current, and the policy is off.
  let ready = await evaluate('__r493.windowInfo().binding === true')
  if (!ready) {
    await evaluate(`__r493.openSession(${JSON.stringify(flag('--session', 'session-<example>'))})`)
    ready = await evaluate('__r493.windowInfo().binding === true')
  }
  await evaluate('__r493.clearPolicy()')
  result.precondition = await evaluate('({ info: __r493.windowInfo(), dom: __r493.dom() })')
  const bench = await evaluate(`(async () => {
    const { binding } = __r493.current()
    if (binding === undefined) return { error: 'no binding' }
    const source = binding.eventSource
    const session = binding.session
    const saved = source.getSnapshot().entries
    const hasMore = source.getSnapshot().hasMore
    const restore = () => { source.replace(saved, hasMore) }
    let lastSeq = saved[saved.length - 1]?.event.seq ?? 0
    const makeEntries = (count) => {
      const entries = []
      for (let index = 0; index < count; index += 1) {
        lastSeq += 1
        entries.push({ type: 'event', event: { seq: lastSeq, type: 'system/message', time: Date.now(), data: {} } })
      }
      return entries
    }
    const pairEntries = makeEntries(${RUNS} * ${APPENDS} * 2)
    const stock = []
    const guarded = []
    const paired = []
    let cursor = 0
    for (let run = 0; run < ${RUNS}; run += 1) {
      const stockFirst = run % 2 === 0
      const runArm = (withGuard) => {
        restore()
        const began = performance.now()
        for (let index = 0; index < ${APPENDS}; index += 1) {
          source.append(pairEntries[cursor])
          cursor += 1
          if (withGuard && session.windowLimit !== null) session.maintainEventWindow()
        }
        const elapsed = performance.now() - began
        return elapsed
      }
      const first = stockFirst ? runArm(false) : runArm(true)
      const second = stockFirst ? runArm(true) : runArm(false)
      const stockTime = stockFirst ? first : second
      const guardedTime = stockFirst ? second : first
      stock.push(stockTime)
      guarded.push(guardedTime)
      paired.push(guardedTime - stockTime)
    }
    restore()
    const round = (value) => Math.round(value * 1000) / 1000
    const sorted = (values) => values.slice().sort((left, right) => left - right)
    const p50 = (values) => sorted(values)[Math.floor(values.length / 2)]
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
    const stdev = (values) => { const center = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - center) * (value - center), 0) / Math.max(1, values.length - 1)) }
    const iqr = (values) => { const sortedValues = sorted(values); return sortedValues[Math.floor(sortedValues.length * 0.75)] - sortedValues[Math.floor(sortedValues.length * 0.25)] }
    const deltaP50 = p50(paired)
    return {
      runs: ${RUNS}, appendsPerArm: ${APPENDS},
      stockP50Ms: round(p50(stock)),
      guardedP50Ms: round(p50(guarded)),
      deltaP50Ms: round(deltaP50),
      deltaPctOfStockP50: round(deltaP50 / p50(stock) * 100),
      deltaMeanMs: round(mean(paired)),
      deltaStdevMs: round(stdev(paired)),
      deltaIqrMs: round(iqr(paired)),
      deltaMinMs: round(Math.min(...paired)),
      deltaMaxMs: round(Math.max(...paired)),
      perAppendNsP50: round(deltaP50 * 1e6 / ${APPENDS}),
      per10kMsP50: round(deltaP50 * 10000 / ${APPENDS}),
      stockIqrMs: round(iqr(stock)),
      guardedIqrMs: round(iqr(guarded)),
      threshold: { pct: 2, per10kMs: 0.05 },
      passPct: deltaP50 / p50(stock) * 100 < 2,
      passPer10k: deltaP50 * 10000 / ${APPENDS} < 0.05,
    }
  })()`)
  result.bench = bench
} catch (error) {
  result.error = String(error && error.stack || error)
} finally {
  try { await cdp.call('Emulation.clearDeviceMetricsOverride') } catch (error) { /* best effort */ }
  try { await cdp.call('Page.reload', { ignoreCache: false }) } catch (error) { /* best effort */ }
  writeFileSync(join(HERE, 'results', 'live-microbench.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  cdp.close()
}
