/**
 * dsh-link-panel — the panel item registry's floor. Host half only.
 *
 * ## What this is
 *
 * "What is in the panel" has to be DATA. This row owns exactly three things, and nothing else:
 *
 *   1  an ITEM is data: { id, kind, title, source, order }, and `kind` is drawn from a CLOSED set.
 *      Nothing in this file reads a clock, an environment variable, a locale or the network.
 *   2  the PROJECTION is a pure function: `projectPanel(entries, { sinks })` returns the sorted
 *      visible items plus every refused item, each carrying the name of its refusal. Two arrival
 *      orders of the same registry project to the same bytes.
 *   3  a REFUSAL is NAMED: PANEL_DUP_ID / PANEL_UNKNOWN_KIND / PANEL_EMPTY_SOURCE are the whole
 *      family (R188-contract.md §9 R3). Everything else that gets refused keeps its own text and
 *      carries `code: null` — a second name for a fact that already has a name is a second
 *      opinion about that fact, and this project has paid for those twice.
 *
 * ## What this is NOT (the boundaries this round draws, and why)
 *
 *   no client half     There is no browser half, no shell, no rendering: `client: null` in
 *                      plugins/build.mjs and no `dsh.client` in package.json. The panel shell IS
 *                      a client half, and R188 proves the client-delivery chain first (§3.2 D1)
 *                      rather than betting this round on the one thing that has never been
 *                      measured. The consequence is visible in the data below and not hidden:
 *                      with no shell, NO sink is mounted, so every declared item is refused at
 *                      projection time with "which sink is missing" as the reason.
 *   no persistence     Items are configuration, re-read at mount. Nothing is written to disk and
 *                      no store exists, because a store would be a second answer to "what is in
 *                      the registry" while the first one (the composition) is already readable.
 *   no write surface   GET is the only verb. A registration endpoint would need an authorization
 *                      story of its own, and a registry that can be rewritten at run time is a
 *                      different, much larger subject than the floor this round lays.
 *
 * ## Where items come from
 *
 * Row config: `config.entries`. That means "what is in the panel" is visible in the composition
 * itself — the rows a reader can already read — instead of being assembled by code at run time.
 * `config.sinks` names the sinks a shell has actually MOUNTED; it defaults to the empty list,
 * which is today's truth and not a placeholder. The route reports both readings side by side so
 * that "the registry declares nothing" and "the shell can show nothing" can never be confused.
 *
 * ## Which face registers the route (R197-contract.md §2 P2)
 *
 * The one read-only route used to have a single face: the context's own `webServer`. It now has a
 * preferred one — `ctx.link.compat.capability('http').registerRoute(...)`, the vocabulary role
 * `http.registerRoute` of the cross-version loader `dsh-link-compat` — and keeps the old one as the
 * fallback for every world that has no loader. The loader is read with `ctx.get('link')` AT THE MOMENT
 * OF REGISTRATION: it is never named in `inject`, so this row never waits for a loader that may never
 * mount and never fails to load in a world without one, and `ctx.link` is never dereferenced as a
 * property (in cordis that read is an error, which is the exact failure this row must not have).
 *
 * THAT MOMENT IS THE SERVER'S ARRIVAL, NOT `apply()`. In the live client `apply()` runs before the web
 * application mounts, and a loader asked then can only answer about a world that has not mounted; the
 * route it would take cannot be served yet either. So the binding is one function, run from `apply()`
 * and again from this row's own `ctx.inject(['webServer'])` retry, and it asks nothing at all while the
 * web server is still pending — a refusal is only ever published for a world that was actually there.
 *
 * THE HANDLE IS KEYED BY ROLE WORD, NOT BY KERNEL MEMBER. `capability('http')` is
 * `{ registerRoute, renderIndex }`; the table's `binds[]` row (`role: http.registerRoute -> member:
 * register`) names the kernel member that ROLE resolves to, never a key of the handle. Asking the
 * handle for `.register` therefore finds nothing, which is how the first real customer refused live
 * (R197-contract.md §1, the correction measured in a booted kernel: "the customer had simply asked by
 * the wrong word"). [PANEL_COMPAT_MEMBER] is derived from the role by the loader's own rule.
 *
 * The route's own answer names which face bound it — `compat: { present, via, role, refused }` — and a
 * loader that is there but refuses is reported with its OWN text in `refused` while the route still
 * binds through `ctx.server`. The fallback is not a degraded mode: it is the same route, the same
 * handler and the same answer with a different registration behind it.
 *
 * The route's shape follows plugins/dsh-link-teams' `GET /api/dsh-link-teams/state`
 * (lib/index.js:38 the default path, :43-49 sendJson, :88-163 the snapshot builder, :165-188 the
 * GET/HEAD-only handler with its named 405, :196-207 the lazy webServer binding and its retry,
 * :229 the ready line). Nothing is copied blindly: what is copied is that this surface answers
 * exactly one read-only question and names what it cannot answer.
 */

