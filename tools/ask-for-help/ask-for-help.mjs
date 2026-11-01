#!/usr/bin/env node
/**
 * ask-for-help —— 让 DSH-LINK 里的 agent 向「Lead」喊话的桥。
 *
 * 形态（link-interconnect/1 的软件主动方向，CLI 模式）：
 *   常驻任务  node tools/ask-for-help/ask-for-help.mjs serve
 *   等待任务  node tools/ask-for-help/ask-for-help.mjs wait
 *   收发命令  node tools/ask-for-help/ask-for-help.mjs reply <ticket> <文本>
 *             node tools/ask-for-help/ask-for-help.mjs send [--session <id>] [--new] <文本>
 *             node tools/ask-for-help/ask-for-help.mjs status | inbox
 *
 * 常驻任务把本机作为一个软件 peer 暴露给 DSH-LINK：
 *   GET  /.well-known/link-interconnect.json
 *   POST /link/v1/invoke        （tools.expose / ask_for_help）
 * DSH-LINK 按协议把它 add 进来（consent 由常驻任务自动应答一次），把 ask_for_help
 * 注册成内核工具，所以 LINK 里的 agent 默认就能调用它。
 *
 * 等待任务是给「会话里的 Lead」用的：它盯着收件箱，一旦有新喊话（或 DSH-LINK 掉线、
 * 模型服务商探针失败、agent 轮次报错）就打印一段报告并退出 —— 后台任务退出会唤醒
 * Lead 的会话，Lead 读报告、处理、再用命令行回复/发消息，然后重新挂一个等待任务。
 *
 * 状态目录（默认 <repo>/.tmp/ask-for-help）：
 *   state.json      常驻任务心跳与 peer 状态
 *   inbox/<id>.json 每一条喊话（pending -> notified -> answered）
 *   replies/<id>.json  Lead 的答复
 *   events.ndjson   常驻任务事件流（apply / add / consent / invoke / error）
 *   waiter.json     等待任务的会话事件游标（只报新错误，不重复报历史）
 *
 * 退出码：0 正常（wait: 有新的喊话）；2 DSH-LINK 掉线；3 模型服务商探针失败；
 *         4 等待超时；5 LINK 会话里出现新的 agent 错误；1 用法/内部错误。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '../../packages/link-interconnect-sdk/src/index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const STATE = process.env.ASK_FOR_HELP_STATE ?? join(REPO, '.tmp', 'ask-for-help')
const LINK_ORIGIN = (process.env.LINK_ORIGIN ?? 'http://127.0.0.1:31761').replace(/\/+$/, '')
const PORT = Number(process.env.ASK_FOR_HELP_PORT ?? 19555)
const LINK_HOME = process.env.DSH_LINK_KERNEL_HOME ?? join(process.env.APPDATA ?? '', 'dev.dshlink.client', 'dsh-link', 'kernel-home')
const LINK_ID = 'svc_lead_ask_for_help'
const PEER_NAME = 'Lead 求助桥（ask-for-help）'
const TOOL_NAME = 'ask_for_help'
const GATEWAY = process.env.OPENDESIGN_BASE_URL ?? 'https://amr-link.open-design.ai/v1'

const argv = process.argv.slice(2)
const command = argv[0] ?? ''
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const stamp = () => new Date().toISOString()
const say = (line) => process.stdout.write(line + '\n')

// ---------------------------------------------------------------- files
const paths = {
  state: join(STATE, 'state.json'),
  inbox: join(STATE, 'inbox'),
  replies: join(STATE, 'replies'),
  events: join(STATE, 'events.ndjson'),
  waiter: join(STATE, 'waiter.json'),
}
function ensureState() {
  for (const one of [paths.inbox, paths.replies]) mkdirSync(one, { recursive: true })
}
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, file)
}
function writeJsonAtomic(file, value) { writeJson(file, value) }
function event(record) {
  try { appendFileSync(paths.events, JSON.stringify({ at: stamp(), ...record }) + '\n') } catch { /* best effort */ }
}
function log(line) {
  const text = '[' + stamp().slice(11, 19) + '] ' + line
  say(text)
  event({ kind: 'log', line })
}
const inboxFiles = () => { try { return readdirSync(paths.inbox).filter((n) => n.endsWith('.json') && !n.endsWith('.tmp')) } catch { return [] } }
const pendingMessages = () => inboxFiles().map((f) => readJson(join(paths.inbox, f), null)).filter((m) => m !== null && m.status === 'pending')
const notifyOnce = () => pendingMessages().filter((m) => m.notifiedAt === undefined)

