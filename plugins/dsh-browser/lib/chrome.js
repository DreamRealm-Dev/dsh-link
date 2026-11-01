/**
 * Chrome discovery, launch, and attach.
 *
 * The plugin runs in the DSH host process, which is NOT the tool sandbox: the
 * file/pipe restrictions that stop a `pwsh` tool call from starting Chrome
 * (Chromium's Mojo IPC needs named pipes) do not apply here. That is the whole
 * reason this capability lives in a host-plane package instead of a script.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const POSIX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function findBrowserExecutable(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    if (!existsSync(explicit)) throw new Error(`browserExecutable does not exist: ${explicit}`)
    return explicit
  }
  for (const candidate of process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  const fromEnv = process.env.DSH_BROWSER_EXECUTABLE
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  throw new Error(
    'no Chrome/Edge executable found; set config.browserExecutable or the DSH_BROWSER_EXECUTABLE environment variable',
  )
}

/** Read `<userDataDir>/DevToolsActivePort` (line 1 = port, line 2 = browser ws path). */
export function readActivePort(userDataDir) {
  const file = join(userDataDir, 'DevToolsActivePort')
  if (!existsSync(file)) return undefined
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const [portLine] = text.split(/\r?\n/)
  const port = Number.parseInt((portLine ?? '').trim(), 10)
  if (!Number.isInteger(port) || port <= 0) return undefined
  return { port, file }
}

async function probePort(port, timeoutMs = 1500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function listTargets(port, timeoutMs = 5000) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`GET /json/list failed with ${response.status}`)
  return await response.json()
}

/**
 * Attach to a live Chrome for this profile, or start one.
 *
 * A leftover `DevToolsActivePort` from a crashed browser is common, so the file
 * is only trusted after `/json/version` answers; otherwise it is removed and a
 * fresh browser is launched (Chrome refuses to reuse a stale port file).
 */
export async function ensureBrowser({
  browserExecutable,
  userDataDir,
  viewport,
  startUrl = 'about:blank',
  extraArgs = [],
  visible = true,
  onSpawn,
} = {}) {
  mkdirSync(userDataDir, { recursive: true })

  const existing = readActivePort(userDataDir)
  if (existing !== undefined && (await probePort(existing.port))) {
    return { port: existing.port, spawned: false }
  }
  if (existing !== undefined) {
    try {
      rmSync(existing.file, { force: true })
    } catch {
      /* ignore */
    }
  }

  const executable = findBrowserExecutable(browserExecutable)
  const width = Number.isFinite(viewport?.width) ? viewport.width : 1280
  const height = Number.isFinite(viewport?.height) ? viewport.height : 800

  const args = [
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-features=Translate,MediaRouter,AcceptCHFrame',
    // Pin device pixels to CSS pixels so screenshot pixels map 1:1 onto the
    // click coordinates the model reads off the image.
    '--force-device-scale-factor=1',
    '--window-position=0,0',
    // Outer window is the viewport plus room for the tab strip and title bar.
    `--window-size=${width + 16},${height + 120}`,
    ...(visible === false ? ['--headless=new'] : []),
    ...extraArgs,
    startUrl,
  ]

  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  onSpawn?.(child)

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    await sleep(250)
    const active = readActivePort(userDataDir)
    if (active === undefined) continue
    if (await probePort(active.port)) return { port: active.port, spawned: true, pid: child.pid }
  }
  throw new Error(`browser did not expose a DevTools port within 30s (executable: ${executable})`)
}

/** Pick the page target to drive, creating one only when the browser has none. */
export async function resolvePageTarget(port) {
  const targets = await listTargets(port)
  const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
  if (pages.length > 0) {
    const preferred = pages.find((t) => t.url !== 'about:blank') ?? pages[0]
    return preferred
  }
  // Chrome >= 111 requires PUT for /json/new.
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  if (!response.ok) throw new Error(`no page target and PUT /json/new failed with ${response.status}`)
  return await response.json()
}
