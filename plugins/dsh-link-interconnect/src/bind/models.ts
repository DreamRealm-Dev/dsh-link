/**
 * models.provide binding: turn one active adapter binding into a kernel LLM provider.
 *
 * The kernel llm service is cordis-owned and this module must stay cordis-free (only
 * src/index.ts may import @deepseek-ai/*), so the adapter is a structural implementation of the
 * kernel LlmAdapter contract rather than a subclass: providerInfo, providerRetryPolicy,
 * imageRequestPricing, imageRequestTarget, listModels, resolveModel, prepareCall and stream. The
 * wire is OpenAI /v1/models plus /v1/chat/completions with the adapter's bearer credential.
 *
 * Activation is handed to the runtime through addBinder(), so registration happens before a
 * binding is committed and a registration throw rolls the whole connect back. bindModels also
 * subscribes to the frozen interconnect/bindings event: a registration whose binding vanishes or
 * becomes unavailable is released, and a deferred activation (llm service not mounted yet) is
 * retried on the next binding change instead of crashing the plugin.
 */
import type { AdapterRuntime, BindHosts, BindingState, CoreEvent, InterconnectCore } from '../protocol/types.ts'
import { LIMITS } from '../protocol/types.ts'
import type { AdapterRuntimeInternals, BindingActivation, CapabilityBinder } from '../adapters/runtime.ts'
import { ADAPTER_EVENTS } from '../adapters/runtime.ts'

/** Options index.ts hands bindModels (the frozen FACTORY CONTRACT names). */
export interface BindModelsOptions {
  core: InterconnectCore
  runtime: AdapterRuntime
  hosts: BindHosts
  log(line: string): void
}

/** One raw stream chunk in the kernel's vocabulary (structural: the kernel type is not imported). */
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: Record<string, any> }
  | { type: 'usage'; usage: Record<string, number> }
  | { type: 'finish'; reason: Record<string, any> }

/** One content block of a harness request message. */
interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: string
}

/** One harness request message, narrowed to the fields the OpenAI projection reads. */
interface RequestMessage {
  role: string
  content?: readonly ContentBlock[]
  toolCallId?: string
  isError?: boolean
}

/** One fully assembled model request (the kernel GenerateOptions subset this adapter reads). */
interface GenerateOptions {
  provider: string
  model: string
  messages?: readonly RequestMessage[]
  system?: string
  tools?: ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }>
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}

/** One OpenAI chat message. */
type OpenAiMessage = Record<string, any>

/** Narrow the frozen runtime to the binder seam createAdapterRuntime() provides. */
function runtimeInternals(runtime: AdapterRuntime): AdapterRuntimeInternals {
  const candidate = runtime as Partial<AdapterRuntimeInternals>
  if (typeof candidate.addBinder !== 'function') {
    throw new Error('bindModels() needs the runtime returned by createAdapterRuntime(): the addBinder seam is missing')
  }
  return candidate as AdapterRuntimeInternals
}

/** Join the text blocks of one harness message. */
function textOf(content: readonly ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block !== null && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

/** Project harness messages onto the OpenAI chat vocabulary. */
function toOpenAiMessages(options: GenerateOptions): OpenAiMessage[] {
  const messages: OpenAiMessage[] = []
  if (typeof options.system === 'string' && options.system !== '') messages.push({ role: 'system', content: options.system })
  for (const message of options.messages ?? []) {
    if (message === null || typeof message !== 'object') continue
    const text = textOf(message.content)
    switch (message.role) {
      case 'system':
        messages.push({ role: 'system', content: text })
        break
      case 'user':
        messages.push({ role: 'user', content: text })
        break
      case 'assistant': {
        const toolCalls: OpenAiMessage[] = []
        for (const block of message.content ?? []) {
          if (block !== null && block.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string') {
            toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: typeof block.arguments === 'string' ? block.arguments : '{}' } })
          }
        }
        if (toolCalls.length > 0) messages.push({ role: 'assistant', content: text === '' ? null : text, tool_calls: toolCalls })
        else if (text !== '') messages.push({ role: 'assistant', content: text })
        break
      }
      case 'tool':
        messages.push({ role: 'tool', tool_call_id: message.toolCallId ?? '', content: text === '' ? (message.isError === true ? 'the tool failed' : '') : text })
        break
      default:
        break
    }
  }
  return messages
}

