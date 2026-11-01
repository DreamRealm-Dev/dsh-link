#!/usr/bin/env node
/**
 * The simple layer may name capabilities and roles, never the kernel's own service/member paths.
 *
 * Why this check looks at paths rather than at every member word: a member word alone is not
 * evidence. «execute» is the kernel member behind the shell capability's «run» role, and it is
 * also an ordinary field name a simple interface may own (this layer's tool handler has an
 * «execute» field). Flagging the bare word turned the check red on a file with no kernel coupling
 * at all, which is the failure mode this repository keeps paying for: an instrument whose reading
 * is about the instrument. The coupling that actually exists is *reaching the kernel by its own
 * name*, so this checks exactly that:
 *
 *   1. a dotted kernel pair — «<service>.<member>» (compat/table's own bindings) spelled in the file;
 *   2. a kernel **service** name passed where a **capability** name belongs («capability('sessions')»);
 *   3. a capability argument that is not in the vocabulary at all.
 *
 * The forbidden/allowed sets are derived from the loaded table, never hand-written, so a table edit
 * moves them. «--self-attack» rewrites a copy with each real coupling and requires this check to go
 * red, so the check is proven able to fail rather than asserted to be strict.
 *
 * Usage:
 *   node scripts/verify-compat-simple-role-words.mjs [--file <path>] [--self-attack]
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCompatModule } from '../compat/load.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name)
  return at === -1 ? fallback : process.argv[at + 1]
}
const flag = (name) => process.argv.includes('--' + name)

const TARGET = resolve(option('file', join(PROJECT, 'compat', 'simple.ts')))

const fail = (message) => {
  process.stdout.write('FAIL ' + message + '\n')
  process.exit(1)
}

/** The vocabulary: capability names, their role words, and every kernel binding behind them. */
const vocabularyOf = (tables) => {
  const capabilities = new Set()
  const roleWords = new Set()
  const services = new Set()
  const pairs = []
  for (const table of tables) {
    for (const [capability, row] of Object.entries(table.capabilities ?? {})) {
      capabilities.add(capability)
      for (const role of row.roles ?? []) roleWords.add(role.includes('.') ? role.split('.').slice(1).join('.') : role)
      for (const target of row.targets ?? []) {
        services.add(target.service)
        for (const bind of target.binds ?? []) {
          pairs.push({ service: target.service, member: bind.member, role: bind.role, capability })
        }
      }
    }
  }
  return { capabilities, roleWords, services, pairs }
}

/** Every place the file reaches for the kernel by its own name. */
const violationsOf = (source, vocabulary) => {
  const lines = source.split(/\r?\n/)
  const found = []
  const capabilityCalls = /(?:capability|require|has)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    for (const pair of vocabulary.pairs) {
      if (line.includes(pair.service + '.' + pair.member)) {
        found.push({
          line: at + 1,
          why: 'kernel pair ' + pair.service + '.' + pair.member + ' (' + pair.capability + '\'s role ' + pair.role + ') spelled directly',
          text: line.trim(),
        })
      }
    }
    for (const match of line.matchAll(capabilityCalls)) {
      const asked = match[1]
      if (vocabulary.services.has(asked) && !vocabulary.capabilities.has(asked)) {
        found.push({ line: at + 1, why: 'kernel service "' + asked + '" passed where a capability name belongs', text: line.trim() })
      } else if (!vocabulary.capabilities.has(asked)) {
        found.push({ line: at + 1, why: '"' + asked + '" is not a capability in this vocabulary', text: line.trim() })
      }
    }
  }
  return found
}

/**
 * R92: the default output spec must be one the kernel's raw-task rule accepts. Grounded in the kernel, not
 * in taste: cordis-host-runner/src/guard.ts:407-411 turns an object schema WITHOUT a `type` key into
 * `json` for raw tasks, while :412 rejects `type: 'json'` itself. So the default may not declare a type at
 * all — the previous `{ type: 'json' }` made every `tools.add` without an explicit `output` throw.
 */
const defaultOutputOf = (text) => {
  const hit = /const output = spec\.output \?\? (\{[^}]*\})/.exec(text)
  if (hit === null) return { spec: null, problem: 'the default output spec is no longer a literal object (expected: const output = spec.output ?? {…})' }
  if (/\btype\s*:/.test(hit[1])) return { spec: hit[1], problem: 'the default output spec declares a type (' + hit[1] + '): the kernel rejects type:"json" for raw tasks and any other type narrows the documented default' }
  return { spec: hit[1], problem: null }
}