// ---------------------------------------------------------------- DSH-LINK RPC / HTTP
/** One JSON-over-HTTP request, no keep-alive (fetch pools sockets that abort on process exit). */
function requestJson(url, { method = 'POST', body, timeoutMs = 20000, headers = {} } = {}) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? https : http
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const allHeaders = { accept: 'application/json', ...headers }
  if (payload !== undefined) { allHeaders['content-type'] = 'application/json'; allHeaders['content-length'] = String(payload.byteLength) }
  return new Promise((resolvePromise) => {
    const request = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, method, headers: allHeaders, agent: false }, (answer) => {
      let text = ''
      answer.setEncoding('utf8')
      answer.on('data', (chunk) => { text += chunk })
      answer.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        resolvePromise({ status: answer.statusCode ?? 0, headers: answer.headers, text, json })
      })
    })
    request.on('error', (error) => resolvePromise({ status: 0, headers: {}, text: '', json: null, error: String(error?.message ?? error) }))
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')))
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}
/** One kernel endpoint through the shell proxy; resolves the endpoint value or throws. */
async function linkCall(endpoint, args, timeoutMs = 30000) {
  const reply = await requestJson(LINK_ORIGIN + '/api/' + endpoint, {
    body: { type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args } },
    timeoutMs,
  })
  if (reply.status !== 200) throw new Error(endpoint + ': HTTP ' + reply.status + ' ' + (reply.error ?? reply.text.slice(0, 120)))
  const envelope = reply.json
  if (envelope?.result?.ok !== true) throw new Error(endpoint + ': ' + (envelope?.result?.error?.code ?? 'unknown') + ' ' + (envelope?.result?.error?.message ?? ''))
  return envelope.result.value
}
/** The shell's boot state, or null when it does not answer. */
async function shellStatus() {
  const reply = await requestJson(LINK_ORIGIN + '/__shell/status', { method: 'GET', timeoutMs: 4000 })
  if (reply.status !== 200 || reply.json === null) return null
  return reply.json
}
/** One of the interconnect plugin's own routes (plain HTTP, not the kernel RPC envelope). */
async function pluginGet(path, timeoutMs = 10000) {
  const reply = await requestJson(LINK_ORIGIN + path, { method: 'GET', timeoutMs })
  if (reply.status !== 200 || reply.json === null) throw new Error(path + ': HTTP ' + reply.status + ' ' + (reply.error ?? reply.text.slice(0, 120)))
  return reply.json
}
/** POST a plain JSON body to one of the interconnect plugin's own routes. */
async function pluginPost(path, body, timeoutMs = 30000) {
  const reply = await requestJson(LINK_ORIGIN + path, { method: 'POST', body, timeoutMs })
  if (reply.status !== 200 || reply.json === null) throw new Error(path + ': HTTP ' + reply.status + ' ' + (reply.error ?? reply.text.slice(0, 160)))
  return reply.json
}

// ---------------------------------------------------------------- provider probe
/** OPENDESIGN_API_KEY from the LINK kernel home (refs are plain text in the credentials store). */
function gatewayKey() {
  try {
    const text = readFileSync(join(LINK_HOME, '.credentials.yaml'), 'utf8')
    const line = /^\s*OPENDESIGN_API_KEY:\s*(\S+)\s*$/m.exec(text)
    return line === null ? undefined : line[1]
  } catch { return undefined }
}
/**
 * Probe the model provider itself: GET {gateway}/models with the credential LINK uses.
 * This is the reading for "模型服务商坏了": unreachable / 401 / 5xx is a named failure,
 * and it costs no tokens.
 */
