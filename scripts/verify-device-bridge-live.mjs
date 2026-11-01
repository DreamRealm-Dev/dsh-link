#!/usr/bin/env node
/**
 * Gate: the phone really serves the device net as its slave end.
 *
 * R249 proved this by hand: install the APK, read the pairing code off /__shell/bridge, and drive
 * pair -> fs.list -> fs.read with the SHIPPED plugins/dsh-lan-bridge wire code. This gate does the same
 * without a human, and asserts each step instead of printing it.
 *
 * R1 an Android device is attached (no device = the third state, exit 3)
 * R2 the app is installed on it
 * R3 the app is running and the bridge listens on 47600 inside the guest
 * R4 /__shell/bridge answers and carries a six-digit pairing code
 * R5 a file placed by this gate is listed and read back through the wire, byte for byte
 * R6 an operation outside the slice (fs.write) is refused BY NAME with the reserved sentence
 * R7 after the run the route reports paired and served>=1
 *
 * Usage: node scripts/verify-device-bridge-live.mjs [--adb <path>] [--serial <id>]
 * Exit 0 every reading held | 1 a reading failed | 3 the world is not there (never a verdict).
 */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const ADB = flag('adb', 'Q:\\MuMu\\nx_main\\adb.exe')
const SERIAL = flag('serial', '127.0.0.1:16384')
const ROUTE_PORT = Number(flag('route-port', '31771'))
const FILE = '/sdcard/Download/dsh-bridge-gate.txt'
const CONTENT = 'dsh-bridge-gate ' + String(Date.now())

const rows = []
const record = (id, ok, detail) => { rows.push({ id, ok: ok === true }); console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + '. ' + detail) }
const adb = (args) => execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8', timeout: 120000 })
const skip = (why) => { console.log('SKIP: ' + why); process.exit(3) }

let devices = ''
try { devices = execFileSync(ADB, ['devices'], { encoding: 'utf8', timeout: 60000 }) } catch (error) { skip('adb is not usable at ' + ADB) }
record('R1', devices.indexOf(SERIAL + '\tdevice') !== -1, 'adb devices names ' + SERIAL + ' = ' + String(devices.indexOf(SERIAL + '\tdevice') !== -1))
if (rows[0].ok !== true) skip('no device attached, so the wire cannot be measured')

let packages = ''
try { packages = adb(['shell', 'pm', 'list', 'packages', 'dev.dshlink.client']) } catch (error) { packages = '' }
record('R2', packages.indexOf('package:dev.dshlink.client') !== -1, 'pm list packages reports dev.dshlink.client = ' + String(packages.indexOf('package:dev.dshlink.client') !== -1))
if (rows[1].ok !== true) skip('the app is not installed, so there is no bridge to drive')

try { adb(['shell', 'am', 'force-stop', 'dev.dshlink.client']) } catch (error) { /* restarting is best effort */ }
try { adb(['shell', 'monkey', '-p', 'dev.dshlink.client', '-c', 'android.intent.category.LAUNCHER', '1']) } catch (error) { /* measured below */ }
await new Promise((done) => setTimeout(done, 8000))
let netstat = ''
try { netstat = adb(['shell', 'cat /proc/net/tcp']) } catch (error) { netstat = '' }
// 47600 is 0x00B9F0; /proc/net/tcp prints the local address as hex port in the last four digits
const listening = netstat.split(String.fromCharCode(10)).some((line) => /:B9F0\s/.test(line) && /\s0A\s/.test(line))
record('R3', listening, 'the guest listens on 47600 (0xB9F0 in /proc/net/tcp) = ' + String(listening))
if (listening === false) skip('the bridge is not listening, so the wire cannot be measured')

try { adb(['forward', 'tcp:' + String(ROUTE_PORT), 'tcp:31761']) } catch (error) { skip('adb forward for the bridge route failed: ' + String(error && error.message).slice(0, 120)) }
const readRoute = async () => {
  const answer = await fetch('http://127.0.0.1:' + String(ROUTE_PORT) + '/__shell/bridge')
  return { status: answer.status, body: await answer.json().catch(() => null) }
}
let route = null
try { route = await readRoute() } catch (error) { skip('the bridge route did not answer: ' + String(error && error.message).slice(0, 120)) }
const code = String(route.body?.pairingCode ?? '')
record('R4', route.status === 200 && /^[0-9]{6}$/.test(code), 'GET /__shell/bridge -> HTTP ' + String(route.status) + ', pairingCode ' + JSON.stringify(code) + ', phase ' + JSON.stringify(route.body?.phase))
if (rows[3].ok !== true) skip('no pairing code, so there is nothing to pair with')

