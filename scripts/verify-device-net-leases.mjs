#!/usr/bin/env node
/**
 * R70 (task-126): the lease is PUBLIC — the protocol page and the shipped module agree, and that
 * agreement is measured rather than quoted.
 *
 * Why a NEW gate instead of extending scripts/verify-device-net-protocol.mjs: that gate's subject is the
 * citation table and its own coverage; this one's subject is the lease fact crossing TWO artifacts (the
 * page a foreign harness reads, and the shipped module it must imitate). Keeping them apart means a red
 * lease reading is not confused with a red transport reading, and the shipped gate's tuned mutants and
 * declared sets are not re-opened from the side.
 *
 * Every reading here is measured: the page is parsed (not quoted back), the module is imported, and the
 * two promises the page makes (equality means expired; the smallest end wins) are re-checked by running
 * the shipped function against worlds this gate builds.
 *
 * Readings after R70's takeover: R1a/R1b/R1c state the page's promise as a SUBSET — every kind the page
 * lists is one the module can read, the page says what it does NOT promise, and the number of promised
 * kinds is asserted so a row cannot quietly disappear. R2 measures the checker's closed blind spot: a
 * fragment is the row's complete remaining text, the old third-cell parse is simulated and shown green on
 * a FATAL copy, and the fixed checker refuses that same copy. R3 reads every citation row against the
 * shipped line it names, and requires the page to name both refusal words. R4-R8 measure the lease
 * promises against a real foreign harness and against the shipped functions.
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (the page or the module, printed).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : resolve(argv[at + 1]) }
// A --self-attack copy of this file lives under .tmp, where ".." is not the project. Everything that is
// read, spawned or written is resolved from ROOT, which the parent passes on to its children.
const ROOT = option('--root', PROJECT)
const PAGE = option('--page', join(ROOT, 'docs', 'protocol', 'device-net-v1.md'))
const MODULE = option('--module', join(ROOT, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))
// The checker is resolved once and handed to every child: a gate-mutant copy of this file lives under
// .tmp, where ".." is not the project, so the path may not be re-derived from the copy's own location.
const CHECKER = option('--checker', join(ROOT, 'scripts', 'check-protocol-page.mjs'))
const SELF_ATTACK = argv.includes('--self-attack')
const ATTACK_PAGE = process.env.R70_ATTACK_PAGE ?? null
const ATTACK_MODULE = process.env.R70_ATTACK_MODULE ?? null
const NL = String.fromCharCode(10)
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'
// R70 (ruling 1): R1 states the page's promise as a SUBSET — the page names seven of the fifteen kinds
// the module can read, and "every kind the page lists is readable" is the promise that exists. The three
// legs are separate readings because they fail for three different reasons.
const DECLARED = 11
const MODULE_READING_IDS = ['R1a', 'R1b', 'R1c', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
const LEASE_KIND = 'task/retry-lease'
/** The page's own statement that the kinds it does NOT list still exist (line 55 of the page). */
const NOT_PROMISED = 'kind 存在且可读'
const NOT_PROMISED_TAIL = '不写成承诺'
/** How many kinds the page lists. A row that vanishes must be a red reading, not a quieter page. */
const PAGE_KIND_COUNT = 7
/** The facts the page must cite a shipped line for (any one row may carry each). */
const REQUIRED_CITATIONS = [
  { id: 'lease-kind', any: ['task/retry-lease'] },
  { id: 'lease-record-builder', any: ['function retryLeaseRecord('] },
  { id: 'lease-owner', any: ['function retryOwner('] },
  { id: 'lease-liveness-strict', any: ['options.now - lease.at < lease.untilMs'] },
  // Ruling 1: the two refusal words are read as the words themselves, in whatever needle carries them.
  // The page cites the SHIPPED SOURCE, where the reasons are written with single quotes, so a needle
  // spelled with double quotes could never match — and neither word needs a citation row of its own.
  { id: 'lease-held-word', any: ['lease-held'] },
  { id: 'lease-mismatch-word', any: ['lease-mismatch'] },
  { id: 'lease-in-readable-kinds', any: ['RETRY_LEASE_KIND]', 'RETRY_LEASE_KIND,'] },
  { id: 'lease-before-attempt', any: ['retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs)'] },
]
const results = []
const record = (id, ok, detail) => { results.push({ id, ok: ok === true }); console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + '  ' + detail) }
const dumps = (value) => JSON.stringify(value)
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)
const MADE = []
const SERVERS = []
const ROUTE = '/api/dsh-link-collab/relay'
const TOKEN = 'r70-token-' + Date.now().toString(36)
const FOREIGN = join(ROOT, 'tools', 'foreign-harness', 'foreign-end.mjs')
const workdir = () => { mkdirSync(join(ROOT, '.tmp'), { recursive: true }); const dir = mkdtempSync(join(ROOT, '.tmp', 'r70-')); MADE.push(dir); return dir }

