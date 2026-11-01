#!/usr/bin/env node
/**
 * Verify the continue button's browser half against the shipping kernel.
 *
 *   node plugins/dsh-continue-button/verify-tail-host.mjs
 *
 * Three things are asserted, all against the artifact the profile actually
 * loads (`lib/client.js`) and the real slot core the page loads
 * (`@deepseek-ai/dsh-client-ui-slots` from the app's node_modules):
 *
 *   1. the pre-fix registration is rejected by the kernel (chain slot without
 *      `select` throws), and the shipped one registers;
 *   2. chain election reaches the button exactly on the tails the assistant
 *      action row cannot host (interrupted with no addressable closing
 *      message), and declines everywhere else;
 *   3. clicking sends `[{type:'text',text:'继续'}]` in `queue` mode through the
 *      session service, and the button hides while the session runs or when a
 *      later turn exists.
 *
 * The election loop mirrors the renderer's chain branch (SlotOutlet): entries in
 * ledger order, first non-null selector wins, a thrown selector counts as
 * declined. Set DSH_APP to test another install.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = process.env.DSH_APP ?? '<install-dir>\\resources\\app'
const TAIL = 'conversation.chat.turnTail'
const ACTIONS = 'conversation.chat.assistant-actions'

const { SlotCore } = await import(pathToFileURL(
  join(APP, 'node_modules', '@deepseek-ai', 'dsh-client-ui-slots', 'lib', 'index.js')).href)

/** Load the built browser half through the module-loader seam the page uses. */
async function loadPlugin() {
  const code = await readFile(join(HERE, 'lib', 'client.js'), 'utf8')
  let definition
  globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
  new Function(code)()
  assert.equal(definition?.id, 'dsh-continue-button', 'bundle registers under the package id')
  const element = (type, props) => ({ element: type, props })
  const plugin = definition.factory((specifier) => {
    if (specifier === 'react') return { createElement: element, Fragment: 'Fragment' }
    if (specifier === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' }
    throw new Error(`unexpected external request: ${specifier}`)
  })
  assert.equal(typeof plugin.apply, 'function', 'browser half exposes apply')
  return plugin
}

/** A slot registry plus the inject seam, declared the way ui-chat declares both keys. */
function createHost() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: { [TAIL]: { kind: 'chain', scope: 'session' }, [ACTIONS]: { kind: 'list', scope: 'session' } },
  }, () => null)
  const injections = new Map()
  const slots = {
    // The real service defers the callback until the declaration exists; the
    // harness invokes them explicitly after apply().
    inject: (key, factory) => { injections.set(key, factory); return () => {} },
    register: (options, component) => core.register(options, component),
  }
  return { core, slots, injections }
}

/** Renderer chain branch: ledger order, first non-null selector wins. */
function elect(core, owner) {
  for (const entry of core.entriesOfSlot(TAIL)) {
    let matched
    try { matched = entry.select(owner) } catch { continue }
    if (matched !== null) return { entry, matched }
  }
  return null
}

/* ---- fixtures shaped like ui-chat's turn-tail projection (0.1.5) ---------- */

/** One step location; `status: 'interrupted'` is the kernel's cut-stream signature. */
const step = (status) => ({ data: new Map([['assistant-step', { status, finalNode: { seq: 90 } }]]) })

/** One turn location: `data` is the Map deliverables reads and tail data lives in. */
function turnLocation({ turn, closing, steps, deliverables }) {
  const data = new Map([['turn-tail', { turn, seq: 100, time: 0, closing, branchUnavailable: closing === null }]])
  if (deliverables !== undefined) data.set('deliverables', deliverables)
  return { turn, data, steps }
}

/** Closing message: text block present means `findLast(hasText)` picks it up. */
function closing({ messageId, text }) {
  return {
    finalNode: { seq: 99, ...(messageId === undefined ? {} : { messageId }) },
    blocks: text === undefined ? [{ kind: 'reasoning', text: '想' }] : [{ kind: 'text', text }],
    time: 0,
  }
}

const OWNER_SEQ = 100
const reasoningOnly = () => turnLocation({ turn: 3, closing: null, steps: [step('interrupted')] })

function render(entry, matched, owner, { running = false, turnOrder = [1, 2, 3], messages = [], turns = [] } = {}) {
  const chat = {
    nodes: new Map(messages.map((node, index) => [`n${index}`, node])),
    timeline: { turnOrder, turns: new Map(turns) },
  }
  return entry.component({
    ...owner, matched, sessionId: 'sess-1',
    useSession: (selector) => selector({ running }),
    useChat: (selector) => selector(chat),
  })
}

const sent = []
const sessions = {
  binding: (sessionId) => ({ session: { prompt: (blocks, mode) => { sent.push({ sessionId, blocks, mode }) } } }),
}

