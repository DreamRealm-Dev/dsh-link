/**
 * dsh-link-groups — the mechanism kernel behind the tool surface's third
 * state: tool GROUPS with `on | off | auto`, two always-open activation tools,
 * and an approval gate for groups the user explicitly disabled.
 *
 * Why this package exists
 * -----------------------
 * The kernel has exactly two ways to change what one agent may call: register a
 * tool on a context, or mask inherited tools with `tools.restrict()` on that
 * agent's context. There is no group, no third state, and no per-tool switch
 * (`packages/core/tools/src/index.ts`: `restrict` at :1097, `register` at
 * :1063, `view` at :1178, and a `Config` carrying only `mode` and
 * `maxParallelSubCalls`). "This family of tools may be opened on demand" has
 * therefore never been expressible.
 *
 * This plugin expresses it through the two entry points the kernel's own plugin
 * guide names (`packages/preset/agent-preset/skills/cordis-plugin-development/
 * references/practices.md:17`): `ctx.tools.restrict()` on the agent's context
 * to hide a closed group, and `ask` from `tools/pre-execute` when a decision
 * must await the user. It deliberately does NOT listen to
 * `system-prompt/assemble` — the same guide forbids using it to add or remove
 * tools, because schema omission is not enforcement (`packages/AGENTS.md`).
 *
 * The two activation tools are registered on `agent.ctx` — the agent's OWN
 * layer — on purpose: a restriction filters what a scope INHERITS and never
 * what its own layer registers (`index.ts:1162-1175`), so an agent can always
 * reach the tools that open and close its own groups. For the same reason every
 * tool a group may close must be registered on an ANCESTOR layer (global or
 * preset scope); a group whose member is registered into the agent's own layer
 * cannot be closed, and is reported `broken` instead of pretending otherwise.
 *
 * What a slide costs
 * -------------------
 * Nothing here is free. The routed provider in this deployment declares neither
 * `toolUpdate` nor `systemPromptUpdate` and throws on `deferLoading`, so
 * changing the tool surface rewrites the request body's `tools` section on the
 * next step. Every slide therefore reports three measured numbers — surface
 * entry count, serialized bytes, and whether that step's `request/header`
 * carried `startsSeries`. Batching keeps the slide count at one per call, and
 * closed groups default to `relockable: false`, so an opened group is not
 * removed again inside a session and already-published tool names keep their
 * positions.
 *
 * The third-party seam
 * ---------------------
 * The row's `config.groups` is data the deployment owns. A plugin that owns
 * tools of its own contributes a group through the one public service this
 * package provides ({@link SERVICE}, `'linkGroups'`): `registerGroup` adds a
 * closed `state: 'auto'` group to every live agent's directory in the same call,
 * on the same `ctx.tools.restrict` path a config group uses, and returns the
 * disposer that takes it back out. A duplicate id is a throwing refusal
 * (`LINK_GROUPS_DUPLICATE_GROUP`), never a silent merge, and
 * `GROUPS_COLLISION` keeps its own meaning: a second row of THIS package still
 * collides with the first, per agent. The contract page is
 * `docs/dev/tool-groups.md`.
 *
 * Where group state lives
 * ------------------------
 * In this process, keyed by agent. The session log — the kernel's first
 * principle — cannot carry it: a third-party plugin may not add a
 * `SessionEventMap` type. `Session.append()` refuses nothing at runtime, but
 * the persistence read path refuses the WHOLE log when it meets an unknown type
 * the writer did not mark `ignorable: true`
 * (`packages/core/session/src/storage-contract.ts:75-80`), and a live append
 * cannot set that marker (`references/practices.md:21`). The consequence is
 * stated rather than hidden: after a restart or resume the groups fall back to
 * their configured state and must be declared again.
 *
 * @module dsh-link-groups
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Context as CordisContext } from '@deepseek-ai/cordis'

// ---------------------------------------------------------------------------------------------
// Types
//
// R498: this package shipped without annotations (esbuild strips types, so nothing ever checked
// them) and this block writes down the shapes the code already runs on. Every declaration here is
// erased by the build; the migration changes no runtime path (see docs/handoff/R498-strict-migration.md).
// ---------------------------------------------------------------------------------------------

/** The three legal configured group states. */
type GroupStateName = 'on' | 'off' | 'auto'

/** The three legal automatic-open conditions. */
type AutoWhen = 'declare' | 'device' | 'after'

/** One normalized automatic-open condition; `after` carries the group it waits on. */
type AutoCondition = { when: 'declare' | 'device' } | { when: 'after'; after: string }

/** One raw `config.groups[]` entry, exactly as the profile row supplies it (unvalidated). */
interface GroupEntryInput {
  readonly id?: unknown
  readonly title?: unknown
  readonly summary?: unknown
  readonly tools?: unknown
  readonly provider?: unknown
  readonly state?: unknown
  readonly auto?: unknown
  readonly userDisabled?: unknown
  readonly relockable?: unknown
}

/** One raw automatic-open value from a config entry. */
interface AutoInput {
  readonly when?: unknown
  readonly after?: unknown
}

/** One raw `config` object from the profile row (unvalidated). */
interface ConfigInput {
  readonly groups?: unknown
  readonly catalogPreamble?: unknown
  readonly deferredNotice?: unknown
  readonly logProviderWarnings?: unknown
}

/** One normalized group: the row entry after validation and defaults. */
interface Group {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly tools: string[]
  /** The provider cross-check, or undefined when the entry named none. */
  readonly provider: string | undefined
  readonly state: GroupStateName
  readonly auto: AutoCondition | undefined
  readonly userDisabled: boolean
  readonly relockable: boolean
}

/** The plugin's validated configuration. */
interface ResolvedConfig {
  readonly groups: Group[]
  readonly catalogPreamble: string
  readonly deferredNotice: boolean
  readonly logProviderWarnings: boolean
}

/** One measured slide: the three numbers every slide reports. */
interface SlideCost {
  readonly entries: number
  readonly bytes: number
  readonly startsSeries: boolean
  readonly headerReason?: string | undefined
  readonly headerChanges: number
}

/** One recorded slide. */
interface Slide {
  readonly id: string
  readonly to: 'open' | 'closed'
  readonly source: string
  readonly cost: SlideCost
}

/** One agent's process-local group state: open flags plus the slides measured so far. */
interface GroupRuntimeState {
  readonly open: Record<string, boolean>
  readonly slides: Slide[]
}

/** The tool-layer facts resolved for one group id. */
interface Installation {
  readonly resolved: string[]
  readonly missing: string[]
  readonly unrestrictable: string[]
}

/** Resolved tool-layer facts, keyed by group id. */
type Installations = Record<string, Installation>

/** One named refusal: a stable code plus the sentence a reader gets. */
interface Refusal {
  readonly code: string
  readonly reason: string
}

/** One catalog row, as the model-facing directory states it. */
interface CatalogRow {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly state: GroupStateName
  readonly open: boolean
  readonly tools: string[]
  readonly openable: boolean
  readonly needsApproval: boolean
  readonly relockable: boolean
  readonly broken: boolean
  readonly reason?: string | undefined
  readonly auto?: string | undefined
  readonly provider?: string | undefined
}

/** The projected catalog: every row plus the count of open groups. */
interface Catalog {
  readonly rows: CatalogRow[]
  readonly openCount: number
}

/** One validated refusal inside a declaration. */
interface DeclarationRefusal {
  readonly id: string
  readonly code: string
  readonly reason: string
}

/** One applied declaration entry. */
interface AppliedDeclaration {
  readonly id: string
  readonly to: 'open' | 'closed'
  readonly effective: string
  readonly cost: SlideCost
}

