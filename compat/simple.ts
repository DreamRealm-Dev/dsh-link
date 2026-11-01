/**
 * The compat loader's simple layer: several kernel steps collapsed into one call, and
 * kernel objects projected into plain data.
 *
 * This is the second half of the two-interface strategy. Interface A hands over the kernel's
 * own object ("you own compatibility with that kernel"); Interface B hands over a capability
 * whose members are named by role words. Neither reduces the *number of steps* a plugin has to
 * write, and neither turns a kernel object into something a plugin can store, compare or log.
 * That is what this module is for: one call in, plain data out.
 *
 * The invariant this file exists to keep: **only capability names and role words appear here**.
 * A role word is a neutral noun («register», «readSession») chosen by the vocabulary; the kernel
 * member it currently binds to is data in a per-kernel section (compat/table/) and must never be
 * spelled in this file. That is what lets a table move a role to a different member, or to a
 * different service, without this file changing. scripts/verify-compat-simple-role-words.mjs
 * proves it mechanically, and proves the check can go red.
 *
 * Absence is explicit, never silent. Asking for something whose capability this kernel does not
 * resolve throws {@link UnsupportedError} from the loader, with the capability, the kernel, the
 * reason and a suggestion. A caller that would rather degrade asks {@link SimpleSurface.available}
 * first — that method never throws — and decides for itself. Nothing here substitutes a default
 * for a missing capability: a plugin that thought it had registered a tool and did not would be
 * the exact class of failure this project keeps finding.
 *
 * @module dsh-link-compat/simple
 */

/** The loader surface this layer needs: capability names in, role-keyed objects out. */
export interface CapabilitySource {
  /** Kernel identity, for refusal messages. */
  readonly kernel: string
  /** Whether «require(name)» would return a value; never throws. */
  has(name: string): boolean
  /** The converged object for a capability; throws when the capability is not honoured. */
  require(name: string): unknown
}

/** One session, as plain data. */
export interface SimpleSession {
  /** Session identity. */
  readonly id: string
  /** Human title, when the kernel carries one. */
  readonly title: string | null
  /** Last-write timestamp, when the kernel carries one. */
  readonly updatedAt: number | null
  /** Number of entries in the stored log, when the anchor session shows what an entry looks like. */
  readonly entries: number | null
  /** Byte size of the stored log, when the kernel returns one. */
  readonly bytes: number | null
}

/** What one {@link SimpleTools.add} produced. */
export interface SimpleToolHandle {
  /** Tool name as registered. */
  readonly name: string
  /** Unregister this tool; idempotent. */
  readonly dispose: () => void
  /** Plain summary of the definition that was registered. */
  readonly definition: { readonly name: string; readonly description: string; readonly parameters: readonly string[] }
}

/** A tool body, plus the metadata a caller may want to keep out of the boilerplate. */
export interface SimpleToolSpec {
  /** Description sent to the model; defaults to the tool name. */
  readonly description?: string
  /** Per-property parameter spec; defaults to an open object with no declared properties. */
  readonly parameters?: Record<string, unknown>
  /** Canonical output spec; defaults to unconstrained lossless JSON. */
  readonly output?: Record<string, unknown>
  /** Render one validated value as model content; defaults to its JSON text. */
  readonly render?: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
  /** The body. */
  readonly execute: (args: Record<string, unknown>, exec?: unknown) => unknown
}

/** What one {@link SimpleSettings.define} produced. */
export interface SimpleSettingDeclaration {
  /** Namespace the caller declared. */
  readonly key: string
  /** What happened, as a word a caller can branch on. */
  readonly status: 'applied' | 'already-present' | 'rejected' | 'unreadable'
  /** The kernel's own message when the declaration did not apply, else null. */
  readonly reason: string | null
  /** Whether this kernel reports a schema for the namespace. */
  readonly schemaReadable: boolean
  /** Whether the caller passed a schema. This kernel's settings role exposes schemas for reading,
   * so a passed schema is recorded rather than installed; dropping it silently would be worse. */
  readonly schemaAccepted: boolean
}