/* ---- 1. the kernel's chain contract vs. the registration ------------- */

{
  const probe = createHost()
  let rejected = null
  try {
    // The pre-fix options: a chain registration with no `select`.
    probe.core.register({ name: TAIL, id: 'continue-generation', order: 0 }, () => null)
  } catch (error) { rejected = error.message }
  assert.match(String(rejected), /requires options\.select/, 'shipping core rejects a chain entry without select')
  console.log('ok  pre-fix registration is rejected by the kernel:', rejected)
}

const plugin = await loadPlugin()
const { core, slots, injections } = createHost()
plugin.apply({ slots, sessions })
for (const [key, factory] of injections) factory()

const tailEntries = core.entriesOfSlot(TAIL)
assert.equal(tailEntries.length, 1, 'turnTail entry registers')
assert.equal(typeof tailEntries[0].select, 'function', 'turnTail entry carries select')
const actionEntries = core.entriesOfSlot(ACTIONS)
assert.equal(actionEntries.length, 1, 'assistant-actions entry registers')
assert.equal(actionEntries[0].options.id, 'continue-generation-actions')
console.log('ok  both registrations reach the real registry; chain entry has select')

/* ---- 2. election: reasoning-phase truncation reaches the button ------- */

{
  const owner = { turn: reasoningOnly(), seq: OWNER_SEQ, openFile: () => {} }
  const elected = elect(core, owner)
  assert.ok(elected, 'frozen tail (reasoning only, no messageId) elects the button')
  assert.equal(elected.matched.frozen, true)
  const node = render(elected.entry, elected.matched, owner)
  assert.equal(node?.element, 'button', 'frozen tail renders a button')
  node.props.onClick()
  assert.deepEqual(sent.at(-1), {
    sessionId: 'sess-1', blocks: [{ type: 'text', text: '继续' }], mode: 'queue',
  }, 'click sends 继续 through the session service in queue mode')
  console.log('ok  reasoning-phase truncation elects and renders the button;', JSON.stringify(sent.at(-1)))
}

/* ---- 3. the display and decline rules --------------------------------- */

{
  const owner = { turn: reasoningOnly(), seq: OWNER_SEQ, openFile: () => {} }
  const elected = elect(core, owner)
  assert.equal(render(elected.entry, elected.matched, owner, { running: true }), null,
    'hidden while the session is generating')
  assert.equal(render(elected.entry, elected.matched, owner, { turnOrder: [1, 2, 3, 4] }), null,
    'hidden when a later turn exists')
  assert.equal(render(elected.entry, elected.matched, owner, { turnOrder: [1, 2, 3] })?.element, 'button',
    'shown on the last turn while idle')
  console.log('ok  hides while running and on non-final turns, shows on the final tail')
}

{
  // Interrupted while streaming text but the frozen partial has no messageId:
  // the action row is rendered there yet carries no extraActions host.
  const loc = turnLocation({ turn: 4, closing: closing({ text: '半句' }), steps: [step('interrupted')] })
  const owner = { turn: loc, seq: OWNER_SEQ, openFile: () => {} }
  const elected = elect(core, owner)
  assert.ok(elected, 'interrupted tail without messageId elects the button')
  assert.equal(elected.matched.frozen, false)
  assert.equal(render(elected.entry, elected.matched, owner, { turnOrder: [1, 2, 3, 4] })?.element, 'button')
  console.log('ok  interrupted-with-text tail without messageId elects and renders')
}

{
  // Delivery-phase truncation: closing message is addressable, so the action row
  // hosts the button and the chain must stay free for other tail owners.
  const loc = turnLocation({ turn: 5, closing: closing({ messageId: 'm5', text: '半句' }), steps: [step('interrupted')] })
  const owner = { turn: loc, seq: OWNER_SEQ, openFile: () => {} }
  assert.equal(elect(core, owner), null, 'chain declines when the action row can host the button')

  const message = { kind: 'turn-tail', data: { turn: 5, closing: closing({ messageId: 'm5', text: '半句' }) } }
  const actions = actionEntries[0]
  const node = render(actions, undefined, { messageId: 'm5' }, {
    messages: [message], turnOrder: [5], turns: [[5, { end: { data: { reason: { kind: 'aborted' } } } }]],
  })
  assert.equal(node?.element, 'button', 'action row still hosts the button for addressable messages')
  console.log('ok  delivery-phase truncation keeps the action-row path')
}

