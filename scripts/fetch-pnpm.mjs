#!/usr/bin/env node
/**
 * Fetch the pnpm bundle this shell ships.
 *
 * Same shape as scripts/fetch-webview2-fixed.mjs: the payload is large, versioned, and
 * reproducible, so it is downloaded into src-tauri/resources/pnpm/ (gitignored) rather
 * than committed. The version is pinned to the one the official desktop bundle uses.
 *
 *   node scripts/fetch-pnpm.mjs [version]
 *
 * The extracted tree is what `bundle.resources` packages and what core::pnpm locates at
 * runtime, so nothing else has to be configured after this runs.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const run = promisify(execFile)
const VERSION = process.argv[2] ?? '11.7.0'
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEST = join(ROOT, 'src-tauri', 'resources', 'pnpm')
const ARCHIVE = join(ROOT, 'src-tauri', 'resources', `pnpm-${VERSION}.tgz`)
// The mirror first: the configured registry is what the machine can actually reach.
const URL = `https://registry.npmmirror.com/pnpm/-/pnpm-${VERSION}.tgz`

async function main() {
  await mkdir(join(ROOT, 'src-tauri', 'resources'), { recursive: true })
  console.log(`downloading ${URL}`)
  const response = await fetch(URL)
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`)
  await writeFile(ARCHIVE, Buffer.from(await response.arrayBuffer()))
  console.log(`extracting into ${DEST}`)
  await rm(DEST, { recursive: true, force: true })
  await mkdir(DEST, { recursive: true })
  // Windows' tar is bsdtar and reads gzip archives natively; --strip-components drops
  // the package/ directory the registry tarball wraps everything in.
  await run('tar', ['-xzf', ARCHIVE, '-C', DEST, '--strip-components', '1'])
  await rm(ARCHIVE, { force: true })
  const entry = join(DEST, 'bin', 'pnpm.mjs')
  console.log(`ready: ${entry}`)
  console.log('run npm run tauri:build (or cargo run) so the shell finds it')
}

await main()
