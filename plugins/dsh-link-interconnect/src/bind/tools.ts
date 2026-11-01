/**
 * tools.expose binding: turn one active adapter binding into dynamically registered tools.
 *
 * Each declared tool becomes one kernel tool through hosts.tools().register(): its declared name,
 * description and parameters JSON schema, plus a handler that invokes the peer over HTTP
 * (POST <baseUrl>/link/v1/invoke, Bearer credential when the declaration has one) and hands the
 * peer's JSON result back as model-facing text. The disposer returned by register() is what
 * deactivate() calls, so the tool disappears the moment the binding is removed or unavailable.
 *
 * Activation happens through the runtime binder seam (before a binding is committed), so a
 * registration throw rolls the whole connect back. The frozen interconnect/bindings event is
 * also subscribed: a binding that vanished releases its tools, and a deferred activation (tools
 * service not mounted yet) is retried on the next binding change instead of crashing the mount.
 */
import type { AdapterRuntime, BindHosts, BindingState, CoreEvent, InterconnectCore, ToolDeclaration } from '../protocol/types.ts'
import { CAPS, LIMITS } from '../protocol/types.ts'
import type { AdapterRuntimeInternals, BindingActivation, CapabilityBinder } from '../adapters/runtime.ts'
import { ADAPTER_EVENTS } from '../adapters/runtime.ts'

/** Options index.ts hands bindTools (the frozen FACTORY CONTRACT names). */
export interface BindToolsOptions {
  core: InterconnectCore
  runtime: AdapterRuntime
  hosts: BindHosts
  log(line: string): void
}

/** One registered tool definition in the kernel vocabulary (structural: the kernel type is not imported). */
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  output: { schema: Record<string, any>; render(args: unknown, value: unknown): Array<Record<string, any>> }
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

/** The kernel tools registry as far as this binder needs it. */
interface ToolsHost {
  register(definition: ToolDefinition): () => void
}

/** Narrow the frozen runtime to the binder seam createAdapterRuntime() provides. */
function runtimeInternals(runtime: AdapterRuntime): AdapterRuntimeInternals {
  const candidate = runtime as Partial<AdapterRuntimeInternals>
  if (typeof candidate.addBinder !== 'function') {
    throw new Error('bindTools() needs the runtime returned by createAdapterRuntime(): the addBinder seam is missing')
  }
  return candidate as AdapterRuntimeInternals
}

/** Render one peer JSON result as model-facing text without inventing structure. */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? String(value) : text
}

