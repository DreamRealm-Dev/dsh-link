#!/usr/bin/env node
/**
 * Gate 119 (R186-C) - notes-inject: THE HALF OF md ITEM 13 THAT IS NOT THE LEDGER.
 *
 * Subject: the prompt-injection face, the approval seam and the tool group of plugins/dsh-link-notes
 * (docs/handoff/R186-contract.md section 3.3, section 9 rulings R2/R3/R4/R5/R6), shipped in
 * plugins/dsh-link-notes/lib/index.js, together with the notes group row the shipped
 * plugins/dsh-link-groups/cordis.patch.yml declares. Written by a verifier who wrote neither the
 * plugin, nor its row, nor the data-face gate.
 *
 * THE WORLD IS THE REAL KERNEL RUNNING THE REAL AGENT LOOP. A fresh cordis Context mounts the
 * kernel's own LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime,
 * ApprovalService, AgentRegistry and AgentLoop; the agent is minted by ctx.agentLoop.create(), so
 * its scope, its session and every request/header, system/message, developer/message, tool/result
 * and approval/* event below is a genuine kernel event. The notes row and the groups row are the
 * SHIPPED bytes, staged onto this gate's own kernel module paths and applied through their own
 * apply(); the group table is parsed out of the shipped cordis.patch.yml at run time, never
 * transcribed here. The ONE substituted service is the MODEL (a scripted LlmAdapter), an external
 * nondeterministic input the gate is allowed to script; the loop, the registries, the session and
 * both plugins stay real.
 *
 * DEPENDENCY: this gate measures BUILT artifacts. It reads plugins/dsh-link-notes/lib/index.js,
 * plugins/dsh-link-groups/lib/index.js and plugins/dsh-link-groups/cordis.patch.yml, records the
 * sha256 of each in its readings, and refuses (exit 3) when one is missing. Source-plane claims are
 * not made here.
 *
 * Readings (each of which can fail on its own evidence):
 *
 *   1 STEP-LEVEL SEMANTICS. A note that appears during step N is in the request of step N+1 and is
 *     absent from the request of step N, and the session says which step committed it: the head
 *     rewrite is logged on the FOLLOWING step, never on the step that changed the ledger.
 *   2 NO CHURN WHILE NOTHING CHANGES. In turns whose ledger did not move, the session commits
 *     exactly ZERO system/message events, and every request in them carries the same prompt bytes.
 *     This pins packages/core/agent-loop/src/runtime-context.ts:98 from the outside.
 *   3 APPROVAL IS FAIL-CLOSED. With no approval service, with no answerer, with a cancelled question
 *     and with a rejection, notes_add is denied with the KERNEL sentence and the ledger bytes are
 *     unchanged; with allowed-once exactly ONE note/state record is appended, and the note an
 *     approved call writes reaches the FOLLOWING step's request. notes_list never asks.
 *   4 THE GROUP MASKS AT THE EXECUTION FACE, NOT ONLY IN THE SCHEMA. While notes is closed both
 *     members answer UNKNOWN_TOOL, byte-for-byte a name that never existed, and the registry lookup
 *     finds nothing; after one declaration the same names are in the face and notes_list answers.
 *     Its contrast is the ANCESTOR-LAYER premise: the same two names registered on the agent's own
 *     scope leave the group refused by name (GROUPS_NO_TOOLS) and reachable anyway.
 *   5 ONE DECLARATION, ONE SLIDE. Declaring the shipped notes row adds exactly one reason:'change'
 *     request/header and exactly one developer/message, whose rows are exactly the two members; the
 *     cost trio the declaration reports is this gate's own arithmetic over the live face.
 *   6 REGISTRATION. Read from the MOUNTED system prompt, not from a module export: notes:ledger
 *     carries order 700 and interpolate false, and the assembled prompt places it between a 600
 *     sentinel and an 800 sentinel. (The empty-ledger render belongs to gate 118 and is not claimed
 *     here.)
 *   7 THE CHAT-SHAPED SESSION. A complete persona suppresses the section (the kernel says it
 *     suppresses sections and nothing else), and the tool face of that same session is READ OUT:
 *     the numbers for both compositions are reported, and the PTC-shaped one is named as such.
 *   8 THE TWO FILES AGREE, AND A ONE-CHARACTER DISAGREEMENT IS NAMED. The shipped row's member
 *     names equal the artifact's own exported tool names; the rows the plugin blocks are exactly the
 *     rows this gate computes as unreachable, and every other row stays openable.
 *
 * Self-attack: --self-attack rewrites the SHIPPED BYTES of the two measured products (one string
 * replacement per mutant, applied to the file this gate reads) and re-runs the whole measurement
 * against that build, so every mutant is anchored on the product itself rather than on a fixture.
 * It asserts, per mutant, that the set of readings that moved is exactly the declared set, prints
 * the sentence 声明集 == 观测集 for each, requires every reading to be covered by at least one
 * mutant, and includes a control mutant that changes nothing.
 *
 * WHAT THIS GATE CANNOT JUDGE. It scripts the model, so it says nothing about a real backend. It
 * does not restart the client, so 'a restart needs the group declared again' is not measured. Its
 * 'another writer' is the mounted store's OWN appendNote from inside this process, not a second
 * process: the collaboration ledger refuses a second open of one directory per process (measured),
 * so the second-process case is the reason the probe exists and not a thing this gate can run. It
 * does not mount a PTC preset (that composition does not mount the groups row at all, and the
 * contract forbids the row there): reading 7 reports the PTC-shaped numbers from a composition with
 * no groups row, which is the shape, not the preset. It reads one provider-independent prompt cost,
 * not any cache hit rate, and its startsSeries is the header the session actually held - never a
 * prediction of the next series (docs/handoff/R185-A-groups.md G5/G6).
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be measured here: a kernel
 * module or a built artifact is missing, the shipped group row cannot be read, or the world could not
 * be built. A reading that cannot be measured is never a pass.
 *
 * Usage: node scripts/verify-notes-inject.mjs [--module <path>] [--groups-module <path>] [--yml <path>]
 *        [--self-attack] [--keep]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = fileURLToPath(new URL('.', import.meta.url))
const PROJECT = (() => {
  let at = resolve(HERE, '..')
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-notes', 'lib', 'index.js'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const ATTACK_CHILD = has('--attack-child')
const KEEP = has('--keep')
const NOTES_MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')))
const GROUPS_MODULE = resolve(option('--groups-module', join(PROJECT, 'plugins', 'dsh-link-groups', 'lib', 'index.js')))
const GROUPS_YML = resolve(option('--yml', join(PROJECT, 'plugins', 'dsh-link-groups', 'cordis.patch.yml')))
const COLLAB_MODULE = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
/** The mutant is armed only in the child process the attack spawns; an exported variable must never arm it. */
const MUTANT = ATTACK_CHILD ? (process.env.R186_G119_MUTANT ?? '') : ''

/** The kernel modules the two subjects import, by path, so plugin and world share ONE instance of each. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent-loop': join(KERNEL, 'packages', 'core', 'agent-loop', 'lib', 'index.js'),
  '@deepseek-ai/dsh-llm': join(KERNEL, 'packages', 'llm', 'llm', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session-projection': join(KERNEL, 'packages', 'session', 'session-projection', 'lib', 'index.js'),
  '@deepseek-ai/dsh-user-approval': join(KERNEL, 'packages', 'interaction', 'user-approval', 'lib', 'index.js'),
}

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const clip = (text, n) => { const out = String(text); return out.length > n ? out.slice(0, n) + '...' : out }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sha12 = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12)
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); console.log('SKIP: ' + why); return 3 }
const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)]

/** The readings this gate makes, in the order it prints them. */
const READINGS = [
  '01-the-head-rewrite-lands-on-the-next-step',
  '02-an-unchanged-turn-commits-nothing',
  '03-approval-is-fail-closed-and-the-ledger-is-untouched',
  '04-the-closed-group-is-unknown-at-the-execution-face',
  '05-one-declaration-is-one-slide',
  '06-the-mounted-section-carries-order-700-and-no-interpolation',
  '07-the-chat-shaped-session-tool-face-is-read-out',
  '08-the-two-files-agree-or-the-row-is-refused-by-name',
]

// ---------------------------------------------------------------------------
// The mutant set: each rewrites ONE string in a measured product's OWN bytes and declares
// exactly which readings must move. Anchored on the product, not on a fixture.
// ---------------------------------------------------------------------------
const MUTANTS = [
  {
    name: 'the-section-order-moves', target: 'notes',
    from: 'var SECTION_ORDER = 700;', to: 'var SECTION_ORDER = 800;',
    expect: ['06-the-mounted-section-carries-order-700-and-no-interpolation'],
    why: 'the order the mounted section carries leaves the 600..800 slot, which the assembled position and the registry field both read',
  },
  {
    name: 'interpolation-turns-on', target: 'notes',
    from: 'interpolate: false', to: 'interpolate: true',
    expect: ['06-the-mounted-section-carries-order-700-and-no-interpolation'],
    why: 'the section stops declaring interpolation off, so user text would be read as a template',
  },
  {
    name: 'the-ask-disappears', target: 'notes',
    from: 'return { kind: "ask" };', to: 'return next();',
    expect: ['03-approval-is-fail-closed-and-the-ledger-is-untouched'],
    why: 'notes_add stops asking, so a world with no approval channel appends instead of denying',
  },
  {
    name: 'the-section-stops-reading-the-ledger', target: 'notes',
    from: 'text: () => renderNotesSection(notesOf(store), limits)', to: 'text: () => "GATE119-FROZEN-SECTION"',
    expect: [
      '01-the-head-rewrite-lands-on-the-next-step',
      '03-approval-is-fail-closed-and-the-ledger-is-untouched',
    ],
    why: 'the section text is frozen, so no step ever carries a note: the step-level reading sees no rewrite, and an approved note that lands on disk never reaches a later step request',
  },
  {
    name: 'the-section-churns-on-every-assembly', target: 'notes',
    from: 'text: () => renderNotesSection(notesOf(store), limits)',
    to: 'text: () => renderNotesSection(notesOf(store), limits) + String(globalThis.__g119 = (globalThis.__g119 ?? 0) + 1)',
    expect: ['02-an-unchanged-turn-commits-nothing'],
    why: 'the text moves on every assembly, so a turn whose ledger did not move commits a system/message per step',
  },
  {
    name: 'the-shipped-row-misspells-a-member', target: 'groups',
    from: '- notes_list', to: '- notes_lst',
    expect: [
      '03-approval-is-fail-closed-and-the-ledger-is-untouched',
      '04-the-closed-group-is-unknown-at-the-execution-face',
      '05-one-declaration-is-one-slide',
      '07-the-chat-shaped-session-tool-face-is-read-out',
      '08-the-two-files-agree-or-the-row-is-refused-by-name',
    ],
    why: 'the row names a tool no layer carries, so the group is refused by name and can never open: the tool never runs, the slide never happens, and because a broken row masks only the members it could resolve, the OTHER member stays reachable (reading 7 sees it in the chat-shaped face)',
  },
  {
    name: 'the-artifact-registers-a-misspelled-name', target: 'notes',
    from: 'var LIST_TOOL = "notes_list";', to: 'var LIST_TOOL = "notes_lst";',
    expect: [
      '03-approval-is-fail-closed-and-the-ledger-is-untouched',
      '04-the-closed-group-is-unknown-at-the-execution-face',
      '05-one-declaration-is-one-slide',
      '07-the-chat-shaped-session-tool-face-is-read-out',
      '08-the-two-files-agree-or-the-row-is-refused-by-name',
    ],
    why: 'the artifact registers a name the shipped row does not declare, so from the other end of the same seam the row is refused by name and the PTC-shaped face carries the wrong spelling',
  },
  { name: 'control-nothing-changed', target: 'none', from: null, to: null, expect: [], why: 'a build with no change of its own must move nothing; it is the control that this attack measures deltas' },
]

