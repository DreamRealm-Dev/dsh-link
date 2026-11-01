/**
 * Bridge-side executor.
 *
 * Runs ONE capability request that arrived from a remote agent over the LAN on
 * THIS machine. The injected `policy` (the per-peer grant table) is the only
 * authority: every path and working directory is resolved by it, a denial carries
 * the policy's own code and reason, and no peer-supplied string ever reaches the
 * filesystem unchecked. Two invariants shape the code below:
 *   - only an `ExecError` (or a JSON value) leaves this module, never a raw Node error;
 *   - every attempt is audited, allowed or denied, including ms and byte counts.
 *
 * Zero dependencies — Node built-ins only.
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { arch, cpus, hostname, release, totalmem } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

const LIST_MAX_ENTRIES = 2000
const READ_DEFAULT_LIMIT = 2000
const READ_MAX_LIMIT = 20000
const MIN_TIMEOUT_MS = 1000
const KILL_GRACE_MS = 2000
const PS_ARGS = Object.freeze(['-NoProfile', '-NonInteractive', '-Command'])
const SH_ARGS = Object.freeze(['-c'])

/** Used only when the injected policy omits a limit. */
const LIMIT_DEFAULTS = {
  maxReadBytes: 1 << 20, maxWriteBytes: 1 << 20, maxOutputBytes: 1 << 20,
  defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000,
}

/** The single error type that may cross the bridge boundary. */
export class ExecError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ExecError'
    this.code = code
  }
}

const isStr = (value) => typeof value === 'string'

function requireString(value, name) {
  if (!isStr(value) || value === '') throw new ExecError('bad-arg', `${name} must be a non-empty string`)
  return value
}

function optionalInt(value, name, fallback, min, max) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ExecError('bad-arg', `${name} must be a number`)
  return Math.min(Math.max(Math.floor(value), min), max)
}

function normalizeArgs(args) {
  if (args === undefined || args === null) return {}
  if (typeof args !== 'object' || Array.isArray(args)) throw new ExecError('bad-arg', 'args must be an object')
  return args
}

function limitOf(limits, key) {
  const value = limits?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : LIMIT_DEFAULTS[key]
}

/** Map a raw Node error onto the wire codes; the resolved absolute path never leaks. */
function toExecError(error, hint) {
  if (error instanceof ExecError) return error
  const raw = isStr(error?.message) ? error.message : String(error)
  const message = hint === undefined ? raw : raw.split(hint.abs).join(hint.given)
  if (error?.code === 'ENOENT') return new ExecError('not-found', message)
  if (error?.code === 'EISDIR') return new ExecError('is-dir', message)
  if (error?.code === 'ENOTDIR') return new ExecError('is-file', message)
  return new ExecError('io', message)
}

/** A throwing policy is an IO failure, not a TypeError leak. */
function callPolicy(fn) {
  try {
    return fn()
  } catch (error) {
    throw toExecError(error)
  }
}

function denial(result, fallbackCode, fallbackReason) {
  const reason = isStr(result?.reason) && result.reason !== '' ? result.reason : fallbackReason
  return new ExecError(isStr(result?.code) ? result.code : fallbackCode, reason)
}

function requireGrant(grant) {
  if (grant === undefined || grant === null) {
    throw new ExecError('not-granted', 'this peer has no grant for the requested capability')
  }
}

/** Resolve a peer path through the grant table; deny with the policy's own code. */
function resolveFs(policy, grant, given, forWrite) {
  requireGrant(grant)
  const resolved = callPolicy(() => policy.resolveFsPath(grant, given, { forWrite }))
  if (resolved?.ok !== true) throw denial(resolved, 'path-denied', `${given} is outside every directory this peer granted`)
  if (!isStr(resolved.abs) || resolved.abs === '') throw new ExecError('io', 'policy returned an empty resolved path')
  return resolved.abs
}

function resolveCwd(policy, grant, input) {
  const resolved = callPolicy(() => policy.resolveShellCwd(grant, input))
  if (resolved?.ok !== true) throw denial(resolved, 'path-denied', 'that working directory is not inside a granted root')
  if (!isStr(resolved.abs) || resolved.abs === '') throw new ExecError('io', 'policy returned an empty working directory')
  return resolved.abs
}

/** Drop a multi-byte sequence cut in half by a byte cap, so decoding stays clean. */
function trimPartialUtf8(buffer) {
  let index = buffer.length - 1
  for (let steps = 0; index >= 0 && (buffer[index] & 0xc0) === 0x80 && steps < 3; steps += 1) index -= 1
  if (index < 0) return buffer
  const lead = buffer[index]
  const expected = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  return buffer.length - index < expected ? buffer.subarray(0, index) : buffer
}

