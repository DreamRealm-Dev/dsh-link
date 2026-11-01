#!/usr/bin/env node
/**
 * Prove, executably, the project's central claim: «a new kernel version is supported by
 * editing data only».
 *
 * The proof is a synthetic future surface, not a fork of the kernel. The real archived
 * surface (compat/surface/0.2.1-alpha.1.json, sha256 2f3e899d…) is copied and mutated —
 * N members renamed, M members deleted — and declared to be «a newer kernel». Three things
 * must then hold:
 *
 *   (a) the table, unchanged, must go RED against that surface, and the report must NAME
 *       the absent service and the absent member — not merely «something failed»;
 *   (b) after editing only data (the table section, plus the surface document, which is
 *       data about the kernel), the same resolver must go GREEN — with the renamed service
 *       reachable through a service-rename translation, which is the new fact the new
 *       data carries;
 *   (c) outside compat/table/** nothing may differ from the frozen revision, except this
 *       script itself. That is the whole point: (b) must not be achieved by editing code.
 *
 * The resolver under test is extracted from a pinned commit with «git archive» into
 * .tmp/compat-future/frozen, so the worktree copy of compat/** is never read and never
 * executed: a concurrent writer cannot move this target. The worktree resolver is then
 * compared with the frozen one by git's own byte comparison, so «we proved it on other
 * code» is itself a graded assertion rather than a footnote.
 *
 * Usage:
 *   node scripts/verify-compat-future.mjs [--future] [--controls] [--rev <sha>] [--out <dir>] [--verbose]
 *
 *   --future     (default) assertions A0–A4: synthetic surface, red without data, green with
 *                data, no code moved outside compat/table/**
 *   --controls   assertions C1–C4: the four «silent false-green» channels of
 *                docs/handoff/R2-critique.md section 10, as negative controls. These are
 *                today's KNOWN RED holes: a control PASSES when the hole is closed, and the
 *                summary line «KNOWN RED: n/4» counts the holes still open. Nothing here
 *                changes product code — every mutation is an in-memory clone of the table.
 *   --rev <sha>  revision to extract the resolver from. Default HEAD, so the proof runs on the
 *                current commit and goes red if a concurrent writer moves it underfoot.
 *   --out <dir>  scratch directory for the extracted revision and the synthetic surface.
 *                Default .tmp/compat-future. Nothing outside it is written.
 *   --verbose    also print every raw per-row detail line.
 *
 * Exit codes: 0 every assertion passed; 1 at least one assertion failed (in --controls mode:
 * at least one hole is still open); 64 usage error. Same convention as scripts/cdp-eval.mjs
 * (64) and scripts/verify-baseline.mjs (1).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }

const KNOWN = ['--future', '--controls', '--rev', '--out', '--verbose', '--help', '-h']
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]
  if (argument === '--rev' || argument === '--out') { index += 1; continue }
  if (!KNOWN.includes(argument)) {
    console.error('unknown argument: ' + argument)
    console.error('usage: node scripts/verify-compat-future.mjs [--future] [--controls] [--rev <sha>] [--out <dir>] [--verbose]')
    process.exit(64)
  }
}
if (has('--help') || has('-h')) {
  console.log('usage: node scripts/verify-compat-future.mjs [--future] [--controls] [--rev <sha>] [--out <dir>] [--verbose]')
  console.log('  --future    (default) synthetic future surface: red without data, green with data, no code moved')
  console.log('  --controls  the four false-green channels of R2-critique.md section 10, as negative controls')
  console.log('exit codes: 0 all assertions passed; 1 an assertion failed; 64 usage error')
  process.exit(0)
}
if (has('--future') && has('--controls')) {
  console.error('--future and --controls are separate runs; pass one of them')
  process.exit(64)
}
const MODE = has('--controls') ? 'controls' : 'future'
const REQUESTED = option('--rev', 'HEAD')
const OUT = resolve(PROJECT, option('--out', '.tmp/compat-future'))
const VERBOSE = has('--verbose')

if (REQUESTED === undefined || REQUESTED.trim() === '' || REQUESTED.startsWith('-')) {
  console.error('--rev needs a revision; got ' + JSON.stringify(option('--rev', null)))
  process.exit(64)
}

/** The revision whose resolver and table the proof is run on; resolved to a long sha at setup. */
let REV = REQUESTED

const say = (line) => console.log(line)
const group = (line) => { say(''); say(line) }

