#!/usr/bin/env node
/**
 * selftest-exec.mjs — self-test for lib/core/exec.js, the bridge-side executor.
 *
 * Runs against a real temp root with an in-file stub `policy` that implements the
 * same five-method interface as lib/core/policy.js (confinement included), so the
 * executor is exercised end to end: real files, the CURRENT platform's real
 * shell, real process kills. Zero dependencies.
 *
 *   node test/selftest-exec.mjs
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createExecutor, ExecError } from '../lib/core/exec.js'

const IS_WIN = process.platform === 'win32'

// --- temp area ---------------------------------------------------------------

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-exec-selftest-')))
const OUTSIDE_FILE = join(dirname(ROOT), `dsh-exec-outside-${process.pid}.txt`)
const OUTSIDE_DIR = join(dirname(ROOT), `dsh-exec-outside-dir-${process.pid}`)

const LIMITS = {
  maxReadBytes: 64 * 1024,
  maxWriteBytes: 1024,
  maxOutputBytes: 8 * 1024,
  defaultTimeoutMs: 5000,
  maxTimeoutMs: 60000,
}

// --- stub policy: the real confinement rules, in miniature -------------------

const audits = []

/** Resolve through the nearest existing ancestor so a new file is still confined. */
function nearestReal(abs) {
  let current = abs
  const tail = []
  for (;;) {
    if (existsSync(current)) break
    const parent = dirname(current)
    if (parent === current) break
    tail.unshift(basename(current))
    current = parent
  }
  let real
  try {
    real = realpathSync(current)
  } catch {
    return null
  }
  return tail.length === 0 ? real : join(real, ...tail)
}

/** Separator-aware, case-insensitive-on-Windows prefix test. */
function insideRoot(target) {
  const fold = (value) => (IS_WIN ? value.toLowerCase() : value)
  const candidate = fold(target)
  const root = fold(ROOT)
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep)
}

function confiningPath(inputPath, { forWrite = false } = {}, grant) {
  if (typeof inputPath !== 'string' || inputPath === '') {
    return { ok: false, code: 'bad-arg', reason: 'path must be a non-empty string' }
  }
  if (inputPath.includes('\0')) return { ok: false, code: 'bad-arg', reason: 'path contains a NUL byte' }
  const real = nearestReal(resolve(ROOT, inputPath))
  if (real === null) return { ok: false, code: 'not-found', reason: `cannot resolve ${inputPath}` }
  if (!insideRoot(real)) return { ok: false, code: 'path-denied', reason: `${inputPath} resolves outside every granted root` }
  if (forWrite && grant?.write !== true) return { ok: false, code: 'path-denied', reason: 'this grant is read-only' }
  return { ok: true, abs: real }
}

function makePolicy({ limits = LIMITS, audit = (entry) => audits.push(entry) } = {}) {
  return {
    limits,
    audit,
    resolveFsPath(grant, inputPath, options = {}) {
      return confiningPath(inputPath, { forWrite: options.forWrite === true }, grant)
    },
    resolveShellCwd(grant, inputCwd) {
      const raw = inputCwd === undefined || inputCwd === null || inputCwd === '' ? grant?.cwdRoot : inputCwd
      if (typeof raw !== 'string' || raw === '') return { ok: false, code: 'bad-arg', reason: 'cwd must be a string' }
      const real = nearestReal(resolve(ROOT, raw))
      if (real === null || !insideRoot(real)) return { ok: false, code: 'path-denied', reason: `${raw} is outside every granted root` }
      if (!existsSync(real)) return { ok: false, code: 'not-found', reason: `${raw} does not exist` }
      return { ok: true, abs: real }
    },
    checkShell(grant, command) {
      if (typeof command !== 'string' || command.trim() === '') {
        return { ok: false, code: 'bad-arg', reason: 'command must be a non-empty string' }
      }
      if (grant?.shell !== true) return { ok: false, code: 'shell-denied', reason: 'shell execution was not granted to this peer' }
      return { ok: true }
    },
  }
}

const warnings = []
const policy = makePolicy()
const exec = createExecutor({ policy, log: { warn: (message, extra) => warnings.push(`${message}: ${extra}`) } })

