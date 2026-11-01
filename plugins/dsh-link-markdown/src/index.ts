/**
 * The host half of dsh-link-markdown.
 *
 * The work is a client half: the tab type, its body and its chip title all live in the browser, and
 * the client module system loads `./client` because this manifest declares `dsh.client`. A host half
 * that invented work would be a row pretending to do something the user can see, so this side only
 * carries the row — plus the claim decision, re-exported so a gate can recompute it from the built
 * artifact instead of only from the client bundle, which a browser wrapper owns.
 */

/** Loader row name for the diagnostics surface. */
export const name = 'link-markdown'

/**
 * The row carries the editor SAVE route (see WRITE_ROUTE_PATH) and nothing else: the tab type, its body and its
 * chip title are the client half work.
 */
export function apply(ctx: any): void {
  // R377: the freshness token and the write both come from the kernel's own `fs` service, not from a
  // fingerprint invented here. The token a person's document carries is the one `workspaceFiles/read`
  // returned, and that token is the fs service's `FsVersion`; a locally recomputed "<mtimeMs>-<size>" is a
  // second vocabulary for the same fact and never matches, so every save was refused as stale (measured
  // live: status "stale" with an unchanged file). `writeText` also replaces the temp-file dance this route
  // used to do by hand: the kernel writes atomically under a per-target lock and checks the same version
  // under it, which is what makes a save and an agent's edit of the same file safe against each other.
  /**
   * The sandbox policy one save runs under.
   *
   * R377: resolved from the SESSION whose file is being saved, not from the process. Without a session the policy
   * service falls back to its configured root - this deployment's is the shell's own working directory - so a save
   * into a Session whose workspace lives elsewhere was refused by the file sandbox with EPERM while mkdir-ing the
   * atomic write's staging directory (measured: "EPERM ... mkdir 'H:\AI自创造\.dsh-link-editor-probe.md.<id>.tmpdir'"
   * while the same route wrote happily under the shell's cwd). The session's immutable cwd IS the workspace-write
   * boundary everywhere else in the product, so this route uses the same one.
   */
  const policyFor = (sessionId: string | null) => {
    const policies = ctx.get?.('sandboxPolicy')
    if (policies === undefined || policies === null) return { policy: undefined, boundary: { mode: null, workspaceRoot: null, session: false } }
    const sessions = ctx.get?.('sessions')
    const session = sessionId === null || sessions === undefined || sessions === null ? undefined : sessions.get(sessionId)
    const policy = session === undefined ? policies.resolve({}) : policies.resolve({ session })
    // Reported with a refusal: "EPERM" alone does not tell a person which fence they hit, and this one is the difference
    // between "your workspace is outside what this shell may write" and "something else on this machine holds the file".
    return { policy, boundary: { mode: policy.mode ?? null, workspaceRoot: policy.workspaceRoot ?? null, session: session !== undefined } }
  }
  const fs = {
    stat: async (path: string) => {
      const service = ctx.get?.('fs')
      if (service === undefined || service === null) return null
      const info = await service.stat(await service.resolve(path))
      if (info === undefined || info === null) return null
      return { version: String(info.version), isFile: info.type === 'file', size: info.size }
    },
    write: async (path: string, text: string, expected: string | null, sessionId: string | null) => {
      const service = ctx.get?.('fs')
      if (service === undefined || service === null) throw new Error('the fs service is not mounted')
      const target = await service.resolve(path)
      const intent = expected === null ? undefined : { kind: 'replaceIfVersion', version: expected }
      const { policy, boundary } = policyFor(sessionId)
      try {
        const outcome = await service.writeText(target, text, intent, undefined, policy)
        return { version: String(outcome.version) }
      } catch (error) {
        // The boundary travels ON the error: it is the one fact that turns "EPERM" into something a person can act on.
        if (error !== null && typeof error === 'object') error.boundary = boundary
        throw error
      }
    },
  }
  const route = { kind: 'exact', path: WRITE_ROUTE_PATH, handler: createWriteHandler({ fs }) }
  const bind = () => {
    const server = (ctx as { get?: (name: string) => unknown }).get?.('webServer') as { register?: (value: unknown) => () => void } | null | undefined
    if (server === null || server === undefined || typeof server.register !== 'function') return
    try {
      const dispose = server.register(route)
      if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-link-markdown: save route')
      console.log('[link-markdown] save route bound on ' + WRITE_ROUTE_PATH + ' (POST, one file, optimistic version)')
    } catch (error) {
      console.error('[link-markdown] could not bind the save route: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  bind()
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], bind)
}
/**
 * Where the editor saves. A PERSON editing a workspace file has to be able to write it, and the kernel own
 * workspace-files surface only reads (`read/readBytes/stat/list/changes`; its README says it fences writes and edits,
 * not reads). So this row carries the ONE write it needs, in the host half, where the file can actually be written.
 *
 * The rules that make it narrow enough to live here:
 * - POST only, one JSON body, at most MAX_BYTES of text;
 * - the path must be absolute and must ALREADY exist as a regular file - this never creates one;
 * - `expectedVersion` (the `<mtimeMs>-<size>` the reader last saw) must still match, so a save that would overwrite
 *   somebody else change is refused by name instead of winning silently;
 * - the write is atomic (temp file beside the target, then rename), so a crash cannot leave half a document.
 *
 * Optimistic concurrency is what the reference implementations do too (Obsidian recomputes a mtime:size:sha256
 * fingerprint; HanaAgent keeps a version per tab), and it is the only model that works when an Agent may also edit the
 * same file.
 */
import { isAbsolute } from 'node:path'

export const WRITE_ROUTE_PATH = '/api/dsh-link-markdown/write'

/** One save may not carry more than this much text. */
export const MAX_BYTES = 2 * 1024 * 1024

/**
 * The freshness token a caller must echo back to prove it read the file it is saving.
 *
 * R377: it is the `fs` service's own opaque token, verbatim — the same string `workspaceFiles/read` handed
 * the reader. This route no longer computes a fingerprint of its own; the format belongs to the service that
 * owns the file, and a variant here can only ever disagree with it.
 * @param stat - what `fs.stat` answered.
 * @returns the version string, or null when there is nothing to compare to.
 */
export function versionOf(stat) { return stat === null || stat === undefined ? null : String(stat.version) }

/**
 * The save handler, exported so a test can drive it without a web server.
 * @param options.fs - the filesystem functions (injected so a test can use a temp dir).
 * @returns an http handler.
 */
export function createWriteHandler(options) {
  const fs = options.fs
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'the editor save route is POST only' })
      return
    }
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch (error) {
      sendJson(res, 400, { ok: false, code: 'BAD_JSON', error: String(error && error.message ? error.message : error) })
      return
    }
    const path = body && typeof body.path === 'string' ? body.path : ''
    const text = body && typeof body.text === 'string' ? body.text : null
    const expected = body && typeof body.expectedVersion === 'string' ? body.expectedVersion : null
    // R377: the Session whose file this is. It selects the workspace-write boundary and nothing else - the caller
    // cannot widen the fence by naming a session, because the boundary comes from that session's own cwd.
    const sessionId = body && typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null
    // A Windows path is absolute without starting with '/': measured the hard way, the first version refused every real
    // path on this machine with BAD_PATH. `isAbsolute` is the platform own answer.
    if (path === '' || isAbsolute(path) === false) {
      sendJson(res, 400, { ok: false, code: 'BAD_PATH', error: 'path must be an absolute file path' })
      return
    }
    if (text === null) {
      sendJson(res, 400, { ok: false, code: 'BAD_TEXT', error: 'text must be a string' })
      return
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
      sendJson(res, 413, { ok: false, code: 'TOO_LARGE', error: 'the document is over ' + String(MAX_BYTES) + ' bytes' })
      return
    }
    // The fs service reports an absent path as `undefined` rather than by throwing, so both answers mean the same
    // thing here: this route never creates a file.
    let before = null
    try { before = await fs.stat(path) } catch (error) { before = null }
    if (before === null || before === undefined) {
      sendJson(res, 404, { ok: false, code: 'NO_FILE', error: 'the editor only saves files that already exist' })
      return
    }
    if (before.isFile !== true) {
      sendJson(res, 400, { ok: false, code: 'NOT_A_FILE', error: 'the target is not a regular file' })
      return
    }
    const current = versionOf(before)
    if (expected !== null && expected !== current) {
      sendJson(res, 409, { ok: false, code: 'STALE', version: current, error: 'the file changed since it was read' })
      return
    }
    // The write itself is the fs service's: atomic, and version-guarded again under its own per-target lock, so the
    // check above is an early, readable answer rather than the only guard. A file that moved between the two is
    // reported by the service (FS_STALE_VERSION) and answered with the same 409 the early check gives.
    let written = null
    try {
      written = await fs.write(path, text, expected, sessionId)
    } catch (error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      const detail = String(error && error.message ? error.message : error)
      if (code === 'FS_STALE_VERSION') { sendJson(res, 409, { ok: false, code: 'STALE', version: null, error: detail }); return }
      if (code === 'FS_NOT_OBSERVED') { sendJson(res, 404, { ok: false, code: 'NO_FILE', error: detail }); return }
      const boundary = error !== null && typeof error === 'object' && error.boundary !== undefined ? error.boundary : null
      sendJson(res, 500, { ok: false, code: 'WRITE_FAILED', error: detail, boundary })
      return
    }
    sendJson(res, 200, { ok: true, version: written === null ? null : written.version, bytes: Buffer.byteLength(text, 'utf8') })
  }
}

/** Read one request body as text, with a ceiling of its own. */
function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = []
    let total = 0
    req.on('data', function (chunk) {
      total += chunk.length
      if (total > MAX_BYTES + 8192) { reject(new Error('request body too large')); return }
      chunks.push(chunk)
    })
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** One JSON answer. */
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export {
  MARKDOWN_KIND, MARKDOWN_PATTERNS, MARKDOWN_TAB_ID, REFUSAL_DISPOSITIONS,
  basenameOf, fileTargetOf, isMarkdownAddress, titleFor,
} from './client/claim.ts'
export type { ClaimRefusal, FileTarget } from './client/claim.ts'
