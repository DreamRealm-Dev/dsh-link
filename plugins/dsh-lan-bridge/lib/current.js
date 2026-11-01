/**
 * dsh-lan-bridge — Host half.
 *
 * The single Host-plane Cordis plugin mounted by the bundle row `lan-bridge`.
 * Everything it owns (tools, RPC carriers, timers, sockets) lives on this
 * plugin's fiber, so unloading the row removes all of it.
 *
 * ## Tool lifecycle is the product requirement
 *
 * Two registries with two independent triggers:
 *
 *   CONTROL PLANE — `bridge_devices`, `bridge_connect`, `bridge_pair`,
 *   `bridge_approve`, `bridge_disconnect` — follows `snapshot().controlTools`.
 *   On a headless or 极简模式 host there is no browser panel, so these five tools
 *   ARE the user interface; on an unrelated host they stay out of the catalog
 *   entirely, because a preset that deliberately ships one tool should not gain
 *   five bridge tools. `service.controlToolsVisible()` owns that decision.
 *
 *   DATA PLANE — `bridge_status` and the five filesystem/shell tools — follows
 *   `snapshot().toolsAvailable`, which is exactly `targets.length > 0`. It is
 *   deliberately NOT `snapshot().connection`: a link can be up while the peer
 *   exposes nothing to us, one device can be reachable only through a relay, and
 *   every device takes an optional `device` argument, so N devices share ONE
 *   registration. A grant refresh, a second device or a relay appearing changes
 *   neither boolean and therefore causes no churn.
 *
 * ## Activation semantics (no restart, no context loss)
 *
 * Tool registration is process-global on this plugin's fiber, and the tool
 * registry re-assembles the model-facing catalog on every step. So the moment a
 * registration edge happens:
 *
 *   - an ACTIVE session picks the change up at its NEXT step — the agent loop
 *     appends a durable `tool-addition` / `tool-removal` developer message, so
 *     the model is told the catalog changed instead of silently finding out;
 *   - a NEW session gets the catalog as it stands at its start;
 *   - nothing restarts, no session is recreated, and conversation context is
 *     never touched.
 *
 * That is why there is no registration gate on "a session is listening": the
 * catalog is re-read per step, so a session that already exists cannot miss an
 * edge that happened after its last step.
 */

import { createBridgeService, HOST_BUILD } from './core/service.js'
import { registerUiRpc } from './core/rpc.js'
import { defineBridgeTools, BRIDGE_TOOL_NAMES, BRIDGE_CONTROL_TOOL_NAMES } from './core/tools.js'
import { log as rootLog } from './core/log.js'

export const name = 'dsh-lan-bridge'

/** No hard dependencies: every plane is looked up optionally. */
export const inject = []