const GRANT = Object.freeze({
  roots: [ROOT],
  write: true,
  shell: true,
  cwdRoot: ROOT,
  createDirs: false,
  timeoutMs: 5000,
  maxOutputBytes: 8 * 1024,
})
const withGrant = (patch) => ({ ...GRANT, ...patch })

// --- tiny harness ------------------------------------------------------------

let passed = 0
let failed = 0
let skipped = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name} - ${error?.message ?? String(error)}`)
  }
}

function skipCase(name, why) {
  skipped += 1
  console.log(`SKIP ${name} - ${why}`)
}

function ok(condition, message) {
  if (condition !== true) throw new Error(message)
}

function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** Assert the call rejects with an ExecError carrying exactly `code`. */
async function expectCode(code, run) {
  let result
  try {
    result = await run()
  } catch (error) {
    if (!(error instanceof ExecError)) throw new Error(`expected ExecError(${code}), got ${error?.name}: ${error?.message}`)
    if (error.code !== code) throw new Error(`expected ExecError(${code}), got ${error.code}: ${error.message}`)
    return error
  }
  throw new Error(`expected ExecError(${code}) but the call succeeded with ${JSON.stringify(result)}`)
}

const sleepMs = (ms) => new Promise((done) => setTimeout(done, ms))

/** A symlink (or Windows junction) inside the root that points outside it. */
function makeEscapeLink() {
  const fileLink = join(ROOT, 'escape-link')
  try {
    symlinkSync(OUTSIDE_FILE, fileLink, 'file')
    return basename(fileLink)
  } catch {
    /* Windows without developer mode: try a directory junction instead */
  }
  try {
    mkdirSync(OUTSIDE_DIR, { recursive: true })
    const dirLink = join(ROOT, 'escape-junction')
    symlinkSync(OUTSIDE_DIR, dirLink, 'junction')
    return basename(dirLink)
  } catch {
    return null
  }
}

function removeLink(name) {
  const target = join(ROOT, name)
  try {
    rmSync(target, { recursive: true, force: true })
    return
  } catch {
    /* fall through */
  }
  try {
    unlinkSync(target)
  } catch {
    try {
      rmdirSync(target)
    } catch {
      /* best effort */
    }
  }
}

// --- cases -------------------------------------------------------------------

console.log(`temp root: ${ROOT}`)
console.log(`platform:  ${process.platform} ${process.arch}, node ${process.version}\n`)

await test('1 fs.write creates (created===true) then overwrites (created===false)', async () => {
  const first = await exec.handle('fs.write', { path: 'notes.txt', content: 'hello\nworld\n' }, { grant: GRANT })
  eq(first.path, 'notes.txt', 'path echo')
  eq(first.created, true, 'created on first write')
  eq(first.bytes, Buffer.byteLength('hello\nworld\n'), 'byte count')
  eq(readFileSync(join(ROOT, 'notes.txt'), 'utf8'), 'hello\nworld\n', 'content on disk')
  ok(!readdirSync(ROOT).some((name) => name.includes('.tmp-')), 'atomic write left no temp file behind')

  const second = await exec.handle('fs.write', { path: 'notes.txt', content: 'hello again\n' }, { grant: GRANT })
  eq(second.created, false, 'created on overwrite')
  eq(readFileSync(join(ROOT, 'notes.txt'), 'utf8'), 'hello again\n', 'overwritten content on disk')
})

const LINES = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')

await test('2 fs.read totalLines + offset/limit slicing', async () => {
  writeFileSync(join(ROOT, 'lines.txt'), `${LINES}\n`)

  const full = await exec.handle('fs.read', { path: 'lines.txt' }, { grant: GRANT })
  // Byte fidelity is a product requirement of a debugging bridge: the file's own
  // trailing newline survives, and a CRLF file is not silently rewritten.
  eq(full.content, `${LINES}\n`, 'full content including the file trailing newline')
  eq(full.totalLines, 10, 'totalLines')
  eq(full.offset, 1, 'default offset')
  eq(full.truncated, false, 'not truncated')

  writeFileSync(join(ROOT, 'crlf.txt'), 'a\r\nb\r\nc\r\n')
  const crlf = await exec.handle('fs.read', { path: 'crlf.txt' }, { grant: GRANT })
  eq(crlf.content, 'a\r\nb\r\nc\r\n', 'CRLF terminators are preserved byte for byte')

  const slice = await exec.handle('fs.read', { path: 'lines.txt', offset: 3, limit: 4 }, { grant: GRANT })
  eq(slice.content, 'line 3\nline 4\nline 5\nline 6\n', 'sliced content keeps the terminators in the window')
  eq(slice.totalLines, 10, 'totalLines is the file total, not the slice')
  eq(slice.offset, 3, 'echoed offset')
  eq(slice.truncated, true, 'truncated when lines remain')

  const tail = await exec.handle('fs.read', { path: 'lines.txt', offset: 9, limit: 50 }, { grant: GRANT })
  eq(tail.content, 'line 9\nline 10\n', 'tail content keeps the file trailing newline')
  eq(tail.truncated, false, 'not truncated at EOF')
})

await test('3 fs.edit unique / ambiguous / missing / replaceAll', async () => {
  writeFileSync(join(ROOT, 'edit.txt'), 'alpha\nbeta\nalpha\n')

  const one = await exec.handle('fs.edit', { path: 'edit.txt', oldString: 'beta', newString: 'gamma' }, { grant: GRANT })
  eq(one.replaced, 1, 'replaced count')
  eq(one.totalLines, 3, 'totalLines after the edit')
  eq(readFileSync(join(ROOT, 'edit.txt'), 'utf8'), 'alpha\ngamma\nalpha\n', 'content after the single edit')

  const ambiguous = await expectCode('bad-arg', () =>
    exec.handle('fs.edit', { path: 'edit.txt', oldString: 'alpha', newString: 'x' }, { grant: GRANT }),
  )
  ok(/replace_all/.test(ambiguous.message), `ambiguous message should mention replace_all: ${ambiguous.message}`)
  eq(readFileSync(join(ROOT, 'edit.txt'), 'utf8'), 'alpha\ngamma\nalpha\n', 'ambiguous edit changed nothing')

  const missing = await expectCode('not-found', () =>
    exec.handle('fs.edit', { path: 'edit.txt', oldString: 'zzz', newString: 'x' }, { grant: GRANT }),
  )
  eq(missing.message, 'oldString not found in edit.txt', 'not-found message')

  const all = await exec.handle(
    'fs.edit',
    { path: 'edit.txt', oldString: 'alpha', newString: 'omega', replaceAll: true },
    { grant: GRANT },
  )
  eq(all.replaced, 2, 'replaceAll count')
  eq(readFileSync(join(ROOT, 'edit.txt'), 'utf8'), 'omega\ngamma\nomega\n', 'content after replaceAll')

  await expectCode('bad-arg', () => exec.handle('fs.edit', { path: 'edit.txt', oldString: '', newString: 'x' }, { grant: GRANT }))
})

await test('4 fs.list entries + dirs-first, case-insensitive sort', async () => {
  mkdirSync(join(ROOT, 'sub'), { recursive: true })
  writeFileSync(join(ROOT, 'a.txt'), 'a')
  writeFileSync(join(ROOT, 'B.txt'), 'bb')

  const result = await exec.handle('fs.list', { path: '.' }, { grant: GRANT })
  eq(result.path, '.', 'path echo (never the resolved absolute path)')
  eq(result.truncated, false, 'truncated')
  const names = result.entries.map((entry) => entry.name)
  ok(names.includes('sub') && names.includes('a.txt') && names.includes('B.txt'), `expected entries, got ${names.join(', ')}`)
  eq(result.entries[0].name, 'sub', 'directory first')
  eq(result.entries[0].type, 'dir', 'directory type')
  eq(names.indexOf('a.txt') + 1, names.indexOf('B.txt'), 'a.txt before B.txt (case-insensitive)')
  const types = result.entries.map((entry) => entry.type)
  const firstNonDir = types.findIndex((type) => type !== 'dir')
  ok(
    firstNonDir === -1 || types.lastIndexOf('dir') < firstNonDir,
    `all directories must precede entries: ${types.join(',')}`,
  )
  const fileNames = result.entries.filter((entry) => entry.type !== 'dir').map((entry) => entry.name.toLowerCase())
  eq(fileNames.join(','), [...fileNames].sort().join(','), 'non-directory names ascending')
  const a = result.entries.find((entry) => entry.name === 'a.txt')
  eq(a.size, 1, 'file size')
  ok(typeof a.mtimeMs === 'number' && a.mtimeMs > 0, `mtimeMs should be a real number, got ${a.mtimeMs}`)

  const empty = await exec.handle('fs.list', { path: 'sub' }, { grant: GRANT })
  eq(empty.entries.length, 0, 'empty directory')
})

await test('5a path escape: ../outside.txt and an absolute path outside the root', async () => {
  writeFileSync(OUTSIDE_FILE, 'outside\n')
  await expectCode('path-denied', () => exec.handle('fs.read', { path: '../outside.txt' }, { grant: GRANT }))
  await expectCode('path-denied', () => exec.handle('fs.read', { path: OUTSIDE_FILE }, { grant: GRANT }))
  await expectCode('path-denied', () =>
    exec.handle('fs.write', { path: '../outside-write.txt', content: 'nope' }, { grant: GRANT }),
  )
  if (IS_WIN) {
    await expectCode('path-denied', () => exec.handle('fs.read', { path: 'C:\\Windows\\win.ini' }, { grant: GRANT }))
  }
})

{
  const linkName = makeEscapeLink()
  if (linkName === null) {
    skipCase('5b path escape: symlink inside the root pointing outside', 'this user cannot create symlinks or junctions')
  } else {
    await test('5b path escape: symlink inside the root pointing outside', async () => {
      await expectCode('path-denied', () => exec.handle('fs.list', { path: linkName }, { grant: GRANT }))
      await expectCode('path-denied', () => exec.handle('fs.write', { path: linkName, content: 'nope' }, { grant: GRANT }))
      await expectCode('path-denied', () =>
        exec.handle('fs.read', { path: join(linkName, 'anything.txt') }, { grant: GRANT }),
      )
      removeLink(linkName)
    })
  }
}

await test('6 directory creation refused unless grant.createDirs===true', async () => {
  const denied = await expectCode('path-denied', () =>
    exec.handle('fs.write', { path: 'newdir/inner.txt', content: 'x' }, { grant: GRANT }),
  )
  ok(/createDirs/.test(denied.message) && /peer/i.test(denied.message), `reason should tell the peer to grant it: ${denied.message}`)
  ok(!existsSync(join(ROOT, 'newdir')), 'nothing may be created while refusing')

  const allowed = await exec.handle('fs.write', { path: 'newdir/inner.txt', content: 'x' }, { grant: withGrant({ createDirs: true }) })
  eq(allowed.created, true, 'created once the grant allows directories')
  eq(readFileSync(join(ROOT, 'newdir', 'inner.txt'), 'utf8'), 'x', 'nested content')
})

await test('7 fs.write above maxWriteBytes throws too-large', async () => {
  const failure = await expectCode('too-large', () =>
    exec.handle('fs.write', { path: 'big.txt', content: 'x'.repeat(LIMITS.maxWriteBytes + 1) }, { grant: GRANT }),
  )
  ok(failure.message.includes(String(LIMITS.maxWriteBytes + 1)), `message should name the size: ${failure.message}`)
  ok(!existsSync(join(ROOT, 'big.txt')), 'nothing may be written when refusing')

  const boundary = await exec.handle('fs.write', { path: 'edge.txt', content: 'y'.repeat(LIMITS.maxWriteBytes) }, { grant: GRANT })
  eq(boundary.bytes, LIMITS.maxWriteBytes, 'exactly at the limit is allowed')
})

const ECHO = IS_WIN ? "Write-Output 'BRIDGE_OK'" : "printf 'BRIDGE_OK\\n'"

await test('8a shell.exec runs a real command (exit 0, known output)', async () => {
  const result = await exec.handle('shell.exec', { command: ECHO }, { grant: GRANT })
  eq(result.exitCode, 0, 'exitCode')
  ok(result.stdout.includes('BRIDGE_OK'), `stdout should contain BRIDGE_OK, got ${JSON.stringify(result.stdout)}`)
  eq(result.stderr, '', 'stderr')
  eq(result.signal, undefined, 'no signal on a clean exit')
  eq(result.cwd, ROOT, 'cwd defaults to the granted root')
  eq(result.truncated, false, 'truncated')
  ok(typeof result.durationMs === 'number' && result.durationMs >= 0, 'durationMs')
})

await test('8b shell.exec returns exitCode 3 without throwing', async () => {
  const result = await exec.handle('shell.exec', { command: 'exit 3' }, { grant: GRANT })
  eq(result.exitCode, 3, 'exitCode')
})

await test('8c shell.exec kills on timeoutMs and returns signal timeout', async () => {
  const command = IS_WIN ? 'Start-Sleep -Seconds 5; Write-Output late' : 'sleep 5; echo late'
  const started = Date.now()
  const result = await exec.handle('shell.exec', { command, timeoutMs: 1500 }, { grant: GRANT })
  const elapsed = Date.now() - started
  eq(result.signal, 'timeout', 'signal')
  ok(result.exitCode !== 0, `exitCode should be non-zero, got ${result.exitCode}`)
  ok(!result.stdout.includes('late'), 'the command must not have finished')
  ok(elapsed < 4000, `should settle near the 1500 ms timeout, took ${elapsed} ms`)
})

await test('8d policy.checkShell denial produces shell-denied', async () => {
  await expectCode('shell-denied', () =>
    exec.handle('shell.exec', { command: ECHO }, { grant: withGrant({ shell: false }) }),
  )
})

await test('9 aborted signal kills the tree and settles', async () => {
  const sentinel = join(ROOT, 'sentinel.txt')
  const quoted = IS_WIN
    ? `'${sentinel.replace(/'/g, "''")}'`
    : `'${sentinel.replace(/'/g, "'\\''")}'`
  const command = IS_WIN
    ? `Start-Sleep -Seconds 3; Set-Content -LiteralPath ${quoted} -Value done`
    : `sleep 3; printf done > ${quoted}`

  const controller = new AbortController()
  const started = Date.now()
  const pending = exec.handle('shell.exec', { command, timeoutMs: 8000 }, { grant: GRANT, signal: controller.signal })
  setTimeout(() => controller.abort(), 600)
  const result = await pending
  const elapsed = Date.now() - started
  ok(result.signal === 'aborted' || result.signal === 'timeout', `signal should be aborted/timeout, got ${result.signal}`)
  eq(result.signal, 'aborted', 'signal after aborting the caller')
  ok(result.exitCode !== 0, `exitCode should be non-zero, got ${result.exitCode}`)
  ok(elapsed < 3000, `should settle promptly after the abort, took ${elapsed} ms`)

  // The strongest proof there is no live child: wait past the sleep and check it never wrote.
  const floor = 4200 - (Date.now() - started)
  if (floor > 0) await sleepMs(floor)
  ok(!existsSync(sentinel), 'the killed command must not have run to completion')
})

