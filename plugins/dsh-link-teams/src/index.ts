/**
 * dsh-link-teams — the product surface for the collaboration bus.
 *
 * ## What this is, and what it is not
 *
 * The bus (`dsh-link-collab`) owns the facts: an append-only control ledger, a projection that folds
 * it back into tasks / members / a team tree / a capability registry / liveness / peer permissions,
 * and a recorder that writes the kernel's own Agent Teams events into it. It has no product surface:
 * nothing a person can look at reads the ledger.
 *
 * This plugin is that surface and nothing else. It owns no storage, writes no records, and replaces no
 * kernel service. It reads the capability the bus publishes (`ctx.get('linkCollab')`) and serves ONE
 * read-only JSON document over the app's own web server, which the right-rail pane polls.
 *
 * ## One world, composed from the live fold
 *
 * `collab.state()` re-folds the control log on every read (`collab/src/index.ts:9442`), so what this
 * route serves is the live kernel's own fold at the moment of the GET. What that fold does NOT say is
 * which of its teams belong to this machine's real work: the live ledger still holds the R180-B
 * acceptance run's rows (seq 50-54), written under `gate-r180-alpha-*` names with `writer: "local"`
 * and the live instance id - the same provenance as the kernel's own rows - so no reader can tell
 * them apart by who wrote them, and re-folding cannot remove a row that is really there.
 *
 * `src/world.ts` is where that becomes one answer: the tree is every team the ledger declares OR
 * names in a task/member row (so a real session team that never declared itself is still drawn), a
 * team carrying the round's fixture naming contract is withheld from the world and counted in
 * `teams.withheld`, and `counts.teams` is the number of nodes in the tree this answer carries. The
 * ledger view - the stream, the member rows, the capability declarations - keeps those rows because
 * they are facts of the file; each one that carries a fixture name is flagged `fixture: true` so the
 * pane can say so rather than letting it read like live work.
 *
 * ## One route, read-only by construction
 *
 * There is no POST, no query parameter that selects a mutation, and no writer here at all: the only
 * verb is GET. A surface that can write would need its own authorization story, and the user's own
 * chat box is already the write path that matters ("direct the lead" is a message to the lead, not a
 * button that forges one).
 *
 * ## When the capability is absent
 *
 * The route answers 503 with a named code instead of an empty document. An empty board and a missing
 * bus look identical to a reader otherwise, and telling those two apart is the whole job of an honest
 * surface.
 */

import { createHash } from 'node:crypto'
import { composeWorld, fixtureCensus, isFixtureId } from './world.ts'

export const name = 'dsh-link-teams'

/** Nothing is injected at apply time: both dependencies are looked up lazily. */
export const inject = []

/** Where the pane reads the folded state. Overridable by row config. */
const DEFAULT_PATH = '/api/dsh-link-teams/state'

/**
 * R453: the session title for one session id, read from the kernel's own projection cache.
 *
 * The pane can NAME a session row (the ledger knows the id) but the sidebar lists sessions by TITLE, and this page
 * bundle has no session service (measured: ctx.get('sessions') answers null from every accessor). The projection cache
 * the kernel keeps next to the ledger DOES carry the title, so a second read-only route serves it; the pane then clicks
 * the sidebar item whose text starts with it. No service, no guess: a missing file is a 404.
 */
const TITLE_PATH = '/api/dsh-link-teams/session-title'

/** How many control records travel with the state (the pane's "交流" list). */
const DEFAULT_STREAM_LIMIT = 40

function sendJson(res, status, body, etag = null) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (typeof etag === 'string') res.setHeader('etag', etag)
  res.end(text)
}

/**
 * The fields of one record a reader may use to spot a fixture row, without a second rule: the same
 * naming contract `src/world.ts` applies to teams decides whether a row is declared to belong to a
 * test world.
 *
 * R377: it answers WHICH field named the row, not just whether one did. A boolean told a reader that a row
 * belongs to a test world and left the reason out, so "why is this row flagged" could only be answered by
 * reading the ledger by hand - and the rule itself was the thing under suspicion. The field paths are the
 * ones a reader would open.
 * @param record - one ledger record as the fold holds it.
 * @returns the field path that carries a fixture name, or null when none does.
 */
