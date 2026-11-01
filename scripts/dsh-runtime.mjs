#!/usr/bin/env node
/**
 * R444 - the runtime instrument: one command answers what the creation-mode "inspect runtime" tool answers for our stack.
 *
 * Why a CLI: that tool is a model-facing tool of the CREATION mode and reaches the live Cordis runtime in-process. PTC
 * sessions only get the tools this program can call, so the same questions had to be re-asked by hand every round
 * (which process, which port, which phase, which plugin rows, which profile, which panel). This script asks them once,
 * from the outside, against the running DSH-LINK stack, and prints one screen (or JSON).
 *
 *   node scripts/dsh-runtime.mjs            # table
 *   node scripts/dsh-runtime.mjs --json     # machine-readable
 *   node scripts/dsh-runtime.mjs --port 31761 --home <kernel-home>
 *
 * Exit 0 the stack was inspected (even if something is down: a down fact is a fact) | 2 the shell did not answer.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(flag('--port', '31761'))
const KERNEL_PORT = Number(flag('--kernel-port', '31760'))
const CDP_PORT = Number(flag('--cdp-port', '9222'))
const HOME = flag('--home', join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home'))
const ORIGIN = 'http://127.0.0.1:' + String(PORT)

const ship = { at: new Date().toISOString(), port: PORT, kernelPort: KERNEL_PORT, home: HOME }

const getJson = async (path) => {
  try {
    const answer = await fetch(ORIGIN + path, { signal: AbortSignal.timeout(4000) })
    return await answer.json().catch(() => null)
  } catch (error) { return null }
}
const postJson = async (path, body) => {
  try {
    const answer = await fetch(ORIGIN + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) })
    return await answer.json().catch(() => null)
  } catch (error) { return null }
}
const listening = (port) => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', 'if (Get-NetTCPConnection -State Listen -LocalPort ' + String(port) + ' -ErrorAction SilentlyContinue) { "up" } else { "down" }'], { encoding: 'utf8', timeout: 20000 })
    return out.trim() === 'up'
  } catch (error) { return false }
}
const processRows = () => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "dsh-link.exe" -or ($_.Name -eq "node.exe" -and $_.CommandLine -like "*kernel-home*") } | ForEach-Object { $_.ProcessId.ToString() + "|" + $_.Name + "|" + ($_.CommandLine -replace "\s+"," ") }'], { encoding: 'utf8', timeout: 30000 })
    return out.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => {
      const [pid, name, cmdline] = line.split('|')
      return { pid: Number(pid), name, cmdline: (cmdline ?? '').slice(0, 120) }
    })
  } catch (error) { return [] }
}
const tailLog = (path, filter, limit) => {
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line !== '')
    const hits = filter === null ? lines : lines.filter((line) => filter.test(line))
    return hits.slice(-limit)
  } catch (error) { return [] }
}

const status = await getJson('/__shell/status')
const bridge = await getJson('/__shell/bridge')
const panel = await postJson('/__shell/panel', { op: 'state' })
const teams = await getJson('/api/dsh-link-teams/state')
const collab = await getJson('/api/dsh-link-collab/status')

const bootLog = join(HOME, 'boot.log')
const profileJson = join(HOME, 'profiles', 'web', 'package.json')
let bundles = []
try { bundles = JSON.parse(readFileSync(profileJson, 'utf8'))?.dsh?.profile?.bundles ?? [] } catch (error) { bundles = [] }
let sessions = 0
try { sessions = readdirSync(join(HOME, 'sessions')).length } catch (error) { sessions = 0 }
let kernelVersion = null
try { kernelVersion = JSON.parse(readFileSync(join(HOME, '..', '..', '..', '..', '..', '..', 'mod', 'mcst', 'package.json'), 'utf8'))?.version ?? null } catch (error) { kernelVersion = null }

ship.processes = processRows()
ship.ports = { [String(PORT)]: listening(PORT), [String(KERNEL_PORT)]: listening(KERNEL_PORT), [String(CDP_PORT)]: listening(CDP_PORT) }
ship.status = status === null ? null : { phase: status.phase, pid: status.pid, version: status.version, message: status.message ?? null }
ship.panel = panel === null ? null : { mounted: panel.mounted, tabs: Array.isArray(panel.tabs) ? panel.tabs.length : 0, live: Array.isArray(panel.tabs) ? panel.tabs.filter((tab) => tab.live === true).length : 0, viewport: panel.viewport ?? null, preset: panel.viewportPreset ?? null, mode: panel.mode ?? null, chromeH: panel.chromeH ?? null, surface: panel.surface !== null && panel.surface !== undefined }
ship.teams = teams === null ? null : { teams: Array.isArray(teams.teams?.teams) ? teams.teams.teams.length : 0, members: Array.isArray(teams.members) ? teams.members.length : 0, tasks: Array.isArray(teams.tasks) ? teams.tasks.length : 0 }
ship.collab = collab === null ? null : { records: collab.ledger?.records ?? null, writer: collab.ledger?.writer ?? null, relay: collab.relay?.bound ?? null }
ship.bridge = bridge === null ? null : { phase: bridge.phase ?? null }

// R472: link-interconnect. Two readings that must agree, plus the pane's one snapshot:
//   contractShell  - through the shell proxy, i.e. the /link/* forwarding rule is installed
//   contractKernel - straight at the kernel port, i.e. the plugin route is mounted
// A contract that answers on only one of them says exactly which half is missing.
const probeContract = async (base) => {
  try {
    const answer = await fetch(base + '/link/v1/contract', { signal: AbortSignal.timeout(4000) })
    const body = await answer.json().catch(() => null)
    return { status: answer.status, protocol: body?.protocol ?? null, caps: Array.isArray(body?.caps) ? body.caps.length : null, routes: Array.isArray(body?.endpoints) ? body.endpoints.length : null }
  } catch (error) { return { status: null, reason: String(error?.name ?? 'unreachable') } }
}
const contractShell = await probeContract(ORIGIN)
const contractKernel = await probeContract('http://127.0.0.1:' + String(KERNEL_PORT))
const linkState = await getJson('/api/dsh-link-interconnect/state')
ship.interconnect = {
  contractShell,
  contractKernel,
  state: linkState === null ? null : {
    linkId: linkState.linkId ?? null,
    peers: linkState.counts?.peers ?? null,
    activePeers: linkState.counts?.activePeers ?? null,
    bindings: linkState.counts?.bindings ?? null,
    activeBindings: linkState.counts?.activeBindings ?? null,
    pendingConsent: linkState.counts?.pendingConsent ?? null,
    adapters: Array.isArray(linkState.adapters) ? linkState.adapters.map((a) => String(a.id) + ':' + (a.detected ? 'detected' : String(a.reasonCode ?? 'absent'))) : null,
  },
}

ship.profile = { bundles, sessions }
ship.boot = {
  ready: tailLog(bootLog, /ready|listening|authenticated/i, 3),
  warnings: tailLog(bootLog, /warn|error|failed|reclaiming|skip/i, 6),
}

if (argv.includes('--json')) {
  console.log(JSON.stringify(ship, null, 2))
} else {
  const yes = (v) => (v === true ? 'up' : 'down')
  console.log('DSH-LINK runtime @ ' + ORIGIN + '  (' + ship.at + ')')
  console.log('  processes : ' + (ship.processes.length === 0 ? 'none' : ship.processes.map((p) => p.name + '#' + String(p.pid)).join(' ')))
  console.log('  ports     : 31761=' + yes(ship.ports[String(PORT)]) + ' 31760=' + yes(ship.ports[String(KERNEL_PORT)]) + ' 9222=' + yes(ship.ports[String(CDP_PORT)]))
  console.log('  kernel    : ' + (status === null ? 'NO ANSWER' : String(status.phase) + (status.message ? ' — ' + String(status.message).split(String.fromCharCode(10))[0] : '')))
  console.log('  profile   : ' + String(bundles.length) + ' bundle(s), ' + String(sessions) + ' session dir(s)')
  console.log('  panel     : ' + (panel === null ? 'n/a' : 'mounted=' + String(panel.mounted) + ' tabs=' + String(ship.panel.tabs) + '/live=' + String(ship.panel.live) + ' viewport=' + JSON.stringify(panel.viewport) + ' preset=' + String(panel.viewportPreset) + ' mode=' + String(panel.mode)))
  console.log('  teams     : ' + (teams === null ? 'n/a' : String(ship.teams.teams) + ' teams / ' + String(ship.teams.members) + ' members / ' + String(ship.teams.tasks) + ' tasks'))
  console.log('  collab    : ' + (collab === null ? 'n/a' : 'records=' + String(ship.collab.records) + ' writer=' + String(ship.collab.writer) + ' relay=' + String(ship.collab.relay)))
  console.log('  bridge    : ' + (bridge === null ? 'n/a' : String(ship.bridge.phase)))
  const contractLine = (probe) => (probe?.status === null ? 'unreachable' : probe?.status === undefined ? 'n/a' : String(probe.status) + (probe.protocol ? ' ' + String(probe.protocol) : '') + (probe.caps === null || probe.caps === undefined ? '' : ' caps=' + String(probe.caps)))
  console.log('  interlink : shell=' + contractLine(ship.interconnect.contractShell) + ' kernel=' + contractLine(ship.interconnect.contractKernel))
  console.log('  linkstate : ' + (ship.interconnect.state === null ? 'n/a (route not mounted)' : 'peers=' + String(ship.interconnect.state.peers) + ' active=' + String(ship.interconnect.state.activePeers) + ' bindings=' + String(ship.interconnect.state.bindings) + ' pending=' + String(ship.interconnect.state.pendingConsent) + ' adapters=' + JSON.stringify(ship.interconnect.state.adapters)))
  if (ship.boot.warnings.length > 0) { for (const line of ship.boot.warnings) console.log('  warn      : ' + line.slice(0, 150)) }
}

process.exit(status === null ? 2 : 0)