/** The validated declaration handed from the approval gate to the tool. */
interface ValidatedDeclare {
  readonly ok: boolean
  readonly known: string[]
  readonly open: string[]
  readonly close: string[]
  readonly refused: DeclarationRefusal[]
}

/** One declaration's outcome. */
interface DeclarationResult {
  readonly applied: AppliedDeclaration[]
  readonly refused: DeclarationRefusal[]
  readonly pendingApproval: Array<{ readonly id: string; readonly reason: string }>
  readonly known: string[]
}

/** One folded tool-surface header fact from the session log. */
interface SurfaceHeader {
  readonly reason: string
  readonly startsSeries: boolean
  readonly names: string[]
}

/** What foldSurface() reconstructs from the session log. */
interface FoldedSurface {
  readonly headers: SurfaceHeader[]
  readonly additions: string[]
}

/** The header payload measureCost() reads (the last `request/header` of a session). */
interface HeaderPayload {
  readonly startsSeries?: boolean
  readonly reason?: string
}

/** The minimum a schema needs to contribute a byte count. */
interface CostInputSchema {
  readonly name: string
}

/** One model content block. */
interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** The output declaration both tools in this package share. */
interface StringOutput {
  readonly schema: { readonly type: 'string' }
  render(args: unknown, value: unknown): TextBlock[]
}

/** One row of the seam's `groups()` read. */
interface DefinitionRow {
  readonly id: string
  readonly title: string
  readonly origin: 'config' | 'contributed'
  readonly state: GroupStateName
  readonly members: string[]
  readonly autoWhen?: AutoCondition | undefined
}

/** What one contributed definition may carry (unvalidated). */
interface DefinitionInput {
  readonly id?: unknown
  readonly title?: unknown
  readonly members?: unknown
  readonly autoWhen?: unknown
}

/** The public seam this package provides. */
interface Seam {
  readonly merged: ResolvedConfig
  readonly groups: () => DefinitionRow[]
  readonly registerGroup: (definition: unknown) => () => void
}

// --- kernel surfaces, in the minimum structural form this package reads -------------------------

/** One session event, as far as nextHeader()/headerChanges() read it. */
interface SessionEventLike {
  readonly type: string
  readonly data?: unknown
}

/** One agent's session, as far as this package reads it. */
interface SessionLike {
  readonly seq: number
  eventAt(seq: number): SessionEventLike | undefined
}

/** One live agent, in the form installAgent()/requestAutoOpen() read it. */
interface AgentLike {
  readonly id?: unknown
  readonly ctx: CordisContext
  readonly session?: SessionLike
}

/** The agents service, as far as `ctx.get('agents')` is read. */
interface AgentsService {
  list(): AgentLike[]
}

/** The kernel's tools/pre-execute event, as this package's approval gate reads it. */
interface ToolPreExecuteEvent {
  readonly name: string
  readonly agent?: AgentLike
  readonly arguments: unknown
  readonly callId: unknown
}

/**
 * The plugin context this module uses: the real Cordis context (with the kernel services the tool
 * registry declaration merges in), except `on`, which is loosened to a named event string because
 * the agent lifecycle events it listens for are declared by a kernel package this plugin does not import.
 */
interface GroupsContext extends Omit<CordisContext, 'on'> {
  on(event: string, listener: (...args: never[]) => unknown): unknown
}

/** One live installation: the per-agent registry this package owns. */
interface InstallationRecord {
  readonly scopeKey: object
  readonly scope: CordisContext
  readonly resolveState: GroupRuntimeState
  readonly installations: Installations
  readonly restrictions: Map<string, () => void>
  readonly disposers: Array<() => void>
  ready: boolean
  /** Narrowing seat for the refusal union: never set on a live record. */
  readonly code?: undefined
  readonly reason?: undefined
  sync(id: string): void
  cost(): SlideCost
  admit(group: Group): void
  retract(id: string): void
  dispose(): void
  effectDispose?: unknown
}

/** installAgent()'s outcome: the live record, or the named reason it could not be installed. */
type InstallationOutcome = InstallationRecord | Refusal

/** One context→registry entry used by the automatic-open path. */
interface AutoOpenRecord {
  readonly config: ResolvedConfig
  readonly installed: Map<AgentLike, InstallationRecord>
}

/** requestAutoOpen()'s answer. */
type AutoOpenResult =
  | { applied: true; id: string; to: 'open'; effective: string; cost: SlideCost }
  | { applied: false; code: string; reason: string }

/** Loader identity. */
export const name = 'dsh-link-groups'

/** The tool registry and the system prompt it assembles schemas for. */
export const inject = ['tools', 'systemPrompt']

/** The catalog tool: read the directory, change nothing. */
export const CATALOG_TOOL = 'tool_groups'

/** The declaration tool: open and close several groups in one call. */
export const DECLARE_TOOL = 'tool_groups_declare'

/**
 * Named refusals. A refusal never changes any state, and the reading that
 * proves it is that every group's `state`/`open` value is identical before and
 * after the call.
 */
export const REFUSALS = Object.freeze({
  /** The argument object, or one of its list fields, has the wrong type. */
  INPUT: 'GROUPS_INPUT',
  /** A group id is not in the catalog; the known ids travel back with the refusal. */
  UNKNOWN: 'GROUPS_UNKNOWN',
  /** The same id appears in both `open` and `close`. */
  DUP: 'GROUPS_DUP',
  /** A group configured `state: 'off'` was declared open without an approval. */
  OFF: 'GROUPS_OFF',
  /** An `auto.when: 'after'` group whose dependency is not open. */
  DEPENDENCY: 'GROUPS_DEPENDENCY',
  /** A group whose declared tool names reach no layer its agent can call. */
  NO_TOOLS: 'GROUPS_NO_TOOLS',
  /** No agent scope is reachable, so no restriction could be applied. */
  CHANNEL: 'GROUPS_CHANNEL',
  /** The catalog tool takes no arguments. */
  CATALOG: 'GROUPS_CATALOG',
  /** An activation tool would collide with a tool already resolving for that agent. */
  COLLISION: 'GROUPS_COLLISION',
})

/** The only legal effective point: the next step's assembly, never this step's request. */
export const EFFECTIVE = 'next-step'

/**
 * The public service this package provides: `ctx.get('linkGroups')` once the row
 * is applied. A consumer that cannot work without it declares `inject: [SERVICE]`
 * and is withheld until a page provides one; a consumer that can reports its own
 * absence from `ctx.get(SERVICE) === undefined`.
 */
export const SERVICE = 'linkGroups'

/**
 * The seam's named refusals. Unlike {@link REFUSALS}, which a declaration returns
 * as model-facing text, these are THROWN at the caller: a registration that cannot
 * be honoured must not leave half a group installed. A throwing refusal carries the
 * code in its message, so a caller that catches it can name what happened.
 */
export const SEAM_REFUSALS = Object.freeze({
  /** The definition is not `{ id, title, members, autoWhen? }` with usable values. */
  INPUT: 'LINK_GROUPS_INPUT',
  /** The id already belongs to a config group or to another contributed group. */
  DUPLICATE: 'LINK_GROUPS_DUPLICATE_GROUP',
})

/** Legal configured states. */
const STATES: readonly GroupStateName[] = ['on', 'off', 'auto']

/** Legal automatic-open conditions. */
const WHEN: readonly AutoWhen[] = ['declare', 'device', 'after']

/**
 * Resolve loader configuration. Every tunable lives here so a profile patch can
 * change it without editing this plugin (the kernel's no-hardcoded-tunables rule).
 * @param config - the row's `config` object, or undefined.
 * @returns the resolved, validated configuration.
 * @throws {TypeError} when a group entry is structurally unusable.
 */
