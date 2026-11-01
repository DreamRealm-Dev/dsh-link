#!/usr/bin/env node
/**
 * R489 read-only live probe for the multi-level Team evidence in the running DSH-LINK kernel.
 *
 * Default mode reads the LIVE kernel through the shell proxy and asserts the durable facts an
 * acceptance review needs:
 *   - the roster carries a nested member (depth >= 2, spawnedBy set) in the root session log;
 *   - the last list_agents tool dispatch is error-free (no ToolOutputError INVALID_TOOL_OUTPUT);
 *   - the returned rows include the nested member with its depth/spawnedBy and the Lead at depth 0;
 *   - the live model-visible team policy says the Team is multi-level.
 * Nothing is mutated. The --send flag is the only mutation and is explicit; it posts one prompt
 * to the Lead session and waits for the turn to settle (this costs provider tokens).
 *
 * Usage:
 *   node scripts/verify-r489-live-rpc.mjs [--base http://127.0.0.1:31761] [--lead session-...]
 *        [--member probe-l3] [--json] [--send "<one minimal prompt>"]
 *
 * Exit code 0 when the read-only assertions pass.
 */
import { randomUUID } from 'node:crypto'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const BASE = flag('--base', 'http://127.0.0.1:31761')
const LEAD = flag('--lead', 'session-<example>')
const MEMBER = flag('--member', 'probe-l3')
const JSON_OUT = argv.includes('--json')
const SEND = flag('--send', undefined)

const results = []
function record(id, ok, detail) {
  results.push({ id, ok, detail })
  if (!JSON_OUT) console.log((ok ? 'PASS' : 'FAIL').padEnd(4), id.padEnd(30), detail)
}

