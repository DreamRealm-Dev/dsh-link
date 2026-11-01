#!/usr/bin/env node
/**
 * Gate 116 (R185-C) - tool-groups-approval: THE QUESTION AND THE FAIL-CLOSED DENIALS AROUND IT.
 *
 * Subject: the approval half of R185 (docs/handoff/R185-contract.md section 4.2, gate 116), shipped in
 * plugins/dsh-link-groups/lib/index.js. Written by a verifier who did not write the plugin. The world
 * below is the REAL kernel - a fresh cordis Context with the real SystemPrompt, ToolRuntime,
 * AgentRegistry, Session and ApprovalService mounted - and the shipped ARTIFACT's own bytes are
 * staged onto those modules, so every tool/call, approval/asked, approval/decided and tools/change
 * below is a genuine kernel event. No hand-written tool registry stands in for the kernel's.
 *
 * WHAT THIS GATE JUDGES, AND WHAT IT DELIBERATELY DOES NOT.
 * It judges the question ("does this group ask?") and the failures around it ("what happens when the
 * answer is no, when there is nobody to ask, when the asking throws, when the answer never comes").
 * It does NOT re-judge the catalog's content, the cost trio, the automatic open path, the session-log
 * fold or the teardown - those belong to gate 115 and to the producer's own self-check, and a second
 * witness to the same fact is not a second fact.
 *
 * THE COUNTS ARE THE KERNEL'S OWN. How many questions a declaration asked is not counted by a
 * listener of this gate's making: it is counted from the APPROVAL AUDIT PAIR the kernel's own
 * ApprovalService appends to the session log (approval/asked and approval/decided). A world where the
 * question is never asked has no such event, and a world where it is asked twice has two - both
 * regardless of what the plugin says about itself. The number of tool-surface changes in one call is
 * likewise counted from the ToolRuntime's own tools/change events.
 *
 * Twenty-three readings, each able to fail on its own evidence:
 *
 *   01-the-channel-refusal-names-itself-for-an-agent-with-no-scope
 *                                            An agent whose ctx is not a scope is refused BY NAME
 *                                            (GROUPS_CHANNEL) in the plugin's own log line, gains no
 *                                            activation tool and keeps its surface name for name.
 *   02-the-collision-refusal-names-itself-and-keeps-the-pre-existing-tool
 *                                            An agent that already resolves a tool called tool_groups
 *                                            is refused BY NAME (GROUPS_COLLISION); the tool it already
 *                                            had still executes, and no activation tool appears.
 *   03-the-installed-surface-is-exactly-the-members-plus-two-activation-tools
 *                                            After apply() the agent sees exactly its open groups'
 *                                            members and exactly two new names: tool_groups and
 *                                            tool_groups_declare - both computed here from this gate's
 *                                            own configuration. A smuggled third name reddens.
 *   04-a-closed-member-is-unreachable-and-the-error-is-the-nonexistent-tool error
 *                                            A member of a closed group EXECUTES as unknown tool
 *                                            "name", spelled exactly like a name nobody ever
 *                                            registered: closed is not merely hidden from the schema.
 *   05-effective-has-exactly-one-legal-spelling
 *                                            Every applied row of every declaration in this world reads
 *                                            effective: next-step, and no other effective word appears
 *                                            anywhere in what the model is shown. A different word is
 *                                            refused BY NAME here (EFFECTIVE_DRIFT) rather than accepted.
 *   06-a-user-disabled-group-asks-exactly-once-and-opens-nothing-without-an-answer
 *                                            With nobody composed to answer, the declaration is denied,
 *                                            the catalog and the surface are byte-identical, the member
 *                                            is still unreachable - and the kernel's own audit pair
 *                                            carries exactly ONE asked/decided for it.
 *   07-the-paired-group-is-asked-nothing
 *                                            The same call shape on a group that is not user-disabled
 *                                            runs with the answerer composed and armed and asks it ZERO
 *                                            times. Without this pair, "asks once" could be a world where
 *                                            everything asks.
 *   08-an-off-group-is-denied-by-name-without-a-question
 *                                            A group the composition turned off is denied by the plugin
 *                                            itself (GROUPS_OFF) with ZERO questions asked, and nothing
 *                                            opens. Fail-closed without asking, because the model cannot
 *                                            answer for a user who said no.
 *   09-both-flags-ask-instead-of-denying
 *                                            One group carries state off AND userDisabled. The measured
 *                                            precedence is that the user-disabled rule wins: it is ASKED
 *                                            (exactly once) and denied, never opened silently.
 *   10-a-rejected-approval-moves-nothing
 *                                            The answerer rejects: the call fails, the catalog is
 *                                            byte-identical, the surface is byte-identical, no tool-surface
 *                                            change happened, the member is unreachable, exactly one
 *                                            question was asked and the log carries the rejection.
 *   11-an-allowed-approval-slides-the-surface-exactly-once
 *                                            The answerer allows once: exactly one question, exactly ONE
 *                                            tools/change event for the call (not a mask-then-lift pair),
 *                                            exactly one opened row, the group reads OPEN, and a second
 *                                            declaration of it asks again - it is already open, so it is
 *                                            refused with no second slide.
 *   12-a-channel-that-cannot-answer-denies-with-the-kernel-sentence
 *                                            No answerer is composed: the question is asked once, decided
 *                                            unavailable, and the model is told the kernel's own sentence
 *                                            (requires approval, but no approval channel is available).
 *                                            Nothing opens.
 *   13-no-approval-service-at-all-still-denies
 *     In a second world                       A world that composes NO ApprovalService at all still denies
 *                                            the user-disabled declaration (fail-closed, not fail-open),
 *                                            records no approval, and opens nothing - while an ordinary
 *                                            group in the SAME bare world still opens normally, so the
 *                                            denial is a reading and not a dead world.
 *   14-an-answerer-that-throws-denies
 *                                            A composed answerer that throws is contained by the approval
 *                                            seam and fails the QUESTION closed: the kernel sentence
 *                                            again, nothing opens, exactly one question asked.
 *   15-an-aborted-question-denies-and-opens-nothing
 *                                            The question is asked and never answered; the call's signal is
 *                                            aborted. The call fails, the kernel's own audit pair records the
 *                                            question as decided cancelled, nothing opens, and the catalog is
 *                                            byte-identical.
 *   16..21 the six declared refusals are each named (GROUPS_INPUT / GROUPS_UNKNOWN / GROUPS_DUP /
 *                                            GROUPS_DEPENDENCY / GROUPS_NO_TOOLS / GROUPS_CATALOG), each
 *                                            read from a real call, with the known ids listed for the
 *                                            unknown one and the dependency and the missing tool named in
 *                                            the other two.
 *   22-all-nine-refusal-codes-are-observed
 *                                            The union of codes this gate OBSERVED in its own world is
 *                                            exactly the nine the round froze. One short is a failure.
 *   23-no-refusal-moved-state-or-surface
 *                                            Around the whole refusal batch, and after it: the catalog is
 *                                            byte-identical, the surface is identical name for name in
 *                                            order, and a closed member and a never-registered name still
 *                                            answer the same way. Paired: the same snapshots in the same
 *                                            world DO see other declarations move the catalog, so this is not
 *                                            a comparison between two dead snapshots.
 *
 * Self-attack: --self-attack mutates the SHIPPED ARTIFACT'S OWN BYTES (one string replacement per
 * mutant, anchored on the measured product, never on a fixture), re-measures the whole world through
 * a child process for each mutant, and requires the observed set of reddened readings to EQUAL the
 * declared set - no more and no fewer. It prints the coverage matrix: how many mutants declare each
 * reading, with every reading required to be covered by at least one. A mutant whose anchor string is
 * absent or ambiguous is a NAMED not-measured, never a silent pass.
 *
 * Exit 0 every reading held and every mutant moved exactly what it declared | 1 a reading failed or a
 * mutant moved something else | 3 NOT MEASURED (the kernel modules or the artifact are not there, the
 * artifact does not import, or a mutant anchor is not exactly once, so no honest reading exists).
 *
 * Usage: node scripts/verify-tool-groups-approval.mjs [--module <path>] [--self-attack] [--json]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-groups', 'lib', 'index.js'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const JSON_OUT = has('--json')
const ATTACK_CHILD = has('--attack-child')
const SELF_ATTACK = has('--self-attack')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-groups', 'lib', 'index.js')))
/**
 * Set only by --self-attack on the child process it spawns; mutates the SHIPPED artifact's own bytes.
 * A mutation is applied ONLY under --attack-child: the runner strips other gates' fault-injection
 * variables but not this one, and a shell that happens to export it must never arm a defect inside
 * a run the suite believes is clean.
 */