/** Parse one SSE data line into its JSON event, or the terminal marker. */
function parseSseLine(line: string): Record<string, any> | 'done' | undefined {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return undefined
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return 'done'
  try {
    const parsed = JSON.parse(payload)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Yield every server-sent event of one OpenAI streaming response. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      for (;;) {
        const boundary = buffer.indexOf('\n')
        if (boundary === -1) break
        const line = buffer.slice(0, boundary).replace(/\r$/, '')
        buffer = buffer.slice(boundary + 1)
        const event = parseSseLine(line)
        if (event === 'done') return
        if (event !== undefined) yield event
      }
    }
    const tail = (buffer + decoder.decode()).trim()
    if (tail !== '') {
      const event = parseSseLine(tail)
      if (event !== undefined && event !== 'done') yield event
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* the reader is already released when the stream ended */
    }
  }
}

/** Map one OpenAI usage object onto the kernel TokenUsage (cached input is disjoint). */
function mapUsage(usage: any): Record<string, number> | undefined {
  const prompt = Number(usage?.prompt_tokens)
  const completion = Number(usage?.completion_tokens)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens)
  const total = Number(usage?.total_tokens)
  return {
    inputTokens: Number.isFinite(cached) && cached > 0 ? Math.max(0, prompt - cached) : prompt,
    outputTokens: completion,
    ...(Number.isFinite(total) ? { totalTokens: total } : {}),
    ...(Number.isFinite(cached) && cached > 0 ? { cacheReadTokens: cached } : {}),
  }
}

/** Map one OpenAI finish_reason onto the kernel FinishReason. */
function mapFinishReason(reason: string | undefined): Record<string, any> {
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  if (reason === 'content_filter') return { kind: 'stop' }
  return { kind: 'stop' }
}

/** One model a static catalog advertises. */
export interface OpenAiCompatibleModel {
  id: string
  name?: string
}

/** Options for createOpenAiCompatibleAdapter(). */
export interface OpenAiCompatibleAdapterOptions {
  /** The kernel provider route the adapter is registered under. */
  providerId: string
  /** Display name for providerInfo(); defaults to providerId. */
  label?: string
  /** OpenAI-compatible origin, e.g. http://127.0.0.1:18900 (a trailing slash is ignored). */
  baseUrl: string
  /** Bearer credential sent with every request. It stays in memory only. */
  apiKey: string
  /** Static catalog; when omitted GET <baseUrl>/v1/models is the catalog. Strings or {id,name}. */
  models?: ReadonlyArray<string | OpenAiCompatibleModel>
  /** Per-request timeout; defaults to LIMITS.timeoutMs. */
  timeoutMs?: number
}

/** One request-image shape (structural) the kernel may hand to imageRequestTarget(). */
interface ImageRequestShape {
  width?: number
  height?: number
  bytes?: number
}

/** The kernel LlmAdapter surface createOpenAiCompatibleAdapter() returns (the class is not imported). */
export interface OpenAiCompatibleLlmAdapter {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(): undefined
  imageRequestPricing(): undefined
  imageRequestTarget(provider: string, model: string, image: ImageRequestShape): { width?: number | undefined; height?: number | undefined; maxBytes?: number | undefined }
  listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string }>>
  resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string }>
  prepareCall(provider: string, model: string): Promise<{ model: { provider: string; id: string; name: string }; stream(options: GenerateOptions): AsyncIterable<StreamChunk> }>
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** One resolved static catalog row. */
interface CatalogRow {
  id: string
  name: string
}

/** Everything the OpenAI wire adapter needs; the exported factory and bindModels both build this. */
interface OpenAiWireConfig {
  providerId: string
  label: string
  baseUrl: string
  timeoutMs: number
  /** Read the bearer credential; throws one sentence when it is no longer available. */
  credential(): string
  /** Static catalog advertised instead of GET /v1/models. */
  catalog?: CatalogRow[]
}

/** Read one non-empty string option, or refuse by name. */
function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('createOpenAiCompatibleAdapter: ' + field + ' must be a non-empty string')
  return value.trim()
}

