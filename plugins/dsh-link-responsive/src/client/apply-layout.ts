/**
 * The seam between the decision and the document: write what changed, and take away what is gone.
 *
 * What this module is careful about is the second half. A layout that only ever writes leaves the
 * values of the band it came from in place: come back from a wide window and the narrow band's keys
 * are added, but the wide band's own keys are still there, still winning where they are more specific
 * — the "wide gap still hangs on the narrow window" defect. So a key the previous band decided and
 * this one does not is **removed**, not overwritten, and the removal is reported.
 *
 * It imports nothing and reads no global: the only thing it needs of a document is the two methods it
 * is handed, which is what lets a check drive it with a stand-in object.
 */
import type { LayoutPlan } from './layout-plan.ts'

/**
 * What this module needs of a document root.
 *
 * The first three methods are the whole common path. removeProperty is not in the minimal seam — a
 * plan that removes nothing needs only the first three — but a target that has keys to remove and no
 * way to remove them is refused rather than quietly left carrying a stale value.
 */
export interface LayoutTarget {
  /** Write one attribute on the element. */
  setAttribute(name: string, value: string): void
  /** Inline style of the element the decisions are written on. */
  style: {
    /** Write one custom property. */
    setProperty(name: string, value: string): void
    /** Remove one custom property. Needed only when there is something to remove. */
    removeProperty?(name: string): void
  }
}

/** What one apply did, so a caller can see the writes it asked for and the removals it made. */
export interface LayoutApplyResult {
  /** The names written: the band attribute, and one custom property per decision written. */
  readonly wrote: readonly string[]
  /** The decision keys removed, sorted. Empty when the previous band decided nothing extra. */
  readonly removed: readonly string[]
}

/** The attribute carrying the chosen band's name. */
export const BAND_ATTRIBUTE = 'data-dsh-link-layout'

/** The custom property one decision key is written as. */
export const decisionProperty = (key: string): string => '--dsh-link-' + key

/**
 * Apply one plan to one target, writing only what changed and removing what the plan dropped.
 *
 * Idempotent: the same plan applied twice to the same target writes nothing the second time — the
 * band attribute and every decision are compared against the previous plan first, and an unchanged
 * value is not written again. The decision keys are never invented and never renamed: what the band
 * decided is what is written, as the string form of its value.
 * @param target - the document root, or a stand-in for it.
 * @param plan - the plan to apply.
 * @param previous - the plan in force before, or null when nothing was.
 * @returns what was written and what was removed.
 * @throws TypeError when a previous decision key has to be removed and the target cannot remove one.
 */
export function applyLayout(target: LayoutTarget, plan: LayoutPlan, previous: LayoutPlan | null): LayoutApplyResult {
  const wrote: string[] = []
  const removed: string[] = []
  if (previous === null || previous.band !== plan.band) {
    target.setAttribute(BAND_ATTRIBUTE, String(plan.band))
    wrote.push(BAND_ATTRIBUTE)
  }
  const stale = previous === null
    ? []
    : Object.keys(previous.decisions).filter((key) => !Object.prototype.hasOwnProperty.call(plan.decisions, key)).sort()
  if (stale.length > 0 && typeof target.style.removeProperty !== 'function') {
    throw new TypeError('applyLayout: the target cannot remove the stale decision(s) ' + JSON.stringify(stale) + '; leaving them in place would let the previous band keep winning')
  }
  for (const key of stale) {
    target.style.removeProperty?.(decisionProperty(key))
    removed.push(key)
  }
  for (const key of Object.keys(plan.decisions)) {
    const value = String(plan.decisions[key])
    if (previous !== null && Object.prototype.hasOwnProperty.call(previous.decisions, key) && String(previous.decisions[key]) === value) continue
    target.style.setProperty(decisionProperty(key), value)
    wrote.push(decisionProperty(key))
  }
  return { wrote, removed }
}
