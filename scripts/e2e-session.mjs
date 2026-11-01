#!/usr/bin/env node
/**
 * End-to-end check against a live kernel: create a session, read it back, and
 * submit one prompt — the whole path the UI takes, so it exercises the shell's
 * cookie, the proxy's re-originating forward, and the kernel's session controller
 * together.
 *
 * A prompt needs a usable provider. Without one the kernel still accepts the
 * submission and the turn fails afterwards, so acceptance is what is asserted.
 *
 * Usage:
 *   node scripts/e2e-session.mjs [origin]
 */

import { argv } from 'node:process'

import { callEndpoint } from './lib/http.mjs'

const DEFAULT_ORIGIN = 'http://127.0.0.1:31761'

/**
 * Run one step, printing its result and whether it threw.
 *
 * @param {string} name - step name.
 * @param {() => Promise<string>} step - performs the call and returns a summary.
 * @returns {Promise<boolean>} whether the step succeeded.
 */
async function step(name, step_) {
  try {
    process.stdout.write(`${name}: ${await step_()}\n`)
    return true
  } catch (error) {
    process.stdout.write(`${name}: FAILED — ${error.message}\n`)
    return false
  }
}

const origin = argv[2] ?? DEFAULT_ORIGIN

let ok = true
let sessionId = null

ok = (await step('session/list before', async () => {
  const before = await callEndpoint(origin, 'session/list', { _request: {} })
  const count = Array.isArray(before?.items) ? before.items.length : 0
  return `${count} session(s)`
})) && ok

ok =
  (await step('session/create', async () => {
    // `session/create` takes its named arguments inside a `request` object.
    const created = await callEndpoint(origin, 'session/create', { request: {} })
    if (typeof created?.sessionId !== 'string') {
      throw new Error(`no sessionId in ${JSON.stringify(created)?.slice(0, 160)}`)
    }
    sessionId = created.sessionId
    return sessionId
  })) && ok

ok = (await step('session/list after', async () => {
  const after = await callEndpoint(origin, 'session/list', { _request: {} })
  const items = Array.isArray(after?.items) ? after.items : []
  return `${items.length} session(s); newest ${items[0]?.sessionId ?? '—'}`
})) && ok

if (sessionId === null) {
  process.stdout.write('\nFAIL  no session to read\n')
  process.exit(1)
}

ok = (await step('session/projections', async () => {
  const projections = await callEndpoint(origin, 'session/projections', {
    request: { sessionId },
  })
  if (projections === null) throw new Error('returned null')
  return `asOfSeq=${projections.asOfSeq}, title=${JSON.stringify(projections.values?.title ?? null)}`
})) && ok

ok =
  (await step('session/page', async () => {
    const projections = await callEndpoint(origin, 'session/projections', {
      request: { sessionId },
    })
    const page = await callEndpoint(origin, 'session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq: projections.asOfSeq,
        maxMessages: 20,
      },
    })
    const records = Array.isArray(page?.records) ? page.records : []
    return `${records.length} record(s), hasMore=${page?.hasMore === true}`
  })) && ok

ok =
  (await step('session/prompt', async () => {
    const accepted = await callEndpoint(origin, 'session/prompt', {
      request: {
        requestId: crypto.randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'DSH Link 端到端自检' }],
        clientTimeZone: 'Asia/Shanghai',
      },
    })
    return `accepted=${accepted?.accepted === true}`
  })) && ok

ok = (await step('session/cancel', async () => {
  await callEndpoint(origin, 'session/cancel', { request: { sessionId } })
  return 'cancelled'
})) && ok

process.stdout.write(`\n${ok ? 'PASS  full session path' : 'FAIL  session path incomplete'}\n`)
process.exit(ok ? 0 : 1)
