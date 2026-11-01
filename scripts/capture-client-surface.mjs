#!/usr/bin/env node
/**
 * Capture the client plane's own service and event names from the kernel source.
 *
 * The archived host surface describes what the Host plane offers. A client-half plugin uses a
 * different plane: the browser packages declare their services by augmenting the Cordis Context
 * interface inside `declare module '@deepseek-ai/cordis'`. This reads those augmentations, so a
 * client-plane usage can be judged against something instead of against nothing.
 *
 * It reads names and types, not behavior: a name that is still declared does not promise the
 * same method set.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const GROUPS = join(KERNEL, 'packages')
const OUT = join(REPO, 'compat/surface/client-0.2.1-alpha.1.json')
const FORMAT = 'dsh-link.client-surface/1'
const EXTENSIONS = ['.ts', '.tsx']

/** @param {string} at @param {string[]} found @returns {string[]} source files under a package's src. */
function walk(at, found) {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests') continue
    const next = join(at, entry.name)
    if (entry.isDirectory()) walk(next, found)
    else if (EXTENSIONS.some(extension => entry.name.endsWith(extension))) found.push(next)
  }
  return found
}

/**
 * Read one file's SlotMap declaration, which is where a slot name becomes legal.
 *
 * @param {string[]} lines - the file's lines.
 * @param {string} where - repository-relative path, for the citation.
 * @param {Map<string, any>} into - slot name to record.
 * @returns {void}
 */
function readSlotMap(lines, where, into) {
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^(\s*)interface SlotMap \{$/.exec(lines[index])
    if (open === null) continue
    const base = open[1].length
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const text = lines[cursor]
      if (/^\s*\}/.test(text) && text.search(/\S/) <= base) break
      const match = /^\s+?(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(.+)$/.exec(text)
      if (match === null) continue
      const name = match[1] ?? match[2] ?? match[3]
      const record = into.get(name) ?? { name, specifier: match[4].trim(), declaredIn: [] }
      record.declaredIn.push(where + ':' + String(cursor + 1))
      into.set(name, record)
    }
  }
}

/** @param {string[]} lines @param {string} where @param {Map<string, any>} into @returns {void} */
function readAugmentations(lines, where, into) {
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^declare module '([^']+)' \{$/.exec(lines[index])
    if (open === null || !open[1].includes('cordis')) continue
    let depth = 1
    for (let cursor = index + 1; cursor < lines.length && depth > 0; cursor += 1) {
      const text = lines[cursor]
      if (/^\}/.test(text)) { depth = 0; break }
      const face = /^\s{2}interface (Context|Events) \{$/.exec(text)
      if (face === null) continue
      for (let member = cursor + 1; member < lines.length; member += 1) {
        const text2 = lines[member]
        if (/^\s{2}\}/.test(text2)) break
        // A service reads `name: Type`; an event reads `'name'(args): void`, so quoted names count too.
        // The type is captured greedily: it can contain slashes (`layout: import('./service.ts').ILayout`),
        // and requiring none silently dropped every such declaration from the table.
        const match = /^\s{4}(?:readonly\s+)?(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\??\s*(?::\s*(.*?)\s*$|\()/.exec(text2)
        if (match === null) continue
        const name = match[1] ?? match[2] ?? match[3]
        const bucket = face[1] === 'Context' ? 'services' : 'events'
        const type = match[4] === undefined ? null : match[4].replace(/\s+\/\/.*$/, '').trim()
        const record = into[bucket].get(name) ?? { name, type, declaredIn: [] }
        record.declaredIn.push(where + ':' + String(member + 1))
        into[bucket].set(name, record)
      }
    }
  }
}

/**
 * A declaration head: the line where a type name becomes legal.
 *
 * `extends` is captured so a base class or interface can be followed; a class body and an interface body
 * are read the same way, because a member is a member whichever keyword introduced it.
 */
const DECLARATION_HEAD = /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|type)\s+([A-Za-z_$][\w$]*)\b(.*)$/

/** Modifiers a member declaration may carry before its name. */
const MEMBER_MODIFIERS = '(?:readonly\\s+|static\\s+|public\\s+|private\\s+|protected\\s+|abstract\\s+|declare\\s+|override\\s+|async\\s+|accessor\\s+)*'

/** A method signature: a name followed by a parameter list. */
const METHOD_MEMBER = new RegExp('^\\s*' + MEMBER_MODIFIERS + "(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_$][\\w$]*))\\s*(?:<[^>(]*>)?\\s*\\(")