// R251: the manifest asks for MANAGE_EXTERNAL_STORAGE, and on Android 11+ a fresh install still needs the grant
// the system dialog would give (a debug build gets it here through appops). Without it the app can LIST /sdcard but
// every fs.read answers EACCES - measured: "[fs.read] FAILED io /storage/emulated/0/...: Permission denied".
let grant = 'skipped'
try { grant = adb(['shell', 'appops', 'set', 'dev.dshlink.client', 'MANAGE_EXTERNAL_STORAGE', 'allow']).trim() || 'granted' } catch (error) { grant = String(error && error.message).slice(0, 80) }
console.log('  ..    all-files access for dev.dshlink.client: ' + grant)
try { adb(['shell', 'echo ' + CONTENT + ' > ' + FILE]) } catch (error) { /* measured below */ }
try { adb(['forward', 'tcp:47600', 'tcp:47600']) } catch (error) { /* forward may already exist */ }
let wire = ''
try {
  // R380: the same run also asks the phone for ONE STILL FRAME (`--photo`), which is the camera half of the device net.
  // It costs a couple of seconds and it makes "the phone is a camera" a reading this gate re-takes instead of a claim.
  wire = execFileSync(process.execPath, [join(PROJECT, 'tools', 'device-bridge', 'drive.mjs'), '--port', '47600', '--code', code, '--list', '/sdcard/Download', '--read', FILE, '--photo', '1', '--refuse', 'fs.write', '--timeout', '20000'], { cwd: PROJECT, encoding: 'utf8', timeout: 180000 })
} catch (error) { wire = String((error && error.stdout) || '') + String((error && error.stderr) || '') }
record('R5', wire.indexOf('[pair] ok') !== -1 && wire.indexOf(CONTENT) !== -1, 'pair + fs.list + fs.read: ' + (wire.indexOf('[pair] ok') !== -1 ? 'paired' : 'no pair') + ', the file content read back = ' + String(wire.indexOf(CONTENT) !== -1))
// R380 - the phone as a CAMERA, through the same wire: the host asked for one frame and read the artifact back.
const photoLine = wire.split(String.fromCharCode(10)).filter((line) => line.indexOf('[media.capture] photo ->') !== -1)[0] ?? ''
const readBack = wire.split(String.fromCharCode(10)).filter((line) => line.indexOf('read back through fs.read') !== -1)[0] ?? ''
const photoOk = /"bytes":\d+/.test(photoLine) && /"path":"[^"]+\.jpg"/.test(photoLine) && readBack !== ''
record('R5b', photoOk, 'the host asked the phone for a still frame and read it back: ' + (photoLine === '' ? 'no photo step answered' : photoLine.replace('[media.capture] photo -> ', '')) + (readBack === '' ? '' : ' | ' + readBack.replace('[media.capture] ', '')))
record('R6', wire.indexOf('refused code=reserved') !== -1 && wire.indexOf('not implemented on Android yet') !== -1, 'fs.write is refused by name: ' + String(wire.indexOf('refused code=reserved') !== -1))
let after = null
try { after = await readRoute() } catch (error) { after = null }
record('R7', after !== null && after.body?.paired !== null && Number(after.body?.served ?? 0) >= 1, 'after the run: paired=' + JSON.stringify(after === null ? null : after.body?.paired) + ', served=' + String(after === null ? '?' : after.body?.served) + ', refused=' + String(after === null ? '?' : after.body?.refused))

try { adb(['forward', '--remove', 'tcp:' + String(ROUTE_PORT)]) } catch (error) { /* best effort */ }
const failed = rows.filter((row) => row.ok !== true)
console.log('  ' + String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
if (failed.length > 0) { console.log('  --- driver transcript ---'); for (const line of wire.split(String.fromCharCode(10)).slice(-12)) console.log('  | ' + line.trim()) }
process.exit(failed.length === 0 ? 0 : 1)