// ---------------------------------------------------------------------------
// Staging: the shipped bytes, with ONLY their import specifiers rewritten onto the exact module
// paths this gate also imports, so both sides share one registry instance of the pinned kernel.
// ---------------------------------------------------------------------------
const substitutions = () => Object.assign({}, KERNEL_MODULES, { '../../dsh-link-collab/lib/index.js': COLLAB_MODULE })
const stageSource = (source) => {
  let text = source
  let rewrites = 0
  const all = substitutions()
  for (const specifier of Object.keys(all)) {
    const url = pathToFileURL(all[specifier]).href
    for (const quote of QUOTES) {
      const parts = text.split(quote + specifier + quote)
      rewrites += parts.length - 1
      text = parts.join(quote + url + quote)
    }
  }
  return { text, rewrites }
}
const unstageSource = (text) => {
  let out = text
  const all = substitutions()
  for (const specifier of Object.keys(all)) out = out.split(pathToFileURL(all[specifier]).href).join(specifier)
  return out
}
const bareSpecifiers = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)].map((match) => match[1]).filter((spec) => spec.startsWith('@') || spec.startsWith('.'))

// ---------------------------------------------------------------------------
// The shipped group table, read out of the shipped YAML bytes. This gate never transcribes the
// row: it parses the bytes the client would read, so the mutation of reading 8 is a mutation of
// the product and not of a fixture.
// ---------------------------------------------------------------------------
const unquote = (value) => {
  const text = String(value).trim()
  if (text.length >= 2 && ((text.startsWith(String.fromCharCode(39)) && text.endsWith(String.fromCharCode(39))) || (text.startsWith(String.fromCharCode(34)) && text.endsWith(String.fromCharCode(34))))) return text.slice(1, -1)
  return text
}
const parseGroupRows = (text) => {
  const rows = []
  let inside = false
  let current = null
  let nested = null
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/[ \t]+$/u, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (/^[A-Za-z][A-Za-z0-9_]*:\s*$/u.test(trimmed) && indent < 10) { inside = trimmed === 'groups:'; current = null; nested = null; continue }
    if (!inside) continue
    if (indent < 10) { inside = false; current = null; nested = null; continue }
    const entry = /^-\s+id:\s*(.+)$/u.exec(trimmed)
    if (entry !== null) { current = { id: unquote(entry[1]), tools: [] }; rows.push(current); nested = null; continue }
    if (current === null) continue
    const item = /^-\s+(.+)$/u.exec(trimmed)
    if (item !== null) { if (nested === 'tools') current.tools.push(unquote(item[1])); continue }
    const key = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/u.exec(trimmed)
    if (key === null) continue
    const field = key[1]
    const value = key[2]
    const owner = nested
    nested = null
    if (field === 'tools' && value === '') { nested = 'tools'; continue }
    if (field === 'auto' && value === '') { current.auto = {}; nested = 'auto'; continue }
    if (owner === 'auto') { current.auto[field] = unquote(value); continue }
    if (field === 'userDisabled' || field === 'relockable') { current[field] = unquote(value) === 'true'; continue }
    if (value !== '') current[field] = unquote(value)
  }
  const preamble = /^\s*catalogPreamble:\s*(.+)$/mu.exec(text)
  const deferred = /^\s*deferredNotice:\s*(\S+)\s*$/mu.exec(text)
  return {
    rows,
    config: {
      groups: rows,
      ...preamble === null ? {} : { catalogPreamble: unquote(preamble[1]) },
      ...deferred === null ? {} : { deferredNotice: unquote(deferred[1]) === 'true' },
    },
  }
}
const describeRows = (rows) => rows.map((row) => row.id + '{tools=' + show(row.tools) + ',state=' + show(row.state) + ',provider=' + show(row.provider) + ',auto=' + show(row.auto) + '}').join(' ')
// ---------------------------------------------------------------------------
// Scratch rooms: everything this gate writes lives under .tmp/r186-g119/ and is removed again.
// ---------------------------------------------------------------------------
let BASE = null
const base = () => {
  if (BASE === null) {
    mkdirSync(join(PROJECT, '.tmp'), { recursive: true })
    BASE = join(PROJECT, '.tmp', 'r186-g119', 'run-' + String(process.pid) + '-' + String(Date.now()))
    mkdirSync(BASE, { recursive: true })
  }
  return BASE
}
const room = (tag) => { const dir = join(base(), tag); mkdirSync(dir, { recursive: true }); return dir }

// ---------------------------------------------------------------------------
// Bytes on disk: this gate's own reader, so no expectation is read back from the plugin.
// ---------------------------------------------------------------------------
const filesUnder = (root) => {
  const out = []
  const walk = (rel) => {
    const abs = rel === '' ? root : join(root, rel)
    if (existsSync(abs) === false) return
    for (const name of readdirSync(abs).sort()) {
      const child = rel === '' ? name : rel + '/' + name
      if (statSync(join(abs, name)).isDirectory()) walk(child)
      else out.push(child)
    }
  }
  walk('')
  return out.sort()
}
const bytesOf = (root) => {
  const map = {}
  for (const rel of filesUnder(root)) map[rel] = readFileSync(join(root, rel))
  return map
}
const digestOf = (map) => sha12(Buffer.concat(Object.keys(map).sort().map((rel) => Buffer.concat([Buffer.from(rel + '=', 'utf8'), map[rel], Buffer.from(';', 'utf8')]))))
const sizeList = (map) => Object.keys(map).sort().map((rel) => rel + ' ' + String(map[rel].length) + 'B').join(', ')
const recordsOf = (map) => {
  const rows = []
  for (const rel of Object.keys(map).sort()) {
    if (rel.endsWith('.jsonl') === false) continue
    for (const line of map[rel].toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try { const parsed = JSON.parse(trimmed); if (parsed !== null && typeof parsed === 'object') rows.push(parsed) } catch { /* an unreadable line is not a fact this gate counts */ }
    }
  }
  return rows.sort((left, right) => Number(left.seq) - Number(right.seq))
}
const ledgerNow = (dir) => {
  const map = bytesOf(dir)
  const rows = recordsOf(map)
  const notes = rows.filter((row) => row.kind === 'note/state')
  return {
    digest: digestOf(map), sizes: sizeList(map), count: rows.length, notes: notes.length,
    texts: notes.map((row) => String(row.payload === null || row.payload === undefined ? '' : row.payload.text)),
  }
}

// ---------------------------------------------------------------------------
// The kernel: the real services, by path, one instance each.
// ---------------------------------------------------------------------------
let KERNEL_CACHE = null
const loadKernel = async () => {
  if (KERNEL_CACHE !== null) return KERNEL_CACHE
  for (const specifier of Object.keys(KERNEL_MODULES)) {
    if (existsSync(KERNEL_MODULES[specifier]) === false) {
      throw new Error('the kernel module ' + specifier + ' is missing at ' + KERNEL_MODULES[specifier] + '; this gate mounts the real kernel and will not stand in a fake registry')
    }
  }
  const load = (key) => import(pathToFileURL(KERNEL_MODULES[key]).href)
  const cordis = await load('@deepseek-ai/cordis')
  const prompt = await load('@deepseek-ai/dsh-system-prompt')
  const tools = await load('@deepseek-ai/dsh-tools')
  const session = await load('@deepseek-ai/dsh-session')
  const agent = await load('@deepseek-ai/dsh-agent')
  const loop = await load('@deepseek-ai/dsh-agent-loop')
  const projection = await load('@deepseek-ai/dsh-session-projection')
  const llm = await load('@deepseek-ai/dsh-llm')
  const approval = await load('@deepseek-ai/dsh-user-approval')
  KERNEL_CACHE = {
    Context: cordis.Context,
    SystemPrompt: prompt.default,
    renderPrompt: prompt.renderPrompt,
    ToolRuntime: tools.default,
    defineTool: tools.defineTool,
    SessionStore: session.default,
    Session: session.Session,
    SessionId: session.SessionId,
    AgentRegistry: agent.default,
    AgentLoop: loop.default,
    SessionProjectionRegistry: projection.default,
    LlmRuntime: llm.default === undefined ? llm.LlmRuntime : llm.default,
    LlmAdapter: llm.LlmAdapter,
    createUserMessage: llm.createUserMessage,
    ApprovalService: approval.default,
  }
  return KERNEL_CACHE
}

// ---------------------------------------------------------------------------
// The scripted model: the ONE substituted service (an external, nondeterministic input).
// ---------------------------------------------------------------------------
const textResponse = (text) => [
  { type: 'block-start', index: 0, blockType: 'text' },
  ...Array.from(text, (char) => ({ type: 'text-delta', index: 0, text: char })),
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const toolCallResponse = (rawCallId, name, args) => {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: rawCallId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id: rawCallId, name, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: rawCallId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
const makeAdapter = (LlmAdapter) => class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.requests = [] }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
  async * stream(options) {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('the scripted model ran out of scripted answers')
    for (const chunk of (typeof entry === 'function' ? entry(options) : entry)) yield chunk
  }
}

