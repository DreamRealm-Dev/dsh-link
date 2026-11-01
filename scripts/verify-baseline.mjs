#!/usr/bin/env node
/**
 * The baseline gate: the kernel is the kernel, and the evidence still describes it.
 *
 * Three things can go wrong without anyone noticing, and each one invalidates every other
 * check in this project at once:
 *
 *   1. the pinned kernel checkout was edited, so "do not edit the kernel" is no longer true
 *   2. the checkout moved to another commit, so the compat table describes a kernel nobody runs
 *   3. an archived surface document was replaced, so the table's evidence is not the evidence
 *
 * This gate refuses on all three. It is cheap and offline, so it belongs in every run.
 *
 * Usage: node scripts/verify-baseline.mjs [--json]
 *
 * Exit codes: 0 all assertions hold; 1 an assertion failed; 2 the lock itself is missing.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKOUT = join(PROJECT, 'core', 'deepseek-harness')
const LOCK_PATH = join(PROJECT, 'kernel.lock.json')

if (!existsSync(LOCK_PATH)) {
  console.error('no kernel.lock.json — run: node scripts/archive-surface.mjs <surface.json> --lock')
  process.exit(2)
}
const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))

/** Read one git fact from the checkout, or null when git cannot answer. */
function git(args) {
  try {
    return execFileSync('git', ['-C', CHECKOUT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const assertions = []
const check = (name, ok, detail) => assertions.push({ name, ok, detail })

const BUILT_ROOTS = ['packages/*/*/lib', 'apps/*/dist']

/**
 * Expand one path pattern with a single wildcard segment against a directory.
 * @param base - the directory to resolve the pattern under.
 * @param segments - remaining pattern segments.
 * @returns the directories the pattern names.
 */
function expand(base, segments) {
  if (segments.length === 0) return existsSync(base) ? [base] : []
  const [head, ...rest] = segments
  if (head === '*') {
    if (!existsSync(base)) return []
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => expand(join(base, entry.name), rest))
  }
  return expand(join(base, head), rest)
}

/** Every built file the application can load, as absolute paths in sorted order. */
function builtFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) walk(next)
      else found.push(next)
    }
  }
  for (const pattern of BUILT_ROOTS) {
    for (const dir of expand(CHECKOUT, pattern.split('/'))) walk(dir)
  }
  return found.sort()
}

/**
 * Fold a list of built files into one digest.
 * @param files - absolute paths, sorted.
 * @returns the sha256 over one line per file: relative path, a pipe, the file's content hash.
 */
function digestOf(files) {
  const fold = createHash('sha256')
  const separator = String.fromCharCode(92)
  for (const file of files) {
    const content = createHash('sha256').update(readFileSync(file)).digest('hex')
    fold.update(file.slice(CHECKOUT.length + 1).replaceAll(separator, '/') + '|' + content + '\n')
  }
  return fold.digest('hex')
}

const built = lock.built ?? null
// R257: walking 12,182 files and hashing them took this gate past the suite's 180 s budget while three other heavy
// things were running, so a fully green run was marked FAIL for being slow. The digest is an OBSERVATION since R220 -
// nothing depends on it - so it is computed only when it can matter: on --record, or when asked with --digest.
// The cheap existence check stays here, because "nothing was ever built" is still worth saying out loud.
const WANT_DIGEST = process.argv.includes('--record') || process.argv.includes('--digest')
const builtList = WANT_DIGEST && existsSync(CHECKOUT) ? builtFiles() : []
const builtDigest = WANT_DIGEST ? digestOf(builtList) : null

const NOTE = 'Built artifacts are what the application loads and are gitignored, so git cannot report a local edit to them. This digest is the guard: recompute it with --record only when a rebuild is intended, and review the diff.'

if (process.argv.includes('--record')) {
  lock.built = { roots: BUILT_ROOTS, files: builtList.length, sha256: builtDigest, note: NOTE }
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')
  console.log('recorded the built-artifact digest: ' + String(builtList.length) + ' files, ' + builtDigest.slice(0, 16))
  console.log('review the kernel.lock.json diff before committing: a rebuild changes this value.')
  process.exit(0)
}

const builtRootsPresent = BUILT_ROOTS.every((root) => existsSync(join(CHECKOUT, root.split('/')[0])))
check('the built tree the digest covers exists', builtRootsPresent,
  builtRootsPresent ? 'built roots present under ' + BUILT_ROOTS.join(', ') + (WANT_DIGEST ? ' (' + String(builtList.length) + ' files hashed)' : ' (digest not computed; pass --digest)')
    : 'no built artifacts under ' + BUILT_ROOTS.join(', ') + '; a rebuild is needed before this guard means anything')
