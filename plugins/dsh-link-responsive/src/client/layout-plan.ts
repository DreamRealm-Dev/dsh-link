/**
 * Which layout band a width falls in: a table in data, one pure decision.
 *
 * The band table is the authority, not this file: which bands exist, what each one decides and in
 * what order they are tried all live in bands.json, so changing the layout is a data review rather
 * than a code change. What this module owns is the one rule that must not drift — that a band's
 * MAXIMUM is inclusive, that a band's MINIMUM is inclusive, that ties go to the table's own order,
 * and that a table with no catch-all band refuses rather than crowning the nearest one.
 *
 * It imports nothing and touches no global: node runs it as it is, which is what makes the decision
 * independently recomputable by a check instead of only observable in a browser.
 */

/** The band-table format this build reads. Anything else is refused, not guessed at. */
export const BANDS_FORMAT = 'dsh-link.responsive-bands/1'

/** One band: when it applies, and what it decides. */
export interface Band {
  /** Its name, unique in the table and reported as the chosen band. */
  readonly name: string
  /** Inclusive lower bound, in CSS pixels, when it has one. */
  readonly minWidth?: number
  /** Inclusive upper bound, in CSS pixels, when it has one. */
  readonly maxWidth?: number
  /** True for the band that answers when nothing else does. At most one may carry it. */
  readonly catchAll?: boolean
  /** The decisions it makes: key to value, where a value is written as its string form. */
  readonly decisions: Readonly<Record<string, unknown>>
}

/** A band table, as the data file holds it. */
export interface Bands {
  /** The format tag. Only BANDS_FORMAT is read. */
  readonly format: string
  /** The bands, in the order they are tried. */
  readonly bands: readonly Band[]
}

/** Why one width chose one band, so a reader can see which rule decided. */
export type MatchedBy = 'maxWidth' | 'minWidth' | 'catchAll'

/** What the planner decided: the band, the width it was asked about, and its decisions. */
export interface LayoutPlan {
  /** The band's name. */
  readonly band: string
  /** The width the plan was made for, echoed so a caller cannot lose it. */
  readonly width: number
  /** The decisions that band makes. */
  readonly decisions: Readonly<Record<string, unknown>>
  /** Which rule in the band matched: its upper bound, its lower bound, or its catch-all. */
  readonly matchedBy: MatchedBy
}

/** What loadBands answers. */
export interface BandsLoadResult {
  /** Whether the table may be used. */
  readonly ok: boolean
  /** Why not, when it may not. */
  readonly reason: 'ok' | 'bad-bands'
  /** The table, or null when it was refused. */
  readonly bands: Bands | null
  /** What was wrong, when something was. */
  readonly detail: string | null
}

/** What planLayout answers. */
export interface PlanResult {
  /** Whether a band was chosen. */
  readonly ok: boolean
  /** Why not, when none was. */
  readonly reason: 'ok' | 'no-band'
  /** The plan, or null when no band answered. */
  readonly plan: LayoutPlan | null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Read a band table, refusing anything it cannot use.
 *
 * Every refusal names what was wrong, because a table that silently lost its last band would be
 * indistinguishable from one that decides nothing. A table with **no** catch-all is not refused
 * here: whether a width finds a band is a question about a width, and planLayout is where a width
 * that finds none is reported. A table with **two** catch-alls is refused here, because that is a
 * table that cannot be read at all — the rule that would choose between them does not exist.
 * @param raw - the parsed data file, or anything a caller hoped was one.
 * @returns the table, or the reason it was refused.
 */
export function loadBands(raw: unknown): BandsLoadResult {
  const bad = (detail: string): BandsLoadResult => ({ ok: false, reason: 'bad-bands', bands: null, detail })
  if (!isPlainObject(raw)) return bad('the band table is not an object')
  if (raw.format !== BANDS_FORMAT) return bad('unknown format ' + JSON.stringify(raw.format ?? null) + '; this build reads ' + BANDS_FORMAT)
  if (!Array.isArray(raw.bands)) return bad('bands is not an array')
  const names = new Set<string>()
  let catchAlls = 0
  const bands: Band[] = []
  for (const entry of raw.bands) {
    if (!isPlainObject(entry)) return bad('a band is not an object')
    const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : null
    if (name === null) return bad('a band has no usable name')
    if (names.has(name)) return bad('the band name ' + JSON.stringify(name) + ' appears twice')
    names.add(name)
    if (!isPlainObject(entry.decisions)) return bad('the band ' + JSON.stringify(name) + ' has no decisions object')
    for (const bound of ['minWidth', 'maxWidth']) {
      const value = entry[bound]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return bad('the band ' + JSON.stringify(name) + ' has a ' + bound + ' of ' + JSON.stringify(value) + ', not a finite width')
    }
    if (entry.catchAll !== undefined && typeof entry.catchAll !== 'boolean') return bad('the band ' + JSON.stringify(name) + ' has a catchAll that is not a boolean')
    if (entry.catchAll === true) catchAlls += 1
    bands.push({
      name,
      ...(entry.minWidth === undefined ? {} : { minWidth: entry.minWidth }),
      ...(entry.maxWidth === undefined ? {} : { maxWidth: entry.maxWidth }),
      ...(entry.catchAll === undefined ? {} : { catchAll: entry.catchAll }),
      decisions: { ...entry.decisions },
    })
  }
  if (catchAlls > 1) return bad('the table carries ' + String(catchAlls) + ' catch-all bands; at most one can answer for the rest')
  return { ok: true, reason: 'ok', bands: { format: BANDS_FORMAT, bands }, detail: null }
}

/**
 * Decide which band one width falls in.
 *
 * Pure: no clock, no DOM, no globals, so two calls answer byte for byte the same question. The rules
 * are the table's own: a band whose maxWidth is at least this width matches, a band whose minWidth is
 * at most this width matches, a catch-all matches, and the **first** match in table order wins —
 * which is why the order is data rather than a comment. A width no band answers for is refused with
 * no-band and a null plan: crowning the nearest band would be a guess about a screen nobody measured.
 * @param width - the viewport width in CSS pixels. A negative, non-finite or non-numeric width is a
 * caller error and throws; that is not the same answer as a width no band covers.
 * @param bands - the table, as loadBands returned it.
 * @returns the plan, or the reason no band answered.
 * @throws TypeError when width is not a finite number, or is negative.
 */
export function planLayout(width: number, bands: Bands): PlanResult {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0) {
    throw new TypeError('planLayout: width must be a finite number of CSS pixels that is not negative, got ' + JSON.stringify(width))
  }
  for (const band of bands.bands) {
    const matchedBy: MatchedBy | null = band.catchAll === true
      ? 'catchAll'
      : band.maxWidth !== undefined && width <= band.maxWidth
        ? 'maxWidth'
        : band.minWidth !== undefined && width >= band.minWidth
          ? 'minWidth'
          : null
    if (matchedBy === null) continue
    return { ok: true, reason: 'ok', plan: { band: band.name, width, decisions: { ...band.decisions }, matchedBy } }
  }
  return { ok: false, reason: 'no-band', plan: null }
}
