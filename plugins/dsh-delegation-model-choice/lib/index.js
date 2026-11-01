/**
 * dsh-delegation-model-choice — let an agent delegate on another model, with the
 * user's explicit approval, while keeping the session's own route as the default.
 *
 * Why this package exists
 * -----------------------
 * DSH can already start a `subagent` on another provider/model, but only when the
 * host setting `subagent-model-selection` is enabled and the route was
 * pre-authorized in Settings, and only for tools configured with
 * `modelSelectionSettings: true`. Agent Teams' `spawn_teammate` has no model
 * field at all: `ctx.agentTeams.spawnTeammate` never passes `agentOptions`, so a
 * teammate always inherits the Lead's route.
 *
 * This plugin closes both gaps with one policy and two model-facing tools:
 *
 *  - `list_delegation_models`  — exact provider/model routes this deployment serves.
 *  - `spawn_teammate_model`    — a teammate on a chosen route (default: the Lead's).
 *  - `spawn_subagent_model`    — a durable continuable child on a chosen route.
 *
 * A route that differs from the caller's own route is only created after the user
 * answers an approval question. Once the user approves a route in a conversation,
 * later delegates on that same route in that same conversation run without asking
 * again (config `rememberApproval`, default on); a different route, or another
 * conversation, still asks. The system-prompt section states the default (inherit)
 * and the approval rule, so the model does not switch models on its own.
 *
 * Teammate creation on a non-inherited route
 * ------------------------------------------
 * `ctx.agentTeams.spawnTeammate` accepts no `agentOptions`, and
 * `ctx.subagents.startContinuable` resolves a child's route only from
 * `request.agentOptions` (a provider's `agentRouteDefaults` is a tool-side hint,
 * never consulted by the continuation path). So this plugin reproduces the
 * service's own two-step journal protocol on the Lead Session — append the
 * `team/member` provisioning event, start the durable continuable child with the
 * requested `agentOptions`, then append the active edge — which is exactly what
 * `spawnAdmitted` does. The member is then a first-class Team member: roster,
 * mailbox, shared tasks, and disposal all read the same journal. When no route
 * override is requested the plugin calls `ctx.agentTeams.spawnTeammate` instead,
 * so the common path keeps the service's own provisioning and recovery logic.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'delegation-model-choice'

/** The tool registry must be in scope to register model-facing tools. */
export const inject = ['tools']

// ---8<--- CORE START ---8<---
/** Prompt section carrying the default-inherit and approval policy. */
const POLICY_SECTION = 'delegation:model-choice'

/** Fallback order when the repository's own TEAM_POLICY placement is unavailable. */
const POLICY_ORDER_FALLBACK = 601

/** Policy text shared by every Team member scope. */
const POLICY_TEXT = `Model choice when delegating (Agent Teams teammates and subagents):
- Default: create every teammate and subagent on your own current route — the provider/model this session runs on. Never move a delegate to another model on your own initiative, even when another model looks cheaper, faster, or stronger.
- Switch only when the user explicitly asked for it in this conversation, naming a model or provider (for example "use glm-5.3 for the teammates"). If the user did not name one, delegate on your own route.
- A delegation on a different route requires explicit user approval: spawn_teammate_model and spawn_subagent_model ask the user before creating the delegate. When the user declines, delegate on your own route instead (or do not delegate) and say so plainly.
- Once the user has approved a delegate on a route in this conversation, further delegates on that same route in this conversation do not ask again; a different route, or another conversation, still needs approval.
- Call list_delegation_models first to see the exact routes this deployment offers, then pass an exact provider and model pair.
- Report the route each delegate actually runs on in your final answer.`

/** The service's own teammate-name grammar, mirrored so a bad name fails early. */
const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Maximum teammate-name length accepted by the Team service. */
const MAX_MEMBER_NAME = 64

/** Stable question id used by the approval card. */
const APPROVAL_ID = 'delegation-model-approval'

/** Per-Lead serialization of our own journal writes. */
const spawnQueues = new Map()

/**
 * Approvals the user has already given in one conversation, keyed by Session id
 * and then by the exact requested route. "首次同意后同对话下次自动": once the
 * user approves a delegate on a route, later delegates on that SAME route in
 * that SAME conversation skip the card; a different route — or another
 * conversation — still asks, and a Decline is never remembered. This lives for
 * the plugin's process lifetime, so a host restart asks once per route again.
 */
const conversationGrants = new Map()

/** Cap how many conversations keep remembered routes at once. */
const MAX_GRANT_CONVERSATIONS = 128