export const name = 'dsh-link-panel'

/** Nothing is injected at apply time: the web server is looked up lazily, exactly like the teams row. */
export const inject = []

/**
 * The closed set of item kinds.
 *
 * Closed means closed. An item whose kind is not one of these is refused BY NAME
 * (PANEL_UNKNOWN_KIND) and is never translated to the nearest kind this build happens to know:
 * a newer plugin declaring a kind from a newer round must appear as a HOLE, not as an item drawn
 * in the wrong place. Every kind here has a sink in PANEL_KIND_SINKS; a kind without one could
 * not be shown even if it were admitted, which is the second reason the set is closed.
 */
export const PANEL_KINDS: readonly string[] = Object.freeze(['pane', 'action', 'status'])

/**
 * The named refusals — the WHOLE family (R188-contract.md §9 R3).
 *
 * These three names are the vocabulary a reader, a gate and the panel shell share. The contract
 * froze three; this file refuses to invent a fourth, so everything else that gets refused carries
 * the original text and `code: null`.
 */
export const PANEL_REJECT = Object.freeze({
  DUP_ID: 'PANEL_DUP_ID',
  UNKNOWN_KIND: 'PANEL_UNKNOWN_KIND',
  EMPTY_SOURCE: 'PANEL_EMPTY_SOURCE',
})

/**
 * Where a panel item can be shown.
 *
 * Two places exist among LINK's own surfaces today: the right rail, which carries the panes this
 * project already ships (dsh-link-teams is the reference), and the notice area the lan-bridge
 * card uses for state a person should see without opening anything.
 */
export const PANEL_SINKS: readonly string[] = Object.freeze(['right-rail', 'header'])

/**
 * kind -> sink, as data in one place.
 *
 * "Where does a status item go" is answerable without running a shell, and the answer is not a
 * branch inside the projection: a kind that is not in PANEL_KINDS has no entry here at all, which
 * is the same fact (it cannot be shown) stated once.
 */
export const PANEL_KIND_SINKS: Readonly<Record<string, string>> = Object.freeze({
  pane: 'right-rail',
  action: 'right-rail',
  status: 'header',
})

/** Where the read-only state is served. Overridable by row config (`config.path`). */
export const PANEL_ROUTE_PATH = '/api/dsh-link-panel/state'

/**
 * The face that bound the route, as the answer names it: the cross-version loader's `http` capability
 * (R197-contract.md §2 P2), which is preferred whenever it is there.
 */
export const PANEL_VIA_LOADER = 'link.compat'

/** The face with no loader behind it: the context's own web server, which is the fallback and not a lesser route. */
export const PANEL_VIA_SERVER = 'ctx.server'

/**
 * The vocabulary role `PANEL_VIA_LOADER` binds — the member the loader resolves for it is
 * `webServer.register` (dsh-link-compat's table, `lib/index.js:120-135`). The plain face binds no
 * vocabulary at all, so it reports `null` rather than borrowing a name it did not use.
 */
export const PANEL_COMPAT_ROLE = 'http.registerRoute'

/** The loader's own rule for a role word (dsh-link-compat's `roleWord`): everything after the first dot. */
function roleWord(role: string): string {
  const at = role.indexOf('.')
  return at === -1 ? role : role.slice(at + 1)
}

/**
 * The member a capability handle names [PANEL_COMPAT_ROLE] by: the ROLE WORD, never the kernel member.
 *
 * `capability('http')` hands out `{ registerRoute, renderIndex }` — measured in a booted kernel
 * (R197-contract.md §1), where asking for the table's member name `.register` left the handle empty and
 * the customer fell back to `ctx.server` for no reason but a wrong word. Derived from the role above
 * with the loader's own rule, so the two can never drift apart.
 */