// ---------------------------------------------------------------------------
// Session readers. Every number the judge uses comes from one of these, over the kernel's own log.
// ---------------------------------------------------------------------------
const systemText = (request) => {
  const messages = Array.isArray(request.messages) ? request.messages : []
  const first = messages[0]
  if (first === undefined || first === null) return ''
  const content = Array.isArray(first.content) ? first.content : []
  return content.filter((block) => block !== null && block.type === 'text').map((block) => String(block.text)).join('')
}
const requestTools = (request) => (Array.isArray(request.tools) ? request.tools.map((tool) => String(tool.name)) : [])
const stepKey = (turn, step) => String(turn) + ':' + String(step)
const stepRows = (all) => all.filter((event) => event.type === 'step/start').map((event) => { const data = event.data === null || event.data === undefined ? {} : event.data; return { seq: event.seq, turn: data.turn, step: data.step, key: stepKey(data.turn, data.step) } })
const commitRows = (all) => all.filter((event) => event.type === 'system/message').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const content = Array.isArray(data.message?.content) ? data.message.content : []
  return {
    seq: event.seq, turn: data.turn, step: data.step, key: stepKey(data.turn, data.step),
    text: content.filter((block) => block !== null && block.type === 'text').map((block) => String(block.text)).join(''),
    intent: data.message === undefined ? 'unknown' : String(event.seq),
  }
})
const headerRows = (all) => all.filter((event) => event.type === 'request/header').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  return { seq: event.seq, reason: String(data.reason === undefined ? '' : data.reason), startsSeries: data.startsSeries === true, tools: (Array.isArray(data.header?.tools) ? data.header.tools : []).map((tool) => String(tool.name)) }
})
const developerRows = (all) => all.filter((event) => event.type === 'developer/message').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const content = Array.isArray(data.message?.content) ? data.message.content : []
  return { seq: event.seq, headerSeq: data.headerSeq === undefined ? null : data.headerSeq, source: String(data.message?.source?.kind ?? ''), rows: content.map((block) => String(block === null || block === undefined ? '' : block.type === 'tool-addition' ? 'addition:' + String(block.toolName) : block.type === 'tool-removal' ? 'removal:' + String(block.toolName) : block.type)) }
})
const resultRows = (all) => all.filter((event) => event.type === 'tool/result').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const content = Array.isArray(data.message?.content) ? data.message.content : []
  return { seq: event.seq, callId: data.message?.toolCallId === undefined ? null : String(data.message.toolCallId), isError: data.message?.isError === true, text: content.filter((block) => block !== null && block.type === 'text').map((block) => String(block.text)).join('') }
})
const auditRows = (all) => ({
  asked: all.filter((event) => event.type === 'approval/asked').map((event) => event.data),
  decided: all.filter((event) => event.type === 'approval/decided').map((event) => event.data),
})
// ---------------------------------------------------------------------------
// The world: real kernel, real loop, both shipped rows applied by their own apply().
// ---------------------------------------------------------------------------
const SENTINEL_LOW = 'gate119:before'
const SENTINEL_HIGH = 'gate119:after'
const PING = 'gate119_ping'
const APPEND_PROBE = 'gate119_append'
const GHOST = 'gate119_ghost_never_registered'
const CHAT_PERSONA = 'gate119:chat-persona'
const MAIN_AGENT = 'gate119-main'
const CHAT_AGENT = 'gate119-chat'
const CATALOG = 'tool_groups'
const DECLARE = 'tool_groups_declare'
const LIST_TOOL = 'notes_list'
const ADD_TOOL = 'notes_add'

const stubTool = (defineTool, name) => defineTool({
  name,
  description: 'gate 119 registration probe: ' + name,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: () => 'ran:' + name,
})

/** The note bodies this gate writes. Each one is a distinct string so a request can be searched for it. */
const NOTE_A = 'gate119-note-alpha-from-another-writer'
const NOTE_B = 'gate119-note-bravo-from-the-second-writer'
const NOTE_C = 'gate119-note-charlie-that-the-masked-call-never-wrote'
const NOTE_D = 'gate119-note-delta-from-the-notes-add-tool'
const NOTE_E = 'gate119-note-echo-that-was-never-approved'

let PROBE_SEQ = 0
const callTool = async (ctx, agent, name, args, callId) => {
  PROBE_SEQ += 1
  try {
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: callId === undefined ? 'gate119-probe-' + String(PROBE_SEQ) : callId, name, arguments: args === undefined ? {} : args, agent })
    const content = Array.isArray(result.content) ? result.content : []
    return { threw: false, isError: result.isError === true, callId: callId === undefined ? 'gate119-probe-' + String(PROBE_SEQ) : callId, text: content.filter((block) => block !== null && block !== undefined && block.type === 'text').map((block) => String(block.text)).join('') }
  } catch (error) {
    return { threw: true, isError: true, callId: callId === undefined ? 'gate119-probe-' + String(PROBE_SEQ) : callId, text: 'threw: ' + describe(error) }
  }
}
const faceSchemas = (ctx, agent) => ctx.tools.schemas(agent)
const faceNames = (ctx, agent) => faceSchemas(ctx, agent).map((tool) => String(tool.name))
const faceBytes = (ctx, agent) => Buffer.byteLength(JSON.stringify(faceSchemas(ctx, agent)), 'utf8')
const registeredNames = (ctx) => ctx.tools.schemas().map((tool) => String(tool.name))
const noteNames = (names) => names.filter((name) => name.startsWith('notes_'))

/**
 * One loop world: real services, the shipped rows applied through their own apply(), a real agent.
 * @param subject - the staged artifacts and the parsed shipped row table.
 * @param options - withGroups: mount the groups row (false is the PTC-shaped composition, which the
 *   shipped groups file says must not mount it); notesPlane: 'host' applies the notes row on the
 *   host context before the groups row, 'agent' applies it on the agent's OWN scope after it.
 */
const buildLoopWorld = async (subject, options) => {
  const K = await loadKernel()
  const ctx = new K.Context()
  await ctx.plugin(K.LlmRuntime)
  await ctx.plugin(K.SessionStore)
  await ctx.plugin(K.SessionProjectionRegistry)
  await ctx.plugin(K.SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
  await ctx.plugin(K.ToolRuntime)
  await ctx.plugin(K.ApprovalService, { policy: 'ask' })
  await ctx.plugin(K.AgentRegistry)
  await ctx.plugin(K.AgentLoop, { agents: [] })
  const adapter = new (makeAdapter(K.LlmAdapter))([])
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.systemPrompt.section({ name: SENTINEL_LOW, order: 600, interpolate: false, text: () => 'GATE119-BEFORE' })
  ctx.systemPrompt.section({ name: SENTINEL_HIGH, order: 800, interpolate: false, text: () => 'GATE119-AFTER' })
  const teams = subject.rows.filter((row) => row.id === 'teams')[0]
  const teamMembers = teams === undefined ? [] : teams.tools
  for (const name of teamMembers) ctx.tools.register(stubTool(K.defineTool, name))
  ctx.tools.register(stubTool(K.defineTool, PING))
  ctx.tools.register(K.defineTool({
    name: APPEND_PROBE,
    description: 'gate 119 probe: append one note through the mounted store own appendNote, the way a writer other than the notes_add tool would',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      const store = ctx.get('linkNotes')
      if (store === undefined) return 'gate119: the notes row published no store'
      const appended = await subject.notesModule.appendNote(store, { text: String(args === null || args === undefined ? '' : args.text), tags: ['gate119'], author: 'gate119-writer' })
      return 'gate119-writer appended ' + String(appended.id)
    },
  }))
  let notesFiber = null
  const applyNotes = async (onCtx) => { notesFiber = onCtx.plugin(subject.notesModule, { dir: options.ledgerDir }); await notesFiber; return notesFiber }
  let groupsFiber = null
  const applyGroups = async () => { groupsFiber = ctx.plugin(subject.groupsModule, subject.config); await groupsFiber; return groupsFiber }
  if (options.notesPlane === 'agent') {
    if (options.withGroups === true) await applyGroups()
  } else {
    await applyNotes(ctx)
    if (options.withGroups === true) await applyGroups()
  }
  const agent = await ctx.agentLoop.create(K.SessionId(MAIN_AGENT), { provider: 'mock', model: 'model' })
  if (options.notesPlane === 'agent') await applyNotes(agent.ctx)
  const chat = await ctx.agentLoop.create(K.SessionId(CHAT_AGENT), { provider: 'mock', model: 'model' })
  chat.ctx.systemPrompt.section({ name: CHAT_PERSONA, order: 100, complete: true, interpolate: false, text: () => 'GATE119-CHAT-PERSONA' })
  return { ctx, agent, chat, adapter, notesFiber, groupsFiber, teamMembers }
}

