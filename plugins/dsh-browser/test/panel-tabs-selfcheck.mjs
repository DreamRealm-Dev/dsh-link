#!/usr/bin/env node
/**
 * Producer self-check for the R184 tab face and the R193 client half (offline).
 *
 * WHAT IT DRIVES: the REAL plugin code (lib/panel.js, lib/registry.js, lib/session.js, lib/tools.js -
 * and, in reading 1, lib/index.js through its own apply()) against a FAKE shell panel
 * (test/fake-panel.mjs) whose shapes and refusal sentences are transcribed from
 * src-tauri/src/core/sidebar_panel.rs. Reading 1 checks that transcription against that Rust file
 * itself, so this harness cannot quietly agree with a fake that drifted.
 *
 * USAGE
 *   node test/panel-tabs-selfcheck.mjs                    clean world: every reading must hold
 *   node test/panel-tabs-selfcheck.mjs --mutate=<name>    one LIE in the world: the readings that
 *                                                         declare it must go red, and nothing else may
 *   node test/panel-tabs-selfcheck.mjs --list             the readings, and what each one would catch
 *
 * EXIT CODES: 0 as declared; 1 a reading disagreed with its expectation; 3 NOT MEASURED (named: the
 * Rust anchor is unreadable, so the fake could be describing a shell that does not exist).
 *
 * THE CLIENT HALF (R193). Readings 1-20 drive the HOST half against the fake shell. Readings 21-28 run
 * plugins/dsh-browser/lib/client.js ITSELF - a HAND-WRITTEN bundle that is NOT in plugins/build.mjs's
 * manifest, so no build step can disagree with it and no artifact-drift check can catch it. They load
 * those bytes the way the page's module loader does (install window.__ModuleLoader__.load, run the
 * factory with a recording require) and drive the half against a recording client plane: the kernel's
 * locale service, the panel's linkPanel seam, the right column's sidebarRight, the tab registry and the
 * two slot seats.
 *
 * ARTIFACT MUTATIONS: --mutate=<name> also accepts two lies told to the bundle's BYTES (BUNDLE_MUTATIONS
 * below), and every anchor must LAND in lib/client.js - an anchor that is not there is NOT MEASURED
 * (exit 3), never a silent pass.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BrowserRegistry } from '../lib/registry.js'
import { ConfigStore } from '../lib/config.js'
import { DEFAULT_PANEL_ORIGIN, panelTabs } from '../lib/panel.js'
import { defineBrowserTools } from '../lib/tools.js'
import { SHELL, createFakePanel } from './fake-panel.mjs'

const RUST_SOURCE = new URL('../../../src-tauri/src/core/sidebar_panel.rs', import.meta.url)
const BASE_DIR = mkdtempSync(join(tmpdir(), 'dsh-browser-selfcheck-'))

/** Report a POST to a fake panel as JSON, outside the plugin, for the anchor reading. */
function post(origin, payload) {
  return fetch(origin + '/__shell/panel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const text = await response.text()
    return JSON.parse(text)
  })
}

/** The real shell's op=state key set, read out of the Rust format string (the anchor against drift). */
function rustStateKeys() {
  let text
  try {
    text = readFileSync(RUST_SOURCE, 'utf8')
  } catch (error) {
    return { ok: false, reason: 'the shell source could not be read at ' + RUST_SOURCE.pathname + ': ' + (error?.message ?? String(error)) }
  }
  const line = text.split(/\r?\n/).find((row) => row.includes('"exists":{}') && row.includes('"prefsPath":{}'))
  if (line === undefined) return { ok: false, reason: 'the op=state format string was not found in ' + RUST_SOURCE.pathname }
  const keys = [...line.matchAll(/"([A-Za-z][A-Za-z0-9]*)":/g)].map((match) => match[1])
  if (keys.length === 0) return { ok: false, reason: 'the format string carried no keys' }
  return { ok: true, keys }
}

/** A tiny assertion kit: a reading is green only when every check in it is. */
function verdict(checks) {
  const failed = checks.filter((check) => check.ok !== true)
  const parts = failed.length === 0
    ? checks.map((check) => check.what)
    : failed.map((check) => check.what + ' (got ' + JSON.stringify(check.got) + ', wanted ' + JSON.stringify(check.want) + ')')
  return { ok: failed.length === 0, detail: parts.join('; ').slice(0, 700) }
}
const is = (what, got, want) => ({ ok: got === want, what, got, want })
/** Read a nested field of a marker without a missing one taking the reading down with a TypeError. */
const field = (object, path) => path.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), object)
const has = (what, text, needle) => ({ ok: typeof text === 'string' && text.includes(needle), what, got: text, want: needle })
const lacks = (what, text, needle) => ({ ok: typeof text === 'string' && !text.includes(needle), what, got: text, want: 'NOT ' + needle })

/** The tools of one channel, built the way lib/index.js builds them. */
async function toolsFor({ world, channel = 'panel' }) {
  const store = new ConfigStore(BASE_DIR)
  const registry = new BrowserRegistry({ baseDir: BASE_DIR, config: store, log: { info() {}, warn() {}, error() {} }, usePanel: channel === 'panel', panelOrigin: world === null ? undefined : world.origin })
  const attachments = { saveImage: async ({ data, mediaType, name }) => ({ attachmentId: 'att-1', mediaType, bytes: data.length, width: 1, height: 1, name }) }
  const definitions = defineBrowserTools({ registry, config: store, getAttachments: () => attachments })
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const call = async (name, args = {}) => {
    const definition = byName.get(name)
    if (definition === undefined) throw new Error('no such tool in this world: ' + name)
    return await definition.execute(args, {})
  }
  return {
    registry,
    definitions,
    names: definitions.map((definition) => definition.name),
    description: (name) => byName.get(name)?.description ?? null,
    parameters: (name) => Object.keys(byName.get(name)?.parameters?.properties ?? {}),
    call,
    text: async (name, args = {}) => (await call(name, args))?.text ?? null,
  }
}

/**
 * Load lib/index.js through a CACHE-BUSTED url: index.js reads DSH_BROWSER_PANEL and the ambient
 * environment once, at evaluation time, and reading 1 wants the real entry point, not a rebuilt copy
 * of it. Returns the tool definitions the plugin actually registered.
 */
async function loadThroughApply({ world, channel, tag }) {
  process.env.DSH_BROWSER_PANEL = channel === 'panel' ? '1' : '0'
  const url = new URL('../lib/index.js', import.meta.url).href + '?selfcheck=' + tag
  const plugin = await import(url)
  const definitions = []
  const attachments = { saveImage: async ({ data, mediaType, name }) => ({ attachmentId: 'att-1', mediaType, bytes: data.length, width: 1, height: 1, name }) }
  const written = []
  const ctx = {
    get(name) {
      if (name === 'tools') return { register(definition) { definitions.push(definition); return () => {} } }
      if (name === 'attachments') return attachments
      return undefined
    },
    inject() {},
    effect() { return () => {} },
    webServer: undefined,
    get logger() { return undefined },
    set logger(value) { written.push(value) },
  }
  plugin.apply(ctx, { baseDir: BASE_DIR, panelOrigin: world.origin })
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  return { names: definitions.map((definition) => definition.name), byName, call: async (name, args = {}) => await byName.get(name).execute(args, {}) }
}