/** The three entry points, plus a non-throwing availability probe. */
export interface SimpleSurface {
  /**
   * One call for "the recent sessions, as plain rows".
   *
   * R237 note, because the name is misleading and the MD asks for something else: this returns
   * SESSIONS, and its first argument only anchors the projection (the capabilities' row keys are read
   * off the session it names). It is not `session.getRecentMessages`: no message is returned. A caller
   * that wants a session's recent messages has no call here yet - the gap is named in
   * plugins/../docs/handoff/R221-md-gaps.md rather than hidden behind a name that suggests it works.
   */
  readonly sessions: {
    recent(sessionId: string, limit?: number): Promise<SimpleSession[]>
  }
  /** One call for "register a tool". */
  readonly tools: {
    add(name: string, handler: SimpleToolSpec | SimpleToolSpec['execute']): SimpleToolHandle
    /** Whether a tool name is registered, without the caller reading the registry itself. */
    has(name: string): boolean
    /** Registered tool names, as plain strings. */
    names(): string[]
  }
  /** One call for "declare this setting". */
  readonly settings: {
    define(key: string, defaultValue: unknown, schema?: unknown): Promise<SimpleSettingDeclaration>
  }
  /** Which entry points this kernel can honour; never throws. */
  available(): { sessions: boolean; tools: boolean; settings: boolean }
  /** Unregister everything {@link sessions} … {@link tools} registered, for plugin teardown. */
  dispose(): void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** First present key of a record, or undefined. */
const pick = (record: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) if (record[key] !== undefined) return record[key]
  return undefined
}

/** A finite timestamp out of whatever the kernel calls it. */
const asTime = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

/** How many entries a stored log holds, counted structurally rather than by knowing the format. */
const countEntries = (log: unknown): number | null => {
  if (Array.isArray(log)) return log.length
  if (isRecord(log)) {
    for (const key of ['entries', 'events', 'records', 'lines']) {
      const value = log[key]
      if (Array.isArray(value)) return value.length
    }
  }
  return null
}

/** Byte size of whatever the kernel returned, as plain data. */
const sizeOf = (log: unknown): number | null => {
  if (log === undefined || log === null) return null
  if (typeof log === 'string') return Buffer.byteLength(log)
  if (isRecord(log) || Array.isArray(log)) {
    try {
      return Buffer.byteLength(JSON.stringify(log))
    } catch {
      return null
    }
  }
  return null
}

/**
 * Build the simple layer over one loader.
 *
 * @param source - the loader's capability surface.
 * @returns the three entry points and their availability probe.
 */
