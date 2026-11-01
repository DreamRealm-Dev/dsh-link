/**
 * The toolbar menu's rows, driven directly: the shipped pure function with a stand-in attribute
 * source.
 *
 * Needs no page and no DSH: the module under test imports nothing.
 *   node plugins/dsh-link-toolbar/test/toolbar-items.spec.mjs
 */
import { toolbarItems, MARKER_ATTRIBUTES } from '../src/client/toolbar-items.ts'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: ok === true })
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const show = (value) => JSON.stringify(value)
const source = (values) => ({ getAttribute: (name) => Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null })

const mounted = toolbarItems(source({ 'data-dsh-link-layout': 'narrow', 'data-dsh-link-notes': '3', 'data-dsh-browser': '' }))
check('1 a marker with a value is enabled and reports it', mounted[0].enabled === true && mounted[0].value === 'narrow' && mounted[0].reason === null, show(mounted[0]))
check('2 a missing marker is not-mounted', mounted[1].enabled === true && toolbarItems(source({}))[1].enabled === false && toolbarItems(source({}))[1].reason === 'not-mounted', show(toolbarItems(source({}))[1]))
check('3 an empty marker is empty-value, not not-mounted', mounted[3].enabled === false && mounted[3].reason === 'empty-value' && mounted[3].value === null, show(mounted[3]))
check('4 every row carries a dictionary key and no sentence', mounted.every((item) => /^item\.[a-z]+$/.test(item.labelKey)), show(mounted.map((item) => item.labelKey)))
check('5 the order is the table, whatever the values are', show(toolbarItems(source({})).map((item) => item.id)) === show(['layout', 'notes', 'glass', 'browser']) && show(toolbarItems(source({ 'data-dsh-link-glass': 'on' })).map((item) => item.id)) === show(['layout', 'notes', 'glass', 'browser']), show(toolbarItems(source({ 'data-dsh-link-glass': 'on' })).map((item) => [item.id, item.enabled])))
check('6 the same source answers the same rows twice', show(toolbarItems(source({ 'data-dsh-link-layout': 'wide' }))) === show(toolbarItems(source({ 'data-dsh-link-layout': 'wide' }))), show(MARKER_ATTRIBUTES))
const bad = results.filter((row) => !row.ok)
console.log('')
console.log(String(results.length) + ' checks, ' + String(results.length - bad.length) + ' held, ' + String(bad.length) + ' failed')
process.exit(bad.length === 0 ? 0 : 1)
