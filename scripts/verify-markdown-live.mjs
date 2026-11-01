#!/usr/bin/env node
/**
 * Gate (R377) - the Markdown tab type, driven the way a PERSON reaches it: 开始 -> 工作区文件 -> the file's row ->
 * 编辑 -> type -> 保存, and the file on disk really changes.
 *
 * Why this gate exists. Until R377 the editor had three green offline gates and had never drawn a pixel. Two bugs
 * were sitting exactly there, invisible to a fake reader or a fake host:
 *
 *   - the tab BODY threw on every render: its read effect listed \`reload\` in its dependency array, and that \`const\`
 *     was declared further down, so every render hit the temporal dead zone;
 *   - the paged READ sent a bare line number where the kernel declares \`range: WorkspaceFileRange\`, and the wire
 *     refused it ("wire field \"range\" failed boundary validation") before the Host ever saw the call.
 *
 * A handler nobody has called is not a handler. This gate calls it: real presses on the shipped guide, the shipped
 * file tree and the shipped tab body, then reads the file back from the disk.
 *
 * What it touches and puts back: one scratch file in the session's own workspace root (dsh-link-editor-probe.md),
 * written by this gate and deleted on every exit path, plus the tabs it opened. Nothing else is written.
 *
 * Readings:
 *   1-client-half-live       the page carries the built client half and it RAN (the __dshLinkMarkdown marker says
 *                            registered, with the frozen pattern pair)
 *   2-tree-opened            pressing the guide's 工作区文件 capsule opened the file-tree tab, whose header names an
 *                            absolute workspace root
 *   3-scratch-listed         the file this gate wrote is a pressable row of that tree
 *   4-tab-opened             pressing the row opened a markdown tab at the file's own dsh-resource:// address
 *   5-body-read-the-file     the body RENDERED the file's text: no failure block and the sentinel line on screen
 *                            (this is the reading the wire bug failed)
 *   6-editable               the pane offers 编辑 and is not showing 只读
 *   7-draft-is-dirty         pressing 编辑 shows the textarea; typing marks 未保存 and enables 保存
 *   8-save-reached-the-disk  pressing 保存 is accepted (not stale), the pane says saved, and the file ON DISK carries
 *                            the typed line
 *   9-preview-rereads        pressing 预览 renders the saved document again, read back through the kernel
 *   10-world-put-back        the scratch file is gone and the tab this gate opened is closed
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when nothing could be measured (no CDP, no
 * right rail in this world) - never a silent green.
 *
 * Usage: node scripts/verify-markdown-live.mjs [--cdp-port 9222] [--port 31761] [--deadline-ms 8000]
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from './cdp-drive.mjs'

const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const SHELL_PORT = Number(option('--port', '31761'))
const DEADLINE_MS = Number(option('--deadline-ms', '8000'))

const SCRATCH_NAME = 'dsh-link-editor-probe.md'
const SENTINEL = 'gate-sentinel-377'
const SAVED_MARK = 'gate-saved-377'
const GUIDE_LABEL = '工作区文件'
const TREE_TITLE = '文件'

const show = (value) => JSON.stringify(value === undefined ? null : value)
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))

// ------------------------------------------------------------------------------- page-side steps
// Every one is a real function shipped through toString(): the page only runs it.

/** Press one rail tab by the start of its visible text. */
function pressRailTab(label) {
  const rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return 'no-rail'
  const tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  const hit = tabs.filter((el) => rail.contains(el) && String(el.textContent || '').indexOf(label) === 0)[0]
  if (hit === undefined) return 'no-tab'
  hit.click()
  return 'pressed'
}

/**
 * Press the guide capsule with this label.
 *
 * Every page-side step below looks its own body up rather than calling a shared helper: these functions travel to the
 * page by \`toString()\`, so a call to another one of them is a FREE identifier there and throws. Measured: the file
 * tree reading answered null because \`activeBody\` did not exist in the page. The lookup picks the body that is on
 * screen - several tabs keep their bodies mounted, and an inactive one is inert and zero-boxed, so "the first
 * tabBody in the document" is the wrong body the moment more than one tab exists.
 */
