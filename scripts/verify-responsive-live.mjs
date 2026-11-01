#!/usr/bin/env node
/**
 * Gate: the responsive client half is REALLY running in the live shell, and it follows the viewport.
 *
 * Why this exists (R222): dsh-link-responsive had never been loaded anywhere. Its host half was a barrel of
 * pure functions with no apply, so the loader answered "failed to import" with no detail, and the plugin was
 * absent from the live profile's dependencies and bundles altogether. The barrel now carries a documented
 * no-op apply, the profile mounts it, and this gate reads the proof the plugin exists for: the band attribute
 * it writes onto the document root, and that it moves when the window does.
 *
 * Readings:
 *   R1  the shell document carries data-dsh-link-layout (the client half ran at all)
 *   R2  at a wide viewport the band is the wide band
 *   R3  at a narrow viewport the band is NOT the wide band (the decision follows the window)
 *   R4  returning to the wide viewport restores the wide band (the decision is not one-way)
 *   R5  the window is put back to the size it was found at
 *
 * Usage: node scripts/verify-responsive-live.mjs [--port 31761] [--cdp 9222]
 * Exit 0 every reading held | 1 a reading failed | 3 the world is not there (never a verdict).
 */
import { CdpClient } from '../plugins/dsh-browser/lib/cdp.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(flag('port', '31761'))
const CDP = Number(flag('cdp', '9222'))
const ATTRIBUTE = 'data-dsh-link-layout'
const WIDE = 1440
const NARROW = 900

const rows = []
const record = (id, ok, detail) => { rows.push({ id, ok: ok === true }); console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + '. ' + detail) }

let list = null
try { list = await (await fetch('http://127.0.0.1:' + String(CDP) + '/json')).json() } catch (error) { list = null }
if (list === null) { console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP) + ', so this gate measured nothing'); process.exit(3) }
const page = list.find((target) => target.type === 'page' && String(target.url).indexOf('127.0.0.1:' + String(PORT)) !== -1)
if (page === undefined) { console.log('SKIP: no shell page on port ' + String(PORT) + ', so this gate measured nothing'); process.exit(3) }

const client = await CdpClient.connect(page.webSocketDebuggerUrl)
const band = async () => {
  const out = await client.send('Runtime.evaluate', { expression: 'document.documentElement.getAttribute("' + ATTRIBUTE + '") + "|" + String(innerWidth)', returnByValue: true })
  const value = String(out?.result?.value ?? '')
  const at = value.lastIndexOf('|')
  return { band: value.slice(0, at), width: Number(value.slice(at + 1)) }
}
const win = await client.send('Browser.getWindowForTarget', { targetId: page.id })
const original = (await client.send('Browser.getWindowBounds', { windowId: win.windowId })).bounds
const resize = async (width) => {
  await client.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width, height: original.height ?? 900 } })
  await new Promise((done) => setTimeout(done, 900))
}

const first = await band()
record('R1', first.band !== null && first.band !== '' && first.band !== 'null', 'the document root carries ' + ATTRIBUTE + '=' + JSON.stringify(first.band) + ' at ' + String(first.width) + 'px')

await resize(WIDE)
const wide = await band()
record('R2', wide.band === 'wide', 'at ' + String(wide.width) + 'px the band is ' + JSON.stringify(wide.band) + ' (expected wide)')

await resize(NARROW)
const narrow = await band()
record('R3', narrow.band !== 'wide' && narrow.band !== '', 'at ' + String(narrow.width) + 'px the band is ' + JSON.stringify(narrow.band) + ' (expected anything but wide)')

await resize(WIDE)
const back = await band()
record('R4', back.band === 'wide', 'back at ' + String(back.width) + 'px the band is ' + JSON.stringify(back.band) + ' (expected wide again)')

await client.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: original })
await new Promise((done) => setTimeout(done, 700))
const restored = await band()
record('R5', restored.width === (original.width ?? restored.width), 'window put back: width ' + String(restored.width) + ' against the ' + String(original.width) + ' it was found at')
client.close()

const failed = rows.filter((row) => row.ok !== true)
console.log('  ' + String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
process.exit(failed.length === 0 ? 0 : 1)
