#!/usr/bin/env node
/**
 * R501 P1 scenarios (scoped, per-step timeouts): trimOpeningPage:false no-hole evidence,
 * live-trim hole evidence, old-page-reading anchor jump quantification, bottom-follow trim.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
const withTimeout = (promise, timeoutMs, label) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout: ' + label)), timeoutMs))])
const step = (label, expression, timeoutMs = 30000) => withTimeout(evaluate(expression), timeoutMs, label)
const waitFor = async (expression) => { for (let attempt = 0; attempt < 120; attempt += 1) { try { if (await evaluate(expression) === true) return true } catch (error) { /* navigating */ } await sleep(250) } return false }
const reloadAndOpen = async (trimOpeningPage) => {
  await step('reload', 'location.reload()', 10000).catch(() => {})
  await sleep(1500)
  await waitFor("document.readyState === 'complete' && !!globalThis.__dshSessionNav && (document.querySelector('#root')?.childElementCount ?? 0) > 0")
  await step('inject', HELPER_SRC, 30000)
  await step('mounted', '__r493.ensureMounted()', 20000)
  await step('away', '__r493.openSession(' + JSON.stringify(AWAY) + ', 60000)', 70000)
  const policy = await step('policy', '__r493.setPolicy(500,125,' + trimOpeningPage + ')', 10000)
  const open = await step('open-target', '__r493.openSession(' + JSON.stringify(LEAD) + ', 60000)', 70000)
  return { policy, open, info: await step('info', '__r493.windowInfo()', 10000) }
}
const seqDump = `(() => {
  const { binding } = __r493.current()
  const entries = binding.eventSource.getSnapshot().entries
  const seqs = entries.map(entry => entry.event.seq)
  const gaps = []
  for (let index = 1; index < seqs.length; index += 1) if (seqs[index] !== seqs[index - 1] + 1) gaps.push({ index, previous: seqs[index - 1], next: seqs[index], missing: seqs[index] - seqs[index - 1] - 1 })
  return { count: seqs.length, first: seqs[0], last: seqs[seqs.length - 1], gaps: gaps.slice(0, 12), gapTotal: gaps.reduce((sum, gap) => sum + gap.missing, 0), contiguous: gaps.length === 0, baseSeq: binding.session.baseSeq, hasMore: binding.session.getSnapshot().hasMore }
})()`
const appendOne = `(() => {
  const { binding } = __r493.current()
  const entries = binding.eventSource.getSnapshot().entries
  const lastSeq = entries[entries.length - 1].event.seq
  binding.eventSource.append({ type: 'event', event: { seq: lastSeq + 1, type: 'system/message', time: Date.now(), data: {} } })
  binding.session.maintainEventWindow()
  return __r493.windowInfo()
})()`
const results = { format: 'dsh-link.chat-window-p1-scenarios/2', recordedAt: new Date().toISOString() }
try {
  // A2: trimOpeningPage:false -> loadOlder must be hole-free
  const untrimmed = await reloadAndOpen(false)
  results.untrimmed = { openInfo: untrimmed.info, openDump: await step('dump', seqDump, 10000) }
  results.untrimmed.loadOlder = await step('loadOlder', '__r493.loadOlder().then(() => ' + JSON.stringify(seqDump) + ')', 30000)
  // live trim (mid-message) -> next loadOlder
  results.untrimmed.appendOne = await step('appendOne', appendOne, 15000)
  results.untrimmed.afterLiveTrimDump = await step('dump', seqDump, 10000)
  results.untrimmed.loadOlderAfterTrim = await step('loadOlder', '__r493.loadOlder().then(() => ' + JSON.stringify(seqDump) + ')', 30000)
  // B: old-page reading anchor quantification
  const reading = await reloadAndOpen(false)
  results.oldPage = { openInfo: reading.info }
  results.oldPage.loadedDump = await step('loadOlder', '__r493.loadOlder().then(() => ' + JSON.stringify(seqDump) + ')', 30000)
  await step('scroll', '(() => { const dom = __r493.dom(); __r493.scrollTo(Math.round(dom.scrollHeight * 0.42)); return true })()', 10000)
  await step('settle', '__r493.settle()', 30000)
  results.oldPage.before = await step('before', '({ anchor: __r493.anchorAtViewport(90), dom: __r493.dom(), info: __r493.windowInfo(), folds: __r493.foldState().length })', 15000)
  results.oldPage.appendOne = await step('appendOne', appendOne, 15000)
  await step('settle', '__r493.settle()', 30000)
  results.oldPage.after = await step('after', '({ anchor: __r493.anchorAtViewport(90), dom: __r493.dom(), info: __r493.windowInfo(), folds: __r493.foldState().length })', 15000)
  results.oldPage.anchorJumped = results.oldPage.before.anchor !== null && results.oldPage.after.anchor !== null && results.oldPage.before.anchor.text !== results.oldPage.after.anchor.text
  // C: bottom-follow trim while following
  const follow = await reloadAndOpen(false)
  results.bottomFollow = { openInfo: follow.info }
  results.bottomFollow.loadedDump = await step('loadOlder', '__r493.loadOlder().then(() => ' + JSON.stringify(seqDump) + ')', 30000)
  await step('scrollBottom', '__r493.scrollTo("bottom")', 10000)
  await step('settle', '__r493.settle()', 30000)
  results.bottomFollow.before = await step('before', '({ anchor: __r493.anchorAtViewport(0), dom: __r493.dom(), info: __r493.windowInfo() })', 15000)
  results.bottomFollow.appendOne = await step('appendOne', appendOne, 15000)
  await step('settle', '__r493.settle()', 30000)
  results.bottomFollow.after = await step('after', '({ anchor: __r493.anchorAtViewport(0), dom: __r493.dom(), info: __r493.windowInfo() })', 15000)
} catch (error) {
  results.error = String(error && error.stack || error)
} finally {
  try { await cdp.call('Emulation.clearDeviceMetricsOverride') } catch (error) { /* best effort */ }
  try { await cdp.call('Page.reload', { ignoreCache: false }) } catch (error) { /* best effort */ }
  writeFileSync(join(HERE, 'results', 'p1-scenarios.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
  cdp.close()
}
