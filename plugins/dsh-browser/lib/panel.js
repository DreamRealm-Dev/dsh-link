/**
 * The shell's sidebar panel, as the plugin's ONE read face for its tab set (R184).
 *
 * The shell owns WHICH tabs exist: `sidebar_panel.rs` holds the tab vector, the active id and
 * `MAX_TABS`, and the only read face is its own `op=state` report (`tabs[]/active/count/limit`).
 * This module therefore holds NO tab list of its own - `panelTabs(state)` is a pure projection of a
 * report the caller just read, never a cache, so "which tabs exist" has exactly one answer.
 *
 * What lives here:
 *
 *   shellPost(origin, path, payload)   one JSON POST, resolved as { status, body, text }
 *   panelRequest(origin, payload)      one panel op; a shell refusal is re-thrown in the SHELL's words
 *   panelTabs(state)                   the projection (pure, no geometry, no state)
 *   tabArgument(value, tool)           input validation, with this package's own named refusal
 *
 * Named refusals this package OWNS (the shell's own sentences are never rewritten into these):
 *
 *   TABS_INPUT     an argument that cannot be honoured (not a string id, ...)
 *   TABS_CHANNEL   a tab was addressed on the chrome channel (`DSH_BROWSER_PANEL=0`), where each
 *                  instance is its own window and there is no tab set at all
 *   TABS_NO_PANEL  the shell did not answer, or it answered that no panel is there
 *
 * Everything else - an unknown tab id, the tab cap, an unmounted browser, a lease held by somebody
 * else - is the SHELL's refusal, passed through verbatim by panelRequest(). Rewriting those into our
 * own words would make the model act on our paraphrase instead of on what the shell said.
 */
import http from 'node:http'

/**
 * Where the shell's own HTTP surface lives. The default is UNCHANGED (R178-N): R184 only makes the
 * value reachable from the outside (row config `panelOrigin` or `DSH_BROWSER_PANEL_ORIGIN`), so an
 * offline fixture can point the very same plugin at a fake panel. A deployment that sets neither
 * behaves exactly as before.
 */
export const DEFAULT_PANEL_ORIGIN = 'http://127.0.0.1:31761'

/**
 * The name our writes travel under. It is a NAME, not a lease: nothing here claims the panel, and the
 * shell's `enforce_lease` treats it the same way it treats an anonymous caller - it only means a
 * refusal says "and not by dsh-browser" instead of "and not by nobody".
 */
export const PANEL_HOLDER = 'dsh-browser'

/** Our own named refusals; see the header for when each one is the honest answer. */
export const TAB_REFUSAL = Object.freeze({
  INPUT: 'TABS_INPUT',
  CHANNEL: 'TABS_CHANNEL',
  NO_PANEL: 'TABS_NO_PANEL',
})

export class TabRefusal extends Error {
  constructor(code, detail) {
    super(code + ': ' + detail)
    this.name = 'TabRefusal'
    this.code = code
  }
}

/** One JSON POST to the shell, resolved as { status, body, text }. */
export function shellPost(origin, path, payload, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(path, origin)
    } catch (error) {
      reject(new Error('invalid shell panel origin ' + JSON.stringify(String(origin)) + ': ' + (error?.message ?? String(error))))
      return
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    const request = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === '' ? 80 : Number(url.port),
        path: url.pathname,
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': body.length },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }
          resolve({ status: response.statusCode ?? 0, body: parsed, text })
        })
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('no answer within ' + timeoutMs + ' ms'))
    })
    request.on('error', (error) => {
      reject(new Error('the shell panel at ' + String(origin) + ' did not answer ' + path + ': ' + (error?.message ?? String(error))))
    })
    request.end(body)
  })
}

/**
 * "Is the panel up?" without betting on a single key name: today the shell says `exists`, R178-G is
 * adding `mounted`, and both mean the same thing here.
 */
export function panelUp(state) {
  if (state === null || typeof state !== 'object') return false
  return state.exists === true || state.mounted === true
}

const stringOrNull = (value) => (typeof value === 'string' ? value : null)