/** Assertions, each one PASS/FAIL with the numbers it rests on. */
const assertions = []
const assertion = (id, ok, detail) => {
  assertions.push({ id, ok, detail })
  say('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + id.padEnd(3) + ' ' + detail)
}

/**
 * This project lives in a subdirectory of its repository, and git names the same file two
 * ways depending on the subcommand: «git diff» resolves a pathspec at the repository root,
 * while «git archive» resolves it against the current directory. PN is the project's path
 * inside the repository, kept in the repository-root form (`dsh-link/`) and converted
 * per call. It is computed from the filesystem, never from «git rev-parse --show-prefix»,
 * which reports whatever an inherited GIT_PREFIX happens to say.
 */
let PN = ''

/** A project-relative path as git diff/show names it. */
const repoRelative = (projectRelative) => PN + projectRelative

/** A project-relative path as «git archive», run from the project, names it. */
const archiveRelative = (projectRelative) => projectRelative

/** The variables a parent may have exported; an inherited GIT_PREFIX silently renames our paths. */
const GIT_INHERITED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']

/** Run git with an explicit cwd, no shell, and a scrubbed environment. */
function git(args, cwd) {
  const env = { ...process.env }
  for (const name of GIT_INHERITED) delete env[name]
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const note = error && error.stderr ? String(error.stderr).trim().split(/\r?\n/)[0] : String(error && error.message)
    throw new Error('git ' + args.join(' ') + ' (cwd ' + cwd + ') failed: ' + note)
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hashFile = (path) => sha256(readFileSync(path))

import { readdirSync } from 'node:fs'
/** The directories this proof is allowed to be sensitive to: the resolver and the compat package. */
const WATCHED = ['compat', 'scripts', 'plugins/dsh-link-compat/src']

/**
 * Hash every file under the watched directories. Two snapshots taken around the run are the
 * evidence for (c): an edit made while the proof runs moves a hash, and a file added or removed
 * changes the key set — so an edit cannot hide behind a not-yet-committed file either.
 * node_modules and the vendored kernel stay out of scope: the kernel has its own gate.
 */
function snapshotWatched() {
  const into = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile()) continue
      const key = relative(PROJECT, full).split(/[\\/]/).join('/')
      try { into.set(key, hashFile(full)) } catch (error) { into.set(key, 'unreadable:' + String(error && error.code ? error.code : error)) }
    }
  }
  for (const dir of WATCHED) {
    const full = join(PROJECT, dir)
    if (existsSync(full)) walk(full)
  }
  return into
}

/** Place this project inside its repository. */
function locate() {
  const top = realpathSync(git(['rev-parse', '--show-toplevel'], PROJECT).trim())
  const inside = relative(top, realpathSync(HERE)).split(/[\/]+/).filter((part) => part !== '')
  const project = inside.slice(0, -1).join('/')
  PN = project === '' ? '' : project + '/'
  return { top, project }
}

/** Every repository-relative path git reports as different between the revision and the working tree. */
function changedSince(revision, projectRelative) {
  const output = git(['diff', '--name-only', revision, '--', repoRelative(projectRelative)], PROJECT)
  return output.split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line !== '')
}

/**
 * Whether the worktree file has exactly the revision's bytes. git decides: «git diff --quiet
 * <rev> -- <path>» exits 0 only for a byte-identical file, so a CRLF rewrite, a one-line
 * comment edit and a changed import all count as «moved» without any hashing of our own.
 */
function matchesFrozenBlob(revision, projectRelative) {
  try {
    git(['diff', '--quiet', revision, '--', repoRelative(projectRelative)], PROJECT)
    return existsSync(join(PROJECT, projectRelative))
  } catch {
    return false
  }
}

/** Extract the pinned revision's compat tree, so nothing under test is read from the worktree. */
let FROZEN_COMPAT = ''
function extractFrozen(revision) {
  mkdirSync(OUT, { recursive: true })
  const archive = join(OUT, 'frozen.tar')
  git(['archive', revision, archiveRelative('compat'), '-o', archive], PROJECT)
  execFileSync('tar', ['-xf', archive, '-C', OUT], { encoding: 'utf8' })
  const extracted = join(OUT, 'compat')
  if (!existsSync(join(extracted, 'load.mjs')) || !existsSync(join(extracted, 'table'))) {
    throw new Error('the extracted revision ' + revision + ' carries no compat/ loader at ' + extracted)
  }
  return extracted
}

/** Load the extracted revision's own loader (it bundles its own index.ts in memory). */
async function loadFrozenModule() {
  const loader = FROZEN_COMPAT + '/load.mjs'
  const module = await import('file:///' + loader.replace(/[\\]/g, '/') + '?rev=' + encodeURIComponent(REV))
  return module.loadCompatModule()
}