export const PANEL_COMPAT_MEMBER = roleWord(PANEL_COMPAT_ROLE)

const KIND_SET: Set<string> = new Set(PANEL_KINDS)
const SINK_SET: Set<string> = new Set(PANEL_SINKS)
/** The kind an unknown one must NOT be translated to — named here so a mutant has something to aim at. */
const FALLBACK_KIND: string = PANEL_KINDS[0]
/** The fixed precedence for a record that carries several codes: named refusals are reported loudest-first. */
const PRECEDENCE: readonly string[] = Object.freeze([PANEL_REJECT.UNKNOWN_KIND, PANEL_REJECT.EMPTY_SOURCE, PANEL_REJECT.DUP_ID])
/** The five frozen fields, in the order they are read. */
const FIELDS: readonly string[] = Object.freeze(['id', 'kind', 'title', 'source', 'order'])

/** One panel item, exactly as the registry reports it: five fields, no more. */
export interface PanelEntry {
  id: string
  kind: string
  title: string
  source: string
  order: number
}

/** One refused item: what it claimed, the named code (or null when the text is the whole story), and why. */
export interface PanelRejection {
  id: string | null
  code: string | null
  detail: string
  entry: PanelEntry
}

interface PanelOptions {
  sinks?: readonly string[]
  strict?: boolean
}

/** JSON for every value a reader may meet, with NaN/Infinity printed as themselves rather than as null. */
function show(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) === false) return String(value)
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text
}

/** Code-unit order. Not localeCompare: a projection whose order depends on the machine's locale is not pure. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The sort key of a record: ties are broken by DATA, never by arrival order. */
function canonical(value: unknown): string {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text
}