/**
 * The tab set of one `op=state` report, as the tools may repeat it.
 *
 * PURE: no caching, no clock, no second copy - and deliberately NO `bounds`. A tab's rectangle is the
 * shell's (physical, letterboxed, unsettled since R179); a projection that carried it would invite a
 * tool to compute geometry, which is exactly what R184 forbids.
 */
export function panelTabs(state) {
  const report = state !== null && typeof state === 'object' ? state : {}
  const rows = Array.isArray(report.tabs) ? report.tabs : []
  const tabs = rows.map((row) => ({
    id: stringOrNull(row?.id) ?? '',
    label: stringOrNull(row?.label),
    url: stringOrNull(row?.url),
    live: row?.live === true,
    active: row?.active === true,
    // The shell has a title for the ACTIVE tab only (its own document is the one it can see); the rest
    // are null on purpose and must not be filled in from somewhere else.
    title: stringOrNull(row?.title),
  }))
  return {
    up: panelUp(report),
    mounted: report.mounted === true,
    count: Number.isFinite(report.count) ? report.count : tabs.length,
    limit: Number.isFinite(report.limit) ? report.limit : null,
    active: stringOrNull(report.active),
    listed: tabs.length,
    tabs,
  }
}

/** The panel report a write-op answer already carries, or the flat report op=state answers with. */
function stateOf(body) {
  if (body === null || typeof body !== 'object') return null
  if (body.state !== null && typeof body.state === 'object') return body.state
  return body
}

/**
 * One panel op. Resolves { answer, state }; a refusal is thrown in the SHELL's own words.
 *
 * The shell answers a refusal with HTTP 400 and `{error, state}`; that `error` string is its named
 * refusal (it starts with "named refusal:" for the cases a caller must be able to quote).
 */
export async function panelRequest(origin, payload, { timeoutMs = 20000 } = {}) {
  let answer
  try {
    answer = await shellPost(origin, '/__shell/panel', payload, { timeoutMs })
  } catch (error) {
    throw new TabRefusal(TAB_REFUSAL.NO_PANEL, error?.message ?? String(error))
  }
  if (answer.status !== 200) {
    const said = answer.body !== null && typeof answer.body?.error === 'string' ? answer.body.error : answer.text.slice(0, 300)
    throw new Error(said)
  }
  if (answer.body === null) {
    throw new TabRefusal(TAB_REFUSAL.NO_PANEL, 'the shell panel answered with something that is not JSON: ' + answer.text.slice(0, 200))
  }
  return { answer, state: stateOf(answer.body) }
}

/** The one refusal every tab-addressed entry point starts with: there is no tab set here. */
export function assertPanelChannel(usePanel, what) {
  if (usePanel !== true) {
    throw new TabRefusal(
      TAB_REFUSAL.CHANNEL,
      what + ' needs the shell sidebar panel, and this deployment runs the chrome channel (DSH_BROWSER_PANEL=0), ' +
        'where each browser instance is a separate window with no tab set of its own',
    )
  }
}

/**
 * A panel WRITE, then the shell's own read-back of the tab set.
 *
 * Never optimistic: the state handed back is the one the shell produced in a separate op=state
 * AFTER the write, so the caller reports what the shell now says and not what it asked for.
 * Resolves { answer, state }; a refusal (the tab cap, an unknown id, somebody else's lease) is
 * thrown in the shell's words by panelRequest.
 */
export async function panelWrite(origin, payload, { timeoutMs = 20000 } = {}) {
  const { answer } = await panelRequest(origin, { ...payload, holder: PANEL_HOLDER }, { timeoutMs })
  const { state } = await panelRequest(origin, { op: 'state' }, { timeoutMs: 8000 })
  return { answer, state: state ?? stateOf(answer.body) }
}

/**
 * A `tab` argument, as the caller wrote it.
 *
 * VERBATIM on purpose: no trim, no lowercase, no "the second tab" translated into an id. The shell's
 * ids are the only names; inventing a second naming scheme is how two truths start.
 */
export function tabArgument(value, tool) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value === '') {
    throw new TabRefusal(
      TAB_REFUSAL.INPUT,
      tool + ' takes tab as a tab id from browser_tabs (e.g. "t2"); it received ' + JSON.stringify(value),
    )
  }
  return value
}
