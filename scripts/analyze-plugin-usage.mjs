#!/usr/bin/env node
/**
 * What an existing plugin actually uses, read from its own files.
 *
 * The compatibility table answers "does this NAME exist in the kernel we run". That is a
 * declaration-level answer, and the R16 critique showed where it misleads: a plugin that declares a
 * dependency it never calls cannot be told apart from one that calls a service whose contract
 * drifted, and refusing both is how a bridge excludes plugins it could have carried. This analyzer
 * reads the call sites instead, and reports what it could not read.
 *
 * Usage: node scripts/analyze-plugin-usage.mjs --dir <package dir> [--out <file>]
 * Exit codes: 0 the package was analyzed; 1 it could not be read; 2 no --dir given.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']

/** Context members that are the framework's own surface, not services a plugin depends on. */
const CONTEXT_BOILERPLATE = new Set([
  'on', 'once', 'emit', 'parallel', 'serial', 'bail', 'waterfall', 'effect', 'plugin', 'inject',
  'provide', 'get', 'set', 'logger', 'fiber', 'reflect', 'registry', 'root', 'extend', 'isolate',
  'intercept', 'scope', 'cmdlineArgs', 'appExit', 'baseUrl', 'shadow', 'receiver', 'accessor', 'mixin',
])

/**
 * Every source file of a package.
 * @param dir - the package directory.
 * @returns absolute paths, sorted.
 */
/**
 * Fingerprint the files this analyzer read, so a ticket can say which revision it describes.
 * @param files - absolute source paths.
 * @param root - the package directory they sit under.
 * @returns the sha256 over one line per file: relative path, a pipe, the file's content hash.
 */
function sourceDigest(files, root) {
  const fold = createHash('sha256')
  const separator = String.fromCharCode(92)
  for (const file of files) {
    const content = createHash('sha256').update(readFileSync(file)).digest('hex')
    fold.update(file.slice(root.length + 1).replaceAll(separator, '/') + '|' + content + '\n')
  }
  return fold.digest('hex')
}

function sourceFiles(dir) {
  const found = new Set()
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const next = join(current, entry.name)
      if (entry.isDirectory()) { walk(next); continue }
      if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.add(next)
    }
  }
  for (const area of ['lib', 'src', 'dist', 'tools']) {
    const path = join(dir, area)
    if (existsSync(path) && statSync(path).isDirectory()) walk(path)
  }
  const manifestPath = join(dir, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const candidate of [manifest.main, manifest.module, manifest.types]) {
      if (typeof candidate === 'string' && existsSync(join(dir, candidate))) found.add(join(dir, candidate))
    }
  }
  return [...found].sort()
}

/**
 * Read one plugin package and report the kernel surface it actually touches.
 * @param dir - the package directory.
 * @returns the usage report.
 */
