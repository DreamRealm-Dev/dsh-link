#!/usr/bin/env node
/**
 * R81: the shape of a plugin's `apply` decides whether the cleanup it returns ever runs.
 *
 * R80 measured a kernel rule that four rounds of readings had mis-attributed to the loader: cordis
 * decides at mount time whether a plugin callback is *constructible*
 * (vendor/cordis/src/fiber.ts:251), and a **function declaration** is. That branch builds the instance
 * with `new` and returns `instance?.[symbols.init]?.()` (:257) - so the plugin's own return value is
 * dropped and never reaches the fiber's disposables. A **method** (`{ apply(ctx) {} }`) and an
 * **arrow** are not constructible, take :259, and their return value is collected (:230-232) and run on
 * unload.
 *
 * What this gate reads, all measured against the shipped kernel checkout (read only):
 *   R1  method shape   -> the returned cleanup is in the fiber's disposables AND runs on dispose
 *   R2  arrow shape    -> same
 *   R3  declaration    -> the returned cleanup is NOT collected and never runs (the pit itself, frozen)
 *   R4  the loader's own mount verb (ctx.registry.plugin, the call vendor/loader/src/config/entry.ts:236
 *       makes) with both a method and a declaration: same verdicts as ctx.plugin, so what decides is the
 *       SHAPE and not the path - the reading R73 got wrong by measuring under a method
 *   R5  the three source lines this rests on are still there and still what they were
 *   R6  an effect-registered teardown runs in every shape (ours is registered this way, so our own
 *       plugin is on the safe side even though its apply is a function declaration)
 *
 * Exit 0 every reading held; 1 a reading failed; 3 an input is missing (no kernel checkout / no tsx).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NL = String.fromCharCode(10)
const HERE = fileURLToPath(import.meta.url)
// A mutant copy of this gate runs from .tmp, so the project and the kernel are named by the parent
// rather than derived from this file's own path: deriving them is how a mutant "could not be built"
// while looking like a failing anchor.
const PROJECT = resolve(process.env.R81_PROJECT ?? resolve(dirname(HERE), '..'))
const KERNEL = resolve(process.env.R81_KERNEL ?? process.env.DSH_LINK_KERNEL ?? join(PROJECT, 'core', 'deepseek-harness'))
const SCRATCH = join(PROJECT, '.tmp', 'r81-gate')
const FIBER = join(KERNEL, 'vendor', 'cordis', 'src', 'fiber.ts')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const JSON_OUT = argv.includes('--json')
const JUMP = /[\\]u005c/  // never matches: keeps template quoting honest without a literal backslash

/** One plugin shape, as source the driver imports and applies. */
const DRIVER = `
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const CORDIS = process.env.R81_CORDIS
const mod = await import(pathToFileURL(join(CORDIS, 'index.ts')).href)
const { Context } = mod
const markers = []
const write = (what) => markers.push(what)

const shapes = {
  method: (captured) => ({
    name: 'r81-method',
    apply(ctx) {
      ctx.effect(() => () => write('method-effect-disposed'))
      captured.cleanup = () => write('method-return-ran')
      return captured.cleanup
    },
  }),
  arrow: (captured) => ({
    name: 'r81-arrow',
    apply: (ctx) => {
      ctx.effect(() => () => write('arrow-effect-disposed'))
      captured.cleanup = () => write('arrow-return-ran')
      return captured.cleanup
    },
  }),
  declaration: (captured) => {
    function apply(ctx) {
      ctx.effect(() => () => write('declaration-effect-disposed'))
      captured.cleanup = () => write('declaration-return-ran')
      return captured.cleanup
    }
    return { name: 'r81-declaration', apply }
  },
}

const mount = async (verb, shape) => {
  const captured = {}
  const ctx = new Context()
  const plugin = shapes[shape](captured)
  const mounted = verb === 'registry' ? ctx.registry.plugin(plugin, undefined) : ctx.plugin(plugin)
  await mounted
  // One snapshot, taken once: the fiber keeps its disposables in a structure whose iteration must not
  // be run twice (reading the length from a second pass reported 0 while the identity check saw the
  // entry), and a reading whose two halves disagree about the same list is worse than no reading.
  const raw = mounted._disposables ?? null
  const snapshot = raw === null ? null : Array.from(raw)
  const collected = snapshot === null ? null : snapshot.some((entry) => entry === captured.cleanup)
  const ranBefore = markers.includes(shape + '-return-ran')
  await ctx.fiber.dispose()
  return {
    shape,
    verb,
    disposables: snapshot === null ? null : snapshot.length,
    collected,
    ranBeforeDispose: ranBefore,
    ranAfterDispose: markers.includes(shape + '-return-ran'),
    effectDisposed: markers.includes(shape + '-effect-disposed'),
  }
}

const out = []
for (const shape of ['method', 'arrow', 'declaration']) out.push(await mount('plugin', shape))
for (const shape of ['method', 'declaration']) out.push(await mount('registry', shape))
console.log(JSON.stringify({ readings: out, markers }))
`

