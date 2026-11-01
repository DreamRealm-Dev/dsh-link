#!/usr/bin/env node
/**
 * The link-interconnect local gate: parse, layering, declaration validity, adapter budget.
 *
 * Fast enough to run on every edit (esbuild in-memory, no writes), so the Lead's full
 * plugins/build.mjs stays the only thing that writes lib/:
 *
 *   node scripts/link-interconnect-parse-check.mjs
 *
 * Readings: parse (host + client halves resolve and parse), cordis-free (only src/index.ts
 * may import @deepseek-ai/*; the client half may use the preloaded client baseline only),
 * adapters (each adapter.json parses, each adapter.mjs is inside the 120-line budget).
 * Exit 0 all held | 1 a reading failed.
 */
import { build } from 'esbuild'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(PROJECT, 'plugins', 'dsh-link-interconnect')
const HOST_EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope']
const CLIENT_BASELINE = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
const ADAPTER_BUDGET_LINES = 120

const failures = []
const passes = []
const hold = (label, detail) => passes.push(label + (detail ? ': ' + detail : ''))
const fail = (label, detail) => failures.push(label + (detail ? ': ' + detail : ''))

/** Parse one bundle in memory; returns null or a diagnosable sentence. */
async function parse(entry, client) {
  try {
    await build({
      entryPoints: [entry], bundle: true, write: false, logLevel: 'silent', absWorkingDir: PROJECT,
      platform: client ? 'browser' : 'node', format: client ? 'cjs' : 'esm', target: client ? 'chrome120' : 'node22',
      jsx: 'automatic', external: client ? CLIENT_BASELINE : HOST_EXTERNAL, loader: { '.css': 'text', '.svg': 'text' },
    })
    return null
  } catch (error) {
    const list = Array.isArray(error?.errors) ? error.errors : []
    if (list.length === 0) return String(error?.message ?? error)
    return list.slice(0, 6).map((e) => (e.location ? e.location.file + ':' + e.location.line + ' ' : '') + e.text).join(' | ')
  }
}

const half = (rel) => join(PLUGIN, rel)
for (const [rel, client] of [['src/index.ts', false], ['src/client/index.tsx', true]]) {
  if (!existsSync(half(rel))) { hold('parse ' + rel, 'absent (skipped)'); continue }
  const problem = await parse(half(rel), client)
  if (problem === null) hold('parse ' + rel); else fail('parse ' + rel, problem)
}

/** Every .ts/.tsx below src/. */
function sources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

const heartbeat = /from\s+['"]@deepseek-ai\//.test('') // eslint placeholder, replaced below
for (const path of sources(half('src'))) {
  const rel = path.slice(PLUGIN.length + 1).replaceAll(sep, '/')
  const text = readFileSync(path, 'utf8')
  if (rel === 'src/index.ts') continue
  if (rel.startsWith('src/client/')) {
    // The browser half may use the shell's preloaded module table only.
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec.startsWith('.') || spec.startsWith('node:')) continue
      if (!CLIENT_BASELINE.includes(spec)) fail('client-baseline ' + rel, 'imports ' + spec + ' (not preloaded)')
    }
    continue
  }
  if (/from\s+['"]@deepseek-ai\//.test(text)) fail('cordis-free ' + rel, 'a host module below src/index.ts imports @deepseek-ai/*')
  if (/from\s+['"]react/.test(text)) fail('cordis-free ' + rel, 'a host module below src/index.ts imports react')
}
hold('cordis-free layering')

const adaptersDir = join(PLUGIN, 'adapters')
if (existsSync(adaptersDir)) {
  const declared = readdirSync(adaptersDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  for (const id of declared) {
    const json = join(adaptersDir, id, 'adapter.json')
    if (!existsSync(json)) { fail('adapter ' + id, 'missing adapter.json'); continue }
    try {
      const declaration = JSON.parse(readFileSync(json, 'utf8'))
      if (declaration.id !== id) fail('adapter ' + id, 'adapter.json declares id ' + String(declaration.id))
      else if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) fail('adapter ' + id, 'declares no capabilities')
      else hold('adapter ' + id + ' declaration')
    } catch (error) { fail('adapter ' + id + ' declaration', String(error?.message ?? error)) }
    const script = join(adaptersDir, id, 'adapter.mjs')
    if (existsSync(script)) {
      const lines = readFileSync(script, 'utf8').split('\n').length
      if (lines > ADAPTER_BUDGET_LINES) fail('adapter ' + id + ' budget', lines + ' lines > ' + ADAPTER_BUDGET_LINES)
      else hold('adapter ' + id + ' budget', lines + ' lines <= ' + ADAPTER_BUDGET_LINES)
    }
  }
}
hold('adapter declarations + budget')

if (existsSync(join(PLUGIN, 'package.json'))) {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
  const patch = manifest?.dsh?.bundle?.patch
  if (typeof patch !== 'string') fail('package manifest', 'dsh.bundle.patch is not a path')
  else if (!existsSync(join(PLUGIN, patch))) fail('package manifest', 'declared patch ' + patch + ' is missing')
  else hold('package manifest', patch)
}

for (const line of passes) console.log('ok   ' + line)
for (const line of failures) console.log('FAIL ' + line)
console.log('---')
console.log('link-interconnect gate: ' + passes.length + ' held, ' + failures.length + ' failed')
process.exit(failures.length === 0 ? 0 : 1)