/* ------------------------------------------------ the two artifacts, parsed rather than quoted */

/** Every kind name the page lists in a markdown table with a `kind` column. */
function pageKinds(text) {
  const kinds = new Set()
  const lines = text.split(NL)
  let inTable = false
  for (const line of lines) {
    const cells = line.trim().startsWith('|') ? line.trim().split('|').slice(1, -1).map((cell) => cell.trim()) : null
    if (cells === null) { inTable = false; continue }
    if (!inTable) { inTable = cells.some((cell) => cell === 'kind'); continue }
    if (cells.every((cell) => /^-{2,}$/.test(cell))) continue
    const first = cells[0] ?? ''
    const match = /^`([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)`$/.exec(first)
    if (match !== null) kinds.add(match[1])
  }
  return [...kinds].sort()
}

/** The kinds the shipped module says it can read, resolved through its own constants. */
function moduleKinds(text) {
  const constants = new Map()
  for (const match of text.matchAll(/var ([A-Z_]+_KIND) = "([^"]+)";/g)) constants.set(match[1], match[2])
  const line = /var READABLE_KINDS = \[([^\]]*)\];/.exec(text)
  if (line === null) return null
  return [...line[1].matchAll(/([A-Z_]+_KIND)/g)].map((match) => constants.get(match[1])).filter((value) => typeof value === 'string')
}

/**
 * A citation row read the way scripts/check-protocol-page.mjs reads it after its blind-spot fix: the
 * fragment is the COMPLETE remaining text of the row, so a pipe inside a fragment is visible instead of
 * being silently cut away. The naive parse (third cell only) is kept beside it so R2 can measure the
 * difference instead of asserting it.
 */
function citationCells(line) {
  return line.trim().split('|').slice(1, -1).map((cell) => cell.trim())
}
function citationLineOf(text, id) {
  const start = text.indexOf(BEGIN)
  const stop = text.indexOf(END)
  if (start === -1 || stop === -1) return null
  for (const line of text.slice(start, stop).split(NL)) {
    if (!line.trim().startsWith('|')) continue
    const cells = citationCells(line)
    if (cells.length < 3 || cells[0] === 'id' || /^-{2,}$/.test(cells[0])) continue
    if (cells[0] === id) return line
  }
  return null
}
/** The citation rows the page declares: id, where (path:line), and the fragment the line must hold. */
function pageCitations(text) {
  const start = text.indexOf(BEGIN)
  const stop = text.indexOf(END)
  if (start === -1 || stop === -1) return null
  const rows = []
  for (const line of text.slice(start, stop).split(NL)) {
    if (!line.trim().startsWith('|')) continue
    const cells = citationCells(line)
    if (cells.length < 3 || cells[0] === 'id' || /^-{2,}$/.test(cells[0])) continue
    // The complete remaining text of the row: every cell after the location, joined back with the pipes
    // that separated them. A fragment carrying a pipe therefore stays a fragment carrying a pipe.
    const must = cells.slice(2).join('|')
    const naive = cells[2] ?? ''
    const split = (value) => (value === '' || value === '-' ? [] : value.split(' ; '))
    rows.push({ id: cells[0], where: cells[1], must, naive, fragments: split(must), naiveFragments: split(naive) })
  }
  return rows
}

/**
 * Resolve rows against the cited files, one needle at a time: a row may carry several fragments and the
 * cited line has to hold every one of them. `needlesOf` decides which fragments a given parse sees.
 */
function resolveRows(rows, needlesOf) {
  const failed = []
  const moved = []
  for (const row of rows) {
    const at = /^(.*):([0-9]+)$/.exec(row.where)
    if (at === null) { failed.push(row.id + ':not-path-line'); continue }
    const text = readText(resolve(ROOT, at[1]))
    if (text === null) { failed.push(row.id + ':file-missing'); continue }
    const line = text.split(NL)[Number(at[2]) - 1] ?? ''
    for (const needle of needlesOf(row)) {
      if (line.includes(needle)) continue
      if (text.includes(needle)) moved.push(row.id + ':' + flat(needle).slice(0, 30))
      else failed.push(row.id + ':' + flat(needle).slice(0, 30))
    }
  }
  return { failed, moved }
}