/** Run the driver against one cordis source tree. */
const drive = (cordisBase) => {
  const file = join(SCRATCH, 'driver.mjs')
  writeFileSync(file, DRIVER, 'utf8')
  const run = spawnSync(process.execPath, ['--import', 'tsx/esm', file], {
    cwd: KERNEL,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, R81_CORDIS: cordisBase },
  })
  const text = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
  const last = text.split(/\r?\n/).filter((line) => line.startsWith('{')).pop()
  if (last === undefined) return { error: text.slice(-400) }
  try { return JSON.parse(last) } catch (error) { return { error: String(error?.message ?? error) } }
}

/** The three lines this gate rests on, as the kernel ships them today. */
const ANCHORS = [
  { id: 'constructible-branch', line: 251, fragment: 'if (isConstructor(runtime.callback)) {' },
  { id: 'new-branch-drops-return', line: 257, fragment: 'return instance?.[symbols.init]?.()' },
  { id: 'plain-branch-returns-it', line: 259, fragment: 'return runtime.callback(this.ctx, this.config)' },
  { id: 'collect-pushes', line: 231, fragment: 'this._disposables.push(dispose)' },
]

const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
const found = (rows, shape, verb) => rows?.readings?.find((row) => row.shape === shape && row.verb === verb) ?? null
const flat = (value) => JSON.stringify(value)

const DECLARED = 7
const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']

/** Run every reading against one cordis base. A mutant points this at a patched copy. */
const runReadings = (cordisBase) => {
  readings.length = 0
  const base = existsSync(join(cordisBase, 'index.ts')) ? cordisBase : null
  const rows = base === null ? null : drive(base)

  const shapeOf = (shape, verb) => (rows === null || rows.error !== undefined ? null : found(rows, shape, verb))
  const say = (row) => (row === null ? 'no reading (the driver did not report)' : flat(row))

  for (const [id, shape, wantCollected] of [['R1', 'method', true], ['R2', 'arrow', true], ['R3', 'declaration', false]]) {
    const row = shapeOf(shape, 'plugin')
    const ok = row !== null && row.collected === wantCollected && row.ranAfterDispose === wantCollected
    held(id, 'a ' + shape + ' apply ' + (wantCollected ? 'has its returned cleanup collected and run on dispose' : 'never has its returned cleanup collected, so it never runs (the pit R80 froze)'), ok, say(row))
  }

  const registry = shapeOf('method', 'registry')
  const registryDecl = shapeOf('declaration', 'registry')
  const pathIrrelevant = registry !== null && registryDecl !== null
    && registry.collected === true && registry.ranAfterDispose === true
    && registryDecl.collected === false && registryDecl.ranAfterDispose === false
  held('R4', "the loader's own mount verb decides the same way: a method is collected and run, a declaration is not, so the shape is what decides and not the path", pathIrrelevant, 'method=' + say(registry) + ' declaration=' + say(registryDecl))

  const source = existsSync(FIBER) ? readFileSync(FIBER, 'utf8').split(/\r?\n/) : []
  const missing = ANCHORS.filter((anchor) => (source[anchor.line - 1] ?? '').includes(anchor.fragment) === false).map((anchor) => anchor.id)
  held('R5', 'the three source lines this rests on are still there and still what they were', source.length > 0 && missing.length === 0, 'anchors=' + String(ANCHORS.length) + ' missing=' + flat(missing))

  const effectShapes = ['method', 'arrow', 'declaration'].map((shape) => shapeOf(shape, 'plugin'))
  const effectsRan = effectShapes.every((row) => row !== null && row.effectDisposed === true)
  held('R6', 'an effect-registered teardown runs in every shape - which is why our own plugin, whose apply is a declaration, is on the safe side', effectsRan, flat(effectShapes.map((row) => row !== null && row.effectDisposed)))

  held('RD', 'the declared reading count matches the readings this run produced', readings.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(readings.length + 1))
  return readings
}

const MUTANTS = [
  { name: 'constructible-branch-inverted', target: 'kernel', from: 'if (isConstructor(runtime.callback)) {', to: 'if (false) {', declared: ['R3', 'R4'] },
  { name: 'new-branch-keeps-the-return', target: 'kernel', from: 'return instance?.[symbols.init]?.()', to: 'return instance?.[symbols.init]?.() ?? runtime.callback(this.ctx, this.config)', declared: ['R3', 'R4'] },
  { name: 'collect-dropped', target: 'kernel', from: 'this._disposables.push(dispose)', to: 'void dispose', declared: ['R1', 'R2', 'R4'] },
  { name: 'declaration-expected-to-be-collected', target: 'gate', from: "['R3', 'declaration', false]", to: "['R3', 'declaration', true]", declared: ['R3'] },
  { name: 'anchor-line-moved', target: 'gate', from: "line: 257, fragment: 'return instance?.[symbols.init]?.()'", to: "line: 258, fragment: 'return instance?.[symbols.init]?.()'", declared: ['R5'] },
  { name: 'registry-verb-swapped', target: 'gate', from: "for (const shape of ['method', 'declaration']) out.push(await mount('registry', shape))", to: "for (const shape of ['method', 'declaration']) out.push(await mount('plugin', shape))", declared: ['R4'] },
  { name: 'effect-teardown-expected-to-be-missing', target: 'gate', from: 'const effectsRan = effectShapes.every((row) => row !== null && row.effectDisposed === true)', to: 'const effectsRan = effectShapes.every((row) => row !== null && row.effectDisposed === false)', declared: ['R6'] },
]