/** One reading. world is the fake world options; run gets { world, tools, panel }. */
const readingDefs = []
function defineReading(entry) {
  readingDefs.push(entry)
}

const OLD_PANEL_OPEN_LIE = 'Multiple instances can be open at once, each with its own window, profile, and pinned viewport'

async function expectThrow(run) {
  try {
    const value = await run()
    return { thrown: null, value }
  } catch (error) {
    return { thrown: error, value: undefined }
  }
}
/* ------------------------------------------------------------------ *
 * The client half (R193): the instrument for plugins/dsh-browser/lib/client.js.
 *
 * That file is a HAND-WRITTEN bundle - plugins/build.mjs's manifest does not list
 * dsh-browser, so nothing rebuilds it and no check can drift against it. The only
 * way to judge it is to run IT: read its bytes, install the browser module loader's
 * registration point, run the factory with a recording require, and give the
 * resulting apply() a recording client plane.
 * ------------------------------------------------------------------ */

/** Lies told to the ARTIFACT's bytes (world mutations are the separate MUTATIONS table below). */
const BUNDLE_MUTATIONS = {
  'empty-invoke': {
    what: 'the panel action\'s invoke is an empty function: the panel would call nothing at all',
    edits: [{ in: 'invoke: function () { openOwnPanel(ctx, tabType) },', out: 'invoke: function () { },' }],
  },
  'absent-throws': {
    what: 'the absent-service paths throw instead of recording: a page with no panel (or no right column) would break instead of keeping its tab type',
    edits: [
      { in: "    markDeclaration(false, 'linkPanel-unavailable: this page offers no ' + LINK_PANEL_SERVICE + ' service, so the browser panel action was not declared', tabType)", out: "    throw new Error('linkPanel-unavailable: this page offers no ' + LINK_PANEL_SERVICE + ' service, so the browser panel action was not declared')" },
      { in: "    markInvoke({ ok: false, kind: tabType.kind, failed: 'sidebarRight-unavailable: this page offers no ' + SIDEBAR_RIGHT_SERVICE + ' service, so the browser panel was not opened' })", out: "    throw new Error('sidebarRight-unavailable: this page offers no ' + SIDEBAR_RIGHT_SERVICE + ' service, so the browser panel was not opened')" },
    ],
  },
}

/**
 * Load the shipped client half, optionally with one lie told to its bytes.
 * @param mutation - a BUNDLE_MUTATIONS entry to apply, or null for the delivered bytes.
 * @returns the registration id, the factory's exports and the source it ran from.
 */
function loadClientHalf(mutation = null) {
  let source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  if (mutation !== null) {
    for (const edit of mutation.edits) {
      const at = source.indexOf(edit.in)
      if (at === -1) throw new Error('NOT MEASURED: this mutation anchor is not in lib/client.js: ' + JSON.stringify(edit.in))
      source = source.slice(0, at) + edit.out + source.slice(at + edit.in.length)
    }
  }
  let loaded = null
  const page = { __ModuleLoader__: { load(registration) { loaded = registration } } }
  new Function('window', source)(page)
  if (loaded === null) throw new Error('the bundle did not register itself through window.__ModuleLoader__.load')
  // The page's module table, as far as this half reads it: react, and nothing else.
  const react = { createElement: () => null, useState: () => [null, () => {}], useRef: () => ({ current: 0 }), useCallback: (fn) => fn, useEffect: () => {} }
  const requireShim = (name) => {
    if (name === 'react') return react
    throw new Error('the half asked for a module this harness does not carry: ' + name)
  }
  return { id: loaded.id, exported: loaded.factory(requireShim), source }
}

/** The half, or the named NOT MEASURED third state when a mutation anchor did not land. */
function loadOrNotMeasured(mutation) {
  try {
    return { half: loadClientHalf(mutation) }
  } catch (error) {
    const text = String(error?.message ?? error)
    if (text.startsWith('NOT MEASURED')) return { notMeasured: text }
    throw error
  }
}

/**
 * The client plane this half reaches for, as a recorder of what it did with it.
 *
 * Every service can be told to be ABSENT (the page has none) or to REFUSE (it
 * answers with its own error), which is how the fail-closed readings are driven.
 * @param options - 'absent' / 'refuses' per service, and the page's language.
 * @returns the ctx, everything the half did with it, and the two drivers above it.
 */
function clientPlane(options = {}) {
  const present = (name) => options[name] !== 'absent'
  const record = {
    applied: false, threw: null, declarations: [], openTabCalls: [], tabTypes: [], slotNames: [],
    effects: [], dictionaries: [], notifications: 0, localeSubscribers: 0, released: [],
  }
  let listener = null
  let language = options.language ?? 'zh'
  const dictionaryOf = (ns, lang) => {
    const held = record.dictionaries.find((entry) => entry.ns === ns)
    return held === undefined ? null : held.dicts[lang] ?? null
  }
  const services = {
    locale: {
      register(ns, dicts) {
        record.dictionaries.push({ ns, dicts })
        return () => { record.released.push('locale:' + ns) }
      },
      bind(ns) {
        return (key) => {
          const dict = dictionaryOf(ns, language)
          return dict !== null && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
        }
      },
      getLocale() { return { active: language, locales: [], revision: 0 } },
      subscribe(callback) { record.localeSubscribers += 1; listener = callback; return () => { listener = null } },
    },
    linkPanel: {
      declare(definition) {
        if (options.declare === 'refuses') throw new Error('PANEL_DUP_ID: duplicate id "dsh-browser:open-panel" (this harness own refusal)')
        record.declarations.push(definition)
        return () => { record.released.push('panel:' + definition.id) }
      },
      notify() { record.notifications += 1 },
    },
    sidebarRight: {
      openTab(kind) {
        if (options.openTab === 'refuses') throw new Error('sidebarRight: no session surface is mounted')
        record.openTabCalls.push(kind)
      },
    },
  }
  const ctx = {
    get(name) { return present(name) ? services[name] ?? undefined : undefined },
    effect(callback, label) { record.effects.push(String(label)); return callback() },
    slots: {
      inject(name, callback) { record.slotNames.push(String(name)); callback(); return () => {} },
      register() { return () => {} },
    },
    sidebarRightTabs: { register(definition) { record.tabTypes.push(definition); return () => {} } },
  }
  return {
    ctx,
    record,
    /** Apply the shipped half to this plane. A throw is caught and NAMED, never propagated. */
    apply(half) {
      delete globalThis.__dshBrowserPanel
      try {
        half.exported.apply(ctx)
        record.applied = true
      } catch (error) {
        record.threw = String(error?.message ?? error)
      }
      return record
    },
    /** Move the page's language and tell the subscribers, the way the service does. */
    switchLanguage(next) { language = next; if (listener !== null) listener() },
    /** One of the dictionaries the half registered, as data. */
    dictionary(lang) { return dictionaryOf('dsh-browser', lang) },
  }
}