/** Split text into lines, ignoring the empty tail a trailing newline produces. */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const pathExists = (target) => fsp.stat(target).then(() => true, () => false)

/** Sibling temp file + rename: a peer never observes a half-written file. */
async function atomicWrite(abs, content) {
  const temp = `${abs}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  try {
    await fsp.writeFile(temp, content, 'utf8')
    await fsp.rename(temp, abs)
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/** Create the parent directory only when the grant explicitly allows it. */
async function ensureParent(ctx, abs, given) {
  const parent = dirname(abs)
  if (await pathExists(parent)) return
  if (ctx.grant?.createDirs !== true) {
    throw new ExecError(
      'path-denied',
      `the directory ${dirname(given)} does not exist and this grant does not allow creating directories ` +
        '(the peer must set grant.createDirs = true to allow it)',
    )
  }
  await fsp.mkdir(parent, { recursive: true })
}

/** Literal (never regex, never $-expanding) replacement, counting occurrences. */
function replaceLiteral(text, needle, replacement, all) {
  const parts = text.split(needle)
  const count = parts.length - 1
  if (count === 0) return { count, text }
  return { count, text: all ? parts.join(replacement) : parts[0] + replacement + parts.slice(1).join(needle) }
}

// --- capabilities ------------------------------------------------------------

const DIRENT_TYPE = (dirent) =>
  dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : dirent.isSymbolicLink() ? 'link' : 'other'

function compareNames(a, b) {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x !== y) return x < y ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** `fs.list` — one directory page, directories first, capped at 2000 entries. */async function fsList(ctx) {
  const given = requireString(ctx.args.path, 'path')
  const abs = resolveFs(ctx.policy, ctx.grant, given, false)
  try {
    // readdir on a file fails with ENOTDIR, which `toExecError` reports as `is-file`.
    const dirents = await fsp.readdir(abs, { withFileTypes: true })
    const rows = dirents.map((dirent) => ({ name: dirent.name, type: DIRENT_TYPE(dirent), dir: dirent.isDirectory() }))
    rows.sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1) || compareNames(a.name, b.name))
    const entries = []
    let bytes = 0
    for (const row of rows.slice(0, LIST_MAX_ENTRIES)) {
      const info = await fsp.lstat(join(abs, row.name)).catch(() => null) // may vanish between readdir and lstat
      const size = info === null ? 0 : info.size
      entries.push({ name: row.name, type: row.type, size, mtimeMs: info === null ? 0 : info.mtimeMs })
      bytes += size
    }
    return { value: { path: given, entries, truncated: rows.length > LIST_MAX_ENTRIES }, bytes }
  } catch (error) {
    throw toExecError(error, { abs, given })
  }
}

/** `fs.read` — UTF-8 text, 1-based line window, byte-capped by the policy. */
/**
 * Slice a line window out of the decoded text WITHOUT normalising anything.
 *
 * A remote debugging bridge must hand back the peer's real bytes: joining
 * split lines with '\n' would silently drop a trailing newline and rewrite
 * CRLF files, so the window is taken as the exact substring from the start of
 * line `startLine` up to (not including) the start of the line after the last
 * one taken — which preserves every terminator that is actually in the file.
 *
 * @returns {{ text: string, taken: number }}
 */
function lineWindow(text, startLine, limit) {
  if (limit <= 0) return { text: '', taken: 0 }
  let pos = 0
  let line = 0
  while (line < startLine) {
    const nl = text.indexOf('\n', pos)
    if (nl === -1) return { text: '', taken: 0 }
    pos = nl + 1
    line += 1
  }
  let end = pos
  let taken = 0
  while (taken < limit) {
    const nl = text.indexOf('\n', end)
    if (nl === -1) {
      end = text.length
      taken += 1
      break
    }
    end = nl + 1
    taken += 1
  }
  return { text: text.slice(pos, end), taken }
}

async function fsRead(ctx) {
  const given = requireString(ctx.args.path, 'path')
  const offset = optionalInt(ctx.args.offset, 'offset', 1, 1, Number.MAX_SAFE_INTEGER)
  const limit = optionalInt(ctx.args.limit, 'limit', READ_DEFAULT_LIMIT, 0, READ_MAX_LIMIT)
  const abs = resolveFs(ctx.policy, ctx.grant, given, false)
  try {
    const info = await fsp.stat(abs)
    if (info.isDirectory()) throw new ExecError('is-dir', `${given} is a directory, not a file`)
    const take = Math.min(info.size, limitOf(ctx.limits, 'maxReadBytes'))
    const handle = await fsp.open(abs, 'r')
    let chunk
    try {
      const buffer = Buffer.alloc(take)
      let read = 0
      while (read < take) {
        const { bytesRead } = await handle.read(buffer, read, take - read, read)
        if (bytesRead <= 0) break
        read += bytesRead
      }
      chunk = buffer.subarray(0, read)
    } finally {
      await handle.close().catch(() => {})
    }
    // `totalLines` counts the lines actually read: a byte-capped read is not the file total.
    const text = trimPartialUtf8(chunk).toString('utf8')
    const lines = splitLines(text)
    const startLine = Math.max(0, offset - 1)
    const window = lineWindow(text, startLine, limit)
    const truncated = info.size > chunk.length || startLine + window.taken < lines.length
    return {
      value: { path: given, content: window.text, offset, totalLines: lines.length, truncated },
      bytes: chunk.length,
    }
  } catch (error) {
    throw toExecError(error, { abs, given })
  }
}

/** `fs.write` — whole-file atomic write; new directories need grant.createDirs. */
async function fsWrite(ctx) {
  const given = requireString(ctx.args.path, 'path')
  if (!isStr(ctx.args.content)) throw new ExecError('bad-arg', 'content must be a string')
  const content = ctx.args.content
  const bytes = Buffer.byteLength(content, 'utf8')
  const maxWrite = limitOf(ctx.limits, 'maxWriteBytes')
  if (bytes > maxWrite) throw new ExecError('too-large', `content is ${bytes} bytes, above the write limit of ${maxWrite}`)
  const abs = resolveFs(ctx.policy, ctx.grant, given, true)
  try {
    await ensureParent(ctx, abs, given)
    const created = !(await pathExists(abs))
    if (!created && (await fsp.stat(abs)).isDirectory()) throw new ExecError('is-dir', `${given} is a directory`)
    await atomicWrite(abs, content)
    return { value: { path: given, bytes, created }, bytes }
  } catch (error) {
    throw toExecError(error, { abs, given })
  }
}

/** `fs.edit` — exact literal replacement with the local edit tool's semantics. */
async function fsEdit(ctx) {
  const given = requireString(ctx.args.path, 'path')
  if (!isStr(ctx.args.oldString)) throw new ExecError('bad-arg', 'oldString must be a string')
  const oldString = ctx.args.oldString
  if (oldString === '') throw new ExecError('bad-arg', 'oldString must not be empty')
  const rawNew = ctx.args.newString
  if (rawNew !== undefined && rawNew !== null && !isStr(rawNew)) throw new ExecError('bad-arg', 'newString must be a string')
  const newString = rawNew === undefined || rawNew === null ? '' : rawNew
  const replaceAll = ctx.args.replaceAll === true
  const abs = resolveFs(ctx.policy, ctx.grant, given, true)
  try {
    const info = await fsp.stat(abs)
    if (info.isDirectory()) throw new ExecError('is-dir', `${given} is a directory`)
    const maxRead = limitOf(ctx.limits, 'maxReadBytes')
    if (info.size > maxRead) {
      throw new ExecError('too-large', `${given} is ${info.size} bytes; editing needs the whole file (read limit ${maxRead})`)
    }
    const { count, text: after } = replaceLiteral(await fsp.readFile(abs, 'utf8'), oldString, newString, replaceAll)
    if (count === 0) throw new ExecError('not-found', `oldString not found in ${given}`)
    if (count > 1 && !replaceAll) {
      throw new ExecError(
        'bad-arg',
        `oldString appears ${count} times in ${given}; pass a longer unique string, or set replace_all = true`,
      )
    }
    const bytes = Buffer.byteLength(after, 'utf8')
    const maxWrite = limitOf(ctx.limits, 'maxWriteBytes')
    if (bytes > maxWrite) throw new ExecError('too-large', `the edit would write ${bytes} bytes (limit ${maxWrite})`)
    await atomicWrite(abs, after)
    return { value: { path: given, replaced: count, totalLines: splitLines(after).length }, bytes }
  } catch (error) {
    throw toExecError(error, { abs, given })
  }
}

// --- shell -------------------------------------------------------------------

/** The platform's real shell: PowerShell 7, else Windows PowerShell, else /bin/sh. */
function resolveShell() {
  if (process.platform !== 'win32') return { file: existsSync('/bin/sh') ? '/bin/sh' : 'sh', args: SH_ARGS }
  const pwsh = findOnPath('pwsh.exe') ?? findOnPath('pwsh')
  if (pwsh !== null) return { file: pwsh, args: PS_ARGS }
  return { file: findOnPath('powershell.exe') ?? 'powershell.exe', args: PS_ARGS }
}

function findOnPath(exe) {
  for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Kill the whole tree: Windows has no process groups, so taskkill walks it.
 *
 * THE ORDER IS THE WHOLE POINT. `taskkill /T` discovers the tree by walking
 * parent -> child, so killing the root first leaves it nothing to walk: it exits
 * 128, every grandchild is orphaned, and a surviving child holding the stdio
 * pipes keeps this handler alive until the grace timer fires. Measured before the
 * fix: a relayed `shell.exec` whose caller gave up at 2 s was refused correctly,
 * audited as `exit -1`, and the command it started still wrote its file four
 * seconds later — a remote side effect that nobody was waiting for any more.
 *
 * So: let taskkill finish the walk, and keep the direct kill only as a backstop
 * for the cases where taskkill is missing, fails, or never answers.
 */
function killTree(child) {
  const pid = child.pid
  if (typeof pid !== 'number') return
  if (process.platform === 'win32') {
    let settled = false
    const backstop = () => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    try {
      const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      taskkill.on('error', backstop)
      taskkill.on('close', (code) => {
        // exit 0 means the whole tree, root included, is gone. Anything else
        // means taskkill could not do the job (already exited, access denied,
        // missing binary), so fall back to the direct kill.
        if (code === 0) settled = true
        else backstop()
      })
      taskkill.unref()
      // A taskkill that hangs must not leave a live command behind.
      const timer = setTimeout(backstop, 1500)
      timer.unref?.()
      return
    } catch {
      /* taskkill unavailable: fall through to the direct kill */
    }
  }
  try {
    process.kill(-pid, 'SIGKILL') // negative pid = the detached process group
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn the command and settle exactly once. A non-zero exit code is a result,
 * not a failure; only a spawn/IO failure rejects.
 */
function runShell({ shell, command, cwd, timeoutMs, maxOutputBytes, signal, started }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(shell.file, [...shell.args, command], {
        cwd, env: process.env, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(toExecError(error))
      return
    }

    const out = []
    const err = []
    let captured = 0
    let truncated = false
    let killed = null
    let settled = false
    let killTimer = null
    let graceTimer = null

    /** Resolve or reject once, and always drop every listener and timer. */
    const finish = (error, exitCode, sig) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      if (graceTimer !== null) clearTimeout(graceTimer)
      signal?.removeEventListener?.('abort', onAbort)
      if (error !== null) {
        reject(toExecError(error))
        return
      }
      resolve({
        value: {
          exitCode,
          ...(sig === undefined ? {} : { signal: sig }),
          stdout: trimPartialUtf8(Buffer.concat(out)).toString('utf8'),
          stderr: trimPartialUtf8(Buffer.concat(err)).toString('utf8'),
          truncated,
          durationMs: Date.now() - started,
          cwd,
        },
        bytes: captured,
      })
    }

    /** Kill once, then guarantee settlement even if a pipe holder delays `close`. */
    const killFor = (reason) => {
      if (killed !== null) return
      killed = reason
      killTree(child)
      graceTimer = setTimeout(() => finish(null, -1, killed), KILL_GRACE_MS)
    }

    const onAbort = () => killFor('aborted')
    /** Capture up to the cap, but always drain: a full pipe would block the child. */
    const onData = (sink, data) => {
      const remaining = maxOutputBytes - captured
      if (remaining <= 0) {
        truncated = true
        return
      }
      if (data.length > remaining) {
        sink.push(data.subarray(0, remaining))
        captured += remaining
        truncated = true
        return
      }
      sink.push(data)
      captured += data.length
    }

    child.stdout?.on('data', (data) => onData(out, data))
    child.stderr?.on('data', (data) => onData(err, data))
    child.on('error', (error) => finish(error, -1))
    child.on('close', (code, sig) => {
      if (killed !== null) return finish(null, typeof code === 'number' && code !== 0 ? code : -1, killed)
      finish(null, typeof code === 'number' ? code : -1, sig === null || sig === undefined ? undefined : String(sig))
    })

    killTimer = setTimeout(() => {
      if (!settled) killFor('timeout')
    }, timeoutMs)
    if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted === true) onAbort() // aborted between the entry check and here
    }
  })
}

/** `shell.exec` — real shell, locked cwd, hard timeout, capped output. */
async function shellExec(ctx) {
  const command = requireString(ctx.args.command, 'command')
  const rawCwd = ctx.args.cwd
  if (rawCwd !== undefined && rawCwd !== null && !isStr(rawCwd)) throw new ExecError('bad-arg', 'cwd must be a string')
  requireGrant(ctx.grant)

  // The grant table decides whether shell is allowed at all, before anything runs.
  const verdict = callPolicy(() => ctx.policy.checkShell(ctx.grant, command))
  if (verdict?.ok !== true) throw denial(verdict, 'shell-denied', 'shell execution is not granted to this peer')

  const inputCwd = rawCwd === undefined || rawCwd === null || rawCwd === '' ? ctx.grant.cwdRoot : rawCwd
  const cwd = resolveCwd(ctx.policy, ctx.grant, inputCwd)
  const ceiling = Math.max(MIN_TIMEOUT_MS, limitOf(ctx.limits, 'maxTimeoutMs'))
  const fallback = limitOf(ctx.limits, 'defaultTimeoutMs')
  const timeoutMs = optionalInt(ctx.args.timeoutMs, 'timeoutMs', fallback, MIN_TIMEOUT_MS, ceiling)
  const started = Date.now()

  if (ctx.signal?.aborted === true) {
    return {
      value: { exitCode: -1, signal: 'aborted', stdout: '', stderr: '', truncated: false, durationMs: 0, cwd },
      bytes: 0,
    }
  }
  const maxOutputBytes = limitOf(ctx.limits, 'maxOutputBytes')
  return runShell({ shell: resolveShell(), command, cwd, timeoutMs, maxOutputBytes, signal: ctx.signal, started })
}

/** `sys.info` — host fingerprint; no filesystem or shell access involved. */
async function sysInfo() {
  try {
    const value = {
      hostname: hostname(), platform: process.platform, release: release(), arch: arch(),
      cpus: cpus().length, totalMemBytes: totalmem(), node: process.version, cwd: process.cwd(),
    }
    return { value, bytes: Buffer.byteLength(JSON.stringify(value), 'utf8') }
  } catch (error) {
    throw toExecError(error)
  }
}

const CAPS = {
  'fs.list': fsList, 'fs.read': fsRead, 'fs.write': fsWrite,
  'fs.edit': fsEdit, 'shell.exec': shellExec, 'sys.info': sysInfo,
}

/** Best-effort audit target: the peer's own view of what it asked for. */
function targetOf(cap, args) {
  if (typeof args !== 'object' || args === null) return undefined
  if (cap === 'shell.exec') return isStr(args.command) ? args.command : undefined
  return isStr(args.path) ? args.path : undefined
}

/**
 * Build the bridge-side executor. `handle(cap, args, { grant, signal })` resolves
 * to the capability's JSON value, or throws an `ExecError`.
 */
export function createExecutor({ policy, log } = {}) {
  if (policy === null || typeof policy !== 'object') throw new ExecError('bad-arg', 'createExecutor requires a policy object')

  /** Audit is fire-and-forget: a broken sink must never mask or break a call. */
  const audit = (entry) => {
    try {
      if (typeof policy.audit === 'function') policy.audit(entry)
    } catch (error) {
      try {
        log?.warn?.('audit sink failed', error?.message ?? String(error))
      } catch {
        /* logging must not throw either */
      }
    }
  }

  async function handle(cap, args, options) {
    const started = Date.now()
    const grant = options?.grant
    const signal = options?.signal
    const target = targetOf(cap, args)
    const impl = isStr(cap) ? CAPS[cap] : undefined
    if (impl === undefined) {
      audit({ cap: String(cap), target, allowed: false, reason: 'unsupported capability', ms: 0 })
      throw new ExecError('unsupported', `unsupported capability: ${String(cap)}`)
    }
    try {
      const outcome = await impl({ policy, grant, signal, limits: policy.limits, args: normalizeArgs(args) })
      const bytes = typeof outcome.bytes === 'number' ? outcome.bytes : 0
      audit({ cap, target, allowed: true, bytes, ms: Date.now() - started })
      return outcome.value
    } catch (error) {
      const failure = toExecError(error)
      audit({ cap, target, allowed: false, reason: failure.message, ms: Date.now() - started })
      throw failure
    }
  }

  return { handle }
}