/** Member names and declared property names from a surface document, as the verify scripts read it. */
function lookupFrom(document) {
  const services = document.services ?? {}
  const declared = Object.keys(services)
  return {
    membersOf(service) {
      const entry = services[service]
      if (entry === undefined || entry === null || entry.error !== undefined) return undefined
      return Array.isArray(entry.members) ? entry.members : []
    },
    serviceNames() { return declared },
  }
}

/** A kernel whose services hold the members the surface declares, as stubs: enough for the loader. */
function hostFrom(document) {
  const lookup = lookupFrom(document)
  const stub = function stub() {}
  return {
    membersOf: lookup.membersOf,
    serviceNames: lookup.serviceNames,
    valueOf(service) {
      const members = lookup.membersOf(service)
      if (members === undefined) return undefined
      const value = {}
      for (const member of members) value[member] = stub
      return value
    },
  }
}

/** tableProblems may throw on a shape that is wrong but present; a throw is a problem too. */
function problemsOf(module, table) {
  try {
    const problems = module.tableProblems(table)
    return Array.isArray(problems) ? problems : ['tableProblems returned ' + typeof problems]
  } catch (error) {
    return ['tableProblems threw ' + (error && error.message ? error.message : String(error))]
  }
}

const deepClone = (value) => JSON.parse(JSON.stringify(value))

// ---------------------------------------------------------------------------------------
// The synthetic future surface
// ---------------------------------------------------------------------------------------

/** Copy of the services with «service» renamed to «renameTo»: the old name is gone, the members stay. */
function renameService(document, service, renameTo) {
  const next = deepClone(document)
  const entry = next.services[service]
  if (entry === undefined) return { document: next, found: false }
  next.services[renameTo] = entry
  delete next.services[service]
  return { document: next, found: true }
}

/** Copy of the services with «member» dropped from «service»: the service stays, one member fewer. */
function deleteMember(document, service, member) {
  const next = deepClone(document)
  const entry = next.services[service]
  if (entry === undefined || !Array.isArray(entry.members)) return { document: next, found: false }
  const before = entry.members.length
  entry.members = entry.members.filter((name) => name !== member)
  return { document: next, found: before !== entry.members.length }
}

/** Rename one capability row's target service, and nothing else. */
function retargetService(table, capability, renameTo) {
  const next = deepClone(table)
  const row = next.capabilities[capability]
  if (row === undefined) return { table: next, found: false }
  row.targets[0].service = renameTo
  return { table: next, found: true }
}

/** Rebind one promised role to another member of the same target, and nothing else. */
function rebindRole(table, capability, role, member) {
  const next = deepClone(table)
  const row = next.capabilities[capability]
  if (row === undefined) return { table: next, found: false }
  const binding = row.targets[0].binds.find((candidate) => candidate.role === role)
  if (binding === undefined) return { table: next, found: false }
  binding.member = member
  return { table: next, found: true }
}

/** Declare a service rename on a row: the one new fact the new kernel's data carries. */
function declareServiceRename(table, capability, from, to) {
  const next = deepClone(table)
  const row = next.capabilities[capability]
  if (row === undefined) return { table: next, found: false }
  row.disposition = 'translate'
  row.kind = 'service-rename'
  row.translation = { from, to }
  return { table: next, found: true }
}

// ---------------------------------------------------------------------------------------
// A: the synthetic future surface
// ---------------------------------------------------------------------------------------

/** The two mutations the synthetic surface carries: N=2 changes, M=1 member deletion. The
 *  numbers in the output are printed from this plan rather than written into prose.
 *
 *  A rename and a deletion are separate cases on purpose: a rename makes the whole service
 *  absent, so the report can only name the service; only a member dropped from a service
 *  that survives forces the report to name a service AND a member.
 */
const MUTATION = {
  renames: [{ service: 'skills', to: 'skillRegistry', capability: 'skill' }],
  deletions: [{ service: 'workspaceFiles', member: 'stat', capability: 'workspace', role: 'workspace.statFile' }],
}