/** The checker the page is really judged by, run on whichever copy is handed in. */
function checkerExit(pagePath) {
  const result = spawnSync(process.execPath, [CHECKER, '--page', pagePath], { encoding: 'utf8' })
  return { code: result.status, out: flat((result.stdout ?? '') + (result.stderr ?? '')).slice(-160) }
}

/* ------------------------------------------------ the worlds the measured promises need */

function leaseRow(root, end, at, untilMs, seq) { return { root, end, at, untilMs, seq } }

async function runReadings(pagePath, modulePath) {
  const pageText = readText(pagePath)
  if (pageText === null) throw new Error('the page is missing: ' + pagePath)
  const moduleText = readText(modulePath)
  if (moduleText === null) throw new Error('the module is missing: ' + modulePath)
  const mod = await import(pathToFileURL(modulePath).href)
  const now = 100_000

  // R1a (ruling 1): the page's promise is a SUBSET, not an equality. Every kind it lists must be one the
  // module can read, and the lease kind must be on both sides — the page promises seven of the module's
  // fifteen kinds, and "the page never names a kind nobody can read" is the defect this leg names.
  {
    const page = pageKinds(pageText)
    const shipped = moduleKinds(moduleText)
    const notReadable = shipped === null ? ['(the module exposes no READABLE_KINDS array)'] : page.filter((kind) => !shipped.includes(kind))
    const leaseOnPage = page.includes(LEASE_KIND)
    const leaseReadable = shipped !== null && shipped.includes(LEASE_KIND)
    const moduleCarries = moduleText.includes(LEASE_KIND)
    record('R1a', shipped !== null && notReadable.length === 0 && leaseOnPage && leaseReadable && moduleCarries,
      'pageKindCount=' + String(page.length) + ' shippedKindCount=' + String(shipped === null ? 0 : shipped.length)
      + ' pageNotReadable=' + dumps(notReadable) + ' leaseOnPage=' + String(leaseOnPage)
      + ' leaseReadable=' + String(leaseReadable) + ' moduleCarriesLeaseKind=' + String(moduleCarries))
  }

  // R1b: the page must also state what it is NOT promising — that the kinds it does not list exist and
  // are readable. Without that sentence a foreign end cannot tell "not documented" from "not readable".
  {
    const lines = pageText.split(NL)
    const at = lines.findIndex((line) => line.includes(NOT_PROMISED) && line.includes(NOT_PROMISED_TAIL))
    record('R1b', at !== -1,
      'line=' + String(at + 1) + ' text=' + dumps(at === -1 ? null : flat(lines[at]).slice(0, 110)))
  }

  // R1c: the number of kinds the page promises is asserted, so a kind row that quietly disappears is a
  // red reading rather than a smaller page.
  {
    const page = pageKinds(pageText)
    record('R1c', page.length === PAGE_KIND_COUNT,
      'pageKinds=' + String(page.length) + ' declared=' + String(PAGE_KIND_COUNT) + ' kinds=' + dumps(page))
  }

  // R2: the blind spot the checker's fix closed, measured three ways rather than quoted. (i) the fragment
  // this gate parses must be the COMPLETE remaining text of the row, so no needle is silently cut at a
  // pipe; (ii) a copy whose row LIES while keeping a true left half still reads green through the old
  // parse — the old parse is simulated here; (iii) the same copy goes to the fixed checker, which must
  // refuse it while still accepting the shipped page.
  {
    const rows = pageCitations(pageText)
    if (rows === null) throw new Error('the page carries no citation table between ' + BEGIN + ' and ' + END)
    const truncated = rows.filter((row) => row.naive !== row.must).map((row) => row.id)
    const victim = citationLineOf(pageText, 'lease-kind')
    if (victim === null) throw new Error('the page has no citation row named lease-kind to build the blind-spot copy from')
    const where = citationCells(victim)[1]
    const lie = flat(citationCells(victim)[2])
    const fatalLine = '| lease-kind | ' + where + ' | ' + lie + ' | NOT ON THE CITED LINE |'
    const fatalPage = pageText.replace(victim, fatalLine)
    const fatalPath = join(workdir(), 'blindspot-page.md')
    writeFileSync(fatalPath, fatalPage)
    const fatalRows = pageCitations(fatalPage) ?? []
    const oldParse = resolveRows(fatalRows, (row) => row.naiveFragments)
    const newParse = resolveRows(fatalRows, (row) => row.fragments)
    const fixedOnFatal = checkerExit(fatalPath)
    const fixedOnShipped = checkerExit(PAGE)
    record('R2', truncated.length === 0 && oldParse.failed.length === 0
      && newParse.failed.some((entry) => entry.startsWith('lease-kind:'))
      && fixedOnFatal.code === 1 && fixedOnShipped.code === 0,
      'fragmentsCutByOldParse=' + dumps(truncated)
      + ' oldParseOnFatalCopy=' + dumps(oldParse.failed.slice(0, 3))
      + ' completeParseOnFatalCopy=' + dumps(newParse.failed.slice(0, 3))
      + ' fixedCheckerOnFatalCopy=' + String(fixedOnFatal.code) + ' fixedCheckerOnShippedPage=' + String(fixedOnShipped.code)
      + ' fatalRow=' + dumps(flat(fatalLine).slice(0, 120)))
  }

  // R3: the citation rows. Each required lease fact must be cited against a file that really exists and
  // really holds that fragment AT THAT LINE — the row is read, not trusted. Two things ruling 1 fixed
  // here: the two refusal words are matched as the words themselves (the page cites the SHIPPED SOURCE,
  // where they carry single quotes, and neither word needs a citation row of its own), and the row COUNT
  // is reported rather than required — required is that every fact is cited somewhere and that every
  // cited line really holds its fragment. What is still required of the page itself: it must NAME both
  // words, because a foreign end reads the page's prose, not the citation rows.
  {
    const rows = pageCitations(pageText)
    if (rows === null) throw new Error('the page carries no citation table between ' + BEGIN + ' and ' + END)
    const fragmentsOf = (row) => row.fragments
    const carriers = rows.filter((row) => REQUIRED_CITATIONS.some((need) => need.any.some((wanted) => fragmentsOf(row).some((fragment) => fragment.includes(wanted)))))
    const missing = []
    const moved = []
    for (const row of rows) {
      const at = /^(.*):([0-9]+)$/.exec(row.where)
      if (at === null) { missing.push(row.id + ':not-path-line'); continue }
      const file = resolve(ROOT, at[1])
      const text = readText(file)
      if (text === null) { missing.push(row.id + ':file-missing'); continue }
      const line = text.split(NL)[Number(at[2]) - 1] ?? ''
      for (const fragment of fragmentsOf(row)) {
        if (line.includes(fragment)) continue
        // A fragment that is in the file but not on the cited line has drifted; one that is nowhere has
        // vanished. The first is reported (the checker tolerates it), the second reddens this reading.
        if (text.includes(fragment)) moved.push(row.id + ':' + flat(fragment).slice(0, 30))
        else missing.push(row.id + ':' + flat(fragment).slice(0, 30))
      }
    }
    const uncited = REQUIRED_CITATIONS.filter((need) => !rows.some((row) => need.any.some((wanted) => fragmentsOf(row).some((fragment) => fragment.includes(wanted))))).map((need) => need.id)
    const named = { held: pageText.includes('lease-held'), mismatch: pageText.includes('lease-mismatch') }
    record('R3', uncited.length === 0 && missing.length === 0 && Object.values(named).every(Boolean),
      'rows=' + String(rows.length) + ' rowsCarryingRequiredFacts=' + String(carriers.length) + ' uncited=' + dumps(uncited)
      + ' missing=' + dumps(missing) + ' driftedLine=' + dumps(moved.slice(0, 6)) + ' pageNamesBothWords=' + dumps(named))
  }

  // R4: the compatibility promise, witnessed by the REAL foreign harness (tools/foreign-harness/foreign-end.mjs
  // --attempt): an implementation that never heard of leases joins over the shipped relay route and writes its
  // own attempt. In a world with no lease the attempt is ACCEPTED; with another end's live lease in the ledger
  // the same shape of attempt is read as refusedDispatches/lease-mismatch — visibly, not dropped. And because
  // that implementation never writes a lease, it can never be the holder: while any end holds a live lease its
  // verdict is 'other'. All three facts in one reading, because "refused" alone would also be true of a fold
  // that refused everything.
  {
    const end = await mounted(mod, 'compat', { enabled: false })
    const log = end.capability.log
    await seedWork(mod, log, 'team-1', 'end-A', now)
    // ONE home for both runs: the foreign end mints its instance once per home, and a second run with a
    // fresh home would be a different instance of the same writer name — our ingest would refuse the batch
    // as a rewritten log, and the refusal under test would never arrive.
    // Each phase runs its OWN foreign home and writer name. A second run in the same home re-sends the
    // same writer instance stream, which is fine — but a distinct name per phase makes each phase a
    // stranger the ledger has never met, so nothing about the first phase can explain the second.
    const runForeign = (phase, attemptId) => {
      const foreignHome = workdir()
      const writer = 'foreign-' + phase
      return spawn(process.execPath, [
        FOREIGN, '--home', foreignHome, '--peer', end.url, '--token', TOKEN, '--member', 'm-' + writer, '--writer', writer,
        '--end', writer, '--team', 'team-1', '--tool', 'probe-tool', '--capability', 'probe-tool',
        '--attempt', attemptId, '--attempt-actor', writer, '--attempt-to', 'm-' + writer, '--rounds', '3',
      ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env }, cwd: foreignHome })
    }
    const waited = (child) => new Promise((settle) => {
      let out = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } settle({ code: null, out }) }, 20_000)
      child.on('exit', (code) => { clearTimeout(timer); settle({ code, out }) })
    })
    const first = await waited(runForeign('one', 'job-1#r2'))
    const withoutLease = mod.projectDispatches(log.replay())
    const accepted = withoutLease.dispatches.some((row) => row.id === 'job-1#r2')
    await log.append(mod.retryLeaseRecord('job-2', 'end-A', Date.now() - 10, 60_000))
    const second = await waited(runForeign('two', 'job-2#r2'))
    const withLease = mod.projectDispatches(log.replay())
    const refused = withLease.refusedDispatches.filter((row) => row.reason === 'lease-mismatch').map((row) => row.id)
    const neverHolder = mod.retryOwner(mod.projectTeamState(log.replay()).retryLeases, { root: 'job-2', localEnd: 'foreign-two', now: Date.now() })
    stopAll(end)
    record('R4', first.code === 0 && second.code === 0 && accepted
      && refused.includes('job-2#r2') && !withLease.dispatches.some((row) => row.id === 'job-2#r2')
      && neverHolder.mine === false && neverHolder.reason === 'other',
      'foreignExit=' + dumps([first.code, second.code]) + ' acceptedWithoutLease=' + String(accepted)
      + ' refusedWithLease=' + dumps(refused) + ' neverHolder=' + dumps(neverHolder))
  }

  // R5: the page's first promise, measured: a lease whose age is EXACTLY its untilMs is expired, so a
  // stranger may take the root; one millisecond younger it is still held. The pair is the boundary.
  {
    const held = mod.retryOwner([leaseRow('r', 'end-B', now - 999, 1_000, 1)], { root: 'r', localEnd: 'end-A', now })
    const boundary = mod.retryOwner([leaseRow('r', 'end-B', now - 1_000, 1_000, 1)], { root: 'r', localEnd: 'end-A', now })
    record('R5', held.reason === 'other' && boundary.reason === 'expired' && boundary.holder === null,
      'oneMsYounger=' + dumps(held) + ' exactlyUntilMs=' + dumps(boundary))
  }

  // R6: the page's second promise, measured: among live leases the smallest end is the holder — and the
  // control swaps which name is smaller so "whichever was read first" cannot pass for "the smallest".
  {
    const first = mod.retryOwner([leaseRow('r', 'end-b', now - 10, 1_000, 1), leaseRow('r', 'end-c', now - 10, 1_000, 2)], { root: 'r', localEnd: 'end-z', now })
    const second = mod.retryOwner([leaseRow('r', 'end-b', now - 10, 1_000, 1), leaseRow('r', 'end-a', now - 10, 1_000, 2)], { root: 'r', localEnd: 'end-z', now })
    const expired = mod.retryOwner([leaseRow('r', 'end-a', now - 5_000, 1_000, 1), leaseRow('r', 'end-b', now - 10, 1_000, 2)], { root: 'r', localEnd: 'end-z', now })
    record('R6', first.holder === 'end-b' && second.holder === 'end-a' && first.holder !== second.holder && expired.holder === 'end-b',
      'b-vs-c=' + dumps(first.holder) + ' b-vs-a=' + dumps(second.holder) + ' expiredIgnored=' + dumps(expired.holder))
  }

  // R7: the page promises the write ORDER (lease first, then the attempt it authorises). Measured off the
  // ledger's own sequence numbers, and paired: both records really were written.
  {
    const end = await mounted(mod, 'order', { enabled: false })
    const log = end.capability.log
    await seedWork(mod, log, 'team-1', 'end-A', now)
    const written = await mod.appendRedispatches(mod.projectTeamState(log.replay()), log, { team: 'team-1', localEnd: 'end-A', now, timeoutMs: 1_000, maxAttempts: 10 })
    const leaseRowWritten = log.replay().find((row) => row.kind === LEASE_KIND)
    const attemptRow = log.replay().find((row) => row.kind === 'task/dispatch' && String(row.subject).includes('#r'))
    stopAll(end)
    record('R7', written.length === 2 && leaseRowWritten !== undefined && attemptRow !== undefined && leaseRowWritten.seq < attemptRow.seq,
      'written=' + dumps(written) + ' leaseSeq=' + String(leaseRowWritten?.seq) + ' attemptSeq=' + String(attemptRow?.seq))
  }

  // R8: the boundary the page must state, measured on the shipped text: the lease kind really is in the
  // module's readable set, so a foreign end's lease records are not silently counted as unknown.
  {
    const shipped = moduleKinds(moduleText)
    const readable = shipped !== null && shipped.includes(LEASE_KIND)
    const unknown = /unknown/.test(readable ? '' : ' ')
    record('R8', readable && unknown === false, 'readableKinds=' + dumps(shipped))
  }

  // RD: the gate's own declaration of how many readings exist is not allowed to drift.
  {
    record('RD', DECLARED === results.length + 1, 'declared=' + String(DECLARED) + ' produced=' + String(results.length))
  }

  return results
}