/** Resolve loader configuration with the same defaults the Team profile uses. */
function resolveConfig(config) {
  const source = config === undefined || config === null ? {} : config
  return {
    maxMembers: Number.isSafeInteger(source.maxMembers) && source.maxMembers > 0 ? source.maxMembers : 8,
    freshProvider: typeof source.freshProvider === 'string' && source.freshProvider.length > 0 ? source.freshProvider : 'spawn',
    forkProvider: typeof source.forkProvider === 'string' && source.forkProvider.length > 0 ? source.forkProvider : 'fork',
    requireApproval: source.requireApproval !== false,
    rememberApproval: source.rememberApproval !== false,
  }
}

/** The grant key for one route: the provider/model pair the user approved. */
function routeGrantKey(route) {
  const provider = route === undefined || route === null ? undefined : route.provider
  const model = route === undefined || route === null ? undefined : route.model
  return String(provider) + '/' + String(model)
}

/** Whether this conversation already approved this exact route. */
function hasConversationGrant(agent, route) {
  const perConversation = conversationGrants.get(String(agent.id))
  return perConversation !== undefined && perConversation.has(routeGrantKey(route))
}

/** Remember one conversation's approval of one exact route. */
function rememberConversationGrant(agent, route, config) {
  if (!config.rememberApproval) return
  const conversation = String(agent.id)
  if (!conversationGrants.has(conversation)) {
    while (conversationGrants.size >= MAX_GRANT_CONVERSATIONS) {
      const oldest = conversationGrants.keys().next().value
      conversationGrants.delete(oldest)
    }
    conversationGrants.set(conversation, new Set())
  }
  conversationGrants.get(conversation).add(routeGrantKey(route))
}

/** Compact JSON output declaration for one dynamic tool. */
function jsonOutput(schema) {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Read one message string without touching live service objects. */
function errorMessage(error) {
  if (error === undefined || error === null) return 'unknown error'
  const message = error.message
  if (typeof message === 'string' && message.length > 0) return message
  return String(error)
}

/** Read an optional string field as a scalar. */
function optionalText(value) {
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (value === undefined || value === null) return undefined
  return String(value)
}

/** The caller's own provider/model route, read as scalars. */
function ownRoute(agent) {
  const options = agent === undefined ? undefined : agent.options
  if (options === undefined) return { provider: undefined, model: undefined, reasoningEffort: undefined }
  return {
    provider: optionalText(options.provider),
    model: optionalText(options.model),
    reasoningEffort: options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort),
  }
}

/** Whether two routes name the same provider/model pair. */
function sameRoute(left, right) {
  return left.provider === right.provider && left.model === right.model
}

/** Human-readable route, or a phrase for the inherited route. */
function describeRoute(route) {
  if (route === undefined || route.provider === undefined || route.model === undefined) return 'the session route'
  return route.provider + '/' + route.model
}

/** Resolve one tool call's route request into child `AgentOptions` plus its display form. */
function resolveRequest(agent, args) {
  const own = ownRoute(agent)
  const provider = optionalText(args.provider)
  const model = optionalText(args.model)
  const effort = optionalText(args.reasoning_effort)
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('pass provider and model together, or omit both to keep the session route')
  }
  if (provider === undefined) {
    if (effort === undefined) return { agentOptions: undefined, requested: own, explicitRoute: false }
    return {
      agentOptions: { reasoningEffort: effort },
      requested: { provider: own.provider, model: own.model, reasoningEffort: effort },
      explicitRoute: false,
    }
  }
  const agentOptions = effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort }
  return {
    agentOptions,
    requested: { provider, model, reasoningEffort: effort },
    explicitRoute: true,
  }
}

/** Serialize one Lead's own journal mutation, mirroring the service's transaction queue. */
function serialize(key, operation) {
  const prior = spawnQueues.get(key) ?? Promise.resolve()
  const run = prior.then(operation, operation)
  const tail = run.then(() => undefined, () => undefined)
  spawnQueues.set(key, tail)
  const settle = (value) => {
    if (spawnQueues.get(key) === tail) spawnQueues.delete(key)
    return value
  }
  return run.then(settle, (error) => {
    if (spawnQueues.get(key) === tail) spawnQueues.delete(key)
    throw error
  })
}

/** Mint one durable child id that cannot collide with a stored session. */
function mintChildId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** Validate a teammate name exactly as the Team service does. */
function assertMemberName(value) {
  if (typeof value !== 'string' || !MEMBER_NAME.test(value) || value.length > MAX_MEMBER_NAME || value === 'lead') {
    throw new Error('teammate name must be lower-kebab-case, at most 64 characters, and not "lead"')
  }
}

