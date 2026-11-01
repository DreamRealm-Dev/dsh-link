#!/usr/bin/env node
/**
 * Copy a repository tree with local account names, home paths and workspace paths replaced.
 *
 * Publishing runs this over the development checkout and pushes only the output, so a source
 * file that quotes an absolute path cannot carry the author's account name into the public
 * history. Placeholders stay readable: `<user>` for the account segment and `<workspace>`
 * for an optional checkout root passed as `--workspace=<name>`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

const args = process.argv.slice(2)
const workspaceArg = args.find((value) => value.startsWith('--workspace='))
const workspace = workspaceArg?.slice('--workspace='.length) ?? ''
const [source, target] = args.filter((value) => !value.startsWith('--'))
if (source === undefined || target === undefined) {
  process.stderr.write('usage: node scripts/sanitize-publish.mjs <source-dir> <target-dir> [--workspace=<name>]\n')
  process.exit(1)
}
const SKIP = /(^|[\\/])(\.git|node_modules|target|\.tmp)([\\/]|$)/
const TEXT = /(\.md|\.json|\.mjs|\.js|\.ts|\.tsx|\.yml|\.yaml|\.rs|\.toml|\.txt|\.ps1|\.py|\.css|\.html|\.svg|\.gitignore|\.cjs)$/i

/** Replace one absolute path's account segment while keeping its separator style. */
function scrub(text) {
  let next = text.replace(/([A-Za-z]):([\\/]+)Users([\\/]+)[A-Za-z0-9._-]+/gi, (_m, drive, sep1, sep2) => drive + ':' + sep1 + 'Users' + sep2 + '<user>')
  if (workspace !== '') {
    const escaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp('[A-Za-z]:([\\\\/]+)' + escaped, 'gi'), '<workspace>$1')
  }
  return next
}

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

for (const file of walk(source)) {
  const dest = join(target, relative(source, file))
  mkdirSync(dirname(dest), { recursive: true })
  if (!TEXT.test(file) || statSync(file).size > 4 * 1024 * 1024) {
    writeFileSync(dest, readFileSync(file))
    continue
  }
  writeFileSync(dest, scrub(readFileSync(file, 'utf8')))
}
process.stdout.write('sanitized ' + source + ' -> ' + target + '\n')
