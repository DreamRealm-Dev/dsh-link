#!/usr/bin/env node
/**
 * The repo gate for packages/link-interconnect-sdk.
 *
 * Runs the SDK's own reading table: the bundled echo peer is started in-process and the
 * well-known declaration, invoke auth/dispatch, the SSE route, models.provide, idempotency, the
 * reverse linkClient and the frozen-contract mirror are measured. Same suite as the package's
 * test; this is the path the Lead runs.
 *
 * This gate also owns one repo-specific reading the package suite cannot make on its own: the five
 * protocol route prefixes the shell forwards are asserted explicitly, both against their frozen
 * literal values and against types.ts. The suite's ids reading covers the code lists; this row
 * prints the route prefixes it checked.
 *
 *   node scripts/link-interconnect-sdk-check.mjs
 *
 * Exit 0 all held | 1 a reading failed.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROUTES } from '../packages/link-interconnect-sdk/src/index.mjs'
import { runSdkChecks } from '../packages/link-interconnect-sdk/test/sdk.test.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX_ROUTES = ['contract', 'invoke', 'events', 'embedToken', 'openaiPrefix']
const EXPECTED_PREFIXES = {
  contract: '/link/v1/contract',
  invoke: '/link/v1/invoke',
  events: '/link/v1/events',
  embedToken: '/link/v1/embed/token',
  openaiPrefix: '/link/v1/openai',
}

/** The named prefixes are the frozen literals, and the FROZEN types.ts spells them the same way. */
async function routesMirrorReading() {
  for (const key of PREFIX_ROUTES) {
    if (ROUTES[key] !== EXPECTED_PREFIXES[key]) {
      throw new Error('SDK ROUTES.' + key + ' is ' + JSON.stringify(ROUTES[key]) + ', expected ' + JSON.stringify(EXPECTED_PREFIXES[key]))
    }
  }
  const frozenPath = join(PROJECT, 'plugins/dsh-link-interconnect/src/protocol/types.ts')
  const summary = PREFIX_ROUTES.map((key) => key + '=' + ROUTES[key]).join(' ')
  if (!existsSync(frozenPath)) return summary + ' (types.ts absent: literal check only)'
  const frozen = await import(pathToFileURL(frozenPath).href)
  for (const key of PREFIX_ROUTES) {
    if (frozen.ROUTES[key] !== ROUTES[key]) {
      throw new Error('SDK ROUTES.' + key + ' drifted from types.ts: ' + JSON.stringify(frozen.ROUTES[key]) + ' vs ' + JSON.stringify(ROUTES[key]))
    }
  }
  return summary
}

const held = await runSdkChecks({
  extraReadings: [
    { label: 'routes mirror: contract/invoke/events/embedToken/openaiPrefix', run: routesMirrorReading },
  ],
})
process.exitCode = held ? 0 : 1