/** Every exact route this deployment currently serves, as detached scalars. */
async function listRoutes(services) {
  const llm = services.get('llm')
  if (llm === undefined) return []
  const routes = []
  for (const provider of llm.listProviders()) {
    const id = String(provider.id)
    let models = []
    try {
      models = await llm.listModels(id)
    } catch (_error) {
      models = []
    }
    for (const model of models) {
      routes.push({
        provider: id,
        model: String(model.id),
        name: typeof model.name === 'string' ? model.name : String(model.id),
      })
    }
  }
  return routes
}

/**
 * Ask the user to approve one delegation on a different route.
 *
 * `helpers.hostRequest`, when present, adapts the request object into the host
 * realm before it crosses the Remote-event gateway. A real Cordis plugin runs in
 * the host realm already and passes no adapter; the dynamic-plugin sandbox
 * evaluates in its own VM realm, whose object prototypes the gateway rejects as
 * non-lossless JSON, so only that sandbox supplies one.
 *
 * @returns whether the user approved.
 */
async function askApproval(services, agent, signal, what, requested, helpers) {
  const questions = services.get('userQuestions')
  if (questions === undefined) {
    throw new Error('this deployment has no user-question channel, so a different-model delegation cannot be approved; delegate on the session route instead')
  }
  const request = {
    questions: [{
      id: APPROVAL_ID,
      header: 'Delegate on another model',
      question: 'Create ' + what + ' on ' + describeRoute(requested) + ' instead of the session route?',
      detail: 'The delegate runs on ' + describeRoute(requested) + ' while this session runs on ' + describeRoute(ownRoute(agent)) + '.',
      options: [
        { label: 'Approve', description: 'Create the delegate on ' + describeRoute(requested) + '.' },
        { label: 'Decline', description: 'Keep the session route; do not create it on another model.' },
      ],
    }],
    agent,
    signal,
  }
  const wire = helpers !== undefined && helpers.hostRequest !== undefined ? helpers.hostRequest(request) : request
  const answer = await questions.ask(wire)
  const items = answer === undefined || !Array.isArray(answer.answers) ? [] : answer.answers
  const item = items.find((candidate) => candidate.id === APPROVAL_ID) ?? items[0]
  if (item === undefined) return false
  const selected = Array.isArray(item.selected) ? item.selected : []
  if (selected.some((value) => String(value) === 'Approve')) return true
  const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
  return /^(approve|approved|yes|y|ok|允许|同意|批准|可以)/iu.test(custom)
}

/** Resolve the exact live Team Lead behind one calling agent. */
function requireLead(services, agent) {
  const team = services.get('agentTeams')
  if (team === undefined) throw new Error('Agent Teams is not mounted in this session')
  const membership = team.tryMembership(agent)
  if (membership === undefined || membership.role !== 'lead') throw new Error('only the Team Lead may create a teammate')
  return { team, lead: membership.root }
}

/**
 * Start one teammate through the Team service with an explicit model route.
 *
 * The service now accepts \`agentOptions\` on \`SpawnTeammateRequest\`, so the service owns
 * the provisioning/active edges, the child identity, the depth admission, and recovery.
 * The plugin only decided that the route is approved.
 */
async function spawnTeammateOnRoute(services, config, caller, args, agentOptions, signal) {
  const team = services.get('agentTeams')
  if (team === undefined) throw new Error('Agent Teams is not mounted in this session')
  const context = args.context === 'fork' ? 'fork' : 'fresh'
  const result = await team.spawnTeammate(caller, {
    name: String(args.name),
    description: String(args.description),
    prompt: [{ type: 'text', text: String(args.prompt) }],
    context,
    provider: context === 'fork' ? config.forkProvider : config.freshProvider,
    agentOptions,
    ...args.under === undefined ? {} : { under: String(args.under) },
    signal,
  })
  const view = result.member
  return {
    id: String(view.id),
    name: String(view.name),
    role: String(view.role),
    status: String(view.status),
    description: view.description === undefined ? undefined : String(view.description),
    provider: view.provider === undefined ? undefined : String(view.provider),
    context: view.context === undefined ? undefined : String(view.context),
    model: view.model === undefined ? optionalText(agentOptions === undefined ? undefined : agentOptions.model) : String(view.model),
  }
}

