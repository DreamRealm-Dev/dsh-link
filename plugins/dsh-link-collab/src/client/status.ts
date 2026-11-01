/**
 * One read of the bus's own status route, narrowed to the four facts the row draws.
 *
 * WHY THIS MODULE EXISTS. The row must carry what the bus ANSWERED, not what this half hoped: a route
 * that is missing, a body that is not JSON, an answer that says ok: false, and a document whose
 * numbers are not numbers are four different facts, and each becomes its own named failure rather
 * than an empty line that reads like a healthy bus with nothing in it.
 *
 * Pure and total: nothing here throws, nothing reads a clock or the environment, and the only input
 * is what the page's own fetch handed back.
 */
import type { Translate } from './locales.ts'

/** The four facts the row draws, as the route carries them. */
export interface BusReading {
  /** How many teams the ledger folds to. */
  readonly teams: number
  /** How many members the ledger folds to. */
  readonly members: number
  /** How many records the ledger holds. */
  readonly records: number
  /** Whether a peer can reach this end at all. */
  readonly relayBound: boolean
  /** The path this reading came from, so the row can name its own source. */
  readonly path: string
  /**
   * What the message count can see on the running kernel, as the route names it.
   *
   * R217: the two supported kernel lines do not log message flow the same way. alpha.1 wrote the Team
   * mailbox events (both directions); alpha.5 steers a message into the target's own inbox, so only
   * messages delivered INTO the session this bus watches are visible. 'unknown' is what an older host
   * half answers - a fact, not a default.
   */
  readonly messagesScope: 'both-directions' | 'this-end-only' | 'none' | 'unknown'
}

/** One named reason the reading could not be taken. */
export interface BusFailure {
  /** This half's own code, or the route's own code when the route answered ok: false. */
  readonly code: string | null
  /** The route's own message, or this half's own sentence about what it could not read. */
  readonly detail: string
}

/** What one read settled to: the reading, or the reason there is none. */
export interface BusRead {
  readonly reading: BusReading | null
  readonly failure: BusFailure | null
}

/** A number the route answered with, or null when the field is not a finite number. */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One field of a document this half did not write, read without letting a getter throw. */
function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/**
 * Read one route answer into the four facts the row draws, or into the reason it could not be read.
 *
 * @param input - the HTTP status the page saw, the body text, and what the request itself reported
 *   (a transport sentence, when the request never produced an answer at all).
 * @returns the reading, or the named failure - never both, and never neither.
 */
/** The message scope the route declared, or 'unknown' when it declared none this half can read. */
function scopeOf(value: unknown): 'both-directions' | 'this-end-only' | 'none' | 'unknown' {
  return value === 'both-directions' || value === 'this-end-only' || value === 'none' ? value : 'unknown'
}

export function readAnswer(input: { readonly status: number | null, readonly text: string, readonly transport: string | null }): BusRead {
  if (input.transport !== null) return { reading: null, failure: { code: 'route-unreachable', detail: input.transport } }
  let document: unknown = null
  try {
    document = JSON.parse(input.text)
  } catch {
    return { reading: null, failure: { code: 'body-not-json', detail: 'the answer was not JSON (' + String(input.text.length) + ' bytes, HTTP ' + String(input.status) + ')' } }
  }
  if (fieldOf(document, 'ok') !== true) {
    const error = fieldOf(document, 'error')
    const code = fieldOf(error, 'code')
    const message = fieldOf(error, 'message')
    // R208: this sentence is a DIAGNOSTIC, not product copy - the same rule the panel's own load.ts follows
    // ('a sentence about a mount that handed in no seat is a diagnostic, not copy'). Keeping it out of the
    // object literal is what lets the copy gate see that: what a dictionary entry would be right here is a
    // translation of a sentence that exists to be read by whoever is debugging the route.
    const fallback = 'the route refused the reading (HTTP ' + String(input.status) + ')'
    return {
      reading: null,
      failure: {
        code: typeof code === 'string' && code !== '' ? code : null,
        detail: typeof message === 'string' && message !== '' ? message : fallback,
      },
    }
  }
  const ledger = fieldOf(document, 'ledger')
  const world = fieldOf(document, 'world')
  const relay = fieldOf(document, 'relay')
  const records = numberOf(fieldOf(ledger, 'records'))
  const teams = numberOf(fieldOf(world, 'teams'))
  const members = numberOf(fieldOf(world, 'members'))
  const path = fieldOf(document, 'path')
  if (records === null || teams === null || members === null) {
    return { reading: null, failure: { code: 'reading-incomplete', detail: 'the answer carried no ledger/world counts (HTTP ' + String(input.status) + '): ' + String(input.text).slice(0, 200) } }
  }
  return {
    reading: {
      teams,
      members,
      records,
      relayBound: fieldOf(relay, 'bound') === true,
      path: typeof path === 'string' ? path : '',
      messagesScope: scopeOf(fieldOf(fieldOf(document, 'messages'), 'scope')),
    },
    failure: null,
  }
}

/**
 * What the row says, from the reading this half holds now.
 *
 * Three states, told apart on purpose: nothing read yet, a reading with its four numbers, and a named
 * failure. All three are this package's OWN words - the numbers, a code and a route's message are
 * data and travel as parameters, and the two relay labels are copy read from the same dictionary.
 *
 * @param reading - the reading last taken, or null.
 * @param failure - why there is no reading, or null.
 * @param t - the translate bound to this package's namespace.
 * @returns the one line the panel draws for this row.
 */
export function bodyText(reading: BusReading | null, failure: BusFailure | null, t: Translate): string {
  if (reading !== null) {
    const line = t('panel.status.body', {
      teams: reading.teams,
      members: reading.members,
      records: reading.records,
      relay: t(reading.relayBound ? 'panel.status.relayBound' : 'panel.status.relayUnbound'),
    })
    // Only the two states a reader must know about get a suffix: both-directions is the ordinary case
    // and says nothing extra, and 'unknown' means the host half predates this field rather than that
    // the bus lost something. Everything else is named, so a scope that changes the meaning of the
    // count is never left to be guessed.
    if (reading.messagesScope === 'this-end-only') return line + t('panel.status.messagesThisEnd')
    if (reading.messagesScope === 'none') return line + t('panel.status.messagesNone')
    return line
  }
  if (failure !== null) {
    return t('panel.status.failed', { code: failure.code ?? t('panel.status.noCode'), detail: failure.detail })
  }
  return t('panel.status.unread')
}