// ------------------------------------------------------------- 1. the fake IS the shell (anchor)
defineReading({
  id: 1,
  name: 'state-key-set-is-the-shells',
  catches: 'the fake describing an op=state report the shell does not send (or the shell having moved on): its key set is compared with the format string in sidebar_panel.rs:538-592',
  mutants: ['no-count'],
  async run({ world }) {
    const rust = rustStateKeys()
    if (rust.ok !== true) return { notMeasured: rust.reason }
    const answer = await post(world.origin, { op: 'state' })
    const keys = Object.keys(answer)
    return verdict([
      is('the fake sends exactly the keys the shell sends, in the same order', JSON.stringify(keys), JSON.stringify(rust.keys)),
    ])
  },
})

// ------------------------------------------------------------- 2. the projection is a projection
defineReading({
  id: 2,
  name: 'panelTabs-is-pure',
  catches: 'a projection that caches, mutates its input, or recomputes count from the rows - a second answer to a question the shell answers',
  async run({ world }) {
    const answer = await post(world.origin, { op: 'state' })
    const sample = JSON.parse(JSON.stringify(answer))
    const before = JSON.stringify(sample)
    const first = panelTabs(sample)
    const second = panelTabs(sample)
    const doctored = panelTabs({ ...JSON.parse(before), count: 7 })
    return verdict([
      is('two calls on the same report are identical', JSON.stringify(first), JSON.stringify(second)),
      is('the input report is not mutated by projecting it', JSON.stringify(sample), before),
      is('count stays the number the shell reported even when the rows disagree', doctored.count, 7),
      is('the rows are still listed as they arrived', doctored.listed, sample.tabs.length),
      is('no geometry travels in the projection (bounds is not a field)', Object.keys(first.tabs[0]).includes('bounds'), false),
    ])
  },
})