async function providerProbe() {
  const key = gatewayKey()
  if (key === undefined) return { ok: false, code: 'credential-missing', detail: 'OPENDESIGN_API_KEY not found in ' + join(LINK_HOME, '.credentials.yaml') }
  const reply = await requestJson(GATEWAY + '/models', { method: 'GET', timeoutMs: 15000, headers: { authorization: 'Bearer ' + key } })
  if (reply.status !== 200) return { ok: false, code: reply.status === 0 ? 'gateway-unreachable' : 'gateway-http-' + reply.status, detail: (reply.error ?? reply.text.slice(0, 200)) }
  const models = Array.isArray(reply.json?.data) ? reply.json.data.length : Array.isArray(reply.json?.models) ? reply.json.models.length : null
  return { ok: true, code: 'ok', detail: String(models ?? '?') + ' model(s) at ' + GATEWAY }
}

/** How many sessions are running right now, or null when the list cannot be read. */
async function runningSessionCount() {
  try {
    const list = await linkCall('session/list', { _request: {} })
    const items = Array.isArray(list?.items) ? list.items : []
    return items.filter((item) => item?.running === true).length
  } catch { return null }
}

// ---------------------------------------------------------------- resident peer (serve)
const manifest = {
  protocol: 'link-interconnect/1',
  identity: { linkId: LINK_ID, name: PEER_NAME, vendor: 'dsh-link' },
  endpoints: { invoke: '/link/v1/invoke' },
  capabilities: [
    {
      kind: 'tools.expose', version: 1, auth: 'bearer', scopes: ['tools.expose'],
      tools: [
        {
          name: TOOL_NAME,
          description: '向 Lead（这台机器上的 DSH 会话里的 AI 助手）喊话求助。适用：模型/服务商异常、任务卡住、需要另一个人或智能体来排查。调用后消息进入 Lead 的后台收件箱，Lead 会被唤醒并接手；本调用立即返回 ticket，不阻塞。Lead 的答复会以一条新消息发回本会话。',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '要喊话的内容：现象、报错原文、你要 Lead 做什么' },
              context: { type: 'string', description: '可选：已尝试过什么、相关的会话或任务 id' },
              urgency: { type: 'string', enum: ['normal', 'urgent'], description: '默认 normal' },
            },
            required: ['message'],
          },
          call: { cap: 'tools.expose', op: TOOL_NAME },
        },
      ],
    },
  ],
  limits: { rpm: 60 },
}
function acceptCall(request) {
  return typeof request.token === 'string' && request.token !== ''
}
async function handleAskForHelp(args) {
  const message = typeof args?.message === 'string' ? args.message.trim() : ''
  if (message === '') return { ok: false, error: { code: 'link/bad-request', message: 'message is required (non-empty string)' } }
  ensureState()
  const ticket = 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  const record = {
    id: ticket, at: stamp(), status: 'pending', tool: TOOL_NAME,
    message,
    context: typeof args?.context === 'string' ? args.context : '',
    urgency: args?.urgency === 'urgent' ? 'urgent' : 'normal',
    pid: process.pid,
  }
  writeJsonAtomically(join(paths.inbox, ticket + '.json'), record)
  event({ kind: 'invoke', ticket, urgency: record.urgency, bytes: message.length })
  log('ask-for-help ' + ticket + ' from LINK (' + record.urgency + '): ' + message.slice(0, 120))
  return { ok: true, result: { delivered: true, ticket, at: record.at, by: 'lead-ask-for-help-bridge', note: 'Lead 的后台任务已被唤醒；答复会作为一条新消息发回本会话。' } }
}
function writeJsonAtomically(file, value) { writeJson(file, value) }

/** Whether our peer is currently bound and active in LINK. */
async function peerRow() {
  const listed = await pluginGet('/api/dsh-link-interconnect/peers')
  const rows = Array.isArray(listed?.result) ? listed.result : Array.isArray(listed) ? listed : []
  return rows.find((row) => String(row.linkId) === LINK_ID)
}
/**
 * Install our peer into LINK (idempotent).
 *
 * Adding a peer raises a consent question and the add call only resolves after it is answered, so
 * the add request and the consent answer have to be in flight at the same time. The question is
 * auto-granted: the person asked for this bridge, and the tool it exposes is the asked-for
 * ask_for_help. Nothing else is granted, and the grant is scoped to tools.expose.
 */