/** One field read without letting a getter's own throw escape as anything but the text it threw. */
function readField(holder: Record<string, unknown>, key: string): { value: unknown; error: string | null } {
  try {
    return { value: holder[key], error: null }
  } catch (error) {
    return { value: null, error: 'reading ' + key + ' threw: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

interface Portable {
  value: unknown
  note: string | null
}

/**
 * Carry one field value into the projection.
 *
 * The five fields are SCALARS, so only what a field can legitimately hold travels as itself: a
 * string, a finite number, a boolean, null. Everything else is carried as null AND named in the
 * refusal text — carrying a structured value as its own String() would launder it into a string
 * that then passes the "non-empty source" check, which is how a registry starts accepting things
 * nobody validated.
 */
function portable(value: unknown): Portable {
  if (value === null || value === undefined) return { value: null, note: null }
  const type = typeof value
  if (type === 'string' || type === 'boolean') return { value, note: null }
  if (type === 'number') return { value: Number.isFinite(value as number) ? value : null, note: Number.isFinite(value as number) ? null : 'a field is a scalar and this number is not finite; it is carried as null: ' + show(value) }
  return { value: null, note: 'a field is a scalar and this one is not; it is carried as null: ' + show(value) }
}

interface ReadItem {
  entry: PanelEntry
  errors: string[]
}

/** Read one raw item into the five frozen fields, collecting every reason it is not one. Never throws. */
function normalizeEntry(raw: unknown): ReadItem {
  const errors: string[] = []
  const holder = raw !== null && (typeof raw === 'object' || typeof raw === 'function') ? (raw as Record<string, unknown>) : null
  if (holder === null) errors.push('the item is not an object: ' + show(raw))
  const fields: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (holder === null) {
      fields[key] = null
      continue
    }
    const read = readField(holder, key)
    if (read.error !== null) errors.push(read.error)
    const carried = portable(read.value)
    if (carried.note !== null) errors.push(key + ': ' + carried.note)
    fields[key] = carried.value
  }
  // The three shape rules with no name of their own: their text is the refusal, and it is specific.
  if (typeof fields.id !== 'string' || fields.id.trim() === '') errors.push('id must be a non-empty string (got ' + show(fields.id) + ')')
  if (typeof fields.title !== 'string' || fields.title.trim() === '') errors.push('title must be a non-empty string (got ' + show(fields.title) + ')')
  if (typeof fields.order !== 'number' || Number.isFinite(fields.order) === false) errors.push('order must be a finite number (got ' + show(fields.order) + ')')
  return { entry: fields as unknown as PanelEntry, errors }
}

/**
 * The closed-set gate for one item's kind — written as ONE statement, on purpose.
 *
 * This is the line an unknown kind must fail at, and it is the line a gate mutates to prove the
 * readings can move (the mutation "translate the unknown kind to the nearest one" lives here).
 * A guard that cannot be made to fail was never a guard.
 */
function refusalOfKind(entry: PanelEntry): string | null {
  if (!KIND_SET.has(entry.kind)) return PANEL_REJECT.UNKNOWN_KIND
  return null
}

interface Issue {
  code: string | null
  detail: string
}

/** Fold one item's issues into the single record the projection reports for it. */
function refusalOf(entry: PanelEntry, issues: Issue[]): PanelRejection {
  const code = PRECEDENCE.find((name) => issues.some((issue) => issue.code === name)) ?? null
  const id = typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : null
  return { id, code, detail: issues.map((issue) => issue.detail).join('; '), entry: { ...entry } }
}

/** The sinks this projection has mounted. Omitted means "all of them": the registry's own view. */
function mountedSet(sinks: unknown): Set<string> {
  if (sinks === undefined || sinks === null) return new Set(PANEL_SINKS)
  if (Array.isArray(sinks) === false) {
    throw new TypeError('projectPanel: options.sinks must be an array of sink names (got ' + show(sinks) + ')')
  }
  return new Set(sinks as string[])
}

/**
 * Thrown by the strict projection. It is an ERROR, not a code: `code` is one of the three frozen
 * names or null, never a fourth name, and `rejected` carries the whole refusal list so a caller
 * that wants to report all of them does not have to project twice.
 */
export class PanelRefusal extends Error {
  code: string | null
  rejected: PanelRejection[]

  constructor(rejected: PanelRejection[]) {
    const code = PRECEDENCE.find((candidate) => rejected.some((row) => row.code === candidate)) ?? null
    super(
      'panel projection refused ' + String(rejected.length) + ' item(s)'
      + (code === null ? ' (none of the three named codes: the original text is carried below)' : ' by ' + code)
      + ': ' + rejected.map((row) => 'id ' + show(row.id) + ' [' + String(row.code ?? 'no code') + '] ' + row.detail).join(' | '),
    )
    this.name = 'PanelRefusal'
    this.code = code
    this.rejected = rejected
  }
}

/**
 * Project a registry into what a shell with the named sinks mounted would show.
 *
 * Pure: no clock, no environment, no locale, no I/O. Same input, same bytes out — including for
 * two different ARRIVAL ORDERS of the same items, which is why the sort keys are data
 * (order, then the item's own JSON) and why a duplicated id refuses EVERY claimant instead of
 * letting the first one win.
 *
 * Two channels, one truth (R188-contract.md §9 R3):
 *   - default            returns { visible, rejected }: an item that is refused is NAMED in
 *                        `rejected` and never appears in `visible`. An empty registry returns an
 *                        empty projection — an empty panel is legal, a thrown error is not.
 *   - { strict: true }   THROWS PanelRefusal for every refused item that carries a name, listing
 *                        them in the message. The world-refusals (a sink that is not mounted) never
 *                        throw even here: the item is fine, the shell is not there yet.
 */
export function projectPanel(entries: unknown, options: PanelOptions = {}): { visible: PanelEntry[]; rejected: PanelRejection[] } {
  if (Array.isArray(entries) === false) {
    throw new TypeError('projectPanel: entries must be an array (got ' + show(entries) + ') — a registry is data, and a caller that hands it something else has a bug, not a refused item')
  }
  const settings: PanelOptions = options !== null && typeof options === 'object' ? options : {}
  const mounted = mountedSet(settings.sinks)
  const read = (entries as unknown[]).map((raw) => normalizeEntry(raw))

  /**
   * Who claims which id, and the orders they claimed it in.
   *
   * No arrival index is kept: an index would make two permutations of the same registry project
   * to different bytes, and "order-insensitive" is a property of the output, not of the code path.
   */
  const claimants = new Map<string, string[]>()
  for (const item of read) {
    const id = item.entry.id
    if (typeof id !== 'string' || id.trim() === '') continue
    const list = claimants.get(id) ?? []
    list.push(String(item.entry.order))
    claimants.set(id, list)
  }

  const visible: PanelEntry[] = []
  const rejected: PanelRejection[] = []

  for (const item of read) {
    const entry = item.entry
    const issues: Issue[] = []
    for (const text of item.errors) issues.push({ code: null, detail: text })

    // The closed set, by name. An unknown kind is refused HERE and never translated (see refusalOfKind).
    const unknownKind = refusalOfKind(entry)
    if (unknownKind !== null) {
      issues.push({ code: unknownKind, detail: 'unknown kind ' + show(entry.kind) + '; the closed set is ' + PANEL_KINDS.join(', ') })
    }

    if (typeof entry.source !== 'string' || entry.source.trim() === '') {
      issues.push({
        code: PANEL_REJECT.EMPTY_SOURCE,
        detail: 'source is empty (got ' + show(entry.source) + '): an item that cannot say where it comes from is not showable',
      })
    }

    const claims = claimants.get(entry.id) ?? []
    if (claims.length > 1) {
      issues.push({
        code: PANEL_REJECT.DUP_ID,
        detail: 'duplicate id ' + show(entry.id) + ': ' + String(claims.length) + ' items claim it (order ' + [...claims].sort(compareText).join(', ')
          + '); every claimant is refused, because keeping one would let arrival order decide what the panel shows',
      })
    }

    if (issues.length === 0) {
      const sink = PANEL_KIND_SINKS[entry.kind] ?? null
      if (sink === null || mounted.has(sink) === false) {
        issues.push({
          code: null,
          detail: 'kind ' + show(entry.kind) + ' is shown in sink ' + show(sink) + ', which this projection does not have mounted (mounted: '
            + [...mounted].sort(compareText).join(', ') + ')',
        })
      }
    }

    if (issues.length === 0) visible.push(entry)
    else rejected.push(refusalOf(entry, issues))
  }

  visible.sort((a, b) => (a.order - b.order) || compareText(canonical(a), canonical(b)))
  rejected.sort((a, b) => compareText(canonical(a), canonical(b)))

  if (settings.strict === true) {
    const named = rejected.filter((row) => row.code !== null)
    if (named.length > 0) throw new PanelRefusal(named)
  }
  return { visible, rejected }
}

/** Ask the strict projection whether a batch is admissible: true, or the refusal with every offender listed. */
export function admitsPanel(entries: unknown, options: PanelOptions = {}): true | PanelRefusal {
  try {
    projectPanel(entries, { ...(options ?? {}), strict: true })
    return true
  } catch (error) {
    if (error instanceof PanelRefusal) return error
    throw error
  }
}

/** Row config as data: `config.entries` is the registry, and a list that is not a list is refused at mount. */
function readEntries(value: unknown): PanelEntry[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value) === false) {
    throw new Error('dsh-link-panel: config.entries must be an array of panel items, got ' + show(value)
      + ' — a row that declares something else is refused at mount, because an empty panel and a broken one must not look the same')
  }
  return value as PanelEntry[]
}

