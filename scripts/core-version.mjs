#!/usr/bin/env node
/**
 * Report the pinned kernel version this checkout carries.
 *
 * The kernel under core/deepseek-harness is a pinned checkout that must not be edited.
 * Two things name the pin: the git tag and commit of that checkout, and the version its
 * own package.json declares. They can drift apart when someone changes the checkout by
 * hand, so this script prints both and exits non-zero on a disagreement — the shell's
 * locator refuses to launch a kernel it cannot identify, and this is the same fact
 * available without launching anything.
 *
 * Usage: node scripts/core-version.mjs [--json]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKOUT = join(PROJECT, 'core', 'deepseek-harness')
const json = process.argv.includes('--json')

if (!existsSync(join(CHECKOUT, 'package.json'))) {
  console.error(`no kernel checkout at ${CHECKOUT} — run: npm run setup`)
  process.exit(1)
}

/** Read one git fact from the checkout, or null when git cannot answer. */
function git(args) {
  try {
    return execFileSync('git', ['-C', CHECKOUT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const manifest = JSON.parse(readFileSync(join(CHECKOUT, 'package.json'), 'utf8'))
const described = git(['describe', '--tags', '--always', '--dirty'])
const commit = git(['rev-parse', '--short', 'HEAD'])
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])

const report = {
  checkout: CHECKOUT,
  packageVersion: manifest.version ?? null,
  packageName: manifest.name ?? null,
  commit,
  branch,
  described,
  /** The git describe is the authoritative pin; packageVersion must agree with it. */
  consistent: described === null ? null : described.replace(/^dsh-v/, '').startsWith(String(manifest.version ?? '')),
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`kernel checkout: ${report.checkout}`)
  console.log(`  package:  ${report.packageName} ${report.packageVersion}`)
  console.log(`  commit:   ${report.commit ?? '(git unavailable)'} on ${report.branch ?? '?'}`)
  console.log(`  describe: ${report.described ?? '(no tags)'}`)
  if (report.consistent === false) {
    console.log('  WARNING:  the tag and the package version disagree — the checkout was modified by hand')
  }
}

process.exit(report.consistent === false ? 1 : 0)