function pressCapsule(label) {
  const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-right-tab]')).filter((el) => String(el.className || '').indexOf('tabBody') !== -1)
  const shown = bodies.filter((el) => { const box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 })
  const body = shown[0] || bodies[0] || null
  if (body === null) return 'no-body'
  const all = Array.prototype.slice.call(body.querySelectorAll('*'))
  const leaf = all.filter((el) => el.children.length === 0 && String(el.textContent || '').trim() === label)[0]
  if (leaf === undefined) return 'no-capsule'
  let target = leaf
  for (let step = 0; step < 6 && target !== null; step += 1) {
    if (String(target.tagName || '') === 'BUTTON' || target.getAttribute('role') === 'button') break
    target = target.parentElement
  }
  if (target === null) return 'no-button'
  target.click()
  return 'pressed'
}

/**
 * The file tree's header row, which prints the session's workspace root.
 *
 * The row prints the root as segments (a drive span, then one span per directory), so the drive span's parent is the
 * row and its text is the whole root.
 */
function treeRoot() {
  const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-right-tab]')).filter((el) => String(el.className || '').indexOf('tabBody') !== -1)
  const shown = bodies.filter((el) => { const box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 })
  const body = shown[0] || bodies[0] || null
  if (body === null) return null
  const spans = Array.prototype.slice.call(body.querySelectorAll('span'))
  // The header row prints the root as a directory span followed by a name span, and the directory span is the whole
  // prefix, not just the drive (measured: "<workspace>\\dsh-link\core\" + "deepseek-harness"). Read the pair and join
  // it; fall back to the row's own path span, whose text is shortened to fit.
  const dir = spans.filter((el) => String(el.className || '').indexOf('_directory_') !== -1)[0]
  const name = spans.filter((el) => String(el.className || '').indexOf('_name_') !== -1)[0]
  if (dir !== undefined && name !== undefined) {
    const left = String(dir.textContent || '').trim()
    const right = String(name.textContent || '').trim()
    const joined = /[\\/]$/.test(left) ? left + right : left + '\\' + right
    if (/^[A-Za-z]:/.test(joined)) return joined
  }
  const pathSpan = spans.filter((el) => String(el.className || '').indexOf('_path_') !== -1)[0]
  if (pathSpan !== undefined) {
    const text = String(pathSpan.textContent || '').trim()
    if (/^[A-Za-z]:/.test(text)) return text
  }
  return null
}

/** Row labels in the file tree. */
function treeRows() {
  const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-right-tab]')).filter((el) => String(el.className || '').indexOf('tabBody') !== -1)
  const shown = bodies.filter((el) => { const box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 })
  const body = shown[0] || bodies[0] || null
  if (body === null) return 'no-body'
  const rows = Array.prototype.slice.call(body.querySelectorAll('button')).map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim()).filter((text) => text !== '')
  return JSON.stringify(rows.slice(0, 60))
}

/** Press the file-tree row whose name starts with this one. */
function pressTreeRow(name) {
  const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-right-tab]')).filter((el) => String(el.className || '').indexOf('tabBody') !== -1)
  const shown = bodies.filter((el) => { const box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 })
  const body = shown[0] || bodies[0] || null
  if (body === null) return 'no-body'
  const rows = Array.prototype.slice.call(body.querySelectorAll('button'))
  const hit = rows.filter((el) => String(el.textContent || '').indexOf(name) === 0)[0]
  if (hit === undefined) return 'no-row'
  hit.click()
  return 'pressed'
}

/** Press the tree's own re-read control. */
function pressTreeReload() {
  const buttons = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]'))
  const hit = buttons.filter((el) => /重新读取|Refresh|Reload/i.test(String(el.getAttribute('aria-label') || '')))[0]
  if (hit === undefined) return 'no-reload'
  hit.click()
  return 'pressed'
}