export function resolveConfig(config: ConfigInput | undefined | null): ResolvedConfig {
  const source: ConfigInput = config === undefined || config === null ? {} : config
  const rawGroups = source.groups === undefined || source.groups === null ? [] : source.groups
  if (!Array.isArray(rawGroups)) throw new TypeError('dsh-link-groups: config.groups must be an array of group entries')
  const groups = rawGroups.map((entry, index) => resolveGroup(entry, index))
  const ids = new Set()
  for (const group of groups) {
    if (ids.has(group.id)) throw new TypeError('dsh-link-groups: duplicate group id "' + group.id + '"')
    ids.add(group.id)
  }
  return {
    groups,
    catalogPreamble: typeof source.catalogPreamble === 'string' && source.catalogPreamble.length > 0
      ? source.catalogPreamble
      : 'Tools are organised in groups. A closed group costs nothing: call ' + CATALOG_TOOL
        + ' to read the directory, then ' + DECLARE_TOOL + ' to open or close several groups in one call.',
    deferredNotice: source.deferredNotice !== false,
    logProviderWarnings: source.logProviderWarnings !== false,
  }
}

/**
 * Validate and normalize one configured group.
 * @param entry - one element of `config.groups`.
 * @param index - its position, used in the error message only.
 * @returns the normalized group, with every optional field defaulted.
 * @throws {TypeError} when the entry cannot describe a group at all.
 */
function resolveGroup(entry: GroupEntryInput, index: number): Group {
  const where = 'config.groups[' + String(index) + ']'
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('dsh-link-groups: ' + where + ' must be an object')
  const id = entry.id
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) {
    throw new TypeError('dsh-link-groups: ' + where + '.id must be a non-empty lower-case identifier (letters, digits, dot, dash, underscore)')
  }
  const tools = entry.tools
  if (!Array.isArray(tools) || tools.length === 0 || tools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" needs a non-empty `tools` array of tool names; the membership is written down because no package manifest carries a tool list')
  }
  const state = entry.state === undefined ? 'off' : entry.state
  if (typeof state !== 'string' || !STATES.includes(state as GroupStateName)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" state must be one of ' + STATES.join('|'))
  }
  return {
    id,
    title: typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : id,
    summary: typeof entry.summary === 'string' ? entry.summary : '',
    tools: [...tools],
    provider: typeof entry.provider === 'string' && entry.provider.length > 0 ? entry.provider : undefined,
    state: state as GroupStateName,
    auto: resolveAuto(entry.auto as AutoInput | undefined, id),
    userDisabled: entry.userDisabled === true,
    relockable: entry.relockable === true,
  }
}

/**
 * Validate one group's automatic-open condition.
 * @param input - the configured `auto` value.
 * @param id - the owning group id, for messages and the self-dependency check.
 * @returns the normalized condition, or undefined when none was configured.
 * @throws {TypeError} when the condition is unusable.
 */
function resolveAuto(input: AutoInput | undefined | null, id: string): AutoCondition | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('dsh-link-groups: group "' + id + '" auto must be an object')
  const when = input.when
  if (typeof when !== 'string' || !WHEN.includes(when as AutoWhen)) {
    throw new TypeError('dsh-link-groups: group "' + id + '" auto.when must be one of ' + WHEN.join('|'))
  }
  const condition = when as AutoWhen
  if (condition !== 'after') return { when: condition }
  if (typeof input.after !== 'string' || input.after.length === 0) {
    throw new TypeError('dsh-link-groups: group "' + id + '" auto.when "after" needs auto.after naming the group it depends on')
  }
  if (input.after === id) throw new TypeError('dsh-link-groups: group "' + id + '" cannot depend on itself')
  return { when: 'after', after: input.after }
}

/**
 * One group's initial `open` value: `on` starts open, everything else closed.
 * @param group - a resolved group.
 * @returns whether the group is open before any declaration.
 */
export function initialOpen(group: Group): boolean {
  return group.state === 'on'
}

/**
 * Project resolved groups into the runtime state: `open` per group id, plus the
 * slides this process has measured.
 * @param config - a resolved configuration.
 * @returns a fresh state record for one agent.
 */
export function initialState(config: ResolvedConfig): GroupRuntimeState {
  const open: Record<string, boolean> = {}
  for (const group of config.groups) open[group.id] = initialOpen(group)
  return { open, slides: [] }
}

/**
 * Whether a declared tool exists on a layer its agent can call. `baseline` is
 * the agent-visible surface captured BEFORE any group restriction was applied,
 * which is the only measurement that can still see a closed group's tools.
 * @param toolName - the declared tool name.
 * @param baseline - names visible to the agent before any group restriction.
 * @param globalNames - names in the registry's global view.
 * @returns whether the tool exists on a layer the agent can reach.
 */
export function toolInstalled(toolName: string, baseline: ReadonlySet<string>, globalNames: ReadonlySet<string>): boolean {
  return baseline.has(toolName) || globalNames.has(toolName)
}

/**
 * Resolve one group's tool-layer facts against a surface snapshot.
 * @param group - a resolved group.
 * @param visible - the names its agent can see in that snapshot.
 * @param restrictable - the names a restriction may filter in that snapshot.
 * @returns the resolved members, the ones that reach no layer, and the ones a
 * restriction cannot name (empty here; the installer fills it when a mask is refused).
 */
function installationFor(group: Group, visible: ReadonlySet<string>, restrictable: ReadonlySet<string>): Installation {
  const resolvedTools: string[] = []
  const missing: string[] = []
  for (const toolName of group.tools) {
    if (toolInstalled(toolName, visible, restrictable)) resolvedTools.push(toolName)
    else missing.push(toolName)
  }
  return { resolved: resolvedTools, missing, unrestrictable: [] }
}

/**
 * Why one group cannot be opened right now, in a fixed precedence: a broken
 * group first (a typo must not pretend it could work), then an unopened
 * dependency. A user-disabled group is NOT blocked here — it is openable, but
 * only through the approval gate ({@link approvalNeeded}).
 * @param group - a resolved group.
 * @param state - one agent's group state.
 * @param installation - that agent's resolved tool-layer facts for this group.
 * @param known - the catalog's id set.
 * @returns the refusal code and its one-line reason, or undefined when openable.
 */
export function blockedReason(group: Group, state: GroupRuntimeState, installation: Installation, known: ReadonlySet<string>): Refusal | undefined {
  if (installation.unrestrictable.length > 0) {
    return {
      code: REFUSALS.NO_TOOLS,
      reason: 'registered on the agent own layer, which a restriction cannot filter: ' + installation.unrestrictable.join(', '),
    }
  }
  if (installation.missing.length > 0) {
    return {
      code: REFUSALS.NO_TOOLS,
      reason: 'declared tool' + (installation.missing.length > 1 ? 's' : '') + ' registered on no layer this agent can call: ' + installation.missing.join(', '),
    }
  }
  const auto = group.auto
  if (auto !== undefined && auto.when === 'after') {
    const dependency = auto.after
    if (!known.has(dependency)) return { code: REFUSALS.DEPENDENCY, reason: 'the group it depends on is not in the catalog: ' + dependency }
    if (state.open[dependency] !== true) return { code: REFUSALS.DEPENDENCY, reason: 'depends on group "' + dependency + '", which is not open' }
  }
  return undefined
}

/**
 * The groups a declaration may open only after the approval seam allows it.
 * @param ids - the ids the caller asked to open.
 * @param config - a resolved configuration.
 * @returns the ids the user explicitly disabled, in configuration order.
 */
/**
 * Whether opening one group must pass the approval seam first: the user turned it
 * off (`state: 'off'`) or disabled it outright (`userDisabled`). Both are the same
 * decision written two ways, and neither is ever opened silently.
 * @param group - a resolved group.
 * @returns whether opening it needs an approval.
 */