await test('10 fs.read on a directory is is-dir; unknown capability is unsupported', async () => {
  await expectCode('is-dir', () => exec.handle('fs.read', { path: 'sub' }, { grant: GRANT }))
  await expectCode('is-file', () => exec.handle('fs.list', { path: 'notes.txt' }, { grant: GRANT }))
  await expectCode('unsupported', () => exec.handle('fs.rename', {}, { grant: GRANT }))
  await expectCode('unsupported', () => exec.handle(undefined, {}, { grant: GRANT }))
})

await test('11 wrong-typed args are bad-arg / not-granted, never a TypeError', async () => {
  await expectCode('bad-arg', () => exec.handle('fs.list', { path: 42 }, { grant: GRANT }))
  await expectCode('bad-arg', () => exec.handle('fs.read', 'not-an-object', { grant: GRANT }))
  await expectCode('bad-arg', () => exec.handle('fs.write', { path: 'x.txt' }, { grant: GRANT }))
  await expectCode('bad-arg', () => exec.handle('shell.exec', { command: 42 }, { grant: GRANT }))
  await expectCode('bad-arg', () => exec.handle('fs.read', { path: 'lines.txt', offset: 'two' }, { grant: GRANT }))
  await expectCode('not-granted', () => exec.handle('fs.list', { path: '.' }, {}))
})

