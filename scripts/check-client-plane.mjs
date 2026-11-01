#!/usr/bin/env node
/**
 * Judge a plugin's client-plane service usages against the captured client surface.
 *
 * The archived host surface cannot answer this: a client-half plugin names services the browser
 * packages declare. This joins the two so a usage becomes present / absent / unknown instead of
 * "nobody looked". Names only — a declared name does not promise the same method set.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './analyze-plugin-usage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SURFACE = join(REPO, 'compat/surface/client-0.2.1-alpha.1.json')
const TARGETS = join(REPO, 'compat/adaptation/usage-targets.json')
const OUT = join(REPO, 'compat/adaptation/client-plane.json')
const FORMAT = 'dsh-link.client-plane/1'

/**
 * Every slot name a plugin's own sources inject into or register.
 *
 * @param {string} dir - the plugin package directory.
 * @returns {any[]} one row per distinct slot name with the first citation.
 */
function slotsUsedBy(dir) {
  const found = new Map()
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const next = join(at, entry.name)
      if (entry.isDirectory()) { walk(next); continue }
      if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(entry.name)) continue
      const lines = readFileSync(next, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        for (const pattern of [/slots\.inject\(\s*['"]([^'"]+)['"]/, /slots\.register(?:Factory)?\(\s*\{\s*name:\s*['"]([^'"]+)['"]/]) {
          const match = pattern.exec(line)
          if (match === null) continue
          if (!found.has(match[1])) found.set(match[1], { name: match[1], at: relative(dir, next).replace(/\\/g, '/') + ':' + String(index + 1) })
        }
      })
    }
  }
  walk(dir)
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function main() {
  if (!existsSync(SURFACE)) { console.log('SKIP  no client surface at ' + SURFACE); process.exit(3) }
  const surface = JSON.parse(readFileSync(SURFACE, 'utf8'))
  const services = surface.services ?? {}
  const targets = JSON.parse(readFileSync(TARGETS, 'utf8')).targets
  const plugins = []
  for (const target of targets) {
    const usage = analyze(target.dir)
    const rows = []
    for (const entry of usage.usages ?? []) {
      if (entry.classification !== 'client-plane') continue
      // `remote.credentials` is two facts: which service, and which of its members the call site
      // reaches for. The head is judged against the declared services; the tail against the member
      // set that service declares, which is the layer R34 added.
      const name = String(entry.name)
      const head = name.split('.')[0]
      const member = name.slice(head.length + 1)
      const declared = services[head] ?? null
      const row = {
        name, kind: entry.kind, via: entry.via, at: (entry.at ?? [])[0] ?? null,
        member: member === '' ? null : member,
        class: declared === null ? 'absent-from-client-surface' : 'present',
        declaredIn: declared === null ? null : declared.declaredIn,
        declaredType: declared === null ? null : declared.type,
        declaredAs: null,
        memberReason: null,
      }
      if (declared !== null && member !== '') {
        const members = Array.isArray(declared.members) ? declared.members : null
        const properties = Array.isArray(declared.properties) ? declared.properties : null
        row.memberReason = declared.membersReason ?? null
        if (members !== null && members.includes(member)) { row.class = 'member-present'; row.declaredAs = 'member' }
        else if (properties !== null && properties.includes(member)) { row.class = 'member-present'; row.declaredAs = 'property' }
        // A name that is not listed is evidence only when the set was enumerated; otherwise the
        // honest answer is unknown, never absent.
        else if (declared.membersComplete === true) row.class = 'member-absent'
        else row.class = 'member-unknown'
      }
      rows.push(row)
    }
    const slotRows = slotsUsedBy(target.dir).map(row => {
      const declared = (surface.slots ?? {})[row.name] ?? null
      return { name: row.name, at: row.at, class: declared === null ? 'absent-from-slot-map' : 'present', declaredIn: declared === null ? null : declared.declaredIn, specifier: declared === null ? null : declared.specifier }
    })
    const counts = {}
    for (const row of rows) counts[row.class] = (counts[row.class] ?? 0) + 1
    for (const row of slotRows) counts['slot:' + row.class] = (counts['slot:' + row.class] ?? 0) + 1
    plugins.push({ name: target.name, version: target.version, rows, slotRows, counts })
  }
  const report = {
    format: FORMAT,
    note: 'A dotted usage is judged twice: the head against the declared services, the tail against the member set that service declares (member-present / member-absent / member-unknown). A member is present when the type declares it as a callable member or as a data property, and absent only when the member set was enumerated completely; a service whose set could not be enumerated yields member-unknown with the reason. Slot names are judged against SlotMap merging, which is what makes a name legal to render.',
    surface: SURFACE.replace(REPO, '').replace(/\\/g, '/'),
    clientSurfaceCounts: surface.counts,
    plugins,
    counts: plugins.reduce((total, plugin) => {
      for (const [key, value] of Object.entries(plugin.counts)) total[key] = (total[key] ?? 0) + value
      return total
    }, {}),
    sourceDigest: createHash('sha256').update(JSON.stringify(plugins.map(plugin => [plugin.name, plugin.rows.map(row => [row.name, row.class]), (plugin.slotRows ?? []).map(row => [row.name, row.class])]))).digest('hex').slice(0, 16),
  }
  const text = JSON.stringify(report, null, 1) + '\n'
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.log('FAIL  no committed report at ' + OUT); process.exit(1) }
    if (readFileSync(OUT, 'utf8') !== text) { console.log('FAIL  the committed client-plane report no longer describes these plugins'); process.exit(1) }
    console.log(`PASS  ${OUT}: ${JSON.stringify(report.counts)} against ${report.clientSurfaceCounts.services} declared client service(s)`)
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  for (const plugin of plugins) {
    if (plugin.rows.length === 0) continue
    console.log(`\n${plugin.name}@${plugin.version}  ${JSON.stringify(plugin.counts)}`)
    for (const row of plugin.rows) console.log(`  [${row.class}] service ${row.name} (${row.kind}, ${row.via}) ${row.declaredType ?? ''} ${row.declaredAs ?? ''} ${(row.declaredIn ?? []).join(', ')}${row.class === 'member-unknown' ? '  reason: ' + String(row.memberReason ?? '').slice(0, 80) : ''}`)
    for (const row of plugin.slotRows ?? []) console.log(`  [${row.class}] slot ${row.name} @ ${row.at} -> ${row.specifier ?? 'not declared'} ${(row.declaredIn ?? []).join(', ')}`)
  }
  console.log(`\nclient surface: ${report.clientSurfaceCounts.services} service(s), ${report.clientSurfaceCounts.events} event(s) -> ${OUT}`)
}

main()