/** One approval probe world: no loop, a hand-built agent whose session holds an open turn. */
const buildApprovalWorld = async (subject, tag, options) => {
  const K = await loadKernel()
  const ctx = new K.Context()
  await ctx.plugin(K.SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
  await ctx.plugin(K.ToolRuntime)
  if (options.withService === true) await ctx.plugin(K.ApprovalService, { policy: 'ask' })
  const dir = room('approval-' + tag)
  await ctx.plugin(subject.notesModule, { dir })
  const session = K.Session.create(K.SessionId('gate119-approval-' + tag))
  session.append('turn/start', { turn: 1 })
  const counter = { asks: 0 }
  if (options.outcome !== null && options.outcome !== undefined) {
    ctx.on('approval/request', () => { counter.asks += 1; return options.outcome })
  }
  const agent = { id: 'gate119-approval-' + tag, session, ctx: undefined }
  return { ctx, agent, session, dir, counter }
}

// ---------------------------------------------------------------------------
// The measurement. Every expectation of the judge is arithmetic over this transcript.
// ---------------------------------------------------------------------------
const readSection = (ctx) => {
  const sections = ctx.systemPrompt?.layers?.global?.sections
  if (sections === undefined || sections === null || typeof sections.get !== 'function') return null
  const entry = sections.get('notes:ledger')
  if (entry === undefined || entry === null) return null
  return { source: 'the mounted systemPrompt service (layers.global.sections.get)', name: String(entry.name), order: entry.order, interpolate: entry.interpolate }
}
const assemblyRows = (assembly) => (Array.isArray(assembly?.sections) ? assembly.sections : []).map((row) => ({ name: String(row.name), interpolate: row.interpolate, text: String(row.text) }))

async function measure(subject) {
  const K = await loadKernel()
  const t = { notesModulePath: subject.notesPath, notesSha: subject.notesSha, notesBytes: subject.notesBytes, groupsSha: subject.groupsSha, ymlPath: subject.ymlPath, ymlSha: subject.ymlSha, rows: subject.rows, config: subject.config, staging: subject.staging, exports: {}, walls: {} }
  const mainLedgerDir = room('ledger-main')
  const world = await buildLoopWorld(subject, { withGroups: true, notesPlane: 'host', ledgerDir: mainLedgerDir })
  const { ctx, agent, chat, adapter } = world
  const module_ = subject.notesModule
  t.exports = {
    sectionName: module_.SECTION_NAME, sectionOrder: module_.SECTION_ORDER,
    listTool: module_.LIST_TOOL, addTool: module_.ADD_TOOL,
    refusals: module_.REFUSALS, limits: { maxNotes: module_.DEFAULT_MAX_NOTES, maxChars: module_.DEFAULT_MAX_CHARS },
  }
  const ledgerDir = mainLedgerDir
  t.install = {
    section: readSection(ctx),
    assembled: assemblyRows(await ctx.systemPrompt.assemble({})),
    registered: registeredNames(ctx),
    face: faceNames(ctx, agent),
    faceBytes: faceBytes(ctx, agent),
    ledger: ledgerNow(ledgerDir),
    catalog: await callTool(ctx, agent, CATALOG, {}),
  }
  t.closed = {
    notesList: await callTool(ctx, agent, LIST_TOOL, {}),
    notesAdd: await callTool(ctx, agent, ADD_TOOL, { text: NOTE_C }),
    ghost: await callTool(ctx, agent, GHOST, {}),
    lookup: {
      list: ctx.tools.get(LIST_TOOL, agent) === undefined ? 'absent' : 'present',
      add: ctx.tools.get(ADD_TOOL, agent) === undefined ? 'absent' : 'present',
      ghost: ctx.tools.get(GHOST, agent) === undefined ? 'absent' : 'present',
    },
  }
  t.chat = { assembled: assemblyRows(await ctx.systemPrompt.assemble({ agent: chat, scope: chat })), face: faceNames(ctx, chat) }
  t.chatMain = { assembled: assemblyRows(await ctx.systemPrompt.assemble({ agent, scope: agent })), face: faceNames(ctx, agent) }

  // -- the turns. Each one is a real turn of the real loop; the model is the only scripted input.
  let answerer = 'allowed-once'
  ctx.on('approval/request', () => answerer)
  const runTurn = async (label, script, user) => {
    const fromSeq = agent.session.seq
    const fromRequest = adapter.requests.length
    const before = ledgerNow(ledgerDir)
    adapter.script.push(...script)
    agent.followup(K.createUserMessage({ content: [{ type: 'text', text: user }], source: { kind: 'user' } }))
    let error = null
    try { await agent.whenIdle() } catch (caught) { error = describe(caught) }
    const after = ledgerNow(ledgerDir)
    const all = agent.session.snapshotEvents().filter((event) => event.seq >= fromSeq)
    const requests = adapter.requests.slice(fromRequest)
    return {
      label, user, error, fromSeq, fromRequest,
      requests: requests.map((request) => ({ system: systemText(request), tools: requestTools(request) })),
      steps: stepRows(all), commits: commitRows(all), headers: headerRows(all), developers: developerRows(all),
      results: resultRows(all), audits: auditRows(all),
      ledgerBefore: before, ledgerAfter: after,
    }
  }
  const turns = []
  const midTurn = { records: null }
  const appendStep = (callId, body) => () => { midTurn.records = midTurn.records === null ? ledgerNow(ledgerDir).count : midTurn.records; return toolCallResponse(callId, APPEND_PROBE, { text: body }) }
  turns.push(await runTurn('t1-another-writer-moves-the-ledger', [toolCallResponse('gate119-t1-masked', ADD_TOOL, { text: NOTE_C }), appendStep('gate119-t1-a', NOTE_A), textResponse('noted')], 'remember one thing'))
  turns[0].midRecords = midTurn.records
  turns.push(await runTurn('t2-one-declaration', [toolCallResponse('gate119-t2-a', DECLARE, { open: ['notes'] }), textResponse('opened')], 'open the notes group'))
  midTurn.records = null
  turns.push(await runTurn('t3-the-second-writer-moves-the-ledger', [appendStep('gate119-t3-a', NOTE_B), textResponse('noted again')], 'remember another thing'))
  turns[2].midRecords = midTurn.records
  turns.push(await runTurn('t4-the-tool-adds-a-note', [toolCallResponse('gate119-t4-a', ADD_TOOL, { text: NOTE_D, tags: ['gate119'], author: 'agent' }), textResponse('added')], 'add a note with the tool'))
  turns.push(await runTurn('t5-nothing-changes', [toolCallResponse('gate119-t5-a', PING, {}), textResponse('nothing changed')], 'touch nothing'))
  turns.push(await runTurn('t6-answer-only', [textResponse('again')], 'say something'))
  answerer = 'rejected'
  turns.push(await runTurn('t7-the-user-rejects', [toolCallResponse('gate119-t7-a', ADD_TOOL, { text: NOTE_E }), textResponse('it was refused')], 'try to add a note anyway'))
  t.turns = turns
  const all = agent.session.snapshotEvents()
  t.loop = {
    commits: commitRows(all), headers: headerRows(all), developers: developerRows(all), steps: stepRows(all), results: resultRows(all), audits: auditRows(all),
    requests: adapter.requests.map((request) => ({ system: systemText(request), tools: requestTools(request) })),
    totalSteps: stepRows(all).length, totalRequests: adapter.requests.length,
  }
  t.final = {
    face: faceNames(ctx, agent), faceBytes: faceBytes(ctx, agent), registered: registeredNames(ctx),
    ledger: ledgerNow(ledgerDir),
    catalog: await callTool(ctx, agent, CATALOG, {}),
    notesList: await callTool(ctx, agent, LIST_TOOL, {}),
    declareAgain: await callTool(ctx, agent, DECLARE, { open: ['notes'] }),
    renderSection: String(module_.renderNotesSection(module_.notesOf(ctx.get('linkNotes')), { maxNotes: module_.DEFAULT_MAX_NOTES, maxChars: module_.DEFAULT_MAX_CHARS })),
  }

  // -- the ancestor-layer contrast: the same artifact applied on the AGENT's own scope.
  const contrastLedger = room('ledger-contrast')
  const contrast = await buildLoopWorld(subject, { withGroups: true, notesPlane: 'agent', ledgerDir: contrastLedger })
  t.contrast = {
    face: faceNames(contrast.ctx, contrast.agent),
    registered: registeredNames(contrast.ctx),
    catalog: await callTool(contrast.ctx, contrast.agent, CATALOG, {}),
    declare: await callTool(contrast.ctx, contrast.agent, DECLARE, { open: ['notes'] }),
    listAfter: await callTool(contrast.ctx, contrast.agent, LIST_TOOL, {}),
  }
  t.contrastLedger = ledgerNow(contrastLedger)

  // -- the PTC-shaped composition: the notes row mounted, the groups row NOT mounted at all.
  const ptc = await buildLoopWorld(subject, { withGroups: false, notesPlane: 'host', ledgerDir: room('ledger-ptc') })
  t.ptc = { face: faceNames(ptc.ctx, ptc.agent), registered: registeredNames(ptc.ctx), catalogLookup: ptc.ctx.tools.get(CATALOG, ptc.agent) === undefined ? 'absent' : 'present' }

  // -- the approval seam, read directly: five worlds, one outcome each, ledger bytes either way.
  const PRE = 'gate119-approval-probe-note'
  const approval = []
  const variants = [
    { tag: 'no-service-at-all', withService: false, outcome: null },
    { tag: 'no-answerer', withService: true, outcome: null },
    { tag: 'rejected', withService: true, outcome: 'rejected' },
    { tag: 'cancelled', withService: true, outcome: 'cancelled' },
    { tag: 'allowed-once', withService: true, outcome: 'allowed-once' },
  ]
  for (const variant of variants) {
    const probeWorld = await buildApprovalWorld(subject, variant.tag, variant)
    const askedCount = () => auditRows(probeWorld.session.snapshotEvents()).asked.length
    const before = ledgerNow(probeWorld.dir)
    const asksBeforeAdd = askedCount()
    const add = await callTool(probeWorld.ctx, probeWorld.agent, ADD_TOOL, { text: PRE })
    const addAsked = askedCount() - asksBeforeAdd
    const after = ledgerNow(probeWorld.dir)
    const asksBeforeList = askedCount()
    const list = await callTool(probeWorld.ctx, probeWorld.agent, LIST_TOOL, {})
    const listAsked = askedCount() - asksBeforeList
    approval.push({
      tag: variant.tag, withService: variant.withService, outcome: variant.outcome,
      approvalServiceComposed: probeWorld.ctx.get('approval') !== undefined,
      add, list, addAsked, listAsked, answererSaw: probeWorld.counter.asks, audit: auditRows(probeWorld.session.snapshotEvents()),
      ledgerBefore: before, ledgerAfter: after,
    })
  }
  t.approval = approval
  return t
}
// ---------------------------------------------------------------------------
// The judge: pure over the measured transcript, so a mutant's world is judged the same way.
// ---------------------------------------------------------------------------
const results = []
let QUIET = false
const add = (id, ok, detail, evidence) => {
  results.push({ id, ok: ok === true, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  if (QUIET) return
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + '. ' + detail)
  for (const line of (Array.isArray(evidence) ? evidence : [])) console.log('        ' + line)
}
const catalogRows = (text) => String(text).split('\n').filter((line) => line.startsWith('- ')).map((line) => {
  const id = line.slice(2).split(' ')[0]
  const blocked = /blocked: (GROUPS_[A-Z_]+): ([^\u00b7]*)/u.exec(line)
  const toolsPart = /tools\((\d+)\): (.*?) \u00b7 /u.exec(line + ' \u00b7 ')
  return {
    id, line,
    open: line.indexOf(' OPEN ') !== -1,
    code: blocked === null ? null : blocked[1],
    reason: blocked === null ? '' : blocked[2].trim(),
    openable: line.includes('openable now'),
    tools: toolsPart === null || toolsPart[2] === '(none)' ? [] : toolsPart[2].split(', ').map((name) => name.trim()),
  }
})
const stepAt = (steps, seq) => { let found = null; for (const row of steps) { if (row.seq >= seq) break; found = row } return found }
const turn = (t, prefix) => t.turns.filter((row) => row.label.startsWith(prefix))[0]
const requestsOf = (t) => t.loop.requests
const stepIndexOf = (t, key) => t.loop.steps.findIndex((row) => row.key === key)
const commitsCarrying = (t, needle) => {
  const out = []
  let seen = false
  for (const row of t.loop.commits) {
    const has = row.text.indexOf(needle) !== -1
    if (has && seen === false) out.push(row)
    seen = seen || has
  }
  return out
}
const lines = (list) => list.join(' | ')

function judge(t) {
  const artifact = 'notes sha256 ' + t.notesSha + ' (' + String(t.notesBytes) + 'B), shipped group row ' + t.ymlSha + ' (' + String(t.staging.ymlBytes) + 'B)'

  // ---- 1 -------------------------------------------------------------------
  const steps = t.loop.steps
  const requests = requestsOf(t)
  const problems1 = []
  if (steps.length !== requests.length) problems1.push('the session logged ' + String(steps.length) + ' step(s) and the model made ' + String(requests.length) + ' request(s), so request-to-step pairing is not one-to-one')
  const pairs = [
    { callId: 'gate119-t1-a', needle: NOTE_A, what: 'a note appended during the step by the store own appendNote (a writer other than the notes_add tool)' },
    { callId: 'gate119-t3-a', needle: NOTE_B, what: 'a second note appended the same way during a later step' },
  ]
  const pairEvidence = []
  for (const pair of pairs) {
    const result = t.loop.results.filter((row) => row.callId === pair.callId)[0]
    if (result === undefined) { problems1.push('no tool/result for ' + pair.callId + ', so ' + pair.what + ' was never observed'); continue }
    if (result.isError === true) problems1.push(pair.callId + ' failed (' + clip(result.text, 120) + '), so ' + pair.what + ' never happened')
    if (clip(result.text, 200).indexOf('appended') === -1) problems1.push(pair.callId + ' did not confirm the append: ' + clip(result.text, 120))
    const step = stepAt(steps, result.seq)
    if (step === null) { problems1.push('the change of ' + pair.callId + ' belongs to no step'); continue }
    const at = stepIndexOf(t, step.key)
    const here = requests[at] === undefined ? null : requests[at].system
    const next = requests[at + 1] === undefined ? null : requests[at + 1].system
    const carrying = commitsCarrying(t, pair.needle)
    if (here === null) problems1.push('step ' + step.key + ' made no request this gate could read')
    else if (here.indexOf(pair.needle) !== -1) problems1.push('the request of step ' + step.key + ' ALREADY carried the new note, but the note only appeared during that step')
    if (next === null) problems1.push('step ' + step.key + ' was the last step, so the following request the reading needs does not exist')
    else if (next.indexOf(pair.needle) === -1) problems1.push('the request after step ' + step.key + ' did not carry the new note')
    if (carrying.length !== 1) problems1.push('the session committed ' + String(carrying.length) + ' system/message event(s) carrying the new note, expected exactly 1')
    else {
      const following = steps[at + 1]
      if (following === undefined || carrying[0].key !== following.key) problems1.push('the head rewrite was logged on ' + String(carrying[0].key) + ' instead of the following step ' + String(following === undefined ? '(none)' : following.key))
    }
    pairEvidence.push(
      pair.callId + ' (' + pair.what + '): changed during step ' + step.key
      + '; request of that step carries the note: ' + String(here !== null && here.indexOf(pair.needle) !== -1)
      + '; request of the next step carries it: ' + String(next !== null && next.indexOf(pair.needle) !== -1)
      + '; system/message events carrying it: ' + String(carrying.length) + (carrying.length === 0 ? '' : ' on ' + carrying[0].key),
      'step ' + step.key + ' prompt = ' + show(clip(here === null ? '' : here, 90)),
      'step ' + String(steps[at + 1] === undefined ? '(none)' : steps[at + 1].key) + ' prompt = ' + show(clip(next === null ? '' : next, 90)),
    )
  }
  add(READINGS[0], problems1.length === 0, problems1.length === 0
    ? 'a note that appears during step N is absent from step N request and present in step N+1 request, and the session logged exactly one head rewrite, on the FOLLOWING step: ' + String(pairs.length) + ' independent changes measured'
    : problems1.join(' | '),
  [...pairEvidence, 'one request per step: ' + String(steps.length) + ' step(s) / ' + String(requests.length) + ' request(s)', artifact])

  // ---- 2 -------------------------------------------------------------------
  const still = t.turns.filter((row) => row.ledgerBefore.digest === row.ledgerAfter.digest)
  const problems2 = []
  const evidence2 = []
  if (still.length < 2) problems2.push('only ' + String(still.length) + ' turn(s) left the ledger bytes alone, which is too few to read a no-churn rule from')
  for (const row of still) {
    const commits = row.commits.length
    if (commits !== 0) problems2.push(row.label + ' committed ' + String(commits) + ' system/message event(s) although the ledger bytes did not move')
    if (row.steps.length === 0) problems2.push(row.label + ' ran no step, so it measured no assembly')
    const texts = new Set(row.requests.map((request) => request.system))
    if (texts.size > 1) problems2.push(row.label + ' sent ' + String(texts.size) + ' different prompts inside one unchanged turn')
    evidence2.push(row.label + ': ' + String(row.steps.length) + ' step(s), ' + String(commits) + ' system/message commit(s), system text ' + String([...texts][0] === undefined ? 0 : [...texts][0].length) + ' character(s), identical across the turn: ' + String(texts.size <= 1))
  }
  const moved = t.turns.filter((row) => row.ledgerBefore.digest !== row.ledgerAfter.digest)
  add(READINGS[1], problems2.length === 0, problems2.length === 0
    ? 'every turn whose ledger bytes did not move committed exactly ZERO system/message events and sent one identical prompt throughout, including the turn whose tool face slid by one; every turn that did move the ledger committed at least once'
    : problems2.join(' | '),
  [...evidence2, 'session-wide system/message events: ' + String(t.loop.commits.length) + ' at ' + show(t.loop.commits.map((row) => row.key)) + ' for ' + String(moved.length) + ' ledger-moving turn(s)', artifact])

  // ---- 3 -------------------------------------------------------------------
  const problems3 = []
  const evidence3 = []
  const approved = turn(t, 't4-')
  const delta3 = approved.ledgerAfter.count - approved.ledgerBefore.count
  const approvedResult = approved.results.filter((row) => row.callId === 'gate119-t4-a')[0]
  if (delta3 !== 1) problems3.push('the approved notes_add appended ' + String(delta3) + ' record(s), expected exactly 1')
  if (approvedResult === undefined || approvedResult.isError === true) problems3.push('the approved notes_add did not answer successfully: ' + clip(approvedResult === undefined ? '(no result)' : approvedResult.text, 120))
  else if (approvedResult.text.indexOf('added note') === -1) problems3.push('the approved notes_add answered without naming the note: ' + clip(approvedResult.text, 120))
  if (approved.ledgerAfter.texts.indexOf(NOTE_D) === -1) problems3.push('the body the approved call was given is not on disk: ' + show(approved.ledgerAfter.texts))
  const auditApproved = approved.audits
  if (auditApproved.asked.length !== 1 || auditApproved.decided.length !== 1) problems3.push('the approved append holds ' + String(auditApproved.asked.length) + ' approval/asked and ' + String(auditApproved.decided.length) + ' approval/decided, expected one of each')
  const maskedCall = t.loop.results.filter((row) => row.callId === 'gate119-t1-masked')[0]
  if (maskedCall === undefined) problems3.push('the masked notes_add call left no tool/result')
  else if (maskedCall.isError !== true || maskedCall.text.indexOf('unknown tool') === -1) problems3.push('a masked notes_add that the user allowed still ran or failed oddly: ' + show(clip(maskedCall.text, 140)))
  evidence3.push('masked notes_add inside a real turn, answered by an allowing user: ' + show(clip(maskedCall === undefined ? '' : maskedCall.text, 110)) + '; ledger records after that step and before the other writer moved it: ' + String(t.turns[0].midRecords))
  evidence3.push('the five probe worlds below each mount the real ToolRuntime and the shipped row (two of them with the real ApprovalService and one answerer each); notes_list never asked in any of them')
  const approvedResultRow = t.loop.results.filter((row) => row.callId === 'gate119-t4-a')[0]
  const approvedCarry = commitsCarrying(t, NOTE_D)
  const approvedStep = approvedResultRow === undefined ? null : stepAt(t.loop.steps, approvedResultRow.seq)
  if (approvedCarry.length !== 1) problems3.push('the note the approved tool call wrote reached the prompt in ' + String(approvedCarry.length) + ' head rewrite(s), expected exactly 1')
  else if (approvedStep === null || t.loop.steps[stepIndexOf(t, approvedStep.key) + 1] === undefined || approvedCarry[0].key !== t.loop.steps[stepIndexOf(t, approvedStep.key) + 1].key) problems3.push('the tool-written note reached the prompt on ' + String(approvedCarry[0].key) + ' instead of the step after the call')
  evidence3.push('the approved call wrote ' + show(NOTE_D) + ' and the prompt carried it from step ' + String(approvedCarry.length === 0 ? '(never)' : approvedCarry[0].key) + ' onward')
  evidence3.push('approved append: ledger records ' + String(approved.ledgerBefore.count) + ' -> ' + String(approved.ledgerAfter.count) + ', note bodies on disk ' + show(approved.ledgerAfter.texts) + ', audit ' + show(auditApproved.decided.map((row) => row.outcome)))
  const rejected = turn(t, 't7-')
  const delta5 = rejected.ledgerAfter.count - rejected.ledgerBefore.count
  const rejectedResult = rejected.results.filter((row) => row.callId === 'gate119-t7-a')[0]
  if (delta5 !== 0) problems3.push('the rejected notes_add appended ' + String(delta5) + ' record(s)')
  if (rejected.ledgerAfter.digest !== rejected.ledgerBefore.digest) problems3.push('the rejected notes_add changed the ledger bytes: ' + rejected.ledgerBefore.digest + ' -> ' + rejected.ledgerAfter.digest)
  const sentence = 'the user rejected tool "notes_add"'
  if (rejectedResult === undefined) problems3.push('the rejected notes_add left no tool/result')
  else if (rejectedResult.text.indexOf(sentence) === -1) problems3.push('the rejected notes_add answered ' + show(clip(rejectedResult.text, 140)) + ', which is not the kernel sentence ' + show(sentence))
  evidence3.push('rejected inside a real turn: ledger records ' + String(rejected.ledgerBefore.count) + ' -> ' + String(rejected.ledgerAfter.count) + ', bytes ' + rejected.ledgerBefore.digest + ' -> ' + rejected.ledgerAfter.digest + ', answer ' + show(clip(rejectedResult === undefined ? '' : rejectedResult.text, 120)))
  const expectations = {
    'no-service-at-all': { composed: false, text: 'requires approval (not yet supported)' },
    'no-answerer': { composed: true, text: 'requires approval, but no approval channel is available' },
    rejected: { composed: true, text: 'the user rejected tool "notes_add"' },
    cancelled: { composed: true, text: 'approval for tool "notes_add" was cancelled' },
  }
  for (const row of t.approval) {
    const want = expectations[row.tag]
    if (row.list.isError === true || row.listAsked !== 0) problems3.push('notes_list asked for approval or failed in world ' + row.tag + ' (' + show(clip(row.list.text, 80)) + ', asks during the call=' + String(row.listAsked) + ')')
    if (want === undefined) continue
    if (row.approvalServiceComposed !== want.composed) problems3.push('world ' + row.tag + ' composed the approval service: ' + String(row.approvalServiceComposed) + ', expected ' + String(want.composed))
    if (row.add.text.indexOf(want.text) === -1) problems3.push('world ' + row.tag + ' answered ' + show(clip(row.add.text, 140)) + ', which does not carry ' + show(want.text))
    if (row.add.isError !== true) problems3.push('world ' + row.tag + ' did NOT deny notes_add')
    if (row.ledgerBefore.digest !== row.ledgerAfter.digest) problems3.push('world ' + row.tag + ' changed the ledger bytes: ' + row.ledgerBefore.digest + ' -> ' + row.ledgerAfter.digest)
    if (row.addAsked !== (want.composed === false ? 0 : 1)) problems3.push('world ' + row.tag + ' asked ' + String(row.addAsked) + ' approval question(s) for notes_add, expected ' + String(want.composed === false ? 0 : 1))
    evidence3.push('world ' + row.tag + ': ' + show(clip(row.add.text, 130)) + ' | ledger ' + row.ledgerBefore.digest + ' -> ' + row.ledgerAfter.digest + ' (' + String(row.ledgerAfter.count) + ' record(s))')
  }
  const allowed = t.approval.filter((row) => row.tag === 'allowed-once')[0]
  if (allowed === undefined) problems3.push('the allowed-once world is missing')
  else {
    const delta = allowed.ledgerAfter.count - allowed.ledgerBefore.count
    if (delta !== 1) problems3.push('the allowed-once world appended ' + String(delta) + ' record(s), expected exactly 1')
    else if (allowed.ledgerAfter.notes !== 1) problems3.push('the allowed-once world holds ' + String(allowed.ledgerAfter.notes) + ' note/state fact(s), expected exactly 1')
    if (allowed.add.isError === true) problems3.push('the allowed-once world denied the call: ' + clip(allowed.add.text, 120))
    evidence3.push('world allowed-once: ' + show(clip(allowed.add.text, 130)) + ' | ledger records ' + String(allowed.ledgerBefore.count) + ' -> ' + String(allowed.ledgerAfter.count) + ', note bodies ' + show(allowed.ledgerAfter.texts))
  }
  add(READINGS[2], problems3.length === 0, problems3.length === 0
    ? 'a call that cannot be asked is denied with the kernel own sentence and writes no byte; the approved call appends exactly one note/state record and that note reaches the following step request; the read-only tool never asks'
    : problems3.join(' | '),
  [...evidence3, 'each refusal sentence above is the kernel text, passed through verbatim (no synonym is written by the notes row)', artifact])
  // ---- 4 -------------------------------------------------------------------
  const problems4 = []
  const evidence4 = []
  const unknownText = (name) => 'Error: unknown tool "' + name + '"'
  if (t.closed.notesList.text !== unknownText(LIST_TOOL)) problems4.push('a closed note group member answered ' + show(clip(t.closed.notesList.text, 120)) + ' instead of ' + show(unknownText(LIST_TOOL)))
  const masked = t.loop.results.filter((row) => row.callId === 'gate119-t1-masked')[0]
  if (masked === undefined) problems4.push('the masked writing member was never called inside a turn, so its execution face was not read')
  else if (masked.text !== unknownText(ADD_TOOL)) problems4.push('the masked writing member answered ' + show(clip(masked.text, 140)) + ' instead of ' + show(unknownText(ADD_TOOL)) + ' (it is called inside an open turn, so the approval seam can answer and still nothing runs)')
  if (t.closed.ghost.text !== unknownText(GHOST)) problems4.push('a name that was never registered answered ' + show(clip(t.closed.ghost.text, 120)))
  const swapped = (text) => String(text).split(LIST_TOOL).join('#').split(GHOST).join('#').split(ADD_TOOL).join('#')
  if (swapped(t.closed.notesList.text) !== swapped(t.closed.ghost.text)) problems4.push('a masked member and a never-registered name do not fail with the same sentence: ' + show(swapped(t.closed.notesList.text)) + ' vs ' + show(swapped(t.closed.ghost.text)))
  if (masked !== undefined && swapped(masked.text) !== swapped(t.closed.ghost.text)) problems4.push('the masked writing member and a never-registered name do not fail with the same sentence: ' + show(swapped(masked.text)) + ' vs ' + show(swapped(t.closed.ghost.text)))
  if (t.turns[0].midRecords !== 0) problems4.push('the masked writing member wrote to the ledger although it is masked: ' + String(t.turns[0].midRecords) + ' record(s) before the other writer ran')
  if (t.closed.lookup.list !== 'absent' || t.closed.lookup.add !== 'absent' || t.closed.lookup.ghost !== 'absent') problems4.push('the registry lookup for a masked member is not absent: ' + show(t.closed.lookup))
  const closedFaceNotes = noteNames(t.install.face)
  if (closedFaceNotes.length !== 0) problems4.push('the closed group left ' + show(closedFaceNotes) + ' in the face')
  const registeredNotes = noteNames(t.install.registered)
  if (registeredNotes.length !== 2) problems4.push('the artifact registered ' + show(registeredNotes) + ' at the global layer, expected the two notes tools (a closed group must MASK what is registered, not replace it)')
  evidence4.push('closed: ' + show(t.closed.notesList.text) + ' for the masked member, ' + show(t.closed.ghost.text) + ' for a name nobody registered - the same sentence modulo the name: ' + String(swapped(t.closed.notesList.text) === swapped(t.closed.ghost.text)) + '; the face holds none of ' + show(registeredNotes) + ' while the registry holds both')
  evidence4.push('closed, the writing member, called inside a real turn with an ALLOWING answerer: ' + show(clip(masked === undefined ? '' : masked.text, 120)) + '; it wrote nothing (ledger records before the other writer ran: ' + String(t.turns[0].midRecords) + ')')
  const finalNotes = noteNames(t.final.face)
  if (finalNotes.length !== 2) problems4.push('after one declaration the face holds ' + show(finalNotes) + ', expected the two members')
  if (t.final.notesList.isError === true || t.final.notesList.text.startsWith('Notes ledger:') === false) problems4.push('after one declaration notes_list answered ' + show(clip(t.final.notesList.text, 120)))
  evidence4.push('after one declaration: face ' + show(finalNotes) + '; notes_list answered ' + show(clip(t.final.notesList.text, 110)))
  const contrastFace = noteNames(t.contrast.face)
  if (contrastFace.length !== 2) problems4.push('the ancestor-layer contrast never got the two names into the face: ' + show(t.contrast.face))
  if (t.contrast.declare.text.indexOf('GROUPS_NO_TOOLS') === -1) problems4.push('with the same artifact applied on the AGENT scope the group was not refused by name: ' + show(clip(t.contrast.declare.text, 140)))
  else {
    for (const name of [LIST_TOOL, ADD_TOOL]) if (t.contrast.declare.text.indexOf(name) === -1) problems4.push('the refusal of the agent-scope world does not name ' + name + ': ' + show(clip(t.contrast.declare.text, 140)))
  }
  if (t.contrast.listAfter.isError === true) problems4.push('in the agent-scope world the refused group left the member reachable but it failed anyway: ' + show(clip(t.contrast.listAfter.text, 120)))
  evidence4.push('contrast (the row applied on the agent scope, the same bytes): face ' + show(contrastFace) + '; declaring the group answered ' + show(clip(t.contrast.declare.text, 150)) + '; the member still answered: ' + String(t.contrast.listAfter.isError === false))
  add(READINGS[3], problems4.length === 0, problems4.length === 0
    ? 'a closed group member is unknown AT THE EXECUTION FACE, byte-for-byte a name that never existed, while the registry still holds it; one declaration makes the same names answer, and on the agent scope the group refuses by name and the member stays reachable'
    : problems4.join(' | '),
  [...evidence4, artifact])

  // ---- 5 -------------------------------------------------------------------
  const problems5 = []
  const evidence5 = []
  const declTurn = turn(t, 't2-')
  const changes = t.loop.headers.filter((row) => row.reason === 'change')
  const turnChanges = declTurn.headers.filter((row) => row.reason === 'change')
  if (turnChanges.length !== 1) problems5.push('the declaring turn logged ' + String(turnChanges.length) + ' reason:change request/header event(s), expected exactly 1')
  if (changes.length !== 1) problems5.push('the whole session logged ' + String(changes.length) + ' reason:change request/header event(s), expected exactly 1 (this world declares once)')
  const developers = t.loop.developers
  if (developers.length !== 1) problems5.push('the session logged ' + String(developers.length) + ' developer/message event(s), expected exactly 1')
  else {
    const rows = [...developers[0].rows].sort()
    if (same(rows, ['addition:' + ADD_TOOL, 'addition:' + LIST_TOOL]) === false) problems5.push('the developer message carried ' + show(rows) + ' instead of one addition row per member')
    if (developers[0].headerSeq !== changes[0].seq) problems5.push('the developer message is bound to header ' + String(developers[0].headerSeq) + ' instead of the change header ' + String(changes[0].seq))
    evidence5.push('one declaration: header(change) seq ' + String(changes[0].seq) + ', developer/message seq ' + String(developers[0].seq) + ' with ' + show(rows))
  }
  const declaration = declTurn.results.filter((row) => row.callId === 'gate119-t2-a')[0]
  const tuple = declaration === undefined ? null : /surface now (\d+) tools \/ (\d+) bytes/u.exec(declaration.text)
  const series = declaration === undefined ? null : /startsSeries=(true|false)/u.exec(declaration.text)
  if (tuple === null) problems5.push('the declaration answered without a cost trio this gate can read: ' + show(clip(declaration === undefined ? '' : declaration.text, 140)))
  else {
    const entries = Number(tuple[1])
    const bytes = Number(tuple[2])
    if (entries !== t.final.face.length) problems5.push('the declaration reported ' + String(entries) + ' entries and this gate counts ' + String(t.final.face.length) + ' over the live face')
    if (bytes !== t.final.faceBytes) problems5.push('the declaration reported ' + String(bytes) + ' bytes and this gate measures ' + String(t.final.faceBytes) + ' over the live face')
    evidence5.push('cost trio as the declaration reported it: entries ' + String(entries) + ', bytes ' + String(bytes) + ', startsSeries ' + String(series === null ? '?' : series[1]) + '; this gate own arithmetic over ctx.tools.schemas(agent): entries ' + String(t.final.face.length) + ', bytes ' + String(t.final.faceBytes))
  }
  const declarationRow = declTurn.results.filter((row) => row.callId === 'gate119-t2-a')[0]
  const before = declarationRow === undefined ? t.loop.headers : t.loop.headers.filter((row) => row.seq < declarationRow.seq)
  const held = before[before.length - 1]
  if (series !== null && held !== undefined) {
    if (String(held.startsSeries) !== series[1]) problems5.push('the declaration reported startsSeries=' + series[1] + ' and the last request/header the session held before it answered (seq ' + String(held.seq) + ') carries ' + String(held.startsSeries))
    evidence5.push('the trio startsSeries is the value of the header the session actually held before the declaration answered (seq ' + String(held.seq) + ', reason ' + show(held.reason) + ', startsSeries ' + String(held.startsSeries) + '): it is NOT a prediction that the next step opens a new series (R185-A G5/G6)')
  }
  const reportedChars = declTurn.results.filter((row) => row.callId === 'gate119-t2-b')[0]
  const chars = reportedChars === undefined ? null : /section is now (\d+) character/u.exec(reportedChars.text)
  if (chars !== null) evidence5.push('the section cost the tool reported: ' + chars[1] + ' characters; the artifact own render now: ' + String(t.final.renderSection.length) + ' characters, ' + show(clip(t.final.renderSection, 80)))
  add(READINGS[4], problems5.length === 0, problems5.length === 0
    ? 'one declaration produced exactly one reason:change header, exactly one developer/message holding one row per member, and a cost trio that equals this gate own arithmetic over the live face'
    : problems5.join(' | '),
  [...evidence5, artifact])

  // ---- 6 -------------------------------------------------------------------
  const problems6 = []
  const evidence6 = []
  const section = t.install.section
  if (section === null) problems6.push('the mounted system prompt holds no notes:ledger section at all')
  else {
    if (section.order !== 700) problems6.push('the mounted section carries order ' + show(section.order) + ', and the round froze 700')
    if (section.interpolate !== false) problems6.push('the mounted section carries interpolate ' + show(section.interpolate) + ', and the round froze false')
    evidence6.push('read off the mounted service (' + section.source + '): ' + show({ name: section.name, order: section.order, interpolate: section.interpolate }))
  }
  const order = t.install.assembled.map((row) => row.name)
  const at = order.indexOf('notes:ledger')
  if (at === -1) problems6.push('the assembled prompt holds no notes:ledger row: ' + show(order))
  else {
    if (order.indexOf(SENTINEL_LOW) > at) problems6.push('the section assembled BEFORE the 600 sentinel: ' + show(order))
    if (order.indexOf(SENTINEL_HIGH) < at) problems6.push('the section assembled AFTER the 800 sentinel: ' + show(order))
    const row = t.install.assembled[at]
    if (row.interpolate !== false) problems6.push('the assembled row carries interpolate ' + show(row.interpolate))
    evidence6.push('assembled section order: ' + show(order) + '; the notes row assembled at index ' + String(at) + ' between the 600 and the 800 sentinel')
  }
  const first = t.loop.requests[0]
  evidence6.push('the first request of the session carried ' + String(first === undefined ? 0 : first.system.length) + ' character(s) of prompt: ' + show(clip(first === undefined ? '' : first.system, 120)))
  add(READINGS[5], problems6.length === 0, problems6.length === 0
    ? 'read off the MOUNTED system prompt, not off a module export: notes:ledger carries order 700 and interpolate false, and the assembled prompt places it between a 600 and an 800 sentinel'
    : problems6.join(' | '),
  [...evidence6, artifact])

  // ---- 7 -------------------------------------------------------------------
  const problems7 = []
  const evidence7 = []
  const chatNames = t.chat.assembled.map((row) => row.name)
  if (same(chatNames, [CHAT_PERSONA]) === false) problems7.push('a complete persona left ' + show(chatNames) + ' in the assembled prompt, so it does not suppress the sections')
  const mainNames = t.chatMain.assembled.map((row) => row.name)
  if (mainNames.indexOf('notes:ledger') === -1) problems7.push('the same world without the complete persona does not carry the section, so the suppression above is not the persona doing it')
  const chatNotes = noteNames(t.chat.face)
  const ptcNotes = [...noteNames(t.ptc.face)].sort()
  const wanted = [LIST_TOOL, ADD_TOOL].sort()
  if (same(ptcNotes, wanted) === false) problems7.push('the composition without the groups row carries ' + show(ptcNotes) + ' instead of the artifact own two names ' + show(wanted))
  if (t.ptc.catalogLookup !== 'absent') problems7.push('the composition without the groups row still resolves a catalog tool')
  if (chatNotes.length !== 0) problems7.push('the chat-shaped session face carries ' + show(chatNotes) + ' while the notes group is closed')
  evidence7.push('REPORTED, not promised: with this world composition the chat-shaped session face carries ' + String(chatNotes.length) + ' notes tool(s); the same artifact in a composition that does NOT mount the groups row (the PTC shape) carries ' + String(ptcNotes.length) + ': ' + show(ptcNotes))
  evidence7.push('the persona suppresses the SECTION only: assembled ' + show(chatNames) + ' for the chat agent against ' + show(mainNames) + ' for the same world without it')
  add(READINGS[6], problems7.length === 0, problems7.length === 0
    ? 'a complete persona suppresses every section (kernel behavior, read here); the tool faces are read out both ways and reported: chat-shaped ' + String(chatNotes.length) + ', PTC-shaped ' + String(ptcNotes.length)
    : problems7.join(' | '),
  [...evidence7, 'the PTC shape is a composition with no groups row, which is the shipped file own instruction (PTC presets must not mount this row); the real PTC preset is NOT mounted here', artifact])
  // ---- 8 -------------------------------------------------------------------
  const problems8 = []
  const evidence8 = []
  const notesRow = t.rows.filter((row) => row.id === 'notes')[0]
  if (notesRow === undefined) problems8.push('the shipped group table holds no notes row: ' + show(t.rows.map((row) => row.id)))
  else {
    const declared = [...notesRow.tools].sort()
    const artifactNames = [t.exports.listTool, t.exports.addTool].sort()
    if (same(declared, artifactNames) === false) problems8.push('the shipped row declares ' + show(declared) + ' and the artifact registers ' + show(artifactNames) + ': the two files disagree about a member name')
    if (notesRow.provider !== undefined && notesRow.tools.some((name) => name.startsWith(notesRow.provider)) === false) problems8.push('the row declares provider ' + show(notesRow.provider) + ' and no member starts with it')
    evidence8.push('the shipped row, parsed out of the shipped bytes: ' + show({ id: notesRow.id, tools: notesRow.tools, provider: notesRow.provider, state: notesRow.state, auto: notesRow.auto }) + '; the artifact own names: ' + show(artifactNames))
  }
  const registered = t.install.registered
  const missingByRow = {}
  for (const row of t.rows) missingByRow[row.id] = row.tools.filter((name) => registered.includes(name) === false)
  const rowsWithMissing = t.rows.filter((row) => missingByRow[row.id].length > 0).map((row) => row.id).sort()
  const catalog = catalogRows(t.install.catalog.text)
  const blockedRows = catalog.filter((row) => row.code !== null)
  const blockedIds = blockedRows.map((row) => row.id).sort()
  if (same(blockedIds, rowsWithMissing) === false) problems8.push('the plugin blocks ' + show(blockedIds) + ' and this gate own arithmetic over the same bytes finds unreachable members in ' + show(rowsWithMissing))
  for (const row of blockedRows) {
    if (row.code !== 'GROUPS_NO_TOOLS') problems8.push('row ' + row.id + ' is blocked with ' + row.code + ' instead of GROUPS_NO_TOOLS')
    for (const name of missingByRow[row.id]) if (row.reason.indexOf(name) === -1) problems8.push('the refusal for row ' + row.id + ' does not name the unreachable member ' + name + ': ' + show(row.reason))
  }
  const healthy = catalog.filter((row) => row.code === null)
  for (const row of healthy) if (row.openable !== true && row.open !== true) problems8.push('row ' + row.id + ' is neither blocked nor openable: ' + show(clip(row.line, 160)))
  evidence8.push('catalog rows: ' + show(catalog.map((row) => row.id + (row.code === null ? '(openable=' + String(row.openable) + ')' : '(blocked=' + row.code + ')'))))
  evidence8.push('unreachable members this gate computes and the plugin reports: ' + show(rowsWithMissing) + ' / ' + show(blockedIds))
  const declaration8 = turn(t, 't2-').results.filter((row) => row.callId === 'gate119-t2-a')[0]
  const declarationText = declaration8 === undefined ? '' : declaration8.text
  if (blockedIds.length === 0) {
    if (declarationText.indexOf('- opened notes') === -1) problems8.push('with nothing unreachable the declaration of the shipped row did not open it: ' + show(clip(declarationText, 140)))
    evidence8.push('with every name reachable the declaration applied: ' + show(clip(declarationText, 120)))
  } else {
    if (declarationText.indexOf('GROUPS_NO_TOOLS') === -1) problems8.push('a row with an unreachable member was not refused with GROUPS_NO_TOOLS: ' + show(clip(declarationText, 140)))
    for (const id of blockedIds) if (declarationText.indexOf('- refused ' + id + ' [GROUPS_NO_TOOLS]') === -1) problems8.push('the refusal does not name ' + id + ' with the code: ' + show(clip(declarationText, 160)))
    evidence8.push('the declaration in this build: ' + show(clip(declarationText, 170)))
  }
  add(READINGS[7], problems8.length === 0, problems8.length === 0
    ? 'the shipped row member names equal the artifact own tool names; the rows the plugin blocks are exactly the rows whose names no layer carries, each refused by name with GROUPS_NO_TOOLS, and every other row stays openable'
    : problems8.join(' | '),
  [...evidence8, artifact])
  return results
}

// ---------------------------------------------------------------------------
// The subject: the built bytes, staged onto this gate's kernel module paths.
// ---------------------------------------------------------------------------
const applyOneReplacement = (source, mutant, label) => {
  const occurrences = source.split(mutant.from).length - 1
  if (occurrences !== 1) throw new Error('the mutant ' + mutant.name + ' anchors on a string that occurs ' + String(occurrences) + ' time(s) in ' + label + ', not exactly once; an ambiguous anchor is not a mutation')
  return source.split(mutant.from).join(mutant.to)
}
const buildSubject = async () => {
  for (const specifier of Object.keys(KERNEL_MODULES)) {
    if (existsSync(KERNEL_MODULES[specifier]) === false) return { error: 'the kernel module ' + specifier + ' is missing at ' + KERNEL_MODULES[specifier] + '; this gate mounts the real kernel and will not stand in a fake registry' }
  }
  if (existsSync(NOTES_MODULE) === false) return { error: 'the built notes artifact is missing at ' + NOTES_MODULE + ' (run: node plugins/build.mjs)' }
  if (existsSync(GROUPS_MODULE) === false) return { error: 'the built groups artifact is missing at ' + GROUPS_MODULE + ' (run: node plugins/build.mjs)' }
  if (existsSync(COLLAB_MODULE) === false) return { error: 'the built collaboration bus is missing at ' + COLLAB_MODULE + ' (the notes row imports its ledger)' }
  if (existsSync(GROUPS_YML) === false) return { error: 'the shipped group table is missing at ' + GROUPS_YML + '; this gate reads the row rather than transcribing it' }
  const ymlBuffer = readFileSync(GROUPS_YML)
  let notesSource = readFileSync(NOTES_MODULE, 'utf8')
  let groupsSource = readFileSync(GROUPS_MODULE, 'utf8')
  let ymlText = ymlBuffer.toString('utf8')
  const mutants = MUTANT === '' ? [] : MUTANTS.filter((row) => row.name === MUTANT)
  if (MUTANT !== '' && mutants.length === 0) return { error: 'unknown mutant ' + show(MUTANT) }
  for (const mutant of mutants) {
    if (mutant.target === 'notes') notesSource = applyOneReplacement(notesSource, mutant, NOTES_MODULE)
    else if (mutant.target === 'groups') ymlText = applyOneReplacement(ymlText, mutant, GROUPS_YML)
  }
  const parsed = parseGroupRows(ymlText)
  if (parsed.rows.length === 0) return { error: 'the shipped group table at ' + GROUPS_YML + ' parsed to no group row, so this gate cannot read the row it must measure' }
  if (parsed.rows.filter((row) => row.id === 'notes').length !== 1) return { error: 'the shipped group table holds ' + String(parsed.rows.filter((row) => row.id === 'notes').length) + ' notes row(s), expected exactly one' }
  const roomDir = room('subject')
  const notesStaged = stageSource(notesSource)
  const groupsStaged = stageSource(groupsSource)
  const notesFile = join(roomDir, 'notes.mjs')
  const groupsFile = join(roomDir, 'groups.mjs')
  writeFileSync(notesFile, notesStaged.text)
  writeFileSync(groupsFile, groupsStaged.text)
  const notesModule = await import(pathToFileURL(notesFile).href)
  const groupsModule = await import(pathToFileURL(groupsFile).href)
  if (typeof notesModule.apply !== 'function') return { error: 'the artifact at ' + NOTES_MODULE + ' exports no apply()' }
  if (typeof groupsModule.apply !== 'function') return { error: 'the artifact at ' + GROUPS_MODULE + ' exports no apply()' }
  const leftover = [...bareSpecifiers(notesStaged.text), ...bareSpecifiers(groupsStaged.text)]
  return {
    subject: {
      notesModule, groupsModule, rows: parsed.rows, config: parsed.config,
      notesPath: NOTES_MODULE, groupsPath: GROUPS_MODULE, ymlPath: GROUPS_YML,
      notesSha: sha12(readFileSync(NOTES_MODULE)), groupsSha: sha12(readFileSync(GROUPS_MODULE)), ymlSha: sha12(ymlBuffer),
      notesBytes: readFileSync(NOTES_MODULE).length,
      ledgerDir: room('ledger'),
      mutant: MUTANT, mutants: mutants.map((row) => row.name),
      staging: {
        notesRewrites: notesStaged.rewrites, groupsRewrites: groupsStaged.rewrites,
        leftover,
        notesFaithful: unstageSource(notesStaged.text) === notesSource,
        groupsFaithful: unstageSource(groupsStaged.text) === groupsSource,
        ymlBytes: ymlBuffer.length,
        notesStrippedOfKernelSpecifiers: /from\s+["']@deepseek-ai\//u.test(notesStaged.text) === false && /from\s+["']@deepseek-ai\//u.test(groupsStaged.text) === false,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// The self-attack: rewrite the shipped bytes, re-measure the world, compare sets.
// ---------------------------------------------------------------------------
const runSelfAttack = async (baseline, started) => {
  const red = baseline.filter((reading) => reading.ok === false)
  if (red.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: ' + String(red.length) + ' reading(s) are already red, and a mutant declared against a red reading proves nothing')
    return 1
  }
  console.log('  each mutant below rewrites ONE string in a measured product own bytes and is measured in its OWN child process:')
  let imprecise = 0
  for (const mutant of MUTANTS) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--attack-child'], {
      encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { R186_G119_MUTANT: mutant.name }),
    })
    const output = String(child.stdout ?? '') + String(child.stderr ?? '')
    const line = output.split(/\r?\n/u).filter((entry) => entry.startsWith('READINGS-JSON ')).pop()
    if (line === undefined) {
      imprecise += 1
      const named = output.split(/\r?\n/u).filter((entry) => entry.includes('NOT MEASURED') || entry.includes('SKIP:')).pop()
      console.log('  FAIL  mutant. ' + mutant.name + ' produced no readings (exit ' + String(child.status) + ')' + (named === undefined ? '' : ': ' + named))
      continue
    }
    const after = JSON.parse(line.slice('READINGS-JSON '.length))
    const observed = after.filter((reading) => reading.ok === false).map((reading) => reading.id).sort()
    const declared = [...mutant.expect].sort()
    const precise = same(observed, declared)
    if (precise === false) imprecise += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' \u2014 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed))
    console.log('        why: ' + mutant.why)
  }
  const coverage = new Map()
  for (const mutant of MUTANTS) for (const id of mutant.expect) coverage.set(id, (coverage.get(id) ?? 0) + 1)
  let uncovered = 0
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  for (const reading of baseline) {
    const count = coverage.get(reading.id) ?? 0
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(MUTANTS.length) + ' mutants, ' + String(imprecise) + ' imprecise, '
    + String(MUTANTS.filter((mutant) => mutant.expect.length > 0).length) + ' of them declare a target, '
    + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants rewrite the measured products THEMSELVES (the built notes artifact and the shipped group row) and every one is measured in a child process of this gate.')
  return imprecise === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  QUIET = ATTACK_CHILD
  const built = await buildSubject()
  if (built.error !== undefined) return NOT_MEASURED(built.error)
  const subject = built.subject
  let transcript = null
  try {
    transcript = await measure(subject)
  } catch (error) {
    console.log(String(error !== null && error !== undefined && error.stack !== undefined ? error.stack : ''))
    return NOT_MEASURED('the world could not be built: ' + describe(error))
  }
  const readings = judge(transcript)
  if (ATTACK_CHILD) console.log('READINGS-JSON ' + JSON.stringify(readings))
  if (ATTACK_CHILD) return readings.filter((reading) => reading.ok === false).length > 0 ? 1 : 0
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  frozen subjects: notes ' + NOTES_MODULE + ' sha256 ' + subject.notesSha + ' (' + String(subject.notesBytes) + 'B); groups ' + GROUPS_MODULE + ' sha256 ' + subject.groupsSha + '; shipped row ' + GROUPS_YML + ' sha256 ' + subject.ymlSha + ' (' + String(subject.staging.ymlBytes) + 'B)' + (subject.mutant === '' ? '' : '; MUTANTS ' + show(subject.mutants)))
  console.log('  the shipped rows this gate parsed: ' + describeRows(subject.rows))
  console.log('  staging: kernel specifiers rewritten onto this gate module paths (' + String(subject.staging.notesRewrites + subject.staging.groupsRewrites) + ' rewrite(s)), no bare kernel specifier left: ' + String(subject.staging.notesStrippedOfKernelSpecifiers) + ', leftover ' + show(subject.staging.leftover) + ', un-rewriting reproduces the shipped bytes exactly: ' + String(subject.staging.notesFaithful && subject.staging.groupsFaithful))
  if (SELF_ATTACK) return await runSelfAttack(readings, started)
  return failed.length > 0 ? 1 : 0
}

try {
  process.exitCode = await main()
} finally {
  if (BASE !== null) {
    if (KEEP) console.log('  kept: ' + BASE)
    else { try { rmSync(BASE, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
  }
}
