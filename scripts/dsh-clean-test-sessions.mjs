#!/usr/bin/env node
/**
 * R450 - remove the test sessions this project's gates created, and nothing else.
 *
 * The store: `kernel-home/storages/session_projcache/sessions/<id>.json` holds a small projection with the session's
 * title; the durable log is `kernel-home/sessions/<encoded-workspace>/<id>/session.v4.jsonl.zstd`. A session is removed
 * only when its title matches one of the test families below - the user's own sessions are titles like
 * "DSH-LINK 开发推进与侧边栏完善" and never match. Default is a dry run; --apply deletes.
 *
 *   node scripts/dsh-clean-test-sessions.mjs            # report only
 *   node scripts/dsh-clean-test-sessions.mjs --apply    # delete
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home')
const CACHE = join(HOME, 'storages', 'session_projcache', 'sessions')
const LOGS = join(HOME, 'sessions')
const APPLY = process.argv.includes('--apply')

/** Titles this project's gates create. Kept narrow on purpose: a false match deletes a real session. */
const TEST_TITLE = /(单次调用|单次派生|产品自检|协作总线|工具面自检|工具组自检|这是一次(产品|工具面)?自检|只回复 ?done|回答 ?ok ?即可|Reply (with )?(exactly|single) (one|with)|Exact one-word|Single word alpha|g134-witness|R198 gate|witness|You are teammate|alpha|example-app|烧杯|化学实验|live path check|Reply exactly)/i

const titles = new Map()
let cacheFiles = []
try { cacheFiles = readdirSync(CACHE).filter((name) => name.endsWith('.json')) } catch (error) { cacheFiles = [] }
for (const name of cacheFiles) {
  const id = name.replace(/\.json$/, '')
  try {
    const doc = JSON.parse(readFileSync(join(CACHE, name), 'utf8'))
    const title = doc?.record?.rows?.title?.val
    titles.set(id, typeof title === 'string' ? title : '')
  } catch (error) { titles.set(id, '') }
}

const matches = [...titles.entries()].filter(([, title]) => TEST_TITLE.test(title))
const kept = [...titles.entries()].filter(([, title]) => !TEST_TITLE.test(title))

console.log('sessions in cache : ' + String(titles.size))
console.log('test sessions     : ' + String(matches.length))
console.log('kept              : ' + String(kept.length))
const sample = (rows) => rows.slice(0, 8).map(([id, title]) => '  ' + id.slice(0, 8) + '  ' + (title === '' ? '(untitled)' : title.replace(/\s+/g, ' ').slice(0, 70))).join('\n')
console.log('--- would delete ---')
console.log(sample(matches))
console.log('--- would keep ---')
console.log(sample(kept))

if (!APPLY) { console.log('(dry run: pass --apply to delete)'); process.exit(0) }

const workspaces = (() => { try { return readdirSync(LOGS).map((name) => join(LOGS, name)) } catch (error) { return [] } })()
let removedLogs = 0
let removedCaches = 0
for (const [id] of matches) {
  for (const workspace of workspaces) {
    const dir = join(workspace, id)
    if (existsSync(dir) && statSync(dir).isDirectory()) { rmSync(dir, { recursive: true, force: true }); removedLogs += 1 }
  }
  const cache = join(CACHE, id + '.json')
  if (existsSync(cache)) { rmSync(cache, { force: true }); removedCaches += 1 }
}
console.log('removed log dirs=' + String(removedLogs) + ' cache files=' + String(removedCaches))
