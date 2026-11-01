#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it reads an emulator/adb/SDK environment and explicitly launches nothing (header line 20: no package install, no emulator launch, no window input), so no DSH tree exists for it to sample
/**
 * Probe the Android / MuMu emulator environment the DSH-Link mobile line depends on.
 *
 * The phone build stands on four things that live outside this repository, so none of
 * them can be pinned by a lockfile: a running MuMu emulator, an adb that can actually
 * talk to it, an Android SDK with an NDK the Rust linker can use, and the Rust android
 * targets. This probe reads all of them in one command and prints a PASS/FAIL line per
 * fact, so a later round can re-run it instead of re-deriving the environment by hand.
 *
 * Two deliberate design choices:
 *
 *  1. adb is resolved once and every call goes through that single binary. The SDK ships
 *     adb 37.0.1 while the MuMu bundle ships 36.0.0, and an adb *client* kills a running
 *     adb *server* whose version differs. Mixing the two mid-probe restarts the daemon
 *     between calls, which makes a healthy device read as "device not found". That was
 *     hit for real while writing this, so the probe stays on one binary and only reports
 *     the others without invoking them.
 *  2. "adb root" (which restarts adbd) is skipped under --no-root. Nothing else here
 *     mutates the emulator: no package install, no emulator launch, no window input.
 *
 * Exit code 0 means the probe finished, not that every check passed - the environment is
 * allowed to be incomplete, and a probe that cannot run at all is the only real failure.
 * Use --strict to turn any FAIL line into exit code 1.
 *
 * Usage:
 *   node scripts/probe-android-env.mjs [--adb <path>] [--sdk <path>] [--serial <id>]
 *                                      [--no-root] [--strict] [--json]
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { argv } from 'node:process'

import { report } from './lib/http.mjs'

// ---------------------------------------------------------------- arguments

const parseArgs = (raw) => {
  const options = { adb: null, sdk: null, serial: null, root: true, strict: false, json: false }
  for (let i = 0; i < raw.length; i += 1) {
    const flag = raw[i]
    if (flag === '--adb') options.adb = raw[++i]
    else if (flag === '--sdk') options.sdk = raw[++i]
    else if (flag === '--serial') options.serial = raw[++i]
    else if (flag === '--no-root') options.root = false
    else if (flag === '--strict') options.strict = true
    else if (flag === '--json') options.json = true
    else throw new Error('unknown argument: ' + flag)
  }
  return options
}

const options = parseArgs(argv.slice(2))

// ------------------------------------------------------------------ helpers

let failures = 0
const check = (name, ok, detail) => {
  if (!report(name, ok, detail)) failures += 1
}

const log = (line = '') => process.stdout.write(line + '\n')
const section = (title) => log('\n== ' + title + ' ==')

/** Sleep without a dependency and without awaiting. */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Run one command and capture it.
 *
 * @param {string} command - executable to run.
 * @param {string[]} args - argv tail.
 * @param {object} [runOptions] - timeout in ms and cwd.
 * @returns {object} status, stdout, stderr, error, ok.
 */
const run = (command, args, runOptions = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: runOptions.timeout ?? 30000,
    cwd: runOptions.cwd,
    maxBuffer: 8 * 1024 * 1024,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  return {
    status: result.status ?? -1,
    stdout,
    stderr,
    error: result.error ? result.error.message : null,
    ok: !result.error && result.status === 0,
  }
}

/**
 * Run one PowerShell snippet, preferring pwsh over Windows PowerShell.
 *
 * Only two host facts need it - the process list with executable paths and the
 * uninstall registry - because neither is reachable from node:fs. A failure is
 * reported, never fatal.
 *
 * @param {string} script - PowerShell source.
 * @param {number} [timeout] - ms.
 * @returns {object} command result plus the shell that answered.
 */
const powershell = (script, timeout = 40000) => {
  // Node decodes the pipe as UTF-8 while PowerShell writes the console codepage, so a
  // CJK display name arrives mangled unless the console encoding is forced first.
  const preamble = "try { [Console]::OutputEncoding=[Text.Encoding]::UTF8 } catch { }; "
  let last = null
  for (const shell of ['pwsh', 'powershell']) {
    const result = run(shell, ['-NoProfile', '-NonInteractive', '-Command', preamble + script], { timeout })
    if (result.error && result.stdout === '') {
      last = result
      continue
    }
    return Object.assign(result, { shell })
  }
  return Object.assign(last ?? {}, { shell: null })
}

