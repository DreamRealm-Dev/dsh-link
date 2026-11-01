#!/usr/bin/env node
// Fetch Microsoft's Fixed Version WebView2 runtime — for EVALUATION ONLY.
//
// This shell does not ship that runtime and does not load it: Microsoft's fixed runtime carries
// licence files this project cannot relicense (GPL-3.0 texts under `Trust Protection Lists/{Mu,
// Sigma}`), so bundling it would put copyleft into our distribution. `tauri.conf.json` installs
// Microsoft's own runtime instead (`downloadBootstrapper`) and the app uses the machine's evergreen
// build; THIRD-PARTY-NOTICES.md carries the full account. The download stays available because
// comparing engines is a legitimate measurement (see docs/cef-runtime-evaluation.md), but it must
// never become part of a build, so the script refuses to run without an acknowledgement.
//
// The rendering engine then comes from the folder shipped with the app instead of
// whatever Evergreen build the machine has — the same shell code, a known engine.
// Microsoft publishes the download list as JSON; the .cab is extracted with the
// Windows built-in `expand`.
//
//   node scripts/fetch-webview2-fixed.mjs --evaluation-only [--force]
//
// Result: src-tauri/webview2-fixed/msedgewebview2.exe (gitignored, ~670MB extracted)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cabPath = join(root, 'src-tauri', 'webview2-fixed.cab')
const target = join(root, 'src-tauri', 'webview2-fixed')
const force = process.argv.includes('--force')

// The acknowledgement is the guard that keeps a licence decision from being undone by habit: a
// fetch that used to be a normal step of setting the app up is now a measurement somebody asked for.
if (!process.argv.includes('--evaluation-only')) {
  console.error('Refusing to fetch: Microsoft\'s Fixed Version WebView2 runtime carries GPL-3.0'
    + ' components and this project does not distribute it.')
  console.error('The installer downloads Microsoft\'s own runtime instead. For an engine comparison,'
    + ' pass --evaluation-only and keep the result out of any build.')
  process.exit(1)
}

if (process.platform !== 'win32') {
  console.error('The Fixed Version runtime is Windows-only; nothing to fetch elsewhere.')
  process.exit(0)
}

const catalog = await (await fetch('https://developer.microsoft.com/microsoft-edge/api/webview2')).json()
const release = catalog[0]
const build = release?.builds?.find(entry => entry.architecture === 'x64')
if (!build) {
  console.error('No x64 Fixed Version runtime in the catalog response.')
  process.exit(1)
}

if (existsSync(cabPath) && !force) {
  console.log(`Using the existing ${cabPath}`)
} else {
  console.log(`Downloading ${release.version} (x64)`)
  const response = await fetch(build.url)
  if (!response.ok) {
    console.error(`Download failed: ${response.status} ${response.statusText}`)
    process.exit(1)
  }
  writeFileSync(cabPath, Buffer.from(await response.arrayBuffer()))
}
console.log(`cab: ${(statSync(cabPath).size / 1048576).toFixed(1)} MB`)

if (existsSync(target) && !force) {
  console.log(`Runtime folder already present: ${target}`)
} else {
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('expand.exe', ['-F:*', cabPath, target], { stdio: 'inherit' })
  // expand keeps the cab's single top-level directory; flatten it so the folder
  // holding msedgewebview2.exe is the one both the config and the shell name.
  const entries = readdirSync(target)
  if (entries.length === 1 && statSync(join(target, entries[0])).isDirectory()) {
    const inner = join(target, entries[0])
    for (const name of readdirSync(inner)) renameSync(join(inner, name), join(target, name))
    rmSync(inner, { recursive: true, force: true })
  }
}
if (!existsSync(join(target, 'msedgewebview2.exe'))) {
  console.error('msedgewebview2.exe is missing after extraction.')
  process.exit(1)
}
console.log(`Pinned engine ready: ${target}`)
console.log('Note: unpackaged Fixed Version deployments on Windows 10 need the folder')
console.log('granted to ALL APPLICATION PACKAGES, e.g.')
console.log(`  icacls "${target}" /grant *S-1-15-2-2:(OI)(CI)(RX)`)
console.log(`  icacls "${target}" /grant *S-1-15-2-1:(OI)(CI)(RX)`)
