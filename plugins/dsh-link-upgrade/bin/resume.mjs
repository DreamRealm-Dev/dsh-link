#!/usr/bin/env node
/**
 * dsh-link-resume: the CLI that finally uses the lock queue.
 *
 * The queue exists for one situation - an operation that could not run because a lock was held - and
 * until now nothing in the product decided what to DO about that at process level. This is that
 * decision, as an exit code, because a driver has to be able to tell "come back later" from "this
 * needs a human":
 *
 *   0   everything queued was done, or there was nothing queued
 *   1   something failed for a reason retrying will not fix
 *   75  something failed because it is LOCKED (LOCK_EXIT_CODE); it stays queued, and the caller is
 *       meant to come back. The entry is not dropped: a lock is a when, not a never.
 *   2   the command itself was wrong (no --root): a usage error, not a completion status
 *
 * The resume itself is not implemented here. `startup` (and through it the existing
 * `resumePendingOps`) does the work; this file only supplies an applier and turns the result into an
 * exit code. A second implementation of the queue would be the one that drifts.
 *
 * ## What a rename operation looks like
 *
 * `PendingOp` carries an opaque `detail` string, and nothing in the repository had fixed how a
 * rename records its two paths, so this CLI reads the three shapes that can be meant by "rename
 * `from` to `to`" and refuses anything else loudly:
 *
 *   1. `from` and `to` as top-level string fields on the operation
 *   2. `detail` as JSON: {"from": "...", "to": "..."}
 *   3. `detail` as text: "from -> to"
 *
 * Relative paths resolve against the CURRENT WORKING DIRECTORY, the usual reading for a CLI: the
 * queue records what the driver saw, and the driver ran somewhere. The destination parent directory
 * is created if missing; anything of another `kind` throws rather than being skipped, because an
 * unimplemented operation that is silently dropped is work that quietly stops existing.
 */
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LOCK_EXIT_CODE, isLockFailure, startup } from '../lib/index.js'

const USAGE_EXIT = 2
const USAGE = 'usage: dsh-link-resume --root <dir>'

/**
 * Read the command line.
 * @param {string[]} argv - process.argv without the first two entries.
 * @returns {{ root: string | null, error?: string }}
 */
const parseArgv = (argv) => {
  let root = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      root = argv[index + 1] ?? null
      index += 1
    } else if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length)
    } else {
      return { root, error: 'unknown argument: ' + arg }
    }
  }
  return { root }
}

/**
 * The two paths a rename operation names.
 * @param {Record<string, unknown>} op - one queued operation.
 * @returns {{ from: string, to: string }}
 * @throws {TypeError} when no shape carries both paths.
 */
const pairOf = (op) => {
  if (typeof op?.from === 'string' && typeof op?.to === 'string') return { from: op.from, to: op.to }
  const detail = typeof op?.detail === 'string' ? op.detail : ''
  if (detail.trim().startsWith('{')) {
    let parsed = null
    try {
      parsed = JSON.parse(detail)
    } catch {
      // Not JSON after all: fall through to the text form rather than reporting bad data.
    }
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      return { from: parsed.from, to: parsed.to }
    }
  }
  const arrow = detail.indexOf(' -> ')
  if (arrow > 0) return { from: detail.slice(0, arrow), to: detail.slice(arrow + 4) }
  throw new TypeError('resume: operation ' + String(op?.key) + ' of kind rename carries no from/to pair: give them as top-level fields, as JSON in detail, or as "from -> to"')
}

/** The keys whose failure was a lock, judged where the real error object still carries its code. */
const locked = new Set()

/**
 * Carry out one queued operation: rename its file, creating the destination directory if needed.
 *
 * The lock decision is taken HERE, on the error object, and not later on its message:
 * `resumePendingOps` keeps only `error.message`, and the EPERM code `isLockFailure` reads is gone by
 * then. The error is rethrown either way, so a locked entry stays queued.
 * @param {Record<string, unknown>} op - one queued operation.
 * @throws {TypeError} for any kind this CLI does not implement.
 */
const applyOp = (op) => {
  if (op?.kind !== 'rename') {
    throw new TypeError('resume: unsupported operation kind ' + JSON.stringify(op?.kind) + ' for ' + String(op?.key) + ': this CLI only renames')
  }
  const { from, to } = pairOf(op)
  try {
    mkdirSync(dirname(resolve(to)), { recursive: true })
    renameSync(resolve(from), resolve(to))
  } catch (error) {
    if (isLockFailure(error)) locked.add(String(op.key))
    throw error
  }
}

/** One line of JSON on stdout, and the code this process will exit with.
 * @returns {number} the exit code.
 */
const main = () => {
  const parsed = parseArgv(process.argv.slice(2))
  if (parsed.error !== undefined) {
    process.stderr.write('resume: ' + parsed.error + '\n' + USAGE + '\n')
    return USAGE_EXIT
  }
  if (parsed.root === null || parsed.root === '') {
    process.stderr.write('resume: --root <dir> is required\n' + USAGE + '\n')
    return USAGE_EXIT
  }
  const root = resolve(parsed.root)
  let report = null
  try {
    report = startup(root, { applyOp })
  } catch (error) {
    // Nothing was counted, because startup refused before any resume happened: the counts are null
    // rather than a fabricated zero, and the error is named where the counts would have been.
    const lock = isLockFailure(error)
    const exit = lock ? LOCK_EXIT_CODE : 1
    process.stdout.write(JSON.stringify({ attempted: 0, resumed: [], failed: [{ key: null, error: String(error?.message ?? error), lock }], remaining: null, exit }) + '\n')
    return exit
  }
  const failed = report.pending.failed.map((row) => ({
    key: row.key,
    error: row.error,
    // Judged on the real error first; the message check is a second chance for the Windows form
    // "(1175)", which survives stringification.
    lock: locked.has(row.key) || isLockFailure(row.error),
  }))
  const lock = failed.some((row) => row.lock)
  const exit = lock ? LOCK_EXIT_CODE : failed.length > 0 ? 1 : 0
  process.stdout.write(JSON.stringify({ attempted: report.pending.attempted, resumed: report.pending.resumed, failed, remaining: report.pending.remaining, exit }) + '\n')
  return exit
}

// process.exitCode rather than process.exit(): the report must reach a pipe before the process ends.
process.exitCode = main()
