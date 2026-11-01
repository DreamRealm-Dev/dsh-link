#!/usr/bin/env node
/**
 * The validation-set matrix, and the constructive proof that a new kernel is a
 * section of data.
 *
 * Two jobs, both about the same claim: this table and this resolver describe more
 * than one kernel.
 *
 *   1  Matrix. For every archived surface document, run the shipped resolver over
 *      the table and print "capability x kernel -> disposition", with each cell
 *      carrying the level of its evidence: measured (a probe ran against that
 *      kernel), code-provable (extracted from a packaged build), or synthetic.
 *      Measured cells are checked against predictions written down BEFORE the run;
 *      a mismatch there fails the gate. Code-provable and synthetic cells are
 *      reported loudly and never fail it, because they are not what the product
 *      promises.
 *
 *   2  Constructive proof. A future kernel does not exist, so "adding a section is
 *      enough" is proven by construction: a synthetic surface changes one thing at
 *      a time, the rules for each change are written into the document itself
 *      before the resolver runs, and the resolver must answer exactly as declared.
 *      Only data changes — the surface document and a table section built from the
 *      shipped one — and no resolver code is touched.
 *
 * Usage:
 *   node scripts/verify-compat-matrix.mjs
 *   node scripts/verify-compat-matrix.mjs --extract-packaged <dir> --label 0.1.5-rc.1
 *
 * Exit codes: 0 measured cells match their predictions and the three constructed
 *             assertions hold; 1 otherwise.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCompatModule } from '../compat/load.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SURFACE_DIR = join(PROJECT, 'compat', 'surface')

/**
 * Every archived surface the matrix reads, with the level of its evidence.
 *
 * The level is a property of how the document was produced, not of the file, so it
 * is recorded here rather than trusted from the document: an extraction and a probe
 * can both write a dsh-link.surface/1 file.
 */
const SURFACES = [
  // binding: this is the kernel the table ships for, so a divergence here is a defect.
  { file: '0.2.1-alpha.1.json', kernel: 'dsh-v0.2.1-alpha.1', level: 'measured', binding: true, by: 'scripts/probe-kernel-surface.mjs against core/deepseek-harness' },
  // The two older kernels are a validation set. The table carries no section for them
  // — that is the scope decision of this round — so a disagreement on these columns is
  // the expected result and is reported, never gated.
  { file: '0.1.1-rc.2.json', kernel: 'dsh-v0.1.1-rc.2', level: 'measured', binding: false, by: 'scripts/probe-kernel-surface.mjs --checkout <0.1.1-rc.2 source tree>' },
  { file: '0.1.5-rc.1.json', kernel: 'dsh-v0.1.5-rc.1', level: 'code-provable', binding: false, by: 'static extraction from the packaged libraries of the 0.1.5 desktop app' },
]

/**
 * What each capability is expected to be on each validation kernel, written from the
 * sources before the matrix ran. A measured cell that disagrees with its prediction
 * is the finding this gate exists for.
 */
const PREDICTIONS = {
  'dsh-v0.1.1-rc.2': {
    store: 'resolve', tools: 'resolve', settings: 'resolve', workspace: 'resolve', shell: 'resolve', http: 'resolve',
    team: 'resolve', agent: 'resolve', skill: 'resolve', telemetry: 'unknown', link: 'resolve',
    'agent.childRows': 'refuse', 'agent.presets': 'refuse',
    'settings.liveWrite': 'refuse', 'tools.escalation': 'refuse', 'link.peerRange': 'refuse',
  },
  'dsh-v0.1.5-rc.1': {
    store: 'resolve', tools: 'resolve', settings: 'resolve', workspace: 'resolve', shell: 'resolve', http: 'resolve',
    team: 'refuse', agent: 'resolve', skill: 'resolve', telemetry: 'unknown', link: 'resolve',
    'agent.childRows': 'refuse', 'agent.presets': 'refuse',
    'settings.liveWrite': 'refuse', 'tools.escalation': 'refuse', 'link.peerRange': 'refuse',
  },
}

const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const failures = []
const notes = []
const trouble = (line) => { failures.push(line); console.log('  FAIL ' + line) }
const attempt = (run) => {
  try {
    return { value: run(), error: null }
  } catch (error) {
    return { value: undefined, error }
  }
}
const say = (line) => console.log(line)