const selfTest = () => {
  const missing = ANCHORS.filter((anchor) => (readFileSync(FIBER, 'utf8').split(/\r?\n/)[anchor.line - 1] ?? '').includes(anchor.fragment) === false)
  console.log('anchor check: ' + (missing.length === 0 ? 'all present' : 'missing ' + flat(missing.map((a) => a.id))))
  console.log('run with --self-attack to measure the mutants')
}

const selfAttack = () => {
  mkdirSync(SCRATCH, { recursive: true })
  const baseline = runReadings(option('--cordis', join(KERNEL, 'vendor', 'cordis', 'src')))
  const baselineFailed = baseline.filter((row) => row.ok !== true).map((row) => row.id)
  if (baselineFailed.length > 0) {
    console.log('self-attack refused: the baseline is not green (' + flat(baselineFailed) + ')')
    console.log('no mutant can be trusted while the shipped world fails')
    return 1
  }
  const covered = new Set()
  let mismatches = 0
  let missingAnchors = 0
  for (const mutant of MUTANTS) {
    let base = option('--cordis', join(KERNEL, 'vendor', 'cordis', 'src'))
    let cleanup = () => {}
    if (mutant.target === 'kernel') {
      const dir = join(SCRATCH, 'mutant-' + mutant.name)
      rmSync(dir, { recursive: true, force: true })
      cpSync(join(KERNEL, 'vendor', 'cordis', 'src'), join(dir, 'src'), { recursive: true })
      const file = join(dir, 'src', 'fiber.ts')
      const text = readFileSync(file, 'utf8')
      if (text.includes(mutant.from) === false) { console.log('  FAIL  ' + mutant.name + ' (anchor absent)'); missingAnchors += 1; continue }
      writeFileSync(file, text.replace(mutant.from, mutant.to), 'utf8')
      base = join(dir, 'src')
      cleanup = () => rmSync(dir, { recursive: true, force: true })
    }
    try {
      const rows = mutant.target === 'kernel'
        ? runReadings(base)
        : (() => {
            const file = join(SCRATCH, 'mutant-gate-' + mutant.name + '.mjs')
            const text = readFileSync(HERE, 'utf8')
            if (text.includes(mutant.from) === false) return null
            writeFileSync(file, text.replace(mutant.from, mutant.to), 'utf8')
            const run = spawnSync(process.execPath, [file, '--json'], { cwd: PROJECT, encoding: 'utf8', timeout: 240000, env: { ...process.env, R81_PROJECT: PROJECT, R81_KERNEL: KERNEL } })
            const line = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/).filter((one) => one.startsWith('[')).pop()
            return line === undefined ? null : JSON.parse(line)
          })()
      if (rows === null) { console.log('  FAIL  ' + mutant.name + ' (the mutant could not be built)'); missingAnchors += 1; continue }
      const flipped = rows.filter((row) => row.ok !== true).map((row) => row.id).sort()
      for (const id of flipped) covered.add(id)
      const declared = [...mutant.declared].sort()
      const same = flipped.length === declared.length && flipped.every((id, index) => id === declared[index])
      if (same === false) mismatches += 1
      console.log((same ? '  ok    ' : '  FAIL  ') + mutant.name + '  flipped=' + flat(flipped) + ' declared=' + flat(declared) + (same ? '' : '  MISMATCH'))
    } finally { cleanup() }
  }
  const uncovered = MODULE_READING_IDS.filter((id) => covered.has(id) === false)
  console.log('')
  console.log('coverage: ' + String(MODULE_READING_IDS.length) + ' declared readings, ' + String(covered.size) + ' moved by at least one mutant, uncovered ' + flat(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(missingAnchors))
  return mismatches === 0 && uncovered.length === 0 && missingAnchors === 0 ? 0 : 1
}

if (existsSync(join(KERNEL, 'vendor', 'cordis', 'src', 'index.ts')) === false) {
  console.error('the kernel checkout is not here: ' + KERNEL)
  process.exit(3)
}
if (argv.includes('--self-test')) { selfTest(); process.exit(0) }
if (argv.includes('--self-attack')) { process.exit(selfAttack()) }
if (JSON_OUT) { console.log(JSON.stringify(runReadings(option('--cordis', join(KERNEL, 'vendor', 'cordis', 'src'))))) }
else {
  const rows = runReadings(option('--cordis', join(KERNEL, 'vendor', 'cordis', 'src')))
  for (const row of rows) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.id + '  ' + row.name + '  |  ' + row.detail)
  const failed = rows.filter((row) => row.ok !== true).length
  console.log('')
  console.log(String(rows.length - failed) + ' of ' + String(rows.length) + ' readings held')
  process.exit(failed === 0 ? 0 : 1)
}
