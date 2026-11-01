#!/usr/bin/env node
/**
 * Refuse a repository state that exposes a local account name.
 *
 * Development checkouts quote absolute paths; the publishing sanitizer rewrites the account
 * segment to `<user>`. This gate fails when a file still names a concrete Windows or POSIX
 * user profile directory, and names the file so it can be sanitized. Documented placeholders
 * such as `/Users/<user>` are not account names and stay allowed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.argv[2] ?? process.cwd()
const SKIP = /(^|[\\/])(\.git|node_modules|vendor|target|\.tmp)([\\/]|$)/
const TEXT = /(\.md|\.json|\.mjs|\.js|\.ts|\.tsx|\.yml|\.yaml|\.rs|\.toml|\.txt|\.ps1|\.py|\.css|\.html|\.svg|\.gitignore|\.cjs)$/i
// Account-shaped segments that are documentation placeholders, not real profile names.
const PLACEHOLDER = '(?!<user>|name\\b|username\\b|user\\b|you\\b|test\\b|tester\\b|example\\b)'
const RULES = [
  ['concrete Windows user path', new RegExp('Users[\\\\/]+' + PLACEHOLDER + '[A-Za-z0-9._-]+')],
  ['concrete POSIX user path', new RegExp('(?:^|[^A-Za-z0-9])[/\\\\]Users[/\\\\]+' + PLACEHOLDER + '[A-Za-z0-9._-]+')],
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
