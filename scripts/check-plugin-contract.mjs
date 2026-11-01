#!/usr/bin/env node
/**
 * Judge any plugin package against the executable plugin contract.
 *
 * The rule set is data: compat/plugin-contract.json. This file implements the six check kinds it
 * names and nothing else, so a rule whose kind this checker does not know is reported unknown rather
 * than passed. Every verdict carries the basis it was decided from: a file:line, a specifier, a range,
 * a service name. A reading that could not be taken is unknown and says why - unknown is never pass.
 *
 * Usage:
 *   node scripts/check-plugin-contract.mjs <pluginDir> [--json]
 *   node scripts/check-plugin-contract.mjs --self-test
 *   node scripts/check-plugin-contract.mjs --all [--out compat/adaptation/plugin-contract.json]
 *   node scripts/check-plugin-contract.mjs --all --check
 *
 * Exit codes: 0 every reading held (rewrite/note failures and unknowns are counted in the summary but
 * do not fail the run); 1 a refuse-level rule failed; 2 bad usage; 3 an input is missing.
 *
 * The checking paths read only. --all --out is the producer: it rewrites the tracked reading, and
 * --all --check recomputes it and compares, which is how a gate re-derives the same file.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'
import { patchFilesOf, readPatch } from './read-composition-rows.mjs'
import { kernelRoster } from './compose-profile-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RULES_PATH = join(REPO, 'compat', 'plugin-contract.json')
const CLIENT_SURFACE = join(REPO, 'compat', 'surface', 'client-0.2.1-alpha.1.json')
const COMPOSITION = join(REPO, 'compat', 'adaptation', 'rows', 'profile-composition.json')
const PORT_VERDICTS = join(REPO, 'compat', 'adaptation', 'port-verdicts.json')
const TARGETS = join(REPO, 'compat', 'adaptation', 'usage-targets.json')
const DEFAULT_OUT = join(REPO, 'compat', 'adaptation', 'plugin-contract.json')
const FORMAT = 'dsh-link.plugin-contract-readings/1'
const READ_KINDS = ['package-field', 'row-patch', 'import-specifier', 'client-usage', 'peer-range', 'licence']

/** Licences a host may load and redistribute with the package. */
const PERMISSIVE = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0']

/** @param {string} file @returns {any|null} parsed JSON, or null when it cannot be read. */
function jsonOf(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** @param {string} dir @returns {any|null} the package manifest, or null when unreadable. */
function manifestOf(dir) {
  return jsonOf(join(dir, 'package.json'))
}

/** @param {string} dir @returns {string[]} the declared bundle patch files, resolved. */
function declaredPatches(dir, manifest) {
  const declared = manifest?.dsh?.bundle?.patch
  const list = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.filter((entry) => typeof entry === 'string') : []
  return list.map((entry) => ({ declared: entry, path: resolve(dir, entry), exists: existsSync(resolve(dir, entry)) }))
}

/**
 * The client services a package declares for itself, by augmenting the Cordis Context interface.
 *
 * A plugin may publish its own client service (dsh-theme-settings publishes liquidGlass), and that name
 * cannot be in a surface captured from the kernel packages. Reading the package's own augmentation keeps
 * that case out of the absent pile, where it would be reported as a kernel-side absence that is not one.
 *
 * @param {string} dir - the package directory.
 * @returns {Map<string, string[]>} service name to the file:line that declares it.
 */
function declaredServices(dir) {
  const found = new Map()
  const walk = (at) => {
    let entries = []
    try { entries = readdirSync(at, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const next = join(at, entry.name)
      if (entry.isDirectory()) { walk(next); continue }
      if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry.name) === false) continue
      let text = ''
      try { text = readFileSync(next, 'utf8') } catch { continue }
      if (text.includes('declare module') === false || text.includes('interface Context') === false) continue
      const lines = text.split(/\r?\n/)
      let inFace = false
      let depth = 0
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (inFace === false && /^\s*interface Context \{/.test(line)) { inFace = true; depth = 1; continue }
        if (inFace === false) continue
        if (/^\s{0,2}\}/.test(line)) { inFace = false; continue }
        const match = /^\s+?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?:]/.exec(line)
        if (match !== null) {
          const list = found.get(match[1]) ?? []
          list.push(next.replace(/\\/g, '/').slice(dir.length + 1) + ':' + String(index + 1))
          found.set(match[1], list)
        }
        depth += 0
      }
    }
  }
  walk(dir)
  return found
}

/** @param {string} text @returns {boolean} whether a patch document opens as a top-level sequence. */
function opensAsSequence(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    return trimmed.startsWith('- ') || trimmed === '-'
  }
  return false
}

/** How a roster origin is named in a basis: the reader has to see which truth decided the pass. */
const KERNEL_LABEL = { workspace: 'kernel-packages', app: 'kernel-app', vendor: 'kernel-vendor' }
const KERNEL_ROSTER = kernelRoster()
// Client services this repository's own plugin packages declare or publish. The kernel capture reads the
// kernel packages, so a service another plugin publishes (dsh-liquid-glass provides liquidGlass at
// plugins/dsh-liquid-glass/src/client/index.ts) is invisible to it; reading the local tree keeps that case
// out of the absent pile without turning a genuine absence into a pass.
const REPO_DECLARED_SERVICES = declaredServices(join(REPO, 'plugins'))
const CLIENT_BASELINE = (() => {
  try { return JSON.parse(readFileSync(join(REPO, 'compat', 'host-modules.json'), 'utf8')).clientBaseline ?? [] } catch { return [] }
})()

/** @param {string} name @returns {boolean} whether the kernel tree carries this package: workspace or vendored. */
function kernelProvides(name) {
  return name.startsWith('node:') || name.startsWith('dsh:') || KERNEL_ROSTER.has(name)
}

/**
 * Which source of truth provides a specifier to a plugin, when one does.
 *
 * Two sources, both read from data: the kernel's own package tree (packages/**, apps/* and vendor/*,
 * enumerated by kernelRoster) and the client baseline the web shell preloads (compat/host-modules.json).
 * Naming the source in the basis is the point: a reader has to tell which truth decided a pass.
 *
 * @param {string} specifier - a bare specifier or a node builtin.
 * @returns {string|null} a source label, or null when nothing provides it.
 */