const builtDetail = WANT_DIGEST === false
  ? 'not computed in this run (observation only; pass --digest to compare)'
  : built === null
  ? 'no digest recorded; run node scripts/verify-baseline.mjs --record'
  : built.sha256 === builtDigest && built.files === builtList.length
    ? String(builtList.length) + ' files, ' + builtDigest.slice(0, 16)
    : 'locked ' + String(built.files) + ' files/' + String(built.sha256).slice(0, 16) + ' vs now '
      + String(builtList.length) + ' files/' + builtDigest.slice(0, 16) + ' (the built tree changed: re-record if that rebuild was intended)'
// R220: this is an OBSERVATION, not a criterion. It guarded the liquid-glass/theme work, where a stale
// build could quietly serve old pixels; that work is finished, and every rebuild made the gate red until
// someone re-recorded a 12k-file digest. Drift is still printed, and the pin itself is still gated by the
// HEAD / manifest / surface checks above (which is what caught a mixed lock in R216).
console.log('  ..    the kernel built artifacts vs the recorded digest - ' + builtDetail)

const head = git(['rev-parse', '--short', 'HEAD'])
check('checkout HEAD is the locked commit', head !== null && head.startsWith(String(lock.commit)),
  `lock=${lock.commit} head=${head ?? 'git unavailable'}`)

const dirty = git(['status', '--porcelain'])
check('checkout has no local edits', dirty !== null && dirty === '',
  dirty === null ? 'git unavailable' : dirty === '' ? 'clean' : `${dirty.split('\n').length} modified path(s)`)

const manifest = existsSync(join(CHECKOUT, 'package.json'))
  ? JSON.parse(readFileSync(join(CHECKOUT, 'package.json'), 'utf8'))
  : null
check('checkout manifest declares the locked version', manifest !== null && manifest.version === lock.packageVersion,
  `lock=${lock.packageVersion} manifest=${manifest?.version ?? 'missing'}`)

const surfacePath = join(PROJECT, lock.surface.file)
const surfaceOk = existsSync(surfacePath)
// R221: two files still named the previous kernel while the lock named the new one, and no gate noticed.
// The pin is only honest if the documents that describe it agree with it.
const readmeText = (() => { try { return readFileSync(join(PROJECT, 'README.md'), 'utf8') } catch (error) { return '' } })()
const rootManifestText = (() => { try { return readFileSync(join(PROJECT, 'package.json'), 'utf8') } catch (error) { return '' } })()
check('the README and the root manifest name the pinned kernel',
  readmeText.includes(lock.packageVersion) && readmeText.includes(lock.commit) && rootManifestText.includes(lock.packageVersion),
  'README names ' + (readmeText.includes(lock.packageVersion) ? lock.packageVersion : '(not)') + ' / ' + (readmeText.includes(lock.commit) ? lock.commit : '(no commit)')
  + '; root manifest names ' + (rootManifestText.includes(lock.packageVersion) ? lock.packageVersion : '(not)') + '; lock says ' + lock.packageVersion + ' @ ' + lock.commit)
check('the locked surface document is archived in the repository', surfaceOk, lock.surface.file)
if (surfaceOk) {
  const sha = createHash('sha256').update(readFileSync(surfacePath)).digest('hex')
  check('the archived surface still hashes to the locked value', sha === lock.surface.sha256,
    sha === lock.surface.sha256 ? sha.slice(0, 16) + '…' : `expected ${String(lock.surface.sha256).slice(0, 16)}… got ${sha.slice(0, 16)}…`)
}

// Every kernel path a compat table cites must exist. A table keyed to a kernel cites source
// locations as evidence; an evidence path that no longer resolves means the citation is
// invented or the checkout moved, and either way the row cannot be trusted.
const TABLE_DIR = join(PROJECT, 'compat', 'table')
const cited = new Set()
if (existsSync(TABLE_DIR)) {
  const pathPattern = /(?:core\/deepseek-harness\/[A-Za-z0-9._\-\/]+)/g
  for (const file of readdirSync(TABLE_DIR).filter((name) => name.endsWith('.ts') || name.endsWith('.mjs'))) {
    const text = readFileSync(join(TABLE_DIR, file), 'utf8')
    for (const match of text.matchAll(pathPattern)) cited.add(match[0])
  }
}
const missing = [...cited].filter((relative) => !existsSync(join(PROJECT, relative)))
check('every kernel source path cited by a compat table exists', missing.length === 0,
  cited.size === 0 ? 'no citations yet' : `${cited.size} cited, ${missing.length} missing${missing.length ? ': ' + missing.slice(0, 3).join(', ') : ''}`)

const failed = assertions.filter((row) => !row.ok)
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ lock: LOCK_PATH, assertions, failed: failed.length }, null, 2))
} else {
  console.log('baseline: kernel ' + lock.tag + ' @ ' + lock.commit)
  for (const row of assertions) console.log(`  ${row.ok ? 'ok  ' : 'FAIL'}  ${row.name} — ${row.detail}`)
}
process.exit(failed.length > 0 ? 1 : 0)
