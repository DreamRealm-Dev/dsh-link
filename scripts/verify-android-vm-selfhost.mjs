#!/usr/bin/env node
/**
 * Gate 151 android-vm-selfhost - the toolchain assembles its own Android device (the objective's "安卓端可自组虚拟机").
 *
 * The MD hands the emulator to one person and says MuMu has adb root; what a rig needs on top is an instance it can
 * ASK FOR. scripts/android-vm.mjs is that ask (status / ensure / release over MuMuManager's own verbs), and this gate
 * holds the four facts the ask is worth anything for:
 *
 *   1  the manager is on this machine and its info parses      MuMuManager.exe info -v all -> JSON
 *   2  an instance is RUNNING and reports an adb endpoint      is_process_started + adb_host_ip:adb_port
 *   3  adb agrees that endpoint is a live device               adb devices lists it as "device"
 *   4  our app is installed on that device                     pm list packages contains dev.dshlink.client
 *   5  the instrument can fail (control of a missing index)    a named refusal, so 1-4 are not a holiday
 *
 * R73 alive-control: EXEMPT, with the reason - nothing here boots a kernel or a profile: it reads the emulator
 * manager and adb, both of which answer or refuse by name, and an absent manager is a named exit 3 rather than a red.
 *
 * Usage: node scripts/verify-android-vm-selfhost.mjs [--json]
 * Exit: 0 every reading held | 1 a reading failed | 3 the manager or adb is not on this machine (named).
 */
import { execFileSync } from 'node:child_process'

const MANAGER = process.env.DSH_MUMU_MANAGER ?? 'Q:\\MuMu\\nx_main\\MuMuManager.exe'
const ADB = process.env.DSH_ADB ?? '<android-sdk>\\platform-tools\\adb.exe'
const PACKAGE = 'dev.dshlink.client'

const run = (file, args, timeout = 60000) => {
  try { return { ok: true, text: execFileSync(file, args, { encoding: 'utf8', timeout, windowsHide: true }) } }
  catch (error) { return { ok: false, text: String((error && error.stdout) || '') + String((error && error.stderr) || '') + String((error && error.message) || error) } }
}

const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail: String(detail) })

const main = () => {
  const info = run(MANAGER, ['info', '-v', 'all'])
  if (info.ok !== true) {
    console.log('SKIP: the emulator manager is not answering on this machine (' + info.text.slice(0, 120) + '); nothing about a self-assembled device can be read')
    return 3
  }
  const at = info.text.indexOf('{')
  let parsed = null
  try { parsed = at === -1 ? null : JSON.parse(info.text.slice(at)) } catch (error) { parsed = null }
  held('1', 'the manager is present and its own info parses', parsed !== null,
    parsed === null ? 'info printed no parseable JSON: ' + info.text.slice(0, 160) : Object.keys(parsed).length + ' instance(s) reported')

  const rows = parsed === null ? [] : Object.keys(parsed).map((key) => parsed[key] ?? {})
  const running = rows.filter((row) => row.is_process_started === true)
  const withAdb = running.map((row) => ({ row, endpoint: String(row.adb_host_ip ?? '') + ':' + String(row.adb_port ?? '') })).filter((entry) => /:\d+$/.test(entry.endpoint))
  held('2', 'an instance is running and names the adb endpoint it is reachable on', withAdb.length > 0,
    withAdb.length > 0 ? withAdb.map((entry) => 'vm ' + String(entry.row.index) + ' (' + String(entry.row.name) + ') android ' + String(entry.row.android_version) + ' -> ' + entry.endpoint).join('; ') : 'running=' + String(running.length) + ' of ' + String(rows.length) + ' instance(s)')

  const adbDevices = run(ADB, ['devices'])
  if (adbDevices.ok !== true) {
    console.log('SKIP: adb is not on this machine (' + adbDevices.text.slice(0, 120) + ')')
    return 3
  }
  const online = adbDevices.text.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => line.endsWith('device')).map((line) => line.split(/\s+/)[0])
  const endpoint = withAdb.length === 0 ? null : withAdb[0].endpoint
  held('3', 'adb itself lists that endpoint as a live device', endpoint !== null && online.includes(endpoint),
    'endpoint=' + String(endpoint) + ' adb-devices=[' + online.join(', ') + ']')

  let installed = null
  if (endpoint !== null && online.includes(endpoint)) {
    const pm = run(ADB, ['-s', endpoint, 'shell', 'pm', 'list', 'packages', PACKAGE])
    installed = pm.ok === true && pm.text.includes('package:' + PACKAGE)
    held('4', 'our application is installed on that device', installed === true, pm.text.trim().slice(0, 160) || 'pm printed nothing')
  } else {
    held('4', 'our application is installed on that device', false, 'no live device to ask (see reading 3)')
  }

  const refused = run(MANAGER, ['control', '-v', '9999', 'launch'], 30000)
  const named = refused.ok !== true || /error|invalid|fail|no/i.test(refused.text)
  held('5', 'the instrument can fail: controlling an index that does not exist is refused, not silently accepted', named,
    'exit=' + String(refused.ok ? 0 : 1) + ' says=' + refused.text.trim().slice(0, 120))

  for (const reading of readings) console.log((reading.ok ? 'ok    ' : 'FAIL  ') + reading.id + ' ' + reading.name + ' | ' + reading.detail)
  const failed = readings.filter((reading) => reading.ok !== true)
  console.log('')
  console.log('android-vm-selfhost: ' + String(readings.length) + ' readings, ' + String(readings.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
  console.log('note: this gate never creates or launches an instance - scripts/android-vm.mjs ensure does that on demand, and a gate that changed the machine it measures would not be measuring the machine.')
  return failed.length === 0 ? 0 : 1
}

process.exitCode = main()
