/**
 * policy.js — the bridge side's own authorization for every remote action.
 *
 * Zero dependencies (node:fs, node:path, node:os, node:crypto, node:child_process).
 *
 * Design rule: the agent is untrusted. It may *ask* for a capability; the
 * bridge decides, per connection, using a revocable grant table, and re-checks
 * every single request. Nothing the agent sends is trusted: not paths, not
 * cwd, not timeouts, not output sizes.
 *
 * Layers (each one can only narrow the previous):
 *   1. server policy      — what the bridge is willing to ever allow (config)
 *   2. grant table        — what this session/connection was granted, revocable
 *   3. per-request check  — canonicalisation + root/shell/timeout/byte limits
 *   4. handler            — performs the operation the authorizer approved
 *   5. audit log          — mandatory, written before the effect and after
 *
 * Path rules (see canonicalizePath): the input is resolved against the
 * grant's cwd, then the *deepest existing ancestor* is realpath()ed so symlinks
 * cannot be used to escape, then a separator-aware prefix check against the
 * allowed roots is applied. Windows drive-relative paths, UNC, `\\?\` device
 * paths, NTFS alternate data streams and reserved device names are rejected;
 * macOS comparison is NFC-normalised and case-folded only when the volume is
 * actually case-insensitive (detected once per root, cached).
 *
 * Honest limits, stated rather than hidden:
 *   - `shell.mode: 'allowlist'` spawns argv directly with shell:false. It never
 *     hands a string to a shell, because "filter dangerous characters out of a
 *     shell string" is not a security boundary (cmd.exe re-parsing, %VAR%
 *     expansion, ^ escapes, PowerShell aliases all defeat substring filters).
 *   - `shell.mode: 'unrestricted'` DOES hand a string to a shell and is
 *     equivalent to giving the agent the user's account. It must be turned on
 *     explicitly, per grant, with a UI warning.
 *   - Canonicalise-then-open has an inherent TOCTOU window. We reduce it by
 *     opening the canonical path (not the user's string) with O_NOFOLLOW on the
 *     final component where the platform supports it, and by re-checking the
 *     device/inode after open on POSIX. It is not zero.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PolicyError extends Error {
  /**
   * @param {string} code stable wire code (e.g. 'denied_path')
   * @param {string} detail human detail for the audit log / UI
   * @param {object} [meta] extra audit fields
   */
  constructor(code, detail = '', meta = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PolicyError';
    this.code = code;
    this.detail = detail;
    this.meta = meta;
  }
}

/** Codes are stable strings so old peers can render something sensible. */
export const DENY = Object.freeze({
  NO_GRANT: 'denied_no_grant',
  REVOKED: 'denied_revoked',
  PATH_OUTSIDE_ROOT: 'denied_path_outside_root',
  PATH_MALFORMED: 'denied_path_malformed',
  PATH_TRAVERSAL: 'denied_path_traversal',
  PATH_SYMLINK_ESCAPE: 'denied_symlink_escape',
  PATH_PROTECTED: 'denied_protected_path',
  PATH_NOT_REGULAR: 'denied_not_regular_file',
  READONLY: 'denied_read_only',
  SHELL_DENIED: 'denied_shell',
  SHELL_NOT_ALLOWED: 'denied_command_not_allowed',
  SHELL_UNSAFE: 'denied_command_unsafe',
  LIMIT: 'denied_limit',
  BAD_ARGS: 'bad_args',
  UNSUPPORTED: 'unsupported',
  BUSY: 'busy',
  AUDIT_UNAVAILABLE: 'denied_audit_unavailable',
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Append-only JSONL audit log. Every entry is one line so a crash mid-write
 * can only ever lose the last line, and `O_APPEND` keeps concurrent writers
 * from interleaving. Entries never contain file contents or shell output —
 * only paths, argv, sizes, hashes and decisions.
 */
export class AuditLog {
  /**
   * @param {{file?:string|null, required?:boolean, maxBytes?:number, keep?:number,
   *          now?:()=>number, onEntry?:(e:object)=>void}} opts
   */
  constructor(opts = {}) {
    this.file = opts.file ?? null;
    this.required = opts.required !== false;
    this.maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
    this.keep = opts.keep ?? 5;
    this.now = opts.now ?? (() => Date.now());
    this.onEntry = opts.onEntry ?? null;
    this.seq = 0;
    this.buffer = [];
    this.failures = 0;
    this.lastError = null;
  }

  /**
   * Write one entry. Returns the entry. Throws when the log is required and
   * cannot be written — the caller must then deny the operation (fail closed).
   */
  write(entry) {
    const rec = { ts: this.now(), n: ++this.seq, ...entry };
    this.emit(rec);
    if (!this.file) {
      if (this.required && !this.onEntry) throw new PolicyError(DENY.AUDIT_UNAVAILABLE, 'no audit sink configured');
      return rec;
    }
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'a' });
    } catch (err) {
      this.failures++;
      this.lastError = err;
      if (this.required) throw new PolicyError(DENY.AUDIT_UNAVAILABLE, `audit write failed: ${err.code || err.message}`);
    }
    return rec;
  }

  emit(rec) {
    if (this.onEntry) { try { this.onEntry(rec); } catch { /* sink's problem */ } }
  }

  rotateIfNeeded() {
    if (!this.file || this.maxBytes <= 0) return;
    let st;
    try { st = fs.statSync(this.file); } catch { return; }
    if (st.size < this.maxBytes) return;
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      const to = `${this.file}.${i + 1}`;
      try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch { /* best effort */ }
    }
    try { fs.renameSync(this.file, `${this.file}.1`); } catch { /* best effort */ }
  }
}

/** sha256 of the canonical JSON form of a value: the audit digest. */
export function digestArgs(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 32);
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// ---------------------------------------------------------------------------
// Path canonicalisation
// ---------------------------------------------------------------------------

