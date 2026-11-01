#!/usr/bin/env node
/**
 * Refuse a repository state that exposes a local account name or machine path.
 *
 * Development checkouts quote absolute paths; those quotes are useful locally and must never
 * ship. This gate fails when a tracked file still carries a concrete Windows user profile path
 * or a local absolute drive path, and names the file so it can be replaced with a placeholder.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.argv[2] ?? process.cwd()
const SKIP = /(^|[\\/])(\.git|node_modules|vendor|target|\.tmp)([\\/]|$)/
const TEXT = /(\.md|\.json|\.mjs|\.js|\.ts|\.tsx|\.yml|\.yaml|\.rs|\.toml|\.txt|\.ps1|\.py|\.css|\.html|\.svg|\.gitignore|\.cjs)$/i
const RULES = [
  ['concrete Windows user path', /Users[\\/]+(?!<user>)[A-Za-z0-9._-]+/],
  ['local absolute drive path', /(?:^|[\s"'`(=])[A-Za-z]:[\\/]+(?!Users[\\/]<user>|Windows|Program Files)/m],
]

/** Collect every regular file below one directory. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (SKIP.test(full)) continue
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(ROOT)
const failures = []
for (const file of files) {
  let stat
  try { stat = statSync(file) } catch { continue }
  if (stat.size > 4 * 1024 * 1024 || !TEXT.test(file)) continue
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  for (const [label, rule] of RULES) {
    const match = rule.exec(text)
    if (match === null) continue
    failures.push(file.slice(ROOT.length + 1).replace(/\\/g, '/') + ': ' + label + ' (' + match[0].slice(0, 40) + ')')
  }
}
if (failures.length > 0) {
  process.stderr.write('identity check failed:\n  ' + failures.join('\n  ') + '\n')
  process.exitCode = 1
} else {
  process.stdout.write('identity check passed (' + files.length + ' files)\n')
}
