#!/usr/bin/env node
/**
 * Check a package against the community skin-package contract.
 *
 * The contract is the one the public skin manager enforces (captured in R32 from
 * `dsh-skin-manager/皮肤新增指南.md`): a package needs package.json, skin.json, a browser half
 * reachable through `exports["./client"]`, a declared `dsh.client.platform`, and preview images;
 * its row id is derived from the package name and must not collide with another skin's.
 *
 * Two rules are worth stating because they are the ones people trip on: a row id is a global key
 * (`duplicate loader entry id`), and every JSON/YAML file must be UTF-8 without a BOM.
 *
 * Usage:
 *   node scripts/check-skin-contract.mjs --package <dir> [--peer <other-skin-dir>]...
 *   node scripts/check-skin-contract.mjs --self-test
 *
 * Exit codes: 0 the package conforms; 1 it does not (each deviation printed); 2 bad usage.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SKIN_NAME = /^@[a-z0-9-]+\/dsh-client-ui-skin-[a-z0-9-]+$/

/** @param {string} file @returns {string|null} '#1 BOM' when the file starts with a BOM. */
function bomOf(file) {
  const head = readFileSync(file).subarray(0, 3)
  return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? '#1 BOM' : null
}

/** @param {string} dir @returns {string[]} every JSON/YAML file under a package. */
function textFiles(dir) {
  const found = []
  const walk = (at) => {
    for (const entry of require$readdir(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const next = join(at, entry.name)
      if (entry.isDirectory()) walk(next)
      else if (/\.(json|jsonc|ya?ml)$/.test(entry.name)) found.push(next)
    }
  }
  walk(dir)
  return found
}

// A tiny indirection keeps the walk readable without importing fs twice.
import { readdirSync as require$readdir } from 'node:fs'

/**
 * @param {string} dir - the package directory.
 * @param {string[]} peers - other skin package directories, for the row-id collision rule.
 * @returns {string[]} every deviation found, in the contract's own order.
 */
export function deviationsOf(dir, peers) {
  const problems = []
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return ['package.json is missing']
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const name = String(manifest.name ?? '')
  if (!SKIN_NAME.test(name)) problems.push(`package.json name "${name}" is not @<scope>/dsh-client-ui-skin-<short>`)
  const clientExport = manifest.exports?.['./client']
  if (clientExport === undefined) problems.push('package.json exports["./client"] is missing: the skin manager loads the browser half through it')
  else {
    const target = typeof clientExport === 'string' ? clientExport : clientExport.default
    if (typeof target !== 'string' || !existsSync(join(dir, target))) problems.push(`exports["./client"] points at "${String(target)}", which does not exist`)
  }
  if (manifest.dsh?.client?.platform !== 'web') problems.push('dsh.client.platform must be "web"')
  const skinPath = join(dir, 'skin.json')
  if (!existsSync(skinPath)) problems.push('skin.json is missing: without it the manager does not list the skin')
  else {
    const skin = JSON.parse(readFileSync(skinPath, 'utf8'))
    for (const key of ['id', 'name', 'nameEn', 'tagline', 'accent', 'preview', 'order']) {
      if (skin[key] === undefined) problems.push(`skin.json is missing "${key}"`)
    }
    const light = skin.preview?.light
    if (typeof light !== 'string' || !existsSync(join(dir, light))) problems.push('skin.json preview.light does not point at an existing file')
  }
  for (const file of textFiles(dir)) {
    const bom = bomOf(file)
    if (bom !== null) problems.push(`${file.slice(dir.length + 1)} starts with a UTF-8 ${bom}`)
  }
  // The row id the manager derives, checked against every peer's.
  if (SKIN_NAME.test(name)) {
    const short = name.replace(/^@[a-z0-9-]+\/dsh-client-ui-skin-/, '')
    const id = 'ui-skin-' + short
    for (const peer of peers) {
      if (resolve(peer) === resolve(dir)) continue
      const peerWindows = peers.filter(other => other !== peer && existsSync(join(other, 'cordis.patch.yml')))
      const text = readFileSync(join(peer, 'cordis.patch.yml'), 'utf8')
      if (new RegExp('id:\\s*' + id + '\\b').test(text) && peerWindows.length >= 0) {
        problems.push(`row id "${id}" is already declared by ${peer}`)
      }
    }
  }
  return problems
}

/** Build one conforming package, then break one rule at a time and require each to be seen. */
function selfTest() {
  const root = join(REPO, '.tmp', 'skin-contract-selftest')
  rmSync(root, { recursive: true, force: true })
  const good = join(root, 'good')
  const write = (base, rel, text) => { const file = join(base, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    write(good, 'package.json', JSON.stringify({ name: '@dsh-external/dsh-client-ui-skin-demo', type: 'module', exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'web' } } }))
    write(good, 'lib/client.js', 'export const nothing = 1\n')
    write(good, 'skin.json', JSON.stringify({ id: 'demo', name: '演示', nameEn: 'Demo', tagline: 'x', accent: '#fff', preview: { light: 'preview/light.webp' }, order: 1 }))
    write(good, 'preview/light.webp', 'not really an image, only existence is checked\n')
    const cases = [
      ['a conforming package has no deviation', () => deviationsOf(good, []).length === 0],
      ['the missing browser half is named', () => { rmSync(join(good, 'lib/client.js')); const seen = deviationsOf(good, []).some(x => /does not exist/.test(x)); write(good, 'lib/client.js', 'export const nothing = 1\n'); return seen }],
      ['a missing skin.json is named', () => { rmSync(join(good, 'skin.json')); const seen = deviationsOf(good, []).some(x => /skin.json is missing/.test(x)); write(good, 'skin.json', JSON.stringify({ id: 'demo', name: '演示', nameEn: 'Demo', tagline: 'x', accent: '#fff', preview: { light: 'preview/light.webp' }, order: 1 })); return seen }],
      ['a BOM is named', () => { write(good, 'cordis.patch.yml', '\ufeff- insert: []\n'); const seen = deviationsOf(good, []).some(x => /UTF-8 #1 BOM/.test(x)); rmSync(join(good, 'cordis.patch.yml')); return seen }],
      ['a colliding row id is named', () => { const peer = join(root, 'peer'); write(peer, 'cordis.patch.yml', '- insert:\n    - id: ui-skin-demo\n      name: other\n'); return deviationsOf(good, [peer]).some(x => /already declared/.test(x)) }],
    ]
    let bad = 0
    for (const [what, held] of cases) { const ok = held(); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad += 1 }
    console.log(`self-test: ${cases.length - bad}/${cases.length} held`)
    return bad === 0
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
  const at = argv.indexOf('--package')
  if (at === -1) { console.error('usage: node scripts/check-skin-contract.mjs --package <dir> [--peer <dir>]... | --self-test'); process.exit(2) }
  const dir = resolve(argv[at + 1])
  const peers = argv.map((value, index) => (value === '--peer' ? argv[index + 1] : null)).filter(value => value !== null).map(value => resolve(value))
  const problems = deviationsOf(dir, peers)
  for (const problem of problems) console.log('  deviation: ' + problem)
  if (problems.length === 0) { console.log('PASS  ' + dir + ' conforms to the skin package contract'); return }
  console.log(`FAIL  ${dir} has ${problems.length} deviation(s)`)
  process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