// ------------------------------------------------------------- 3. the tab set is read, not remembered
defineReading({
  id: 3,
  name: 'browser_tabs-reads-op-state',
  catches: 'a tool that answers from its own memory instead of the shell: it must ask op=state and repeat the count and limit the shell reported',
  mutants: ['no-count'],
  async run({ world, tools }) {
    const text = await tools.text('browser_tabs')
    const ops = world.ops()
    return verdict([
      has('the tool asked the shell for op=state', JSON.stringify(ops), '\"state\"'),
      has('the count is the count the shell reported', text, 'tabs (2 of 4)'),
      has('the active tab is marked', text, '* t1'),
      has('every tab is listed under the id the shell gave it', text, '  t2'),
      has('urls come from the report', text, 'https://b.example/'),
      lacks('no tab is called an instance', text, 'instance'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 4. browser_list on the panel channel
defineReading({
  id: 4,
  name: 'browser_list-panel-reports-tabs',
  catches: 'the panel channel listing phantom instances (the R184 lie) or a count that is not the shell\'s',
  mutants: ['no-count'],
  async run({ world, tools }) {
    const text = await tools.text('browser_list')
    const live = world.world.tabs.length
    return verdict([
      has('the row count equals what the world really holds', text, 'tabs (' + live + ' of 4)'),
      is('the world really holds two tabs (the count above is not a coincidence)', live, 2),
      lacks('the word instance is gone from the panel channel', text, 'instance'),
      has('the active tab is marked with *', text, '* t1'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 5. the chrome channel is the pair
defineReading({
  id: 5,
  name: 'chrome-channel-still-speaks-instances',
  catches: 'the channel condition being dropped: on the chrome channel there are instances and NO tab set, so every tab tool must refuse by name and the descriptions must describe THAT channel',
  async run({ world }) {
    const chrome = await toolsFor({ world, channel: 'chrome' })
    const list = await chrome.text('browser_list')
    const refused = await expectThrow(() => chrome.call('browser_tabs', {}))
    const refusedGoto = await expectThrow(() => chrome.call('browser_goto', { url: 'https://x.test/', tab: 't1' }))
    const panel = await toolsFor({ world, channel: 'panel' })
    return verdict([
      has('browser_list on the chrome channel lists instances', list, 'no browser instances are open'),
      has('its description still says instances (true there)', chrome.description('browser_list'), 'instance'),
      has('browser_open describes the chrome channel, not the panel', chrome.description('browser_open'), OLD_PANEL_OPEN_LIE),
      is('browser_tabs refuses with TABS_CHANNEL on the chrome channel', (refused.thrown?.message ?? '').startsWith('TABS_CHANNEL: '), true),
      is('a tab argument is refused with TABS_CHANNEL there too', (refusedGoto.thrown?.message ?? '').startsWith('TABS_CHANNEL: '), true),
      lacks('the panel channel does NOT describe instances', panel.description('browser_open'), 'instance'),
      lacks('the panel channel does NOT keep the old sentence', panel.description('browser_open'), OLD_PANEL_OPEN_LIE),
    ])
  },
})

// ------------------------------------------------------------- 6. the tab travels VERBATIM into cdp
defineReading({
  id: 6,
  name: 'cdp-carries-the-named-tab',
  catches: 'a call that names a tab but reaches the active one - the field would be missing, or the answer would describe t1 instead of t2',
  mutants: ['ignore-tab'],
  async run({ world, tools }) {
    const text = await tools.text('browser_status', { tab: 't2' })
    const bodies = world.cdp()
    const documents = bodies.filter((body) => typeof body.params?.expression === 'string' && body.params.expression.includes('readyState'))
    const carried = documents.filter((body) => body.tab === 't2')
    return verdict([
      is('a document read was addressed at t2', carried.length > 0, true),
      is('every document read of this reading named tab=t2', carried.length, documents.length),
      has('the answer is about t2', text, 'tab: t2'),
      has('the url came from t2 itself', text, 'https://b.example/'),
      lacks('t1\'s url is not passed off as t2\'s', text, 'url: https://a.example/'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 7. no tab named = the active tab
defineReading({
  id: 7,
  name: 'omitted-tab-is-the-shells-active-tab',
  catches: 'an implementation that always names a tab: the shell defines an omitted tab as the ACTIVE one, and the reply must say which that is',
  mutants: ['no-count'],
  async run({ world, tools }) {
    const text = await tools.text('browser_status')
    const bodies = world.cdp()
    return verdict([
      is('no cdp request named a tab at all', bodies.every((body) => body.tab === undefined), true),
      has('the reply says which tab it is', text, 'tab: t1 (active)'),
      has('and reports the tab set', text, '2/4 tabs'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})
// ------------------------------------------------------------- 8. goto goes through the per-tab op
defineReading({
  id: 8,
  name: 'browser_goto-uses-tab-goto-and-reads-the-landing',
  catches: 'browser_goto still navigating the active tab through Page.navigate (which is the page the user is looking at), or reporting the URL it asked for instead of the one the tab really landed on',
  mutants: ['ignore-tab', 'no-redirect'],
  async run({ world, tools }) {
    const text = await tools.text('browser_goto', { url: 'https://x.test/redirect', tab: 't2' })
    const ops = world.ops()
    const bodies = world.cdp()
    const navigated = bodies.filter((body) => body.method === 'Page.navigate')
    const rows = world.world.tabs
    return verdict([
      is('the write went to the per-tab op', ops.includes('tab-goto'), true),
      is('Page.navigate was NOT used on the panel channel', navigated.length, 0),
      has('the landing is read from the tab itself', text, 'url (read from the tab itself): https://x.test/landed'),
      has('the shell record keeps the URL that was asked for', text, 'shell record for t2: https://x.test/redirect'),
      has('the reply names the tab it navigated', text, 'tab t2 navigated'),
      is('the tab that was navigated is the one that moved', rows.find((tab) => tab.id === 't2').page.href, 'https://x.test/landed'),
      is('the ACTIVE tab did not move (navigating does not steal the view)', rows.find((tab) => tab.id === 't1').page.href, 'https://a.example/'),
      is('the active tab is still t1', world.world.active, 't1'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'], redirect: (url) => url.replace('/redirect', '/landed') },
})

// ------------------------------------------------------------- 9. goto without a tab = the active tab
defineReading({
  id: 9,
  name: 'browser_goto-defaults-to-the-active-tab',
  catches: 'a default that picks the wrong tab, or a reply that leaves the model guessing which tab moved',
  async run({ world, tools }) {
    const text = await tools.text('browser_goto', { url: 'https://y.test/redirect' })
    const gotos = world.requests.filter((entry) => entry.path === '/__shell/panel' && entry.body?.op === 'tab-goto')
    return verdict([
      is('exactly one tab-goto was sent', gotos.length, 1),
      is('it named the active tab', gotos[0].body.id, 't1'),
      has('the reply says which tab moved', text, 'tab t1 navigated'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'], redirect: (url) => url.replace('/redirect', '/landed') },
})

// ------------------------------------------------------------- 10. a new tab, from the shell
defineReading({
  id: 10,
  name: 'browser_tab_new-reads-the-shell-back',
  catches: 'an optimistic reply: the created id must be the answer the shell gave, and the count must come from a state read AFTER the write',
  mutants: ['stale-readback', 'no-count'],
  async run({ world, tools }) {
    const text = await tools.text('browser_tab_new', { url: 'https://c.example/' })
    const ops = world.ops()
    const after = ops.slice(ops.indexOf('tab-new'))
    return verdict([
      has('the id is the id the shell answered with', text, 'opened tab t3'),
      has('the count is the shell read-back, not the request', text, 'tabs (3 of 4)'),
      is('the world really has three tabs', world.world.tabs.length, 3),
      is('the new tab is active, as the shell defines it', world.world.active, 't3'),
      is('the write was followed by an op=state read', after[1], 'state'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 11. the cap comes from the shell
defineReading({
  id: 11,
  name: 'tab-cap-refusal-is-the-shells-own-sentence',
  catches: 'a tool that invents its own cap message, or that computes the limit itself instead of letting the shell refuse by name',
  mutants: ['silent-cap'],
  async run({ world, tools }) {
    const answer = await expectThrow(() => tools.call('browser_tab_new', { url: 'https://fifth.example/' }))
    const expected = SHELL.cap(5, 4, ['t1', 't2', 't3', 't4'])
    return verdict([
      is('the refusal is the shell sentence, character for character', answer.thrown?.message ?? null, expected),
      is('and no tab appeared', world.world.tabs.length, 4),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/'] },
})

// ------------------------------------------------------------- 12. an unknown id, same rule
defineReading({
  id: 12,
  name: 'unknown-tab-refusal-is-the-shells-own-sentence',
  catches: 'a rewritten refusal: the model must read the sentence the shell sent, with the ids the shell really has',
  async run({ world, tools }) {
    const answer = await expectThrow(() => tools.call('browser_tab_activate', { tab: 't9' }))
    const expected = SHELL.unknownTab('tab-activate', 't9', ['t1', 't2'])
    return verdict([
      is('the refusal is the shell sentence, character for character', answer.thrown?.message ?? null, expected),
      is('the world was not changed by the refusal', world.world.active, 't1'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})
// ------------------------------------------------------------- 13. closing the active tab
defineReading({
  id: 13,
  name: 'tab-close-activates-the-left-neighbour',
  catches: 'a tool that guesses what became active, or a reply that reports the closed tab as still active',
  mutants: ['first-tab', 'stale-readback'],
  async run({ world, tools }) {
    await tools.call('browser_tab_activate', { tab: 't3' })
    const text = await tools.text('browser_tab_close', { tab: 't3' })
    return verdict([
      has('the reply names the tab it closed', text, 'closed tab t3'),
      has('the active tab is the left neighbour, as the shell set it', text, '* t2'),
      is('the world agrees', world.world.active, 't2'),
      is('only two tabs are left', world.world.tabs.length, 2),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/', 'https://c.example/'] },
})

// ------------------------------------------------------------- 14. activating reports the state
defineReading({
  id: 14,
  name: 'tab-activate-reports-the-state-the-shell-sent',
  catches: 'a reply that repeats the request instead of the report (the shell is the only side that says which tab is in the content area)',
  mutants: ['stale-readback'],
  async run({ world, tools }) {
    const text = await tools.text('browser_tab_activate', { tab: 't2' })
    return verdict([
      has('the reply names the tab it activated', text, 'activated tab t2'),
      has('the shell report marks t2 active', text, '* t2'),
      is('the world agrees', world.world.active, 't2'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 15. writes travel under a name
defineReading({
  id: 15,
  name: 'writes-carry-the-holder-and-repeat-the-refusal',
  catches: 'writes arriving with no name (the shell could only say not by nobody), or a refusal rewritten into our own words',
  mutants: ['ignore-holder'],
  async run({ world, tools }) {
    await post(world.origin, { op: 'lease', leaseOp: 'claim', holder: 'gate-113', ttlMs: 30000 })
    const answer = await expectThrow(() => tools.call('browser_tab_activate', { tab: 't2' }))
    const writes = world.requests.filter((entry) => entry.path === '/__shell/panel' && entry.body?.op === 'tab-activate')
    return verdict([
      is('the write carried a holder name', writes.length > 0, true),
      is('the name it carried is this plugin', writes.length > 0 ? writes[writes.length - 1].body.holder : null, 'dsh-browser'),
      is('the refusal is the shell sentence, with both names', answer.thrown?.message ?? null, SHELL.leased('gate-113', 'dsh-browser')),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 16. the user can take it back
defineReading({
  id: 16,
  name: 'a-takeover-refuses-the-next-write-with-the-shells-words',
  catches: 'a tool that swallows the takeover rule: the shell refuses an unnamed AI write after the user drove the panel, and that sentence must reach the model unchanged',
  mutants: ['ignore-holder'],
  async run({ world, tools }) {
    await post(world.origin, { op: 'lease', leaseOp: 'claim', holder: 'gate-113', ttlMs: 30000 })
    // The user hand on the shell browser page: it takes the turn by name (sidebar_panel.rs:799-807).
    await post(world.origin, { op: 'tab-new', url: 'https://user.example/', holder: 'user-chrome' })
    const answer = await expectThrow(() => tools.call('browser_tab_close', { tab: 't3' }))
    const expected = SHELL.taken('gate-113', 'user-input', 'shell-control:tab-new')
    return verdict([
      is('the refusal is the sentence the takeover produced', answer.thrown?.message ?? null, expected),
      is('the tab the user opened is still there', world.world.tabs.some((tab) => tab.url === 'https://user.example/'), true),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 17. a capture says which tab it is
defineReading({
  id: 17,
  name: 'browser_shot-names-the-tab-and-warns-about-a-parked-one',
  catches: 'a capture that silently returns the parked window as if it were a page, or that labels the image with the active tab',
  mutants: ['ignore-tab'],
  async run({ world, tools }) {
    const value = await tools.call('browser_shot', { tab: 't2' })
    const text = value?.text ?? ''
    const shots = world.cdp().filter((body) => body.method === 'Page.captureScreenshot')
    return verdict([
      is('the capture was addressed at t2', shots.length > 0 && shots.every((body) => body.tab === 't2'), true),
      has('the image carries an attachment', JSON.stringify(value?.image ?? null), 'att-1'),
      has('the reply says which tab the image is', text, 'tab: t2 (NOT the active tab'),
      has('and says the window is parked, so the pixels are that window', text, 'the shell parks it off-screen'),
      has('the url in the block is the tab it came from', text, 'https://b.example/'),
    ])
  },
  world: { urls: ['https://a.example/', 'https://b.example/'] },
})

// ------------------------------------------------------------- 18. the fixture seam, default untouched
defineReading({
  id: 18,
  name: 'panelOrigin-is-a-seam-with-an-unchanged-default',
  catches: 'a seam that moved the default (which would change live behaviour), or an entry point that ignores the value and would then never reach a fixture',
  async run({ world }) {
    const plain = await toolsFor({ world, channel: 'panel' })
    const defaulted = new BrowserRegistry({ baseDir: BASE_DIR, config: new ConfigStore(BASE_DIR), usePanel: true })
    const blanked = new BrowserRegistry({ baseDir: BASE_DIR, config: new ConfigStore(BASE_DIR), usePanel: true, panelOrigin: '' })
    const text = await plain.text('browser_tabs')
    return verdict([
      is('the published default is the shell address it always was', DEFAULT_PANEL_ORIGIN, 'http://127.0.0.1:31761'),
      is('a registry with no panelOrigin uses that default', defaulted.panelOrigin, DEFAULT_PANEL_ORIGIN),
      is('an empty string falls back to the default too', blanked.panelOrigin, DEFAULT_PANEL_ORIGIN),
      is('the seam really routes the plugin at the fixture', world.ops().includes('state'), true),
      has('and the tool read the fixture, not a live shell', text, 'https://a.example/'),
    ])
  },
  world: { urls: ['https://a.example/'] },
})

// ------------------------------------------------------------- 19. the surface, and the words
defineReading({
  id: 19,
  name: 'eighteen-tools-and-honest-channel-words',
  catches: 'a tool surface that lost a tab tool, or a description that went back to describing the other channel (the words the model reads changed in R184 and must stay changed)',
  async run({ world }) {
    const panel = await toolsFor({ world, channel: 'panel' })
    const chrome = await toolsFor({ world, channel: 'chrome' })
    const want = ['browser_open', 'browser_list', 'browser_tabs', 'browser_goto', 'browser_tab_new', 'browser_tab_close', 'browser_tab_activate', 'browser_shot', 'browser_controls', 'browser_pick', 'browser_click', 'browser_hover', 'browser_type', 'browser_key', 'browser_scroll', 'browser_status', 'browser_close', 'browser_config']
    const openPanel = panel.description('browser_open')
    const openChrome = chrome.description('browser_open')
    const listPanel = panel.description('browser_list')
    return verdict([
      is('the surface is eighteen tools in this order', JSON.stringify(panel.names), JSON.stringify(want)),
      has('a page tool takes a tab argument', JSON.stringify(panel.parameters('browser_status')), 'tab'),
      has('browser_goto takes one too', JSON.stringify(panel.parameters('browser_goto')), 'tab'),
      lacks('the panel description of browser_open does not claim instances', openPanel, 'Multiple instances'),
      has('the chrome description still says what is true there', openChrome, OLD_PANEL_OPEN_LIE),
      lacks('the panel description of browser_list does not say instance', listPanel, 'instance'),
      has('the chrome description of browser_list does', chrome.description('browser_list'), 'instance'),
      has('browser_tabs on the chrome channel announces its refusal code', chrome.description('browser_tabs'), 'TABS_CHANNEL'),
      has('browser_goto on the panel channel says the shell op is what navigates', panel.description('browser_goto'), 'per-tab op'),
    ])
  },
})

// ------------------------------------------------------------- 20. through the real entry point
defineReading({
  id: 20,
  name: 'apply-registers-and-drives-the-fake-world',
  catches: 'the plugin entry point not wiring the seam, or registering a surface other than the one the tools file defines',
  async run({ world }) {
    const plugin = await loadThroughApply({ world, channel: 'panel', tag: 'reading20-' + Date.now() })
    const answer = await plugin.call('browser_tabs', {})
    return verdict([
      is('apply registered eighteen tools', plugin.names.length, 18),
      is('the four tab tools are among them', ['browser_tabs', 'browser_tab_new', 'browser_tab_close', 'browser_tab_activate'].every((name) => plugin.names.includes(name)), true),
      is('the registry reached the fixture through the row config', world.ops().includes('state'), true),
      has('and the tool answered from it', answer?.text ?? '', 'https://a.example/'),
    ])
  },
  world: { urls: ['https://a.example/'] },
})

// ------------------------------------------- 21. the client half registers itself
defineReading({
  id: 21,
  name: 'client-half-self-registers-and-names-its-injections',
  catches: 'a hand-written bundle that stopped registering itself through window.__ModuleLoader__.load (the loader answers "loaded without registering"), or a half that stopped injecting the locale service and the panel seam R193 contributes through',
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const half = loaded.half
    const buildManifest = readFileSync(new URL('../../build.mjs', import.meta.url), 'utf8')
    return verdict([
      is('the bundle registers under its own package name', half.id, 'dsh-browser'),
      is('the factory exports exactly name/inject/apply', JSON.stringify(Object.keys(half.exported).sort()), JSON.stringify(['apply', 'inject', 'name'])),
      is('the name it reports is its own package name', half.exported.name, 'dsh-browser'),
      is('it injects the two seats, the locale service and the panel seam', JSON.stringify(half.exported.inject), JSON.stringify(['slots', 'sidebarRightTabs', 'locale', 'linkPanel'])),
      is('sidebarRight is deliberately NOT injected (its absence must not hold the tab type back)', half.exported.inject.includes('sidebarRight'), false),
      is('this half is NOT in plugins/build.mjs: it is a hand-written bundle, and running it is the only judge', buildManifest.includes("'dsh-browser'"), false),
    ])
  },
})

// ------------------------------------------- 22. the dictionary, and every key t names
defineReading({
  id: 22,
  name: 'dictionary-balance-and-every-t-key',
  catches: 'a dictionary pair whose key sets differ (a word that exists in one language only), a t(...) call naming a key no dictionary carries, or a namespace that is not this package own',
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane()
    plane.apply(loaded.half)
    const zh = plane.dictionary('zh')
    const en = plane.dictionary('en')
    const used = [...loaded.half.source.matchAll(/\bt\((['"])([^'"]+)\1/g)].map((match) => match[2])
    if (zh === null || en === null) return { notMeasured: 'the half registered no dictionary under its own namespace, so there is nothing to compare' }
    return verdict([
      is('the one namespace it registered is its own package name', plane.record.dictionaries.map((entry) => entry.ns).join(','), 'dsh-browser'),
      is('zh and en arrive in ONE registration (the kernel service takes both)', JSON.stringify(Object.keys(plane.record.dictionaries[0].dicts).sort()), JSON.stringify(['en', 'zh'])),
      is('zh and en carry the same key set', JSON.stringify(Object.keys(en).sort()), JSON.stringify(Object.keys(zh).sort())),
      is('every key a t(...) call names is in the dictionary', JSON.stringify(used.filter((key) => Object.prototype.hasOwnProperty.call(zh, key) === false)), '[]'),
      is('the keys this half really asks for, in source order (the item title first, then the tab copy)', JSON.stringify(used), JSON.stringify(['panel.item.title', 'tab.title', 'tab.title', 'tab.description'])),
      is('the namespace is not empty (the reading above is about real words)', Object.keys(zh).length > 0, true),
    ])
  },
})

// ------------------------------------------- 23. the tab registration shape is the delivered one
defineReading({
  id: 23,
  name: 'tab-type-registration-shape-unchanged',
  catches: 'the delivered tab face moving: an id, a kind, a band, a guide order or one of the two zh guide strings that the live gates read off this registration, or the two slot keys this half fills',
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane()
    plane.apply(loaded.half)
    const tab = plane.record.tabTypes[0]
    if (tab === undefined) return { notMeasured: 'the half registered no tab type at all' }
    return verdict([
      is('exactly one tab type is registered', plane.record.tabTypes.length, 1),
      is('its id is the one the body and title slots are keyed by', tab.id, 'dsh-browser:panel'),
      is('its kind is what openTab names', tab.kind, 'browser'),
      is('its band is still builtin', tab.priority, 'builtin'),
      is('it carries exactly these fields', JSON.stringify(Object.keys(tab)), JSON.stringify(['id', 'kind', 'priority', 'title', 'guide'])),
      is('the chip title is its own zh dictionary value', tab.title(), '浏览器'),
      is('one guide entry, at order 20', JSON.stringify(tab.guide.map((entry) => entry.order)), JSON.stringify([20])),
      is('the guide entry carries exactly these fields', JSON.stringify(Object.keys(tab.guide[0])), JSON.stringify(['order', 'title', 'description', 'icon'])),
      is('the guide title is the same dictionary value', tab.guide[0].title(), '浏览器'),
      is('the guide description is byte-identical to the literal it replaced', tab.guide[0].description(), '打开受控 Chrome 的实时画面：恒定分辨率，可缩放、可拖动滚动条，可多开与回收。'),
      is('the glyph is still this half own component', typeof tab.guide[0].icon, 'function'),
      is('the two slots this half fills are the ones it always filled', JSON.stringify(plane.record.slotNames), JSON.stringify(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])),
      is('the tab type registration is bound to the plugin lifetime through ctx.effect', plane.record.effects.includes('dsh-browser: browser tab type'), true),
    ])
  },
})

// ------------------------------------------- 24. the panel item, as declared
defineReading({
  id: 24,
  name: 'the-action-item-carries-its-own-words-and-a-callable-invoke',
  catches: 'a declared item whose kind is not action, whose title is a sentence spelled at the call site instead of this package dictionary, an action with no callable invoke, or a declaration smuggled in without ctx.effect',
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane()
    plane.apply(loaded.half)
    const item = plane.record.declarations[0]
    const zh = plane.dictionary('zh')
    const en = plane.dictionary('en')
    if (item === undefined) return { notMeasured: 'the half declared no item into the seam, so the item face cannot be judged' }
    return verdict([
      is('exactly one item is declared', plane.record.declarations.length, 1),
      is('the id is this package own, namespaced', item.id, 'dsh-browser:open-panel'),
      is('the kind is the panel word for something to do', item.kind, 'action'),
      is('the source is this package', item.source, 'dsh-browser'),
      is('the order is finite and inside the panel own range', Number.isFinite(item.order) && item.order > 0 && item.order < 40, true),
      is('the title is what its own zh dictionary says, verbatim', item.title(), zh['panel.item.title']),
      is('and it is not the en value (the dictionary really carries both)', item.title() === en['panel.item.title'], false),
      is('an action carries no body (a thing to do is not a reading)', Object.prototype.hasOwnProperty.call(item, 'body'), false),
      is('invoke is a function', typeof item.invoke, 'function'),
      is('it carries exactly these fields', JSON.stringify(Object.keys(item)), JSON.stringify(['id', 'kind', 'source', 'order', 'title', 'invoke'])),
      is('the contribution is bound to the plugin lifetime through ctx.effect', plane.record.effects.includes('dsh-browser: panel action'), true),
    ])
  },
})

// ------------------------------------------- 25. invoke really opens its own type
defineReading({
  id: 25,
  name: 'invoke-calls-openTab-with-the-kind-it-registered',
  catches: 'an invoke that opens the wrong type or nothing at all: it must call the right column openTab exactly once, with the kind READ out of the very registration object this half handed the tab registry, and record what it did in this package own marker',
  mutants: ['empty-invoke'],
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane()
    plane.apply(loaded.half)
    const tab = plane.record.tabTypes[0]
    const item = plane.record.declarations[0]
    if (tab === undefined || item === undefined) return { notMeasured: 'no tab type or no declared item, so invoke has nothing to be judged against' }
    item.invoke()
    const marker = globalThis.__dshBrowserPanel ?? null
    return verdict([
      is('openTab was called exactly once', plane.record.openTabCalls.length, 1),
      is('with the kind the tab registration itself carries', plane.record.openTabCalls[0], tab.kind),
      is('that kind is a non-empty string', typeof tab.kind === 'string' && tab.kind.length > 0, true),
      is('invoke itself recorded no failure', field(marker, 'lastInvoke.failed') ?? null, null),
      is('the marker reports one ask', field(marker, 'invokes') ?? null, 1),
      is('the marker names the kind it passed', field(marker, 'lastInvoke.kind') ?? null, tab.kind),
      is('the declaration own record names the same tab kind', field(marker, 'tabKind') ?? null, tab.kind),
      is('the marker carries data only, never a function', Object.values(field(marker, 'lastInvoke') ?? {}).every((value) => typeof value !== 'function'), true),
    ])
  },
})

// ------------------------------------------- 26. no panel, no locale: not a throw
defineReading({
  id: 26,
  name: 'a-page-with-no-panel-and-no-locale-still-works',
  catches: 'a half that throws (or claims to have contributed) on a page with no linkPanel and no locale service: such a page must keep its tab type, its two slots and its own words, and the absence must be NAMED in this package own marker',
  mutants: ['absent-throws'],
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane({ linkPanel: 'absent', locale: 'absent' })
    plane.apply(loaded.half)
    const marker = globalThis.__dshBrowserPanel ?? null
    const tab = plane.record.tabTypes[0]
    return verdict([
      is('apply() threw nothing', plane.record.threw, null),
      is('apply() really ran to the end', plane.record.applied, true),
      is('nothing was declared into a seam that is not there', plane.record.declarations.length, 0),
      is('the marker says nothing was declared', marker === null ? null : marker.declared, false),
      is('the marker NAMES what was missing', typeof (marker === null ? null : marker.failed) === 'string' && marker.failed.startsWith('linkPanel-unavailable'), true),
      is('the tab type is still registered', tab === undefined ? null : tab.id, 'dsh-browser:panel'),
      is('the two slots are still filled', plane.record.slotNames.length, 2),
      is('the words still answer, from this package own dictionary', tab === undefined ? null : tab.title(), '浏览器'),
      is('the marker still names the item that was not declared', marker === null ? null : marker.id, 'dsh-browser:open-panel'),
    ])
  },
})

// ------------------------------------------- 27. a refusal is contained, wherever it comes from
defineReading({
  id: 27,
  name: 'a-refusing-declare-or-openTab-is-contained',
  catches: 'a refusal that escapes: the panel refusing the item, the right column absent, or openTab throwing (its own "no session surface is mounted") must each be caught, named in this package own marker with the service own words, and must not break the page. It is also moved by empty-invoke: with nothing asked, nothing can be recorded',
  mutants: ['absent-throws', 'empty-invoke'],
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    // (a) the panel is there and refuses the item.
    const refused = clientPlane({ declare: 'refuses' })
    refused.apply(loaded.half)
    const refusedMarker = globalThis.__dshBrowserPanel ?? null
    // (b) the panel takes it, the column is there, and openTab throws.
    const throwing = clientPlane({ openTab: 'refuses' })
    throwing.apply(loaded.half)
    const throwingItem = throwing.record.declarations[0]
    const threw = throwingItem === undefined ? { thrown: 'no declaration' } : await expectThrow(() => throwingItem.invoke())
    const throwingMarker = globalThis.__dshBrowserPanel ?? null
    // (c) the panel takes it and there is no column at all.
    const absent = clientPlane({ sidebarRight: 'absent' })
    absent.apply(loaded.half)
    const absentItem = absent.record.declarations[0]
    const absentThrew = absentItem === undefined ? { thrown: 'no declaration' } : await expectThrow(() => absentItem.invoke())
    const absentMarker = globalThis.__dshBrowserPanel ?? null
    return verdict([
      is('a refusing panel does not break apply()', refused.record.threw, null),
      is('the refusal is named, not swallowed', String(field(refusedMarker, 'failed') ?? '').startsWith('linkPanel-declare-refused'), true),
      is('and it carries the panel own words', String(field(refusedMarker, 'failed') ?? '').includes('PANEL_DUP_ID'), true),
      is('the rest of the half still registered', refused.record.tabTypes.length, 1),
      is('a throwing openTab does not escape invoke', threw.thrown, null),
      is('nothing was opened by the refusal', throwing.record.openTabCalls.length, 0),
      is('the refusal is named with the service own sentence', String(field(throwingMarker, 'lastInvoke.failed') ?? '').includes('no session surface is mounted'), true),
      is('the marker says the ask failed', field(throwingMarker, 'lastInvoke.ok') ?? null, false),
      is('the marker still counted the ask', field(throwingMarker, 'invokes') ?? null, 1),
      is('an absent column does not escape invoke either', absentThrew.thrown, null),
      is('and it is named as absent', String(field(absentMarker, 'lastInvoke.failed') ?? '').startsWith('sidebarRight-unavailable'), true),
    ])
  },
})

// ------------------------------------------- 28. a language switch reaches the panel
defineReading({
  id: 28,
  name: 'a-language-switch-reaches-the-seam-through-notify',
  catches: 'a row whose words are frozen at declaration time (the panel would keep drawing the old language), or a half that watches for the switch on a timer of its own instead of the locale service subscription',
  async run({ mutation }) {
    const loaded = loadOrNotMeasured(mutation)
    if (loaded.notMeasured !== undefined) return { notMeasured: loaded.notMeasured }
    const plane = clientPlane()
    // An event, not a cadence: the half must start NO timer of its own while applying.
    const timers = []
    const realSetInterval = globalThis.setInterval
    globalThis.setInterval = (...args) => { timers.push('setInterval'); return realSetInterval(...args) }
    try {
      plane.apply(loaded.half)
    } finally {
      globalThis.setInterval = realSetInterval
    }
    const item = plane.record.declarations[0]
    const tab = plane.record.tabTypes[0]
    if (item === undefined || tab === undefined) return { notMeasured: 'no declared item or no tab type, so nothing can be watched across a language switch' }
    const before = item.title()
    plane.switchLanguage('en')
    const en = plane.dictionary('en')
    return verdict([
      is('the half subscribed to the locale service exactly once', plane.record.localeSubscribers, 1),
      is('the half started NO timer of its own', JSON.stringify(timers), '[]'),
      is('the title followed the switch', item.title(), en['panel.item.title']),
      is('and it is not the zh value any more', item.title() === before, false),
      is('the switch was announced to the seam through its own notify()', plane.record.notifications, 1),
      is('the item was not re-declared to change language', plane.record.declarations.length, 1),
      is('the tab type words follow the switch too', tab.title(), en['tab.title']),
    ])
  },
})

// ------------------------------------------------------------- the runner
const MUTATIONS = {
  'ignore-tab': 'cdp and tab-goto serve the ACTIVE tab whatever tab was named',
  'ignore-holder': 'the lease rule and the takeover record are skipped',
  'silent-cap': 'tab-new at the cap answers 200 without creating anything',
  'no-count': 'the op=state report drops limit',
  'stale-readback': 'the first op=state after a write answers the report from BEFORE it',
  'first-tab': 'closing the active tab activates the first tab instead of the left one',
  'no-redirect': 'the world does not redirect, so the landing equals the request',
}

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const mutateArg = argv.find((arg) => arg.startsWith('--mutate='))
const mutate = mutateArg === undefined ? null : mutateArg.slice('--mutate='.length)

// The plugin logs through the console; those lines are not readings here.
const realLog = console.log.bind(console)
const realWarn = console.warn.bind(console)
const realError = console.error.bind(console)
console.log = (...args) => { if (args[0] !== '[dsh-browser]') realLog(...args) }
console.warn = (...args) => { if (args[0] !== '[dsh-browser]') realWarn(...args) }
console.error = (...args) => { if (args[0] !== '[dsh-browser]') realError(...args) }

/**
 * The world a reading gets: its own options, plus the WORLD lie this run is asking
 * for. A BUNDLE_MUTATIONS name is a lie told to lib/client.js instead, so it is
 * never handed to the fake panel (which would ignore it and quietly judge the
 * delivered world).
 */
function worldOptions(definition, mutation) {
  const options = { ...(definition.world ?? {}) }
  if (mutation === null) return options
  if (Object.prototype.hasOwnProperty.call(BUNDLE_MUTATIONS, mutation)) return options
  if (mutation === 'no-redirect') delete options.redirect
  else options.mutate = mutation
  return options
}

if (listOnly) {
  realLog('panel-tabs-selfcheck readings (' + readingDefs.length + '):')
  for (const definition of readingDefs) {
    realLog('  ' + String(definition.id).padStart(2) + '  ' + definition.name)
    realLog('      catches: ' + definition.catches)
    realLog('      goes red under: ' + ((definition.mutants ?? []).length === 0 ? 'nothing named (its falsifier is in catches)' : definition.mutants.join(', ')))
  }
  realLog('lies the WORLD can be asked to tell: ' + Object.keys(MUTATIONS).join(', '))
  realLog('lies the CLIENT HALF bytes can be asked to tell: ' + Object.keys(BUNDLE_MUTATIONS).join(', '))
  process.exit(0)
}

const KNOWN_MUTATIONS = [...Object.keys(MUTATIONS), ...Object.keys(BUNDLE_MUTATIONS)]
if (mutate !== null && !KNOWN_MUTATIONS.includes(mutate)) {
  realLog('NOT MEASURED: unknown mutation ' + JSON.stringify(mutate) + '; known ones: ' + KNOWN_MUTATIONS.join(', '))
  process.exit(3)
}
/** The lie this run tells the artifact's bytes, or null. */
const bundleMutation = mutate !== null && Object.prototype.hasOwnProperty.call(BUNDLE_MUTATIONS, mutate) ? BUNDLE_MUTATIONS[mutate] : null

async function runReading(definition) {
  const world = createFakePanel(worldOptions(definition, mutate))
  world.origin = await world.listen()
  let outcome
  try {
    const tools = await toolsFor({ world, channel: 'panel' })
    outcome = await Promise.race([
      definition.run({ world, tools, mutation: bundleMutation }),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 30000)),
    ])
  } catch (error) {
    outcome = { ok: false, detail: 'the reading itself threw: ' + String(error?.stack ?? error).split(String.fromCharCode(10)).slice(0, 3).join(' | ') }
  }
  try {
    await world.close()
  } catch {
    // the fixture is gone either way
  }
  if (outcome?.notMeasured !== undefined) return { id: definition.id, state: 'not-measured', detail: String(outcome.notMeasured) }
  if (outcome?.timedOut === true) return { id: definition.id, state: 'failed', detail: 'the reading did not finish inside 30 s' }
  return { id: definition.id, state: outcome?.ok === true ? 'ok' : 'failed', detail: String(outcome?.detail ?? '(no detail)') }
}

const results = []
for (const definition of readingDefs) {
  const result = await runReading(definition)
  results.push({ ...result, name: definition.name })
  const label = result.state === 'ok' ? 'ok  ' : result.state === 'not-measured' ? 'NOT ' : 'FAIL'
  realLog(label + ' ' + String(result.id).padStart(2) + ' ' + definition.name + ': ' + result.detail)
}

const failed = results.filter((result) => result.state === 'failed')
const notMeasured = results.filter((result) => result.state === 'not-measured')
const worldLabel = mutate === null
  ? 'clean world'
  : bundleMutation === null
    ? 'mutated world: ' + mutate + ' - ' + MUTATIONS[mutate]
    : 'mutated client half bytes: ' + mutate + ' - ' + bundleMutation.what

if (mutate === null) {
  realLog('panel-tabs-selfcheck: ' + results.length + ' readings, ' + failed.length + ' failed, ' + notMeasured.length + ' not measured [' + worldLabel + ']')
  if (notMeasured.length > 0) {
    realLog('NOT MEASURED: ' + notMeasured.map((result) => result.id + ' ' + result.name + ' -> ' + result.detail).join(' | '))
    process.exit(3)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

const declared = readingDefs.filter((definition) => (definition.mutants ?? []).includes(mutate)).map((definition) => definition.id)
const observed = failed.map((result) => result.id)
const unexpected = observed.filter((id) => !declared.includes(id))
const missed = declared.filter((id) => !observed.includes(id))
realLog('panel-tabs-selfcheck --mutate=' + mutate + ': declared-red [' + declared.join(', ') + '], observed-red [' + observed.join(', ') + '], unexpected [' + unexpected.join(', ') + '], missed [' + missed.join(', ') + ']')
if (notMeasured.length > 0) {
  realLog('NOT MEASURED: ' + notMeasured.map((result) => result.id + ' ' + result.name + ' -> ' + result.detail).join(' | '))
  process.exit(3)
}
if (missed.length === 0 && unexpected.length === 0) {
  realLog('the lie was caught where it was declared, and nowhere else')
  process.exit(0)
}
realLog('the lie was NOT caught as declared: missed [' + missed.join(', ') + '], unexpected [' + unexpected.join(', ') + ']')
process.exit(1)
