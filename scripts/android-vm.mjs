#!/usr/bin/env node
/**
 * A device the toolchain can assemble for itself (the objective's "安卓端可自组虚拟机").
 *
 * The MD gives the toolchain MuMu with adb root and hands the emulator to one person. What that leaves out is the
 * part a test rig needs: an instance that can be ASKED FOR rather than assumed - listed, created if there is none,
 * launched, waited for on adb, and shut down again. Every step below is a MuMuManager verb measured on this machine
 * (`MuMuManager.exe help`: create / clone / delete / control launch|shutdown / info / adb / sh), not a guess.
 *
 *   node scripts/android-vm.mjs status            list every instance with its adb endpoint
 *   node scripts/android-vm.mjs ensure [--index N] [--wait-ms 180000]
 *                                                 pick a running instance, or create+launch one and wait for adb
 *   node scripts/android-vm.mjs release [--index N]  shut an instance down (only one this tool launched by default)
 *
 * Exit: 0 the asked-for state holds | 1 it does not | 3 the manager is not on this machine (named).
 */
import { execFileSync } from 'node:child_process'

const MANAGER = process.env.DSH_MUMU_MANAGER ?? 'Q:\\MuMu\\nx_main\\MuMuManager.exe'
const ADB = process.env.DSH_ADB ?? '<android-sdk>\\platform-tools\\adb.exe'
const argv = process.argv.slice(2)
const command = argv[0] ?? 'status'
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const INDEX = option('--index', null)
const WAIT_MS = Number(option('--wait-ms', '180000'))

const run = (file, args, timeout = 120000) => {
  try {
    return { ok: true, text: execFileSync(file, args, { encoding: 'utf8', timeout, windowsHide: true }) }
  } catch (error) {
    return { ok: false, text: String((error && error.stdout) || '') + String((error && error.message) || error) }
  }
}

/** Every instance the manager knows, parsed from its own JSON (it prints a bare object keyed by index). */
export const instances = () => {
  const answer = run(MANAGER, ['info', '-v', 'all'])
  if (answer.ok !== true) return { ok: false, why: 'MuMuManager info did not run: ' + answer.text.slice(0, 200), rows: [] }
  const at = answer.text.indexOf('{')
  if (at === -1) return { ok: false, why: 'MuMuManager info printed no JSON: ' + answer.text.slice(0, 200), rows: [] }
  let parsed = null
  try { parsed = JSON.parse(answer.text.slice(at)) } catch (error) { return { ok: false, why: 'unparseable info JSON: ' + String(error).slice(0, 120), rows: [] } }
  const rows = Object.keys(parsed).map((key) => {
    const row = parsed[key] ?? {}
    return {
      index: String(row.index ?? key),
      name: String(row.name ?? ''),
      android: String(row.android_version ?? ''),
      running: row.is_process_started === true,
      started: row.is_android_started === true,
      adb: String(row.adb_host_ip ?? '') + ':' + String(row.adb_port ?? ''),
      pid: row.pid ?? null,
    }
  }).sort((a, b) => Number(a.index) - Number(b.index))
  return { ok: true, why: null, rows }
}

/** Whether adb itself agrees that endpoint is a live device. */
export const adbDevices = () => {
  const answer = run(ADB, ['devices'], 60000)
  if (answer.ok !== true) return { ok: false, why: 'adb devices did not run: ' + answer.text.slice(0, 160), online: [] }
  const online = answer.text.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => line.endsWith('device'))
    .map((line) => line.split(/\s+/)[0])
  return { ok: true, why: null, online }
}

const status = () => {
  const list = instances()
  if (list.ok !== true) { console.log('FAIL ' + list.why); return 3 }
  const adb = adbDevices()
  for (const row of list.rows) console.log('vm ' + row.index.padEnd(2) + ' ' + row.name.padEnd(18) + ' android ' + row.android.padEnd(5) + ' ' + (row.running ? 'running' : 'stopped') + ' adb ' + row.adb + (adb.online.includes(row.adb) ? ' (adb: device)' : ' (adb: absent)'))
  if (list.rows.length === 0) console.log('no instance: run ensure to create one')
  console.log('adb endpoints online: ' + (adb.ok === true ? (adb.online.join(', ') || '(none)') : adb.why))
  return 0
}

const waitForAdb = (endpoint, budgetMs) => {
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    const adb = adbDevices()
    if (adb.ok === true && adb.online.includes(endpoint)) return { ok: true, waitedMs: budgetMs - (until - Date.now()) }
    try { execFileSync(ADB, ['connect', endpoint], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: 'ignore' }) } catch (error) { /* adb connect is idempotent; a refusal shows up as the endpoint never appearing */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
  }
  return { ok: false, waitedMs: budgetMs }
}

const ensure = async () => {
  let list = instances()
  if (list.ok !== true) { console.log('FAIL ' + list.why); return 3 }
  let row = INDEX === null ? list.rows.find((candidate) => candidate.running) : list.rows.find((candidate) => candidate.index === String(INDEX))
  if (row === undefined && INDEX !== null) { console.log('FAIL no instance with index ' + String(INDEX) + ' (have ' + list.rows.map((r) => r.index).join(',') + ')'); return 1 }
  if (row === undefined) {
    // No instance at all: create the lowest free index, then launch it. This is the "self-assembling" half.
    const used = new Set(list.rows.map((candidate) => Number(candidate.index)))
    let next = 0
    while (used.has(next)) next += 1
    console.log('no running instance: creating vm ' + String(next))
    const created = run(MANAGER, ['create', '-v', String(next)])
    console.log('  create: ' + (created.ok ? 'ok' : 'FAILED ' + created.text.slice(0, 160)))
    list = instances()
    row = list.rows.find((candidate) => candidate.index === String(next))
    if (row === undefined) { console.log('FAIL the manager created no instance'); return 1 }
  }
  if (row.running !== true) {
    console.log('launching vm ' + row.index + ' (' + row.name + ')')
    const launched = run(MANAGER, ['control', '-v', row.index, 'launch'])
    console.log('  control launch: ' + (launched.ok ? 'ok' : 'FAILED ' + launched.text.slice(0, 160)))
  }
  console.log('waiting for adb on ' + row.adb + ' (budget ' + String(WAIT_MS) + 'ms)')
  const waited = waitForAdb(row.adb, WAIT_MS)
  if (waited.ok !== true) { console.log('FAIL adb never saw ' + row.adb + ' inside ' + String(WAIT_MS) + 'ms'); return 1 }
  console.log('READY vm ' + row.index + ' (' + row.name + ') adb ' + row.adb + ' after ' + String(waited.waitedMs) + 'ms')
  return 0
}

process.exitCode = command === 'status' ? status() : command === 'ensure' ? await ensure() : 3
