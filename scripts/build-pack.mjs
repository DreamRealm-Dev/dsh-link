#!/usr/bin/env node
/**
 * One manifest for every plugin this repository ships.
 *
 * The plugins here are mounted one bundle patch at a time, which is convenient to write and
 * impossible to inventory: nothing in the tree answers "what does this project install". The
 * distribution it borrows this shape from (DSH EAC's full pack) answers it with a generated
 * manifest rather than a hand-written list, for the same reason a hand-written list is wrong:
 * it drifts the moment somebody adds a plugin and forgets the list.
 *
 * So this file is derived, never edited: each plugin's package.json and the bundle patches next to
 * them are the source, and `--check` fails when the checked-in manifest is not what they say.
 *
 * Run:  node scripts/build-pack.mjs [--check]
 * Exit: 0 written (or, with --check, already correct); 1 drift; 2 the plugin tree is unreadable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(PROJECT, 'plugins')
const MANIFEST = join(PROJECT, 'pack', 'pack.json')

/**
 * Read one plugin directory as the manifest describes it.
 * @param name - the directory name under `plugins/`.
 * @returns the plugin's manifest entry, or null when it carries no package.json.
 */
function readPlugin(name) {
  const dir = join(PLUGINS, name)
  const packagePath = join(dir, 'package.json')
  if (!existsSync(packagePath)) return null
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  const declared = manifest?.dsh?.bundle?.patch
  const patches = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared]
  const normalized = patches.map((value) => String(value).replace(/^\.\//, ''))
  // Only composition patches describe rows. A plugin may also ship data patches (a preset list, for
  // instance), and reading those `- id:` lines as rows would put preset and tool identifiers into a
  // list of mounted plugin rows — the two are not the same inventory, and a manifest that mixes
  // them cannot answer the question it exists for.
  const rows = []
  const mountedNames = []
  for (const patch of normalized) {
    const path = join(dir, patch)
    if (!existsSync(path)) continue
    // Composition patches are named `cordis.patch.yml` in this repository; the other patches a
    // plugin ships are data (presets, tools) whose entries also carry ids and names but mount no
    // package, so they are not rows.
    if (!/cordis\.patch\.ya?ml$/i.test(patch)) continue
    const text = readFileSync(path, 'utf8')
    // A composition row is an inserted entry that names a plugin: `- id: <row>` followed by
    // `name: <package>` in the same block. A data patch inserts entries without a package name
    // (presets, tools), and counting those as mounted rows would put identifiers in the manifest
    // that no bundle mounts.
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const row = /^\s*-\s*id:\s*(\S+)\s*$/.exec(lines[index])
      if (row === null) continue
      let name = null
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^\s*-\s*id:/.test(lines[cursor])) break
        const named = /^\s*name:\s*(\S+)\s*$/.exec(lines[cursor])
        if (named !== null) { name = named[1]; break }
      }
      if (name === null) continue
      if (!rows.includes(row[1])) rows.push(row[1])
      if (!mountedNames.includes(name)) mountedNames.push(name)
    }
  }
  return {
    id: String(manifest.name ?? name),
    version: String(manifest.version ?? '0.0.0'),
    // The licence travels with the entry: a pack that cannot say what it redistributes cannot be
    // shipped, and a plugin that ships no licence declares `none` rather than leaving a reader to
    // assume the permissive one this repository uses for its own code.
    license: typeof manifest.license === 'string' && manifest.license.trim() !== '' ? manifest.license.trim() : 'none',
    // Whose work this is. `own` is the default because the tree is this project's, and a plugin that
    // carries somebody else's code has to say so — the licence gate cannot otherwise tell a package
    // written here from one copied in, and "our own work" would stay an unprovable claim.
    origin: manifest?.dsh?.link?.origin === 'third-party' ? 'third-party' : 'own',
    licenseFile: ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].find((candidate) => existsSync(join(dir, candidate))) ?? null,
    entry: typeof manifest.main === 'string' && manifest.main !== '' ? manifest.main.replace(/^\.\//, '') : null,
    bundlePatches: normalized,
    rows,
    mountedNames,
    client: existsSync(join(dir, 'lib', 'client.js')),
  }
}

/**
 * Build the manifest from the plugin tree.
 * @returns the manifest document, with its own counts so a reader need not recount.
 */
export function buildPack() {
  if (!existsSync(PLUGINS)) {
    console.error('no plugin tree at ' + PLUGINS)
    process.exit(2)
  }
  const plugins = readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPlugin(entry.name))
    .filter((entry) => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
  // Who mounts whom is a fact about the composition, not about a package: several packages here are
  // mounted by another plugin's patch, and a manifest that cannot say so would report them as
  // shipping nothing.
  for (const plugin of plugins) {
    const mounters = plugins
      .filter((other) => other.id !== plugin.id && other.mountedNames.includes(plugin.id))
      .map((other) => other.id)
    plugin.mountedBy = mounters
    plugin.unmounted = plugin.entry !== null && plugin.rows.length === 0 && mounters.length === 0
  }
  return {
    format: 'dsh-link.pack/1',
    generatedBy: 'scripts/build-pack.mjs',
    source: 'plugins/*/package.json and the bundle patches they name',
    counts: {
      plugins: plugins.length,
      bundles: plugins.filter((plugin) => plugin.bundlePatches.length > 0).length,
      rows: plugins.reduce((total, plugin) => total + plugin.rows.length, 0),
      client: plugins.filter((plugin) => plugin.client).length,
      unmounted: plugins.filter((plugin) => plugin.unmounted).length,
      unlicensed: plugins.filter((plugin) => plugin.license === 'none').length,
      thirdParty: plugins.filter((plugin) => plugin.origin === 'third-party').length,
    },
    licenses: Object.fromEntries(
      [...new Set(plugins.map((plugin) => plugin.license))].sort()
        .map((license) => [license, plugins.filter((plugin) => plugin.license === license).map((plugin) => plugin.id)]),
    ),
    plugins,
  }
}

// The CLI runs only when this file is the program. A gate that imports `buildPack()` to derive the
// expected manifest would otherwise rewrite the manifest before comparing it — a check that always
// agrees with itself, which is worse than no check because it reports success.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const json = JSON.stringify(buildPack(), null, 2) + '\n'
  main(json)
}

/**
 * Write the manifest, or compare it when asked to check.
 * @param json - the manifest the tree currently describes.
 */
function main(json) {
if (process.argv.includes('--check')) {
  const current = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : ''
  if (current === json) {
    console.log('pack/pack.json matches the plugin tree');
    process.exit(0)
  }
  console.error('pack/pack.json is not what the plugin tree says; run node scripts/build-pack.mjs')
  const before = current.split('\n')
  const after = json.split('\n')
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] !== after[index]) {
      console.error('  line ' + String(index + 1) + ': on disk ' + JSON.stringify(before[index] ?? null)
        + ' | from the tree ' + JSON.stringify(after[index] ?? null))
      break
    }
  }
  process.exit(1)
}
mkdirSync(dirname(MANIFEST), { recursive: true })
mkdirSync(dirname(MANIFEST), { recursive: true })
writeFileSync(MANIFEST, json, 'utf8')
console.log('wrote pack/pack.json: ' + String(buildPack().counts.plugins) + ' plugins, '
  + String(buildPack().counts.rows) + ' rows, ' + String(buildPack().counts.client) + ' with a client bundle')
}