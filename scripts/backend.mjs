#!/usr/bin/env node
/**
 * Debug launcher for the full DSH Link app — window and kernel — with safe
 * console-close shutdown.
 *
 *   node scripts/backend.mjs            — build & run the Tauri shell in THIS console
 *   node scripts/backend.cmd            — same, double-clickable
 *
 * Everything runs attached to this console (nothing is spawned detached): the
 * cargo wrapper, the shell exe, and the kernel child the shell supervises. That
 * makes 叉掉黑框 a safe shutdown in three layers:
 *
 *   1. Windows delivers CTRL_CLOSE_EVENT to every process in the console with a
 *      ~5s budget — the kernel's own shutdown handlers and the shell's exit hook
 *      (stop_all_sync) run on their own;
 *   2. this script's SIGHUP handler adds a bounded fallback: after 3s the whole
 *      tree gets taskkill /T /F, in case any layer missed the event;
 *   3. the single-instance plugin keeps a second launch from ever creating a
 *      second tree (this script also refuses up front when the ports are busy).
 *
 * Ctrl+C works the same way (the kernel child is in a new process group and does
 * NOT receive the console Ctrl+C itself — the SIGBREAK fallback forwards it).
 */

import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const stamp = () => new Date().toISOString().slice(11, 23)
const log = (line) => console.log(`[${stamp()}] ${line}`)

/** Whether something already listens on a port. */
function portOccupied(port) {
  return new Promise((occupied) => {
    const probe = net.connect({ host: '127.0.0.1', port })
    probe.once('connect', () => { probe.destroy(); occupied(true) })
    probe.once('error', () => occupied(false))
    // Not connectable within 500ms reads as free; a live kernel answers instantly.
    setTimeout(() => { probe.destroy(); occupied(false) }, 500)
  })
}

for (const [port, what] of [[31761, '代理/窗口'], [31760, '内核']]) {
  if (await portOccupied(port)) {
    console.error(`端口 ${port} 已被占用（${what}）：本机可能还有另一个 DSH Link 实例或内核在运行，先结束它再启动。`)
    process.exit(1)
  }
}

log('启动 DSH Link 完整应用（cargo run：窗口 + 内核监管）…')
log('关闭本窗口 = 整树安全关闭（内核优雅收尾 + 兜底强杀）；Ctrl+C 同效。')
log('窗口是官方 DSH 客户端；内核故障时会先看到引导/恢复页，终端会同步打印诊断。')

// Not detached: the whole tree shares this console, which is what makes the
// window-close event reach every layer. cargo run (not the exe directly) so a
// debug launch always reflects the current sources.
const app = spawn('cargo', ['run', '--manifest-path', resolve(PROJECT, 'src-tauri/Cargo.toml')], {
  cwd: PROJECT,
  env: { ...process.env, CARGO_HTTP_CHECK_REVOKE: 'false' },
  stdio: 'inherit',
})

let exited = false
let shuttingDown = false

// Keeps this script alive while the app runs even though nothing else refs the
// loop (stdio is inherited, so there are no pipe handles to hold it).
const keepalive = setInterval(() => {}, 1 << 30)

app.on('exit', (code) => {
  exited = true
  clearInterval(keepalive)
  // Best-effort tree sweep: cargo's exit usually means the whole tree is down,
  // but an orphaned grandchild must not outlive the console. (EAC's before-quit
  // 收口: the exit path itself guarantees cleanup.)
  try {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* tree already gone */ }
  log(`应用已退出（code=${code ?? '—'}）`)
  process.exit(code ?? 0)
})

/** Graceful-first teardown: the close event does the real work, this is the net. */
function shutdown() {
  if (shuttingDown || exited) return
  shuttingDown = true
  log('正在安全关闭整棵进程树…')
  try { app.kill('SIGBREAK') } catch { /* already gone */ }
  // Inside the ~5s console-close budget: after three seconds nothing that ignored
  // the event survives — the tree kill takes cargo, the shell, and the kernel.
  setTimeout(() => {
    if (exited) return
    try {
      spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* fall through to the direct kill */ }
    setTimeout(() => {
      if (!exited) { try { app.kill() } catch { /* nothing left to do */ } }
    }, 1500)
  }, 3000)
}

process.on('SIGINT', shutdown)
process.on('SIGBREAK', shutdown)
// Console window closed: every process in the tree got CTRL_CLOSE directly and is
// shutting itself down; this handler only orchestrates the bounded fallback.
process.on('SIGHUP', shutdown)
process.on('exit', () => {
  if (!exited) { try { app.kill() } catch { /* nothing left to do */ } }
})
