#!/usr/bin/env node
/**
 * Whether the module specifiers a plugin imports still resolve in this kernel.
 *
 * The client half of a plugin imports packages the host surface file does not describe, so the
 * archived host surface cannot judge it. This asks the narrower question that can be answered from
 * the tree itself: does the package exist, and does it still export the subpath the import names?
 * It does not judge whether the exported API kept its shape.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'
import { kernelRoster } from './compose-profile-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const TARGETS = join(REPO, 'compat/adaptation/usage-targets.json')
const OUT = join(REPO, 'compat/adaptation/import-resolution.json')
const FORMAT = 'dsh-link.import-resolution/1'

// The roster is shared (scripts/compose-profile-rows.mjs kernelRoster): one scan in the repository, three
// sources (packages/**, apps/*, vendor/*). This file used to carry a second copy of that scan, which is how
// the two drifted apart (this one read apps/, the shared one did not).

/** @param {string} specifier @returns {{pkg: string, subpath: string}|null} */
function splitSpecifier(specifier) {
  // The analyzer's import list also carries quoted strings that are not module specifiers
  // ("legitimately repetitive", "the same delta twice"); only a package-shaped specifier is judged.
  if (typeof specifier !== 'string' || specifier === '' || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null
  if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(\/[A-Za-z0-9._-]+)*$/.test(specifier)) return null
  const parts = specifier.split('/')
  if (parts[0].startsWith('@')) return { pkg: parts.slice(0, 2).join('/'), subpath: parts.slice(2).join('/') }
  return { pkg: parts[0], subpath: parts.slice(1).join('/') }
}

/** @param {any} pkg @param {string} subpath @returns {string} how the subpath resolves in this package. */
function subpathClass(pkg, subpath) {
  if (subpath === '') return pkg.exports === null || pkg.exports['.'] !== undefined ? 'resolves' : 'missing-subpath'
  if (pkg.exports === null) return 'no-exports-map'
  return pkg.exports['./' + subpath] !== undefined ? 'resolves' : 'missing-subpath'
}

