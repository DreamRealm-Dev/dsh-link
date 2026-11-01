/**
 * The reading this package publishes about itself, as data.
 *
 * WHAT IT IS FOR. The bus has no product surface of its own: the ledger is a JSONL file, the relay is
 * a route that may or may not be bound, and the counts live in a fold nothing shows. The LINK panel's
 * status row is that surface, and this document is what it reads - built here, on the host, from the
 * live ledger, so the row carries numbers somebody can act on rather than a claim that the bus exists.
 *
 * Pure: it takes what the caller folded and touched, and adds nothing. No clock (the caller passes
 * its own instant), no file, no environment.
 */
import type { DamageReport, TeamRecorder, TeamState } from './index.ts'

/** What the relay route did: whether it is bound at all, and the counts its own handler keeps. */
export interface RelayReading {
  readonly bound: boolean
  readonly path: string
  readonly accepted: number
  readonly refused: number
  readonly lastCode: string | null
}

/** The whole reading, in the one JSON document the route serves. */
export interface BusStatus {
  readonly ok: true
  /** Where this answer came from, spelled from the route that is bound rather than from a second constant. */
  readonly path: string
  /** When the caller took the reading. */
  readonly at: number
  readonly ledger: {
    /** Records the file holds, relayed ones included: how much ledger there is. */
    readonly records: number
    /** Highest sequence the log assigned. */
    readonly lastSeq: number
    /** The name this log's own records carry. */
    readonly writer: string
    /** Which of that writer's ledgers this is; a rebuilt log is a different instance. */
    readonly instance: string
    /**
     * What the log's reader could not parse, or null when every line of the ledger parsed.
     *
     * Null rather than three zeros on purpose: an intact ledger has no damage report, and a row of
     * zeros would describe a reading somebody took instead of the ordinary case.
     */
    readonly damage: {
      readonly brokenLines: number
      readonly lastGoodSeq: number
      readonly bytes: number
    } | null
  }
  readonly world: {
    /**
     * How many teams the ledger DECLARES: the team tree's nodes.
     *
     * Not the fold's team buckets, which count the scopes the task and member rows name (including the
     * unnamed one): a ledger can declare two teams and carry work for none of them yet, and this
     * field is the one a reader means by "how many teams are there".
     */
    readonly teams: number
    readonly members: number
    readonly tasks: number
    readonly folded: number
    readonly unknown: number
  }
  readonly relay: RelayReading
  /**
   * What the bus can see of message flow, and where it saw it.
   *
   * R217: 'journal' means the Team mailbox events (team/message/queued|delivered), which carry BOTH
   * directions because the Team service wrote them into the Lead's own log. 'inbox' means the target's
   * inbox splice (agent/inbox/spliced with source.kind = 'agent-message'), which only ever shows
   * messages DELIVERED INTO the session this bus watches. 'both' is a ledger that holds both (an
   * upgraded log). 'none' is a kernel that journals neither: named, because a bare zero would read as
   * "the team never spoke" - the one thing this field exists to prevent.
   */
  readonly messages: {
    readonly journal: number
    readonly inbox: number
    readonly source: 'journal' | 'inbox' | 'both' | 'none'
    readonly scope: 'both-directions' | 'this-end-only' | 'none'
  }
  readonly recorded: {
    readonly seen: number
    readonly recorded: number
    readonly ignored: number
    readonly failed: number
  }
}

/**
 * Build the reading.
 *
 * @param input - the instant, the route's own path, the log's identity and damage report, the record
 *   count, the counts the team fold produced, the relay's counters, and the recorder's counters.
 * @returns the document, with every number the caller supplied and nothing invented.
 */
export function busStatus(input: {
  readonly at: number
  readonly path: string
  readonly log: {
    readonly lastSeq: number
    readonly writer: string
    readonly instance: string
    readonly damage: DamageReport | null
  }
  readonly records: number
  /** The team tree's node count, read by the caller from the same fold. */
  readonly teams: number
  readonly counts: TeamState['counts']
  readonly relay: RelayReading
  readonly messages: BusStatus['messages']
  readonly recorded: TeamRecorder['counts']
}): BusStatus {
  return {
    ok: true,
    path: input.path,
    at: input.at,
    ledger: {
      records: input.records,
      lastSeq: input.log.lastSeq,
      writer: input.log.writer,
      instance: input.log.instance,
      damage: input.log.damage === null
        ? null
        : {
          brokenLines: input.log.damage.brokenLines.length,
          lastGoodSeq: input.log.damage.lastGoodSeq,
          bytes: input.log.damage.bytes,
        },
    },
    world: {
      teams: input.teams,
      members: input.counts.members,
      tasks: input.counts.tasks,
      folded: input.counts.folded,
      unknown: input.counts.unknown,
    },
    relay: input.relay,
    messages: input.messages,
    recorded: {
      seen: input.recorded.seen,
      recorded: input.recorded.recorded,
      ignored: input.recorded.ignored,
      failed: input.recorded.failed,
    },
  }
}
