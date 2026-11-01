#!/usr/bin/env node
/**
 * R500 physical-laziness gap verifier (read-only, disposable fixtures).
 *
 * Builds synthetic DSH 0.2.1-rc.2 JSONL sessions under a disposable root
 * (default <workspace>//.tmp/r500) and measures, through the real services:
 *   fixtures  generate synthetic logs (100k / 1M logical events, none|zstd)
 *   measure   cold/warm session/page + session/follow cost, whether every cold
 *             page re-reads and re-prepares the whole log, page event/byte size
 *   seek      offset/frame-index read prototype vs full-file observation
 *   all       the matrix used by docs/handoff/R500-physical-laziness-gap.md
 *
 * Never writes kernel-home sessions, never changes kernel sources, never commits.
 * Heavy phases take dsh-link/.build.lock (mkdir/remove) unless --no-lock.
 *
 * Usage:
 *   node scripts/verify-r500-gap.mjs all
 *   node scripts/verify-r500-gap.mjs fixtures --sizes=100k,1m
 *   node scripts/verify-r500-gap.mjs measure --fixtures=r500-100k-zstd-b2048-moderate --scenarios=tail-cold,tail-warm
 *   node scripts/verify-r500-gap.mjs seek --fixtures=r500-100k-none-b2048-moderate
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULTS = {
  kernel: '<workspace>//dsh-link/core/deepseek-harness',
  tmp: '<workspace>//.tmp/r500',
  lock: '<workspace>//dsh-link/.build.lock',
}

function parseArgs(argv) {
  const command = argv[2] ?? 'all'
  const flags = new Map()
  for (const arg of argv.slice(3)) {
    const match = /^--([^=]+)(?:=(.*))?$/u.exec(arg)
    if (match !== null) flags.set(match[1], match[2] ?? 'true')
  }
  const pick = (name, fallback) => flags.get(name) ?? fallback
  return {
    command,
    kernel: pick('kernel', DEFAULTS.kernel),
    tmp: pick('tmp', DEFAULTS.tmp),
    lock: pick('lock', DEFAULTS.lock),
    noLock: flags.get('no-lock') === 'true',
    sizes: pick('sizes', '100k,1m').split(',').filter(Boolean),
    fixtureNames: flags.get('fixtures')?.split(',').filter(Boolean) ?? [],
    scenarios: flags.get('scenarios')?.split(',').filter(Boolean) ?? [],
  }
}

const FIXTURES = {
  'r500-100k-none-b2048-moderate': { size: 100000, compression: 'none', batch: 2048, payload: 'moderate' },
  'r500-100k-zstd-b2048-moderate': { size: 100000, compression: 'zstd', batch: 2048, payload: 'moderate' },
  'r500-100k-zstd-b2048-heavy': { size: 100000, compression: 'zstd', batch: 2048, payload: 'heavy' },
  'r500-100k-zstd-b128-moderate': { size: 100000, compression: 'zstd', batch: 128, payload: 'moderate' },
  'r500-1m-none-b2048-moderate': { size: 1000000, compression: 'none', batch: 2048, payload: 'moderate' },
  'r500-1m-zstd-b2048-moderate': { size: 1000000, compression: 'zstd', batch: 2048, payload: 'moderate' },
  'r500-1m-zstd-ball-moderate': { size: 1000000, compression: 'zstd', batch: 1000000, payload: 'moderate' },
}

const PAYLOADS = {
  moderate: { userChars: 80, assistantChars: 240, toolResultChars: 600 },
  heavy: { userChars: 300, assistantChars: 1600, toolResultChars: 3072 },
}

function acquireLock(lockDir, timeoutMs = 20 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!existsSync(lockDir)) {
      try {
        mkdirSync(lockDir)
        return () => { try { rmSync(lockDir, { recursive: true, force: true }) } catch {} }
      } catch {}
    }
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + lockDir)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
}

function runChild(params, code, timeoutMs) {
  const result = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx/esm', '--input-type=module'], {
    cwd: params.kernel,
    input: code,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs ?? 20 * 60 * 1000,
    env: { ...process.env, R500_PARAMS: JSON.stringify(params) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || '').split('\n').slice(-40).join('\n')
    throw new Error('child failed (' + String(result.signal ?? result.status) + '):\n' + tail)
  }
  return result.stdout
}

function metric(stdout, prefix) {
  const line = stdout.split('\n').find(candidate => candidate.startsWith(prefix))
  if (line === undefined) throw new Error('missing ' + prefix + ' in child output:\n' + stdout.slice(-4000))
  return JSON.parse(line.slice(prefix.length))
}

const GENERATOR_JS = `
const T0 = 1700000000000
function makeTurnEvents(turn, seqStart, payload) {
  const events = []
  let seq = seqStart
  const push = (type, data, extra = {}) => { events.push({ type, seq: seq++, time: T0 + seq, data, ...extra }) }
  const filler = (tag, chars) => tag + ' ' + String(turn) + ' ' + 'x'.repeat(Math.max(0, chars - tag.length - String(turn).length - 2))
  push('turn/start', { turn })
  push('step/start', { turn, step: 1 })
  if (turn === 1) push('system/message', { turn, step: 1, message: { id: 'system-head', role: 'system', content: [], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  push('user/message', { id: 'prompt-' + String(turn), role: 'user', content: [{ type: 'text', text: filler('request', payload.userChars) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const tool = turn % 4 === 0
  const callId = 'call-' + String(turn)
  const args = JSON.stringify({ turn })
  const content = [{ type: 'text', text: filler('answer', payload.assistantChars) }]
  if (tool) content.push({ type: 'tool-call', id: callId, name: 'synthetic_tool', arguments: args })
  push('assistant/message', { turn, step: 1, message: { id: 'reply-' + String(turn), role: 'assistant', content, source: { kind: 'model', provider: 'synthetic', model: 'synthetic' } }, stream: [] }, { surfaceOp: 'append' })
  if (tool) {
    const callSeq = seq
    push('tool/call', { turn, step: 1, callId, name: 'synthetic_tool', arguments: args })
    push('tool/result', { turn, step: 1, message: { id: 'result-' + String(turn), role: 'tool', toolCallId: callId, isError: false, source: { kind: 'tool', callId }, content: [{ type: 'text', text: filler('tool result', payload.toolResultChars) }] } }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  }
  push('step/end', { turn, step: 1 })
  push('turn/end', { turn, reason: { kind: 'completed' } })
  return { events, nextSeq: seq }
}
function seqOfTurn(turn) {
  const prior = turn - 1
  return prior * 6 + Math.floor(prior / 4) * 2
}
`

const FIXTURE_JS = GENERATOR_JS + `
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'

const params = JSON.parse(process.env.R500_PARAMS)
const root = join(params.tmp, 'fixtures', params.name)
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
const sessionRoot = join(root, 'session-root')
const cwd = join(root, 'ws')
const sessionId = SessionId('r500-' + params.name)
const payload = params.payloadSpec

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(Jsonl, { root: sessionRoot, compression: params.compression })
const header = { version: 4, id: sessionId, createdAt: T0, cwd, isSeeded: false }
const handle = await ctx.sessionPersistence.create(header)
let seq = 0
let turns = 0
let batch = []
const t0 = performance.now()
while (seq < params.size) {
  turns += 1
  const result = makeTurnEvents(turns, seq, payload)
  seq = result.nextSeq
  batch.push(...result.events)
  if (batch.length >= params.batch) { await handle.append(batch); batch = [] }
}
if (batch.length > 0) await handle.append(batch)
await handle.flush()
await handle.close()
const generationMs = performance.now() - t0
const stat = await ctx.sessionPersistence.stat(sessionId)
await ctx.fiber.dispose()

function findArtifact(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { const found = findArtifact(path); if (found !== undefined) return found }
    else if (entry.name.startsWith('session.') && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd'))) return path
  }
  return undefined
}
const artifact = findArtifact(root)
if (artifact === undefined) throw new Error('generated artifact not found under ' + root)
console.log('R500_FIXTURE ' + JSON.stringify({ name: params.name, artifact, root, sessionRoot, sessionId, cwd, compression: params.compression, batch: params.batch, payload: params.payload, size: params.size, events: seq, turns, generationMs: +generationMs.toFixed(0), fileBytes: statSync(artifact).size, sizeBytes: stat.sizeBytes }))
`

const MEASURE_JS = GENERATOR_JS + `
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { SessionHistoryController } from './packages/api/session-controller/src/history.ts'

const params = JSON.parse(process.env.R500_PARAMS)
const payload = params.payloadSpec
const sessionId = SessionId(params.sessionId)
const signal = new AbortController().signal
const rssMB = () => +(process.memoryUsage().rss / 1048576).toFixed(1)
const heapMB = () => { globalThis.gc?.(); return +(process.memoryUsage().heapUsed / 1048576).toFixed(1) }

async function openContext() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Jsonl, { root: params.sessionRoot, compression: params.compression })
  class TestQuery extends SessionQueryEngine {
    searchSessions() { return Promise.reject(new Error('disabled')) }
    searchEvents() { return Promise.reject(new Error('disabled')) }
  }
  await ctx.plugin(TestQuery)
  const stats = { prepares: [], reads: [], observes: [], opens: 0, stats: 0 }
  const origPrepare = ctx.sessions.prepare.bind(ctx.sessions)
  ctx.sessions.prepare = (id, options) => { stats.prepares.push({ events: options?.seed?.length ?? 0 }); return origPrepare(id, options) }
  const origOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
  ctx.sessionPersistence.open = async (id, access, options) => {
    stats.opens += 1
    const handle = await origOpen(id, access, options)
    const read = handle.read.bind(handle)
    handle.read = async (offset, length, o) => {
      const t = performance.now()
      const result = await read(offset, length, o)
      stats.reads.push({ offset: offset ?? 0, length: length ?? null, events: result.events.length, ms: +(performance.now() - t).toFixed(1) })
      return result
    }
    return handle
  }
  const origStat = ctx.sessionPersistence.stat.bind(ctx.sessionPersistence)
  ctx.sessionPersistence.stat = async (id, options) => { stats.stats += 1; return origStat(id, options) }
  const origObserve = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
  ctx.sessionQuery.observeSession = async (id, options) => {
    const t = performance.now()
    const observation = await origObserve(id, options)
    stats.observes.push({ source: observation.source, events: observation.events.length, projections: observation.projections !== undefined, ms: +(performance.now() - t).toFixed(1) })
    return observation
  }
  const history = new SessionHistoryController(ctx, () => {})
  return { ctx, history, stats, eventCount: params.events, revision: null }
}

function reset(stats) { stats.prepares.length = 0; stats.reads.length = 0; stats.observes.length = 0; stats.opens = 0; stats.stats = 0 }

async function measurePage(env, request) {
  reset(env.stats)
  const rss0 = rssMB(); const heap0 = heapMB(); const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const page = await env.history.page(request, signal)
  const wallMs = performance.now() - t0
  const cpu = process.cpuUsage(cpu0)
  const heap1 = heapMB(); const rss1 = rssMB()
  return {
    records: page.records.length, bytes: Buffer.byteLength(JSON.stringify(page.records)), hasMore: page.hasMore,
    wallMs: +wallMs.toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
    rssDeltaMB: +(rss1 - rss0).toFixed(1), heapDeltaMB: +(heap1 - heap0).toFixed(1),
    prepares: env.stats.prepares.slice(), reads: env.stats.reads.slice(), observes: env.stats.observes.slice(), opens: env.stats.opens, stats: env.stats.stats,
    eventCount: env.eventCount,
  }
}

function tailStartSeq(turns, messages) {
  const wantedTurns = Math.max(1, Math.ceil(messages / 2))
  const startTurn = Math.max(1, turns - wantedTurns + 1)
  return { startTurn, startSeq: seqOfTurn(startTurn) }
}

const result = { fixture: params.name, scenario: params.scenario, kernelEvents: params.events, turns: params.turns, compression: params.compression, batch: params.batch, payload: params.payload }
const scenario = params.scenario

if (scenario === 'tail-cold' || scenario === 'tail-warm') {
  const env = await openContext()
  const request = { address: { kind: 'session', sessionId }, throughSeq: env.eventCount - 1, maxMessages: 500 }
  result.cold = await measurePage(env, request)
  if (scenario === 'tail-warm') result.warm = await measurePage(env, request)
  await env.ctx.fiber.dispose()
}

if (scenario === 'client-window') {
  const env = await openContext()
  const request = { address: { kind: 'session', sessionId }, throughSeq: env.eventCount - 1, maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }
  result.cold = await measurePage(env, request)
  await env.ctx.fiber.dispose()
}

if (scenario === 'deep-cold') {
  const env = await openContext()
  const throughSeq = env.eventCount - 1
  const beforeSeq = Math.max(1, Math.min(throughSeq - 1, tailStartSeq(params.turns, 1000).startSeq))
  result.cold = await measurePage(env, { address: { kind: 'session', sessionId }, throughSeq, beforeSeq, maxMessages: 500 })
  await env.ctx.fiber.dispose()
}

if (scenario === 'follow-cold') {
  const env = await openContext()
  reset(env.stats)
  const heap0 = heapMB(); const rss0 = rssMB(); const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const stream = env.history.follow({ address: { kind: 'session', sessionId }, maxMessages: 500 }, signal)
  let snapshot
  for await (const frame of stream) { if (frame.type === 'snapshot') { snapshot = frame; break } }
  const wallMs = performance.now() - t0
  const cpu = process.cpuUsage(cpu0)
  const heap1 = heapMB(); const rss1 = rssMB()
  result.snapshot = {
    records: snapshot?.records.length ?? 0, bytes: snapshot === undefined ? 0 : Buffer.byteLength(JSON.stringify(snapshot.records)),
    hasMore: snapshot?.hasMore, cursor: snapshot?.cursor,
    wallMs: +wallMs.toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
    rssDeltaMB: +(rss1 - rss0).toFixed(1), heapDeltaMB: +(heap1 - heap0).toFixed(1),
    prepares: env.stats.prepares.slice(), reads: env.stats.reads.slice(), observes: env.stats.observes.slice(), opens: env.stats.opens,
  }
  await stream.return?.(undefined)
  await env.ctx.fiber.dispose()
}

if (scenario === 'revision') {
  // Append to a throwaway copy so the generated fixture stays byte-identical for later runs.
  const { cpSync } = await import('node:fs')
  params.sessionRoot = params.sessionRoot + '-revision-' + String(process.pid)
  cpSync(JSON.parse(process.env.R500_PARAMS).sessionRoot, params.sessionRoot, { recursive: true })
  const env = await openContext()
  result.cold = await measurePage(env, { address: { kind: 'session', sessionId }, throughSeq: env.eventCount - 1, maxMessages: 500 })
  const handle = await env.ctx.sessionPersistence.open(sessionId, 'write')
  let nextTurn = params.turns + 1
  let seq = env.eventCount
  const batch = []
  for (let i = 0; i < 4; i++) { const next = makeTurnEvents(nextTurn, seq, payload); seq = next.nextSeq; nextTurn += 1; batch.push(...next.events) }
  await handle.append(batch)
  await handle.flush()
  await handle.close()
  const statAfter = await env.ctx.sessionPersistence.stat(sessionId)
  result.newRevision = statAfter.revision
  result.appendedEvents = batch.length
  result.cold2 = await measurePage(env, { address: { kind: 'session', sessionId }, throughSeq: params.events + batch.length - 1, maxMessages: 500 })
  await env.ctx.fiber.dispose()
}

console.log('R500_METRIC ' + JSON.stringify(result))
`

const SEEK_JS = String.raw`
import { performance } from 'node:perf_hooks'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, snapshotSessionEvent } from '@deepseek-ai/dsh-session'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { scanZstdFrames, decompressZstdFrame } from './packages/session/session-persistence-jsonl/src/zstd.ts'

const params = JSON.parse(process.env.R500_PARAMS)
const sessionId = SessionId(params.sessionId)
const signal = new AbortController().signal
const result = { fixture: params.name, compression: params.compression, batch: params.batch, events: params.events, turns: params.turns, fileBytes: statSync(params.artifact).size }
const rssMB = () => +(process.memoryUsage().rss / 1048576).toFixed(1)
const heapMB = () => { globalThis.gc?.(); return +(process.memoryUsage().heapUsed / 1048576).toFixed(1) }

async function fullObservation() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Jsonl, { root: params.sessionRoot, compression: params.compression })
  class TestQuery extends SessionQueryEngine {
    searchSessions() { return Promise.reject(new Error('disabled')) }
    searchEvents() { return Promise.reject(new Error('disabled')) }
  }
  await ctx.plugin(TestQuery)
  const rss0 = rssMB(); const heap0 = heapMB(); const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none', signal })
  const events = observation.events
  const wallMs = performance.now() - t0
  const cpu = process.cpuUsage(cpu0)
  const rss1 = rssMB(); const heap1 = heapMB()
  const out = { wallMs: +wallMs.toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), rssDeltaMB: +(rss1 - rss0).toFixed(1), heapDeltaMB: +(heap1 - heap0).toFixed(1), events: events.length, source: observation.source }
  observation[Symbol.dispose]()
  await ctx.fiber.dispose()
  return out
}

function targetWindow(turns) {
  const wantedTurns = Math.ceil(500 / 2)
  const startTurn = Math.max(1, turns - wantedTurns + 1)
  const startSeq = (startTurn - 1) * 6 + Math.floor((startTurn - 1) / 4) * 2
  const endSeq = turns * 6 + Math.floor(turns / 4) * 2
  return { startTurn, startSeq, endSeq, events: endSeq - startSeq }
}

async function plainSeek(target) {
  const buffer = readFileSync(params.artifact)
  const heap0 = heapMB(); const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const offsets = [0]
  for (let i = 0; i < buffer.length; i++) if (buffer[i] === 0x0a) offsets.push(i + 1)
  const indexWall = performance.now() - t0
  const indexCpu = process.cpuUsage(cpu0)
  const indexHeap = heapMB() - heap0
  const startOffset = offsets[target.startSeq + 1]
  const endOffset = offsets[target.endSeq + 1] ?? buffer.length
  const heap1 = heapMB()
  const cpu1 = process.cpuUsage()
  const t1 = performance.now()
  const fd = openSync(params.artifact, 'r')
  const slice = Buffer.allocUnsafe(endOffset - startOffset)
  readSync(fd, slice, 0, slice.length, startOffset)
  closeSync(fd)
  const lines = slice.toString('utf8').split('\n').filter(line => line.length > 0)
  const pageEvents = lines.map(line => JSON.parse(line))
  for (const event of pageEvents) snapshotSessionEvent(event)
  const seekWall = performance.now() - t1
  const seekCpu = process.cpuUsage(cpu1)
  return {
    indexBuild: { wallMs: +indexWall.toFixed(1), cpuMs: +((indexCpu.user + indexCpu.system) / 1000).toFixed(1), heapDeltaMB: +indexHeap.toFixed(1), entries: offsets.length, indexBytes: offsets.length * 8 },
    page: { events: pageEvents.length, bytes: slice.length, wallMs: +seekWall.toFixed(1), cpuMs: +((seekCpu.user + seekCpu.system) / 1000).toFixed(1), heapDeltaMB: +(heapMB() - heap1).toFixed(1), totalBytes: buffer.length, firstSeq: pageEvents[0]?.seq, lastSeq: pageEvents.at(-1)?.seq, correct: pageEvents[0]?.seq === target.startSeq && pageEvents.length === target.events },
  }
}

async function zstdSeek(target) {
  const buffer = readFileSync(params.artifact)
  const heap0 = heapMB(); const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const scan = scanZstdFrames(buffer)
  const frames = []
  for (const frame of scan.frames) {
    const plain = await decompressZstdFrame(buffer.subarray(frame.start, frame.end))
    const text = plain.toString('utf8')
    const firstLine = text.split('\n', 1)[0]
    let firstSeq = -1
    try { const parsed = JSON.parse(firstLine); if (typeof parsed.seq === 'number') firstSeq = parsed.seq } catch {}
    frames.push({ start: frame.start, end: frame.end, plainLength: plain.length, firstSeq, lines: text.split('\n').filter(line => line.length > 0).length })
  }
  const indexWall = performance.now() - t0
  const indexCpu = process.cpuUsage(cpu0)
  const indexHeap = heapMB() - heap0
  const heapFrames = heapMB()
  const cpu1 = process.cpuUsage()
  const t1 = performance.now()
  let frameIndex = 0
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    if (frame.firstSeq !== -1 && frame.firstSeq <= target.startSeq) frameIndex = i
    else if (frame.firstSeq > target.startSeq) break
  }
  const collected = []
  let touched = 0
  let bytesRead = 0
  for (let i = frameIndex; i < frames.length && collected.length < target.events; i++) {
    const frame = frames[i]
    touched += 1
    bytesRead += frame.end - frame.start
    const plain = await decompressZstdFrame(buffer.subarray(frame.start, frame.end))
    const lines = plain.toString('utf8').split('\n').filter(line => line.length > 0)
    for (const line of lines) {
      const event = JSON.parse(line)
      if (typeof event.seq !== 'number') continue
      if (event.seq < target.startSeq || event.seq >= target.endSeq) continue
      snapshotSessionEvent(event)
      collected.push(event)
    }
  }
  const seekWall = performance.now() - t1
  const seekCpu = process.cpuUsage(cpu1)
  const heapPage = heapMB()
  return {
    frameCount: frames.length,
    frameStats: { avgCompressedBytes: Math.round(result.fileBytes / frames.length), avgPlaintextBytes: Math.round(frames.reduce((sum, frame) => sum + frame.plainLength, 0) / frames.length), maxPlaintextBytes: Math.max(...frames.map(frame => frame.plainLength)) },
    indexBuild: { wallMs: +indexWall.toFixed(1), cpuMs: +((indexCpu.user + indexCpu.system) / 1000).toFixed(1), heapDeltaMB: +indexHeap.toFixed(1), entries: frames.length, indexBytes: frames.length * 24 },
    page: { events: collected.length, bytes: bytesRead, wallMs: +seekWall.toFixed(1), cpuMs: +((seekCpu.user + seekCpu.system) / 1000).toFixed(1), heapDeltaMB: +(heapPage - heapFrames).toFixed(1), framesTouched: touched, totalBytes: result.fileBytes, firstSeq: collected[0]?.seq, lastSeq: collected.at(-1)?.seq, correct: collected[0]?.seq === target.startSeq && collected.length === target.events },
  }
}

result.fullObservation = await fullObservation()
const target = targetWindow(params.turns)
result.target = target
result.seek = params.compression === 'zstd' ? await zstdSeek(target) : await plainSeek(target)
result.ratio = {
  eventsCovered: +(result.fullObservation.events / result.seek.page.events).toFixed(1),
  bytesCovered: +(result.fileBytes / result.seek.page.bytes).toFixed(1),
  wallRatio: +(result.fullObservation.wallMs / result.seek.page.wallMs).toFixed(1),
  pageHeapRatio: +(result.fullObservation.heapDeltaMB / Math.max(0.1, result.seek.page.heapDeltaMB ?? 0.1)).toFixed(1),
  breakEvenPages: +((result.seek.indexBuild.wallMs + result.seek.page.wallMs) / Math.max(0.1, result.fullObservation.wallMs - result.seek.page.wallMs)).toFixed(1),
}
console.log('R500_SEEK ' + JSON.stringify(result))
`

function existingFixtureNames(tmp) {
  const dir = join(tmp, 'fixtures')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
}

function readFixtureMeta(tmp, name) {
  const path = join(tmp, 'results', name + '.fixture.json')
  if (!existsSync(path)) throw new Error('missing fixture metadata ' + path + ' (run fixtures first)')
  return JSON.parse(readFileSync(path, 'utf8'))
}

function saveJson(tmp, fileName, value) {
  mkdirSync(join(tmp, 'results'), { recursive: true })
  writeFileSync(join(tmp, 'results', fileName), JSON.stringify(value, null, 2))
}

function defaultScenarios(name) {
  return name.includes('1m')
    ? ['tail-cold', 'tail-warm', 'deep-cold']
    : ['tail-cold', 'tail-warm', 'deep-cold', 'follow-cold', 'revision']
}

async function main() {
  const args = parseArgs(process.argv)
  const release = args.noLock ? () => {} : acquireLock(args.lock)
  try {
    mkdirSync(args.tmp, { recursive: true })
    const report = { command: args.command, startedAt: new Date().toISOString(), fixtures: {}, measurements: [], seeks: [] }
    const fixtureNames = args.fixtureNames.length > 0 ? args.fixtureNames : existingFixtureNames(args.tmp)
    const allNames = args.fixtureNames.length > 0 ? args.fixtureNames : Object.keys(FIXTURES)

    if (args.command === 'fixtures' || args.command === 'all') {
      const names = allNames.filter(name => args.sizes.some(size => name.includes(size)))
      for (const name of names) {
        const spec = FIXTURES[name]
        if (spec === undefined) throw new Error('unknown fixture ' + name)
        const params = { kernel: args.kernel, tmp: args.tmp, name, size: spec.size, compression: spec.compression, batch: spec.batch, payload: spec.payload, payloadSpec: PAYLOADS[spec.payload] }
        process.stdout.write('generating ' + name + ' ... ')
        const started = Date.now()
        const stdout = runChild(params, FIXTURE_JS, 20 * 60 * 1000)
        const meta = metric(stdout, 'R500_FIXTURE ')
        meta.generateWallMs = Date.now() - started
        saveJson(args.tmp, name + '.fixture.json', meta)
        report.fixtures[name] = { events: meta.events, turns: meta.turns, fileBytes: meta.fileBytes, generationMs: meta.generationMs }
        console.log('ok events=' + String(meta.events) + ' bytes=' + String(meta.fileBytes) + ' gen=' + String(meta.generationMs) + 'ms wall=' + String(meta.generateWallMs) + 'ms')
      }
      saveJson(args.tmp, 'fixtures.json', report.fixtures)
    }

    if (args.command === 'measure' || args.command === 'all') {
      const names = fixtureNames.length > 0 ? fixtureNames : existingFixtureNames(args.tmp)
      for (const name of names) {
        const meta = readFixtureMeta(args.tmp, name)
        const scenarios = args.scenarios.length > 0 ? args.scenarios : defaultScenarios(name)
        for (const scenario of scenarios) {
          const params = { kernel: args.kernel, tmp: args.tmp, name, sessionRoot: meta.sessionRoot, sessionId: meta.sessionId, compression: meta.compression, batch: meta.batch, payload: meta.payload, payloadSpec: PAYLOADS[meta.payload], events: meta.events, turns: meta.turns, scenario }
          process.stdout.write('measure ' + name + ' ' + scenario + ' ... ')
          const stdout = runChild(params, MEASURE_JS, 20 * 60 * 1000)
          const value = metric(stdout, 'R500_METRIC ')
          saveJson(args.tmp, name + '.' + scenario + '.json', value)
          report.measurements.push(value)
          const cold = value.cold ?? value.snapshot
          console.log('ok records=' + String(cold?.records ?? '-') + ' bytes=' + String(cold?.bytes ?? '-') + ' wall=' + String(cold?.wallMs ?? '-') + 'ms prepares=' + String((cold?.prepares ?? []).length) + ' reads=' + JSON.stringify((cold?.reads ?? []).map(read => read.events)))
        }
      }
    }

    if (args.command === 'seek' || args.command === 'all') {
      const names = fixtureNames.length > 0 ? fixtureNames : existingFixtureNames(args.tmp)
      for (const name of names) {
        const meta = readFixtureMeta(args.tmp, name)
        const params = { kernel: args.kernel, tmp: args.tmp, name, artifact: meta.artifact, sessionRoot: meta.sessionRoot, sessionId: meta.sessionId, compression: meta.compression, batch: meta.batch, events: meta.events, turns: meta.turns }
        process.stdout.write('seek ' + name + ' ... ')
        const stdout = runChild(params, SEEK_JS, 20 * 60 * 1000)
        const value = metric(stdout, 'R500_SEEK ')
        saveJson(args.tmp, name + '.seek.json', value)
        report.seeks.push(value)
        console.log('ok full=' + String(value.fullObservation.wallMs) + 'ms/' + String(value.fullObservation.events) + 'ev index=' + String(value.seek.indexBuild.wallMs) + 'ms page=' + String(value.seek.page.wallMs) + 'ms/' + String(value.seek.page.events) + 'ev wallRatio=' + String(value.ratio.wallRatio))
      }
    }

    saveJson(args.tmp, 'report.' + args.command + '.json', report)
    console.log('R500 DONE command=' + args.command + ' tmp=' + args.tmp)
  } finally {
    release()
  }
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1) })
