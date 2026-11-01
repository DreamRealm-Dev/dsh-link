#!/usr/bin/env node
/**
 * The declarative-adapter budget gate (PLAN section 4.4): a new integration is data plus at most
 * a small script. Reads every adapters/<id>/ directory under the link-interconnect plugin and
 * holds two readings per adapter:
 *
 *   1 adapter.json parses, declares id == <id>, and declares at least one capability;
 *   2 adapter.mjs, when present, is within the 120-line budget (comments included).
 *
 *   node scripts/verify-adapter-budget.mjs
 *   exit 0 all held | 1 a reading failed
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADAPTERS = join(PROJECT, 'plugins', 'dsh-link-interconnect', 'adapters')
const BUDGET_LINES = 120

const failures = []
const passes = []
const hold = (detail) => passes.push(detail)
const fail = (detail) => failures.push(detail)

if (!existsSync(ADAPTERS)) {
  fail('adapters directory is missing: ' + ADAPTERS)
} else {
  const ids = readdirSync(ADAPTERS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  if (ids.length === 0) fail('adapters declares no adapter directories under ' + ADAPTERS)
  const seen = new Set()
  for (const id of ids) {
    const directory = join(ADAPTERS, id)
    const declarationPath = join(directory, 'adapter.json')
    if (!existsSync(declarationPath)) {
      fail('adapter ' + id + ': adapter.json is missing')
      continue
    }
    let declaration
    try {
      declaration = JSON.parse(readFileSync(declarationPath, 'utf8'))
    } catch (error) {
      fail('adapter ' + id + ': adapter.json does not parse: ' + String(error?.message ?? error))
      continue
    }
    if (declaration.id !== id) {
      fail('adapter ' + id + ': adapter.json declares id ' + JSON.stringify(declaration.id))
      continue
    }
    if (seen.has(declaration.id)) {
      fail('adapter ' + id + ': duplicate declared id')
      continue
    }
    seen.add(declaration.id)
    if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) {
      fail('adapter ' + id + ': declares no capabilities')
      continue
    }
    const kinds = declaration.capabilities.map((capability) => (capability !== null && typeof capability === 'object' ? String(capability.kind) : String(capability)))
    hold('adapter ' + id + ': id=' + declaration.id + ' capabilities=' + kinds.join(','))
    const scriptPath = join(directory, 'adapter.mjs')
    if (existsSync(scriptPath)) {
      const lines = readFileSync(scriptPath, 'utf8').split('\n').length
      if (lines > BUDGET_LINES) fail('adapter ' + id + ': adapter.mjs is ' + lines + ' lines, budget ' + BUDGET_LINES)
      else hold('adapter ' + id + ': adapter.mjs ' + lines + ' lines <= ' + BUDGET_LINES)
    } else {
      hold('adapter ' + id + ': adapter.mjs absent (declaration-only adapter)')
    }
  }
}

for (const line of passes) console.log('ok   ' + line)
for (const line of failures) console.log('FAIL ' + line)
console.log('---')
console.log('adapter budget gate: ' + passes.length + ' held, ' + failures.length + ' failed')
process.exit(failures.length === 0 ? 0 : 1)
