/**
 * Behaviour test for the per-conversation approval memory added to lib/index.js.
 *
 * The canonical source is `lib/index.js`; `build.mjs` extracts the marked core
 * region for the dynamic Cordis build. This script evaluates that same core
 * region with the two grant helpers exposed, so the durable plugin path is
 * covered without importing the package (whose bare import only resolves inside
 * a DSH profile).
 *
 * Usage: node tools/test-conversation-grant.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
const START = '// ---8<--- CORE START ---8<---'
const END = '// ---8<--- CORE END ---8<---'
const start = source.indexOf(START)
const end = source.indexOf(END)
if (start < 0 || end < 0) throw new Error('core markers missing from lib/index.js')
const core = source.slice(start + START.length, end)

const api = new Function(`${core}
return { resolveConfig, hasConversationGrant, rememberConversationGrant, routeGrantKey, conversationGrants }`)()

const results = []
const check = (name, condition, detail) => results.push({ name, ok: Boolean(condition), detail: String(detail) })
const ROUTE = { provider: 'commandcode', model: 'gpt-6-luna' }
const OTHER = { provider: 'tokenrhythm', model: 'glm-5' }
const lead = { id: 'conversation-a' }
const other = { id: 'conversation-b' }
const on = api.resolveConfig({})
const off = api.resolveConfig({ rememberApproval: false })

check('rememberApproval defaults to true', on.rememberApproval === true, JSON.stringify(on.rememberApproval))
check('rememberApproval can be disabled', off.rememberApproval === false, JSON.stringify(off.rememberApproval))
check('requireApproval still defaults to true', on.requireApproval === true, JSON.stringify(on.requireApproval))
check('a route starts without a grant', api.hasConversationGrant(lead, ROUTE) === false, 'no grant expected')

api.rememberConversationGrant(lead, ROUTE, on)
check('an approved route is granted in that conversation', api.hasConversationGrant(lead, ROUTE) === true, 'grant expected')
check('a different route is NOT granted', api.hasConversationGrant(lead, OTHER) === false, 'no grant expected')
check('another conversation is NOT granted', api.hasConversationGrant(other, ROUTE) === false, 'no grant expected')

api.rememberConversationGrant(other, ROUTE, off)
check('rememberApproval:false records nothing', api.hasConversationGrant(other, ROUTE) === false, 'no grant expected')

for (let index = 0; index < api.conversationGrants.size + 300; index += 1) api.rememberConversationGrant({ id: `bulk-${index}` }, ROUTE, on)
check('the conversation table stays capped', api.conversationGrants.size <= 128, `size=${api.conversationGrants.size}`)

const failed = results.filter((entry) => !entry.ok)
for (const entry of results) console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name} :: ${entry.detail}`)
console.log(failed.length === 0 ? `ALL ${results.length} CHECKS PASSED` : `FAILED: ${failed.map((entry) => entry.name).join(', ')}`)
process.exitCode = failed.length === 0 ? 0 : 1