export function apply(ctx, config = {}) {
  const log = rootLog.child('host')
  const service = createBridgeService({ ctx, config: config ?? {}, log })

  /** Tool disposers, non-empty exactly while their plane belongs in the catalog. */
  let toolDisposers = []
  /** Control-plane disposers. Registered once per registration edge, never per device. */
  let controlToolDisposers = []
  let uiRpc = null
  let unsubscribe = null

  /**
   * Register one plane and keep its disposers.
   *
   * `disposers` is the plane's own array and `names` is its declared roster; a
   * plane is (re)registered only when its array is empty, so a change listener
   * that fires for an unrelated reason never re-registers and never churns the
   * catalog. A failure disposes whatever was partially registered and leaves the
   * array empty, so the next change edge retries instead of leaving a half
   * catalog behind.
   */
  function registerPlane(label, names, disposers, { controlOnly }) {
    if (disposers.length > 0) return true
    const tools = ctx.get('tools')
    if (tools === undefined) {
      log.warn(`cannot register ${label} tools: this profile composes no tool registry`)
      return false
    }
    try {
      for (const definition of defineBridgeTools({ ctx, getService: () => service, controlOnly })) {
        disposers.push(tools.register(definition))
      }
      log.info(`${label} bridge tools registered: ${names.join(', ')}`)
      return true
    } catch (error) {
      log.error(`failed to register ${label} bridge tools`, error?.message ?? error)
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

  /**
   * Reconcile both planes against one snapshot.
   *
   * Reads `service.snapshot()` rather than the argument, because the argument is
   * only a convenience: the host now passes a snapshot (it used to pass its
   * INTERNAL `state`, which has no `toolsAvailable` / `controlTools` fields at
   * all, and trusting that silently reclaimed both planes on every mid-start
   * notification and re-registered them on the next one — a register/remove/add
   * churn the model sees as three catalog changes for one boot). Reading the
   * snapshot here makes this correct whichever the host passes.
   *
   * Registration index is what decides re-registration, never the reason the
   * snapshot was produced, so this is safe to call from every change
   * notification.
   *
   * The disposer arrays are mutated in place (`length = 0`, not reassignment):
   * `registerPlane` closes over them, so replacing the array would leave the
   * closure writing into an orphan and silently stop registering after the first
   * reclaim.
   */
  function syncTools() {
    const state = service.snapshot()
    if (state.controlTools === true) {
      cancelReclaim()
      registerPlane('control-plane', BRIDGE_CONTROL_TOOL_NAMES, controlToolDisposers, { controlOnly: true })
    }
    if (state.toolsAvailable === true) {
      // Coming back cancels a pending reclaim: a link that dropped and returned
      // must not cost two catalog changes when it never really left.
      cancelReclaim()
      registerPlane('data-plane', BRIDGE_TOOL_NAMES, toolDisposers, { controlOnly: false })
    }
    if (state.toolsAvailable !== true || state.controlTools !== true) scheduleReclaim()
  }

  /**
   * Reclaim the data-plane tools only after the last device has been gone a
   * while, never the instant the snapshot says zero.
   *
   * A tool catalog change makes DSH start a NEW request series
   * (`agent-loop`: `startsSeries: … || this.toolsChanged(assembly.tools)`), i.e.
   * it invalidates the cached request prefix. Unlocking immediately is what the
   * user wants — tools must be there the moment a device appears — but reclaiming
   * immediately made a FLAPPING link churn the catalog on every bounce, and a
   * flap is not hypothetical: the audit log shows four
   * `agent.connect` / `agent.close peer_closed:peer_goaway` rounds in a row.
   * One miss when a device genuinely leaves is the honest cost of reclaiming;
   * one miss per bounce is not.
   *
   * This is deliberately NOT `sticky`: keeping the tools registered forever would
   * cost nothing in cache misses but would permanently spend request-prefix space
   * on six tools that usually cannot do anything.
   */
  const RECLAIM_GRACE_MS = 20_000
  let reclaimTimer = null

  function cancelReclaim() {
    if (reclaimTimer === null) return
    clearTimeout(reclaimTimer)
    reclaimTimer = null
  }

  function reclaimPlane(plane, disposers) {
    if (disposers.length === 0) return
    const count = disposers.length
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        log.warn(`failed to reclaim a ${plane} bridge tool`, error?.message ?? error)
      }
    }
    disposers.length = 0
    log.info(
      `${plane} bridge tools reclaimed (${count}) after ${RECLAIM_GRACE_MS / 1000}s with no device; ` +
        'local tools and context are untouched',
    )
  }

  function scheduleReclaim() {
    if (reclaimTimer !== null) return
    if (toolDisposers.length === 0 && controlToolDisposers.length === 0) return
    reclaimTimer = setTimeout(() => {
      reclaimTimer = null
      // Re-read: the grace period exists precisely because the answer may have
      // changed while we waited.
      const now = service.snapshot()
      if (now.toolsAvailable !== true) reclaimPlane('data-plane', toolDisposers)
      if (now.controlTools !== true) reclaimPlane('control-plane', controlToolDisposers)
    }, RECLAIM_GRACE_MS)
    reclaimTimer.unref?.()
  }

  // --- browser panel carrier -------------------------------------------------
  // The diagnostics block is what makes "tools are registered" observable from
  // the panel and from a support session instead of having to read the host log.
  try {
    uiRpc = registerUiRpc({
      ctx,
      service,
      log,
      build: HOST_BUILD,
      diagnostics: () => ({
        toolsUnlocked: toolDisposers.length === BRIDGE_TOOL_NAMES.length ? [...BRIDGE_TOOL_NAMES] : [],
        toolsRegistered: toolDisposers.length,
        controlToolsUnlocked:
          controlToolDisposers.length === BRIDGE_CONTROL_TOOL_NAMES.length ? [...BRIDGE_CONTROL_TOOL_NAMES] : [],
        controlToolsRegistered: controlToolDisposers.length,
        carriers: uiRpc?.carriers ?? null,
        dataDir: service.dataDir,
        pid: process.pid,
        node: process.version,
      }),
    })
  } catch (error) {
    log.error('could not register the sidebar panel RPC', error?.message ?? error)
  }

  // --- lifecycle ------------------------------------------------------------
  ctx.effect(
    () => () => {
      unsubscribe?.()
      // A pending reclaim must not fire into a half-unloaded plugin.
      cancelReclaim()
      for (const dispose of [...controlToolDisposers, ...toolDisposers]) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
      toolDisposers.length = 0
      controlToolDisposers.length = 0
      uiRpc?.dispose?.()
      // Teardown runs while the host is unloading us; a rejection escaping here
      // would be an unhandled rejection in the host process, which is fatal.
      void service.stop().catch((error) => log.warn('bridge service teardown failed', error?.message ?? error))
    },
    'dsh-lan-bridge: lifecycle',
  )

  // NOTE on the first reconciliation: it happens on the FIRST snapshot that has
  // finished starting, not at the top of `apply()`. `snapshot()` is only truthful
  // once `service.start()` has resolved — before that, `accepts` is false, the
  // listener has not bound and no pairing window exists, so `controlToolsVisible()`
  // is legitimately false and an early reconcile would register nothing, get
  // reclaimed by the first mid-start notification, and then re-register: a
  // register/remove/add churn the model would see as three catalog changes for
  // one boot. Every later snapshot change re-reconciles, and the registration
  // index makes that a no-op whenever the triggers have not moved.
  unsubscribe = service.onChange(syncTools)

  void service
    .start()
    .then(() => {
      log.info(
        `ready — device ${service.snapshot().deviceId} (${service.snapshot().deviceName}), ` +
          `ui carriers: ${JSON.stringify(uiRpc?.carriers ?? {})}`,
      )
      syncTools()
    })
    .catch((error) => log.error('bridge service failed to start', error?.message ?? error))

  // A late-composed tool registry must still get the tools on BOTH planes.
  ctx.inject(['tools'], () => syncTools())
}

export default { name, inject, apply }