function hostSource(specifier, sources = { workspace: true, app: true, vendor: true, baseline: true }) {
  if (specifier.startsWith('node:') || specifier.startsWith('dsh:')) return 'node builtin'
  const pkg = packageOf(specifier)
  const carried = KERNEL_ROSTER.get(pkg)
  const carriedUsable = carried !== undefined && sources[carried.origin] === true
  const preloaded = sources.baseline && (CLIENT_BASELINE.includes(specifier) || CLIENT_BASELINE.includes(pkg))
  if (carriedUsable && preloaded) return (KERNEL_LABEL[carried.origin] ?? 'kernel-packages') + '+client-baseline'
  if (carriedUsable) return KERNEL_LABEL[carried.origin] ?? 'kernel-packages'
  if (preloaded) return 'client-baseline'
  return null
}

/** @param {string} specifier @returns {boolean} whether the host provides this specifier from either source. */
function hostProvides(specifier, sources = { workspace: true, app: true, vendor: true, baseline: true }) {
  return hostSource(specifier, sources) !== null
}

/** @param {string} dir @param {string} specifier @returns {{resolved: boolean, why: string}} */
function resolvesFrom(dir, specifier, sources = { workspace: true, app: true, vendor: true, baseline: true }) {
  if (specifier.startsWith('node:')) return { resolved: true, why: 'node builtin' }
  if (specifier.startsWith('.')) {
    const at = resolve(dir, specifier)
    const candidates = [at, at + '.js', at + '.mjs', at + '.cjs', join(at, 'index.js')]
    return { resolved: candidates.some((file) => existsSync(file)), why: 'relative path ' + specifier }
  }
  if (isAbsolute(specifier)) return { resolved: existsSync(specifier), why: 'absolute path' }
  try {
    createRequire(join(dir, 'package.json')).resolve(specifier)
    return { resolved: true, why: 'resolved from the package' }
  } catch (error) {
    const source = hostSource(specifier, sources)
    if (source !== null) return { resolved: true, why: 'provided by the host (' + source + ')' }
    return { resolved: false, why: String(error?.code ?? 'unresolved') }
  }
}

/** @param {string} specifier @returns {string} the package a bare specifier names. */
function packageOf(specifier) {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? parts[0] + '/' + parts[1] : specifier
  return parts[0]
}

/**
 * Whether a semver range admits a version, for the range forms peer ranges actually use.
 *
 * @param {string} range - the declared range.
 * @param {string} version - the running version.
 * @returns {boolean|null} true, false, or null when the range is a form this reader does not decide.
 */
function admitsVersion(range, version) {
  const triple = (text) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim())
    return match === null ? null : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null }
  }
  const compare = (left, right) => {
    if (left.major !== right.major) return left.major < right.major ? -1 : 1
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
    if (left.pre === right.pre) return 0
    if (left.pre === null) return 1
    if (right.pre === null) return -1
    return left.pre < right.pre ? -1 : 1
  }
  const target = triple(version)
  if (target === null) return null
  const alternatives = String(range).split('||')
  let decided = false
  for (const alternative of alternatives) {
    const clauses = alternative.trim().split(/\s+/).filter((part) => part !== '')
    let holds = clauses.length > 0
    for (const clause of clauses) {
      if (clause === '*' || clause === 'x' || clause === '') continue
      const operator = /^([\^~<>=]*)(.*)$/.exec(clause)
      const op = operator[1]
      const bound = triple(operator[2])
      if (bound === null) return null
      if (op === '' || op === '=') holds = holds && compare(target, bound) === 0
      else if (op === '>') holds = holds && compare(target, bound) > 0
      else if (op === '>=') holds = holds && compare(target, bound) >= 0
      else if (op === '<') holds = holds && compare(target, bound) < 0
      else if (op === '<=') holds = holds && compare(target, bound) <= 0
      else if (op === '^') holds = holds && compare(target, bound) >= 0 && target.major === bound.major && (bound.major > 0 || target.minor === bound.minor)
      else if (op === '~') holds = holds && compare(target, bound) >= 0 && target.major === bound.major && target.minor === bound.minor
      else return null
    }
    if (holds) decided = true
  }
  return decided
}

/** A verdict record, in the shape every rule reports. */
const verdict = (rule, status, basis, extra) => Object.assign({ rule: rule.id, severity: rule.severity, kind: rule.check.kind, category: rule.category ?? null, verdict: status, basis }, extra ?? {})

/**
 * Judge one plugin directory against the rule set.
 *
 * @param {string} dir - the package directory.
 * @param {{rules: any[], clientSurface: any, composition: any}} context - the rule set and the captured surfaces.
 * @returns the per-rule readings, their counts, and the exit code the readings imply.
 */
