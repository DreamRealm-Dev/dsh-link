#!/usr/bin/env node
/**
 * R122: the payloads dsh-ops needs, extracted next to the repository but never committed.
 *
 * The pin (dsh-ops.pin.json) records three win32-x64 payloads totalling about 127 MB. T54's readings need
 * them on disk; git must not carry them. This script turns the pinned tarballs into an extracted tree at
 * .tmp/dsh-ops-payload/<name>, which the gate that needs them treats as its prerequisite.
 *
 * Usage:
 *   node scripts/prepare-dsh-ops-payload.mjs                 # from .tmp/r117-fetch (or DSH_OPS_TGZ_CACHE)
 *   node scripts/prepare-dsh-ops-payload.mjs --check         # report what is present, change nothing
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = resolve(process.env.DSH_OPS_TGZ_CACHE ?? join(PROJECT, '.tmp', 'r117-fetch'))
const OUT = resolve(process.env.DSH_OPS_PAYLOAD ?? join(PROJECT, '.tmp', 'dsh-ops-payload'))
const check = process.argv.includes('--check')
const WANTED = [
  { tarball: 'dsh-ops-fastctx-win32-x64-0.2.1.tgz', dir: 'fastctx', executable: 'bin/fastctx.exe' },
  { tarball: 'dsh-ops-pwsh-win32-x64-0.2.1.tgz', dir: 'pwsh', executable: 'bin/pwsh.exe' },
  { tarball: 'dsh-ops-bash-win32-x64-0.2.1.tgz', dir: 'bash', executable: 'bin/bash.exe' },
]
const state = WANTED.map((entry) => ({ ...entry, tarballPresent: existsSync(join(CACHE, entry.tarball)), extracted: existsSync(join(OUT, entry.dir, entry.executable)) }))
if (check) {
  for (const row of state) console.log(row.dir + ': tarball=' + String(row.tarballPresent) + ' extracted=' + String(row.extracted))
  const ready = state.every((row) => row.extracted)
  console.log('ready=' + String(ready))
  process.exit(ready ? 0 : 1)
}
for (const row of state) {
  if (row.extracted) { console.log('already extracted: ' + row.dir); continue }
  if (!row.tarballPresent) { console.error('missing tarball ' + row.tarball + ' in ' + CACHE + ' (fetch it with: npm pack <name>@<version>)'); continue }
  const target = join(OUT, row.dir)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', join(CACHE, row.tarball), '-C', target, '--strip-components=1'], { stdio: 'inherit' })
  console.log('extracted ' + row.dir + ' -> ' + target + ' (' + String(readdirSync(target).length) + ' entries)')
}
// One combined bin/ next to the per-payload trees: the plugin reads <DSH_HOME>/dsh-ops/bin, and a gate can
// then junction <DSH_HOME>/dsh-ops to this directory instead of copying ~127 MB into a world that the world
// script deletes and rebuilds on every run (R122: that copy failed with EPIPE on the second run).
const combined = join(OUT, 'bin')
mkdirSync(combined, { recursive: true })
for (const row of state) {
  const bin = join(OUT, row.dir, 'bin')
  if (!existsSync(bin)) continue
  for (const entry of readdirSync(bin)) {
    const target = join(combined, entry)
    if (existsSync(target)) continue
    execFileSync('powershell', ['-NoProfile', '-Command', 'Copy-Item -Recurse -Force "' + join(bin, entry) + '" "' + target + '"'], { stdio: 'inherit' })
  }
  console.log('combined ' + row.dir + '/bin into ' + combined)
}
writeFileSync(join(OUT, 'README.txt'), 'Extracted dsh-ops win32-x64 payloads for the T54 readings. Never committed: the pin (dsh-ops.pin.json) carries the upstream integrity of each tarball.\n', 'utf8')
const ready = state.every((row) => existsSync(join(OUT, row.dir, row.executable)))
console.log('ready=' + String(ready) + ' out=' + OUT)
process.exit(0)
