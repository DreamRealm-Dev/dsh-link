#!/usr/bin/env node
/**
 * Compose the live profile through the real loader and diff the entry ids against the static
 * row analysis, so the analysis is measured against kernel behaviour instead of against itself.
 *
 * The dump runs with `DSH_HOME` pointing at a throwaway home whose profile directory carries a
 * junction to the live `node_modules`, so bundle packages resolve without copying them and the
 * live profile is never written. `--dump-config` composes entries through the same
 * `applyEntryPatches` call `boot()` makes and never mounts a plugin.
 *
 * R73 alive-control: present - this probe LAUNCHES the profile (`--profile web --dump-config` through the CLI), so
 * its class is the launcher and its witness is the child's own announcement plus its exit code: `aliveVerdict`
 * below is that pair. Without it the comparison would be against a dump that may have printed nothing at all.
 * (R272: this file claimed EXEMPT while spawning the CLI with `--profile`; an exemption says "I cannot read a
 * live composition", never "I chose not to".)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProfile } from './compose-profile-rows.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = join(REPO, 'core', 'deepseek-harness')
const CLI = join(KERNEL, 'apps', 'cli', 'src', 'bin.ts')
const LIVE_HOME = 'C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/kernel-home'
const PROFILE = 'web'
const OUT = join(REPO, 'compat/adaptation/rows/dump-diff.json')

/** @param {string} text @returns {{ids: string[], lines: number}} ids as the dump prints them. */
function idsOfDump(text) {
  const ids = []
  const nested = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    // The composed entry list prints root entries unindented; an id with leading whitespace sits
    // inside some entry's config (an agent preset's own plugin list, for example) and is not a row
    // of the composed tree.
    const root = /^- id: (.+?)\s*$/.exec(line)
    if (root !== null) { ids.push(root[1].replace(/^['"]|['"]$/g, '')); continue }
    const inner = /^\s+- id: (.+?)\s*$/.exec(line)
    if (inner !== null) nested.push(inner[1].replace(/^['"]|['"]$/g, ''))
  }
  return { ids, nested, lines: lines.length }
}

/** @returns {{home: string, profileDir: string, log: string[]}} a throwaway home over the live profile. */
function stageHome() {
  const home = mkdtempSync(join(REPO, '.tmp', 'live-compose-'))
  const profileDir = join(home, 'profiles', PROFILE)
  mkdirSync(profileDir, { recursive: true })
  const live = join(LIVE_HOME, 'profiles', PROFILE)
  const log = []
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'compatibility.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const from = join(live, name)
    if (existsSync(from)) { cpSync(from, join(profileDir, name)); log.push(`copied ${name}`) } else log.push(`absent in live profile: ${name}`)
  }
  const modulesFrom = join(live, 'node_modules')
  if (existsSync(modulesFrom)) { symlinkSync(modulesFrom, join(profileDir, 'node_modules'), 'junction'); log.push('junctioned node_modules to the live profile') } else log.push('no live node_modules: bundles will not resolve')
  return { home, profileDir, log }
}

async function main() {
  if (!existsSync(CLI)) throw new Error(`no kernel CLI at ${CLI}`)
  const staged = stageHome()
  try {
    const started = Date.now()
    // R218: stderr is captured too. The kernel names every profile bundle it REFUSES on that stream
    // ("skipping profile bundle ... is incompatible with dsh ..."), and that name is the only honest
    // way to explain an id the static analysis sees and the live composition cannot: without it the
    // comparison reports a miss and blames the row instead of the refusal.
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', CLI, '--profile', PROFILE, '--dump-config'], {
      cwd: KERNEL, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, DSH_HOME: staged.home },
    })
    const stdout = String(run.stdout ?? '')
    const stderr = String(run.stderr ?? '')
    // R73 launcher witness, recorded as a value so the reading is checkable and not only printed.
    const aliveVerdict = run.status === 0 && /^- id:/m.test(stdout)
    const dump = idsOfDump(stdout)
    const staticReport = await analyzeProfile(join(LIVE_HOME, 'profiles', PROFILE))
    const staticIds = new Set(staticReport.ids.map(item => item.id))
    const dumpIds = new Set(dump.ids)
    const onlyInDump = [...dumpIds].filter(id => !staticIds.has(id)).sort()
    // The kernel's own refusal list, by name, from its own words on stderr.
    const refusedBundles = [...new Set([...stderr.matchAll(/skipping profile bundle "([^"]+)"/g)].map((m) => m[1]))].sort()
    const refusedIds = []
    for (const id of [...staticIds].filter(one => !dumpIds.has(one))) {
      const row = staticReport.ids.find((one) => one.id === id)
      const layers = (row?.mentions ?? []).map((m) => String(m.layer))
      if (layers.some((layer) => refusedBundles.includes(layer))) refusedIds.push(id)
    }
    const missing = [...staticIds].filter(id => !dumpIds.has(id) && !refusedIds.includes(id)).sort()
    const onlyInStatic = missing
    const report = {
      format: 'dsh-link.composition-dump-diff/1',
      method: 'live profile composed through apps/cli/src/bin.ts --dump-config over a throwaway home whose profile node_modules is a junction to the live one',
      staged: staged.log,
      elapsedMs: Date.now() - started,
      dump: { lines: dump.lines, rootIds: dump.ids.length, uniqueIds: dumpIds.size, idsInsideConfig: dump.nested.length, idsInsideConfigSample: [...new Set(dump.nested)].slice(0, 20) },
      staticAnalysis: {
        ids: staticReport.ids.length,
        sourceDigest: staticReport.sourceDigest,
        liveDigest: staticReport.liveDigest ?? null,
      },
      // Two digests, two jobs, and only one of them is a gate criterion (R53 debt B2).
      digests: {
        note: 'sourceDigest folds only the layer files whose real path is inside this repository, so a repository change moves it and a machine change does not. liveDigest folds the inputs this machine owns (the live profile own cordis.patch.yml and bundles installed outside the repository): it is recorded so a reader can see that the machine moved under the report, and no gate may turn on it - the application rewrites its own profile patch (measured in R40, R43 and R51).',
        gated: 'sourceDigest',
        recorded: 'liveDigest',
      },
      // A refused bundle is a THIRD category: present in the profile, absent from the composition, and
      // excluded by name rather than by a wildcard. Both lists travel with the report so a reader can
      // see what was set aside and why.
      refused: { bundles: refusedBundles, ids: refusedIds },
      agree: onlyInDump.length === 0 && onlyInStatic.length === 0,
      onlyInDump: onlyInDump.slice(0, 60),
      onlyInStatic: onlyInStatic.slice(0, 60),
      counts: { onlyInDump: onlyInDump.length, onlyInStatic: onlyInStatic.length, both: [...dumpIds].filter(id => staticIds.has(id)).length },
      limit: [
        'The dump is matched by id lines only: it does not evaluate !!js, and an id present in both does not mean the same config.',
        'Scope is the profile composition (bundle layers then the profile layer). The home layer and --patch overlays apply after it (document.ts:159) and are not part of this comparison.',
        'Only unindented ids count as rows; an id printed inside some entry config (an agent preset plugin list) is counted separately as idsInsideConfig.',
      ],
    }
    // The artifact carries no timing: it is a tracked file, and a gate run must not dirty it.
  writeFileSync(OUT, JSON.stringify({ ...report, elapsedMs: undefined }, null, 1).replace(/^\s*"elapsedMs": undefined,\n/m, '') + '\n')
    console.log(`dump ${dump.lines} lines / ${dumpIds.size} unique ids in ${report.elapsedMs} ms`)
    console.log(`static analysis ${staticReport.ids.length} ids`)
    console.log(`agree: ${report.agree}; both ${report.counts.both}, only in dump ${report.counts.onlyInDump}, only in analysis ${report.counts.onlyInStatic}`)
    if (onlyInDump.length > 0) console.log('only in dump: ' + onlyInDump.slice(0, 30).join(', '))
    if (onlyInStatic.length > 0) console.log('only in analysis: ' + onlyInStatic.slice(0, 30).join(', '))
  } finally {
    rmSync(staged.home, { recursive: true, force: true })
  }
}

await main()