export function needsApproval(group: Group): boolean {
  return group.userDisabled || group.state === 'off'
}

/**
 * The groups in one open list that must pass the approval seam first.
 * @param ids - the ids the caller asked to open.
 * @param config - a resolved configuration.
 * @returns the gated ids, in configuration order.
 */
export function approvalNeeded(ids: readonly string[], config: ResolvedConfig): string[] {
  const wanted = new Set<string>(ids)
  return config.groups.filter(group => wanted.has(group.id) && needsApproval(group)).map(group => group.id)
}

/**
 * Build the model-facing directory: one row per group. Only names and one-line
 * reasons travel — never a tool's parameter schema, so a closed group costs no
 * schema budget.
 * @param config - a resolved configuration.
 * @param state - one agent's group state.
 * @param installations - resolved tool-layer facts per group id.
 * @returns rows in configuration order, plus the count of open groups.
 */
export function projectCatalog(config: ResolvedConfig, state: GroupRuntimeState, installations: Installations): Catalog {
  const known = new Set<string>(config.groups.map(group => group.id))
  const rows = config.groups.map(group => {
    // installAgent() fills one entry per configured id before any catalog read.
    const installation = installations[group.id]!
    const blocked = blockedReason(group, state, installation, known)
    const open = state.open[group.id] === true
    return {
      id: group.id,
      title: group.title,
      summary: group.summary,
      state: group.state,
      open,
      tools: [...installation.resolved],
      openable: blocked === undefined && open !== true,
      needsApproval: needsApproval(group),
      relockable: group.relockable,
      broken: installation.unrestrictable.length > 0 || installation.missing.length > 0,
      ...blocked === undefined ? {} : { reason: blocked.code + ': ' + blocked.reason },
      ...group.auto === undefined ? {} : autoLabel(group.auto),
      ...group.provider === undefined ? {} : { provider: group.provider },
    }
  })
  return { rows, openCount: rows.filter(row => row.open).length }
}

/**
 * One group's automatic-open condition, as the directory states it.
 * @param auto - the resolved condition.
 * @returns the label to merge into a catalog row.
 */
function autoLabel(auto: AutoCondition): { auto: string } {
  return auto.when === 'after' ? { auto: 'after ' + String(auto.after) } : { auto: auto.when }
}

/**
 * Fold a session log into the group facts that ARE reconstructable from it.
 * This is deliberately not the group state: state is process-local (see the
 * module note), while what the log does carry about the tool surface is the
 * header history plus the tool-registry additions.
 * @param events - session events, each `{ type, data }`.
 * @returns the folded tool-surface facts.
 */
export function foldSurface(events: readonly unknown[]): FoldedSurface {
  const headers: SurfaceHeader[] = []
  const additions: string[] = []
  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue
    const event = raw as { readonly type?: unknown; readonly data?: unknown }
    if (event.type === 'request/header') {
      const data = event.data === null || typeof event.data !== 'object' ? {} : event.data as { readonly header?: unknown; readonly reason?: unknown; readonly startsSeries?: unknown }
      const header = data.header === null || typeof data.header !== 'object' ? {} : data.header as { readonly tools?: unknown }
      const tools = Array.isArray(header.tools) ? header.tools : []
      headers.push({
        reason: String(data.reason === undefined ? '' : data.reason),
        startsSeries: data.startsSeries === true,
        names: tools.map((tool: unknown) => String(tool === null || typeof tool !== 'object' ? '' : (tool as { readonly name?: unknown }).name)),
      })
    } else if (event.type === 'developer/message') {
      const data = event.data === null || typeof event.data !== 'object' ? {} : event.data as { readonly message?: unknown }
      const message = data.message === null || typeof data.message !== 'object' ? {} : data.message as { readonly content?: unknown }
      const content = Array.isArray(message.content) ? message.content : []
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        const addition = block as { readonly type?: unknown; readonly toolName?: unknown }
        if (addition.type === 'tool-addition') additions.push(String(addition.toolName))
      }
    }
  }
  return { headers, additions }
}

/**
 * The three numbers every slide reports. `entries` counts the tools the agent
 * can see after the slide, `bytes` is the UTF-8 size of exactly those schemas
 * as the kernel would serialize them, and `startsSeries` is read from the next
 * `request/header` the agent logs.
 * @param schemas - the agent's visible tool schemas after the slide.
 * @param header - the next logged `request/header` payload, when one exists.
 * @param changeCount - how many `request/header` events carried `reason: 'change'`.
 * @returns the measured cost of one slide.
 */
export function measureCost(schemas: readonly CostInputSchema[], header: HeaderPayload | undefined, changeCount: number): SlideCost {
  return {
    entries: schemas.length,
    bytes: Buffer.byteLength(JSON.stringify(schemas), 'utf8'),
    startsSeries: header !== undefined && header.startsSeries === true,
    ...header === undefined ? {} : { headerReason: header.reason },
    headerChanges: changeCount,
  }
}

/** One text content block. */
function textContent(text: string): TextBlock[] {
  return [{ type: 'text', text }]
}

/** A tool result whose only model-visible payload is the rendered text. */
function textOutput(): StringOutput {
  return {
    schema: { type: 'string' },
    render: (_args: unknown, value: unknown) => textContent(typeof value === 'string' ? value : JSON.stringify(value)),
  }
}

/**
 * One row of the directory, rendered as a single auditable line.
 * @param row - a catalog row.
 * @returns the line.
 */
function renderRow(row: CatalogRow): string {
  const parts = ['- ' + row.id]
  parts.push(row.open ? 'OPEN' : 'closed')
  parts.push('state=' + row.state)
  if (row.auto !== undefined) parts.push('auto=' + row.auto)
  parts.push('tools(' + String(row.tools.length) + '): ' + (row.tools.length === 0 ? '(none)' : row.tools.join(', ')))
  if (row.provider !== undefined) parts.push('provider=' + row.provider)
  if (row.needsApproval) parts.push('USER-DISABLED: opening needs approval')
  if (row.relockable) parts.push('relockable')
  if (row.reason !== undefined) parts.push('blocked: ' + row.reason)
  else if (!row.open) parts.push('openable now')
  if (row.summary.length > 0) parts.push(row.summary)
  return parts.join(' \u00b7 ')
}

/**
 * Render the whole directory as text.
 * @param config - a resolved configuration.
 * @param catalog - the projected catalog.
 * @returns the model-facing directory text.
 */
export function renderCatalog(config: ResolvedConfig, catalog: Catalog): string {
  const lines: string[] = [config.catalogPreamble, '']
  lines.push('Groups (' + String(catalog.rows.length) + ' total, ' + String(catalog.openCount) + ' open):')
  for (const row of catalog.rows) lines.push(renderRow(row))
  const openable = catalog.rows.filter(row => row.openable === true)
  if (openable.length > 0) {
    lines.push('')
    lines.push('Openable in one call: ' + openable.map(row => row.id).join(', '))
    lines.push('Call ' + DECLARE_TOOL + ' with open: [...] — one call opens every group you name, and the change lands on your next step, never on this one.')
  }
  if (config.deferredNotice) {
    lines.push('')
    lines.push('The directory describes THIS session surface. Group state is process-local: after a restart or resume the groups fall back to their configured state and must be declared again.')
  }
  return lines.join('\n')
}

/**
 * Render one declaration's outcome.
 * @param result - the declaration result.
 * @returns the model-facing text.
 */
