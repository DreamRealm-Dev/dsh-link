/**
 * What the toolbar entry's menu reports: one row per marker, each one honest about what it found.
 *
 * The three outcomes are the whole point of this module. A marker with a value means the thing is
 * mounted and says something; a marker that is absent means it is not mounted here; and a marker that
 * exists but is empty means it is mounted and has not said anything yet. Collapsing the last two into
 * "unavailable" would make a half-started plugin look like a missing one, and making any of them look
 * clickable when nothing is behind them is what this round exists to avoid.
 *
 * The module reads no global: the attribute source is handed in, which is what lets a node check
 * recompute every one of these rows without a browser.
 */

/** What this module needs of a document root, so a check can stand in for one. */
export interface ToolbarAttributeSource {
  /** Read one attribute; null when it is not there. */
  getAttribute(name: string): string | null
}

/** Why one row is not enabled. */
export type ToolbarReason = 'not-mounted' | 'empty-value'

/** One row of the menu. */
export interface ToolbarItem {
  /** Stable id, also the order key: the menu does not reorder itself. */
  readonly id: string
  /** The dictionary key for this row's label. Never the label itself. */
  readonly labelKey: string
  /** Whether the thing behind this row is there right now. */
  readonly enabled: boolean
  /** Why it is not enabled, or null when it is. */
  readonly reason: ToolbarReason | null
  /** The marker's value when there is one, else null. */
  readonly value: string | null
}

/** One marker the menu reports, in the order the menu shows them. */
const MARKERS: readonly { readonly id: string, readonly attribute: string }[] = [
  { id: 'layout', attribute: 'data-dsh-link-layout' },
  { id: 'notes', attribute: 'data-dsh-link-notes' },
  { id: 'glass', attribute: 'data-dsh-link-glass' },
  { id: 'browser', attribute: 'data-dsh-browser' },
]

/**
 * Read the menu's rows off one attribute source.
 *
 * Pure in the strict sense: the same source answers byte for byte the same rows, no clock is read, and
 * the order is the table above rather than anything the source says — a menu whose order moved with
 * the data would be a menu nobody can learn.
 * @param source - the document root, or a stand-in whose getAttribute answers for it.
 * @returns one row per marker, in table order.
 */
export function toolbarItems(source: ToolbarAttributeSource): readonly ToolbarItem[] {
  return MARKERS.map((marker) => {
    const raw = source === null || source === undefined ? null : source.getAttribute(marker.attribute)
    if (raw === null || raw === undefined) {
      return { id: marker.id, labelKey: 'item.' + marker.id, enabled: false, reason: 'not-mounted' as ToolbarReason, value: null }
    }
    if (raw === '') {
      return { id: marker.id, labelKey: 'item.' + marker.id, enabled: false, reason: 'empty-value' as ToolbarReason, value: null }
    }
    return { id: marker.id, labelKey: 'item.' + marker.id, enabled: true, reason: null, value: raw }
  })
}

/** The marker attributes this menu reports, in menu order. */
export const MARKER_ATTRIBUTES: readonly string[] = MARKERS.map((marker) => marker.attribute)
