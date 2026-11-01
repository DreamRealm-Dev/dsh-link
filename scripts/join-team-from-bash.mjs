#!/usr/bin/env node
/**
 * Join the LIVE collaboration bus from a plain shell.
 *
 * The relay route exists for exactly this: a process outside the kernel - a bash script, a teammate entry,
 * another app - posts a batch of control records and becomes a member of the same bus the in-shell team
 * reads. Until R221 no live world had it bound, so every join was a rehearsal.
 *
 * Pass condition is about THIS run: the harness must be answered 200 AND the batch must have moved at least
 * one record (appended for a first join, skipped for a repeat from the same home/instance). The relay's
 * cumulative counter is printed but never trusted - earlier runs move it too.
 *
 * Usage: node scripts/join-team-from-bash.mjs [--end lead-bridge] [--team team-1] [--port 31760]
 * Exit 0 this run joined | 1 it did not | 3 an input is missing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const END = flag('end', 'lead-bridge')
const TEAM = flag('team', 'team-1')
const PORT = Number(flag('port', '31760'))
const OVERLAY = join(process.env.APPDATA ?? '', 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'dsh-link.patch.yml')

const say = (line) => console.log(line)
const fail = (line) => { console.log('FAIL  ' + line); process.exit(1) }

if (!existsSync(OVERLAY)) { console.log('SKIP: no live overlay - this runs against a running DSH-LINK client'); process.exit(3) }
const tokenLine = String(readFileSync(OVERLAY, 'utf8')).split('\n').filter((line) => /^\s*token:\s*\S+/.test(line)).pop()
if (tokenLine === undefined) { console.log('SKIP: the overlay carries no relay token; add relay.token to the link-collab row'); process.exit(3) }
const token = tokenLine.split(':', 2)[1].trim().replace(/^['"]|['"]$/g, '')
const origin = 'http://127.0.0.1:' + String(PORT)
const relay = origin + '/api/dsh-link-collab/relay'

const read = async (path) => {
  const answer = await fetch(origin + path)
  return { status: answer.status, body: await answer.json().catch(() => null) }
}
const namesOf = (doc) => (Array.isArray(doc?.members) ? doc.members.map((one) => String(one.name ?? one.id ?? '?')) : [])

const before = await read('/api/dsh-link-teams/state')
say('before: ' + String(namesOf(before.body).length) + ' member(s), ledger ' + String(before.body?.ledger?.records ?? '?'))

const home = join(PROJECT, '.tmp', 'r221-bridge-' + END)
mkdirSync(home, { recursive: true })
let out = ''
try {
  out = execFileSync(process.execPath, [
    join(PROJECT, 'tools', 'foreign-harness', 'foreign-end.mjs'),
    '--home', home, '--peer', relay, '--token', token,
    '--member', 'm-' + END, '--writer', END, '--end', END, '--team', TEAM,
    '--tool', 'sum', '--capability', 'sum', '--rounds', '1',
  ], { encoding: 'utf8', timeout: 120000 })
} catch (error) { fail('the foreign harness did not run: ' + String(error && error.message).slice(0, 200)) }

const reachedBody = /"reached":\{"status":(\d+),"body":(\{[^}]*\})/.exec(out)
const status = reachedBody === null ? 0 : Number(reachedBody[1])
const counts = reachedBody === null ? '' : reachedBody[2]
const appended = Number((/"appended":(\d+)/.exec(counts) ?? [0, '0'])[1])
const skipped = Number((/"skipped":(\d+)/.exec(counts) ?? [0, '0'])[1])
say('harness: reached status ' + String(status) + ' with ' + counts)

const after = await read('/api/dsh-link-teams/state')
const names = namesOf(after.body)
const joined = names.includes('m-' + END) || names.includes(END)
const live = await read('/api/dsh-link-collab/status')
say('after : ' + String(names.length) + ' member(s), ledger ' + String(after.body?.ledger?.records ?? '?') + '; joined=' + String(joined))
say('relay : ' + JSON.stringify(live.body?.relay))

// A writer name is held by ONE instance for the life of the log. A fresh home mints a new instance, so a
// second home for the same name is answered RELAY_REWRITTEN - the log protecting itself, not a bug.
if (status === 400 && String(out).includes('RELAY_REWRITTEN')) {
  fail('this end (' + END + ') is already held by another instance in the live log: reuse that instance\'s home, or join under a new name with --end ' + END + '-2')
}
if (!joined) fail('the member m-' + END + ' is not in ' + TEAM + ', so this process did not join the bus')
if (status !== 200) fail('this run batch was not accepted (status ' + String(status) + ')')
if (appended + skipped < 1) fail('the batch was accepted but moved no record (appended 0, skipped 0)')
say('PASS - this run joined ' + TEAM + ' over the live relay: appended ' + String(appended) + ', skipped ' + String(skipped))