async function installPeer() {
  const existing = await peerRow().catch(() => undefined)
  if (existing !== undefined && String(existing.status) === 'active') return { ok: true, state: 'active', row: existing }
  const peerUrl = 'http://127.0.0.1:' + String(PORT)
  const adding = pluginPost('/api/dsh-link-interconnect/peers', { op: 'add', url: peerUrl })
    .then(() => ({ ok: true, state: 'added' }))
    .catch((error) => ({ ok: false, error: String(error?.message ?? error) }))
  let granted = false
  for (let attempt = 0; attempt < 48 && !granted; attempt += 1) {
    await new Promise((wake) => setTimeout(wake, 250))
    try {
      const snapshot = await pluginGet('/api/dsh-link-interconnect/state')
      const questions = Array.isArray(snapshot?.pendingConsent) ? snapshot.pendingConsent : []
      const ours = questions.find((question) => {
        const title = String(question?.title ?? '')
        return String(question?.peerLinkId ?? '') === LINK_ID || title.includes('ask-for-help') || title.includes('Lead 求助桥')
      })
      if (ours !== undefined) {
        await pluginPost('/api/dsh-link-interconnect/consent', { id: ours.id, decision: 'granted' })
        granted = true
        log('consent granted for ' + LINK_ID + ' (' + String(ours.title) + ')')
        event({ kind: 'consent', id: ours.id, title: ours.title })
      }
    } catch { /* the question may not be up yet */ }
  }
  const outcome = await adding
  if (outcome.ok) outcome.row = await peerRow().catch(() => undefined)
  return { ...outcome, granted }
}

async function runServe() {
  ensureState()
  if (existsSync(paths.state)) {
    const previous = readJson(paths.state, {})
    if (previous?.pid !== undefined && previous.pid !== process.pid) {
      try { process.kill(previous.pid, 0); say('serve: already running (pid ' + String(previous.pid) + '); stop it first'); process.exit(1) } catch { /* stale */ }
    }
  }
  const peer = await serve({ manifest, handlers: { ['tools.expose/' + TOOL_NAME]: handleAskForHelp }, auth: acceptCall, port: PORT, host: '127.0.0.1' })
  log('peer listening ' + peer.url + ' declaration ' + peer.manifestUrl)
  const beat = () => writeJson(paths.state, { pid: process.pid, url: peer.url, linkId: LINK_ID, tool: TOOL_NAME, at: stamp(), link: { ok: lastLink.ok, detail: lastLink.detail }, peer: lastPeer })
  let lastLink = { ok: false, detail: 'not probed' }
  let lastPeer = { ok: false, state: 'not added' }
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    log('stopping')
    try { await peer.close() } catch { /* best effort */ }
    try { writeJson(paths.state, { pid: process.pid, url: peer.url, linkId: LINK_ID, at: stamp(), stopped: true }) } catch { /* best effort */ }
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // Auto-install loop: LINK may not be up yet, and a restart turns the peer row rejoin-required.
  const install = async () => {
    const status = await shellStatus()
    lastLink = status === null
      ? { ok: false, detail: 'shell does not answer ' + LINK_ORIGIN }
      : { ok: status.phase === 'ready', detail: 'phase=' + String(status.phase) }
    if (lastLink.ok) {
      try {
        lastPeer = await installPeer()
        if (lastPeer.ok) log('peer ok: ' + JSON.stringify({ state: lastPeer.state, tools: lastPeer.row?.tools }))
      } catch (error) {
        lastPeer = { ok: false, error: String(error?.message ?? error) }
      }
    } else {
      lastPeer = { ok: false, state: 'link-not-ready' }
    }
    beat()
  }
  await install()
  setInterval(() => { install().catch(() => {}) }, 5000)
  setInterval(beat, 2000)
}