/* ------------------------------------------------ one mounted end, and the seed a pass needs */

const MOUNTED = []
async function mounted(mod, label, retryConfig) {
  const dir = workdir()
  const provided = new Map()
  const effects = []
  // R214: a route TABLE, not a single slot. The shipped plugin now injects TWO webServer routes (the relay
  // and /api/dsh-link-collab/status), so whichever injection ran last won the slot and the relay stopped
  // existing for this fixture - the foreign end then found 'no route', exited 0, and never wrote its attempt.
  // The tell was acceptedWithoutLease=false with foreignExit=[0,0]. A stub that can hold one route silently
  // un-registers the product's other routes; the fixture must model the surface it stands in for.
  const routes = new Map()
  const stub = { register: (value) => { routes.set(value.path, value); return () => { routes.delete(value.path) } } }
  const context = {
    get: (name) => (name === 'dshHomePath' ? (...segments) => join(dir, ...segments) : undefined),
    provide: (name, value) => { provided.set(name, value) },
    effect: (body) => { const dispose = body(); effects.push({ dispose: typeof dispose === 'function' ? dispose : () => {} }); return dispose },
    inject: (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) }),
    on: () => () => {},
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  }
  mod.apply(context, { relay: { token: TOKEN, path: ROUTE }, retry: { everyMs: 60_000, timeoutMs: 60_000, maxAttempts: 10, team: 'team-1', localEnd: 'end-A', ...retryConfig } })
  const server = createServer((req, res) => {
    const routed = routes.get(req.url)
    if (routed !== undefined) { void routed.handler(req, res); return }
    res.statusCode = 404
    res.end('no route')
  })
  SERVERS.push(server)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const entry = { label, provided, effects, capability: provided.get('linkCollab'), url: 'http://127.0.0.1:' + String(server.address().port) + ROUTE }
  MOUNTED.push(entry)
  return entry
}
const stopAll = (entry) => { for (const effect of entry.effects) effect.dispose() }
async function seedWork(mod, log, team, end, now, tool = 'probe-tool') {
  await log.append({ kind: 'member/state', actor: team, subject: end, payload: { id: end, state: 'active', name: end } })
  await log.append({ kind: 'task/state', actor: team, subject: 'task-1', payload: { id: 'task-1', state: 'in_progress', owner: end } })
  await log.append(mod.capabilityRecord(end, [tool]))
  await log.append(mod.dispatchRecord('job-1', end, tool, {}, now - 1_000))
}