/** Normalize one OpenAI-compatible base URL. */
function normalizeBaseUrl(value: unknown): string {
  const text = requireText('baseUrl', value)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new TypeError('createOpenAiCompatibleAdapter: baseUrl must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('createOpenAiCompatibleAdapter: baseUrl must be an absolute http(s) URL')
  return text.replace(/\/+$/, '')
}

/** Normalize the optional static catalog; undefined keeps the /v1/models catalog. */
function normalizeCatalog(models: ReadonlyArray<string | OpenAiCompatibleModel> | undefined): CatalogRow[] | undefined {
  if (models === undefined) return undefined
  if (!Array.isArray(models)) throw new TypeError('createOpenAiCompatibleAdapter: models must be an array of model ids or {id, name} entries')
  const seen = new Set<string>()
  const rows: CatalogRow[] = []
  for (const entry of models) {
    const rawId = typeof entry === 'string' ? entry : entry?.id
    const id = requireText('models[].id', rawId)
    if (seen.has(id)) continue
    seen.add(id)
    const rawName = typeof entry === 'string' ? undefined : entry?.name
    rows.push({ id, name: typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : id })
  }
  if (rows.length === 0) throw new TypeError('createOpenAiCompatibleAdapter: models must name at least one model when provided')
  return rows
}

/** Build one OpenAI-compatible adapter over an explicit wire config. */
function buildOpenAiCompatibleAdapter(config: OpenAiWireConfig): OpenAiCompatibleLlmAdapter {
  const { label, baseUrl, timeoutMs, credential, catalog } = config

  /** One bounded request to the configured base URL. */
  async function request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('the adapter request exceeded ' + String(timeoutMs) + ' ms')), timeoutMs)
    try {
      return await fetch(baseUrl + path, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** The streamed call in the kernel chunk vocabulary. */
  async function* streamChat(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const bearer = credential()
    const body: Record<string, any> = { model: options.model, messages: toOpenAiMessages(options), stream: true }
    if (options.tools !== undefined && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
    }
    if (typeof options.temperature === 'number') body.temperature = options.temperature
    if (typeof options.maxTokens === 'number') body.max_tokens = options.maxTokens
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('the model request exceeded ' + String(timeoutMs) + ' ms')), timeoutMs)
    const onAbort = () => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(baseUrl + '/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(label + ': POST /v1/chat/completions answered HTTP ' + String(response.status))
      if (response.body === null) throw new Error(label + ': POST /v1/chat/completions answered no body')
      let nextIndex = 0
      let textIndex = -1
      let text = ''
      const toolBlocks = new Map<number, { index: number; id: string; name: string; arguments: string }>()
      let finishReason: string | undefined
      for await (const event of sseEvents(response.body)) {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('the model request was aborted')
        if (event.usage !== undefined) {
          const usage = mapUsage(event.usage)
          if (usage !== undefined) yield { type: 'usage', usage }
        }
        const choice = Array.isArray(event.choices) ? event.choices[0] : undefined
        if (choice === undefined || choice === null) continue
        if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') finishReason = choice.finish_reason
        const delta = choice.delta ?? {}
        if (typeof delta.content === 'string' && delta.content !== '') {
          if (textIndex < 0) {
            textIndex = nextIndex
            nextIndex += 1
            yield { type: 'block-start', index: textIndex, blockType: 'text' }
          }
          text += delta.content
          yield { type: 'text-delta', index: textIndex, text: delta.content }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            const key = typeof call?.index === 'number' ? call.index : toolBlocks.size
            const name = typeof call?.function?.name === 'string' ? call.function.name : undefined
            let block = toolBlocks.get(key)
            if (block === undefined) {
              block = { index: nextIndex, id: typeof call?.id === 'string' && call.id !== '' ? call.id : 'tool-call-' + String(key), name: '', arguments: '' }
              nextIndex += 1
              toolBlocks.set(key, block)
              yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
            }
            if (name !== undefined && block.name === '') block.name = name
            const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : ''
            block.arguments += argumentsDelta
            yield { type: 'tool-call-delta', index: block.index, id: block.id, ...(name === undefined ? {} : { name }), argumentsDelta }
          }
        }
      }
      if (textIndex >= 0) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
      for (const block of toolBlocks.values()) {
        yield { type: 'block-end', index: block.index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments } }
      }
      yield { type: 'finish', reason: mapFinishReason(finishReason) }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    providerInfo(provider: string) {
      return { id: provider, name: label }
    },
    providerRetryPolicy() {
      return undefined
    },
    imageRequestPricing() {
      return undefined
    },
    imageRequestTarget(_provider: string, _model: string, image: ImageRequestShape) {
      return { width: image?.width, height: image?.height, maxBytes: image?.bytes }
    },
    async listModels(provider: string) {
      if (catalog !== undefined) return catalog.map((row) => ({ provider, id: row.id, name: row.name }))
      const response = await request('/v1/models', { method: 'GET', headers: { authorization: 'Bearer ' + credential(), accept: 'application/json' }, redirect: 'error' })
      if (!response.ok) throw new Error(label + ': GET /v1/models answered HTTP ' + String(response.status))
      const document = await response.json().catch(() => undefined)
      const rows = Array.isArray((document as { data?: unknown } | undefined)?.data) ? (document as { data: any[] }).data : []
      return rows
        .filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string' && row.id !== '')
        .map((row) => ({ provider, id: row.id, name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id }))
    },
    async resolveModel(provider: string, model: string) {
      if (catalog !== undefined) {
        const row = catalog.find((entry) => entry.id === model)
        return { provider, id: model, name: row === undefined ? model : row.name }
      }
      return { provider, id: model, name: model }
    },
    async prepareCall(provider: string, model: string) {
      return { model: { provider, id: model, name: model }, stream: (options: GenerateOptions) => streamChat(options) }
    },
    stream(options: GenerateOptions) {
      return streamChat(options)
    },
  }
}

