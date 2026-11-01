#!/usr/bin/env node
/**
 * Build the host half of dsh-link-compute.
 *
 *   node plugins/dsh-link-compute/build.mjs            build lib/index.js
 *   node plugins/dsh-link-compute/build.mjs --check    fail if lib/index.js is stale
 *
 * The package has no browser half, so there is no lib/client.js. The root plugins/build.mjs does
 * not list this package yet; registering it there is a one-line follow-up owned by the Lead (the
 * file is outside this package's write scope). This script follows the same conventions the root
 * builder uses so the artifact it writes is what the root builder would write.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Packages the host half must resolve to the kernel's own instances. */
const HOST_EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope']

const check = process.argv.includes('--check')
const result = await build({
  entryPoints: [join(HERE, 'src', 'index.ts')],
  bundle: true,
  write: false,
  logLevel: 'warning',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: HOST_EXTERNAL,
  legalComments: 'inline',
})
const text = result.outputFiles[0].text
const target = join(HERE, 'lib', 'index.js')
let before
try {
  before = await readFile(target, 'utf8')
} catch {
  before = undefined
}
if (check) {
  if (before !== text) {
    console.error('stale: lib/index.js (run: node plugins/dsh-link-compute/build.mjs)')
    process.exit(1)
  }
  console.log('ok: lib/index.js')
} else {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  console.log((before === undefined ? 'created ' : 'wrote   ') + 'lib/index.js  ' + String(text.length) + ' bytes')
}