{
  const actions = actionEntries[0]
  // Both block-tagging conventions: 0.1.5 closes with `kind`, 0.2.x with `type`.
  const shapes = [
    ['kind', { kind: 'text', text: '完整答复```\n代码\n```' }],
    ['type', { type: 'text', text: '完整答复```\n代码\n```' }],
  ]
  for (const [tagging, block] of shapes) {
    const message = { kind: 'turn-tail', data: { turn: 6, closing: { finalNode: { seq: 99, messageId: 'm6' }, blocks: [block], time: 0 } } }
    const node = render(actions, undefined, { messageId: 'm6' }, {
      messages: [message], turnOrder: [6], turns: [[6, { end: { data: { reason: { kind: 'completed' } } } }]],
    })
    assert.equal(node, null, `a completed, closed reply shows nothing (${tagging}-tagged blocks)`)
  }

  // Truncated delivery: text present, fences opened, reason not completed.
  const cut = { kind: 'turn-tail', data: { turn: 6, closing: { finalNode: { seq: 99, messageId: 'm6' }, blocks: [{ kind: 'text', text: '半句```\n' }], time: 0 } } }
  const cutNode = render(actions, undefined, { messageId: 'm6' }, {
    messages: [cut], turnOrder: [6], turns: [[6, { end: { data: { reason: { kind: 'aborted' } } } }]],
  })
  assert.equal(cutNode?.element, 'button', 'a truncated delivery still shows (unclosed fence + aborted)')
  console.log('ok  completed replies stay untouched under both block shapes; truncated delivery still shows')
}

{
  // A clean turn that only called tools (no prose, no interruption) claims the
  // host but must render nothing; deliverable turns yield the chain outright.
  const toolOnly = turnLocation({ turn: 7, closing: null, steps: [step('settled')] })
  const toolOwner = { turn: toolOnly, seq: OWNER_SEQ, openFile: () => {} }
  const toolElected = elect(core, toolOwner)
  assert.equal(render(toolElected?.entry, toolElected?.matched, toolOwner,
    { turnOrder: [7], turns: [[7, { end: { data: { reason: { kind: 'completed' } } } }]] }), null,
    'a clean tool-only turn renders nothing')
  const delivered = turnLocation({
    turn: 8, closing: null, steps: [step('interrupted')],
    deliverables: { produced: [{ path: 'a.ts', seq: 50 }], presented: [] },
  })
  assert.equal(elect(core, { turn: delivered, seq: OWNER_SEQ }), null,
    'a turn owning deliverables yields the chain to the shipped tail owner')
  console.log('ok  clean tool-only turns render nothing; deliverable turns are declined')
}

{
  // The two independent "cut" signals, each sufficient on its own.
  const aborted = turnLocation({
    turn: 9, closing: null, steps: [step('settled')],
  })
  const abortedOwner = { turn: aborted, seq: OWNER_SEQ, openFile: () => {} }
  const abortedElected = elect(core, abortedOwner)
  assert.equal(render(abortedElected.entry, abortedElected.matched, abortedOwner, {
    turnOrder: [9], turns: [[9, { end: { data: { reason: { kind: 'aborted' } } } }]],
  })?.element, 'button', 'a non-completed end reason alone shows the button')

  const interrupted = turnLocation({ turn: 10, closing: null, steps: [step('interrupted')] })
  const interruptedOwner = { turn: interrupted, seq: OWNER_SEQ, openFile: () => {} }
  const interruptedElected = elect(core, interruptedOwner)
  assert.equal(render(interruptedElected.entry, interruptedElected.matched, interruptedOwner, {
    turnOrder: [10], turns: [[10, { end: { data: { reason: { kind: 'completed' } } } }]],
  })?.element, 'button', 'an interrupted assistant step alone shows the button')
  console.log('ok  either cut signal (end reason, interrupted step) shows the button')
}

{
  // The shipped deliverables entry registers earlier, so ledger order alone
  // protects its row; a rival registered first must win the contested tail.
  const { core: rival, slots: rivalSlots, injections: rivalInjections } = createHost()
  let rivalWins = 0
  rival.register({ name: TAIL, select: () => ({ rival: true }) }, () => { rivalWins += 1 })
  plugin.apply({ slots: rivalSlots, sessions })
  for (const [, factory] of rivalInjections) for (const disposer of [factory()]) void disposer
  const owner = { turn: reasoningOnly(), seq: OWNER_SEQ, openFile: () => {} }
  const elected = elect(rival, owner)
  assert.equal(elected?.matched?.rival, true, 'an earlier ledger entry keeps its claim')
  console.log('ok  an earlier tail owner on the same turn is never stolen from')
}

{
  // Garbage owners must be declined, never thrown at (the renderer treats a
  // thrown selector as declined, but a crash log per render is still wrong).
  for (const owner of [undefined, {}, { turn: 7 }, { turn: null }, { turn: { data: 5 } }]) {
    assert.equal(elect(core, owner), null, `select declines malformed owner: ${JSON.stringify(owner)}`)
  }
  console.log('ok  select declines malformed owners without throwing')
}

console.log('\nall continue-button tail-host checks passed')