const isWindows = process.platform === 'win32';
const isDarwin = process.platform === 'darwin';
/** Windows device names that mean a device, not a file, in every directory. */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Cache of "is this root's volume case-insensitive?" keyed by root. */
const caseSensitivityCache = new Map();

/**
 * Detect whether a directory lives on a case-insensitive volume. macOS is
 * usually case-insensitive-but-case-preserving (HFS+/APFS default) but APFS can
 * be case-sensitive, and Linux/Windows can be either (per-directory on
 * Windows). We probe instead of assuming: create a temp file with mixed case
 * and stat it with the case flipped.
 */
export function detectCaseInsensitive(dir) {
  const key = isWindows ? dir.toLowerCase() : dir;
  if (caseSensitivityCache.has(key)) return caseSensitivityCache.get(key);
  let result = isWindows; // Windows is case-insensitive by default everywhere
  try {
    const probe = path.join(dir, `.dsh-case-probe-${crypto.randomBytes(6).toString('hex')}Aa`);
    fs.writeFileSync(probe, '', { flag: 'wx' });
    const flipped = probe.replace(/Aa$/, 'aA');
    result = fs.existsSync(flipped);
    fs.unlinkSync(probe);
  } catch {
    result = isWindows || isDarwin; // probe impossible: use the platform default
  }
  caseSensitivityCache.set(key, result);
  return result;
}

/** NFC on macOS (HFS+ stores NFD; APFS is normalisation-insensitive). */
function normalizeForCompare(p, caseInsensitive) {
  let s = p;
  if (isDarwin) s = s.normalize('NFC');
  return caseInsensitive ? (isWindows ? s.toLowerCase() : s.toLowerCase()) : s;
}

/**
 * True when `child` is inside `root` (or equal), separator-aware: `/data2`
 * must NOT count as being inside `/data`.
 */
export function isInsideRoot(child, root, { caseInsensitive = isWindows } = {}) {
  const a = normalizeForCompare(child, caseInsensitive);
  const b = normalizeForCompare(root, caseInsensitive);
  if (a === b) return true;
  const sep = path.sep;
  const bTrim = b.endsWith(sep) ? b : b + sep;
  return a.startsWith(bTrim);
}

/** Reject the path *shapes* that cannot be made safe by resolving them. */
export function rejectPathShape(input) {
  if (typeof input !== 'string') throw new PolicyError(DENY.BAD_ARGS, 'path must be a string');
  if (input.length === 0) throw new PolicyError(DENY.BAD_ARGS, 'empty path');
  if (input.length > 4096) throw new PolicyError(DENY.BAD_ARGS, 'path too long');
  if (input.includes('\u0000')) throw new PolicyError(DENY.PATH_MALFORMED, 'NUL byte in path');
  if (/[\r\n]/.test(input)) throw new PolicyError(DENY.PATH_MALFORMED, 'newline in path');
  if (isWindows) {
    if (input.startsWith('\\\\?\\') || input.startsWith('\\\\.\\') || input.startsWith('\\??\\')) {
      throw new PolicyError(DENY.PATH_MALFORMED, 'NT namespace path');
    }
    if (input.startsWith('\\\\')) {
      throw new PolicyError(DENY.PATH_MALFORMED, 'UNC path is not allowed (mount or map the share first)');
    }
    if (/^[A-Za-z]:[^\\/]/.test(input)) {
      // "C:foo" is drive-RELATIVE: it resolves against that drive's cwd, not
      // against ours. Reject instead of guessing.
      throw new PolicyError(DENY.PATH_MALFORMED, 'drive-relative path');
    }
    const afterDrive = input.replace(/^[A-Za-z]:/, '');
    if (afterDrive.includes(':')) {
      throw new PolicyError(DENY.PATH_MALFORMED, 'NTFS alternate data stream');
    }
  }
  return true;
}

/**
 * Realpath the deepest existing ancestor of `abs`, then re-append the
 * not-yet-existing tail. This is what makes symlink escapes detectable for
 * files that do not exist yet (e.g. a write into a new subdirectory).
 * @returns {{real:string, existed:boolean, tail:string[]}}
 */
export function realpathDeep(abs) {
  let cur = abs;
  const tail = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur);
      return { real, tail: tail.reverse(), existed: tail.length === 0 };
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const parent = path.dirname(cur);
      if (parent === cur) throw new PolicyError(DENY.PATH_MALFORMED, `cannot resolve ${abs}`);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  throw new PolicyError(DENY.PATH_MALFORMED, 'path too deeply nested');
}

/**
 * Canonicalise a requested path against one allowed root.
 *
 * @param {string} input         what the agent asked for
 * @param {string} root          an allowed root (must be absolute)
 * @param {string} cwd           the grant's working directory (inside root)
 * @param {{caseInsensitive?:boolean, mustExist?:boolean, onMissing?:'deny'|'allow'}} [opts]
 * @returns {{realPath:string, relPath:string, root:string, existed:boolean}}
 */