function fixtureFieldOf(record) {
  const payload = record !== null && typeof record === 'object' ? record.payload : null
  const fields = payload !== null && typeof payload === 'object' ? payload : {}
  const candidates = [
    ['actor', record?.actor],
    ['subject', record?.subject],
    ['payload.id', fields.id],
    ['payload.name', fields.name],
    ['payload.senderId', fields.senderId],
    ['payload.targetId', fields.targetId],
  ]
  const named = candidates.find(([, value]) => isFixtureId(value))
  return named === undefined ? null : named[0]
}

/**
 * One control record reduced to what a reader renders.
 *
 * The ledger row carries its whole payload; the pane needs six of its fields and the four routing
 * fields beside them. Reduced HERE rather than in the browser so the shape a gate reads is the shape
 * the pane renders.
 */
function row(record) {
  const payload = record !== null && typeof record === 'object' ? record.payload : null
  const fields = payload !== null && typeof payload === 'object' ? payload : {}
  const fixture = fixtureFieldOf(record)
  return {
    seq: record?.seq ?? null,
    kind: record?.kind ?? null,
    actor: record?.actor ?? null,
    subject: record?.subject ?? null,
    at: record?.at ?? null,
    id: fields.id ?? null,
    state: fields.state ?? null,
    title: fields.title ?? null,
    name: fields.name ?? null,
    senderId: fields.senderId ?? null,
    targetId: fields.targetId ?? null,
    // R196: the row is served (the ledger holds it) and it says whether the name it carries belongs to
    // a test world. Hiding the row would lie about the file; drawing it like live work would lie about
    // the world. This flag is the third option. R377 adds WHICH field named it.
    fixture: fixture !== null,
    fixtureBy: fixture,
  }
}

