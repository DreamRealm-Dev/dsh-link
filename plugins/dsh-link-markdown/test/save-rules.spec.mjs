#!/usr/bin/env node
/**
 * R354: the editor RULES, without a browser.
 *
 * The pane JSX is not driven here (there is no DOM harness in this package); what is pinned is the decision layer the
 * component uses: when an edit may be offered, what counts as dirty, and what a save attempt means - including the case
 * the pane must never confuse with success (a STALE refusal leaves the draft on screen and writes nothing).
 */
import { canEdit, isDirty, saveDocument, SAVE_PATH } from '../src/client/save.ts'

const results = []
const check = (name, ok, detail) => { results.push({ name, ok: ok === true }); console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail) }
const show = (value) => JSON.stringify(value)

check('1 a document with a path and no failure may be edited', canEdit({ failure: null, absolutePath: 'C:/w/a.md' }) === true, show({ failure: null }))
check('2 a document that failed to read may not be edited (paired with 1)', canEdit({ failure: { code: 'X' }, absolutePath: 'C:/w/a.md' }) === false, 'failure is not null')
check('3 a document with no absolute path may not be edited: the save route would have nowhere to write', canEdit({ failure: null, absolutePath: '' }) === false && canEdit({ failure: null }) === false, 'no path')
check('4 an untouched draft is not dirty', isDirty('# a', '# a') === false, 'same text')
check('5 a changed draft is dirty (paired with 4)', isDirty('# a', '# b') === true, 'one character')
check('6 the save route path is the one the host half binds', SAVE_PATH === '/api/dsh-link-markdown/write', show(SAVE_PATH))

const seen = []
const fake = (status, body) => async (path, payload) => { seen.push({ path, payload }); return { status, body } }

const saved = await saveDocument({ absolutePath: 'C:/w/a.md', version: '10-5' }, '# new', fake(200, { ok: true, version: '11-6', bytes: 6 }))
check('7 a 200 with ok:true is reported as saved, with the new version', saved.kind === 'saved' && saved.version === '11-6' && saved.bytes === 6, show(saved))
check('8 the request carried the path, the text and the version the document was read at', seen.length === 1 && seen[0].path === SAVE_PATH && seen[0].payload.path === 'C:/w/a.md' && seen[0].payload.text === '# new' && seen[0].payload.expectedVersion === '10-5', show(seen[0]))

const stale = await saveDocument({ absolutePath: 'C:/w/a.md', version: '10-5' }, '# mine', fake(409, { ok: false, code: 'STALE', version: '12-7' }))
check('9 a 409 is its own outcome (STALE), never "saved", and it carries the version that won', stale.kind === 'stale' && stale.version === '12-7', show(stale))

const refused = await saveDocument({ absolutePath: 'C:/w/a.md', version: '10-5' }, 'x', fake(400, { ok: false, code: 'BAD_PATH' }))
check('10 any other refusal keeps the code the server named', refused.kind === 'refused' && refused.code === 'BAD_PATH', show(refused))

const noPath = await saveDocument({ version: '10-5' }, 'x', fake(200, { ok: true }))
check('11 a document with no path is refused BEFORE any request is made', noPath.kind === 'refused' && noPath.code === 'NO_PATH' && seen.length === 3, 'requests=' + String(seen.length))

const failed = results.filter((row) => row.ok !== true)
console.log(String(results.length - failed.length) + '/' + String(results.length) + ' reading(s) held')
process.exit(failed.length === 0 ? 0 : 1)
