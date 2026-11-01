#!/usr/bin/env node
/**
 * The pack, held to what the tree says and to what it is allowed to ship.
 *
 * `verify-all` proves each plugin works. Nothing proved that the set of plugins is knowable, or
 * that the licences under which they ship cover them. Both are inventory questions, and both are
 * answered the same way: derive the answer from the tree and refuse a hand-written one.
 *
 *   1  the manifest is what the tree says      pack/pack.json equals a fresh generation
 *   2  rows are unique and exist              a duplicate row id is a composition conflict
 *   3  counts are not hand-edited             the summary equals the arrays it summarises
 *   4  every plugin declares a licence        `none` is a refusal, not a default
 *   5  the licence text is consolidated       one copy of MIT covers all the MIT packages
 *   6  copyleft needs a decision              GPL/AGPL/LGPL fail until the pack says otherwise
 *
 * Run:  node scripts/verify-pack.mjs
 * Exit: 0 every check held; 1 a check failed; 2 the tree or the manifest is unreadable.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPack } from './build-pack.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(PROJECT, 'pack', 'pack.json')
const TAURI_CONF = join(PROJECT, 'src-tauri', 'tauri.conf.json')
const LICENCES = join(PROJECT, 'pack', 'LICENSES.md')
const NOTICES = join(PROJECT, 'THIRD-PARTY-NOTICES.md')
const PLUGINS = join(PROJECT, 'plugins')
/** The repository root, which is what `git ls-files` must be asked about. */
const REPO = resolve(PROJECT, '..')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}

const generated = buildPack()
if (!existsSync(MANIFEST)) {
  console.error('no manifest at ' + MANIFEST + '; run node scripts/build-pack.mjs')
  process.exit(2)
}
const onDisk = readFileSync(MANIFEST, 'utf8')
const manifest = JSON.parse(onDisk)

// ---------------------------------------------------------------- 1 derived, not written
{
  const same = JSON.stringify(manifest) === JSON.stringify(generated);
  const added = generated.plugins.filter((plugin) => !manifest.plugins.some((row) => row.id === plugin.id)).map((plugin) => plugin.id);
  const removed = manifest.plugins.filter((row) => !generated.plugins.some((plugin) => plugin.id === row.id)).map((row) => row.id);
  record('1 pack/pack.json is what the plugin tree says',
    same,
    same ? String(manifest.plugins.length) + ' plugins, derived'
      : 'missing from the manifest: ' + JSON.stringify(added) + '; no longer in the tree: ' + JSON.stringify(removed));
}

// ---------------------------------------------------------------- 2 rows
{
  const seen = new Map()
  const duplicates = []
  for (const plugin of manifest.plugins) {
    for (const row of plugin.rows) {
      if (seen.has(row)) duplicates.push(row + ' (' + seen.get(row) + ' and ' + plugin.id + ')')
      else seen.set(row, plugin.id)
    }
  }
  const orphanRows = [...seen.keys()].filter((row) => {
    const owner = seen.get(row)
    const plugin = manifest.plugins.find((row) => row.id === owner)
    return plugin === undefined || !plugin.bundlePatches.some((patch) => existsSync(join(PLUGINS, directoryOf(plugin.id), patch)))
  });
  record('2 every row is unique and belongs to a patch that exists',
    duplicates.length === 0 && orphanRows.length === 0,
    duplicates.length > 0 ? 'duplicate rows: ' + JSON.stringify(duplicates)
      : orphanRows.length > 0 ? 'rows with no patch file: ' + JSON.stringify(orphanRows)
        : String(seen.size) + ' rows across ' + String(manifest.plugins.length) + ' plugins');
}

/** The directory a plugin id lives in, which is its package name by convention here. */
function directoryOf(id) {
  return id;
}

// ---------------------------------------------------------------- 3 counts
{
  const expected = generated.counts;
  const same = JSON.stringify(manifest.counts) === JSON.stringify(expected);
  record('3 the summary counts equal the arrays they summarise', same,
    same ? JSON.stringify(manifest.counts) : 'manifest ' + JSON.stringify(manifest.counts) + ' vs tree ' + JSON.stringify(expected));
}

// ---------------------------------------------------------------- 4-8 licences
const MIT_SENTENCE = /Permission is hereby granted, free of charge, to any person obtaining a copy/g

/**
 * Every file in this repository that claims to carry licence text.
 *
 * **Tracked**, not merely present on disk, and the distinction is the point: the WebView2 fixed
 * runtime the shell downloads carries GPL-3.0 and proprietary licence files and is gitignored, so it
 * is not redistributed by this repository; demanding notices for it would let a downloaded binary
 * decide this project's licence surface. A file that IS tracked and carries licence text is one we
 * ship, and every one of those has to be accounted for.
 *
 * @returns repo-relative paths under `dsh-link/`, sorted.
 */