/** Read a JSON body from a fetch Response, answering undefined for an empty or broken body. */
async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Build the peer-invoking execute handler for one declared tool. */
function createToolDefinition(activation: BindingActivation, tool: ToolDeclaration): ToolDefinition {
  const baseUrl = activation.baseUrl.replace(/\/+$/, '')
  const timeoutMs = activation.limits.timeoutMs > 0 ? activation.limits.timeoutMs : LIMITS.timeoutMs
  const parameters = tool.parameters !== null && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', additionalProperties: true }
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderValue(value) }],
    },
    async execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown> {
      const credential = activation.credential()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('the peer request exceeded ' + String(timeoutMs) + ' ms')), timeoutMs)
      const onAbort = () => controller.abort(exec?.signal?.reason)
      exec?.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
        if (credential !== undefined) headers.authorization = 'Bearer ' + credential
        const call = tool.call ?? { cap: CAPS.toolsExpose, op: tool.name }
        const response = await fetch(baseUrl + '/link/v1/invoke', {
          method: 'POST',
          headers,
          body: JSON.stringify({ cap: call.cap, op: call.op, args }),
          signal: controller.signal,
        })
        const body = await readJsonBody(response)
        if (!response.ok) throw new Error('the peer answered HTTP ' + String(response.status) + ' for tool ' + JSON.stringify(tool.name))
        const envelope = body !== null && typeof body === 'object' ? (body as { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } }) : undefined
        if (envelope === undefined) throw new Error('the peer answered a non-JSON body for tool ' + JSON.stringify(tool.name))
        if (envelope.ok === false) {
          const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'link/internal'
          const message = typeof envelope.error?.message === 'string' ? envelope.error.message : 'the peer refused the call'
          throw new Error(code + ': ' + message)
        }
        return envelope.result === undefined ? null : envelope.result
      } finally {
        clearTimeout(timer)
        exec?.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

/**
 * Bind every tools.expose binding to the kernel tools registry.
 * @param options - core, runtime, host accessors and one log line sink.
 * @returns the disposer that releases every registration and stops listening.
 */
export function bindTools(options: BindToolsOptions): () => void {
  const { core, runtime, hosts, log } = options
  const seam = runtimeInternals(runtime)
  const registrations = new Map<string, { toolNames: string[]; dispose(): void }>()
  const deferred = new Map<string, BindingActivation>()

  /** Register one active binding's declared tools; a missing tools service defers. */
  function start(activation: BindingActivation): void {
    const adapterId = activation.adapterId
    if (registrations.has(adapterId)) return
    const capability = activation.declaration.capabilities.find((entry) => entry.kind === CAPS.toolsExpose)
    const declared = capability !== undefined && Array.isArray(capability.tools) ? capability.tools : []
    if (declared.length === 0) return
    const toolsHost = hosts.tools?.() as ToolsHost | undefined
    if (toolsHost === undefined || toolsHost === null) {
      deferred.set(adapterId, activation)
      log('tool registrations for adapter ' + adapterId + ' are deferred: the tools service is not mounted yet')
      return
    }
    const disposers: Array<() => void> = []
    try {
      for (const tool of declared) {
        disposers.push(toolsHost.register(createToolDefinition(activation, tool)))
      }
    } catch (error) {
      for (const dispose of disposers.slice().reverse()) {
        try {
          dispose()
        } catch {
          /* the registration failure is the one being reported */
        }
      }
      throw error
    }
    deferred.delete(adapterId)
    registrations.set(adapterId, {
      toolNames: declared.map((tool) => tool.name),
      dispose() {
        for (const dispose of disposers.slice().reverse()) {
          try {
            dispose()
          } catch (error) {
            log('releasing a tool of adapter ' + adapterId + ' failed: ' + (error instanceof Error ? error.message : String(error)))
          }
        }
      },
    })
    log('tools registered from adapter ' + adapterId + ': ' + declared.map((tool) => tool.name).join(', '))
  }

  /** Release one binding's tools. */
  function stop(activation: BindingActivation): void {
    deferred.delete(activation.adapterId)
    const registration = registrations.get(activation.adapterId)
    if (registration === undefined) return
    registrations.delete(activation.adapterId)
    registration.dispose()
  }

  /** Reconcile against one published binding snapshot. */
  function reconcile(event: CoreEvent): void {
    const published = Array.isArray(event.data?.bindings) ? (event.data.bindings as BindingState[]) : []
    const active = new Map<string, BindingState>()
    for (const binding of published) {
      if (binding === null || typeof binding !== 'object') continue
      if (binding.status !== 'active') continue
      if (!Array.isArray(binding.caps) || !binding.caps.includes(CAPS.toolsExpose)) continue
      active.set(binding.adapterId, binding)
    }
    for (const [adapterId, registration] of [...registrations]) {
      if (active.has(adapterId)) continue
      registrations.delete(adapterId)
      registration.dispose()
      log('tools for adapter ' + adapterId + ' released: the binding is no longer active')
    }
    for (const [adapterId, activation] of [...deferred]) {
      if (!active.has(adapterId)) {
        deferred.delete(adapterId)
        continue
      }
      try {
        start(activation)
      } catch (error) {
        log('deferred tool registration for adapter ' + adapterId + ' failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  const binder: CapabilityBinder = {
    name: 'tools',
    caps: [CAPS.toolsExpose],
    activate: (activation) => start(activation),
    deactivate: (activation) => stop(activation),
  }
  const disposeSeam = seam.addBinder(binder)
  const unsubscribe = core.events.subscribe((event) => {
    if (event === null || typeof event !== 'object') return
    if (event.type !== ADAPTER_EVENTS.bindings) return
    reconcile(event)
  })
  return () => {
    try {
      unsubscribe()
    } catch {
      /* an already released subscription is not a failure to report */
    }
    disposeSeam()
    for (const registration of registrations.values()) registration.dispose()
    registrations.clear()
    deferred.clear()
  }
}
