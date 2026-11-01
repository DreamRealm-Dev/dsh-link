#!/usr/bin/env node
/** Diagnose window/paging after synthetic live appends (are seq gaps an artifact of synthetic seqs?). */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER_SRC = readFileSync(join(HERE, 'probes', '24-helpers.js'), 'utf8')
const LEAD = 'session-<example>'
const AWAY = 'session-<example>'
const cdp = await connect({ port: 9222 })
const evaluate = (expression) => cdp.evaluate(expression)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cdp.call('Page.reload', { ignoreCache: false })
await sleep(1500)
for (let attempt = 0; attempt < 120; attempt += 1) {
  try { if (await evaluate("document.readyState === 'complete' && !!globalThis.__dshSessionNav && (document.querySelector('#root')?.childElementCount ?? 0) > 0") === true) break } catch (error) { /* navigating */ }
  await sleep(250)
}
await evaluate(HELPER_SRC)
const away = await evaluate('__r493.openSession(' + JSON.stringify(AWAY) + ')')
const policy = await evaluate('__r493.setPolicy(500, 125, true)')
const open = await evaluate('__r493.openSession(' + JSON.stringify(LEAD) + ', 60000)')
const seqDump = `(() => {
  const { binding } = __r493.current()
  const entries = binding.eventSource.getSnapshot().entries
  const seqs = entries.map(entry => entry.event.seq)
  const gaps = []
  for (let index = 1; index < seqs.length; index += 1) if (seqs[index] !== seqs[index - 1] + 1) gaps.push({ index, previous: seqs[index - 1], next: seqs[index] })
  return { count: seqs.length, first: seqs.slice(0, 4), last: seqs.slice(-4), gaps: gaps.slice(0, 12), baseSeq: binding.session.baseSeq, hasMore: binding.session.getSnapshot().hasMore }
})()`
const steps = []
steps.push({ step: 'open', info: await evaluate(seqDump) })
steps.push({ step: 'loadOlder-1', result: await evaluate('__r493.loadOlder()'), dump: await evaluate(seqDump) })
steps.push({ step: 'loadOlder-2', result: await evaluate('__r493.loadOlder()'), dump: await evaluate(seqDump) })
const appendOne = await evaluate(`(() => {
  const { binding } = __r493.current()
  const entries = binding.eventSource.getSnapshot().entries
  const lastSeq = entries[entries.length - 1].event.seq
  binding.eventSource.append({ type: 'event', event: { seq: lastSeq + 1, type: 'system/message', time: Date.now(), data: {} } })
  const applied = binding.session.maintainEventWindow()
  return { applied, info: __r493.windowInfo() }
})()`)
steps.push({ step: 'append1+maintain-after-pages', result: appendOne, dump: await evaluate(seqDump) })
console.log(JSON.stringify({ away, policy, open, steps }, null, 2))
await cdp.call('Emulation.clearDeviceMetricsOverride')
await cdp.call('Page.reload', { ignoreCache: false })
cdp.close()