const MUTANT = process.env.R185_P116_MUTANT ?? ''

/** The kernel modules the subject imports, by path, so both sides share one instance of each. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(PROJECT, 'core', 'deepseek-harness', 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/dsh-scope': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-user-approval': join(PROJECT, 'core', 'deepseek-harness', 'packages', 'interaction', 'user-approval', 'lib', 'index.js'),
}

/** The two activation tools this round froze. They are a SPELLING the round wrote down, not a discovery. */
const CATALOG_TOOL = 'tool_groups'
const DECLARE_TOOL = 'tool_groups_declare'
/** A name nobody ever registers: the control that a closed member is not merely hidden from a schema. */
const GHOST_TOOL = 'p116_never_registered'
/** The nine codes the round froze, in the order the contract lists them. */
const NINE_CODES = ['GROUPS_INPUT', 'GROUPS_UNKNOWN', 'GROUPS_DUP', 'GROUPS_OFF', 'GROUPS_DEPENDENCY', 'GROUPS_NO_TOOLS', 'GROUPS_CHANNEL', 'GROUPS_CATALOG', 'GROUPS_COLLISION']

/**
 * The world's data. Every state the approval half has to tell apart gets its own group, and the
 * membership is written here because this gate must compute the expected surface ITSELF.
 */
const GROUPS = [
  { id: 'always', title: 'Open from configuration', tools: ['always_alpha', 'always_beta'], state: 'on' },
  { id: 'plain', title: 'Declared on demand', tools: ['plain_one', 'plain_two'], state: 'auto', auto: { when: 'declare' } },
  { id: 'locked', title: 'Turned off by configuration', tools: ['locked_one'], state: 'off' },
  { id: 'gated', title: 'Disabled by the user', tools: ['gated_one', 'gated_two'], state: 'auto', auto: { when: 'declare' }, userDisabled: true },
  { id: 'gated_b', title: 'A second disabled group', tools: ['gated_b_one'], state: 'auto', auto: { when: 'declare' }, userDisabled: true },
  { id: 'locked_gated', title: 'Both flags at once', tools: ['locked_gated_one'], state: 'off', userDisabled: true },
  { id: 'behind', title: 'After another group', tools: ['behind_one'], state: 'auto', auto: { when: 'after', after: 'plain' } },
  { id: 'typo', title: 'A configuration typo', tools: ['typo_present', 'typo_absent'], state: 'auto', auto: { when: 'declare' } },
  { id: 'quiet', title: 'Nobody declares this', tools: ['quiet_one'], state: 'auto', auto: { when: 'declare' } },
]
const GROUP_IDS = GROUPS.map(group => group.id)
/** The members that really get registered: the typo group's second name deliberately never is. */
const REGISTERED_MEMBERS = []
for (const group of GROUPS) for (const name of group.tools) if (name !== 'typo_absent') REGISTERED_MEMBERS.push(name)

const READING = {
  CHANNEL: '01-the-channel-refusal-names-itself-for-an-agent-with-no-scope',
  COLLISION: '02-the-collision-refusal-names-itself-and-keeps-the-pre-existing-tool',
  INSTALL: '03-the-installed-surface-is-exactly-the-members-plus-two-activation-tools',
  UNREACHABLE: '04-a-closed-member-is-unreachable-and-looks-nonexistent',
  EFFECTIVE: '05-effective-has-exactly-one-legal-spelling',
  GATED_ASK: '06-a-user-disabled-group-asks-exactly-once-and-opens-nothing',
  PAIRED: '07-the-paired-group-is-asked-nothing',
  OFF: '08-an-off-group-is-denied-by-name-without-a-question',
  BOTH_FLAGS: '09-both-flags-ask-instead-of-denying',
  REJECTED: '10-a-rejected-approval-moves-nothing',
  ALLOWED: '11-an-allowed-approval-slides-the-surface-exactly-once',
  NO_ANSWERER: '12-a-channel-that-cannot-answer-denies-with-the-kernel-sentence',
  BARE: '13-no-approval-service-at-all-still-denies',
  THROWING: '14-an-answerer-that-throws-denies',
  ABORTED: '15-an-aborted-question-denies-and-opens-nothing',
  INPUT: '16-the-input-refusal-is-named',
  UNKNOWN: '17-the-unknown-refusal-is-named-and-lists-the-known-ids',
  DUP: '18-the-duplicate-refusal-is-named',
  DEPENDENCY: '19-the-dependency-refusal-is-named-and-points-at-the-group',
  NO_TOOLS: '20-the-typo-refusal-is-named-and-confined-to-one-group',
  CATALOG: '21-the-catalog-refusal-is-named',
  NINE: '22-all-nine-refusal-codes-are-observed',
  INVARIANT: '23-no-refusal-moved-state-or-surface',
}

// ---------------------------------------------------------------------------
// The subject: the shipped artifact's own bytes, staged onto the kernel modules
// ---------------------------------------------------------------------------

/**
 * The mutants. Each replaces ONE string in the artifact's own bytes, so what is attacked is the
 * measured product and not a fixture, and declares exactly which readings it must redden.
 */
const MUTANTS = [
  {
    name: 'off-group-deny-removed',
    from: 'return { kind: "deny", reason: REFUSALS.OFF + ": the user turned this group off, so a declaration cannot open it: " + off.join(", ") };',
    to: 'return next();',
    mustRedden: [READING.OFF, READING.NINE],
  },
  {
    name: 'effective-becomes-immediate',
    from: 'var EFFECTIVE = "next-step"',
    to: 'var EFFECTIVE = "immediate"',
    mustRedden: [READING.EFFECTIVE],
  },
  {
    name: 'ask-becomes-allow',
    from: 'kind: "ask",',
    to: 'kind: "allow",',
    mustRedden: [READING.GATED_ASK, READING.BOTH_FLAGS, READING.REJECTED, READING.ALLOWED, READING.NO_ANSWERER, READING.BARE, READING.THROWING, READING.ABORTED],
  },
  {
    name: 'mask-is-a-no-op',
    from: 'const mask = (id) => {',
    to: 'const mask = (id) => { if (true) return;',
    mustRedden: [READING.INSTALL, READING.UNREACHABLE, READING.ALLOWED],
  },
  {
    name: 'catalog-accepts-arguments',
    from: 'if (args !== void 0 && args !== null && typeof args === "object" && Object.keys(args).length > 0) {',
    to: 'if (false) {',
    mustRedden: [READING.CATALOG, READING.NINE],
  },
  {
    name: 'unknown-refusal-renamed',
    from: 'UNKNOWN: "GROUPS_UNKNOWN"',
    to: 'UNKNOWN: "GROUPS_NOT_IN_CATALOG"',
    mustRedden: [READING.UNKNOWN, READING.NINE],
  },
  {
    name: 'dependency-ignored',
    from: 'if (state.open[dependency] !== true) return { code: REFUSALS.DEPENDENCY,',
    to: 'if (false) return { code: REFUSALS.DEPENDENCY,',
    mustRedden: [READING.DEPENDENCY, READING.NINE, READING.INVARIANT],
  },
  {
    name: 'typo-short-circuits',
    from: 'if (installation.missing.length > 0) {',
    to: 'if (false) {',
    mustRedden: [READING.NO_TOOLS, READING.NINE, READING.INVARIANT],
  },
  {
    name: 'user-disabled-forgotten',
    from: 'userDisabled: entry.userDisabled === true,',
    to: 'userDisabled: false,',
    mustRedden: [READING.GATED_ASK, READING.BOTH_FLAGS, READING.REJECTED, READING.ALLOWED, READING.NO_ANSWERER, READING.BARE, READING.THROWING, READING.ABORTED],
  },
  {
    name: 'empty-declaration-accepted',
    from: 'if (named.length === 0) {',
    to: 'if (false) {',
    mustRedden: [READING.INPUT],
  },
  {
    name: 'duplicate-check-removed',
    from: 'if (inOpen && inClose) {',
    to: 'if (false) {',
    mustRedden: [READING.DUP, READING.NINE],
  },
  {
    name: 'every-group-needs-approval',
    from: 'return group.userDisabled || group.state === "off";',
    to: 'return true;',
    mustRedden: [READING.PAIRED, READING.BARE, READING.EFFECTIVE],
  },
  {
    name: 'channel-refusal-renamed',
    from: 'CHANNEL: "GROUPS_CHANNEL"',
    to: 'CHANNEL: "GROUPS_NO_SCOPE"',
    mustRedden: [READING.CHANNEL, READING.NINE],
  },
  {
    name: 'collision-refusal-renamed',
    from: 'COLLISION: "GROUPS_COLLISION"',
    to: 'COLLISION: "GROUPS_TAKEN"',
    mustRedden: [READING.COLLISION, READING.NINE],
  },
]