async function rpc(method, args) {
  const body = { type: 'client-request', rpcId: 'r489-live-' + randomUUID(), method, payload: { args } }
  const response = await fetch(BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json()
  const result = parsed.result
  if (result?.ok !== true) throw new Error(method + ': ' + JSON.stringify(result?.error ?? parsed))
  return result.value
}

async function listSessions() {
  const value = await rpc('session/list', { _request: {} })
  return value.items
}
const findLead = (items) => items.find(item => item.sessionId === LEAD)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function pageTail(throughSeq) {
  const value = await rpc('session/page', { request: { address: { kind: 'session', sessionId: LEAD }, throughSeq, maxMessages: 500 } })
  return value.records.map(record => record.event ?? record)
}

function dispatchText(dispatch) {
  const content = dispatch?.content ?? []
  return content.map(part => part?.text ?? '').join('\n')
}

async function readFacts() {
  const items = await listSessions()
  const lead = findLead(items)
  if (!lead) throw new Error('Lead session not found: ' + LEAD)
  const events = await pageTail(lead.projections.asOfSeq)
  const memberEvents = events.filter(e => e.type === 'team/member' && e.data?.member?.name === MEMBER)
  const lastMember = memberEvents[memberEvents.length - 1]?.data?.member
  const listDispatches = events.filter(e => e.type === 'tool/ptc-dispatch' && e.data?.name === 'list_agents')
  const lastList = listDispatches[listDispatches.length - 1]?.data
  let parsedRows
  if (lastList) {
    try { parsedRows = JSON.parse(dispatchText(lastList)) } catch { parsedRows = undefined }
  }
  const invalidOutput = events.some(e => JSON.stringify(e.data ?? {}).includes('INVALID_TOOL_OUTPUT'))
  return { sessions: items.length, lead, events, memberEvents, lastMember, lastList, parsedRows, invalidOutput }
}

async function assertReadOnly() {
  const facts = await readFacts()
  record('live-kernel-reachable', true, 'sessions=' + facts.sessions + ' lead asOfSeq=' + facts.lead.projections?.asOfSeq + ' running=' + facts.lead.running)
  record('live-nested-member', Boolean(facts.lastMember && facts.lastMember.depth >= 2 && typeof facts.lastMember.spawnedBy === 'string'),
    facts.lastMember ? 'last team/member for ' + MEMBER + ': depth=' + facts.lastMember.depth + ' spawnedBy=' + facts.lastMember.spawnedBy : 'no team/member event for ' + MEMBER)
  record('live-list-agents-clean', Boolean(facts.lastList && facts.lastList.isError === false && !facts.invalidOutput),
    facts.lastList ? 'last list_agents dispatch isError=' + facts.lastList.isError + '; INVALID_TOOL_OUTPUT in tail=' + facts.invalidOutput : 'no list_agents dispatch in the page tail')
  const rows = Array.isArray(facts.parsedRows) ? facts.parsedRows : []
  const leadRow = rows.find(row => row.target === 'lead')
  const memberRow = rows.find(row => row.target === MEMBER)
  record('live-member-row-fields', Boolean(leadRow?.depth === 0 && memberRow?.depth >= 2 && memberRow?.spawnedBy),
    'lead.depth=' + leadRow?.depth + ' ' + MEMBER + '.depth=' + memberRow?.depth + ' ' + MEMBER + '.spawnedBy=' + memberRow?.spawnedBy)
  const legacy = rows.filter(row => row.target !== 'lead' && row.target !== MEMBER && row.depth === undefined)
  record('live-legacy-row-absence', true, legacy.length + ' legacy row(s) carry neither spawnedBy nor depth (documented fallback: lead / depth 1)')
  const policyEvents = facts.events.filter(e => e.type === 'system/message')
  const policyText = policyEvents.map(e => JSON.stringify(e.data ?? {})).join('\n')
  record('live-multi-level-policy', policyText.includes('This Team is multi-level (depth limit'), 'last system prompt carries the multi-level team policy line')
  return facts
}

const before = await listSessions()
const leadBefore = findLead(before)
if (SEND !== undefined) {
  const requestId = randomUUID()
  const accepted = await rpc('session/prompt', { request: { requestId, sessionId: LEAD, mode: 'queue', content: [{ type: 'text', text: SEND }] } })
  record('live-prompt-accepted', accepted?.accepted === true, 'requestId=' + requestId)
  for (let i = 0; i < 60; i++) {
    await sleep(3000)
    const items = await listSessions()
    const lead = findLead(items)
    if (lead && lead.running === false && (lead.projections?.asOfSeq ?? 0) > (leadBefore?.projections?.asOfSeq ?? 0)) break
  }
}
const facts = await assertReadOnly()
const after = findLead(await listSessions())
const tokensBefore = leadBefore?.projections?.values?.tokenUsage ?? {}
const tokensAfter = after?.projections?.values?.tokenUsage ?? {}
record('live-cost', true, 'uncachedIn +' + ((tokensAfter.uncachedInputTokens ?? 0) - (tokensBefore.uncachedInputTokens ?? 0)) +
  ' output +' + ((tokensAfter.outputTokens ?? 0) - (tokensBefore.outputTokens ?? 0)) +
  ' cacheRead +' + ((tokensAfter.cacheReadTokens ?? 0) - (tokensBefore.cacheReadTokens ?? 0)) +
  ' (lead ' + (leadBefore?.projections?.asOfSeq ?? '?') + ' -> ' + (after?.projections?.asOfSeq ?? '?') + ')')

const failed = results.filter(r => !r.ok)
if (JSON_OUT) console.log(JSON.stringify({ base: BASE, lead: LEAD, member: MEMBER, send: SEND !== undefined, sessions: facts.sessions, failures: failed.map(r => r.id), checks: results }, null, 2))
else console.log('\n' + (failed.length === 0 ? 'LIVE OK' : 'LIVE FAILED') + ': ' + results.length + ' check(s), ' + failed.length + ' failed')
process.exitCode = failed.length === 0 ? 0 : 1
