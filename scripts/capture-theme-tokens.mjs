#!/usr/bin/env node
/**
 * Capture the theme token surface, which is the seam an external design spec plugs into.
 *
 * A unified theme spec (another desktop's design system, for instance) can only be adopted if the
 * tokens it names exist here and the local controls consume tokens instead of literals. This reads
 * the kernel's declared `--dsw-*` tokens with their source lines, counts the usages, and lists the
 * tokens something uses but nothing declares — the class that breaks silently when a theme changes.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const CLIENT = join(KERNEL, 'packages', 'client')
const PLUGINS = join(REPO, 'plugins')
const OUT = join(REPO, 'compat/surface/theme-0.2.1.json')
const FORMAT = 'dsh-link.theme-surface/1'
const EXTENSIONS = ['.css', '.ts', '.tsx']
const TOKEN = /--dsw-[a-z0-9-]+/g

/** @param {string} at @param {string[]} found @returns {string[]} */
function walk(at, found) {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'lib') continue
    const next = join(at, entry.name)
    if (entry.isDirectory()) walk(next, found)
    else if (EXTENSIONS.some(extension => entry.name.endsWith(extension))) found.push(next)
  }
  return found
}

function main() {
  const argv = process.argv.slice(2)
  if (!existsSync(CLIENT)) { console.log('FAIL  no client packages at ' + CLIENT); process.exit(1) }
  const declared = new Map()
  const used = new Map()
  let files = 0
  // The assembled stylesheet also declares tokens outside the client packages (the web app shell),
  // so both roots are read before anything is called undeclared.
  const roots = [CLIENT, join(KERNEL, 'apps', 'web', 'src')].filter(root => existsSync(root))
  const sources = roots.flatMap(root => walk(root, []))
  for (const file of sources) {
    files += 1
    const where = relative(REPO, file).replace(/\\/g, '/')
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      // A declaration carries a colon right after the name; anything else var()s it.
      for (const token of line.match(TOKEN) ?? []) {
        // A name ending in '-' is a template fragment, not a token.
        if (token.endsWith('-')) continue
        if (new RegExp(token + '\\s*:').test(line)) {
          const record = declared.get(token) ?? { token, declaredIn: [] }
          if (record.declaredIn.length < 6) record.declaredIn.push(where + ':' + String(index + 1))
          declared.set(token, record)
        } else {
          const record = used.get(token) ?? { token, uses: 0, firstUse: where + ':' + String(index + 1) }
          record.uses += 1
          used.set(token, record)
        }
      }
    })
  }
  const orphaned = [...used.values()].filter(record => !declared.has(record.token)).sort((left, right) => right.uses - left.uses)
  // Our own plugins are the consumers an outside spec would land on: do they read tokens, or do
  // they paint literals? A literal is where a unified theme silently stops applying.
  const pluginTokens = new Map()
  const pluginLiterals = []
  if (existsSync(PLUGINS)) {
    for (const file of walk(PLUGINS, [])) {
      const where = relative(REPO, file).replace(/\\/g, '/')
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        for (const token of line.match(TOKEN) ?? []) {
          const record = pluginTokens.get(token) ?? { token, uses: 0, declared: declared.has(token) }
          record.uses += 1
          pluginTokens.set(token, record)
        }
        const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.exec(line)
        if (literal !== null && pluginLiterals.length < 40) pluginLiterals.push({ at: where + ':' + String(index + 1), literal: literal[0] })
      })
    }
  }
  const report = {
    format: FORMAT,
    kernel: JSON.parse(readFileSync(join(REPO, 'kernel.lock.json'), 'utf8')).packageVersion,
    method: 'reads --dsw-* declarations and usages under core/deepseek-harness/packages/client/*/src',
    files,
    counts: { declared: declared.size, used: used.size, orphaned: orphaned.length },
    // Families matter more than individual names for judging whether an outside spec can land here.
    families: Object.fromEntries([...new Set([...declared.keys()].map(token => token.replace(/^--dsw-([a-z0-9]+)-.*$/, '$1')))]
      .sort()
      .map(family => [family, [...declared.keys()].filter(token => token.startsWith('--dsw-' + family + '-')).length])),
    declared: Object.fromEntries([...declared].sort((left, right) => left[0].localeCompare(right[0]))),
    usedButUndeclared: orphaned.slice(0, 40),
    plugins: {
      tokensUsed: [...pluginTokens.values()].sort((left, right) => right.uses - left.uses).slice(0, 40),
      tokensUsedButNotDeclared: [...pluginTokens.values()].filter(record => !record.declared).map(record => record.token),
      literals: pluginLiterals,
      literalCount: pluginLiterals.length,
    },
    limits: [
      'Declarations are read from the client sources, not from the assembled stylesheet: a token a plugin declares at runtime is counted as used-but-undeclared.',
      'Only --dsw-* names are read; an outside spec\u2019s own prefix would need its own capture.',
    ],
    sourceDigest: createHash('sha256').update(JSON.stringify([...declared.keys()].sort())).digest('hex').slice(0, 16),
  }
  const text = JSON.stringify(report, null, 1) + '\n'
  if (argv.includes('--check')) {
    if (!existsSync(OUT)) { console.log('FAIL  no committed theme surface at ' + OUT); process.exit(1) }
    if (readFileSync(OUT, 'utf8') !== text) { console.log('FAIL  the committed theme surface no longer matches the client sources'); process.exit(1) }
    console.log(`PASS  ${OUT}: ${report.counts.declared} declared token(s), ${report.counts.orphaned} used-but-undeclared`)
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`files ${files} | declared ${report.counts.declared} | used ${report.counts.used} | used-but-undeclared ${report.counts.orphaned}`)
  console.log('families: ' + Object.entries(report.families).map(([name, count]) => name + '(' + count + ')').join(', '))
  for (const record of orphaned.slice(0, 8)) console.log('  orphan ' + record.token + ' x' + record.uses + ' first ' + record.firstUse)
  console.log('-> ' + OUT)
}

main()