/** Rewrite the subject's bare kernel imports onto the exact module paths this file also imports. */
const stage = (source) => {
  let text = source
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

const loadSubject = async () => {
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    if (!existsSync(file)) return { error: 'the kernel module ' + specifier + ' is missing at ' + file + '; this gate mounts the real registry and will not stand in a fake one' }
  }
  if (!existsSync(MODULE_PATH)) return { error: 'the subject is missing at ' + MODULE_PATH + ' (build it with: node plugins/build.mjs)' }
  if (MUTANT !== '' && ATTACK_CHILD === false) {
    console.log('        note: R185_P116_MUTANT is set in this environment but this run is not --attack-child; the shipped artifact is measured UNMUTATED')
  }
  let source = readFileSync(MODULE_PATH, 'utf8')
  if (MUTANT !== '' && ATTACK_CHILD === true) {
    const mutant = MUTANTS.find(entry => entry.name === MUTANT)
    if (mutant === undefined) return { error: 'unknown mutant "' + MUTANT + '"' }
    const occurrences = source.split(mutant.from).length - 1
    if (occurrences !== 1) return { error: 'mutant "' + MUTANT + '" anchors on a string that occurs ' + String(occurrences) + ' time(s) in the artifact, not exactly once; an ambiguous anchor is not a mutation' }
    source = source.split(mutant.from).join(mutant.to)
  }
  const staged = stage(source)
  if (/from\s+["']@deepseek-ai\//u.test(staged)) return { error: 'staging left a bare kernel specifier in the artifact, so the world it would mount is not the pinned kernel' }
  const root = mkdtempSync(join(tmpdir(), 'r185-p116-'))
  const file = join(root, 'subject.mjs')
  writeFileSync(file, staged)
  const module = await import(pathToFileURL(file).href)
  if (typeof module.apply !== 'function') return { error: 'the artifact at ' + MODULE_PATH + ' exports no apply()' }
  return { module, root }
}

// ---------------------------------------------------------------------------
// The world: the real kernel, three agents, and the shipped plugin applied once
// ---------------------------------------------------------------------------

/**
 * Build one world. Agent A is an ordinary scoped agent; agent B already resolves a tool called
 * tool_groups (the collision); agent C is an agent whose ctx is not a scope (the channel refusal).
 * @param kernel - the real kernel modules.
 * @param module - the staged subject.
 * @param options - withApproval mounts the real ApprovalService and opens a turn in A's session.
 */
async function buildWorld(kernel, module, options) {
  const { Context, createScope, SystemPrompt, ToolRuntime, AgentRegistry, ApprovalService, Session, SessionId, defineTool } = kernel
  const ctx = new Context()
  const logs = []
  const state = { changes: 0 }
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.on('tools/change', () => { state.changes += 1 })
  await ctx.plugin(AgentRegistry)
  // The default exporter level hides warn; this gate wants the plugin's own refusal lines, so it
  // declares the level it reads at instead of assuming the default shows everything.
  ctx.logger.exporter({ levels: { default: 3 }, export: (message) => { logs.push(String(message.type) + ' | ' + String(message.name) + ' | ' + message.args.map(argument => String(argument)).join(' ')) } })

  const toolFile = (name) => defineTool({
    name,
    description: 'group member ' + name,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: () => 'ran:' + name,
  })
  for (const name of REGISTERED_MEMBERS) ctx.tools.register(toolFile(name))

  const agentOf = (id) => ({
    id: SessionId(id), options: {}, session: Session.create(SessionId(id)),
    inbox: { nextTurn: [], nextStep: [] }, status: 'idle', ctx: undefined,
    send() {}, followup() {}, steer: () => ({ outcome: Promise.resolve({ status: 'rejected' }) }),
    inject() {}, cancel() {}, runMaintenance: (task) => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  })
  const agentA = agentOf('p116-a')
  const agentB = agentOf('p116-b')
  const agentC = agentOf('p116-c')
  const mintScope = async (agent) => {
    await ctx.plugin(Object.assign((inner) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  }
  await mintScope(agentA)
  await mintScope(agentB)
  agentB.ctx.tools.register(toolFile(CATALOG_TOOL))
  agentC.ctx = ctx

  const surfaceNames = (agent) => ctx.tools.schemas(agent).map(tool => tool.name).sort()
  const before = { A: surfaceNames(agentA), B: surfaceNames(agentB), C: surfaceNames(agentC) }
  await ctx.agents.register(agentA)
  await ctx.agents.register(agentB)
  await ctx.agents.register(agentC)

  let installError = null
  const fiber = ctx.plugin(module, { groups: GROUPS })
  try { await fiber } catch (error) { installError = String(error !== null && typeof error === 'object' && 'message' in error ? error.message : error) }

  let approval = null
  if (options.withApproval === true) {
    approval = new ApprovalService(ctx, { policy: 'ask' })
    agentA.session.append('turn/start', { turn: 1 })
  }

  // The answerer is composed only when the world asks for one: the FIRST approval reading needs a
  // world where nobody at all can answer, which is a different world from one whose answerer says no.
  const answerer = {
    mode: 'unavailable',
    asks: 0,
    release: null,
    register() {
      ctx.on('approval/request', () => {
        answerer.asks += 1
        if (answerer.mode === 'rejected') return 'rejected'
        if (answerer.mode === 'allowed-once') return 'allowed-once'
        if (answerer.mode === 'throw') throw new Error('p116: the composed answerer refused to answer')
        if (answerer.mode === 'hang') return new Promise((settle) => { answerer.release = () => settle('rejected') })
        return 'unavailable'
      })
    },
  }
  return { ctx, agentA, agentB, agentC, logs, installError, before, approval, answerer, surfaceNames, state }
}

/** A read-only reader over the kernel's own audit pair: how many questions were asked, and what came of them. */
const auditOf = (session) => {
  const asked = []
  const decided = []
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'approval/asked') asked.push(event.data)
    if (event.type === 'approval/decided') decided.push(event.data)
  }
  return { asked, decided }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** The call helpers: every reading below is arithmetic over what these return. */
async function callHelpers(world) {
  const { ctx, agentA, state } = world
  let seq = 0
  const counters = () => {
    const audit = auditOf(agentA.session)
    return { asks: audit.asked.length, decided: audit.decided.length, outcomes: audit.decided.map(entry => String(entry.outcome)), changes: state.changes }
  }
  const runTool = async (agent, name, args, signal) => {
    const controller = new AbortController()
    const callId = 'p116-' + String(++seq)
    const result = await ctx.tools.execute({ signal: signal ?? controller.signal, callId, name, arguments: args ?? {}, agent })
    const first = result.content[0]
    return {
      callId,
      text: first !== undefined && first.type === 'text' ? first.text : JSON.stringify(result.content),
      isError: result.isError === true,
    }
  }
  const snapshot = async (agent) => {
    const catalog = await runTool(agent, CATALOG_TOOL, {})
    const counted = counters()
    return { catalog: catalog.text, catalogError: catalog.isError, surface: world.surfaceNames(agent), asks: counted.asks, decided: counted.decided, outcomes: counted.outcomes, changes: counted.changes }
  }
  const probe = async (id, agent, name, args) => {
    const start = await snapshot(agent)
    const outcome = await runTool(agent, name, args)
    const end = await snapshot(agent)
    return {
      id, tool: name, args: args ?? {},
      text: outcome.text, isError: outcome.isError, callId: outcome.callId,
      catalogBefore: start.catalog, catalogAfter: end.catalog,
      surfaceBefore: start.surface, surfaceAfter: end.surface,
      asks: end.asks - start.asks,
      decided: end.decided - start.decided,
      outcomes: end.outcomes.slice(start.decided),
      changes: end.changes - start.changes,
      opened: (outcome.text.match(/^- opened /gmu) ?? []).length,
      refused: (outcome.text.match(/^- refused /gmu) ?? []).length,
      pending: (outcome.text.match(/^- not applied /gmu) ?? []).length,
      effective: [...outcome.text.matchAll(/effective: ([A-Za-z-]+)/gu)].map(match => match[1]),
    }
  }
  return { runTool, snapshot, probe, counters }
}

/** The whole measurement, in the order the readings need it. */
async function measure(module, kernel) {
  const transcript = { config: { groups: GROUPS, registered: REGISTERED_MEMBERS }, mutant: MUTANT }

  // ---- world 1: the real ApprovalService is composed and a turn is open, but no answerer is
  //      registered until after the first question, so that question is asked in a world where
  //      nobody at all can answer it.
  const world = await buildWorld(kernel, module, { withApproval: true })
  const { runTool, snapshot, probe } = await callHelpers(world)
  const { agentA, agentB, agentC, before, surfaceNames, ctx, answerer } = world
  transcript.installError = world.installError
  transcript.logs = world.logs

  transcript.install = {
    beforeA: before.A, beforeB: before.B, beforeC: before.C,
    surfaceA: surfaceNames(agentA), surfaceB: surfaceNames(agentB), surfaceC: surfaceNames(agentC),
    added: surfaceNames(agentA).filter(name => before.A.includes(name) === false),
    bOwnTool: await runTool(agentB, CATALOG_TOOL, {}),
    bDeclare: await runTool(agentB, DECLARE_TOOL, { open: ['plain'] }),
    cCatalog: await runTool(agentC, CATALOG_TOOL, {}),
  }

  // ---- closed means unreachable, and a closed group's member looks like a name nobody registered.
  transcript.closed = {
    closedMember: await runTool(agentA, 'plain_one', {}),
    ghostMember: await runTool(agentA, GHOST_TOOL, {}),
  }

  // ---- the refusal batch: seven declarable refusals, each of which must move nothing.
  const BATCH = [
    { id: 'input-empty', tool: DECLARE_TOOL, args: {} },
    { id: 'unknown-id', tool: DECLARE_TOOL, args: { open: ['no_such_group'] } },
    { id: 'duplicate', tool: DECLARE_TOOL, args: { open: ['typo'], close: ['typo'] } },
    { id: 'dependency', tool: DECLARE_TOOL, args: { open: ['behind'] } },
    { id: 'typo', tool: DECLARE_TOOL, args: { open: ['typo'] } },
    { id: 'catalog-with-arguments', tool: CATALOG_TOOL, args: { open: ['plain'] } },
    { id: 'off-group', tool: DECLARE_TOOL, args: { open: ['locked'] } },
  ]
  const batchBefore = await snapshot(agentA)
  const batchCalls = []
  for (const step of BATCH) batchCalls.push(await probe(step.id, agentA, step.tool, step.args))
  const batchAfter = await snapshot(agentA)
  transcript.batch = { before: batchBefore, after: batchAfter, calls: batchCalls }

  // ---- the questions. The first one is asked with NO answerer composed anywhere.
  const questions = {}
  questions.noAnswerer = await probe('no-answerer-composed', agentA, DECLARE_TOOL, { open: ['gated'] })
  answerer.register()
  answerer.mode = 'rejected'
  questions.rejected = await probe('rejecting-answerer', agentA, DECLARE_TOOL, { open: ['gated'] })
  answerer.mode = 'allowed-once'
  questions.allowed = await probe('allowing-answerer', agentA, DECLARE_TOOL, { open: ['gated'] })
  questions.allowedAgain = await probe('allowing-answerer-again', agentA, DECLARE_TOOL, { open: ['gated'] })
  answerer.mode = 'rejected'
  questions.bothFlags = await probe('both-flags', agentA, DECLARE_TOOL, { open: ['locked_gated'] })
  questions.paired = await probe('paired-not-gated', agentA, DECLARE_TOOL, { open: ['plain'] })
  answerer.mode = 'throw'
  questions.throwing = await probe('throwing-answerer', agentA, DECLARE_TOOL, { open: ['gated_b'] })

  // ---- a question asked and never answered, with the call's own signal aborted under it.
  const abortedStart = await snapshot(agentA)
  answerer.mode = 'hang'
  const controller = new AbortController()
  const pending = ctx.tools.execute({
    signal: controller.signal, callId: 'p116-aborted', name: DECLARE_TOOL, arguments: { open: ['gated_b'] }, agent: agentA,
  })
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && auditOf(agentA.session).asked.length <= abortedStart.asks) await sleep(10)
  controller.abort()
  const abortOutcome = await pending
  const abortedEnd = await snapshot(agentA)
  if (answerer.release !== null) answerer.release()
  const abortText = abortOutcome.content[0] !== undefined && abortOutcome.content[0].type === 'text' ? abortOutcome.content[0].text : JSON.stringify(abortOutcome.content)
  questions.aborted = {
    id: 'aborted-question',
    text: abortText,
    isError: abortOutcome.isError === true,
    catalogBefore: abortedStart.catalog, catalogAfter: abortedEnd.catalog,
    surfaceBefore: abortedStart.surface, surfaceAfter: abortedEnd.surface,
    asks: abortedEnd.asks - abortedStart.asks,
    decided: abortedEnd.decided - abortedStart.decided,
    outcomes: abortedEnd.outcomes.slice(abortedStart.decided),
    changes: abortedEnd.changes - abortedStart.changes,
    opened: (abortText.match(/^- opened /gmu) ?? []).length,
    refused: (abortText.match(/^- refused /gmu) ?? []).length,
    pending: (abortText.match(/^- not applied /gmu) ?? []).length,
    effective: [...abortText.matchAll(/effective: ([A-Za-z-]+)/gu)].map(match => match[1]),
  }
  transcript.questions = questions
  transcript.answererAsks = answerer.asks

  // ---- world 2: no ApprovalService at all. An ordinary declaration must still work here, or the
  //      denial measured beside it would only be a dead world.
  const bareWorld = await buildWorld(kernel, module, { withApproval: false })
  const bare = await callHelpers(bareWorld)
  transcript.bare = {
    approvalComposed: bareWorld.ctx.get('approval') !== undefined,
    userDisabled: await bare.probe('bare-user-disabled', bareWorld.agentA, DECLARE_TOOL, { open: ['gated'] }),
    ordinary: await bare.probe('bare-ordinary', bareWorld.agentA, DECLARE_TOOL, { open: ['plain'] }),
  }
  transcript.installErrorBare = bareWorld.installError
  return transcript
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured transcript, so a mutant's world is judged the same way
// ---------------------------------------------------------------------------

const rowOf = (catalog, id) => (catalog.split('\n').find(line => line.startsWith('- ' + id + ' ')) ?? '')
const sameList = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const codesIn = (text) => [...text.matchAll(/\bGROUPS_[A-Z_]+\b/gu)].map(match => match[0])

function judge(t) {
  const readings = []
  const add = (id, ok, detail, evidence) => {
    readings.push({ id, ok: ok === true, detail: String(detail), evidence: (evidence ?? []).filter(line => line !== undefined).map(String) })
  }
  const byId = (id) => t.batch.calls.find(call => call.id === id)
  const expectedInstall = REGISTERED_MEMBERS
    .filter(name => GROUPS.some(group => group.state === 'on' && group.tools.includes(name)))
    .concat([CATALOG_TOOL, DECLARE_TOOL]).sort()
  const activation = [CATALOG_TOOL, DECLARE_TOOL].sort()
  const KERNEL_SENTENCE = 'requires approval, but no approval channel is available'
  const probes = [...t.batch.calls, ...Object.values(t.questions), t.bare.userDisabled, t.bare.ordinary]

  // ---- 01 the channel refusal
  {
    const lines = t.logs.filter(line => line.includes('p116-c') && line.includes('GROUPS_CHANNEL'))
    const fails = []
    if (!sameList(t.install.surfaceC, t.install.beforeC)) fails.push('the unscoped agent surface moved: ' + JSON.stringify(t.install.beforeC) + ' -> ' + JSON.stringify(t.install.surfaceC))
    if (t.install.surfaceC.includes(CATALOG_TOOL) || t.install.surfaceC.includes(DECLARE_TOOL)) fails.push('an activation tool was registered on an agent with no scope')
    if (lines.length !== 1) fails.push('expected exactly one named refusal line, saw ' + String(lines.length))
    if (!(t.install.cCatalog.isError === true && t.install.cCatalog.text === 'Error: unknown tool "' + CATALOG_TOOL + '"')) fails.push('the catalog call answered ' + JSON.stringify(t.install.cCatalog.text))
    add(READING.CHANNEL, fails.length === 0,
      fails.length === 0
        ? 'an agent whose ctx is not a scope keeps its ' + String(t.install.surfaceC.length) + ' names, gains no activation tool, and the plugin names the refusal once: ' + JSON.stringify(lines[0])
        : 'GROUPS_CHANNEL not honoured: ' + fails.join(' | '),
      [lines[0] === undefined ? 'no refusal line naming p116-c' : lines[0], 'catalog for that agent: ' + t.install.cCatalog.text])
  }

  // ---- 02 the collision refusal
  {
    const lines = t.logs.filter(line => line.includes('p116-b') && line.includes('GROUPS_COLLISION'))
    const fails = []
    if (!sameList(t.install.surfaceB, t.install.beforeB)) fails.push('the surface of the colliding agent moved: ' + JSON.stringify(t.install.beforeB) + ' -> ' + JSON.stringify(t.install.surfaceB))
    if (!(t.install.bOwnTool.isError === false && t.install.bOwnTool.text === 'ran:' + CATALOG_TOOL)) fails.push('the pre-existing tool no longer executes: ' + JSON.stringify(t.install.bOwnTool.text))
    if (!(t.install.bDeclare.isError === true && t.install.bDeclare.text === 'Error: unknown tool "' + DECLARE_TOOL + '"')) fails.push('the declaration tool was installed anyway: ' + JSON.stringify(t.install.bDeclare.text))
    if (lines.length !== 1) fails.push('expected exactly one named refusal line, saw ' + String(lines.length))
    add(READING.COLLISION, fails.length === 0,
      fails.length === 0
        ? 'an agent that already resolves ' + CATALOG_TOOL + ' is refused with its own name, keeps that tool, and gains nothing: ' + JSON.stringify(lines[0])
        : 'GROUPS_COLLISION not honoured: ' + fails.join(' | '),
      [lines[0], 'its own tool answered ' + JSON.stringify(t.install.bOwnTool.text) + ', the declaration tool ' + JSON.stringify(t.install.bDeclare.text)])
  }

  // ---- 03 the installed surface is exactly what this gate computed
  {
    const fails = []
    if (!sameList(t.install.surfaceA, expectedInstall)) fails.push('surface is ' + JSON.stringify(t.install.surfaceA) + ', this gate computed ' + JSON.stringify(expectedInstall))
    if (!sameList(t.install.added, activation)) fails.push('the names added to the agent are ' + JSON.stringify(t.install.added) + ', not the two frozen activation tools')
    add(READING.INSTALL, fails.length === 0,
      fails.length === 0
        ? 'after apply() the agent sees exactly the ' + String(expectedInstall.length) + ' names this gate computed from its own configuration, and the ' + String(t.install.added.length) + ' it gained are ' + JSON.stringify(t.install.added)
        : 'the installed surface is not the declared one: ' + fails.join(' | '),
      ['surface: ' + JSON.stringify(t.install.surfaceA), 'this gate computed: ' + JSON.stringify(expectedInstall)])
  }

  // ---- 04 a closed member is unreachable, exactly like a name nobody registered
  {
    const closed = t.closed.closedMember
    const ghost = t.closed.ghostMember
    const fails = []
    if (!(closed.isError === true && closed.text === 'Error: unknown tool "plain_one"')) fails.push('a closed group member answered ' + JSON.stringify(closed.text))
    if (!(ghost.isError === true && ghost.text === 'Error: unknown tool "' + GHOST_TOOL + '"')) fails.push('a never-registered name answered ' + JSON.stringify(ghost.text))
    const shape = (text, name) => text.split(name).join('<name>')
    if (closed.text !== undefined && ghost.text !== undefined && shape(closed.text, 'plain_one') !== shape(ghost.text, GHOST_TOOL)) fails.push('the two errors are not the same shape: ' + JSON.stringify(closed.text) + ' vs ' + JSON.stringify(ghost.text))
    add(READING.UNREACHABLE, fails.length === 0,
      fails.length === 0
        ? 'a member of a closed group is refused at the EXECUTION surface with the same words as a name nothing ever registered: ' + JSON.stringify(closed.text)
        : 'closed is not unreachable: ' + fails.join(' | '),
      ['closed member: ' + JSON.stringify(closed.text), 'unregistered name: ' + JSON.stringify(ghost.text)])
  }

  // ---- 05 the one legal effective point
  {
    const applied = probes.filter(probe => /^- (opened|closed) /mu.test(probe.text))
    const words = [...new Set(applied.flatMap(probe => probe.effective))]
    const drift = words.filter(word => word !== 'next-step')
    const elsewhere = probes.filter(probe => /immediate|this step|same step/iu.test(probe.text))
    const fails = []
    if (applied.length < 2) fails.push('only ' + String(applied.length) + ' applied row(s) in the whole world, so this reading would be vacuous')
    if (drift.length > 0) fails.push('EFFECTIVE_DRIFT: the only legal value is next-step, observed ' + JSON.stringify(drift))
    if (words.length === 0) fails.push('EFFECTIVE_DRIFT: no applied row carried an effective value at all')
    if (elsewhere.length > 0) fails.push('EFFECTIVE_DRIFT: ' + String(elsewhere.length) + ' answer(s) claim another effective point: ' + JSON.stringify(elsewhere.map(probe => probe.id)))
    add(READING.EFFECTIVE, fails.length === 0,
      fails.length === 0
        ? String(applied.length) + ' applied rows in this world, every one reading effective: next-step — the observed vocabulary is ' + JSON.stringify(words)
        : fails.join(' | '),
      ['applied rows: ' + JSON.stringify(applied.map(probe => probe.id + ' -> ' + JSON.stringify(probe.effective)))])
  }

  // ---- 06 the user-disabled group asks exactly once and opens nothing
  {
    const q = t.questions.noAnswerer
    const fails = []
    if (q.asks !== 1) fails.push('the kernel audit pair counted ' + String(q.asks) + ' question(s), not one')
    if (q.decided !== 1) fails.push('the audit pair counted ' + String(q.decided) + ' decision(s), not one')
    if (q.catalogBefore !== q.catalogAfter) fails.push('the catalog moved')
    if (!sameList(q.surfaceBefore, q.surfaceAfter)) fails.push('the tool surface moved')
    if (rowOf(q.catalogAfter, 'gated').includes(' OPEN ')) fails.push('the group reads OPEN afterwards')
    add(READING.GATED_ASK, fails.length === 0,
      fails.length === 0
        ? 'with nobody composed to answer, a user-disabled group is asked exactly once (kernel approval/asked), decided ' + JSON.stringify(q.outcomes[0]) + ', and nothing moved: catalog and surface byte-identical'
        : 'the question was not asked exactly once, or the world moved anyway: ' + fails.join(' | '),
      ['answer: ' + JSON.stringify(q.text.slice(0, 220)), 'asks=' + String(q.asks) + ' decided=' + JSON.stringify(q.outcomes)])
  }

  // ---- 07 the paired group is asked nothing
  {
    const p = t.questions.paired
    const fails = []
    if (p.asks !== 0) fails.push('it was asked ' + String(p.asks) + ' time(s)')
    if (p.isError !== false) fails.push('the call failed: ' + JSON.stringify(p.text.slice(0, 160)))
    if (!rowOf(p.catalogAfter, 'plain').includes(' OPEN ')) fails.push('the group did not open')
    if (p.catalogBefore === p.catalogAfter) fails.push('the catalog did not move, so the call did nothing at all')
    for (const name of ['plain_one', 'plain_two']) if (!p.surfaceAfter.includes(name)) fails.push(name + ' is still not visible')
    add(READING.PAIRED, fails.length === 0,
      fails.length === 0
        ? 'the same call shape on a group that is not user-disabled runs with the answerer composed and armed and asks it 0 times: it simply opens'
        : 'the pair is not a pair: ' + fails.join(' | '),
      ['result: ' + JSON.stringify(p.text.slice(0, 200)), 'asks=' + String(p.asks) + ' (the answerer was composed and counted ' + String(t.answererAsks) + ' ask(s) in the whole world)'])
  }

  // ---- 08 an off group is denied by name without a question
  {
    const o = byId('off-group')
    const fails = []
    if (o.asks !== 0) fails.push('it was asked ' + String(o.asks) + ' time(s)')
    if (o.isError !== true) fails.push('the call was not refused')
    if (!o.text.startsWith('Error: GROUPS_OFF')) fails.push('the refusal does not lead with the frozen name: ' + JSON.stringify(o.text.slice(0, 160)))
    if (o.catalogBefore !== o.catalogAfter) fails.push('the catalog moved')
    if (!sameList(o.surfaceBefore, o.surfaceAfter)) fails.push('the surface moved')
    if (o.changes !== 0) fails.push(String(o.changes) + ' tool-surface change(s) happened')
    add(READING.OFF, fails.length === 0,
      fails.length === 0
        ? 'a group the composition turned off is denied by the plugin itself with ZERO questions asked and no surface change: ' + JSON.stringify(o.text.slice(0, 140))
        : 'the off group was not denied without asking: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(o.text.slice(0, 200)), 'asks=' + String(o.asks) + ' changes=' + String(o.changes)])
  }

  // ---- 09 both flags: the user-disabled rule wins and it is asked
  {
    const b = t.questions.bothFlags
    const fails = []
    if (b.asks !== 1) fails.push('it was asked ' + String(b.asks) + ' time(s), not once')
    if (b.isError !== true) fails.push('the call was not refused: ' + JSON.stringify(b.text.slice(0, 160)))
    if (b.catalogBefore !== b.catalogAfter) fails.push('the catalog moved')
    if (!sameList(b.surfaceBefore, b.surfaceAfter)) fails.push('the surface moved')
    if (rowOf(b.catalogAfter, 'locked_gated').includes(' OPEN ')) fails.push('the group reads OPEN afterwards')
    add(READING.BOTH_FLAGS, fails.length === 0,
      fails.length === 0
        ? 'a group carrying state off AND userDisabled is ASKED exactly once (the user-disabled rule wins over the direct denial) and denied: ' + JSON.stringify(b.outcomes)
        : 'the two flags did not resolve to one question and no movement: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(b.text.slice(0, 200))])
  }

  // ---- 10 a rejected approval moves nothing
  {
    const r = t.questions.rejected
    const fails = []
    if (r.asks !== 1) fails.push('asked ' + String(r.asks) + ' time(s)')
    if (r.isError !== true) fails.push('the call was not refused')
    if (!r.text.includes('the user rejected tool "' + DECLARE_TOOL + '"')) fails.push('the model was not told the user rejected it: ' + JSON.stringify(r.text.slice(0, 200)))
    if (r.catalogBefore !== r.catalogAfter) fails.push('the catalog moved')
    if (!sameList(r.surfaceBefore, r.surfaceAfter)) fails.push('the surface moved')
    if (r.changes !== 0) fails.push(String(r.changes) + ' tool-surface change(s) happened')
    if (r.opened !== 0) fails.push(String(r.opened) + ' opening row(s) were rendered')
    add(READING.REJECTED, fails.length === 0,
      fails.length === 0
        ? 'a rejecting answerer leaves the catalog byte-identical, the surface identical name for name, zero surface changes and zero applied rows after exactly one question'
        : 'the rejection moved something: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(r.text.slice(0, 200)), 'asks=' + String(r.asks) + ' changes=' + String(r.changes)])
  }

  // ---- 11 an allowed approval slides the surface exactly once
  {
    const a = t.questions.allowed
    const again = t.questions.allowedAgain
    const fails = []
    if (a.asks !== 1) fails.push('the first call asked ' + String(a.asks) + ' time(s)')
    if (a.isError !== false) fails.push('the granted call failed: ' + JSON.stringify(a.text.slice(0, 200)))
    if (a.opened !== 1) fails.push(String(a.opened) + ' opening row(s) were rendered')
    if (a.changes !== 1) fails.push(String(a.changes) + ' tool-surface change(s) for one grant, not one')
    if (!rowOf(a.catalogAfter, 'gated').includes(' OPEN ')) fails.push('the group does not read OPEN')
    if (a.catalogBefore === a.catalogAfter) fails.push('the catalog did not move, so nothing opened')
    if (again.asks !== 0) fails.push('the repeat declaration asked ' + String(again.asks) + ' time(s)')
    if (again.changes !== 0) fails.push('the repeat declaration changed the surface ' + String(again.changes) + ' time(s)')
    if (!again.text.includes('GROUPS_INPUT')) fails.push('the repeat declaration was not refused by name: ' + JSON.stringify(again.text.slice(0, 160)))
    if (again.catalogBefore !== again.catalogAfter) fails.push('the repeat declaration moved the catalog')
    add(READING.ALLOWED, fails.length === 0,
      fails.length === 0
        ? 'one granted answer produced exactly ONE tools/change event and exactly one applied row (not the mask-then-lift pair), and the second declaration of the same group asked nothing and slid nothing'
        : 'the grant did not slide exactly once: ' + fails.join(' | '),
      ['granted: ' + JSON.stringify(a.text.slice(0, 200)), 'changes=' + String(a.changes) + ' asks=' + String(a.asks),
       'repeat: ' + JSON.stringify(again.text.slice(0, 160)), 'changes=' + String(again.changes) + ' asks=' + String(again.asks)])
  }

  // ---- 12 a channel that cannot answer is the kernel's own denial
  {
    const q = t.questions.noAnswerer
    const fails = []
    if (q.text.includes(KERNEL_SENTENCE) === false) fails.push('the model was not given the kernel sentence: ' + JSON.stringify(q.text.slice(0, 220)))
    if (q.text.includes('tool "' + DECLARE_TOOL + '"') === false) fails.push('the denial does not name the tool')
    if (q.text.includes('opening user-disabled tool group')) fails.push('the refusal is the ask\'s own prose, not the kernel\'s degrade sentence')
    if (q.isError !== true) fails.push('the call did not fail')
    if (rowOf(q.catalogAfter, 'gated').includes(' OPEN ')) fails.push('the group opened anyway')
    add(READING.NO_ANSWERER, fails.length === 0,
      fails.length === 0
        ? 'with no answerer composed anywhere the kernel denies with its own sentence rather than letting anything through: ' + JSON.stringify(q.text.slice(0, 200))
        : 'the unavailable channel did not fail closed: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(q.text)])
  }

  // ---- 13 no ApprovalService at all is still a denial, and the same world still works
  {
    const u = t.bare.userDisabled
    const o = t.bare.ordinary
    const fails = []
    if (t.bare.approvalComposed !== false) fails.push('the bare world composed an approval service after all')
    if (u.isError !== true) fails.push('the user-disabled declaration did not fail: ' + JSON.stringify(u.text.slice(0, 200)))
    if (u.catalogBefore !== u.catalogAfter) fails.push('the catalog moved')
    if (u.asks !== 0) fails.push(String(u.asks) + ' approval(s) were recorded in a world with no service')
    if (rowOf(u.catalogAfter, 'gated').includes(' OPEN ')) fails.push('the group opened')
    if (u.text.includes('opening user-disabled tool group') === false) fails.push('the denial does not carry the ask reason the kernel falls back to')
    if (o.isError !== false) fails.push('an ordinary declaration failed in the same bare world: ' + JSON.stringify(o.text.slice(0, 160)))
    if (!rowOf(o.catalogAfter, 'plain').includes(' OPEN ')) fails.push('the ordinary group did not open, so the bare world is simply dead')
    add(READING.BARE, fails.length === 0,
      fails.length === 0
        ? 'a world that composes no ApprovalService still denies the user-disabled declaration (nothing opens, nothing is recorded) while an ordinary declaration in the SAME world opens - so this is fail-closed, not a dead world'
        : 'the bare world did not fail closed, or was not alive: ' + fails.join(' | '),
      ['user-disabled: ' + JSON.stringify(u.text.slice(0, 220)), 'ordinary: ' + JSON.stringify(o.text.slice(0, 160)), 'approval composed: ' + String(t.bare.approvalComposed)])
  }

  // ---- 14 an answerer that throws
  {
    const th = t.questions.throwing
    const fails = []
    if (th.asks !== 1) fails.push('asked ' + String(th.asks) + ' time(s)')
    if (th.decided !== 1) fails.push(String(th.decided) + ' decision(s) recorded')
    if (th.outcomes[0] !== 'unavailable') fails.push('the throwing answerer decided ' + JSON.stringify(th.outcomes))
    if (th.text.includes(KERNEL_SENTENCE) === false) fails.push('the model was not given the kernel sentence: ' + JSON.stringify(th.text.slice(0, 220)))
    if (th.isError !== true) fails.push('the call did not fail')
    if (th.catalogBefore !== th.catalogAfter) fails.push('the catalog moved')
    add(READING.THROWING, fails.length === 0,
      fails.length === 0
        ? 'an answerer that throws is contained by the approval seam and fails the QUESTION closed: decided unavailable, the kernel sentence reaches the model, nothing opens'
        : 'the throwing answerer did not fail closed: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(th.text.slice(0, 220)), 'decided=' + JSON.stringify(th.outcomes)])
  }

  // ---- 15 an aborted question
  {
    const ab = t.questions.aborted
    const fails = []
    if (ab.asks !== 1) fails.push('asked ' + String(ab.asks) + ' time(s)')
    if (ab.outcomes[0] !== 'cancelled') fails.push('the question was decided ' + JSON.stringify(ab.outcomes) + ', not cancelled')
    if (ab.isError !== true) fails.push('the call did not fail: ' + JSON.stringify(ab.text.slice(0, 200)))
    if (ab.catalogBefore !== ab.catalogAfter) fails.push('the catalog moved')
    if (!sameList(ab.surfaceBefore, ab.surfaceAfter)) fails.push('the surface moved')
    if (ab.changes !== 0) fails.push(String(ab.changes) + ' tool-surface change(s) happened')
    if (ab.opened !== 0) fails.push(String(ab.opened) + ' opening row(s) were rendered')
    add(READING.ABORTED, fails.length === 0,
      fails.length === 0
        ? 'a question that is asked and never answered leaves the call failed and the world untouched when its signal is aborted, after exactly one question'
        : 'the unanswered question opened something: ' + fails.join(' | '),
      ['text: ' + JSON.stringify(ab.text.slice(0, 220)), 'asks=' + String(ab.asks) + ' decided=' + JSON.stringify(ab.outcomes)])
  }

  // ---- 16..21 the six declared refusals are named
  {
    const c = byId('input-empty')
    const ok = c.isError === false && c.text.includes('GROUPS_INPUT') && c.opened === 0
    add(READING.INPUT, ok,
      ok ? 'an empty declaration is refused by name without a call error and without opening anything: ' + JSON.stringify(c.text.slice(0, 140))
        : 'GROUPS_INPUT was not the refusal: ' + JSON.stringify(c.text.slice(0, 200)),
      ['text: ' + JSON.stringify(c.text.slice(0, 200))])
  }
  {
    const c = byId('unknown-id')
    const known = (c.text.split('Known group ids (configuration order): ')[1] ?? '').split('\n')[0]
    const listed = known.split(', ').filter(entry => entry.length > 0)
    const ok = c.isError === false && c.text.includes('GROUPS_UNKNOWN') && sameList(listed, GROUP_IDS)
    add(READING.UNKNOWN, ok,
      ok ? 'an id outside the catalog is refused by name and the known ids travel back in configuration order: ' + JSON.stringify(listed)
        : 'GROUPS_UNKNOWN did not carry the ordered known ids: ' + JSON.stringify(c.text.slice(0, 240)),
      ['text: ' + JSON.stringify(c.text.slice(0, 240)), 'this gate\'s ids: ' + JSON.stringify(GROUP_IDS)])
  }
  {
    const c = byId('duplicate')
    const ok = c.isError === false && c.text.includes('GROUPS_DUP') && c.opened === 0
    add(READING.DUP, ok,
      ok ? 'one id named on both sides is refused by name and nothing opens: ' + JSON.stringify(c.text.slice(0, 140))
        : 'GROUPS_DUP was not the refusal: ' + JSON.stringify(c.text.slice(0, 200)),
      ['text: ' + JSON.stringify(c.text.slice(0, 200))])
  }
  {
    const c = byId('dependency')
    const ok = c.isError === false && c.text.includes('GROUPS_DEPENDENCY') && c.text.includes('"plain"')
    add(READING.DEPENDENCY, ok,
      ok ? 'a group whose auto.when is after names the group it waits for: ' + JSON.stringify(c.text.slice(0, 160))
        : 'GROUPS_DEPENDENCY did not name the group it depends on: ' + JSON.stringify(c.text.slice(0, 200)),
      ['text: ' + JSON.stringify(c.text.slice(0, 200))])
  }
  {
    const c = byId('typo')
    const ok = c.isError === false && c.text.includes('GROUPS_NO_TOOLS') && c.text.includes('typo_absent') && c.opened === 0
    add(READING.NO_TOOLS, ok,
      ok ? 'one wrong name in the configuration is a named refusal that names the tool and does not open the group: ' + JSON.stringify(c.text.slice(0, 180))
        : 'GROUPS_NO_TOOLS did not name the missing tool: ' + JSON.stringify(c.text.slice(0, 220)),
      ['text: ' + JSON.stringify(c.text.slice(0, 220))])
  }
  {
    const c = byId('catalog-with-arguments')
    const ok = c.isError === true && c.text.includes('GROUPS_CATALOG')
    add(READING.CATALOG, ok,
      ok ? 'the directory tool refuses arguments by name: ' + JSON.stringify(c.text.slice(0, 140))
        : 'GROUPS_CATALOG was not the refusal: ' + JSON.stringify(c.text.slice(0, 200)),
      ['text: ' + JSON.stringify(c.text.slice(0, 200))])
  }

  // ---- 22 the nine codes are all observed, and nothing else is
  {
    const texts = [
      ...probes.map(probe => probe.text),
      ...t.logs,
    ]
    const observed = [...new Set(texts.flatMap(codesIn))].sort()
    const missing = NINE_CODES.filter(code => observed.includes(code) === false)
    const extra = observed.filter(code => NINE_CODES.includes(code) === false)
    const ok = missing.length === 0 && extra.length === 0
    add(READING.NINE, ok,
      ok ? 'every one of the nine frozen refusal codes was OBSERVED by this gate in its own world, and no other GROUPS_ name appeared: ' + JSON.stringify(observed)
        : 'the observed refusal vocabulary is not the frozen nine: missing=' + JSON.stringify(missing) + ' unexpected=' + JSON.stringify(extra),
      ['observed: ' + JSON.stringify(observed), 'frozen: ' + JSON.stringify(NINE_CODES)])
  }

  // ---- 23 no refusal moved state or surface, and the comparison can move
  {
    const perCall = t.batch.calls.map(call => ({ id: call.id, catalogSame: call.catalogBefore === call.catalogAfter, surfaceSame: sameList(call.surfaceBefore, call.surfaceAfter) }))
    const moved = perCall.filter(entry => entry.catalogSame === false || entry.surfaceSame === false)
    const batchLevel = t.batch.before.catalog === t.batch.after.catalog && sameList(t.batch.before.surface, t.batch.after.surface)
    const movedProbes = probes.filter(probe => probe.catalogBefore !== probe.catalogAfter)
    const control = probes.some(probe => probe.catalogBefore !== probe.catalogAfter)
    const fails = []
    if (moved.length > 0) fails.push('these refusals moved the world: ' + JSON.stringify(moved))
    if (batchLevel === false) fails.push('the batch as a whole moved the catalog or the surface')
    if (control === false) fails.push('the paired control did not move the world either, so these snapshots prove nothing')
    add(READING.INVARIANT, fails.length === 0,
      fails.length === 0
        ? 'all ' + String(t.batch.calls.length) + ' refusals and the batch around them left the catalog byte-identical and the surface identical name for name, while the same snapshots in the same world DID see a declaration move the catalog (' + String(movedProbes.length) + ' of them)'
        : 'a refusal moved something: ' + fails.join(' | '),
      ['per call: ' + JSON.stringify(perCall), 'batch-level identical: ' + String(batchLevel), 'snapshots that moved in this world: ' + JSON.stringify(movedProbes.map(probe => probe.id))])
  }

  return readings
}

// ---------------------------------------------------------------------------
// The self-attack: rewrite the shipped artifact, re-measure the world, compare sets
// ---------------------------------------------------------------------------

const runSelfAttack = async (baseline, started) => {
  const red = baseline.filter(reading => reading.ok === false)
  if (red.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: ' + String(red.length) + ' reading(s) are already red, and a mutant declared against a red reading proves nothing')
    for (const reading of red) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below rewrites ONE string in the shipped artifact and is measured in its OWN child process:')
  let imprecise = 0
  for (const mutant of MUTANTS) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--attack-child'], {
      encoding: 'utf8', timeout: 300000, env: { ...process.env, R185_P116_MUTANT: mutant.name },
    })
    const output = String(child.stdout ?? '') + String(child.stderr ?? '')
    const line = output.split(/\r?\n/u).filter(entry => entry.startsWith('READINGS-JSON ')).pop()
    if (line === undefined) {
      imprecise += 1
      const named = output.split(/\r?\n/u).filter(entry => entry.includes('NOT MEASURED') || entry.includes('SKIP:')).pop()
      console.log('  FAIL  mutant. ' + mutant.name + ' produced no readings (exit ' + String(child.status) + ')' + (named === undefined ? '' : ': ' + named))
      continue
    }
    const after = JSON.parse(line.slice('READINGS-JSON '.length))
    const observed = after.filter(reading => reading.ok === false).map(reading => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every(id => observed.includes(id))
    if (precise === false) imprecise += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' \u2014 声明集 == 观测集: declared=' + JSON.stringify(declared) + ' observed=' + JSON.stringify(observed))
  }
  const coverage = new Map()
  for (const mutant of MUTANTS) for (const id of mutant.mustRedden) coverage.set(id, (coverage.get(id) ?? 0) + 1)
  let uncovered = 0
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  for (const reading of baseline) {
    const count = coverage.get(reading.id) ?? 0
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(MUTANTS.length) + ' mutants, ' + String(imprecise) + ' imprecise, '
    + String(MUTANTS.filter(mutant => mutant.mustRedden.length > 0).length) + ' of them declare a target, '
    + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants rewrite the artifact ITSELF and every one is measured in a child process of this gate, so the world is rebuilt from the mutated bytes rather than a fixture being edited.')
  return imprecise === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const loadKernel = async () => {
  const load = (key) => import(pathToFileURL(KERNEL_MODULES[key]).href)
  const cordis = await load('@deepseek-ai/cordis')
  const scope = await load('@deepseek-ai/dsh-scope')
  const tools = await load('@deepseek-ai/dsh-tools')
  const prompt = await load('@deepseek-ai/dsh-system-prompt')
  const session = await load('@deepseek-ai/dsh-session')
  const agent = await load('@deepseek-ai/dsh-agent')
  const approval = await load('@deepseek-ai/dsh-user-approval')
  return {
    Context: cordis.Context,
    createScope: scope.createScope,
    defineTool: tools.defineTool,
    ToolRuntime: tools.default,
    SystemPrompt: prompt.default,
    Session: session.Session,
    SessionId: session.SessionId,
    AgentRegistry: agent.default,
    ApprovalService: approval.default,
  }
}

const describe = (error) => String(error !== null && typeof error === 'object' && 'message' in error ? error.message : error)

const run = async (subject, started) => {
  let kernel
  try { kernel = await loadKernel() } catch (error) {
    console.log('NOT MEASURED: the kernel modules did not import: ' + describe(error))
    console.log('SKIP: the kernel modules did not import: ' + describe(error))
    return 3
  }
  let transcript
  try { transcript = await measure(subject.module, kernel) } catch (error) {
    console.log('NOT MEASURED: the world could not be measured: ' + describe(error))
    console.log('SKIP: the world could not be measured: ' + describe(error))
    console.log(String(error !== null && typeof error === 'object' && 'stack' in error ? error.stack : ''))
    return 3
  }
  const readings = judge(transcript)
  if (JSON_OUT || ATTACK_CHILD) console.log('READINGS-JSON ' + JSON.stringify(readings))
  if (ATTACK_CHILD) return readings.filter(reading => reading.ok === false).length > 0 ? 1 : 0
  const failed = readings.filter(reading => reading.ok === false)
  for (const reading of readings) {
    console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  if (transcript.installError !== null) console.log('        note: apply() rejected in world 1: ' + String(transcript.installError))
  if (transcript.installErrorBare !== null) console.log('        note: apply() rejected in world 2: ' + String(transcript.installErrorBare))
  if (SELF_ATTACK) return await runSelfAttack(readings, started)
  return failed.length > 0 ? 1 : 0
}

const main = async () => {
  const started = Date.now()
  const subject = await loadSubject()
  try {
    if (subject.error !== undefined) {
      console.log('NOT MEASURED: ' + subject.error)
      console.log('SKIP: ' + subject.error)
      return 3
    }
    return await run(subject, started)
  } finally {
    // The staged subject is a copy of the artifact for one run; it is disposable.
    try { rmSync(subject.root, { recursive: true, force: true }) } catch { /* nothing to remove */ }
  }
}

process.exitCode = await main()