/** @param {any[]} at @returns {'client'|'host'|'mixed'} */
function planeOf(at) {
  const files = Array.isArray(at) ? at : []
  const client = files.filter(file => /client lib|\\client\\|\/client\//i.test(file)).length
  if (files.length > 0 && client === files.length) return 'client'
  if (client === 0) return 'host'
  return 'mixed'
}

/**
 * Classify one specifier against the roster, the plugin's own install tree and the profile's.
 *
 * @param {string} specifier - what the plugin imports.
 * @param {any} manifest - the plugin's own manifest, for what it declared.
 * @param {Map<string, any>} roster - the shared kernel roster.
 * @param {string} targetDir - the plugin package directory.
 * @param {string} profileModules - the profile's node_modules.
 * @returns {Record<string, any>} the class and the fields that class reports.
 */
function classifySpecifier(specifier, manifest, roster, targetDir, profileModules) {
  const split = splitSpecifier(specifier)
  if (split === null) return { class: 'not-a-package' }
  const hit = roster.get(split.pkg)
  let found = hit === undefined ? null : { ...hit, source: 'kernel' }
  for (const [where, base] of [['plugin-install', join(targetDir, 'node_modules', split.pkg)], ['profile-install', join(profileModules, split.pkg)]]) {
    if (found !== null) break
    const manifestPath = join(base, 'package.json')
    if (!existsSync(manifestPath)) continue
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    found = { dir: dirname(manifestPath), exports: parsed.exports ?? null, client: parsed.dsh?.client ?? null, source: where }
  }
  if (found === null) {
    // Not installed anywhere reachable: say what the plugin itself declared rather than calling every
    // unresolved name missing.
    const declaredAs = manifest.peerDependencies?.[split.pkg] !== undefined ? 'peer-not-installed'
      : manifest.dependencies?.[split.pkg] !== undefined ? 'dependency-not-installed' : 'undeclared-not-found'
    return { class: declaredAs }
  }
  return { class: subpathClass(found, split.subpath), package: split.pkg, subpath: split.subpath, resolvedFrom: found.source }
}

/**
 * R4 as a fixed reading: the roster covers three sources, and a name none of them carries must still be
 * judged unresolvable rather than quietly resolving against a roster that grew.
 */
function selfTest() {
  const roster = kernelRoster()
  const dir = join(REPO, '.tmp', 'r51-import-selftest')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'r51-probe', peerDependencies: { 'peer-only-probe': '^1.0.0' } }))
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const workspace = [...roster].find(([, entry]) => entry.origin === 'workspace')?.[0] ?? ''
  const app = [...roster].find(([, entry]) => entry.origin === 'app')?.[0] ?? ''
  const vendored = [...roster].find(([, entry]) => entry.origin === 'vendor')?.[0] ?? ''
  const cases = [
    ['no source carries left-pad, so it stays unresolvable', classifySpecifier('left-pad', manifest, roster, dir, dir).class === 'undeclared-not-found'],
    ['a peer nobody installed is named as a peer', classifySpecifier('peer-only-probe', manifest, roster, dir, dir).class === 'peer-not-installed'],
    ['a workspace package resolves (' + workspace + ')', workspace !== '' && classifySpecifier(workspace, manifest, roster, dir, dir).class === 'resolves'],
    // An app package is found through the roster; whether its SUBPATH resolves is a separate question
    // (the CLI app declares an exports map without "."), so this asserts roster coverage, not the subpath.
    ['an app package is found through the roster, not undeclared (' + app + ')', app !== '' && ['undeclared-not-found', 'dependency-not-installed', 'peer-not-installed', 'not-a-package'].includes(classifySpecifier(app, manifest, roster, dir, dir).class) === false],
    ['a vendored package resolves (' + vendored + ')', vendored !== '' && classifySpecifier(vendored, manifest, roster, dir, dir).class === 'resolves'],
    ['the roster carries all three origins', ['workspace', 'app', 'vendor'].every((origin) => [...roster].some(([, entry]) => entry.origin === origin))],
  ]
  let bad = 0
  for (const [what, held] of cases) { console.log('  ' + (held ? 'ok  ' : 'FAIL') + ' ' + what); if (!held) bad += 1 }
  console.log('self-test: ' + String(cases.length - bad) + '/' + String(cases.length) + ' held')
  rmSync(dir, { recursive: true, force: true })
  return bad === 0
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
  const roster = kernelRoster()
  const targets = JSON.parse(readFileSync(TARGETS, 'utf8')).targets
  const plugins = []
  for (const target of targets) {
    const usage = analyze(target.dir)
    const manifest = JSON.parse(readFileSync(join(target.dir, 'package.json'), 'utf8'))
    const profileModules = resolve(target.dir, '..', '..')
    const rows = []
    for (const entry of usage.imports ?? []) {
      const plane = planeOf(entry.at)
      const verdict = classifySpecifier(entry.specifier, manifest, roster, target.dir, profileModules)
      // The field order is kept as it was: this report is compared byte for byte by its --check, and a
      // reordered key would show up as a change nobody made.
      rows.push(verdict.package === undefined
        ? { specifier: entry.specifier, plane, class: verdict.class, at: entry.at }
        : { specifier: entry.specifier, plane, class: verdict.class, package: verdict.package, subpath: verdict.subpath, resolvedFrom: verdict.resolvedFrom, at: entry.at })
    }
    const counts = {}
    for (const row of rows) counts[row.class] = (counts[row.class] ?? 0) + 1
    plugins.push({ name: target.name, version: target.version, rows, counts })
  }
  const report = {
    format: FORMAT,
    note: [
      'Module resolution only: a specifier that resolves says the package and subpath still exist, NOT that the exported API kept its shape.',
      'undeclared-not-found covers names no dependency section declares and no reachable install provides; the import extractor also records quoted strings that are not module specifiers, so a name here may be an extraction artifact rather than a missing package.',
      'not-a-package counts specifiers this checker refuses to judge (relative paths, node: builtins).',
    ],
    kernelPackages: roster.size,
    plugins,
    counts: plugins.reduce((total, plugin) => {
      for (const [key, value] of Object.entries(plugin.counts)) total[key] = (total[key] ?? 0) + value
      return total
    }, {}),
    sourceDigest: createHash('sha256').update(JSON.stringify(plugins.map(plugin => ({ name: plugin.name, rows: plugin.rows.map(row => [row.specifier, row.class]) })))).digest('hex').slice(0, 16),
  }
  const text = JSON.stringify(report, null, 1) + '\n'
  if (argv.includes('--check')) {
    if (!existsSync(OUT)) { console.log('FAIL  no committed report at ' + OUT); process.exit(1) }
    if (readFileSync(OUT, 'utf8') !== text) { console.log('FAIL  the committed resolution report no longer describes these plugins'); process.exit(1) }
    console.log(`PASS  ${OUT}: ${report.kernelPackages} kernel package(s), ${JSON.stringify(report.counts)}`)
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`kernel packages: ${report.kernelPackages}`)
  for (const plugin of plugins) {
    console.log(`
${plugin.name}@${plugin.version}  ${JSON.stringify(plugin.counts)}`)
    for (const row of plugin.rows.filter(row => row.class === 'missing-package' || row.class === 'missing-subpath')) console.log(`  [${row.class}] ${row.plane} ${row.specifier}`)
  }
  console.log(`
-> ${OUT}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
