#!/usr/bin/env node
/** Quick ordering check for the live gate: reload -> away -> set policy -> open target -> windowInfo. */
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
const before = await evaluate('({ global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null, info: __r493.windowInfo() })')
const policy = await evaluate('__r493.setPolicy(500, 125, true)')
const open = await evaluate('__r493.openSession(' + JSON.stringify(LEAD) + ', 60000)')
const info = await evaluate('__r493.windowInfo()')
const trimAttempt = await evaluate('__r493.syntheticAppend(130)')
const after = await evaluate('__r493.windowInfo()')
console.log(JSON.stringify({ away, before, policy, open, info, trimAttempt, after }, null, 2))
await cdp.call('Emulation.clearDeviceMetricsOverride')
await cdp.call('Page.reload', { ignoreCache: false })
cdp.close()
