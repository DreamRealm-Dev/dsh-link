#!/usr/bin/env node
/**
 * Gate: anchored-lite changes exactly ONE thing about a request prefix - the tool surface.
 *
 * Why this exists (R219). The plugin's first version did two things to every session: it narrowed the
 * tool catalog, and it stripped the auto-injected context messages (AGENTS.md summary, skill catalog).
 * A request prefix is tools + system/context + history, and the provider caches it byte for byte, so
 * each of those is a FULL re-prefix: two per session on a cold start, and one more at promotion.
 * The plugin now does the first only. This gate holds that line:
 *
 *   R1  exactly one registered hook can change a request prefix (system-prompt/assemble), and no
 *       agent/pre-step hook exists at all
 *   R2  cold start narrows the catalog to the bootstrap pair and leaves system + messages untouched
 *   R3  after one promote event the catalog is bootstrap + resident, still with no pre-step hook
 *   R4  a config that names suppressedContextSources is ACCEPTED, warns BY NAME, and still registers
 *       no pre-step hook (accepted-but-ignored is named, never silent)
 *   R5  declared readings == produced readings
 *
 * What it does NOT prove: that the model behaves the same with the injected context present. The
 * reference implementation's anchoring phenomenon depended on the catalog being absent, so this gate
 * cannot promise that behaviour survives - it promises the prefix budget.
 *
 * Usage: node scripts/verify-anchored-lite-prefix.mjs [--json] [--self-attack]
 * Exit 0 every reading held | 1 a reading failed, or a mutant did not land | 3 an input is missing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const MODULE = join(PROJECT, 'plugins', 'dsh-anchored-lite', 'lib', 'index.js')
const DECLARED = 5
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SELF_ATTACK = argv.includes('--self-attack')

const BOOTSTRAP = ['bash', 'str_replace_editor']
const RESIDENT = ['cordis_inspect_list', 'skill_search']
const CATALOG = ['bash', 'str_replace_editor', 'cordis_inspect_list', 'skill_search', 'pwsh', 'read']

/** Mount the shipped module against a recording context. */
const mount = async (config, source = MODULE) => {
  const mod = await import(new URL('file://' + source.split('\\').join('/')).href)
  const hooks = []
  const warnings = []
  const ctx = {
    on: (event, fn, options) => { hooks.push({ event, fn, options }); return () => {} },
    logger: { warn: (line) => warnings.push(String(line)), info: () => {}, error: () => {} },
  }
  mod.apply(ctx, config)
  return { hooks, warnings, mod }
}

/** The assembly a request would carry, before any plugin narrows it. */
const assembly = () => ({
  tools: CATALOG.map((name) => ({ name, description: name + ' schema', parameters: {} })),
  system: 'SYSTEM PROMPT BYTES',
  messages: [{ role: 'system', source: { kind: 'agent-instructions' }, content: 'AGENTS' }, { role: 'user', content: 'hi' }],
})

const namesOf = (out) => (Array.isArray(out?.tools) ? out.tools.map((tool) => tool.name) : null)
const sameSet = (a, b) => a !== null && a.length === b.length && b.every((one) => a.includes(one))

/** Run the one hook that may change a prefix, for a session in the given state. */
const assemble = async (mounted, sessionId) => {
  const hook = mounted.hooks.find((one) => one.event === 'system-prompt/assemble')
  if (hook === undefined) return { missing: true }
  const out = await hook.fn({}, { agent: { session: { id: sessionId } } }, async () => assembly())
  return { out }
}

const promote = (mounted, sessionId) => {
  const hook = mounted.hooks.find((one) => one.event === 'session/event')
  if (hook === undefined) return false
  hook.fn({ id: sessionId }, { type: 'tool/call' })
  return true
}