/* ------------------------------------------------ self-attack */

const MUTANTS = [
  // Ruling 1 made R1 a subset, so its three legs each need their own subject. A kind the page lists that
  // nobody can read is the defect R1a names; a kind row that stops being a kind row is R1c's subject; the
  // sentence about the kinds the page does NOT promise is R1b's.
  { name: 'page-kind-nobody-reads', kind: 'page', from: '| `task/retry-lease` | `{ root, end, at, untilMs }` | 声明', to: '| `task/not-real` | `{ root, end, at, untilMs }` | 声明', declared: ['R1a', 'R1c'] },
  { name: 'page-drops-a-kind-row', kind: 'page', from: '| `member/host` | `{ id, end, via, at }` | 你在哪一端、经谁中转（`via: null` = 直达）。**没有这条事实 = 你在本端**。 |', to: '', declared: ['R1c'] }, // R214: no NL suffix - this checkout hands files back CRLF (autocrlf), the LF-suffixed anchor stopped existing and the self-attack said so out loud ('anchors missing: 1') instead of silently losing its subject; deleting the row's cells leaves an empty line, which is all this mutant ever needed
  { name: 'page-rewords-disclaimer', kind: 'page', from: '它们的记录 kind 存在且可读', to: '它们的记录 kind 都在账本里', declared: ['R1b'] },
  // R2's first leg: a fragment carrying a pipe is exactly the shape the old parse swallowed, so this
  // mutant flips both the blind-spot reading and the row reading.
  { name: 'page-fragment-carries-pipe', kind: 'page', from: '| export const RETRY_LEASE_KIND = \'task/retry-lease\' |', to: '| export const RETRY_LEASE_KIND = \'task/retry-lease\' | NOT ON THE CITED LINE |', declared: ['R2', 'R3'] },
  // R2 also certifies that the untouched page is accepted by the fixed checker, so a row that stops
  // resolving reddens the blind-spot reading too — measured, not guessed.
  { name: 'page-rewords-owner-fragment', kind: 'page', from: 'function retryOwner(', to: 'function retryOwnerX(', declared: ['R2', 'R3'] },
  { name: 'page-rewords-liveness-fragment', kind: 'page', from: 'options.now - lease.at < lease.untilMs', to: 'options.now - lease.at <= lease.untilMs', declared: ['R2', 'R3'] },
  { name: 'module-drops-lease-mismatch', kind: 'module', from: 'reason: "lease-mismatch"', to: 'reason: "mismatch"', declared: ['R4'] },
  { name: 'module-lease-unknown-kind', kind: 'module', from: 'var RETRY_LEASE_KIND = "task/retry-lease";', to: 'var RETRY_LEASE_KIND = "task/lease";', declared: ['R1a', 'R7', 'R8'] },
  { name: 'module-equality-alive', kind: 'module', from: 'const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs);', to: 'const live = relevant.filter((lease) => options.now - lease.at <= lease.untilMs);', declared: ['R5'] },
  { name: 'module-max-end', kind: 'module', from: '(left.end < right.end ? -1 : left.end > right.end ? 1 : 0)', to: '(left.end > right.end ? -1 : left.end < right.end ? 1 : 0)', declared: ['R6'] },
  // R7 reads the ORDER off the ledger and the report of what was written: a lease that is appended but
  // left out of the returned sequence makes that report lie.
  { name: 'lease-seq-not-reported', kind: 'module', from: 'written.push(await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs)));', to: 'await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs));', declared: ['R7'] },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 11' + NL, to: 'const DECLARED = 99' + NL, declared: ['RD'] },
]