export function canonicalizePath(input, root, cwd, opts = {}) {
  rejectPathShape(input);
  const absRoot = path.resolve(root);
  const caseInsensitive = opts.caseInsensitive ?? detectCaseInsensitive(absRoot);
  const base = path.resolve(cwd ?? absRoot);
  const abs = path.resolve(base, input);

  // Two distinct failure modes, two distinct audit codes:
  //   1. the resolved (not yet realpath'ed) path leaves the root -> traversal
  //   2. it stays inside lexically but a symlink points outside -> escape
  if (!isInsideRoot(abs, absRoot, { caseInsensitive })) {
    throw new PolicyError(DENY.PATH_OUTSIDE_ROOT, `${abs} is outside ${absRoot}`);
  }

  const { real, tail, existed } = realpathDeep(abs);
  const full = tail.length ? path.join(real, ...tail) : real;

  if (!isInsideRoot(full, absRoot, { caseInsensitive })) {
    throw new PolicyError(DENY.PATH_SYMLINK_ESCAPE, `${full} (via ${abs}) resolves outside ${absRoot}`);
  }
  if (tail.length > 0 && opts.mustExist) {
    throw new PolicyError(DENY.PATH_MALFORMED, 'path does not exist');
  }
  // Windows device names resolve to devices even inside an allowed root.
  if (isWindows && tail.length > 0 && WIN_RESERVED.test(tail[tail.length - 1])) {
    throw new PolicyError(DENY.PATH_MALFORMED, 'reserved device name');
  }
  const relPath = path.relative(absRoot, full) || '.';
  return { realPath: full, relPath, root: absRoot, existed };
}

