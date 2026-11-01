#!/usr/bin/env node
/** R501 P1 evidence batches (single in-page evaluations; each batch fully scoped in its own IIFE). */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER_SRC = readFileSync(join(HERE, 'probes', '24-helpers.js'), 'utf8')
const LEAD = 'session-<example>'
const AWAY = 'session-<example>'
const cdp = await connect({ port: 9222 })
const evaluate = (expression, timeoutMs = 180000) => cdp.evaluate(expression, timeoutMs)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const helpers = `const info = () => __r493.windowInfo();
  const dump = () => { const { binding } = __r493.current(); const entries = binding.eventSource.getSnapshot().entries; const seqs = entries.map(entry => entry.event.seq); const gaps = []; for (let index = 1; index < seqs.length; index += 1) if (seqs[index] !== seqs[index - 1] + 1) gaps.push({ index, previous: seqs[index - 1], next: seqs[index], missing: seqs[index] - seqs[index - 1] - 1 }); return { count: seqs.length, first: seqs[0], last: seqs[seqs.length - 1], gaps: gaps.slice(0, 12), gapTotal: gaps.reduce((sum, gap) => sum + gap.missing, 0), contiguous: gaps.length === 0, baseSeq: binding.session.baseSeq, hasMore: binding.session.getSnapshot().hasMore }; };
  const appendOne = () => { const { binding } = __r493.current(); const entries = binding.eventSource.getSnapshot().entries; const lastSeq = entries[entries.length - 1].event.seq; binding.eventSource.append({ type: 'event', event: { seq: lastSeq + 1, type: 'system/message', time: Date.now(), data: {} } }); binding.session.maintainEventWindow(); return info(); };
  const guarded = (promise, ms, label) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ timeout: label }), ms))]);`;
const batch1 = `(async () => { const lead = ${JSON.stringify(LEAD)}, away = ${JSON.stringify(AWAY)}; ${helpers}
  const result = {};
  try {
    await __r493.openSession(away, 60000);
    result.policy = __r493.setPolicy(500, 125, false);
    result.open = await __r493.openSession(lead, 60000);
    result.openInfo = info();
    result.openDump = dump();
    result.loadOlder = __r493.windowInfo();
    await guarded(__r493.loadOlder(), 45000, 'loadOlder');
    result.afterLoadOlder = dump();
    result.appendOne = appendOne();
    result.afterTrimDump = dump();
    await guarded(__r493.loadOlder(), 45000, 'loadOlder2');
    result.afterTrimLoadOlder = dump();
  } catch (error) { result.error = String(error && error.stack || error) }
  return result;
})()`;
const batch2 = `(async () => { const lead = ${JSON.stringify(LEAD)}, away = ${JSON.stringify(AWAY)}; ${helpers}
  const result = {};
  try {
    await __r493.openSession(away, 60000);
    result.policy = __r493.setPolicy(500, 125, false);
    result.open = await __r493.openSession(lead, 60000);
    result.openInfo = info();
    await guarded(__r493.loadOlder(), 45000, 'loadOlder');
    result.loaded = dump();
    const dom = __r493.dom();
    __r493.scrollTo(Math.round(dom.scrollHeight * 0.42));
    await __r493.sleep(300);
    result.before = { anchor: __r493.anchorAtViewport(90), dom: __r493.dom(), info: info(), foldCount: __r493.foldState().length };
    result.append = appendOne();
    await guarded(__r493.settle(), 30000, 'settle');
    result.after = { anchor: __r493.anchorAtViewport(90), dom: __r493.dom(), info: info(), foldCount: __r493.foldState().length };
    result.anchorJumped = result.before.anchor !== null && result.after.anchor !== null && result.before.anchor.text !== result.after.anchor.text;
    result.scrollHeightDelta = result.after.dom.scrollHeight - result.before.dom.scrollHeight;
    result.scrollTopBefore = result.before.dom.scrollTop;
    result.scrollTopAfter = result.after.dom.scrollTop;
    result.entriesBefore = result.before.info.entries;
    result.entriesAfter = result.after.info.entries;
    result.baseSeqBefore = result.before.info.baseSeq;
    result.baseSeqAfter = result.after.info.baseSeq;
  } catch (error) { result.error = String(error && error.stack || error) }
  return result;
})()`;
const results = { format: 'dsh-link.chat-window-p1-scenarios/4', recordedAt: new Date().toISOString() }
try {
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.call('Page.reload', { ignoreCache: false })
  await sleep(1500)
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try { if (await evaluate("document.readyState === 'complete' && !!globalThis.__dshSessionNav && (document.querySelector('#root')?.childElementCount ?? 0) > 0", 4000) === true) break } catch (error) { /* navigating */ }
    await sleep(250)
  }
  await evaluate(HELPER_SRC, 30000)
  await evaluate('__r493.ensureMounted()', 20000)
  results.batch1 = await evaluate(batch1)
  results.batch2 = await evaluate(batch2)
} catch (error) {
  results.error = String(error && error.stack || error)
} finally {
  try { await cdp.call('Emulation.clearDeviceMetricsOverride') } catch (error) { /* best effort */ }
  try { await cdp.call('Page.reload', { ignoreCache: false }) } catch (error) { /* best effort */ }
  writeFileSync(join(HERE, 'results', 'p1-batches.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
  cdp.close()
}