/** Start one teammate on the Lead's own route through the Team service itself. */
async function spawnTeammateInherited(services, config, agent, args, agentOptions, signal) {
  const { team } = requireLead(services, agent)
  const context = args.context === 'fork' ? 'fork' : 'fresh'
  const result = await team.spawnTeammate(agent, {
    name: args.name,
    description: String(args.description),
    prompt: [{ type: 'text', text: String(args.prompt) }],
    context,
    provider: context === 'fork' ? config.forkProvider : config.freshProvider,
    signal,
  })
  const view = result.member
  return {
    id: String(view.id),
    name: String(view.name),
    role: String(view.role),
    status: String(view.status),
    description: view.description === undefined ? undefined : String(view.description),
    provider: view.provider === undefined ? undefined : String(view.provider),
    context: view.context === undefined ? undefined : String(view.context),
    model: view.model === undefined ? optionalText(agentOptions === undefined ? undefined : agentOptions.model) : String(view.model),
  }
}

/** Build every model-facing tool for one scope. */
function buildTools(services, config, helpers) {
  const listModels = helpers.define({
    name: 'list_delegation_models',
    description: 'List the exact provider/model routes this deployment serves for delegated work, plus the route the current session runs on. Call this before choosing a model for a teammate or subagent.',
    parameters: {},
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        current: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
          },
        },
        routes: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              provider: { type: 'string', required: true },
              model: { type: 'string', required: true },
              name: { type: 'string' },
            },
          },
        },
        policySection: {
          type: 'boolean',
          required: true,
        },
      },
    }),
    async execute(_args, exec) {
      const agent = exec.agent
      const own = ownRoute(agent)
      const routes = await listRoutes(services)
      let policySection = false
      const prompt = services.get('systemPrompt')
      if (prompt !== undefined && agent !== undefined) {
        try {
          const assembly = await prompt.assemble({ scope: agent })
          policySection = assembly.sections.some((section) => section.name === POLICY_SECTION)
        } catch (_error) {
          policySection = false
        }
      }
      return {
        current: {
          ...own.provider === undefined ? {} : { provider: own.provider },
          ...own.model === undefined ? {} : { model: own.model },
        },
        routes,
        policySection,
      }
    },
  })

  const teammate = helpers.define({
    name: 'spawn_teammate_model',
    description: 'Create one named, durable teammate, optionally on another model. Default: the teammate inherits this session\'s own route — pass provider and model only when the user explicitly asked for a different model. Any route other than the session route requires the user\'s approval, which this tool requests before creating the teammate. Only the Team Lead may call this tool.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique lower-kebab-case teammate name.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'Short description of the delegated responsibility.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'Complete initial task for the teammate.',
      },
      context: {
        type: 'string',
        enum: ['fresh', 'fork'],
        description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
      },
      provider: {
        type: 'string',
        description: 'LLM provider for the teammate. Omit together with model to inherit the session route.',
      },
      model: {
        type: 'string',
        description: 'Exact model id for the teammate. Omit together with provider to inherit the session route.',
      },
      reasoning_effort: {
        type: 'string',
        description: 'Optional reasoning effort id for the teammate route.',
      },
    },
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        approved: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        member: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            role: { type: 'string', required: true },
            status: { type: 'string', required: true },
            description: { type: 'string' },
            provider: { type: 'string' },
            context: { type: 'string' },
            model: { type: 'string' },
          },
        },
      },
    }),
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('spawn_teammate_model requires a calling agent')
      const { lead } = requireLead(services, agent)
      const request = resolveRequest(agent, args)
      const needsApproval = config.requireApproval && request.explicitRoute && !sameRoute(request.requested, ownRoute(agent)) && !hasConversationGrant(agent, request.requested)
      if (needsApproval) {
        const approved = await askApproval(services, agent, exec.signal, 'teammate "' + String(args.name) + '"', request.requested, helpers)
        if (!approved) {
          return {
            ok: false,
            approved: false,
            message: 'The user declined a delegation on ' + describeRoute(request.requested) + '. Create the teammate on the session route instead, or do not create it, and tell the user what you did.',
          }
        }
        rememberConversationGrant(agent, request.requested, config)
      }
      const member = request.agentOptions === undefined
        ? await spawnTeammateInherited(services, config, agent, args, undefined, exec.signal)
        : await serialize(String(lead.id), () => spawnTeammateOnRoute(services, config, lead, args, request.agentOptions, exec.signal))
      return {
        ok: true,
        approved: true,
        message: 'Created teammate "' + member.name + '" on ' + describeRoute({ provider: member.provider, model: member.model }) + '.',
        member,
      }
    },
  })

  const subagent = helpers.define({
    name: 'spawn_subagent_model',
    description: 'Start one durable, continuable subagent, optionally on another model. Default: the subagent inherits this session\'s own route — pass provider and model only when the user explicitly asked for a different model. Any route other than the session route requires the user\'s approval, which this tool requests before starting the subagent. Use the ordinary subagent tool when no model choice is involved.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Complete, self-contained task for the subagent.',
      },
      label: {
        type: 'string',
        description: 'Short display label for the subagent.',
      },
      provider: {
        type: 'string',
        description: 'LLM provider for the subagent. Omit together with model to inherit the session route.',
      },
      model: {
        type: 'string',
        description: 'Exact model id for the subagent. Omit together with provider to inherit the session route.',
      },
      reasoning_effort: {
        type: 'string',
        description: 'Optional reasoning effort id for the subagent route.',
      },
    },
    output: jsonOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        approved: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        child: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            provider: { type: 'string' },
            model: { type: 'string' },
          },
        },
      },
    }),
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('spawn_subagent_model requires a calling agent')
      const subagents = services.get('subagents')
      if (subagents === undefined) throw new Error('the subagent registry is not mounted')
      const request = resolveRequest(agent, args)
      const needsApproval = config.requireApproval && request.explicitRoute && !sameRoute(request.requested, ownRoute(agent)) && !hasConversationGrant(agent, request.requested)
      if (needsApproval) {
        const approved = await askApproval(services, agent, exec.signal, 'a subagent', request.requested, helpers)
        if (!approved) {
          return {
            ok: false,
            approved: false,
            message: 'The user declined a subagent on ' + describeRoute(request.requested) + '. Start it on the session route instead, or do not start it, and tell the user what you did.',
          }
        }
        rememberConversationGrant(agent, request.requested, config)
      }
      const label = optionalText(args.label) ?? 'delegated subagent'
      const started = await subagents.startActivation({
        delivery: 'parent',
        provider: config.freshProvider,
        label,
        request: {
          prompt: [{ type: 'text', text: String(args.prompt) }],
          parent: agent,
          ...request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions },
        },
        signal: exec.signal,
      })
      const own = ownRoute(agent)
      const provider = request.requested.provider ?? own.provider
      const model = request.requested.model ?? own.model
      return {
        ok: true,
        approved: true,
        message: 'Started subagent ' + String(started.childId) + ' on ' + describeRoute({ provider, model }) + '.',
        child: {
          id: String(started.childId),
          ...provider === undefined ? {} : { provider },
          ...model === undefined ? {} : { model },
        },
      }
    },
  })

  return [listModels, teammate, subagent]
}

