import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * R116 (task-159) W2 driver: the three compat roles inside the REAL mirrored world.
 *
 * It boots the same way scripts/fixtures/t52-boot.mjs does (env interface: marker + the two kernel
 * entry URLs), then calls sessions.recent / tools.add / settings.define on the mounted plugin and
 * writes RAW facts to the marker. It decides nothing: the judge (the gate) owns every expectation.
 *
 * R7 (R116 contract): EVERY reading records isThenable, computed from the value that was actually
 * produced. A missing await turns a reading into a Promise, and the judge refuses any thenable
 * reading loudly - the instrument bug this driver was handed with (three async entry points were
 * called without await, so a Promise was reported as the fact).
 *
 * Call shapes come from the SOURCE (compat/simple.ts), never from a guess:
 *   :173  async recent(sessionId: string, limit = 10): Promise<SimpleSession[]>  -> sessionId is
 *         REQUIRED (arity is 1) and is used only to read an anchor; the list role is not filtered by it.
 *   :107  settings.define(key, defaultValue, schema?): Promise<SimpleSettingDeclaration> -> await.
 *   :222  tools.add(name, spec|execute): SimpleToolHandle -> synchronous, no await.
 *
 * It carries its own liveness CONTROL readings, as the frozen contract requires: the root service
 * dshHomePath is read once after settle and once after dispose, so verify-probe-alive-control can see
 * that the probe was alive in this world rather than merely silent.
 *
 * No input outside the repository is assumed: everything comes from env, and a missing prerequisite
 * exits non-zero with a message instead of failing somewhere deeper.
 */