export function renderDeclaration(result: DeclarationResult): string {
  const lines: string[] = []
  for (const entry of result.applied) {
    const cost = entry.cost
    const direction = entry.to === 'open' ? 'opened' : 'closed'
    lines.push('- ' + direction + ' ' + entry.id + ' (effective: ' + entry.effective + ') \u00b7 surface now '
      + String(cost.entries) + ' tools / ' + String(cost.bytes) + ' bytes \u00b7 next request/header.startsSeries=' + String(cost.startsSeries))
  }
  for (const entry of result.pendingApproval) lines.push('- not applied ' + entry.id + ': ' + entry.reason)
  for (const entry of result.refused) lines.push('- refused ' + entry.id + ' [' + entry.code + '] ' + entry.reason)
  if (lines.length === 0) lines.push('- nothing changed')
  if (result.known.length > 0) lines.push('Known group ids (configuration order): ' + result.known.join(', '))
  return lines.join('\n')
}

/**
 * Run one disposer, containing the teardown races a scope can present. An agent
 * ctx being unwound may already have disposed its own registry.
 * @param dispose - the exact disposer a registry returned.
 */
function callDisposer(dispose: () => void): void {
  try {
    dispose()
  } catch (_error) {
    // The owning registry is already gone; there is nothing left to remove.
  }
}

/**
 * Enumerate every id a declaration names, in first-seen order.
 * @param open - the `open` list, already validated as string[].
 * @param close - the `close` list, already validated as string[].
 * @returns the distinct ids in the order they were first named.
 */
function namedIds(open: readonly string[], close: readonly string[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of [...open, ...close]) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Validate a declaration without touching anything. The approval gate calls it
 * before it decides to ask, and the tool calls it again before it applies, so
 * the two stages cannot disagree about what was asked for.
 * @param args - the raw tool arguments.
 * @param config - a resolved configuration.
 * @param state - one agent's group state.
 * @param installations - resolved tool-layer facts per group id.
 * @returns the normalized request plus every refusal it would produce.
 */
export function validateDeclare(args: unknown, config: ResolvedConfig, state: GroupRuntimeState, installations: Installations): ValidatedDeclare {
  const knownList = config.groups.map(group => group.id)
  const known = new Set<string>(knownList)
  const refuse = (id: string, code: string, reason: string): DeclarationRefusal => ({ id, code, reason })
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse('', REFUSALS.INPUT, 'arguments must be an object with optional open/close string arrays')] }
  }
  const source = args as { readonly open?: unknown; readonly close?: unknown }
  const rawOpen = source.open === undefined || source.open === null ? [] : source.open
  const rawClose = source.close === undefined || source.close === null ? [] : source.close
  if (!Array.isArray(rawOpen) || rawOpen.some(id => typeof id !== 'string') || !Array.isArray(rawClose) || rawClose.some(id => typeof id !== 'string')) {  // reached only when a caller drives this function directly; the tool schema rejects a non-array first
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse('', REFUSALS.INPUT, 'open and close must be arrays of group id strings')] }
  }
  const named = namedIds(rawOpen, rawClose)
  if (named.length === 0) {
    return { ok: false, known: knownList, open: [], close: [], refused: [refuse('', REFUSALS.INPUT, 'nothing to do: name at least one group in open or close')] }
  }
  const refused: DeclarationRefusal[] = []
  const wanted = new Set<string>()
  const wantedClose = new Set<string>()
  for (const id of named) {
    if (!known.has(id)) { refused.push(refuse(id, REFUSALS.UNKNOWN, 'unknown group id; known ids: ' + (knownList.join(', ') || '(none)'))); continue }
    const inOpen = rawOpen.includes(id)
    const inClose = rawClose.includes(id)
    if (inOpen && inClose) { refused.push(refuse(id, REFUSALS.DUP, 'named in both open and close')); continue }
    const group = config.groups.find(candidate => candidate.id === id)!
    if (inOpen) {
      if (state.open[id] === true) { refused.push(refuse(id, REFUSALS.INPUT, 'already open')); continue }
      const blocked = blockedReason(group, state, installations[id]!, known)
      if (blocked !== undefined) { refused.push(refuse(id, blocked.code, blocked.reason)); continue }
      wanted.add(id)
      continue
    }
    if (state.open[id] !== true) { refused.push(refuse(id, REFUSALS.INPUT, 'already closed')); continue }
    if (group.relockable !== true) {
      refused.push(refuse(id, REFUSALS.INPUT, 'not relockable: it stays open for the rest of the session so published tool names keep their positions'))
      continue
    }
    wantedClose.add(id)
  }
  return { ok: true, known: knownList, open: [...wanted], close: [...wantedClose], refused }
}

/**
 * Validate and normalize one contributed definition. The seam takes the same
 * facts a config row entry may carry, under the names a third-party author
 * writes: `members` is the membership and `autoWhen` the automatic-open
 * condition. A contributed group is always `state: 'auto'` — it is closed until
 * the model declares it, which is the whole point of gating it — and it is never
 * `userDisabled` and never `relockable`, because a third-party plugin has no
 * user decision to freeze and no reason to publish a name it may take back.
 * @param definition - the `{ id, title, members, autoWhen? }` object.
 * @returns the normalized group, in the shape the rest of this module reads.
 * @throws {TypeError} when the definition cannot describe a group at all.
 */
export function resolveDefinition(definition: unknown): Group {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': registerGroup(definition) needs an object { id, title, members, autoWhen? }')
  }
  const source = definition as DefinitionInput
  const id = source.id
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': registerGroup(definition).id must be a non-empty lower-case identifier (letters, digits, dot, dash, underscore), the same rule config.groups follows')
  }
  const members = source.members
  if (!Array.isArray(members) || members.length === 0 || members.some(member => typeof member !== 'string' || member.length === 0)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" needs a non-empty `members` array of tool names; the membership is written down because no package manifest carries a tool list')
  }
  return {
    id,
    title: typeof source.title === 'string' && source.title.length > 0 ? source.title : id,
    summary: '',
    tools: [...members],
    provider: undefined,
    state: 'auto',
    auto: resolveDefinitionAuto(source.autoWhen, id),
    userDisabled: false,
    relockable: false,
  }
}

/**
 * Validate one contributed group's automatic-open condition. Omitted means
 * `{ when: 'declare' }`, the condition every shipped config group uses; a
 * plugin that opens on a condition it observes itself passes `{ when: 'device' }`
 * and calls {@link requestAutoOpen}.
 * @param input - the definition's `autoWhen`, either the bare condition name or `{ when, after }`.
 * @param id - the owning group id, for messages and the self-dependency check.
 * @returns the normalized condition.
 * @throws {TypeError} when the condition is unusable.
 */
function resolveDefinitionAuto(input: unknown, id: string): AutoCondition {
  if (input === undefined || input === null) return { when: 'declare' }
  const value = typeof input === 'string' ? { when: input as AutoWhen } : input
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen must be one of ' + WHEN.join('|') + ' or an object { when, after }')
  }
  const source = value as AutoInput
  const when = source.when
  if (typeof when !== 'string' || !WHEN.includes(when as AutoWhen)) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen must be one of ' + WHEN.join('|'))
  }
  const condition = when as AutoWhen
  if (condition !== 'after') return { when: condition }
  if (typeof source.after !== 'string' || source.after.length === 0) {
    throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" autoWhen "after" needs autoWhen.after naming the group it depends on')
  }
  if (source.after === id) throw new TypeError(SEAM_REFUSALS.INPUT + ': group "' + id + '" cannot depend on itself')
  return { when: 'after', after: source.after }
}

/**
 * One row of the seam's `groups()` read: a definition with its origin named.
 * Config rows come first, in configuration order; contributed rows follow, in
 * registration order. The row speaks the seam's field names, so a config row's
 * `tools` reads as `members` and its `auto` as `autoWhen` — one shape for a
 * reader, whichever way the group was declared.
 * @param group - a normalized group.
 * @param origin - `'config'` or `'contributed'`.
 * @returns the row.
 */