/**
 * Install the policy section and every tool into one scope.
 * @returns the exact disposer that removes this scope's contributions.
 */
function installScope(scope, services, config, helpers) {
  const disposers = []
  const prompt = scope.get('systemPrompt')
  if (prompt !== undefined) {
    let order = POLICY_ORDER_FALLBACK
    try {
      order = prompt.getSectionOrder('TEAM_POLICY') + 1
    } catch (_error) {
      order = POLICY_ORDER_FALLBACK
    }
    disposers.push(prompt.section({ name: POLICY_SECTION, order, text: POLICY_TEXT }))
  }
  for (const tool of buildTools(services, config, helpers)) disposers.push(helpers.register(scope, tool))
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (_error) {
        // A scope being torn down may already have disposed its registry.
      }
    }
  }
}
// ---8<--- CORE END ---8<---

/**
 * Mount the delegation model-choice tools into every live or later-published Team
 * member scope, mirroring how the shipped Team tool plugin scopes its tools.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const helpers = {
    define: defineTool,
    register: (scope, tool) => scope.tools.register(tool),
  }
  const installed = new Map()
  const maybeInstall = (agent) => {
    if (installed.has(agent)) return
    const team = ctx.get('agentTeams')
    if (team === undefined) return
    let membership
    try {
      membership = team.tryMembership(agent)
    } catch (_error) {
      return
    }
    if (membership === undefined) return
    installed.set(agent, installScope(agent.ctx, ctx, resolved, helpers))
  }
  const agents = ctx.get('agents')
  if (agents !== undefined) for (const agent of agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => maybeInstall(agent))
  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = installed.get(agent)
    if (dispose === undefined) return
    installed.delete(agent)
    dispose()
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'delegation-model-choice.scopedTools()')
}
