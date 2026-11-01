#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it attaches to a kernel that is ALREADY RUNNING (base URL and launch token arrive on the command line, line 12 and line 107; its only import is 'node:process', line 18; every call is a fetch against that base, lines 43 and 66), so it never boots or owns a composition and the running kernel's own replies are the witness.
/**
 * Probe the DSH kernel's `/api` surface.
 *
 * DSH 0.2.x gates every route — including `/api` — behind a signed cookie that
 * is minted by exchanging the launch token printed on the kernel's stdout. This
 * script performs that exchange and then calls the endpoints named on the
 * command line (or the default set), printing each reply. It is the fastest way
 * to learn a payload shape without reading the generated Typert descriptors.
 *
 * Usage:
 *   node scripts/probe-api.mjs <base> <token> [endpoint[:jsonPayload] ...]
 *
 * Example:
 *   node scripts/probe-api.mjs http://127.0.0.1:31760 hlb4... session/list '{}'
 */

import { argv, exit } from 'node:process'

const DEFAULT_ENDPOINTS = [
  'settings/describe',
  'credentials/describe',
  'session/list',
  'session/modelCatalog',
  'agentPresets/list',
  'commands/list',
  'skills/list',
  'permissionPresets/catalog',
  'llm/listProviders',
  'llm/listConfigurableProviders',
]

/** Endpoints to skip when the caller named none; these need live credentials. */
const DEFAULT_EXCLUDED = new Set(['llm/listConfigurableProviders'])

/**
 * Exchange the launch token for the signed session cookie.
 * @param {string} base - kernel origin.
 * @param {string} token - launch token from the kernel's stdout line.
 * @returns {Promise<string>} the `Cookie` header value to send on later calls.
 */
async function authenticate(base, token) {
  const response = await fetch(`${base}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  })
  if (response.status !== 303) {
    throw new Error(`token exchange expected 303, got ${response.status}`)
  }
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('token exchange returned no set-cookie')
  const pair = setCookie.split(';', 1)[0]
  if (pair === '') throw new Error('token exchange returned an empty cookie')
  return pair
}

/**
 * Call one unary endpoint and return its decoded reply.
 * @param {string} base - kernel origin.
 * @param {string} cookie - `Cookie` header value.
 * @param {string} endpoint - channel-relative endpoint.
 * @param {unknown} payload - endpoint-owned request payload.
 * @returns {Promise<unknown>} the whole decoded envelope.
 */
async function call(base, cookie, endpoint, payload) {
  const rpcId = crypto.randomUUID()
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
  })
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { httpStatus: response.status, body: text.slice(0, 400) }
  }
}

/** Reduce a reply to something readable when a payload is enormous. */
function summarise(value, depth = 0) {
  const json = JSON.stringify(value, null, 2)
  if (json.length <= 20_000) return json
  if (Array.isArray(value)) {
    return `[\n  // ${value.length} items; first item:\n${JSON.stringify(value[0], null, 2).split('\n').map((line) => `  ${line}`).join('\n')}\n]`
  }
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      const text = JSON.stringify(entry)
      out[key] = text !== undefined && text.length > 400 ? `<${text.length} chars>` : entry
    }
    return JSON.stringify(out, null, 2)
  }
  return `<${json.length} chars>`
}

/**
 * Every Remote endpoint takes its named arguments inside a single `args`
 * object; the Gateway rejects any other payload shape.
 * @param {Record<string, unknown>} args - endpoint-named arguments.
 * @returns {unknown} the wire payload.
 */
function remotePayload(args) {
  return { args }
}

const [base, token, ...rest] = argv.slice(2)
if (base === undefined || token === undefined) {
  console.error('usage: node scripts/probe-api.mjs <base> <token> [endpoint[:json] ...]')
  exit(2)
}

const targets = rest.length > 0
  ? rest.map((spec) => {
      const at = spec.indexOf(':')
      return at === -1
        ? { endpoint: spec, payload: remotePayload({}) }
        : { endpoint: spec.slice(0, at), payload: remotePayload(JSON.parse(spec.slice(at + 1))) }
    })
  : DEFAULT_ENDPOINTS
    .filter((endpoint) => !DEFAULT_EXCLUDED.has(endpoint))
    .map((endpoint) => ({ endpoint, payload: remotePayload({}) }))

let cookie
try {
  cookie = await authenticate(base, token)
} catch (error) {
  console.error(`auth failed: ${error.message}`)
  exit(1)
}

for (const { endpoint, payload } of targets) {
  process.stdout.write(`\n=== ${endpoint} ===\n`)
  try {
    const reply = await call(base, cookie, endpoint, payload)
    process.stdout.write(`${summarise(reply)}\n`)
  } catch (error) {
    process.stdout.write(`CALL FAILED: ${error.message}\n`)
  }
}