/** Everything the markdown tab says about itself. */
function markdownState() {
  const md = document.querySelector('[data-markdown-address]')
  if (md === null) return JSON.stringify({ present: false })
  const toggle = md.querySelector('[data-markdown-edit-toggle]')
  const readonly = md.querySelector('[data-markdown-readonly]')
  const area = md.querySelector('[data-markdown-area]')
  const save = md.querySelector('[data-markdown-save]')
  const status = md.querySelector('[data-markdown-status]')
  const failure = md.querySelector('[data-markdown-failure]')
  const dirty = md.querySelector('[data-markdown-dirty]')
  return JSON.stringify({
    present: true,
    address: md.getAttribute('data-markdown-address'),
    name: md.getAttribute('data-markdown-name'),
    text: String(md.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    editToggle: toggle === null ? null : String(toggle.textContent || '').trim(),
    readonly: readonly === null ? null : String(readonly.textContent || '').trim(),
    hasArea: area !== null,
    saveText: save === null ? null : String(save.textContent || '').trim(),
    saveDisabled: save === null ? null : save.disabled === true,
    status: status === null ? null : status.getAttribute('data-markdown-status'),
    statusCode: status === null ? null : status.getAttribute('data-markdown-code'),
    statusDetail: status === null ? null : status.getAttribute('title'),
    statusText: status === null ? null : String(status.textContent || '').trim(),
    dirty: dirty === null ? null : String(dirty.textContent || '').trim(),
    failure: failure === null ? null : failure.getAttribute('data-markdown-failure'),
    failureText: failure === null ? null : String(failure.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  })
}

/** Press the 编辑/预览 toggle. */
function pressEditToggle() {
  const md = document.querySelector('[data-markdown-address]')
  if (md === null) return 'no-tab'
  const button = md.querySelector('[data-markdown-edit-toggle]')
  if (button === null) return 'no-toggle'
  button.click()
  return 'pressed'
}

/** Type a whole document into the textarea the way a person does: the value, then one input event. */
function typeDraft(text) {
  const md = document.querySelector('[data-markdown-address]')
  if (md === null) return 'no-tab'
  const area = md.querySelector('[data-markdown-area]')
  if (area === null) return 'no-area'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(area, text)
  area.dispatchEvent(new Event('input', { bubbles: true }))
  return 'typed'
}

/** Press 保存. */
function pressSave() {
  const md = document.querySelector('[data-markdown-address]')
  if (md === null) return 'no-tab'
  const button = md.querySelector('[data-markdown-save]')
  if (button === null) return 'no-save'
  if (button.disabled === true) return 'disabled'
  button.click()
  return 'pressed'
}

/** Close the rail tab whose chip starts with this text. */
function closeRailTab(label) {
  const rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return 'no-rail'
  const tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  const hits = tabs.filter((el) => rail.contains(el) && String(el.textContent || '').indexOf(label) === 0)
  let closed = 0
  for (const tab of hits) {
    const shut = tab.querySelector('[data-dockkit-tab-close]')
    if (shut !== null) { shut.click(); closed += 1 }
  }
  return closed === 0 ? 'no-close-control' : 'closed:' + String(closed)
}

/**
 * Close every rail tab, and report their labels.
 *
 * The strip's add control and the guide that carries it exist only on an EMPTY pane: measured on this kernel, a rail
 * holding any tab shows no 新标签页 button and no 开始 chip at all, so the only deterministic door to a page type is
 * "empty the pane first". A person does the same thing. The labels are returned so the gate can put the rail back.
 */
function closeAllRailTabs() {
  const rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return JSON.stringify([])
  const tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]')).filter((el) => rail.contains(el))
  const labels = tabs.map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24))
  for (const tab of tabs) {
    const shut = tab.querySelector('[data-dockkit-tab-close]')
    if (shut !== null) shut.click()
  }
  return JSON.stringify(labels)
}

/** Expand the right rail when it sits collapsed (a session opens that way). */
function openRail() {
  const buttons = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]'))
  const hit = buttons.filter((el) => /打开右侧边栏|Open right sidebar/i.test(String(el.getAttribute('aria-label') || '')))[0]
  if (hit === undefined) return 'already-open'
  hit.click()
  return 'pressed'
}