/** `config.sinks`: the sinks a shell has mounted HERE. Absent means none, which is today's truth. */
function readMounted(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value) === false) {
    throw new Error('dsh-link-panel: config.sinks must be an array of sink names, got ' + show(value))
  }
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string' || SINK_SET.has(entry) === false) {
      throw new Error('dsh-link-panel: config.sinks names an unknown sink ' + show(entry) + '; this build knows ' + PANEL_SINKS.join(', ')
        + ' — a misspelled sink would silently show an empty panel, so it is refused')
    }
  }
  return value as string[]
}

function sendJson(res: any, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

export function apply(ctx: any, config: any = {}): void {
  const settings = config ?? {}
  const path = typeof settings.path === 'string' && settings.path.startsWith('/') ? settings.path : PANEL_ROUTE_PATH
  const items = readEntries(settings.entries)
  const sinksMounted = readMounted(settings.sinks)

  const disposers: Array<() => void> = []
  let bound = false
  let served = 0
  let refused = 0

  /**
   * Which face bound the route, frozen when it bound (R197-contract.md §2 P2).
   *
   * Four values every answer repeats: `present` is the loader's consumer face as read at registration,
   * `via` is the face that actually took the route (`link.compat` or `ctx.server`), `role` is the
   * vocabulary role that face bound (`http.registerRoute`, or null when no vocabulary was used), and
   * `refused` is the loader's OWN message when it was there and would not take the route.
   */
  const binding: { present: boolean; via: string | null; role: string | null; refused: string | null } = {
    present: false,
    via: null,
    role: null,
    refused: null,
  }

  /**
   * The whole read surface, in one place, with no path that throws past it.
   *
   * Both projections are served side by side, from the same items:
   *   declared  what the registry declares, with every sink this build knows (the registry's view)
   *   mounted   what a shell that has mounted exactly `config.sinks` would show (today's view)
   * Serving only one of them is how "there is nothing in the registry" and "there is no shell to
   * draw it" become the same reading — the confusion this row exists to prevent.
   */
  function snapshot(): { status: number; body: unknown } {
    const declared = projectPanel(items, { sinks: PANEL_SINKS })
    const mounted = projectPanel(items, { sinks: sinksMounted })
    return {
      status: 200,
      body: {
        ok: true,
        // Only the ROUTE reads a clock; the projection never does, so nothing here can make the
        // projection's own bytes differ between two calls.
        at: Date.now(),
        path,
        readOnly: true,
        registry: {
          entries: items.length,
          kinds: PANEL_KINDS,
          sinks: PANEL_SINKS,
          kindSinks: PANEL_KIND_SINKS,
          sinksMounted,
          route: path,
        },
        declared,
        mounted,
        served: served + 1,
        // Which face carries this route (R197). Appended rather than woven in: every field above keeps
        // the bytes it had in R188, which is what gates 124/127/128 compare this answer by.
        compat: {
          present: binding.present,
          via: binding.via,
          role: binding.role,
          refused: binding.refused,
        },
      },
    }
  }

  async function handler(req: any, res: any): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        refused += 1
        sendJson(res, 405, {
          ok: false,
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'dsh-link-panel state is read-only: GET is the only verb, and ' + String(req.method) + ' was refused',
          },
        })
        return
      }
      const answer = snapshot()
      served += 1
      sendJson(res, answer.status, answer.body)
    } catch (error) {
      refused += 1
      sendJson(res, 500, {
        ok: false,
        error: { code: 'SNAPSHOT_FAILED', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  const route = { kind: 'exact', path, handler }

  /**
   * The loader's consumer face, read NOW and never injected.
   *
   * `ctx.get` is the store read that needs no `inject` entry (vendor cordis `get(name, strict)`), so a
   * world without the loader answers `undefined` — an absence the answer names as `present: false`,
   * never a throw and never a wait. Two different absences are told apart on purpose: no `link` at all
   * is not an event (`refused: null`), while a `link` that is there without a usable `compat` face, or
   * a read that throws, is the loader failing to answer and keeps its own text.
   */
  function loaderFace(): { compat: any | null; refused: string | null } {
    let link: any
    try {
      link = typeof ctx.get === 'function' ? ctx.get('link') : undefined
    } catch (error) {
      return { compat: null, refused: 'reading ctx.get("link") threw: ' + (error instanceof Error ? error.message : String(error)) }
    }
    const face = link === null || link === undefined ? undefined : link.compat
    if (face === null || face === undefined) return { compat: null, refused: null }
    if ((typeof face !== 'object' && typeof face !== 'function') || typeof face.capability !== 'function') {
      return {
        compat: null,
        refused: 'the "link" service on this context carries no compat face with a callable capability member (got ' + show(face) + ')',
      }
    }
    return { compat: face, refused: null }
  }

  /**
   * Hand the route to the loader's `http` capability, or keep the reason it would not take it.
   *
   * The handle is keyed by ROLE WORD ([PANEL_COMPAT_MEMBER]), so the member taken here IS
   * `webServer.register` bound to the kernel's own web server — read through the loader, under the
   * loader's own name for it. What it returns is the route's disposer: the loader is a registration
   * face, never a second owner of the route's lifetime. Nothing in here throws — a refusal comes back
   * as a value, because the route has to survive it.
   */
  function bindThroughLoader(face: any): { ok: boolean; disposer: (() => void) | null; refused: string | null } {
    try {
      const capability = face.capability('http')
      const register = capability === null || capability === undefined ? undefined : capability[PANEL_COMPAT_MEMBER]
      if (typeof register !== 'function') {
        return {
          ok: false,
          disposer: null,
          refused: 'the loader\'s "http" capability has no callable "' + PANEL_COMPAT_MEMBER + '" member for role ' + PANEL_COMPAT_ROLE + ' (got ' + show(register) + ')',
        }
      }
      const disposer = register(route)
      return { ok: true, disposer: typeof disposer === 'function' ? disposer : null, refused: null }
    } catch (error) {
      return { ok: false, disposer: null, refused: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The two lines every successful binding prints: the route line R188 froze, then the face that bound it. */
  function announceBound(): void {
    console.log('[dsh-link-panel] state route bound on ' + path + ' (GET, read-only)')
    console.log('[dsh-link-panel] registration face ' + String(binding.via) + ', role ' + show(binding.role) + ', loader present '
      + String(binding.present) + (binding.refused === null ? '' : ', loader refused: ' + binding.refused))
  }

  /** The context's own web server, once it is mounted and can take a route. Never throws, never waits. */
  function webServer(): any | null {
    const server = ctx.get('webServer')
    return server === undefined || server === null || typeof server.register !== 'function' ? null : server
  }

  // `apply()` can run before the web application mounts, exactly like the teams row: the registration
  // happens when `webServer` is there and again when it appears, and the whole thing is disposed with the
  // row. Disposal is registered through `ctx.effect`, which runs in every plugin shape, so this row does
  // not depend on whether its own return value is collected.
  //
  // R197: THE MOMENT IS THE SERVER'S ARRIVAL. Nothing is asked of the loader while `webServer` is pending:
  // a loader asked then answers about a world that has not mounted, and publishing that answer would name
  // a refusal the loader never made. Once the server is here the loader is tried FIRST and read at that
  // moment rather than injected; a loader that refuses is named in `compat.refused` and the same route
  // binds through `ctx.server` — the fallback a world without a loader takes anyway, so neither path is a
  // mode a reader of the answer has to guess at.
  function registerRoute(): void {
    if (bound) return
    const server = webServer()
    if (server === null) return
    const loader = loaderFace()
    binding.present = loader.compat !== null
    if (loader.compat !== null) {
      const attempt = bindThroughLoader(loader.compat)
      if (attempt.ok) {
        if (attempt.disposer !== null) disposers.push(attempt.disposer)
        bound = true
        binding.via = PANEL_VIA_LOADER
        binding.role = PANEL_COMPAT_ROLE
        binding.refused = null
        announceBound()
        return
      }
      binding.refused = attempt.refused
      console.error('[dsh-link-panel] the loader refused the state route: ' + String(attempt.refused)
        + ' — registering through ' + PANEL_VIA_SERVER + ' instead')
    } else if (loader.refused !== null) {
      binding.refused = loader.refused
      console.error('[dsh-link-panel] the loader could not be read: ' + loader.refused
        + ' — registering through ' + PANEL_VIA_SERVER + ' instead')
    }
    try {
      disposers.push(server.register(route))
      bound = true
      binding.via = PANEL_VIA_SERVER
      binding.role = null
      announceBound()
    } catch (error) {
      console.error('[dsh-link-panel] could not bind the state route: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  registerRoute()
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], () => registerRoute())
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        bound = false
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            /* a route that is already gone is not an error worth reporting */
          }
        }
      },
      'dsh-link-panel: state route',
    )
  }

  const boot = projectPanel(items, { sinks: PANEL_SINKS })
  for (const row of boot.rejected) {
    console.log('[dsh-link-panel] refused ' + String(row.code ?? '(no code)') + ': ' + row.detail)
  }
  console.log('[dsh-link-panel] ready — ' + String(items.length) + ' panel item(s) declared, ' + String(boot.rejected.length) + ' refused, '
    + String(boot.visible.length) + ' visible when every sink is mounted; ' + String(sinksMounted.length) + ' sink(s) mounted here'
    + (sinksMounted.length === 0 ? ' (no client shell this round: every item is declared, none is on screen)' : '')
    + (bound ? '' : ' (route pending webServer)'))
}

export default { name, inject, apply }