async function childVerdicts(pagePath, modulePath) {
  const child = spawn(process.execPath, [SELF, '--page', pagePath, '--module', modulePath, '--checker', CHECKER, '--root', ROOT], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env },
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += String(chunk) })
  const code = await new Promise((settle) => child.on('exit', settle))
  const verdicts = {}
  for (const line of out.split(/\r?\n/)) {
    const verdict = /^VERDICT (\S+) (true|false)$/.exec(line.trim())
    if (verdict !== null) verdicts[verdict[1]] = verdict[2] === 'true'
  }
  return { code, verdicts, out }
}

async function selfAttack() {
  const pageText = readText(PAGE)
  const moduleText = readText(MODULE)
  if (pageText === null || moduleText === null) { console.log('self-attack cannot run: an input is missing'); process.exitCode = 3; return }
  const baseline = await childVerdicts(PAGE, MODULE)
  const failed = Object.entries(baseline.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
  console.log('baseline: ' + String(Object.keys(baseline.verdicts).length) + ' readings seen, failed ' + dumps(failed))
  if (baseline.code === 3) { console.log('self-attack cannot run: an input is missing'); process.exitCode = 3; return }
  if (Object.keys(baseline.verdicts).length === 0 || failed.length > 0) {
    console.log('self-attack refuses to run: the unmutated pair is not green, so no mutant can be trusted')
    process.exitCode = 1
    return
  }
  const coverage = new Map()
  let mismatches = 0
  let anchorsMissing = 0
  for (const mutant of MUTANTS) {
    // R214: anchors are matched with line endings normalised. This checkout hands files back with CRLF
    // (autocrlf) while several anchors were written with a literal LF terminator, so a fixture that existed
    // and mutated correctly in an LF tree reported ANCHOR MISSING here - the self-attack was red on Windows
    // for a reason that has nothing to do with the product. The count below still reddens a fixture that is
    // genuinely gone; it just no longer mistakes a line ending for an absence.
    const normalize = (text) => text.replace(/\r\n/g, '\n')
    const sourceRaw = mutant.kind === 'page' ? pageText : mutant.kind === 'module' ? moduleText : readFileSync(SELF, 'utf8')
    const source = sourceRaw.includes(mutant.from) ? sourceRaw : normalize(sourceRaw)
    const from = sourceRaw.includes(mutant.from) ? mutant.from : normalize(mutant.from)
    if (!source.includes(from)) { console.log('  ANCHOR MISSING  ' + mutant.name + '  |  ' + flat(mutant.from).slice(0, 90)); anchorsMissing += 1; continue }
    if (source.indexOf(from, source.indexOf(from) + from.length) !== -1) { console.log('  ANCHOR NOT UNIQUE  ' + mutant.name); anchorsMissing += 1; continue }
    const mutated = source.replace(from, mutant.to)
    let observed = []
    if (mutant.kind === 'gate') {
      const dir = workdir()
      const copy = join(dir, 'gate-mutant.mjs')
      writeFileSync(copy, mutated)
      const child = spawn(process.execPath, [copy, '--page', PAGE, '--module', MODULE, '--checker', CHECKER, '--root', ROOT], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } })
      let out = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      await new Promise((settle) => child.on('exit', settle))
      for (const line of out.split(/\r?\n/)) { const verdict = /^VERDICT (\S+) (true|false)$/.exec(line.trim()); if (verdict !== null && verdict[2] === 'false') observed.push(verdict[1]) }
    } else {
      const dir = workdir()
      const pageCopy = mutant.kind === 'page' ? join(dir, 'page.md') : PAGE
      const moduleCopy = mutant.kind === 'module' ? join(dir, 'module.js') : MODULE
      if (mutant.kind === 'page') writeFileSync(pageCopy, mutated)
      if (mutant.kind === 'module') writeFileSync(moduleCopy, mutated)
      const result = await childVerdicts(pageCopy, moduleCopy)
      observed = Object.entries(result.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
    }
    for (const id of observed) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const declared = [...mutant.declared].sort().join(',')
    const flipped = [...observed].sort().join(',')
    if (declared !== flipped) mismatches += 1
    console.log('  ' + (declared === flipped ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  |  declared=[' + declared + '] flipped=[' + flipped + ']')
  }
  const uncovered = MODULE_READING_IDS.filter((id) => !coverage.has(id))
  console.log('coverage: ' + String(MODULE_READING_IDS.length) + ' declared readings, ' + String(coverage.size) + ' flipped by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(anchorsMissing))
  process.exitCode = mismatches === 0 && uncovered.length === 0 && anchorsMissing === 0 ? 0 : 1
}

const cleanup = () => {
  for (const server of SERVERS) { try { server.close() } catch { /* already closed */ } }
  for (const entry of MOUNTED) { try { entry.capability?.log?.close?.() } catch { /* already closed */ } }
  for (const dir of MADE) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may hold one for a moment */ } }
}

try {
  if (SELF_ATTACK) {
    await selfAttack()
  } else {
    if (!existsSync(PAGE)) { console.log('SKIP  verify-device-net-leases: the protocol page is missing: ' + PAGE); process.exit(3) }
    if (!existsSync(MODULE)) { console.log('SKIP  verify-device-net-leases: the built module is missing: ' + MODULE); process.exit(3) }
    await runReadings(ATTACK_PAGE ?? PAGE, ATTACK_MODULE ?? MODULE)
    for (const row of results) console.log('VERDICT ' + row.id + ' ' + String(row.ok))
    const failed = results.filter((row) => !row.ok).length
    console.log(String(results.length - failed) + ' of ' + String(results.length) + ' readings held')
    process.exitCode = failed === 0 ? 0 : 1
  }
} finally {
  cleanup()
}