export function checkPlugin(dir, context) {
  const manifest = manifestOf(dir)
  const name = typeof manifest?.name === 'string' ? manifest.name : null
  const version = typeof manifest?.version === 'string' ? manifest.version : null
  const licence = typeof manifest?.license === 'string' ? manifest.license : null
  const declared = manifest === null ? [] : declaredPatches(dir, manifest)
  const missingManifest = manifest === null
  const patchRecords = []
  const patchProblems = []
  for (const file of declared) {
    if (!file.exists) continue
    if (opensAsSequence(readFileSync(file.path, 'utf8')) === false) { patchProblems.push(file); continue }
    try { patchRecords.push({ file, parsed: readPatch(file.path) }) } catch (error) { patchProblems.push(file) }
  }
  const rows = patchRecords.flatMap((entry) => entry.parsed.rows.map((row) => ({ row, file: entry.file })))
  let analysis = null
  try { analysis = analyze(dir) } catch (error) { analysis = null }
  const clientSurface = context.clientSurface ?? {}
  const composition = context.composition ?? null
  const byId = new Map(((composition?.ids) ?? []).map((entry) => [entry.id, entry]))
  const kernelVersion = context.kernelVersion ?? ''
  // Which truths about host-provided modules this run is allowed to consult. The producer runs the legacy
  // set (kernel workspace only) beside the current one, so a rule that flipped from fail to pass because
  // the roster learned a source is named rather than quietly green.
  const hostSources = context.hostSources ?? { workspace: true, app: true, vendor: true, baseline: true }

  const readings = []
  for (const rule of context.rules) {
    const kind = rule.check.kind
    const which = rule.check.rule
    if (READ_KINDS.includes(kind) === false) { readings.push(verdict(rule, 'unknown', ['check.kind "' + kind + '" is not one of ' + READ_KINDS.join(', ')], { unknownBecause: 'this checker implements no reading for that kind', toDecide: 'implement the kind or drop the rule' })); continue }
    if (missingManifest && rule.id !== 'manifest-readable') { readings.push(verdict(rule, 'unknown', ['package.json is unreadable at ' + dir], { unknownBecause: 'no manifest to read', toDecide: 'a readable package.json' })); continue }

    if (kind === 'package-field' && which === 'manifest-readable') {
      if (manifest === null) readings.push(verdict(rule, 'fail', ['package.json is missing or unreadable at ' + dir]))
      else if (name === null) readings.push(verdict(rule, 'fail', ['package.json declares no "name"']))
      else if (typeof manifest.version !== 'string') readings.push(verdict(rule, 'fail', ['package.json declares no "version"']))
      else readings.push(verdict(rule, 'pass', ['package.json: ' + name + '@' + version]))
      continue
    }
    if (kind === 'package-field' && which === 'patch-declared-exists') {
      if (declared.length === 0) readings.push(verdict(rule, 'pass', ['no dsh.bundle.patch declared: the package contributes no rows']))
      else {
        const missing = declared.filter((file) => file.exists === false)
        readings.push(missing.length === 0
          ? verdict(rule, 'pass', declared.map((file) => file.declared + ' -> ' + file.path))
          : verdict(rule, 'fail', missing.map((file) => 'dsh.bundle.patch declares ' + file.declared + ', missing at ' + file.path)))
      }
      continue
    }
    if (kind === 'package-field' && which === 'dependency-declared') {
      if (analysis === null) readings.push(verdict(rule, 'unknown', ['the package could not be read for imports'], { unknownBecause: 'the analyzer could not read the package', toDecide: 'a readable package tree' }))
      else {
        const declaredNames = new Set()
        for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
          for (const key of Object.keys(manifest[section] ?? {})) declaredNames.add(key)
        }
        const undeclared = analysis.imports.filter((entry) => {
          if (entry.specifier.startsWith('.') || isAbsolute(entry.specifier) || entry.specifier.startsWith('node:')) return false
          const pkg = packageOf(entry.specifier)
          return declaredNames.has(pkg) === false && hostProvides(entry.specifier, hostSources) === false
        })
        const hosted = analysis.imports.filter((entry) => declaredNames.has(packageOf(entry.specifier)) === false && hostProvides(entry.specifier, hostSources))
        readings.push(undeclared.length === 0
          ? verdict(rule, 'pass', [analysis.imports.length + ' import(s), every bare one declared or host-provided', ...(hosted.length === 0 ? [] : ['host-provided: ' + hosted.slice(0, 6).map((entry) => entry.specifier + ' -> ' + hostSource(entry.specifier, hostSources)).join(', ')])])
          : verdict(rule, 'fail', undeclared.map((entry) => entry.specifier + ' imported at ' + (entry.at[0] ?? '?') + ' is not declared, not carried by the kernel (packages/** or vendor/*), and not in the client baseline')))
      }
      continue
    }
    if (kind === 'row-patch' && which === 'top-level-array') {
      if (declared.length === 0) readings.push(verdict(rule, 'pass', ['no patch file declared']))
      else if (patchProblems.length > 0) readings.push(verdict(rule, 'fail', patchProblems.map((file) => file.path + ' does not open as a top-level sequence')))
      else readings.push(verdict(rule, 'pass', patchRecords.map((entry) => entry.file.path + ' opens as a top-level sequence')))
      continue
    }
    if (kind === 'row-patch' && which === 'ids-and-inserts') {
      if (declared.length === 0) readings.push(verdict(rule, 'pass', ['no patch file declared']))
      else {
        const broken = rows.filter((entry) => ['skipped-no-id', 'duplicate-insert-id', 'unknown-metadata-key'].includes(entry.row.class))
        const nameless = rows.filter((entry) => entry.row.origin === 'insert-child' && (typeof entry.row.name !== 'string' || typeof entry.row.id !== 'string' || entry.row.id === ''))
        const problems = [...broken.map((entry) => entry.row.file + ':' + entry.row.line + ' class ' + entry.row.class), ...nameless.map((entry) => entry.row.file + ':' + entry.row.line + ' insert child names no module')]
        readings.push(problems.length === 0
          ? verdict(rule, 'pass', [rows.length + ' row(s) read, none is a skipped id, a duplicate id, an unknown metadata key, or an insert child without id and name'])
          : verdict(rule, 'fail', problems))
      }
      continue
    }
    if (kind === 'row-patch' && which === 'id-contested-in-composition') {
      const ids = [...new Set(rows.filter((entry) => entry.row.origin === 'insert-child' && typeof entry.row.id === 'string').map((entry) => entry.row.id))]
      if (composition === null) readings.push(verdict(rule, 'unknown', ['the composition reading is not on this machine'], { unknownBecause: 'no profile-composition.json', toDecide: 'run the composer' }))
      else if (ids.length === 0) readings.push(verdict(rule, 'pass', ['the package inserts no id']))
      else {
        const contested = ids.filter((id) => (byId.get(id)?.flags ?? []).includes('configSuperseded'))
        const absent = ids.filter((id) => byId.has(id) === false)
        if (contested.length > 0) readings.push(verdict(rule, 'fail', contested.map((id) => 'id ' + id + ' is claimed by a later layer: ' + JSON.stringify(byId.get(id).flags))))
        else if (absent.length > 0) readings.push(verdict(rule, 'unknown', ['id(s) ' + absent.join(', ') + ' are not in this composition at all'], { unknownBecause: 'this composition never claims those ids, so nothing here can tell whether another layer would', toDecide: 'a composition that mounts this package' }))
        else readings.push(verdict(rule, 'pass', ids.map((id) => id + ' -> ' + JSON.stringify(byId.get(id).flags))))
      }
      continue
    }
    if (kind === 'import-specifier' && which === 'row-module-resolves') {
      const named = rows.filter((entry) => typeof entry.row.name === 'string')
      if (declared.length === 0) readings.push(verdict(rule, 'pass', ['no patch file declared, so no row names a module']))
      else if (named.length === 0) readings.push(verdict(rule, 'pass', ['no row names a module']))
      else {
        const unresolved = []
        for (const entry of named) {
          const base = dirname(entry.file.path)
          const target = entry.row.name
          const probe = target.startsWith('.') ? resolvesFrom(base, target) : resolvesFrom(dir, target, hostSources)
          if (probe.resolved === false) unresolved.push(target + ' at ' + entry.row.file + ':' + entry.row.line + ' (' + probe.why + ')')
        }
        readings.push(unresolved.length === 0
          ? verdict(rule, 'pass', named.length + ' row module specifier(s) resolve')
          : verdict(rule, 'fail', unresolved))
      }
      continue
    }
    if (kind === 'peer-range' && which === 'admits-kernel') {
      // Only kernel WORKSPACE packages are measured against the kernel version: they are released in
      // lockstep with it. A vendored framework package carries its own upstream version line
      // (vendor/schemastery is 3.18.5-alpha.1 while the kernel is 0.2.1-alpha.1) and the client baseline
      // is a module table the shell preloads, so neither may be compared against the kernel.
      const allPeers = Object.entries(manifest.peerDependencies ?? {})
      const kernelPeers = allPeers.filter(([pkg]) => ['workspace', 'app'].includes(KERNEL_ROSTER.get(pkg)?.origin ?? ''))
      const skippedPeers = allPeers.filter(([pkg]) => kernelProvides(pkg) && ['workspace', 'app'].includes(KERNEL_ROSTER.get(pkg)?.origin ?? '') === false).map(([pkg, range]) => pkg + ' ' + String(range) + ' carries its own version line, not the kernel version')
      if (kernelPeers.length === 0) readings.push(verdict(rule, 'pass', ['no peer dependency on a kernel workspace package', ...(skippedPeers.length === 0 ? [] : ['not measured: ' + skippedPeers.join('; ')])]))
      else {
        const excluded = []
        const undecided = []
        for (const [pkg, range] of kernelPeers) {
          const holds = admitsVersion(String(range), kernelVersion)
          if (holds === false) excluded.push(pkg + ' ' + String(range) + ' excludes ' + kernelVersion)
          else if (holds === null) undecided.push(pkg + ' ' + String(range) + ' is not a range this reader decides')
        }
        if (excluded.length > 0) readings.push(verdict(rule, 'fail', excluded))
        else if (undecided.length > 0) readings.push(verdict(rule, 'unknown', undecided, { unknownBecause: 'the range form was not decided', toDecide: 'a range this reader understands, or a semver dependency' }))
        else readings.push(verdict(rule, 'pass', [...kernelPeers.map(([pkg, range]) => pkg + ' ' + String(range) + ' admits ' + kernelVersion), ...(skippedPeers.length === 0 ? [] : ['not measured: ' + skippedPeers.join('; ')])]))
      }
      continue
    }
    if (kind === 'client-usage') {
      if (analysis === null) { readings.push(verdict(rule, 'unknown', ['the package could not be read for client usages'], { unknownBecause: 'the analyzer could not read the package', toDecide: 'a readable package tree' })); continue }
      const clientUsages = analysis.usages.filter((usage) => usage.classification === 'client-plane')
      const shaped = clientUsages.map((usage) => {
        const text = String(usage.name)
        const head = text.split('.')[0]
        const member = text.slice(head.length + 1)
        return { usage, head, member, declared: clientSurface.services?.[head] ?? null }
      })
      if (which === 'service-collected') {
        const selfDeclared = declaredServices(dir)
        const isName = (entry) => /^[A-Za-z_$][\w$]*$/.test(entry.head)
        const unreadableName = shaped.filter((entry) => entry.declared === null && isName(entry) === false)
        const mineDeclared = shaped.filter((entry) => entry.declared === null && isName(entry) && selfDeclared.has(entry.head))
        const otherDeclared = shaped.filter((entry) => entry.declared === null && isName(entry) && selfDeclared.has(entry.head) === false && REPO_DECLARED_SERVICES.has(entry.head))
        const absent = shaped.filter((entry) => entry.declared === null && isName(entry) && selfDeclared.has(entry.head) === false && REPO_DECLARED_SERVICES.has(entry.head) === false)
        if (absent.length > 0) readings.push(verdict(rule, 'fail', absent.map((entry) => entry.head + ' used at ' + (entry.usage.at[0] ?? '?') + ' is not in the captured client surface')))
        else if (mineDeclared.length + otherDeclared.length + unreadableName.length > 0) readings.push(verdict(rule, 'unknown', [
          ...mineDeclared.map((entry) => entry.head + ' used at ' + (entry.usage.at[0] ?? '?') + ' is declared by this package at ' + [...(selfDeclared.get(entry.head) ?? [])].join(', ')),
          ...otherDeclared.map((entry) => entry.head + ' used at ' + (entry.usage.at[0] ?? '?') + ' is declared in this repository at ' + [...(REPO_DECLARED_SERVICES.get(entry.head) ?? [])].join(', ')),
          ...unreadableName.map((entry) => String(entry.usage.name) + ' used at ' + (entry.usage.at[0] ?? '?') + ' is not an identifier, so the name reading itself recorded something that cannot be judged'),
        ], { unknownBecause: 'the captured client surface reads the kernel packages: a service a plugin declares or publishes is not in it, and a name that is not an identifier names nothing', toDecide: 'a capture that reads the plugin packages as well, or a name reading that only records identifiers' }))
        else readings.push(verdict(rule, 'pass', shaped.length === 0 ? ['no client-plane usage'] : shaped.map((entry) => entry.head + ' is declared at ' + (entry.declared.declaredIn[0] ?? '?'))))
        continue
      }
      const memberRows = shaped.filter((entry) => entry.member !== '' && entry.declared !== null)
      const unknownRows = memberRows.filter((entry) => {
        const members = Array.isArray(entry.declared.members) ? entry.declared.members : null
        const properties = Array.isArray(entry.declared.properties) ? entry.declared.properties : null
        return (members === null || members.includes(entry.member) === false) && (properties === null || properties.includes(entry.member) === false)
      })
      const absentRows = unknownRows.filter((entry) => entry.declared.membersComplete === true)
      const undecided = unknownRows.filter((entry) => entry.declared.membersComplete !== true)
      if (absentRows.length > 0) readings.push(verdict(rule, 'fail', absentRows.map((entry) => entry.head + '.' + entry.member + ' at ' + (entry.usage.at[0] ?? '?') + ' is not declared by ' + entry.declared.type)))
      else if (undecided.length > 0) readings.push(verdict(rule, 'unknown', undecided.map((entry) => entry.head + '.' + entry.member + ' at ' + (entry.usage.at[0] ?? '?') + ': ' + String(entry.declared.membersReason ?? 'no reason recorded')), { unknownBecause: 'the member set of that service was not enumerated', toDecide: 'a capture that enumerates that service type' }))
      else readings.push(verdict(rule, 'pass', memberRows.length === 0 ? ['no client-plane member usage'] : memberRows.map((entry) => entry.head + '.' + entry.member + ' declared as ' + (Array.isArray(entry.declared.members) && entry.declared.members.includes(entry.member) ? 'member' : 'property'))))
      continue
    }
    if (kind === 'licence' && which === 'permissive') {
      const raw = manifest.license ?? (Array.isArray(manifest.licenses) ? manifest.licenses.map((entry) => entry?.type).filter((entry) => typeof entry === 'string').join(' OR ') : null)
      if (typeof raw !== 'string' || raw.trim() === '') readings.push(verdict(rule, 'unknown', ['package.json declares no licence'], { unknownBecause: 'no licence field to judge', toDecide: 'a "license" field or a LICENSE file the reading can follow' }))
      else if (PERMISSIVE.includes(raw.trim())) readings.push(verdict(rule, 'pass', ['licence ' + raw.trim() + ' is on the loadable list']))
      else if (/^SEE LICEN[CS]E IN /i.test(raw.trim())) readings.push(verdict(rule, 'unknown', ['licence is declared as ' + raw.trim()], { unknownBecause: 'the licence itself is in a file this reading does not open', toDecide: 'the SPDX id, or reading that file' }))
      else readings.push(verdict(rule, 'fail', ['licence ' + raw.trim() + ' is not on the loadable list (' + PERMISSIVE.join(', ') + ')']))
      continue
    }
    readings.push(verdict(rule, 'unknown', ['no reading is implemented for ' + kind + '/' + which], { unknownBecause: 'the rule names a reading this checker does not implement', toDecide: 'implement it or drop the rule' }))
  }

  const counts = { pass: 0, fail: 0, unknown: 0 }
  const failsBySeverity = { refuse: 0, rewrite: 0, note: 0 }
  for (const entry of readings) {
    counts[entry.verdict] += 1
    if (entry.verdict === 'fail') failsBySeverity[entry.severity] += 1
  }
  return { dir, package: { name, version, license: licence }, readings, counts, failsBySeverity, exitCode: failsBySeverity.refuse > 0 ? 1 : 0 }
}

