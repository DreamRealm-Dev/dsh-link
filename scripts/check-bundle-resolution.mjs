#!/usr/bin/env node
/**
 * Whether a profile's declared bundles exist and still carry the rows they declare.
 *
 * `dsh.profile.bundles` is a list a manifest can get wrong without failing: a name nothing installs
 * contributes no layer, and a bundle whose declared patch file is missing contributes no rows. Both
 * look like a working profile from the outside, so this reads the list and resolves every entry.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kernelRoster } from './compose-profile-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const LIVE_PROFILE = 'C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/kernel-home/profiles/web'

/** @param {string} value @returns {string[]} the declared patch paths, string and array forms alike. */
function patchPaths(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string')
  return []
}

/**
 * Resolve one declared bundle.
 *
 * @param {string} profileDir - the profile whose manifest declared it.
 * @param {string} name - the bundle's package name.
 * @param {(name: string) => string|null} fromKernel - kernel workspace resolver.
 * @returns {any} where it resolved and whether its declared patch files are there.
 */
function resolveBundle(profileDir, name, fromKernel) {
  let packageJson = join(profileDir, 'node_modules', name, 'package.json')
  let source = 'profile-install'
  if (!existsSync(packageJson)) {
    const kernelDir = fromKernel(name)
    if (kernelDir === null) return { name, class: 'unresolved', source: null, patches: [] }
    packageJson = join(kernelDir, 'package.json')
    source = 'kernel-workspace'
  }
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8'))
  const declared = patchPaths(manifest.dsh?.bundle?.patch)
  const patches = declared.map(rel => {
    const path = resolve(dirname(packageJson), rel)
    return { declared: rel, path, exists: existsSync(path) }
  })
  const missing = patches.filter(patch => !patch.exists)
  return {
    name, source, patches,
    class: declared.length === 0 ? 'no-declared-patch'
      : missing.length > 0 ? 'declared-patch-missing' : 'resolved',
  }
}

/** @param {string} profileDir @returns {any} the check result for one profile. */
export function checkProfile(profileDir) {
  const manifest = join(profileDir, 'package.json')
  if (!existsSync(manifest)) throw new Error(`no profile manifest at ${manifest}`)
  const bundles = JSON.parse(readFileSync(manifest, 'utf8')).dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error(`${manifest} declares no dsh.profile.bundles array`)
  // The shared roster, read once: this file used to import kernelPackages() (a thin wrapper over it),
  // which was fine, but the roster is the one scan and a consumer should say so.
  const roster = kernelRoster()
  const rows = bundles.map(name => resolveBundle(profileDir, name, (value) => roster.get(value)?.dir ?? null))
  const counts = {}
  for (const row of rows) counts[row.class] = (counts[row.class] ?? 0) + 1
  return { profileDir, rows, counts, failed: rows.filter(row => row.class === 'unresolved' || row.class === 'declared-patch-missing').length }
}

/** Build a profile whose manifest lies in the two ways this checks for, and require both to be seen. */
function selfTest() {
  const root = join(REPO, '.tmp', 'bundle-resolution-selftest')
  rmSync(root, { recursive: true, force: true })
  const profileDir = join(root, 'profiles', 'web')
  const write = (rel, text) => { const file = join(profileDir, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    write('package.json', JSON.stringify({ dsh: { profile: { bundles: ['good-bundle', 'not-installed-anywhere', 'patch-file-missing'] } } }))
    write('node_modules/good-bundle/package.json', JSON.stringify({ name: 'good-bundle', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    write('node_modules/good-bundle/cordis.patch.yml', '- insert: []\n')
    write('node_modules/patch-file-missing/package.json', JSON.stringify({ name: 'patch-file-missing', dsh: { bundle: { patch: './gone.yml' } } }))
    const result = checkProfile(profileDir)
    const byName = new Map(result.rows.map(row => [row.name, row]))
    const checks = [
      ['the good bundle resolves', byName.get('good-bundle')?.class === 'resolved'],
      ['a bundle nothing installs is unresolved', byName.get('not-installed-anywhere')?.class === 'unresolved'],
      ['a declared patch file that is gone is named', byName.get('patch-file-missing')?.class === 'declared-patch-missing'],
      ['exactly two failures are counted', result.failed === 2],
      ['the kernel workspace resolves a real kernel bundle', resolveBundle(LIVE_PROFILE, '@deepseek-ai/dsh-base', (value) => kernelRoster().get(value)?.dir ?? null).class !== 'unresolved'],
    ]
    let bad = 0
    for (const [what, held] of checks) { console.log(`  ${held ? 'ok  ' : 'FAIL'} ${what}`); if (!held) bad += 1 }
    console.log(`self-test: ${checks.length - bad}/${checks.length} held`)
    return bad === 0
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
  const at = argv.indexOf('--profile-dir')
  const profileDir = at === -1 ? LIVE_PROFILE : argv[at + 1]
  const result = checkProfile(profileDir)
  console.log(`${result.profileDir}: ${JSON.stringify(result.counts)}`)
  for (const row of result.rows) {
    if (row.class === 'resolved') continue
    console.log(`  [${row.class}] ${row.name}`)
    for (const patch of row.patches) console.log(`      declared ${patch.declared} -> ${patch.path}`)
  }
  if (result.failed > 0) {
    console.log(`FAIL  ${result.failed} declared bundle(s) contribute no rows`)
    process.exit(1)
  }
  console.log('PASS  every declared bundle resolves and carries the rows it declares')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
