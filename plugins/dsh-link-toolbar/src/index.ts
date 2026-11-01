/**
 * The host half of the LINK toolbar entry.
 *
 * The work is a client half: the entry lives in the conversation header, which exists in the browser.
 * This side is deliberately near-empty — a row has to resolve for the client half to be loaded with
 * it, and a host half that invented work would be a row pretending to do something the user can see.
 * The one thing worth exporting here is the name, so a reader can find the package from a row — and the
 * menu's rows, re-exported so the decision can be recomputed from the built artifact instead of only
 * from the client bundle, which a browser wrapper owns.
 */
export const name = 'dsh-link-toolbar'

export { MARKER_ATTRIBUTES, toolbarItems } from './client/toolbar-items.ts'
export type { ToolbarAttributeSource, ToolbarItem, ToolbarReason } from './client/toolbar-items.ts'
