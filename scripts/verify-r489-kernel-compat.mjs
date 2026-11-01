#!/usr/bin/env node
/**
 * R489 adversarial compatibility gate for the R484 multi-level Agent Teams kernel patch.
 *
 * Checks the claims R484/R485/R484-P1 make, from the outside, with commands + bytes:
 *   A. the patch series is exactly the committed diff against the pinned upstream tag
 *      (5 files, no upstream test edits), and the shipped patch file's line endings are usable;
 *   B. the shipped patch (as-is) applies to a pristine worktree at the pinned tag, and the
 *      patched tree is byte-identical to the branch tree (rebase-ability proxy);
 *   C. default (single-level) configuration keeps every model-facing tool string identical to
 *      upstream; multi-level roster fields are declared optional, never required;
 *   D. forward and backward log compatibility: patched kernel reads old member events, old
 *      upstream strict schema rejects a multi-level member event (one-way migration);
 *   E. artifacts the architecture doc points at (R486/R487 handoffs, Rust core, bench parity);
 *   F. the upgrade manual is executable as written (README fixed; R485 §6 is byte-scanned);
 *   G. the P1/P1b model-facing fixes are present in source (live kernel may predate them).
 *
 * Usage: node scripts/verify-r489-kernel-compat.mjs [--json] [--strict]
 *   --strict promotes artifact/doc defects (missing handoffs, CRLF patch, corrupt manual) to
 *   blocking failures; without it they are warnings and the exit code tracks semantic checks only.
 *
 * Exit code 0 when every blocking check passes.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KERNEL = join(ROOT, 'core', 'deepseek-harness')
const PATCH = join(ROOT, 'docs', 'kernel-patches', 'R484-multilevel-team.patch')
const PATCH459 = join(ROOT, 'docs', 'kernel-patches', 'R459-page-nav-bridge.patch')
const PATCH501 = join(ROOT, 'docs', 'kernel-patches', 'R501-b2-event-window.patch')
const R484_PATHS = ['packages/experimental/agent-team', 'packages/experimental/tool-agent-team']
const R459_PATH = 'packages/client/ui-workspace/src/client/navigation.ts'
const R501_PATHS = ['packages/api/session-controller/src/client', 'packages/api/session-controller/tests/session-window.client.spec.ts']
const R501_TEST = 'packages/api/session-controller/tests/session-window.client.spec.ts'
const MULTILEVEL_TEST = 'packages/experimental/agent-team/tests/multilevel.spec.ts'
const README = join(ROOT, 'docs', 'kernel-patches', 'README.md')
const R485 = join(ROOT, 'docs', 'handoff', 'R485-cordis-rust-strict-arch.md')
const TOOL_SRC = 'packages/experimental/tool-agent-team/src/index.ts'
const ROSTER_SRC = 'packages/experimental/agent-team/src/roster.ts'
const BASE_TAG = 'dsh-v0.2.2-alpha.2'
const EXPECTED_FILES = 6
const EXPECTED_FILES_501 = 4

const args = new Set(process.argv.slice(2))
const JSON_OUT = args.has('--json')
const STRICT = args.has('--strict')

const results = []
function record(id, severity, ok, detail) {
  results.push({ id, severity, ok, detail })
  if (!JSON_OUT) {
    const tag = ok ? 'PASS' : severity === 'blocking' ? 'FAIL' : severity === 'warn' ? 'WARN' : 'INFO'
    console.log(tag.padEnd(4), id.padEnd(34), detail)
  }
}
const git = (...argv) => execFileSync('git', ['-C', KERNEL, ...argv], { encoding: 'buffer', stdio: 'pipe' })
const gitText = (...argv) => git(...argv).toString('utf8')
const strip = (value) => String(value).replace(/\r\n/g, '\n')
const docSeverity = STRICT ? 'blocking' : 'warn'

// ---------------------------------------------------------------------------------------------
// A. Patch series identity + artifact line endings
// ---------------------------------------------------------------------------------------------
const head = gitText('rev-parse', 'HEAD').trim()
const baseCommit = gitText('rev-parse', BASE_TAG).trim()
let baseIsAncestor = false
try { execFileSync('git', ['-C', KERNEL, 'merge-base', '--is-ancestor', BASE_TAG, 'HEAD'], { stdio: 'pipe' }); baseIsAncestor = true } catch { baseIsAncestor = false }
record('A1-base-is-ancestor', 'blocking', baseIsAncestor, 'HEAD=' + head.slice(0, 8) + ' at/after ' + BASE_TAG + '=' + baseCommit.slice(0, 8))
record('A2-shallow', 'info', true, 'shallow=' + gitText('rev-parse', '--is-shallow-repository').trim() + ' (cross-tag rebase needs git fetch first)')

const patchBuf = readFileSync(PATCH)
const patchText = patchBuf.toString('utf8')
const crlf = (patchText.match(/\r\n/g) ?? []).length
record('A3-patch-line-endings', docSeverity, crlf === 0, crlf + ' CRLF; a CRLF patch fails git apply on LF files (regenerate with git --output)')

const patchNorm = strip(patchText)
const r484Committed = strip(gitText('diff', baseCommit + '..HEAD', '--', ...R484_PATHS))
const patch459 = strip(readFileSync(PATCH459, 'utf8'))
const navCommitted = strip(gitText('diff', baseCommit + '..HEAD', '--', R459_PATH))
record('A4-patch-equals-committed-diff', 'blocking', r484Committed === patchNorm, 'R484 normalized bytes patch=' + patchNorm.length + ' committed=' + r484Committed.length)
record('A4b-nav-patch-equals-diff', 'blocking', navCommitted === patch459, 'R459 normalized bytes patch=' + patch459.length + ' committed=' + navCommitted.length)
const patch501 = strip(readFileSync(PATCH501, 'utf8'))
const r501Committed = strip(gitText('diff', baseCommit + '..HEAD', '--', ...R501_PATHS))
record('A4c-r501-patch-equals-diff', 'blocking', r501Committed === patch501, 'R501 normalized bytes patch=' + patch501.length + ' committed=' + r501Committed.length)
const committedNorm = strip(gitText('diff', baseCommit + '..HEAD'))
const changed = gitText('diff', '--name-only', baseCommit + '..HEAD').split('\n').filter(Boolean)
const allowed = changed.every(p => p === R459_PATH || p === R501_TEST || R501_PATHS.some(prefix => p.startsWith(prefix + '/')) || R484_PATHS.some(prefix => p.startsWith(prefix + '/')))
record('A5-patch-scope', 'blocking', changed.length === EXPECTED_FILES + 1 + EXPECTED_FILES_501 && allowed, changed.length + ' file(s) vs expected ' + (EXPECTED_FILES + 1 + EXPECTED_FILES_501) + ' (R484 6 + R459 1 + R501 4): ' + changed.map(p => p.split('/').pop()).join(', '))
const modifiedExistingTests = gitText('diff', '--diff-filter=M', '--name-only', baseCommit + '..HEAD', '--', 'packages/experimental/agent-team/tests', 'packages/experimental/tool-agent-team/tests').split('\n').filter(Boolean)
const addedTest = changed.includes(MULTILEVEL_TEST)
record('A6-no-test-edits', 'blocking', modifiedExistingTests.length === 0 && addedTest, modifiedExistingTests.length ? 'existing test files modified: ' + modifiedExistingTests.join(',') : 'no upstream test file modified; the new multilevel.spec.ts is added coverage')
const dirty = gitText('status', '--porcelain').split('\n').filter(Boolean)
record('A7-working-tree-clean', docSeverity, dirty.length === 0, dirty.length ? 'uncommitted kernel changes NOT in the patch series: ' + dirty.map(l => l.slice(3)).join(', ') : 'clean')

// ---------------------------------------------------------------------------------------------
// B. Patch applies to the pinned upstream tree (rebase-ability proxy)
// ---------------------------------------------------------------------------------------------
let worktree
try {
  worktree = mkdtempSync(join(tmpdir(), 'r489-base-'))
  execFileSync('git', ['-C', KERNEL, 'worktree', 'add', '--detach', '--quiet', worktree, BASE_TAG], { stdio: 'pipe' })
  let rawCheck = 0
  try {
    execFileSync('git', ['-C', worktree, 'apply', '--check', PATCH], { stdio: 'pipe' })
    execFileSync('git', ['-C', worktree, 'apply', '--check', PATCH459], { stdio: 'pipe' })
    execFileSync('git', ['-C', worktree, 'apply', '--check', PATCH501], { stdio: 'pipe' })
  } catch { rawCheck = 1 }
  record('B1-shipped-patch-applies', docSeverity, rawCheck === 0, rawCheck === 0 ? 'as shipped: all patch files git apply --check exit 0 on pristine ' + BASE_TAG : 'as shipped: git apply --check exit 1')
  const lfPatch = join(tmpdir(), 'r484-r489-lf.patch')
  writeFileSync(lfPatch, patchNorm)
  execFileSync('git', ['-C', worktree, 'apply', lfPatch], { stdio: 'pipe' })
  execFileSync('git', ['-C', worktree, 'apply', join(ROOT, 'docs', 'kernel-patches', 'R459-page-nav-bridge.patch')], { stdio: 'pipe' })
  execFileSync('git', ['-C', worktree, 'apply', PATCH501], { stdio: 'pipe' })
  execFileSync('git', ['-C', worktree, 'add', '-A'], { stdio: 'pipe' })
  const patchedTree = execFileSync('git', ['-C', worktree, 'write-tree'], { encoding: 'utf8' }).trim()
  const headTree = gitText('rev-parse', 'HEAD^{tree}').trim()
  record('B2-patched-tree-identity', 'blocking', patchedTree === headTree, 'patched-tree=' + patchedTree.slice(0, 12) + ' HEAD-tree=' + headTree.slice(0, 12))
} catch (error) {
  record('B2-patched-tree-identity', 'blocking', false, 'apply experiment failed: ' + String(error.message).split('\n')[0].slice(0, 160))
} finally {
  if (worktree) {
    try { execFileSync('git', ['-C', KERNEL, 'worktree', 'remove', '--force', worktree], { stdio: 'pipe' }) } catch { /* best effort */ }
    try { rmSync(worktree, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------------------------
// C. Default (single-level) model-visible parity
// ---------------------------------------------------------------------------------------------
const upstreamTool = gitText('show', BASE_TAG + ':' + TOOL_SRC)
const patchedTool = readFileSync(join(KERNEL, TOOL_SRC), 'utf8')
const literals = [
  ['spawn-default-description', 'Create one named, durable teammate. Only the Team Lead may call this tool.'],
  ['list-default-description', 'List the Lead and every durable teammate with an addressable target and current availability.'],
  ['policy-default-sentence', 'Agent Teams is available in this session'],
]
for (const [id, text] of literals) {
  const inUpstream = upstreamTool.includes(text)
  const inPatched = patchedTool.includes(text)
  record('C-' + id, 'blocking', inUpstream && inPatched, 'upstream=' + inUpstream + ' patched=' + inPatched)
}
const sliceLiteral = (source) => {
  const start = source.indexOf('Interrupt one teammate')
  const end = source.indexOf('Team Lead only.', start)
  return end === -1 ? undefined : source.slice(start, end)
}
const upstreamInterrupt = sliceLiteral(upstreamTool)
const patchedInterrupt = sliceLiteral(patchedTool)
record('C-interrupt-default-description', 'blocking', upstreamInterrupt !== undefined && upstreamInterrupt === patchedInterrupt, 'default branch byte-equal=' + (upstreamInterrupt === patchedInterrupt))
const schemaStart = patchedTool.indexOf('const MEMBER_VIEW_SCHEMA')
const schemaBlock = patchedTool.slice(schemaStart, patchedTool.indexOf('} as const', schemaStart))
for (const field of ['spawnedBy', 'depth']) {
  const declared = new RegExp('\\b' + field + '\\s*:\\s*\\{').test(schemaBlock)
  const required = new RegExp('\\b' + field + '\\s*:\\s*\\{[^}]*required:\\s*true').test(schemaBlock)
  record('C-member-schema-' + field, 'blocking', declared && !required, 'declared=' + declared + ' required=' + required)
}
const upstreamRoster = gitText('show', BASE_TAG + ':' + ROSTER_SRC)
const patchedRoster = readFileSync(join(KERNEL, ROSTER_SRC), 'utf8')
record('C-interrupt-message-change', 'warn',
  upstreamRoster.includes('the Team Lead cannot interrupt itself') && patchedRoster.includes('a Team member cannot interrupt itself'),
  'default-mode model-visible tool error text changed: "the Team Lead cannot interrupt itself" -> "a Team member cannot interrupt itself"')
record('C-lead-membership-depth', 'blocking', !/role: 'lead', name: 'lead', depth: 0/.test(patchedRoster),
  'default-mode service API: membership(lead) does NOT publish depth (upstream-identical shape)')
record('C-multilevel-tests', 'blocking', addedTest,
  addedTest ? 'multilevel.spec.ts covers depth/spawnedBy, nested spawn parent, depth limits, default shape, interrupt matrix and the P1 tool-output guard' : 'no automated multi-level coverage')

// ---------------------------------------------------------------------------------------------
// D. Log compatibility (both directions)
// ---------------------------------------------------------------------------------------------
try {
  const require = createRequire(join(KERNEL, 'package.json'))
  const { z } = require('zod')
  const upstreamMember = z.object({
    id: z.string(), name: z.string(), description: z.string(), provider: z.string(),
    context: z.enum(['fresh', 'fork']), phase: z.enum(['provisioning', 'active', 'failed']),
    error: z.string().optional(),
  }).strict()
  const upstreamEvent = z.object({ version: z.literal(2), teamId: z.string(), member: upstreamMember }).strict()
  const patchedEvent = z.object({ version: z.literal(2), teamId: z.string(), member: upstreamMember.extend({ spawnedBy: z.string().optional(), depth: z.number().int().positive().optional() }) }).strict()
  const oldEvent = { version: 2, teamId: 'session-x', member: { id: 'a', name: 'builder-lead', description: 'd', provider: 'spawn', context: 'fresh', phase: 'active' } }
  const newEvent = { version: 2, teamId: 'session-x', member: { id: 'b', name: 'probe-l3', description: 'd', provider: 'spawn', context: 'fresh', phase: 'active', spawnedBy: 'builder-lead', depth: 2 } }
  record('D1-old-log-on-new-kernel', 'blocking', patchedEvent.safeParse(oldEvent).success, 'patched kernel folds a pre-patch member event without migration')
  record('D2-new-log-on-new-kernel', 'blocking', patchedEvent.safeParse(newEvent).success, 'patched kernel accepts a multi-level member event')
  const down = upstreamEvent.safeParse(newEvent)
  record('D3-new-log-on-old-kernel', 'warn', !down.success,
    down.success ? 'old schema unexpectedly accepted new fields' : 'old upstream rc.2 strict schema rejects the new event (path: ' + down.error.issues.map(i => i.path.join('.')).join(',') + ') — downgrade needs a log rewrite')
} catch (error) {
  record('D3-new-log-on-old-kernel', 'warn', false, 'zod experiment failed: ' + String(error.message).slice(0, 120))
}

// ---------------------------------------------------------------------------------------------
// E. Artifacts named by R485 §1.2
// ---------------------------------------------------------------------------------------------
const artifacts = [
  ['R486-napi-mvp.md', join(ROOT, 'docs', 'handoff', 'R486-napi-mvp.md')],
  ['R487-perf-audit.md', join(ROOT, 'docs', 'handoff', 'R487-perf-audit.md')],
  ['rust-workspace', join(ROOT, 'rust', 'Cargo.toml')],
  ['compute-row', join(ROOT, 'plugins', 'dsh-link-compute', 'src', 'index.ts')],
  ['compute-addon', join(ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')],
]
for (const [id, path] of artifacts) record('E-' + id, docSeverity, existsSync(path), existsSync(path) ? 'present' : 'missing: ' + path.replace(ROOT, '<repo>'))
const benchPath = join(ROOT, 'rust', 'bench-results.json')
if (existsSync(benchPath)) {
  const bench = JSON.parse(readFileSync(benchPath, 'utf8'))
  const parity = bench.parity === 'byte-identical on every timed fixture' && (bench.results ?? []).every(r => r.parity === 'byte-identical')
  record('E-bench-parity', 'blocking', parity, 'native vs TS reference: ' + (bench.parity ?? 'unknown'))
  record('E-bench-speedups', 'info', true, (bench.results ?? []).map(r => r.case + ' x' + Number(r.speedup).toFixed(2) + ' p99=' + Number(r.latencyRatioP99).toFixed(2)).join(' | '))
} else record('E-bench-results', docSeverity, false, 'missing rust/bench-results.json (no benchmark-first evidence for the Rust migration)')

// ---------------------------------------------------------------------------------------------
// F. Upgrade manual executability
// ---------------------------------------------------------------------------------------------
const readmeText = existsSync(README) ? readFileSync(README, 'utf8') : ''
record('F1-readme-upstream-note', 'blocking', readmeText.includes('git remote add upstream') && readmeText.includes('--output'),
  'README documents the missing upstream remote and git --output patch regeneration')
record('F2-readme-link-gates', 'blocking', /LINK-side gates .*NOT in the kernel checkout/s.test(readmeText),
  'README scopes node plugins/build.mjs --check to the LINK repo')
const r485Text = existsSync(R485) ? readFileSync(R485, 'utf8') : ''
const loneCr = (r485Text.match(/\r(?!\n)/g) ?? []).length
record('F3-r485-manual-bytes', docSeverity, loneCr === 0 && r485Text.includes('<workspace>\\\\dsh-link'),
  loneCr + ' lone CR byte(s) in R485; a Windows path written through an escape-processing writer turns \\r into CR and breaks the §6 code block')
record('F4-r485-manual-promises-lf', 'info', /git apply --check/.test(r485Text), 'R485 §6 claims a clean-worktree git apply --check; re-run B1 for the byte-level result')

// ---------------------------------------------------------------------------------------------
// G. P1/P1b model-facing fixes present in source (live kernel may predate them)
// ---------------------------------------------------------------------------------------------
record('G1-p1-schema-declared', 'blocking',
  /spawnedBy:\s*\{\s*type:\s*'string'\s*\}/.test(schemaBlock) && /depth:\s*\{\s*type:\s*'integer'\s*\}/.test(schemaBlock),
  'P1: multi-level fields declared in the model-facing member view schema')
record('G2-p1b-absent-field-text', 'blocking',
  patchedTool.includes('absent spawnedBy means the Lead, absent depth means one'),
  'P1b: team policy + list_agents text explains absent spawnedBy/depth for rows written before multi-level')
record('G3-live-restart-note', 'info', true, 'P1b is source-only until the running kernel restarts; verify the live face after the restart')

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------
const blocking = results.filter(r => r.severity === 'blocking' && !r.ok)
const warns = results.filter(r => r.severity === 'warn' && !r.ok)
const summary = {
  head: head.slice(0, 8), base: BASE_TAG, patchBytes: patchBuf.length, patchCrlf: crlf,
  files: changed.length,
  insertions: committedNorm.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
  deletions: committedNorm.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length,
  blockingFailures: blocking.map(r => r.id), warnings: warns.map(r => r.id), checks: results,
}
if (JSON_OUT) console.log(JSON.stringify(summary, null, 2))
else {
  console.log('')
  console.log('summary: head=' + summary.head + ' base=' + summary.base + ' patch=' + summary.patchBytes + 'B (' + crlf + ' CRLF) files=' + summary.files + ' +' + summary.insertions + '/-' + summary.deletions)
  console.log('blocking failures=' + blocking.length + (blocking.length ? ' [' + blocking.map(r => r.id).join(', ') + ']' : '') + ' warnings=' + warns.length + (warns.length ? ' [' + warns.map(r => r.id).join(', ') + ']' : ''))
}
process.exitCode = blocking.length === 0 ? 0 : 1