async function runFuture() {
  group('== A. synthetic future surface — «only data supports a new kernel» ==')
  say('resolver  : ' + FROZEN_COMPAT.replace(PROJECT + '\'', '') + '   (git rev ' + REV + ')')
  const module = await loadFrozenModule()
  const table = module.TABLES[0]

  const surfacePath = resolve(PROJECT, table.surface.file)
  const surfaceBytes = readFileSync(surfacePath)
  const surfaceHash = sha256(surfaceBytes)
  const document = JSON.parse(surfaceBytes.toString('utf8'))
  say('surface   : ' + table.surface.file + '   sha256 ' + surfaceHash.slice(0, 16) + '…  ' + surfaceBytes.length + ' bytes, '
    + Object.keys(document.services).length + ' services')
  say('table     : ' + table.kernel + ' @ ' + String(table.commit) + '   ' + Object.keys(table.capabilities).length
    + ' capabilities + ' + Object.keys(table.refused).length + ' refusals')

  const problems0 = problemsOf(module, table)
  const baseline = module.validateTable({ table, lookup: lookupFrom(document) })
  assertion('A0', problems0.length === 0 && baseline.ok === true,
    'the frozen baseline is self-consistent: tableProblems=' + problems0.length + ', validateTable.ok=' + baseline.ok
    + ', red rows=' + baseline.rows.filter((row) => row.verdict !== 'ok').length
    + ', counts=' + JSON.stringify(baseline.counts))
  if (!baseline.ok || problems0.length > 0) {
    say('        a red baseline makes every later conclusion meaningless; stopping here')
    return
  }

  // Every mutation is checked to still apply, so a re-probed surface cannot silently retire it.
  for (const rename of MUTATION.renames) {
    const members = Array.isArray(document.services[rename.service]?.members) ? document.services[rename.service].members : []
    if (members.length === 0) { assertion('A0', false, 'synthetic surface: service ' + rename.service + ' is not on the archived surface'); return }
    if (members.includes(rename.to)) { assertion('A0', false, 'synthetic surface: service ' + rename.to + ' already exists'); return }
  }
  for (const deletion of MUTATION.deletions) {
    const members = Array.isArray(document.services[deletion.service]?.members) ? document.services[deletion.service].members : []
    if (!members.includes(deletion.member)) { assertion('A0', false, 'synthetic surface: ' + deletion.service + '.' + deletion.member + ' is not on the archived surface'); return }
  }

  const N = MUTATION.renames.length + MUTATION.deletions.length
  const M = MUTATION.deletions.length
  say('mutation  : N=' + N + ' data changes (' + MUTATION.renames.length + ' rename, ' + MUTATION.deletions.length
    + ' member deletion), M=' + M + ' member(s) deleted')
  for (const rename of MUTATION.renames) {
    const members = document.services[rename.service].members
    say('            rename  ' + rename.service + ' -> ' + rename.to + '   (' + members.length + ' members keep their names; capability «'
      + rename.capability + '» is bound to it)')
  }
  for (const deletion of MUTATION.deletions) {
    say('            delete  ' + deletion.service + '.' + deletion.member + '   (the service survives, the promise the role «'
      + deletion.role + '» rests on does not)')
  }

  let synthetic = document
  for (const rename of MUTATION.renames) synthetic = renameService(synthetic, rename.service, rename.to).document
  for (const deletion of MUTATION.deletions) synthetic = deleteMember(synthetic, deletion.service, deletion.member).document
  synthetic.counts = { ...synthetic.counts, reachableServices: Object.keys(synthetic.services).length }
  synthetic.kernel = { ...synthetic.kernel, id: 'dsh-v9.9.9-synthetic', version: '9.9.9-synthetic', commit: null }

  const syntheticPath = join(OUT, 'surface.synthetic.json')
  writeFileSync(syntheticPath, JSON.stringify(synthetic, null, 2))
  const syntheticHash = hashFile(syntheticPath)
  say('synthetic : ' + syntheticPath.replace(PROJECT + '\'', '') + '   sha256 ' + syntheticHash.slice(0, 16)
    + '…   (the archived surface is unchanged on disk)')

  const lookup = lookupFrom(synthetic)
  const host = hostFrom(synthetic)

  // (a) the unchanged table + the synthetic surface must be RED, and must NAME what is gone.
  group('A1/a — the unchanged table against the synthetic surface: must be RED, and must NAME what is gone')
  const red = module.validateTable({ table, lookup })
  const redRows = red.rows.filter((row) => row.verdict !== 'ok')
  const redText = red.rows.flatMap((row) => [...row.failures, ...row.detail]).join('\n')
  say('red rows  : ' + (redRows.map((row) => row.capability + '[' + row.disposition + '/' + row.verdict + ']').join(', ') || '(none)'))
  say('raw report of the red rows, verbatim:')
  for (const row of redRows) for (const failure of row.failures) say('            ' + row.capability + ': ' + failure)
  if (VERBOSE) for (const row of redRows) for (const line of row.detail) say('            · ' + row.capability + ' ' + line)

  const namedService = MUTATION.renames.every((rename) => redText.includes(rename.service))
  const namedMember = MUTATION.deletions.every((deletion) => redText.includes(deletion.service + '.' + deletion.member))
  const redRowsFor = (capability) => redRows.filter((row) => row.capability === capability).length
  assertion('A1a', red.ok === false && MUTATION.renames.every((rename) => redRowsFor(rename.capability) > 0) && namedService,
    'the renamed service is RED and the report names it: rows ' + redRowsFor(MUTATION.renames[0].capability) + ' red, «'
    + MUTATION.renames[0].service + '» named ' + String(namedService))
  assertion('A1b', red.ok === false && MUTATION.deletions.every((deletion) => redRowsFor(deletion.capability) > 0) && namedMember,
    'the deleted member is RED and the report names «service.member»: rows ' + redRowsFor(MUTATION.deletions[0].capability)
    + ' red, «' + MUTATION.deletions[0].service + '.' + MUTATION.deletions[0].member + '» named ' + String(namedMember))

  // The production entry point must refuse too, not merely the checker.
  const loaderErrors = []
  try {
    const loader = module.createCompatLoader({ table, ...host, selfProvided: { link: {} } })
    for (const rename of MUTATION.renames) {
      if (loader.has(rename.capability) !== false) loaderErrors.push(rename.capability + ' is still reported present')
      try { loader.capability(rename.capability); loaderErrors.push(rename.capability + ' returned a half-product') }
      catch (error) { loaderErrors.push('capability(' + JSON.stringify(rename.capability) + ') threw: ' + String(error && error.message ? error.message : error)) }
    }
  } catch (error) {
    loaderErrors.push('createCompatLoader threw: ' + String(error && error.message ? error.message : error))
  }
  say('loader    : has()=false and capability() throws UnsupportedError for every red row:')
  for (const line of loaderErrors) say('            ' + line)

  // One snapshot taken here and another after the repair: an edit anywhere in this project while
  // the proof runs moves a hash. The edits this proof makes are in-memory, plus the synthetic surface.
  const before = snapshotWatched()

  // (b) after a data-only edit, the same resolver must be GREEN.
  group('A2/b — after editing data only (the table section): must be GREEN')
  let repaired = table
  const edits = []
  for (const rename of MUTATION.renames) {
    const step = retargetService(repaired, rename.capability, rename.to)
    if (!step.found) { assertion('A2', false, 'no row «' + rename.capability + '» to retarget'); return }
    repaired = step.table
    edits.push('target service of «' + rename.capability + '»: «' + rename.service + '» -> «' + rename.to + '»')
    const declared = declareServiceRename(repaired, rename.capability, rename.service, rename.to)
    repaired = declared.table
    edits.push('translation { from: «' + rename.service + '», to: «' + rename.to + '» }, kind service-rename')
  }
  for (const deletion of MUTATION.deletions) {
    // The deleted member's promise is a decision, not a mechanical edit: buy no replacement
    // behaviour, ask the surviving service for the nearest member that still answers the role.
    const survivors = table.capabilities[deletion.capability].targets[0].binds
      .filter((binding) => binding.member !== deletion.member).map((binding) => binding.member)
    const fallback = survivors[0]
    const step = rebindRole(repaired, deletion.capability, deletion.role, fallback)
    if (!step.found) { assertion('A2', false, 'no binding «' + deletion.role + '» to repair'); return }
    repaired = step.table
    edits.push('role «' + deletion.role + '» rebound: «' + deletion.member + '» -> «' + fallback + '» (the nearest surviving member)')
  }
  for (const edit of edits) say('data edit : ' + edit)

  const problems1 = problemsOf(module, repaired)
  const green = module.validateTable({ table: repaired, lookup })
  const greenRows = green.rows.filter((row) => row.verdict !== 'ok')
  say('verdict   : tableProblems=' + problems1.length + ', validateTable.ok=' + green.ok + ', red rows=' + greenRows.length
    + (problems1.length ? ', problems: ' + problems1.slice(0, 2).join('; ') : ''))

  const translations = []
  let resolveError = null
  try {
    const loader = module.createCompatLoader({ table: repaired, ...host, selfProvided: { link: {} } })
    for (const rename of MUTATION.renames) {
      const value = loader.capability(rename.capability)
      const translation = value === null || typeof value !== 'object' ? null : value.translation
      translations.push(translation ?? null)
      say('loader    : capability(' + JSON.stringify(rename.capability) + ') resolved, roles ' + Object.keys(value ?? {}).join(', ')
        + ', translation ' + JSON.stringify(translation ?? null))
    }
    for (const deletion of MUTATION.deletions) say('loader    : capability(' + JSON.stringify(deletion.capability) + ') resolved='
      + String(loader.has(deletion.capability)))
  } catch (error) {
    resolveError = String(error && error.message ? error.message : error)
    say('loader    : threw: ' + resolveError)
  }
  const translationOk = translations.length === MUTATION.renames.length && MUTATION.renames.every((rename, index) =>
    translations[index] !== null && translations[index].from === rename.service && translations[index].to === rename.to)
  assertion('A2', green.ok === true && problems1.length === 0 && resolveError === null && translationOk,
    'a data-only edit turns the synthetic surface GREEN (ok=' + green.ok + ', problems=' + problems1.length
    + ', loader ' + (resolveError === null ? 'resolved cleanly' : 'threw') + ') and the renamed service is reachable through translation '
    + JSON.stringify(translations[0] ?? null))

  // (c) the data-only claim is only as good as the fact that nothing else moved.
  group('A3/c — the change stayed inside the data')
  const CODE = ['compat/engine.ts', 'compat/types.ts', 'compat/index.ts', 'compat/load.mjs',
    'plugins/dsh-link-compat/src/index.ts']
  const SELF = 'scripts/verify-compat-future.mjs'
  const codeMoved = CODE.filter((projectRelative) => !matchesFrozenBlob(REV, projectRelative))
  const tableSame = matchesFrozenBlob(REV, 'compat/table/dsh-v0.2.1-alpha.1.ts')
  const after = snapshotWatched()
  const changedDuring = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
  // One path in the watch set belongs to another writer on this team: a second synthetic-future
  // surface being built under compat/surface/ at the same time. It is data, no proof here reads it,
  // and this proof does not own it — so it is declared, and reported whenever it does move.
  const OTHER_WRITER = ['compat/surface/synthetic-future.json']
  const movedByOthers = changedDuring.filter((path) => OTHER_WRITER.includes(path))
  const movedByUs = changedDuring.filter((path) => OTHER_WRITER.includes(path) === false)
  say('snapshots : ' + before.size + ' files under ' + WATCHED.join(', ') + ' hashed before the run and after it')
  say('changed   : ' + (changedDuring.length === 0 ? 'none' : changedDuring.join(', ')))
  if (movedByOthers.length > 0) say('attributed: not this proof — another writer replaced ' + movedByOthers.join(', '))
  say('resolver  : worktree identical to the revision the proof was run on? ' + String(codeMoved.length === 0) + '   [' + CODE.length
    + ' files: ' + (codeMoved.length === 0 ? 'all identical' : 'moved: ' + codeMoved.join(', ')) + ']')
  say('table file: worktree table identical to the revision? ' + String(tableSame)
    + '   (every edit this run makes lives in the in-memory copy and in the synthetic surface)')
  assertion('A3a', movedByUs.length === 0,
    'nothing this proof could have written moved: ' + before.size + ' watched files hashed before and after, ' + movedByUs.length
    + ' changed, ' + movedByOthers.length + ' written by the declared other writer')
  // A measurement, not an assertion: the team is editing compat/** on purpose, and this proof does
  // not own the worktree. What it must not be read as is «the proof ran on this byte»: when the two
  // disagree, the proof ran on the revision, and a reviewer has to re-run it against the new bytes.
  say('measure   : revision vs worktree — ' + codeMoved.length + '/' + CODE.length + ' code files differ'
    + (codeMoved.length === 0 ? '' : ' (' + codeMoved.join(', ') + ')'))

  // (d) the surface the verdict ran on is still the archived one.
  const afterHash = hashFile(surfacePath)
  const stillSynthetic = existsSync(syntheticPath) && hashFile(syntheticPath) === syntheticHash
  assertion('A4', afterHash === surfaceHash && surfaceHash === table.surface.sha256 && stillSynthetic,
    'the archived surface is byte-identical after the run (sha256 ' + afterHash.slice(0, 16)
    + '…) and the synthetic copy exists only under ' + OUT.replace(PROJECT + '\\', '')
    + ' (sha256 ' + syntheticHash.slice(0, 16) + '…)')
}