export function definitionRow(group: Group, origin: 'config' | 'contributed'): DefinitionRow {
  return {
    id: group.id,
    title: group.title,
    origin,
    state: group.state,
    members: [...group.tools],
    autoWhen: group.auto === undefined ? undefined : { ...group.auto },
  }
}

/**
 * Merge the config groups with the contributed ones, and keep every installed
 * agent in step as they arrive and leave. The merge is one live array the install
 * path and the pre-execute gate both read, so a contribution reaches the tool
 * face through the SAME `ctx.tools.restrict` path a config group uses — no second
 * mechanism, and no polling: an admission happens in the registering call.
 * @param resolved - the resolved configuration.
 * @param installed - the live installations keyed by agent, owned by the caller.
 * @returns the merged view, the service's `groups()` read, and its `registerGroup`.
 */
export function createSeam(resolved: ResolvedConfig, installed: Map<AgentLike, InstallationRecord>): Seam {
  const contributed = new Map<string, Group>()
  const merged: ResolvedConfig = { ...resolved, groups: [...resolved.groups] }
  const groups = (): DefinitionRow[] => [
    ...resolved.groups.map(group => definitionRow(group, 'config')),
    ...[...contributed.values()].map(group => definitionRow(group, 'contributed')),
  ]
  const registerGroup = (definition: unknown): (() => void) => {
    const group = resolveDefinition(definition)
    const home = resolved.groups.some(candidate => candidate.id === group.id)
      ? 'config'
      : contributed.has(group.id) ? 'contributed' : undefined
    if (home !== undefined) {
      throw new Error(SEAM_REFUSALS.DUPLICATE + ': group id "' + group.id + '" already belongs to a ' + home
        + ' group; ids are unique across the config row and every contributed group, and a silent merge is refused rather than performed')
    }
    contributed.set(group.id, group)
    merged.groups.push(group)
    const admitted: InstallationRecord[] = []
    try {
      for (const record of installed.values()) {
        record.admit(group)
        admitted.push(record)
      }
    } catch (error) {
      for (const record of admitted) record.retract(group.id)
      merged.groups.splice(merged.groups.indexOf(group), 1)
      contributed.delete(group.id)
      throw error
    }
    let live = true
    return () => {
      if (!live) return
      live = false
      contributed.delete(group.id)
      const at = merged.groups.indexOf(group)
      if (at !== -1) merged.groups.splice(at, 1)
      for (const record of installed.values()) record.retract(group.id)
    }
  }
  return { merged, groups, registerGroup }
}

/**
 * Install the two activation tools and every group restriction into one agent
 * scope. The returned record carries the exact disposers plus the resolved
 * tool-layer facts the catalog reports.
 * @param ctx - the plugin's own context (services and events).
 * @param agent - the agent whose scope this installation belongs to.
 * @param resolved - the resolved configuration.
 * @returns the installation record, or a `{ code, reason }` refusal.
 */
function installAgent(ctx: GroupsContext, agent: AgentLike, resolved: ResolvedConfig): InstallationOutcome {
  const scope = agent.ctx
  const scopeKey = scopeOf(scope)
  if (scopeKey === undefined) {
    return { code: REFUSALS.CHANNEL, reason: 'tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent' }
  }
  const activate = scope.tools
  if (activate === undefined || typeof activate.register !== 'function') {
    return { code: REFUSALS.CHANNEL, reason: 'the agent scope resolves no tool registry, so no activation tool could be registered on it' }
  }
  const globalNames = new Set(ctx.tools.schemas().map(tool => tool.name))
  const baseline = new Set([...globalNames, ...activate.schemas(scopeKey).map(tool => tool.name)])
  const state = initialState(resolved)
  const restrictions = new Map<string, () => void>()
  const installations: Installations = {}
  for (const group of resolved.groups) installations[group.id] = installationFor(group, baseline, globalNames)
  // The record is filled in two phases: its literal fields here, then the verbs every consumer
  // reads (sync/cost/admit/retract/dispose) attached below, once they exist. The assertion is the
  // type-level record of that construction order; it emits nothing.
  const disposers: Array<() => void> = []
  const record = { scopeKey, scope, resolveState: state, installations, restrictions, disposers, ready: false } as InstallationRecord
  const disposed = { value: false }
  const lift = (id: string): void => {
    const dispose = restrictions.get(id)
    if (dispose === undefined) return
    restrictions.delete(id)
    callDisposer(dispose)
  }
  const mask = (id: string): void => {
    if (restrictions.has(id)) return
    // installAgent() fills one entry per configured id before any mask can run.
    const wanted = installations[id]!.resolved
    if (wanted.length === 0) return
    try {
      restrictions.set(id, activate.restrict({ deny: wanted }))
    } catch (error) {
      // A name that moved between the surface read and this call, or a registry
      // already unwinding: the honest reading is "not closed", never a silent
      // half-mask. The message is the kernel's own, not a paraphrase.
      restrictions.delete(id)
      if (disposed.value) return
      throw error
    }
  }
  const sync = (id: string): void => {
    if (state.open[id] === true) lift(id)
    else mask(id)
  }
  const visible = (): CostInputSchema[] => activate.schemas(scopeKey)
  // The LAST request/header the session has logged. It is the header the next
  // model request will reuse, so it is the honest answer after a slide; reading
  // it must not consume it, because several cost readings may follow one slide.
  const nextHeader = (): HeaderPayload | undefined => {
    const session = agent.session
    if (session === undefined || typeof session.eventAt !== 'function') return undefined
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      const event = session.eventAt(seq)
      if (event !== undefined && event.type === 'request/header') return event.data as HeaderPayload
    }
    return undefined
  }
  const headerChanges = (): number => {
    const session = agent.session
    if (session === undefined || typeof session.eventAt !== 'function') return 0
    let count = 0
    for (let seq = 0; seq < session.seq; seq += 1) {
      const event = session.eventAt(seq)
      if (event === undefined || event.type !== 'request/header') continue
      const data = event.data === null || typeof event.data !== 'object' ? {} : event.data as { readonly reason?: unknown }
      if (data.reason === 'change') count += 1
    }
    return count
  }
  const cost = (): SlideCost => measureCost(visible(), nextHeader(), headerChanges())
  const declare = async (args: unknown, approved: boolean): Promise<DeclarationResult> => {
    const validation = validateDeclare(args, resolved, state, installations)
    const result: DeclarationResult = { applied: [], refused: [...validation.refused], pendingApproval: [], known: validation.known }
    if (!validation.ok) return result
    const gated = approvalNeeded(validation.open, resolved)
    const plain = validation.open.filter(id => !gated.includes(id))
    const openable = approved === true ? [...plain, ...gated] : plain
    if (approved !== true) {
      for (const id of gated) {
        result.pendingApproval.push({ id, reason: 'the user turned this group off, so it opens only after an approval; nothing changed' })
      }
    }
    for (const id of openable) {
      state.open[id] = true
      sync(id)
    }
    if (openable.length > 0) {
      const slide = cost()
      for (const id of openable) {
        state.slides.push({ id, to: 'open', source: 'declare', cost: slide })
        result.applied.push({ id, to: 'open', effective: EFFECTIVE, cost: slide })
      }
    }
    for (const id of validation.close) {
      state.open[id] = false
      sync(id)
      const slide = cost()
      state.slides.push({ id, to: 'closed', source: 'declare', cost: slide })
      result.applied.push({ id, to: 'closed', effective: EFFECTIVE, cost: slide })
    }
    return result
  }
  const catalogTool = defineTool({
    name: CATALOG_TOOL,
    description: 'List the tool groups of this session: each group id, whether it is open, its configured state, the tool names it would add, and — when it cannot be opened — the reason. Use it before declaring a group you have not seen and whenever you are unsure which of your tools are present. It takes no arguments and changes nothing.',
    parameters: {},
    output: textOutput(),
    // The registry awaits execute(), so an async body is runtime-equivalent to the sync one this
    // replaces (see docs/handoff/R498-strict-migration.md, artifact note).
    execute: async (args) => {
      if (args !== undefined && args !== null && typeof args === 'object' && Object.keys(args).length > 0) {
        throw new Error(REFUSALS.CATALOG + ': ' + CATALOG_TOOL + ' takes no arguments; it only reports the directory')
      }
      return renderCatalog(resolved, projectCatalog(resolved, state, installations))
    },
  })
  const declareTool = defineTool({
    name: DECLARE_TOOL,
    description: 'Open or close one or more tool groups in a single call. Opening a group makes its tools available from your NEXT step onward — never in the step that declares them — so name everything you need in one call instead of one group at a time. A group the user explicitly disabled asks for approval first. Pass open: [ids] to open, close: [ids] to re-close a relockable group, and why: a short reason. Returns what was applied, what was refused and why, and the measured cost of the change.',
    parameters: {
      open: { type: 'array', items: { type: 'string' }, description: 'Group ids to open.' },
      close: { type: 'array', items: { type: 'string' }, description: 'Group ids to close again; a group configured relockable false refuses.' },
      why: { type: 'string', description: 'Optional one-line reason, recorded for the reader and passed to an approval prompt.' },
    },
    output: textOutput(),
    execute: async (args, exec) => {
      const approved = takeApproval(exec.agent, String(exec.callId))
      return renderDeclaration(await declare(args === undefined ? {} : args, approved))
    },
  })
  for (const tool of [catalogTool, declareTool]) {
    if (activate.get(tool.name, scopeKey) !== undefined) {
      return { code: REFUSALS.COLLISION, reason: 'tool "' + tool.name + '" already resolves for this agent, so the activation tool could not be registered on its own layer' }
    }
  }
  for (const group of resolved.groups) {
    if (state.open[group.id] === true) lift(group.id)
    else mask(group.id)
  }
  record.disposers.push(activate.register(catalogTool))
  record.disposers.push(activate.register(declareTool))
  record.sync = sync
  record.cost = cost
  // The seam's two verbs on one live installation. `admit` reads the surface
  // FRESH, because a contributed group may be registered after its own tools —
  // the install-time snapshot would call those members missing. `retract` lifts
  // the mask through the same map every other lift goes through and forgets the
  // state, so a disposed group leaves the face exactly as it was.
  record.admit = (group: Group): void => {
    const restrictable = new Set<string>(ctx.tools.schemas().map(tool => tool.name))
    const visibleNow = new Set<string>([...restrictable, ...activate.schemas(scopeKey).map(tool => tool.name)])
    installations[group.id] = installationFor(group, visibleNow, restrictable)
    state.open[group.id] = initialOpen(group)
    try {
      sync(group.id)
    } catch (_error) {
      // A member this scope cannot name in a restriction (one registered on the
      // agent's own layer): the group stays registered and reads `broken` with the
      // named reason a declaration already reports, instead of a half-applied mask.
      // `mask` removed its own restriction before rethrowing.
      installations[group.id] = { resolved: [], missing: [], unrestrictable: [...installations[group.id]!.resolved] }
    }
  }
  record.retract = (id: string): void => {
    lift(id)
    delete state.open[id]
    delete installations[id]
  }
  record.dispose = (): void => {
    if (disposed.value) return
    disposed.value = true
    for (const id of [...restrictions.keys()]) lift(id)
    for (const dispose of record.disposers.reverse()) callDisposer(dispose)
    record.disposers.length = 0
    // @ts-expect-error R498: `install` is undefined here — a pre-existing latent ReferenceError on
    // the dispose path, kept byte-identical this round (types-only migration); flagged in the R498 record.
    install.ready = false
  }
  record.ready = true
  return record
}

