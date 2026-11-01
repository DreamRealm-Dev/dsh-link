/**
 * When one radius adjustment has to reach every surface.
 *
 * The slider's own write is cheap and immediate: two custom properties on the root element,
 * which every stylesheet-driven corner reads, and the shell, which draws the window's own
 * corner. What that write does *not* reach is the work a surface has already cached: the
 * material engine keeps a baked lens per shape and only treats a panel as a surface of its own
 * once a sweep has said so, so an already-open popover kept the corner it was born with until
 * it was closed and reopened — the defect this module exists for.
 *
 * So the cheap half runs on every input (the drag previews live, as it always did) and the
 * expensive half — one global re-dress — is deferred to the first moment the adjustments stop:
 * {@link RADIUS_APPLY_IDLE_MS} after the last one. A burst of slider input therefore costs one
 * re-dress, not one per step, and the re-dress is a function of the value alone, so running it
 * twice changes nothing.
 */

/** Milliseconds of stillness after the last radius adjustment before the global apply. */
export const RADIUS_APPLY_IDLE_MS = 3000

/**
 * How far the panel step sits from the window radius, in CSS pixels.
 *
 * The relationship the material already had — 12 inside, 18 outside — kept as one number here
 * so the live write and the global apply can never disagree about it.
 */
export const PANEL_RADIUS_STEP = 6

/** The one thing both writes need of a document: its root element's inline style. */
export interface RadiusTokenOwner {
  /** Inline style of the element the tokens are written on. */
  style: { setProperty(name: string, value: string): void }
}

/**
 * Write the unified radius onto the element every surface resolves it from.
 *
 * Idempotent by construction: the same radius writes the same two declarations, and the same
 * declaration written twice leaves the element exactly as it was. That is what lets the live
 * preview and the deferred global apply share this one writer.
 * @param owner - the document's root element, or a stand-in for it in a test.
 * @param radius - the unified radius, in CSS pixels.
 */
export function writeRadiusTokens(owner: RadiusTokenOwner, radius: number): void {
  owner.style.setProperty('--lg-radius-window', `${radius}px`)
  owner.style.setProperty('--lg-radius-panel', `${radius + PANEL_RADIUS_STEP}px`)
}

/** The shape of the engine's debug hook this plugin borrows. */
interface SweepHook {
  /** One full pass: tag the panels the engine has not classified, then dress every surface. */
  sweep?: () => void
}

/**
 * The material engine's global re-dress, as a callable, or undefined when it is not there.
 *
 * `sweep` is the only pass that reaches a panel the engine has never classified — the
 * client-glass popover case, which is a surface whose corner comes from the client's own
 * number until the sweep tags it — and it dresses every surface afterwards, which is what
 * re-bakes the lens of a surface already on screen. It is read here rather than imported
 * because it is the engine's published hook, and this plugin must not reach into another
 * plugin's module graph.
 * @param host - the global object to read the hook from.
 * @returns the sweep, or undefined when this composition has no engine hook.
 */
export function lgSweep(host: unknown): (() => void) | undefined {
  const hook = (host as { __lgSweep?: SweepHook } | undefined)?.__lgSweep
  if (hook === undefined || typeof hook.sweep !== 'function') return undefined
  const sweep = hook.sweep.bind(hook)
  return () => { sweep() }
}

/** What one global apply does, in the order it does it. */
export interface RadiusApplySteps {
  /**
   * The cheap half: the two tokens and the shell's own corner. Idempotent, and the reason a
   * run repeated by hand cannot make the interface worse.
   */
  applyTokens: (radius: number) => void
  /**
   * The expensive half: re-dress every surface in the document that resolves a radius.
   * Idempotent — a surface whose lens already fits its shape is handed the lens it wears.
   */
  redressSurfaces: () => void
}

/** The idle debounce, as its owner sees it. */
export interface RadiusApplier {
  /** Note one radius adjustment; the global apply follows {@link RADIUS_APPLY_IDLE_MS} after the last one. */
  note: (radius: number) => void
  /** The radius the last global apply was run for, or undefined before the first one. */
  applied: () => number | undefined
  /** Drop any pending apply without running it (plugin teardown). */
  cancel: () => void
}

/**
 * Build the applier that turns a burst of radius adjustments into one global apply.
 *
 * The debounce is deliberately value-aware, not just timer-aware: a value the last global apply
 * already wrote is *dropped* rather than deferred, because re-running the apply for an unchanged
 * radius is work with no user-visible effect. That is also what makes the apply idempotent from
 * the outside — the caller may note the same radius as often as it likes (a commit arriving
 * after a drag, a settings change that left the radius alone) and the document is re-dressed
 * once per *change*, never once per note.
 * @param steps - the two halves of the apply.
 * @param idleMs - stillness required before the apply; the shipped window is {@link RADIUS_APPLY_IDLE_MS}.
 * @returns the applier.
 */
export function createRadiusApplier(steps: RadiusApplySteps, idleMs: number = RADIUS_APPLY_IDLE_MS): RadiusApplier {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: number | undefined
  let applied: number | undefined

  const stop = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const run = (): void => {
    timer = undefined
    const radius = pending
    pending = undefined
    if (radius === undefined || radius === applied) return
    /* Recorded before the work, so a step that throws cannot leave the debounce believing the
     * radius still has to be applied and re-running it on the next note. */
    applied = radius
    steps.applyTokens(radius)
    steps.redressSurfaces()
  }

  return {
    note: (radius) => {
      stop()
      /* Nothing to apply when the surface of the world is already this: a control that lands
       * back on the persisted value, or a commit that carried no radius change at all. */
      if (radius === applied) { pending = undefined; return }
      pending = radius
      timer = setTimeout(run, idleMs)
    },
    applied: () => applied,
    cancel: () => { stop(); pending = undefined },
  }
}