export function createSimpleLayer(source: CapabilitySource): SimpleSurface {
  const registered = new Map<string, () => void>()

  /** The capability, or the loader's own typed refusal. No default is substituted. */
  const capability = (name: string): Record<string, unknown> => source.require(name) as Record<string, unknown>

  const sessions: SimpleSurface['sessions'] = {
    async recent(sessionId: string, limit = 10): Promise<SimpleSession[]> {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new RangeError('simple.sessions.recent: limit must be a positive integer, got ' + String(limit))
      }
      const store = capability('store')
      const list = store.listSessions
      if (typeof list !== 'function') throw new TypeError('simple.sessions.recent: the store capability has no listSessions role')

      // The anchor is read first so the projection follows the shape this kernel actually stores,
      // instead of a shape this file assumed. A missing anchor is not fatal: the list still works.
      const read = store.readSession
      let anchor: unknown
      if (typeof read === 'function') {
        try {
          anchor = await (read as (id: string) => unknown)(sessionId)
        } catch {
          anchor = undefined
        }
      }
      const anchorKeys = isRecord(anchor) ? Object.keys(anchor) : []

      const listed: unknown = await (list as () => unknown)()
      const rows: unknown[] = Array.isArray(listed)
        ? listed
        : Array.isArray((listed as { sessions?: unknown[] } | undefined)?.sessions)
          ? (listed as { sessions: unknown[] }).sessions
          : []

      const plain = rows.filter(isRecord).map((row) => ({
        id: String(pick(row, ['id', 'sessionId', 'session', ...anchorKeys]) ?? ''),
        title: (pick(row, ['title', 'name', 'summary', ...anchorKeys]) as string | undefined) ?? null,
        updatedAt: asTime(pick(row, ['updatedAt', 'updated', 'mtime', 'modifiedAt', 'at'])),
        // Always null here: the list role carries summaries, not stored logs. A caller that
        // needs the size asks for one session; this call stays one call.
        entries: anchorKeys.length > 0 ? countEntries(pick(row, anchorKeys)) : null,
        bytes: null,
      }))
      const ordered = [...plain].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      return ordered.slice(0, limit).map((row) => ({
        id: row.id,
        title: typeof row.title === 'string' ? row.title : null,
        updatedAt: row.updatedAt,
        entries: row.entries,
        bytes: row.bytes,
      }))
    },
  }

  const tools: SimpleSurface['tools'] = {
    add(name: string, handler: SimpleToolSpec | SimpleToolSpec['execute']): SimpleToolHandle {
      if (typeof name !== 'string' || name === '') throw new TypeError('simple.tools.add: name must be a non-empty string')
      const capabilityObject = capability('tools')
      const register = capabilityObject.register
      if (typeof register !== 'function') throw new TypeError('simple.tools.add: the tools capability has no register role')
      const spec: SimpleToolSpec = typeof handler === 'function' ? { execute: handler } : handler
      if (typeof spec.execute !== 'function') throw new TypeError('simple.tools.add: a tool needs an execute function')

      const description = typeof spec.description === 'string' && spec.description !== '' ? spec.description : name
      const parameters = spec.parameters ?? {}
      // The default must be the unconstrained form the kernel's raw-task rule accepts: an object schema with
      // NO `type` key (cordis-host-runner/src/guard.ts:407-411 turns that into `json`), because the same rule
      // rejects `type: 'json'` outright (:412). The earlier default made every call without an explicit
      // `output` throw, contradicting the documented "unconstrained lossless JSON". R92.
      const output = spec.output ?? {}
      const render = spec.render ?? ((_args: unknown, value: unknown) => [{
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      }])

      // The boilerplate this call exists to remove: the four-field definition the registry wants,
      // the default output contract, and the disposal bookkeeping below.
      const definition = {
        name,
        description,
        parameters,
        output: { schema: output, render },
        execute: (args: Record<string, unknown>, exec?: unknown) => spec.execute(args, exec),
      }
      const dispose = (register as (value: unknown) => () => void)(definition)
      const once = (): void => {
        if (!registered.has(name)) return
        registered.delete(name)
        dispose()
      }
      registered.set(name, once)
      return {
        name,
        dispose: once,
        definition: { name, description, parameters: Object.keys(parameters) },
      }
    },

    has(name: string): boolean {
      if (!source.has('tools')) return false
      const capabilityObject = capability('tools')
      const lookup = capabilityObject.lookup
      if (typeof lookup === 'function') return (lookup as (name: string) => unknown)(name) !== undefined
      return registered.has(name)
    },

    names(): string[] {
      if (!source.has('tools')) return []
      const capabilityObject = capability('tools')
      const schemas = capabilityObject.schemas
      if (typeof schemas === 'function') {
        const listed = (schemas as () => unknown)()
        const rows = Array.isArray(listed) ? listed : []
        return rows.map((row) => (isRecord(row) ? String(row.name ?? '') : '')).filter((value) => value !== '')
      }
      return [...registered.keys()]
    },
  }

  const settings: SimpleSurface['settings'] = {
    async define(key: string, defaultValue: unknown, _schema?: unknown): Promise<SimpleSettingDeclaration> {
      if (typeof key !== 'string' || key === '') throw new TypeError('simple.settings.define: key must be a non-empty string')
      const capabilityObject = capability('settings')
      const schemaAccepted = _schema !== undefined

      // Three kernel steps, one call: is the namespace known, does it carry a schema, and is the
      // default value actually there. Each answer is plain data, and a kernel refusal is reported
      // as a status rather than thrown away — a declaration that silently did nothing is the
      // failure mode this project keeps finding.
      let described: unknown
      if (typeof capabilityObject.describe === 'function') {
        try {
          described = (capabilityObject.describe as () => unknown)()
        } catch {
          described = undefined
        }
      }
      const rows = Array.isArray(described) ? described.filter(isRecord) : []
      const existing = rows.find((row) => pick(row, ['ns', 'key', 'name']) === key)

      let schemaReadable = false
      if (typeof capabilityObject.schema === 'function') {
        try {
          schemaReadable = (capabilityObject.schema as (entry: unknown) => unknown)(existing ?? key) !== undefined
        } catch {
          schemaReadable = false
        }
      }

      if (existing === undefined) {
        if (typeof capabilityObject.update !== 'function') {
          return { key, status: 'unreadable', reason: 'the settings capability has no update role', schemaReadable, schemaAccepted }
        }
        try {
          await (capabilityObject.update as (ns: string, patch: object) => Promise<void>)(key, defaultValue as object)
          return { key, status: 'applied', reason: null, schemaReadable, schemaAccepted }
        } catch (error) {
          return { key, status: 'rejected', reason: String((error as { message?: unknown })?.message ?? error), schemaReadable, schemaAccepted }
        }
      }
      return {
        key,
        status: 'already-present',
        reason: null,
        schemaReadable,
        schemaAccepted,
      }
    },
  }

  return Object.freeze({
    sessions,
    tools,
    settings,
    available(): { sessions: boolean; tools: boolean; settings: boolean } {
      return { sessions: source.has('store'), tools: source.has('tools'), settings: source.has('settings') }
    },
    dispose(): void {
      for (const dispose of [...registered.values()]) dispose()
    },
  })
}