/**
 * Mount the two activation tools and the group masks on one agent's scope.
 * Exported so this package's self-check drives the exact path the loader drives.
 * @param ctx - the plugin's own context.
 * @param agent - the agent to install into.
 * @param config - a resolved configuration (see {@link resolveConfig}).
 * @returns the installation record, or a `{ code, reason }` refusal.
 */
export function mountAgent(ctx: GroupsContext, agent: AgentLike, config: ResolvedConfig): InstallationOutcome {
  return installAgent(ctx, agent, config)
}

/** The per-context registry {@link requestAutoOpen} resolves through. */
const autoOpenRecords = new WeakMap<object, AutoOpenRecord>()

/**
 * Installations by agent. The automatic-open path is reached with whatever
 * context the calling plugin holds, which need not be the exact context this
 * plugin was applied on, so the agent itself is the reliable key.
 */
const recordsByAgent = new WeakMap<AgentLike, AutoOpenRecord>()

/**
 * Conditions observed before an agent's installation existed, replayed as soon
 * as it appears. Without this an early observation would be silently dropped.
 */
const pendingOpens = new WeakMap<AgentLike, Array<{ id: string; why: string | undefined }>>()

/**
 * Resolve the plugin's registry from any context inside its own fiber tree. A
 * group's own plugin holds the context it was loaded with, which is a child of
 * the one `apply` ran on, so the walk is what makes the automatic-open path
 * reachable from an agent-scoped context.
 * @param ctx - the context the caller holds.
 * @returns the registry, or undefined when this plugin is not applied on its chain.
 */
function autoOpenRecordFor(ctx: object, agent: AgentLike | undefined): AutoOpenRecord | undefined {
  if (agent !== undefined) {
    const byAgent = recordsByAgent.get(agent)
    if (byAgent !== undefined) return byAgent
  }
  let cursor: object | undefined = ctx
  const seen = new Set<object>()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const record = autoOpenRecords.get(cursor)
    if (record !== undefined) return record
    cursor = (cursor as CordisContext).fiber.parent
  }
  return undefined
}

/**
 * Open one group from a condition its own plugin observed, without a model call.
 * This is the same open path the declaration tool uses; only the decider
 * differs. A group the user disabled is refused instead of asked about, because
 * nothing on this path can prompt the user.
 * @param ctx - the plugin's own context.
 * @param agent - the agent whose group should open.
 * @param id - the group id.
 * @param why - one line about the condition that was observed.
 * @returns the outcome: applied with its cost, or a named refusal.
 */
export function requestAutoOpen(ctx: GroupsContext, agent: AgentLike, id: string, why: string | undefined): AutoOpenResult {
  const record = autoOpenRecordFor(ctx, agent)
  if (record === undefined) return { applied: false, code: REFUSALS.CHANNEL, reason: 'this plugin is not applied on that context, so no group state exists' }
  const install = record.installed.get(agent)
  if (install === undefined) {
    const queued = pendingOpens.get(agent) ?? []
    queued.push({ id, why })
    pendingOpens.set(agent, queued)
    return { applied: false, code: REFUSALS.CHANNEL, reason: 'that agent has no group installation yet; the condition was queued and replays when it appears' }
  }
  const group = record.config.groups.find(candidate => candidate.id === id)
  if (group === undefined) {
    return { applied: false, code: REFUSALS.UNKNOWN, reason: 'unknown group id; known ids: ' + record.config.groups.map(candidate => candidate.id).join(', ') }
  }
  const state = install.resolveState
  if (state.open[id] === true) return { applied: false, code: REFUSALS.INPUT, reason: 'already open' }
  if (group.userDisabled) return { applied: false, code: REFUSALS.OFF, reason: 'the user turned this group off; only an explicit declaration with approval may open it' }
  const known = new Set<string>(record.config.groups.map(candidate => candidate.id))
  const blocked = blockedReason(group, state, install.installations[id]!, known)
  if (blocked !== undefined) return { applied: false, code: blocked.code, reason: blocked.reason }
  state.open[id] = true
  install.sync(id)
  const slide = install.cost()
  state.slides.push({ id, to: 'open', source: why === undefined ? 'auto' : String(why), cost: slide })
  return { applied: true, id, to: 'open', effective: EFFECTIVE, cost: slide }
}

