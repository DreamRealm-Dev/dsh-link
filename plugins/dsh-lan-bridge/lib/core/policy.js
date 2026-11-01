/**
 * Bridge-side authorization policy.
 *
 * This is the security boundary of the whole bridge. The peer is untrusted: it
 * may send any path and any command, and none of it may reach the filesystem or
 * a shell before this module has approved it. Everything here is pure and
 * synchronous so the decision is auditable and unit-testable.
 *
 * Threat model it defends:
 *   - path traversal (`..`), absolute paths outside the granted roots
 *   - symlink/junction escapes: a path that *looks* inside a root but resolves
 *     outside it, including via a non-existent leaf under a symlinked ancestor
 *   - Windows drive-relative and UNC/device `\\?\` forms that bypass naive
 *     prefix checks
 *   - case-insensitive filesystems (Windows, macOS APFS) where a separator-aware
 *     - but case-sensitive prefix check would otherwise mis-compare
 *   - NUL-byte truncation tricks
 *
 * What it deliberately does NOT claim: a shell grant is powerful, and no
 * allow-list makes arbitrary command execution safe. The real controls are the
 * user's explicit per-device approval in the UI, the ability to revoke it at any
 * moment, and the audit log. The deny list below is defence in depth only.
 */

import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path'

export class PolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
  }
}

/** Windows and macOS compare paths case-insensitively; Linux does not. */
const CASE_INSENSITIVE_FS = process.platform !== 'linux'

function fold(value) {
  return CASE_INSENSITIVE_FS ? value.toLowerCase() : value
}

/** Separator-aware containment: equal, or a real child (never `/root2` under `/root`). */
export function containsPath(root, candidate) {
  const a = fold(root)
  const b = fold(candidate)
  if (a === b) return true
  const prefix = a.endsWith(sep) ? a : a + sep
  return b.startsWith(prefix)
}

/** Windows reserved device names: mean a device in every directory, never a file. */
const WINDOWS_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

/** Reject forms that a string prefix check cannot reason about. */
function rejectHostileForm(input) {
  if (typeof input !== 'string' || input.length === 0) return 'the path is empty'
  if (input.length > 4096) return 'the path is longer than 4096 characters'
  if (input.includes('\0')) return 'the path contains a NUL byte'
  // Windows namespace forms: \\?\C:\… , \\.\PIPE\… , \??\… and bare UNC.
  if (input.startsWith('\\\\') || input.startsWith('//') || input.startsWith('\\??\\')) {
    return 'UNC, namespace and device paths are not accepted'
  }
  if (/^[a-zA-Z]:$/.test(input)) return 'a bare drive letter is not a path'
  if (process.platform === 'win32') {
    // An NTFS alternate data stream (`file.txt:stream`) hides content from a
    // plain read and is a classic way to smuggle data past a path check. A
    // colon is only legal as the drive separator at index 1.
    const colon = input.indexOf(':', 2)
    if (colon !== -1) return 'NTFS alternate data streams are not accepted'
    for (const segment of input.split(/[\\/]+/)) {
      if (WINDOWS_DEVICE_NAMES.test(segment)) {
        return `${segment} is a reserved Windows device name, not a file path`
      }
    }
  }
  return undefined
}

/**
 * Canonicalize a path for comparison without requiring the leaf to exist.
 *
 * `realpathSync` fails on a non-existent target, so we walk up to the deepest
 * existing ancestor, resolve THAT, then re-append the missing tail. This is what
 * defeats "symlinked directory + non-existent child" escapes.
 */
export function canonicalize(inputPath) {
  let abs = normalize(resolve(inputPath))
  const tail = []
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(abs)) {
      let real
      try {
        real = realpathSync.native(abs)
      } catch {
        try {
          real = realpathSync(abs)
        } catch {
          real = abs
        }
      }
      return tail.length === 0 ? real : join(real, ...tail.reverse())
    }
    const parent = parse(abs).dir
    if (parent === abs) return abs
    tail.push(abs.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
    abs = parent
  }
  return abs
}

/** Normalize one root entry from a grant into an absolute canonical string. */
function canonicalRoot(root, cwdRoot) {
  const base = isAbsolute(root) ? root : join(cwdRoot ?? process.cwd(), root)
  return canonicalize(base)
}

