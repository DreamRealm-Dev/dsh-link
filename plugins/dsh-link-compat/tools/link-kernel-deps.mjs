#!/usr/bin/env node
/**
 * R197: make this package's kernel imports resolvable from ITS OWN directory.
 *
 * The loader imports @deepseek-ai/schemastery (lib/index.js:2). A `link:` mount puts a junction at
 * <profile>/node_modules/dsh-link-compat pointing at this repo, and Node resolves a module's imports
 * from its REAL path - so the kernel's own node_modules is not on the walk, and the import throws
 * before apply() ever runs. The kernel then composes the row and the plugin simply never starts: the
 * live composition shows dsh-link-compat at 216 ids while nothing about it appears in the boot log,
 * because the loader reports through ctx.logger (which this composition does not sink to console).
 *
 * The fix is one junction into the kernel's VENDORED copy, which lives in this same repository - so the
 * link needs no network, no install and no machine state outside <workspace>/.
 *
 *   node plugins/dsh-link-compat/tools/link-kernel-deps.mjs           # create what is missing, report
 *   node plugins/dsh-link-compat/tools/link-kernel-deps.mjs --check   # read-only: everything resolvable?
 *
 * Exit 0 when every dependency resolves; 1 when one cannot be linked (the path is named).
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const KERNEL = resolve(PACKAGE, '..', '..', 'core', 'deepseek-harness')
const VENDOR = join(KERNEL, 'vendor')
/** The kernel packages this half imports, and where this repository vendors each one. */
const NEEDED = [['@deepseek-ai/schemastery', join(VENDOR, 'schemastery')]]
const check = process.argv.includes('--check')
let bad = 0
for (const [specifier, target] of NEEDED) {
  const link = join(PACKAGE, 'node_modules', ...specifier.split('/'))
  const present = existsSync(join(link, 'package.json'))
  if (present) { console.log('resolvable: ' + specifier + ' -> ' + link); continue }
  if (check) { console.log('MISSING: ' + specifier + ' (expected at ' + link + ')'); bad += 1; continue }
  if (!existsSync(join(target, 'package.json'))) { console.log('CANNOT LINK: ' + specifier + ' - no vendored copy at ' + target); bad += 1; continue }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'junction')
  console.log('linked: ' + specifier + ' -> ' + target)
}
const after = NEEDED.filter(([specifier]) => !existsSync(join(PACKAGE, 'node_modules', ...specifier.split('/'), 'package.json')))
console.log('dsh-link-compat kernel imports: ' + String(NEEDED.length - after.length) + '/' + String(NEEDED.length) + ' resolvable' + (after.length === 0 ? '' : ' - missing ' + after.map((one) => one[0]).join(', ')))
process.exit(after.length === 0 ? 0 : 1)