await test('12 limits: byte-capped read and capped shell output stay truthful', async () => {
  const tinyRead = createExecutor({ policy: makePolicy({ limits: { ...LIMITS, maxReadBytes: 40 } }) })
  const partial = await tinyRead.handle('fs.read', { path: 'lines.txt' }, { grant: GRANT })
  eq(partial.truncated, true, 'byte-capped read sets truncated')
  ok(partial.content.length < LINES.length, 'content is a prefix of the file')
  eq(partial.content.split('\n').length, partial.totalLines, 'totalLines counts the lines actually read')
  ok(partial.totalLines < 10, `totalLines must not pretend to be the file total, got ${partial.totalLines}`)

  const loud = IS_WIN
    ? "1..400 | ForEach-Object { Write-Output 'xxxxxxxxxx' }"
    : 'yes xxxxxxxxxx | head -n 400'
  const tinyOut = createExecutor({ policy: makePolicy({ limits: { ...LIMITS, maxOutputBytes: 64 } }) })
  const capped = await tinyOut.handle('shell.exec', { command: loud }, { grant: GRANT })
  eq(capped.exitCode, 0, 'exitCode (the pipes were drained, so the child never blocked)')
  eq(capped.truncated, true, 'output cap sets truncated')
  ok(capped.stdout.length + capped.stderr.length <= 64, `capture must stay within the cap, got ${capped.stdout.length}`)
})