// ---------------------------------------------------------------- waiter
function formatMessage(message) {
  return [
    '=== ask-for-help: DSH-LINK 里的 agent 在喊你 ===',
    'ticket  : ' + message.id,
    'time    : ' + message.at,
    'urgency : ' + message.urgency,
    'message : ' + message.message,
    message.context === '' ? 'context : (没给)' : 'context : ' + message.context,
  ].join('\n')
}
/** The most recent LINK sessions, so the Lead knows where to send the answer. */
async function recentSessions(limit = 5) {
  try {
    const listed = await linkCall('session/list', { _request: {} })
    const items = Array.isArray(listed?.items) ? listed.items : []
    return items.slice(0, limit).map((row) => ({
      sessionId: row.sessionId,
      running: row.running === true,
      updatedAt: row.updatedAt,
      asOfSeq: Number(row.projections?.asOfSeq ?? 0),
      title: row.projections?.values?.title ?? null,
    }))
  } catch { return [] }
}
async function reportNewMessage() {
  const fresh = notifyOnce()
  if (fresh.length === 0) return false
  for (const message of fresh) {
    const stored = readJson(join(paths.inbox, message.id + '.json'), message)
    stored.notifiedAt = stamp()
    writeJson(join(paths.inbox, message.id + '.json'), stored)
  }
  const sessions = await recentSessions(6)
  for (const message of fresh) {
    say(formatMessage(message))
    say('LINK 最近会话（答复用 --session 指定；不给则发给最新一个）：')
    for (const session of sessions) say('  ' + session.sessionId + '  running=' + String(session.running) + '  ' + String(session.title ?? '(无标题)'))
    say('回复（记录）：node tools/ask-for-help/ask-for-help.mjs reply ' + message.id + ' "<答复>"')
    say('发回会话  ：node tools/ask-for-help/ask-for-help.mjs send [--session <id>] "<答复>"')
    say('实战铁律  ：若该会话是异常停止的，根因修完后必须再 send --session <id> "继续"。')
    say('')
  }
  say('处理完记得重新挂一个等待任务：node tools/ask-for-help/ask-for-help.mjs wait')
  return true
}
function describeStatus(status) {
  if (status === null) return 'shell ' + LINK_ORIGIN + ' 无应答'
  return 'phase=' + String(status.phase) + ' pid=' + String(status.pid ?? '?') + ' version=' + String(status.version ?? '?')
}
async function reportFailure(kind, detail, extra = []) {
  say('=== ask-for-help: DSH-LINK 异常，等待任务退出 ===')
  say('kind    : ' + kind)
  say('detail  : ' + detail)
  for (const line of extra) say('          ' + line)
  say('LINK    : ' + describeStatus(await shellStatus()))
  say('boot.log: ' + join(LINK_HOME, 'boot.log'))
  if (existsSync(join(LINK_HOME, 'boot.log'))) {
    const tail = readFileSync(join(LINK_HOME, 'boot.log'), 'utf8').split(/\r?\n/).filter((line) => line !== '').slice(-8)
    for (const line of tail) say('  | ' + line.slice(0, 240))
  }
  say('修好后重新挂等待任务：node tools/ask-for-help/ask-for-help.mjs wait')
}

/** New agent errors in LINK sessions since the waiter last ran (only new ones; baseline on first run). */
async function sessionErrors(state) {
  const sessions = await recentSessions(8)
  const found = []
  for (const session of sessions) {
    let projections
    try { projections = await linkCall('session/projections', { request: { sessionId: session.sessionId } }) } catch { continue }
    // project ands may answer null (even for a session session/list reports with an asOfSeq), so the
    // list row's own asOfSeq is the fallback cursor. Evidence: kernel types.ts 'absent' projection.
    const asOf = Number(projections?.asOfSeq ?? session.asOfSeq ?? 0)
    const seen = state.cursors[session.sessionId]
    if (seen === undefined) { state.cursors[session.sessionId] = asOf; continue }
    if (asOf <= seen) continue
    let page
    try {
      page = await linkCall('session/page', { request: { address: { kind: 'session', sessionId: session.sessionId }, throughSeq: asOf, maxMessages: 200 } })
    } catch { continue }
    for (const record of page?.records ?? []) {
      const event = record?.event ?? record
      const type = String(event?.type ?? '')
      const seq = Number(event?.seq ?? 0)
      if (seq <= seen) continue
      if (type === 'agent/error' || type === 'llm/error') found.push({ sessionId: session.sessionId, type, seq, data: event?.data })
      // The durable, authoritative failure record is the turn's closing turn/end reason
      // (core/agent-loop/src/agent.ts writes it in a finally on every failure). There is NO
      // durable agent/error session event, so scanning for one is kept only as a belt-and-braces
      // no-op. 'error' = provider/model failure; 'interrupted' = a crash-orphaned turn closed
      // after the fact; 'max-tokens'/'aborted'/'completed' are normal finishes.
      const reason = type === 'turn/end' ? String(event?.data?.reason?.kind ?? '') : ''
      if (reason === 'error' || reason === 'interrupted') found.push({ sessionId: session.sessionId, type: 'turn/end:' + reason, seq, data: event?.data })
    }
    state.cursors[session.sessionId] = asOf
    // Keep the cursor table small.
    const keys = Object.keys(state.cursors)
    if (keys.length > 40) for (const key of keys.slice(0, keys.length - 40)) delete state.cursors[key]
  }
  return found
}