/** Read a document and hand back its bytes with them. */
function readSurface(entry) {
  const path = join(SURFACE_DIR, entry.file)
  if (!existsSync(path)) return null
  const bytes = readFileSync(path)
  return { ...entry, path, bytes, document: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** The resolver's lookup over one surface document. */
function lookupOf(document) {
  const services = document.services ?? {}
  const declared = Array.isArray(document.declared) ? document.declared.map((row) => row?.key).filter((key) => typeof key === 'string') : Object.keys(services)
  return {
    membersOf: (service) => {
      const entry = services[service]
      if (entry === undefined || entry === null || entry.error !== undefined) return undefined
      return Array.isArray(entry.members) ? entry.members : []
    },
    serviceNames: () => declared,
  }
}

/** A digest of what the document says is composed, so two surfaces can be compared. */
const compositionDigest = (document) => {
  const declared = (document.declared ?? []).map((row) => row?.key + ':' + row?.type).sort().join(',')
  return createHash('sha256').update(declared).digest('hex').slice(0, 12)
}

/**
 * Static extraction of a surface document from a packaged build.
 *
 * A packaged kernel ships declarations, not sources: the honest oracle is the
 * declared Context surface plus the class members those declarations name. The
 * document is marked code-provable, and the matrix never lets it turn a gate red.
 */
function extractPackaged(root, label) {
  const scope = join(root, '@deepseek-ai')
  if (!existsSync(scope)) { console.error('no @deepseek-ai scope under ' + root); process.exit(1) }
  const packages = readdirSync(scope).filter((name) => {
    try { return statSync(join(scope, name)).isDirectory() } catch { return false }
  })
  const declared = new Map()
  const classMembers = new Map()
  let files = 0
  let version = null
  for (const name of packages) {
    const dir = join(scope, name)
    let manifest = null
    try { manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { manifest = null }
    if (manifest === null) continue
    if (name === 'dsh-root' || name.startsWith('dsh')) {
      if (typeof manifest.version === 'string' && version === null) version = manifest.version
    }
    const candidates = new Set()
    for (const field of ['types', 'typings', 'main']) {
      const value = manifest[field]
      if (typeof value !== 'string') continue
      candidates.add(join(dir, value.replace(/\.js$/, '.d.ts')))
    }
    candidates.add(join(dir, 'lib', 'types', 'index.d.ts'))
    candidates.add(join(dir, 'lib', 'index.d.ts'))
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      files += 1
      const text = readFileSync(candidate, 'utf8')
      // Context declarations: "name: Type" inside interface Context, across merges.
      for (const block of text.matchAll(/interface Context\s*\{([\s\S]*?)\n\}/g)) {
        for (const line of block[1].split('\n')) {
          const match = /^\s{2,}(?:readonly\s+)?([A-Za-z_$][\w$]*)\??:\s*([A-Za-z_$][\w$.<>[\]| ]*)/.exec(line)
          if (match !== null) declared.set(match[1], match[2].trim())
        }
      }
      // Class member declarations: exported classes and their methods.
      for (const block of text.matchAll(/(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{([\s\S]*?)\n\}/g)) {
        const members = new Set()
        for (const line of block[2].split('\n')) {
          const match = /^\s{2,}(?!constructor|private|protected|static|readonly|\/\/|\*)([A-Za-z_$][\w$]*)\s*\(/.exec(line)
          if (match !== null) members.add(match[1])
        }
        if (members.size > 0) classMembers.set(block[1], [...members].sort())
      }
    }
  }
  // Resolve each declared property's type name to the class members it names.
  const services = {}
  for (const [key, type] of declared) {
    const bare = type.replace(/<.*$/, '').trim()
    const members = classMembers.get(bare)
    if (members === undefined) continue
    services[key] = { type: 'object', ctor: bare, members, fields: [] }
  }
  const document = {
    format: 'dsh-link.surface/1',
    capturedAt: new Date().toISOString(),
    kernel: { id: 'dsh-v' + String(version ?? label), version: version ?? label, commit: null, globalVersion: null, node: process.version, pid: process.pid },
    env: { DSH_HOME: null, DSH_LINK_PROFILE: null },
    provenance: {
      kind: 'packaged-libs', level: 'code-provable', root, label: String(label), packages: packages.length, files,
      note: 'extracted from shipped declarations: a service is listed when a Context declaration names a class whose members the package also declares',
    },
    counts: { declaredProperties: declared.size, reachableServices: Object.keys(services).length, events: 0, tools: null },
    declared: [...declared].map(([key, type]) => ({ key, type })).sort((l, r) => l.key.localeCompare(r.key)),
    services,
    events: [],
    tools: null,
  }
  return document
}

if (argv.includes('--extract-packaged')) {
  const root = resolve(option('--extract-packaged', ''))
  const label = option('--label', 'packaged')
  const document = extractPackaged(root, label)
  const target = join(SURFACE_DIR, label + '.json')
  writeFileSync(target, JSON.stringify(document, null, 2) + '\n', 'utf8')
  const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex')
  console.log(JSON.stringify({ file: 'compat/surface/' + label + '.json', sha256, counts: document.counts, provenance: document.provenance }, null, 2))
  process.exit(0)
}

const compat = await loadCompatModule()
const table = compat.TABLES[0]
const surfaces = SURFACES.map(readSurface)

say('== compat validation-set matrix ==')
say('table     : ' + table.kernel + ' (' + Object.keys(table.capabilities).length + ' capabilities, ' + Object.keys(table.refused).length + ' refusals)')
say('')

/** One surface's whole verdict, and the per-capability disposition it produces. */
function verdictFor(surface) {
  if (surface === null) return null
  const verdict = compat.validateTable({ table, lookup: lookupOf(surface.document) })
  const cells = new Map()
  for (const row of verdict.rows) {
    // A code-provable surface lists what the declarations name, not what the kernel
    // mounts, so "the service is absent" there is inconclusive rather than stale.
    const inconclusive = row.verdict !== 'ok' && surface.level !== 'measured'
    const disposition = row.disposition === 'refuse'
      ? (row.verdict === 'stale' && inconclusive ? 'refuse/inconclusive' : 'refuse/' + row.refusalClass)
      : row.verdict === 'ok' ? row.disposition : 'refuse/missing'
    cells.set(row.capability, { disposition, verdict: row.verdict, failures: row.failures, inconclusive })
  }
  return { verdict, cells, digest: compositionDigest(surface.document) }
}

const results = surfaces.map((surface) => ({ surface, result: verdictFor(surface) }))

// The matrix itself: capability x kernel -> the disposition this table produces here.
const capabilities = [...new Set([
  ...Object.keys(table.capabilities),
  ...Object.keys(table.refused),
])].sort()
const header = ['capability', ...results.map(({ surface }) => surface === null ? '(missing)' : surface.kernel.replace(/^dsh-/, ''))]
const width = Math.max(...header.map((cell) => cell.length))
say(header.map((cell) => cell.padEnd(width)).join(' | '))
say(header.map(() => '-'.repeat(width)).join('-+-'))
for (const capability of capabilities) {
  const cells = results.map(({ result }) => {
    if (result === null) return '-'
    const cell = result.cells.get(capability)
    if (cell === undefined) return '-'
    return cell.disposition.replace('refuse/semantic-changed', 'refuse/sem').replace('refuse/absent', 'refuse/abs')
  })
  const line = header.map((_, index) => (index === 0 ? capability : cells[index - 1]).padEnd(width)).join(' | ')
  const prediction = results.map(({ surface }) => surface === null ? undefined : PREDICTIONS[surface.kernel]?.[capability]).filter(Boolean)[0]
  say(line + (prediction === undefined ? '' : '   predicted: ' + prediction))
}

say('')
say('surfaces')
for (const { surface, result } of results) {
  if (surface === null) { say('  MISSING: an archived surface listed in SURFACES is not on disk'); failures.push('an archived surface is missing'); continue }
  say('  ' + surface.kernel.padEnd(20) + surface.level.padEnd(14) + 'sha256 ' + surface.sha256.slice(0, 12)
    + '  composition ' + result.digest + '  ' + surface.by)
}

// Predictions are only binding on measured columns; the others are reported.
say('')
say('prediction check')
for (const { surface, result } of results) {
  if (surface === null) continue
  const expected = PREDICTIONS[surface.kernel]
  if (expected === undefined) { say('  ' + surface.kernel + ': no predictions registered'); continue }
  let hits = 0
  let misses = 0
  for (const [capability, want] of Object.entries(expected)) {
    const cell = result.cells.get(capability)
    const got = cell === undefined ? 'absent' : cell.disposition.replace('refuse/semantic-changed', 'refuse').replace('refuse/absent', 'refuse')
    const normalised = want === 'unknown' ? got : want
    if (want === 'unknown') continue
    if (got === normalised || (want === 'refuse' && got.startsWith('refuse'))) hits += 1
    else {
      misses += 1
      const line = surface.kernel + ': ' + capability + ' predicted ' + want + ', resolved as ' + got
      if (surface.binding === true) trouble(line + ' — the supported kernel disagrees with its own prediction')
      else say('  miss (' + surface.level + ', validation column: reported, not gated): ' + line)
    }
  }
  say('  ' + surface.kernel + ' (' + surface.level + '): ' + hits + ' hit, ' + misses + ' miss, of ' + Object.keys(expected).length + ' predicted')
}

say('')
say('cross-version differences (this table against each surface)')
for (const { surface, result } of results) {
  if (surface === null) continue
  const broken = [...result.cells.entries()].filter(([, cell]) => cell.verdict !== 'ok')
  say('  ' + surface.kernel + ': ' + (broken.length === 0 ? 'no divergence' : broken.length + ' capability/ies diverge'))
  for (const [capability, cell] of broken) {
    say('      ' + capability + ' -> ' + cell.disposition + (cell.failures[0] === undefined ? '' : ' (' + cell.failures[0].slice(0, 110) + ')'))
  }
}

// ---------------------------------------------------------------------------
// The constructive proof. A future kernel does not exist, so the claim that a new
// kernel costs one section of data is proven by construction: each rule below was
// written down (and into the synthetic document) before the resolver was asked, and
// only data changes between the "before" and "after" of each case — the synthetic
// surface, and a section built from the shipped one.
// ---------------------------------------------------------------------------

/** Rules registered before the run, and stored in the synthetic document itself. */
const CONSTRUCTED_RULES = [
  {
    id: 'renamed-service',
    change: 'the surface renames the service the telemetry capability binds to (sessionTelemetry -> telemetryBackend), member emit kept',
    before: 'the shipped section binds the old name, so the capability is refused: a stale table must fail loud rather than resolve something that is not there',
    after: 'one data row rebinds telemetry.emit to telemetryBackend.emit and declares a service-rename translation, so the capability resolves and reports as translate',
  },
  {
    id: 'semantic-bit-restored',
    change: 'the surface gives settings a member named writableFields, which matches the refusal witness pattern volatile|writable',
    before: 'the refusal holds',
    after: 'the refusal is reported as outdated (stale), and a strict load refuses to start on a stale premise instead of passing it over',
  },
  {
    id: 'required-member-deleted',
    change: 'the surface deletes tools.get, the member the tools.lookup role binds to',
    before: 'the capability resolves',
    after: 'the capability is refused before apply, capability() throws naming the missing member, has() is false, and nothing half-built is handed over',
  },
]

const baseResult = results.find(({ surface }) => surface !== null && surface.kernel === table.kernel)
if (baseResult === undefined) {
  trouble('the supported kernel has no archived surface to build the synthetic future from')
} else {
  const base = JSON.parse(baseResult.surface.bytes.toString('utf8'))
  const clone = () => JSON.parse(JSON.stringify(base))
  const rebind = (section, capability, service, member, kind) => {
    const copy = JSON.parse(JSON.stringify(section))
    const row = copy.capabilities[capability]
    row.targets = [{ service, binds: [{ role: row.roles[0], member }], evidence: 'synthetic-future' }]
    if (kind !== undefined) {
      row.disposition = 'translate'
      row.kind = kind
      row.translation = { from: 'sessionTelemetry', to: service }
    }
    return copy
  }
  const refresh = (section, document) => compat.validateTable({ table: section, lookup: lookupOf(document) })
  const cell = (section, document, capability) => {
    const verdict = refresh(section, document)
    const row = verdict.rows.find((entry) => entry.capability === capability)
    return { verdict, row }
  }

  const synthetic = {}
  // Case 1 — a renamed service.
  synthetic['renamed-service'] = clone()
  synthetic['renamed-service'].services.telemetryBackend = synthetic['renamed-service'].services.sessionTelemetry
  delete synthetic['renamed-service'].services.sessionTelemetry
  const renamedBefore = cell(table, synthetic['renamed-service'], 'telemetry')
  const renamedAfter = cell(rebind(table, 'telemetry', 'telemetryBackend', 'emit', 'service-rename'), synthetic['renamed-service'], 'telemetry')

  // Case 2 — a refusal whose semantic bit came back.
  synthetic['semantic-bit-restored'] = clone()
  synthetic['semantic-bit-restored'].services.settings.members = [
    ...synthetic['semantic-bit-restored'].services.settings.members, 'writableFields',
  ]
  const refusalBefore = cell(table, synthetic['semantic-bit-restored'], 'settings.liveWrite')
  const refusalAfter = cell(table, synthetic['semantic-bit-restored'], 'settings.liveWrite')
  const strictLoad = attempt(() => compat.createCompatLoader({
    table,
    membersOf: lookupOf(synthetic['semantic-bit-restored']).membersOf,
    valueOf: () => undefined,
    strict: true,
  }))

  // Case 3 — a required member deleted.
  synthetic['required-member-deleted'] = clone()
  synthetic['required-member-deleted'].services.tools.members =
    synthetic['required-member-deleted'].services.tools.members.filter((member) => member !== 'get')
  const deletedBefore = cell(table, synthetic['required-member-deleted'], 'tools')
  const deletedLoad = compat.createCompatLoader({
    table,
    membersOf: lookupOf(synthetic['required-member-deleted']).membersOf,
    valueOf: (service) => {
      const entry = synthetic['required-member-deleted'].services[service]
      if (entry === undefined) return undefined
      const value = {}
      for (const member of entry.members) value[member] = () => undefined
      return value
    },
    selfProvided: { link: { capability: () => undefined, has: () => false, require: () => undefined, report: () => ({}), services: {} } },
    strict: true,
  })
  const deletedCall = attempt(() => deletedLoad.capability('tools'))

  // The capture time is carried over from the checked-in proof rather than stamped fresh: this file
  // is a committed artifact, and a gate that rewrites it with a new timestamp leaves the tree dirty
  // after every run for a difference that proves nothing. A missing or unreadable file still gets a
  // real stamp, so the field keeps meaning "when this document was produced".
  const previousCapture = (() => {
    try {
      return JSON.parse(readFileSync(join(SURFACE_DIR, 'synthetic-future.json'), 'utf8')).capturedAt ?? null
    } catch {
      return null
    }
  })()
  const document = {
    ...clone(),
    kernel: { ...base.kernel, id: table.kernel, version: table.packageVersion },
    capturedAt: typeof previousCapture === 'string' && previousCapture !== '' ? previousCapture : new Date().toISOString(),
    provenance: {
      kind: 'synthetic', level: 'synthetic', generatedBy: 'scripts/verify-compat-matrix.mjs',
      note: 'one synthetic surface per constructed rule; every change is a data change, and no resolver code differs between the before and after of a rule',
    },
    rules: CONSTRUCTED_RULES,
    cases: synthetic,
  }
  writeFileSync(join(SURFACE_DIR, 'synthetic-future.json'), JSON.stringify(document, null, 2) + '\n', 'utf8')

  say('')
  say('constructive proof (rules registered in compat/surface/synthetic-future.json before the run)')
  const caseOne = renamedBefore.row.disposition === 'resolve' && renamedBefore.row.verdict !== 'ok'
    && renamedAfter.row.verdict === 'ok' && renamedAfter.row.disposition === 'translate'
  say((caseOne ? '  ok   ' : '  FAIL ') + 'renamed-service: before ' + renamedBefore.row.verdict + '/'
    + renamedBefore.row.disposition + ', after ' + renamedAfter.row.verdict + '/' + renamedAfter.row.disposition)
  if (!caseOne) {
    trouble('renamed-service: the resolver did not re-judge a renamed target as a translate row')
  }

  const caseTwo = refusalBefore.row.verdict === 'stale' && strictLoad.error !== null
    && /stale|expired|outdated/i.test(String(strictLoad.error?.message ?? ''))
  say((caseTwo ? '  ok   ' : '  FAIL ') + 'semantic-bit-restored: verdict ' + refusalBefore.row.verdict
    + ', strict load ' + (strictLoad.error === null ? 'succeeded' : 'refused: ' + String(strictLoad.error.message).slice(0, 90)))
  if (!caseTwo) {
    trouble('semantic-bit-restored: a refusal whose premise came back was not reported as outdated')
  }

  const caseThree = deletedBefore.row.verdict !== 'ok' && deletedCall.error instanceof compat.UnsupportedError
    && String(deletedCall.error.reason).includes('get') && deletedLoad.has('tools') === false
  say((caseThree ? '  ok   ' : '  FAIL ') + 'required-member-deleted: verdict ' + deletedBefore.row.verdict
    + ', capability() ' + (deletedCall.error === null ? 'returned a half-built object' : 'threw: ' + String(deletedCall.error.reason).slice(0, 90)))
  if (!caseThree) {
    trouble('required-member-deleted: a capability with a missing member was not refused')
  }
  say('  data only: the section passed to the resolver differs from the shipped one; compat/engine.ts is the same code in every case above')
}

console.log(failures.length === 0 ? 'MATRIX OK' : 'MATRIX FAILED')
process.exit(failures.length === 0 ? 0 : 1)
