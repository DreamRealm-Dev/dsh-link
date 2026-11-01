/**
 * dsh-browser — Host-plane Cordis plugin.
 *
 * ## Why this plane
 *
 * The tools registry is layered: `schemas(scope)` merges every inherited layer
 * and keeps each tool whose layers all `admits()` it, then adds the scope's own
 * registrations (see @deepseek-ai/dsh-tools `view()`). A row mounted in the HOST
 * composition therefore registers into the root layer, every agent scope
 * inherits it, and the capability is available to every conversation without
 * touching — or copying — any agent preset.
 *
 * ## Why it can start a browser at all
 *
 * The plugin runs inside the DSH host process, which is not the tool sandbox.
 * Chromium's Mojo IPC needs named pipes, which the sandbox denies, so a `pwsh`
 * tool call cannot start Chrome; a host-plane package can. That is the whole
 * reason this is a package and not a script.
 *
 * ## Instances
 *
 * `BrowserRegistry` owns every open browser. The model tools and the sidebar
 * panel both address it, so "which browsers are open" has exactly one answer no
 * matter which side opened or closed one, and either side can recycle the other's.
 */
import { ConfigStore, defaultBaseDir } from './config.js'
import { BrowserRegistry } from './registry.js'
import { BROWSER_TOOL_NAMES, defineBrowserTools } from './tools.js'
import { log as rootLog } from './log.js'
import { registerPanelRpc } from './rpc.js'

export const name = 'dsh-browser'

/** No hard dependencies: `tools` and `attachments` are looked up optionally. */
export const inject = []

/**
 * Channel switch (R178-N).
 *
 * true (default): every browser_* tool drives the SHELL's own sidebar panel, so
 * the model and the human look at one and the same browser. false: the old path -
 * this plugin spawns a private Chrome, invisible to the user, exactly as before.
 *
 * ROLLBACK WITHOUT EDITING CODE: start the kernel with DSH_BROWSER_PANEL=0 (the
 * value is read once here, at apply time). Everything else in this package stays
 * as it was; the two channels share the same session surface.
 */
const USE_PANEL = process.env.DSH_BROWSER_PANEL !== '0'

/**
 * Where the shell's panel lives (R184).
 *
 * The default is UNCHANGED - DEFAULT_PANEL_ORIGIN, http://127.0.0.1:31761 - and this is only a seam:
 * an offline fixture points the very same plugin at a fake panel through row config `panelOrigin` or
 * `DSH_BROWSER_PANEL_ORIGIN`, so the tab face can be driven by readings instead of by reading code.
 * A deployment that sets neither behaves exactly as before. It is read once, at apply time, like
 * USE_PANEL: whoever uses it as a runtime switch would be building a second truth about the shell.
 */
const PANEL_ORIGIN =
  typeof process.env.DSH_BROWSER_PANEL_ORIGIN === 'string' && process.env.DSH_BROWSER_PANEL_ORIGIN !== ''
    ? process.env.DSH_BROWSER_PANEL_ORIGIN
    : undefined

export function apply(ctx, config = {}) {
  const log = rootLog
  const settings = config ?? {}
  const baseDir = typeof settings.baseDir === 'string' && settings.baseDir !== '' ? settings.baseDir : defaultBaseDir()
  const store = new ConfigStore(baseDir)

  // Row config seeds the file only when the file does not exist yet, so a value
  // edited in the sidebar is never clobbered by a DSH restart.
  const initial = store.read()
  const seeded = {}
  if (typeof settings.browserExecutable === 'string' && settings.browserExecutable !== '' && initial.browserExecutable === null) {
    seeded.browserExecutable = settings.browserExecutable
  }
  if (Number.isFinite(settings.viewport?.width) || Number.isFinite(settings.viewport?.height)) {
    seeded.viewport = {
      width: Number.isFinite(settings.viewport?.width) ? settings.viewport.width : initial.viewport.width,
      height: Number.isFinite(settings.viewport?.height) ? settings.viewport.height : initial.viewport.height,
    }
  }
  if (Object.keys(seeded).length > 0) store.write(seeded)
  const effective = store.read()

  const panelOrigin =
    typeof settings.panelOrigin === 'string' && settings.panelOrigin !== '' ? settings.panelOrigin : PANEL_ORIGIN
  const registry = new BrowserRegistry({ baseDir, config: store, log, usePanel: USE_PANEL, panelOrigin })

  /** Tool disposers; non-empty exactly while the catalog carries the browser tools. */
  const disposers = []

  function registerTools() {
    if (disposers.length > 0) return true
    const tools = ctx.get('tools')
    if (tools === undefined) {
      log.warn('cannot register browser tools: this profile composes no tool registry')
      return false
    }
    try {
      for (const definition of defineBrowserTools({ registry, config: store, getAttachments: () => ctx.get('attachments') })) {
        disposers.push(tools.register(definition))
      }
      log.info(`browser tools registered: ${BROWSER_TOOL_NAMES.join(', ')}`)
      return true
    } catch (error) {
      log.error('failed to register browser tools', error?.message ?? error)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
      disposers.length = 0
      return false
    }
  }

  registerTools()

  // A late-composed tool registry must still receive the tools.
  ctx.inject(['tools'], () => registerTools())

  /** Panel RPC: the sidebar reads the same registry the tools mutate. */
  let panel = null
  try {
    panel = registerPanelRpc({
      ctx,
      registry,
      config: store,
      baseDir,
      openInstance: (options) => registry.open(options),
      closeInstance: (id, options) => registry.close(id, options),
      log,
    })
  } catch (error) {
    log.error('could not register the sidebar panel RPC', error?.message ?? error)
  }

  ctx.effect(
    () => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
      disposers.length = 0
      panel?.dispose?.()
      // Teardown runs while the host is unloading us; an escaping rejection here
      // would be an unhandled rejection in the host process. Browser windows are
      // deliberately LEFT OPEN: they are the user's to close, and killing them on
      // an unrelated reload would be surprising.
      void registry.detachAll().catch((error) => log.warn('browser registry teardown failed', error?.message ?? error))
    },
    'dsh-browser: lifecycle',
  )

  log.info(
    USE_PANEL === true
      ? 'browser tools drive the shell panel at ' + registry.panelOrigin + ' (the same browser the user sees, tabs and all); set DSH_BROWSER_PANEL=0 for the private-Chrome channel'
      : "browser tools spawn their own Chrome (DSH_BROWSER_PANEL=0 was set); they do NOT share the user's panel",
  )

  log.info(
    `ready — base ${baseDir}, viewport ${effective.viewport.width}x${effective.viewport.height}, ` +
      `executable ${effective.browserExecutable ?? '(auto-detect)'}, browsers start on first browser_* call`,
  )
}

export default { name, inject, apply }
