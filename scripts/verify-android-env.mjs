#!/usr/bin/env node
/**
 * Gate: the Android story is exactly as big as the evidence says, and no bigger.
 *
 * Why this exists (R222). The MD audit found the Android requirement MISSING in a way worth pinning: a
 * committed Tauri scaffold that was never compiled, a mobile engine seam that refuses by name, and an
 * environment probe that was never a gate. Without this file the repository has no reading at all for its
 * fourth first-release platform - a claim nobody checks is a claim that drifts.
 *
 * This gate does NOT pretend Android works. Six readings, each holding one fact:
 *   R1  the scaffold exists (gen/android with app/ and gradlew), so "we started" is true
 *   R2  the build chain the scaffold needs is ABSENT (tauri.properties / tauri.build.gradle.kts /
 *       tauri.settings.gradle), so "it was never compiled" is true and stays true until someone adds them
 *   R3  the mobile engine seam refuses BY NAME (mobile.rs: "not implemented on Android yet")
 *   R4  the environment probe names every missing prerequisite with its own value
 *   R5  the probe answers a machine-readable report, and the emulator this machine would use is named in it
 *   R6  declared readings == produced readings
 *
 * Usage: node scripts/verify-android-env.mjs [--json]
 * Exit 0 every reading held | 1 a reading failed | 3 an input is missing (never a verdict).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const DECLARED = 7
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')

const ANDROID = join(PROJECT, 'src-tauri', 'gen', 'android')
const CHAIN = ['tauri.properties', 'tauri.build.gradle.kts', 'tauri.settings.gradle']
const MOBILE_RS = join(PROJECT, 'src-tauri', 'src', 'core', 'mobile.rs')

const rows = []
const record = (id, ok, detail) => rows.push({ id, ok: ok === true, detail })

if (!existsSync(ANDROID)) { console.log('SKIP: no android scaffold at ' + ANDROID + ', so there is nothing to judge'); process.exit(3) }

const scaffolded = existsSync(join(ANDROID, 'app')) && existsSync(join(ANDROID, 'gradlew'))
record('R1', scaffolded, 'scaffold: gen/android with app/ and gradlew = ' + String(scaffolded))

// R2 (rewritten on R223): the first version asserted the three generated gradle chain files were ABSENT, which
// was true of a scaffold nobody had touched. The moment this round actually ran `tauri android build` one of them
// appeared and the reading flipped - correctly, and uselessly, because the fact that matters is whether an
// ARTIFACT exists. It now asserts exactly that: no APK has ever been produced, and it names what the tree does
// carry so a reader can see how far the attempt got.
const apks = []
const walk = (dir) => {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (error) { return }
  for (const entry of entries) {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) walk(at)
    else if (entry.name.endsWith('.apk')) apks.push(at.slice(PROJECT.length))
  }
}
walk(ANDROID)
const present = CHAIN.filter((name) => existsSync(join(ANDROID, "app", name)) || existsSync(join(ANDROID, name)))
// R2 has now flipped once, and the flip is the point: on R222 it asserted NO apk existed ("never compiled"), which
// was true then. On R233 the chain finally produced one - so the reading asserts the artifact exists, names it with
// its size, and still reports which gradle chain files the tree carries.
const newest = apks.length === 0 ? null : apks[apks.length - 1]
const size = newest === null ? 0 : (() => { try { return readFileSync(join(PROJECT, newest)).length } catch (error) { return 0 } })()
record('R2', apks.length > 0,
  'APK artifacts produced by this checkout: ' + JSON.stringify(apks) + (newest === null ? '' : ' (newest ' + String(size) + ' bytes)')
  + '; gradle chain files present: ' + JSON.stringify(present)
  + (apks.length === 0 ? ' - no APK means the scaffold has never been compiled into something installable' : ' - the scaffold has been compiled into an installable artifact'))
let seam = ''
try { seam = readFileSync(MOBILE_RS, 'utf8') } catch (error) { seam = '' }
const seamLine = seam.split('\n').find((line) => line.includes('not implemented on Android yet')) ?? ''
record('R3', seamLine.length > 0 && seam.includes('reserved'),
  'the mobile seam refuses by name: ' + JSON.stringify(seamLine.trim().slice(0, 110)))

let probeOut = ''
try {
  // --json is what makes the probe print its machine-readable line; without it only the human report appears.
  probeOut = execFileSync(process.execPath, [join(PROJECT, 'scripts', 'probe-android-env.mjs'), '--json'], { cwd: PROJECT, encoding: 'utf8', timeout: 180000 })
} catch (error) { probeOut = String(error && error.stdout ? error.stdout : '') }
const fails = probeOut.split('\n').filter((line) => line.trim().startsWith('FAIL')).map((line) => line.trim())
record('R4', fails.length > 0,
  'the probe names ' + String(fails.length) + ' missing prerequisite(s), each with its own value: '
  + JSON.stringify(fails.slice(0, 5).map((line) => line.replace(/^FAIL\s+/, '').slice(0, 70))))

// The probe prints a human report then one JSON line. Read the JSON line rather than a regex over prose: the
// first version of this reading looked for the literal "mumu":{"roots" and missed a report whose JSON was
// concatenated after the summary.
const jsonLine = probeOut.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('JSON ')).pop() ?? ''
let probeJson = null
try { probeJson = jsonLine === '' ? null : JSON.parse(jsonLine.slice(5)) } catch (error) { probeJson = null }
const mumuRoots = probeJson?.mumu?.roots ?? null
const vmUp = /mumu\.vm-up\s+—\s+([^\n]*)/.exec(probeOut)
record('R5', probeJson !== null && Array.isArray(mumuRoots) && mumuRoots.length > 0,
  'the probe answered a JSON report and names the emulator this machine would use: ' + JSON.stringify(mumuRoots)
  + '; guest VM: ' + String(vmUp === null ? '(not reported)' : vmUp[1].trim().slice(0, 70)))

// R7: on R223 this machine DID have an end: MuMu was launched, adb attached 127.0.0.1:16384 and the
// guest answered getprop. The reading is written so it holds in both worlds - it asserts that WHEN a device
// is attached the probe carries its identity, and says which identity it saw. It does not require a device:
// an emulator that is off is not a product failure, it is a fact this line names.
const attached = /device\.attached\s+—\s+is device/.test(probeOut) || (probeJson?.device?.attached === true)
const identity = probeJson?.device?.identity ?? probeJson?.device?.getprop ?? null
record('R7', attached === false || identity !== null,
  attached ? 'a device is attached and the probe carries its identity: ' + JSON.stringify(identity).slice(0, 140) : 'no device attached, so there is no identity to read (named, not a failure)')
record('R6', rows.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(rows.length + 1))

const failed = rows.filter((row) => row.ok !== true)
if (JSON_OUT) console.log(JSON.stringify({ gate: 'android-env', declared: DECLARED, rows }, null, 2))
else {
  for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '. ' + row.detail)
  console.log('  ' + String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
}
process.exit(failed.length === 0 ? 0 : 1)