/** An accessor, which answers a read rather than a call. */
const ACCESSOR_MEMBER = new RegExp('^\\s*' + MEMBER_MODIFIERS + '(get|set)\\s+([A-Za-z_$][\\w$]*)\\s*\\(')

/** A data member: a name followed by a type annotation. */
const DATA_MEMBER = new RegExp('^\\s*' + MEMBER_MODIFIERS + "(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_$][\\w$]*))\\s*\\??\\s*:")

/** An index or mapped signature: the names it admits are not statically known. */
const OPEN_SIGNATURE = /^\s*(?:readonly\s+)?\[[^\]]*\]\s*\??\s*:/

/** Every file under a root, skipping the directories that are not source. */
function walkSources(at, found) {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'lib' || entry.name.startsWith('.')) continue
    const next = join(at, entry.name)
    if (entry.isDirectory()) walkSources(next, found)
    else if (EXTENSIONS.some(extension => entry.name.endsWith(extension))) found.push(next)
  }
  return found
}

/** Undo the escapes a declaration carried while it sat inside a string literal. */
function unescapeDeclaration(text) {
  return text.replace(/\\n/g, String.fromCharCode(10)).replace(/\\t/g, ' ').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

/** Name of a member the regexes matched, whichever quoting it used. */
function memberName(match) {
  return match[1] ?? match[2] ?? match[3]
}

/**
 * Read one declaration body into a site record.
 *
 * @param lines - the declaration's lines, starting at its head.
 * @param site - the record to fill.
 * @returns void
 */
function readBody(lines, site) {
  let depth = 0
  let opened = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\/\/.*$/, '')
    if (index === 0) {
      const at = line.indexOf('{')
      if (at === -1) { site.complete = false; site.note = site.note === '' ? 'declaration has no body on its head line' : site.note; return }
      depth = 1
      opened = true
      for (const character of line.slice(at + 1)) {
        if (character === '{') depth += 1
        else if (character === '}') depth -= 1
      }
      if (depth <= 0) return
      continue
    }
    const trimmed = line.trim()
    if (depth === 1 && trimmed !== '' && !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')) {
      const accessor = ACCESSOR_MEMBER.exec(line)
      const method = accessor === null ? METHOD_MEMBER.exec(line) : null
      const data = accessor === null && method === null ? DATA_MEMBER.exec(line) : null
      if (OPEN_SIGNATURE.test(line)) { site.complete = false; site.note = 'index or mapped signature: ' + trimmed.slice(0, 60) }
      else if (accessor !== null) site.properties.push(accessor[2])
      else if (method !== null && memberName(method) !== 'constructor') site.members.push(memberName(method))
      else if (data !== null) site.properties.push(memberName(data))
    }
    for (const character of line) {
      if (character === '{') depth += 1
      else if (character === '}') depth -= 1
    }
    if (opened && depth <= 0) return
  }
  site.complete = false
  site.note = site.note === '' ? 'body did not close' : site.note
}

/**
 * Record every declaration in one text: heads, bases, and members.
 *
 * @param lines - the text's lines.
 * @param where - repository-relative path, for the citation.
 * @param index - type name to declaration sites.
 * @returns void
 */