if (!existsSync(TARGET)) fail('no file to inspect at ' + TARGET)
const compat = await loadCompatModule()
const tables = compat.TABLES
if (!Array.isArray(tables) || tables.length === 0) fail('the compat module exported no tables')
const vocabulary = vocabularyOf(tables)
const source = readFileSync(TARGET, 'utf8')
const clean = violationsOf(source, vocabulary)

const report = (label, violations, file) => {
  if (violations.length === 0) {
    process.stdout.write('PASS ' + label + ': 0 kernel paths, 0 service-named capabilities in ' + file + '\n')
    return
  }
  for (const hit of violations) process.stdout.write('FAIL ' + file + ':' + hit.line + ' — ' + hit.why + ': ' + hit.text.slice(0, 140) + '\n')
}

if (flag('self-attack')) {
  if (clean.length > 0) {
    report('the file under test', clean, TARGET)
    fail('the file is not clean, so an attack would prove nothing')
  }
  const pair = vocabulary.pairs.find((entry) => entry.capability === 'shell') ?? vocabulary.pairs[0]
  const service = [...vocabulary.services].find((name) => !vocabulary.capabilities.has(name))
  if (pair === undefined || service === undefined) fail('this vocabulary has nothing to inject, so the check cannot be proven to fail')
  const dir = mkdtempSync(join(tmpdir(), 'r30-role-words-'))
  try {
    const attacks = [
      { name: 'kernel dotted pair', body: '\nconst attack = (kernel) => kernel.' + pair.service + '.' + pair.member + '(1)\n' },
      { name: 'service name as capability', body: '\nconst attack2 = (link) => link.capability(' + JSON.stringify(service) + ')\n' },
      { name: 'word outside the vocabulary', body: '\nconst attack3 = (link) => link.require(\'notAThing\')\n' },
    ]
    let allCaught = true
    for (const attack of attacks) {
      const copy = join(dir, 'under-attack-' + attack.name.replace(/[^a-z]+/gi, '-') + '.ts')
      writeFileSync(copy, source + attack.body, 'utf8')
      const caught = violationsOf(readFileSync(copy, 'utf8'), vocabulary)
      if (caught.length === 0) {
        allCaught = false
        process.stdout.write('FAIL the attack "' + attack.name + '" stayed green\n')
      } else {
        process.stdout.write('ok   attack caught (' + attack.name + '): ' + caught[0].why + ' at line ' + caught[0].line + '\n')
      }
    }
    const reverted = source.replace('const output = spec.output ?? {}', "const output = spec.output ?? { type: 'json' }")
    if (reverted === source) {
      allCaught = false
      process.stdout.write('FAIL the reverted-default-output attack could not be built: the source no longer matches the shipped default\n')
    } else {
      const problem = defaultOutputOf(reverted).problem
      if (problem === null) {
        allCaught = false
        process.stdout.write('FAIL the attack "reverted default output ({ type: \'json\' })" stayed green\n')
      } else {
        process.stdout.write('ok   attack caught (reverted default output): ' + problem + '\n')
      }
    }
    if (!allCaught) process.exit(1)
    process.stdout.write('ok   and the clean file passes: ' + vocabulary.pairs.length + ' kernel binding(s) known, 0 violations\n')
    process.exit(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.stdout.write('simple layer under test: ' + TARGET + '\n')
process.stdout.write('capabilities in vocabulary : ' + [...vocabulary.capabilities].sort().join(', ') + '\n')
process.stdout.write('role words allowed         : ' + [...vocabulary.roleWords].sort().join(', ') + '\n')
process.stdout.write('kernel bindings known      : ' + vocabulary.pairs.length + ' across ' + vocabulary.services.size + ' service(s)\n')
report('the simple layer', clean, TARGET)
const output = defaultOutputOf(source)
process.stdout.write(output.problem === null
  ? 'ok   default output spec: ' + output.spec + ' — no `type`, which is the unconstrained form the kernel raw rule accepts\n'
  : 'FAIL ' + output.problem + '\n')
process.exit(clean.length === 0 && output.problem === null ? 0 : 1)