/** The synthetic packages the self-test builds: one conforming baseline, then one violation per rule. */
function selfTestCases() {
  const ROOT = join(REPO, '.tmp', 'r47-contract-selftest')
  const write = (base, rel, text) => { const file = join(base, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  const PATCH = '- insert:' + String.fromCharCode(10) + '    - id: r47-contract-demo' + String.fromCharCode(10) + '      name: ./helper.mjs' + String.fromCharCode(10)
  const CLIENT = 'export const wire = (ctx) => ctx.slots.register({ name: "x" }, () => null)' + String.fromCharCode(10)
  const manifestOfCase = (extra) => JSON.stringify(Object.assign({ name: '@r47-external/dsh-contract-demo', version: '1.0.0', type: 'module', license: 'MIT', main: './lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }, extra ?? {}))
  const build = () => {
    rmSync(ROOT, { recursive: true, force: true })
    const base = join(ROOT, 'pkg')
    write(base, 'package.json', manifestOfCase())
    write(base, 'cordis.patch.yml', PATCH)
    write(base, 'helper.mjs', 'export const nothing = 1' + String.fromCharCode(10))
    write(base, 'lib/client.js', CLIENT)
    write(ROOT, 'composition-clean.json', JSON.stringify({ ids: [{ id: 'r47-contract-demo', flags: [] }] }))
    write(ROOT, 'composition-contested.json', JSON.stringify({ ids: [{ id: 'r47-contract-demo', flags: ['configSuperseded'] }] }))
    const surface = JSON.parse(readFileSync(CLIENT_SURFACE, 'utf8'))
    const partial = JSON.parse(JSON.stringify(surface))
    partial.services.slots.membersComplete = false
    partial.services.slots.members = null
    partial.services.slots.membersReason = 'synthetic: the member set could not be enumerated (self-test)'
    write(ROOT, 'client-surface-partial.json', JSON.stringify(partial, null, 1))
    return base
  }
  const context = (base, extra) => ({
    rules: RULES,
    kernelVersion: KERNEL_VERSION,
    clientSurface: extra?.clientSurface ?? JSON.parse(readFileSync(CLIENT_SURFACE, 'utf8')),
    composition: extra?.composition ?? JSON.parse(readFileSync(join(ROOT, 'composition-clean.json'), 'utf8')),
  })
  const cases = []
  const add = (rule, what, mutate, run, extra) => cases.push(Object.assign({ rule, what, mutate, run }, extra ?? {}))
  add('manifest-readable', 'package.json removed', (base) => rmSync(join(base, 'package.json')), 'allOthersUnknown')
  add('patch-files-exist', 'dsh.bundle.patch names a file that is not there', (base) => write(base, 'package.json', manifestOfCase({ dsh: { bundle: { patch: './missing.patch.yml' } } })))
  add('patch-top-level-array', 'the patch file opens as a mapping, not a sequence', (base) => write(base, 'cordis.patch.yml', 'id: r47-contract-demo' + String.fromCharCode(10) + 'name: ./helper.mjs' + String.fromCharCode(10)))
  add('row-ids-and-inserts', 'an insert child carries no id', (base) => write(base, 'cordis.patch.yml', '- insert:' + String.fromCharCode(10) + '    - name: ./helper.mjs' + String.fromCharCode(10)))
  add('row-id-contested-in-composition', 'the composition marks the inserted id as superseded', null, 'contested-composition')
  add('row-module-resolves', 'a row names a module that is not there', (base) => write(base, 'cordis.patch.yml', '- insert:' + String.fromCharCode(10) + '    - id: r47-contract-demo' + String.fromCharCode(10) + '      name: ./does-not-exist.mjs' + String.fromCharCode(10)))
  add('dependency-declared', 'a bare specifier is imported and not declared', (base) => write(base, 'lib/client.js', 'import { gone } from "@r47-nope/missing"' + String.fromCharCode(10) + CLIENT))
  add('peer-range-admits-kernel', 'a kernel peer range excludes this kernel', (base) => write(base, 'package.json', manifestOfCase({ peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.0-rc.6' } })))
  add('client-service-collected', 'a client usage names a service the client surface does not declare', (base) => write(base, 'lib/client.js', 'export const wire = (ctx) => ctx.r47NoSuchService.run()' + String.fromCharCode(10)))
  add('client-member-collected', 'a client usage names a member the captured member set does not declare', (base) => write(base, 'lib/client.js', 'export const wire = (ctx) => ctx.slots.r47NoSuchMember()' + String.fromCharCode(10)))
  add('client-member-collected', 'the captured member set is incomplete, so the member cannot be judged', (base) => write(base, 'lib/client.js', 'export const wire = (ctx) => ctx.slots.r47NoSuchMember()' + String.fromCharCode(10)), 'partial-surface')
  add('licence-permissive', 'the declared licence is not one the host may load', (base) => write(base, 'package.json', manifestOfCase({ license: 'GPL-3.0-only' })))
  add('licence-permissive', 'no licence is declared at all', (base) => { const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')); delete manifest.license; write(base, 'package.json', JSON.stringify(manifest)) }, 'unknown-expected')
  add('dependency-declared', 'a specifier nothing provides: left-pad (not declared, not in the kernel tree, not in the client baseline)', (base) => write(base, 'lib/client.js', 'import leftPad from "left-pad"' + String.fromCharCode(10) + CLIENT), 'left-pad')
  add('row-module-resolves', 'two rules broken at once: the row module is missing and the licence is not loadable', (base) => {
    write(base, 'cordis.patch.yml', '- insert:' + String.fromCharCode(10) + '    - id: r47-contract-demo' + String.fromCharCode(10) + '      name: ./does-not-exist.mjs' + String.fromCharCode(10))
    const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
    manifest.license = 'GPL-3.0-only'
    write(base, 'package.json', JSON.stringify(manifest))
  }, 'pair', { pairWith: ['row-module-resolves', 'licence-permissive'] })
  return { ROOT, build, context, PATCH, CLIENT, cases, manifestOfCase, write }
}

/** Run every self-test case, requiring the named rule to move and every other reading to stay put. */
function selfTest() {
  const harness = selfTestCases()
  const { build, context, cases } = harness
  const rows = []
  let failed = 0
  const baselineDir = build()
  const baseline = checkPlugin(baselineDir, context(baselineDir))
  const baselineMap = new Map(baseline.readings.map((entry) => [entry.rule, entry.verdict]))
  const covered = new Set()
  for (const item of cases) {
    const base = build()
    if (typeof item.mutate === 'function') item.mutate(base, harness)
    const ctx = item.run === 'contested-composition' ? context(base, { composition: JSON.parse(readFileSync(join(harness.ROOT, 'composition-contested.json'), 'utf8')) })
      : item.run === 'partial-surface' ? context(base, { clientSurface: JSON.parse(readFileSync(join(harness.ROOT, 'client-surface-partial.json'), 'utf8')) })
        : context(base)
    const after = checkPlugin(base, ctx)
    const moved = after.readings.filter((entry) => entry.verdict !== baselineMap.get(entry.rule)).map((entry) => entry.rule)
    const named = after.readings.find((entry) => entry.rule === item.rule)
    const wanted = item.run === 'allOthersUnknown' ? null : [item.rule]
    const others = moved.filter((id) => id !== item.rule)
    const movedAsDeclared = wanted === null ? others.length === after.readings.length - 1 && others.every((id) => after.readings.find((entry) => entry.rule === id).verdict === 'unknown')
      : item.run === 'pair' ? moved.length === item.pairWith.length && item.pairWith.every((id) => moved.includes(id))
        : moved.length === 1 && moved[0] === item.rule
    const wantedVerdict = item.run === 'partial-surface' || item.run === 'unknown-expected' ? 'unknown' : 'fail'
    const basisText = (named?.basis ?? []).join(' ')
    // R4: the reason has to name every source that was consulted, or a reader cannot tell a real
    // absence from a source this check forgot to read.
    const reasonHolds = item.run === 'left-pad' ? /not carried by the kernel/.test(basisText) && /not in the client baseline/.test(basisText) : true
    const right = named !== undefined && named.verdict === wantedVerdict && movedAsDeclared && reasonHolds
    covered.add(item.rule)
    if (right) failed += 0
    else failed += 1
    const detail = after.readings.filter((entry) => entry.verdict !== baselineMap.get(entry.rule)).map((entry) => entry.rule + ':' + baselineMap.get(entry.rule) + '->' + entry.verdict).join(' ')
    rows.push({ rule: item.rule, case: item.what, verdict: named === undefined ? '(missing)' : named.verdict, expected: wantedVerdict, moved: moved.join(', '), detail, ok: right })
  }
  const orphans = RULES.map((rule) => rule.id).filter((id) => covered.has(id) === false)
  for (const id of orphans) { failed += 1; rows.push({ rule: id, case: 'no counterexample was built', verdict: '(none)', expected: 'fail', moved: '', ok: false }) }
  console.log('  ' + 'rule'.padEnd(36) + 'case'.padEnd(64) + 'verdict   expected  moved')
  for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + ' ' + row.rule.padEnd(36) + row.case.slice(0, 62).padEnd(64) + String(row.verdict).padEnd(10) + String(row.expected).padEnd(10) + (row.ok ? '' : (row.moved + ' :: ' + (row.detail ?? ''))))
  console.log('self-test: ' + String(rows.length - failed) + '/' + String(rows.length) + ' held; every one of the ' + String(RULES.length) + ' rule(s) has a counterexample: ' + String(orphans.length === 0))
  rmSync(harness.ROOT, { recursive: true, force: true })
  return failed === 0
}

const RULES_DOC = jsonOf(RULES_PATH)
if (RULES_DOC === null) { console.error('no rule set at ' + RULES_PATH); process.exit(3) }
const RULES = Array.isArray(RULES_DOC.rules) ? RULES_DOC.rules : []
const KERNEL_VERSION = String(jsonOf(join(REPO, 'kernel.lock.json'))?.packageVersion ?? RULES_DOC.kernel?.version ?? '')

/** @returns the paths a run reads: the captures, overridable so the self-test can point at its own. */
function contextOf(argv) {
  const at = (name, fallback) => { const index = argv.indexOf(name); return index === -1 ? fallback : resolve(argv[index + 1]) }
  const surfacePath = at('--surface-client', CLIENT_SURFACE)
  const compositionPath = at('--composition', COMPOSITION)
  return {
    rules: RULES,
    kernelVersion: KERNEL_VERSION,
    surfacePath,
    compositionPath,
    clientSurface: jsonOf(surfacePath) ?? {},
    composition: jsonOf(compositionPath),
  }
}

/** One package's readings, printed as a table with the basis of each verdict. */
function render(result) {
  console.log('== ' + result.dir)
  console.log('   package ' + String(result.package.name ?? '(unnamed)') + '@' + String(result.package.version ?? '?') + ' licence ' + String(result.package.license ?? '(none declared)'))
  for (const entry of result.readings) {
    console.log('  [' + entry.verdict.padEnd(7) + '] ' + entry.severity.padEnd(7) + ' ' + entry.rule + (entry.category === null ? '' : ' (' + entry.category + ')'))
    for (const line of entry.basis.slice(0, 4)) console.log('           ' + String(line).slice(0, 160))
    if (entry.unknownBecause !== undefined) console.log('           unknown because: ' + entry.unknownBecause + '; to decide: ' + String(entry.toDecide))
  }
  console.log('   ' + result.counts.pass + ' pass, ' + result.counts.fail + ' fail (' + result.failsBySeverity.refuse + ' refuse / ' + result.failsBySeverity.rewrite + ' rewrite / ' + result.failsBySeverity.note + ' note), ' + result.counts.unknown + ' unknown')
  console.log('   exit ' + result.exitCode + (result.exitCode === 0 ? ' (no refuse-level failure)' : ' (a refuse-level rule failed)'))
}

/** The producer: judge every recorded target and write the reading a gate can recompute. */
function all(argv) {
  const targets = jsonOf(TARGETS)?.targets ?? []
  const context = contextOf(argv)
  const results = []
  for (const target of targets) {
    const dir = String(target.dir ?? '')
    if (dir === '' || existsSync(dir) === false) {
      results.push({ name: target.name, version: target.version, dir, missing: true, readings: [], counts: { pass: 0, fail: 0, unknown: 0 }, failsBySeverity: { refuse: 0, rewrite: 0, note: 0 } })
      continue
    }
    const result = checkPlugin(dir, context)
    results.push({ name: target.name, version: target.version, dir, license: result.package.license, readings: result.readings, counts: result.counts, failsBySeverity: result.failsBySeverity })
  }
  const totals = { targets: results.length, missing: results.filter((entry) => entry.missing === true).length, pass: 0, fail: 0, unknown: 0, refuse: 0, rewrite: 0, note: 0 }
  for (const entry of results) {
    totals.pass += entry.counts.pass
    totals.fail += entry.counts.fail
    totals.unknown += entry.counts.unknown
    totals.refuse += entry.failsBySeverity.refuse
    totals.rewrite += entry.failsBySeverity.rewrite
    totals.note += entry.failsBySeverity.note
  }
  // A recorded category this rule set does not carry is a finding to name, not to paper over: the
  // criterion says which reading would have to change, and which rule now judges the same fact.
  const criterionFor = (category, entry) => {
    if (category === 'client-service-absent') {
      const memberRule = entry.readings.find((reading) => reading.rule === 'client-member-collected')
      return 'superseded by the member layer: the item names dotted paths, the capture now carries members and properties per service (compat/surface/client-0.2.1-alpha.1.json, R34), and this rule set judges those paths under client-member-collected, which read ' + String(memberRule?.verdict ?? 'nothing') + ' for this package (' + String((memberRule?.basis ?? []).join('; ')).slice(0, 200) + '). client-service-collected reproduces the item only where the head service itself is missing.'
    }
    if (category === 'host-callsite-absent') {
      return 'no rule of this contract judges the host plane: the closed kind list is ' + READ_KINDS.join(', ') + ', and host call sites are judged by scripts/analyze-plugin-usage.mjs against compat/surface/0.2.1-alpha.1.json (scripts/verify-adaptation-usage.mjs owns that reading)'
    }
    return 'no rule in compat/plugin-contract.json carries the recorded category ' + category
  }
  // R5: this repository's own plugin packages are judged by the same rules. R6: every reading that changed
  // because the roster learned the vendored packages and the client baseline is named beside it - the
  // legacy run consults only the kernel workspace, which is what the check read before R50.
  const legacyContext = { ...context, hostSources: { workspace: true, app: false, vendor: false, baseline: false } }
  const verdictsOf = (readings) => new Map(readings.map((reading) => [reading.rule, reading.verdict]))
  const ourDirs = (() => {
    const root = join(REPO, 'plugins')
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'package.json')))
      .map((entry) => entry.name).sort()
  })()
  const ours = []
  for (const name of ourDirs) {
    const dir = join(REPO, 'plugins', name)
    const result = checkPlugin(dir, context)
    ours.push({ name: result.package.name ?? name, version: result.package.version ?? null, dir, license: result.package.license ?? null, counts: result.counts, failsBySeverity: result.failsBySeverity, readings: result.readings })
  }
  const ourTotals = { packages: ours.length, pass: 0, fail: 0, unknown: 0, refuse: 0, rewrite: 0, note: 0 }
  for (const entry of ours) {
    ourTotals.pass += entry.counts.pass
    ourTotals.fail += entry.counts.fail
    ourTotals.unknown += entry.counts.unknown
    ourTotals.refuse += entry.failsBySeverity.refuse
    ourTotals.rewrite += entry.failsBySeverity.rewrite
    ourTotals.note += entry.failsBySeverity.note
  }
  const flipped = []
  const flippedUnknownToPass = []
  const regressed = []
  const regressedTowardsUnknown = []
  for (const entry of [...results, ...ours]) {
    if (entry.missing === true) continue
    const before = verdictsOf(checkPlugin(entry.dir, legacyContext).readings)
    for (const reading of entry.readings) {
      const was = before.get(reading.rule)
      if (was === 'fail' && reading.verdict === 'pass') flipped.push({ package: entry.name, rule: reading.rule, category: reading.category ?? null, before: was, after: reading.verdict, basis: reading.basis.slice(0, 3) })
      else if (was === 'unknown' && reading.verdict === 'pass') flippedUnknownToPass.push({ package: entry.name, rule: reading.rule, before: was, after: reading.verdict })
      else if (reading.verdict === 'fail' && was !== 'fail') regressed.push({ package: entry.name, rule: reading.rule, category: reading.category ?? null, before: was, after: reading.verdict, basis: reading.basis.slice(0, 3) })
      else if (reading.verdict === 'unknown' && was === 'pass') regressedTowardsUnknown.push({ package: entry.name, rule: reading.rule, category: reading.category ?? null, before: was, after: reading.verdict, basis: reading.basis.slice(0, 3) })
    }
  }
  flipped.sort((left, right) => left.package.localeCompare(right.package) || left.rule.localeCompare(right.rule))
  const verdicts = jsonOf(PORT_VERDICTS)
  const portByPackage = new Map((verdicts?.verdicts ?? []).map((entry) => [entry.name, entry]))
  const agree = []
  const notReproduced = []
  const newFindings = []
  for (const entry of results) {
    const port = portByPackage.get(entry.name)
    if (port !== undefined && (port.items ?? []).length === 0) continue
    // Category-less failures are compared by rule id: they are failures the recorded verdicts never
    // expressed as a category, and they belong in this list rather than in silence.
    const mine = new Map(entry.readings.filter((reading) => reading.verdict === 'fail').map((reading) => [reading.category ?? ('rule:' + reading.rule), reading]))
    for (const item of port?.items ?? []) {
      const reading = mine.get(item.category)
      if (reading === undefined) {
        notReproduced.push({ package: entry.name, category: item.category, severity: item.severity, portDetail: String(item.detail ?? '').slice(0, 220), criterion: criterionFor(item.category, entry) })
        mine.delete(item.category)
      } else {
        agree.push({ package: entry.name, category: item.category, portSeverity: item.severity, ruleSeverity: reading.severity, rule: reading.rule, basis: reading.basis.slice(0, 2) })
        mine.delete(item.category)
      }
    }
    for (const [category, reading] of mine) newFindings.push({ package: entry.name, category, rule: reading.rule, severity: reading.severity, basis: reading.basis.slice(0, 3), note: 'this rule set names a failure the recorded verdicts do not carry; the rule and its evidence are the criterion' })
  }
  const doc = {
    format: FORMAT,
    kernel: { package: '@deepseek-ai/dsh-root', version: KERNEL_VERSION },
    checker: 'scripts/check-plugin-contract.mjs',
    ruleSet: { file: 'compat/plugin-contract.json', format: RULES_DOC.format, rules: RULES.map((rule) => ({ id: rule.id, severity: rule.severity, kind: rule.check.kind })) },
    note: 'One reading per rule per real third-party package on this machine. Every verdict carries its basis; an unknown carries why it could not be read and what would decide it. This is a static contract reading: nothing here mounts a package, and nothing here writes inside a plugin directory.',
    targets: results.map((entry) => ({ name: entry.name, version: entry.version, dir: entry.dir, license: entry.license ?? null, missing: entry.missing === true, counts: entry.counts, failsBySeverity: entry.failsBySeverity, readings: entry.readings.map((reading) => ({ rule: reading.rule, severity: reading.severity, kind: reading.kind, category: reading.category, verdict: reading.verdict, basis: reading.basis, unknownBecause: reading.unknownBecause ?? null, toDecide: reading.toDecide ?? null })) })),
    totals,
    ourPackages: ours.map((entry) => ({ name: entry.name, version: entry.version, dir: entry.dir, license: entry.license, counts: entry.counts, failsBySeverity: entry.failsBySeverity, readings: entry.readings.map((reading) => ({ rule: reading.rule, severity: reading.severity, kind: reading.kind, category: reading.category, verdict: reading.verdict, basis: reading.basis, unknownBecause: reading.unknownBecause ?? null, toDecide: reading.toDecide ?? null })) })),
    ourTotals,
    roster: {
      note: 'R50: what the host provides is read from two sources, both data. flipped lists every reading that was fail against the legacy sources and is pass now, so a roster repair is visible rather than silently green.',
      sources: ['kernel-packages (core/deepseek-harness/packages/**, the workspace)', 'kernel-app (core/deepseek-harness/apps/*)', 'kernel-vendor (core/deepseek-harness/vendor/*)', 'client-baseline (compat/host-modules.json)'],
      kernelApps: [...KERNEL_ROSTER].filter(([, entry]) => entry.origin === 'app').map(([name]) => name).sort(),
      legacySources: ['kernel-packages (the reading before R50: workspace packages only)'],
      kernelRosterSize: KERNEL_ROSTER.size,
      kernelVendored: [...KERNEL_ROSTER].filter(([, entry]) => entry.origin === 'vendor').map(([name]) => name).sort(),
      clientBaseline: CLIENT_BASELINE,
    },
    flipped,
    flippedUnknownToPass,
    regressed,
    regressedTowardsUnknown,
    consistency: {
      note: 'R8: this reading must not fight the recorded verdicts. A category both carry is listed under agree with the rule that reproduces it; a recorded category this rule set does not carry is listed under notReproduced with the criterion that explains it; a failure this rule set names and the verdicts do not carry is a newFinding.',
      against: 'compat/adaptation/port-verdicts.json',
      agree,
      notReproduced,
      newFindings,
    },
    sourceDigest: '',
  }
  doc.sourceDigest = createHash('sha256').update(JSON.stringify({ results, ours, flipped })).digest('hex').slice(0, 16)
  const out = (() => { const index = argv.indexOf('--out'); return index === -1 ? DEFAULT_OUT : resolve(argv[index + 1]) })()
  const text = JSON.stringify(doc, null, 1) + String.fromCharCode(10)
  if (argv.includes('--check')) {
    if (!existsSync(out)) { console.log('FAIL  no committed reading at ' + out); return 1 }
    if (readFileSync(out, 'utf8') !== text) { console.log('FAIL  the committed contract reading no longer matches a fresh run of the checker'); return 1 }
    console.log('PASS  ' + out + ': ' + totals.pass + ' pass, ' + totals.fail + ' fail, ' + totals.unknown + ' unknown over ' + totals.targets + ' target(s)')
    return 0
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
  for (const entry of results) console.log('  ' + String(entry.name).padEnd(48) + JSON.stringify(entry.counts) + (entry.missing === true ? ' MISSING' : ''))
  console.log('  totals ' + JSON.stringify(totals))
  console.log('  our packages ' + JSON.stringify(ourTotals))
  console.log('  flipped by the roster: ' + flipped.length + ' reading(s) fail -> pass (' + [...new Set(flipped.map((entry) => entry.package))].join(', ') + ')')
  console.log('  regressed: ' + regressed.length + ' pass/unknown -> fail, ' + regressedTowardsUnknown.length + ' pass -> unknown')
  console.log('  consistency: ' + agree.length + ' agree, ' + notReproduced.length + ' notReproduced, ' + newFindings.length + ' newFinding(s)')
  console.log('-> ' + out)
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
  if (argv.includes('--all')) process.exit(all(argv))
  const dirArg = argv.find((value) => value.startsWith('--') === false)
  if (dirArg === undefined) { console.error('usage: node scripts/check-plugin-contract.mjs <pluginDir> [--json] [--surface-client <file>] [--composition <file>] | --self-test | --all [--out <file>] [--check]'); process.exit(2) }
  const dir = resolve(dirArg)
  if (!existsSync(dir)) { console.error('no plugin directory at ' + dir); process.exit(3) }
  const result = checkPlugin(dir, contextOf(argv))
  if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 1)); process.exit(result.exitCode) }
  render(result)
  process.exit(result.exitCode)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
