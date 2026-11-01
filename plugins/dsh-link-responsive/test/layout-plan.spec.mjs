/**
 * The responsive layout decision, driven directly: the shipped table, the shipped planner and the
 * shipped applier, with only a stand-in target.
 *
 * Needs no page and no DSH: the two modules under test import nothing.
 *   node plugins/dsh-link-responsive/test/layout-plan.spec.mjs
 *
 * What is measured is what the layout is worth anything for: the inclusive bounds on both sides of
 * both edges, table order deciding an overlap, a table with no catch-all refusing instead of guessing,
 * a bad table refused by name, a bad width thrown at the caller, and an apply that is idempotent and
 * that removes the keys its predecessor wrote.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBands, planLayout } from '../src/client/layout-plan.ts'
import { applyLayout } from '../src/client/apply-layout.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: ok === true })
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const show = (value) => JSON.stringify(value)

/** A stand-in for the document root: attributes and custom properties, both recorded. */
const createTarget = () => {
  const attributes = new Map()
  const properties = new Map()
  const writes = []
  return {
    attributes,
    properties,
    writes,
    setAttribute: (name, value) => { attributes.set(name, value); writes.push(['attr', name, value]) },
    style: {
      setProperty: (name, value) => { properties.set(name, value); writes.push(['prop', name, value]) },
      removeProperty: (name) => { properties.delete(name); writes.push(['remove', name, null]) },
    },
  }
}

const shipped = JSON.parse(readFileSync(join(HERE, '..', 'bands.json'), 'utf8'))
const loaded = loadBands(shipped)
const bands = loaded.bands
const at = (width) => { const planned = planLayout(width, bands); return planned.ok && planned.plan !== null ? planned.plan.band : planned.reason }

check('1 the shipped band table loads', loaded.ok === true && bands !== null && bands.bands.length === 3, show({ ok: loaded.ok, reason: loaded.reason, bands: bands === null ? null : bands.bands.map((band) => band.name) }))
check('2 the maximum edge is inclusive on both sides', at(720) === 'narrow' && at(721) !== 'narrow' && at(1080) === 'wide' && at(1079) !== 'wide', show({ at720: at(720), at721: at(721), at1080: at(1080), at1079: at(1079) }))
check('3 the catch-all answers what no band covers', at(800) === 'default' && at(720) === 'narrow' && at(2000) === 'wide', show({ at800: at(800), at720: at(720), at2000: at(2000) }))

const overlap = loadBands({ format: 'dsh-link.responsive-bands/1', bands: [
  { name: 'first', maxWidth: 1000, decisions: { sidebar: 'drawer' } },
  { name: 'second', minWidth: 500, decisions: { sidebar: 'docked' } },
  { name: 'rest', catchAll: true, decisions: { sidebar: 'docked' } },
] }).bands
const overlapPlan = planLayout(700, overlap)
check('4 an overlap is decided by table order', overlapPlan.ok === true && overlapPlan.plan !== null && overlapPlan.plan.band === 'first' && overlapPlan.plan.matchedBy === 'maxWidth', show({ band: overlapPlan.plan === null ? null : overlapPlan.plan.band, matchedBy: overlapPlan.plan === null ? null : overlapPlan.plan.matchedBy }))

const noCatchAll = loadBands({ format: 'dsh-link.responsive-bands/1', bands: [
  { name: 'narrow', maxWidth: 720, decisions: { sidebar: 'drawer' } },
  { name: 'wide', minWidth: 1080, decisions: { sidebar: 'docked' } },
] })
const orphan = noCatchAll.bands === null ? null : planLayout(900, noCatchAll.bands)
check('5 a width no band covers is refused, not guessed', noCatchAll.ok === true && orphan !== null && orphan.ok === false && orphan.reason === 'no-band' && orphan.plan === null, show({ loaded: noCatchAll.ok, reason: orphan === null ? null : orphan.reason, plan: orphan === null ? null : orphan.plan }))

const duplicate = loadBands({ format: 'dsh-link.responsive-bands/1', bands: [{ name: 'a', catchAll: true, decisions: {} }, { name: 'a', maxWidth: 10, decisions: {} }] })
const noDecisions = loadBands({ format: 'dsh-link.responsive-bands/1', bands: [{ name: 'a', catchAll: true, decisions: 7 }] })
const wrongFormat = loadBands({ format: 'something/else', bands: [] })
check('6 an unreadable table is refused by name', duplicate.reason === 'bad-bands' && noDecisions.reason === 'bad-bands' && wrongFormat.reason === 'bad-bands' && duplicate.detail !== null && /twice/.test(duplicate.detail), show({ duplicate: duplicate.detail, noDecisions: noDecisions.detail, wrongFormat: wrongFormat.detail }))

const thrown = []
for (const width of [Number.NaN, -1, Number.POSITIVE_INFINITY, '800']) {
  try { planLayout(width, bands); thrown.push('no throw for ' + show(width)) } catch (error) { thrown.push(error instanceof TypeError ? 'TypeError' : 'other') }
}
check('7 an impossible width throws rather than refusing a band', show(thrown) === show(['TypeError', 'TypeError', 'TypeError', 'TypeError']), show(thrown))

const target = createTarget()
const narrow = planLayout(720, bands).plan
const wide = planLayout(1400, bands).plan
const first = applyLayout(target, wide, null)
const second = applyLayout(target, wide, wide)
check('8 applying the same plan twice writes nothing the second time', first.wrote.length > 0 && second.wrote.length === 0 && second.removed.length === 0, show({ first: first.wrote, second: { wrote: second.wrote, removed: second.removed } }))

// The shipped table decides the same three keys in every band, so the removal has to be measured on
// a table whose bands differ: a key that only the wide band writes must be gone on the way back.
const asymmetric = loadBands({ format: 'dsh-link.responsive-bands/1', bands: [
  { name: 'wide', minWidth: 1000, decisions: { sidebar: 'docked', rail: 'shown', gap: 12 } },
  { name: 'narrow', maxWidth: 720, decisions: { sidebar: 'drawer', gap: 4 } },
  { name: 'rest', catchAll: true, decisions: { sidebar: 'docked' } },
] }).bands
const backTarget = createTarget()
const widePlan = planLayout(1400, asymmetric).plan
const narrowPlan = planLayout(700, asymmetric).plan
const fromNull = applyLayout(backTarget, widePlan, null)
const back = applyLayout(backTarget, narrowPlan, widePlan)
check('9 going back removes the keys the previous band decided', show(back.removed) === show(['rail']) && !backTarget.properties.has('--dsh-link-rail') && fromNull.wrote.includes('--dsh-link-rail') && backTarget.properties.get('--dsh-link-gap') === '4', show({ written: fromNull.wrote, removed: back.removed, properties: [...backTarget.properties.entries()].sort() }))

const matched = [planLayout(720, bands).plan.matchedBy, planLayout(1400, bands).plan.matchedBy, planLayout(800, bands).plan.matchedBy]
check('10 matchedBy names the rule that decided', show(matched) === show(['maxWidth', 'minWidth', 'catchAll']), show(matched))

const bad = results.filter((row) => !row.ok)
console.log('')
console.log(String(results.length) + ' checks, ' + String(results.length - bad.length) + ' held, ' + String(bad.length) + ' failed')
process.exit(bad.length === 0 ? 0 : 1)