function licenceFiles() {
  const listed = execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  // R119: a vendored third-party copy under vendor/<name>/ keeps UPSTREAM's bytes on purpose (that is what
  // <name>.lock.json folds), so it cannot be reshaped into this repository's one-text accounting, and nothing
  // in it is part of the shipped pack. It is out of this enumeration but NOT out of accounting: reading 7
  // additionally requires every vendor/<name> to be pinned by <name>.pin.json and folded by <name>.lock.json,
  // so the class cannot become a place to drop licence text nobody looked at. The 23 files this first brought
  // in (dsh-ops' own MIT/Apache pair plus FastCtx's bundled PDFium/ICU component texts) are named in
  // docs/handoff/R119-dsh-ops-mounted.md and carried as a compliance debt before any distribution that
  // includes the 127 MB payloads.
  return listed.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('dsh-link/') && /(^|\/)(LICEN[CS]E|COPYING)/i.test(line))
    .map((line) => line.slice('dsh-link/'.length))
    .filter((line) => line.startsWith('vendor/') === false)
    .sort()
}

{
  const licences = existsSync(LICENCES) ? readFileSync(LICENCES, 'utf8') : '';
  const unlicensed = manifest.plugins.filter((plugin) => plugin.license === 'none').map((plugin) => plugin.id);
  const thirdPartyMissingFile = manifest.plugins
    .filter((plugin) => plugin.origin === 'third-party' && plugin.licenseFile === null)
    .map((plugin) => plugin.id);
  const thirdPartyUnlisted = manifest.plugins
    .filter((plugin) => plugin.origin === 'third-party' && !licences.includes('`' + plugin.id + '`'))
    .map((plugin) => plugin.id);
  record('4 every plugin declares a licence, and borrowed code names its own text',
    unlicensed.length === 0 && thirdPartyMissingFile.length === 0 && thirdPartyUnlisted.length === 0,
    'declares-none=' + JSON.stringify(unlicensed) + ' thirdPartyWithoutFile=' + JSON.stringify(thirdPartyMissingFile)
    + ' thirdPartyUnlisted=' + JSON.stringify(thirdPartyUnlisted) + ' thirdParty=' + String(manifest.counts.thirdParty));

  // A copyleft package needs an entry that names it. Matching a heading anywhere in the file let one
  // line admit every copyleft package at once, and the check's own detail printed the uncovered
  // packages while still reporting success — a gate that describes a failure and then passes.
  const permissive = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense']
  const copyleft = manifest.plugins
    .filter((plugin) => plugin.license.split(/\s+(?:OR|AND)\s+/).some((term) => !permissive.includes(term)))
    .map((plugin) => plugin)
  const uncovered = copyleft.filter((plugin) => !new RegExp('\\|\\s*`?' + plugin.id + '`?\\s*\\|').test(licences)).map((plugin) => plugin.id + '/' + plugin.license)
  record('5 a copyleft or unusual licence needs an entry naming that package',
    uncovered.length === 0,
    uncovered.length === 0 ? (copyleft.length === 0 ? 'only permissive licences are declared: ' + JSON.stringify(Object.keys(manifest.licenses))
      : 'covered by name: ' + JSON.stringify(copyleft.map((plugin) => plugin.id)))
      : 'not covered by the pack licence file: ' + JSON.stringify(uncovered))

  // One copy of the text for every package it covers, counted across the whole repository, and every
  // licence file either listed in the merged notice or pointing at it.
  const files = licenceFiles()
  // "One copy" is about OUR text: vendored runtimes carry their holders' texts and are accounted for
  // by the notices file instead, so counting every MIT sentence in the tree would demand that we
  // delete other people's licences.
  const ours = /Copyright \(c\) 2026 DSH Link contributors/
  const withText = files.filter((file) => {
    const text = existsSync(join(PROJECT, file)) ? readFileSync(join(PROJECT, file), 'utf8') : ''
    return (text.match(MIT_SENTENCE) ?? []).length > 0 && ours.test(text)
  })
  const mitOwners = manifest.licenses.MIT ?? []
  const unlisted = mitOwners.filter((id) => !licences.includes('`' + id + '`'))
  // One copy means one: the canonical root `LICENSE`.
  const CANONICAL = 'LICENSE'
  const canonicalPresent = files.includes(CANONICAL)
  const strayCopies = withText.filter((file) => file !== CANONICAL)
  record('6 one copy of the MIT text covers every MIT package, and each is listed',
    canonicalPresent && (mitOwners.length === 0 ? withText.length === 0 : withText.length === 1 && withText[0] === CANONICAL && unlisted.length === 0 && strayCopies.length === 0),
    'canonicalPresent=' + String(canonicalPresent) + ' textCopies=' + String(withText.length) + ' stray=' + JSON.stringify(strayCopies)
    + ' mitPackages=' + String(mitOwners.length) + ' unlisted=' + JSON.stringify(unlisted));

  // Every licence file in the tree is accounted for: the merged notice, a pointer to it, or a file
  // the notice names. An unaccounted file is how a fourth copy of a text travels unnoticed.
  const notices = existsSync(NOTICES) ? readFileSync(NOTICES, 'utf8') : ''
  const accounted = files.filter((file) => file.endsWith('pack/LICENSES.md')
    || notices.includes(file)
    || licences.includes(file.split('/').slice(-2).join('/'))
    || /pack\/LICENSES\.md/.test(readFileSync(join(PROJECT, file), 'utf8')))
  const unaccounted = files.filter((file) => !accounted.includes(file))
  // Copyleft found in the tree is named in the result, so a reader sees it in the gate output rather
  // than only in the notices file: the point is that it is accounted for, not that it is absent.
  // The whole file, not its first lines: a copyleft text appended below a permissive header is still a
  // copyleft text we would be shipping, and a scan that stops early reports the opposite.
  const copyleftFiles = files.filter((file) => /GNU (GENERAL|LESSER|AFFERO) PUBLIC|GNU (GENERAL|LESSER|AFFERO) LICENSE/i.test(existsSync(join(PROJECT, file)) ? readFileSync(join(PROJECT, file), 'utf8') : ''))
  // R119: the vendored third-party class is out of the enumeration above but NOT out of accounting: every
  // tree under vendor/ must be pinned by <name>.pin.json and folded by <name>.lock.json, so this class cannot
  // become somewhere to drop licence text nobody looked at.
  const vendoredTrees = existsSync(join(PROJECT, 'vendor'))
    ? readdirSync(join(PROJECT, 'vendor'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : []
  const vendoredUnpinned = vendoredTrees.filter((name) => !(existsSync(join(PROJECT, name + '.pin.json')) && existsSync(join(PROJECT, name + '.lock.json'))))
  record('7 every licence file in the tree is the merged one, a pointer to it, or named by the notices',
    unaccounted.length === 0 && copyleftFiles.length === 0 && vendoredUnpinned.length === 0,
    'files=' + String(files.length) + ' copyleftFiles=' + JSON.stringify(copyleftFiles) + ' unaccounted=' + JSON.stringify(unaccounted)
    + ' vendoredTrees=' + JSON.stringify(vendoredTrees) + ' vendoredUnpinned=' + JSON.stringify(vendoredUnpinned));

  // A copyleft identifier in our own sources is the one place a licence problem is invisible to every
  // other check: the package says MIT, the manifest says MIT, and the file says otherwise.
  const offenders = []
  const scan = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) { if (!['node_modules', '.tmp'].includes(entry.name)) scan(next); continue }
      if (!/\.(ts|js|mjs|cjs)$/.test(entry.name)) continue
      const text = readFileSync(next, 'utf8')
      const match = /SPDX-License-Identifier:\s*([^\n*]+)/.exec(text)
      if (match !== null && /GPL|AGPL|LGPL|SSPL|CPAL|OSL/i.test(match[1])) offenders.push(next.replace(PROJECT, '') + ': ' + match[1].trim())
    }
  }
  scan(PLUGINS)
  record('8 no source file in this repository declares a copyleft licence', offenders.length === 0,
    offenders.length === 0 ? 'scanned plugins/ for SPDX identifiers' : JSON.stringify(offenders));
}


