/**
 * User-editable configuration for dsh-browser.
 *
 * Deliberately NOT the harness `settings` service: registering a namespace there
 * needs a schemastery schema, which would make this package depend on an
 * @deepseek-ai internal. Keeping the config in a plain JSON file under the
 * package's own base directory keeps the zero-dependency property, and the
 * sidebar panel edits the same file through the plugin's own RPC.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 })

export function defaultBaseDir() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, '.dsh-browser')
}

export function defaultConfig() {
  return {
    /** Absolute path to chrome.exe / msedge.exe; null = auto-detect, then DSH_BROWSER_EXECUTABLE. */
    browserExecutable: null,
    /** Pinned viewport; screenshot pixels equal CSS pixels at these dimensions. */
    viewport: { ...DEFAULT_VIEWPORT },
    /** Extra Chrome command-line arguments appended to the launch. */
    extraArgs: [],
    /** Keep the browser window visible (false = add --headless=new). */
    visible: true,
    /** Upper bound on controls listed by browser_controls, to bound token cost. */
    maxControls: 150,
  }
}

function coerce(raw) {
  const base = defaultConfig()
  if (raw === null || typeof raw !== 'object') return base
  const viewport = raw.viewport !== null && typeof raw.viewport === 'object' ? raw.viewport : {}
  const width = Number(viewport.width)
  const height = Number(viewport.height)
  const maxControls = Number(raw.maxControls)
  return {
    browserExecutable: typeof raw.browserExecutable === 'string' && raw.browserExecutable.trim() !== '' ? raw.browserExecutable.trim() : null,
    viewport: {
      width: Number.isFinite(width) && width >= 200 ? Math.round(width) : base.viewport.width,
      height: Number.isFinite(height) && height >= 200 ? Math.round(height) : base.viewport.height,
    },
    extraArgs: Array.isArray(raw.extraArgs) ? raw.extraArgs.filter((a) => typeof a === 'string') : [],
    visible: raw.visible === false ? false : true,
    maxControls: Number.isFinite(maxControls) && maxControls > 0 ? Math.round(maxControls) : base.maxControls,
  }
}

export class ConfigStore {
  constructor(baseDir) {
    this.baseDir = baseDir
    this.file = join(baseDir, 'config.json')
    this.cache = null
  }

  ensureDir() {
    mkdirSync(this.baseDir, { recursive: true })
  }

  /** Read config, revalidating from disk only when it changed on disk or was cached never. */
  read() {
    if (this.cache !== null) return this.cache
    let parsed = null
    if (existsSync(this.file)) {
      try {
        parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch {
        parsed = null
      }
    }
    this.cache = coerce(parsed)
    return this.cache
  }

  /** Merge a patch, persist it, and return the effective config. */
  write(patch) {
    const current = this.read()
    const next = coerce({
      ...current,
      ...(patch ?? {}),
      viewport: { ...current.viewport, ...(patch?.viewport ?? {}) },
      extraArgs: patch?.extraArgs ?? current.extraArgs,
    })
    this.ensureDir()
    // Write-then-rename so a crash mid-write cannot leave a truncated config.
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
    this.cache = next
    return next
  }

  /** Forget the cache so the next read picks up an external edit. */
  invalidate() {
    this.cache = null
  }
}