const marker = process.env.T52_MARKER ?? process.env.R91_MARKER
if (marker === undefined || marker === "") { console.error("acceptance-boot: no marker path (set T52_MARKER)"); process.exit(3) }
const appBootUrl = process.env.T52_APP_BOOT ?? process.env.R91_APP_BOOT
const profileBootUrl = process.env.T52_PROFILE_BOOT ?? process.env.R91_PROFILE_BOOT
if (appBootUrl === undefined || profileBootUrl === undefined) { console.error("acceptance-boot: missing kernel entry URLs (T52_APP_BOOT / T52_PROFILE_BOOT)"); process.exit(3) }
const profile = process.env.T52_PROFILE ?? process.env.R91_PROFILE ?? 'web'
// The marker directory is created rather than assumed: a missing parent turned the first note into a
// fatal ENOENT inside the catch handler, which is the least readable way to say "no such directory".
mkdirSync(dirname(marker), { recursive: true })
const isThenable = (value) => value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'
const preview = (value) => { if (value === undefined) return undefined; try { const text = JSON.stringify(value); return text === undefined ? String(value) : text.length > 300 ? text.slice(0, 300) + '...' : text } catch { return '<unserialisable>' } }
const note = (event, value, extra = {}) => appendFileSync(marker, JSON.stringify({ event, isThenable: isThenable(value), ...(value === undefined ? {} : { valuePreview: preview(value) }), ...extra }) + '\n')
const refusal = (error) => ({ name: error?.name ?? typeof error, message: String(error?.message ?? error).slice(0, 200) })
const aliveRoot = (ctx) => { try { return ctx.reflect.get("dshHomePath", false) !== undefined } catch (error) { return "threw:" + String(error?.name ?? error) } }
const typeOf = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const rowShape = (row) => {
  if (row === null || typeof row !== 'object') return typeOf(row)
  return Object.keys(row).sort().map((key) => key + ':' + typeOf(row[key])).join(',')
}
const idsOf = (rows) => Array.isArray(rows) ? rows.map((row) => (row && typeof row === 'object' ? row.id : undefined)) : null
try {
  const appBoot = await import(appBootUrl)
  const boot = await import(profileBootUrl)
  const result = await boot.runProfile({ environment: appBoot.loadLayeredEnv("dsh"), profile, patchFiles: [], // --no-open: this driver must never pop a browser window on the machine running the gate.
    args: ["--host", "127.0.0.1", "--port", "0", "--no-open"] })
  const ctx = result.ctx
  note('control.settled', undefined, { rootAlive: aliveRoot(ctx) })
  const link = ctx.link
  const compat = link && link.compat
  const simple = compat && compat.simple
  note('link-visible', Boolean(simple), { hasLink: link !== undefined, hasCompat: compat !== undefined, hasSimple: Boolean(simple) })
  if (!simple) { note("no-simple") } else {
    note('available', simple.available())
    // R117: a fresh world's store is empty, so the rows/limit/id readings had nothing to judge. The
    // kernel's own service is the only honest way to seed a composition: SessionStore.create() is
    // synchronous (packages/core/session/src/index.ts:982) and corpus.listSessions() merges the live
    // sessions (session-query/src/corpus.ts:70). Two sessions, so limit=1 slicing is discriminating.
    const seeded = []
    try {
      const sessions = ctx.sessions
      if (sessions === undefined || typeof sessions.create !== "function") {
        note('sessions.seed.absent', undefined, { hasSessions: sessions !== undefined })
      } else {
        for (let index = 0; index < 2; index += 1) {
          const created = sessions.create()
          seeded.push(created && typeof created.id === 'string' ? created.id : null)
        }
        note('sessions.seed.ok', undefined, { ids: seeded, liveListLength: sessions.list().length })
      }
    } catch (error) { note('sessions.seed.threw', undefined, refusal(error)) }
    const recent = simple.sessions
    const arity = recent && typeof recent.recent === 'function' ? recent.recent.length : -1
    note('sessions.recent.arity', arity, { arity })
    // SOURCE-FAITHFUL CALL SHAPE: the id is required, so one is always passed. The first call uses a
    // made-up id (the source uses it only to read an anchor), then a real id taken from that list, then
    // an id that is known not to exist. All three are recorded as raw facts.
    if (typeof recent?.recent === 'function') {
      try {
        const rows = await recent.recent('__r116-probe__')
        note('sessions.recent.ok', rows, { isArray: Array.isArray(rows), length: Array.isArray(rows) ? rows.length : -1, rowKeys: Array.isArray(rows) && rows.length > 0 ? Object.keys(rows[0]).sort() : [], rowShape: Array.isArray(rows) && rows.length > 0 ? rowShape(rows[0]) : '', types: Array.isArray(rows) && rows.length > 0 ? Object.values(rows[0]).map(typeOf).join(',') : '' })
        const firstId = Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0].id === 'string' ? rows[0].id : null
        note('sessions.recent.knownId', firstId, { firstId, isArray: Array.isArray(rows), length: Array.isArray(rows) ? rows.length : -1 })
        try {
          const known = firstId === null ? null : await recent.recent(firstId)
          note('sessions.recent.known', known, { isArray: Array.isArray(known), length: Array.isArray(known) ? known.length : -1, idsMatchList: firstId === null ? null : JSON.stringify(idsOf(known)) === JSON.stringify(idsOf(rows)) })
        } catch (error) { note('sessions.recent.known.threw', undefined, refusal(error)) }
        try {
          const limited = await recent.recent(firstId === null ? '__r116-probe__' : firstId, 1)
          note('sessions.recent.limit1', limited, { isArray: Array.isArray(limited), length: Array.isArray(limited) ? limited.length : -1, listLength: Array.isArray(rows) ? rows.length : -1 })
        } catch (error) { note('sessions.recent.limit1.threw', undefined, refusal(error)) }
        try {
          const unknown = await recent.recent('__r116-unknown-session__')
          note('sessions.recent.unknown', unknown, { isArray: Array.isArray(unknown), length: Array.isArray(unknown) ? unknown.length : -1, sameIdsAsList: JSON.stringify(idsOf(unknown)) === JSON.stringify(idsOf(rows)), listLength: Array.isArray(rows) ? rows.length : -1 })
        } catch (error) { note('sessions.recent.unknown.threw', undefined, refusal(error)) }
      } catch (error) { note('sessions.recent.threw', undefined, refusal(error)) }
    }
    try {
      const handle = simple.tools.add('r116-acceptance', { parameters: { value: { type: 'string' } }, execute: (args) => ({ echo: args?.value ?? null }) })
      note('tools.add.ok', handle, { name: handle?.name, has: simple.tools.has('r116-acceptance'), namesInclude: simple.tools.names().includes('r116-acceptance'), definitionKeys: handle?.definition ? Object.keys(handle.definition).sort() : [] })
    } catch (error) { note('tools.add.threw', undefined, refusal(error)) }
    try {
      const declaration = await simple.settings.define('r116-acceptance', { value: { type: 'string', description: 'R116 acceptance probe' } })
      note('settings.define.ok', declaration, { declaration, declarationKeys: declaration && typeof declaration === 'object' ? Object.keys(declaration).sort() : [] })
    } catch (error) { note('settings.define.threw', undefined, refusal(error)) }
    // Ruling 2: try to reach the ACCEPTED path with real configurable plugin entry keys instead of only
    // the made-up probe key. Each candidate is one raw fact; the judge owns what a status means.
    for (const candidate of ['dsh-theme-settings', 'dsh-link-collab', 'dsh-link-mods']) {
      try {
        const declaration = await simple.settings.define(candidate, { value: 'r116' })
        note('settings.define.candidate', declaration, { candidate, status: declaration?.status, reason: declaration?.reason })
      } catch (error) { note('settings.define.candidate.threw', undefined, { candidate, ...refusal(error) }) }
    }
  }
  note('consumer-done')
  await ctx.fiber.dispose()
  note('control.disposed', undefined, { rootAlive: aliveRoot(ctx) })
  process.exit(0)
} catch (error) { note('driver-error', undefined, { message: String(error?.message ?? error).slice(0, 300) }); process.exit(3) }