// ---------------------------------------------------------------- 9 no vendored runtime
{
  // A decision that only lives in a commit message gets undone by the next person who wants a
  // predictable rendering engine: shipping Microsoft's fixed runtime was exactly that trade, and it
  // put GPL-3.0 texts into the distribution. The packaging config is where the decision is enforced.
  const tauri = existsSync(TAURI_CONF) ? JSON.parse(readFileSync(TAURI_CONF, 'utf8')) : null
  const mode = tauri?.bundle?.windows?.webviewInstallMode ?? null
  const vendored = mode !== null && typeof mode.type === 'string' && mode.type.toLowerCase().includes('fixedruntime')
  // Packing the runtime as a resource would ship it just as surely as the fixed-runtime mode did, so
  // the check reads the whole configuration for the name rather than one field that was the last place
  // it appeared.
  const confText = existsSync(TAURI_CONF) ? readFileSync(TAURI_CONF, 'utf8') : ''
  const mentioned = /webview2-fixed/i.test(confText)
  const vendoredCopy = existsSync(join(PROJECT, 'src-tauri', 'webview2-fixed', 'msedgewebview2.exe'))
  record('9 the shell bundles no vendored WebView2 runtime',
    vendored === false && mentioned === false,
    'webviewInstallMode=' + JSON.stringify(mode) + ' confMentionsVendoredPath=' + String(mentioned)
    + ' vendoredCopyOnDisk(unused)=' + String(vendoredCopy))
}

const failed = results.filter((row) => !row.ok)
console.log('')
console.log(results.length + ' checks, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)