await test('13 every attempt is audited; a hostile audit sink cannot break a call', async () => {
  const before = audits.length
  const info = await exec.handle('sys.info', {}, { grant: GRANT })
  ok(typeof info.hostname === 'string' && typeof info.platform === 'string', 'sys.info shape')
  eq(info.cpus > 0, true, 'cpus')
  eq(typeof info.totalMemBytes, 'number', 'totalMemBytes')
  eq(info.node, process.version, 'node')
  eq(info.cwd, process.cwd(), 'cwd')
  await expectCode('unsupported', () => exec.handle('nope.cap', {}, { grant: GRANT }))

  const recorded = audits.slice(before)
  const allowed = recorded.find((entry) => entry.cap === 'sys.info' && entry.allowed === true)
  ok(allowed !== undefined, 'an allowed attempt must be audited')
  ok(typeof allowed.ms === 'number' && typeof allowed.bytes === 'number', 'allowed entry carries ms and bytes')
  const denied = recorded.find((entry) => entry.allowed === false)
  ok(denied !== undefined && typeof denied.reason === 'string', 'a denied attempt must be audited with a reason')

  const hostile = makePolicy({ audit: () => { throw new Error('sink down') } })
  const hostileExec = createExecutor({ policy: hostile, log: { warn: (message, extra) => warnings.push(`${message}: ${extra}`) } })
  const still = await hostileExec.handle('sys.info', {}, { grant: GRANT })
  ok(typeof still.hostname === 'string', 'a throwing audit sink must not break the call')
  ok(warnings.length > 0, 'the audit failure is reported to the logger instead')
})

// --- cleanup -----------------------------------------------------------------

let leftovers = []
try {
  leftovers = readdirSync(ROOT)
} catch {
  /* the temp root is already gone */
}
for (const name of leftovers) {
  if (name.startsWith('escape-')) removeLink(name)
}
try {
  rmSync(ROOT, { recursive: true, force: true })
} catch {
  /* best effort */
}
try {
  rmSync(OUTSIDE_FILE, { force: true })
} catch {
  /* best effort */
}
try {
  rmSync(OUTSIDE_DIR, { recursive: true, force: true })
} catch {
  /* best effort */
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (temp root removed: ${!existsSync(ROOT)})`)
if (failed > 0) process.exitCode = 1