export function analyze(dir) {
  const absolute = resolve(dir)
  const manifestPath = join(absolute, 'package.json')
  if (!existsSync(manifestPath)) throw new Error('no package.json in ' + absolute)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const files = sourceFiles(absolute)
  const members = new Map()
  const events = new Map()
  const lookups = new Map()
  const injects = new Map()
  const memberPaths = new Map()
  const imports = new Map()
  const limits = { dynamicContextAccess: 0, destructuredContext: 0, memberUsageHeadsOutsideClientSurface: 0 }
  const note = (map, name, where) => {
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(where)
  }
  // The archived surface describes the HOST plane. A name used only from the client half is not
  // "absent from the kernel" — it is a question this oracle cannot answer, and saying `absent` there
  // would send a plugin to the rewrite pile for a reason nobody checked.
  const isClientFile = (relative) => relative.includes('client')
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const relative = file.slice(absolute.length + 1)
    const plane = isClientFile(relative) ? 'client' : 'host'
    const lines = text.split('\n')
    let inBlockComment = false
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]
      // A usage is read from code, never from prose: a commented-out `ctx.locale` is not a call
      // site, and recording it sent a plugin to the rewrite pile for a line nobody runs.
      const trimmed = raw.trim()
      if (inBlockComment) { if (trimmed.includes('*/')) inBlockComment = false; continue }
      if (trimmed.startsWith('/*') && !trimmed.includes('*/')) { inBlockComment = true; continue }
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
      const line = raw
      const where = (plane === 'client' ? 'client ' : '') + relative + ':' + String(index + 1)
      // `ctx.member` — the call sites, not the declarations.
      let cursor = 0
      while (true) {
        const at = line.indexOf('ctx.', cursor)
        if (at === -1) break
        cursor = at + 4
        let end = cursor
        while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end += 1
        const name = line.slice(cursor, end)
        if (name !== '' && !CONTEXT_BOILERPLATE.has(name)) note(members, name, where)
        // `ctx.service.member` — the name a call site reaches for. The service alone cannot tell a
        // member that still exists from one that moved, which is what R34 added this reading for.
        if (name !== '' && !CONTEXT_BOILERPLATE.has(name) && line[end] === '.') {
          let stop = end + 1
          while (stop < line.length && /[A-Za-z0-9_]/.test(line[stop])) stop += 1
          const member = line.slice(end + 1, stop)
          if (/^[A-Za-z_$][\w$]*$/.test(member)) note(memberPaths, name + '.' + member, where)
          else limits.memberUsageHeadsOutsideClientSurface += 1
        }
      }
      // `ctx['name']` and `const { a } = ctx` cannot be resolved here, and are counted so the gap is visible.
      if (line.includes('ctx[')) limits.dynamicContextAccess += 1
      if (line.includes('= ctx') && line.includes('{')) limits.destructuredContext += 1
      // `ctx.on('event'` and `ctx.once('event'`
      for (const marker of ["ctx.on('", 'ctx.on("', "ctx.once('", 'ctx.once("']) {
        const at = line.indexOf(marker)
        if (at === -1) continue
        const quote = marker[marker.length - 1]
        const rest = line.slice(at + marker.length)
        const close = rest.indexOf(quote)
        if (close > 0) note(events, rest.slice(0, close), where)
      }
      // `ctx.get('service')`
      for (const marker of ["get('", 'get("']) {
        const at = line.indexOf('ctx.' + marker)
        if (at === -1) continue
        const quote = marker[marker.length - 1]
        const rest = line.slice(at + 4 + marker.length)
        const close = rest.indexOf(quote)
        if (close > 0) note(lookups, rest.slice(0, close), where)
      }
      // `inject: ['a', 'b']`
      if (line.includes('inject:') || line.includes('inject =')) {
        let scan = line
        let open = scan.indexOf('[')
        const close = scan.lastIndexOf(']')
        if (open !== -1 && close > open) {
          for (const piece of scan.slice(open + 1, close).split(',')) {
            const name = piece.trim().replaceAll("'", '').replaceAll('"', '').trim()
            if (name !== '') note(injects, name, where)
          }
        }
      }
      // package imports
      // A specifier is only read where a module system puts one. Matching a bare " from " or
      // "require(" anywhere in the line recorded ordinary strings as imports: 'legitimately
      // repetitive', 'nothing was readable' and 'the same delta twice' all came from data or prose.
      for (const pattern of [
        /^\s*import\s+['"]([^'"]+)['"]/,                                 // side-effect import
        /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/,      // import/export … from 'specifier'
        /\bimport\s*\(\s*['"]([^'"]+)['"]/,                            // dynamic import('specifier')
        /(?:^|[^\w.]|__)require\s*\(\s*['"]([^'"]+)['"]/,               // require('specifier'), __require in bundled output
      ]) {
        const match = pattern.exec(line)
        if (match === null) continue
        const specifier = match[1]
        if (specifier !== '' && !specifier.startsWith('.') && !specifier.includes(' ')) note(imports, specifier, where)
        break
      }
      // A specifier can also sit on a later line: import {\n  a,\n} from 'pkg'. Read the statement
      // forward a few lines, and stop at a terminator or at the next statement so two imports are
      // never merged into one reading.
      if (/^\s*(?:import|export)\b/.test(line) && !/\bfrom\b/.test(line) && !/['"]/.test(line)) {
        for (let look = index + 1; look < Math.min(index + 6, lines.length); look += 1) {
          const next = lines[look]
          const match = /\bfrom\s*['"]([^'"]+)['"]/.exec(next)
          if (match !== null) {
            const specifier = match[1]
            if (specifier !== '' && !specifier.startsWith('.') && !specifier.includes(' ')) note(imports, specifier, where)
            break
          }
          if (/;\s*$/.test(next) || /^\s*(?:import|export)\b/.test(next)) break
        }
      }
    }
  }

  const surface = JSON.parse(readFileSync(join(PROJECT, 'compat', 'surface', '0.2.1-alpha.1.json'), 'utf8'))
  const drift = JSON.parse(readFileSync(join(PROJECT, 'compat', 'adaptation', 'name-drift.json'), 'utf8'))
  const driftRows = new Map()
  for (const row of drift.kept ?? []) driftRows.set(row.name, row)
  const serviceNames = new Set(Object.keys(surface.services ?? {}))
  // The client surface answers which services are client-plane, and therefore which dotted names are
  // the member layer this analyzer can read. A dotted name whose head is not declared there is counted
  // as an unread gap instead of being recorded as a host-plane absence nobody measured.
  const clientSurfacePath = join(PROJECT, 'compat', 'surface', 'client-0.2.1-alpha.1.json')
  const clientServiceNames = new Set(existsSync(clientSurfacePath) ? Object.keys(JSON.parse(readFileSync(clientSurfacePath, 'utf8')).services ?? {}) : [])
  const eventNames = new Set(surface.events ?? [])

  const classify = (kind, name, plane) => {
    const allClient = plane === 'client'
    const inSurface = kind === 'event' ? eventNames.has(name) : serviceNames.has(name)
    if (inSurface) return { classification: 'present', evidence: 'compat/surface/0.2.1-alpha.1.json' }
    const row = driftRows.get(name)
    if (row !== undefined && (row.candidates ?? []).length > 0) {
      return { classification: 'translatable', to: row.candidates[0].name, evidence: 'compat/adaptation/name-drift.json ' + row.tier }
    }
    if (row !== undefined) return { classification: 'loss', evidence: 'compat/adaptation/name-drift.json ' + row.tier + ', no candidate' }
    if (allClient) {
      return { classification: 'client-plane', evidence: 'used only from the client half; the archived surface describes the host plane' }
    }
    return { classification: 'absent', evidence: 'not in the 0.2.1 surface and not in the drift table' }
  }

  const usages = []
  const planeOf = (at) => (at.every((where) => where.startsWith('client ')) ? 'client' : 'host')
  for (const [name, at] of members) usages.push({ kind: 'service', name, via: 'ctx.member', at, ...classify('service', name, planeOf(at)) })
  for (const [name, at] of memberPaths) {
    const head = name.split('.')[0]
    if (clientServiceNames.has(head) === false) { limits.memberUsageHeadsOutsideClientSurface += 1; continue }
    usages.push({ kind: 'service', name, member: name.slice(head.length + 1), via: 'ctx.member', at, ...classify('service', name, planeOf(at)) })
  }
  for (const [name, at] of lookups) usages.push({ kind: 'service', name, via: 'ctx.get', at, ...classify('service', name, planeOf(at)) })
  for (const [name, at] of injects) usages.push({ kind: 'service', name, via: 'inject', at, ...classify('service', name, planeOf(at)) })
  for (const [name, at] of events) usages.push({ kind: 'event', name, via: 'ctx.on', at, ...classify('event', name, planeOf(at)) })
  usages.sort((left, right) => left.name.localeCompare(right.name))

  const counts = {}
  for (const usage of usages) counts[usage.classification] = (counts[usage.classification] ?? 0) + 1

  return {
    format: 'dsh-link.plugin-usage/1',
    generatedBy: 'scripts/analyze-plugin-usage.mjs',
    plugin: {
      name: String(manifest.name ?? ''),
      version: String(manifest.version ?? ''),
      license: String(manifest.license ?? 'none'),
      patch: manifest?.dsh?.bundle?.patch ?? null,
      client: manifest?.dsh?.client !== undefined,
    },
    dir: absolute.replaceAll(String.fromCharCode(92), '/'),
    filesScanned: files.length,
    sourceDigest: sourceDigest(files, absolute),
    usages,
    imports: [...imports].map(([specifier, at]) => ({ specifier, at })).sort((left, right) => left.specifier.localeCompare(right.specifier)),
    counts,
    limits,
  }
}

function option(argv, name) {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = option(process.argv, '--dir')
  if (dir === undefined) {
    console.error('usage: node scripts/analyze-plugin-usage.mjs --dir <package dir> [--out <file>]')
    process.exit(2)
  }
  const report = analyze(dir)
  const out = option(process.argv, '--out')
  if (out === undefined) console.log(JSON.stringify(report, null, 1))
  else {
    writeFileSync(out, JSON.stringify(report, null, 1) + '\n', 'utf8')
    console.log('wrote ' + out)
  }
}