async function runWait() {
  ensureState()
  const maxSeconds = Number(flag('max-seconds', '0'))
  const probeProvider = argv.includes('--no-provider-probe') ? false : true
  const downAfterMs = Number(flag('down-after', '30000'))
  const started = Date.now()
  const state = readJson(paths.waiter, { cursors: {} })
  state.cursors = state.cursors ?? {}
  let downSince = null
  let lastProvider = null
  let lastProviderAt = 0
  // One probe timeout is not a broken provider: the gateway is a network service (Cloudflare edge), and a
  // single transient timeout must not page the Lead. The probe runs once a minute, so the default "three
  // consecutive failures AND at least three minutes down" means a real outage, not an edge flap.
  // 实战 2026-10-25/26: two ~2-minute Cloudflare 抖动 each paged under the old "two consecutive" rule,
  // and the gateway answered 200 again by the time the report was read. Thresholds are flags.
  const providerFailureThreshold = Math.max(2, Number(flag('provider-failures', '3')))
  const providerDownAfterMs = Number(flag('provider-down-ms', String(3 * 60 * 1000)))
  let providerFailures = 0
  let providerDownSince = null
  // session/modelCatalog.failures[] names providers whose catalog lookup failed - the
  // LINK-side reading of "the provider is broken" (it can fail while the gateway answers).
  let catalogFailures = 0
  say('wait: watching ' + LINK_ORIGIN + ' (ask-for-help inbox ' + paths.inbox + ')')
  for (;;) {
    if (maxSeconds > 0 && Date.now() - started > maxSeconds * 1000) {
      await reportFailure('wait-timeout', '等待了 ' + String(maxSeconds) + ' 秒仍没有新的喊话或故障')
      process.exit(4)
    }
    // 1. a new ask-for-help message
    try { if (await reportNewMessage()) process.exit(0) } catch (error) { event({ kind: 'wait-error', where: 'message', error: String(error?.message ?? error) }) }
    // 2. is DSH-LINK alive?
    const status = await shellStatus()
    const alive = status !== null && status.phase === 'ready'
    if (alive) downSince = null
    else {
      downSince = downSince ?? Date.now()
      if (Date.now() - downSince > downAfterMs) {
        await reportFailure('link-down', 'DSH-LINK 已连续 ' + String(Math.round((Date.now() - downSince) / 1000)) + ' 秒不可用（shell phase 不是 ready）')
        process.exit(2)
      }
    }
    // 3. the model provider itself
    if (probeProvider && alive && Date.now() - lastProviderAt > 60000) {
      lastProviderAt = Date.now()
      lastProvider = await providerProbe()
      event({ kind: 'provider-probe', ok: lastProvider.ok, code: lastProvider.code, detail: lastProvider.detail, failures: providerFailures })
      if (lastProvider.ok) {
        if (providerFailures > 0) say('wait: 模型服务商已恢复（连续失败 ' + String(providerFailures) + ' 次后本次成功）')
        providerFailures = 0
        providerDownSince = null
      } else {
        providerFailures += 1
        providerDownSince = providerDownSince ?? Date.now()
        const downMs = Date.now() - providerDownSince
        say('wait: 模型服务商探针失败 ' + String(providerFailures) + '/' + String(providerFailureThreshold) + '（已持续 ' + String(Math.round(downMs / 1000)) + ' s）— ' + lastProvider.code + ' — ' + lastProvider.detail)
        if (providerFailures >= providerFailureThreshold && downMs >= providerDownAfterMs) {
          const running = await runningSessionCount()
          await reportFailure('provider-broken', 'OpenDesign 模型服务商连续 ' + String(providerFailures) + ' 次探针失败（约 ' + String(Math.round(downMs / 60000)) + ' 分钟）：' + lastProvider.code + ' — ' + lastProvider.detail + '（当时运行中的会话：' + (running === null ? '未知' : String(running)) + ' 个）')
          process.exit(3)
        }
      }
      const catalog = await linkCall('session/modelCatalog', {}).catch(() => null)
      const catalogFailure = (Array.isArray(catalog?.failures) ? catalog.failures : []).find((one) => /opendesign/i.test(String(one?.id ?? '') + ' ' + String(one?.name ?? '')))
      if (catalogFailure !== undefined) {
        catalogFailures += 1
        say('wait: LINK 的模型目录里有 opendesign 失败项 ' + String(catalogFailures) + '/2 — ' + JSON.stringify(catalogFailure).slice(0, 200))
        if (catalogFailures >= 2) {
          await reportFailure('provider-broken', 'LINK 的 session/modelCatalog 连续 ' + String(catalogFailures) + ' 次报告 opendesign 目录失败：' + JSON.stringify(catalogFailure).slice(0, 300))
          process.exit(3)
        }
      } else catalogFailures = 0
    }
    // 4. new agent errors inside LINK
    if (alive) {
      try {
        const errors = await sessionErrors(state)
        writeJson(paths.waiter, state)
        if (errors.length > 0) {
          const lines = errors.slice(0, 5).map((error) => error.sessionId + ' ' + error.type + ' seq=' + String(error.seq) + ' ' + JSON.stringify(error.data).slice(0, 300))
          // 实战铁律：会话是「非正常停止」的，修完根因后必须把「继续」发回该会话，它才会接着跑。
          const stopped = [...new Set(errors.map((error) => error.sessionId))]
          lines.push('', '修完根因后必须发「继续」让这些会话接着跑（不要只说修好了）：')
          for (const sessionId of stopped) lines.push('  node tools/ask-for-help/ask-for-help.mjs send --session ' + sessionId + ' "继续"')
          lines.push('（如果会话已经不在列表里/被删了，就跳过；模型服务商恢复后先 send 再挂回等待任务。）')
          await reportFailure('turn-error', 'LINK 会话里出现了新的 agent/模型错误 ' + String(errors.length) + ' 条', lines)
          process.exit(5)
        }
      } catch (error) { event({ kind: 'wait-error', where: 'session-errors', error: String(error?.message ?? error) }) }
    }
    await new Promise((wake) => setTimeout(wake, 1200))
  }
}