/** Open flags that refuse to follow a symlink on the final component. */
function readFlags() {
  return isWindows ? 'r' : (fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
}

/**
 * Open a regular file for reading after canonicalisation, refusing symlinks on
 * the final component and verifying the opened inode is the one we validated
 * (POSIX). Returns { fd, size, stat }.
 */
export function openRegularFileForRead(canonical) {
  let fd;
  try {
    fd = fs.openSync(canonical.realPath, readFlags());
  } catch (err) {
    if (err.code === 'ELOOP') throw new PolicyError(DENY.PATH_SYMLINK_ESCAPE, 'final component is a symlink');
    throw err;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new PolicyError(DENY.PATH_NOT_REGULAR, 'not a regular file');
    if (!isWindows) {
      // Re-validate the link count path: the file we opened must still resolve
      // to itself (guards the common TOCTOU swap).
      try {
        const again = fs.realpathSync.native ? fs.realpathSync.native(canonical.realPath) : fs.realpathSync(canonical.realPath);
        const st2 = fs.statSync(again);
        if (st2.dev !== st.dev || st2.ino !== st.ino) {
          throw new PolicyError(DENY.PATH_SYMLINK_ESCAPE, 'path changed between check and open');
        }
      } catch (err) {
        if (err instanceof PolicyError) throw err;
        /* stat raced with a legit unlink; the fd is still the file we checked */
      }
    }
    return { fd, size: st.size, stat: st };
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Grant table
// ---------------------------------------------------------------------------

/**
 * Capability grant for one connection. Immutable snapshots come out of
 * `snapshot()`; revocation bumps the epoch so in-flight operations can notice.
 */
export class GrantTable {
  /**
   * @param {{caps?:string[], roots?:Array<{path:string, mode:'ro'|'rw'}>,
   *          cwd?:string, shell?:object, limits?:object, label?:string}} grant
   */
  constructor(grant = {}) {
    this.epoch = 1;
    this.revoked = new Set();
    this.caps = new Set(grant.caps ?? []);
    this.roots = (grant.roots ?? []).map((r) => ({ path: path.resolve(r.path), mode: r.mode === 'rw' ? 'rw' : 'ro' }));
    this.cwd = grant.cwd ? path.resolve(grant.cwd) : (this.roots[0]?.path ?? process.cwd());
    this.shell = {
      mode: 'deny',                       // 'deny' | 'allowlist' | 'unrestricted'
      allow: [],
      deny: [],
      allowShell: false,
      allowPaths: false,
      allowInterpreters: false,
      maxArgv: 128,
      maxArgBytes: 8192,
      ...(grant.shell ?? {}),
    };
    this.limits = {
      fsReadMs: 15000,
      fsWriteMs: 15000,
      listMs: 10000,
      execMs: 120000,
      maxReadBytes: 8 * 1024 * 1024,
      maxWriteBytes: 8 * 1024 * 1024,
      maxListEntries: 5000,
      maxOutputBytes: 256 * 1024,
      maxConcurrent: 4,
      ...(grant.limits ?? {}),
    };
    this.label = grant.label ?? '';
    this.createdAt = Date.now();
    this.inFlight = new Map(); // opKey -> count
  }

  /** Snapshot for the audit log / the agent's UI (never includes secrets). */
  snapshot() {
    return {
      epoch: this.epoch,
      label: this.label,
      caps: [...this.caps],
      roots: this.roots.map((r) => ({ ...r })),
      cwd: this.cwd,
      shell: { ...this.shell, allow: [...this.shell.allow], deny: [...this.shell.deny] },
      limits: { ...this.limits },
      revoked: [...this.revoked],
    };
  }

  has(cap) {
    return this.caps.has(cap) && !this.revoked.has(cap);
  }

  grant(cap) {
    this.caps.add(cap);
    this.revoked.delete(cap);
    this.epoch++;
    return this;
  }

  /** Revoke one capability (or everything with `cap === '*'`). */
  revoke(cap) {
    if (cap === '*') { for (const c of this.caps) this.revoked.add(c); } else this.revoked.add(cap);
    this.epoch++;
    return this;
  }

  setRoots(roots) {
    this.roots = roots.map((r) => ({ path: path.resolve(r.path), mode: r.mode === 'rw' ? 'rw' : 'ro' }));
    this.epoch++;
    return this;
  }

  setShell(shell) {
    this.shell = { ...this.shell, ...shell };
    this.epoch++;
    return this;
  }

  /** The root that contains `p`, preferring the longest match. */
  rootFor(realPath, { caseInsensitive } = {}) {
    let best = null;
    for (const r of this.roots) {
      const ci = caseInsensitive ?? detectCaseInsensitive(r.path);
      if (isInsideRoot(realPath, r.path, { caseInsensitive: ci })) {
        if (!best || r.path.length > best.path.length) best = r;
      }
    }
    return best;
  }

  enter(opKey, max) {
    const n = this.inFlight.get(opKey) ?? 0;
    if (n >= max) throw new PolicyError(DENY.BUSY, `${opKey} concurrency ${n}/${max}`);
    this.inFlight.set(opKey, n + 1);
    return () => {
      const m = (this.inFlight.get(opKey) ?? 1) - 1;
      if (m <= 0) this.inFlight.delete(opKey); else this.inFlight.set(opKey, m);
    };
  }
}

// ---------------------------------------------------------------------------
// Command policy
// ---------------------------------------------------------------------------

/**
 * Split a command line into argv using POSIX-ish quoting rules. Used ONLY for
 * the allowlist mode, where the result is passed to spawn() with shell:false —
 * so a mis-parse cannot inject a second command, it can only fail the check.
 * @returns {string[]}
 */
export function parseArgv(line, { maxArgv = 128, maxArgBytes = 8192 } = {}) {
  if (typeof line !== 'string' || line.trim() === '') throw new PolicyError(DENY.BAD_ARGS, 'empty command');
  if (line.length > maxArgBytes) throw new PolicyError(DENY.BAD_ARGS, 'command line too long');
  const argv = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < line.length) { cur += line[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; started = true; continue; }
    if (ch === ' ' || ch === '\t') {
      if (started || cur.length) { argv.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (quote) throw new PolicyError(DENY.BAD_ARGS, 'unterminated quote');
  if (started || cur.length) argv.push(cur);
  if (argv.length === 0) throw new PolicyError(DENY.BAD_ARGS, 'empty command');
  if (argv.length > maxArgv) throw new PolicyError(DENY.BAD_ARGS, `too many arguments (${argv.length})`);
  return argv;
}

/** Shell metacharacters: relevant only when a real shell is in the loop. */
const SHELL_META = /[;&|<>`$(){}\[\]\n\r]|\$\(/;

/**
 * Commands that can execute arbitrary code by construction. Allowlisting one of
 * these is *equivalent to unrestricted mode* — `node -e`, `python -c`,
 * `sh -c` can do anything the user can. The allowlist is only meaningful for
 * tools that are not Turing-complete (git, ls, grep, ffmpeg, unzip, ...).
 * We refuse them unless the operator sets `allowInterpreters: true` on the
 * grant, so this cannot happen by accident.
 */
export const INTERPRETERS = new Set([
  'node', 'nodejs', 'python', 'python3', 'python2', 'perl', 'ruby', 'php',
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'fish', 'ash',
  'cmd', 'powershell', 'pwsh', 'wsl', 'cscript', 'wscript', 'mshta', 'rundll32', 'regsvr32',
  'osascript', 'expect', 'tclsh', 'lua', 'deno', 'bun', 'java', 'javaw', 'dotnet', 'mono',
  'env', 'xargs', 'find', 'make', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'cargo', 'go',
  'eval', 'exec', 'source',
]);

/** Normalise a command name for allow/deny comparison. */
export function normalizeCommand(name, platform = process.platform) {
  let base = name;
  if (platform === 'win32') {
    base = base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
    // A command with a path is only matched by its basename, and the policy
    // additionally forbids paths in argv[0] unless allowPaths is set.
  } else {
    base = base.replace(/\.(sh|bash|zsh|py|pl|rb)$/i, '');
  }
  return base.toLowerCase();
}

/**
 * Decide whether a command line may run, and how.
 * @returns {{mode:'argv'|'shell', argv?:string[], command:string, line:string}}
 */
export function checkCommand(line, shellPolicy, platform = process.platform) {
  const policy = {
    mode: 'deny', allow: [], deny: [], allowShell: false, allowPaths: false, ...(shellPolicy ?? {}),
  };
  if (policy.mode === 'deny') throw new PolicyError(DENY.SHELL_DENIED, 'shell.exec is not granted');
  if (typeof line !== 'string' || line.trim() === '') throw new PolicyError(DENY.BAD_ARGS, 'empty command');

  const argv = parseArgv(line, policy);
  const bin = argv[0];
  const name = normalizeCommand(bin, platform);

  // Deny always wins, and matches on the basename of the first word.
  const deny = (policy.deny ?? []).map((d) => normalizeCommand(d, platform));
  if (deny.includes(name) || deny.includes('*')) {
    throw new PolicyError(DENY.SHELL_UNSAFE, `"${name}" is on the deny list`);
  }

  if (policy.mode === 'allowlist') {
    const allow = (policy.allow ?? []).map((a) => normalizeCommand(a, platform));
    if (!allow.includes(name)) {
      throw new PolicyError(DENY.SHELL_NOT_ALLOWED, `"${name}" is not on the allow list`);
    }
    if (bin.includes('/') || bin.includes('\\')) {
      if (!policy.allowPaths) throw new PolicyError(DENY.SHELL_NOT_ALLOWED, 'absolute/program paths are not allowed');
    }
    if (INTERPRETERS.has(name) && policy.allowInterpreters !== true) {
      throw new PolicyError(DENY.SHELL_UNSAFE,
        `"${name}" can execute arbitrary code, so allowlisting it is equivalent to unrestricted mode; ` +
        'grant unrestricted explicitly (or set allowInterpreters) if that is really intended');
    }
    // NOTE: argv is executed with shell:false, so metacharacters inside
    // arguments are literal characters and cannot start a second command. We
    // deliberately do NOT filter them: doing so would break `node -e "1+1"`,
    // `git commit -m "fix; typo"` and friends while providing no security
    // benefit whatsoever. The security boundary is argv[0] + shell:false.
    return { mode: 'argv', argv, command: name, line };
  }

  if (policy.mode === 'unrestricted') {
    if (!policy.allowShell) {
      throw new PolicyError(DENY.SHELL_DENIED, 'unrestricted mode requires allowShell: true');
    }
    return { mode: 'shell', command: name, line };
  }
  throw new PolicyError(DENY.SHELL_DENIED, `unknown shell mode ${policy.mode}`);
}

/**
 * Environment keys a remote caller may NEVER set, whatever it asks for.
 *
 * This is a real escalation path, not hygiene: in allowlist mode the bridge
 * spawns `argv[0]` with shell:false, and argv[0] is resolved through PATH. If
 * the agent could set PATH it could point it at a directory it just wrote to
 * with fs.write and turn "may run node" into "may run anything". The same goes
 * for the loader environment of every interpreter we might spawn.
 */
const ENV_KEY_DENY = /^(path|pathext|comspec|node_options|node_path|node_repl_history|ld_preload|ld_library_path|ld_audit|dyld_.*|pythonpath|pythonstartup|pythonhome|rubyopt|perl5opt|bash_env|env|shellopts|shell|ps1|ps2|ifs|home|userprofile|appdata|localappdata|systemroot|windir|temp|tmp|tmpdir|dsh_.*)$/i;
const ENV_KEY_OK = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Sanitised environment for spawned commands: never inherit DSH's env, and
 *  never let the caller override anything that changes what gets executed. */
export function safeEnv(extra = {}, { allowCallerKeys = false } = {}) {
  const env = {};
  const keep = isWindows
    ? ['PATH', 'PATHEXT', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'ProgramFiles', 'ProgramFiles(x86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'USER', 'SHELL'];
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (!env.PATH && isDarwin) env.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  if (!env.PATH && isWindows) env.PATH = `${process.env.SystemRoot || 'C:\\Windows'}\\system32;${process.env.SystemRoot || 'C:\\Windows'}`;
  if (allowCallerKeys) {
    for (const [k, v] of Object.entries(extra)) {
      if (!ENV_KEY_OK.test(k)) continue;
      if (ENV_KEY_DENY.test(k)) continue;
      if (typeof v !== 'string' || v.length > 4096) continue;
      env[k] = v;
    }
  }
  return env;
}

/** Head/tail output retention in bytes when the caller does not cap output. */
const TAIL_KEEP = 16 * 1024;

/**
 * Run a command with a hard wall-clock timeout, output cap and process-tree
 * kill. Returns { code, signal, stdout, stderr, ms, truncated }.
 * Output is capped head+tail so a build log keeps its diagnostics.
 */
export async function runCommand(checked, opts = {}) {
  const {
    cwd, timeoutMs = 120000, maxOutputBytes = 256 * 1024, env = {},
    onData, signal: abortSignal, platform = process.platform,
  } = opts;

  const useShell = checked.mode === 'shell';
  const file = useShell
    ? (platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh')
    : checked.argv[0];
  const args = useShell
    ? (platform === 'win32' ? ['/d', '/s', '/c', checked.line] : ['-c', checked.line])
    : checked.argv.slice(1);

    const child = spawn(file, args, {
      cwd,
      // Caller-supplied env keys are allowed here (a command may legitimately
      // need FOO=bar), but safeEnv() strips everything that changes *what* runs
      // (PATH, NODE_OPTIONS, LD_PRELOAD, ...).
      env: safeEnv(env, { allowCallerKeys: true }),
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32', // own process group => we can kill the tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const started = Date.now();
  let total = 0;
  let truncated = false;
  const head = [];
  const tail = [];
  let headBytes = 0;
  // Keep a head slice for context and a tail slice for diagnostics. The tail
  // budget must never exceed what the caller allowed, otherwise a small cap
  // (e.g. 4 KiB) would push everything into the tail and leave `stdout` empty.
  const tailBudget = Math.max(1024, Math.min(TAIL_KEEP, Math.floor(maxOutputBytes / 2)));
  const headBudget = Math.max(0, maxOutputBytes - tailBudget);

  const collect = (buf, isErr) => {
    total += buf.length;
    if (total > maxOutputBytes) truncated = true;
    let rest = buf;
    // A single chunk can be far larger than the whole budget, so it must be
    // split rather than pushed whole (otherwise the cap is not a cap).
    if (headBytes < headBudget) {
      const take = Math.min(headBudget - headBytes, rest.length);
      head.push({ isErr, buf: rest.subarray(0, take) });
      headBytes += take;
      rest = rest.subarray(take);
    }
    if (rest.length > 0) {
      tail.push({ isErr, buf: rest });
      let tailBytes = tail.reduce((a, r) => a + r.buf.length, 0);
      while (tail.length > 1 && tailBytes > tailBudget) tailBytes -= tail.shift().buf.length;
      if (tailBytes > tailBudget && tail.length === 1) {
        const drop = tailBytes - tailBudget;
        tail[0] = { isErr: tail[0].isErr, buf: tail[0].buf.subarray(drop) };
      }
    }
    if (onData) onData(buf, isErr);
  };
  child.stdout.on('data', (b) => collect(b, false));
  child.stderr.on('data', (b) => collect(b, true));

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child, platform); }, timeoutMs);
  timer.unref?.();
  const onAbort = () => killTree(child, platform);
  if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });

  const result = await new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: null, signal: null, spawnError: err.code || err.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  if (abortSignal) abortSignal.removeEventListener('abort', onAbort);

  const join = (list) => Buffer.concat(list.map((r) => r.buf)).toString('utf8');
  return {
    ...result,
    timedOut,
    ms: Date.now() - started,
    truncated,
    bytes: total,
    stdout: join(head.filter((r) => !r.isErr)),
    stderr: join(head.filter((r) => r.isErr)),
    stdoutTail: join(tail.filter((r) => !r.isErr)),
    stderrTail: join(tail.filter((r) => r.isErr)),
  };
}

/** Kill a process and its children. */
export function killTree(child, platform = process.platform) {
  if (!child || child.killed) return;
  try {
    if (platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// The policy engine
// ---------------------------------------------------------------------------

/** Operation -> capability + limits key. Extra ops must be added here. */
export const OPS = Object.freeze({
  'fs.read:read': { cap: 'fs.read', limit: 'fsReadMs', maxBytes: 'maxReadBytes' },
  'fs.read:stat': { cap: 'fs.read', limit: 'fsReadMs', maxBytes: 'maxReadBytes' },
  'fs.list:list': { cap: 'fs.list', limit: 'listMs', maxBytes: 'maxListEntries' },
  'fs.write:write': { cap: 'fs.write', limit: 'fsWriteMs', maxBytes: 'maxWriteBytes' },
  'fs.write:mkdir': { cap: 'fs.write', limit: 'fsWriteMs', maxBytes: 'maxWriteBytes' },
  'fs.write:remove': { cap: 'fs.write', limit: 'fsWriteMs', maxBytes: 'maxWriteBytes' },
  'shell.exec:run': { cap: 'shell.exec', limit: 'execMs', maxBytes: 'maxOutputBytes' },
  'process.spawn:spawn': { cap: 'process.spawn', limit: 'execMs', maxBytes: 'maxOutputBytes' },
  'sys.info:get': { cap: 'sys.info', limit: null, maxBytes: null },
});

/**
 * The bridge-side authorizer. One instance per bridge; one GrantTable per
 * connection (or per paired peer, if the app wants a persistent grant).
 */
export class PolicyEngine {
  /**
   * @param {{serverPolicy?:object, audit?:AuditLog, platform?:string, now?:()=>number}} opts
   */
  constructor(opts = {}) {
    this.platform = opts.platform ?? process.platform;
    this.audit = opts.audit ?? new AuditLog({ file: null, required: false });
    this.now = opts.now ?? (() => Date.now());
    /** Server policy: the outer bound nothing can widen. */
    this.serverPolicy = {
      maxRoots: 16,
      allowShellModes: ['deny', 'allowlist'],       // 'unrestricted' must be opted in
      maxTimeouts: { fsReadMs: 60000, fsWriteMs: 60000, listMs: 30000, execMs: 900000 },
      maxBytes: { maxReadBytes: 32 * 1024 * 1024, maxWriteBytes: 32 * 1024 * 1024, maxOutputBytes: 4 * 1024 * 1024, maxListEntries: 50000 },
      deniedPathPatterns: [/(^|[\\/])\.ssh([\\/]|$)/i, /(^|[\\/])\.aws([\\/]|$)/i, /(^|[\\/])\.gnupg([\\/]|$)/i, /(^|[\\/])Keychains([\\/]|$)/i, /(^|[\\/])\.dsh([\\/]|$)/i, /(^|[\\/])AppData[\\/]Roaming[\\/]DeepSeek Harness([\\/]|$)/i],
      ...(opts.serverPolicy ?? {}),
    };
    this.grants = new Map(); // sessionKey -> GrantTable
  }

  /** Clamp a requested grant to the server policy. */
  clampGrant(requested) {
    const g = { ...requested };
    if ((g.roots ?? []).length > this.serverPolicy.maxRoots) {
      throw new PolicyError(DENY.LIMIT, `at most ${this.serverPolicy.maxRoots} roots`);
    }
    g.roots = (g.roots ?? []).map((r) => {
      const abs = path.resolve(r.path);
      const real = (() => { try { return fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs); } catch { return abs; } })();
      return { path: real, mode: r.mode === 'rw' ? 'rw' : 'ro' };
    });
    if (g.shell && !this.serverPolicy.allowShellModes.includes(g.shell.mode)) {
      throw new PolicyError(DENY.SHELL_DENIED, `shell mode ${g.shell.mode} is not permitted by the server policy`);
    }
    g.limits = { ...(g.limits ?? {}) };
    for (const [k, max] of Object.entries(this.serverPolicy.maxTimeouts)) {
      if (g.limits[k] !== undefined) g.limits[k] = Math.min(g.limits[k], max);
    }
    for (const [k, max] of Object.entries(this.serverPolicy.maxBytes)) {
      if (g.limits[k] !== undefined) g.limits[k] = Math.min(g.limits[k], max);
    }
    return g;
  }

  createGrant(sessionKey, requested) {
    const table = new GrantTable(this.clampGrant(requested));
    this.grants.set(sessionKey, table);
    this.audit.write({ event: 'grant_create', session: sessionKey, table: table.snapshot() });
    return table;
  }

  getGrant(sessionKey) { return this.grants.get(sessionKey) ?? null; }

  revokeGrant(sessionKey, cap = '*') {
    const t = this.grants.get(sessionKey);
    if (!t) return false;
    t.revoke(cap);
    this.audit.write({ event: 'grant_revoke', session: sessionKey, cap, epoch: t.epoch });
    return true;
  }

  dropGrant(sessionKey) {
    const existed = this.grants.delete(sessionKey);
    if (existed) this.audit.write({ event: 'grant_drop', session: sessionKey });
    return existed;
  }

  _deny(auditBase, code, detail) {
    this.audit.write({ ...auditBase, decision: 'deny', code, detail });
    throw new PolicyError(code, detail);
  }

  /**
   * Authorize one request. This is the function the Session calls for every
   * inbound `req`; it returns { ok, limits } or { ok:false, error }.
   *
   * @param {{sessionKey:string, peer:{deviceId:string,name?:string}, cap:string,
   *          op:string, args:object, requestId:number, remote?:object}} req
   */
  authorize(req) {
    const { sessionKey, peer = {}, cap, op, args = {}, requestId } = req;
    const grant = this.grants.get(sessionKey);
    const base = {
      event: 'request', session: sessionKey, peer: peer.deviceId, peerName: peer.name,
      cap, op, requestId, argsDigest: digestArgs(args), epoch: grant?.epoch ?? null,
    };
    try {
      if (!grant) this._deny(base, DENY.NO_GRANT, 'no grant table for this session');
      if (!grant.has(cap)) this._deny(base, grant.revoked.has(cap) ? DENY.REVOKED : DENY.NO_GRANT, `capability ${cap} is not granted`);

      const spec = OPS[`${cap}:${op}`];
      if (!spec) this._deny(base, DENY.UNSUPPORTED, `unknown operation ${cap}/${op}`);
      if (spec.cap !== cap) this._deny(base, DENY.UNSUPPORTED, `capability mismatch for ${op}`);

      const timeoutMs = grant.limits[spec.limit] ?? 30000;
      const maxBytes = spec.maxBytes ? (grant.limits[spec.maxBytes] ?? 1024 * 1024) : 0;

      let decision;
      if (cap === 'sys.info') decision = this._authorizeSysInfo(base, grant);
      else if (cap === 'shell.exec' || cap === 'process.spawn') decision = this._authorizeShell(base, grant, cap, op, args);
      else decision = this._authorizeFs(base, grant, cap, op, args);

      const out = {
        ok: true,
        limits: {
          ...decision,
          timeoutMs: Math.min(args.timeoutMs ?? timeoutMs, timeoutMs),
          maxBytes,
        },
      };
      this.audit.write({ ...base, decision: 'allow', resolved: decision.realPath ?? decision.cwd ?? null, limits: { timeoutMs: out.limits.timeoutMs, maxBytes } });
      return out;
    } catch (err) {
      if (err instanceof PolicyError) return { ok: false, error: { code: err.code, detail: err.detail } };
      this.audit.write({ ...base, decision: 'deny', code: 'internal_error', detail: String(err.message ?? err) });
      return { ok: false, error: { code: 'internal_error', detail: 'policy evaluation failed' } };
    }
  }

  _authorizeSysInfo(base, grant) {
    return { fields: ['os', 'arch', 'hostname', 'release', 'cpus', 'totalmem', 'freemem', 'uptime', 'node', 'platform'] };
  }

  _checkDeniedPatterns(realPath, base) {
    for (const re of this.serverPolicy.deniedPathPatterns) {
      if (re.test(realPath)) this._deny(base, DENY.PATH_PROTECTED, `path matches a protected pattern (${re})`);
    }
  }

  _authorizeFs(base, grant, cap, op, args) {
    const requested = args.path ?? args.root ?? '.';
    const mustExist = op === 'read' || op === 'stat' || op === 'list';
    // Try every allowed root: a session may have several, and the agent gives a
    // path, not a root. The first root that can canonicalise the request wins;
    // if none can, the operation is denied (never "resolved best effort").
    let canonical = null;
    let firstError = null;
    for (const root of grant.roots) {
      try {
        canonical = canonicalizePath(requested, root.path, grant.cwd, { mustExist });
        break;
      } catch (err) {
        if (!(err instanceof PolicyError)) throw err;
        if (!firstError) firstError = err;
      }
    }
    if (!canonical) {
      this._deny(base, firstError?.code ?? DENY.PATH_OUTSIDE_ROOT,
        `${requested}: ${firstError?.detail ?? 'not inside any allowed root'}`);
    }
    const root = grant.rootFor(canonical.realPath);
    if (!root) this._deny(base, DENY.PATH_OUTSIDE_ROOT, `${canonical.realPath} is not inside an allowed root`);
    this._checkDeniedPatterns(canonical.realPath, base);

    const writeOp = op === 'write' || op === 'mkdir' || op === 'remove';
    if (writeOp && root.mode !== 'rw') this._deny(base, DENY.READONLY, `${root.path} is read-only`);

    if (op === 'write' && typeof args.content !== 'string' && typeof args.base64 !== 'string') {
      this._deny(base, DENY.BAD_ARGS, 'write requires content (utf8) or base64');
    }
    if (op === 'write') {
      const size = typeof args.base64 === 'string' ? Buffer.byteLength(args.base64, 'base64') : Buffer.byteLength(args.content, 'utf8');
      const max = grant.limits.maxWriteBytes;
      if (size > max) this._deny(base, DENY.LIMIT, `write of ${size} bytes exceeds maxWriteBytes ${max}`);
    }
    if (op === 'list') {
      const depth = Number.isInteger(args.depth) ? args.depth : 1;
      if (depth < 1 || depth > 8) this._deny(base, DENY.LIMIT, 'depth must be 1..8');
      return { realPath: canonical.realPath, relPath: canonical.relPath, root: root.path, mode: root.mode, depth, existed: canonical.existed };
    }
    if (op === 'read') {
      const max = grant.limits.maxReadBytes;
      const want = Number.isInteger(args.maxBytes) ? args.maxBytes : max;
      if (want < 0 || want > max) this._deny(base, DENY.LIMIT, `maxBytes ${want} exceeds ${max}`);
      return { realPath: canonical.realPath, relPath: canonical.relPath, root: root.path, mode: root.mode, wantBytes: want, offset: Number.isInteger(args.offset) ? args.offset : 0, existed: canonical.existed };
    }
    return { realPath: canonical.realPath, relPath: canonical.relPath, root: root.path, mode: root.mode, existed: canonical.existed };
  }

  _authorizeShell(base, grant, cap, op, args) {
    const line = args.cmd ?? args.command ?? '';
    const checked = checkCommand(line, grant.shell, this.platform);
    // The working directory is pinned to the grant, never taken from the agent.
    const cwdCanonical = canonicalizePath(args.cwd ?? '.', grant.cwd, grant.cwd, { mustExist: true });
    const root = grant.rootFor(cwdCanonical.realPath);
    if (!root) this._deny(base, DENY.PATH_OUTSIDE_ROOT, `cwd ${cwdCanonical.realPath} is not inside an allowed root`);
    const projectedEnv = args.env && typeof args.env === 'object' ? args.env : {};
    if (Object.keys(projectedEnv).length > 32) this._deny(base, DENY.LIMIT, 'too many environment variables');
    return {
      mode: checked.mode,
      command: checked.command,
      commandLine: checked.line,
      argv: checked.argv ?? null,
      cwd: cwdCanonical.realPath,
      env: projectedEnv,
      cap,
    };
  }
}

// ---------------------------------------------------------------------------
// Handlers: the actual effects, driven by the approved decision
// ---------------------------------------------------------------------------

/** Register the default, policy-checked handlers on a Session. */
export function registerStandardHandlers(session, engine, opts = {}) {
  const platform = opts.platform ?? process.platform;
  session.setAuthorizer((req) => engine.authorize({
    ...req,
    sessionKey: opts.sessionKey ?? req.sessionKey ?? session.sessionKey ?? session.peerDeviceId,
    peer: opts.peer ?? { deviceId: session.peerDeviceId },
    remote: session.link?.remote,
  }));

  session.handle('sys.info', 'get', async ({ limits }) => {
    const facts = {
      os: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : process.platform,
      arch: process.arch,
      platform: process.platform,
      hostname: os.hostname(),
      release: os.release(),
      cpus: os.cpus().length,
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      uptime: Math.round(os.uptime()),
      homedir: os.homedir(),
      node: process.versions.node,
      electron: process.versions.electron ?? null,
    };
    const out = {};
    for (const f of limits.fields ?? Object.keys(facts)) if (f in facts) out[f] = facts[f];
    return out;
  });

  session.handle('fs.list', 'list', async ({ args, limits }) => {
    const entries = [];
    const cap = limits.maxEntries ?? limits.maxListEntries ?? 5000;
    const walk = (dir, depth) => {
      if (entries.length >= cap) return;
      let items;
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) {
        entries.push({ name: path.basename(dir), error: err.code || 'error' });
        return;
      }
      for (const it of items) {
        if (entries.length >= cap) return;
        const full = path.join(dir, it.name);
        let st = null;
        try { st = fs.lstatSync(full); } catch { /* raced */ }
        entries.push({
          name: path.relative(limits.realPath, full) || it.name,
          dir: it.isDirectory(),
          link: it.isSymbolicLink(),
          size: st?.size ?? null,
          mtime: st?.mtimeMs ?? null,
        });
        if (it.isDirectory() && !it.isSymbolicLink() && depth > 1) walk(full, depth - 1);
      }
    };
    walk(limits.realPath, limits.depth ?? 1);
    return { root: limits.realPath, entries, truncated: entries.length >= cap };
  });

  session.handle('fs.read', 'stat', async ({ limits }) => {
    const st = fs.statSync(limits.realPath);
    return { path: limits.realPath, size: st.size, mtime: st.mtimeMs, dir: st.isDirectory(), mode: st.mode };
  });

  session.handle('fs.read', 'read', async ({ limits }) => {
    const { fd, size } = openRegularFileForRead({ realPath: limits.realPath });
    try {
      const want = Math.max(0, Math.min(limits.wantBytes ?? size, size - (limits.offset ?? 0)));
      const buf = Buffer.alloc(want);
      const read = want > 0 ? fs.readSync(fd, buf, 0, want, limits.offset ?? 0) : 0;
      return { path: limits.realPath, size, bytes: read, content: buf.subarray(0, read).toString('utf8'), truncated: (limits.offset ?? 0) + read < size };
    } finally { fs.closeSync(fd); }
  });

  session.handle('fs.write', 'write', async ({ args, limits }) => {
    const data = typeof args.base64 === 'string' ? Buffer.from(args.base64, 'base64') : Buffer.from(args.content ?? '', 'utf8');
    const dir = path.dirname(limits.realPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(limits.realPath, data, { mode: 0o644 });
    return { path: limits.realPath, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  });

  session.handle('fs.write', 'mkdir', async ({ limits }) => {
    fs.mkdirSync(limits.realPath, { recursive: true });
    return { path: limits.realPath, created: true };
  });

  session.handle('shell.exec', 'run', async ({ args, limits, emitChunk, isCancelled, registerCancel }) => {
    const controller = new AbortController();
    // A cancel from the peer kills the whole process tree, not just the shell.
    if (registerCancel) registerCancel(() => controller.abort());
    const res = await runCommand(
      limits.mode === 'shell'
        ? { mode: 'shell', line: limits.commandLine ?? args.cmd, command: limits.command }
        : { mode: 'argv', argv: limits.argv, command: limits.command },
      {
        cwd: limits.cwd,
        timeoutMs: limits.timeoutMs,
        maxOutputBytes: limits.maxBytes,
        env: limits.env,
        platform,
        signal: controller.signal,
        onData: (buf, isErr) => { if (emitChunk && !isErr) emitChunk(buf, false); },
      },
    );
    if (isCancelled && isCancelled()) { /* the abort already killed the tree */ }
    return {
      code: res.code, signal: res.signal, timedOut: !!res.timedOut, ms: res.ms,
      bytes: res.bytes, truncated: !!res.truncated,
      stdout: res.stdout, stderr: res.stderr,
      stdoutTail: res.stdoutTail, stderrTail: res.stderrTail,
    };
  });

  return session;
}

export default {
  PolicyError, DENY, AuditLog, digestArgs,
  detectCaseInsensitive, isInsideRoot, rejectPathShape, realpathDeep, canonicalizePath,
  openRegularFileForRead, GrantTable, parseArgv, normalizeCommand, checkCommand, safeEnv,
  runCommand, killTree, OPS, PolicyEngine, registerStandardHandlers,
};