export function apply(ctx, config = {}) {
  const settings = config ?? {}
  const path = typeof settings.path === 'string' && settings.path.startsWith('/') ? settings.path : DEFAULT_PATH
  const streamLimit =
    Number.isInteger(settings.streamLimit) && settings.streamLimit > 0 ? settings.streamLimit : DEFAULT_STREAM_LIMIT

  const disposers: Array<() => void> = []
  let served = 0
  let refused = 0
  let lastError = null

  /** The whole read surface, in one place, with no path that throws past it. */
  function snapshot(options: { view?: 'full' | 'structure' } = {}) {
    const collab = ctx.get('linkCollab')
    if (collab === undefined || collab === null) {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: 'NO_CAPABILITY',
            message: 'the linkCollab capability is not mounted in this profile, so there is no ledger to read',
          },
        },
      }
    }
    if (typeof collab.state !== 'function') {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: 'NO_STATE_READER',
            message: 'linkCollab is mounted but publishes no state() reader; this surface refuses to guess a shape',
          },
        },
      }
    }
    const log = collab.log
    if (log === undefined || log === null || typeof log.replay !== 'function') {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: 'NO_CONTROL_LOG',
            message: 'linkCollab publishes no control log handle, so the stream cannot be read',
          },
        },
      }
    }
    const state = collab.state()
    const records = log.replay()
    // ONE composition of the world, used by every field below: the tree and the counts cannot be
    // derived from two different notions of "team" if there is only one place that derives either.
    const world = composeWorld(state)
    const from = Math.max(0, records.length - streamLimit)
    const body = {
      ok: true,
        at: Date.now(),
        path,
        ledger: {
          directory: typeof log.directory === 'string' ? log.directory : null,
          writer: log.writer ?? null,
          instance: log.instance ?? null,
          lastSeq: typeof log.lastSeq === 'number' ? log.lastSeq : null,
          records: records.length,
          damage: log.damage ?? null,
        },
        // The world's counts: `teams` is the number of nodes in the tree served below, never a second
        // notion of "how many teams" (`src/world.ts`).
        counts: world.counts,
        through: state.through ?? null,
        teams: world.teams,
        // The ledger view: the rows the fold holds, each flagged when it carries a fixture name.
        // R344 (perf, measured in RESEARCH-RUST-PERF): every task/member row carried its FULL `losers` history, so the
        // served document grew with the number of write CONFLICTS rather than with the number of entities - 5.12 MB and
        // 41.6 ms of JSON per 2 s poll at L=128k in the research bench. The pane reads `losers` only off the team TREE
        // nodes (world.ts:88), never off these flat rows, so the rows now carry the COUNT and the history stays in the
        // ledger where a diagnosis would look for it.
        // R377: the flag and the FIELD that raised it travel together here too, for the same reason as in `row`.
        tasks: Array.isArray(state.tasks) ? state.tasks.map((task) => { const { losers, ...rest } = task ?? {}; const by = isFixtureId(task?.team) ? 'team' : isFixtureId(task?.id) ? 'id' : null; return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by } }) : [],
        members: Array.isArray(state.members) ? state.members.map((member) => { const { losers, ...rest } = member ?? {}; const by = isFixtureId(member?.team) ? 'team' : isFixtureId(member?.id) ? 'id' : null; return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by } }) : [],
        registry: state.registry ?? null,
        liveness: state.liveness ?? null,
        peers: state.peers ?? null,
        board: state.board ?? null,
        // R181: the isolation facts the reclaimer writes (member/quarantine rows). They were folded but
        // never served, so a reader of this route could watch a task be taken away from a silent owner and
        // still not learn that the owner was set aside - the fault-isolation half of the round was
        // invisible. Optional like every other fold field: a ledger with no isolation yields null, never a
        // missing key, so a pane can tell "nobody is quarantined" from "this build does not say".
        quarantine: state.quarantine ?? null,
        // How many rows on this answer carry a fixture name. Counts, never ids: the ids are withheld from
        // the world (see `teams.withheld`) and the ledger view is not allowed to reintroduce them as names.
        // R344: the census describes what is ON SCREEN (this page of the stream), not the whole ledger - the pane line
        // says "N fixture rows are on screen", and scanning every record on every 2 s poll was the other half of the cost.
        fixtures: fixtureCensus(state, records.slice(from)),
        stream: records.slice(from).map(row),
        served: served + 1,
    }
    // R514: the structure popover reads the tree and the member rows only. Serving the registry,
    // peers, board, quarantine, ledger and stream to it was megabytes of JSON parsed on the
    // renderer's main thread every poll, for fields it never renders.
    if (options.view === 'structure') {
      return {
        status: 200,
        body: {
          ok: true,
          at: body.at,
          through: body.through,
          counts: body.counts,
          teams: body.teams,
          members: body.members,
        },
      }
    }
    return { status: 200, body }
  }

  async function handler(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        refused += 1
        sendJson(res, 405, {
          ok: false,
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message:
              'dsh-link-teams state is read-only: GET is the only verb, and ' + String(req.method) + ' was refused',
          },
        })
        return
      }
      const url = new URL(String(req.url ?? ''), 'http://127.0.0.1')
      const answer = snapshot({ view: url.searchParams.get('view') === 'structure' ? 'structure' : 'full' })
      if (answer.status === 200) served += 1
      else refused += 1
      const text = JSON.stringify(answer.body)
      // `at` and the served counter change on every answer without describing a change in the
      // ledger, so the validator is computed with them pinned; otherwise every poll is a new ETag.
      const stable = JSON.stringify({ ...answer.body, at: 0, served: 0 })
      const etag = '"' + createHash('sha1').update(stable).digest('hex') + '"'
      if (req.method === 'GET' && String(req.headers?.['if-none-match'] ?? '') === etag) {
        res.statusCode = 304
        res.setHeader('etag', etag)
        res.setHeader('cache-control', 'no-store')
        res.end()
        return
      }
      sendJson(res, answer.status, answer.body, etag)
    } catch (error) {
      refused += 1
      lastError = String(error?.message ?? error)
      sendJson(res, 500, { ok: false, error: { code: 'SNAPSHOT_FAILED', message: lastError } })
    }
  }

  /** The kernel home, derived from the control log's own directory (…/collab -> home). */
  function kernelHome() {
    try {
      const collab = ctx.get('linkCollab')
      const directory = collab?.log?.directory
      if (typeof directory !== 'string' || directory === '') return null
      return directory.replace(/[\\/]collab[\\/]?$/, '')
    } catch (error) {
      return null
    }
  }

  async function titleHandler(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'session-title is read-only' } })
        return
      }
      const url = new URL(String(req.url ?? ''), 'http://127.0.0.1')
      const many = url.searchParams.get('ids')
      if (typeof many === 'string' && many !== '') {
        // R456: the map needs titles for every visible node in one request; each id keeps the same single-id contract.
        const wanted = many.split(',').map((part) => part.trim()).filter((part) => /^(session-)?[0-9a-f-]{36}$/i.test(part)).slice(0, 60)
        const home = kernelHome()
        if (home === null) {
          sendJson(res, 503, { ok: false, error: { code: 'NO_HOME', message: 'the control log names no home directory' } })
          return
        }
        const { readFile } = await import('node:fs/promises')
        const { join } = await import('node:path')
        const titles: Record<string, string> = {}
        for (const part of wanted) {
          const id = /^session-/i.test(part) ? part : 'session-' + part
          try {
            const text = await readFile(join(home, 'storages', 'session_projcache', 'sessions', id + '.json'), 'utf8')
            const value = JSON.parse(text)?.record?.rows?.title?.val
            titles[id] = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
          } catch (error) {
            titles[id] = ''
          }
        }
        sendJson(res, 200, { ok: true, titles })
        return
      }
      const raw = url.searchParams.get('id') ?? ''
      const id = /^session-[0-9a-f-]{36}$/i.test(raw) ? raw : (/^[0-9a-f-]{36}$/i.test(raw) ? 'session-' + raw : '')
      if (id === '') {
        sendJson(res, 400, { ok: false, error: { code: 'BAD_ID', message: 'id must be a session id' } })
        return
      }
      const home = kernelHome()
      if (home === null) {
        sendJson(res, 503, { ok: false, error: { code: 'NO_HOME', message: 'the control log names no home directory' } })
        return
      }
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      let text = null
      try {
        text = await readFile(join(home, 'storages', 'session_projcache', 'sessions', id + '.json'), 'utf8')
      } catch (error) {
        sendJson(res, 404, { ok: false, error: { code: 'NO_SESSION', message: 'no projection cache for ' + id } })
        return
      }
      let title = ''
      try {
        const doc = JSON.parse(text)
        const value = doc?.record?.rows?.title?.val
        title = typeof value === 'string' ? value : ''
      } catch (error) {
        title = ''
      }
      // Titles can be a whole system-reminder; the sidebar shows a leading slice, so trim on a word-ish boundary.
      sendJson(res, 200, { ok: true, id, title: title.replace(/\s+/g, ' ').trim().slice(0, 60) })
    } catch (error) {
      lastError = String(error?.message ?? error)
      sendJson(res, 500, { ok: false, error: { code: 'TITLE_FAILED', message: lastError } })
    }
  }

  const route = { kind: 'exact', path, handler }
  const titleRoute = { kind: 'exact', path: TITLE_PATH, handler: titleHandler }

  // `apply()` can run before the web application mounts, exactly like the browser
  // plugin's route: the registration is attempted now and again when `webServer`
  // appears, and the whole thing is disposed with the row.
  let bound = false
  function registerRoute() {
    if (bound) return
    const server = ctx.get('webServer')
    if (server === undefined || server === null || typeof server.register !== 'function') return
    try {
      disposers.push(server.register(route))
      disposers.push(server.register(titleRoute))
      bound = true
      console.log('[dsh-link-teams] state route bound on ' + path + ' (GET, read-only)')
      console.log('[dsh-link-teams] session-title route bound on ' + TITLE_PATH + ' (GET, read-only)')
    } catch (error) {
      console.error('[dsh-link-teams] could not bind the state route: ' + String(error?.message ?? error))
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
      'dsh-link-teams: state route',
    )
  }

  console.log('[dsh-link-teams] ready — read-only team surface, ledger via linkCollab' + (bound ? '' : ' (route pending webServer)'))
}

export default { name, inject, apply }