/**
 * Approval grants keyed by agent, then by tool-call id. The `tools/pre-execute`
 * gate adds a call id and the tool consumes it, so a grant can never leak from
 * one call into another set of groups.
 */
const approvals = new WeakMap<AgentLike, Set<string>>()

/**
 * Read and consume the approval grant for one call.
 * @param agent - the calling agent.
 * @param callId - the exact tool call id.
 * @returns whether the approval seam already allowed this exact call.
 */
function takeApproval(agent: AgentLike | undefined, callId: string): boolean {
  // `WeakMap.get` answers undefined for a non-object key exactly as it did before the type was
  // written down; the assertion is compile-time only.
  const granted = approvals.get(agent as AgentLike)
  if (granted === undefined || !granted.has(callId)) return false
  granted.delete(callId)
  if (granted.size === 0) approvals.delete(agent as AgentLike)
  return true
}

/**
 * Whether installAgent() answered a refusal rather than a live record. A type guard keeps the
 * record's verbs typed on the success path; it reads the same `code` field the branch always read.
 * @param outcome - installAgent()'s answer.
 * @returns true for the `{ code, reason }` refusal.
 */
function isRefusal(outcome: InstallationOutcome): outcome is Refusal {
  return outcome.code !== undefined
}

/**
 * The plugin entry point: install the group kernel on every live and later
 * agent, and gate a declaration that opens a user-disabled group behind the
 * approval seam.
 * @param ctx - the plugin's context.
 * @param rawConfig - the row's `config`.
 */
export function apply(ctx: GroupsContext, rawConfig: ConfigInput = {}): void {
  const resolved = resolveConfig(rawConfig)
  const installed = new Map<AgentLike, InstallationRecord>()
  const seam = createSeam(resolved, installed)
  const merged = seam.merged
  if (resolved.logProviderWarnings) {
    for (const group of resolved.groups) {
      if (group.provider === undefined) continue
      if (group.tools.some(toolName => toolName.startsWith(String(group.provider)))) continue
      ctx.logger?.warn?.('dsh-link-groups: group "' + group.id + '" declares provider "' + group.provider
        + '" but none of its tools start with it (' + group.tools.join(', ') + '); `provider` is a cross-check only and `tools` stays authoritative')
    }
  }
  // One line at activation, so this package is graded rather than UNGRADED by plugins/health-markers.json.
  // It says nothing about any agent's surface. R185-P3 measured that ctx.logger.info does NOT reach the boot
  // output the health gate reads (it judges the probe boot's stdout), so this goes through console.log like
  // dsh-image-guard, dsh-link-collab, dsh-link-teams and dsh-continue-button already do - otherwise a mounted
  // package would still be graded NOT MOUNTED.
  console.log('[link-groups] ready — ' + String(resolved.groups.length) + ' group(s) configured')
  // The one public seam. A second instance of this package on the same root finds
  // the name taken; it still installs its own config groups (and still collides by
  // agent exactly as before), but it does not own the service, and it says so
  // instead of failing the whole row.
  if (typeof ctx.provide === 'function' && ctx.get(SERVICE) === undefined) {
    try {
      ctx.provide(SERVICE, { registerGroup: seam.registerGroup, groups: seam.groups })
    } catch (error) {
      ctx.logger?.warn?.('dsh-link-groups: the service "' + SERVICE + '" could not be provided [LINK_GROUPS_SERVICE_TAKEN] '
        + (error instanceof Error ? error.message : String(error)) + '; groups registered through this instance reach no agent')
    }
  } else {
    ctx.logger?.warn?.('dsh-link-groups: the service "' + SERVICE + '" is already provided by another page [LINK_GROUPS_SERVICE_TAKEN];'
      + ' this instance still installs the groups from its own row, but contributed groups reach agents only through the owning instance')
  }
  autoOpenRecords.set(ctx, { config: merged, installed })
  const maybeInstall = (): void => {
    const agents = ctx.get('agents') as AgentsService | undefined
    const live: AgentLike[] = agents === undefined ? [] : [...agents.list()]
    for (const agent of live) {
      if (installed.has(agent)) continue
      const record = installAgent(ctx, agent, merged)
      if (isRefusal(record)) {
        ctx.logger?.warn?.('dsh-link-groups: agent ' + String(agent.id) + ' not installed [' + record.code + '] ' + record.reason)
        continue
      }
      // Two owners, on purpose: this disposer is also owned by the agent's own
      // scope, so either teardown removes the registrations. Unloading this
      // plugin does not dispose agent.ctx registrations by itself.
      record.effectDispose = record.scope.effect(() => () => record.dispose(), 'dsh-link-groups.agentScope()')
      recordsByAgent.set(agent, { config: merged, installed })
      installed.set(agent, record)
      for (const queued of pendingOpens.get(agent) ?? []) requestAutoOpen(ctx, agent, queued.id, queued.why)
      pendingOpens.delete(agent)
    }
    for (const [agent, record] of [...installed]) {
      if (live.includes(agent)) continue
      installed.delete(agent)
      recordsByAgent.delete(agent)
      record.dispose()
    }
  }
  maybeInstall()
  ctx.on('agent/created', () => maybeInstall())
  ctx.on('agent/disposed', () => maybeInstall())
  ctx.effect(() => () => {
    for (const record of installed.values()) record.dispose()
    installed.clear()
    autoOpenRecords.delete(ctx)
  }, 'dsh-link-groups.installations()')
  ctx.on('tools/pre-execute', async (exec: ToolPreExecuteEvent, next: () => unknown) => {
    if (exec.name !== DECLARE_TOOL || exec.agent === undefined) return next()
    const record = installed.get(exec.agent)
    if (record === undefined) return next()
    const validation = validateDeclare(exec.arguments, merged, record.resolveState, record.installations)
    if (!validation.ok) return next()
    const gated = approvalNeeded(validation.open, merged)
    if (gated.length === 0) return next()
    const off = gated.filter(id => merged.groups.find(group => group.id === id)!.state === 'off' && !merged.groups.find(group => group.id === id)!.userDisabled)
    if (off.length > 0) {
      return { kind: 'deny', reason: REFUSALS.OFF + ': the user turned this group off, so a declaration cannot open it: ' + off.join(', ') }
    }
    const id = String(exec.callId)
    const granted = approvals.get(exec.agent)
    if (granted === undefined) approvals.set(exec.agent, new Set([id]))
    else granted.add(id)
    const why = exec.arguments !== null && typeof exec.arguments === 'object' && typeof (exec.arguments as { readonly why?: unknown }).why === 'string'
      ? String((exec.arguments as { readonly why?: unknown }).why)
      : ''
    const extra = why.length > 0 ? ' (' + why + ')' : ''
    return {
      kind: 'ask',
      reason: 'opening user-disabled tool group' + (gated.length > 1 ? 's' : '') + ' ' + gated.join(', ') + extra
      + ' — the user turned them off, so they are never opened silently. Without an available answer this declaration changes nothing.',
      displayReason: { en: 'Open tool group: ' + gated.join(', ') },
    }
  })
}