function readDeclarations(lines, where, index) {
  for (let index0 = 0; index0 < lines.length; index0 += 1) {
    const head = DECLARATION_HEAD.exec(lines[index0])
    if (head === null) continue
    const site = { name: head[2], kind: head[1], where: where + ':' + String(index0 + 1), members: [], properties: [], bases: [], complete: true, note: '' }
    const tail = head[3]
    const extendsAt = /\bextends\s+([^{]+)/.exec(tail)
    if (extendsAt !== null) {
      site.bases = extendsAt[1].split(',').map(part => part.trim().split('<')[0].trim()).filter(name => /^[A-Za-z_$][\w$]*$/.test(name))
    }
    const body = lines.slice(index0)
    if (site.kind === 'type') {
      const rhs = tail.replace(/^\s*=\s*/, '').trim()
      if (rhs.startsWith('{')) readBody(body, site)
      else { site.complete = false; site.note = 'type alias to ' + rhs.slice(0, 60) }
    } else readBody(body, site)
    const found = index.get(site.name) ?? []
    found.push(site)
    index.set(site.name, found)
  }
}

/**
 * Index every type declaration the kernel sources carry, including generated ones.
 *
 * A generated declaration can sit inside a string literal (the client API catalog stores whole
 * interface declarations that way), so those strings are read as declarations too: the members they
 * name are as real as any in a .ts file, and leaving them out is how a member set silently shrinks.
 *
 * @returns type name to its declaration sites.
 */
function indexDeclarations() {
  const index = new Map()
  const roots = [join(KERNEL, 'packages'), join(KERNEL, 'vendor')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const file of walkSources(root, [])) {
      const where = relative(REPO, file).replace(/\\/g, '/')
      const text = readFileSync(file, 'utf8')
      readDeclarations(text.split(/\r?\n/), where, index)
      for (const match of text.matchAll(/\bdeclaration:\s*(['\"])((?:[^\\]|\\.)*?)\1/g)) {
        readDeclarations(unescapeDeclaration(match[2]).split(String.fromCharCode(10)), where + ' (embedded declaration)', index)
      }
    }
  }
  return index
}

/** The site whose file sits closest to the service that named this type, or null when the choice is a guess. */
/** @param kind - the kind the referring declaration used, so a base is not taken from a same-named interface. */
function pickSite(sites, declaredIn, kind = null) {
  if (sites.length === 1) return sites[0]
  if (kind !== null) {
    const sameKind = sites.filter(site => site.kind === kind)
    if (sameKind.length === 1) return sameKind[0]
  }
  const packageOf = (where) => {
    const at = where.lastIndexOf('/src/')
    return at === -1 ? where : where.slice(0, at)
  }
  const wanted = packageOf(declaredIn)
  const same = sites.filter(site => packageOf(site.where) === wanted)
  if (same.length === 1) return same[0]
  return null
}

/**
 * The members a service type declares, following its bases.
 *
 * Names are read, not called: `members` are the names a caller can call, `properties` the names it can
 * read. `complete` is false when something in the chain could not be enumerated, and then a name that is
 * not listed is not evidence of absence.
 *
 * @param typeExpression - the declared type of the service.
 * @param declaredIn - where the service itself was declared, used to pick between same-named types.
 * @param index - the declaration index.
 * @param seen - sites already followed, for cycles.
 * @returns the member record.
 */
function resolveMembers(typeExpression, declaredIn, index, seen = new Set(), expectedKind = null) {
  const bare = /^[A-Za-z_$][\w$]*$/.exec(String(typeExpression ?? '').trim())
  if (bare === null) {
    return { members: null, properties: null, complete: false, reason: 'type is not a bare name: ' + String(typeExpression).slice(0, 60) }
  }
  const name = bare[0]
  const sites = index.get(name) ?? []
  if (sites.length === 0) return { members: null, properties: null, complete: false, reason: 'no declaration found for ' + name }
  const site = pickSite(sites, declaredIn, expectedKind)
  if (site === null) return { members: null, properties: null, complete: false, reason: 'ambiguous: ' + String(sites.length) + ' declarations of ' + name }
  if (seen.has(site.where)) return { members: [], properties: [], complete: true, reason: 'cycle at ' + site.where }
  seen.add(site.where)
  const result = {
    members: [...new Set(site.members)],
    properties: [...new Set(site.properties)],
    complete: site.complete,
    reason: site.kind + ' ' + name + ' @ ' + site.where + (site.note === '' ? '' : ' (' + site.note + ')'),
  }
  if (site.kind === 'interface' && site.members.length === 0 && site.properties.length === 0) {
    result.complete = false
    result.reason += ' (empty body here: names this interface carries may be added by declaration merging)'
  }
  for (const base of site.bases) {
    const resolved = resolveMembers(base, site.where, index, seen, site.kind)
    if (resolved.members === null) {
      result.complete = false
      result.reason += '; base ' + base + ' not enumerable: ' + resolved.reason
      continue
    }
    result.members = [...new Set([...result.members, ...resolved.members])]
    result.properties = [...new Set([...result.properties, ...(resolved.properties ?? [])])]
    result.complete = result.complete && resolved.complete
    result.reason += '; base ' + resolved.reason
  }
  result.members.sort()
  result.properties = result.properties.filter(name0 => result.members.includes(name0) === false).sort()
  return result
}

/**
 * The service table with each service's declared members attached.
 *
 * @param services - the collected service records.
 * @param index - the declaration index.
 * @returns name to record, sorted by name.
 */
function dumpServices(services, index) {
  const entries = [...services].sort((left, right) => left[0].localeCompare(right[0]))
  const out = {}
  for (const [name, record] of entries) {
    const resolved = resolveMembers(record.type, record.declaredIn[0] ?? '', index)
    out[name] = {
      ...record,
      members: resolved.members,
      properties: resolved.properties,
      membersComplete: resolved.members !== null && resolved.complete === true,
      membersReason: resolved.reason,
    }
  }
  return out
}
function main() {
  const argv = process.argv.slice(2)
  if (!existsSync(GROUPS)) { console.log('FAIL  no kernel packages at ' + GROUPS); process.exit(1) }
  const into = { services: new Map(), events: new Map(), slots: new Map() }
  const packages = []
  // The client plane is not one directory: browser services are declared in packages/client/*/src and
  // in packages/*/*/src/client (api/remotes declares `remote` that way), so both are read.
  const candidates = []
  for (const group of readdirSync(GROUPS, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(GROUPS, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageDir = join(GROUPS, group.name, entry.name)
      // packages/client/* keeps its browser half in src/client as well, so walking src once already
      // covers it; adding both roots read the same file twice and doubled every declaration.
      candidates.push(group.name === 'client' ? join(packageDir, 'src') : join(packageDir, 'src', 'client'))
    }
  }
  for (const srcDir of candidates) {
    if (!existsSync(srcDir)) continue
    const packageDir = resolve(srcDir, '..', '..')
    const manifest = join(packageDir, 'package.json')
    const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : relative(GROUPS, packageDir)
    const files = walk(srcDir, [])
    if (files.length === 0) continue
    packages.push({ package: name, files: files.length })
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      const where = relative(REPO, file).replace(/\\/g, '/')
      readAugmentations(lines, where, into)
      readSlotMap(lines, where, into.slots)
    }
  }
  const dump = (map) => Object.fromEntries([...map].sort((left, right) => left[0].localeCompare(right[0])))
  const services = dumpServices(into.services, indexDeclarations())
  const events = dump(into.events)
  const slots = dump(into.slots)
  const enumerated = Object.values(services).filter(record => Array.isArray(record.members)).length
  const complete = Object.values(services).filter(record => record.membersComplete === true).length
  const report = {
    format: FORMAT,
    kernel: JSON.parse(readFileSync(join(REPO, 'kernel.lock.json'), 'utf8')).packageVersion,
    method: "reads 'declare module <cordis>' Context/Events augmentations under core/deepseek-harness/packages/client/*/src",
    packages: packages.length,
    counts: {
      services: Object.keys(services).length,
      events: Object.keys(events).length,
      slots: Object.keys(slots).length,
      servicesWithMembers: complete,
      servicesWithMembersPartial: enumerated - complete,
      servicesWithoutMembers: Object.keys(services).length - enumerated,
    },
    services,
    events,
    slots,
    limits: [
      'Members are the names the service type declares, followed through its declared bases: members are the ones a caller can call, properties the ones it can read. A type whose members could not be enumerated records members: null with membersReason, and a member usage against such a service is unknown, never absent.',
      'Members are read from the kernel sources, including declarations stored inside generated catalogs; a name that is still declared does not promise the same body.',
      'Names and declared types only: a name that is still declared does not promise the same method set.',
      'Only Context/Events augmentations are read; a service reached through another package\u2019s re-export is not attributed twice.',
      'Slot names come from SlotMap declaration merging, which is what makes a name legal; whether the current owner renders that seat is a runtime fact this does not read.',
    ],
    sourceDigest: createHash('sha256').update(JSON.stringify([services, [...into.events.keys()]])).digest('hex').slice(0, 16),
  }
  const text = JSON.stringify(report, null, 1) + '\n'
  if (argv.includes('--check')) {
    if (!existsSync(OUT)) { console.log('FAIL  no committed client surface at ' + OUT); process.exit(1) }
    if (readFileSync(OUT, 'utf8') !== text) { console.log('FAIL  the committed client surface no longer matches the kernel sources'); process.exit(1) }
    console.log(`PASS  ${OUT}: ${report.counts.services} service(s) (${report.counts.servicesWithMembers} with a complete member set, ${report.counts.servicesWithMembersPartial} partial, ${report.counts.servicesWithoutMembers} unreadable), ${report.counts.events} event(s) over ${report.packages} package(s)`)
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`client packages: ${packages.length} | services: ${report.counts.services} | events: ${report.counts.events}`)
  for (const name of ['slots', 'configForms', 'locale', 'remote', 'connection', 'modules']) {
    const found = report.services[name]
    console.log('  ' + name.padEnd(14), found === undefined ? 'NOT DECLARED' : found.type + '  @ ' + found.declaredIn.join(', '))
  }
  console.log('-> ' + OUT)
}

main()
