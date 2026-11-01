#!/usr/bin/env node
/**
 * Read-only: what one history page actually carries for the longest live sessions.
 *
 * The client opens a session with HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow }.
 * That caps MESSAGES, not events: one message spends turn/start + step/start + durable events
 * + assistant/message + step/end. This probe reports the page's record count, per-type counts,
 * the message count, and what fraction of the durable log it is. Ordinary sessions only: a
 * subagent address needs the parent half, which this probe does not model.
 *
 *   node plugins/dsh-link-chat-window/tools/page-audit.mjs [sessionId ...]
 */
import { randomUUID } from 'node:crypto'

const BASE = process.env.DSH_LINK_BASE ?? 'http://127.0.0.1:31761'
const rpc = async (method, args) => {
  const response = await fetch(BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r493-page-' + randomUUID(), method, payload: { args } }),
  })
  const parsed = await response.json()
  const result = parsed.result
  if (result?.ok !== true) throw new Error(method + ': ' + JSON.stringify(result?.error ?? parsed))
  return result.value
}

const list = await rpc('session/list', { _request: {} })
const ordinary = list.items.filter(item => item.origin !== 'subagent')
const requested = process.argv.slice(2)
const targets = requested.length > 0
  ? requested
  : ordinary.slice().sort((a, b) => (b.projections?.asOfSeq ?? 0) - (a.projections?.asOfSeq ?? 0)).slice(0, 5).map(item => item.sessionId)

const report = []
for (const sessionId of targets) {
  const item = list.items.find(candidate => candidate.sessionId === sessionId)
  const throughSeq = item?.projections?.asOfSeq ?? 0
  const page = await rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 500 } })
  const records = page.records
  const types = new Map()
  let messages = 0
  for (const record of records) {
    const type = record.event?.type ?? record.type
    types.set(type, (types.get(type) ?? 0) + 1)
    if (type === 'user/message' || type === 'assistant/message') messages += 1
  }
  const firstSeq = records.length === 0 ? null : (records[0].event?.seq ?? records[0].seq)
  const lastSeq = records.length === 0 ? null : (records[records.length - 1].event?.seq ?? records[records.length - 1].seq)
  report.push({
    sessionId,
    title: item?.title ?? null,
    asOfSeq: throughSeq,
    pageRecords: records.length,
    pageMessages: messages,
    hasMore: page.hasMore,
    firstSeq,
    lastSeq,
    span: firstSeq === null ? null : lastSeq - firstSeq,
    windowFraction: throughSeq === 0 ? null : Number((records.length / throughSeq).toFixed(3)),
    bytes: Buffer.byteLength(JSON.stringify(records)),
    types: [...types.entries()].sort((a, b) => b[1] - a[1]),
  })
}
console.log(JSON.stringify({ ordinarySessions: ordinary.length, report }, null, 2))
