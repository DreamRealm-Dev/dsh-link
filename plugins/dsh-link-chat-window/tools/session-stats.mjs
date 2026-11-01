#!/usr/bin/env node
/**
 * Read-only session inventory from the LIVE kernel through the shell proxy.
 * Lists sessions (id, title, asOfSeq, running) sorted by asOfSeq so the audit can
 * pick the longest one; no mutation.
 */
import { randomUUID } from 'node:crypto'

const BASE = process.env.DSH_LINK_BASE ?? 'http://127.0.0.1:31761'
const rpc = async (method, args) => {
  const response = await fetch(BASE + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r493-audit-' + randomUUID(), method, payload: { args } }),
  })
  const parsed = await response.json()
  const result = parsed.result
  if (result?.ok !== true) throw new Error(method + ': ' + JSON.stringify(result?.error ?? parsed))
  return result.value
}
const value = await rpc('session/list', { _request: {} })
const rows = value.items.map(item => ({
  sessionId: item.sessionId,
  title: item.title ?? item.displayTitle ?? null,
  asOfSeq: item.projections?.asOfSeq ?? null,
  running: item.running ?? null,
  parentId: item.parentId ?? null,
  origin: item.origin ?? null,
  updatedAt: item.updatedAt ?? null,
})).sort((a, b) => (b.asOfSeq ?? 0) - (a.asOfSeq ?? 0))
console.log(JSON.stringify({ sessions: rows.length, top: rows.slice(0, 15) }, null, 2))