/**
 * Build one reusable OpenAI-compatible kernel adapter: the same structural LlmAdapter instance
 * bindModels registers for a models.provide binding, over an explicit provider/baseURL/key instead
 * of a declaration activation. The peer ingress uses this to serve a peer's /v1 surface without a
 * second wire implementation.
 * @param options - provider id, label, base URL, bearer key, optional static catalog and timeout.
 * @returns the adapter instance to hand to hosts.llm().registerAdapter([providerId], adapter).
 */
export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleAdapterOptions): OpenAiCompatibleLlmAdapter {
  if (options === null || typeof options !== 'object') throw new TypeError('createOpenAiCompatibleAdapter: options must be an object')
  const providerId = requireText('providerId', options.providerId)
  const label = options.label === undefined ? providerId : requireText('label', options.label)
  const apiKey = requireText('apiKey', options.apiKey)
  const timeoutMs = options.timeoutMs === undefined ? LIMITS.timeoutMs : options.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('createOpenAiCompatibleAdapter: timeoutMs must be a positive finite number')
  const catalog = normalizeCatalog(options.models)
  return buildOpenAiCompatibleAdapter({
    providerId,
    label,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    timeoutMs,
    credential: () => apiKey,
    ...(catalog === undefined ? {} : { catalog }),
  })
}

/** Build the adapter bindModels registers for one models.provide binding. */
function createModelAdapter(activation: BindingActivation, providerId: string): OpenAiCompatibleLlmAdapter {
  const capability = activation.declaration.capabilities.find((entry) => entry.kind === 'models.provide')
  return buildOpenAiCompatibleAdapter({
    providerId,
    label: capability?.as?.label ?? activation.declaration.name,
    baseUrl: activation.baseUrl.replace(/\/+$/, ''),
    timeoutMs: activation.limits.timeoutMs > 0 ? activation.limits.timeoutMs : LIMITS.timeoutMs,
    credential: () => {
      const credential = activation.credential()
      if (credential === undefined) throw new Error('provider ' + JSON.stringify(providerId) + ': the adapter credential is no longer available; disconnect and connect again')
      return credential
    },
  })
}

/**
 * Bind every models.provide binding to the kernel llm registry.
 * @param options - core, runtime, host accessors and one log line sink.
 * @returns the disposer that releases every registration and stops listening.
 */
export function bindModels(options: BindModelsOptions): () => void {
  const { core, runtime, hosts, log } = options
  const seam = runtimeInternals(runtime)
  const registrations = new Map<string, { binding: BindingState; dispose(): void }>()
  const deferred = new Map<string, BindingActivation>()

  /** Register one active binding; a missing llm service defers instead of failing the mount. */
  function start(activation: BindingActivation): void {
    const adapterId = activation.adapterId
    if (registrations.has(adapterId)) return
    const llm = hosts.llm?.()
    if (llm === undefined || llm === null) {
      deferred.set(adapterId, activation)
      log('model provider for adapter ' + adapterId + ' is deferred: the llm service is not mounted yet')
      return
    }
    const providerId = activation.binding.providerId ?? activation.declaration.id
    if (activation.binding.peerLinkId !== undefined && activation.credential() === undefined) {
      log('peer model binding ' + activation.binding.id + ' carries no bearer credential in the runtime; bindModels leaves provider ' + providerId + ' to the ingress')
      return
    }
    const handle = llm.registerAdapter([providerId], createModelAdapter(activation, providerId))
    deferred.delete(adapterId)
    registrations.set(adapterId, {
      binding: activation.binding,
      dispose() {
        try {
          handle()
        } catch (error) {
          log('releasing the model provider ' + providerId + ' failed: ' + (error instanceof Error ? error.message : String(error)))
        }
      },
    })
    log('model provider ' + providerId + ' registered from adapter ' + adapterId)
  }

  /** Release one binding's registration. */
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
      if (!Array.isArray(binding.caps) || !binding.caps.includes('models.provide')) continue
      active.set(binding.adapterId, binding)
    }
    for (const [adapterId, registration] of [...registrations]) {
      if (active.has(adapterId)) continue
      registrations.delete(adapterId)
      registration.dispose()
      log('model provider for adapter ' + adapterId + ' released: the binding is no longer active')
    }
    for (const [adapterId, activation] of [...deferred]) {
      if (!active.has(adapterId)) {
        deferred.delete(adapterId)
        continue
      }
      try {
        start(activation)
      } catch (error) {
        log('deferred model registration for adapter ' + adapterId + ' failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  const binder: CapabilityBinder = {
    name: 'models',
    caps: ['models.provide'],
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