const exists = (target) => {
  if (!target) return false
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

const listDir = (target) => {
  try {
    return fs.readdirSync(target).sort()
  } catch {
    return null
  }
}

const isDir = (target) => {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

/** Canonical form for paths, so 'Q:/MuMu' and 'Q:\\MuMu' are one root, not two. */
const canonical = (target) => path.resolve(target)

// ------------------------------------------------------------ host baseline

log('DSH-Link - Android / MuMu environment probe')
log('host: ' + process.platform + ' ' + process.arch + ', node ' + process.version)
log('exit code 0 means the probe finished; read the PASS/FAIL lines for the verdict')

section('Host')
check('host.platform', process.platform === 'win32', process.platform + ' ' + process.arch)
check('host.node', Number(process.versions.node.split('.')[0]) >= 22, 'node ' + process.version)

const processResult = powershell(
  "$ErrorActionPreference='SilentlyContinue'; " +
    "Get-Process | Where-Object { $_.ProcessName -match 'MuMu|Nemu' } | " +
    "ForEach-Object { $_.ProcessName + '|' + $_.Id + '|' + $_.Path }",
)
const muMuProcesses = lines(processResult.stdout)
  .filter((line) => line.split('|').length >= 2)
  .map((line) => {
    const [name, pid, exe] = line.split('|')
    return { name, pid: Number(pid), exe: exe || null }
  })

const uninstallResult = powershell(
  "$ErrorActionPreference='SilentlyContinue'; " +
    "$paths=@('HKLM:/SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall/*'," +
    "'HKLM:/SOFTWARE/WOW6432Node/Microsoft/Windows/CurrentVersion/Uninstall/*'," +
    "'HKCU:/SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall/*'); " +
    "Get-ItemProperty $paths | Where-Object { $_.DisplayName -match 'MuMu|Netease' } | " +
    "ForEach-Object { $_.DisplayName + '|' + $_.DisplayVersion + '|' + $_.InstallLocation }",
)
const installed = lines(uninstallResult.stdout)
  .filter((line) => line.includes('|'))
  .map((line) => {
    const [displayName, displayVersion, installLocation] = line.split('|')
    return { displayName, displayVersion, installLocation: installLocation || null }
  })

// ------------------------------------------------------------- MuMu emulator

section('MuMu emulator')

/** A directory is a MuMu install root when it owns the two engine trees. */
const looksLikeMuMuRoot = (dir) =>
  isDir(path.join(dir, 'nx_main')) || isDir(path.join(dir, 'nx_device'))

/** Walk up from a known executable path until a MuMu root shows up. */
const muMuRootFrom = (start) => {
  let dir = start
  for (let depth = 0; depth < 4; depth += 1) {
    if (looksLikeMuMuRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Collect every plausible install root: the common install locations first, then a
 * drive-root sweep for MuMu* directories, then the uninstall registry, then the
 * executable paths of any running engine process.
 */
const discoverMuMu = () => {
  const searched = [
    'Q:/MuMu',
    'C:/Program Files/Netease/MuMuPlayer-12.0',
    'C:/Program Files/Netease/MuMuPlayer',
    'C:/Program Files/Netease/MuMuPlayer-12.0/nx_device',
    'C:/Program Files/MuMuPlayer',
    'C:/Program Files (x86)/Netease/MuMuPlayer',
    'C:/Program Files/Netease',
    'C:/Program Files (x86)/Netease',
    'D:/MuMuPlayer',
    'D:/MuMu',
    'D:/Program Files/Netease/MuMuPlayer-12.0',
    'E:/MuMuPlayer',
    'H:/MuMu',
  ]
  const roots = new Set()

  for (const candidate of searched) {
    if (!exists(candidate)) continue
    if (looksLikeMuMuRoot(candidate)) roots.add(canonical(candidate))
    if (path.basename(candidate) === 'Netease') {
      for (const child of listDir(candidate) ?? []) {
        const childPath = path.join(candidate, child)
        if (looksLikeMuMuRoot(childPath)) roots.add(canonical(childPath))
      }
    }
  }

  const drives = []
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const drive = String.fromCharCode(code) + ':/'
    if (exists(drive)) drives.push(drive)
  }
  for (const drive of drives) {
    for (const entry of listDir(drive) ?? []) {
      if (/^MuMu/i.test(entry) && looksLikeMuMuRoot(path.join(drive, entry))) {
        roots.add(canonical(path.join(drive, entry)))
      }
    }
    for (const programFiles of ['Program Files', 'Program Files (x86)']) {
      const base = path.join(drive, programFiles)
      if (!isDir(base)) continue
      searched.push(base)
      for (const entry of listDir(base) ?? []) {
        if (!/^(MuMu|Netease)/i.test(entry)) continue
        const candidate = path.join(base, entry)
        if (looksLikeMuMuRoot(candidate)) roots.add(canonical(candidate))
        if (entry === 'Netease') {
          for (const child of listDir(candidate) ?? []) {
            const childPath = path.join(candidate, child)
            if (looksLikeMuMuRoot(childPath)) roots.add(canonical(childPath))
          }
        }
      }
    }
  }

  const fromRegistry = []
  for (const item of installed) {
    if (!item.installLocation || !exists(item.installLocation)) continue
    if (looksLikeMuMuRoot(item.installLocation)) {
      fromRegistry.push(canonical(item.installLocation))
      roots.add(canonical(item.installLocation))
      continue
    }
    // The uninstall entry often points at a parent that holds no engine tree.
    for (const child of listDir(item.installLocation) ?? []) {
      const childPath = path.join(item.installLocation, child)
      if (looksLikeMuMuRoot(childPath)) {
        fromRegistry.push(canonical(childPath))
        roots.add(canonical(childPath))
      }
    }
  }

  const fromProcess = []
  for (const engineProcess of muMuProcesses) {
    if (!engineProcess.exe) continue
    const root = muMuRootFrom(path.dirname(engineProcess.exe))
    if (root) {
      fromProcess.push(canonical(root))
      roots.add(canonical(root))
    }
  }

  return {
    roots: [...roots].sort(),
    searched: [...new Set(searched)],
    fromRegistry: [...new Set(fromRegistry)],
    fromProcess: [...new Set(fromProcess)],
  }
}

const muMu = discoverMuMu()
const muMuRoot = muMu.roots[0] ?? null

if (muMuRoot) {
  check('mumu.install-root', true, muMu.roots.join(', '))
  log(
    'INFO  mumu.discovery - ' +
      muMu.searched.length +
      ' directories searched; roots from registry: ' +
      (muMu.fromRegistry.join(', ') || 'none') +
      '; from running processes: ' +
      (muMu.fromProcess.join(', ') || 'none'),
  )
} else {
  const version = installed.map((item) => item.displayName + ' ' + item.displayVersion).join(', ')
  check(
    'mumu.install-root',
    false,
    'unavailable: no install root found under any searched entry (' +
      muMu.searched.length +
      ' directories tested' +
      (version ? '; uninstall registry lists: ' + version : '; uninstall registry lists nothing MuMu-like') +
      ')',
  )
}

if (muMu.roots.length > 1) log('INFO  mumu.multiple-roots - ' + muMu.roots.length + ' roots: ' + muMu.roots.join(', '))

const deviceTree = muMuRoot ? path.join(muMuRoot, 'nx_device') : null

if (muMuRoot) {
  const launcher = [
    'nx_main/MuMuNxMain.exe',
    'MuMuPlayer.exe',
    'nx_main/MuMuNxDevice.exe',
    'nx_device/15.0/shell/NemuShell.exe',
  ]
    .map((relative) => path.join(muMuRoot, relative))
    .find((candidate) => exists(candidate))
  check('mumu.launcher', Boolean(launcher), launcher ?? 'unavailable: no launcher executable under ' + muMuRoot)

  const runningNames = [...new Set(muMuProcesses.map((entry) => entry.name))]
  const main = muMuProcesses.find((entry) => entry.name === 'MuMuNxMain')
  const vm = muMuProcesses.find((entry) => /MuMuNxDevice|Nemu/.test(entry.name))
  check(
    'mumu.running',
    Boolean(main),
    main
      ? 'MuMuNxMain.exe pid=' + main.pid + ' - ' + runningNames.length + ' engine processes: ' + runningNames.join(', ')
      : 'not running: no MuMuNxMain.exe; engine process names seen: ' + (runningNames.join(', ') || 'none'),
  )
  check(
    'mumu.vm-up',
    Boolean(vm),
    vm ? vm.name + ' pid=' + vm.pid : 'not running: no MuMuNxDevice/Nemu process, so no guest VM is up',
  )

  const engines = (listDir(deviceTree) ?? []).filter((entry) => /^[0-9]+[.][0-9]+$/.test(entry))
  check(
    'mumu.engines',
    engines.length > 0,
    engines.length
      ? 'nx_device engines: ' + engines.join(', ') + '; vms: ' + ((listDir(path.join(muMuRoot, 'vms')) ?? []).join(', ') || 'none')
      : 'unavailable: no numbered engine directory under ' + deviceTree,
  )
} else {
  check('mumu.launcher', false, 'unavailable: no MuMu install root to inspect')
  check('mumu.running', false, 'unavailable: no MuMu install root; the process scan found no MuMuNxMain.exe')
  check('mumu.vm-up', false, 'unavailable: no MuMu install root to inspect')
  check('mumu.engines', false, 'unavailable: no MuMu install root to inspect')
}

// --------------------------------------------------------------------- adb

section('adb')

/** PATH lookup without a shell, so no quoting surprises on Windows. */
const adbOnPath = () => {
  for (const entry of (process.env.PATH ?? '').split(';')) {
    if (!entry) continue
    for (const name of ['adb.exe', 'adb.cmd', 'adb.bat', 'adb']) {
      const candidate = path.join(entry, name)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

const sdkCandidates = [
  options.sdk,
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  '<android-sdk>',
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  'C:/Android/Sdk',
].filter(Boolean)

const sdkRoot =
  sdkCandidates.find((candidate) => exists(path.join(candidate, 'platform-tools', 'adb.exe'))) ??
  sdkCandidates.find((candidate) => isDir(candidate)) ??
  null

const muMuAdbBinaries = []
if (muMuRoot) {
  for (const relative of ['nx_main/adb.exe', 'nx_device/15.0/shell/adb.exe', 'nx_device/12.0/shell/adb.exe']) {
    const candidate = path.join(muMuRoot, relative)
    if (exists(candidate)) muMuAdbBinaries.push(candidate)
  }
}

const adbCandidates = [
  options.adb,
  sdkRoot ? path.join(sdkRoot, 'platform-tools', 'adb.exe') : null,
  ...muMuAdbBinaries,
  adbOnPath(),
].filter(Boolean)

const adb = adbCandidates.find((candidate) => exists(candidate)) ?? null
const otherAdb = [...new Set(adbCandidates)].filter((candidate) => candidate !== adb)

if (!adb) {
  check(
    'adb.binary',
    false,
    'unavailable: no adb executable among ' +
      (adbCandidates.length ? adbCandidates.join(', ') : 'the candidates (ANDROID_HOME unset, no SDK, no PATH entry)'),
  )
} else {
  const version = run(adb, ['version'])
  const banner = lines(version.stdout || version.stderr)
  const versionLine = banner.find((line) => line.startsWith('Version ')) ?? banner[0] ?? 'no output'
  check('adb.binary', version.ok, adb + ' - ' + versionLine)
  if (otherAdb.length) {
    log(
      'INFO  adb.other-binaries - ' +
        otherAdb.length +
        ' further adb executable(s) present but NOT invoked, because an adb client of a different version kills the running adb server: ' +
        otherAdb.join(', '),
    )
  }
}

/** Parse "adb devices -l" into serial / state / props. */
const parseDevices = (text) =>
  text
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/)
      const props = {}
      for (const token of rest) {
        const separator = token.indexOf(':')
        if (separator > 0) props[token.slice(0, separator)] = token.slice(separator + 1)
      }
      return { serial, state, props }
    })

let device = null
if (adb) {
  const listDevices = () => parseDevices(run(adb, ['devices', '-l']).stdout)
  let devices = listDevices()
  let waited = 0
  while (!devices.some((entry) => entry.state === 'device') && waited < 6000) {
    sleep(2000)
    waited += 2000
    devices = listDevices()
  }

  if (!devices.some((entry) => entry.state === 'device') && !options.serial) {
    // MuMu also serves the guest on a loopback endpoint beside the emulator console.
    for (const endpoint of ['127.0.0.1:7555', '127.0.0.1:16384']) {
      run(adb, ['connect', endpoint], { timeout: 15000 })
      devices = listDevices()
      if (devices.some((entry) => entry.state === 'device')) break
      run(adb, ['disconnect', endpoint], { timeout: 15000 })
    }
  }

  device = options.serial
    ? devices.find((entry) => entry.serial === options.serial) ?? null
    : devices.find((entry) => entry.state === 'device') ??
      devices.find((entry) => entry.state === 'offline') ??
      null

  const rendered = devices.length
    ? devices
        .map((entry) => entry.serial + '(' + entry.state + (entry.props.model ? ', ' + entry.props.model : '') + ')')
        .join(', ')
    : 'no device entries at all'
  check(
    'device.attached',
    Boolean(device) && device.state === 'device',
    device
      ? device.serial +
          ' is ' +
          device.state +
          (device.state === 'device' ? '' : ' (never reached the online state)') +
          '; all entries: ' +
          rendered
      : 'unavailable: no online device; all entries: ' + rendered,
  )
}

// ------------------------------------------------------------ device details

section('Device facts')

const PROP_KEYS = [
  'ro.product.model',
  'ro.product.brand',
  'ro.product.manufacturer',
  'ro.build.version.sdk',
  'ro.build.version.release',
  'ro.product.cpu.abi',
  'ro.product.cpu.abilist',
  'ro.build.version.incremental',
  'ro.build.fingerprint',
  'ro.build.type',
  'ro.debuggable',
  'ro.secure',
]

/** Read one "[key]: [value]" line out of a getprop dump without a regex. */
const getProp = (dump, key) => {
  const marker = '[' + key + ']: ['
  const at = dump.indexOf(marker)
  if (at === -1) return null
  const end = dump.indexOf(']', at + marker.length)
  return end === -1 ? null : dump.slice(at + marker.length, end).trim()
}

const facts = {
  serial: device?.serial ?? null,
  model: null,
  brand: null,
  manufacturer: null,
  sdk: null,
  release: null,
  abi: null,
  abilist: null,
  incremental: null,
  fingerprint: null,
  buildType: null,
  debuggable: null,
  secure: null,
  root: null,
  rootMethod: null,
  su: null,
}

if (adb && device && device.state === 'device') {
  const target = ['-s', device.serial]
  const dump = run(adb, [...target, 'shell', 'getprop']).stdout
  const prop = (key) => getProp(dump, key)
  facts.model = prop('ro.product.model')
  facts.brand = prop('ro.product.brand')
  facts.manufacturer = prop('ro.product.manufacturer')
  facts.sdk = prop('ro.build.version.sdk')
  facts.release = prop('ro.build.version.release')
  facts.abi = prop('ro.product.cpu.abi')
  facts.abilist = prop('ro.product.cpu.abilist')
  facts.incremental = prop('ro.build.version.incremental')
  facts.fingerprint = prop('ro.build.fingerprint')
  facts.buildType = prop('ro.build.type')
  facts.debuggable = prop('ro.debuggable')
  facts.secure = prop('ro.secure')

  const unreadable = PROP_KEYS.filter((key) => !prop(key))
  check(
    'device.getprop',
    unreadable.length === 0,
    'model=' + (facts.model ?? '?') +
      ' brand=' + (facts.brand ?? '?') +
      ' sdk=' + (facts.sdk ?? '?') +
      ' release=' + (facts.release ?? '?') +
      ' abi=' + (facts.abi ?? '?') +
      ' abilist=' + (facts.abilist ?? '?') +
      ' type=' + (facts.buildType ?? '?') +
      ' debuggable=' + (facts.debuggable ?? '?') +
      ' secure=' + (facts.secure ?? '?') +
      ' fingerprint=' + (facts.fingerprint ?? '?') +
      (unreadable.length ? ' - unreadable: ' + unreadable.join(', ') : ''),
  )

  const identity = run(adb, [...target, 'shell', 'id'])
  let idLine = identity.stdout || identity.stderr
  facts.root = /uid=0[(]root[)]/.test(idLine)
  if (facts.root) {
    // adbd can already be root because an earlier run escalated it, and MuMu keeps that
    // until the VM restarts. Ask adbd itself, so the recorded evidence is the capability
    // rather than this session's leftover state.
    const confirm = run(adb, [...target, 'root'])
    const confirmOutput = lines(confirm.stdout || confirm.stderr).pop() ?? 'no output'
    facts.rootMethod = 'adbd already root on arrival (' + confirmOutput + ')'
    log('INFO  device.root-inherited - adbd was already root when the probe started; "adb root" reports: ' + confirmOutput)
  }

  const suProbe = run(adb, [...target, 'shell', 'su', '-c', 'id'])
  const suOutput = (suProbe.stdout || suProbe.stderr).trim()
  facts.su = /uid=0[(]root[)]/.test(suOutput)
  if (facts.su && !facts.root) {
    facts.root = true
    facts.rootMethod = 'su -c id'
  }

  if (!facts.root && options.root) {
    const escalate = run(adb, [...target, 'root'])
    const escalateOutput = lines(escalate.stdout || escalate.stderr).pop() ?? 'no output'
    run(adb, [...target, 'wait-for-device'])
    sleep(2000)
    const after = run(adb, [...target, 'shell', 'id'])
    idLine = after.stdout || after.stderr
    if (/uid=0[(]root[)]/.test(idLine)) {
      facts.root = true
      facts.rootMethod = 'adb root (' + escalateOutput + ')'
    } else {
      facts.root = false
      facts.rootMethod = 'adb root did not escalate: ' + escalateOutput
    }
  }

  const suReason = suOutput.includes('not found') || suOutput.includes('inaccessible')
    ? 'not installed on this image'
    : suOutput || 'no output'
  check(
    'device.root',
    facts.root === true,
    facts.root
      ? 'root available - ' + facts.rootMethod + '; shell id: ' + idLine.replace(/\s+/g, ' ').slice(0, 110)
      : 'unavailable: no root - ' +
          (facts.rootMethod ?? 'no method worked') +
          '; su: ' +
          suReason +
          (options.root ? '' : ' (escalation skipped by --no-root)'),
  )
} else {
  check('device.getprop', false, 'unavailable: no online device to read getprop from')
  check('device.root', false, 'unavailable: no online device to test root on')
}

// ------------------------------------------------------------- Android SDK

section('Android SDK')

if (sdkRoot) {
  check('sdk.root', true, sdkRoot + ' (adb taken from: ' + (adb ?? 'none') + ')')

  const ndkVersions = listDir(path.join(sdkRoot, 'ndk')) ?? []
  check(
    'sdk.ndk',
    ndkVersions.length > 0,
    ndkVersions.length ? 'ndk: ' + ndkVersions.join(', ') : 'unavailable: nothing under ' + path.join(sdkRoot, 'ndk'),
  )

  const platforms = listDir(path.join(sdkRoot, 'platforms')) ?? []
  check(
    'sdk.platforms',
    platforms.length > 0,
    platforms.length ? 'platforms: ' + platforms.join(', ') : 'unavailable: nothing under ' + path.join(sdkRoot, 'platforms'),
  )

  const buildTools = listDir(path.join(sdkRoot, 'build-tools')) ?? []
  check(
    'sdk.build-tools',
    buildTools.length > 0,
    buildTools.length ? 'build-tools: ' + buildTools.join(', ') : 'unavailable: nothing under ' + path.join(sdkRoot, 'build-tools'),
  )

  const cmake = listDir(path.join(sdkRoot, 'cmake')) ?? []
  check(
    'sdk.cmake',
    cmake.length > 0,
    cmake.length ? 'cmake: ' + cmake.join(', ') : 'unavailable: nothing under ' + path.join(sdkRoot, 'cmake'),
  )

  const cmdlineRoot = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin')
  const cmdline = listDir(cmdlineRoot) ?? []
  check(
    'sdk.cmdline-tools',
    cmdline.some((entry) => entry.startsWith('sdkmanager.')),
    cmdline.length ? cmdlineRoot + ': ' + cmdline.join(', ') : 'unavailable: ' + cmdlineRoot + ' missing or empty',
  )

  const emulatorExe = path.join(sdkRoot, 'emulator', 'emulator.exe')
  log(
    'INFO  sdk.avd-emulator - ' +
      (exists(emulatorExe)
        ? emulatorExe + ' present'
        : 'unavailable: no ' + emulatorExe + '; MuMu is the emulator here, so no AVD is installed'),
  )

  const ndkVersion = ndkVersions[0]
  if (ndkVersion) {
    const toolchain = path.join(sdkRoot, 'ndk', ndkVersion, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin')
    const clang = (listDir(toolchain) ?? []).filter((entry) => /^(aarch64|armv7a|x86_64|i686)-linux-android/.test(entry))
    check(
      'sdk.ndk-toolchain',
      clang.length > 0,
      clang.length
        ? clang.length + ' android clang wrappers in ' + toolchain + ' (e.g. ' + clang.slice(0, 3).join(', ') + ')'
        : 'unavailable: no android clang wrapper under ' + toolchain,
    )
  } else {
    check('sdk.ndk-toolchain', false, 'unavailable: no NDK installed to inspect')
  }
} else {
  check(
    'sdk.root',
    false,
    'unavailable: no Android SDK - tested ' + (sdkCandidates.join(', ') || 'no candidate at all'),
  )
  for (const name of ['sdk.ndk', 'sdk.platforms', 'sdk.build-tools', 'sdk.cmake', 'sdk.cmdline-tools', 'sdk.ndk-toolchain']) {
    check(name, false, 'unavailable: no Android SDK root resolved')
  }
}

const missingEnv = ['ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT'].filter(
  (name) => !process.env[name],
)
check(
  'sdk.env-vars',
  missingEnv.length === 0,
  missingEnv.length === 0
    ? 'ANDROID_HOME, ANDROID_SDK_ROOT, ANDROID_NDK_HOME, ANDROID_NDK_ROOT are all set'
    : 'unset: ' +
        missingEnv.join(', ') +
        ' - the SDK was found by path, not by environment; the gradle/tauri android build reads these, so export them or pass them per command',
)

// ------------------------------------------------------------ Rust toolchain

section('Rust / android targets')

const rustc = run('rustc', ['-V'])
const cargo = run('cargo', ['-V'])
const rustup = run('rustup', ['-V'])
check(
  'rust.toolchain',
  rustc.ok && cargo.ok,
  rustc.ok && cargo.ok
    ? rustc.stdout + ' / ' + cargo.stdout + ' / ' + (lines(rustup.stdout)[0] ?? 'rustup ?')
    : 'unavailable: rustc=' + (rustc.error ?? rustc.stderr ?? '?') + ' cargo=' + (cargo.error ?? cargo.stderr ?? '?'),
)

const ANDROID_TARGETS = [
  'aarch64-linux-android',
  'armv7-linux-androideabi',
  'i686-linux-android',
  'x86_64-linux-android',
]

const installedTargets = rustup.ok ? run('rustup', ['target', 'list', '--installed']) : null
if (installedTargets && installedTargets.ok) {
  const targets = lines(installedTargets.stdout)
  const missingTargets = ANDROID_TARGETS.filter((target) => !targets.includes(target))
  check(
    'rust.android-targets',
    missingTargets.length === 0,
    missingTargets.length === 0
      ? 'all 4 android targets installed (' + ANDROID_TARGETS.join(', ') + '); ' + targets.length + ' targets total'
      : 'missing: ' +
          missingTargets.join(', ') +
          ' - android targets present: ' +
          (targets.filter((target) => target.includes('android')).join(', ') || 'none'),
  )
} else {
  check('rust.android-targets', false, 'unavailable: rustup target list --installed failed (' + (installedTargets?.error ?? 'rustup missing') + ')')
}

const cargoNdk = run('cargo', ['ndk', '--version'], { timeout: 20000 })
log(
  'INFO  rust.cargo-ndk - ' +
    (cargoNdk.ok
      ? cargoNdk.stdout
      : 'unavailable: cargo-ndk not installed (Tauri v2 does not need it; the generated gradle project drives the NDK linker)'),
)

// ------------------------------------------------------- Tauri android side

section('Tauri android build chain')

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1')), '..')
const cliPackage = path.join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'package.json')
if (exists(cliPackage)) {
  const cli = JSON.parse(fs.readFileSync(cliPackage, 'utf8'))
  const platformPackage = path.join(
    projectRoot,
    'node_modules',
    '@tauri-apps',
    'cli-' + process.platform + '-' + process.arch + '-msvc',
  )
  check(
    'tauri.cli-npm',
    true,
    '@tauri-apps/cli ' +
      cli.version +
      ' - ' +
      (exists(platformPackage)
        ? 'native binding present (' + path.basename(platformPackage) + ')'
        : 'native binding MISSING (' + path.basename(platformPackage) + ')') +
      '; invoke it as "npm run tauri -- android <cmd>"',
  )
} else {
  check('tauri.cli-npm', false, 'unavailable: ' + cliPackage + ' missing - run npm install first')
}

const cargoTauri = run('cargo', ['tauri', '-V'])
log(
  'INFO  tauri.cli-cargo - ' +
    (cargoTauri.ok
      ? cargoTauri.stdout
      : 'unavailable: no cargo-tauri on PATH; the npm CLI above is the usable entry point'),
)

const androidProject = path.join(projectRoot, 'src-tauri', 'gen', 'android')
check(
  'tauri.android-project',
  isDir(androidProject),
  isDir(androidProject)
    ? androidProject + ' exists: ' + ((listDir(androidProject) ?? []).slice(0, 8).join(', ') || 'empty')
    : 'not generated yet: ' + androidProject + ' is missing - the first mobile build runs "tauri android init"',
)

const confPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json')
if (exists(confPath)) {
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'))
  check(
    'tauri.config',
    true,
    'identifier=' +
      conf.identifier +
      ' productName=' +
      (conf.productName ?? '?') +
      ' bundleTargets=' +
      (conf.bundle?.targets === 'all' ? 'all (covers the mobile apk/aab)' : JSON.stringify(conf.bundle?.targets ?? null)),
  )
} else {
  check('tauri.config', false, 'unavailable: ' + confPath + ' missing')
}

const javaHome = process.env.JAVA_HOME ?? null
const java = javaHome ? run(path.join(javaHome, 'bin', 'java.exe'), ['-version'], { timeout: 20000 }) : null
const javaLines = java ? lines(java.stderr || java.stdout) : []
check(
  'jdk.java',
  Boolean(java && java.ok),
  javaHome
    ? java && java.ok
      ? 'JAVA_HOME=' + javaHome + ' - ' + (javaLines.find((line) => line.includes('version')) ?? javaLines[0] ?? 'no output')
      : 'JAVA_HOME=' + javaHome + ' but java did not run: ' + (java?.error ?? javaLines[0] ?? 'no output')
    : 'unavailable: JAVA_HOME unset - gradle needs a JDK for the android build',
)

// ------------------------------------------------------------------ summary

section('Summary')
log(
  failures === 0
    ? 'every check passed'
    : failures + ' check(s) FAILED - each FAIL line above names the value or the reason it is unavailable',
)
log('exit code 0 = the probe completed (it does NOT mean everything is usable); --strict turns any FAIL into exit 1')

if (options.json) {
  log(
    'JSON ' +
      JSON.stringify({
        host: { platform: process.platform, arch: process.arch, node: process.version },
        mumu: { roots: muMu.roots, searched: muMu.searched, registry: installed, processes: muMuProcesses },
        adb: { chosen: adb, others: otherAdb, sdkRoot },
        device: facts,
        rust: {
          rustc: rustc.stdout || rustc.stderr,
          cargo: cargo.stdout || cargo.stderr,
          androidTargets: installedTargets?.ok
            ? lines(installedTargets.stdout).filter((line) => line.includes('android'))
            : null,
        },
        failures,
      }),
  )
}

process.exit(options.strict && failures > 0 ? 1 : 0)