// ---------------------------------------------------------------- commands
async function runReply() {
  ensureState()
  const ticket = argv[1]
  const text = argv.slice(2).join(' ').trim()
  if (ticket === undefined || text === '') { say('usage: ask-for-help.mjs reply <ticket> <text>'); process.exit(1) }
  const inboxPath = join(paths.inbox, ticket + '.json')
  const message = readJson(inboxPath, null)
  if (message === null) { say('reply: unknown ticket ' + ticket); process.exit(1) }
  const reply = { id: ticket, text, at: stamp(), by: 'lead' }
  writeJson(join(paths.replies, ticket + '.json'), reply)
  message.status = 'answered'
  message.answeredAt = reply.at
  writeJson(inboxPath, message)
  event({ kind: 'reply', ticket, bytes: text.length })
  say('reply recorded for ' + ticket)
}
async function runSend() {
  const tokens = argv.slice(1)
  const wanted = flag('session', '')
  const proposeNew = tokens.includes('--new')
  const text = tokens.filter((token, index) => {
    if (token === '--new') return false
    if (token === '--session') return false
    if (index > 0 && tokens[index - 1] === '--session') return false
    return true
  }).join(' ').trim()
  if (text === '') { say('usage: ask-for-help.mjs send [--session <id>] [--new] <text>'); process.exit(1) }
  let sessionId = wanted
  if (sessionId === '' && proposeNew) {
    const created = await linkCall('session/create', { request: {} })
    sessionId = created.sessionId
    say('created session ' + sessionId)
  }
  if (sessionId === '') {
    const listed = await linkCall('session/list', { _request: {} })
    const items = Array.isArray(listed?.items) ? listed.items : []
    if (items.length === 0) { say('send: no LINK session to send to; pass --new'); process.exit(1) }
    sessionId = items[0].sessionId
    say('sending to newest session ' + sessionId + ' (' + String(items[0].projections?.values?.title ?? '') + ')')
  }
  let accepted
  try {
    accepted = await linkCall('session/prompt', {
      request: { requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' },
    })
  } catch (error) {
    const message = String(error?.message ?? error)
    // A teammate session is owned by subagent routing: an external prompt is refused with
    // session/agent-busy. Only the Lead (or the member's L2) can wake it, through send_message.
    if (message.includes('agent-busy') || message.includes('subagent routing')) {
      say('send: ' + sessionId + ' 是 teammate 的子会话，外部 prompt 被拒（owned by subagent routing）。')
      say('      正确做法：把话发给 Lead 会话，让 Lead 用 send_message 转达给该 teammate（或由它的 L2 唤醒）。')
      event({ kind: 'send-refused', sessionId, reason: 'subagent-routing', bytes: text.length })
      process.exit(1)
    }
    throw error
  }
  event({ kind: 'send', sessionId, bytes: text.length })
  say('sent to ' + sessionId + ': accepted=' + String(accepted?.accepted === true))
}
async function runStatus() {
  ensureState()
  const state = readJson(paths.state, null)
  const status = await shellStatus()
  const pending = pendingMessages().length
  const unreplied = pendingMessages().filter((m) => m.status === 'pending').length
  const probe = await providerProbe()
  const ours = await peerRow().catch(() => undefined)
  say('ask-for-help bridge status')
  say('  LINK      : ' + describeStatus(status))
  say('  resident  : ' + (state === null ? 'not running' : 'pid ' + String(state.pid) + ' url ' + String(state.url) + ' at ' + String(state.at)))
  say('  peer      : ' + (ours === undefined ? 'not bound' : JSON.stringify({ status: ours.status, tools: ours.tools })))
  say('  tool      : ' + TOOL_NAME + (ours === undefined ? ' (未注册)' : ' (已注册)'))
  say('  inbox     : ' + String(pending) + ' pending (' + String(unreplied) + ' 未处理)')
  say('  provider  : ' + (probe.ok ? 'ok' : 'BROKEN ' + probe.code) + ' - ' + probe.detail)
  const catalog = await linkCall('session/modelCatalog', {}).catch(() => null)
  const failures = Array.isArray(catalog?.failures) ? catalog.failures : []
  say('  catalog   : ' + (failures.length === 0 ? 'no failures' : failures.map((one) => String(one.id) + ': ' + String(one.message)).join(' | ')))
}
async function runInbox() {
  ensureState()
  const messages = inboxFiles().map((file) => readJson(join(paths.inbox, file), null)).filter((one) => one !== null).sort((left, right) => String(left.at).localeCompare(String(right.at)))
  if (messages.length === 0) { say('inbox empty'); return }
  for (const message of messages) {
    say('[' + String(message.status) + '] ' + message.id + ' ' + message.at + ' ' + message.urgency)
    say('  ' + message.message.replace(/\n/g, '\n  '))
  }
}

const commands = { serve: runServe, wait: runWait, reply: runReply, send: runSend, status: runStatus, inbox: runInbox }
const handler = commands[command]
if (handler === undefined) {
  say('usage: ask-for-help.mjs <serve|wait|reply|send|status|inbox> [args]')
  say('  serve  常驻：把本机作为 link-interconnect 软件 peer 暴露给 DSH-LINK（tools.expose: ' + TOOL_NAME + '）')
  say('  wait   一次性等待：有新喊话/DSH-LINK 掉线/服务商探针失败/agent 报错时打印报告并退出')
  say('  reply  <ticket> <text>         记录对某条喊话的答复')
  say('  send   [--session id] [--new] <text>  把一条消息发进 LINK 会话')
  say('  status | inbox')
  process.exit(1)
}
try {
  await handler()
} catch (error) {
  say(command + ': FAILED — ' + String(error?.stack ?? error))
  process.exit(1)
}
