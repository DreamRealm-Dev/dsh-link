#!/usr/bin/env node
/**
 * Archive one surface document into the repository's evidence store.
 *
 * A surface document is the only proof of what a kernel actually offers, and a table that
 * cites a path under .tmp/ cites something a later run deletes — the probe removes its
 * output before it boots. So every document a table or a matrix relies on is copied into
 * compat/surface/ together with its SHA-256, and the compat table cites the archive.
 *
 * The lock file this also writes is what makes "the kernel was not edited" auditable: it
 * records the commit and tag the surface was taken from, so a later run can prove the
 * checkout still is what the evidence describes.
 *
 * Usage:
 *   node scripts/archive-surface.mjs <source.json> [--label <name>] [--lock]
 *
 * Exit codes: 0 archived; 1 the source is missing or is not a surface document.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SURFACE_DIR = join(PROJECT, 'compat', 'surface')
const CHECKOUT = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const source = argv.find((value) => !value.startsWith('--'))
const labelAt = argv.indexOf('--label')
const label = labelAt === -1 ? null : argv[labelAt + 1]
const writeLock = argv.includes('--lock')

if (source === undefined) {
  console.error('usage: node scripts/archive-surface.mjs <source.json> [--label <name>] [--lock]')
  process.exit(2)
}
if (!existsSync(source)) {
  console.error('no such surface document: ' + source)
  process.exit(1)
}

const round = resolve(source)
const text = readFileSync(round, 'utf8')
let document
try {
  document = JSON.parse(text)
} catch (error) {
  console.error('not JSON: ' + error.message)
  process.exit(1)
}
if (document?.format !== 'dsh-link.surface/1') {
  console.error('not a dsh-link.surface/1 document (format=' + String(document?.format) + ')')
  process.exit(1)
}

const kernel = label ?? String(document.kernel?.version ?? 'unknown').replace(/^dsh-/, '')
mkdirSync(SURFACE_DIR, { recursive: true })
const target = join(SURFACE_DIR, kernel + '.json')
copyFileSync(round, target)

const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex')
const entry = {
  kernel,
  file: 'compat/surface/' + kernel + '.json',
  sha256,
  bytes: readFileSync(target).length,
  capturedAt: document.capturedAt ?? null,
  format: document.format,
  counts: document.counts ?? null,
  origin: document.kernel ?? null,
}
console.log(JSON.stringify(entry, null, 2))

// --lock re-pins the kernel lock, and the lock describes THE PINNED CHECKOUT - not whichever kernel
// the surface came from. R216 learned that the hard way: archiving the alpha.5 surface with --lock
// rewrote commit to alpha.5's and dropped the built-artifact digest, so verify-baseline went red on
// a tree where nothing about the kernel had changed. A surface of another kernel is archived WITHOUT
// touching the lock (the compat section cites its own file and sha256; verify-compat-table-bindings
// checks that binding). Refusing here is the fix, not a warning.
if (writeLock) {
  const manifest = JSON.parse(readFileSync(join(CHECKOUT, 'package.json'), 'utf8'))
  const pinned = String(manifest.version ?? '')
  const archived = String(document.kernel?.version ?? '')
  if (archived !== pinned) {
    console.error('refused to re-pin kernel.lock.json: the archived surface is for ' + archived + ' while the pinned checkout declares ' + pinned + '.')
    console.error('The lock describes the pinned checkout; a section for another kernel cites its own surface file and sha256 instead. The surface was archived either way.')
    process.exit(1)
  }
  const previous = existsSync(join(PROJECT, 'kernel.lock.json')) ? JSON.parse(readFileSync(join(PROJECT, 'kernel.lock.json'), 'utf8')) : {}
  const lock = {
    ...previous,
    note: 'The vendored kernel is a pinned upstream checkout and is never edited. This lock is what makes that auditable: verify-baseline.mjs refuses when the checkout is dirty or its HEAD is not this commit.',
    packageName: manifest.name ?? null,
    packageVersion: manifest.version ?? null,
    tag: 'dsh-v' + pinned,
    commit: String(document.kernel?.commit ?? previous.commit ?? null),
    surface: { file: entry.file, sha256, capturedAt: entry.capturedAt },
  }
  writeFileSync(join(PROJECT, 'kernel.lock.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8')
  console.log('wrote kernel.lock.json')
}