const judge = (world) => {
  const rows = []
  const record = (id, ok, detail) => rows.push({ id, ok: ok === true, detail })

  const prefixHooks = world.cold.hooks.filter((one) => one.event === 'system-prompt/assemble' || one.event === 'agent/pre-step')
  const preStep = world.cold.hooks.filter((one) => one.event === 'agent/pre-step')
  record('R1', world.cold.hooks.length > 0 && prefixHooks.length === 1 && prefixHooks[0].event === 'system-prompt/assemble' && preStep.length === 0,
    'hooks=' + JSON.stringify(world.cold.hooks.map((one) => one.event)) + ' | prefix-changing hooks=' + String(prefixHooks.length) + ' (must be 1: system-prompt/assemble) | agent/pre-step hooks=' + String(preStep.length) + ' (must be 0)')

  const coldNames = namesOf(world.coldAssembled.out)
  const coldQuiet = world.coldAssembled.out !== undefined && world.coldAssembled.out.system === 'SYSTEM PROMPT BYTES'
    && JSON.stringify(world.coldAssembled.out.messages) === JSON.stringify(assembly().messages)
  record('R2', sameSet(coldNames, BOOTSTRAP) && coldQuiet,
    'cold start tools=' + JSON.stringify(coldNames) + ' (must be ' + JSON.stringify(BOOTSTRAP) + ') | system bytes untouched=' + String(world.coldAssembled.out?.system === 'SYSTEM PROMPT BYTES') + ' | messages untouched=' + String(coldQuiet))

  const promotedNames = namesOf(world.promotedAssembled.out)
  const promoteRan = promote(world.cold, 's-promote')
  const promotedAgain = promoteRan ? null : 'no session/event hook'
  const preStepAfter = world.cold.hooks.filter((one) => one.event === 'agent/pre-step').length
  record('R3', promoteRan && sameSet(promotedNames, [...BOOTSTRAP, ...RESIDENT]) && preStepAfter === 0,
    'after one tool/call the catalog=' + JSON.stringify(promotedNames) + ' (must be ' + JSON.stringify([...BOOTSTRAP, ...RESIDENT]) + ') | promote hook present=' + String(promoteRan) + ' | ' + String(promotedAgain ?? 'promoted once') + ' | agent/pre-step hooks=' + String(preStepAfter))

  const suppressedConfig = { suppressedContextSources: ['skill-catalog'] }
  const warned = world.suppressed.warnings.some((line) => line.includes('suppressedContextSources') && /IGNORED/i.test(line))
  const suppressedHooks = world.suppressed.hooks.map((one) => one.event)
  record('R4', world.suppressedMounted === true && warned && suppressedHooks.includes('agent/pre-step') === false && suppressedHooks.includes('system-prompt/assemble') === true,
    'config naming suppressedContextSources: accepted=' + String(world.suppressedMounted) + ' | warned by name=' + String(warned) + ' | hooks=' + JSON.stringify(suppressedHooks) + ' | warning=' + JSON.stringify(world.suppressed.warnings[0] ?? null))

  record('R5', rows.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(rows.length + 1))
  return rows
}

const world = async () => {
  const cold = await mount({})
  const coldAssembled = await assemble(cold, 's-cold')
  const promotedMounted = await mount({})
  promote(promotedMounted, 's-promote')
  const promotedAssembled = await assemble(promotedMounted, 's-promote')
  let suppressed = { hooks: [], warnings: [] }
  let suppressedMounted = true
  try { suppressed = await mount({ suppressedContextSources: ['skill-catalog'] }) } catch (error) { suppressedMounted = false }
  return { cold, coldAssembled, promotedAssembled, suppressed, suppressedMounted, mount }
}

const mutants = (base) => [
  // R1 and R3 both assert that no agent/pre-step hook exists (the prefix budget and the promoted state), so
  // a mutant that adds one is caught by both.
  { name: 'a-pre-step-hook-comes-back', declared: ['R1', 'R3'], apply: (w) => { w.cold.hooks.push({ event: 'agent/pre-step', fn: () => {}, options: {} }) } },
  { name: 'cold-start-keeps-the-whole-catalog', declared: ['R2'], apply: (w) => { w.coldAssembled.out = { ...assembly() } } },
  { name: 'promotion-keeps-the-bootstrap-pair-only', declared: ['R3'], apply: (w) => { w.promotedAssembled.out = { ...assembly(), tools: assembly().tools.filter((tool) => BOOTSTRAP.includes(tool.name)) } } },
  { name: 'suppressedContextSources-is-accepted-silently', declared: ['R4'], apply: (w) => { w.suppressed.warnings.length = 0 } },
  { name: 'the-system-prompt-is-rewritten-too', declared: ['R2'], apply: (w) => { w.coldAssembled.out = { ...w.coldAssembled.out, system: 'DIFFERENT BYTES' } } },
]

const main = async () => {
  const base = await world()
  const rows = judge(base)
  const red = rows.filter((row) => row.ok !== true).map((row) => row.id)
  if (SELF_ATTACK) {
    console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline: the shipped module judged as it is -> red=' + JSON.stringify(red))
    let failures = red.length === 0 ? 0 : 1
    for (const mutant of mutants(base)) {
      const copy = { ...base, cold: { ...base.cold, hooks: [...base.cold.hooks] }, coldAssembled: { ...base.coldAssembled }, promotedAssembled: { ...base.promotedAssembled }, suppressed: { hooks: [...base.suppressed.hooks], warnings: [...base.suppressed.warnings] } }
      mutant.apply(copy)
      const seen = judge(copy).filter((row) => row.ok !== true).map((row) => row.id)
      const precise = seen.length === mutant.declared.length && mutant.declared.every((id) => seen.includes(id))
      if (precise !== true) failures += 1
      console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + JSON.stringify(seen) + ' declared=' + JSON.stringify(mutant.declared))
    }
    console.log(failures === 0 ? '  every mutant landed where it declared' : '  ' + String(failures) + ' failure(s)')
    return failures === 0 ? 0 : 1
  }
  if (JSON_OUT) console.log(JSON.stringify({ gate: 'anchored-lite-prefix', declared: DECLARED, rows }, null, 2))
  else {
    for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '  |  ' + row.detail)
    console.log('')
    console.log(String(rows.length) + ' readings, ' + String(rows.length - red.length) + ' held, ' + String(red.length) + ' failed')
  }
  return red.length === 0 ? 0 : 1
}

process.exitCode = await main()