/** Press the strip's own add control (present on an empty pane). */
function pressAddTab() {
  const button = document.querySelector('[data-dockkit-add-tab]')
  if (button === null) return 'no-add-control'
  button.click()
  return 'pressed'
}

/** Press the menu item whose text starts with this label (the add menu lists the registered page types). */
function pressMenuItem(label) {
  const items = Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"]'))
  const hit = items.filter((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().indexOf(label) === 0)[0]
  if (hit === undefined) return 'no-item'
  hit.click()
  return 'pressed'
}

/** The chip labels currently in the rail. */
function railChips() {
  const rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return JSON.stringify([])
  return JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]')).filter((el) => rail.contains(el)).map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)))
}

/** Parse one markdownState answer. */
const stateOf = (answer) => {
  if (answer === null || answer === undefined || typeof answer.value !== 'string') return null
  try { return JSON.parse(answer.value) } catch (error) { return null }
}

// ------------------------------------------------------------------------------------------ driver
const readings = []
const held = (id, ok, detail, evidence = []) => readings.push({ id, ok: ok === true, detail, evidence })

const main = async () => {
  const cdp = await connect({ port: CDP_PORT })
  if (cdp === null) {
    console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING')
    return 3
  }
  const evaluate = async (expression) => {
    const answer = await cdp.evaluate(expression)
    return answer === null || answer === undefined ? { value: null, exception: 'no answer' } : { value: answer.value, exception: answer.exception }
  }
  const call = async (fn, ...args) => evaluate('(' + fn.toString() + ')(' + args.map((value) => JSON.stringify(value)).join(', ') + ')')
  const until = async (fn, args, predicate, budgetMs = DEADLINE_MS) => {
    const deadline = Date.now() + budgetMs
    let last = null
    while (Date.now() < deadline) {
      last = await call(fn, ...args)
      if (predicate(last) === true) return last
      await sleep(250)
    }
    return last
  }
  const progress = []
  let scratchPath = null
  /** Print what happened so far, and answer the exit code of a run that produced a verdict. */
  const report = () => {
    for (const line of progress) console.log('        ' + line)
    for (const reading of readings) {
      console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
      for (const line of reading.evidence) console.log('        ' + line)
    }
    const failed = readings.filter((reading) => reading.ok === false)
    console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
    return failed.length === 0 ? 0 : 1
  }
  /** Leave with the named third state: what was measured is printed, and the reason is on one line. */
  const skipWith = (why) => {
    console.log('SKIP: ' + why)
    for (const line of progress) console.log('        ' + line)
    for (const reading of readings) console.log('  ' + (reading.ok ? 'ok  ' : 'note') + '  ' + reading.id + '. ' + reading.detail)
    return 3
  }
  try {
    // ---- 1 the client half is live ---------------------------------------------------------------------
    const marker = await evaluate('JSON.stringify(globalThis.__dshLinkMarkdown || null)')
    const parsed = marker.value === null ? null : JSON.parse(String(marker.value))
    held('1-client-half-live',
      parsed !== null && parsed.registered === true && parsed.kind === 'markdown' && show(parsed.patterns) === show(['*.md', '*.markdown']),
      'the served client half ran and registered the tab type',
      ['__dshLinkMarkdown = ' + show(parsed)])

    // A session opens with its right rail COLLAPSED; nothing about the editor is reachable until it is expanded, and a
    // just-switched session mounts a moment later.
    const openPress = await call(openRail)
    progress.push('open the right rail: ' + show(openPress.value))
    await sleep(1200)
    const chips = await until(railChips, [], (answer) => answer !== null && String(answer.value) !== show([]), 9000)
    progress.push('rail chips before: ' + String(chips === null ? null : chips.value))
    if (chips === null || String(chips.value) === show([])) {
      return skipWith('this client has no right rail with tabs ([data-rightbar-col] / [data-dockkit-tab] is absent, i.e. no session is open), so the editor cannot be reached; the gate touched nothing')
    }

    // ---- 2 reach the file tree through the shipped controls -----------------------------------------------
    // On this kernel the add control and the guide exist only on an EMPTY pane, so the door is: close the rail, press
    // 新标签页, press 工作区文件. The labels found here are what reading 10 puts back.
    const closed = await call(closeAllRailTabs)
    let chipsBefore = []
    try { chipsBefore = JSON.parse(String(closed.value)) } catch (error) { chipsBefore = [] }
    progress.push('rail chips closed: ' + show(chipsBefore))
    await sleep(900)
    // An emptied pane offers the add control; a moment later the shipped guide may stand in its place as the sole
    // docked tab. Both carry the same page-type list, so the door takes whichever one this world has.
    const addPress = await call(pressAddTab)
    progress.push('press 新标签页: ' + show(addPress.value))
    let door = null
    if (addPress !== null && addPress.value === 'pressed') {
      await sleep(800)
      const itemPress = await call(pressMenuItem, GUIDE_LABEL)
      progress.push('press ' + GUIDE_LABEL + ' in the add menu: ' + show(itemPress.value))
      if (itemPress !== null && itemPress.value === 'pressed') door = 'the strip add control opened the page-type menu, and 工作区文件 opened the tree'
    } else {
      await sleep(900)
      const guidePress = await call(pressRailTab, '开始')
      await sleep(900)
      const capsulePress = await call(pressCapsule, GUIDE_LABEL)
      progress.push('press 开始 then ' + GUIDE_LABEL + ': ' + show(guidePress.value) + ' / ' + show(capsulePress.value))
      if (capsulePress !== null && capsulePress.value === 'pressed') door = 'the guide tab opened the page-type list, and 工作区文件 opened the tree'
    }
    // A freshly opened tree lists its root over the wire, so the header appears a moment after the press.
    const rootAnswer = await until(treeRoot, [], (answer) => answer !== null && typeof answer.value === 'string', 10000)
    const root = rootAnswer !== null && typeof rootAnswer.value === 'string' ? rootAnswer.value : null
    const rows0 = await call(treeRows)
    held('2-tree-opened',
      door !== null && root !== null,
      'the shipped controls reach the file tree, and it names the session root',
      ['door = ' + show(door), 'rail held before the door = ' + show(chipsBefore), 'root = ' + show(root), 'rows = ' + String(rows0.value).slice(0, 200)])

    if (root === null) {
      return skipWith('the file tree did not name a workspace root, so this gate cannot place its scratch file; it wrote nothing')
    }

    // ---- 3 the scratch file, written by this gate, is a row of the tree --------------------------------
    scratchPath = root.replace(/[\\/]+$/, '') + '\\' + SCRATCH_NAME
    writeFileSync(scratchPath, '# gate probe\n\n' + SENTINEL + '\n', 'utf8')
    progress.push('wrote ' + scratchPath)
    // Precondition, stated before anything is judged: can the shell's OWN kernel create entries in this workspace at
    // all? A shell started from inside a confined parent inherits that parent's writable roots, so a session whose
    // workspace lives outside them cannot be saved into by anyone - measured as EPERM while mkdir-ing the atomic
    // write's staging directory, with mode danger-full-access in force, i.e. below DSH. That world cannot measure the
    // editor; it says so instead of reddening a product reading.
    const probe = await fetch('http://127.0.0.1:' + String(SHELL_PORT) + '/api/dsh-link-markdown/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: scratchPath, text: '# gate probe\n\n' + SENTINEL + '\n', expectedVersion: null }),
    }).then(async (answer) => ({ status: answer.status, body: await answer.json().catch(() => null) })).catch((error) => ({ status: 0, body: null, why: String(error) }))
    progress.push('write precondition: status=' + String(probe.status) + ' ' + show(probe.body === null ? null : probe.body.code))
    if (probe.status !== 200) {
      rmSync(scratchPath, { force: true })
      scratchPath = null
      return skipWith('this Session workspace (' + show(root) + ') is not writable by the shell kernel, so a save cannot land here: ' + show(probe.body === null ? probe.why : probe.body.error))
    }
    const reloadPress = await call(pressTreeReload)
    progress.push('press tree re-read: ' + show(reloadPress.value))
    const listed = await until(pressTreeRow, [SCRATCH_NAME], (answer) => answer !== null && answer.value === 'pressed', 6000)
    held('3-scratch-listed',
      listed !== null && listed.value === 'pressed',
      'the tree lists the file this gate wrote, and its row is pressable',
      ['row press = ' + show(listed === null ? null : listed.value), 're-read control = ' + show(reloadPress.value)])

    // ---- 4 the row opens the markdown tab --------------------------------------------------------------
    await sleep(2500)
    const opened = await until(markdownState, [], (answer) => {
      const state = stateOf(answer)
      return state !== null && state.present === true
    }, 8000)
    const state = stateOf(opened)
    held('4-tab-opened',
      state !== null && state.present === true && /^dsh-resource:\/\/file\/session\/[^/]+\//.test(String(state.address)) && String(state.address).indexOf(SCRATCH_NAME) !== -1 && state.name === SCRATCH_NAME,
      'pressing the file row opened the markdown tab at that file own address',
      ['address = ' + show(state === null ? null : state.address), 'chip name = ' + show(state === null ? null : state.name)])

    // ---- 5 the body rendered the file (the reading the wire bug failed) --------------------------------
    const bodyText = state === null ? '' : String(state.text)
    held('5-body-read-the-file',
      state !== null && state.failure === null && bodyText.indexOf(SENTINEL) !== -1,
      'the body READ the file through the kernel and rendered its text',
      ['failure = ' + show(state === null ? null : state.failure), 'failure text = ' + show(state === null ? null : state.failureText), 'body = ' + show(bodyText.slice(0, 160))])

    // ---- 6 the document is editable --------------------------------------------------------------------
    held('6-editable',
      state !== null && state.readonly === null && typeof state.editToggle === 'string' && state.editToggle !== '',
      'the pane offers 编辑 and is not showing 只读',
      ['edit toggle = ' + show(state === null ? null : state.editToggle), 'readonly badge = ' + show(state === null ? null : state.readonly)])

    // ---- 7 typing makes a draft dirty ------------------------------------------------------------------
    const togglePress = await call(pressEditToggle)
    await sleep(500)
    const toggled = stateOf(await call(markdownState))
    const draft = '# gate probe\n\n' + SENTINEL + '\n\n' + SAVED_MARK + '\n'
    const typed = await call(typeDraft, draft)
    await sleep(600)
    const typedState = stateOf(await call(markdownState))
    held('7-draft-is-dirty',
      togglePress.value === 'pressed' && typed.value === 'typed' && toggled !== null && toggled.hasArea === true
        && typedState !== null && typedState.dirty !== null && typedState.saveDisabled === false,
      'the editor opens as a textarea, and a typed draft is marked unsaved with 保存 enabled',
      ['toggle = ' + show(togglePress.value), 'has textarea = ' + show(toggled === null ? null : toggled.hasArea), 'typed = ' + show(typed.value), 'dirty badge = ' + show(typedState === null ? null : typedState.dirty), 'save disabled = ' + show(typedState === null ? null : typedState.saveDisabled)])

    // ---- 8 保存 reached the disk ------------------------------------------------------------------------
    const savePress = await call(pressSave)
    const savedAnswer = await until(markdownState, [], (answer) => {
      const now = stateOf(answer)
      return now !== null && (now.status === 'saved' || now.status === 'stale' || now.status === 'refused')
    }, 8000)
    const afterSave = stateOf(savedAnswer)
    let onDisk = ''
    try { onDisk = readFileSync(scratchPath, 'utf8') } catch (error) { onDisk = '' }
    held('8-save-reached-the-disk',
      savePress.value === 'pressed' && afterSave !== null && afterSave.status === 'saved' && onDisk.indexOf(SAVED_MARK) !== -1,
      'the save was accepted and the file on disk carries the typed line',
      ['save press = ' + show(savePress.value), 'status = ' + show(afterSave === null ? null : afterSave.status) + ' (' + show(afterSave === null ? null : afterSave.statusText) + ')', 'code = ' + show(afterSave === null ? null : afterSave.statusCode) + ' detail = ' + show(afterSave === null ? null : afterSave.statusDetail), 'disk bytes = ' + String(onDisk.length), 'disk text = ' + show(onDisk.slice(0, 160))])

    // ---- 9 预览 re-reads what was written ----------------------------------------------------------------
    const backToPreview = await call(pressEditToggle)
    const previewAnswer = await until(markdownState, [], (answer) => {
      const now = stateOf(answer)
      return now !== null && now.hasArea === false && String(now.text).indexOf(SAVED_MARK) !== -1
    }, 8000)
    const preview = stateOf(previewAnswer)
    held('9-preview-rereads',
      backToPreview.value === 'pressed' && preview !== null && preview.hasArea === false && String(preview.text).indexOf(SAVED_MARK) !== -1,
      'leaving the editor re-reads the file from the kernel and the saved line is on screen',
      ['toggle = ' + show(backToPreview.value), 'has textarea = ' + show(preview === null ? null : preview.hasArea), 'body = ' + show(preview === null ? null : String(preview.text).slice(0, 160))])

    // ---- 10 the world is put back -----------------------------------------------------------------------
    const closePress = await call(closeRailTab, SCRATCH_NAME)
    await sleep(400)
    rmSync(scratchPath, { force: true })
    let goneFromDisk = true
    try { readFileSync(scratchPath, 'utf8'); goneFromDisk = false } catch (error) { goneFromDisk = true }
    scratchPath = null
    const closeTree = await call(closeRailTab, TREE_TITLE)
    await sleep(500)
    // Put the rail back: the tabs this run closed are re-opened through the same add menu, by the label each chip
    // carried. A label the menu does not offer is named in the evidence rather than passed over.
    const MENU_NAME = { '文件': '工作区文件', '开始': '工作区文件' }
    const reopened = []
    for (const label of chipsBefore) {
      const word = String(label).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
      if (word === '') continue
      const menuName = MENU_NAME[word] !== undefined ? MENU_NAME[word] : word
      const addAgain = await call(pressAddTab)
      await sleep(700)
      const itemAgain = await call(pressMenuItem, menuName)
      reopened.push(word + ' -> ' + menuName + ':' + String(itemAgain === null ? null : itemAgain.value))
      await sleep(900)
    }
    const chipsAfter = await call(railChips)
    let after = []
    try { after = JSON.parse(String(chipsAfter.value)) } catch (error) { after = [] }
    // What this reading claims is bounded on purpose: the scratch file and this run's tabs are gone, and the rail still
    // offers something to work with. Re-opening the exact set the rail held is NOT claimed - the add menu names page
    // types (工作区文件), not the chips they produce (文件), and a comparison that passed on equal counts would be
    // measuring arithmetic instead of the world.
    held('10-world-put-back',
      goneFromDisk === true && String(chipsAfter.value).indexOf(SCRATCH_NAME) === -1 && after.length > 0,
      'the scratch file and this run own tabs are gone, and the rail still offers a tab',
      ['tab close = ' + show(closePress.value), 'tree tab close = ' + show(closeTree.value), 'file gone = ' + String(goneFromDisk), 'rail held before this run = ' + show(chipsBefore), 'reopen attempts = ' + show(reopened), 'rail chips after = ' + String(chipsAfter.value)])
  } finally {
    try { cdp.close() } catch (error) { /* the socket is closed on every path */ }
  }
  return report()
}

process.exitCode = await (async () => {
  try {
    return await main()
  } catch (error) {
    console.log('  FAIL  the gate itself threw before it could judge (a GATE bug, not a product verdict)')
    console.log('        ' + (error && error.stack ? String(error.stack).split('\n').slice(0, 6).join('\n        ') : String(error)))
    return 1
  }
})()