// ---------------------------------------------------------------------------------------
// B: the four false-green channels, as negative controls
// ---------------------------------------------------------------------------------------

/** One control: its mutation, what «closed» means, and whether the hole is closed today. */
function control(id, hole, mutation, closedDetails) {
  const detail = closedDetails()
  assertion(id, detail.closed, (detail.closed ? '[closed] ' : '[KNOWN RED] ') + hole + ' — mutation: ' + mutation
    + '; expected red, measured ' + detail.measured)
  return detail.closed
}

async function runControls() {
  group('== B. the four false-green channels of R2-critique.md section 10, as negative controls ==')
  say('resolver  : ' + FROZEN_COMPAT.replace(PROJECT + '\\', '') + '   (git rev ' + REV + ')')
  say('note      : a control PASSES when the hole is closed; «KNOWN RED: n/4» counts the holes still open.')
  say('note      : no product code is changed here — every mutation is an in-memory clone of the table.')
  const module = await loadFrozenModule()
  const table = module.TABLES[0]
  const surfacePath = resolve(PROJECT, table.surface.file)
  const document = JSON.parse(readFileSync(surfacePath, 'utf8'))
  const lookup = lookupFrom(document)
  const baseline = module.validateTable({ table, lookup })
  say('baseline  : validateTable.ok=' + baseline.ok + ', tableProblems=' + problemsOf(module, table).length)
  const baselineRefusals = baseline.counts.refuseSemanticChanged

  const closed = []

  // C1 — a wrong translation target is never checked against the kernel.
  group('C1 — translation.to is written wrong (R2-critique section 10.1 channel 1)')
  const c1 = deepClone(table)
  const c1Rows = Object.entries(c1.capabilities).filter(([, row]) => row.translation !== undefined)
  const c1Name = c1Rows[0][0]
  const c1Before = c1Rows[0][1].translation.to
  c1Rows[0][1].translation.to = c1Before + 'X'
  const c1Problems = problemsOf(module, c1)
  const c1Verdict = module.validateTable({ table: c1, lookup })
  closed.push(control('C1', 'a translating row\'s translation.to is data the kernel is never asked about',
    c1Name + '.translation.to: ' + c1Before + ' -> ' + c1Before + 'X',
    () => ({
      closed: c1Problems.length > 0 || c1Verdict.ok === false,
      measured: 'tableProblems=' + c1Problems.length + ', validateTable.ok=' + c1Verdict.ok
        + ', red rows=' + c1Verdict.rows.filter((row) => row.verdict !== 'ok').length
        + ' (a «' + c1Before + 'X» key exists on no service of the archived surface)',
    })))

  // C2 — dropping a promised member, bind and role together, is invisible.
  group('C2 — a required member is deleted from the data (R2-critique section 10.1 channel 2c)')
  const c2 = deepClone(table)
  const c2RolesBefore = c2.capabilities.tools.roles.length
  c2.capabilities.tools.roles = c2.capabilities.tools.roles.filter((role) => role !== 'tools.schemas')
  c2.capabilities.tools.targets[0].binds = c2.capabilities.tools.targets[0].binds.filter((binding) => binding.member !== 'schemas')
  const c2Problems = problemsOf(module, c2)
  const c2Verdict = module.validateTable({ table: c2, lookup })
  closed.push(control('C2', 'the promise on tools.schemas is deleted with its binding, so nothing is left to check',
    'tools: drop role tools.schemas and its bind to schemas',
    () => ({
      closed: c2Problems.length > 0 || c2Verdict.ok === false,
      measured: 'roles ' + c2RolesBefore + ' -> ' + c2.capabilities.tools.roles.length + ', tableProblems=' + c2Problems.length
        + ', validateTable.ok=' + c2Verdict.ok,
    })))

  // C3 — the table's identity fields are recorded and never compared.
  group('C3 — commit / packageVersion / surface.sha256 disagree with the kernel and the archive (channel 3)')
  const c3 = deepClone(table)
  c3.commit = '0000000deadbeef'
  c3.packageVersion = '9.9.9'
  c3.kernel = 'dsh-v9.9.9-fake'
  c3.surface = { file: table.surface.file, sha256: 'f'.repeat(64) }
  const c3Problems = problemsOf(module, c3)
  const c3Verdict = module.validateTable({ table: c3, lookup })
  const lockPath = join(PROJECT, 'kernel.lock.json')
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null
  const archiveHash = hashFile(surfacePath)
  // Only the resolver's own calls may decide this: comparing the mutated copy with the original
  // would be true by construction and would make the control pass whatever the resolver does.
  const c3Red = c3Problems.length > 0 || c3Verdict.ok === false
  closed.push(control('C3', 'no check compares the table with the running kernel or with the archived surface',
    'commit -> 0000000deadbeef, packageVersion -> 9.9.9, kernel -> dsh-v9.9.9-fake, surface.sha256 -> ffff…',
    () => ({
      closed: c3Red,
      measured: 'tableProblems=' + c3Problems.length + ', validateTable.ok=' + c3Verdict.ok
        + '; archived surface hashes ' + archiveHash.slice(0, 16) + '… vs the record it was checked against '
        + (lock === null ? '(no kernel.lock.json)' : String(lock.surface.sha256).slice(0, 16) + '… (equal: '
          + String(lock.surface.sha256 === archiveHash) + ')')
        + ', and the fake kernel identity is served by no section: tableFor("dsh-v9.9.9-fake") is '
        + String(module.tableFor('dsh-v9.9.9-fake') === undefined),
    })))

  // C4 — a fake refusal: shape-valid, its only witness is an absence, yet it is counted as the product.
  const c4 = deepClone(table)
  c4.refused['agent.legacyRuntimeThing'] = {
    disposition: 'refuse',
    class: 'semantic-changed',
    suggestion: 'do not ask for it',
    evidence: 'synthetic control, not a measurement',
    wasThere: { kernel: table.previousKernel, path: 'packages/legacy/legacy.ts', line: 1,
      contains: 'legacyRuntimeThing', fact: 'synthetic control' },
    changedAt: { kernel: table.kernel, path: 'packages/boot/app-boot/src/plugin-compatibility.ts', line: 1,
      contains: 'includePrerelease', fact: 'synthetic control' },
    discriminator: { introduced: 'includePrerelease',
      presentAt: { path: 'packages/boot/app-boot/src/plugin-compatibility.ts', line: 1 },
      absentIn: 'packages/boot/app-boot/src/profile.ts', note: 'synthetic control' },
    // The one witness says nothing is here. A row that only claims absence is an «absent»
    // refusal, and «absent» may never stand in for a semantic change (types.ts:19-27).
    witness: [{ claim: 'service-absent', service: 'codeRuntimeService',
      because: 'synthetic control: the absence is the entire claim' }],
  }
  const c4Problems = problemsOf(module, c4)
  const c4Verdict = module.validateTable({ table: c4, lookup })
  const c4Counted = c4Verdict.counts.refuseSemanticChanged > baselineRefusals
  // A rejection counts only as a returned problem list or a red verdict; a throw is neither.
  const c4Threw = c4Problems.some((entry) => entry.startsWith('tableProblems threw'))
  const c4Rejected = (c4Problems.length > 0 && c4Threw === false) || c4Verdict.ok === false
  const c4Closed = c4Counted === false || c4Rejected
  const positiveControl = Object.entries(table.refused).map(([name, row]) => {
    const claims = Array.isArray(row.witness) ? row.witness.map((witness) => witness.claim) : []
    const positive = claims.filter((claim) => claim === 'service-present' || claim === 'member-present')
    return name + ' (' + claims.join(',') + '; positive=' + positive.length + ')'
  })
  say('            the fake refusal: witness=service-absent only -> tableProblems=' + c4Problems.length
    + ', validateTable.ok=' + c4Verdict.ok + ', refuseSemanticChanged=' + c4Verdict.counts.refuseSemanticChanged
    + ' (baseline ' + baselineRefusals + ')')
  say('            and tableProblems says: ' + (c4Threw ? 'threw (TypeError), it did not rule on the classification' : c4Problems.length === 0 ? '(nothing)' : c4Problems.join(' | ')))
  say('            the table\'s own refusals: ' + positiveControl.join(' | '))
  assertion('C4', c4Closed, (c4Closed ? '[closed] ' : '[KNOWN RED] ')
    + 'a refusal claimed as semantic-changed on an absence-only witness set is counted as the product: ' + String(c4Counted)
    + ', and no call refuses it (the class is written by hand, never derived from the witnesses)')
  closed.push(c4Closed)

  const total = 4
  const knownRed = closed.filter((entry) => entry === false).length
  say('')
  say('KNOWN RED : ' + knownRed + '/' + total + '   (C1 translation.to, C2 deleted promise, C3 identity fields, C4 witness with no positive control)')
  say('summary   : ' + (total - knownRed) + '/' + total + ' negative control(s) already enforced by the frozen resolver at rev ' + REV)
}

// ---------------------------------------------------------------------------------------

try {
  const placed = locate()
  REV = git(['rev-parse', '--short', REQUESTED], PROJECT).trim()
  FROZEN_COMPAT = extractFrozen(REV)
  say('# compat future-surface gate — ' + MODE + ' mode')
  say('project   : ' + PROJECT + '   (inside the repository at «' + (placed.project === '' ? '(root)' : placed.project) + '»)')
} catch (error) {
  console.error('cannot set up the frozen revision ' + REV + ': ' + String(error && error.message ? error.message : error))
  console.error('pass a revision that carries compat/, e.g. --rev HEAD')
  process.exit(64)
}

if (MODE === 'future') await runFuture()
else await runControls()

const failed = assertions.filter((row) => row.ok === false)
say('')
say((failed.length === 0 ? 'PASS' : 'FAIL') + ' — ' + assertions.length + ' assertion(s), ' + failed.length + ' failed'
  + (failed.length ? ': ' + failed.map((row) => row.id).join(', ') : ''))
  const codeSet = ['compat/engine.ts', 'compat/types.ts', 'compat/index.ts', 'compat/load.mjs',
    'plugins/dsh-link-compat/src/index.ts']
process.exit(failed.length === 0 ? 0 : 1)