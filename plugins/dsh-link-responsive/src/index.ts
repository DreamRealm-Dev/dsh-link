/**
 * The host half of the responsive layout plugin: the band table and the two seams, on this side too.
 *
 * The decisions themselves are a document-root concern, so the work happens in the client half. This
 * side exists because the same three things are worth reading from a host: the band table is data, the
 * planner is pure, and the applier takes any object with the two methods it needs — which is how a
 * check drives a layout decision without a browser.
 */
export const name = 'dsh-link-responsive'

export { BANDS_FORMAT, loadBands, planLayout } from './client/layout-plan.ts'
export type { Band, Bands, BandsLoadResult, LayoutPlan, MatchedBy, PlanResult } from './client/layout-plan.ts'
export { applyLayout, BAND_ATTRIBUTE, decisionProperty } from './client/apply-layout.ts'
export type { LayoutApplyResult, LayoutTarget } from './client/apply-layout.ts'

/**
 * The host half's mount point.
 *
 * R221b: this side carries no behaviour - the decisions are a document-root concern and the applier runs
 * in the client half. It still needs an `apply`, because a Cordis row is a plugin and a module without one
 * cannot be composed: the loader answered `link-responsive (dsh-link-responsive): failed to import` for
 * exactly that reason, with no detail line, and the plugin had never been mounted anywhere.
 */
export function apply(): void {}