export function createPolicy({ limits, denyPatterns, audit } = {}) {
  const effectiveLimits = {
    maxReadBytes: 8 * 1024 * 1024,
    maxWriteBytes: 8 * 1024 * 1024,
    maxOutputBytes: 512 * 1024,
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    maxListEntries: 2000,
    ...(limits ?? {}),
  }

  const deny = (denyPatterns ?? [
    // Catastrophic, never-a-debug-operation commands. Matched case-insensitively
    // against the raw command line; deliberately narrow so normal work is not
    // blocked by false positives.
    /\bformat\s+[a-z]:/i,
    /\bmkfs(\.\w+)?\b/i,
    /\bdiskpart\b/i,
    /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\//i,
    /\b(shutdown|reboot|halt|poweroff)\b/i,
    /\brm\s+(-[a-z]*\s+)*-\/[a-z]*\s*(\s|$)/i,
    /\bRemove-Item\s+[^\n]*-Recurse[^\n]*\s[\\/]\s*$/i,
    // Disk-wiping Windows forms that the POSIX patterns above miss.
    /\b(del|erase)\s+(\/[a-z]\s+)*[a-z]:[\\/]\s*$/i,
    /\bformat-volume\b/i,
    /\bClear-Disk\b/i,
    // Download-and-execute one-liners: the pragmatic shape of a remote payload.
    /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i,
    /\b(powershell|pwsh)\b[^\n]*-(enc|encodedcommand)\b/i,
  ])

  function auditSafe(entry) {
    try {
      audit?.({ tsMs: Date.now(), ...entry })
    } catch {
      /* auditing must never break an operation */
    }
  }

  /** Resolve a caller-supplied path under a grant, or refuse it. */
  function resolveFsPath(grant, inputPath, options = {}) {
    const forWrite = options.forWrite === true
    const bad = rejectHostileForm(inputPath)
    if (bad !== undefined) return { ok: false, code: 'bad-arg', reason: bad }
    if (grant === undefined || grant === null || !Array.isArray(grant.roots) || grant.roots.length === 0) {
      return { ok: false, code: 'not-granted', reason: 'no directory root was granted for this peer' }
    }
    if (forWrite && grant.write !== true) {
      return { ok: false, code: 'not-granted', reason: 'this peer has read-only access; the bridge side must grant write access' }
    }
    const cwdRoot = grant.cwdRoot ?? grant.roots[0]
    const roots = grant.roots.map((r) => canonicalRoot(r, cwdRoot))
    const candidate = canonicalize(isAbsolute(inputPath) ? inputPath : join(cwdRoot, inputPath))
    const inside = roots.some((root) => containsPath(root, candidate))
    if (!inside) {
      return {
        ok: false,
        code: 'path-denied',
        reason: `${inputPath} resolves outside the granted roots (${grant.roots.join(', ')})`,
      }
    }
    return { ok: true, abs: candidate }
  }

  /** Resolve a shell working directory under the same rules. */
  function resolveShellCwd(grant, inputCwd) {
    if (inputCwd === undefined || inputCwd === null || inputCwd === '') {
      const fallback = grant?.cwdRoot ?? grant?.roots?.[0]
      if (fallback === undefined) return { ok: false, code: 'not-granted', reason: 'no working directory was granted' }
      return { ok: true, abs: canonicalize(fallback) }
    }
    return resolveFsPath(grant, inputCwd, { forWrite: true })
  }

  /** Approve or refuse one shell command line. */
  function checkShell(grant, command) {
    if (grant === undefined || grant === null || grant.shell !== true) {
      return {
        ok: false,
        code: 'shell-denied',
        reason: 'this peer has no shell grant; the bridge side must enable shell access for it in the 连接 panel',
      }
    }
    if (typeof command !== 'string' || command.trim() === '') {
      return { ok: false, code: 'bad-arg', reason: 'the command is empty' }
    }
    if (command.length > 32_768) {
      return { ok: false, code: 'bad-arg', reason: 'the command is longer than 32768 characters' }
    }
    if (command.includes('\0')) {
      return { ok: false, code: 'bad-arg', reason: 'the command contains a NUL byte' }
    }
    for (const pattern of deny) {
      if (pattern.test(command)) {
        return {
          ok: false,
          code: 'shell-denied',
          reason: `the command matches a hard-denied pattern (${String(pattern)}) on the bridge side`,
        }
      }
    }
    return { ok: true }
  }

  /**
   * Describe the default grant offered in the approval UI for a new peer.
   *
   * `relay` is on by default because a chain (A drives B, B drives C) is the
   * point of the bridge; the capability flags are still conjoined at every hop,
   * so a relayed operation can never exceed what this peer may do here or what
   * this machine may do there. The bridge user can turn it off per peer, or
   * narrow it to named devices with `relayPeers`.
   */
  function defaultGrant({ workspaceRoot } = {}) {
    const root = workspaceRoot !== undefined && workspaceRoot !== '' ? workspaceRoot : process.cwd()
    return {
      roots: [root],
      cwdRoot: root,
      write: true,
      shell: false,
      createDirs: false,
      relay: true,
      relayPeers: [],
      timeoutMs: effectiveLimits.defaultTimeoutMs,
      maxOutputBytes: effectiveLimits.maxOutputBytes,
    }
  }

  /** Drop unknown keys and clamp numbers so a persisted grant cannot be poisoned. */
  function sanitizeGrant(input) {
    const source = input !== null && typeof input === 'object' ? input : {}
    const roots = Array.isArray(source.roots)
      ? source.roots.filter((r) => typeof r === 'string' && r.trim() !== '').slice(0, 32)
      : []
    const cwdRoot = typeof source.cwdRoot === 'string' && source.cwdRoot.trim() !== '' ? source.cwdRoot : roots[0]
    const clamp = (value, min, max, fallback) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
    // `relay` defaults to true only when the key is absent entirely; an explicit
    // false must survive a round trip, otherwise turning relaying off in the
    // panel would silently come back on at the next restart.
    const relay = source.relay === undefined ? true : source.relay === true
    return {
      roots: roots.map((r) => canonicalRoot(r, cwdRoot)),
      cwdRoot: cwdRoot === undefined ? undefined : canonicalRoot(cwdRoot, cwdRoot),
      write: source.write === true,
      shell: source.shell === true,
      createDirs: source.createDirs === true,
      relay,
      relayPeers: Array.isArray(source.relayPeers)
        ? source.relayPeers.filter((p) => typeof p === 'string' && p.trim() !== '').slice(0, 64)
        : [],
      timeoutMs: clamp(source.timeoutMs, 1000, effectiveLimits.maxTimeoutMs, effectiveLimits.defaultTimeoutMs),
      maxOutputBytes: clamp(source.maxOutputBytes, 1024, effectiveLimits.maxOutputBytes, effectiveLimits.maxOutputBytes),
    }
  }

  return {
    limits: effectiveLimits,
    audit: auditSafe,
    resolveFsPath,
    resolveShellCwd,
    checkShell,
    defaultGrant,
    sanitizeGrant,
    // exported for tests and for the UI's "why was this refused" text
    _internals: { canonicalize, containsPath, fold, relative },
  }
}

export default { createPolicy, canonicalize, containsPath, PolicyError }
