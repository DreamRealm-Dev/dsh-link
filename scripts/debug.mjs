#!/usr/bin/env node
/**
 * Debug launcher for DSH Link.
 *
 * Two modes:
 *
 *   node scripts/debug.mjs            — full shell: `cargo run` the Tauri app, then
 *                                       follow /__shell/status until the kernel is
 *                                       ready (or failed), printing each phase with
 *                                       timestamps. Closing the window does NOT quit:
 *                                       it hides to the tray and the kernel keeps
 *                                       running. Ctrl+C stops this script, the shell
 *                                       and the kernel child with it; the tray's
 *                                       Quit item is the in-app way out.
 *
 *   node scripts/debug.mjs --kernel   — kernel only: boot `dsh web` exactly the way
 *                                       the supervisor does (same DSH_HOME, overlay,
 *                                       flags) but print the launch URL with its
 *                                       token, so the web client can be opened in a
 *                                       normal browser (`/?token=…` mints the cookie
 *                                       via a 303). Handy for plugin debugging —
 *                                       e.g. watching dsh-opencode-go load — without
 *                                       the Tauri window. Ctrl+C stops the kernel.
 *
 * Both modes reuse scripts/lib/http.mjs on purpose: fetch's keep-alive pool trips
 * Windows exit assertions, which would make the script report failure while
 * succeeding.
 *
 * R73 alive-control: present - launcher form. This script mounts no plugin of its own, so it cannot read a
 * root-provided service from inside a composition; its witness is the kernel's own announcement line, which
 * it *requires* before reporting success (--kernel exits 1 when the child dies before announcing), and the
 * child's exit code, which is how it says the composition is gone. Both verdicts are recorded below as
 * alive-control lines so the witness is a reading rather than a promise.
 */

import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { requestJson } from './lib/http.mjs'

const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHECKOUT = resolve(PROJECT, 'core/deepseek-harness')
const KERNEL_PORT = 31760
const PROXY_ORIGIN = 'http://127.0.0.1:31761'

const stamp = () => new Date().toISOString().slice(11, 23)
const log = (line) => console.log(`[${stamp()}] ${line}`)

/** Poll the shell's status probe until it reaches `ready` or `failed`. */
async function followShellStatus() {
  for (;;) {
    try {
      const { status, text } = await requestJson(`${PROXY_ORIGIN}/__shell/status`, { method: 'GET' })
      if (status === 200) {
        const state = JSON.parse(text)
        log(`phase=${state.phase} pid=${state.pid ?? '—'} version=${state.version ?? '—'}${state.message ? ` message="${state.message}"` : ''}`)
        if (state.phase === 'ready') {
          log(`official client: ${PROXY_ORIGIN}`)
          return 0
        }
        if (state.phase === 'failed') {
          log(`boot log: ${state.log}`)
          return 1
        }
      }
    } catch {
      // The proxy is the thing being polled; before it binds, this is expected.
    }
    await new Promise((wake) => setTimeout(wake, 750))
  }
}

/** Launch the Tauri shell and follow it to readiness. */
async function runShell() {
  const { status, text } = await requestJson(`${PROXY_ORIGIN}/__shell/status`, { method: 'GET' }).catch(() => ({ status: 0, text: '' }))
  if (status === 200 && text.includes('"ready"')) {
    log(`a shell is already running: ${PROXY_ORIGIN}`)
    return 0
  }

  log('launching: cargo run (src-tauri)')
  // The machine's cargo needs the revocation check off (CRYPT_E_REVOCATION_OFFLINE).
  const child = spawn('cargo', ['run'], {
    cwd: resolve(PROJECT, 'src-tauri'),
    env: { ...process.env, CARGO_HTTP_CHECK_REVOKE: 'false' },
    stdio: 'inherit',
  })
  child.on('exit', (code) => log(`cargo run exited with ${code}`))

  const outcome = await followShellStatus()
  log('debug session done — the shell is running; closing the window only hides it to the tray')
  return outcome
}

/** Boot the kernel alone, print the token URL, and keep the process attached. */
async function runKernelOnly() {
  // The same home the shell uses (Tauri app_config_dir + dsh-link), overridable for
  // experimenting against an isolated profile.
  const homeFlag = process.argv.indexOf('--home')
  const homeArg = homeFlag !== -1 ? process.argv[homeFlag + 1] : undefined
  const home = homeArg !== undefined ? resolve(homeArg) : resolve(process.env.APPDATA ?? '', 'dev.dshlink.client/dsh-link/kernel-home')
  if (!homeArg && process.env.APPDATA === undefined) {
    console.error('APPDATA is not set; pass --home <path> to name the kernel home')
    return 1
  }
  log('kernel-only mode boots the same profile the shell supervises')
  log(`DSH_HOME: ${home}`)
  log('launching: node --import tsx/esm apps/cli/src/bin.ts web')

  const child = spawn('node', ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web',
    '--patch', resolve(home, 'dsh-link.patch.yml'),
    '--host', '127.0.0.1', '--port', String(KERNEL_PORT), '--no-open'], {
    cwd: CHECKOUT,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_PERMISSION_MODE: 'danger-full-access',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    stdio: ['inherit', 'pipe', 'inherit'],
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split('\n')) {
      if (line.trim() === '') continue
      console.log(`[kernel] ${line}`)
    }
  })
  // The launcher's aliveness reading: the child's exit is the composition being gone, and the exit code is
  // the only thing this script can attest about *why*. Recorded rather than asserted, so a reader of the log
  // sees the same two instants the wrapper branch below acts on.
  const recordAlive = (event, fields) => {
    console.log('alive-control ' + JSON.stringify({ event, at: Date.now(), ...fields }))
  }
  child.on('exit', (code) => {
    log(`kernel exited with ${code}`)
    recordAlive('disposed', { reason: 'kernel-exited', code: code ?? 1 })
    process.exitCode = code ?? 1
  })

  // Wait for the announcement so the script can hand the user a usable URL, then
  // keep running until the user (or a kernel exit) ends the process.
  const url = await new Promise((found) => {
    let buffer = ''
    const onChunk = (chunk) => {
      buffer += chunk
      const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)
      if (match) {
        child.stdout.off('data', onChunk)
        found(match[0])
      }
    }
    child.stdout.on('data', onChunk)
    child.on('exit', () => found(null))
  })

  if (url === null) {
    // The composition never came up: this is the launcher form of "not alive", and it is the only branch in
    // this script that can tell it apart from "it came up and then went away".
    recordAlive('never-alive', { reason: 'the kernel exited before it announced itself' })
    log('kernel exited before announcing itself; see the [kernel] output above')
    return 1
  }
  recordAlive('alive', { witness: 'the kernel announced its own URL' })
  log(`browser URL (opens the official client, token mints the cookie): ${url}`)
  log('API probing: node scripts/probe-api.mjs '
    + `http://127.0.0.1:${KERNEL_PORT} <token from the URL above>`)
  log('Ctrl+C stops the kernel')
  return undefined
}

const mode = process.argv[2] ?? ''
if (mode === '--kernel') process.exitCode = await runKernelOnly() ?? process.exitCode
else if (mode === '' || mode === '--shell') process.exitCode = await runShell()
else {
  console.error(`usage: node ${relative(process.cwd(), fileURLToPath(import.meta.url))} [--shell|--kernel] [--home <path>]`)
  process.exit(2)
}
